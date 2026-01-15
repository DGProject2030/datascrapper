const db = require('./chainhoist_data_processed/chainhoist_database_processed.json');

const missing = db.filter(p => !p.loadCapacity);

console.log('=== PRODUCTS MISSING LOAD CAPACITY ===');
console.log('Total:', missing.length);
console.log();

// Group by manufacturer
const byMfr = {};
missing.forEach(p => {
  const mfr = p.manufacturer || 'Unknown';
  if (!byMfr[mfr]) {
    byMfr[mfr] = [];
  }
  byMfr[mfr].push(p);
});

Object.entries(byMfr)
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([mfr, products]) => {
    console.log(`\n${mfr} (${products.length}):`);
    products.forEach(p => {
      const hasUrl = p.url ? 'Y' : 'N';
      const hasPdfs = (p.pdfs && p.pdfs.length > 0) ? `${p.pdfs.length} PDFs` : 'No PDFs';
      console.log(`  - ${p.model} [URL: ${hasUrl}, ${hasPdfs}]`);
    });
  });
