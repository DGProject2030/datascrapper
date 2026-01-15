const db = require('./chainhoist_data_processed/chainhoist_database_processed.json');
const withCapacity = db.filter(p => p.loadCapacity);
const withPdfExtracted = db.filter(p => p.pdfExtracted);
const missing = db.filter(p => !p.loadCapacity);

console.log('=== DATABASE STATS ===');
console.log('Total products:', db.length);
console.log('Products with load capacity:', withCapacity.length);
console.log('Products with PDF-extracted data:', withPdfExtracted.length);
console.log('Products missing load capacity:', missing.length);
console.log();

// By manufacturer with data
const byMfr = {};
withCapacity.forEach(p => {
  byMfr[p.manufacturer] = (byMfr[p.manufacturer] || 0) + 1;
});
console.log('=== PRODUCTS WITH LOAD CAPACITY BY MANUFACTURER ===');
Object.entries(byMfr).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([m,c]) => {
  console.log(`  ${m}: ${c}`);
});
