const db = require('./chainhoist_data_processed/chainhoist_database_processed.json');
const withCapacity = db.filter(p => p.loadCapacity);
const withSpeed = db.filter(p => p.liftingSpeed);
const withPower = db.filter(p => p.motorPower);
const withVoltage = db.filter(p => p.voltageOptions && p.voltageOptions.length > 0);
const withClassification = db.filter(p => p.classification && p.classification.length > 0);
const withDutyCycle = db.filter(p => p.dutyCycle);
const withPdfExtracted = db.filter(p => p.pdfExtracted);
const missing = db.filter(p => !p.loadCapacity);

console.log('=== DATABASE STATS ===');
console.log('Total products:', db.length);
console.log('Products with load capacity:', withCapacity.length);
console.log('Products with lifting speed:', withSpeed.length);
console.log('Products with motor power:', withPower.length);
console.log('Products with voltage options:', withVoltage.length);
console.log('Products with classification:', withClassification.length);
console.log('Products with duty cycle:', withDutyCycle.length);
console.log('Products with PDF-extracted data:', withPdfExtracted.length);
console.log('Products missing load capacity:', missing.length);

// Show classifications
const allClass = {};
db.forEach(p => {
  (p.classification || []).forEach(c => {
    allClass[c] = (allClass[c] || 0) + 1;
  });
});
console.log('\n=== CLASSIFICATIONS ===');
Object.entries(allClass).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([c, n]) => {
  console.log(`  ${c}: ${n}`);
});

// By manufacturer with data
const byMfr = {};
withCapacity.forEach(p => {
  byMfr[p.manufacturer] = (byMfr[p.manufacturer] || 0) + 1;
});
console.log('\n=== PRODUCTS WITH LOAD CAPACITY BY MANUFACTURER ===');
Object.entries(byMfr).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([m,c]) => {
  console.log(`  ${m}: ${c}`);
});
