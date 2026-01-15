/**
 * PDF Data Extractor
 * Extracts technical specifications from PDFs and updates the database
 * @version 1.0.0
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { LLMAnalyzer } = require('./llm-analyzer');

// Configuration
const PDF_DIR = 'chainhoist_data/media/pdfs';
const DATABASE_PATH = 'chainhoist_data_processed/chainhoist_database_processed.json';
const REPORT_PATH = 'chainhoist_data_processed/pdf_extraction_report.json';

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

/**
 * Logger utility
 */
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data && VERBOSE) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

/**
 * Parse PDF filename to extract manufacturer and product info
 * Format: manufacturer_product_type_index.pdf
 */
function parsePDFFilename(filename) {
  const name = path.basename(filename, '.pdf');
  const parts = name.split('_');

  if (parts.length < 3) {
    return null;
  }

  // Last part is index, second to last is type
  const index = parts.pop();
  const type = parts.pop();
  const manufacturer = parts[0];
  const product = parts.slice(1).join('_');

  return {
    manufacturer,
    product,
    type,
    index: parseInt(index, 10),
    filename
  };
}

/**
 * Find matching products in database for a PDF
 */
function findMatchingProducts(pdfInfo, database) {
  const matches = [];
  const manufacturerLower = pdfInfo.manufacturer.toLowerCase().replace(/-/g, ' ');
  const productLower = pdfInfo.product.toLowerCase().replace(/-/g, ' ');

  for (const product of database) {
    const dbManufacturer = (product.manufacturer || '').toLowerCase();
    const dbModel = (product.model || '').toLowerCase();
    const dbSeries = (product.series || '').toLowerCase();

    // Check if manufacturer matches
    if (dbManufacturer.includes(manufacturerLower) || manufacturerLower.includes(dbManufacturer)) {
      // Check if product/model matches
      if (dbModel.includes(productLower) ||
          productLower.includes(dbModel) ||
          dbSeries.includes(productLower) ||
          productLower.includes(dbSeries)) {
        matches.push(product);
      }
    }
  }

  return matches;
}

/**
 * Main extraction function
 */
async function extractPDFData() {
  log('Starting PDF data extraction...');
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be saved)' : 'LIVE'}`);

  // Check if PDF directory exists
  if (!fs.existsSync(PDF_DIR)) {
    log(`ERROR: PDF directory not found: ${PDF_DIR}`);
    process.exit(1);
  }

  // Load database
  if (!fs.existsSync(DATABASE_PATH)) {
    log(`ERROR: Database not found: ${DATABASE_PATH}`);
    process.exit(1);
  }

  const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
  log(`Loaded database with ${database.length} products`);

  // Get all PDFs
  const pdfFiles = fs.readdirSync(PDF_DIR)
    .filter(f => f.endsWith('.pdf'))
    .map(f => path.join(PDF_DIR, f));

  log(`Found ${pdfFiles.length} PDF files`);

  if (pdfFiles.length === 0) {
    log('No PDF files found. Exiting.');
    process.exit(0);
  }

  // Initialize LLM Analyzer
  let analyzer;
  try {
    analyzer = new LLMAnalyzer();
    log('LLM Analyzer initialized');
  } catch (error) {
    log(`ERROR: Failed to initialize LLM Analyzer: ${error.message}`);
    log('Make sure GEMINI_API_KEY is set in your environment');
    process.exit(1);
  }

  // Track results
  const report = {
    startTime: new Date().toISOString(),
    totalPDFs: pdfFiles.length,
    processed: 0,
    successful: 0,
    failed: 0,
    productsUpdated: 0,
    extractions: []
  };

  // Process each PDF
  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfPath = pdfFiles[i];
    const filename = path.basename(pdfPath);

    log(`\n[${i + 1}/${pdfFiles.length}] Processing: ${filename}`);

    const pdfInfo = parsePDFFilename(filename);
    if (!pdfInfo) {
      log('  Skipping: Could not parse filename');
      report.extractions.push({
        filename,
        status: 'skipped',
        reason: 'Could not parse filename'
      });
      continue;
    }

    log(`  Manufacturer: ${pdfInfo.manufacturer}`);
    log(`  Product: ${pdfInfo.product}`);
    log(`  Type: ${pdfInfo.type}`);

    // Extract data from PDF
    let extractedData;
    try {
      extractedData = await analyzer.analyzePDF(pdfPath);
      report.processed++;

      if (extractedData.error) {
        log(`  Warning: ${extractedData.error}`);
        report.extractions.push({
          filename,
          status: 'error',
          error: extractedData.error
        });
        report.failed++;
        continue;
      }

      report.successful++;
      log(`  Extracted data with confidence: ${extractedData.confidence || 'N/A'}`);

      if (VERBOSE) {
        log('  Extracted fields:', Object.keys(extractedData).filter(k => extractedData[k]));
      }
    } catch (error) {
      log(`  ERROR: ${error.message}`);
      report.extractions.push({
        filename,
        status: 'error',
        error: error.message
      });
      report.failed++;
      continue;
    }

    // Find matching products in database
    const matches = findMatchingProducts(pdfInfo, database);
    log(`  Found ${matches.length} matching products in database`);

    if (matches.length === 0) {
      // Store as orphan extraction - data extracted but no matching product
      report.extractions.push({
        filename,
        status: 'no_match',
        extractedData,
        pdfInfo
      });
      continue;
    }

    // Update matching products
    for (const product of matches) {
      const productIndex = database.findIndex(p => p.id === product.id);
      if (productIndex === -1) {
        continue;
      }

      // Merge extracted data into product
      const updatedProduct = analyzer.mergeProductData(product, extractedData);
      updatedProduct.pdfExtracted = true;
      updatedProduct.pdfExtractedAt = new Date().toISOString();
      updatedProduct.pdfSource = filename;

      if (!DRY_RUN) {
        database[productIndex] = updatedProduct;
      }

      report.productsUpdated++;
      log(`  Updated product: ${product.manufacturer} - ${product.model}`);

      if (VERBOSE) {
        // Show what changed
        const changes = [];
        for (const key of Object.keys(extractedData)) {
          if (key !== 'confidence' && extractedData[key] && !product[key]) {
            changes.push(key);
          }
        }
        if (changes.length > 0) {
          log(`    New fields added: ${changes.join(', ')}`);
        }
      }
    }

    report.extractions.push({
      filename,
      status: 'success',
      extractedData,
      matchedProducts: matches.map(p => ({ id: p.id, manufacturer: p.manufacturer, model: p.model }))
    });

    // Rate limit status
    const status = analyzer.getRateLimitStatus();
    if (status.minuteRemaining < 3) {
      log(`  Rate limit: ${status.minuteRemaining} requests remaining this minute`);
    }
  }

  // Save results
  report.endTime = new Date().toISOString();
  report.duration = new Date(report.endTime) - new Date(report.startTime);

  if (!DRY_RUN) {
    // Save updated database
    fs.writeFileSync(DATABASE_PATH, JSON.stringify(database, null, 2));
    log(`\nDatabase saved to: ${DATABASE_PATH}`);
  }

  // Save report
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  log(`Report saved to: ${REPORT_PATH}`);

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('EXTRACTION SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total PDFs:        ${report.totalPDFs}`);
  console.log(`Processed:         ${report.processed}`);
  console.log(`Successful:        ${report.successful}`);
  console.log(`Failed:            ${report.failed}`);
  console.log(`Products Updated:  ${report.productsUpdated}`);
  console.log(`Duration:          ${Math.round(report.duration / 1000)}s`);
  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes were saved to the database.');
    console.log('Run without --dry-run to save changes.');
  }
  console.log('='.repeat(50));
}

// Run
extractPDFData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
