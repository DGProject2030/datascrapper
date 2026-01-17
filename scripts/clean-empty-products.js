/**
 * Clean Empty Products Script
 * Removes products with 0% data completeness from the database
 */

const fs = require('fs');
const path = require('path');

const databasePath = path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database.json');

console.log('Loading database...');
const dbContent = fs.readFileSync(databasePath, 'utf8');
const parsed = JSON.parse(dbContent);
const database = Array.isArray(parsed) ? parsed : (parsed.data || []);

console.log(`Total products before cleanup: ${database.length}`);

// Filter out products with no meaningful data
const cleanedDatabase = database.filter(product => {
  // Check if product has at least some useful specifications
  const hasLoadCapacity = product.loadCapacity && product.loadCapacity.trim() !== '';
  const hasLiftingSpeed = product.liftingSpeed && product.liftingSpeed.trim() !== '';
  const hasMotorPower = product.motorPower && product.motorPower.trim() !== '';
  const hasClassification = product.classification && Array.isArray(product.classification) && product.classification.length > 0;
  const hasDutyCycle = product.dutyCycle && product.dutyCycle.trim() !== '';
  const hasWeight = product.weight && product.weight.trim() !== '';

  // Count how many specs are present
  const specCount = [hasLoadCapacity, hasLiftingSpeed, hasMotorPower, hasClassification, hasDutyCycle, hasWeight].filter(Boolean).length;

  // Keep product if it has at least 1 specification
  if (specCount === 0) {
    console.log(`Removing: ${product.manufacturer} - ${product.model} (0 specs)`);
    return false;
  }

  return true;
});

console.log(`\nProducts after cleanup: ${cleanedDatabase.length}`);
console.log(`Removed: ${database.length - cleanedDatabase.length} products`);

// Save cleaned database
const output = {
  data: cleanedDatabase,
  stats: {
    totalProducts: cleanedDatabase.length,
    manufacturers: [...new Set(cleanedDatabase.map(p => p.manufacturer))].length
  },
  scrapedAt: new Date().toISOString(),
  cleanedAt: new Date().toISOString(),
  version: '3.1'
};

fs.writeFileSync(databasePath, JSON.stringify(output, null, 2));
console.log(`\nSaved cleaned database to: ${databasePath}`);
