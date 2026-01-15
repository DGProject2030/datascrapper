/**
 * Personality-Based Web Scraper
 * Uses extracted personality data to search for additional product information
 * @version 1.0.0
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { parseAllPersonalities } = require('./personality-parser');

// Configuration
const CONFIG = {
  outputFile: 'chainhoist_data/personality_enriched.json',
  csvOutput: 'chainhoist_data/personality_enriched.csv',
  requestDelay: 2000,
  maxRetries: 2,
  timeout: 15000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

// Known manufacturer websites for direct scraping
const MANUFACTURER_URLS = {
  'Lodestar': {
    brand: 'CM Lodestar',
    website: 'https://www.columbusmckinnon.com',
    searchUrl: 'https://www.columbusmckinnon.com/en-us/products/hoists-and-rigging/electric-chain-hoists/'
  },
  'Liftket': {
    brand: 'Liftket',
    website: 'https://liftket.com',
    searchUrl: 'https://liftket.com/entertainment/'
  },
  'Kinesys': {
    brand: 'Kinesys',
    website: 'https://www.kinesys.com',
    searchUrl: 'https://www.kinesys.com/products/'
  },
  'EXE': {
    brand: 'EXE Technology',
    website: 'https://www.exetechnology.com',
    searchUrl: 'https://www.exetechnology.com/electric-chain-hoist/'
  },
  'Prolyft': {
    brand: 'Prolyft (Prolyte)',
    website: 'https://www.prolyte.com',
    searchUrl: 'https://www.prolyte.com/products/prolyft/nero-chain-hoists'
  },
  'GIS': {
    brand: 'GIS AG',
    website: 'https://gis-ag.ch',
    searchUrl: 'https://gis-ag.ch/en/industry/products/chain-hoists-and-trolleys'
  },
  'Chainmaster': {
    brand: 'Chainmaster',
    website: 'https://www.chainmaster.de',
    searchUrl: 'https://www.chainmaster.de/en/products/'
  },
  'WiMotion': {
    brand: 'Wicreations',
    website: 'https://www.wicreations.com',
    searchUrl: 'https://www.wicreations.com/categories/technologies'
  },
  'Atlanta Rigging Systems': {
    brand: 'Atlanta Rigging Systems',
    website: 'https://www.atlantarigging.com',
    searchUrl: 'https://www.atlantarigging.com/sales-and-installations/'
  }
};

// Entertainment industry specific manufacturers
const ENTERTAINMENT_MANUFACTURERS = [
  'Lodestar', 'Liftket', 'Kinesys', 'Prolyft', 'EXE', 'Chainmaster',
  'GIS', 'Movecat', 'WiMotion', 'Atlanta Rigging Systems', 'Prostar',
  'Varistar', 'LoadGuard', 'Evo', 'Summit Steel', 'Flying by Foy'
];

/**
 * Fetch page with retries
 */
async function fetchPage(url, retries = CONFIG.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: { 'User-Agent': CONFIG.userAgent },
        timeout: CONFIG.timeout
      });
      return response.data;
    } catch (err) {
      console.warn(`  Attempt ${attempt} failed for ${url}: ${err.message}`);
      if (attempt < retries) {
        await sleep(CONFIG.requestDelay * attempt);
      }
    }
  }
  return null;
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract product images from a page
 */
function extractImages($, baseUrl, productName) {
  const images = [];
  const seen = new Set();

  // Common image selectors for product pages
  const selectors = [
    'img[src*="product"]',
    'img[src*="hoist"]',
    '.product-image img',
    '.gallery img',
    '.main-image img',
    '.product-gallery img',
    '[class*="product"] img',
    'img[alt*="hoist"]',
    'img[alt*="chain"]',
    'article img',
    '.content img'
  ];

  selectors.forEach(selector => {
    try {
      $(selector).each((_, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (!src) {
          return;
        }

        // Skip small icons, logos, and tracking pixels
        const width = parseInt($(el).attr('width')) || 0;
        const height = parseInt($(el).attr('height')) || 0;
        if ((width > 0 && width < 80) || (height > 0 && height < 80)) {
          return;
        }
        if (src.includes('pixel') || src.includes('tracking') || src.includes('icon') ||
            src.includes('logo') || src.includes('avatar') || src.includes('placeholder')) {
          return;
        }

        // Make URL absolute
        if (!src.startsWith('http')) {
          try {
            src = new URL(src, baseUrl).href;
          } catch {
            return;
          }
        }

        // Skip duplicates
        if (seen.has(src)) {
          return;
        }
        seen.add(src);

        // Get alt text
        const alt = $(el).attr('alt') || $(el).attr('title') || '';

        images.push({
          url: src,
          alt: alt,
          title: $(el).attr('title') || ''
        });
      });
    } catch {
      // Selector failed, continue
    }
  });

  // Return max 5 images
  return images.slice(0, 5);
}

/**
 * Search for product info on manufacturer website
 */
async function searchManufacturerSite(product, mfrInfo) {
  if (!mfrInfo || !mfrInfo.website) {
    return null;
  }

  console.log(`  Searching ${mfrInfo.brand} website for ${product.searchTerms?.model || product.name}...`);

  try {
    const html = await fetchPage(mfrInfo.searchUrl);
    if (!html) {
      return null;
    }

    const $ = cheerio.load(html);

    // Look for matching products
    const productLinks = [];
    $('a[href*="product"], a[href*="hoist"], .product-link, .product-item a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().toLowerCase();
      const modelName = (product.searchTerms?.model || '').toLowerCase();

      if (modelName && text.includes(modelName.split(' ')[0])) {
        productLinks.push({
          href: href.startsWith('http') ? href : `${mfrInfo.website}${href}`,
          text: $(el).text().trim()
        });
      }
    });

    // Extract images from the page
    const images = extractImages($, mfrInfo.searchUrl, product.name);

    return {
      website: mfrInfo.website,
      brand: mfrInfo.brand,
      matchingProducts: productLinks.slice(0, 5),
      images: images
    };
  } catch (err) {
    console.warn(`  Error searching ${mfrInfo.brand}: ${err.message}`);
    return null;
  }
}

/**
 * Extract additional product specifications from a page
 */
function extractSpecsFromPage($, url) {
  const specs = {};

  // Common spec patterns
  const specPatterns = {
    loadCapacity: /capacity[:\s]*(\d+(?:\.\d+)?)\s*(kg|lbs?|tons?)/i,
    liftingSpeed: /(?:lifting\s*)?speed[:\s]*(\d+(?:\.\d+)?)\s*(m\/min|fpm|mm\/s)/i,
    motorPower: /(?:motor\s*)?power[:\s]*(\d+(?:\.\d+)?)\s*(kw|hp|w)/i,
    voltage: /voltage[:\s]*(\d+(?:\/\d+)?)\s*v/i,
    weight: /weight[:\s]*(\d+(?:\.\d+)?)\s*(kg|lbs?)/i,
    chainFall: /chain\s*fall[:\s]*(\d+)/i,
    dutyCycle: /duty\s*(?:cycle)?[:\s]*(\w+)/i
  };

  // Extract from page text
  const pageText = $('body').text();

  for (const [key, pattern] of Object.entries(specPatterns)) {
    const match = pageText.match(pattern);
    if (match) {
      specs[key] = match[0].trim();
    }
  }

  // Look for spec tables
  $('table').each((_, table) => {
    $(table).find('tr').each((_, row) => {
      const cells = $(row).find('td, th');
      if (cells.length >= 2) {
        const label = $(cells[0]).text().trim().toLowerCase();
        const value = $(cells[1]).text().trim();

        if (label.includes('capacity')) {
          specs.loadCapacity = value;
        }
        if (label.includes('speed')) {
          specs.liftingSpeed = value;
        }
        if (label.includes('power')) {
          specs.motorPower = value;
        }
        if (label.includes('voltage')) {
          specs.voltage = value;
        }
        if (label.includes('weight')) {
          specs.weight = value;
        }
      }
    });
  });

  // Look for certification badges
  const certifications = [];
  $('img[alt*="CE"], img[alt*="ISO"], img[alt*="UL"], img[alt*="certified"]').each((_, img) => {
    certifications.push($(img).attr('alt'));
  });
  if (certifications.length > 0) {
    specs.certifications = certifications;
  }

  // Look for PDF datasheets
  const datasheets = [];
  $('a[href$=".pdf"]').each((_, a) => {
    const href = $(a).attr('href');
    const text = $(a).text().trim();
    if (href && (text.toLowerCase().includes('datasheet') ||
        text.toLowerCase().includes('spec') ||
        text.toLowerCase().includes('brochure'))) {
      datasheets.push({
        url: href.startsWith('http') ? href : new URL(href, url).href,
        title: text
      });
    }
  });
  if (datasheets.length > 0) {
    specs.datasheets = datasheets;
  }

  return specs;
}

/**
 * Determine product category based on name and specs
 */
function categorizeProduct(product) {
  const name = (product.name || '').toLowerCase();
  const model = (product.searchTerms?.model || '').toLowerCase();

  if (name.includes('trolley') || model.includes('trolley')) {
    return 'Beam Trolley';
  }
  if (name.includes('winch') || model.includes('winch')) {
    return 'Winch';
  }
  if (name.includes('revolve') || name.includes('turntable') || name.includes('rotator')) {
    return 'Revolve/Turntable';
  }
  if (name.includes('fly') || name.includes('flying')) {
    return 'Flying System';
  }

  return 'Electric Chain Hoist';
}

/**
 * Determine if product is variable speed or fixed speed
 */
function determineSpeedType(product) {
  const name = (product.name || '').toLowerCase();

  if (name.includes('varispeed') || name.includes('variable') || name.includes('varistar')) {
    return 'Variable Speed';
  }
  if (name.includes('fixed speed') || name.includes('fixspeed')) {
    return 'Fixed Speed';
  }

  // Check variable speed control parameters
  const vsc = product.variableSpeedControl || {};
  if (vsc.minSpeed !== null && vsc.maxSpeed !== null && vsc.minSpeed !== vsc.maxSpeed) {
    return 'Variable Speed';
  }

  return 'Unknown';
}

/**
 * Enrich a single product with web data
 */
async function enrichProduct(product) {
  const enriched = { ...product };

  // Add categorization
  enriched.category = categorizeProduct(product);
  enriched.speedType = determineSpeedType(product);

  // Add entertainment industry flag
  const isEntertainment = ENTERTAINMENT_MANUFACTURERS.some(m =>
    product.manufacturer.toLowerCase().includes(m.toLowerCase()) ||
    (product.searchTerms?.manufacturer || '').toLowerCase().includes(m.toLowerCase())
  );
  enriched.entertainmentIndustry = isEntertainment;

  // Find manufacturer info
  const mfrKey = Object.keys(MANUFACTURER_URLS).find(key =>
    product.manufacturer.toLowerCase().includes(key.toLowerCase())
  );

  if (mfrKey) {
    const mfrInfo = MANUFACTURER_URLS[mfrKey];
    enriched.manufacturerWebsite = mfrInfo.website;
    enriched.manufacturerBrand = mfrInfo.brand;

    // Search manufacturer site
    const searchResult = await searchManufacturerSite(product, mfrInfo);
    if (searchResult) {
      enriched.webSearchResults = searchResult;

      // Store images if found
      if (searchResult.images && searchResult.images.length > 0) {
        enriched.images = searchResult.images;
      }
    }

    await sleep(CONFIG.requestDelay);
  }

  return enriched;
}

/**
 * Main enrichment function
 */
async function enrichPersonalityData() {
  console.log('\\n=== Personality Data Web Enrichment ===\\n');

  // Parse personality files first
  console.log('Loading personality database...');
  const database = await parseAllPersonalities();

  console.log(`\\nEnriching ${database.products.length} products with web data...\\n`);

  const enrichedProducts = [];
  let processed = 0;

  // Group products by manufacturer to reduce duplicate searches
  const byManufacturer = database.byManufacturer;

  for (const [manufacturer, products] of Object.entries(byManufacturer)) {
    console.log(`\\nProcessing ${manufacturer} (${products.length} products)...`);

    for (const product of products) {
      const enriched = await enrichProduct(product);
      enrichedProducts.push(enriched);
      processed++;

      if (processed % 20 === 0) {
        console.log(`  Progress: ${processed}/${database.products.length}`);
      }
    }
  }

  // Create enriched database
  const enrichedDatabase = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    source: 'Personality XML Files + Web Enrichment',
    totalProducts: enrichedProducts.length,
    manufacturers: Object.keys(byManufacturer).length,
    categories: {
      'Electric Chain Hoist': enrichedProducts.filter(p => p.category === 'Electric Chain Hoist').length,
      'Beam Trolley': enrichedProducts.filter(p => p.category === 'Beam Trolley').length,
      'Winch': enrichedProducts.filter(p => p.category === 'Winch').length,
      'Revolve/Turntable': enrichedProducts.filter(p => p.category === 'Revolve/Turntable').length,
      'Flying System': enrichedProducts.filter(p => p.category === 'Flying System').length
    },
    speedTypes: {
      'Variable Speed': enrichedProducts.filter(p => p.speedType === 'Variable Speed').length,
      'Fixed Speed': enrichedProducts.filter(p => p.speedType === 'Fixed Speed').length,
      'Unknown': enrichedProducts.filter(p => p.speedType === 'Unknown').length
    },
    entertainmentProducts: enrichedProducts.filter(p => p.entertainmentIndustry).length,
    products: enrichedProducts
  };

  // Save enriched database
  fs.writeFileSync(
    path.join(__dirname, CONFIG.outputFile),
    JSON.stringify(enrichedDatabase, null, 2)
  );
  console.log(`\\nSaved enriched database to: ${CONFIG.outputFile}`);

  // Export to CSV
  exportEnrichedCSV(enrichedProducts);

  // Print summary
  console.log('\\n=== Enrichment Summary ===');
  console.log(`Total Products: ${enrichedDatabase.totalProducts}`);
  console.log(`Manufacturers: ${enrichedDatabase.manufacturers}`);
  console.log('\\nBy Category:');
  for (const [cat, count] of Object.entries(enrichedDatabase.categories)) {
    if (count > 0) {
      console.log(`  ${cat}: ${count}`);
    }
  }
  console.log('\\nBy Speed Type:');
  for (const [type, count] of Object.entries(enrichedDatabase.speedTypes)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\\nEntertainment Industry Products: ${enrichedDatabase.entertainmentProducts}`);

  return enrichedDatabase;
}

/**
 * Export enriched products to CSV
 */
function exportEnrichedCSV(products) {
  const headers = [
    'Manufacturer',
    'Brand',
    'Name',
    'Model',
    'Category',
    'Speed Type',
    'Entertainment Industry',
    'Load Capacity (kg)',
    'Lifting Speed (m/min)',
    'Lifting Speed (fpm)',
    'Min Speed',
    'Max Speed',
    'Default Speed',
    'Underload Limit',
    'Overload Limit',
    'Encoder Scaling',
    'Website',
    'Image URL'
  ];

  const rows = products.map(p => [
    p.manufacturer || '',
    p.manufacturerBrand || '',
    `"${(p.name || '').replace(/"/g, '""')}"`,
    `"${(p.searchTerms?.model || '').replace(/"/g, '""')}"`,
    p.category || '',
    p.speedType || '',
    p.entertainmentIndustry ? 'Yes' : 'No',
    p.loadCapacityKg || '',
    p.liftingSpeedMpm || '',
    p.liftingSpeedFpm || '',
    p.variableSpeedControl?.minSpeed || '',
    p.variableSpeedControl?.maxSpeed || '',
    p.variableSpeedControl?.defaultSpeed || '',
    p.underloadLimit || '',
    p.overloadLimit || '',
    p.encoderScaling || '',
    p.manufacturerWebsite || '',
    p.images && p.images.length > 0 ? p.images[0].url : ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\\n');

  fs.writeFileSync(path.join(__dirname, CONFIG.csvOutput), csvContent);
  console.log(`Exported enriched CSV to: ${CONFIG.csvOutput}`);
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'enrich';

  switch (command) {
  case 'enrich':
    await enrichPersonalityData();
    break;

  case 'help':
  default:
    console.log(`
Personality Web Scraper

Usage:
  node personality-web-scraper.js <command>

Commands:
  enrich    Parse XML files and enrich with web data (default)
  help      Show this help message

Output:
  - chainhoist_data/personality_enriched.json
  - chainhoist_data/personality_enriched.csv
`);
    break;
  }
}

module.exports = {
  enrichPersonalityData,
  enrichProduct,
  searchManufacturerSite
};

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
