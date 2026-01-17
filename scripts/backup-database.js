/**
 * Database Backup Script
 * Creates timestamped backups of the chainhoist database
 *
 * Usage: node scripts/backup-database.js [--keep N]
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  dataDir: path.join(__dirname, '..', 'chainhoist_data'),
  processedDir: path.join(__dirname, '..', 'chainhoist_data_processed'),
  backupDir: path.join(__dirname, '..', 'chainhoist_data', 'backups'),
  maxBackups: 10, // Keep last N backups
  filesToBackup: [
    'chainhoist_database.json',
    'personality_enriched.json',
    'pdf_extractions.json'
  ],
  processedFilesToBackup: [
    'chainhoist_database_processed.json',
    'data_quality_report.json'
  ]
};

// Parse command line arguments
const args = process.argv.slice(2);
const keepIndex = args.indexOf('--keep');
const maxBackups = keepIndex !== -1 ? parseInt(args[keepIndex + 1]) : CONFIG.maxBackups;

/**
 * Logger utility
 */
class Logger {
  static info(message) {
    console.log(`[INFO] ${message}`);
  }

  static warn(message) {
    console.warn(`[WARN] ${message}`);
  }

  static error(message) {
    console.error(`[ERROR] ${message}`);
  }

  static success(message) {
    console.log(`[SUCCESS] ${message}`);
  }
}

/**
 * Create a timestamp string for backup folder name
 */
function getTimestamp() {
  const now = new Date();
  return now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
}

/**
 * Get list of existing backup folders sorted by date (newest first)
 */
function getExistingBackups() {
  if (!fs.existsSync(CONFIG.backupDir)) {
    return [];
  }

  return fs.readdirSync(CONFIG.backupDir)
    .filter(name => name.startsWith('backup_'))
    .map(name => ({
      name,
      path: path.join(CONFIG.backupDir, name),
      timestamp: name.replace('backup_', '')
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Delete old backups exceeding the max count
 */
function cleanupOldBackups(backups, keepCount) {
  if (backups.length <= keepCount) {
    return 0;
  }

  const toDelete = backups.slice(keepCount);
  let deleted = 0;

  for (const backup of toDelete) {
    try {
      // Delete all files in the backup folder
      const files = fs.readdirSync(backup.path);
      for (const file of files) {
        fs.unlinkSync(path.join(backup.path, file));
      }
      // Delete the folder
      fs.rmdirSync(backup.path);
      deleted++;
      Logger.info(`Deleted old backup: ${backup.name}`);
    } catch (error) {
      Logger.warn(`Failed to delete backup ${backup.name}: ${error.message}`);
    }
  }

  return deleted;
}

/**
 * Calculate file size in human-readable format
 */
function formatFileSize(bytes) {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Main backup function
 */
async function createBackup() {
  Logger.info('Starting database backup');
  Logger.info(`Max backups to keep: ${maxBackups}`);

  // Ensure backup directory exists
  if (!fs.existsSync(CONFIG.backupDir)) {
    fs.mkdirSync(CONFIG.backupDir, { recursive: true });
    Logger.info(`Created backup directory: ${CONFIG.backupDir}`);
  }

  // Create timestamped backup folder
  const timestamp = getTimestamp();
  const backupFolder = path.join(CONFIG.backupDir, `backup_${timestamp}`);

  try {
    fs.mkdirSync(backupFolder, { recursive: true });
    Logger.info(`Created backup folder: backup_${timestamp}`);
  } catch (error) {
    Logger.error(`Failed to create backup folder: ${error.message}`);
    process.exit(1);
  }

  // Track backup statistics
  const stats = {
    filesBacked: 0,
    totalSize: 0,
    errors: []
  };

  // Backup main data files
  for (const filename of CONFIG.filesToBackup) {
    const sourcePath = path.join(CONFIG.dataDir, filename);

    if (fs.existsSync(sourcePath)) {
      try {
        const destPath = path.join(backupFolder, filename);
        fs.copyFileSync(sourcePath, destPath);
        const fileStats = fs.statSync(destPath);
        stats.filesBacked++;
        stats.totalSize += fileStats.size;
        Logger.success(`Backed up: ${filename} (${formatFileSize(fileStats.size)})`);
      } catch (error) {
        stats.errors.push({ file: filename, error: error.message });
        Logger.warn(`Failed to backup ${filename}: ${error.message}`);
      }
    } else {
      Logger.info(`Skipped: ${filename} (not found)`);
    }
  }

  // Backup processed data files
  for (const filename of CONFIG.processedFilesToBackup) {
    const sourcePath = path.join(CONFIG.processedDir, filename);

    if (fs.existsSync(sourcePath)) {
      try {
        // Add 'processed_' prefix to avoid confusion
        const destFilename = `processed_${filename}`;
        const destPath = path.join(backupFolder, destFilename);
        fs.copyFileSync(sourcePath, destPath);
        const fileStats = fs.statSync(destPath);
        stats.filesBacked++;
        stats.totalSize += fileStats.size;
        Logger.success(`Backed up: ${filename} (${formatFileSize(fileStats.size)})`);
      } catch (error) {
        stats.errors.push({ file: filename, error: error.message });
        Logger.warn(`Failed to backup ${filename}: ${error.message}`);
      }
    } else {
      Logger.info(`Skipped: ${filename} (not found)`);
    }
  }

  // Create backup manifest
  const manifest = {
    timestamp,
    createdAt: new Date().toISOString(),
    files: [],
    totalSize: stats.totalSize,
    errors: stats.errors
  };

  // List all backed up files
  const backedUpFiles = fs.readdirSync(backupFolder);
  for (const file of backedUpFiles) {
    const filePath = path.join(backupFolder, file);
    const fileStats = fs.statSync(filePath);
    manifest.files.push({
      name: file,
      size: fileStats.size,
      sizeHuman: formatFileSize(fileStats.size)
    });
  }

  // Write manifest
  fs.writeFileSync(
    path.join(backupFolder, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Clean up old backups
  const existingBackups = getExistingBackups();
  const deletedCount = cleanupOldBackups(existingBackups, maxBackups);

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('BACKUP COMPLETE');
  console.log('='.repeat(50));
  console.log(`Backup folder: backup_${timestamp}`);
  console.log(`Files backed up: ${stats.filesBacked}`);
  console.log(`Total size: ${formatFileSize(stats.totalSize)}`);
  console.log(`Old backups deleted: ${deletedCount}`);
  console.log(`Current backups: ${getExistingBackups().length}`);

  if (stats.errors.length > 0) {
    console.log(`\nWarnings: ${stats.errors.length} files could not be backed up`);
    for (const err of stats.errors) {
      console.log(`  - ${err.file}: ${err.error}`);
    }
  }

  console.log('='.repeat(50));

  return stats;
}

/**
 * List all backups
 */
function listBackups() {
  const backups = getExistingBackups();

  if (backups.length === 0) {
    Logger.info('No backups found');
    return;
  }

  console.log('\n' + '='.repeat(50));
  console.log('AVAILABLE BACKUPS');
  console.log('='.repeat(50));

  for (const backup of backups) {
    try {
      const manifestPath = path.join(backup.path, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        console.log(`\n${backup.name}`);
        console.log(`  Created: ${manifest.createdAt}`);
        console.log(`  Size: ${formatFileSize(manifest.totalSize)}`);
        console.log(`  Files: ${manifest.files.length}`);
      } else {
        console.log(`\n${backup.name} (no manifest)`);
      }
    } catch (error) {
      console.log(`\n${backup.name} (error reading)`);
    }
  }

  console.log('\n' + '='.repeat(50));
}

// Check for list command
if (args.includes('--list')) {
  listBackups();
  process.exit(0);
}

// Run the backup
createBackup()
  .then(stats => {
    process.exit(stats.errors.length > 0 ? 1 : 0);
  })
  .catch(error => {
    Logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
