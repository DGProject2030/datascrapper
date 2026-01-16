/**
 * Aggressive cleanup - remove all non-product entries
 */

const fs = require('fs');
const DATABASE_PATH = 'chainhoist_data_processed/chainhoist_database_processed.json';

const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
console.log('Current database size:', database.length);

// Patterns that indicate non-product pages
const nonProductPatterns = [
  // Contact/About pages
  /^contact/i,
  /^about/i,
  /^we are/i,
  /^we improve/i,
  /^our challenge/i,
  /^our lifting/i,
  /leading manufacturer/i,

  // Category/generic names
  /^products$/i,
  /^downloads$/i,
  /^certificates/i,
  /^sales network/i,
  /^online services/i,
  /^additional equipment/i,
  /^what is included/i,
  /price enquiry/i,
  /^choose country/i,
  /^existing users/i,
  /^your baskets/i,
  /^clearance items/i,

  // Company info pages
  /^purpose in motion/i,
  /^corporate sustainability/i,
  /^community$/i,
  /^internship program/i,
  /^iso 9001/i,
  /^patents$/i,
  /^professional associations/i,
  /newsroom/i,
  /^manufacturers and brands/i,

  // Generic category names ending with "s" (hoists)
  /^lever s$/i,
  /^hand s$/i,
  /^air s$/i,
  /^electric wire rope s$/i,
  /^pneumatic wire rope s$/i,
  /^explosion proof.*s$/i,
  /^cable pullers/i,
  /^a global leader/i,
  /compressed air.*s$/i,
  /^manual s$/i,
  /wire rope.*s$/i,
  /^atex s$/i,
  /^pneumatic s$/i,
  /^manual ing$/i,
  /^pneumatic ing$/i,

  // Industry pages
  /^automotive.*crane/i,
  /^general manufacturing/i,
  /^metal production/i,
  /^mining$/i,
  /^oil.*gas/i,
  /^power plants/i,
  /by industry/i,
  /maximize throughput/i,

  // Crane types (not hoists)
  /^overhead cranes$/i,
  /^double girder/i,
  /^portal.*cranes/i,
  /^light crane systems/i,
  /^specialised.*cranes/i,
  /^underslung cranes/i,
  /^workstation cranes/i,
  /^jib cranes/i,
  /^gantry cranes/i,
  /^bridge crane/i,
  /^monorails$/i,

  // Non-English pages
  /^polipastos/i,  // Spanish
  /^elektrokettenzug/i,  // German
  /电动环链葫芦/,  // Chinese
  /^die profi/i,  // German
  /^la série/i,  // French

  // Error pages
  /seite nicht gefunden/i,
  /page not found/i,
  /404/,

  // Other non-products
  /^lifting equipment$/i,
  /^fall arrest/i,
  /^material handling.*equipment$/i,
  /^beam.*clamps$/i,
  /^trolleys$/i,
  /^air trolleys$/i,
  /^air winches$/i,
  /^chain blocks$/i,
  /hook type$/i,
  /with trolley$/i,
  /^no crane without/i,
  /^s \+ trolleys$/i,
  /industrial services/i,
  /lifting technology$/i,
  /slings.*straps/i,
  /drupal$/i,
  /demagcranes$/i,
];

// Also check for very short or empty models
const isValidProduct = (p) => {
  const model = (p.model || '').trim();

  // Too short
  if (model.length < 3) {
    return false;
  }

  // Empty or just whitespace
  if (!model || model === '') {
    return false;
  }

  // Check against patterns
  for (const pattern of nonProductPatterns) {
    if (pattern.test(model)) {
      return false;
    }
  }

  // Check for models that are just generic words
  const genericWords = ['s', 'hoists', 'products', 'trolleys', 'cranes', 'equipment'];
  if (genericWords.includes(model.toLowerCase())) {
    return false;
  }

  return true;
};

const removed = [];
const cleaned = database.filter(p => {
  if (!isValidProduct(p)) {
    removed.push({ manufacturer: p.manufacturer, model: p.model });
    return false;
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

// Show stats by manufacturer after cleanup
const mfrCounts = {};
cleaned.forEach(p => {
  mfrCounts[p.manufacturer] = (mfrCounts[p.manufacturer] || 0) + 1;
});

console.log('\n=== Products by manufacturer (after cleanup) ===');
Object.entries(mfrCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([mfr, count]) => {
    console.log(`  ${mfr}: ${count}`);
  });

// Show what's left missing load capacity
const stillMissing = cleaned.filter(p => !p.loadCapacity);
console.log('\n=== Still missing load capacity ===');
console.log('Count:', stillMissing.length);
