/**
 * Clean up duplicate category page entries from the database
 */

const fs = require('fs');
const DATABASE_PATH = 'chainhoist_data_processed/chainhoist_database_processed.json';

const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
console.log('Original database size:', database.length);

// Analyze duplicates
const urlCounts = {};
database.forEach(p => {
  if (p.url) {
    urlCounts[p.url] = (urlCounts[p.url] || 0) + 1;
  }
});

// Find URLs that appear many times (category pages)
const duplicateUrls = Object.entries(urlCounts)
  .filter(([url, count]) => count > 3)
  .sort((a, b) => b[1] - a[1]);

console.log('\n=== URLs appearing more than 3 times (category pages) ===');
duplicateUrls.forEach(([url, count]) => {
  console.log(`  ${count}x: ${url.substring(0, 70)}...`);
});

// Identify category page patterns
const categoryPatterns = [
  /category/i,
  /view.all/i,
  /products\/?$/i,
  /hoists\/?$/i,
  /lifting\/?$/i,
  /equipment\/?$/i
];

// Find products that look like category pages
const categoryProducts = database.filter(p => {
  const model = (p.model || '').toLowerCase();
  const url = (p.url || '').toLowerCase();

  // Check if model name suggests category page
  if (model.includes('category') ||
      model.includes('view all') ||
      model.includes('products') ||
      model === 'hoists' ||
      model === 's' ||  // Just "s" from "Hoists" being cut off
      model.length < 3) {
    return true;
  }

  // Check if URL appears many times
  if (urlCounts[p.url] > 5) {
    return true;
  }

  return false;
});

console.log('\n=== Products identified as category pages ===');
console.log('Count:', categoryProducts.length);
categoryProducts.slice(0, 20).forEach(p => {
  console.log(`  - ${p.manufacturer}: "${p.model}" (${p.url ? p.url.substring(0, 50) : 'no url'}...)`);
});

// Also find entries with very similar/duplicate models from same manufacturer
const modelGroups = {};
database.forEach(p => {
  const key = `${p.manufacturer}|${(p.model || '').toLowerCase().trim()}`;
  if (!modelGroups[key]) {
    modelGroups[key] = [];
  }
  modelGroups[key].push(p);
});

const duplicateModels = Object.entries(modelGroups)
  .filter(([key, products]) => products.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

console.log('\n=== Duplicate model names (same manufacturer) ===');
duplicateModels.slice(0, 15).forEach(([key, products]) => {
  console.log(`  ${products.length}x: ${key}`);
});

// Clean the database
const cleaned = database.filter(p => {
  const model = (p.model || '').toLowerCase().trim();
  const url = p.url || '';

  // Remove if model is too short or generic
  if (model.length < 3 || model === 's' || model === 'hoists') {
    return false;
  }

  // Remove category keywords
  if (model.includes('view all') || model.includes('category')) {
    return false;
  }

  // Remove if URL appears more than 10 times (definitely a category page)
  if (urlCounts[url] > 10) {
    return false;
  }

  return true;
});

// Deduplicate by keeping the entry with most data
const seen = new Map();
const deduped = [];

cleaned.forEach(p => {
  const key = `${p.manufacturer}|${(p.model || '').toLowerCase().trim()}`;

  if (!seen.has(key)) {
    seen.set(key, p);
    deduped.push(p);
  } else {
    // Keep the one with more data
    const existing = seen.get(key);
    const existingScore = (existing.loadCapacity ? 1 : 0) +
                          (existing.liftingSpeed ? 1 : 0) +
                          (existing.motorPower ? 1 : 0) +
                          ((existing.images || []).length > 0 ? 1 : 0) +
                          ((existing.pdfs || []).length > 0 ? 1 : 0);
    const newScore = (p.loadCapacity ? 1 : 0) +
                     (p.liftingSpeed ? 1 : 0) +
                     (p.motorPower ? 1 : 0) +
                     ((p.images || []).length > 0 ? 1 : 0) +
                     ((p.pdfs || []).length > 0 ? 1 : 0);

    if (newScore > existingScore) {
      // Replace with better entry
      const idx = deduped.findIndex(x => x.id === existing.id);
      if (idx >= 0) {
        deduped[idx] = p;
        seen.set(key, p);
      }
    }
  }
});

console.log('\n=== CLEANUP SUMMARY ===');
console.log('Original count:', database.length);
console.log('After removing category pages:', cleaned.length);
console.log('After deduplication:', deduped.length);
console.log('Entries removed:', database.length - deduped.length);

// Save cleaned database
fs.writeFileSync(DATABASE_PATH, JSON.stringify(deduped, null, 2));
console.log('\nDatabase cleaned and saved!');

// Show stats by manufacturer after cleanup
const mfrCounts = {};
deduped.forEach(p => {
  mfrCounts[p.manufacturer] = (mfrCounts[p.manufacturer] || 0) + 1;
});

console.log('\n=== Products by manufacturer (after cleanup) ===');
Object.entries(mfrCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([mfr, count]) => {
    console.log(`  ${mfr}: ${count}`);
  });
