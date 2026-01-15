const db = require('./chainhoist_data_processed/chainhoist_database_processed.json');

// Products WITH load capacity that have PDFs
const withData = db.filter(p => p.loadCapacity && p.downloadedPDFs && p.downloadedPDFs.length > 0);
console.log('Products with load capacity AND PDFs:', withData.length);

// Group by manufacturer
const mfrWithPdfs = {};
withData.forEach(p => {
  mfrWithPdfs[p.manufacturer] = (mfrWithPdfs[p.manufacturer] || 0) + 1;
});

console.log('\nManufacturers with PDF-enriched products:');
Object.entries(mfrWithPdfs).sort((a, b) => b[1] - a[1]).forEach(([m, c]) => {
  console.log(`  ${m}: ${c}`);
});

// Check which products have PDF links but haven't been processed
const withPdfLinks = db.filter(p => p.pdfs && p.pdfs.length > 0 && !p.pdfExtracted);
console.log('\nProducts with PDF links but not extracted:', withPdfLinks.length);
withPdfLinks.slice(0, 10).forEach(p => {
  console.log(`  ${p.manufacturer} - ${p.model}`);
  console.log(`    PDFs: ${p.pdfs.length}, Downloaded: ${(p.downloadedPDFs || []).length}`);
});
