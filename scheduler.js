/**
 * Scraping Scheduler Module
 * Handles weekly automated scraping with logging and history tracking
 * @version 1.0.0
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load configuration
let config;
try {
  config = require('./config.json');
} catch {
  config = {
    scheduler: {
      enabled: true,
      cronExpression: '0 2 * * 0', // Sunday 2am
      timezone: 'UTC',
      runOnStart: false,
      notifications: { onError: true, onSuccess: false },
      historyFile: 'scheduler_history.json',
      logFile: 'logs/scheduler.log'
    }
  };
}

const SCHEDULER_CONFIG = config.scheduler || {};

/**
 * Logger for scheduler
 */
class SchedulerLogger {
  constructor(logFile = SCHEDULER_CONFIG.logFile || 'logs/scheduler.log') {
    this.logFile = logFile;
    this.ensureLogDir();
  }

  ensureLogDir() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    // Console output
    console.log(logEntry.trim());

    // File output
    try {
      fs.appendFileSync(this.logFile, logEntry);
    } catch (err) {
      console.error(`Failed to write to log file: ${err.message}`);
    }
  }

  info(message) {
    this.log('info', message);
  }
  warn(message) {
    this.log('warn', message);
  }
  error(message) {
    this.log('error', message);
  }
  debug(message) {
    this.log('debug', message);
  }
}

const logger = new SchedulerLogger();

/**
 * Run history manager
 */
class HistoryManager {
  constructor(historyFile = SCHEDULER_CONFIG.historyFile || 'scheduler_history.json') {
    this.historyFile = historyFile;
    this.history = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.historyFile)) {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      }
    } catch (err) {
      logger.warn(`Failed to load history: ${err.message}`);
    }
    return { runs: [], lastRun: null, stats: { total: 0, successful: 0, failed: 0 } };
  }

  save() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (err) {
      logger.error(`Failed to save history: ${err.message}`);
    }
  }

  addRun(run) {
    this.history.runs.unshift(run); // Add to beginning
    this.history.runs = this.history.runs.slice(0, 100); // Keep last 100 runs
    this.history.lastRun = run;
    this.history.stats.total++;
    if (run.success) {
      this.history.stats.successful++;
    } else {
      this.history.stats.failed++;
    }
    this.save();
  }

  getLastRun() {
    return this.history.lastRun;
  }

  getHistory() {
    return this.history;
  }
}

/**
 * Main Scheduler class
 */
class ScrapingScheduler {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
    this.history = new HistoryManager();
  }

  /**
   * Start the scheduler
   * @param {string} cronExpression - Cron expression (default: Sunday 2am)
   */
  start(cronExpression = SCHEDULER_CONFIG.cronExpression || '0 2 * * 0') {
    if (this.cronJob) {
      logger.warn('Scheduler already running');
      return;
    }

    // Validate cron expression
    if (!cron.validate(cronExpression)) {
      logger.error(`Invalid cron expression: ${cronExpression}`);
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    logger.info(`Starting scheduler with cron: ${cronExpression}`);
    logger.info(`Next run: ${this.getNextRun(cronExpression)}`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.runNow();
    }, {
      timezone: SCHEDULER_CONFIG.timezone || 'UTC'
    });

    logger.info('Scheduler started successfully');

    // Run on start if configured
    if (SCHEDULER_CONFIG.runOnStart) {
      logger.info('Running initial scrape...');
      this.runNow();
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('Scheduler stopped');
    }
  }

  /**
   * Run scraping now
   * @param {boolean} withLLM - Enable LLM analysis
   */
  async runNow(withLLM = true) {
    if (this.isRunning) {
      logger.warn('Scraping already in progress, skipping');
      return { success: false, error: 'Already running' };
    }

    this.isRunning = true;
    const startTime = new Date();
    const runId = `run_${startTime.getTime()}`;

    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Starting scheduled scrape: ${runId}`);
    logger.info(`Time: ${startTime.toISOString()}`);
    logger.info(`LLM Analysis: ${withLLM ? 'Enabled' : 'Disabled'}`);
    logger.info('='.repeat(60));

    const run = {
      id: runId,
      startTime: startTime.toISOString(),
      endTime: null,
      duration: null,
      success: false,
      withLLM: withLLM,
      error: null,
      stats: null
    };

    try {
      // Run the scraper
      const scraperResult = await this.runScraper(withLLM);
      run.stats = scraperResult;

      // Run the processor
      const processorResult = await this.runProcessor();
      run.processorStats = processorResult;

      run.success = true;
      logger.info('Scraping completed successfully');
    } catch (err) {
      run.error = err.message;
      logger.error(`Scraping failed: ${err.message}`);

      // Send error notification if configured
      if (SCHEDULER_CONFIG.notifications?.onError) {
        this.sendNotification('error', run);
      }
    }

    const endTime = new Date();
    run.endTime = endTime.toISOString();
    run.duration = (endTime - startTime) / 1000; // seconds

    this.history.addRun(run);
    this.isRunning = false;

    logger.info(`Run completed in ${run.duration}s`);
    logger.info('='.repeat(60) + '\n');

    // Send success notification if configured
    if (run.success && SCHEDULER_CONFIG.notifications?.onSuccess) {
      this.sendNotification('success', run);
    }

    return run;
  }

  /**
   * Run the scraper script
   */
  runScraper(withLLM = true) {
    return new Promise((resolve, reject) => {
      const args = ['chainhoist-scraper-enhanced.js'];
      if (withLLM) {
        args.push('--with-llm');
      }

      logger.info(`Running: node ${args.join(' ')}`);

      const proc = spawn('node', args, {
        cwd: __dirname,
        stdio: ['inherit', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        process.stderr.write(text);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output });
        } else {
          reject(new Error(`Scraper exited with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Run the data processor script
   */
  runProcessor() {
    return new Promise((resolve, reject) => {
      const args = ['chainhoist-data-processor.js'];

      logger.info(`Running: node ${args.join(' ')}`);

      const proc = spawn('node', args, {
        cwd: __dirname,
        stdio: ['inherit', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        process.stderr.write(text);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output });
        } else {
          reject(new Error(`Processor exited with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Get next scheduled run time
   */
  getNextRun(cronExpression = SCHEDULER_CONFIG.cronExpression || '0 2 * * 0') {
    // Parse cron expression to estimate next run
    const parts = cronExpression.split(' ');
    const now = new Date();

    // Simple estimation for weekly schedule
    const dayOfWeek = parseInt(parts[4]) || 0;
    const hour = parseInt(parts[1]) || 2;
    const minute = parseInt(parts[0]) || 0;

    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);

    // Find next occurrence of the day of week
    const currentDay = now.getDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil <= 0 || (daysUntil === 0 && now >= next)) {
      daysUntil += 7;
    }
    next.setDate(next.getDate() + daysUntil);

    return next.toISOString();
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: !!this.cronJob,
      isScrapingNow: this.isRunning,
      cronExpression: SCHEDULER_CONFIG.cronExpression,
      nextRun: this.cronJob ? this.getNextRun() : null,
      lastRun: this.history.getLastRun(),
      stats: this.history.getHistory().stats
    };
  }

  /**
   * Send notification (placeholder - can be extended for email/webhook)
   */
  sendNotification(type, run) {
    if (type === 'error') {
      logger.warn(`NOTIFICATION: Scraping run ${run.id} failed: ${run.error}`);
    } else if (type === 'success') {
      logger.info(`NOTIFICATION: Scraping run ${run.id} completed successfully`);
    }
    // TODO: Implement email or webhook notifications
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  const scheduler = new ScrapingScheduler();

  switch (command) {
  case 'start':
    console.log('\nStarting Chainhoist Scraping Scheduler');
    console.log('Press Ctrl+C to stop\n');
    scheduler.start();

    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\nReceived SIGINT, stopping scheduler...');
      scheduler.stop();
      process.exit(0);
    });
    break;

  case 'run-now':
  case 'run': {
    console.log('\nRunning scraper now...\n');
    const withLLM = !args.includes('--no-llm');
    const result = await scheduler.runNow(withLLM);
    console.log('\nRun result:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
    break;
  }

  case 'status': {
    const status = scheduler.getStatus();
    console.log('\nScheduler Status:');
    console.log(JSON.stringify(status, null, 2));
    break;
  }

  case 'history': {
    const history = scheduler.history.getHistory();
    console.log('\nRun History:');
    console.log(JSON.stringify(history, null, 2));
    break;
  }

  case 'help':
  default:
    console.log(`
Chainhoist Scraping Scheduler

Usage:
  node scheduler.js <command> [options]

Commands:
  start       Start the scheduler (runs weekly by default)
  run-now     Run the scraper immediately
  status      Show scheduler status
  history     Show run history
  help        Show this help message

Options:
  --no-llm    Disable LLM analysis for run-now command

Examples:
  node scheduler.js start           # Start weekly scheduler
  node scheduler.js run-now         # Run scraper now with LLM
  node scheduler.js run-now --no-llm  # Run scraper without LLM
  node scheduler.js status          # Check scheduler status

Schedule:
  Default: Every Sunday at 2:00 AM UTC
  Cron expression: ${SCHEDULER_CONFIG.cronExpression || '0 2 * * 0'}

Configuration:
  Edit config.json to change scheduler settings:
  - cronExpression: When to run (cron format)
  - timezone: Timezone for scheduling
  - runOnStart: Run immediately when scheduler starts
  - notifications: Error/success notification settings
`);
    break;
  }
}

// Export for programmatic use
module.exports = { ScrapingScheduler, HistoryManager, SchedulerLogger };

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
