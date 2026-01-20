const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { chromium } = require('playwright');

const DB_PATH = path.join(__dirname, 'chainhoist_data', 'chainhoist_database.json');
const IMAGES_DIR = path.join(__dirname, 'chainhoist_data', 'media', 'images');

// Skip patterns for non-product images
const SKIP_PATTERNS = [
  'icon', 'logo', 'pixel', 'tracking', 'avatar', 'badge', 'flag',
  'payment', 'social', 'share', 'spinner', 'loading', 'placeholder',
  'blank', '1x1', 'spacer', 'transparent', 'consent', 'cookie'
];

function shouldSkip(url) {
  const lower = url.toLowerCase();
  return SKIP_PATTERNS.some(p => lower.includes(p)) || lower.endsWith('.gif');
}

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filepath);

    const request = protocol.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
        downloadImage(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        const stats = fs.statSync(filepath);
        if (stats.size < 2000) {
          fs.unlinkSync(filepath);
          reject(new Error('File too small'));
          return;
        }
        resolve(filepath);
      });
    });
    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      reject(err);
    });
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function sanitize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
}

async function scrapeImages(page, url) {
  const images = [];

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Scroll to trigger lazy loading
    // eslint-disable-next-line no-undef
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(1000);

    // Get all images with their attributes
    const allImages = await page.$$eval('img', imgs => imgs.map(img => ({
      src: img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'),
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0
    })));

    // Filter and collect good images
    const seen = new Set();
    for (const img of allImages) {
      if (!img.src || !img.src.startsWith('http')) {
        continue;
      }
      if (img.width < 100 || img.height < 100) {
        continue;
      }
      if (shouldSkip(img.src)) {
        continue;
      }
      if (seen.has(img.src)) {
        continue;
      }

      seen.add(img.src);
      images.push(img);

      if (images.length >= 5) {
        break;
      }
    }

  } catch (err) {
    // Silent fail - will return empty array
  }

  return images;
}

async function main() {
  console.log('Image Scraper v2\n');

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const products = db.data;

  // Products without images, with specific URLs
  const needImages = products.filter(p => {
    if (p.images && p.images.length > 0) {
      return false;
    }
    if (!p.url || !p.url.startsWith('http')) {
      return false;
    }
    try {
      return new URL(p.url).pathname.length > 2;
    } catch {
      return false;
    }
  });

  console.log(`Total products: ${products.length}`);
  console.log(`Need images: ${needImages.length}\n`);

  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let success = 0, fail = 0;
  const limit = Math.min(needImages.length, 100);

  for (let i = 0; i < limit; i++) {
    const p = needImages[i];
    process.stdout.write(`[${i + 1}/${limit}] ${p.manufacturer} - ${p.model.substring(0, 30)}... `);

    const images = await scrapeImages(page, p.url);

    if (images.length === 0) {
      console.log('no images');
      fail++;
      continue;
    }

    console.log(`found ${images.length}`);

    // Download up to 3 images
    const downloaded = [];
    for (let j = 0; j < Math.min(images.length, 3); j++) {
      const img = images[j];
      try {
        const ext = path.extname(new URL(img.src).pathname).split('?')[0] || '.jpg';
        const filename = `${sanitize(p.manufacturer)}_${sanitize(p.model)}_${j}${ext}`;
        const filepath = path.join(IMAGES_DIR, filename);

        await downloadImage(img.src, filepath);
        downloaded.push(`/media/images/${filename}`);
        console.log(`    -> ${filename}`);
      } catch (err) {
        console.log(`    -> failed: ${err.message}`);
      }
    }

    if (downloaded.length > 0) {
      const dbProduct = products.find(x => x.id === p.id);
      if (dbProduct) {
        dbProduct.images = downloaded;
        success++;
      }
    }

    await page.waitForTimeout(500);
  }

  await browser.close();

  // Save database
  db.stats.imagesScrapedAt = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  console.log('\n=== COMPLETE ===');
  console.log(`Processed: ${limit}`);
  console.log(`Got images: ${success}`);
  console.log(`No images: ${fail}`);
}

main().catch(console.error);
