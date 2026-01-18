// Electric Chainhoist Data Processor
// This script cleans, normalizes, and enriches the scraped chainhoist data

const fs = require('fs/promises');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Configuration
const CONFIG = {
  inputDir: 'chainhoist_data',
  inputFile: 'chainhoist_database.json',
  outputDir: 'chainhoist_data_processed',
  processedFile: 'chainhoist_database_processed.json',
  csvOutputFile: 'chainhoist_database_processed.csv',
  reportFile: 'data_quality_report.json',
  missingDataThreshold: 0.4, // Threshold for reporting missing data
  localImagesDir: 'chainhoist_data/media/images',
  localImagesUrlPrefix: '/media/images/',
};

// Mapping from local image filename slugs to database manufacturer names
const MANUFACTURER_SLUG_MAP = {
  'abus-kransysteme': 'ABUS Kransysteme',
  'budgit': 'Budgit Hoists',
  'chainmaster': 'Chainmaster',
  'coffing': 'Coffing Hoists',
  'demag': 'Demag',
  'donati': 'Donati Sollevamenti',
  'elephant': 'Elephant Lifting Products',
  'gorbel': 'Gorbel',
  'hitachi': 'Hitachi',
  'jdn': 'J.D. Neuhaus',
  'kito': 'Kito',
  'liftingsafety': 'LiftingSafety',
  'planeta': 'PLANETA-Hebetechnik',
  'rm-materials': 'R&M Materials Handling',
  'stahl': 'Stahl CraneSystems',
  'street-crane': 'Street Crane',
  'swf': 'SWF Krantechnik',
  'swf-krantechnik': 'SWF Krantechnik',
  'tiger': 'Tiger Lifting',
  'tiger-lifting': 'Tiger Lifting',
  'txk': 'TXK',
  'yale': 'Yale Hoists',
};

// Define unit conversion factors
const UNIT_CONVERSIONS = {
  weight: {
    kgToLbs: 2.20462,
    lbsToKg: 0.453592,
  },
  capacity: {
    kgToLbs: 2.20462,
    lbsToKg: 0.453592,
    tonToKg: 1000,
    tonToLbs: 2000,
    metricTonToKg: 1000,
    shortTonToLbs: 2000,
  },
  speed: {
    mPerMinToFtPerMin: 3.28084,
    ftPerMinToMPerMin: 0.3048,
  },
  power: {
    kWToHP: 1.34102,
    hpToKW: 0.745699,
  },
};

// Classification standards and their aliases
const CLASSIFICATION_ALIASES = {
  'd8': ['d8', 'bgv-d8', 'bgvd8', 'd8standard'],
  'd8+': ['d8+', 'd8plus', 'bgv-d8+', 'bgvd8+', 'bgv-d8plus'],
  'bgv-c1': ['bgv-c1', 'bgvc1', 'c1'],
  'ansi': ['ansi', 'asme'],
};

// Data Processor Class
class ChainhoistDataProcessor {
  constructor() {
    this.data = [];
    this.processedData = [];
    this.localImagesByManufacturer = {}; // Map of manufacturer -> [{ filename, url, pageSlug }]
    this.report = {
      totalRecords: 0,
      processedRecords: 0,
      skippedRecords: 0,
      missingDataFields: {},
      manufacturerStats: {},
      capacityDistribution: {},
      classificationDistribution: {},
      processingErrors: [],
      localImagesFound: 0,
      localImagesMapped: 0,
    };
  }

  async initialize() {
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(CONFIG.outputDir, { recursive: true });

      // Load the database
      const dbFile = path.join(CONFIG.inputDir, CONFIG.inputFile);
      const dbContent = await fs.readFile(dbFile, 'utf8');
      const parsed = JSON.parse(dbContent);

      // Handle both old and new database formats
      if (Array.isArray(parsed)) {
        this.data = parsed;
      } else if (parsed.data && Array.isArray(parsed.data)) {
        this.data = parsed.data;
      } else {
        throw new Error('Invalid database format - no data array found');
      }

      this.report.totalRecords = this.data.length;

      console.log(`Loaded ${this.data.length} records for processing`);

      // Scan local images
      await this.scanLocalImages();
    } catch (err) {
      console.error('Failed to initialize data processor:', err);
      throw err;
    }
  }

  // Scan local images directory and create mapping
  async scanLocalImages() {
    try {
      const { readdirSync } = require('fs');
      const imagesDir = path.join(__dirname, CONFIG.localImagesDir);

      let files;
      try {
        files = readdirSync(imagesDir);
      } catch (err) {
        console.log('No local images directory found, skipping local image mapping');
        return;
      }

      // Filter for image files
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
      const imageFiles = files.filter(f =>
        imageExtensions.some(ext => f.toLowerCase().endsWith(ext))
      );

      this.report.localImagesFound = imageFiles.length;
      console.log(`Found ${imageFiles.length} local image files`);

      // Parse filenames and group by manufacturer
      // Filename format: manufacturer-slug_page-slug_index.ext
      for (const filename of imageFiles) {
        const match = filename.match(/^([^_]+)_([^_]+)_(\d+)\.(\w+)$/);
        if (!match) {
          continue;
        }

        const [, manufacturerSlug, pageSlug, index] = match;
        const manufacturer = MANUFACTURER_SLUG_MAP[manufacturerSlug];

        if (!manufacturer) {
          continue;
        }

        if (!this.localImagesByManufacturer[manufacturer]) {
          this.localImagesByManufacturer[manufacturer] = [];
        }

        this.localImagesByManufacturer[manufacturer].push({
          filename,
          url: CONFIG.localImagesUrlPrefix + filename,
          pageSlug,
          index: parseInt(index, 10),
        });
      }

      // Sort images by page slug and index
      for (const manufacturer of Object.keys(this.localImagesByManufacturer)) {
        this.localImagesByManufacturer[manufacturer].sort((a, b) => {
          if (a.pageSlug !== b.pageSlug) {
            return a.pageSlug.localeCompare(b.pageSlug);
          }
          return a.index - b.index;
        });
      }

      const mappedManufacturers = Object.keys(this.localImagesByManufacturer).length;
      console.log(`Mapped local images to ${mappedManufacturers} manufacturers`);
    } catch (err) {
      console.error('Error scanning local images:', err);
    }
  }

  // Process all records
  async processAll() {
    console.log('Starting data processing...');

    for (const record of this.data) {
      try {
        const processed = this.processRecord(record);
        if (processed) {
          this.processedData.push(processed);
          this.report.processedRecords++;

          // Update manufacturer stats
          const mfr = processed.manufacturer;
          if (!this.report.manufacturerStats[mfr]) {
            this.report.manufacturerStats[mfr] = 1;
          } else {
            this.report.manufacturerStats[mfr]++;
          }

          // Update capacity distribution
          const cap = this.getCapacityCategory(processed.loadCapacity);
          if (cap) {
            if (!this.report.capacityDistribution[cap]) {
              this.report.capacityDistribution[cap] = 1;
            } else {
              this.report.capacityDistribution[cap]++;
            }
          }

          // Update classification distribution
          if (processed.classification && Array.isArray(processed.classification)) {
            for (const cls of processed.classification) {
              if (!this.report.classificationDistribution[cls]) {
                this.report.classificationDistribution[cls] = 1;
              } else {
                this.report.classificationDistribution[cls]++;
              }
            }
          }
        } else {
          this.report.skippedRecords++;
        }
      } catch (error) {
        console.error(`Error processing record ${record.id || 'unknown'}:`, error.message);
        this.report.processingErrors.push({
          id: record.id || 'unknown',
          error: error.message,
        });
        this.report.skippedRecords++;
      }
    }

    // Calculate missing data statistics
    this.calculateMissingDataStats();

    // Run quality gates check
    const gateResults = this.checkQualityGates();
    this.report.qualityGates = gateResults;

    console.log(`Processed ${this.report.processedRecords} records successfully`);
    console.log(`Skipped ${this.report.skippedRecords} records due to errors or insufficient data`);
    console.log(`Mapped ${this.report.localImagesMapped} local images to products`);

    // Report quality gate status
    console.log('\n--- Quality Gates ---');
    gateResults.gates.forEach(gate => {
      const status = gate.passed ? '✓' : '✗';
      console.log(`  ${status} ${gate.name}: ${gate.actual} (threshold: ${gate.threshold})`);
    });
    console.log(`\n${gateResults.summary}`);

    // If quality gates fail, issue warning but continue (degraded operation)
    if (!gateResults.passed) {
      console.warn('\n⚠️  WARNING: Quality gates failed. Data quality is below acceptable thresholds.');
      console.warn('   Review the data and consider enrichment before production use.\n');
    }
  }

  // Check quality gates for processed data
  checkQualityGates() {
    const total = this.processedData.length;
    const results = {
      passed: true,
      failedGates: [],
      passedGates: [],
      gates: [],
      summary: '',
    };

    // Define quality thresholds
    const thresholds = {
      minRecords: 10,
      maxMissingCapacity: 80,      // Max 80% missing
      maxMissingSpeed: 85,         // Max 85% missing
      maxMissingPower: 95,         // Max 95% missing
      maxMissingClassification: 50, // Max 50% missing
      minSourceTracking: 90,       // At least 90% must have source
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
      `≥${thresholds.minRecords}`,
      total,
      total >= thresholds.minRecords,
      `Database has ${total} records`
    );

    // Count missing fields
    const missingCounts = {
      loadCapacity: 0,
      liftingSpeed: 0,
      motorPower: 0,
      classification: 0,
      source: 0,
    };

    this.processedData.forEach(item => {
      if (!this.hasValidValue(item.loadCapacity)) {
        missingCounts.loadCapacity++;
      }
      if (!this.hasValidValue(item.liftingSpeed)) {
        missingCounts.liftingSpeed++;
      }
      if (!this.hasValidValue(item.motorPower)) {
        missingCounts.motorPower++;
      }
      if (!item.classification || item.classification.length === 0) {
        missingCounts.classification++;
      }
      if (!item.source || item.source === 'unknown') {
        missingCounts.source++;
      }
    });

    // Gate 2-5: Missing critical fields
    const fieldGates = [
      { field: 'loadCapacity', name: 'Load Capacity', max: thresholds.maxMissingCapacity },
      { field: 'liftingSpeed', name: 'Lifting Speed', max: thresholds.maxMissingSpeed },
      { field: 'motorPower', name: 'Motor Power', max: thresholds.maxMissingPower },
      { field: 'classification', name: 'Classification', max: thresholds.maxMissingClassification },
    ];

    fieldGates.forEach(({ field, name, max }) => {
      const missingPercent = (missingCounts[field] / total) * 100;
      addGate(
        `Missing ${name}`,
        `≤${max}%`,
        `${missingPercent.toFixed(1)}%`,
        missingPercent <= max,
        `${missingCounts[field]} of ${total} records missing ${field}`
      );
    });

    // Gate 6: Source tracking
    const sourcePercent = ((total - missingCounts.source) / total) * 100;
    addGate(
      'Source Tracking',
      `≥${thresholds.minSourceTracking}%`,
      `${sourcePercent.toFixed(1)}%`,
      sourcePercent >= thresholds.minSourceTracking,
      `${total - missingCounts.source} of ${total} records have source tracking`
    );

    // Generate summary
    if (results.passed) {
      results.summary = `✓ PASSED: All ${results.gates.length} quality gates passed`;
    } else {
      results.summary = `✗ FAILED: ${results.failedGates.length} of ${results.gates.length} gates failed`;
    }

    return results;
  }

  // Process a single record
  processRecord(record) {
    // Skip if missing critical data
    if (!record.model || !record.manufacturer) {
      return null;
    }

    const processed = { ...record };

    // Clean and normalize fields
    processed.manufacturer = this.cleanManufacturerName(processed.manufacturer);
    processed.model = this.cleanModelName(processed.model);

    // Process load capacity
    processed.loadCapacity = this.processLoadCapacity(processed.loadCapacity);

    // Process lifting speed
    processed.liftingSpeed = this.processLiftingSpeed(processed.liftingSpeed);

    // Process motor power
    processed.motorPower = this.processMotorPower(processed.motorPower);

    // Normalize classification
    processed.classification = this.normalizeClassification(processed.classification);

    // Convert boolean fields
    processed.quietOperation = this.processBoolean(processed.quietOperation);
    processed.dynamicLifting = this.processBoolean(processed.dynamicLifting);
    processed.liftingOverPeople = this.processBoolean(processed.liftingOverPeople);

    // Make sure arrays are arrays
    if (!Array.isArray(processed.voltageOptions) && processed.voltageOptions) {
      processed.voltageOptions = [processed.voltageOptions];
    }
    if (!Array.isArray(processed.bodyColor) && processed.bodyColor) {
      processed.bodyColor = [processed.bodyColor];
    }
    if (!Array.isArray(processed.commonApplications) && processed.commonApplications) {
      processed.commonApplications = [processed.commonApplications];
    }
    if (!Array.isArray(processed.additionalSafety) && processed.additionalSafety) {
      processed.additionalSafety = [processed.additionalSafety];
    }

    // Ensure objects are objects
    if (typeof processed.controlCompatibility !== 'object' || processed.controlCompatibility === null) {
      processed.controlCompatibility = {};
    }
    if (typeof processed.positionFeedback !== 'object' || processed.positionFeedback === null) {
      processed.positionFeedback = {};
    }
    if (typeof processed.certifications !== 'object' || processed.certifications === null) {
      processed.certifications = {};
    }

    // Standardize common fields based on manufacturer patterns
    this.applyManufacturerSpecificProcessing(processed);

    // Add computed fields
    processed.capacityKg = this.extractCapacityKg(processed.loadCapacity);
    processed.speedMMin = this.extractSpeedMMin(processed.liftingSpeed);
    processed.dataCompleteness = this.calculateDataCompleteness(processed);
    processed.hasCompleteSpecs = this.checkCompleteSpecs(processed);

    // Add additional metadata
    processed.processedDate = new Date();

    // Ensure source tracking fields are populated
    this.ensureSourceTracking(processed, record);

    // Map local images to product
    this.mapLocalImages(processed);

    return processed;
  }

  // Ensure all records have proper source tracking
  ensureSourceTracking(processed, original) {
    // Set source if not already present
    if (!processed.source) {
      if (original._manuallyCreated) {
        processed.source = 'manual';
      } else if (original.llmEnriched) {
        processed.source = 'llm_enriched';
      } else if (original.scrapedFrom || original.sourceUrl || original.url) {
        processed.source = 'scraped';
      } else {
        processed.source = 'unknown';
      }
    }

    // Ensure sourceUrl is set
    if (!processed.sourceUrl) {
      processed.sourceUrl = original.scrapedFrom || original.url || null;
    }

    // Set processedAt timestamp
    processed.processedAt = new Date().toISOString();

    // Calculate and set data quality tier
    const completeness = processed.dataCompleteness || 0;
    if (completeness >= 80) {
      processed.dataQualityTier = 'complete';
    } else if (completeness >= 60) {
      processed.dataQualityTier = 'partial';
    } else if (completeness >= 30) {
      processed.dataQualityTier = 'incomplete';
    } else {
      processed.dataQualityTier = 'minimal';
    }

    // Track which fields have data
    const criticalFields = ['loadCapacity', 'liftingSpeed', 'motorPower', 'classification'];
    processed.populatedFields = criticalFields.filter(f => this.hasValidValue(processed[f]));
    processed.missingFields = criticalFields.filter(f => !this.hasValidValue(processed[f]));
  }

  // Map local images to a product
  mapLocalImages(record) {
    const manufacturer = record.manufacturer;
    const manufacturerImages = this.localImagesByManufacturer[manufacturer];

    if (!manufacturerImages || manufacturerImages.length === 0) {
      return;
    }

    // Create slug from model name for matching
    const modelSlug = this.createSlug(record.model);
    const idSlug = record.id ? record.id.replace(/^[^-]+-/, '') : '';

    // Find matching images based on page slug similarity
    const matchingImages = manufacturerImages.filter(img => {
      const pageSlug = img.pageSlug.toLowerCase();
      const modelLower = modelSlug.toLowerCase();
      const idLower = idSlug.toLowerCase();

      // Check if page slug matches model slug or contains key parts
      if (pageSlug === modelLower) {
        return true;
      }
      if (pageSlug.includes(modelLower) || modelLower.includes(pageSlug)) {
        return true;
      }
      if (idLower && (pageSlug.includes(idLower) || idLower.includes(pageSlug))) {
        return true;
      }

      // Check for partial matches (e.g., "dc-pro" matches "DC Pro")
      const pageParts = pageSlug.split('-').filter(p => p.length > 2);
      const modelParts = modelLower.split('-').filter(p => p.length > 2);
      const commonParts = pageParts.filter(p => modelParts.some(m => m.includes(p) || p.includes(m)));
      return commonParts.length >= 2;
    });

    if (matchingImages.length > 0) {
      // Initialize images array if needed
      if (!record.images || !Array.isArray(record.images)) {
        record.images = [];
      }

      // Add local images (avoid duplicates)
      const existingUrls = new Set(record.images.map(img => img.url));
      for (const img of matchingImages) {
        if (!existingUrls.has(img.url)) {
          record.images.push({
            url: img.url,
            alt: `${record.manufacturer} ${record.model}`,
            localPath: img.filename,
          });
          this.report.localImagesMapped++;
        }
      }
    } else {
      // Fallback: assign some manufacturer images if no specific match
      // but only if product has no images at all
      if (!record.images || record.images.length === 0) {
        // Get unique page slugs for this manufacturer
        const uniquePageImages = [];
        const seenSlugs = new Set();
        for (const img of manufacturerImages) {
          if (!seenSlugs.has(img.pageSlug) && img.index === 0) {
            seenSlugs.add(img.pageSlug);
            uniquePageImages.push(img);
            if (uniquePageImages.length >= 3) {
              break;
            }
          }
        }

        if (uniquePageImages.length > 0) {
          record.images = uniquePageImages.map(img => ({
            url: img.url,
            alt: `${record.manufacturer} ${record.model}`,
            localPath: img.filename,
          }));
          this.report.localImagesMapped += uniquePageImages.length;
        }
      }
    }
  }

  // Create URL-friendly slug from text
  createSlug(text) {
    if (!text) {
      return '';
    }
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Extract numeric capacity in kg
  extractCapacityKg(capacity) {
    if (!capacity) {
      return null;
    }

    const str = String(capacity).toLowerCase();

    // Try to match kg value
    const kgMatch = str.match(/(\d+(?:\.\d+)?)\s*kg/i);
    if (kgMatch) {
      return parseFloat(kgMatch[1]);
    }

    // Try to match lbs and convert
    const lbsMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/i);
    if (lbsMatch) {
      return Math.round(parseFloat(lbsMatch[1]) * UNIT_CONVERSIONS.capacity.lbsToKg);
    }

    // Try to match tons
    const tonMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:tons?|tonnes?|t\b)/i);
    if (tonMatch) {
      return parseFloat(tonMatch[1]) * UNIT_CONVERSIONS.capacity.tonToKg;
    }

    return null;
  }

  // Extract numeric speed in m/min
  extractSpeedMMin(speed) {
    if (!speed) {
      return null;
    }

    const str = String(speed).toLowerCase();

    // Try to match m/min value (may be a range like "0.5-8")
    const mMinMatch = str.match(/(\d+(?:\.\d+)?)\s*m\/min/i);
    if (mMinMatch) {
      return parseFloat(mMinMatch[1]);
    }

    // Try to match ft/min and convert
    const ftMinMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:ft\/min|fpm)/i);
    if (ftMinMatch) {
      return Math.round(parseFloat(ftMinMatch[1]) * UNIT_CONVERSIONS.speed.ftPerMinToMPerMin * 10) / 10;
    }

    // Try to match m/s and convert
    const msMatch = str.match(/(\d+(?:\.\d+)?)\s*m\/s/i);
    if (msMatch) {
      return parseFloat(msMatch[1]) * 60;
    }

    return null;
  }

  // Calculate data completeness score (0-100)
  calculateDataCompleteness(record) {
    const criticalFields = ['loadCapacity', 'liftingSpeed', 'motorPower', 'classification', 'dutyCycle'];
    const secondaryFields = ['voltageOptions', 'weight', 'protectionClass', 'series'];

    let criticalScore = 0;
    let secondaryScore = 0;

    // Check critical fields (weighted 70%)
    for (const field of criticalFields) {
      if (this.hasValidValue(record[field])) {
        criticalScore++;
      }
    }

    // Check secondary fields (weighted 30%)
    for (const field of secondaryFields) {
      if (this.hasValidValue(record[field])) {
        secondaryScore++;
      }
    }

    // Calculate weighted score
    const criticalPct = criticalScore / criticalFields.length;
    const secondaryPct = secondaryScore / secondaryFields.length;

    return Math.round((criticalPct * 70) + (secondaryPct * 30));
  }

  // Check if a field has a valid (non-empty) value
  hasValidValue(value) {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === 'string' && (!value || value.trim() === '' || value === '-')) {
      return false;
    }
    if (Array.isArray(value) && value.length === 0) {
      return false;
    }
    return true;
  }

  // Check if product has all critical specs
  checkCompleteSpecs(record) {
    const requiredFields = ['loadCapacity', 'liftingSpeed', 'motorPower'];
    return requiredFields.every(field => this.hasValidValue(record[field]));
  }

  // Clean manufacturer name
  cleanManufacturerName(name) {
    if (!name) {
      return '';
    }

    // Standardize manufacturer names
    const nameMap = {
      'Columbus McKinnon (CM)': 'Columbus McKinnon',
      'CM': 'Columbus McKinnon',
      'CM Lodestar': 'Columbus McKinnon',
      'CM Works': 'Columbus McKinnon',
      'Chainmaster GmbH': 'Chainmaster',
      'Verlinde (Stagemaker)': 'Verlinde',
      'Stagemaker': 'Verlinde',
      'Movecat GmbH': 'Movecat',
      'GIS AG Switzerland': 'GIS AG',
    };

    return nameMap[name] || name;
  }

  // Clean model name
  cleanModelName(name) {
    if (!name) {
      return '';
    }

    // Remove common prefixes/suffixes (handle plural forms to avoid leaving trailing 's')
    name = name.replace(/electric chain hoists?/gi, '')
      .replace(/chain hoists?/gi, '')
      .replace(/hoists?/gi, '')
      .replace(/series/gi, '')
      .trim();

    return name;
  }

  // Process load capacity
  processLoadCapacity(capacity) {
    if (!capacity) {
      return '';
    }

    // Convert to string if not already
    capacity = String(capacity);

    // Extract numeric value and unit
    const matches = capacity.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/i);
    if (!matches) {
      return capacity;
    }

    const value = parseFloat(matches[1]);
    const unit = matches[2].toLowerCase();

    // Normalize to standard format
    if (unit.includes('kg')) {
      return `${value} kg (${Math.round(value * UNIT_CONVERSIONS.capacity.kgToLbs)} lbs)`;
    } else if (unit.includes('lb') || unit.includes('lbs')) {
      return `${Math.round(value * UNIT_CONVERSIONS.capacity.lbsToKg)} kg (${value} lbs)`;
    } else if (unit.includes('ton') && !unit.includes('metric')) {
      return `${value * UNIT_CONVERSIONS.capacity.tonToKg} kg (${value * UNIT_CONVERSIONS.capacity.tonToLbs} lbs)`;
    }

    return capacity;
  }

  // Process lifting speed
  processLiftingSpeed(speed) {
    if (!speed) {
      return '';
    }

    // Convert to string if not already
    speed = String(speed);

    // Extract numeric value and unit
    const matches = speed.match(/(\d+(?:\.\d+)?)\s*([a-z/]+)/i);
    if (!matches) {
      return speed;
    }

    const value = parseFloat(matches[1]);
    const unit = matches[2].toLowerCase();

    // Normalize to standard format
    if (unit.includes('m/min') || unit.includes('m/min')) {
      return `${value} m/min (${Math.round(value * UNIT_CONVERSIONS.speed.mPerMinToFtPerMin)} ft/min)`;
    } else if (unit.includes('ft/min') || unit.includes('fpm')) {
      return `${(value * UNIT_CONVERSIONS.speed.ftPerMinToMPerMin).toFixed(1)} m/min (${value} ft/min)`;
    }

    return speed;
  }

  // Process motor power
  processMotorPower(power) {
    if (!power) {
      return '';
    }

    // Convert to string if not already
    power = String(power);

    // Extract numeric value and unit
    const matches = power.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/i);
    if (!matches) {
      return power;
    }

    const value = parseFloat(matches[1]);
    const unit = matches[2].toLowerCase();

    // Normalize to standard format
    if (unit.includes('kw')) {
      return `${value} kW (${(value * UNIT_CONVERSIONS.power.kWToHP).toFixed(1)} HP)`;
    } else if (unit.includes('hp')) {
      return `${(value * UNIT_CONVERSIONS.power.hpToKW).toFixed(2)} kW (${value} HP)`;
    }

    return power;
  }

  // Normalize classification
  normalizeClassification(classification) {
    if (!classification) {
      return [];
    }

    // If string, convert to array
    if (typeof classification === 'string') {
      classification = classification.split(/[,;/]/);
    } else if (!Array.isArray(classification)) {
      return [];
    }

    // Normalize each classification
    const normalized = [];
    for (let cls of classification) {
      if (!cls) {
        continue;
      }

      cls = cls.toString().trim().toLowerCase();

      // Match to standard classifications
      let found = false;
      for (const [standard, aliases] of Object.entries(CLASSIFICATION_ALIASES)) {
        if (aliases.includes(cls)) {
          normalized.push(standard);
          found = true;
          break;
        }
      }

      if (!found) {
        normalized.push(cls);
      }
    }

    // Remove duplicates
    return [...new Set(normalized)];
  }

  // Process boolean values
  processBoolean(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      value = value.toLowerCase().trim();
      return value === 'yes' || value === 'true' || value === 'y' || value === '1';
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    return false;
  }

  // Apply manufacturer-specific processing
  applyManufacturerSpecificProcessing(record) {
    const manufacturer = record.manufacturer;

    if (manufacturer === 'Columbus McKinnon') {
      // CM-specific processing
      if (record.model.includes('Lodestar')) {
        record.series = 'Lodestar';

        // Lodestar is typically D8 unless specified otherwise
        if (!record.classification || record.classification.length === 0) {
          record.classification = ['d8'];
        }
      }
    } else if (manufacturer === 'Chainmaster') {
      // Chainmaster-specific processing
      if (record.model.includes('D8+')) {
        if (!record.classification || record.classification.length === 0) {
          record.classification = ['d8+'];
        }
      } else if (record.model.includes('D8')) {
        if (!record.classification || record.classification.length === 0) {
          record.classification = ['d8'];
        }
      }
    } else if (manufacturer === 'Verlinde') {
      // Verlinde-specific processing
      if (record.model.includes('SR')) {
        record.series = 'Stagemaker SR';
      } else if (record.model.includes('SL')) {
        record.series = 'Stagemaker SL';
      }
    }

    return record;
  }

  // Get capacity category for reporting
  getCapacityCategory(capacity) {
    if (!capacity) {
      return null;
    }

    // Try to extract numeric value
    const matches = capacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
    if (!matches) {
      return null;
    }

    const value = parseFloat(matches[1]);

    // Categorize based on capacity
    if (value <= 250) {
      return '≤250 kg';
    }
    if (value <= 500) {
      return '251-500 kg';
    }
    if (value <= 1000) {
      return '501-1000 kg';
    }
    if (value <= 2000) {
      return '1001-2000 kg';
    }
    return '>2000 kg';
  }

  // Calculate missing data statistics
  calculateMissingDataStats() {
    // Count missing fields
    const fieldCounts = {};
    const totalRecords = this.processedData.length;

    for (const record of this.processedData) {
      for (const field of Object.keys(record)) {
        if (record[field] === null || record[field] === undefined || record[field] === '') {
          if (!fieldCounts[field]) {
            fieldCounts[field] = 1;
          } else {
            fieldCounts[field]++;
          }
        }
      }
    }

    // Calculate percentages and report fields above threshold
    for (const [field, count] of Object.entries(fieldCounts)) {
      const percentage = count / totalRecords;
      if (percentage >= CONFIG.missingDataThreshold) {
        this.report.missingDataFields[field] = {
          count,
          percentage: (percentage * 100).toFixed(1) + '%',
        };
      }
    }
  }

  // Deduplicate records based on manufacturer + model combination
  deduplicateRecords() {
    console.log('Starting deduplication...');
    const beforeCount = this.processedData.length;

    // Create a map to group records by manufacturer + normalized model
    const recordMap = new Map();

    for (const record of this.processedData) {
      // Create a normalized key
      const key = this.createDedupeKey(record);

      if (recordMap.has(key)) {
        // Merge with existing record
        const existing = recordMap.get(key);
        recordMap.set(key, this.mergeRecords(existing, record));
      } else {
        recordMap.set(key, record);
      }
    }

    // Convert map back to array
    this.processedData = Array.from(recordMap.values());

    const afterCount = this.processedData.length;
    const duplicatesRemoved = beforeCount - afterCount;

    console.log(`Deduplication complete: ${beforeCount} -> ${afterCount} records (${duplicatesRemoved} duplicates merged)`);

    // Update report
    this.report.deduplication = {
      beforeCount,
      afterCount,
      duplicatesRemoved,
    };

    // Recalculate manufacturer stats
    this.report.manufacturerStats = {};
    for (const record of this.processedData) {
      const mfr = record.manufacturer;
      if (!this.report.manufacturerStats[mfr]) {
        this.report.manufacturerStats[mfr] = 1;
      } else {
        this.report.manufacturerStats[mfr]++;
      }
    }

    this.report.processedRecords = afterCount;
  }

  // Create a deduplication key from a record
  createDedupeKey(record) {
    const manufacturer = (record.manufacturer || '').toLowerCase().trim();

    // Normalize model name - remove common variations
    let model = (record.model || '').toLowerCase().trim();

    // Remove series prefix if it matches manufacturer name
    const mfrWords = manufacturer.split(/s+/);
    for (const word of mfrWords) {
      if (model.startsWith(word)) {
        model = model.substring(word.length).trim();
      }
    }

    // Remove common suffixes/variations
    model = model
      .replace(/s*-s*/g, '-')           // Normalize dashes
      .replace(/s+/g, ' ')               // Normalize spaces
      .replace(/electric chain hoist/gi, '')  // Remove generic terms
      .replace(/chain hoist/gi, '')
      .replace(/hoist/gi, '')
      .replace(/series/gi, '')
      .replace(/model/gi, '')
      .trim();

    return `${manufacturer}:${model}`;
  }

  // Merge two duplicate records, keeping the most complete data
  mergeRecords(existing, newRecord) {
    const merged = { ...existing };

    // For each field in the new record, keep the more complete/informative value
    for (const [key, value] of Object.entries(newRecord)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }

      const existingValue = merged[key];

      // Skip metadata fields - prefer existing
      if (['id', 'url', 'lastUpdated', 'createdAt', 'scrapedAt'].includes(key)) {
        continue;
      }

      // For arrays, merge and dedupe
      if (Array.isArray(value)) {
        if (Array.isArray(existingValue)) {
          merged[key] = [...new Set([...existingValue, ...value])];
        } else {
          merged[key] = value;
        }
        continue;
      }

      // For strings, keep the longer/more informative one
      if (typeof value === 'string') {
        if (!existingValue || value.length > existingValue.length) {
          merged[key] = value;
        }
        continue;
      }

      // For other types, prefer new value if existing is empty
      if (existingValue === null || existingValue === undefined) {
        merged[key] = value;
      }
    }

    return merged;
  }

  // Save processed data
  async save() {
    try {
      // Save processed data
      const processedFile = path.join(CONFIG.outputDir, CONFIG.processedFile);
      await fs.writeFile(processedFile, JSON.stringify(this.processedData, null, 2));
      console.log(`Saved ${this.processedData.length} processed records to ${processedFile}`);

      // Save report
      const reportFile = path.join(CONFIG.outputDir, CONFIG.reportFile);
      await fs.writeFile(reportFile, JSON.stringify(this.report, null, 2));
      console.log(`Saved data quality report to ${reportFile}`);

      // Export to CSV
      await this.exportToCsv();
    } catch (err) {
      console.error('Failed to save processed data:', err);
      throw err;
    }
  }

  // Export to CSV
  async exportToCsv() {
    try {
      // Flatten nested objects for CSV export
      const flattenedData = this.processedData.map(item => {
        const flat = { ...item };

        // Handle arrays
        if (Array.isArray(flat.voltageOptions)) {
          flat.voltageOptions = flat.voltageOptions.join(', ');
        }
        if (Array.isArray(flat.classification)) {
          flat.classification = flat.classification.join(', ');
        }
        if (Array.isArray(flat.bodyColor)) {
          flat.bodyColor = flat.bodyColor.join(', ');
        }
        if (Array.isArray(flat.commonApplications)) {
          flat.commonApplications = flat.commonApplications.join(', ');
        }
        if (Array.isArray(flat.additionalSafety)) {
          flat.additionalSafety = flat.additionalSafety.join(', ');
        }
        if (Array.isArray(flat.images)) {
          flat.images = flat.images.join(', ');
        }

        // Handle objects
        if (typeof flat.controlCompatibility === 'object' && flat.controlCompatibility !== null) {
          Object.keys(flat.controlCompatibility).forEach(key => {
            flat[`controlCompatibility_${key}`] = flat.controlCompatibility[key];
          });
          delete flat.controlCompatibility;
        }

        if (typeof flat.positionFeedback === 'object' && flat.positionFeedback !== null) {
          Object.keys(flat.positionFeedback).forEach(key => {
            flat[`positionFeedback_${key}`] = flat.positionFeedback[key];
          });
          delete flat.positionFeedback;
        }

        if (typeof flat.certifications === 'object' && flat.certifications !== null) {
          Object.keys(flat.certifications).forEach(key => {
            flat[`certification_${key}`] = flat.certifications[key];
          });
          delete flat.certifications;
        }

        if (typeof flat.price === 'object' && flat.price !== null) {
          flat.priceValue = flat.price.value;
          flat.priceCurrency = flat.price.currency;
          delete flat.price;
        }

        if (typeof flat.rentalRate === 'object' && flat.rentalRate !== null) {
          flat.rentalRateDaily = flat.rentalRate.daily;
          flat.rentalRateWeekly = flat.rentalRate.weekly;
          delete flat.rentalRate;
        }

        if (typeof flat.supportInfo === 'object' && flat.supportInfo !== null) {
          Object.keys(flat.supportInfo).forEach(key => {
            flat[`supportInfo_${key}`] = flat.supportInfo[key];
          });
          delete flat.supportInfo;
        }

        // Format dates
        if (flat.lastUpdated instanceof Date) {
          flat.lastUpdated = flat.lastUpdated.toISOString();
        }
        if (flat.processedDate instanceof Date) {
          flat.processedDate = flat.processedDate.toISOString();
        }

        return flat;
      });

      // Get all possible headers
      const headers = new Set();
      for (const record of flattenedData) {
        Object.keys(record).forEach(key => headers.add(key));
      }

      // Create CSV writer
      const csvWriter = createCsvWriter({
        path: path.join(CONFIG.outputDir, CONFIG.csvOutputFile),
        header: Array.from(headers).map(id => ({ id, title: id })),
      });

      // Write CSV
      await csvWriter.writeRecords(flattenedData);
      console.log(`Exported processed data to CSV: ${CONFIG.csvOutputFile}`);
    } catch (err) {
      console.error('Failed to export to CSV:', err);
      throw err;
    }
  }
}

// Main execution
async function main() {
  console.log('Starting Electric Chainhoist Data Processor');
  console.log('------------------------------------------');

  // Initialize processor
  const processor = new ChainhoistDataProcessor();
  await processor.initialize();

  // Process data
  await processor.processAll();

  // Deduplicate records
  processor.deduplicateRecords();

  // Save processed data
  await processor.save();

  console.log('Processing completed successfully');
}

// Export for testing
module.exports = ChainhoistDataProcessor;

// Execute the main function only when run directly
if (require.main === module) {
  main().catch(error => {
    console.error('An error occurred:', error);
    process.exit(1);
  });
}
