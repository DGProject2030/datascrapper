/**
 * Merge Personality Data into Main Chainhoist Database
 * Combines web-scraped data with personality XML configuration data
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  mainDbPath: 'chainhoist_data_processed/chainhoist_database_processed.json',
  personalityDbPath: 'chainhoist_data/personality_enriched.json',
  outputPath: 'chainhoist_data_processed/chainhoist_database_processed.json',
  reportPath: 'chainhoist_data_processed/data_quality_report.json'
};

/**
 * Load JSON file
 */
function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, filePath), 'utf8'));
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Generate unique ID for a product
 */
function generateId(product) {
  const manufacturer = (product.manufacturer || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const name = (product.name || product.model || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${manufacturer}--${name}`.replace(/-+/g, '-');
}

/**
 * Merge personality product into standard format
 */
function convertPersonalityProduct(p) {
  return {
    // Standard fields
    manufacturer: p.manufacturerBrand || p.manufacturer || 'Unknown',
    model: p.searchTerms?.model || p.name,
    series: p.manufacturer,
    loadCapacity: p.loadCapacity || (p.loadCapacityKg ? `${p.loadCapacityKg} kg` : null),
    liftingSpeed: p.liftingSpeed || (p.liftingSpeedMpm ? `${p.liftingSpeedMpm} m/min` : null),
    motorPower: null,
    classification: p.entertainmentIndustry ? ['entertainment', p.speedType?.toLowerCase().replace(' ', '-')] : [p.speedType?.toLowerCase().replace(' ', '-')],

    // Source info
    url: p.manufacturerWebsite || null,
    scrapedFrom: 'personality-xml',
    confidence: 0.95,

    // IDs
    id: `personality-${p.manufacturerId}-${p.productId}`,
    personalityId: `${p.manufacturerId}-${p.productId}`,

    // Timestamps
    lastUpdated: new Date().toISOString(),
    createdDate: new Date().toISOString(),
    updateCount: 0,

    // Personality-specific data
    category: p.category,
    speedType: p.speedType,
    entertainmentIndustry: p.entertainmentIndustry,

    // Technical parameters from personality files
    variableSpeedControl: p.variableSpeedControl || null,
    tuningParameters: p.tuningParameters || null,
    underloadLimit: p.underloadLimit,
    overloadLimit: p.overloadLimit,
    loadcellScaling: p.loadcellScaling,
    encoderScaling: p.encoderScaling,

    // Speed details
    liftingSpeedMpm: p.liftingSpeedMpm,
    liftingSpeedFpm: p.liftingSpeedFpm,
    loadCapacityKg: p.loadCapacityKg,

    // Original personality file info
    personalityFileName: p.fileName,
    personalityName: p.name,

    // Standard flags
    quietOperation: false,
    dynamicLifting: p.speedType === 'Variable Speed',
    liftingOverPeople: p.entertainmentIndustry || false,
    controlCompatibility: {},
    positionFeedback: p.encoderScaling ? { encoder: true } : {},
    certifications: {},

    processedDate: new Date().toISOString(),
    source: 'personality'
  };
}

/**
 * Main merge function
 */
function mergeDatabases() {
  console.log('\n=== Merging Chainhoist Databases ===\n');

  // Load databases
  const mainDb = loadJson(CONFIG.mainDbPath);
  const personalityDb = loadJson(CONFIG.personalityDbPath);

  if (!mainDb) {
    console.error('Failed to load main database');
    return;
  }

  if (!personalityDb) {
    console.error('Failed to load personality database');
    return;
  }

  console.log(`Main database: ${mainDb.length} products`);
  console.log(`Personality database: ${personalityDb.products?.length || 0} products`);

  // Create merged database starting with main DB
  const mergedDb = [...mainDb];
  const existingIds = new Set(mainDb.map(p => p.id));

  // Track stats
  let added = 0;
  let skipped = 0;

  // Add personality products
  if (personalityDb.products) {
    for (const product of personalityDb.products) {
      const converted = convertPersonalityProduct(product);

      // Check if similar product exists
      if (!existingIds.has(converted.id)) {
        mergedDb.push(converted);
        existingIds.add(converted.id);
        added++;
      } else {
        skipped++;
      }
    }
  }

  console.log('\nMerge results:');
  console.log(`  Added from personality: ${added}`);
  console.log(`  Skipped (duplicates): ${skipped}`);
  console.log(`  Total products: ${mergedDb.length}`);

  // Save merged database
  fs.writeFileSync(
    path.join(__dirname, CONFIG.outputPath),
    JSON.stringify(mergedDb, null, 2)
  );
  console.log(`\nSaved merged database to: ${CONFIG.outputPath}`);

  // Update quality report
  const report = loadJson(CONFIG.reportPath) || {};

  // Count categories
  const categoryDist = {};
  const speedTypeDist = {};
  const sourceDist = { web: 0, personality: 0 };

  mergedDb.forEach(p => {
    // Category
    const cat = p.category || 'Unknown';
    categoryDist[cat] = (categoryDist[cat] || 0) + 1;

    // Speed type
    const st = p.speedType || 'Unknown';
    speedTypeDist[st] = (speedTypeDist[st] || 0) + 1;

    // Source
    if (p.source === 'personality') {
      sourceDist.personality++;
    } else {
      sourceDist.web++;
    }
  });

  // Update report
  report.totalRecords = mergedDb.length;
  report.categoryDistribution = categoryDist;
  report.speedTypeDistribution = speedTypeDist;
  report.sourceDistribution = sourceDist;
  report.personalityProducts = added;
  report.lastMerged = new Date().toISOString();

  // Recalculate capacity distribution
  const capacityDist = {
    '≤250 kg': 0,
    '251-500 kg': 0,
    '501-1000 kg': 0,
    '1001-2000 kg': 0,
    '>2000 kg': 0
  };

  mergedDb.forEach(p => {
    const cap = p.loadCapacityKg || (p.loadCapacity ? parseInt(p.loadCapacity) : 0);
    if (cap <= 250) {
      capacityDist['≤250 kg']++;
    } else if (cap <= 500) {
      capacityDist['251-500 kg']++;
    } else if (cap <= 1000) {
      capacityDist['501-1000 kg']++;
    } else if (cap <= 2000) {
      capacityDist['1001-2000 kg']++;
    } else if (cap > 2000) {
      capacityDist['>2000 kg']++;
    }
  });

  report.capacityDistribution = capacityDist;

  fs.writeFileSync(
    path.join(__dirname, CONFIG.reportPath),
    JSON.stringify(report, null, 2)
  );
  console.log(`Updated quality report: ${CONFIG.reportPath}`);

  // Print summary
  console.log('\n=== Merged Database Summary ===');
  console.log(`Total Products: ${mergedDb.length}`);
  console.log(`  From web scraping: ${sourceDist.web}`);
  console.log(`  From personality files: ${sourceDist.personality}`);
  console.log('\nBy Category:');
  Object.entries(categoryDist).forEach(([cat, count]) => {
    if (count > 0) {
      console.log(`  ${cat}: ${count}`);
    }
  });
  console.log('\nBy Speed Type:');
  Object.entries(speedTypeDist).forEach(([type, count]) => {
    if (count > 0) {
      console.log(`  ${type}: ${count}`);
    }
  });

  return mergedDb;
}

// Run if called directly
if (require.main === module) {
  mergeDatabases();
}

module.exports = { mergeDatabases };
