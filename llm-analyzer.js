/**
 * LLM Analyzer Module
 * Supports both OpenAI and Google Gemini for intelligent data extraction
 * @version 2.0.0
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
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
  constructor(requestsPerMinute = 60, requestsPerDay = 10000) {
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

    if (now >= this.dailyResetTime) {
      this.dayQueue = [];
      this.dailyResetTime = this.getNextMidnight();
    }

    this.minuteQueue = this.minuteQueue.filter(t => now - t < 60000);

    if (this.dayQueue.length >= this.requestsPerDay) {
      const waitTime = this.dailyResetTime - now;
      logger.warn(`Daily rate limit reached. Waiting until midnight (${Math.round(waitTime / 3600000)}h)`);
      throw new Error('Daily rate limit exceeded');
    }

    if (this.minuteQueue.length >= this.requestsPerMinute) {
      const oldestRequest = this.minuteQueue[0];
      const waitTime = 60000 - (now - oldestRequest) + 100;
      logger.debug(`Rate limit: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

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
      const cacheEntry = { timestamp: Date.now(), data: data };
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
 * Main LLM Analyzer class - supports OpenAI, Gemini, and Claude
 */
class LLMAnalyzer {
  constructor(options = {}) {
    // Determine provider from environment or options
    this.provider = options.provider || process.env.LLM_PROVIDER || config.llm?.provider || 'claude';

    // Get API keys
    const openaiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
    const geminiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
    const anthropicKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

    // Auto-detect provider based on available keys
    if (anthropicKey && !openaiKey && !geminiKey) {
      this.provider = 'claude';
    } else if (openaiKey && !geminiKey && !anthropicKey) {
      this.provider = 'openai';
    } else if (geminiKey && !openaiKey && !anthropicKey) {
      this.provider = 'gemini';
    } else if (anthropicKey) {
      this.provider = 'claude'; // Prefer Claude if multiple keys exist
    }

    // Set default model based on provider
    const defaultModels = {
      'claude': 'claude-sonnet-4-20250514',
      'openai': 'gpt-4o-mini',
      'gemini': 'gemini-2.0-flash'
    };

    this.options = {
      model: options.model || config.llm?.model || defaultModels[this.provider],
      maxTokens: options.maxTokens || config.llm?.maxTokens || 4096,
      cacheEnabled: options.cacheEnabled ?? config.llm?.cache?.enabled ?? true,
      cacheDir: options.cacheDir || config.llm?.cache?.directory || 'chainhoist_data/llm_cache',
      requestsPerMinute: options.requestsPerMinute || config.llm?.rateLimit?.requestsPerMinute || 60,
      requestsPerDay: options.requestsPerDay || config.llm?.rateLimit?.requestsPerDay || 10000
    };

    // Initialize the appropriate client
    if (this.provider === 'claude') {
      if (!anthropicKey) {
        throw new Error(
          'ANTHROPIC_API_KEY not found. Please set it in your environment or .env file.\n' +
          'Get your API key from: https://console.anthropic.com/settings/keys'
        );
      }
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
      this.options.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
    } else if (this.provider === 'openai') {
      if (!openaiKey) {
        throw new Error(
          'OPENAI_API_KEY not found. Please set it in your environment or .env file.\n' +
          'Get your API key from: https://platform.openai.com/api-keys'
        );
      }
      this.openai = new OpenAI({ apiKey: openaiKey });
      this.options.model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    } else {
      if (!geminiKey) {
        throw new Error(
          'GEMINI_API_KEY not found. Please set it in your environment or .env file.\n' +
          'Get your API key from: https://makersuite.google.com/app/apikey'
        );
      }
      this.genAI = new GoogleGenerativeAI(geminiKey);
      this.geminiModel = this.genAI.getGenerativeModel({ model: this.options.model });
    }

    this.rateLimiter = new RateLimiter(this.options.requestsPerMinute, this.options.requestsPerDay);
    this.cache = this.options.cacheEnabled ? new CacheManager(this.options.cacheDir) : null;

    logger.info(`LLM Analyzer initialized with provider: ${this.provider}, model: ${this.options.model}`);
  }

  /**
   * Generate content using the configured provider
   */
  async generateContent(prompt, imageData = null) {
    await this.rateLimiter.waitForSlot();

    if (this.provider === 'claude') {
      return this.generateWithClaude(prompt, imageData);
    } else if (this.provider === 'openai') {
      return this.generateWithOpenAI(prompt, imageData);
    } else {
      return this.generateWithGemini(prompt, imageData);
    }
  }

  /**
   * Generate content with Claude
   */
  async generateWithClaude(prompt, imageData = null) {
    const content = [];

    if (imageData) {
      // Vision request with image
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageData.mimeType,
          data: imageData.data
        }
      });
    }

    content.push({ type: 'text', text: prompt });

    const response = await this.anthropic.messages.create({
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      messages: [{ role: 'user', content }]
    });

    return response.content[0].text;
  }

  /**
   * Generate content with OpenAI
   */
  async generateWithOpenAI(prompt, imageData = null) {
    const messages = [];

    if (imageData) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${imageData.mimeType};base64,${imageData.data}`
            }
          }
        ]
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await this.openai.chat.completions.create({
      model: this.options.model,
      messages: messages,
      max_tokens: this.options.maxTokens,
      response_format: { type: 'json_object' }
    });

    return response.choices[0].message.content;
  }

  /**
   * Generate content with Gemini
   */
  async generateWithGemini(prompt, imageData = null) {
    let result;

    if (imageData) {
      result = await this.geminiModel.generateContent([
        prompt,
        { inlineData: { mimeType: imageData.mimeType, data: imageData.data } }
      ]);
    } else {
      result = await this.geminiModel.generateContent(prompt);
    }

    return result.response.text();
  }

  /**
   * Analyze a product image to extract specifications
   */
  async analyzeProductImage(imagePath) {
    logger.info(`Analyzing image: ${path.basename(imagePath)}`);

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const contentHash = this.cache?.getContentHash(imageBuffer);

    if (this.cache) {
      const cached = this.cache.get(contentHash);
      if (cached) {
        return cached;
      }
    }

    const mimeType = this.getMimeType(imagePath);
    const imageData = { mimeType, data: imageBuffer.toString('base64') };

    const prompt = `Analyze this electric chainhoist product image and extract all visible specifications.

Return a JSON object with these fields (only include fields where data is visible):
{
  "model": "model name if visible",
  "manufacturer": "manufacturer name if visible",
  "loadCapacity": "capacity in kg if visible",
  "liftingSpeed": "speed if visible",
  "motorPower": "power rating if visible",
  "weight": "weight if visible",
  "dimensions": "dimensions if visible",
  "features": ["list of visible features"],
  "safetyFeatures": ["visible safety features"],
  "certificationLogos": ["any certification logos visible"],
  "confidence": 0.0 to 1.0
}`;

    try {
      const response = await this.generateContent(prompt, imageData);
      const parsed = this.parseJSONResponse(response);

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
   * Analyze scanned PDF using vision capabilities
   */
  async analyzeScannedPDF(pdfPath) {
    logger.info(`Analyzing scanned PDF with ${this.provider} vision: ${path.basename(pdfPath)}`);

    const pdfBuffer = fs.readFileSync(pdfPath);

    // OpenAI and Claude don't support PDF directly via vision
    if (this.provider === 'openai' || this.provider === 'claude') {
      logger.warn(`${this.provider} does not support direct PDF vision analysis. Using text extraction only.`);
      return { error: `${this.provider} does not support scanned PDF analysis`, confidence: 0 };
    }

    const pdfData = { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') };

    const prompt = `This is a scanned PDF document for electric chainhoist or lifting equipment.
Analyze all visible content including tables, specifications, and text.

Return a JSON object with these fields (only include fields where data is found):
{
  "model": "model name",
  "manufacturer": "manufacturer name",
  "series": "product series",
  "loadCapacity": "capacity with unit",
  "liftingSpeed": "speed with unit",
  "motorPower": "power with unit",
  "dutyCycle": "duty cycle",
  "voltageOptions": ["available voltages"],
  "weight": "weight with unit",
  "dimensions": "dimensions",
  "classification": ["certifications"],
  "safetyFeatures": {},
  "certifications": ["CE", "UL", etc.],
  "applications": ["typical applications"],
  "protectionClass": "IP rating",
  "confidence": 0.0 to 1.0
}`;

    try {
      const response = await this.generateContent(prompt, pdfData);
      const parsed = this.parseJSONResponse(response);
      parsed.extractionMethod = `${this.provider}-vision`;
      return parsed;
    } catch (error) {
      logger.error(`Vision PDF analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze a PDF document to extract specifications
   */
  async analyzePDF(pdfPath) {
    logger.info(`Analyzing PDF: ${path.basename(pdfPath)}`);

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF not found: ${pdfPath}`);
    }

    const pdfParse = require('pdf-parse');
    const pdfBuffer = fs.readFileSync(pdfPath);
    const contentHash = this.cache?.getContentHash(pdfBuffer);

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
      logger.warn(`PDF text extraction failed: ${err.message}`);
      pdfText = null;
    }

    // If text extraction failed, try vision (Gemini only)
    if (!pdfText || pdfText.trim().length < 100) {
      logger.info('PDF contains little or no text, trying vision analysis...');
      if (this.provider === 'gemini') {
        try {
          const visionResult = await this.analyzeScannedPDF(pdfPath);
          if (this.cache && visionResult) {
            this.cache.set(contentHash, visionResult);
          }
          return visionResult;
        } catch (visionErr) {
          logger.error(`Vision analysis failed: ${visionErr.message}`);
        }
      }
      return { error: 'PDF contains no extractable text', confidence: 0 };
    }

    // Truncate text if too long
    const maxChars = 30000;
    if (pdfText.length > maxChars) {
      pdfText = pdfText.substring(0, maxChars) + '\n...[truncated]';
    }

    const prompt = `Analyze this electric chainhoist product datasheet/manual and extract all specifications.

Document text:
${pdfText}

Return a JSON object with these fields (only include fields with actual data):
{
  "model": "model name",
  "manufacturer": "manufacturer name",
  "series": "product series",
  "loadCapacity": "capacity with unit (e.g., '1000 kg (2200 lbs)')",
  "liftingSpeed": "speed with unit (e.g., '4 m/min')",
  "motorPower": "power with unit (e.g., '1.5 kW')",
  "dutyCycle": "duty cycle (e.g., '40%', 'M4')",
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
}`;

    try {
      const response = await this.generateContent(prompt);
      const parsed = this.parseJSONResponse(response);
      parsed.extractionMethod = 'text';

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
   * Analyze product description text
   */
  async analyzeText(text, existingData = {}) {
    if (!text || text.trim().length < 20) {
      return existingData;
    }

    const contentHash = this.cache?.getContentHash(text + JSON.stringify(existingData));

    if (this.cache) {
      const cached = this.cache.get(contentHash);
      if (cached) {
        return cached;
      }
    }

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
}`;

    try {
      const response = await this.generateContent(prompt);
      const parsed = this.parseJSONResponse(response);
      const merged = { ...existingData, ...parsed };

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
   * Batch analyze multiple items
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

      if (i < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return results;
  }

  /**
   * Merge LLM-extracted data with existing product data
   */
  mergeProductData(existingProduct, llmData) {
    const merged = { ...existingProduct };

    const updateableFields = [
      'loadCapacity', 'liftingSpeed', 'motorPower', 'dutyCycle',
      'weight', 'dimensions', 'voltageOptions', 'classification',
      'safetyFeatures', 'certifications', 'warranty', 'noiseLevel',
      'protectionClass', 'applications', 'features'
    ];

    for (const field of updateableFields) {
      if (llmData[field] !== undefined && llmData[field] !== null) {
        const existingEmpty = !existingProduct[field] ||
          (Array.isArray(existingProduct[field]) && existingProduct[field].length === 0);

        if (existingEmpty || (llmData.confidence > 0.8 && existingProduct.confidence < 0.8)) {
          merged[field] = llmData[field];
        }
      }
    }

    if (llmData.confidence) {
      merged.confidence = Math.max(existingProduct.confidence || 0, llmData.confidence);
    }

    merged.llmEnriched = true;
    merged.llmEnrichedAt = new Date().toISOString();
    merged.llmProvider = this.provider;

    return merged;
  }

  /**
   * Parse JSON from LLM response
   */
  parseJSONResponse(response) {
    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    try {
      return JSON.parse(jsonStr.trim());
    } catch (error) {
      logger.warn(`Failed to parse LLM response as JSON: ${error.message}`);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
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

  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

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
