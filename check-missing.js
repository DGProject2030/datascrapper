const db = require('./chainhoist_data_processed/chainhoist_database_processed.json');
const missing = db.filter(p => !p.loadCapacity);
console.log('Products missing load capacity:', missing.length);
console.log('');
missing.forEach((p, i) => {
  console.log(`${i+1}. ${p.manufacturer} - ${p.model}`);
});
