/**
 * Data Quality Gates Script
 * Validates database against quality thresholds for release readiness
 *
 * Usage: node scripts/data-quality-gates.js [--gate alpha|beta|release] [--verbose]
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  databaseFile: path.join(__dirname, '..', 'chainhoist_data_processed', 'chainhoist_database_processed.json'),
  rawDatabaseFile: path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database.json'),
  reportFile: path.join(__dirname, '..', 'chainhoist_data_processed', 'quality_gate_report.json'),
};

// Quality gate thresholds
const QUALITY_GATES = {
  alpha: {
    name: 'Alpha',
    description: 'Minimum viable data for internal testing',
    thresholds: {
      loadCapacity: 0.50,      // 50% must have load capacity
      liftingSpeed: 0.40,      // 40% must have lifting speed
      motorPower: 0.30,        // 30% must have motor power
      classification: 0.40,   // 40% must have classification
      images: 0.30,           // 30% must have at least 1 image
      overallCompleteness: 0.35  // 35% average completeness
    }
  },
  beta: {
    name: 'Beta',
    description: 'Data quality suitable for beta testing',
    thresholds: {
      loadCapacity: 0.80,
      liftingSpeed: 0.70,
      motorPower: 0.60,
      classification: 0.60,
      images: 0.50,
      overallCompleteness: 0.60
    }
  },
  release: {
    name: 'Release',
    description: 'Production-ready data quality',
    thresholds: {
      loadCapacity: 0.95,
      liftingSpeed: 0.95,
      motorPower: 0.90,
      classification: 0.85,
      images: 0.80,
      overallCompleteness: 0.85
    }
  }
};

// Critical fields for completeness calculation
const CRITICAL_FIELDS = [
  'loadCapacity',
  'liftingSpeed',
  'motorPower',
  'classification',
  'dutyCycle'
];

// Secondary fields for completeness calculation
const SECONDARY_FIELDS = [
  'voltageOptions',
  'weight',
  'protectionClass',
  'series'
];

// Parse command line arguments
const args = process.argv.slice(2);
const gateIndex = args.indexOf('--gate');
const targetGate = gateIndex !== -1 ? args[gateIndex + 1] : 'release';
const isVerbose = args.includes('--verbose');

/**
 * Logger utility
 */
class Logger {
  static info(message) {
    console.log(`[INFO] ${message}`);
  }

  static warn(message) {
    console.warn(`[WARN] ${message}`);
  }

  static error(message) {
    console.error(`[ERROR] ${message}`);
  }

  static success(message) {
    console.log(`[SUCCESS] ${message}`);
  }

  static debug(message) {
    if (isVerbose) {
      console.log(`[DEBUG] ${message}`);
    }
  }
}

/**
 * Check if a field has a valid value
 */
function hasValidValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string' && (!value || value.trim() === '' || value === '-')) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return false;
  }
  return true;
}

/**
 * Calculate completeness score for a single product
 */
function calculateProductCompleteness(product) {
  let criticalScore = 0;
  let secondaryScore = 0;

  // Check critical fields (weighted 70%)
  for (const field of CRITICAL_FIELDS) {
    if (hasValidValue(product[field])) {
      criticalScore++;
    }
  }

  // Check secondary fields (weighted 30%)
  for (const field of SECONDARY_FIELDS) {
    if (hasValidValue(product[field])) {
      secondaryScore++;
    }
  }

  // Calculate weighted score
  const criticalPct = criticalScore / CRITICAL_FIELDS.length;
  const secondaryPct = secondaryScore / SECONDARY_FIELDS.length;

  return (criticalPct * 0.7) + (secondaryPct * 0.3);
}

/**
 * Calculate field coverage statistics
 */
function calculateFieldCoverage(database) {
  const coverage = {};
  const allFields = [...CRITICAL_FIELDS, ...SECONDARY_FIELDS, 'images'];

  for (const field of allFields) {
    let count = 0;
    for (const product of database) {
      if (field === 'images') {
        if (product.images && Array.isArray(product.images) && product.images.length > 0) {
          count++;
        }
      } else if (hasValidValue(product[field])) {
        count++;
      }
    }
    coverage[field] = {
      count,
      total: database.length,
      percentage: database.length > 0 ? count / database.length : 0
    };
  }

  return coverage;
}

/**
 * Find products missing critical fields
 */
function findIncompleteProducts(database) {
  const incomplete = [];

  for (const product of database) {
    const missingFields = [];

    for (const field of CRITICAL_FIELDS) {
      if (!hasValidValue(product[field])) {
        missingFields.push(field);
      }
    }

    // Check images separately
    if (!product.images || !Array.isArray(product.images) || product.images.length === 0) {
      missingFields.push('images');
    }

    if (missingFields.length > 0) {
      incomplete.push({
        id: product.id,
        manufacturer: product.manufacturer,
        model: product.model,
        missingFields,
        completeness: calculateProductCompleteness(product)
      });
    }
  }

  // Sort by number of missing fields (most incomplete first)
  incomplete.sort((a, b) => b.missingFields.length - a.missingFields.length);

  return incomplete;
}

/**
 * Evaluate quality gate
 */
function evaluateGate(coverage, overallCompleteness, gateConfig) {
  const results = {
    gate: gateConfig.name,
    description: gateConfig.description,
    passed: true,
    checks: []
  };

  // Check each threshold
  for (const [field, threshold] of Object.entries(gateConfig.thresholds)) {
    let actual;
    let passed;

    if (field === 'overallCompleteness') {
      actual = overallCompleteness;
      passed = actual >= threshold;
    } else if (coverage[field]) {
      actual = coverage[field].percentage;
      passed = actual >= threshold;
    } else {
      actual = 0;
      passed = false;
    }

    results.checks.push({
      field,
      threshold,
      actual,
      passed,
      delta: actual - threshold
    });

    if (!passed) {
      results.passed = false;
    }
  }

  return results;
}

/**
 * Generate recommendations for improving data quality
 */
function generateRecommendations(coverage, incomplete) {
  const recommendations = [];

  // Find fields with lowest coverage
  const sortedFields = Object.entries(coverage)
    .sort((a, b) => a[1].percentage - b[1].percentage);

  for (const [field, stats] of sortedFields) {
    if (stats.percentage < 0.8) {
      const missing = stats.total - stats.count;
      recommendations.push({
        priority: stats.percentage < 0.5 ? 'high' : 'medium',
        field,
        current: `${(stats.percentage * 100).toFixed(1)}%`,
        missing,
        action: `Add ${field} data for ${missing} products`
      });
    }
  }

  // Find manufacturers with most incomplete products
  const manufacturerCounts = {};
  for (const product of incomplete) {
    manufacturerCounts[product.manufacturer] = (manufacturerCounts[product.manufacturer] || 0) + 1;
  }

  const topManufacturers = Object.entries(manufacturerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topManufacturers.length > 0) {
    recommendations.push({
      priority: 'high',
      field: 'manufacturer-focus',
      action: `Focus data collection on: ${topManufacturers.map(([m, c]) => `${m} (${c} products)`).join(', ')}`
    });
  }

  return recommendations;
}

/**
 * Main quality gate evaluation function
 */
async function evaluateQualityGates() {
  Logger.info('Starting data quality gate evaluation');
  Logger.info(`Target gate: ${targetGate}`);

  // Verify gate exists
  if (!QUALITY_GATES[targetGate]) {
    Logger.error(`Unknown gate: ${targetGate}. Valid options: ${Object.keys(QUALITY_GATES).join(', ')}`);
    process.exit(1);
  }

  // Load database
  let database;
  const databaseFile = fs.existsSync(CONFIG.databaseFile)
    ? CONFIG.databaseFile
    : CONFIG.rawDatabaseFile;

  try {
    const dbContent = fs.readFileSync(databaseFile, 'utf8');
    const parsed = JSON.parse(dbContent);
    database = Array.isArray(parsed) ? parsed : (parsed.data || []);
    Logger.info(`Loaded database with ${database.length} products`);
  } catch (error) {
    Logger.error(`Failed to load database: ${error.message}`);
    process.exit(1);
  }

  if (database.length === 0) {
    Logger.error('Database is empty');
    process.exit(1);
  }

  // Calculate metrics
  Logger.info('Calculating field coverage...');
  const coverage = calculateFieldCoverage(database);

  Logger.info('Calculating product completeness...');
  let totalCompleteness = 0;
  for (const product of database) {
    totalCompleteness += calculateProductCompleteness(product);
  }
  const overallCompleteness = totalCompleteness / database.length;

  Logger.info('Finding incomplete products...');
  const incomplete = findIncompleteProducts(database);

  // Evaluate all gates
  const gateResults = {};
  for (const [gateName, gateConfig] of Object.entries(QUALITY_GATES)) {
    gateResults[gateName] = evaluateGate(coverage, overallCompleteness, gateConfig);
  }

  // Generate recommendations
  const recommendations = generateRecommendations(coverage, incomplete);

  // Build report
  const report = {
    timestamp: new Date().toISOString(),
    totalProducts: database.length,
    overallCompleteness: overallCompleteness,
    fieldCoverage: coverage,
    gateResults,
    targetGate,
    targetGatePassed: gateResults[targetGate].passed,
    incompleteProducts: incomplete.slice(0, 50), // Top 50 most incomplete
    recommendations
  };

  // Save report
  fs.writeFileSync(CONFIG.reportFile, JSON.stringify(report, null, 2));
  Logger.info(`Saved quality report to ${CONFIG.reportFile}`);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('DATA QUALITY GATE REPORT');
  console.log('='.repeat(60));

  console.log(`\nTotal Products: ${database.length}`);
  console.log(`Overall Completeness: ${(overallCompleteness * 100).toFixed(1)}%`);

  console.log('\n--- Field Coverage ---');
  for (const [field, stats] of Object.entries(coverage)) {
    const bar = '█'.repeat(Math.round(stats.percentage * 20)) + '░'.repeat(20 - Math.round(stats.percentage * 20));
    console.log(`${field.padEnd(18)} ${bar} ${(stats.percentage * 100).toFixed(1)}% (${stats.count}/${stats.total})`);
  }

  console.log('\n--- Gate Evaluations ---');
  for (const [gateName, result] of Object.entries(gateResults)) {
    const status = result.passed ? '✓ PASSED' : '✗ FAILED';
    const marker = gateName === targetGate ? ' ← TARGET' : '';
    console.log(`\n${gateName.toUpperCase()} ${status}${marker}`);

    if (isVerbose || gateName === targetGate) {
      for (const check of result.checks) {
        const checkStatus = check.passed ? '✓' : '✗';
        const delta = check.delta >= 0 ? `+${(check.delta * 100).toFixed(1)}%` : `${(check.delta * 100).toFixed(1)}%`;
        console.log(`  ${checkStatus} ${check.field}: ${(check.actual * 100).toFixed(1)}% (threshold: ${(check.threshold * 100).toFixed(1)}%, delta: ${delta})`);
      }
    }
  }

  if (recommendations.length > 0) {
    console.log('\n--- Recommendations ---');
    for (const rec of recommendations.slice(0, 5)) {
      console.log(`[${rec.priority.toUpperCase()}] ${rec.action}`);
    }
  }

  console.log('\n' + '='.repeat(60));

  // Final verdict
  if (gateResults[targetGate].passed) {
    Logger.success(`\n✓ ${targetGate.toUpperCase()} gate PASSED - Data quality meets ${QUALITY_GATES[targetGate].description}`);
    return 0;
  } else {
    Logger.error(`\n✗ ${targetGate.toUpperCase()} gate FAILED - Data quality does not meet requirements`);
    Logger.info('Run with --verbose for detailed breakdown');
    return 1;
  }
}

// Run the evaluation
evaluateQualityGates()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    Logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
