/**
 * Database Cleaner
 * Removes products with empty/minimal data (name only)
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'chainhoist_data', 'chainhoist_database.json');
const BACKUP_FILE = path.join(__dirname, 'chainhoist_data', 'chainhoist_database_backup.json');

function analyzeDatabase() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const products = db.data || db.products || db;

  const empty = [];
  const good = [];

  products.forEach(p => {
    // Check if product has meaningful data beyond just name
    const hasCapacity = p.loadCapacity && p.loadCapacity !== 'Unknown';
    const hasSpeed = p.liftingSpeed && p.liftingSpeed !== 'Unknown';
    const hasPower = p.motorPower && p.motorPower !== 'Unknown';
    const hasDescription = p.description && p.description.length > 50;
    const hasImages = p.images && p.images.length > 0;
    const hasSpecs = p.specifications && Object.keys(p.specifications).length > 0;

    const hasData = hasCapacity || hasSpeed || hasPower || hasDescription || hasImages || hasSpecs;

    if (!hasData) {
      empty.push(p);
    } else {
      good.push(p);
    }
  });

  return { empty, good, total: products.length };
}

function cleanDatabase(dryRun = true) {
  console.log('\n=== Database Cleaner ===\n');

  const { empty, good, total } = analyzeDatabase();

  console.log(`Total products: ${total}`);
  console.log(`Products with data: ${good.length}`);
  console.log(`Empty products (name only): ${empty.length}`);

  if (empty.length > 0) {
    console.log('\n--- Empty Products ---');
    empty.forEach(p => {
      console.log(`  - ${p.manufacturer}: ${p.model}`);
    });
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made. Run with --clean to remove empty entries.');
    return;
  }

  // Backup original
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(db, null, 2));
  console.log(`\nBackup saved to: ${BACKUP_FILE}`);

  // Save cleaned database
  if (db.data) {
    db.data = good;
  } else if (db.products) {
    db.products = good;
  }
  db.metadata = db.metadata || {};
  db.metadata.cleanedAt = new Date().toISOString();
  db.metadata.removedCount = empty.length;
  if (db.stats) {
    db.stats.totalProducts = good.length;
  }

  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  console.log(`Cleaned database saved: ${good.length} products`);
  console.log(`Removed ${empty.length} empty entries`);
}

// CLI
const args = process.argv.slice(2);
const shouldClean = args.includes('--clean');

cleanDatabase(!shouldClean);
