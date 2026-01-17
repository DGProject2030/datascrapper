/**
 * Deep Clean Database Script
 * Removes invalid entries and normalizes data
 */

const fs = require('fs');
const path = require('path');

const databasePath = path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database.json');

console.log('=== DEEP DATA CLEANING ===\n');
console.log('Loading database...');
const dbContent = fs.readFileSync(databasePath, 'utf8');
const parsed = JSON.parse(dbContent);
const database = Array.isArray(parsed) ? parsed : (parsed.data || []);

console.log(`Total products before cleaning: ${database.length}\n`);

// Patterns that indicate non-product pages
const invalidModelPatterns = [
  /^products$/i,
  /^contact/i,
  /^about/i,
  /^home$/i,
  /^news/i,
  /^drupal$/i,
  /^seite nicht gefunden/i,  // German "page not found"
  /^page not found/i,
  /professional associations/i,
  /corporate sustainability/i,
  /newsroom/i,
  /custom solutions/i,
  /simply reliable/i,
  /choose country/i,
  /online services/i,
  /downloads$/i,
  /^we are global/i,
  /^purpose in motion/i,
  /^community$/i,
  /^patents$/i,
  /internship program/i,
  /iso.*certifications/i,
  /maximize throughput/i,
  /leading manufacturer of/i,
];

// Patterns for model names that are category pages
const categoryPatterns = [
  /^(hand|lever|air|electric)\s*(hoists?|chain|wire)/i,
  /hoists?\s*$/i,
  /^chain\s*$/i,
  /^trolleys?\s*$/i,
  /wire rope hoists$/i,
  /pneumatic.*hoists$/i,
];

let removed = {
  invalidModel: [],
  categoryPage: [],
  noSpecs: [],
  tooShortModel: []
};

const cleanedDatabase = database.filter(product => {
  const model = (product.model || '').trim();
  const manufacturer = (product.manufacturer || '').trim();

  // Check for invalid model names
  for (const pattern of invalidModelPatterns) {
    if (pattern.test(model)) {
      removed.invalidModel.push(`${manufacturer} - ${model}`);
      return false;
    }
  }

  // Check for category pages (only if no real specs)
  const hasSpecs = (product.loadCapacity && product.loadCapacity.trim()) ||
                   (product.liftingSpeed && product.liftingSpeed.trim()) ||
                   (product.motorPower && product.motorPower.trim());

  if (!hasSpecs) {
    for (const pattern of categoryPatterns) {
      if (pattern.test(model)) {
        removed.categoryPage.push(`${manufacturer} - ${model}`);
        return false;
      }
    }
  }

  // Check for products with no useful data at all
  const hasClassification = product.classification && Array.isArray(product.classification) && product.classification.length > 0;
  const hasDutyCycle = product.dutyCycle && product.dutyCycle.trim();
  const hasWeight = product.weight && product.weight.trim();
  const hasAnyData = hasSpecs || hasClassification || hasDutyCycle || hasWeight;

  if (!hasAnyData) {
    removed.noSpecs.push(`${manufacturer} - ${model}`);
    return false;
  }

  // Check for models that are just single words like "Hand" or "Lever"
  if (model.length < 3 || /^[a-z]+$/i.test(model)) {
    if (!hasSpecs) {
      removed.tooShortModel.push(`${manufacturer} - ${model}`);
      return false;
    }
  }

  return true;
});

// Report removals
console.log('--- Removed Entries ---\n');

if (removed.invalidModel.length > 0) {
  console.log(`Invalid model names (${removed.invalidModel.length}):`);
  removed.invalidModel.forEach(m => console.log(`  - ${m}`));
  console.log('');
}

if (removed.categoryPage.length > 0) {
  console.log(`Category pages without specs (${removed.categoryPage.length}):`);
  removed.categoryPage.forEach(m => console.log(`  - ${m}`));
  console.log('');
}

if (removed.noSpecs.length > 0) {
  console.log(`No specifications at all (${removed.noSpecs.length}):`);
  removed.noSpecs.forEach(m => console.log(`  - ${m}`));
  console.log('');
}

if (removed.tooShortModel.length > 0) {
  console.log(`Too short/generic model names (${removed.tooShortModel.length}):`);
  removed.tooShortModel.forEach(m => console.log(`  - ${m}`));
  console.log('');
}

const totalRemoved = removed.invalidModel.length + removed.categoryPage.length +
                     removed.noSpecs.length + removed.tooShortModel.length;

console.log('--- Summary ---');
console.log(`Products before: ${database.length}`);
console.log(`Products after: ${cleanedDatabase.length}`);
console.log(`Removed: ${totalRemoved}`);
console.log('');

// Save cleaned database
const output = {
  data: cleanedDatabase,
  stats: {
    totalProducts: cleanedDatabase.length,
    manufacturers: [...new Set(cleanedDatabase.map(p => p.manufacturer))].length
  },
  scrapedAt: parsed.scrapedAt || new Date().toISOString(),
  cleanedAt: new Date().toISOString(),
  version: '3.2'
};

fs.writeFileSync(databasePath, JSON.stringify(output, null, 2));
console.log(`Saved cleaned database to: ${databasePath}`);
