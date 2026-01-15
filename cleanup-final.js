/**
 * Final cleanup - remove remaining non-product entries
 */

const fs = require('fs');
const DATABASE_PATH = 'chainhoist_data_processed/chainhoist_database_processed.json';

const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
console.log('Current database size:', database.length);

// Patterns that indicate non-product pages
const nonProductPatterns = [
  // PLANETA non-products
  /^contact us$/i,
  /^our challenge/i,
  /^industrial services$/i,
  /^lifting technology$/i,
  /^slings.*straps$/i,
  /^PLANETA lifting technology$/i,

  // Generic category names (ending with just "s" from "Hoists")
  /^lever s$/i,
  /^hand s$/i,
  /^air s$/i,
  /^electric wire rope s$/i,
  /^explosion proof.*s$/i,
  /^cable pullers/i,
  /^a global leader/i,
  /compressed air.*s$/i,
  /manual.*s$/i,
  /wire rope.*s$/i,
  /^atex s$/i,

  // Error pages
  /seite nicht gefunden/i,  // German "Page not found"
  /page not found/i,
  /404/i,
  /not found/i
];

const removed = [];
const cleaned = database.filter(p => {
  const model = (p.model || '').trim();

  // Check against non-product patterns
  for (const pattern of nonProductPatterns) {
    if (pattern.test(model)) {
      removed.push({ manufacturer: p.manufacturer, model: model, reason: pattern.toString() });
      return false;
    }
  }

  return true;
});

console.log('\n=== REMOVED ENTRIES ===');
removed.forEach(r => {
  console.log(`  - ${r.manufacturer}: "${r.model}"`);
});

console.log('\n=== CLEANUP SUMMARY ===');
console.log('Before:', database.length);
console.log('After:', cleaned.length);
console.log('Removed:', removed.length);

// Save
fs.writeFileSync(DATABASE_PATH, JSON.stringify(cleaned, null, 2));
console.log('\nDatabase saved!');

// Show remaining missing load capacity
const stillMissing = cleaned.filter(p => !p.loadCapacity);
console.log('\n=== STILL MISSING LOAD CAPACITY ===');
console.log('Count:', stillMissing.length);

const byMfr = {};
stillMissing.forEach(p => {
  const mfr = p.manufacturer || 'Unknown';
  if (!byMfr[mfr]) {
    byMfr[mfr] = [];
  }
  byMfr[mfr].push(p.model);
});

Object.entries(byMfr)
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([mfr, models]) => {
    console.log(`\n${mfr} (${models.length}):`);
    models.forEach(m => console.log(`  - ${m}`));
  });
