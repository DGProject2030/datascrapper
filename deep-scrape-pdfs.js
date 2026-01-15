/**
 * Deep scrape for PDFs - follows product links from category pages
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

if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

const userAgent = config.scraper.userAgent;
const visited = new Set();

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url) {
  if (visited.has(url)) {
    return null;
  }
  visited.add(url);

  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': userAgent }
    });
    return cheerio.load(response.data);
  } catch (err) {
    return null;
  }
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
    return null;
  }
}

// Target manufacturers with good PDF availability
const targets = [
  {
    name: 'Street Crane',
    baseUrl: 'https://www.streetcrane.co.uk',
    startPage: 'https://www.streetcrane.co.uk/products/hoists/',
    productSelector: 'a[href*="/products/"]',
    pdfSelector: 'a[href$=".pdf"]'
  },
  {
    name: 'Demag',
    baseUrl: 'https://www.demagcranes.com',
    startPage: 'https://www.demagcranes.com/en-us/products/hoists',
    productSelector: 'a[href*="/products/"]',
    pdfSelector: 'a[href$=".pdf"]'
  },
  {
    name: 'Verlinde',
    baseUrl: 'https://www.verlinde.com',
    startPage: 'https://www.verlinde.com/en/products/electric-chain-hoists/',
    productSelector: 'a[href*="/products/"]',
    pdfSelector: 'a[href$=".pdf"]'
  },
  {
    name: 'Yale',
    baseUrl: 'https://www.yale.com',
    startPage: 'https://www.yale.com/en/products/hoists/',
    productSelector: 'a[href*="/product"]',
    pdfSelector: 'a[href$=".pdf"]'
  },
  {
    name: 'Hitachi',
    baseUrl: 'https://www.hitachi-ies.co.jp',
    startPage: 'https://www.hitachi-ies.co.jp/english/products/hoist/',
    productSelector: 'a[href*="/products/"]',
    pdfSelector: 'a[href$=".pdf"]'
  }
];

async function scrapeManufacturer(target, analyzer, database) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scraping: ${target.name}`);
  console.log(`Start page: ${target.startPage}`);
  console.log('='.repeat(60));

  const $ = await fetchPage(target.startPage);
  if (!$) {
    console.log('  Failed to fetch start page');
    return { pdfs: 0, products: 0 };
  }

  // Find product links
  const productLinks = [];
  $(target.productSelector).each((i, el) => {
    let href = $(el).attr('href');
    if (!href) {
      return;
    }
    if (href.startsWith('/')) {
      href = target.baseUrl + href;
    }
    if (!productLinks.includes(href) && href.includes(target.baseUrl)) {
      productLinks.push(href);
    }
  });

  console.log(`  Found ${productLinks.length} product links`);

  let pdfCount = 0;
  let productCount = 0;

  // Visit each product page (limit to 20)
  for (let i = 0; i < Math.min(productLinks.length, 20); i++) {
    const productUrl = productLinks[i];
    console.log(`\n  [${i + 1}/${Math.min(productLinks.length, 20)}] ${productUrl.substring(0, 80)}...`);

    const $product = await fetchPage(productUrl);
    if (!$product) {
      continue;
    }

    // Find PDFs
    const pdfs = [];
    $product(target.pdfSelector).each((j, el) => {
      let href = $product(el).attr('href');
      if (!href || !href.includes('.pdf')) {
        return;
      }
      if (href.startsWith('/')) {
        href = target.baseUrl + href;
      }
      const title = $product(el).text().trim() || 'document';
      pdfs.push({ url: href, title, type: 'document' });
    });

    if (pdfs.length === 0) {
      await delay(1000);
      continue;
    }

    console.log(`    Found ${pdfs.length} PDFs`);

    // Get product name from page
    const pageTitle = $product('h1').first().text().trim() ||
                      $product('title').text().split('|')[0].trim() ||
                      'Unknown Product';

    // Download and analyze first PDF
    const pdf = pdfs[0];
    const safeName = pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
    const filename = `${target.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${safeName}_document_0.pdf`;
    const filepath = path.join(PDF_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.log('    Downloading PDF...');
      const result = await downloadPDF(pdf.url, filepath);
      if (result) {
        pdfCount++;
      }
    }

    if (fs.existsSync(filepath)) {
      console.log('    Analyzing PDF...');
      try {
        const extracted = await analyzer.analyzePDF(filepath);
        if (extracted && !extracted.error && extracted.loadCapacity) {
          // Add to database as new product
          const newProduct = {
            id: `${target.name.toLowerCase().replace(/\s+/g, '-')}-${safeName}`,
            manufacturer: target.name,
            model: pageTitle,
            url: productUrl,
            ...extracted,
            pdfExtracted: true,
            pdfExtractedAt: new Date().toISOString(),
            pdfSource: filename,
            downloadedPDFs: [{ ...pdf, localPath: filepath, filename }],
            scrapedFrom: productUrl,
            createdDate: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          };

          // Check if already exists
          const existingIdx = database.findIndex(p => p.id === newProduct.id);
          if (existingIdx >= 0) {
            database[existingIdx] = { ...database[existingIdx], ...newProduct };
          } else {
            database.push(newProduct);
          }
          productCount++;
          console.log(`    ✓ Added: ${pageTitle} (${extracted.loadCapacity})`);
        }
      } catch (err) {
        console.log(`    Analysis failed: ${err.message}`);
      }
    }

    await delay(2000);
  }

  return { pdfs: pdfCount, products: productCount };
}

async function main() {
  console.log('='.repeat(60));
  console.log('DEEP SCRAPE FOR PDFs');
  console.log('='.repeat(60));

  const database = JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
  console.log(`Loaded ${database.length} existing products`);

  let analyzer;
  try {
    analyzer = new LLMAnalyzer();
    console.log('LLM Analyzer initialized');
  } catch (err) {
    console.error('Failed to initialize LLM:', err.message);
    process.exit(1);
  }

  let totalPdfs = 0;
  let totalProducts = 0;

  for (const target of targets) {
    try {
      const result = await scrapeManufacturer(target, analyzer, database);
      totalPdfs += result.pdfs;
      totalProducts += result.products;
    } catch (err) {
      console.error(`Error scraping ${target.name}: ${err.message}`);
    }
  }

  // Save database
  fs.writeFileSync(DATABASE_PATH, JSON.stringify(database, null, 2));
  console.log(`\nDatabase saved with ${database.length} products`);

  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`New PDFs downloaded: ${totalPdfs}`);
  console.log(`Products added/updated: ${totalProducts}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
