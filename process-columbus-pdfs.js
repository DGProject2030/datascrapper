/**
 * Process Columbus McKinnon PDFs that haven't been extracted yet
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { LLMAnalyzer } = require('./llm-analyzer');

const config = require('./config.json');
const DATABASE_PATH = 'chainhoist_data_processed/chainhoist_database_processed.json';
const PDF_DIR = 'chainhoist_data/media/pdfs';

if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

const userAgent = config.scraper.userAgent;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadPDF(url, filepath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000,
      headers: { 'User-Agent': userAgent }
    });

    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filepath));
      writer.on('error', reject);
    });
  } catch (err) {
    console.error(`  Failed to download: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('PROCESS COLUMBUS MCKINNON PDFs');
  console.log('='.repeat(60));

  const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
  console.log(`Loaded ${database.length} products`);

  // Find Columbus McKinnon products with PDF links that need processing
  const cmProducts = database.filter(p => {
    if (p.manufacturer !== 'Columbus McKinnon') {
      return false;
    }
    if (!p.pdfs || p.pdfs.length === 0) {
      return false;
    }
    if (p.pdfExtracted && p.loadCapacity) {
      return false;
    } // Already done
    return true;
  });

  console.log(`Found ${cmProducts.length} Columbus McKinnon products with PDFs to process\n`);

  let analyzer;
  try {
    analyzer = new LLMAnalyzer();
    console.log('LLM Analyzer initialized\n');
  } catch (err) {
    console.error('Failed to initialize LLM:', err.message);
    process.exit(1);
  }

  let downloadCount = 0;
  let extractCount = 0;

  for (let i = 0; i < cmProducts.length; i++) {
    const product = cmProducts[i];
    console.log(`\n[${i + 1}/${cmProducts.length}] ${product.model}`);

    // Download any missing PDFs
    if (!product.downloadedPDFs) {
      product.downloadedPDFs = [];
    }

    for (const pdf of product.pdfs) {
      // Check if already downloaded
      const alreadyDownloaded = product.downloadedPDFs.find(d => d.url === pdf.url);
      if (alreadyDownloaded && fs.existsSync(alreadyDownloaded.localPath)) {
        continue;
      }

      const safeName = (product.model || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
      const filename = `columbus-mckinnon_${safeName}_${pdf.type || 'document'}_${product.downloadedPDFs.length}.pdf`;
      const filepath = path.join(PDF_DIR, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`  Downloading: ${pdf.url.substring(0, 60)}...`);
        const result = await downloadPDF(pdf.url, filepath);
        if (result) {
          downloadCount++;
          product.downloadedPDFs.push({
            ...pdf,
            localPath: filepath,
            filename
          });
        }
        await delay(1000);
      }
    }

    // Extract data from PDFs
    for (const pdf of product.downloadedPDFs) {
      if (!fs.existsSync(pdf.localPath)) {
        continue;
      }

      console.log(`  Extracting from: ${pdf.filename}`);
      try {
        const extracted = await analyzer.analyzePDF(pdf.localPath);
        if (extracted && !extracted.error) {
          // Update product
          const idx = database.findIndex(p => p.id === product.id);
          if (idx !== -1) {
            database[idx] = analyzer.mergeProductData(database[idx], extracted);
            database[idx].pdfExtracted = true;
            database[idx].pdfExtractedAt = new Date().toISOString();
            database[idx].pdfSource = pdf.filename;
            extractCount++;

            if (extracted.loadCapacity) {
              console.log(`  ✓ Extracted load capacity: ${extracted.loadCapacity}`);
            } else {
              console.log('  - Extracted data but no load capacity found');
            }
          }
        }
      } catch (err) {
        console.error(`  Extract error: ${err.message}`);
      }
      await delay(2000); // Rate limit API calls
    }
  }

  // Save database
  fs.writeFileSync(DATABASE_PATH, JSON.stringify(database, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`PDFs downloaded: ${downloadCount}`);
  console.log(`Products extracted: ${extractCount}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
