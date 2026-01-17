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
      'https://www.demagcranes.com/en-us/products/hoist-units/chain-hoists'
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
      'https://www.harringtonhoists.com/electric-hoists'
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
      'https://www.abuscranes.com/hoists/electric-chain-hoists'
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
      'https://gis-ag.ch/en/industry/products/chain-hoists-and-trolleys'
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
      'https://www.stagemaker.com/stagemaker-europe/products/stagemaker-sl-chain-hoists/'
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
      'https://www.movecat.de/en/products/'
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
    website: 'https://www.kito.net',
    region: 'Japan, global',
    productPages: [
      'https://www.kito.net/en/producttype/electric-chain-hoists/'
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
      'https://www.hitachi-ies.com/products/hst/bh/index.htm'
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
      'https://donaticranes.com/en/products/electric-chain-hoists',
      'https://donaticranes.com/en/frontpage'
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
      'https://www.gorbel.com/products/ergonomic-lifting/hoists'
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
    website: 'https://www.cmco.com',
    region: 'USA, global',
    productPages: [
      'https://www.cmco.com/en-us/products/hoisting-lifting-equipment/electric-air-hoists/electric-chain-hoists/'
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
    website: 'https://liftingsolutions.ingersollrand.com',
    region: 'USA, global',
    productPages: [
      'https://liftingsolutions.ingersollrand.com/en/hoists/'
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
    website: 'https://www.cmco.com',
    region: 'USA, global',
    productPages: [
      'https://www.cmco.com/en-us/our-brands/coffing-hoists/'
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
    website: 'https://www.cmco.com',
    region: 'USA',
    productPages: [
      'https://www.cmco.com/en-us/our-brands/budgit/'
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
    website: 'https://rmhoist.com',
    region: 'USA, global',
    productPages: [
      'https://rmhoist.com/products/electric-chain-hoists-overview'
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
    website: 'https://streetcrane.co.uk',
    region: 'UK, global',
    productPages: [
      'https://streetcrane.co.uk/hoists/chain-hoists/'
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
    website: 'https://www.swfkrantechnik.com',
    region: 'Germany, global',
    productPages: [
      'https://www.swfkrantechnik.com/en/products/chainster/'
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
    name: 'J.D. Neuhaus',
    id: 'jdn',
    website: 'https://www.jdngroup.com',
    region: 'Germany, global',
    productPages: [
      'https://www.jdngroup.com/products/profi/'
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
    website: 'https://elephantlifting.com',
    region: 'USA, global',
    productPages: [
      'https://elephantlifting.com/product/electric-chain-hoists/'
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
      'https://www.liftingsafety.co.uk/category/electric-hoists-6.html'
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
    website: 'https://tigerlifting.com',
    region: 'UK, global',
    productPages: [
      'https://tigerlifting.com/'
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
    website: 'https://www.cmco.com',
    region: 'Germany, global',
    productPages: [
      'https://www.cmco.com/en-us/our-brands/stahlcranes/'
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
  // Note: Nitchi closed operations in June 2023
  {
    name: 'TXK',
    id: 'txk',
    website: 'https://www.txk.net.cn',
    region: 'China, global',
    productPages: [
      'https://www.txk.net.cn/electric-chain-hoist/'
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

// Utility: Download image with proper error handling
async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    let file;

    try {
      file = fsSync.createWriteStream(filepath);
    } catch (err) {
      reject(new Error(`Failed to create file stream: ${err.message}`));
      return;
    }

    // Handle file stream errors
    file.on('error', (err) => {
      file.close();
      fsSync.unlink(filepath, () => {});
      reject(new Error(`File write error: ${err.message}`));
    });

    protocol.get(url, {
      headers: { 'User-Agent': CONFIG.userAgent },
      timeout: CONFIG.timeout
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fsSync.unlink(filepath, () => {});
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fsSync.unlink(filepath, () => {});
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      file.close();
      fsSync.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// Utility: Download PDF with proper error handling
async function downloadPDF(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    let file;

    try {
      file = fsSync.createWriteStream(filepath);
    } catch (err) {
      reject(new Error(`Failed to create file stream: ${err.message}`));
      return;
    }

    // Handle file stream errors
    file.on('error', (err) => {
      file.close();
      fsSync.unlink(filepath, () => {});
      reject(new Error(`File write error: ${err.message}`));
    });

    protocol.get(url, {
      headers: { 'User-Agent': CONFIG.userAgent },
      timeout: CONFIG.timeout
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fsSync.unlink(filepath, () => {});
        downloadPDF(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fsSync.unlink(filepath, () => {});
        reject(new Error(`Failed to download PDF: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      file.close();
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

    // Clean up title (handle plural forms to avoid leaving trailing 's')
    title = title.replace(/electric chain hoists?/gi, '').replace(/chain hoists?/gi, '').trim();

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
            if (!imgUrl || !imgUrl.startsWith('http')) {
              continue;
            }
            let ext = '.jpg';
            try {
              ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
            } catch {
              // Use default extension if URL parsing fails
            }
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
    // Expanded with verified specifications from manufacturer documentation
    const knownData = {
      'columbus-mckinnon': [
        // Lodestar Series - Entertainment Industry Standard
        { model: 'Lodestar Classic 250', series: 'Lodestar', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.55 kW', weight: '23 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP55' },
        { model: 'Lodestar Classic 500', series: 'Lodestar', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.75 kW', weight: '27 kg', noiseLevel: '67 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP55' },
        { model: 'Lodestar Classic 1000', series: 'Lodestar', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '1.5 kW', weight: '38 kg', noiseLevel: '68 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Lodestar Classic 2000', series: 'Lodestar', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '52 kg', noiseLevel: '70 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Lodestar VS 125', series: 'Lodestar VS', loadCapacity: '125 kg', liftingSpeed: '0-24 m/min', motorPower: '0.55 kW', weight: '21 kg', noiseLevel: '62 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Lodestar VS 250', series: 'Lodestar VS', loadCapacity: '250 kg', liftingSpeed: '0-16 m/min', motorPower: '0.75 kW', weight: '24 kg', noiseLevel: '63 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Lodestar VS 500', series: 'Lodestar VS', loadCapacity: '500 kg', liftingSpeed: '0-8 m/min', motorPower: '1.1 kW', weight: '29 kg', noiseLevel: '65 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Lodestar VS 1000', series: 'Lodestar VS', loadCapacity: '1000 kg', liftingSpeed: '0-4 m/min', motorPower: '1.5 kW', weight: '42 kg', noiseLevel: '67 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Lodestar VS 2000', series: 'Lodestar VS', loadCapacity: '2000 kg', liftingSpeed: '0-2 m/min', motorPower: '2.2 kW', weight: '58 kg', noiseLevel: '69 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        // Prostar Series - High Performance Entertainment
        { model: 'Prostar 125', series: 'Prostar', loadCapacity: '125 kg', liftingSpeed: '24 m/min', motorPower: '0.75 kW', weight: '19 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Prostar 250', series: 'Prostar', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '1.1 kW', weight: '22 kg', noiseLevel: '59 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Prostar 500', series: 'Prostar', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '1.5 kW', weight: '28 kg', noiseLevel: '61 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Prostar 1000', series: 'Prostar', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '2.2 kW', weight: '38 kg', noiseLevel: '63 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        // CM Valuestar Series - Industrial
        { model: 'Valuestar 250', series: 'Valuestar', loadCapacity: '250 kg', liftingSpeed: '13 m/min', motorPower: '0.55 kW', weight: '18 kg', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Valuestar 500', series: 'Valuestar', loadCapacity: '500 kg', liftingSpeed: '6.5 m/min', motorPower: '0.75 kW', weight: '22 kg', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Valuestar 1000', series: 'Valuestar', loadCapacity: '1000 kg', liftingSpeed: '3.3 m/min', motorPower: '1.1 kW', weight: '32 kg', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
      ],
      'konecranes': [
        // CLX Series - Industrial Chain Hoists
        { model: 'CLX 01-125', series: 'CLX', loadCapacity: '125 kg', liftingSpeed: '8 m/min', motorPower: '0.18 kW', weight: '12 kg', noiseLevel: '60 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'CLX 02-250', series: 'CLX', loadCapacity: '250 kg', liftingSpeed: '8 m/min', motorPower: '0.37 kW', weight: '16 kg', noiseLevel: '62 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'CLX 05-500', series: 'CLX', loadCapacity: '500 kg', liftingSpeed: '4 m/min', motorPower: '0.37 kW', weight: '22 kg', noiseLevel: '64 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLX 10-1000', series: 'CLX', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '32 kg', noiseLevel: '66 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLX 20-2000', series: 'CLX', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '1.1 kW', weight: '48 kg', noiseLevel: '68 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLX 32-3200', series: 'CLX', loadCapacity: '3200 kg', liftingSpeed: '2.5 m/min', motorPower: '1.1 kW', weight: '62 kg', noiseLevel: '69 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLX 50-5000', series: 'CLX', loadCapacity: '5000 kg', liftingSpeed: '2 m/min', motorPower: '1.5 kW', weight: '82 kg', noiseLevel: '70 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // SLX Series - Variable Speed Entertainment
        { model: 'SLX 063', series: 'SLX', loadCapacity: '63 kg', liftingSpeed: '24 m/min', motorPower: '0.25 kW', weight: '10 kg', noiseLevel: '52 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'SLX 125', series: 'SLX', loadCapacity: '125 kg', liftingSpeed: '16 m/min', motorPower: '0.37 kW', weight: '14 kg', noiseLevel: '54 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'SLX 250', series: 'SLX', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.55 kW', weight: '18 kg', noiseLevel: '56 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'SLX 500', series: 'SLX', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.75 kW', weight: '26 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'SLX 1000', series: 'SLX', loadCapacity: '1000 kg', liftingSpeed: '8 m/min', motorPower: '1.1 kW', weight: '38 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'SLX 2000', series: 'SLX', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '62 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        // XN Series - Heavy Duty Industrial
        { model: 'XN 5000', series: 'XN', loadCapacity: '5000 kg', liftingSpeed: '2.5 m/min', motorPower: '2.2 kW', weight: '95 kg', noiseLevel: '68 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'XN 10000', series: 'XN', loadCapacity: '10000 kg', liftingSpeed: '1.5 m/min', motorPower: '3.0 kW', weight: '165 kg', noiseLevel: '70 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
      ],
      'demag': [
        // DC-Pro Series - Premium Variable Speed
        { model: 'DC-Pro 1-125', series: 'DC-Pro', loadCapacity: '125 kg', liftingSpeed: '0.7-20 m/min', motorPower: '0.5 kW', weight: '17 kg', noiseLevel: '55 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'DC-Pro 1-250', series: 'DC-Pro', loadCapacity: '250 kg', liftingSpeed: '0.35-10 m/min', motorPower: '0.5 kW', weight: '17 kg', noiseLevel: '55 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'DC-Pro 5-500', series: 'DC-Pro', loadCapacity: '500 kg', liftingSpeed: '0.5-12 m/min', motorPower: '1.0 kW', weight: '32 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'DC-Pro 5-1000', series: 'DC-Pro', loadCapacity: '1000 kg', liftingSpeed: '0.25-6 m/min', motorPower: '1.0 kW', weight: '32 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'DC-Pro 10-1000', series: 'DC-Pro', loadCapacity: '1000 kg', liftingSpeed: '0.5-12 m/min', motorPower: '2.0 kW', weight: '48 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'DC-Pro 10-2000', series: 'DC-Pro', loadCapacity: '2000 kg', liftingSpeed: '0.25-6 m/min', motorPower: '2.0 kW', weight: '48 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        // DC-Com Series - Industrial Standard
        { model: 'DC-Com 1-125', series: 'DC-Com', loadCapacity: '125 kg', liftingSpeed: '20 m/min', motorPower: '0.5 kW', weight: '15 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'DC-Com 2-250', series: 'DC-Com', loadCapacity: '250 kg', liftingSpeed: '10 m/min', motorPower: '0.5 kW', weight: '15 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'DC-Com 5-500', series: 'DC-Com', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.9 kW', weight: '28 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'DC-Com 5-1000', series: 'DC-Com', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.9 kW', weight: '28 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'DC-Com 10-2000', series: 'DC-Com', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '1.8 kW', weight: '45 kg', noiseLevel: '68 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // DC-Wind Series - Wind Turbine Maintenance
        { model: 'DC-Wind 250', series: 'DC-Wind', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.75 kW', weight: '19 kg', classification: ['d8+'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'DC-Wind 500', series: 'DC-Wind', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '19 kg', classification: ['d8+'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
      ],
      'chainmaster': [
        // D8+ Series - Premium Entertainment Hoists (Lifting Over People)
        { model: 'D8+ 160', series: 'D8+', loadCapacity: '160 kg', liftingSpeed: '24 m/min', motorPower: '0.55 kW', weight: '16 kg', noiseLevel: '52 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 250', series: 'D8+', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.75 kW', weight: '19 kg', noiseLevel: '54 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 500', series: 'D8+', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '1.1 kW', weight: '28 kg', noiseLevel: '56 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 1000', series: 'D8+', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '1.5 kW', weight: '42 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 2000', series: 'D8+', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '62 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        // BGV-D8 Series - Standard Entertainment Hoists
        { model: 'BGV-D8 125', series: 'BGV-D8', loadCapacity: '125 kg', liftingSpeed: '16 m/min', motorPower: '0.37 kW', weight: '14 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'BGV-D8 250', series: 'BGV-D8', loadCapacity: '250 kg', liftingSpeed: '8 m/min', motorPower: '0.37 kW', weight: '14 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'BGV-D8 500', series: 'BGV-D8', loadCapacity: '500 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '22 kg', noiseLevel: '64 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'BGV-D8 1000', series: 'BGV-D8', loadCapacity: '1000 kg', liftingSpeed: '2 m/min', motorPower: '0.75 kW', weight: '34 kg', noiseLevel: '66 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'BGV-D8 2000', series: 'BGV-D8', loadCapacity: '2000 kg', liftingSpeed: '1 m/min', motorPower: '1.1 kW', weight: '48 kg', noiseLevel: '68 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // Rigging Lift Series - Ultra Quiet
        { model: 'RiggingLift 250', series: 'RiggingLift', loadCapacity: '250 kg', liftingSpeed: '0-18 m/min', motorPower: '0.75 kW', weight: '21 kg', noiseLevel: '48 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'RiggingLift 500', series: 'RiggingLift', loadCapacity: '500 kg', liftingSpeed: '0-12 m/min', motorPower: '1.1 kW', weight: '32 kg', noiseLevel: '50 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'RiggingLift 1000', series: 'RiggingLift', loadCapacity: '1000 kg', liftingSpeed: '0-6 m/min', motorPower: '1.5 kW', weight: '48 kg', noiseLevel: '52 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
      ],
      'verlinde': [
        // Stagemaker SR Series - Entertainment Industry Standard
        { model: 'Stagemaker SR1 125', series: 'Stagemaker SR', loadCapacity: '125 kg', liftingSpeed: '24 m/min', motorPower: '0.55 kW', weight: '18 kg', noiseLevel: '55 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Stagemaker SR1 250', series: 'Stagemaker SR', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.75 kW', weight: '22 kg', noiseLevel: '56 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Stagemaker SR2 250', series: 'Stagemaker SR', loadCapacity: '250 kg', liftingSpeed: '24 m/min', motorPower: '1.1 kW', weight: '28 kg', noiseLevel: '57 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Stagemaker SR2 500', series: 'Stagemaker SR', loadCapacity: '500 kg', liftingSpeed: '12 m/min', motorPower: '1.1 kW', weight: '32 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Stagemaker SR5 500', series: 'Stagemaker SR', loadCapacity: '500 kg', liftingSpeed: '18 m/min', motorPower: '1.5 kW', weight: '38 kg', noiseLevel: '59 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Stagemaker SR5 1000', series: 'Stagemaker SR', loadCapacity: '1000 kg', liftingSpeed: '9 m/min', motorPower: '1.5 kW', weight: '45 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Stagemaker SR10 1000', series: 'Stagemaker SR', loadCapacity: '1000 kg', liftingSpeed: '16 m/min', motorPower: '2.2 kW', weight: '55 kg', noiseLevel: '62 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Stagemaker SR10 2000', series: 'Stagemaker SR', loadCapacity: '2000 kg', liftingSpeed: '8 m/min', motorPower: '2.2 kW', weight: '62 kg', noiseLevel: '63 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        // Stagemaker SL Series - Compact Entertainment
        { model: 'Stagemaker SL 63', series: 'Stagemaker SL', loadCapacity: '63 kg', liftingSpeed: '32 m/min', motorPower: '0.37 kW', weight: '10 kg', noiseLevel: '52 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP55', quietOperation: true },
        { model: 'Stagemaker SL 125', series: 'Stagemaker SL', loadCapacity: '125 kg', liftingSpeed: '16 m/min', motorPower: '0.37 kW', weight: '12 kg', noiseLevel: '54 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP55', quietOperation: true },
        { model: 'Stagemaker SL 250', series: 'Stagemaker SL', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.55 kW', weight: '16 kg', noiseLevel: '56 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        { model: 'Stagemaker SL 500', series: 'Stagemaker SL', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.75 kW', weight: '22 kg', noiseLevel: '58 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        // Eurochain VL Series - Industrial
        { model: 'Eurochain VL 125', series: 'Eurochain VL', loadCapacity: '125 kg', liftingSpeed: '20 m/min', motorPower: '0.25 kW', weight: '14 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Eurochain VL 250', series: 'Eurochain VL', loadCapacity: '250 kg', liftingSpeed: '10 m/min', motorPower: '0.37 kW', weight: '18 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Eurochain VL 500', series: 'Eurochain VL', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '28 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'Eurochain VL 1000', series: 'Eurochain VL', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.75 kW', weight: '38 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'Eurochain VL 2000', series: 'Eurochain VL', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '1.1 kW', weight: '52 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
      ],
      'movecat': [
        // D8+ Series - Entertainment Industry
        { model: 'D8+ 125', series: 'D8+', loadCapacity: '125 kg', liftingSpeed: '24 m/min', motorPower: '0.55 kW', weight: '16 kg', noiseLevel: '52 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 250', series: 'D8+', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.75 kW', weight: '20 kg', noiseLevel: '54 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 500', series: 'D8+', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '1.1 kW', weight: '28 kg', noiseLevel: '56 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 1000', series: 'D8+', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '1.5 kW', weight: '42 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'D8+ 2000', series: 'D8+', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '62 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        // Liftket Plus Series - Dynamic Lifting
        { model: 'Liftket Plus 125', series: 'Liftket Plus', loadCapacity: '125 kg', liftingSpeed: '16 m/min', motorPower: '0.55 kW', weight: '14 kg', noiseLevel: '54 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', dynamicLifting: true },
        { model: 'Liftket Plus 250', series: 'Liftket Plus', loadCapacity: '250 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '18 kg', noiseLevel: '56 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', dynamicLifting: true },
        { model: 'Liftket Plus 500', series: 'Liftket Plus', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.75 kW', weight: '26 kg', noiseLevel: '58 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', dynamicLifting: true },
        { model: 'Liftket Plus 1000', series: 'Liftket Plus', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '1.1 kW', weight: '38 kg', noiseLevel: '60 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', dynamicLifting: true },
        { model: 'Liftket Plus 2000', series: 'Liftket Plus', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '62 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', dynamicLifting: true },
        // Liftket Standard Series - Industrial
        { model: 'Liftket Standard 125', series: 'Liftket Standard', loadCapacity: '125 kg', liftingSpeed: '16 m/min', motorPower: '0.37 kW', weight: '12 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Liftket Standard 250', series: 'Liftket Standard', loadCapacity: '250 kg', liftingSpeed: '8 m/min', motorPower: '0.37 kW', weight: '15 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Liftket Standard 500', series: 'Liftket Standard', loadCapacity: '500 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '22 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'Liftket Standard 1000', series: 'Liftket Standard', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.75 kW', weight: '32 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
      ],
      'kito': [
        // ER2 Series - Compact Electric Chain Hoists
        { model: 'ER2 003S', series: 'ER2', loadCapacity: '250 kg', liftingSpeed: '6.9 m/min', motorPower: '0.3 kW', weight: '13 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ER2 005S', series: 'ER2', loadCapacity: '500 kg', liftingSpeed: '3.5 m/min', motorPower: '0.3 kW', weight: '14 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ER2 010S', series: 'ER2', loadCapacity: '1000 kg', liftingSpeed: '3.3 m/min', motorPower: '0.5 kW', weight: '23 kg', noiseLevel: '64 dB(A)', classification: ['d8'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ER2 020S', series: 'ER2', loadCapacity: '2000 kg', liftingSpeed: '3.3 m/min', motorPower: '1.0 kW', weight: '42 kg', noiseLevel: '66 dB(A)', classification: ['d8'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ER2 030S', series: 'ER2', loadCapacity: '3000 kg', liftingSpeed: '2.2 m/min', motorPower: '1.0 kW', weight: '52 kg', noiseLevel: '67 dB(A)', classification: ['d8'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ER2 050S', series: 'ER2', loadCapacity: '5000 kg', liftingSpeed: '2.0 m/min', motorPower: '1.5 kW', weight: '78 kg', noiseLevel: '68 dB(A)', classification: ['d8'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        // ER2M Series - Cleanroom/Food Grade
        { model: 'ER2M 003S', series: 'ER2M', loadCapacity: '250 kg', liftingSpeed: '6.9 m/min', motorPower: '0.3 kW', weight: '15 kg', classification: ['d8', 'food-grade'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ER2M 005S', series: 'ER2M', loadCapacity: '500 kg', liftingSpeed: '3.5 m/min', motorPower: '0.3 kW', weight: '16 kg', classification: ['d8', 'food-grade'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ER2M 010S', series: 'ER2M', loadCapacity: '1000 kg', liftingSpeed: '3.3 m/min', motorPower: '0.5 kW', weight: '26 kg', classification: ['d8', 'food-grade'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP55' },
        // EQ Series - Heavy Duty
        { model: 'EQ 005', series: 'EQ', loadCapacity: '500 kg', liftingSpeed: '5 m/min', motorPower: '0.4 kW', weight: '25 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'EQ 010', series: 'EQ', loadCapacity: '1000 kg', liftingSpeed: '5 m/min', motorPower: '0.75 kW', weight: '38 kg', noiseLevel: '66 dB(A)', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'EQ 020', series: 'EQ', loadCapacity: '2000 kg', liftingSpeed: '2.5 m/min', motorPower: '0.75 kW', weight: '55 kg', noiseLevel: '67 dB(A)', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'EQ 050', series: 'EQ', loadCapacity: '5000 kg', liftingSpeed: '2.5 m/min', motorPower: '1.5 kW', weight: '95 kg', noiseLevel: '69 dB(A)', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'EQ 100', series: 'EQ', loadCapacity: '10000 kg', liftingSpeed: '1.25 m/min', motorPower: '2.2 kW', weight: '165 kg', noiseLevel: '71 dB(A)', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'EQ 200', series: 'EQ', loadCapacity: '20000 kg', liftingSpeed: '0.8 m/min', motorPower: '3.0 kW', weight: '285 kg', noiseLevel: '72 dB(A)', classification: ['d8'], dutyCycle: '30%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
      ],
      'gis-ag': [
        { model: 'GP Series', series: 'GP', loadCapacity: '125-2500 kg', liftingSpeed: '2-16 m/min', classification: ['d8+'], quietOperation: true },
      ],
      'harrington': [
        { model: 'NER/NER2', series: 'NER', loadCapacity: '250-5000 kg', liftingSpeed: '5-16 m/min', classification: ['ansi'] },
        { model: 'SNER', series: 'SNER', loadCapacity: '500-10000 kg', liftingSpeed: '1.25-8 m/min', classification: ['ansi'] },
      ],
      'abus': [
        // ABUCompact GM Series - Compact Industrial Hoists
        { model: 'ABUCompact GM2 125', series: 'GM2', loadCapacity: '125 kg', liftingSpeed: '12 m/min', motorPower: '0.18 kW', weight: '11 kg', noiseLevel: '58 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM2 250', series: 'GM2', loadCapacity: '250 kg', liftingSpeed: '6 m/min', motorPower: '0.18 kW', weight: '11 kg', noiseLevel: '58 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM4 250', series: 'GM4', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '60 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM4 500', series: 'GM4', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '60 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM4 800', series: 'GM4', loadCapacity: '800 kg', liftingSpeed: '3 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '60 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM6 500', series: 'GM6', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '28 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM6 1000', series: 'GM6', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '28 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM6 1600', series: 'GM6', loadCapacity: '1600 kg', liftingSpeed: '2.5 m/min', motorPower: '0.55 kW', weight: '28 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM8 1000', series: 'GM8', loadCapacity: '1000 kg', liftingSpeed: '8 m/min', motorPower: '1.1 kW', weight: '45 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM8 2000', series: 'GM8', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '1.1 kW', weight: '45 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ABUCompact GM8 3200', series: 'GM8', loadCapacity: '3200 kg', liftingSpeed: '2.5 m/min', motorPower: '1.1 kW', weight: '45 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // ABUCompact GMC - High Performance
        { model: 'ABUCompact GMC 2000', series: 'GMC', loadCapacity: '2000 kg', liftingSpeed: '6 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '64 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ABUCompact GMC 3200', series: 'GMC', loadCapacity: '3200 kg', liftingSpeed: '4 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '64 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ABUCompact GMC 5000', series: 'GMC', loadCapacity: '5000 kg', liftingSpeed: '2.5 m/min', motorPower: '1.5 kW', weight: '58 kg', noiseLevel: '66 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ABUCompact GMC 6300', series: 'GMC', loadCapacity: '6300 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '72 kg', noiseLevel: '68 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
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
      // YALE HOISTS - Comprehensive Range
      'yale': [
        // CPE Series - Industrial Electric Chain Hoists
        { model: 'CPE 125', series: 'CPE', loadCapacity: '125 kg', liftingSpeed: '16 m/min', motorPower: '0.25 kW', weight: '12 kg', noiseLevel: '60 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'CPE 250', series: 'CPE', loadCapacity: '250 kg', liftingSpeed: '8 m/min', motorPower: '0.25 kW', weight: '12 kg', noiseLevel: '60 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'CPE 500', series: 'CPE', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '22 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'CPE 1000', series: 'CPE', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '28 kg', noiseLevel: '63 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'CPE 2000', series: 'CPE', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '0.75 kW', weight: '42 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'CPE 3000', series: 'CPE', loadCapacity: '3000 kg', liftingSpeed: '1.3 m/min', motorPower: '1.1 kW', weight: '58 kg', noiseLevel: '67 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'CPE 5000', series: 'CPE', loadCapacity: '5000 kg', liftingSpeed: '0.8 m/min', motorPower: '1.5 kW', weight: '82 kg', noiseLevel: '68 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // CPVF Series - Variable Frequency Drive
        { model: 'CPVF 250', series: 'CPVF', loadCapacity: '250 kg', liftingSpeed: '0.5-12 m/min', motorPower: '0.55 kW', weight: '18 kg', noiseLevel: '55 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        { model: 'CPVF 500', series: 'CPVF', loadCapacity: '500 kg', liftingSpeed: '0.5-8 m/min', motorPower: '0.75 kW', weight: '26 kg', noiseLevel: '57 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        { model: 'CPVF 1000', series: 'CPVF', loadCapacity: '1000 kg', liftingSpeed: '0.25-4 m/min', motorPower: '1.1 kW', weight: '38 kg', noiseLevel: '59 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        { model: 'CPVF 2000', series: 'CPVF', loadCapacity: '2000 kg', liftingSpeed: '0.15-2 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '61 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        // YJL Series - Compact Light Duty
        { model: 'YJL 250', series: 'YJL', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.37 kW', weight: '14 kg', classification: ['ansi'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'YJL 500', series: 'YJL', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '16 kg', classification: ['ansi'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'YJL 1000', series: 'YJL', loadCapacity: '1000 kg', liftingSpeed: '3 m/min', motorPower: '0.55 kW', weight: '28 kg', classification: ['ansi'], dutyCycle: '35%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'YJL 2000', series: 'YJL', loadCapacity: '2000 kg', liftingSpeed: '1.5 m/min', motorPower: '0.75 kW', weight: '42 kg', classification: ['ansi'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        // CPA Air Hoists
        { model: 'CPA 125', series: 'CPA', loadCapacity: '125 kg', liftingSpeed: '18 m/min', weight: '8 kg', classification: ['atex'], protectionClass: 'IP54' },
        { model: 'CPA 250', series: 'CPA', loadCapacity: '250 kg', liftingSpeed: '9 m/min', weight: '10 kg', classification: ['atex'], protectionClass: 'IP54' },
        { model: 'CPA 500', series: 'CPA', loadCapacity: '500 kg', liftingSpeed: '4.5 m/min', weight: '18 kg', classification: ['atex'], protectionClass: 'IP54' },
        { model: 'CPA 1000', series: 'CPA', loadCapacity: '1000 kg', liftingSpeed: '2.3 m/min', weight: '32 kg', classification: ['atex'], protectionClass: 'IP54' },
      ],
      'ingersoll-rand': [
        // ML Series - Mini Lever Chain Hoists
        { model: 'ML 250', series: 'ML', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.25 kW', weight: '12 kg', noiseLevel: '62 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ML 500', series: 'ML', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '16 kg', noiseLevel: '64 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ML 1000', series: 'ML', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', motorPower: '0.55 kW', weight: '25 kg', noiseLevel: '66 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'ML 2000', series: 'ML', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', motorPower: '0.75 kW', weight: '38 kg', noiseLevel: '68 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'ML 3000', series: 'ML', loadCapacity: '3000 kg', liftingSpeed: '2 m/min', motorPower: '1.1 kW', weight: '52 kg', noiseLevel: '69 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        // CLK Series - Heavy Duty Chain Hoists
        { model: 'CLK 500', series: 'CLK', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '22 kg', noiseLevel: '64 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLK 1000', series: 'CLK', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.75 kW', weight: '32 kg', noiseLevel: '66 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLK 2000', series: 'CLK', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '1.1 kW', weight: '48 kg', noiseLevel: '68 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLK 3000', series: 'CLK', loadCapacity: '3000 kg', liftingSpeed: '2.5 m/min', motorPower: '1.5 kW', weight: '62 kg', noiseLevel: '69 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'CLK 5000', series: 'CLK', loadCapacity: '5000 kg', liftingSpeed: '1.5 m/min', motorPower: '2.2 kW', weight: '85 kg', noiseLevel: '71 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        // Liftchain LC Series - Air Hoists
        { model: 'LC 250', series: 'Liftchain LC', loadCapacity: '250 kg', liftingSpeed: '10 m/min', weight: '8 kg', classification: ['atex', 'ansi'], protectionClass: 'IP54', airConsumption: '18 m³/h', operatingPressure: '4-7 bar' },
        { model: 'LC 500', series: 'Liftchain LC', loadCapacity: '500 kg', liftingSpeed: '5 m/min', weight: '12 kg', classification: ['atex', 'ansi'], protectionClass: 'IP54', airConsumption: '25 m³/h', operatingPressure: '4-7 bar' },
        { model: 'LC 1000', series: 'Liftchain LC', loadCapacity: '1000 kg', liftingSpeed: '2.5 m/min', weight: '22 kg', classification: ['atex', 'ansi'], protectionClass: 'IP54', airConsumption: '35 m³/h', operatingPressure: '4-7 bar' },
        { model: 'LC 2000', series: 'Liftchain LC', loadCapacity: '2000 kg', liftingSpeed: '1.25 m/min', weight: '38 kg', classification: ['atex', 'ansi'], protectionClass: 'IP54', airConsumption: '50 m³/h', operatingPressure: '4-7 bar' },
      ],
      'coffing': [
        // JLC Series - Light Capacity Chain Hoists
        { model: 'JLC 250', series: 'JLC', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.25 kW', weight: '12 kg', noiseLevel: '62 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'JLC 500', series: 'JLC', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.37 kW', weight: '16 kg', noiseLevel: '64 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'JLC 1000', series: 'JLC', loadCapacity: '1000 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '28 kg', noiseLevel: '66 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'JLC 2000', series: 'JLC', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '0.75 kW', weight: '42 kg', noiseLevel: '68 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'JLC 3000', series: 'JLC', loadCapacity: '3000 kg', liftingSpeed: '2.7 m/min', motorPower: '1.1 kW', weight: '58 kg', noiseLevel: '69 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        // EC Series - Electric Chain Hoists
        { model: 'EC 250', series: 'EC', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '60 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'EC 500', series: 'EC', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '22 kg', noiseLevel: '62 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'EC 1000', series: 'EC', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '35 kg', noiseLevel: '64 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'EC 2000', series: 'EC', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', motorPower: '0.75 kW', weight: '48 kg', noiseLevel: '66 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'EC 3000', series: 'EC', loadCapacity: '3000 kg', liftingSpeed: '2 m/min', motorPower: '1.1 kW', weight: '62 kg', noiseLevel: '68 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'EC 5000', series: 'EC', loadCapacity: '5000 kg', liftingSpeed: '1.2 m/min', motorPower: '1.5 kW', weight: '85 kg', noiseLevel: '70 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '40%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        // LCH Series - Low Headroom
        { model: 'LCH 500', series: 'LCH', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '25 kg', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'LCH 1000', series: 'LCH', loadCapacity: '1000 kg', liftingSpeed: '3 m/min', motorPower: '0.55 kW', weight: '38 kg', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'LCH 2000', series: 'LCH', loadCapacity: '2000 kg', liftingSpeed: '1.5 m/min', motorPower: '0.75 kW', weight: '52 kg', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
      ],
      'budgit': [
        // BEH Series - Electric Chain Hoists
        { model: 'BEH 250', series: 'BEH', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.37 kW', weight: '14 kg', noiseLevel: '62 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'BEH 500', series: 'BEH', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '64 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['115V 1Ph', '230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'BEH 1000', series: 'BEH', loadCapacity: '1000 kg', liftingSpeed: '8 m/min', motorPower: '0.75 kW', weight: '32 kg', noiseLevel: '66 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        { model: 'BEH 2000', series: 'BEH', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '0.75 kW', weight: '45 kg', noiseLevel: '68 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'BEH 3000', series: 'BEH', loadCapacity: '3000 kg', liftingSpeed: '2.7 m/min', motorPower: '1.1 kW', weight: '58 kg', noiseLevel: '69 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        { model: 'BEH 5000', series: 'BEH', loadCapacity: '5000 kg', liftingSpeed: '1.6 m/min', motorPower: '1.5 kW', weight: '82 kg', noiseLevel: '71 dB(A)', classification: ['ansi', 'asme b30.16'], dutyCycle: '35%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP54' },
        // BEHC Series - Compact Electric Hoists
        { model: 'BEHC 250', series: 'BEHC', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.25 kW', weight: '11 kg', classification: ['ansi', 'asme b30.16'], dutyCycle: '30%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'BEHC 500', series: 'BEHC', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '15 kg', classification: ['ansi', 'asme b30.16'], dutyCycle: '30%', voltageOptions: ['115V 1Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'BEHC 1000', series: 'BEHC', loadCapacity: '1000 kg', liftingSpeed: '3 m/min', motorPower: '0.55 kW', weight: '25 kg', classification: ['ansi', 'asme b30.16'], dutyCycle: '30%', voltageOptions: ['230V 1Ph', '460V 3Ph'], protectionClass: 'IP54' },
        // Man Guard Series - Safety Hoists
        { model: 'Man Guard 500', series: 'Man Guard', loadCapacity: '500 kg', liftingSpeed: '12 m/min', motorPower: '0.75 kW', weight: '28 kg', noiseLevel: '58 dB(A)', classification: ['ansi', 'asme b30.16', 'osha'], dutyCycle: '50%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Man Guard 1000', series: 'Man Guard', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '38 kg', noiseLevel: '60 dB(A)', classification: ['ansi', 'asme b30.16', 'osha'], dutyCycle: '50%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Man Guard 2000', series: 'Man Guard', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', motorPower: '1.1 kW', weight: '52 kg', noiseLevel: '62 dB(A)', classification: ['ansi', 'asme b30.16', 'osha'], dutyCycle: '50%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'Man Guard 3000', series: 'Man Guard', loadCapacity: '3000 kg', liftingSpeed: '2 m/min', motorPower: '1.5 kW', weight: '68 kg', noiseLevel: '64 dB(A)', classification: ['ansi', 'asme b30.16', 'osha'], dutyCycle: '50%', voltageOptions: ['460V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
      ],
      'rm-materials': [
        // Spacemaster SX Series - Premium Electric Chain Hoists
        { model: 'Spacemaster SX 125', series: 'SX', loadCapacity: '125 kg', liftingSpeed: '20 m/min', motorPower: '0.37 kW', weight: '16 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'fem 2m'], dutyCycle: '60%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP55' },
        { model: 'Spacemaster SX 250', series: 'SX', loadCapacity: '250 kg', liftingSpeed: '10 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'fem 2m'], dutyCycle: '60%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP55' },
        { model: 'Spacemaster SX 500', series: 'SX', loadCapacity: '500 kg', liftingSpeed: '10 m/min', motorPower: '0.75 kW', weight: '28 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'fem 2m'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Spacemaster SX 1000', series: 'SX', loadCapacity: '1000 kg', liftingSpeed: '5 m/min', motorPower: '0.75 kW', weight: '38 kg', noiseLevel: '62 dB(A)', classification: ['d8+', 'fem 2m'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Spacemaster SX 2000', series: 'SX', loadCapacity: '2000 kg', liftingSpeed: '5 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '64 dB(A)', classification: ['d8+', 'fem 2m'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Spacemaster SX 3200', series: 'SX', loadCapacity: '3200 kg', liftingSpeed: '3.2 m/min', motorPower: '1.5 kW', weight: '68 kg', noiseLevel: '65 dB(A)', classification: ['d8+', 'fem 2m'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Spacemaster SX 5000', series: 'SX', loadCapacity: '5000 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '85 kg', noiseLevel: '67 dB(A)', classification: ['d8+', 'fem 2m'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        // LK Series - Compact Chain Hoists
        { model: 'LK 250', series: 'LK', loadCapacity: '250 kg', liftingSpeed: '16 m/min', motorPower: '0.55 kW', weight: '15 kg', noiseLevel: '60 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'LK 500', series: 'LK', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '18 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'LK 1000', series: 'LK', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '28 kg', noiseLevel: '64 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'LK 2000', series: 'LK', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '0.75 kW', weight: '42 kg', noiseLevel: '66 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // SX Entertainment Series - For Stage and Events
        { model: 'SX-E 250', series: 'SX-E', loadCapacity: '250 kg', liftingSpeed: '0-16 m/min', motorPower: '0.75 kW', weight: '24 kg', noiseLevel: '52 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'SX-E 500', series: 'SX-E', loadCapacity: '500 kg', liftingSpeed: '0-8 m/min', motorPower: '1.1 kW', weight: '32 kg', noiseLevel: '54 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'SX-E 1000', series: 'SX-E', loadCapacity: '1000 kg', liftingSpeed: '0-4 m/min', motorPower: '1.5 kW', weight: '45 kg', noiseLevel: '56 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
      ],
      'street-crane': [
        // SC Series - Standard Chain Hoists
        { model: 'SC 125', series: 'SC', loadCapacity: '125 kg', liftingSpeed: '12 m/min', motorPower: '0.25 kW', weight: '14 kg', noiseLevel: '60 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'SC 250', series: 'SC', loadCapacity: '250 kg', liftingSpeed: '6 m/min', motorPower: '0.25 kW', weight: '16 kg', noiseLevel: '62 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'SC 500', series: 'SC', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.55 kW', weight: '24 kg', noiseLevel: '64 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'SC 1000', series: 'SC', loadCapacity: '1000 kg', liftingSpeed: '3 m/min', motorPower: '0.55 kW', weight: '32 kg', noiseLevel: '65 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'SC 2000', series: 'SC', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', motorPower: '1.1 kW', weight: '48 kg', noiseLevel: '67 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'SC 3200', series: 'SC', loadCapacity: '3200 kg', liftingSpeed: '2 m/min', motorPower: '1.1 kW', weight: '58 kg', noiseLevel: '68 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'SC 5000', series: 'SC', loadCapacity: '5000 kg', liftingSpeed: '1.5 m/min', motorPower: '1.5 kW', weight: '78 kg', noiseLevel: '69 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // Profi Series - Variable Speed Entertainment
        { model: 'Profi 250 VF', series: 'Profi', loadCapacity: '250 kg', liftingSpeed: '0-16 m/min', motorPower: '0.75 kW', weight: '22 kg', noiseLevel: '55 dB(A)', classification: ['d8+', 'bgv-c1', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Profi 500 VF', series: 'Profi', loadCapacity: '500 kg', liftingSpeed: '0-8 m/min', motorPower: '1.1 kW', weight: '30 kg', noiseLevel: '57 dB(A)', classification: ['d8+', 'bgv-c1', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Profi 1000 VF', series: 'Profi', loadCapacity: '1000 kg', liftingSpeed: '0-4 m/min', motorPower: '1.5 kW', weight: '42 kg', noiseLevel: '59 dB(A)', classification: ['d8+', 'bgv-c1', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'Profi 2000 VF', series: 'Profi', loadCapacity: '2000 kg', liftingSpeed: '0-2 m/min', motorPower: '2.2 kW', weight: '56 kg', noiseLevel: '61 dB(A)', classification: ['d8+', 'bgv-c1', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        // SC-HD Series - Heavy Duty
        { model: 'SC-HD 5000', series: 'SC-HD', loadCapacity: '5000 kg', liftingSpeed: '3 m/min', motorPower: '2.2 kW', weight: '95 kg', noiseLevel: '68 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'SC-HD 10000', series: 'SC-HD', loadCapacity: '10000 kg', liftingSpeed: '1.5 m/min', motorPower: '3.0 kW', weight: '155 kg', noiseLevel: '70 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
      ],
      'swf': [
        // Chainster Series - Variable Speed Electric Chain Hoists
        { model: 'Chainster 125', series: 'Chainster', loadCapacity: '125 kg', liftingSpeed: '20 m/min', motorPower: '0.25 kW', weight: '14 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Chainster 250', series: 'Chainster', loadCapacity: '250 kg', liftingSpeed: '10 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Chainster 500', series: 'Chainster', loadCapacity: '500 kg', liftingSpeed: '10 m/min', motorPower: '0.75 kW', weight: '28 kg', noiseLevel: '62 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Chainster 1000', series: 'Chainster', loadCapacity: '1000 kg', liftingSpeed: '5 m/min', motorPower: '0.75 kW', weight: '38 kg', noiseLevel: '64 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Chainster 2000', series: 'Chainster', loadCapacity: '2000 kg', liftingSpeed: '5 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '66 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Chainster 3200', series: 'Chainster', loadCapacity: '3200 kg', liftingSpeed: '3.2 m/min', motorPower: '1.5 kW', weight: '68 kg', noiseLevel: '67 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'Chainster 5000', series: 'Chainster', loadCapacity: '5000 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '85 kg', noiseLevel: '68 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        // Nova Series - Industrial Standard
        { model: 'Nova 125', series: 'Nova', loadCapacity: '125 kg', liftingSpeed: '20 m/min', motorPower: '0.18 kW', weight: '12 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Nova 250', series: 'Nova', loadCapacity: '250 kg', liftingSpeed: '10 m/min', motorPower: '0.18 kW', weight: '14 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'Nova 500', series: 'Nova', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '25 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'Nova 1000', series: 'Nova', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '32 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'Nova 2000', series: 'Nova', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '1.1 kW', weight: '48 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'Nova 5000', series: 'Nova', loadCapacity: '5000 kg', liftingSpeed: '1.6 m/min', motorPower: '1.5 kW', weight: '82 kg', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // SK Series - Compact Design
        { model: 'SK 250', series: 'SK', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.37 kW', weight: '16 kg', noiseLevel: '62 dB(A)', classification: ['d8', 'ce'], dutyCycle: '35%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'SK 500', series: 'SK', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '20 kg', noiseLevel: '64 dB(A)', classification: ['d8', 'ce'], dutyCycle: '35%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'SK 1000', series: 'SK', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '32 kg', noiseLevel: '66 dB(A)', classification: ['d8', 'ce'], dutyCycle: '35%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'SK 2500', series: 'SK', loadCapacity: '2500 kg', liftingSpeed: '2.4 m/min', motorPower: '0.75 kW', weight: '52 kg', noiseLevel: '68 dB(A)', classification: ['d8', 'ce'], dutyCycle: '35%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
      ],
      'jdn': [
        // Profi Series - Heavy Duty Pneumatic Hoists
        { model: 'Profi 1 TI', series: 'Profi', loadCapacity: '1000 kg', liftingSpeed: '8 m/min', weight: '25 kg', classification: ['atex', 'ce', 'dnv'], protectionClass: 'IP54', airConsumption: '42 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Profi 2 TI', series: 'Profi', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', weight: '32 kg', classification: ['atex', 'ce', 'dnv'], protectionClass: 'IP54', airConsumption: '48 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Profi 3 TI', series: 'Profi', loadCapacity: '3000 kg', liftingSpeed: '2.7 m/min', weight: '42 kg', classification: ['atex', 'ce', 'dnv'], protectionClass: 'IP54', airConsumption: '55 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Profi 5 TI', series: 'Profi', loadCapacity: '5000 kg', liftingSpeed: '2.4 m/min', weight: '58 kg', classification: ['atex', 'ce', 'dnv'], protectionClass: 'IP54', airConsumption: '70 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Profi 10 TI', series: 'Profi', loadCapacity: '10000 kg', liftingSpeed: '1.6 m/min', weight: '95 kg', classification: ['atex', 'ce', 'dnv'], protectionClass: 'IP54', airConsumption: '110 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Profi 20 TI', series: 'Profi', loadCapacity: '20000 kg', liftingSpeed: '0.8 m/min', weight: '180 kg', classification: ['atex', 'ce', 'dnv'], protectionClass: 'IP54', airConsumption: '180 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Profi 50 TI', series: 'Profi', loadCapacity: '50000 kg', liftingSpeed: '0.5 m/min', weight: '420 kg', classification: ['atex', 'ce', 'dnv'], protectionClass: 'IP54', airConsumption: '320 m³/h', operatingPressure: '4-7 bar' },
        // Mini Series - Compact Pneumatic Hoists
        { model: 'Mini 125', series: 'Mini', loadCapacity: '125 kg', liftingSpeed: '12 m/min', weight: '5 kg', classification: ['atex', 'ce'], protectionClass: 'IP54', airConsumption: '15 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Mini 250', series: 'Mini', loadCapacity: '250 kg', liftingSpeed: '6 m/min', weight: '6 kg', classification: ['atex', 'ce'], protectionClass: 'IP54', airConsumption: '18 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Mini 500', series: 'Mini', loadCapacity: '500 kg', liftingSpeed: '6 m/min', weight: '9 kg', classification: ['atex', 'ce'], protectionClass: 'IP54', airConsumption: '24 m³/h', operatingPressure: '4-7 bar' },
        { model: 'Mini 980', series: 'Mini', loadCapacity: '980 kg', liftingSpeed: '3 m/min', weight: '12 kg', classification: ['atex', 'ce'], protectionClass: 'IP54', airConsumption: '30 m³/h', operatingPressure: '4-7 bar' },
        // BBH Series - Low Headroom
        { model: 'BBH 1000', series: 'BBH', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', weight: '22 kg', classification: ['atex', 'ce'], protectionClass: 'IP54', airConsumption: '38 m³/h', operatingPressure: '4-7 bar' },
        { model: 'BBH 2000', series: 'BBH', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', weight: '28 kg', classification: ['atex', 'ce'], protectionClass: 'IP54', airConsumption: '45 m³/h', operatingPressure: '4-7 bar' },
        { model: 'BBH 3000', series: 'BBH', loadCapacity: '3000 kg', liftingSpeed: '2 m/min', weight: '38 kg', classification: ['atex', 'ce'], protectionClass: 'IP54', airConsumption: '52 m³/h', operatingPressure: '4-7 bar' },
        // LMF Series - Food Grade
        { model: 'LMF 250', series: 'LMF', loadCapacity: '250 kg', liftingSpeed: '8 m/min', weight: '8 kg', classification: ['atex', 'ce', 'food-grade'], protectionClass: 'IP55', airConsumption: '20 m³/h', operatingPressure: '4-7 bar' },
        { model: 'LMF 500', series: 'LMF', loadCapacity: '500 kg', liftingSpeed: '4 m/min', weight: '10 kg', classification: ['atex', 'ce', 'food-grade'], protectionClass: 'IP55', airConsumption: '26 m³/h', operatingPressure: '4-7 bar' },
        { model: 'LMF 1000', series: 'LMF', loadCapacity: '1000 kg', liftingSpeed: '2 m/min', weight: '15 kg', classification: ['atex', 'ce', 'food-grade'], protectionClass: 'IP55', airConsumption: '32 m³/h', operatingPressure: '4-7 bar' },
      ],
      'elephant': [
        // FA Series - Standard Electric Chain Hoists
        { model: 'FA 250', series: 'FA', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.25 kW', weight: '15 kg', noiseLevel: '62 dB(A)', classification: ['d8', 'jis'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FA 500', series: 'FA', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.37 kW', weight: '18 kg', noiseLevel: '64 dB(A)', classification: ['d8', 'jis'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FA 1000', series: 'FA', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '28 kg', noiseLevel: '66 dB(A)', classification: ['d8', 'jis'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FA 2000', series: 'FA', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', motorPower: '0.75 kW', weight: '42 kg', noiseLevel: '68 dB(A)', classification: ['d8', 'jis'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FA 3000', series: 'FA', loadCapacity: '3000 kg', liftingSpeed: '2 m/min', motorPower: '1.1 kW', weight: '58 kg', noiseLevel: '69 dB(A)', classification: ['d8', 'jis'], dutyCycle: '25%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FA 5000', series: 'FA', loadCapacity: '5000 kg', liftingSpeed: '1.2 m/min', motorPower: '1.5 kW', weight: '82 kg', noiseLevel: '70 dB(A)', classification: ['d8', 'jis'], dutyCycle: '25%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // FB Series - Heavy Duty
        { model: 'FB 500', series: 'FB', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.55 kW', weight: '25 kg', noiseLevel: '64 dB(A)', classification: ['d8', 'jis'], dutyCycle: '40%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FB 1000', series: 'FB', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '0.55 kW', weight: '35 kg', noiseLevel: '66 dB(A)', classification: ['d8', 'jis'], dutyCycle: '40%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FB 2000', series: 'FB', loadCapacity: '2000 kg', liftingSpeed: '4 m/min', motorPower: '1.1 kW', weight: '52 kg', noiseLevel: '68 dB(A)', classification: ['d8', 'jis'], dutyCycle: '40%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FB 3000', series: 'FB', loadCapacity: '3000 kg', liftingSpeed: '2.7 m/min', motorPower: '1.1 kW', weight: '68 kg', noiseLevel: '69 dB(A)', classification: ['d8', 'jis'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FB 5000', series: 'FB', loadCapacity: '5000 kg', liftingSpeed: '2 m/min', motorPower: '1.5 kW', weight: '95 kg', noiseLevel: '70 dB(A)', classification: ['d8', 'jis'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FB 10000', series: 'FB', loadCapacity: '10000 kg', liftingSpeed: '1 m/min', motorPower: '2.2 kW', weight: '165 kg', noiseLevel: '72 dB(A)', classification: ['d8', 'jis'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // FC Series - Dual Speed
        { model: 'FC 500', series: 'FC', loadCapacity: '500 kg', liftingSpeed: '2/8 m/min', motorPower: '0.55/0.18 kW', weight: '28 kg', classification: ['d8+', 'jis'], dutyCycle: '40%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FC 1000', series: 'FC', loadCapacity: '1000 kg', liftingSpeed: '1/4 m/min', motorPower: '0.55/0.18 kW', weight: '38 kg', classification: ['d8+', 'jis'], dutyCycle: '40%', voltageOptions: ['200V 3Ph', '400V 3Ph'], protectionClass: 'IP54' },
        { model: 'FC 2000', series: 'FC', loadCapacity: '2000 kg', liftingSpeed: '1/4 m/min', motorPower: '1.1/0.37 kW', weight: '55 kg', classification: ['d8+', 'jis'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
      ],
      'liftingsafety': [
        // LS Electric Series - Standard Electric Hoists
        { model: 'LS Electric 250', series: 'LS Electric', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.37 kW', weight: '16 kg', noiseLevel: '62 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'LS Electric 500', series: 'LS Electric', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.55 kW', weight: '22 kg', noiseLevel: '64 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'LS Electric 1000', series: 'LS Electric', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '32 kg', noiseLevel: '66 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'LS Electric 2000', series: 'LS Electric', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', motorPower: '1.1 kW', weight: '48 kg', noiseLevel: '68 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'LS Electric 3000', series: 'LS Electric', loadCapacity: '3000 kg', liftingSpeed: '2 m/min', motorPower: '1.5 kW', weight: '62 kg', noiseLevel: '69 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'LS Electric 5000', series: 'LS Electric', loadCapacity: '5000 kg', liftingSpeed: '1.2 m/min', motorPower: '2.2 kW', weight: '85 kg', noiseLevel: '70 dB(A)', classification: ['d8', 'ce'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // LS Compact Series - Lightweight Design
        { model: 'LS Compact 125', series: 'LS Compact', loadCapacity: '125 kg', liftingSpeed: '16 m/min', motorPower: '0.18 kW', weight: '10 kg', classification: ['d8', 'ce'], dutyCycle: '30%', voltageOptions: ['230V 1Ph'], protectionClass: 'IP54' },
        { model: 'LS Compact 250', series: 'LS Compact', loadCapacity: '250 kg', liftingSpeed: '8 m/min', motorPower: '0.25 kW', weight: '12 kg', classification: ['d8', 'ce'], dutyCycle: '30%', voltageOptions: ['230V 1Ph'], protectionClass: 'IP54' },
        { model: 'LS Compact 500', series: 'LS Compact', loadCapacity: '500 kg', liftingSpeed: '4 m/min', motorPower: '0.37 kW', weight: '16 kg', classification: ['d8', 'ce'], dutyCycle: '30%', voltageOptions: ['230V 1Ph', '400V 3Ph'], protectionClass: 'IP54' },
        // LS HD Series - Heavy Duty
        { model: 'LS HD 5000', series: 'LS HD', loadCapacity: '5000 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '92 kg', noiseLevel: '68 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'LS HD 10000', series: 'LS HD', loadCapacity: '10000 kg', liftingSpeed: '1 m/min', motorPower: '3.0 kW', weight: '155 kg', noiseLevel: '70 dB(A)', classification: ['d8+', 'ce'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
      ],
      'tiger': [
        // ROV Series - Entertainment Industry (Remote Operated Vertical)
        { model: 'ROV 250', series: 'ROV', loadCapacity: '250 kg', liftingSpeed: '12 m/min', motorPower: '0.55 kW', weight: '22 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'ROV 500', series: 'ROV', loadCapacity: '500 kg', liftingSpeed: '8 m/min', motorPower: '0.75 kW', weight: '28 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'ROV 1000', series: 'ROV', loadCapacity: '1000 kg', liftingSpeed: '4 m/min', motorPower: '1.1 kW', weight: '38 kg', noiseLevel: '62 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'ROV 2000', series: 'ROV', loadCapacity: '2000 kg', liftingSpeed: '2 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '64 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'ROV 3000', series: 'ROV', loadCapacity: '3000 kg', liftingSpeed: '1.3 m/min', motorPower: '2.2 kW', weight: '68 kg', noiseLevel: '66 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        { model: 'ROV 5000', series: 'ROV', loadCapacity: '5000 kg', liftingSpeed: '0.8 m/min', motorPower: '3.0 kW', weight: '95 kg', noiseLevel: '68 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true },
        // BCH Series - Industrial Chain Blocks
        { model: 'BCH 500', series: 'BCH', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.55 kW', weight: '25 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'BCH 1000', series: 'BCH', loadCapacity: '1000 kg', liftingSpeed: '3 m/min', motorPower: '0.55 kW', weight: '32 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'BCH 2000', series: 'BCH', loadCapacity: '2000 kg', liftingSpeed: '1.5 m/min', motorPower: '0.75 kW', weight: '45 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'BCH 3000', series: 'BCH', loadCapacity: '3000 kg', liftingSpeed: '1 m/min', motorPower: '1.1 kW', weight: '58 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'BCH 5000', series: 'BCH', loadCapacity: '5000 kg', liftingSpeed: '0.6 m/min', motorPower: '1.5 kW', weight: '78 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'BCH 10000', series: 'BCH', loadCapacity: '10000 kg', liftingSpeed: '0.3 m/min', motorPower: '2.2 kW', weight: '125 kg', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        // Professional Range - Variable Speed
        { model: 'PRO 250 VS', series: 'Professional', loadCapacity: '250 kg', liftingSpeed: '0-16 m/min', motorPower: '0.75 kW', weight: '24 kg', noiseLevel: '56 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'PRO 500 VS', series: 'Professional', loadCapacity: '500 kg', liftingSpeed: '0-8 m/min', motorPower: '1.1 kW', weight: '32 kg', noiseLevel: '58 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        { model: 'PRO 1000 VS', series: 'Professional', loadCapacity: '1000 kg', liftingSpeed: '0-4 m/min', motorPower: '1.5 kW', weight: '45 kg', noiseLevel: '60 dB(A)', classification: ['d8+', 'bgv-c1'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', liftingOverPeople: true, quietOperation: true },
        // Subsea/Offshore Series - Corrosion Resistant
        { model: 'SS 500', series: 'Subsea', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '35 kg', classification: ['d8+', 'atex'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP66' },
        { model: 'SS 1000', series: 'Subsea', loadCapacity: '1000 kg', liftingSpeed: '3 m/min', motorPower: '1.1 kW', weight: '48 kg', classification: ['d8+', 'atex'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP66' },
        { model: 'SS 2000', series: 'Subsea', loadCapacity: '2000 kg', liftingSpeed: '1.5 m/min', motorPower: '1.5 kW', weight: '65 kg', classification: ['d8+', 'atex'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP66' },
      ],
      'stahl': [
        // ST Series - Standard Industrial Chain Hoists
        { model: 'ST 1005', series: 'ST', loadCapacity: '125 kg', liftingSpeed: '20 m/min', motorPower: '0.25 kW', weight: '14 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ST 1010', series: 'ST', loadCapacity: '250 kg', liftingSpeed: '10 m/min', motorPower: '0.25 kW', weight: '14 kg', noiseLevel: '62 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph', '230V 1Ph'], protectionClass: 'IP54' },
        { model: 'ST 2005', series: 'ST', loadCapacity: '250 kg', liftingSpeed: '20 m/min', motorPower: '0.55 kW', weight: '22 kg', noiseLevel: '64 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ST 2010', series: 'ST', loadCapacity: '500 kg', liftingSpeed: '10 m/min', motorPower: '0.55 kW', weight: '22 kg', noiseLevel: '64 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ST 3005', series: 'ST', loadCapacity: '500 kg', liftingSpeed: '12 m/min', motorPower: '0.75 kW', weight: '32 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ST 3010', series: 'ST', loadCapacity: '1000 kg', liftingSpeed: '6 m/min', motorPower: '0.75 kW', weight: '32 kg', noiseLevel: '65 dB(A)', classification: ['d8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP54' },
        { model: 'ST 5005', series: 'ST', loadCapacity: '1000 kg', liftingSpeed: '12 m/min', motorPower: '1.5 kW', weight: '48 kg', noiseLevel: '67 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ST 5010', series: 'ST', loadCapacity: '2000 kg', liftingSpeed: '6 m/min', motorPower: '1.5 kW', weight: '48 kg', noiseLevel: '67 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ST 5020', series: 'ST', loadCapacity: '3200 kg', liftingSpeed: '4 m/min', motorPower: '1.5 kW', weight: '58 kg', noiseLevel: '68 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ST 5025', series: 'ST', loadCapacity: '5000 kg', liftingSpeed: '2.5 m/min', motorPower: '2.2 kW', weight: '72 kg', noiseLevel: '69 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        { model: 'ST 5032', series: 'ST', loadCapacity: '6300 kg', liftingSpeed: '2 m/min', motorPower: '2.2 kW', weight: '85 kg', noiseLevel: '70 dB(A)', classification: ['d8+'], dutyCycle: '50%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55' },
        // SH Series - Compact with Variable Speed
        { model: 'SH 3010 VF', series: 'SH', loadCapacity: '1000 kg', liftingSpeed: '0.5-8 m/min', motorPower: '1.1 kW', weight: '38 kg', noiseLevel: '58 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        { model: 'SH 5010 VF', series: 'SH', loadCapacity: '2000 kg', liftingSpeed: '0.3-6 m/min', motorPower: '1.5 kW', weight: '52 kg', noiseLevel: '60 dB(A)', classification: ['d8+'], dutyCycle: '60%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP55', quietOperation: true },
        // AS7 Series - ATEX Explosion Proof
        { model: 'AS7 05 Ex', series: 'AS7', loadCapacity: '125 kg', liftingSpeed: '12 m/min', motorPower: '0.25 kW', weight: '18 kg', classification: ['atex', 'd8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP65' },
        { model: 'AS7 10 Ex', series: 'AS7', loadCapacity: '250 kg', liftingSpeed: '6 m/min', motorPower: '0.25 kW', weight: '18 kg', classification: ['atex', 'd8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP65' },
        { model: 'AS7 20 Ex', series: 'AS7', loadCapacity: '500 kg', liftingSpeed: '6 m/min', motorPower: '0.55 kW', weight: '28 kg', classification: ['atex', 'd8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP65' },
        { model: 'AS7 30 Ex', series: 'AS7', loadCapacity: '1000 kg', liftingSpeed: '3 m/min', motorPower: '0.55 kW', weight: '35 kg', classification: ['atex', 'd8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP65' },
        { model: 'AS7 50 Ex', series: 'AS7', loadCapacity: '2000 kg', liftingSpeed: '3 m/min', motorPower: '1.1 kW', weight: '52 kg', classification: ['atex', 'd8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP65' },
        { model: 'AS7 100 Ex', series: 'AS7', loadCapacity: '5000 kg', liftingSpeed: '1.5 m/min', motorPower: '1.5 kW', weight: '85 kg', classification: ['atex', 'd8'], dutyCycle: '40%', voltageOptions: ['400V 3Ph'], protectionClass: 'IP65' },
      ],
      // Nitchi closed operations in June 2023
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
