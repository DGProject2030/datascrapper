/**
 * Batch PDF Analysis Script
 * Processes all PDFs in chainhoist_data/media/pdfs/ using LLM extraction
 * and matches extracted data back to products in the database
 *
 * Usage: node scripts/batch-pdf-analysis.js [--dry-run] [--limit N]
 */

// Load environment variables first
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { LLMAnalyzer } = require('../llm-analyzer');

// Configuration
const CONFIG = {
  pdfDir: path.join(__dirname, '..', 'chainhoist_data', 'media', 'pdfs'),
  databaseFile: path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database.json'),
  outputFile: path.join(__dirname, '..', 'chainhoist_data', 'pdf_extractions.json'),
  enrichedDatabaseFile: path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database_enriched.json'),
  batchSize: 5,
  delayBetweenBatches: 2000, // ms
  maxRetries: 3,
};

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : null;

/**
 * Logger utility
 */
class Logger {
  static info(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  static warn(message, data = null) {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  static error(message, data = null) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  static success(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [SUCCESS] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

/**
 * Parse PDF filename to extract manufacturer and product info
 * Format: manufacturer_product-name_document_N.pdf
 */
function parsePdfFilename(filename) {
  const baseName = path.basename(filename, '.pdf');
  const parts = baseName.split('_');

  if (parts.length >= 2) {
    const manufacturer = parts[0].replace(/-/g, ' ');
    const productSlug = parts[1].replace(/-/g, ' ');
    const docType = parts[2] || 'document';
    const docIndex = parts[3] || '0';

    return {
      manufacturer: manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1),
      productSlug,
      docType,
      docIndex,
      originalFilename: filename
    };
  }

  return {
    manufacturer: 'Unknown',
    productSlug: baseName,
    docType: 'document',
    docIndex: '0',
    originalFilename: filename
  };
}

/**
 * Find matching products in the database for extracted PDF data
 */
function findMatchingProducts(database, pdfInfo, extractedData) {
  const matches = [];

  // Normalize manufacturer name for matching
  const normalizeManufacturer = (name) => {
    if (!name) {
      return '';
    }
    return name.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/gmbh|ag|ltd|inc|llc|corp/g, '');
  };

  const pdfManufacturer = normalizeManufacturer(pdfInfo.manufacturer);
  const extractedManufacturer = normalizeManufacturer(extractedData.manufacturer);

  for (const product of database) {
    const productManufacturer = normalizeManufacturer(product.manufacturer);

    // Check manufacturer match
    const manufacturerMatch =
      productManufacturer.includes(pdfManufacturer) ||
      pdfManufacturer.includes(productManufacturer) ||
      (extractedManufacturer && productManufacturer.includes(extractedManufacturer));

    if (!manufacturerMatch) {
      continue;
    }

    // Check model/series match
    const productModel = (product.model || '').toLowerCase();
    const productSeries = (product.series || '').toLowerCase();
    const extractedModel = (extractedData.model || '').toLowerCase();
    const extractedSeries = (extractedData.series || '').toLowerCase();
    const pdfProduct = pdfInfo.productSlug.toLowerCase();

    const modelMatch =
      productModel.includes(pdfProduct) ||
      pdfProduct.includes(productModel) ||
      (extractedModel && (productModel.includes(extractedModel) || extractedModel.includes(productModel))) ||
      (extractedSeries && (productSeries.includes(extractedSeries) || productModel.includes(extractedSeries)));

    if (modelMatch) {
      matches.push({
        productId: product.id,
        manufacturer: product.manufacturer,
        model: product.model,
        confidence: calculateMatchConfidence(product, pdfInfo, extractedData)
      });
    }
  }

  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);

  return matches;
}

/**
 * Calculate confidence score for a product match
 */
function calculateMatchConfidence(product, pdfInfo, extractedData) {
  let confidence = 0.5;

  // Exact manufacturer match
  if (product.manufacturer.toLowerCase() === pdfInfo.manufacturer.toLowerCase()) {
    confidence += 0.2;
  }

  // Model name in PDF filename
  if (pdfInfo.productSlug.toLowerCase().includes(product.model.toLowerCase())) {
    confidence += 0.2;
  }

  // Extracted model matches
  if (extractedData.model && product.model.toLowerCase().includes(extractedData.model.toLowerCase())) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Merge extracted data into product record
 */
function mergeExtractedData(product, extractedData) {
  const merged = { ...product };

  // Fields to potentially update
  const fields = [
    'loadCapacity', 'liftingSpeed', 'motorPower', 'dutyCycle',
    'weight', 'dimensions', 'voltageOptions', 'classification',
    'certifications', 'protectionClass', 'noiseLevel', 'brakeType',
    'chainSpecification', 'operatingTemperature', 'applications'
  ];

  for (const field of fields) {
    if (extractedData[field] && !product[field]) {
      merged[field] = extractedData[field];
      merged._enrichedFields = merged._enrichedFields || [];
      merged._enrichedFields.push(field);
    }
  }

  // Handle safety features separately
  if (extractedData.safetyFeatures && typeof extractedData.safetyFeatures === 'object') {
    merged.safetyFeatures = merged.safetyFeatures || {};
    for (const [key, value] of Object.entries(extractedData.safetyFeatures)) {
      if (value !== undefined && merged.safetyFeatures[key] === undefined) {
        merged.safetyFeatures[key] = value;
      }
    }
  }

  // Handle classification array
  if (extractedData.classification && Array.isArray(extractedData.classification)) {
    if (!merged.classification || merged.classification.length === 0) {
      merged.classification = extractedData.classification;
    } else {
      // Merge unique classifications
      const existing = new Set(merged.classification.map(c => c.toLowerCase()));
      for (const cls of extractedData.classification) {
        if (!existing.has(cls.toLowerCase())) {
          merged.classification.push(cls);
        }
      }
    }
  }

  merged._pdfEnriched = true;
  merged._pdfEnrichedAt = new Date().toISOString();

  return merged;
}

/**
 * Main batch processing function
 */
async function processBatchPDFs() {
  Logger.info('Starting batch PDF analysis');
  Logger.info(`Configuration: dry-run=${isDryRun}, limit=${limit || 'unlimited'}`);

  // Initialize LLM Analyzer
  let analyzer;
  try {
    analyzer = new LLMAnalyzer();
    Logger.info(`LLM Analyzer initialized with provider: ${analyzer.provider}`);
  } catch (error) {
    Logger.error('Failed to initialize LLM Analyzer', { error: error.message });
    Logger.info('Make sure you have set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY');
    process.exit(1);
  }

  // Load database
  let database;
  try {
    const dbContent = fs.readFileSync(CONFIG.databaseFile, 'utf8');
    const parsed = JSON.parse(dbContent);
    database = Array.isArray(parsed) ? parsed : (parsed.data || []);
    Logger.info(`Loaded database with ${database.length} products`);
  } catch (error) {
    Logger.error('Failed to load database', { error: error.message });
    process.exit(1);
  }

  // Get list of PDFs
  let pdfFiles;
  try {
    pdfFiles = fs.readdirSync(CONFIG.pdfDir)
      .filter(f => f.endsWith('.pdf'))
      .map(f => path.join(CONFIG.pdfDir, f));
    Logger.info(`Found ${pdfFiles.length} PDF files`);
  } catch (error) {
    Logger.error('Failed to read PDF directory', { error: error.message });
    process.exit(1);
  }

  // Apply limit if specified
  if (limit && limit > 0) {
    pdfFiles = pdfFiles.slice(0, limit);
    Logger.info(`Limited to ${pdfFiles.length} files`);
  }

  // Load existing extractions (for resume capability)
  let existingExtractions = {};
  if (fs.existsSync(CONFIG.outputFile)) {
    try {
      existingExtractions = JSON.parse(fs.readFileSync(CONFIG.outputFile, 'utf8'));
      Logger.info(`Loaded ${Object.keys(existingExtractions).length} existing extractions`);
    } catch (error) {
      Logger.warn('Failed to load existing extractions, starting fresh');
    }
  }

  // Process results
  const results = {
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    enriched: 0,
    extractions: { ...existingExtractions }
  };

  // Process PDFs in batches
  for (let i = 0; i < pdfFiles.length; i += CONFIG.batchSize) {
    const batch = pdfFiles.slice(i, i + CONFIG.batchSize);
    Logger.info(`Processing batch ${Math.floor(i / CONFIG.batchSize) + 1}/${Math.ceil(pdfFiles.length / CONFIG.batchSize)}`);

    for (const pdfPath of batch) {
      const filename = path.basename(pdfPath);

      // Skip if already processed
      if (existingExtractions[filename]) {
        Logger.info(`Skipping already processed: ${filename}`);
        results.skipped++;
        continue;
      }

      results.processed++;
      const pdfInfo = parsePdfFilename(filename);
      Logger.info(`Processing: ${filename} (${pdfInfo.manufacturer})`);

      if (isDryRun) {
        Logger.info(`[DRY-RUN] Would analyze: ${filename}`);
        continue;
      }

      let extractedData = null;
      let retries = 0;

      while (retries < CONFIG.maxRetries) {
        try {
          extractedData = await analyzer.analyzePDF(pdfPath);
          break;
        } catch (error) {
          retries++;
          Logger.warn(`Retry ${retries}/${CONFIG.maxRetries} for ${filename}: ${error.message}`);
          if (retries >= CONFIG.maxRetries) {
            Logger.error(`Failed to analyze ${filename} after ${CONFIG.maxRetries} retries`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          }
        }
      }

      if (extractedData && !extractedData.error) {
        results.successful++;

        // Find matching products
        const matches = findMatchingProducts(database, pdfInfo, extractedData);

        // Store extraction result
        results.extractions[filename] = {
          pdfInfo,
          extractedData,
          matches: matches.slice(0, 5), // Top 5 matches
          processedAt: new Date().toISOString()
        };

        Logger.success(`Extracted data from ${filename}`, {
          loadCapacity: extractedData.loadCapacity,
          liftingSpeed: extractedData.liftingSpeed,
          motorPower: extractedData.motorPower,
          dutyCycle: extractedData.dutyCycle,
          confidence: extractedData.confidence,
          matchCount: matches.length
        });
      } else {
        results.failed++;
        results.extractions[filename] = {
          pdfInfo,
          error: extractedData?.error || 'Unknown error',
          processedAt: new Date().toISOString()
        };
      }

      // Save progress periodically
      if (results.processed % 10 === 0) {
        fs.writeFileSync(CONFIG.outputFile, JSON.stringify(results.extractions, null, 2));
        Logger.info(`Progress saved (${results.processed}/${pdfFiles.length})`);
      }
    }

    // Delay between batches to respect rate limits
    if (i + CONFIG.batchSize < pdfFiles.length) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenBatches));
    }
  }

  // Save final extractions
  if (!isDryRun) {
    fs.writeFileSync(CONFIG.outputFile, JSON.stringify(results.extractions, null, 2));
    Logger.info(`Saved extractions to ${CONFIG.outputFile}`);
  }

  // Enrich database with extracted data
  if (!isDryRun && results.successful > 0) {
    Logger.info('Enriching database with extracted data...');

    const enrichedDatabase = database.map(product => {
      // Find extractions that match this product
      for (const extraction of Object.values(results.extractions)) {
        if (extraction.error) {
          continue;
        }

        const topMatch = extraction.matches?.[0];
        if (topMatch && topMatch.productId === product.id && topMatch.confidence >= 0.6) {
          const enriched = mergeExtractedData(product, extraction.extractedData);
          if (enriched._enrichedFields?.length > 0) {
            results.enriched++;
            Logger.info(`Enriched ${product.manufacturer} ${product.model} with: ${enriched._enrichedFields.join(', ')}`);
          }
          return enriched;
        }
      }
      return product;
    });

    // Save enriched database
    fs.writeFileSync(CONFIG.enrichedDatabaseFile, JSON.stringify(enrichedDatabase, null, 2));
    Logger.info(`Saved enriched database to ${CONFIG.enrichedDatabaseFile}`);
  }

  // Print summary
  Logger.info('=== Batch PDF Analysis Complete ===');
  Logger.info(`Total PDFs: ${pdfFiles.length}`);
  Logger.info(`Processed: ${results.processed}`);
  Logger.info(`Successful: ${results.successful}`);
  Logger.info(`Failed: ${results.failed}`);
  Logger.info(`Skipped: ${results.skipped}`);
  Logger.info(`Products Enriched: ${results.enriched}`);

  return results;
}

// Run the batch process
processBatchPDFs()
  .then(results => {
    process.exit(results.failed > results.successful ? 1 : 0);
  })
  .catch(error => {
    Logger.error('Fatal error', { error: error.message });
    process.exit(1);
  });
