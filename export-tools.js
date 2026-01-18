// Export Tools for Enhanced Chainhoist Database
// Provides multiple export formats and advanced reporting capabilities

const fs = require('fs').promises;
const path = require('path');
const { Parser } = require('json2csv');

class ExportTools {
  constructor(configPath = './config.json') {
    this.config = require(configPath);
    this.dataDir = this.config.processor.outputDir;
    this.dataFile = this.config.processor.processedFile;
  }

  async loadData() {
    try {
      const dataPath = path.join(this.dataDir, this.dataFile);
      const content = await fs.readFile(dataPath, 'utf8');
      const parsed = JSON.parse(content);

      // Handle both old and new format
      return Array.isArray(parsed) ? parsed : parsed.data || [];
    } catch (error) {
      console.error('Failed to load data:', error.message);
      return [];
    }
  }

  // Export to JSON with optional filtering
  async exportJSON(options = {}) {
    try {
      const data = await this.loadData();
      let exportData = [...data];

      // Apply filters if provided
      if (options.manufacturer) {
        exportData = exportData.filter(item =>
          item.manufacturer?.toLowerCase().includes(options.manufacturer.toLowerCase())
        );
      }

      if (options.classification) {
        exportData = exportData.filter(item =>
          item.classification?.includes(options.classification.toLowerCase())
        );
      }

      // Create export object with metadata
      const exportObject = {
        metadata: {
          exportDate: new Date().toISOString(),
          totalRecords: exportData.length,
          version: this.config.database.version || '2.0',
          filters: options,
          description: 'Entertainment Industry Electric Chainhoist Database Export'
        },
        data: exportData
      };

      const filename = options.filename || `chainhoist-export-${new Date().toISOString().split('T')[0]}.json`;
      const filepath = path.join('.', filename);

      await fs.writeFile(filepath, JSON.stringify(exportObject, null, 2));

      console.log(`✅ JSON export completed: ${filename}`);
      console.log(`📊 Exported ${exportData.length} records`);
      return filepath;

    } catch (error) {
      console.error('❌ JSON export failed:', error.message);
      throw error;
    }
  }

  // Export to CSV with flattened structure
  async exportCSV(options = {}) {
    try {
      const data = await this.loadData();
      let exportData = [...data];

      // Apply filters
      if (options.manufacturer) {
        exportData = exportData.filter(item =>
          item.manufacturer?.toLowerCase().includes(options.manufacturer.toLowerCase())
        );
      }

      if (options.classification) {
        exportData = exportData.filter(item =>
          item.classification?.includes(options.classification.toLowerCase())
        );
      }

      // Flatten the data for CSV
      const flattenedData = exportData.map(item => {
        const flat = { ...item };

        // Handle arrays by joining with semicolons
        if (Array.isArray(flat.voltageOptions)) {
          flat.voltageOptions = flat.voltageOptions.join('; ');
        }
        if (Array.isArray(flat.classification)) {
          flat.classification = flat.classification.join('; ');
        }
        if (Array.isArray(flat.bodyColor)) {
          flat.bodyColor = flat.bodyColor.join('; ');
        }
        if (Array.isArray(flat.commonApplications)) {
          flat.commonApplications = flat.commonApplications.join('; ');
        }
        if (Array.isArray(flat.additionalSafety)) {
          flat.additionalSafety = flat.additionalSafety.join('; ');
        }
        if (Array.isArray(flat.images)) {
          flat.images = flat.images.join('; ');
        }

        // Handle objects by creating separate columns
        if (typeof flat.price === 'object' && flat.price !== null) {
          flat.priceValue = flat.price.value || '';
          flat.priceCurrency = flat.price.currency || '';
          delete flat.price;
        }

        if (typeof flat.rentalRate === 'object' && flat.rentalRate !== null) {
          flat.rentalRateDaily = flat.rentalRate.daily || '';
          flat.rentalRateWeekly = flat.rentalRate.weekly || '';
          delete flat.rentalRate;
        }

        // Format dates
        if (flat.lastUpdated) {
          flat.lastUpdated = new Date(flat.lastUpdated).toISOString();
        }
        if (flat.createdDate) {
          flat.createdDate = new Date(flat.createdDate).toISOString();
        }

        return flat;
      });

      // Create CSV
      const parser = new Parser({
        flatten: true,
        delimiter: ',',
        quote: '"',
        escapedQuote: '""'
      });
      const csv = parser.parse(flattenedData);

      const filename = options.filename || `chainhoist-export-${new Date().toISOString().split('T')[0]}.csv`;
      const filepath = path.join('.', filename);

      await fs.writeFile(filepath, csv);

      console.log(`✅ CSV export completed: ${filename}`);
      console.log(`📊 Exported ${exportData.length} records`);
      return filepath;

    } catch (error) {
      console.error('❌ CSV export failed:', error.message);
      throw error;
    }
  }

  // Generate statistics report
  async generateStatsReport(options = {}) {
    try {
      const data = await this.loadData();

      const stats = {
        summary: {
          totalRecords: data.length,
          manufacturers: [...new Set(data.map(item => item.manufacturer))].length,
          uniqueModels: [...new Set(data.map(item => `${item.manufacturer}-${item.model}`))].length,
          lastUpdated: new Date().toISOString()
        },
        manufacturers: {},
        classifications: {},
        capacityDistribution: {},
        speedDistribution: {},
        powerDistribution: {},
        dataCompleteness: {}
      };

      // Manufacturer breakdown
      data.forEach(item => {
        if (item.manufacturer) {
          stats.manufacturers[item.manufacturer] = (stats.manufacturers[item.manufacturer] || 0) + 1;
        }
      });

      // Classification breakdown
      data.forEach(item => {
        if (item.classification && Array.isArray(item.classification)) {
          item.classification.forEach(cls => {
            stats.classifications[cls] = (stats.classifications[cls] || 0) + 1;
          });
        }
      });

      // Capacity distribution
      data.forEach(item => {
        if (item.loadCapacity) {
          const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
          if (match) {
            const capacity = parseFloat(match[1]);
            const range = capacity <= 250 ? '≤250kg' :
              capacity <= 500 ? '251-500kg' :
                capacity <= 1000 ? '501-1000kg' :
                  capacity <= 2000 ? '1001-2000kg' : '>2000kg';
            stats.capacityDistribution[range] = (stats.capacityDistribution[range] || 0) + 1;
          }
        }
      });

      // Data completeness analysis
      const fields = ['loadCapacity', 'liftingSpeed', 'motorPower', 'classification', 'series', 'url'];
      fields.forEach(field => {
        const filledCount = data.filter(item => {
          const value = item[field];
          return value && value !== '' && (Array.isArray(value) ? value.length > 0 : true);
        }).length;

        stats.dataCompleteness[field] = {
          filled: filledCount,
          total: data.length,
          percentage: data.length > 0 ? ((filledCount / data.length) * 100).toFixed(1) : '0'
        };
      });

      const filename = options.filename || `chainhoist-stats-${new Date().toISOString().split('T')[0]}.json`;
      const filepath = path.join('.', filename);

      await fs.writeFile(filepath, JSON.stringify(stats, null, 2));

      console.log(`✅ Statistics report generated: ${filename}`);
      console.log(`📈 Analysis of ${data.length} records completed`);

      // Print summary to console
      console.log('\n📊 Database Summary:');
      console.log(`   Total Records: ${stats.summary.totalRecords}`);
      console.log(`   Manufacturers: ${stats.summary.manufacturers}`);
      console.log(`   Unique Models: ${stats.summary.uniqueModels}`);

      console.log('\n🏭 Top Manufacturers:');
      Object.entries(stats.manufacturers)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .forEach(([mfr, count]) => {
          console.log(`   ${mfr}: ${count} models`);
        });

      console.log('\n📋 Classification Distribution:');
      Object.entries(stats.classifications)
        .sort(([,a], [,b]) => b - a)
        .forEach(([cls, count]) => {
          console.log(`   ${cls.toUpperCase()}: ${count} models`);
        });

      return filepath;

    } catch (error) {
      console.error('❌ Statistics report failed:', error.message);
      throw error;
    }
  }

  // Export filtered dataset
  async exportFiltered(filters = {}, format = 'json') {
    const options = {
      ...filters,
      filename: `chainhoist-filtered-${Date.now()}.${format}`
    };

    switch (format.toLowerCase()) {
    case 'csv':
      return await this.exportCSV(options);
    case 'json':
    default:
      return await this.exportJSON(options);
    }
  }

  // Bulk export in multiple formats
  async exportAll(baseFilename = null) {
    const timestamp = new Date().toISOString().split('T')[0];
    const basename = baseFilename || `chainhoist-complete-${timestamp}`;

    console.log('🚀 Starting bulk export...');

    const results = {};

    try {
      results.json = await this.exportJSON({ filename: `${basename}.json` });
      results.csv = await this.exportCSV({ filename: `${basename}.csv` });
      results.stats = await this.generateStatsReport({ filename: `${basename}-stats.json` });

      console.log('\n✅ Bulk export completed successfully!');
      console.log('📁 Generated files:');
      Object.values(results).forEach(file => {
        console.log(`   ${file}`);
      });

      return results;

    } catch (error) {
      console.error('❌ Bulk export failed:', error);
      throw error;
    }
  }
}

// CLI interface
if (require.main === module) {
  const exporter = new ExportTools();

  const command = process.argv[2];
  const options = {};

  // Parse command line arguments
  for (let i = 3; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace('--', '');
    const value = process.argv[i + 1];
    if (key && value) {
      options[key] = value;
    }
  }

  (async () => {
    try {
      switch (command) {
      case 'json':
        await exporter.exportJSON(options);
        break;
      case 'csv':
        await exporter.exportCSV(options);
        break;
      case 'stats':
        await exporter.generateStatsReport(options);
        break;
      case 'all':
        await exporter.exportAll(options.basename);
        break;
      default:
        console.log('Usage: node export-tools.js <command> [options]');
        console.log('Commands:');
        console.log('  json   - Export to JSON format');
        console.log('  csv    - Export to CSV format');
        console.log('  stats  - Generate statistics report');
        console.log('  all    - Export all formats');
        console.log('\nOptions:');
        console.log('  --filename <name>      - Custom filename');
        console.log('  --manufacturer <name>  - Filter by manufacturer');
        console.log('  --classification <cls> - Filter by classification');
        console.log('  --basename <name>      - Base name for bulk export');
      }
    } catch (error) {
      console.error('Export failed:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = ExportTools;
