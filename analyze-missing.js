const db = require('./chainhoist_data_processed/chainhoist_database_processed.json');

// Find products missing load capacity
const missing = db.filter(p => !p.loadCapacity);

// Group by manufacturer
const byManufacturer = {};
missing.forEach(p => {
  const mfr = p.manufacturer || 'Unknown';
  if (!byManufacturer[mfr]) {
    byManufacturer[mfr] = [];
  }
  byManufacturer[mfr].push(p);
});

// Sort by count
const sorted = Object.entries(byManufacturer)
  .sort((a, b) => b[1].length - a[1].length);

console.log('Products missing load capacity by manufacturer:\n');
sorted.forEach(([mfr, products]) => {
  const withUrl = products.filter(p => p.url).length;
  console.log(`${mfr}: ${products.length} products (${withUrl} with URLs)`);
});

// Show products with URLs that could be re-scraped
console.log('\n--- Top candidates for re-scraping ---');
const candidates = missing.filter(p => {
  // Has a product URL (not just manufacturer URL)
  if (!p.url) {
    return false;
  }
  // Exclude category pages
  const model = (p.model || '').toLowerCase();
  if (model.includes('category') || model.includes('view all')) {
    return false;
  }
  // Has hoist-related keywords
  const keywords = ['hoist', 'chain', 'wire', 'winch', 'lift'];
  return keywords.some(k => model.includes(k));
});

console.log(`Found ${candidates.length} re-scrape candidates\n`);
candidates.slice(0, 15).forEach((p, i) => {
  console.log(`${i+1}. ${p.manufacturer} - ${p.model}`);
  console.log(`   ${p.url}`);
});
