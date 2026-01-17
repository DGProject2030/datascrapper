/**
 * Add Known Products Script
 * Extracts known products from the scraper and adds them to the database
 */

const fs = require('fs');
const path = require('path');

// Read the scraper file and extract the knownData object
const scraperPath = path.join(__dirname, '..', 'chainhoist-scraper-enhanced.js');
const databasePath = path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database.json');

console.log('Loading existing database...');
let database;
try {
  const dbContent = fs.readFileSync(databasePath, 'utf8');
  const parsed = JSON.parse(dbContent);
  database = Array.isArray(parsed) ? parsed : (parsed.data || []);
  console.log(`Loaded ${database.length} existing products`);
} catch (error) {
  console.log('No existing database found, starting fresh');
  database = [];
}

// Create a set of existing product IDs to avoid duplicates
const existingIds = new Set(database.map(p => p.id));

// Manufacturer mapping
const manufacturerNames = {
  'columbus-mckinnon': 'Columbus McKinnon',
  'konecranes': 'Konecranes',
  'demag': 'Demag',
  'chainmaster': 'Chainmaster',
  'verlinde': 'Verlinde',
  'movecat': 'Movecat',
  'kito': 'Kito',
  'gis-ag': 'GIS AG',
  'harrington': 'Harrington Hoists',
  'abus': 'ABUS Kransysteme',
  'hitachi': 'Hitachi Industrial Equipment',
  'donati': 'Donati Sollevamenti',
  'gorbel': 'Gorbel',
  'planeta': 'PLANETA-Hebetechnik',
  'yale': 'Yale Hoists',
  'ingersoll-rand': 'Ingersoll Rand',
  'coffing': 'Coffing Hoists',
  'budgit': 'Budgit Hoists',
  'rm-materials': 'R&M Materials Handling',
  'street-crane': 'Street Crane',
  'swf': 'SWF Krantechnik',
  'jdn': 'J.D. Neuhaus',
  'elephant': 'Elephant Lifting Products',
  'liftingsafety': 'LiftingSafety',
  'tiger': 'Tiger Lifting',
  'stahl': 'Stahl CraneSystems',
  'txk': 'TXK'
};

// Read the scraper file content
const scraperContent = fs.readFileSync(scraperPath, 'utf8');

// Extract the knownData object using regex
const knownDataMatch = scraperContent.match(/const knownData = \{([\s\S]*?)\n {4}\};/);
if (!knownDataMatch) {
  console.error('Could not find knownData in scraper file');
  process.exit(1);
}

// Create an eval context to parse the known data
const knownDataStr = `({${knownDataMatch[1]}})`;
let knownData;
try {
  knownData = eval(knownDataStr);
} catch (error) {
  console.error('Error parsing knownData:', error.message);
  process.exit(1);
}

// Helper to sanitize filenames for IDs
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase().substring(0, 50);
}

// Add known products
let added = 0;
let updated = 0;

for (const [manufacturerId, products] of Object.entries(knownData)) {
  const manufacturerName = manufacturerNames[manufacturerId] || manufacturerId;

  for (const product of products) {
    const id = `${manufacturerId}-${sanitizeFilename(product.model)}`.toLowerCase();

    const newProduct = {
      id,
      manufacturer: manufacturerName,
      ...product,
      scrapedFrom: 'known-data',
      scrapedAt: new Date().toISOString(),
      confidence: 0.9
    };

    const existingIndex = database.findIndex(p => p.id === id);
    if (existingIndex >= 0) {
      // Update existing product with new data
      database[existingIndex] = { ...database[existingIndex], ...newProduct };
      updated++;
    } else {
      // Add new product
      database.push({
        ...newProduct,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });
      added++;
    }
  }

  console.log(`${manufacturerName}: ${products.length} products`);
}

// Save updated database
const output = {
  data: database,
  stats: {
    totalProducts: database.length,
    manufacturers: [...new Set(database.map(p => p.manufacturer))].length
  },
  scrapedAt: new Date().toISOString(),
  version: '3.0'
};

fs.writeFileSync(databasePath, JSON.stringify(output, null, 2));

console.log('\n=== Summary ===');
console.log(`Added: ${added} new products`);
console.log(`Updated: ${updated} existing products`);
console.log(`Total: ${database.length} products`);
console.log(`Saved to: ${databasePath}`);
