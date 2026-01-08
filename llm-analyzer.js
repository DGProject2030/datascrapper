/**
 * LLM Analyzer Module
 * Uses Google Gemini for intelligent data extraction from images and PDFs
 * @version 1.0.0
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load configuration
const config = require('./config.json');

/**
 * Logger utility
 */
class Logger {
  constructor(prefix = 'LLM') {
    this.prefix = prefix;
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${this.prefix}] [${level.toUpperCase()}] ${message}`;
    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }

  info(message, data) {
    this.log('info', message, data);
  }
  warn(message, data) {
    this.log('warn', message, data);
  }
  error(message, data) {
    this.log('error', message, data);
  }
  debug(message, data) {
    this.log('debug', message, data);
  }
}

const logger = new Logger('LLM-Analyzer');

/**
 * Rate limiter for API calls
 */
class RateLimiter {
  constructor(requestsPerMinute = 15, requestsPerDay = 1500) {
    this.requestsPerMinute = requestsPerMinute;
    this.requestsPerDay = requestsPerDay;
    this.minuteQueue = [];
    this.dayQueue = [];
    this.dailyResetTime = this.getNextMidnight();
  }

  getNextMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime();
  }

  async waitForSlot() {
    const now = Date.now();

    // Reset daily counter at midnight
    if (now >= this.dailyResetTime) {
      this.dayQueue = [];
      this.dailyResetTime = this.getNextMidnight();
    }

    // Clean up old minute entries
    this.minuteQueue = this.minuteQueue.filter(t => now - t < 60000);

    // Check daily limit
    if (this.dayQueue.length >= this.requestsPerDay) {
      const waitTime = this.dailyResetTime - now;
      logger.warn(`Daily rate limit reached. Waiting until midnight (${Math.round(waitTime / 3600000)}h)`);
      throw new Error('Daily rate limit exceeded');
    }

    // Check minute limit
    if (this.minuteQueue.length >= this.requestsPerMinute) {
      const oldestRequest = this.minuteQueue[0];
      const waitTime = 60000 - (now - oldestRequest) + 100;
      logger.debug(`Rate limit: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Record this request
    this.minuteQueue.push(now);
    this.dayQueue.push(now);
  }

  getStatus() {
    const now = Date.now();
    this.minuteQueue = this.minuteQueue.filter(t => now - t < 60000);
    return {
      minuteRemaining: this.requestsPerMinute - this.minuteQueue.length,
      dayRemaining: this.requestsPerDay - this.dayQueue.length
    };
  }
}

/**
 * Cache manager for LLM responses
 */
class CacheManager {
  constructor(cacheDir = 'chainhoist_data/llm_cache') {
    this.cacheDir = cacheDir;
    this.ensureCacheDir();
  }

  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      logger.info(`Created cache directory: ${this.cacheDir}`);
    }
  }

  getContentHash(content) {
    if (Buffer.isBuffer(content)) {
      return crypto.createHash('sha256').update(content).digest('hex');
    }
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  getCacheFilePath(hash) {
    return path.join(this.cacheDir, `${hash}.json`);
  }

  get(contentHash) {
    const cachePath = this.getCacheFilePath(contentHash);
    if (fs.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        // Check if cache is still valid (7 days)
        const cacheAge = Date.now() - cached.timestamp;
        if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
          logger.debug(`Cache hit for ${contentHash.substring(0, 8)}...`);
          return cached.data;
        }
      } catch (err) {
        logger.warn(`Cache read error: ${err.message}`);
      }
    }
    return null;
  }

  set(contentHash, data) {
    const cachePath = this.getCacheFilePath(contentHash);
    try {
      const cacheEntry = {
        timestamp: Date.now(),
        data: data
      };
      fs.writeFileSync(cachePath, JSON.stringify(cacheEntry, null, 2));
      logger.debug(`Cached result for ${contentHash.substring(0, 8)}...`);
    } catch (err) {
      logger.warn(`Cache write error: ${err.message}`);
    }
  }

  clear() {
    const files = fs.readdirSync(this.cacheDir);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    });
    logger.info(`Cleared ${files.length} cached entries`);
  }
}

/**
 * Main LLM Analyzer class
 */
class LLMAnalyzer {
  constructor(apiKey = null, options = {}) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;

    if (!this.apiKey) {
      throw new Error(
        'GEMINI_API_KEY not found. Please set it in your environment or pass it to the constructor.\n' +
        'Get your API key from: https://makersuite.google.com/app/apikey'
      );
    }

    this.options = {
      model: options.model || config.llm?.model || 'gemini-1.5-flash',
      maxTokens: options.maxTokens || config.llm?.maxTokens || 4096,
      cacheEnabled: options.cacheEnabled ?? config.llm?.cache?.enabled ?? true,
      cacheDir: options.cacheDir || config.llm?.cache?.directory || 'chainhoist_data/llm_cache',
      requestsPerMinute: options.requestsPerMinute || config.llm?.rateLimit?.requestsPerMinute || 15,
      requestsPerDay: options.requestsPerDay || config.llm?.rateLimit?.requestsPerDay || 1500
    };

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: this.options.model });
    this.rateLimiter = new RateLimiter(this.options.requestsPerMinute, this.options.requestsPerDay);
    this.cache = this.options.cacheEnabled ? new CacheManager(this.options.cacheDir) : null;

    logger.info(`LLM Analyzer initialized with model: ${this.options.model}`);
  }

  /**
   * Analyze a product image to extract specifications
   * @param {string} imagePath - Path to the image file
   * @returns {Promise<Object>} Extracted specifications
   */
  async analyzeProductImage(imagePath) {
    logger.info(`Analyzing image: ${path.basename(imagePath)}`);

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const contentHash = this.cache?.getContentHash(imageBuffer);

    // Check cache
    if (this.cache) {
      const cached = this.cache.get(contentHash);
      if (cached) {
        return cached;
      }
    }

    await this.rateLimiter.waitForSlot();

    const mimeType = this.getMimeType(imagePath);
    const imageData = imageBuffer.toString('base64');

    const prompt = `Analyze this electric chainhoist product image and extract all visible specifications and features.

Return a JSON object with the following structure:
{
  "model": "model name if visible",
  "manufacturer": "manufacturer name if visible",
  "loadCapacity": "capacity in kg if visible (e.g., '1000 kg')",
  "liftingSpeed": "speed if visible (e.g., '4 m/min')",
  "motorPower": "power rating if visible (e.g., '1.5 kW')",
  "weight": "weight if visible",
  "dimensions": "dimensions if visible",
  "bodyColor": ["colors visible"],
  "hookType": "hook type if visible (e.g., 'swivel', 'rigid')",
  "chainType": "chain type if visible",
  "controlType": "control type if visible (e.g., 'pendant', 'wireless')",
  "features": ["list of visible features"],
  "safetyFeatures": ["visible safety features"],
  "certificationLogos": ["any certification logos visible"],
  "confidence": 0.0 to 1.0
}

Only include fields where you can see relevant information. Set confidence based on image clarity and visible details.`;

    try {
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: mimeType,
            data: imageData
          }
        }
      ]);

      const response = result.response.text();
      const parsed = this.parseJSONResponse(response);

      // Cache the result
      if (this.cache && parsed) {
        this.cache.set(contentHash, parsed);
      }

      return parsed;
    } catch (error) {
      logger.error(`Image analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze a PDF document (datasheet/manual) to extract specifications
   * @param {string} pdfPath - Path to the PDF file
   * @returns {Promise<Object>} Extracted specifications
   */
  async analyzePDF(pdfPath) {
    logger.info(`Analyzing PDF: ${path.basename(pdfPath)}`);

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF not found: ${pdfPath}`);
    }

    // Import pdf-parse dynamically
    const pdfParse = require('pdf-parse');
    const pdfBuffer = fs.readFileSync(pdfPath);
    const contentHash = this.cache?.getContentHash(pdfBuffer);

    // Check cache
    if (this.cache) {
      const cached = this.cache.get(contentHash);
      if (cached) {
        return cached;
      }
    }

    // Extract text from PDF
    let pdfText;
    try {
      const pdfData = await pdfParse(pdfBuffer);
      pdfText = pdfData.text;
    } catch (err) {
      logger.warn(`PDF text extraction failed: ${err.message}. Trying as image...`);
      // If text extraction fails, we could potentially convert to image
      // For now, return empty result
      return { error: 'PDF text extraction failed', confidence: 0 };
    }

    if (!pdfText || pdfText.trim().length < 50) {
      logger.warn('PDF contains little or no text');
      return { error: 'PDF contains no extractable text', confidence: 0 };
    }

    await this.rateLimiter.waitForSlot();

    // Truncate text if too long (Gemini has token limits)
    const maxChars = 30000;
    if (pdfText.length > maxChars) {
      pdfText = pdfText.substring(0, maxChars) + '\n...[truncated]';
    }

    const prompt = `Analyze this electric chainhoist product datasheet/manual and extract all specifications.

Document text:
${pdfText}

Return a JSON object with the following structure:
{
  "model": "model name",
  "manufacturer": "manufacturer name",
  "series": "product series",
  "loadCapacity": "capacity with unit (e.g., '1000 kg (2200 lbs)')",
  "liftingSpeed": "speed with unit (e.g., '4 m/min (13 ft/min)')",
  "motorPower": "power with unit (e.g., '1.5 kW (2 HP)')",
  "dutyCycle": "duty cycle (e.g., '40%', 'M4', 'H4')",
  "voltageOptions": ["available voltages"],
  "weight": "weight with unit",
  "dimensions": "dimensions",
  "chainFall": "number of chain falls",
  "classification": ["certifications like 'd8', 'd8+', 'bgv-c1'"],
  "safetyFeatures": {
    "overloadProtection": true/false,
    "upperLimitSwitch": true/false,
    "lowerLimitSwitch": true/false,
    "emergencyStop": true/false,
    "slipClutch": true/false
  },
  "certifications": ["CE", "UL", "CSA", etc.],
  "applications": ["typical applications"],
  "operatingTemperature": "temperature range",
  "protectionClass": "IP rating",
  "noiseLevel": "noise level in dB",
  "warranty": "warranty period",
  "confidence": 0.0 to 1.0
}

Extract as much information as possible from the document. Only include fields with actual data found.`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      const parsed = this.parseJSONResponse(response);

      // Cache the result
      if (this.cache && parsed) {
        this.cache.set(contentHash, parsed);
      }

      return parsed;
    } catch (error) {
      logger.error(`PDF analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze product description text to extract structured data
   * @param {string} text - Product description text
   * @param {Object} existingData - Existing product data to enhance
   * @returns {Promise<Object>} Extracted/enhanced specifications
   */
  async analyzeText(text, existingData = {}) {
    if (!text || text.trim().length < 20) {
      return existingData;
    }

    const contentHash = this.cache?.getContentHash(text + JSON.stringify(existingData));

    // Check cache
    if (this.cache) {
      const cached = this.cache.get(contentHash);
      if (cached) {
        return cached;
      }
    }

    await this.rateLimiter.waitForSlot();

    const prompt = `Extract electric chainhoist specifications from this product description.

Existing data (enhance but don't override unless more accurate):
${JSON.stringify(existingData, null, 2)}

Product description:
${text}

Return a JSON object with extracted/enhanced specifications:
{
  "loadCapacity": "capacity with unit",
  "liftingSpeed": "speed with unit",
  "motorPower": "power with unit",
  "dutyCycle": "duty cycle",
  "classification": ["certifications"],
  "features": ["key features"],
  "applications": ["typical uses"],
  "confidence": 0.0 to 1.0
}

Merge with existing data, preferring more complete/accurate values.`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      const parsed = this.parseJSONResponse(response);

      // Merge with existing data
      const merged = { ...existingData, ...parsed };

      // Cache the result
      if (this.cache && parsed) {
        this.cache.set(contentHash, merged);
      }

      return merged;
    } catch (error) {
      logger.error(`Text analysis failed: ${error.message}`);
      return existingData;
    }
  }

  /**
   * Batch analyze multiple items with rate limiting
   * @param {Array} items - Array of {type: 'image'|'pdf'|'text', path?: string, content?: string}
   * @returns {Promise<Array>} Array of results
   */
  async analyzeMultiple(items) {
    const results = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      logger.info(`Processing item ${i + 1}/${items.length}: ${item.type}`);

      try {
        let result;
        switch (item.type) {
        case 'image':
          result = await this.analyzeProductImage(item.path);
          break;
        case 'pdf':
          result = await this.analyzePDF(item.path);
          break;
        case 'text':
          result = await this.analyzeText(item.content, item.existingData);
          break;
        default:
          result = { error: `Unknown item type: ${item.type}` };
        }
        results.push({ success: true, data: result, item });
      } catch (error) {
        results.push({ success: false, error: error.message, item });
      }

      // Small delay between requests
      if (i < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return results;
  }

  /**
   * Merge LLM-extracted data with existing product data
   * @param {Object} existingProduct - Existing product data
   * @param {Object} llmData - Data extracted by LLM
   * @returns {Object} Merged product data
   */
  mergeProductData(existingProduct, llmData) {
    const merged = { ...existingProduct };

    // Fields to potentially update from LLM
    const updateableFields = [
      'loadCapacity', 'liftingSpeed', 'motorPower', 'dutyCycle',
      'weight', 'dimensions', 'voltageOptions', 'classification',
      'safetyFeatures', 'certifications', 'warranty', 'noiseLevel',
      'protectionClass', 'applications', 'features'
    ];

    for (const field of updateableFields) {
      if (llmData[field] !== undefined && llmData[field] !== null) {
        // Only update if existing field is empty/missing or LLM has higher confidence
        const existingEmpty = !existingProduct[field] ||
          (Array.isArray(existingProduct[field]) && existingProduct[field].length === 0);

        if (existingEmpty || (llmData.confidence > 0.8 && existingProduct.confidence < 0.8)) {
          merged[field] = llmData[field];
        }
      }
    }

    // Update confidence score
    if (llmData.confidence) {
      merged.confidence = Math.max(existingProduct.confidence || 0, llmData.confidence);
    }

    // Add LLM metadata
    merged.llmEnriched = true;
    merged.llmEnrichedAt = new Date().toISOString();

    return merged;
  }

  /**
   * Parse JSON from LLM response (handles markdown code blocks)
   */
  parseJSONResponse(response) {
    // Remove markdown code blocks if present
    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    try {
      return JSON.parse(jsonStr.trim());
    } catch (error) {
      logger.warn(`Failed to parse LLM response as JSON: ${error.message}`);
      // Try to extract JSON object from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // Return raw response if parsing fails
          return { rawResponse: response, confidence: 0 };
        }
      }
      return { rawResponse: response, confidence: 0 };
    }
  }

  /**
   * Get MIME type from file extension
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  /**
   * Clear the analysis cache
   */
  clearCache() {
    if (this.cache) {
      this.cache.clear();
    }
  }
}

module.exports = {
  LLMAnalyzer,
  CacheManager,
  RateLimiter,
  Logger
};
