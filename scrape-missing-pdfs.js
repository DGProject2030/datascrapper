/**
 * Scrape PDFs for products missing load capacity
 * Downloads PDFs from product pages and extracts data
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { LLMAnalyzer } = require('./llm-analyzer');

const config = require('./config.json');
const DATABASE_PATH = 'chainhoist_data_processed/chainhoist_database_processed.json';
const PDF_DIR = 'chainhoist_data/media/pdfs';

// Ensure PDF directory exists
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
    console.error(`  Failed to download ${url}: ${err.message}`);
    return null;
  }
}

async function findPDFsOnPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': userAgent }
    });

    const $ = cheerio.load(response.data);
    const pdfs = [];

    // Find PDF links
    $('a[href$=".pdf"], a[href*="datasheet"], a[href*="brochure"], a[href*="manual"], a[href*="specification"]').each((i, el) => {
      let href = $(el).attr('href');
      if (!href) {
        return;
      }

      // Make absolute URL
      if (href.startsWith('/')) {
        const urlObj = new URL(url);
        href = `${urlObj.protocol}//${urlObj.host}${href}`;
      } else if (!href.startsWith('http')) {
        href = new URL(href, url).href;
      }

      if (href.includes('.pdf')) {
        const title = $(el).text().trim() || 'document';
        let type = 'document';
        if (href.toLowerCase().includes('datasheet')) {
          type = 'datasheet';
        } else if (href.toLowerCase().includes('manual')) {
          type = 'manual';
        } else if (href.toLowerCase().includes('brochure')) {
          type = 'brochure';
        } else if (href.toLowerCase().includes('spec')) {
          type = 'specification';
        }

        pdfs.push({ url: href, type, title });
      }
    });

    return [...new Map(pdfs.map(p => [p.url, p])).values()]; // Dedupe
  } catch (err) {
    console.error(`  Failed to fetch ${url}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('SCRAPE MISSING PDFs');
  console.log('='.repeat(60));

  // Load database
  const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
  console.log(`Loaded ${database.length} products`);

  // Find products missing load capacity with valid URLs
  const missing = database.filter(p => {
    if (p.loadCapacity) {
      return false;
    }
    if (!p.url) {
      return false;
    }
    // Skip category pages (same URL appears multiple times)
    const urlCount = database.filter(x => x.url === p.url).length;
    if (urlCount > 3) {
      return false;
    }
    return true;
  });

  console.log(`Found ${missing.length} products missing load capacity with unique URLs`);

  // Initialize LLM
  let analyzer;
  try {
    analyzer = new LLMAnalyzer();
    console.log('LLM Analyzer initialized');
  } catch (err) {
    console.error('Failed to initialize LLM:', err.message);
    process.exit(1);
  }

  let pdfCount = 0;
  let updatedCount = 0;

  // Process each product
  for (let i = 0; i < Math.min(missing.length, 50); i++) { // Limit to 50 products
    const product = missing[i];
    console.log(`\n[${i + 1}/${Math.min(missing.length, 50)}] ${product.manufacturer} - ${product.model}`);
    console.log(`  URL: ${product.url}`);

    // Find PDFs on the page
    const pdfs = await findPDFsOnPage(product.url);
    console.log(`  Found ${pdfs.length} PDFs`);

    if (pdfs.length === 0) {
      await delay(1000);
      continue;
    }

    // Download first 2 PDFs
    const downloadedPDFs = [];
    for (let j = 0; j < Math.min(pdfs.length, 2); j++) {
      const pdf = pdfs[j];
      const safeName = product.model.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
      const filename = `${product.manufacturer.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${safeName}_${pdf.type}_${j}.pdf`;
      const filepath = path.join(PDF_DIR, filename);

      if (fs.existsSync(filepath)) {
        console.log(`  PDF already exists: ${filename}`);
        downloadedPDFs.push({ ...pdf, localPath: filepath, filename });
        continue;
      }

      console.log(`  Downloading: ${pdf.type}...`);
      const result = await downloadPDF(pdf.url, filepath);
      if (result) {
        downloadedPDFs.push({ ...pdf, localPath: filepath, filename });
        pdfCount++;
      }
      await delay(500);
    }

    // Extract data from downloaded PDFs
    for (const pdf of downloadedPDFs) {
      console.log(`  Extracting from: ${pdf.filename}`);
      try {
        const extracted = await analyzer.analyzePDF(pdf.localPath);
        if (extracted && !extracted.error && extracted.confidence > 0.5) {
          // Update product in database
          const idx = database.findIndex(p => p.id === product.id);
          if (idx !== -1) {
            database[idx] = analyzer.mergeProductData(database[idx], extracted);
            database[idx].pdfExtracted = true;
            database[idx].pdfExtractedAt = new Date().toISOString();
            database[idx].pdfSource = pdf.filename;
            if (!database[idx].downloadedPDFs) {
              database[idx].downloadedPDFs = [];
            }
            database[idx].downloadedPDFs.push(pdf);
            updatedCount++;
            console.log(`  ✓ Updated with confidence ${extracted.confidence}`);
          }
        }
      } catch (err) {
        console.error(`  Extract error: ${err.message}`);
      }
    }

    await delay(2000); // Be nice to servers
  }

  // Save database
  fs.writeFileSync(DATABASE_PATH, JSON.stringify(database, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`PDFs downloaded: ${pdfCount}`);
  console.log(`Products updated: ${updatedCount}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
