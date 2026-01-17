// Electric Chainhoist Database - Express Application
// Exports the Express app for testing and server startup

const express = require('express');
const fs = require('fs');
const path = require('path');

// Schema validation
const {
  validateProducts,
  checkQualityGates,
  generateValidationReport
} = require('./schemas/product.schema');

const app = express();

// Configuration
const CONFIG = {
  dataDir: 'chainhoist_data_processed',
  dataFile: 'chainhoist_database_processed.json',
  reportFile: 'data_quality_report.json',
  personalityDir: 'chainhoist_data',
  personalityFile: 'personality_enriched.json',
  cacheTTL: 5 * 60 * 1000, // 5 minutes cache TTL
};

// Set up templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static('public'));
app.use('/media', express.static(path.join(__dirname, 'chainhoist_data', 'media')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ============ CACHING LAYER ============
const cache = {
  data: null,
  dataTime: 0,
  report: null,
  reportTime: 0,
  personality: null,
  personalityTime: 0,
  // Validation results (computed on data load)
  validation: {
    results: null,
    qualityGates: null,
    lastChecked: null,
  },
  // Pre-computed indexes (rebuilt when data cache refreshes)
  indexes: {
    manufacturerStats: null,
    classificationStats: null,
    capacityRange: null,
    dataCompleteness: null,
    parsedCapacities: new Map(), // Map of id -> parsed capacity in kg
    parsedSpeeds: new Map(), // Map of id -> parsed speed in m/min
    // O(1) lookup indexes
    byId: new Map(), // Map of id -> item for O(1) product lookups
    byManufacturer: new Map(), // Map of manufacturer -> [items] for similar products
    byClassification: new Map(), // Map of classification -> [items] for filtered lookups
    // Data quality tier indexes (Phase 2 enhancement)
    byDataQualityTier: new Map(), // Map of tier -> [items] for quality filtering
    byCapacityBucket: new Map(), // Map of bucket -> [items] for O(1) capacity filtering
    bySpeedBucket: new Map(), // Map of bucket -> [items] for O(1) speed filtering
    // Products filtered by data quality
    hasImages: [], // Products with at least 1 image
    hasCompleteSpecs: [], // Products with all critical fields
    productCompleteness: new Map(), // Map of id -> completeness score (0-100)
    // Cached aggregation lists (avoid recomputing on every request)
    manufacturerList: [], // Sorted unique manufacturer names
    dutyCycleList: [], // Sorted unique duty cycles
    categoryList: [], // Sorted unique categories
    speedTypeList: [], // Sorted unique speed types
    classificationList: [], // Sorted unique classifications
    dataQualityTierList: [], // Sorted unique data quality tiers
  }
};

// Parse capacity string to numeric kg value (cached)
function parseCapacity(item) {
  if (!item.loadCapacity) {
    return null;
  }
  if (cache.indexes.parsedCapacities.has(item.id)) {
    return cache.indexes.parsedCapacities.get(item.id);
  }
  const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
  const value = match ? parseFloat(match[1]) : null;
  cache.indexes.parsedCapacities.set(item.id, value);
  return value;
}

// Parse speed string to numeric m/min value (cached)
function parseSpeed(item) {
  if (!item.liftingSpeed) {
    return null;
  }
  if (cache.indexes.parsedSpeeds.has(item.id)) {
    return cache.indexes.parsedSpeeds.get(item.id);
  }
  const match = item.liftingSpeed.match(/(\d+(?:\.\d+)?)\s*m/i);
  const value = match ? parseFloat(match[1]) : null;
  cache.indexes.parsedSpeeds.set(item.id, value);
  return value;
}

// Get capacity bucket name for a given kg value
function getCapacityBucket(kg) {
  if (kg === null || kg === undefined) {
    return null;
  }
  if (kg <= 250) {
    return '≤250 kg';
  }
  if (kg <= 500) {
    return '251-500 kg';
  }
  if (kg <= 1000) {
    return '501-1000 kg';
  }
  if (kg <= 2000) {
    return '1001-2000 kg';
  }
  return '>2000 kg';
}

// Get speed bucket name for a given m/min value
function getSpeedBucket(mmin) {
  if (mmin === null || mmin === undefined) {
    return null;
  }
  if (mmin < 2) {
    return '<2 m/min';
  }
  if (mmin < 4) {
    return '2-4 m/min';
  }
  if (mmin < 8) {
    return '4-8 m/min';
  }
  return '≥8 m/min';
}

// Check if item matches capacity bucket filter (uses cached parsed values)
function matchesCapacityBucket(item, capacityFilter) {
  const value = cache.indexes.parsedCapacities.get(item.id);
  if (value === null || value === undefined) {
    return false;
  }
  switch (capacityFilter) {
  case '≤250 kg':
    return value <= 250;
  case '251-500 kg':
    return value > 250 && value <= 500;
  case '501-1000 kg':
    return value > 500 && value <= 1000;
  case '1001-2000 kg':
    return value > 1000 && value <= 2000;
  case '>2000 kg':
    return value > 2000;
  default:
    return false;
  }
}

// Calculate product data completeness score (0-100)
function calculateProductCompleteness(item) {
  const criticalFields = ['loadCapacity', 'liftingSpeed', 'motorPower', 'classification', 'dutyCycle'];
  const secondaryFields = ['voltageOptions', 'weight', 'protectionClass', 'series'];

  let criticalScore = 0;
  let secondaryScore = 0;

  // Check critical fields (weighted 70%)
  for (const field of criticalFields) {
    const value = item[field];
    if (value && value !== '' && value !== '-' &&
        !(Array.isArray(value) && value.length === 0)) {
      criticalScore++;
    }
  }

  // Check secondary fields (weighted 30%)
  for (const field of secondaryFields) {
    const value = item[field];
    if (value && value !== '' && value !== '-' &&
        !(Array.isArray(value) && value.length === 0)) {
      secondaryScore++;
    }
  }

  // Calculate weighted score
  const criticalPct = criticalScore / criticalFields.length;
  const secondaryPct = secondaryScore / secondaryFields.length;

  return Math.round((criticalPct * 70) + (secondaryPct * 30));
}

// Check if product has all critical specs
function hasCompleteSpecs(item) {
  const requiredFields = ['loadCapacity', 'liftingSpeed', 'motorPower'];
  return requiredFields.every(field => {
    const value = item[field];
    return value && value !== '' && value !== '-';
  });
}

// Build indexes from data (O(n) single pass)
function buildIndexes(data) {
  const manufacturerMap = new Map();
  const classificationMap = new Map();
  const classificationSet = new Set();
  const dutyCycleSet = new Set();
  const categorySet = new Set();
  const speedTypeSet = new Set();
  const dataQualityTierSet = new Set();
  let minCapacity = Infinity;
  let maxCapacity = -Infinity;
  let hasLoadCapacity = 0;
  let hasLiftingSpeed = 0;
  let hasMotorPower = 0;
  let hasClassificationCount = 0;

  // Clear all caches
  cache.indexes.parsedCapacities.clear();
  cache.indexes.parsedSpeeds.clear();
  cache.indexes.byId.clear();
  cache.indexes.byManufacturer.clear();
  cache.indexes.byClassification.clear();
  cache.indexes.byDataQualityTier.clear();
  cache.indexes.byCapacityBucket.clear();
  cache.indexes.bySpeedBucket.clear();
  cache.indexes.productCompleteness.clear();
  cache.indexes.hasImages = [];
  cache.indexes.hasCompleteSpecs = [];

  // Single pass through data
  data.forEach(item => {
    // O(1) ID lookup index
    cache.indexes.byId.set(item.id, item);

    // Manufacturer-grouped index for similar products
    if (!cache.indexes.byManufacturer.has(item.manufacturer)) {
      cache.indexes.byManufacturer.set(item.manufacturer, []);
    }
    cache.indexes.byManufacturer.get(item.manufacturer).push(item);

    // Manufacturer stats
    if (!manufacturerMap.has(item.manufacturer)) {
      manufacturerMap.set(item.manufacturer, { count: 0, models: new Set() });
    }
    const mfrStats = manufacturerMap.get(item.manufacturer);
    mfrStats.count++;
    if (item.model) {
      mfrStats.models.add(item.model);
    }

    // Classification stats and index
    if (item.classification && Array.isArray(item.classification)) {
      hasClassificationCount++;
      item.classification.forEach(cls => {
        const clsLower = cls.toLowerCase();
        classificationMap.set(cls, (classificationMap.get(cls) || 0) + 1);
        classificationSet.add(cls);

        // Build byClassification index
        if (!cache.indexes.byClassification.has(clsLower)) {
          cache.indexes.byClassification.set(clsLower, []);
        }
        cache.indexes.byClassification.get(clsLower).push(item);
      });
    }

    // Collect unique values for filter dropdowns
    if (item.dutyCycle) {
      dutyCycleSet.add(item.dutyCycle);
    }
    if (item.category && item.category !== 'Unknown') {
      categorySet.add(item.category);
    }
    if (item.speedType && item.speedType !== 'Unknown') {
      speedTypeSet.add(item.speedType);
    }

    // Capacity range (and cache parsed value)
    const capacity = parseCapacity(item);
    if (capacity !== null) {
      hasLoadCapacity++;
      if (capacity < minCapacity) {
        minCapacity = capacity;
      }
      if (capacity > maxCapacity) {
        maxCapacity = capacity;
      }
    }

    // Parse and cache speed
    parseSpeed(item);

    // Data completeness
    if (item.liftingSpeed) {
      hasLiftingSpeed++;
    }
    if (item.motorPower) {
      hasMotorPower++;
    }

    // Calculate and cache product completeness
    const completeness = calculateProductCompleteness(item);
    cache.indexes.productCompleteness.set(item.id, completeness);

    // Track products with images
    if (item.images && Array.isArray(item.images) && item.images.length > 0) {
      cache.indexes.hasImages.push(item);
    }

    // Track products with complete specs
    if (hasCompleteSpecs(item)) {
      cache.indexes.hasCompleteSpecs.push(item);
    }

    // Build byDataQualityTier index (Phase 2)
    const tier = item.dataQualityTier || 'minimal';
    dataQualityTierSet.add(tier);
    if (!cache.indexes.byDataQualityTier.has(tier)) {
      cache.indexes.byDataQualityTier.set(tier, []);
    }
    cache.indexes.byDataQualityTier.get(tier).push(item);

    // Build byCapacityBucket index (Phase 2) - O(1) capacity filtering
    const capacityBucket = getCapacityBucket(cache.indexes.parsedCapacities.get(item.id));
    if (capacityBucket) {
      if (!cache.indexes.byCapacityBucket.has(capacityBucket)) {
        cache.indexes.byCapacityBucket.set(capacityBucket, []);
      }
      cache.indexes.byCapacityBucket.get(capacityBucket).push(item);
    }

    // Build bySpeedBucket index (Phase 2) - O(1) speed filtering
    const speedBucket = getSpeedBucket(cache.indexes.parsedSpeeds.get(item.id));
    if (speedBucket) {
      if (!cache.indexes.bySpeedBucket.has(speedBucket)) {
        cache.indexes.bySpeedBucket.set(speedBucket, []);
      }
      cache.indexes.bySpeedBucket.get(speedBucket).push(item);
    }
  });

  // Convert maps to sorted arrays
  cache.indexes.manufacturerStats = Array.from(manufacturerMap.entries())
    .map(([name, stats]) => ({ name, count: stats.count, models: stats.models.size }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cache.indexes.classificationStats = Array.from(classificationMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  cache.indexes.capacityRange = {
    min: minCapacity === Infinity ? 0 : minCapacity,
    max: maxCapacity === -Infinity ? 0 : maxCapacity
  };

  cache.indexes.dataCompleteness = {
    loadCapacity: data.length > 0 ? hasLoadCapacity / data.length : 0,
    liftingSpeed: data.length > 0 ? hasLiftingSpeed / data.length : 0,
    motorPower: data.length > 0 ? hasMotorPower / data.length : 0,
    classification: data.length > 0 ? hasClassificationCount / data.length : 0,
    hasImages: data.length > 0 ? cache.indexes.hasImages.length / data.length : 0,
    hasCompleteSpecs: data.length > 0 ? cache.indexes.hasCompleteSpecs.length / data.length : 0
  };

  // Cache aggregation lists (avoid recomputing on every request)
  cache.indexes.manufacturerList = Array.from(manufacturerMap.keys()).sort();
  cache.indexes.dutyCycleList = Array.from(dutyCycleSet).sort();
  cache.indexes.categoryList = Array.from(categorySet).sort();
  cache.indexes.speedTypeList = Array.from(speedTypeSet).sort();
  cache.indexes.classificationList = Array.from(classificationSet).sort();
  // Sort quality tiers in logical order (best to worst)
  const tierOrder = ['complete', 'partial', 'incomplete', 'minimal'];
  cache.indexes.dataQualityTierList = Array.from(dataQualityTierSet)
    .sort((a, b) => tierOrder.indexOf(a) - tierOrder.indexOf(b));

  console.log(`[Cache] Built indexes: ${manufacturerMap.size} manufacturers, ${classificationMap.size} classifications, ${cache.indexes.byId.size} products indexed`);
  console.log(`[Cache] Products with images: ${cache.indexes.hasImages.length}, with complete specs: ${cache.indexes.hasCompleteSpecs.length}`);
  console.log(`[Cache] Quality tiers: ${Array.from(cache.indexes.byDataQualityTier.entries()).map(([t, items]) => `${t}(${items.length})`).join(', ')}`);
  console.log(`[Cache] Capacity buckets: ${cache.indexes.byCapacityBucket.size}, Speed buckets: ${cache.indexes.bySpeedBucket.size}`);
}

// Load data helper with caching and validation
function loadData() {
  const now = Date.now();
  if (cache.data && (now - cache.dataTime) < CONFIG.cacheTTL) {
    return cache.data;
  }

  try {
    const dataPath = path.join(__dirname, CONFIG.dataDir, CONFIG.dataFile);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    cache.data = data;
    cache.dataTime = now;

    // Validate data and check quality gates
    const validationResults = validateProducts(data);
    const gateResults = checkQualityGates(validationResults);

    cache.validation.results = validationResults;
    cache.validation.qualityGates = gateResults;
    cache.validation.lastChecked = new Date().toISOString();

    // Log validation report on first load
    if (!cache.indexes.byId || cache.indexes.byId.size === 0) {
      console.log('\n' + generateValidationReport(validationResults, gateResults) + '\n');
    }

    // Rebuild indexes when data is refreshed
    buildIndexes(data);
    console.log(`[Cache] Loaded ${data.length} records, cache valid for ${CONFIG.cacheTTL / 1000}s`);

    // Warn if quality gates failed (but don't block - allow degraded operation)
    if (!gateResults.passed) {
      console.warn(`[Quality] WARNING: ${gateResults.failedGates.length} quality gate(s) failed`);
      gateResults.failedGates.forEach(g => {
        console.warn(`  - ${g.name}: ${g.actual} (threshold: ${g.threshold})`);
      });
    }

    return data;
  } catch (error) {
    console.error('Error loading data:', error);
    return cache.data || [];
  }
}

// Load report helper with caching
function loadReport() {
  const now = Date.now();
  if (cache.report && (now - cache.reportTime) < CONFIG.cacheTTL) {
    return cache.report;
  }

  try {
    const reportPath = path.join(__dirname, CONFIG.dataDir, CONFIG.reportFile);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    cache.report = report;
    cache.reportTime = now;
    return report;
  } catch (error) {
    console.error('Error loading report:', error);
    return cache.report || { totalRecords: 0 };
  }
}

// Load personality data helper with caching
function loadPersonalityData() {
  const now = Date.now();
  if (cache.personality && (now - cache.personalityTime) < CONFIG.cacheTTL) {
    return cache.personality;
  }

  try {
    const dataPath = path.join(__dirname, CONFIG.personalityDir, CONFIG.personalityFile);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    cache.personality = data;
    cache.personalityTime = now;
    return data;
  } catch (error) {
    console.error('Error loading personality data:', error);
    return cache.personality || { products: [], totalProducts: 0, manufacturers: 0 };
  }
}

// Invalidate cache (call after data updates)
// eslint-disable-next-line no-unused-vars
function invalidateCache() {
  cache.data = null;
  cache.dataTime = 0;
  cache.report = null;
  cache.reportTime = 0;
  cache.personality = null;
  cache.personalityTime = 0;
  console.log('[Cache] Invalidated all caches');
}

// ============ API Routes ============

// GET /api - API Documentation
app.get('/api', (req, res) => {
  const apiDocs = {
    title: 'Entertainment Industry Chainhoist Database API',
    version: '2.0',
    description: 'REST API for accessing chainhoist data',
    baseUrl: `${req.protocol}://${req.get('host')}/api`,
    endpoints: {
      'GET /api/chainhoists': {
        description: 'Get all chainhoists with optional filtering',
        parameters: {
          manufacturer: 'Filter by manufacturer name',
          model: 'Filter by model name',
          classification: 'Filter by classification',
          minCapacity: 'Minimum load capacity in kg',
          maxCapacity: 'Maximum load capacity in kg',
          page: 'Page number (default: 1)',
          limit: 'Results per page (default: 50)'
        }
      },
      'GET /api/chainhoists/:id': {
        description: 'Get specific chainhoist by ID'
      },
      'GET /api/manufacturers': {
        description: 'Get all manufacturers with statistics'
      },
      'GET /api/classifications': {
        description: 'Get all classifications with counts'
      },
      'GET /api/stats': {
        description: 'Get database statistics and metadata'
      },
      'POST /api/search': {
        description: 'Advanced search with complex criteria',
        body: {
          query: 'Text search across multiple fields',
          capacityRange: { min: 'number', max: 'number' },
          manufacturers: 'Array of manufacturer names',
          classifications: 'Array of classification names',
          sortBy: 'Field to sort by',
          sortOrder: 'asc or desc',
          page: 'Page number',
          limit: 'Results per page'
        }
      }
    },
    examples: {
      'Find D8+ chainhoists': 'GET /api/chainhoists?classification=d8%2B',
      'Find high capacity hoists': 'GET /api/chainhoists?minCapacity=1000',
      'Search CM products': 'GET /api/chainhoists?manufacturer=Columbus%20McKinnon'
    }
  };

  res.json(apiDocs);
});

// GET /api/chainhoists - Get all chainhoists with optional filtering
app.get('/api/chainhoists', (req, res) => {
  try {
    const data = loadData();

    // Pre-process filter values once (outside the filter loop)
    const manufacturerFilter = req.query.manufacturer?.toLowerCase();
    const modelFilter = req.query.model?.toLowerCase();
    const classificationFilter = req.query.classification?.toLowerCase();
    const minCapacity = req.query.minCapacity ? parseFloat(req.query.minCapacity) : null;
    const maxCapacity = req.query.maxCapacity ? parseFloat(req.query.maxCapacity) : null;

    // Single-pass filtering: combine all filters into one pass instead of multiple sequential passes
    const results = data.filter(item => {
      // Manufacturer filter
      if (manufacturerFilter && !item.manufacturer.toLowerCase().includes(manufacturerFilter)) {
        return false;
      }

      // Model filter
      if (modelFilter && !item.model.toLowerCase().includes(modelFilter)) {
        return false;
      }

      // Classification filter
      if (classificationFilter) {
        if (!item.classification || !Array.isArray(item.classification)) {
          return false;
        }
        if (!item.classification.some(cls => cls.toLowerCase().includes(classificationFilter))) {
          return false;
        }
      }

      // Capacity range filters (use cached parsed values)
      if (minCapacity !== null || maxCapacity !== null) {
        const capacity = cache.indexes.parsedCapacities.get(item.id);
        if (capacity === null || capacity === undefined) {
          return false;
        }
        if (minCapacity !== null && capacity < minCapacity) {
          return false;
        }
        if (maxCapacity !== null && capacity > maxCapacity) {
          return false;
        }
      }

      return true;
    });

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedResults = results.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: results.length,
        pages: Math.ceil(results.length / limit)
      },
      filters: req.query
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chainhoists',
      message: error.message
    });
  }
});

// GET /api/chainhoists/:id - Get specific chainhoist (uses O(1) ID index)
app.get('/api/chainhoists/:id', (req, res) => {
  try {
    loadData(); // Ensure data and indexes are loaded
    const chainhoist = cache.indexes.byId.get(req.params.id);

    if (!chainhoist) {
      return res.status(404).json({
        success: false,
        error: 'Chainhoist not found'
      });
    }

    res.json({
      success: true,
      data: chainhoist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chainhoist',
      message: error.message
    });
  }
});

// GET /api/manufacturers - Get all manufacturers (uses pre-computed index)
app.get('/api/manufacturers', (req, res) => {
  try {
    // Ensure data is loaded and indexes are built
    loadData();

    // Return pre-computed manufacturer stats (O(1) instead of O(n²))
    res.json({
      success: true,
      data: cache.indexes.manufacturerStats || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch manufacturers',
      message: error.message
    });
  }
});

// GET /api/classifications - Get all classifications (uses pre-computed index)
app.get('/api/classifications', (req, res) => {
  try {
    // Ensure data is loaded and indexes are built
    loadData();

    // Return pre-computed classification stats (O(1) instead of O(n))
    res.json({
      success: true,
      data: cache.indexes.classificationStats || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch classifications',
      message: error.message
    });
  }
});

// GET /api/stats - Get database statistics (uses pre-computed indexes)
app.get('/api/stats', (req, res) => {
  try {
    const data = loadData();
    const report = loadReport();

    // Use pre-computed indexes instead of multiple scans (O(1) instead of O(n*5))
    const stats = {
      totalRecords: data.length,
      manufacturers: cache.indexes.manufacturerStats?.length || 0,
      classifications: cache.indexes.classificationStats?.length || 0,
      capacityRange: cache.indexes.capacityRange || { min: 0, max: 0 },
      lastUpdated: data.length > 0
        ? Math.max(...data.map(item => new Date(item.lastUpdated).getTime()))
        : Date.now(),
      dataCompleteness: cache.indexes.dataCompleteness || {
        loadCapacity: 0,
        liftingSpeed: 0,
        motorPower: 0,
        classification: 0
      }
    };

    res.json({
      success: true,
      data: stats,
      report: report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});

// GET /api/quality - Get data quality validation results
app.get('/api/quality', (req, res) => {
  try {
    // Ensure data is loaded (triggers validation if not cached)
    loadData();

    const validation = cache.validation;

    if (!validation.results) {
      return res.status(503).json({
        success: false,
        error: 'Validation not yet completed',
        message: 'Data is still being loaded'
      });
    }

    res.json({
      success: true,
      data: {
        summary: {
          total: validation.results.total,
          valid: validation.results.valid.length,
          invalid: validation.results.invalid.length,
          validPercent: ((validation.results.valid.length / validation.results.total) * 100).toFixed(1) + '%',
        },
        missingFields: {
          counts: validation.results.missingFieldCounts,
          percentages: validation.results.missingFieldPercentages,
        },
        qualityGates: {
          passed: validation.qualityGates.passed,
          summary: validation.qualityGates.summary,
          gates: validation.qualityGates.gates,
        },
        errors: validation.results.errors.slice(0, 20), // First 20 errors
        lastChecked: validation.lastChecked,
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch quality data',
      message: error.message
    });
  }
});

// GET /api/products/by-quality/:tier - Get products by data quality tier (O(1) lookup)
app.get('/api/products/by-quality/:tier', (req, res) => {
  try {
    loadData(); // Ensure data and indexes are loaded
    const tier = req.params.tier.toLowerCase();
    const validTiers = ['complete', 'partial', 'incomplete', 'minimal'];

    if (!validTiers.includes(tier)) {
      return res.status(400).json({
        success: false,
        error: `Invalid tier. Valid values: ${validTiers.join(', ')}`
      });
    }

    // O(1) lookup using pre-built index
    const products = cache.indexes.byDataQualityTier.get(tier) || [];

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;
    const paginatedResults = products.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      tier,
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: products.length,
        pages: Math.ceil(products.length / limit)
      },
      tierStats: {
        complete: cache.indexes.byDataQualityTier.get('complete')?.length || 0,
        partial: cache.indexes.byDataQualityTier.get('partial')?.length || 0,
        incomplete: cache.indexes.byDataQualityTier.get('incomplete')?.length || 0,
        minimal: cache.indexes.byDataQualityTier.get('minimal')?.length || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products by quality tier',
      message: error.message
    });
  }
});

// GET /api/products/by-capacity/:bucket - Get products by capacity bucket (O(1) lookup)
app.get('/api/products/by-capacity/:bucket', (req, res) => {
  try {
    loadData(); // Ensure data and indexes are loaded

    // Decode the bucket parameter (handles URL encoding)
    const bucket = decodeURIComponent(req.params.bucket);
    const validBuckets = ['≤250 kg', '251-500 kg', '501-1000 kg', '1001-2000 kg', '>2000 kg'];

    if (!validBuckets.includes(bucket)) {
      return res.status(400).json({
        success: false,
        error: `Invalid bucket. Valid values: ${validBuckets.join(', ')}`
      });
    }

    // O(1) lookup using pre-built index
    const products = cache.indexes.byCapacityBucket.get(bucket) || [];

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;
    const paginatedResults = products.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      bucket,
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: products.length,
        pages: Math.ceil(products.length / limit)
      },
      bucketStats: Object.fromEntries(
        validBuckets.map(b => [b, cache.indexes.byCapacityBucket.get(b)?.length || 0])
      )
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products by capacity',
      message: error.message
    });
  }
});

// GET /api/indexes/stats - Get index statistics for debugging/monitoring
app.get('/api/indexes/stats', (req, res) => {
  try {
    loadData(); // Ensure indexes are built

    res.json({
      success: true,
      indexes: {
        byId: cache.indexes.byId.size,
        byManufacturer: cache.indexes.byManufacturer.size,
        byClassification: cache.indexes.byClassification.size,
        byDataQualityTier: Object.fromEntries(
          Array.from(cache.indexes.byDataQualityTier.entries())
            .map(([k, v]) => [k, v.length])
        ),
        byCapacityBucket: Object.fromEntries(
          Array.from(cache.indexes.byCapacityBucket.entries())
            .map(([k, v]) => [k, v.length])
        ),
        bySpeedBucket: Object.fromEntries(
          Array.from(cache.indexes.bySpeedBucket.entries())
            .map(([k, v]) => [k, v.length])
        ),
        hasImages: cache.indexes.hasImages.length,
        hasCompleteSpecs: cache.indexes.hasCompleteSpecs.length,
        parsedCapacities: cache.indexes.parsedCapacities.size,
        parsedSpeeds: cache.indexes.parsedSpeeds.size
      },
      lists: {
        manufacturers: cache.indexes.manufacturerList.length,
        classifications: cache.indexes.classificationList.length,
        categories: cache.indexes.categoryList.length,
        dutyCycles: cache.indexes.dutyCycleList.length,
        speedTypes: cache.indexes.speedTypeList.length,
        dataQualityTiers: cache.indexes.dataQualityTierList.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch index stats',
      message: error.message
    });
  }
});

// POST /api/search - Advanced search endpoint
app.post('/api/search', (req, res) => {
  try {
    const data = loadData();
    const searchCriteria = req.body;
    let results = [...data];

    if (searchCriteria.query) {
      const query = searchCriteria.query.toLowerCase();
      results = results.filter(item =>
        item.manufacturer?.toLowerCase().includes(query) ||
        item.model?.toLowerCase().includes(query) ||
        item.series?.toLowerCase().includes(query) ||
        item.loadCapacity?.toLowerCase().includes(query) ||
        item.classification?.join(' ').toLowerCase().includes(query)
      );
    }

    if (searchCriteria.capacityRange) {
      const { min, max } = searchCriteria.capacityRange;
      results = results.filter(item => {
        const capacity = parseCapacity(item);
        if (capacity === null) {
          return false;
        }
        return (min === undefined || capacity >= min) &&
               (max === undefined || capacity <= max);
      });
    }

    if (searchCriteria.manufacturers && searchCriteria.manufacturers.length > 0) {
      results = results.filter(item =>
        searchCriteria.manufacturers.includes(item.manufacturer)
      );
    }

    if (searchCriteria.classifications && searchCriteria.classifications.length > 0) {
      results = results.filter(item =>
        item.classification &&
        Array.isArray(item.classification) &&
        searchCriteria.classifications.some(cls =>
          item.classification.includes(cls)
        )
      );
    }

    if (searchCriteria.sortBy) {
      const sortBy = searchCriteria.sortBy;
      const sortOrder = searchCriteria.sortOrder || 'asc';

      results.sort((a, b) => {
        let aVal, bVal;

        // Use cached parsed values for numeric fields (avoids regex on every comparison)
        if (sortBy === 'loadCapacity' || sortBy === 'capacity') {
          aVal = parseCapacity(a) || 0;
          bVal = parseCapacity(b) || 0;
        } else if (sortBy === 'liftingSpeed' || sortBy === 'speed') {
          aVal = parseSpeed(a) || 0;
          bVal = parseSpeed(b) || 0;
        } else {
          aVal = a[sortBy] || '';
          bVal = b[sortBy] || '';
        }

        if (sortOrder === 'desc') {
          return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
        }
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      });
    }

    const page = searchCriteria.page || 1;
    const limit = searchCriteria.limit || 50;
    const startIndex = (page - 1) * limit;
    const paginatedResults = results.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: paginatedResults,
      total: results.length,
      page,
      limit,
      searchCriteria
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

// GET /api/suggestions - Search autocomplete suggestions
app.get('/api/suggestions', (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase().trim();
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);

    if (!query || query.length < 2) {
      return res.json({ suggestions: [] });
    }

    loadData(); // Ensure data and indexes are loaded

    const suggestions = [];
    const seen = new Set();

    // Add matching manufacturers
    for (const mfr of cache.indexes.manufacturerList) {
      if (mfr.toLowerCase().includes(query)) {
        const key = `mfr:${mfr}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({
            type: 'manufacturer',
            value: mfr,
            label: mfr,
            count: cache.indexes.byManufacturer.get(mfr)?.length || 0
          });
        }
      }
    }

    // Add matching classifications
    for (const cls of cache.indexes.classificationList) {
      if (cls.toLowerCase().includes(query)) {
        const key = `cls:${cls}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({
            type: 'classification',
            value: cls,
            label: cls.toUpperCase(),
            count: cache.indexes.byClassification.get(cls.toLowerCase())?.length || 0
          });
        }
      }
    }

    // Add matching models (limit to prevent too many results)
    let modelCount = 0;
    for (const [, item] of cache.indexes.byId) {
      if (modelCount >= 5) {
        break;
      }

      const modelMatch = item.model?.toLowerCase().includes(query);
      const seriesMatch = item.series?.toLowerCase().includes(query);

      if (modelMatch || seriesMatch) {
        const key = `model:${item.manufacturer}:${item.model}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({
            type: 'product',
            value: item.id,
            label: `${item.manufacturer} ${item.model}`,
            manufacturer: item.manufacturer,
            model: item.model
          });
          modelCount++;
        }
      }
    }

    // Sort: manufacturers first, then classifications, then products
    const typeOrder = { manufacturer: 0, classification: 1, product: 2 };
    suggestions.sort((a, b) => {
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      // Within same type, sort by count (descending) or alphabetically
      if (a.count !== undefined && b.count !== undefined) {
        return b.count - a.count;
      }
      return a.label.localeCompare(b.label);
    });

    res.json({
      query,
      suggestions: suggestions.slice(0, limit)
    });
  } catch (error) {
    res.status(500).json({
      suggestions: [],
      error: error.message
    });
  }
});

// GET /api/count - Get count of results for given filters (for live preview)
app.get('/api/count', (req, res) => {
  try {
    const data = loadData();

    // Pre-process filter values once
    const query = req.query.q?.toLowerCase() || '';
    const manufacturerFilter = req.query.manufacturer;
    const capacityFilter = req.query.capacity;
    const classificationFilter = req.query.classification;
    const categoryFilter = req.query.category;
    const speedTypeFilter = req.query.speedType;
    const dutyCycleFilter = req.query.dutyCycle;
    const dataQualityFilter = req.query.dataQuality;

    // Single-pass counting with all filters combined
    let count = 0;
    for (const item of data) {
      // Text search filter
      if (query) {
        const matches =
          item.manufacturer?.toLowerCase().includes(query) ||
          item.model?.toLowerCase().includes(query) ||
          item.series?.toLowerCase().includes(query) ||
          item.loadCapacity?.toLowerCase().includes(query) ||
          item.classification?.join(' ').toLowerCase().includes(query);
        if (!matches) {
          continue;
        }
      }

      // Manufacturer filter (exact match)
      if (manufacturerFilter && item.manufacturer !== manufacturerFilter) {
        continue;
      }

      // Capacity bucket filter (uses cached values)
      if (capacityFilter && !matchesCapacityBucket(item, capacityFilter)) {
        continue;
      }

      // Classification filter
      if (classificationFilter) {
        if (!item.classification || !Array.isArray(item.classification) ||
            !item.classification.includes(classificationFilter)) {
          continue;
        }
      }

      // Category filter
      if (categoryFilter && item.category !== categoryFilter) {
        continue;
      }

      // Speed type filter
      if (speedTypeFilter && item.speedType !== speedTypeFilter) {
        continue;
      }

      // Duty cycle filter
      if (dutyCycleFilter && item.dutyCycle !== dutyCycleFilter) {
        continue;
      }

      // Data quality filter (Phase 2)
      if (dataQualityFilter) {
        if (dataQualityFilter === 'complete') {
          const requiredFields = ['loadCapacity', 'liftingSpeed', 'motorPower'];
          const hasAllSpecs = requiredFields.every(field => {
            const value = item[field];
            return value && value !== '' && value !== '-';
          });
          if (!hasAllSpecs) {
            continue;
          }
        } else if (dataQualityFilter === 'hasImages') {
          if (!item.images || !Array.isArray(item.images) || item.images.length === 0) {
            continue;
          }
        } else if (dataQualityFilter.startsWith('tier-')) {
          const tier = dataQualityFilter.replace('tier-', '');
          if (item.dataQualityTier !== tier) {
            continue;
          }
        }
      }

      count++;
    }

    res.json({ count });
  } catch (error) {
    res.status(500).json({ count: 0, error: error.message });
  }
});

// ============ Personality API Routes ============

// GET /api/personality - Get all personality products
app.get('/api/personality', (req, res) => {
  try {
    const data = loadPersonalityData();
    let results = [...data.products];

    // Filter by manufacturer
    if (req.query.manufacturer) {
      results = results.filter(item =>
        item.manufacturer?.toLowerCase().includes(req.query.manufacturer.toLowerCase())
      );
    }

    // Filter by category
    if (req.query.category) {
      results = results.filter(item =>
        item.category?.toLowerCase() === req.query.category.toLowerCase()
      );
    }

    // Filter by speed type
    if (req.query.speedType) {
      results = results.filter(item =>
        item.speedType?.toLowerCase() === req.query.speedType.toLowerCase()
      );
    }

    // Filter entertainment only
    if (req.query.entertainmentOnly === 'true') {
      results = results.filter(item => item.entertainmentIndustry === true);
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;
    const paginatedResults = results.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: results.length,
        pages: Math.ceil(results.length / limit)
      },
      summary: {
        totalProducts: data.totalProducts,
        manufacturers: data.manufacturers,
        categories: data.categories,
        speedTypes: data.speedTypes,
        entertainmentProducts: data.entertainmentProducts
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch personality data',
      message: error.message
    });
  }
});

// GET /api/personality/stats - Get personality database statistics
app.get('/api/personality/stats', (req, res) => {
  try {
    const data = loadPersonalityData();

    res.json({
      success: true,
      data: {
        version: data.version,
        generatedAt: data.generatedAt,
        source: data.source,
        totalProducts: data.totalProducts,
        manufacturers: data.manufacturers,
        categories: data.categories,
        speedTypes: data.speedTypes,
        entertainmentProducts: data.entertainmentProducts
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch personality stats',
      message: error.message
    });
  }
});

// GET /api/personality/:id - Get specific personality product
app.get('/api/personality/:manufacturerId/:productId', (req, res) => {
  try {
    const data = loadPersonalityData();
    const product = data.products.find(item =>
      item.manufacturerId === req.params.manufacturerId &&
      item.productId === req.params.productId
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product',
      message: error.message
    });
  }
});

// ============ Web Routes ============

app.get('/', (req, res) => {
  const data = loadData();
  const report = loadReport();

  // Use cached aggregation lists instead of recomputing
  const manufacturers = cache.indexes.manufacturerList;
  const capacities = Object.keys(report.capacityDistribution || {}).sort((a, b) => {
    const getNumber = (str) => {
      const match = str.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    };
    return getNumber(a) - getNumber(b);
  });
  const classifications = Object.keys(report.classificationDistribution || {}).sort();

  res.render('index', {
    data,
    report,
    manufacturers,
    capacities,
    classifications,
    filters: req.query,
    title: 'Electric Chainhoist Database'
  });
});

app.get('/search', (req, res) => {
  const data = loadData();
  const report = loadReport();
  const query = req.query.q?.toLowerCase() || '';

  // Phase 2 Optimization: Use pre-built indexes for O(1) initial filtering
  // when a single indexed filter is applied (significant speedup for large datasets)
  let results;
  let usedIndex = false;

  // Check if we can use an index for initial filtering
  const hasQuery = !!query;
  const hasManufacturer = !!req.query.manufacturer;
  const hasCapacity = !!req.query.capacity;
  const hasClassification = !!req.query.classification;
  // These filter flags reserved for future index optimization
  // const hasCategory = !!req.query.category;
  // const hasSpeedType = !!req.query.speedType;
  // const hasDutyCycle = !!req.query.dutyCycle;
  const hasDataQuality = !!req.query.dataQuality;
  const tierMatch = req.query.dataQuality?.match(/^tier-(\w+)$/);

  // Choose the most selective index to start with (O(1) lookup)
  if (!hasQuery && hasManufacturer && !hasClassification && !hasCapacity && !tierMatch) {
    // Use manufacturer index
    results = [...(cache.indexes.byManufacturer.get(req.query.manufacturer) || [])];
    usedIndex = 'manufacturer';
  } else if (!hasQuery && hasClassification && !hasManufacturer && !hasCapacity && !tierMatch) {
    // Use classification index
    results = [...(cache.indexes.byClassification.get(req.query.classification.toLowerCase()) || [])];
    usedIndex = 'classification';
  } else if (!hasQuery && hasCapacity && !hasManufacturer && !hasClassification && !tierMatch) {
    // Use capacity bucket index
    results = [...(cache.indexes.byCapacityBucket.get(req.query.capacity) || [])];
    usedIndex = 'capacity';
  } else if (!hasQuery && tierMatch && !hasManufacturer && !hasClassification && !hasCapacity) {
    // Use data quality tier index
    results = [...(cache.indexes.byDataQualityTier.get(tierMatch[1]) || [])];
    usedIndex = 'dataQualityTier';
  } else if (!hasQuery && hasDataQuality === 'complete' && !hasManufacturer && !hasClassification && !hasCapacity) {
    // Use hasCompleteSpecs index
    results = [...cache.indexes.hasCompleteSpecs];
    usedIndex = 'hasCompleteSpecs';
  } else if (!hasQuery && hasDataQuality === 'hasImages' && !hasManufacturer && !hasClassification && !hasCapacity) {
    // Use hasImages index
    results = [...cache.indexes.hasImages];
    usedIndex = 'hasImages';
  } else {
    // Fall back to full dataset
    results = [...data];
  }

  // Apply remaining filters
  if (query) {
    results = results.filter(item => {
      return (
        (item.manufacturer?.toLowerCase().includes(query)) ||
        (item.model?.toLowerCase().includes(query)) ||
        (item.series?.toLowerCase().includes(query)) ||
        (item.loadCapacity?.toLowerCase().includes(query)) ||
        (item.classification?.join(' ').toLowerCase().includes(query))
      );
    });
  }

  if (req.query.manufacturer && usedIndex !== 'manufacturer') {
    results = results.filter(item => item.manufacturer === req.query.manufacturer);
  }

  if (req.query.capacity && usedIndex !== 'capacity') {
    // Use cached parsed capacities via helper function
    results = results.filter(item => matchesCapacityBucket(item, req.query.capacity));
  }

  if (req.query.classification && usedIndex !== 'classification') {
    results = results.filter(item => {
      return item.classification &&
        Array.isArray(item.classification) &&
        item.classification.includes(req.query.classification);
    });
  }

  if (req.query.category) {
    results = results.filter(item => item.category === req.query.category);
  }

  if (req.query.speedType) {
    results = results.filter(item => item.speedType === req.query.speedType);
  }

  if (req.query.dutyCycle) {
    results = results.filter(item => item.dutyCycle === req.query.dutyCycle);
  }

  // Data quality filter (Phase 2 enhanced) - skip if already handled by index
  if (req.query.dataQuality && usedIndex !== 'dataQualityTier' &&
      usedIndex !== 'hasCompleteSpecs' && usedIndex !== 'hasImages') {
    const qualityFilter = req.query.dataQuality;

    if (qualityFilter === 'complete') {
      // Has all critical specs
      results = results.filter(item => {
        const requiredFields = ['loadCapacity', 'liftingSpeed', 'motorPower'];
        return requiredFields.every(field => {
          const value = item[field];
          return value && value !== '' && value !== '-';
        });
      });
    } else if (qualityFilter === 'hasImages') {
      // Has at least one image
      results = results.filter(item =>
        item.images && Array.isArray(item.images) && item.images.length > 0
      );
    } else if (qualityFilter.startsWith('tier-')) {
      // Filter by data quality tier (uses pre-computed field from data processor)
      const tier = qualityFilter.replace('tier-', '');
      results = results.filter(item => item.dataQualityTier === tier);
    }
  }

  // Use cached aggregation lists instead of recomputing on every request
  const manufacturers = cache.indexes.manufacturerList;
  const capacities = Object.keys(report.capacityDistribution || {}).sort((a, b) => {
    const getNumber = (str) => {
      const match = str.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    };
    return getNumber(a) - getNumber(b);
  });
  const classifications = Object.keys(report.classificationDistribution || {}).sort();
  const categories = cache.indexes.categoryList;
  const speedTypes = cache.indexes.speedTypeList;
  const dutyCycles = cache.indexes.dutyCycleList;

  // Sorting
  const sortBy = req.query.sortBy || '';
  const sortOrder = req.query.sortOrder || 'asc';

  if (sortBy) {
    results.sort((a, b) => {
      let aVal, bVal;

      // Use cached parsed values for numeric fields (avoids regex on every comparison)
      if (sortBy === 'capacity') {
        aVal = cache.indexes.parsedCapacities.get(a.id) || 0;
        bVal = cache.indexes.parsedCapacities.get(b.id) || 0;
      } else if (sortBy === 'speed') {
        aVal = cache.indexes.parsedSpeeds.get(a.id) || 0;
        bVal = cache.indexes.parsedSpeeds.get(b.id) || 0;
      } else if (sortBy === 'classification') {
        // Join array for comparison
        aVal = Array.isArray(a.classification) ? a.classification.join(' ') : (a.classification || '');
        bVal = Array.isArray(b.classification) ? b.classification.join(' ') : (b.classification || '');
      } else {
        aVal = a[sortBy] || '';
        bVal = b[sortBy] || '';
      }

      // Compare
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortOrder === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }

  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const totalResults = results.length;
  const totalPages = Math.ceil(totalResults / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedResults = results.slice(startIndex, endIndex);

  res.render('search', {
    data: paginatedResults,
    query,
    report,
    manufacturers,
    capacities,
    classifications,
    categories,
    speedTypes,
    dutyCycles,
    filters: req.query,
    resultsCount: totalResults,
    pagination: {
      page,
      limit,
      totalPages,
      totalResults,
      hasNext: page < totalPages,
      hasPrev: page > 1
    },
    sort: {
      by: sortBy,
      order: sortOrder
    },
    title: query ? `Search Results for "${query}"` : 'Browse Chainhoists'
  });
});

app.get('/product/:id', (req, res) => {
  const data = loadData();
  const id = req.params.id;

  // Find the product using O(1) ID index
  const product = cache.indexes.byId.get(id);

  if (!product) {
    return res.status(404).render('error', {
      message: 'Product not found',
      title: 'Error'
    });
  }

  // Apply same filters as search page to get filtered results for navigation
  let filteredData = [...data];
  const query = req.query.q?.toLowerCase() || '';

  if (query) {
    filteredData = filteredData.filter(item => {
      return (
        (item.manufacturer?.toLowerCase().includes(query)) ||
        (item.model?.toLowerCase().includes(query)) ||
        (item.series?.toLowerCase().includes(query)) ||
        (item.loadCapacity?.toLowerCase().includes(query)) ||
        (item.classification?.join(' ').toLowerCase().includes(query))
      );
    });
  }

  if (req.query.manufacturer) {
    filteredData = filteredData.filter(item => item.manufacturer === req.query.manufacturer);
  }

  if (req.query.capacity) {
    // Use cached parsed capacities via helper function
    filteredData = filteredData.filter(item => matchesCapacityBucket(item, req.query.capacity));
  }

  if (req.query.classification) {
    filteredData = filteredData.filter(item => {
      return item.classification &&
        Array.isArray(item.classification) &&
        item.classification.includes(req.query.classification);
    });
  }

  if (req.query.category) {
    filteredData = filteredData.filter(item => item.category === req.query.category);
  }

  if (req.query.speedType) {
    filteredData = filteredData.filter(item => item.speedType === req.query.speedType);
  }

  if (req.query.dutyCycle) {
    filteredData = filteredData.filter(item => item.dutyCycle === req.query.dutyCycle);
  }

  // Apply sorting if specified
  const sortBy = req.query.sortBy || '';
  const sortOrder = req.query.sortOrder || 'asc';

  if (sortBy) {
    filteredData.sort((a, b) => {
      let aVal, bVal;

      // Use cached parsed values for numeric fields (avoids regex on every comparison)
      if (sortBy === 'capacity') {
        aVal = cache.indexes.parsedCapacities.get(a.id) || 0;
        bVal = cache.indexes.parsedCapacities.get(b.id) || 0;
      } else if (sortBy === 'speed') {
        aVal = cache.indexes.parsedSpeeds.get(a.id) || 0;
        bVal = cache.indexes.parsedSpeeds.get(b.id) || 0;
      } else if (sortBy === 'classification') {
        aVal = Array.isArray(a.classification) ? a.classification.join(' ') : (a.classification || '');
        bVal = Array.isArray(b.classification) ? b.classification.join(' ') : (b.classification || '');
      } else {
        aVal = a[sortBy] || '';
        bVal = b[sortBy] || '';
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortOrder === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }

  // Find current index within filtered results
  const currentIndex = filteredData.findIndex(item => item.id === id);

  // Get previous and next products from filtered results
  const prevProduct = currentIndex > 0 ? filteredData[currentIndex - 1] : null;
  const nextProduct = currentIndex < filteredData.length - 1 ? filteredData[currentIndex + 1] : null;

  // Build query string for navigation links
  const searchParams = new URLSearchParams();
  if (req.query.q) {
    searchParams.set('q', req.query.q);
  }
  if (req.query.manufacturer) {
    searchParams.set('manufacturer', req.query.manufacturer);
  }
  if (req.query.capacity) {
    searchParams.set('capacity', req.query.capacity);
  }
  if (req.query.classification) {
    searchParams.set('classification', req.query.classification);
  }
  if (req.query.category) {
    searchParams.set('category', req.query.category);
  }
  if (req.query.speedType) {
    searchParams.set('speedType', req.query.speedType);
  }
  if (req.query.dutyCycle) {
    searchParams.set('dutyCycle', req.query.dutyCycle);
  }
  if (req.query.sortBy) {
    searchParams.set('sortBy', req.query.sortBy);
  }
  if (req.query.sortOrder) {
    searchParams.set('sortOrder', req.query.sortOrder);
  }
  const queryString = searchParams.toString();

  // Use manufacturer index for O(1) lookup instead of full scan
  const sameManufacturerProducts = cache.indexes.byManufacturer.get(product.manufacturer) || [];
  const similarProducts = sameManufacturerProducts
    .filter(item => item.id !== id)
    .slice(0, 5);

  res.render('product', {
    product,
    prevProduct,
    nextProduct,
    currentIndex: currentIndex >= 0 ? currentIndex + 1 : 1,
    totalProducts: filteredData.length,
    similarProducts,
    searchContext: queryString,
    hasSearchContext: queryString.length > 0,
    title: `${product.manufacturer} - ${product.model}`
  });
});

app.get('/compare', (req, res) => {
  loadData(); // Ensure data and indexes are loaded
  const ids = req.query.ids ? req.query.ids.split(',') : [];

  // Use O(1) ID index instead of O(n) find for each product
  const products = ids.map(id => cache.indexes.byId.get(id)).filter(Boolean);

  res.render('compare', {
    products,
    title: 'Compare Chainhoists'
  });
});

app.get('/stats', (req, res) => {
  const data = loadData();
  const report = loadReport();

  const capacityStats = {};
  const powerStats = {};
  const speedStats = {};

  data.forEach(item => {
    if (item.loadCapacity) {
      const matches = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value <= 250 ? '≤250 kg' :
          value <= 500 ? '251-500 kg' :
            value <= 1000 ? '501-1000 kg' :
              value <= 2000 ? '1001-2000 kg' : '>2000 kg';
        capacityStats[category] = (capacityStats[category] || 0) + 1;
      }
    }

    if (item.motorPower) {
      const matches = item.motorPower.match(/(\d+(?:\.\d+)?)\s*kW/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value < 0.5 ? '<0.5 kW' :
          value < 1 ? '0.5-1 kW' :
            value < 2 ? '1-2 kW' : '>2 kW';
        powerStats[category] = (powerStats[category] || 0) + 1;
      }
    }

    if (item.liftingSpeed) {
      const matches = item.liftingSpeed.match(/(\d+(?:\.\d+)?)\s*m\/min/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value < 2 ? '<2 m/min' :
          value < 4 ? '2-4 m/min' :
            value < 8 ? '4-8 m/min' : '>8 m/min';
        speedStats[category] = (speedStats[category] || 0) + 1;
      }
    }
  });

  res.render('stats', {
    report,
    capacityStats,
    powerStats,
    speedStats,
    title: 'Database Statistics'
  });
});

// GET /downloads - Downloads page for PDFs and documents
app.get('/downloads', (req, res) => {
  const data = loadData();
  const mediaDir = path.join(__dirname, 'chainhoist_data', 'media', 'pdfs');

  // Get list of PDF files
  let pdfFiles = [];
  try {
    const files = fs.readdirSync(mediaDir);
    pdfFiles = files
      .filter(f => f.endsWith('.pdf'))
      .map(f => {
        const parts = f.replace('.pdf', '').split('_');
        const manufacturer = parts[0] || 'Unknown';
        const product = parts[1] || 'Document';
        const type = parts[2] || 'document';
        return {
          filename: f,
          manufacturer: manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1).replace(/-/g, ' '),
          product: product.replace(/-/g, ' '),
          type: type,
          url: `/media/pdfs/${f}`,
          size: fs.statSync(path.join(mediaDir, f)).size
        };
      });
  } catch (err) {
    console.error('Error reading PDFs directory:', err);
  }

  // Group by manufacturer
  const pdfsByManufacturer = {};
  pdfFiles.forEach(pdf => {
    if (!pdfsByManufacturer[pdf.manufacturer]) {
      pdfsByManufacturer[pdf.manufacturer] = [];
    }
    pdfsByManufacturer[pdf.manufacturer].push(pdf);
  });

  // Count products with PDFs in database
  const productsWithPdfs = data.filter(p => p.pdfs && p.pdfs.length > 0).length;

  res.render('downloads', {
    title: 'Downloads',
    pdfsByManufacturer,
    totalPdfs: pdfFiles.length,
    productsWithPdfs,
    manufacturers: Object.keys(pdfsByManufacturer).sort()
  });
});

// Redirect /personality to main search (databases are now merged)
app.get('/personality', (req, res) => {
  res.redirect('/search?source=personality');
});

// Legacy personality data web route (kept for backwards compatibility)
app.get('/personality-legacy', (req, res) => {
  const data = loadPersonalityData();
  let products = [...data.products];

  // Apply filters
  if (req.query.manufacturer) {
    products = products.filter(item =>
      item.manufacturer === req.query.manufacturer
    );
  }

  if (req.query.category) {
    products = products.filter(item =>
      item.category === req.query.category
    );
  }

  if (req.query.speedType) {
    products = products.filter(item =>
      item.speedType === req.query.speedType
    );
  }

  if (req.query.q) {
    const query = req.query.q.toLowerCase();
    products = products.filter(item =>
      item.name?.toLowerCase().includes(query) ||
      item.manufacturer?.toLowerCase().includes(query) ||
      item.searchTerms?.model?.toLowerCase().includes(query)
    );
  }

  // Get unique values for filters
  const manufacturers = [...new Set(data.products.map(p => p.manufacturer))].sort();
  const categories = Object.keys(data.categories || {});
  const speedTypes = Object.keys(data.speedTypes || {});

  res.render('personality', {
    products,
    allProducts: data.products,
    summary: {
      totalProducts: data.totalProducts,
      manufacturers: data.manufacturers,
      categories: data.categories,
      speedTypes: data.speedTypes,
      entertainmentProducts: data.entertainmentProducts
    },
    manufacturerList: manufacturers,
    categoryList: categories,
    speedTypeList: speedTypes,
    filters: req.query,
    title: 'Personality Database'
  });
});

// Personality product detail route
app.get('/personality/:manufacturerId/:productId', (req, res) => {
  const data = loadPersonalityData();
  const product = data.products.find(item =>
    item.manufacturerId === req.params.manufacturerId &&
    item.productId === req.params.productId
  );

  if (!product) {
    return res.status(404).render('error', {
      message: 'Product not found',
      title: 'Error'
    });
  }

  // Find similar products
  const similarProducts = data.products.filter(item =>
    item.manufacturer === product.manufacturer &&
    item.manufacturerId !== product.manufacturerId
  ).slice(0, 5);

  res.render('personality-detail', {
    product,
    similarProducts,
    title: `${product.manufacturer} - ${product.name}`
  });
});

// Export the app for testing
module.exports = app;
