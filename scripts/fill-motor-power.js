/**
 * Fill Motor Power Gap Script
 * Cleans placeholder values and estimates motor power based on capacity patterns
 */

const fs = require('fs');
const path = require('path');

const databasePath = path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database.json');

console.log('=== FILL MOTOR POWER GAP ===\n');
console.log('Loading database...');
const dbContent = fs.readFileSync(databasePath, 'utf8');
const parsed = JSON.parse(dbContent);
const database = Array.isArray(parsed) ? parsed : (parsed.data || []);

console.log(`Total products: ${database.length}\n`);

// Placeholder patterns to treat as empty
const placeholderPatterns = [
  /^not\s*(specified|visible|available|applicable)/i,
  /^n\/?a$/i,
  /^-$/,
  /^unknown$/i,
  /^tbd$/i,
  /^varies$/i,
  /^see\s+spec/i,
  /^contact/i,
];

function isPlaceholder(value) {
  if (!value || typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return true;
  }
  return placeholderPatterns.some(p => p.test(trimmed));
}

// Known motor power values for common hoist models
const knownMotorPower = {
  // Columbus McKinnon Lodestar series
  'columbus mckinnon|lodestar 250': '0.55 kW (0.7 HP)',
  'columbus mckinnon|lodestar 500': '1.1 kW (1.5 HP)',
  'columbus mckinnon|lodestar 1000': '1.5 kW (2.0 HP)',
  'columbus mckinnon|lodestar 2000': '2.2 kW (3.0 HP)',

  // ABUS GM series (typical values)
  'abus kransysteme|gm2': '0.25 kW',
  'abus kransysteme|gm4': '0.55 kW',
  'abus kransysteme|gm6': '1.1 kW',
  'abus kransysteme|gm8': '2.2 kW',
  'abus kransysteme|abucompact gm2': '0.25 kW',
  'abus kransysteme|abucompact gm4': '0.55 kW',
  'abus kransysteme|abucompact gm6': '1.1 kW',
  'abus kransysteme|abucompact gmc': '0.18 kW',

  // Demag DC series
  'demag|dc-com': '0.18-1.5 kW',
  'demag|dc-pro': '0.25-15 kW',
  'demag|dc chain hoists': '0.18-15 kW',

  // Kito ER2 series
  'kito|er2': '0.4-3.7 kW',
  'kito|eq': '0.3-2.2 kW',

  // Yale CPE series
  'yale hoists|cpe': '0.25-2.2 kW',

  // J.D. Neuhaus (pneumatic - air consumption instead)
  'j.d. neuhaus|profi': 'Pneumatic',
  'j.d. neuhaus|mini': 'Pneumatic',
};

// Typical motor power by capacity (for estimation)
// Based on industry standard ratios
function estimateMotorPower(capacityKg) {
  if (!capacityKg || capacityKg <= 0) {
    return null;
  }

  // Typical motor power = capacity * lifting speed / efficiency
  // Assuming ~4m/min lifting speed, ~80% efficiency
  // P = (m * g * v) / (60 * η) where v is in m/min
  // Simplified: P (kW) ≈ capacity(kg) * 0.0008

  if (capacityKg <= 125) {
    return '0.18-0.25 kW';
  }
  if (capacityKg <= 250) {
    return '0.25-0.37 kW';
  }
  if (capacityKg <= 500) {
    return '0.37-0.75 kW';
  }
  if (capacityKg <= 1000) {
    return '0.75-1.5 kW';
  }
  if (capacityKg <= 2000) {
    return '1.5-3.0 kW';
  }
  if (capacityKg <= 5000) {
    return '3.0-7.5 kW';
  }
  if (capacityKg <= 10000) {
    return '7.5-15 kW';
  }
  return '15+ kW';
}

// Parse capacity to kg
function parseCapacityKg(capacity) {
  if (!capacity) {
    return null;
  }

  // Handle ranges - take the first value
  const rangeMatch = capacity.match(/(\d+(?:[.,]\d+)?)/);
  if (!rangeMatch) {
    return null;
  }

  let value = parseFloat(rangeMatch[1].replace(',', '.'));

  // Convert to kg if in other units
  if (/lb|pound/i.test(capacity)) {
    value = value * 0.453592;
  } else if (/ton/i.test(capacity)) {
    if (/short/i.test(capacity)) {
      value = value * 907.185;
    } else {
      value = value * 1000; // metric ton
    }
  }

  return Math.round(value);
}

let stats = {
  cleaned: 0,
  fromKnown: 0,
  estimated: 0,
  unchanged: 0,
  alreadyHas: 0
};

database.forEach(product => {
  const currentPower = product.motorPower;

  // Skip if already has valid motor power
  if (currentPower && !isPlaceholder(currentPower)) {
    stats.alreadyHas++;
    return;
  }

  // Clean placeholder values
  if (currentPower && isPlaceholder(currentPower)) {
    product.motorPower = '';
    stats.cleaned++;
  }

  // Try to find known motor power
  const mfr = (product.manufacturer || '').toLowerCase();
  const model = (product.model || '').toLowerCase();

  for (const [key, power] of Object.entries(knownMotorPower)) {
    const [keyMfr, keyModel] = key.split('|');
    if (mfr.includes(keyMfr) && model.includes(keyModel)) {
      product.motorPower = power;
      stats.fromKnown++;
      return;
    }
  }

  // Try to estimate based on capacity
  const capacityKg = parseCapacityKg(product.loadCapacity);
  if (capacityKg) {
    const estimated = estimateMotorPower(capacityKg);
    if (estimated) {
      product.motorPower = `${estimated} (estimated)`;
      stats.estimated++;
      return;
    }
  }

  stats.unchanged++;
});

console.log('--- Results ---');
console.log(`Already had valid motor power: ${stats.alreadyHas}`);
console.log(`Cleaned placeholder values: ${stats.cleaned}`);
console.log(`Filled from known data: ${stats.fromKnown}`);
console.log(`Estimated from capacity: ${stats.estimated}`);
console.log(`Still missing: ${stats.unchanged}`);
console.log('');

// Calculate new coverage
const withPower = database.filter(p => p.motorPower && !isPlaceholder(p.motorPower)).length;
console.log(`Motor power coverage: ${withPower}/${database.length} (${(withPower/database.length*100).toFixed(1)}%)`);

// Save updated database
const output = {
  data: database,
  stats: {
    totalProducts: database.length,
    manufacturers: [...new Set(database.map(p => p.manufacturer))].length
  },
  scrapedAt: parsed.scrapedAt || new Date().toISOString(),
  enrichedAt: new Date().toISOString(),
  version: '3.3'
};

fs.writeFileSync(databasePath, JSON.stringify(output, null, 2));
console.log(`\nSaved enriched database to: ${databasePath}`);
