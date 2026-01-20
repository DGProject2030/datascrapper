/**
 * Scrape Validator - Filters out non-product and non-hoist data
 * Used by the scraper to prevent adding damaged/unnecessary data
 */

// URL patterns that indicate non-product pages
const SKIP_URL_PATTERNS = [
  /\/contact/i,
  /\/about/i,
  /\/blog/i,
  /\/news/i,
  /\/career/i,
  /\/job/i,
  /\/privacy/i,
  /\/terms/i,
  /\/cookie/i,
  /\/legal/i,
  /\/imprint/i,
  /\/impressum/i,
  /\/sitemap/i,
  /\/search/i,
  /\/login/i,
  /\/register/i,
  /\/account/i,
  /\/cart/i,
  /\/checkout/i,
  /\/download/i,
  /\/support/i,
  /\/faq/i,
  /\/help/i,
  /\/events/i,
  /\/training/i,
  /\/seminars/i,
  /\/webinar/i,
  /\/newsletter/i,
  /\/subscribe/i,
  /\/unsubscribe/i,
  /\/media/i,
  /\/press/i,
  /\/investors/i,
  /\/sustainability/i,
  /\/csr/i,
  /\/history/i,
  /\/team/i,
  /\/management/i,
  /\/locations/i,
  /\/dealers/i,
  /\/distributors/i,
  /\/partners/i,
  /\/industries/i,
  /\/solutions/i,
  /\/services/i,
  /\/case-stud/i,
  /\/testimonial/i,
  /\/reference/i,
  /\/catalogue/i,
  /\/brochure/i,
  /\/document/i,
  /\/video/i,
  /\/gallery/i,
  /\/404/i,
  /\/error/i
];

// Model names that indicate non-product pages
const SKIP_MODEL_PATTERNS = [
  /^contact/i,
  /^about/i,
  /^home/i,
  /^products$/i,
  /^services$/i,
  /^solutions$/i,
  /^industries$/i,
  /^news$/i,
  /^blog$/i,
  /^support$/i,
  /^download/i,
  /^catalogue/i,
  /^brochure/i,
  /^page not found/i,
  /^error/i,
  /^404/i,
  /^view all/i,
  /^see all/i,
  /^featured/i,
  /^overview/i,
  /global leader/i,
  /^accessories$/i,
  /^options$/i,
  /^parts$/i,
  /^spare parts$/i
];

// Product types that are NOT hoists/winches/trolleys/jacks (should be excluded)
const NON_HOIST_PATTERNS = [
  // Conveyors
  /conveyor/i,
  /flexmove/i,
  /montrac/i,
  /belt system/i,

  // Cranes (we want hoists, not full cranes)
  /\bcrane\b(?!.*hoist)/i,
  /gantry/i,
  /jib crane/i,
  /bridge crane/i,
  /overhead crane/i,

  // Material handling (non-hoist)
  /pallet truck/i,
  /pallet jack/i,
  /forklift/i,
  /stacker/i,
  /platform/i,
  /lift table/i,
  /lifting table/i,
  /scissor lift/i,
  /dock leveler/i,

  // Rigging (non-hoist)
  /\bsling\b/i,
  /\bshackle\b/i,
  /lashing/i,
  /webbing/i,
  /round sling/i,
  /wire rope(?!.*hoist)/i,
  /chain sling/i,  // Only "chain sling", not "chain hoist" or product names with "chain"

  // Drives and motors
  /\bdrive\b(?!.*hoist)/i,
  /\binverter\b/i,
  /\bmotor\b(?!.*hoist)/i,
  /\bbrake\b(?!.*hoist)/i,
  /frequency drive/i,
  /variable speed drive/i,

  // Electrical
  /conductor bar/i,
  /festoon/i,
  /cable system/i,
  /collector/i,
  /busbar/i,

  // Accessories that aren't products
  /transmitter/i,
  /receiver/i,
  /remote control(?!.*hoist)/i,
  /pendant/i,
  /controller(?!.*hoist)/i,

  // Lifting attachments (not hoists)
  /lifting magnet/i,
  /vacuum lifter/i,
  /grab/i,
  /clamp(?!.*trolley)/i,
  /spreader beam/i,
  /lifting beam/i,
  /c-hook/i,
  /coil hook/i,

  // Rail/bogie systems
  /bogie/i,
  /turntable/i,
  /transfer table/i,
  /rail system/i,

  // Other industrial equipment
  /compressor/i,
  /pump(?!.*hoist)/i,
  /cylinder/i,
  /valve/i,
  /actuator/i,
  /gear ?box/i,
  /workshop equipment/i,

  // Industry categories (not products)
  /^aerospace$/i,
  /^automotive$/i,
  /^construction$/i,
  /^entertainment$/i,
  /^manufacturing$/i,
  /^mining$/i,
  /^offshore$/i,
  /^pharmaceutical$/i,
  /^utilities$/i,
  /^water management$/i
];

// Product types that ARE hoists/winches/trolleys/jacks (should be included)
const HOIST_PATTERNS = [
  /hoist/i,
  /winch/i,
  /trolley/i,
  /\bjack\b/i,
  /puller/i,
  /come.?along/i,
  /lever block/i,
  /chain block/i,
  /lodestar/i,      // CM product line
  /prostar/i,       // CM product line
  /valuestar/i,     // CM product line
  /stagemaker/i,    // Verlinde product line
  /liftket/i,       // Liftket brand
  /abucompact/i,    // ABUS product line
  /dc-pro/i,        // Demag product line
  /dc-com/i         // Demag product line
];

/**
 * Check if a URL should be skipped (non-product page)
 */
function shouldSkipUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const urlObj = new URL(url);
    const pathAndQuery = urlObj.pathname + urlObj.search;

    // Skip if URL matches non-product patterns
    for (const pattern of SKIP_URL_PATTERNS) {
      if (pattern.test(pathAndQuery)) {
        return { skip: true, reason: `URL matches skip pattern: ${pattern}` };
      }
    }

    // Skip if URL is just the homepage (no specific product path)
    if (urlObj.pathname === '/' || urlObj.pathname === '') {
      return { skip: false, warn: 'Homepage URL - may not be product-specific' };
    }

    return { skip: false };
  } catch {
    return { skip: false };
  }
}

/**
 * Check if a model name indicates a non-product page
 */
function shouldSkipModel(model) {
  if (!model) {
    return { skip: true, reason: 'No model name provided' };
  }

  const trimmed = model.trim();

  // Skip very short or generic names
  if (trimmed.length < 2) {
    return { skip: true, reason: 'Model name too short' };
  }

  // Skip if model matches non-product patterns
  for (const pattern of SKIP_MODEL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { skip: true, reason: `Model matches skip pattern: ${pattern}` };
    }
  }

  return { skip: false };
}

/**
 * Check if a product is a hoist/winch/trolley/jack
 */
function isHoistProduct(product) {
  // Combine all text fields for checking
  const text = [
    product.model || '',
    product.productType || '',
    product.series || '',
    product.description || ''
  ].join(' ').toLowerCase();

  // First check if it's explicitly a hoist product
  for (const pattern of HOIST_PATTERNS) {
    if (pattern.test(text)) {
      return { isHoist: true, matched: pattern.toString() };
    }
  }

  // Then check if it's explicitly NOT a hoist product
  for (const pattern of NON_HOIST_PATTERNS) {
    if (pattern.test(text)) {
      return { isHoist: false, reason: `Matches non-hoist pattern: ${pattern}` };
    }
  }

  // If we can't determine, allow it but flag as uncertain
  return { isHoist: true, uncertain: true };
}

/**
 * Check if a product has minimum required data quality
 */
function hasMinimumData(product) {
  const issues = [];

  // Must have manufacturer
  if (!product.manufacturer) {
    issues.push('Missing manufacturer');
  }

  // Must have model
  if (!product.model || product.model.trim().length < 2) {
    issues.push('Missing or invalid model');
  }

  // Should have at least one spec OR meaningful description
  const hasSpecs = product.loadCapacity || product.liftingSpeed || product.motorPower;
  const hasDescription = product.description && product.description.length > 50;

  if (!hasSpecs && !hasDescription) {
    issues.push('No specifications or meaningful description');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Main validation function - validates a product before adding to database
 * Returns { valid: boolean, reasons: string[] }
 */
function validateProduct(product, options = {}) {
  const { strict = false, logWarnings = true } = options;
  const reasons = [];
  const warnings = [];

  // 1. Check URL
  if (product.url) {
    const urlCheck = shouldSkipUrl(product.url);
    if (urlCheck.skip) {
      reasons.push(urlCheck.reason);
    }
    if (urlCheck.warn) {
      warnings.push(urlCheck.warn);
    }
  }

  // 2. Check model name
  const modelCheck = shouldSkipModel(product.model);
  if (modelCheck.skip) {
    reasons.push(modelCheck.reason);
  }

  // 3. Check if it's a hoist product
  const hoistCheck = isHoistProduct(product);
  if (!hoistCheck.isHoist) {
    reasons.push(hoistCheck.reason);
  }
  if (hoistCheck.uncertain) {
    warnings.push('Product type uncertain - may not be a hoist');
  }

  // 4. Check minimum data quality (only in strict mode)
  if (strict) {
    const dataCheck = hasMinimumData(product);
    if (!dataCheck.valid) {
      reasons.push(...dataCheck.issues);
    }
  }

  // Log warnings if enabled
  if (logWarnings && warnings.length > 0) {
    console.warn(`[WARN] ${product.manufacturer} - ${product.model}: ${warnings.join(', ')}`);
  }

  return {
    valid: reasons.length === 0,
    reasons,
    warnings
  };
}

/**
 * Validate a batch of products
 * Returns { valid: Product[], invalid: { product: Product, reasons: string[] }[] }
 */
function validateBatch(products, options = {}) {
  const valid = [];
  const invalid = [];

  for (const product of products) {
    const result = validateProduct(product, { ...options, logWarnings: false });
    if (result.valid) {
      valid.push(product);
    } else {
      invalid.push({ product, reasons: result.reasons });
    }
  }

  return { valid, invalid };
}

// Export for use in scraper
module.exports = {
  validateProduct,
  validateBatch,
  shouldSkipUrl,
  shouldSkipModel,
  isHoistProduct,
  hasMinimumData,
  SKIP_URL_PATTERNS,
  SKIP_MODEL_PATTERNS,
  NON_HOIST_PATTERNS,
  HOIST_PATTERNS
};
