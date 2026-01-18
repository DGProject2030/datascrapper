/**
 * Browser Scraper Module - Playwright-based scraping for JavaScript-heavy websites
 *
 * This module provides browser automation capabilities for scraping websites
 * that require JavaScript rendering, which static HTML parsers like Cheerio cannot handle.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load configuration
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

class PlaywrightScraper {
  constructor(options = {}) {
    this.headless = options.headless ?? true;
    this.timeout = options.timeout || CONFIG.scraper?.timeout || 30000;
    this.browser = null;
    this.userAgentIndex = 0;
    this.screenshotDir = options.screenshotDir || path.join(__dirname, 'chainhoist_data', 'screenshots');
  }

  /**
   * Initialize the browser instance
   */
  async initialize() {
    if (this.browser) {
      return;
    }

    console.log('[PlaywrightScraper] Initializing browser...');

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ]
    });

    // Ensure screenshot directory exists
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }

    console.log('[PlaywrightScraper] Browser initialized');
  }

  /**
   * Get rotating user agent
   */
  getNextUserAgent() {
    const ua = USER_AGENTS[this.userAgentIndex];
    this.userAgentIndex = (this.userAgentIndex + 1) % USER_AGENTS.length;
    return ua;
  }

  /**
   * Fetch a page with full JavaScript rendering
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<string>} - Rendered HTML content
   */
  async fetchPage(url, options = {}) {
    if (!this.browser) {
      await this.initialize();
    }

    const {
      waitForSelector = null,
      waitForTimeout = 2000,
      takeScreenshot = false,
      scrollToBottom = false,
    } = options;

    const context = await this.browser.newContext({
      userAgent: this.getNextUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    const page = await context.newPage();

    try {
      // Set extra headers to appear more like a real browser
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      });

      // Navigate to URL
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });

      // Wait for specific selector if provided
      if (waitForSelector) {
        try {
          await page.waitForSelector(waitForSelector, { timeout: this.timeout });
        } catch (e) {
          console.log(`[PlaywrightScraper] Selector "${waitForSelector}" not found, continuing...`);
        }
      }

      // Additional wait for dynamic content
      if (waitForTimeout > 0) {
        await page.waitForTimeout(waitForTimeout);
      }

      // Scroll to load lazy content if requested
      if (scrollToBottom) {
        await this.scrollToBottom(page);
      }

      // Take screenshot for debugging/AI analysis
      if (takeScreenshot) {
        const screenshotPath = path.join(
          this.screenshotDir,
          `${this.urlToFilename(url)}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[PlaywrightScraper] Screenshot saved: ${screenshotPath}`);
      }

      // Get rendered HTML
      const html = await page.content();

      return html;

    } finally {
      await context.close();
    }
  }

  /**
   * Fetch page and return both HTML and page object for further interaction
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<{html: string, page: Page, context: BrowserContext}>}
   */
  async fetchPageWithContext(url, options = {}) {
    if (!this.browser) {
      await this.initialize();
    }

    const context = await this.browser.newContext({
      userAgent: this.getNextUserAgent(),
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: this.timeout
    });

    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, { timeout: this.timeout });
      } catch (e) {
        // Continue even if selector not found
      }
    }

    await page.waitForTimeout(options.waitForTimeout || 2000);

    const html = await page.content();

    return { html, page, context };
  }

  /**
   * Scroll to bottom of page to trigger lazy loading
   * @param {Page} page - Playwright page object
   */
  async scrollToBottom(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          // eslint-disable-next-line no-undef
          const scrollHeight = document.body.scrollHeight;
          // eslint-disable-next-line no-undef
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Wait for any lazy-loaded content
    await page.waitForTimeout(1000);
  }

  /**
   * Extract product links from a page
   * @param {string} url - Product listing page URL
   * @param {string} linkSelector - CSS selector for product links
   * @returns {Promise<string[]>} - Array of product URLs
   */
  async extractProductLinks(url, linkSelector = 'a[href*="product"]') {
    if (!this.browser) {
      await this.initialize();
    }

    const { page, context } = await this.fetchPageWithContext(url, {
      scrollToBottom: true
    });

    try {
      const links = await page.$$eval(linkSelector, (elements, baseUrl) => {
        return elements.map(el => {
          const href = el.getAttribute('href');
          if (!href) {
            return null;
          }
          if (href.startsWith('http')) {
            return href;
          }
          if (href.startsWith('/')) {
            return new URL(href, baseUrl).href;
          }
          return new URL(href, baseUrl).href;
        }).filter(Boolean);
      }, url);

      return [...new Set(links)]; // Remove duplicates

    } finally {
      await context.close();
    }
  }

  /**
   * Take a screenshot for AI analysis
   * @param {string} url - URL to screenshot
   * @param {string} filename - Output filename (without extension)
   * @returns {Promise<string>} - Path to saved screenshot
   */
  async takeScreenshot(url, filename = null) {
    if (!this.browser) {
      await this.initialize();
    }

    const context = await this.browser.newContext({
      userAgent: this.getNextUserAgent(),
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });

      await page.waitForTimeout(2000);

      const screenshotPath = path.join(
        this.screenshotDir,
        `${filename || this.urlToFilename(url)}.png`
      );

      await page.screenshot({ path: screenshotPath, fullPage: true });

      return screenshotPath;

    } finally {
      await context.close();
    }
  }

  /**
   * Convert URL to safe filename
   * @param {string} url - URL to convert
   * @returns {string} - Safe filename
   */
  urlToFilename(url) {
    return url
      .replace(/^https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 100);
  }

  /**
   * Check if a page has product content
   * @param {string} html - HTML content
   * @param {string[]} keywords - Keywords to look for
   * @returns {boolean}
   */
  hasProductContent(html, keywords = ['hoist', 'capacity', 'lifting', 'load', 'kg', 'ton']) {
    const lowerHtml = html.toLowerCase();
    return keywords.some(keyword => lowerHtml.includes(keyword));
  }

  /**
   * Close the browser instance
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[PlaywrightScraper] Browser closed');
    }
  }
}

module.exports = { PlaywrightScraper };
