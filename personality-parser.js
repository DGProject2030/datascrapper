/**
 * Personality File Parser
 * Parses XML personality files for hoists and trolleys
 * Extracts specifications and uses them for web scraping
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const PERSONALITY_DIR = path.join(__dirname, 'public', 'Personality');
const OUTPUT_FILE = path.join(__dirname, 'chainhoist_data', 'personality_database.json');
const CSV_OUTPUT = path.join(__dirname, 'chainhoist_data', 'personality_database.csv');

/**
 * Parse a single XML personality file
 */
async function parsePersonalityFile(filePath) {
  const parser = new xml2js.Parser({ explicitArray: false });
  const content = fs.readFileSync(filePath, 'utf8');

  try {
    const result = await parser.parseStringPromise(content);
    const motor = result.MotorModel;

    if (!motor) {
      return null;
    }

    // Extract model info from name (e.g., "Lodestar Model F 500kg 4m/min")
    const name = motor.Name || '';
    const capacityMatch = name.match(/(\d+(?:\.\d+)?)\s*kg/i);
    const speedMatch = name.match(/(\d+(?:\.\d+)?)\s*m\/?(?:min|pm)/i) || name.match(/(\d+(?:\.\d+)?)\s*mm\/?(?:s|ps)/i);
    const fpmMatch = name.match(/(\d+(?:\.\d+)?)\s*fpm/i);

    // Parse variable speed control
    const vsc = motor.VariableSpeedControl || {};

    // Parse tuning parameters
    const tuningParams = {};
    if (motor.TuningParameter) {
      const params = Array.isArray(motor.TuningParameter) ? motor.TuningParameter : [motor.TuningParameter];
      params.forEach(p => {
        if (p.TuningParameterName) {
          tuningParams[p.TuningParameterName] = parseFloat(p.TuningParameterValue) || 0;
        }
      });
    }

    return {
      manufacturerId: motor.$.ManufacturerId,
      productId: motor.$.ProductId,
      name: name,
      fileName: path.basename(filePath),

      // Extracted specs
      loadCapacity: capacityMatch ? `${capacityMatch[1]} kg` : null,
      loadCapacityKg: capacityMatch ? parseFloat(capacityMatch[1]) : null,
      liftingSpeed: speedMatch ? `${speedMatch[1]} m/min` : null,
      liftingSpeedMpm: speedMatch ? parseFloat(speedMatch[1]) : null,
      liftingSpeedFpm: fpmMatch ? parseFloat(fpmMatch[1]) : null,

      // Variable speed control
      variableSpeedControl: {
        minSpeed: parseFloat(vsc.MinSpeedClamp) || null,
        maxSpeed: parseFloat(vsc.MaxSpeedClamp) || null,
        minAccel: parseFloat(vsc.MinAccelClamp) || null,
        maxAccel: parseFloat(vsc.MaxAccelClamp) || null,
        minDecel: parseFloat(vsc.MinDecelClamp) || null,
        maxDecel: parseFloat(vsc.MaxDecelClamp) || null,
        errorStop: parseFloat(vsc.ErrorStopClamp) || null,
        defaultSpeed: parseFloat(vsc.DefaultSpeed) || null,
        defaultAccel: parseFloat(vsc.DefaultAccel) || null,
        defaultDecel: parseFloat(vsc.DefaultDecel) || null
      },

      // Load limits
      underloadLimit: parseFloat(motor.UnderloadLimit) || null,
      overloadLimit: parseFloat(motor.OverloadLimit) || null,

      // Scaling
      loadcellScaling: parseFloat(motor.LoadcellScaling) || null,
      encoderScaling: parseFloat(motor.EncoderScaling) || null,

      // Tuning parameters
      tuningParameters: tuningParams,

      // Raw data for reference
      imageFile: motor.ImageFile || null
    };
  } catch (err) {
    console.error(`Error parsing ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Parse manufacturers.man file
 */
async function parseManufacturers() {
  const parser = new xml2js.Parser({ explicitArray: false });
  const manFile = path.join(PERSONALITY_DIR, 'manufacturers.man');

  if (!fs.existsSync(manFile)) {
    console.warn('manufacturers.man not found');
    return {};
  }

  const content = fs.readFileSync(manFile, 'utf8');
  const result = await parser.parseStringPromise(content);

  const manufacturers = {};
  const mfrs = result.Manufacturers.Manufacturer;
  const mfrArray = Array.isArray(mfrs) ? mfrs : [mfrs];

  mfrArray.forEach(m => {
    const id = m.$.ManufacturerId;
    const name = m.ManufacturerName;
    // Extract clean manufacturer name (remove ID prefix)
    const cleanName = name.replace(/^\d+\s*-\s*/, '').trim();
    manufacturers[id] = {
      id,
      fullName: name,
      name: cleanName
    };
  });

  return manufacturers;
}

/**
 * Find all XML personality files
 */
function findPersonalityFiles() {
  const files = [];

  const dirs = fs.readdirSync(PERSONALITY_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const dirPath = path.join(PERSONALITY_DIR, dir.name);
      const xmlFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.xml'));

      for (const xmlFile of xmlFiles) {
        files.push(path.join(dirPath, xmlFile));
      }
    }
  }

  return files;
}

/**
 * Extract manufacturer and model info for web searching
 */
function extractSearchTerms(product, manufacturers) {
  const mfr = manufacturers[product.manufacturerId];
  const mfrName = mfr ? mfr.name : 'Unknown';

  // Extract model name from full name
  // e.g., "[000-001] Lodestar Model F 500kg 4m/min" -> "Lodestar Model F"
  let modelName = product.name
    .replace(/^\[\d+-\d+\]\s*/, '')  // Remove ID prefix
    .replace(/\d+(?:\.\d+)?\s*kg.*$/i, '')  // Remove capacity onwards
    .trim();

  // Clean up common suffixes
  modelName = modelName
    .replace(/\s*-\s*\[.*\]$/, '')  // Remove tag suffixes like [PRG Blue Tag]
    .replace(/\s+/g, ' ')
    .trim();

  return {
    manufacturer: mfrName,
    model: modelName,
    searchQuery: `${mfrName} ${modelName} electric chain hoist specifications`,
    capacity: product.loadCapacity,
    speed: product.liftingSpeed
  };
}

/**
 * Main parsing function
 */
async function parseAllPersonalities() {
  console.log('\\n=== Personality File Parser ===\\n');

  // Parse manufacturers
  console.log('Loading manufacturers...');
  const manufacturers = await parseManufacturers();
  console.log(`Found ${Object.keys(manufacturers).length} manufacturers`);

  // Find all XML files
  console.log('\\nFinding personality files...');
  const files = findPersonalityFiles();
  console.log(`Found ${files.length} personality files`);

  // Parse all files
  console.log('\\nParsing files...');
  const products = [];
  const byManufacturer = {};

  for (const file of files) {
    const product = await parsePersonalityFile(file);
    if (product) {
      // Add manufacturer info
      const mfr = manufacturers[product.manufacturerId];
      product.manufacturer = mfr ? mfr.name : `Unknown (${product.manufacturerId})`;
      product.manufacturerFullName = mfr ? mfr.fullName : null;

      // Add search terms
      const searchInfo = extractSearchTerms(product, manufacturers);
      product.searchTerms = searchInfo;

      products.push(product);

      // Group by manufacturer
      if (!byManufacturer[product.manufacturer]) {
        byManufacturer[product.manufacturer] = [];
      }
      byManufacturer[product.manufacturer].push(product);
    }
  }

  console.log(`\\nSuccessfully parsed ${products.length} products`);

  // Summary by manufacturer
  console.log('\\n--- Products by Manufacturer ---');
  for (const [mfr, prods] of Object.entries(byManufacturer).sort()) {
    console.log(`  ${mfr}: ${prods.length} products`);
  }

  // Save to JSON
  const database = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    source: 'Personality XML Files',
    totalProducts: products.length,
    manufacturers: Object.keys(byManufacturer).length,
    manufacturerList: manufacturers,
    products: products,
    byManufacturer: byManufacturer
  };

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(database, null, 2));
  console.log(`\\nSaved database to: ${OUTPUT_FILE}`);

  // Export to CSV
  exportToCSV(products);

  return database;
}

/**
 * Export products to CSV
 */
function exportToCSV(products) {
  const headers = [
    'Manufacturer',
    'Name',
    'Model',
    'Load Capacity (kg)',
    'Lifting Speed (m/min)',
    'Lifting Speed (fpm)',
    'Min Speed',
    'Max Speed',
    'Default Speed',
    'Default Accel',
    'Default Decel',
    'Underload Limit',
    'Overload Limit',
    'Encoder Scaling',
    'Loadcell Scaling',
    'Search Query'
  ];

  const rows = products.map(p => [
    p.manufacturer,
    p.name,
    p.searchTerms?.model || '',
    p.loadCapacityKg || '',
    p.liftingSpeedMpm || '',
    p.liftingSpeedFpm || '',
    p.variableSpeedControl?.minSpeed || '',
    p.variableSpeedControl?.maxSpeed || '',
    p.variableSpeedControl?.defaultSpeed || '',
    p.variableSpeedControl?.defaultAccel || '',
    p.variableSpeedControl?.defaultDecel || '',
    p.underloadLimit || '',
    p.overloadLimit || '',
    p.encoderScaling || '',
    p.loadcellScaling || '',
    p.searchTerms?.searchQuery || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell =>
      typeof cell === 'string' && cell.includes(',') ? `"${cell}"` : cell
    ).join(','))
  ].join('\\n');

  fs.writeFileSync(CSV_OUTPUT, csvContent);
  console.log(`Exported CSV to: ${CSV_OUTPUT}`);
}

/**
 * Get unique search queries for web scraping
 */
function getSearchQueries(database) {
  const queries = new Set();

  for (const product of database.products) {
    if (product.searchTerms?.searchQuery) {
      queries.add(product.searchTerms.searchQuery);
    }
  }

  return Array.from(queries);
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'parse';

  switch (command) {
  case 'parse':
    await parseAllPersonalities();
    break;

  case 'queries': {
    const database = await parseAllPersonalities();
    const queries = getSearchQueries(database);
    console.log('\\n--- Search Queries for Web Scraping ---');
    queries.forEach((q, i) => console.log(`${i + 1}. ${q}`));
    console.log(`\\nTotal unique queries: ${queries.length}`);
    break;
  }

  case 'help':
  default:
    console.log(`
Personality File Parser

Usage:
  node personality-parser.js <command>

Commands:
  parse     Parse all XML files and create database (default)
  queries   Parse files and show search queries for web scraping
  help      Show this help message

Output:
  - chainhoist_data/personality_database.json
  - chainhoist_data/personality_database.csv
`);
    break;
  }
}

module.exports = {
  parseAllPersonalities,
  parsePersonalityFile,
  parseManufacturers,
  findPersonalityFiles,
  getSearchQueries
};

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
