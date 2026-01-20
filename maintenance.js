#!/usr/bin/env node
/**
 * Maintenance Wizard for Chainhoist Database
 * Consolidates cleanup, reporting, and maintenance tasks
 *
 * Usage:
 *   node maintenance.js              - Interactive menu
 *   node maintenance.js <task>       - Run specific task
 *   node maintenance.js --scheduled  - Run scheduled maintenance (non-interactive)
 *   node maintenance.js --list       - List available tasks
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Paths
const DB_PATH = path.join(__dirname, 'chainhoist_data', 'chainhoist_database.json');
const PROCESSED_PATH = path.join(__dirname, 'chainhoist_data_processed', 'chainhoist_database_processed.json');
const QUALITY_REPORT_PATH = path.join(__dirname, 'chainhoist_data_processed', 'data_quality_report.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function c(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

// Load database
function loadDatabase() {
  const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  return Array.isArray(raw) ? raw : raw.data || [];
}

// Save database
function saveDatabase(data) {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (Array.isArray(db)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } else {
    db.data = data;
    db.stats = db.stats || {};
    db.stats.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }
}

// Get database stats summary
function getDbSummary() {
  const data = loadDatabase();
  const manufacturers = new Set(data.map(p => p.manufacturer));
  const withImages = data.filter(p => p.images && p.images.length > 0).length;
  const withPdfs = data.filter(p => p.pdfs && p.pdfs.length > 0).length;

  return {
    total: data.length,
    manufacturers: manufacturers.size,
    withImages,
    withPdfs
  };
}

// ===================== REPORT TASKS =====================

async function reportHealth() {
  console.log(c('bright', '\n=== Database Health Report ===\n'));

  const data = loadDatabase();
  const total = data.length;

  // Field completeness
  const fields = {
    loadCapacity: { count: 0, critical: true },
    liftingSpeed: { count: 0, critical: true },
    motorPower: { count: 0, critical: false },
    weight: { count: 0, critical: false },
    dimensions: { count: 0, critical: false },
    images: { count: 0, critical: false },
    pdfs: { count: 0, critical: false },
    classification: { count: 0, critical: true }
  };

  for (const p of data) {
    if (p.loadCapacity) {
      fields.loadCapacity.count++;
    }
    if (p.liftingSpeed) {
      fields.liftingSpeed.count++;
    }
    if (p.motorPower) {
      fields.motorPower.count++;
    }
    if (p.weight) {
      fields.weight.count++;
    }
    if (p.dimensions) {
      fields.dimensions.count++;
    }
    if (p.images && p.images.length > 0) {
      fields.images.count++;
    }
    if (p.pdfs && p.pdfs.length > 0) {
      fields.pdfs.count++;
    }
    if (p.classification && p.classification.length > 0) {
      fields.classification.count++;
    }
  }

  console.log(c('cyan', 'Field Completeness:'));
  for (const [name, info] of Object.entries(fields)) {
    const pct = ((info.count / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    const color = pct > 70 ? 'green' : pct > 40 ? 'yellow' : 'red';
    const critical = info.critical ? ' *' : '';
    console.log(`  ${name.padEnd(15)} ${c(color, bar)} ${pct.padStart(5)}%${critical}`);
  }

  // Staleness check
  const now = Date.now();
  const staleThreshold = 90 * 24 * 60 * 60 * 1000; // 90 days
  const staleCount = data.filter(p => {
    if (!p.lastUpdated) {
      return true;
    }
    return (now - new Date(p.lastUpdated).getTime()) > staleThreshold;
  }).length;

  console.log(c('cyan', '\nData Freshness:'));
  console.log(`  Stale (>90 days): ${staleCount} products (${((staleCount / total) * 100).toFixed(1)}%)`);

  // Manufacturer coverage
  const mfrStats = {};
  for (const p of data) {
    mfrStats[p.manufacturer] = (mfrStats[p.manufacturer] || 0) + 1;
  }
  const topMfrs = Object.entries(mfrStats).sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log(c('cyan', '\nTop Manufacturers:'));
  for (const [mfr, count] of topMfrs) {
    console.log(`  ${count.toString().padStart(3)} ${mfr}`);
  }

  // Overall health score
  const criticalFields = Object.entries(fields).filter(([, v]) => v.critical);
  const criticalAvg = criticalFields.reduce((sum, [, v]) => sum + (v.count / total), 0) / criticalFields.length;
  const healthScore = Math.round(criticalAvg * 100);

  console.log(c('cyan', '\nOverall Health Score:'));
  const healthColor = healthScore > 70 ? 'green' : healthScore > 40 ? 'yellow' : 'red';
  console.log(`  ${c(healthColor, c('bright', `${healthScore}/100`))}`);

  if (healthScore < 50) {
    console.log(c('yellow', '\nRecommendations:'));
    if (fields.loadCapacity.count / total < 0.5) {
      console.log('  - Run scraping to fill missing load capacity data');
    }
    if (fields.images.count / total < 0.3) {
      console.log('  - Run image scraper: node maintenance.js scrape:images');
    }
    if (staleCount > total * 0.3) {
      console.log('  - Consider re-scraping stale products');
    }
  }

  console.log('');
  return { healthScore, total, fields };
}

async function reportStats() {
  console.log(c('bright', '\n=== Database Statistics ===\n'));

  const data = loadDatabase();

  // Basic counts
  const manufacturers = {};
  const productTypes = {};
  const capacityRanges = { '≤250kg': 0, '251-500kg': 0, '501-1000kg': 0, '1001-2000kg': 0, '>2000kg': 0 };

  for (const p of data) {
    manufacturers[p.manufacturer] = (manufacturers[p.manufacturer] || 0) + 1;
    if (p.productType) {
      productTypes[p.productType] = (productTypes[p.productType] || 0) + 1;
    }

    // Parse capacity
    if (p.loadCapacity) {
      const match = p.loadCapacity.match(/(\d+)/);
      if (match) {
        const kg = parseInt(match[1]);
        if (kg <= 250) {
          capacityRanges['≤250kg']++;
        } else if (kg <= 500) {
          capacityRanges['251-500kg']++;
        } else if (kg <= 1000) {
          capacityRanges['501-1000kg']++;
        } else if (kg <= 2000) {
          capacityRanges['1001-2000kg']++;
        } else {
          capacityRanges['>2000kg']++;
        }
      }
    }
  }

  console.log(c('cyan', 'Summary:'));
  console.log(`  Total Products: ${data.length}`);
  console.log(`  Manufacturers: ${Object.keys(manufacturers).length}`);
  console.log(`  Product Types: ${Object.keys(productTypes).length}`);

  console.log(c('cyan', '\nCapacity Distribution:'));
  for (const [range, count] of Object.entries(capacityRanges)) {
    const pct = ((count / data.length) * 100).toFixed(1);
    console.log(`  ${range.padEnd(12)} ${count.toString().padStart(3)} (${pct}%)`);
  }

  console.log(c('cyan', '\nManufacturers:'));
  const sortedMfrs = Object.entries(manufacturers).sort((a, b) => b[1] - a[1]);
  for (const [mfr, count] of sortedMfrs) {
    console.log(`  ${count.toString().padStart(3)} ${mfr}`);
  }

  console.log('');
  return { total: data.length, manufacturers, capacityRanges };
}

async function reportMissing() {
  console.log(c('bright', '\n=== Missing Data Analysis ===\n'));

  const data = loadDatabase();

  const missing = {
    loadCapacity: [],
    liftingSpeed: [],
    images: [],
    pdfs: [],
    classification: []
  };

  for (const p of data) {
    if (!p.loadCapacity) {
      missing.loadCapacity.push(p);
    }
    if (!p.liftingSpeed) {
      missing.liftingSpeed.push(p);
    }
    if (!p.images || p.images.length === 0) {
      missing.images.push(p);
    }
    if (!p.pdfs || p.pdfs.length === 0) {
      missing.pdfs.push(p);
    }
    if (!p.classification || p.classification.length === 0) {
      missing.classification.push(p);
    }
  }

  for (const [field, products] of Object.entries(missing)) {
    console.log(c('cyan', `\nMissing ${field}: ${products.length} products`));

    // Group by manufacturer
    const byMfr = {};
    for (const p of products) {
      byMfr[p.manufacturer] = (byMfr[p.manufacturer] || 0) + 1;
    }

    const sorted = Object.entries(byMfr).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [mfr, count] of sorted) {
      console.log(`  ${count.toString().padStart(3)} ${mfr}`);
    }
  }

  console.log('');
  return missing;
}

// ===================== BACKUP TASKS =====================

async function createBackup() {
  console.log(c('bright', '\n=== Creating Backup ===\n'));

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.json`);

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  fs.writeFileSync(backupFile, JSON.stringify(db, null, 2));

  const stats = fs.statSync(backupFile);
  console.log(c('green', `Backup created: ${backupFile}`));
  console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);

  // Clean old backups (keep last 10)
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (backups.length > 10) {
    const toDelete = backups.slice(10);
    for (const old of toDelete) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
      console.log(c('dim', `Removed old backup: ${old}`));
    }
  }

  console.log('');
  return backupFile;
}

async function listBackups() {
  console.log(c('bright', '\n=== Available Backups ===\n'));

  if (!fs.existsSync(BACKUP_DIR)) {
    console.log(c('yellow', 'No backups found.'));
    return [];
  }

  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (backups.length === 0) {
    console.log(c('yellow', 'No backups found.'));
    return [];
  }

  for (let i = 0; i < backups.length; i++) {
    const file = backups[i];
    const stats = fs.statSync(path.join(BACKUP_DIR, file));
    const date = file.replace('backup_', '').replace('.json', '').replace(/-/g, ':').slice(0, 16);
    console.log(`  [${i + 1}] ${date}  (${(stats.size / 1024).toFixed(1)} KB)`);
  }

  console.log('');
  return backups;
}

async function restoreBackup(backupFile) {
  if (!backupFile) {
    const backups = await listBackups();
    if (backups.length === 0) {
      return;
    }

    const choice = await prompt('Enter backup number to restore (or 0 to cancel): ');
    const idx = parseInt(choice) - 1;
    if (idx < 0 || idx >= backups.length) {
      console.log(c('yellow', 'Cancelled.'));
      return;
    }
    backupFile = path.join(BACKUP_DIR, backups[idx]);
  }

  console.log(c('yellow', `\nRestoring from: ${backupFile}`));
  console.log(c('red', 'WARNING: This will overwrite the current database!'));

  const confirm = await prompt('Type YES to confirm: ');
  if (confirm !== 'YES') {
    console.log(c('yellow', 'Cancelled.'));
    return;
  }

  // Create backup of current state first
  await createBackup();

  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  fs.writeFileSync(DB_PATH, JSON.stringify(backup, null, 2));

  console.log(c('green', 'Database restored successfully.'));
}

// ===================== CLEANUP TASKS =====================

async function cleanupDuplicates(dryRun = true) {
  console.log(c('bright', `\n=== Find Duplicates ${dryRun ? '(DRY RUN)' : ''} ===\n`));

  const data = loadDatabase();
  const duplicates = [];

  // Group by similar identifiers
  const byUrl = {};
  const byModelMfr = {};

  for (const p of data) {
    // By URL
    if (p.url) {
      const key = p.url.toLowerCase().replace(/\/$/, '');
      if (!byUrl[key]) {
        byUrl[key] = [];
      }
      byUrl[key].push(p);
    }

    // By manufacturer + model
    const modelKey = `${p.manufacturer}|${p.model}`.toLowerCase();
    if (!byModelMfr[modelKey]) {
      byModelMfr[modelKey] = [];
    }
    byModelMfr[modelKey].push(p);
  }

  // Find duplicates
  for (const [url, products] of Object.entries(byUrl)) {
    if (products.length > 1) {
      duplicates.push({ type: 'url', key: url, products });
    }
  }

  for (const [key, products] of Object.entries(byModelMfr)) {
    if (products.length > 1 && !duplicates.some(d => d.products.some(p => products.includes(p)))) {
      duplicates.push({ type: 'model', key, products });
    }
  }

  if (duplicates.length === 0) {
    console.log(c('green', 'No duplicates found.'));
    return { found: 0 };
  }

  console.log(c('yellow', `Found ${duplicates.length} duplicate groups:\n`));

  for (const dup of duplicates.slice(0, 10)) {
    console.log(c('cyan', `  ${dup.type}: ${dup.key}`));
    for (const p of dup.products) {
      console.log(`    - ${p.id} (${p.model})`);
    }
  }

  if (duplicates.length > 10) {
    console.log(c('dim', `  ... and ${duplicates.length - 10} more`));
  }

  if (!dryRun) {
    console.log(c('red', '\nMerging duplicates is not yet implemented.'));
    console.log('Please review and manually merge if needed.');
  }

  console.log('');
  return { found: duplicates.length, duplicates };
}

async function cleanupEmpty(dryRun = true) {
  console.log(c('bright', `\n=== Find Empty Records ${dryRun ? '(DRY RUN)' : ''} ===\n`));

  const data = loadDatabase();
  const minFields = 3; // Minimum useful fields beyond id/manufacturer/model

  const emptyRecords = data.filter(p => {
    let fieldCount = 0;
    if (p.loadCapacity) {
      fieldCount++;
    }
    if (p.liftingSpeed) {
      fieldCount++;
    }
    if (p.motorPower) {
      fieldCount++;
    }
    if (p.weight) {
      fieldCount++;
    }
    if (p.description && p.description.length > 20) {
      fieldCount++;
    }
    if (p.images && p.images.length > 0) {
      fieldCount++;
    }
    if (p.pdfs && p.pdfs.length > 0) {
      fieldCount++;
    }
    return fieldCount < minFields;
  });

  if (emptyRecords.length === 0) {
    console.log(c('green', 'No empty records found.'));
    return { found: 0 };
  }

  console.log(c('yellow', `Found ${emptyRecords.length} records with < ${minFields} useful fields:\n`));

  // Group by manufacturer
  const byMfr = {};
  for (const p of emptyRecords) {
    if (!byMfr[p.manufacturer]) {
      byMfr[p.manufacturer] = [];
    }
    byMfr[p.manufacturer].push(p);
  }

  for (const [mfr, products] of Object.entries(byMfr).slice(0, 10)) {
    console.log(c('cyan', `  ${mfr}: ${products.length}`));
    for (const p of products.slice(0, 3)) {
      console.log(`    - ${p.model}`);
    }
    if (products.length > 3) {
      console.log(c('dim', `    ... and ${products.length - 3} more`));
    }
  }

  if (!dryRun) {
    await createBackup();

    const confirm = await prompt(`\nRemove ${emptyRecords.length} empty records? (yes/no): `);
    if (confirm.toLowerCase() !== 'yes') {
      console.log(c('yellow', 'Cancelled.'));
      return { found: emptyRecords.length, removed: 0 };
    }

    const idsToRemove = new Set(emptyRecords.map(p => p.id));
    const newData = data.filter(p => !idsToRemove.has(p.id));
    saveDatabase(newData);

    console.log(c('green', `Removed ${emptyRecords.length} empty records.`));
    return { found: emptyRecords.length, removed: emptyRecords.length };
  }

  console.log(c('dim', '\nRun with --apply to remove these records.'));
  console.log('');
  return { found: emptyRecords.length };
}

async function cleanupStale(dryRun = true) {
  console.log(c('bright', `\n=== Find Stale Records ${dryRun ? '(DRY RUN)' : ''} ===\n`));

  const data = loadDatabase();
  const staleDays = 90;
  const staleThreshold = staleDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const staleRecords = data.filter(p => {
    if (!p.lastUpdated) {
      return true;
    }
    return (now - new Date(p.lastUpdated).getTime()) > staleThreshold;
  });

  if (staleRecords.length === 0) {
    console.log(c('green', 'No stale records found.'));
    return { found: 0 };
  }

  console.log(c('yellow', `Found ${staleRecords.length} records older than ${staleDays} days:\n`));

  // Group by manufacturer
  const byMfr = {};
  for (const p of staleRecords) {
    if (!byMfr[p.manufacturer]) {
      byMfr[p.manufacturer] = [];
    }
    byMfr[p.manufacturer].push(p);
  }

  const sorted = Object.entries(byMfr).sort((a, b) => b[1].length - a[1].length);
  for (const [mfr, products] of sorted.slice(0, 10)) {
    console.log(`  ${products.length.toString().padStart(3)} ${mfr}`);
  }

  console.log(c('dim', '\nStale records are flagged for re-scraping, not deletion.'));
  console.log('');
  return { found: staleRecords.length, records: staleRecords };
}

async function cleanupInvalid(dryRun = true) {
  console.log(c('bright', `\n=== Find Non-Hoist/Invalid Records ${dryRun ? '(DRY RUN)' : ''} ===\n`));

  const { validateProduct } = require('./scrape-validator');
  const data = loadDatabase();

  const invalidRecords = [];
  for (const p of data) {
    const result = validateProduct(p, { strict: false, logWarnings: false });
    if (!result.valid) {
      invalidRecords.push({ product: p, reasons: result.reasons });
    }
  }

  if (invalidRecords.length === 0) {
    console.log(c('green', 'No invalid records found. All products are valid hoists/winches/trolleys/jacks.'));
    return { found: 0 };
  }

  console.log(c('yellow', `Found ${invalidRecords.length} invalid records:\n`));

  // Group by reason
  const byReason = {};
  for (const { product, reasons } of invalidRecords) {
    const mainReason = reasons[0] || 'Unknown';
    if (!byReason[mainReason]) {
      byReason[mainReason] = [];
    }
    byReason[mainReason].push(product);
  }

  for (const [reason, products] of Object.entries(byReason).slice(0, 5)) {
    console.log(c('cyan', `  ${reason}:`));
    for (const p of products.slice(0, 3)) {
      console.log(`    - ${p.manufacturer}: ${p.model}`);
    }
    if (products.length > 3) {
      console.log(c('dim', `    ... and ${products.length - 3} more`));
    }
  }

  if (!dryRun) {
    await createBackup();

    const confirm = await prompt(`\nRemove ${invalidRecords.length} invalid records? (yes/no): `);
    if (confirm.toLowerCase() !== 'yes') {
      console.log(c('yellow', 'Cancelled.'));
      return { found: invalidRecords.length, removed: 0 };
    }

    const idsToRemove = new Set(invalidRecords.map(r => r.product.id));
    const newData = data.filter(p => !idsToRemove.has(p.id));
    saveDatabase(newData);

    console.log(c('green', `Removed ${invalidRecords.length} invalid records.`));
    return { found: invalidRecords.length, removed: invalidRecords.length };
  }

  console.log(c('dim', '\nRun with --apply to remove these records.'));
  console.log('');
  return { found: invalidRecords.length, records: invalidRecords };
}

// ===================== SCRAPING TASKS =====================

async function scrapeImages(options = {}) {
  const { limit = 50, dryRun = false } = options;

  console.log(c('bright', `\n=== Scrape Missing Images ${dryRun ? '(DRY RUN)' : ''} ===\n`));

  const data = loadDatabase();

  // Find products without images that have valid URLs
  const needImages = data.filter(p => {
    if (p.images && p.images.length > 0) {
      return false;
    }
    if (!p.url || !p.url.startsWith('http')) {
      return false;
    }
    try {
      return new URL(p.url).pathname.length > 2;
    } catch {
      return false;
    }
  });

  console.log(`Products without images: ${needImages.length}`);
  console.log(`Will process: ${Math.min(needImages.length, limit)}`);

  if (dryRun) {
    console.log(c('dim', '\nRun with --apply to scrape images.'));
    return { needImages: needImages.length };
  }

  // Use the existing image scraper
  console.log(c('cyan', '\nLaunching image scraper...'));
  const { spawn } = require('child_process');
  const scraper = spawn('node', ['image-scraper.js'], { stdio: 'inherit' });

  return new Promise((resolve) => {
    scraper.on('close', (code) => {
      if (code === 0) {
        console.log(c('green', '\nImage scraping completed.'));
      } else {
        console.log(c('red', `\nImage scraper exited with code ${code}`));
      }
      resolve({ completed: code === 0 });
    });
  });
}

// ===================== MAINTENANCE TASKS =====================

async function runProcessor() {
  console.log(c('bright', '\n=== Running Data Processor ===\n'));

  const { spawn } = require('child_process');
  const processor = spawn('node', ['chainhoist-data-processor.js'], { stdio: 'inherit' });

  return new Promise((resolve) => {
    processor.on('close', (code) => {
      if (code === 0) {
        console.log(c('green', '\nProcessing completed.'));
      } else {
        console.log(c('red', `\nProcessor exited with code ${code}`));
      }
      resolve({ completed: code === 0 });
    });
  });
}

// ===================== SCHEDULED MAINTENANCE =====================

async function runScheduledMaintenance() {
  console.log(c('bright', '\n=== Scheduled Maintenance ==='));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const results = {};

  // 1. Create backup
  console.log(c('cyan', '[1/4] Creating backup...'));
  results.backup = await createBackup();

  // 2. Health report
  console.log(c('cyan', '[2/4] Generating health report...'));
  results.health = await reportHealth();

  // 3. Find duplicates (report only)
  console.log(c('cyan', '[3/4] Checking for duplicates...'));
  results.duplicates = await cleanupDuplicates(true);

  // 4. Run processor
  console.log(c('cyan', '[4/4] Running data processor...'));
  results.processor = await runProcessor();

  console.log(c('bright', '\n=== Scheduled Maintenance Complete ==='));
  console.log(`Finished: ${new Date().toISOString()}`);

  return results;
}

// ===================== CLI & MENU =====================

let rl;

function prompt(question) {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function closePrompt() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

async function showMenu() {
  const summary = getDbSummary();

  console.log(c('bright', '\n╔════════════════════════════════════════════════════════════╗'));
  console.log(c('bright', '║        CHAINHOIST DATABASE MAINTENANCE WIZARD              ║'));
  console.log(c('bright', '╚════════════════════════════════════════════════════════════╝'));
  console.log(`\nDatabase: ${c('cyan', summary.total)} products | ${c('cyan', summary.manufacturers)} manufacturers`);
  console.log(`Images: ${summary.withImages} | PDFs: ${summary.withPdfs}\n`);

  console.log(c('cyan', '[1] Reports'));
  console.log('    1.1 Health check');
  console.log('    1.2 Full statistics');
  console.log('    1.3 Missing data analysis');

  console.log(c('cyan', '\n[2] Cleanup'));
  console.log('    2.1 Find duplicates');
  console.log('    2.2 Find empty records');
  console.log('    2.3 Find stale records');
  console.log('    2.4 Find non-hoist items');

  console.log(c('cyan', '\n[3] Scraping'));
  console.log('    3.1 Scrape missing images');

  console.log(c('cyan', '\n[4] Maintenance'));
  console.log('    4.1 Run data processor');
  console.log('    4.2 Create backup');
  console.log('    4.3 View backups');
  console.log('    4.4 Restore from backup');

  console.log(c('cyan', '\n[5] Run scheduled maintenance'));

  console.log(c('dim', '\n[0] Exit'));

  const choice = await prompt('\nSelect option: ');

  switch (choice) {
  case '1': case '1.1': await reportHealth(); break;
  case '1.2': await reportStats(); break;
  case '1.3': await reportMissing(); break;
  case '2': case '2.1': await cleanupDuplicates(true); break;
  case '2.2': await cleanupEmpty(true); break;
  case '2.3': await cleanupStale(true); break;
  case '2.4': await cleanupInvalid(true); break;
  case '3': case '3.1': await scrapeImages({ dryRun: true }); break;
  case '4': case '4.1': await runProcessor(); break;
  case '4.2': await createBackup(); break;
  case '4.3': await listBackups(); break;
  case '4.4': await restoreBackup(); break;
  case '5': await runScheduledMaintenance(); break;
  case '0': case 'q': case 'quit': case 'exit':
    closePrompt();
    return false;
  default:
    console.log(c('yellow', 'Invalid option.'));
  }

  return true;
}

function showHelp() {
  console.log(`
${c('bright', 'Chainhoist Database Maintenance Wizard')}

${c('cyan', 'Usage:')}
  node maintenance.js              Interactive menu
  node maintenance.js <task>       Run specific task
  node maintenance.js --scheduled  Run scheduled maintenance
  node maintenance.js --list       List available tasks
  node maintenance.js --help       Show this help

${c('cyan', 'Tasks:')}
  report:health          Database health check
  report:stats           Full statistics
  report:missing         Missing data analysis

  cleanup:duplicates     Find duplicate records
  cleanup:empty          Find empty records
  cleanup:stale          Find stale records

  scrape:images          Scrape missing images

  maintain:process       Run data processor
  maintain:backup        Create backup
  maintain:restore       Restore from backup

${c('cyan', 'Options:')}
  --dry-run              Preview changes without applying (default for cleanup)
  --apply                Apply changes (required for destructive operations)
  --limit=N              Limit number of items to process
`);
}

function listTasks() {
  console.log(c('bright', '\nAvailable Tasks:\n'));
  const tasks = [
    ['report:health', 'Database health check'],
    ['report:stats', 'Full statistics'],
    ['report:missing', 'Missing data analysis'],
    ['cleanup:duplicates', 'Find duplicate records'],
    ['cleanup:empty', 'Find empty records'],
    ['cleanup:stale', 'Find stale records'],
    ['cleanup:invalid', 'Find non-hoist/invalid records'],
    ['scrape:images', 'Scrape missing images'],
    ['maintain:process', 'Run data processor'],
    ['maintain:backup', 'Create backup'],
    ['maintain:restore', 'Restore from backup']
  ];

  for (const [task, desc] of tasks) {
    console.log(`  ${c('cyan', task.padEnd(22))} ${desc}`);
  }
  console.log('');
}

async function runTask(task, options) {
  const dryRun = !options.apply;

  switch (task) {
  case 'report:health': return reportHealth();
  case 'report:stats': return reportStats();
  case 'report:missing': return reportMissing();
  case 'cleanup:duplicates': return cleanupDuplicates(dryRun);
  case 'cleanup:empty': return cleanupEmpty(dryRun);
  case 'cleanup:stale': return cleanupStale(dryRun);
  case 'cleanup:invalid': return cleanupInvalid(dryRun);
  case 'scrape:images': return scrapeImages({ dryRun, limit: options.limit || 50 });
  case 'maintain:process': return runProcessor();
  case 'maintain:backup': return createBackup();
  case 'maintain:restore': return restoreBackup();
  default:
    console.log(c('red', `Unknown task: ${task}`));
    console.log('Run with --list to see available tasks.');
    process.exit(1);
  }
}

// ===================== MAIN =====================

async function main() {
  const args = process.argv.slice(2);

  // Parse options
  const options = {
    apply: args.includes('--apply'),
    dryRun: args.includes('--dry-run'),
    scheduled: args.includes('--scheduled'),
    help: args.includes('--help') || args.includes('-h'),
    list: args.includes('--list')
  };

  // Parse limit
  const limitArg = args.find(a => a.startsWith('--limit='));
  if (limitArg) {
    options.limit = parseInt(limitArg.split('=')[1]);
  }

  // Get task name (first non-flag argument)
  const task = args.find(a => !a.startsWith('-'));

  if (options.help) {
    showHelp();
    return;
  }

  if (options.list) {
    listTasks();
    return;
  }

  if (options.scheduled) {
    await runScheduledMaintenance();
    return;
  }

  if (task) {
    await runTask(task, options);
    return;
  }

  // Interactive menu
  while (await showMenu()) {
    // Continue showing menu
  }

  console.log(c('dim', 'Goodbye!'));
}

main().catch(err => {
  console.error(c('red', 'Error:'), err.message);
  process.exit(1);
});
