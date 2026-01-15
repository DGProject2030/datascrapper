const db = require('./chainhoist_data_processed/chainhoist_database_processed.json');
const fs = require('fs');

// Find products missing load capacity
const missing = db.filter(p => !p.loadCapacity);

console.log('Products missing load capacity:', missing.length);

// Check which have PDF links but not downloaded
const withPdfLinks = missing.filter(p => p.pdfs && p.pdfs.length > 0);
const withDownloadedPdfs = missing.filter(p => p.downloadedPDFs && p.downloadedPDFs.length > 0);
const needsDownload = missing.filter(p => {
  const hasPdfLinks = p.pdfs && p.pdfs.length > 0;
  const hasDownloaded = p.downloadedPDFs && p.downloadedPDFs.length > 0;
  return hasPdfLinks && !hasDownloaded;
});

console.log('With PDF links:', withPdfLinks.length);
console.log('With downloaded PDFs:', withDownloadedPdfs.length);
console.log('Need PDF download:', needsDownload.length);

console.log('\n--- Products needing PDF download ---');
needsDownload.slice(0, 20).forEach((p, i) => {
  console.log(`\n${i+1}. ${p.manufacturer} - ${p.model}`);
  console.log('   PDFs:', p.pdfs.map(pdf => pdf.type).join(', '));
});

// Also check products with load capacity to see PDF coverage
const withCapacity = db.filter(p => p.loadCapacity);
const capacityWithPdfs = withCapacity.filter(p => p.downloadedPDFs && p.downloadedPDFs.length > 0);
console.log('\n--- Coverage Stats ---');
console.log('Products with load capacity:', withCapacity.length);
console.log('  - with downloaded PDFs:', capacityWithPdfs.length);
