/**
 * Product Schema Validation using Joi
 * Defines validation rules for chainhoist product data
 */

const Joi = require('joi');

// Common patterns
const PATTERNS = {
  // Load capacity: "500 kg", "1000 kg (2200 lbs)", "1 ton"
  loadCapacity: /^\d+(?:\.\d+)?\s*(?:kg|lbs?|tons?|t|tonnes?)(?:\s*\([^)]+\))?$/i,

  // Lifting speed: "4 m/min", "0.5-8 m/min", "13 ft/min"
  liftingSpeed: /^\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:m\/min|ft\/min|fpm|m\/s)$/i,

  // Motor power: "1.5 kW", "2 HP", "1500 W"
  motorPower: /^\d+(?:\.\d+)?\s*(?:kW|HP|W)(?:\s*\([^)]+\))?$/i,

  // Duty cycle: "FEM 2m", "40% ED", "M5", "H4"
  dutyCycle: /^(?:FEM\s*\d+[a-z]*m?|M[1-8]|\d+%?\s*ED|H[1-4]|ISO\s*M[1-8]).*$/i,

  // IP rating: "IP54", "IP55", "IP65"
  protectionClass: /^IP\d{2}[A-Z]?$/i,

  // Voltage: "400V", "230V 1ph", "400V 3ph 50Hz"
  voltage: /^\d+V(?:\s*(?:1|3)ph)?(?:\s*\d+Hz)?$/i,

  // Weight: "35 kg", "77 lbs"
  weight: /^\d+(?:\.\d+)?\s*(?:kg|lbs?)$/i,
};

// Classification values (entertainment industry standards)
const VALID_CLASSIFICATIONS = [
  'd8', 'd8+', 'd8plus', 'd8-plus',
  'bgv-d8', 'bgv-c1', 'bgvc1',
  'dguv', 'dguv-v17',
  'ce', 'tuv', 'ul', 'csa',
  'atex', 'iecex',
  'ansi', 'asme', 'osha',
  'fem', 'iso',
  'igvw', 'sqp1'
];

// Safety features schema - allow flexible object structure
const safetyFeaturesSchema = Joi.object().unknown(true);

// Certifications schema - allow flexible object structure
const certificationsSchema = Joi.object().unknown(true);

// Image schema - allow both URIs and local paths
const imageSchema = Joi.object({
  url: Joi.string().required(), // Allow any string (URI or local path like /media/images/...)
  alt: Joi.string().allow('', null),
  type: Joi.string().valid('product', 'diagram', 'detail', 'logo').allow('', null),
  localPath: Joi.string().allow('', null),
  title: Joi.string().allow('', null),
}).unknown(true);

// PDF schema - allow both URIs and local paths
const pdfSchema = Joi.object({
  url: Joi.string().required(), // Allow any string (URI or local path)
  title: Joi.string().allow('', null),
  type: Joi.string().valid('datasheet', 'manual', 'brochure', 'certificate', 'document').allow('', null),
  localPath: Joi.string().allow('', null),
}).unknown(true);

// Main product schema
const productSchema = Joi.object({
  // Required fields
  id: Joi.string().required().min(1).max(200),
  manufacturer: Joi.string().required().min(1).max(200),
  model: Joi.string().required().min(1).max(200),

  // Optional string fields with pattern validation
  loadCapacity: Joi.alternatives().try(
    Joi.string().pattern(PATTERNS.loadCapacity),
    Joi.string().allow('', '-')
  ),
  liftingSpeed: Joi.alternatives().try(
    Joi.string().pattern(PATTERNS.liftingSpeed),
    Joi.string().allow('', '-')
  ),
  motorPower: Joi.alternatives().try(
    Joi.string().pattern(PATTERNS.motorPower),
    Joi.string().allow('', '-')
  ),
  dutyCycle: Joi.alternatives().try(
    Joi.string().pattern(PATTERNS.dutyCycle),
    Joi.string().allow('', '-')
  ),
  protectionClass: Joi.alternatives().try(
    Joi.string().pattern(PATTERNS.protectionClass),
    Joi.string().allow('', '-')
  ),
  weight: Joi.alternatives().try(
    Joi.string().pattern(PATTERNS.weight),
    Joi.string().allow('', '-')
  ),

  // Optional string fields without strict patterns
  series: Joi.string().allow('', '-').max(200),
  chainFall: Joi.string().allow('', '-').max(50),
  liftHeight: Joi.string().allow('', '-').max(100),
  dimensions: Joi.string().allow('', '-').max(200),
  brakeType: Joi.string().allow('', '-').max(200),
  chainSpecification: Joi.string().allow('', '-').max(200),
  controlType: Joi.string().allow('', '-').max(200),
  noiseLevel: Joi.string().allow('', '-').max(50),
  operatingTemperature: Joi.string().allow('', '-').max(100),
  warranty: Joi.string().allow('', '-').max(200),

  // URL fields
  url: Joi.string().uri().allow(''),
  datasheet: Joi.string().uri().allow(''),

  // Classification array - allow any string (standards vary widely)
  classification: Joi.array().items(
    Joi.string().lowercase()
  ).default([]),

  // Voltage options array
  voltageOptions: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ),

  // Color options
  bodyColor: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ),

  // Applications
  commonApplications: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ),

  // Safety features - can be object or array
  safetyFeatures: Joi.alternatives().try(
    safetyFeaturesSchema,
    Joi.array().items(Joi.string())
  ),
  additionalSafety: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ),

  // Certifications - can be object or array
  certifications: Joi.alternatives().try(
    certificationsSchema,
    Joi.array().items(Joi.string())
  ),

  // Media arrays
  images: Joi.array().items(imageSchema).default([]),
  pdfs: Joi.array().items(pdfSchema).default([]),
  downloadedPDFs: Joi.array().items(pdfSchema),
  videos: Joi.array().items(Joi.object({
    type: Joi.string().allow('', null),
    url: Joi.string().allow('', null),
    embed: Joi.string().allow('', null),
    id: Joi.string().allow('', null),
  }).unknown(true)),

  // Entertainment-specific fields
  quietOperation: Joi.boolean(),
  dynamicLifting: Joi.boolean(),
  liftingOverPeople: Joi.boolean(),
  entertainmentIndustry: Joi.boolean(),

  // Speed control parameters
  variableSpeedControl: Joi.object({
    minSpeed: Joi.string(),
    maxSpeed: Joi.string(),
    defaultSpeed: Joi.string(),
    maxAccel: Joi.string(),
    maxDecel: Joi.string(),
    errorStop: Joi.string(),
  }),

  // Tuning parameters
  tuningParameters: Joi.object().unknown(true),

  // Load monitoring
  underloadLimit: Joi.string().allow(''),
  overloadLimit: Joi.string().allow(''),
  loadcellScaling: Joi.string().allow(''),
  encoderScaling: Joi.string().allow(''),

  // Category and type
  category: Joi.string().allow('', 'Unknown'),
  speedType: Joi.string().valid('Variable Speed', 'Fixed Speed', 'Unknown', ''),
  source: Joi.string().valid('scraped', 'personality', 'manual', 'merged'),

  // Control compatibility
  controlCompatibility: Joi.object().unknown(true),
  positionFeedback: Joi.object().unknown(true),

  // Support info
  supportInfo: Joi.object().unknown(true),

  // Pricing (if available)
  price: Joi.object({
    value: Joi.number(),
    currency: Joi.string(),
  }),
  rentalRate: Joi.object({
    daily: Joi.number(),
    weekly: Joi.number(),
  }),

  // Metadata
  lastUpdated: Joi.alternatives().try(
    Joi.date().iso(),
    Joi.string()
  ),
  processedDate: Joi.alternatives().try(
    Joi.date().iso(),
    Joi.string()
  ),

  // Enrichment tracking
  llmEnriched: Joi.boolean(),
  llmEnrichedAt: Joi.string(),
  llmProvider: Joi.string(),
  _pdfEnriched: Joi.boolean(),
  _pdfEnrichedAt: Joi.string(),
  _manuallyEnriched: Joi.boolean(),
  _manualEnrichmentAt: Joi.string(),
  _manualEnrichmentFields: Joi.array().items(Joi.string()),
  _manuallyCreated: Joi.boolean(),
  _manuallyCreatedAt: Joi.string(),
  _enrichedFields: Joi.array().items(Joi.string()),

  // Manual sources and notes
  manualSources: Joi.array().items(Joi.string().uri()),
  manualNotes: Joi.array().items(Joi.object({
    note: Joi.string(),
    addedAt: Joi.string()
  })),

  // Computed fields (added by processor) - allow null when source data is missing
  capacityKg: Joi.number().min(0).allow(null),
  speedMMin: Joi.number().min(0).allow(null),
  dataCompleteness: Joi.number().min(0).max(100).allow(null),
  hasCompleteSpecs: Joi.boolean().allow(null),

}).unknown(true); // Allow additional fields not defined here

// Validation function
function validateProduct(product, options = { strict: false }) {
  const schema = options.strict
    ? productSchema.options({ presence: 'required' })
    : productSchema;

  return schema.validate(product, {
    abortEarly: false,
    stripUnknown: false,
    convert: true
  });
}

// Validate array of products with comprehensive statistics
function validateProducts(products, options = {}) {
  const results = {
    total: products.length,
    valid: [],
    invalid: [],
    errors: [],
    warnings: [],
    missingFieldCounts: {
      loadCapacity: 0,
      liftingSpeed: 0,
      motorPower: 0,
      classification: 0,
      dutyCycle: 0,
      images: 0,
    },
    missingFieldPercentages: {},
  };

  for (const product of products) {
    const { error, value } = validateProduct(product, options);

    if (error) {
      results.invalid.push(product);
      results.errors.push({
        id: product.id,
        manufacturer: product.manufacturer,
        model: product.model,
        errors: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message,
          type: d.type
        }))
      });
    } else {
      results.valid.push(value);
    }

    // Count missing critical fields
    const criticalFields = ['loadCapacity', 'liftingSpeed', 'motorPower', 'dutyCycle'];
    criticalFields.forEach(field => {
      const val = product[field];
      if (!val || val === '' || val === '-') {
        results.missingFieldCounts[field]++;
      }
    });

    // Check classification
    if (!product.classification || !Array.isArray(product.classification) || product.classification.length === 0) {
      results.missingFieldCounts.classification++;
    }

    // Check images
    if (!product.images || !Array.isArray(product.images) || product.images.length === 0) {
      results.missingFieldCounts.images++;
    }
  }

  // Calculate percentages
  Object.keys(results.missingFieldCounts).forEach(field => {
    const percent = (results.missingFieldCounts[field] / results.total) * 100;
    results.missingFieldPercentages[field] = percent.toFixed(1) + '%';
  });

  return results;
}

/**
 * Data Quality Gates
 * Checks if data meets minimum quality thresholds
 * @param {Object} validationResults - Results from validateProducts()
 * @param {Object} thresholds - Custom thresholds (optional)
 * @returns {Object} Gate results with pass/fail status
 */
function checkQualityGates(validationResults, thresholds = {}) {
  const defaults = {
    maxInvalidPercent: 5,           // Max 5% invalid records allowed
    maxMissingCapacity: 80,         // Max 80% missing loadCapacity
    maxMissingSpeed: 85,            // Max 85% missing liftingSpeed
    maxMissingPower: 95,            // Max 95% missing motorPower
    maxMissingClassification: 50,   // Max 50% missing classification
    maxMissingImages: 60,           // Max 60% missing images
    minTotalRecords: 10,            // Minimum records required
  };

  const gates = { ...defaults, ...thresholds };
  const results = {
    passed: true,
    failedGates: [],
    passedGates: [],
    gates: [],
    summary: '',
  };

  // Helper to add gate result
  const addGate = (name, threshold, actual, passed, message) => {
    const gate = { name, threshold, actual, passed, message };
    results.gates.push(gate);
    if (passed) {
      results.passedGates.push(gate);
    } else {
      results.failedGates.push(gate);
      results.passed = false;
    }
  };

  // Gate 1: Minimum records
  addGate(
    'Minimum Records',
    `≥${gates.minTotalRecords}`,
    validationResults.total,
    validationResults.total >= gates.minTotalRecords,
    `Database has ${validationResults.total} records`
  );

  // Gate 2: Invalid records
  const invalidPercent = (validationResults.invalid.length / validationResults.total) * 100;
  addGate(
    'Schema Validity',
    `≤${gates.maxInvalidPercent}%`,
    `${invalidPercent.toFixed(1)}%`,
    invalidPercent <= gates.maxInvalidPercent,
    `${validationResults.invalid.length} records failed schema validation`
  );

  // Gate 3-7: Missing critical fields
  const fieldGates = [
    { field: 'loadCapacity', name: 'Load Capacity', max: gates.maxMissingCapacity },
    { field: 'liftingSpeed', name: 'Lifting Speed', max: gates.maxMissingSpeed },
    { field: 'motorPower', name: 'Motor Power', max: gates.maxMissingPower },
    { field: 'classification', name: 'Classification', max: gates.maxMissingClassification },
    { field: 'images', name: 'Images', max: gates.maxMissingImages },
  ];

  fieldGates.forEach(({ field, name, max }) => {
    const missingPercent = (validationResults.missingFieldCounts[field] / validationResults.total) * 100;
    addGate(
      `Missing ${name}`,
      `≤${max}%`,
      `${missingPercent.toFixed(1)}%`,
      missingPercent <= max,
      `${validationResults.missingFieldCounts[field]} of ${validationResults.total} records missing ${field}`
    );
  });

  // Generate summary
  if (results.passed) {
    results.summary = `✓ PASSED: All ${results.gates.length} quality gates passed`;
  } else {
    results.summary = `✗ FAILED: ${results.failedGates.length} of ${results.gates.length} gates failed - ` +
      results.failedGates.map(g => g.name).join(', ');
  }

  return results;
}

/**
 * Generate a human-readable validation report
 * @param {Object} validationResults - Results from validateProducts()
 * @param {Object} gateResults - Results from checkQualityGates()
 * @returns {string} Formatted report
 */
function generateValidationReport(validationResults, gateResults) {
  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '                    DATA QUALITY REPORT                         ',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Total Records: ${validationResults.total}`,
    `Valid Records: ${validationResults.valid.length} (${((validationResults.valid.length / validationResults.total) * 100).toFixed(1)}%)`,
    `Invalid Records: ${validationResults.invalid.length} (${((validationResults.invalid.length / validationResults.total) * 100).toFixed(1)}%)`,
    '',
    '─── Missing Field Analysis ───────────────────────────────────',
  ];

  Object.keys(validationResults.missingFieldCounts).forEach(field => {
    const count = validationResults.missingFieldCounts[field];
    const pct = validationResults.missingFieldPercentages[field];
    const bar = '█'.repeat(Math.round(parseFloat(pct) / 5)) + '░'.repeat(20 - Math.round(parseFloat(pct) / 5));
    lines.push(`  ${field.padEnd(16)} ${bar} ${pct.padStart(6)} (${count}/${validationResults.total})`);
  });

  lines.push('');
  lines.push('─── Quality Gates ────────────────────────────────────────────');

  gateResults.gates.forEach(gate => {
    const status = gate.passed ? '✓' : '✗';
    lines.push(`  ${status} ${gate.name.padEnd(20)} ${String(gate.actual).padStart(8)} (threshold: ${gate.threshold})`);
  });

  lines.push('');
  lines.push('─── Summary ──────────────────────────────────────────────────');
  lines.push(`  ${gateResults.summary}`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// Export schemas and validation functions
module.exports = {
  productSchema,
  imageSchema,
  pdfSchema,
  safetyFeaturesSchema,
  certificationsSchema,
  validateProduct,
  validateProducts,
  checkQualityGates,
  generateValidationReport,
  PATTERNS,
  VALID_CLASSIFICATIONS
};
