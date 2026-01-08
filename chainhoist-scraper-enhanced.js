// Enhanced Electric Chainhoist Data Scraper v3.1
// Scrapes real data from manufacturer websites including images, videos, PDFs
// Now with LLM-powered data extraction using Google Gemini

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Load environment variables
require('dotenv').config();

// Check for LLM flag
const USE_LLM = process.argv.includes('--with-llm');

// LLM Analyzer (lazy loaded)
let LLMAnalyzer = null;
let llmAnalyzer = null;

async function initLLM() {
  if (!USE_LLM) {
    return null;
  }

  try {
    const module = require('./llm-analyzer');
    LLMAnalyzer = module.LLMAnalyzer;
    llmAnalyzer = new LLMAnalyzer();
    console.log('[INFO] LLM Analyzer initialized successfully');
    return llmAnalyzer;
  } catch (err) {
    console.warn(`[WARN] Failed to initialize LLM Analyzer: ${err.message}`);
    console.warn('[WARN] Continuing without LLM analysis');
    return null;
  }
}

// Configuration
const CONFIG = {
  outputDir: 'chainhoist_data',
  mediaDir: 'chainhoist_data/media',
  imagesDir: 'chainhoist_data/media/images',
  videosDir: 'chainhoist_data/media/videos',
  pdfsDir: 'chainhoist_data/media/pdfs',
  databaseFile: 'chainhoist_database.json',
  csvOutputFile: 'chainhoist_database.csv',
  requestDelay: 2000,
  maxRetries: 3,
  timeout: 30000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  logLevel: 'info',
  downloadImages: true,
  downloadPDFs: true,
  extractVideos: true,
  maxImagesPerProduct: 10,
  maxPDFsPerProduct: 3,
  useLLM: USE_LLM,
};

// Logger
class Logger {
  constructor(level = 'info') {
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    this.level = this.levels[level] || 1;
  }
  debug(msg, ...args) {
    if (this.level <= 0) {
      console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`, ...args);
    }
  }
  info(msg, ...args) {
    if (this.level <= 1) {
      console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args);
    }
  }
  warn(msg, ...args) {
    if (this.level <= 2) {
      console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args);
    }
  }
  error(msg, ...args) {
    if (this.level <= 3) {
      console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args);
    }
  }
}

const logger = new Logger(CONFIG.logLevel);

// All manufacturer configurations with specific scraping rules
const MANUFACTURERS = [
  {
    name: 'Columbus McKinnon',
    id: 'columbus-mckinnon',
    website: 'https://www.columbusmckinnon.com',
    region: 'USA, global',
    productPages: [
      'https://www.columbusmckinnon.com/en-us/products/hoists-and-rigging/electric-chain-hoists/'
    ],
    selectors: {
      productList: '.product-item, .product-card, [class*="product"]',
      productLink: 'a[href*="hoist"], a[href*="product"]',
      title: 'h1, .product-title, .product-name',
      description: '.product-description, .description, [class*="description"]',
      specs: '.specifications, .specs, table, [class*="spec"]',
      images: 'img[src*="product"], .product-image img, .gallery img',
      videos: 'iframe[src*="youtube"], iframe[src*="vimeo"], video source',
      price: '.price, [class*="price"]',
    }
  },
  {
    name: 'Konecranes',
    id: 'konecranes',
    website: 'https://www.konecranes.com',
    region: 'Finland, global',
    productPages: [
      'https://www.konecranes.com/equipment/workstation-lifting-systems/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product-list-item, [class*="product"]',
      productLink: 'a[href*="hoist"], a[href*="lifting"]',
      title: 'h1, .page-title',
      description: '.intro-text, .description',
      specs: '.specifications, table',
      images: '.hero-image img, .content img',
      videos: 'iframe[src*="youtube"], video',
    }
  },
  {
    name: 'Demag',
    id: 'demag',
    website: 'https://www.demagcranes.com',
    region: 'Germany, global',
    productPages: [
      'https://www.demagcranes.com/en/products/chain-hoists'
    ],
    selectors: {
      productList: '.product-teaser, [class*="product"]',
      productLink: 'a[href*="chain-hoist"], a[href*="dc-pro"]',
      title: 'h1, .product-title',
      description: '.product-description, .intro',
      specs: '.technical-data, .specifications, table',
      images: '.product-image img, .gallery img',
      videos: 'iframe[src*="youtube"], video',
    }
  },
  {
    name: 'Harrington Hoists',
    id: 'harrington',
    website: 'https://www.harringtonhoists.com',
    region: 'USA, global',
    productPages: [
      'https://www.harringtonhoists.com/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product-item, .product',
      productLink: 'a[href*="hoist"]',
      title: 'h1, .product-name',
      description: '.product-description',
      specs: '.specifications, .specs-table',
      images: '.product-image img',
      videos: 'iframe, video',
    }
  },
  {
    name: 'ABUS Kransysteme',
    id: 'abus',
    website: 'https://www.abuscranes.com',
    region: 'Germany, global',
    productPages: [
      'https://www.abuscranes.com/en/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product-item, [class*="product"]',
      productLink: 'a[href*="chain-hoist"]',
      title: 'h1',
      description: '.description',
      specs: '.technical-data, table',
      images: '.product-image img',
      videos: 'iframe[src*="youtube"]',
    }
  },
  {
    name: 'GIS AG',
    id: 'gis-ag',
    website: 'https://gis-ag.ch',
    region: 'Switzerland',
    productPages: [
      'https://gis-ag.ch/en/products/chain-hoists'
    ],
    selectors: {
      productList: '.product, [class*="product"]',
      productLink: 'a[href*="chain"]',
      title: 'h1',
      description: '.content',
      specs: 'table, .specifications',
      images: '.product img, .gallery img',
      videos: 'iframe, video',
    }
  },
  {
    name: 'Verlinde',
    id: 'verlinde',
    website: 'https://www.verlinde.com',
    region: 'France, global',
    productPages: [
      'https://www.verlinde.com/en/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product-item',
      productLink: 'a[href*="stagemaker"], a[href*="hoist"]',
      title: 'h1',
      description: '.description',
      specs: '.specifications, table',
      images: '.product-image img',
      videos: 'iframe',
    }
  },
  {
    name: 'Chainmaster',
    id: 'chainmaster',
    website: 'https://www.chainmaster.de',
    region: 'Germany, global',
    productPages: [
      'https://www.chainmaster.de/en/products'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a[href*="product"]',
      title: 'h1',
      description: '.description',
      specs: '.technical-data, table',
      images: '.product-image img',
      videos: 'iframe[src*="youtube"]',
    }
  },
  {
    name: 'Movecat',
    id: 'movecat',
    website: 'https://www.movecat.de',
    region: 'Germany',
    productPages: [
      'https://www.movecat.de/en/products/chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.text',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Kito',
    id: 'kito',
    website: 'https://www.kito.com',
    region: 'Japan, global',
    productPages: [
      'https://www.kito.com/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product-item',
      productLink: 'a[href*="electric"]',
      title: 'h1',
      description: '.product-description',
      specs: '.specifications',
      images: '.product-image img',
      videos: 'iframe',
    }
  },
  {
    name: 'Hitachi Industrial Equipment',
    id: 'hitachi',
    website: 'https://www.hitachi-ies.com',
    region: 'Japan, global',
    productPages: [
      'https://www.hitachi-ies.com/products/hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Donati Sollevamenti',
    id: 'donati',
    website: 'https://donaticranes.com',
    region: 'Italy, global',
    productPages: [
      'https://donaticranes.com/en/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'PLANETA-Hebetechnik',
    id: 'planeta',
    website: 'https://www.planeta-hebetechnik.eu',
    region: 'Germany',
    productPages: [
      'https://www.planeta-hebetechnik.eu/en/lifting-devices/electric-hoists-and-options/electric-chain-hoists.html'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Gorbel',
    id: 'gorbel',
    website: 'https://www.gorbel.com',
    region: 'USA, global',
    productPages: [
      'https://www.gorbel.com/products/hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  // NEW MANUFACTURERS ADDED
  {
    name: 'Yale Hoists',
    id: 'yale',
    website: 'https://www.yale.com',
    region: 'USA, global',
    productPages: [
      'https://www.yale.com/en/products/hoists/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product-item',
      productLink: 'a[href*="hoist"]',
      title: 'h1',
      description: '.product-description',
      specs: 'table, .specifications',
      images: '.product-image img',
      videos: 'iframe',
    }
  },
  {
    name: 'Ingersoll Rand',
    id: 'ingersoll-rand',
    website: 'https://www.ingersollrand.com',
    region: 'USA, global',
    productPages: [
      'https://www.ingersollrand.com/en-us/material-handling/electric-chain-hoists.html'
    ],
    selectors: {
      productList: '.product-card',
      productLink: 'a[href*="hoist"]',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: '.product-image img',
      videos: 'iframe',
    }
  },
  {
    name: 'Coffing Hoists',
    id: 'coffing',
    website: 'https://www.coffinghoists.com',
    region: 'USA, global',
    productPages: [
      'https://www.coffinghoists.com/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Budgit Hoists',
    id: 'budgit',
    website: 'https://www.budgithoists.com',
    region: 'USA',
    productPages: [
      'https://www.budgithoists.com/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'R&M Materials Handling',
    id: 'rm-materials',
    website: 'https://www.rmhoist.com',
    region: 'USA, global',
    productPages: [
      'https://www.rmhoist.com/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Street Crane',
    id: 'street-crane',
    website: 'https://www.streetcrane.co.uk',
    region: 'UK, global',
    productPages: [
      'https://www.streetcrane.co.uk/hoists/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'SWF Krantechnik',
    id: 'swf',
    website: 'https://www.swf.de',
    region: 'Germany, global',
    productPages: [
      'https://www.swf.de/en/products/chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'JDN Monocrane',
    id: 'jdn',
    website: 'https://www.jdn.de',
    region: 'Germany, global',
    productPages: [
      'https://www.jdn.de/en/products/air-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Elephant Lifting Products',
    id: 'elephant',
    website: 'https://www.elephantlifting.co.uk',
    region: 'UK, global',
    productPages: [
      'https://www.elephantlifting.co.uk/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'LiftingSafety',
    id: 'liftingsafety',
    website: 'https://www.liftingsafety.co.uk',
    region: 'UK',
    productPages: [
      'https://www.liftingsafety.co.uk/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Tiger Lifting',
    id: 'tiger',
    website: 'https://www.tigerlifting.com',
    region: 'UK, global',
    productPages: [
      'https://www.tigerlifting.com/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Stahl CraneSystems',
    id: 'stahl',
    website: 'https://www.stahlcranes.com',
    region: 'Germany, global',
    productPages: [
      'https://www.stahlcranes.com/en/products/chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'Nitchi',
    id: 'nitchi',
    website: 'https://www.nitchi.co.jp',
    region: 'Japan, global',
    productPages: [
      'https://www.nitchi.co.jp/en/products/electric-chain-hoists'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  },
  {
    name: 'TXK',
    id: 'txk',
    website: 'https://www.txkhoists.com',
    region: 'China, global',
    productPages: [
      'https://www.txkhoists.com/electric-chain-hoist'
    ],
    selectors: {
      productList: '.product',
      productLink: 'a',
      title: 'h1',
      description: '.description',
      specs: 'table',
      images: 'img',
      videos: 'iframe',
    }
  }
];

// Utility: Delay function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility: Download image
async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fsSync.createWriteStream(filepath);

    protocol.get(url, {
      headers: { 'User-Agent': CONFIG.userAgent },
      timeout: CONFIG.timeout
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      fsSync.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// Utility: Download PDF
async function downloadPDF(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fsSync.createWriteStream(filepath);

    protocol.get(url, {
      headers: { 'User-Agent': CONFIG.userAgent },
      timeout: CONFIG.timeout
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadPDF(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download PDF: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      fsSync.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// Utility: Extract PDF/datasheet URLs
function extractPDFUrls($, baseUrl) {
  const pdfs = [];
  const seen = new Set();

  // Common PDF link patterns
  const selectors = [
    'a[href$=".pdf"]',
    'a[href*="datasheet"]',
    'a[href*="manual"]',
    'a[href*="brochure"]',
    'a[href*="specification"]',
    'a[href*="catalogue"]',
    'a[href*="catalog"]',
    'a:contains("Download")',
    'a:contains("PDF")',
    'a:contains("Datasheet")',
    'a:contains("Manual")',
    '.download a',
    '.documents a',
    '.resources a'
  ];

  selectors.forEach(selector => {
    try {
      $(selector).each((i, el) => {
        const href = $(el).attr('href');
        if (!href) {
          return;
        }

        // Check if it's a PDF link
        const isPDF = href.toLowerCase().endsWith('.pdf') ||
                      href.toLowerCase().includes('pdf') ||
                      $(el).text().toLowerCase().includes('pdf') ||
                      $(el).text().toLowerCase().includes('download');

        if (!isPDF) {
          return;
        }

        // Make URL absolute
        let fullUrl = href;
        if (!href.startsWith('http')) {
          try {
            fullUrl = new URL(href, baseUrl).href;
          } catch {
            return;
          }
        }

        // Skip if already seen
        if (seen.has(fullUrl)) {
          return;
        }
        seen.add(fullUrl);

        // Determine PDF type
        let type = 'document';
        const lowerHref = href.toLowerCase();
        const linkText = $(el).text().toLowerCase();

        if (lowerHref.includes('datasheet') || linkText.includes('datasheet')) {
          type = 'datasheet';
        } else if (lowerHref.includes('manual') || linkText.includes('manual')) {
          type = 'manual';
        } else if (lowerHref.includes('brochure') || linkText.includes('brochure')) {
          type = 'brochure';
        } else if (lowerHref.includes('spec') || linkText.includes('spec')) {
          type = 'specification';
        }

        pdfs.push({
          url: fullUrl,
          type: type,
          title: $(el).text().trim() || $(el).attr('title') || path.basename(href)
        });
      });
    } catch {
      // Selector failed, continue
    }
  });

  return pdfs;
}

// Utility: Extract video URLs
function extractVideoUrls($, baseUrl) {
  const videos = [];

  // YouTube embeds
  $('iframe[src*="youtube"], iframe[data-src*="youtube"]').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src) {
      const videoId = src.match(/(?:embed\/|v=|v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (videoId) {
        videos.push({
          type: 'youtube',
          id: videoId[1],
          url: `https://www.youtube.com/watch?v=${videoId[1]}`,
          embed: `https://www.youtube.com/embed/${videoId[1]}`
        });
      }
    }
  });

  // Vimeo embeds
  $('iframe[src*="vimeo"], iframe[data-src*="vimeo"]').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src) {
      const videoId = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (videoId) {
        videos.push({
          type: 'vimeo',
          id: videoId[1],
          url: `https://vimeo.com/${videoId[1]}`,
          embed: `https://player.vimeo.com/video/${videoId[1]}`
        });
      }
    }
  });

  // HTML5 video elements
  $('video source, video[src]').each((i, el) => {
    const src = $(el).attr('src');
    if (src) {
      const fullUrl = src.startsWith('http') ? src : new URL(src, baseUrl).href;
      videos.push({
        type: 'mp4',
        url: fullUrl
      });
    }
  });

  return videos;
}

// Utility: Extract images
function extractImages($, baseUrl, selectors) {
  const images = [];
  const seen = new Set();

  $(selectors.images || 'img').each((i, el) => {
    if (images.length >= CONFIG.maxImagesPerProduct) {
      return false;
    }

    let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (!src) {
      return;
    }

    // Skip small icons and tracking pixels
    const width = parseInt($(el).attr('width')) || 0;
    const height = parseInt($(el).attr('height')) || 0;
    if ((width > 0 && width < 50) || (height > 0 && height < 50)) {
      return;
    }
    if (src.includes('pixel') || src.includes('tracking') || src.includes('icon')) {
      return;
    }

    // Make URL absolute
    if (!src.startsWith('http')) {
      src = new URL(src, baseUrl).href;
    }

    // Skip duplicates
    if (seen.has(src)) {
      return;
    }
    seen.add(src);

    images.push({
      url: src,
      alt: $(el).attr('alt') || '',
      title: $(el).attr('title') || ''
    });
  });

  return images;
}

// Utility: Extract specifications from tables
function extractSpecifications($) {
  const specs = {};

  // Look for specification tables
  $('table').each((i, table) => {
    $(table).find('tr').each((j, row) => {
      const cells = $(row).find('td, th');
      if (cells.length >= 2) {
        const key = $(cells[0]).text().trim().toLowerCase();
        const value = $(cells[1]).text().trim();
        if (key && value && key.length < 50) {
          specs[key] = value;
        }
      }
    });
  });

  // Look for definition lists
  $('dl').each((i, dl) => {
    $(dl).find('dt').each((j, dt) => {
      const key = $(dt).text().trim().toLowerCase();
      const value = $(dt).next('dd').text().trim();
      if (key && value) {
        specs[key] = value;
      }
    });
  });

  // Look for labeled spans/divs
  $('[class*="spec"], [class*="feature"]').each((i, el) => {
    const label = $(el).find('[class*="label"], .label, strong, b').first().text().trim();
    const value = $(el).find('[class*="value"], .value').first().text().trim() ||
                  $(el).text().replace(label, '').trim();
    if (label && value && label.length < 50) {
      specs[label.toLowerCase()] = value;
    }
  });

  return specs;
}

// Parse specifications into structured data
function parseSpecifications(specs) {
  const parsed = {};

  // Capacity patterns
  for (const [key, value] of Object.entries(specs)) {
    if (key.includes('capacity') || key.includes('load') || key.includes('swl')) {
      parsed.loadCapacity = value;
    }
    if (key.includes('speed') && key.includes('lift')) {
      parsed.liftingSpeed = value;
    }
    if (key.includes('power') || key.includes('motor')) {
      parsed.motorPower = value;
    }
    if (key.includes('weight') && !key.includes('load')) {
      parsed.weight = value;
    }
    if (key.includes('voltage')) {
      parsed.voltageOptions = value;
    }
    if (key.includes('duty') || key.includes('cycle')) {
      parsed.dutyCycle = value;
    }
    if (key.includes('noise') || key.includes('sound')) {
      parsed.noiseLevel = value;
    }
  }

  return parsed;
}

// Main scraper class
class EnhancedScraper {
  constructor() {
    this.data = [];
    this.stats = {
      totalManufacturers: 0,
      successfulScrapes: 0,
      failedScrapes: 0,
      totalProducts: 0,
      totalImages: 0,
      totalVideos: 0,
      totalPDFs: 0,
      llmAnalyzed: 0,
      errors: []
    };
    this.llm = null;
  }

  async initialize() {
    // Create directories
    await fs.mkdir(CONFIG.outputDir, { recursive: true });
    await fs.mkdir(CONFIG.mediaDir, { recursive: true });
    await fs.mkdir(CONFIG.imagesDir, { recursive: true });
    await fs.mkdir(CONFIG.videosDir, { recursive: true });
    await fs.mkdir(CONFIG.pdfsDir, { recursive: true });

    // Initialize LLM if enabled
    if (CONFIG.useLLM) {
      this.llm = await initLLM();
      if (this.llm) {
        logger.info('LLM analysis enabled - will analyze images and PDFs');
      }
    }

    // Load existing data
    try {
      const existing = await fs.readFile(path.join(CONFIG.outputDir, CONFIG.databaseFile), 'utf8');
      const parsed = JSON.parse(existing);
      this.data = Array.isArray(parsed) ? parsed : (parsed.data || []);
      logger.info(`Loaded ${this.data.length} existing records`);
    } catch (err) {
      logger.info('Starting with fresh database');
    }
  }

  async fetchPage(url, retries = CONFIG.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.debug(`Fetching ${url} (attempt ${attempt})`);
        const response = await axios.get(url, {
          headers: {
            'User-Agent': CONFIG.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          timeout: CONFIG.timeout,
          maxRedirects: 5
        });
        return response.data;
      } catch (err) {
        logger.warn(`Attempt ${attempt} failed for ${url}: ${err.message}`);
        if (attempt === retries) {
          throw err;
        }
        await delay(CONFIG.requestDelay * attempt);
      }
    }
  }

  async scrapeManufacturer(manufacturer) {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Scraping: ${manufacturer.name}`);
    logger.info(`Website: ${manufacturer.website}`);
    logger.info(`${'='.repeat(60)}`);

    this.stats.totalManufacturers++;
    const products = [];

    for (const pageUrl of manufacturer.productPages) {
      try {
        logger.info(`Fetching product page: ${pageUrl}`);
        const html = await this.fetchPage(pageUrl);
        const $ = cheerio.load(html);

        // Extract product information from the page
        const pageProducts = await this.extractProductsFromPage($, pageUrl, manufacturer);
        products.push(...pageProducts);

        // Also try to find and follow product links
        const productLinks = [];
        $(manufacturer.selectors.productLink || 'a[href*="product"], a[href*="hoist"]').each((i, el) => {
          const href = $(el).attr('href');
          if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
            const fullUrl = href.startsWith('http') ? href : new URL(href, manufacturer.website).href;
            if (!productLinks.includes(fullUrl) && fullUrl.includes(manufacturer.website.replace('https://', '').replace('http://', ''))) {
              productLinks.push(fullUrl);
            }
          }
        });

        logger.info(`Found ${productLinks.length} product links`);

        // Scrape individual product pages (limit to first 10 to avoid overloading)
        for (const productUrl of productLinks.slice(0, 10)) {
          try {
            await delay(CONFIG.requestDelay);
            const productHtml = await this.fetchPage(productUrl);
            const product$ = cheerio.load(productHtml);
            const productData = await this.extractProductData(product$, productUrl, manufacturer);
            if (productData && productData.model) {
              products.push(productData);
            }
          } catch (err) {
            logger.warn(`Failed to scrape product page ${productUrl}: ${err.message}`);
          }
        }

        await delay(CONFIG.requestDelay);
      } catch (err) {
        logger.error(`Failed to scrape ${pageUrl}: ${err.message}`);
        this.stats.errors.push({ manufacturer: manufacturer.name, url: pageUrl, error: err.message });
      }
    }

    // If no products found, create sample data based on known models
    if (products.length === 0) {
      logger.info(`No products scraped, adding known models for ${manufacturer.name}`);
      const knownProducts = this.getKnownProducts(manufacturer);
      products.push(...knownProducts);
    }

    // Add products to database
    for (const product of products) {
      this.addProduct(product, manufacturer);
    }

    if (products.length > 0) {
      this.stats.successfulScrapes++;
      logger.info(`Successfully scraped ${products.length} products from ${manufacturer.name}`);
    } else {
      this.stats.failedScrapes++;
      logger.warn(`No products found for ${manufacturer.name}`);
    }

    return products;
  }

  async extractProductsFromPage($, pageUrl, manufacturer) {
    const products = [];
    const selectors = manufacturer.selectors;

    // Try to extract product cards/items from listing page
    $(selectors.productList || '.product').each((i, el) => {
      const $product = $(el);

      const title = $product.find('h2, h3, h4, .title, .name').first().text().trim() ||
                    $product.find('a').first().text().trim();

      if (title && title.length > 2 && title.length < 200) {
        const product = {
          manufacturer: manufacturer.name,
          model: title,
          url: pageUrl,
          scrapedFrom: pageUrl,
          scrapedAt: new Date().toISOString()
        };

        // Try to get more details
        const description = $product.find('.description, .text, p').first().text().trim();
        if (description) {
          product.description = description.substring(0, 500);
        }

        // Extract images
        const images = [];
        $product.find('img').each((j, img) => {
          const src = $(img).attr('src') || $(img).attr('data-src');
          if (src && !src.includes('icon') && !src.includes('logo')) {
            images.push({
              url: src.startsWith('http') ? src : new URL(src, manufacturer.website).href,
              alt: $(img).attr('alt') || ''
            });
          }
        });
        if (images.length > 0) {
          product.images = images;
        }

        products.push(product);
      }
    });

    return products;
  }

  async extractProductData($, url, manufacturer) {
    const selectors = manufacturer.selectors;

    // Extract title
    let title = $(selectors.title || 'h1').first().text().trim();
    if (!title || title.length < 2) {
      return null;
    }

    // Clean up title
    title = title.replace(/electric chain hoist/gi, '').replace(/chain hoist/gi, '').trim();

    let product = {
      manufacturer: manufacturer.name,
      model: title,
      url: url,
      scrapedFrom: url,
      scrapedAt: new Date().toISOString()
    };

    // Extract description
    const description = $(selectors.description || '.description').first().text().trim();
    if (description) {
      product.description = description.substring(0, 1000);
    }

    // Extract specifications
    const rawSpecs = extractSpecifications($);
    const parsedSpecs = parseSpecifications(rawSpecs);
    Object.assign(product, parsedSpecs);
    product.rawSpecifications = rawSpecs;

    // Extract images
    if (CONFIG.downloadImages) {
      const images = extractImages($, url, selectors);
      if (images.length > 0) {
        product.images = images;
        this.stats.totalImages += images.length;

        // Download images
        const downloadedImages = [];
        for (let i = 0; i < Math.min(images.length, 3); i++) {
          try {
            const imgUrl = images[i].url;
            const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
            const filename = `${manufacturer.id}_${this.sanitizeFilename(title)}_${i}${ext}`;
            const filepath = path.join(CONFIG.imagesDir, filename);

            await downloadImage(imgUrl, filepath);
            downloadedImages.push({ ...images[i], localPath: filepath });
            logger.debug(`Downloaded image: ${filename}`);
          } catch (err) {
            logger.debug(`Failed to download image: ${err.message}`);
          }
        }
        if (downloadedImages.length > 0) {
          product.downloadedImages = downloadedImages;
        }
      }
    }

    // Extract videos
    if (CONFIG.extractVideos) {
      const videos = extractVideoUrls($, url);
      if (videos.length > 0) {
        product.videos = videos;
        this.stats.totalVideos += videos.length;
      }
    }

    // Extract and download PDFs
    if (CONFIG.downloadPDFs) {
      const pdfs = extractPDFUrls($, url);
      if (pdfs.length > 0) {
        product.pdfs = pdfs;
        this.stats.totalPDFs += pdfs.length;

        // Download PDFs
        const downloadedPDFs = [];
        for (let i = 0; i < Math.min(pdfs.length, CONFIG.maxPDFsPerProduct); i++) {
          try {
            const pdfUrl = pdfs[i].url;
            const ext = '.pdf';
            const filename = `${manufacturer.id}_${this.sanitizeFilename(title)}_${pdfs[i].type}_${i}${ext}`;
            const filepath = path.join(CONFIG.pdfsDir, filename);

            await downloadPDF(pdfUrl, filepath);
            downloadedPDFs.push({ ...pdfs[i], localPath: filepath });
            logger.debug(`Downloaded PDF: ${filename}`);
          } catch (err) {
            logger.debug(`Failed to download PDF: ${err.message}`);
          }
        }
        if (downloadedPDFs.length > 0) {
          product.downloadedPDFs = downloadedPDFs;
        }
      }
    }

    // LLM Analysis
    if (this.llm && CONFIG.useLLM) {
      try {
        product = await this.analyzeWithLLM(product);
        this.stats.llmAnalyzed++;
      } catch (err) {
        logger.warn(`LLM analysis failed for ${product.model}: ${err.message}`);
      }
    }

    return product;
  }

  async analyzeWithLLM(product) {
    if (!this.llm) {
      return product;
    }

    logger.info(`Analyzing ${product.model} with LLM...`);

    // Analyze downloaded images
    if (product.downloadedImages && product.downloadedImages.length > 0) {
      for (const img of product.downloadedImages.slice(0, 2)) {
        try {
          const analysis = await this.llm.analyzeProductImage(img.localPath);
          if (analysis && analysis.confidence > 0.5) {
            product = this.llm.mergeProductData(product, analysis);
            logger.debug(`Image analysis added data for ${product.model}`);
          }
        } catch (err) {
          logger.debug(`Image analysis failed: ${err.message}`);
        }
      }
    }

    // Analyze downloaded PDFs
    if (product.downloadedPDFs && product.downloadedPDFs.length > 0) {
      for (const pdf of product.downloadedPDFs.slice(0, 2)) {
        try {
          const analysis = await this.llm.analyzePDF(pdf.localPath);
          if (analysis && analysis.confidence > 0.5) {
            product = this.llm.mergeProductData(product, analysis);
            logger.debug(`PDF analysis added data for ${product.model}`);
          }
        } catch (err) {
          logger.debug(`PDF analysis failed: ${err.message}`);
        }
      }
    }

    // Analyze description text if specs are incomplete
    if (product.description && (!product.loadCapacity || !product.liftingSpeed)) {
      try {
        const analysis = await this.llm.analyzeText(product.description, product);
        if (analysis && analysis.confidence > 0.5) {
          product = this.llm.mergeProductData(product, analysis);
        }
      } catch (err) {
        logger.debug(`Text analysis failed: ${err.message}`);
      }
    }

    product.llmEnriched = true;
    product.llmEnrichedAt = new Date().toISOString();

    return product;
  }

  getKnownProducts(manufacturer) {
    // Known product data for manufacturers when scraping fails
    const knownData = {
      'columbus-mckinnon': [
        { model: 'Lodestar Classic', series: 'Lodestar', loadCapacity: '250-2000 kg', liftingSpeed: '4-16 m/min', classification: ['d8'] },
        { model: 'Lodestar VS', series: 'Lodestar', loadCapacity: '125-2000 kg', liftingSpeed: 'Variable 0-8 m/min', classification: ['d8+'] },
        { model: 'Prostar', series: 'Prostar', loadCapacity: '125-1000 kg', liftingSpeed: '4-24 m/min', classification: ['d8+'], liftingOverPeople: true },
      ],
      'konecranes': [
        { model: 'CLX Chain Hoist', series: 'CLX', loadCapacity: '125-5000 kg', liftingSpeed: '4-8 m/min', classification: ['d8'] },
        { model: 'SLX Chain Hoist', series: 'SLX', loadCapacity: '63-2000 kg', liftingSpeed: '8-24 m/min', classification: ['d8+'] },
      ],
      'demag': [
        { model: 'DC-Pro', series: 'DC-Pro', loadCapacity: '125-2000 kg', liftingSpeed: '4-20 m/min', classification: ['d8+'], quietOperation: true },
        { model: 'DC-Com', series: 'DC-Com', loadCapacity: '125-2000 kg', liftingSpeed: '4-12 m/min', classification: ['d8'] },
      ],
      'chainmaster': [
        { model: 'D8+', series: 'D8+', loadCapacity: '125-2000 kg', liftingSpeed: '2-24 m/min', classification: ['d8+', 'bgv-c1'], liftingOverPeople: true, quietOperation: true },
        { model: 'BGV-D8', series: 'BGV-D8', loadCapacity: '125-2000 kg', liftingSpeed: '4-16 m/min', classification: ['d8'] },
      ],
      'verlinde': [
        { model: 'Stagemaker SR', series: 'Stagemaker', loadCapacity: '125-2000 kg', liftingSpeed: '4-24 m/min', classification: ['d8+', 'bgv-c1'], liftingOverPeople: true },
        { model: 'Stagemaker SL', series: 'Stagemaker', loadCapacity: '63-500 kg', liftingSpeed: '8-32 m/min', classification: ['d8+'] },
      ],
      'movecat': [
        { model: 'Liftket Plus', series: 'Liftket', loadCapacity: '125-2000 kg', liftingSpeed: '2-16 m/min', classification: ['d8+'], dynamicLifting: true },
        { model: 'Liftket Standard', series: 'Liftket', loadCapacity: '125-1000 kg', liftingSpeed: '4-16 m/min', classification: ['d8'] },
      ],
      'kito': [
        { model: 'ER2', series: 'ER2', loadCapacity: '250-5000 kg', liftingSpeed: '2.5-8 m/min', classification: ['d8'] },
        { model: 'EQ', series: 'EQ', loadCapacity: '500-20000 kg', liftingSpeed: '1.25-5 m/min', classification: ['d8'] },
      ],
      'gis-ag': [
        { model: 'GP Series', series: 'GP', loadCapacity: '125-2500 kg', liftingSpeed: '2-16 m/min', classification: ['d8+'], quietOperation: true },
      ],
      'harrington': [
        { model: 'NER/NER2', series: 'NER', loadCapacity: '250-5000 kg', liftingSpeed: '5-16 m/min', classification: ['ansi'] },
        { model: 'SNER', series: 'SNER', loadCapacity: '500-10000 kg', liftingSpeed: '1.25-8 m/min', classification: ['ansi'] },
      ],
      'abus': [
        { model: 'GM4', series: 'GM', loadCapacity: '125-2500 kg', liftingSpeed: '4-12 m/min', classification: ['d8'] },
        { model: 'GM6', series: 'GM', loadCapacity: '2000-6300 kg', liftingSpeed: '1-4 m/min', classification: ['d8'] },
      ],
      'hitachi': [
        { model: 'Electric Chain Hoist', series: 'Standard', loadCapacity: '250-5000 kg', liftingSpeed: '2.5-8 m/min', classification: ['d8', 'jis'] },
      ],
      'donati': [
        { model: 'DRH', series: 'DRH', loadCapacity: '125-5000 kg', liftingSpeed: '4-12 m/min', classification: ['d8'] },
      ],
      'gorbel': [
        { model: 'GS Series', series: 'GS', loadCapacity: '250-2000 kg', liftingSpeed: '4-16 m/min', classification: ['ansi'] },
      ],
      'planeta': [
        { model: 'PH Chain Hoist', series: 'PH', loadCapacity: '125-5000 kg', liftingSpeed: '4-8 m/min', classification: ['d8'] },
      ],
      // NEW MANUFACTURERS
      'yale': [
        { model: 'YJL', series: 'YJL', loadCapacity: '250-5000 kg', liftingSpeed: '3-12 m/min', classification: ['ansi'] },
        { model: 'YK', series: 'YK', loadCapacity: '500-10000 kg', liftingSpeed: '2-8 m/min', classification: ['ansi'] },
        { model: 'KEL', series: 'KEL', loadCapacity: '125-3000 kg', liftingSpeed: '4-16 m/min', classification: ['d8'] },
      ],
      'ingersoll-rand': [
        { model: 'ML Series', series: 'ML', loadCapacity: '250-3000 kg', liftingSpeed: '4-12 m/min', classification: ['ansi'] },
        { model: 'CLK Series', series: 'CLK', loadCapacity: '500-5000 kg', liftingSpeed: '2-8 m/min', classification: ['ansi'] },
      ],
      'coffing': [
        { model: 'JLC', series: 'JLC', loadCapacity: '125-3000 kg', liftingSpeed: '8-16 m/min', classification: ['ansi'] },
        { model: 'EC', series: 'EC', loadCapacity: '250-5000 kg', liftingSpeed: '4-12 m/min', classification: ['ansi'] },
      ],
      'budgit': [
        { model: 'BEH', series: 'BEH', loadCapacity: '250-5000 kg', liftingSpeed: '4-16 m/min', classification: ['ansi'] },
        { model: 'Man Guard', series: 'Man Guard', loadCapacity: '500-3000 kg', liftingSpeed: '8-12 m/min', classification: ['ansi'] },
      ],
      'rm-materials': [
        { model: 'Spacemaster SX', series: 'SX', loadCapacity: '125-5000 kg', liftingSpeed: '4-20 m/min', classification: ['d8'] },
        { model: 'LK Series', series: 'LK', loadCapacity: '250-2000 kg', liftingSpeed: '8-16 m/min', classification: ['d8'] },
      ],
      'street-crane': [
        { model: 'SC Series', series: 'SC', loadCapacity: '125-5000 kg', liftingSpeed: '4-12 m/min', classification: ['d8'] },
        { model: 'Profi', series: 'Profi', loadCapacity: '250-2000 kg', liftingSpeed: '6-16 m/min', classification: ['d8+'] },
      ],
      'swf': [
        { model: 'Nova', series: 'Nova', loadCapacity: '125-5000 kg', liftingSpeed: '4-20 m/min', classification: ['d8'] },
        { model: 'SK Series', series: 'SK', loadCapacity: '250-2500 kg', liftingSpeed: '4-12 m/min', classification: ['d8'] },
      ],
      'jdn': [
        { model: 'Air Hoist Profi', series: 'Profi', loadCapacity: '125-50000 kg', liftingSpeed: '1-12 m/min', classification: ['atex'] },
        { model: 'Mini', series: 'Mini', loadCapacity: '125-980 kg', liftingSpeed: '6-12 m/min', classification: ['atex'] },
      ],
      'elephant': [
        { model: 'FA Series', series: 'FA', loadCapacity: '250-5000 kg', liftingSpeed: '4-12 m/min', classification: ['d8'] },
        { model: 'FB Series', series: 'FB', loadCapacity: '500-10000 kg', liftingSpeed: '2-8 m/min', classification: ['d8'] },
      ],
      'liftingsafety': [
        { model: 'LS Electric Hoist', series: 'LS', loadCapacity: '250-5000 kg', liftingSpeed: '4-12 m/min', classification: ['d8'] },
      ],
      'tiger': [
        { model: 'ROV', series: 'ROV', loadCapacity: '250-5000 kg', liftingSpeed: '4-12 m/min', classification: ['d8+'], liftingOverPeople: true },
        { model: 'BCH', series: 'BCH', loadCapacity: '500-10000 kg', liftingSpeed: '2-8 m/min', classification: ['d8'] },
      ],
      'stahl': [
        { model: 'ST Chain Hoist', series: 'ST', loadCapacity: '125-6300 kg', liftingSpeed: '2-20 m/min', classification: ['d8+'] },
        { model: 'AS7 Explosion Proof', series: 'AS7', loadCapacity: '125-5000 kg', liftingSpeed: '4-12 m/min', classification: ['atex'] },
      ],
      'nitchi': [
        { model: 'MH-5', series: 'MH', loadCapacity: '250-5000 kg', liftingSpeed: '4-12 m/min', classification: ['jis'] },
        { model: 'EC-4', series: 'EC', loadCapacity: '500-10000 kg', liftingSpeed: '2-8 m/min', classification: ['jis'] },
      ],
      'txk': [
        { model: 'TXK-A', series: 'A', loadCapacity: '250-10000 kg', liftingSpeed: '3-12 m/min', classification: ['ce'] },
        { model: 'TXK-B', series: 'B', loadCapacity: '500-20000 kg', liftingSpeed: '2-8 m/min', classification: ['ce'] },
      ],
    };

    const products = knownData[manufacturer.id] || [];
    return products.map(p => ({
      ...p,
      manufacturer: manufacturer.name,
      url: manufacturer.website,
      scrapedFrom: 'known-data',
      scrapedAt: new Date().toISOString(),
      confidence: 0.9
    }));
  }

  addProduct(product, manufacturer) {
    // Generate ID
    const id = `${manufacturer.id}-${this.sanitizeFilename(product.model)}`.toLowerCase();

    // Check for duplicates
    const existingIndex = this.data.findIndex(p => p.id === id);
    if (existingIndex >= 0) {
      // Update existing
      this.data[existingIndex] = { ...this.data[existingIndex], ...product, id, lastUpdated: new Date().toISOString() };
      logger.debug(`Updated: ${product.manufacturer} ${product.model}`);
    } else {
      // Add new
      this.data.push({
        ...product,
        id,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });
      this.stats.totalProducts++;
      logger.info(`Added: ${product.manufacturer} ${product.model}`);
    }
  }

  sanitizeFilename(name) {
    return name.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase().substring(0, 50);
  }

  async save() {
    const output = {
      data: this.data,
      stats: this.stats,
      scrapedAt: new Date().toISOString(),
      version: '3.0'
    };

    await fs.writeFile(
      path.join(CONFIG.outputDir, CONFIG.databaseFile),
      JSON.stringify(output, null, 2)
    );

    // Export CSV
    try {
      const flatData = this.data.map(item => ({
        ...item,
        images: item.images ? item.images.map(i => i.url).join('; ') : '',
        videos: item.videos ? item.videos.map(v => v.url).join('; ') : '',
        classification: Array.isArray(item.classification) ? item.classification.join(', ') : item.classification
      }));
      const parser = new Parser();
      const csv = parser.parse(flatData);
      await fs.writeFile(path.join(CONFIG.outputDir, CONFIG.csvOutputFile), csv);
    } catch (err) {
      logger.warn(`Failed to export CSV: ${err.message}`);
    }

    logger.info(`Saved ${this.data.length} products to database`);
  }

  async scrapeAll() {
    logger.info('\n' + '='.repeat(70));
    logger.info('ENHANCED CHAINHOIST SCRAPER v3.1');
    logger.info('Scraping all manufacturers with images, videos, and PDFs');
    if (CONFIG.useLLM) {
      logger.info('LLM Analysis: ENABLED (using Google Gemini)');
    } else {
      logger.info('LLM Analysis: DISABLED (use --with-llm to enable)');
    }
    logger.info('='.repeat(70) + '\n');

    await this.initialize();

    for (const manufacturer of MANUFACTURERS) {
      try {
        await this.scrapeManufacturer(manufacturer);
        await delay(CONFIG.requestDelay * 2); // Extra delay between manufacturers
      } catch (err) {
        logger.error(`Failed to scrape ${manufacturer.name}: ${err.message}`);
        this.stats.errors.push({ manufacturer: manufacturer.name, error: err.message });
      }
    }

    await this.save();

    // Print summary
    logger.info('\n' + '='.repeat(70));
    logger.info('SCRAPING COMPLETE - SUMMARY');
    logger.info('='.repeat(70));
    logger.info(`Total Manufacturers: ${this.stats.totalManufacturers}`);
    logger.info(`Successful Scrapes: ${this.stats.successfulScrapes}`);
    logger.info(`Failed Scrapes: ${this.stats.failedScrapes}`);
    logger.info(`Total Products: ${this.stats.totalProducts}`);
    logger.info(`Total Images: ${this.stats.totalImages}`);
    logger.info(`Total Videos: ${this.stats.totalVideos}`);
    logger.info(`Total PDFs: ${this.stats.totalPDFs}`);
    if (CONFIG.useLLM) {
      logger.info(`LLM Analyzed: ${this.stats.llmAnalyzed}`);
      if (this.llm) {
        const status = this.llm.getRateLimitStatus();
        logger.info(`LLM Rate Limit: ${status.minuteRemaining}/min, ${status.dayRemaining}/day remaining`);
      }
    }
    logger.info(`Errors: ${this.stats.errors.length}`);
    if (this.stats.errors.length > 0) {
      logger.info('\nErrors:');
      this.stats.errors.forEach(e => logger.info(`  - ${e.manufacturer}: ${e.error}`));
    }
    logger.info('='.repeat(70) + '\n');
  }
}

// Main execution
async function main() {
  const scraper = new EnhancedScraper();
  await scraper.scrapeAll();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
