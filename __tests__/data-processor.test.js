/**
 * Unit Tests for Chainhoist Data Processor
 * Tests data normalization, extraction, and validation functions
 */

// Mock fs module before requiring the processor
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(JSON.stringify({ data: [] })),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

// We need to test the class methods directly
// Since the processor class is not exported separately, we'll create a test instance
const ChainhoistDataProcessor = require('../chainhoist-data-processor');

describe('ChainhoistDataProcessor', () => {
  let processor;

  beforeEach(() => {
    // Create a fresh processor instance for each test
    processor = new ChainhoistDataProcessor();
  });

  describe('extractCapacityKg', () => {
    test('extracts kg values correctly', () => {
      expect(processor.extractCapacityKg('500 kg')).toBe(500);
      expect(processor.extractCapacityKg('1000kg')).toBe(1000);
      expect(processor.extractCapacityKg('2.5 kg')).toBe(2.5);
    });

    test('converts lbs to kg', () => {
      const result = processor.extractCapacityKg('1000 lbs');
      expect(result).toBeCloseTo(454, 0); // ~453.592 kg
    });

    test('converts tons to kg', () => {
      expect(processor.extractCapacityKg('1 ton')).toBe(1000);
      expect(processor.extractCapacityKg('2 tonnes')).toBe(2000);
      expect(processor.extractCapacityKg('0.5t')).toBe(500);
    });

    test('handles null and empty values', () => {
      expect(processor.extractCapacityKg(null)).toBeNull();
      expect(processor.extractCapacityKg(undefined)).toBeNull();
      expect(processor.extractCapacityKg('')).toBeNull();
    });

    test('handles unrecognized formats', () => {
      expect(processor.extractCapacityKg('unknown format')).toBeNull();
    });
  });

  describe('extractSpeedMMin', () => {
    test('extracts m/min values correctly', () => {
      expect(processor.extractSpeedMMin('8 m/min')).toBe(8);
      expect(processor.extractSpeedMMin('4m/min')).toBe(4);
      expect(processor.extractSpeedMMin('0.5 m/min')).toBe(0.5);
    });

    test('converts ft/min to m/min', () => {
      const result = processor.extractSpeedMMin('10 ft/min');
      expect(result).toBeCloseTo(3.0, 1); // ~3.048 m/min
    });

    test('converts fpm to m/min', () => {
      const result = processor.extractSpeedMMin('20 fpm');
      expect(result).toBeCloseTo(6.1, 1);
    });

    test('converts m/s to m/min', () => {
      expect(processor.extractSpeedMMin('0.1 m/s')).toBe(6); // 0.1 * 60
    });

    test('handles null and empty values', () => {
      expect(processor.extractSpeedMMin(null)).toBeNull();
      expect(processor.extractSpeedMMin(undefined)).toBeNull();
      expect(processor.extractSpeedMMin('')).toBeNull();
    });
  });

  describe('hasValidValue', () => {
    test('returns false for null and undefined', () => {
      expect(processor.hasValidValue(null)).toBe(false);
      expect(processor.hasValidValue(undefined)).toBe(false);
    });

    test('returns false for empty strings', () => {
      expect(processor.hasValidValue('')).toBe(false);
      expect(processor.hasValidValue('   ')).toBe(false);
      expect(processor.hasValidValue('-')).toBe(false);
    });

    test('returns false for empty arrays', () => {
      expect(processor.hasValidValue([])).toBe(false);
    });

    test('returns true for valid values', () => {
      expect(processor.hasValidValue('500 kg')).toBe(true);
      expect(processor.hasValidValue(0)).toBe(true);
      expect(processor.hasValidValue(false)).toBe(true);
      expect(processor.hasValidValue(['item'])).toBe(true);
      expect(processor.hasValidValue({ key: 'value' })).toBe(true);
    });
  });

  describe('calculateDataCompleteness', () => {
    test('returns 0 for empty record', () => {
      const record = {};
      expect(processor.calculateDataCompleteness(record)).toBe(0);
    });

    test('returns 100 for complete record', () => {
      const record = {
        loadCapacity: '500 kg',
        liftingSpeed: '8 m/min',
        motorPower: '1.5 kW',
        classification: ['d8+'],
        dutyCycle: '40%',
        voltageOptions: ['400V'],
        weight: '50 kg',
        protectionClass: 'IP55',
        series: 'Pro Series'
      };
      expect(processor.calculateDataCompleteness(record)).toBe(100);
    });

    test('calculates weighted score correctly', () => {
      // Only critical fields filled (70%)
      const criticalOnly = {
        loadCapacity: '500 kg',
        liftingSpeed: '8 m/min',
        motorPower: '1.5 kW',
        classification: ['d8+'],
        dutyCycle: '40%'
      };
      expect(processor.calculateDataCompleteness(criticalOnly)).toBe(70);

      // Only secondary fields filled (30%)
      const secondaryOnly = {
        voltageOptions: ['400V'],
        weight: '50 kg',
        protectionClass: 'IP55',
        series: 'Pro Series'
      };
      expect(processor.calculateDataCompleteness(secondaryOnly)).toBe(30);
    });

    test('handles partial data correctly', () => {
      const partial = {
        loadCapacity: '500 kg',
        liftingSpeed: '8 m/min',
        // motorPower missing
        classification: ['d8+'],
        // dutyCycle missing
        voltageOptions: ['400V'],
        weight: '50 kg'
      };
      // 3/5 critical = 60% of 70 = 42
      // 2/4 secondary = 50% of 30 = 15
      // Total = 57
      expect(processor.calculateDataCompleteness(partial)).toBe(57);
    });
  });

  describe('checkCompleteSpecs', () => {
    test('returns true when all required fields present', () => {
      const record = {
        loadCapacity: '500 kg',
        liftingSpeed: '8 m/min',
        motorPower: '1.5 kW'
      };
      expect(processor.checkCompleteSpecs(record)).toBe(true);
    });

    test('returns false when loadCapacity missing', () => {
      const record = {
        liftingSpeed: '8 m/min',
        motorPower: '1.5 kW'
      };
      expect(processor.checkCompleteSpecs(record)).toBe(false);
    });

    test('returns false when liftingSpeed missing', () => {
      const record = {
        loadCapacity: '500 kg',
        motorPower: '1.5 kW'
      };
      expect(processor.checkCompleteSpecs(record)).toBe(false);
    });

    test('returns false when motorPower missing', () => {
      const record = {
        loadCapacity: '500 kg',
        liftingSpeed: '8 m/min'
      };
      expect(processor.checkCompleteSpecs(record)).toBe(false);
    });

    test('returns false for empty string values', () => {
      const record = {
        loadCapacity: '',
        liftingSpeed: '8 m/min',
        motorPower: '1.5 kW'
      };
      expect(processor.checkCompleteSpecs(record)).toBe(false);
    });
  });

  describe('cleanManufacturerName', () => {
    test('standardizes known manufacturer names', () => {
      expect(processor.cleanManufacturerName('Columbus McKinnon (CM)')).toBe('Columbus McKinnon');
      expect(processor.cleanManufacturerName('CM')).toBe('Columbus McKinnon');
      expect(processor.cleanManufacturerName('Chainmaster GmbH')).toBe('Chainmaster');
      expect(processor.cleanManufacturerName('Verlinde (Stagemaker)')).toBe('Verlinde');
      expect(processor.cleanManufacturerName('Stagemaker')).toBe('Verlinde');
    });

    test('returns unchanged for unknown manufacturers', () => {
      expect(processor.cleanManufacturerName('KITO')).toBe('KITO');
      expect(processor.cleanManufacturerName('Demag')).toBe('Demag');
    });

    test('handles null and empty values', () => {
      expect(processor.cleanManufacturerName(null)).toBe('');
      expect(processor.cleanManufacturerName(undefined)).toBe('');
    });
  });

  describe('cleanModelName', () => {
    test('trims whitespace', () => {
      expect(processor.cleanModelName('  Model 500  ')).toBe('Model 500');
    });

    test('removes excessive whitespace', () => {
      expect(processor.cleanModelName('Model   500')).toMatch(/Model.*500/);
    });

    test('handles null and empty values', () => {
      expect(processor.cleanModelName(null)).toBe('');
      expect(processor.cleanModelName('')).toBe('');
    });
  });

  describe('normalizeClassification', () => {
    test('normalizes known classification aliases', () => {
      expect(processor.normalizeClassification(['bgv-d8'])).toContain('d8');
      expect(processor.normalizeClassification(['bgvd8'])).toContain('d8');
      expect(processor.normalizeClassification(['d8plus'])).toContain('d8+');
      expect(processor.normalizeClassification(['bgv-d8+'])).toContain('d8+');
    });

    test('handles string input', () => {
      const result = processor.normalizeClassification('d8');
      expect(result).toBeInstanceOf(Array);
      expect(result).toContain('d8');
    });

    test('handles null and empty values', () => {
      expect(processor.normalizeClassification(null)).toEqual([]);
      expect(processor.normalizeClassification(undefined)).toEqual([]);
      expect(processor.normalizeClassification([])).toEqual([]);
    });

    test('preserves unknown classifications', () => {
      const result = processor.normalizeClassification(['custom-standard']);
      expect(result).toContain('custom-standard');
    });
  });

  describe('processBoolean', () => {
    test('converts string yes/no to boolean', () => {
      expect(processor.processBoolean('yes')).toBe(true);
      expect(processor.processBoolean('Yes')).toBe(true);
      expect(processor.processBoolean('YES')).toBe(true);
      expect(processor.processBoolean('no')).toBe(false);
      expect(processor.processBoolean('No')).toBe(false);
    });

    test('converts string true/false to boolean', () => {
      expect(processor.processBoolean('true')).toBe(true);
      expect(processor.processBoolean('false')).toBe(false);
    });

    test('preserves boolean values', () => {
      expect(processor.processBoolean(true)).toBe(true);
      expect(processor.processBoolean(false)).toBe(false);
    });

    test('handles null and undefined', () => {
      expect(processor.processBoolean(null)).toBe(false);
      expect(processor.processBoolean(undefined)).toBe(false);
    });
  });

  describe('processRecord', () => {
    test('returns null for records missing manufacturer', () => {
      const record = { model: 'Test Model' };
      expect(processor.processRecord(record)).toBeNull();
    });

    test('returns null for records missing model', () => {
      const record = { manufacturer: 'Test Manufacturer' };
      expect(processor.processRecord(record)).toBeNull();
    });

    test('processes valid record with all fields', () => {
      const record = {
        id: 'test-001',
        manufacturer: 'Chainmaster GmbH',
        model: 'BGV-D8 Plus',
        loadCapacity: '500 kg',
        liftingSpeed: '8 m/min',
        motorPower: '1.5 kW',
        classification: ['bgv-d8+'],
        quietOperation: 'yes',
        dynamicLifting: true,
        voltageOptions: '400V'
      };

      const result = processor.processRecord(record);

      expect(result).not.toBeNull();
      expect(result.manufacturer).toBe('Chainmaster');
      expect(result.classification).toContain('d8+');
      expect(result.quietOperation).toBe(true);
      expect(result.dynamicLifting).toBe(true);
      expect(result.voltageOptions).toEqual(['400V']);
      expect(result.capacityKg).toBe(500);
      expect(result.speedMMin).toBe(8);
      expect(result.hasCompleteSpecs).toBe(true);
      expect(result.dataCompleteness).toBeGreaterThan(0);
    });

    test('converts single values to arrays where expected', () => {
      const record = {
        manufacturer: 'Test',
        model: 'Model',
        voltageOptions: '400V',
        bodyColor: 'Black',
        commonApplications: 'Entertainment',
        additionalSafety: 'Overload protection'
      };

      const result = processor.processRecord(record);

      expect(result.voltageOptions).toEqual(['400V']);
      expect(result.bodyColor).toEqual(['Black']);
      expect(result.commonApplications).toEqual(['Entertainment']);
      expect(result.additionalSafety).toEqual(['Overload protection']);
    });

    test('initializes objects when not present', () => {
      const record = {
        manufacturer: 'Test',
        model: 'Model'
      };

      const result = processor.processRecord(record);

      expect(result.controlCompatibility).toEqual({});
      expect(result.positionFeedback).toEqual({});
      expect(result.certifications).toEqual({});
    });

    test('adds processedDate to record', () => {
      const record = {
        manufacturer: 'Test',
        model: 'Model'
      };

      const result = processor.processRecord(record);

      expect(result.processedDate).toBeInstanceOf(Date);
    });
  });

  describe('getCapacityCategory', () => {
    test('categorizes very light loads (≤250kg)', () => {
      expect(processor.getCapacityCategory('250 kg')).toBe('≤250 kg');
      expect(processor.getCapacityCategory('100 kg')).toBe('≤250 kg');
    });

    test('categorizes light loads (251-500kg)', () => {
      expect(processor.getCapacityCategory('500 kg')).toBe('251-500 kg');
      expect(processor.getCapacityCategory('300 kg')).toBe('251-500 kg');
    });

    test('categorizes medium loads (501-1000kg)', () => {
      expect(processor.getCapacityCategory('1000 kg')).toBe('501-1000 kg');
      expect(processor.getCapacityCategory('750 kg')).toBe('501-1000 kg');
    });

    test('categorizes heavy loads (1001-2000kg)', () => {
      expect(processor.getCapacityCategory('2000 kg')).toBe('1001-2000 kg');
      expect(processor.getCapacityCategory('1500 kg')).toBe('1001-2000 kg');
    });

    test('categorizes extra heavy loads (>2000kg)', () => {
      expect(processor.getCapacityCategory('5000 kg')).toBe('>2000 kg');
      expect(processor.getCapacityCategory('3000 kg')).toBe('>2000 kg');
    });

    test('handles null and invalid values', () => {
      expect(processor.getCapacityCategory(null)).toBeNull();
      expect(processor.getCapacityCategory('unknown')).toBeNull();
    });
  });
});

describe('Data Validation', () => {
  let processor;

  beforeEach(() => {
    processor = new ChainhoistDataProcessor();
  });

  describe('processLoadCapacity', () => {
    test('normalizes capacity format', () => {
      // These tests verify the output format is consistent
      const result = processor.processLoadCapacity('500kg');
      expect(result).toMatch(/\d+\s*kg/i);
    });

    test('handles range values', () => {
      const result = processor.processLoadCapacity('500-1000 kg');
      expect(result).toBeDefined();
    });

    test('handles null values by returning empty string', () => {
      expect(processor.processLoadCapacity(null)).toBe('');
      expect(processor.processLoadCapacity(undefined)).toBe('');
    });
  });

  describe('processLiftingSpeed', () => {
    test('normalizes speed format', () => {
      const result = processor.processLiftingSpeed('8m/min');
      expect(result).toMatch(/\d+(\.\d+)?\s*m\/min/i);
    });

    test('handles range values', () => {
      const result = processor.processLiftingSpeed('0.5-8 m/min');
      expect(result).toBeDefined();
    });

    test('handles null values by returning empty string', () => {
      expect(processor.processLiftingSpeed(null)).toBe('');
      expect(processor.processLiftingSpeed(undefined)).toBe('');
    });
  });

  describe('processMotorPower', () => {
    test('normalizes power format', () => {
      const result = processor.processMotorPower('1.5kW');
      expect(result).toMatch(/\d+(\.\d+)?\s*kW/i);
    });

    test('handles HP values', () => {
      const result = processor.processMotorPower('2 HP');
      expect(result).toBeDefined();
    });

    test('handles null values by returning empty string', () => {
      expect(processor.processMotorPower(null)).toBe('');
      expect(processor.processMotorPower(undefined)).toBe('');
    });
  });
});
