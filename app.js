// Electric Chainhoist Database - Express Application
// Exports the Express app for testing and server startup

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

// Configuration
const CONFIG = {
  dataDir: 'chainhoist_data_processed',
  dataFile: 'chainhoist_database_processed.json',
  reportFile: 'data_quality_report.json',
};

// Set up templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Load data helper
function loadData() {
  try {
    const dataPath = path.join(__dirname, CONFIG.dataDir, CONFIG.dataFile);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return data;
  } catch (error) {
    console.error('Error loading data:', error);
    return [];
  }
}

// Load report helper
function loadReport() {
  try {
    const reportPath = path.join(__dirname, CONFIG.dataDir, CONFIG.reportFile);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return report;
  } catch (error) {
    console.error('Error loading report:', error);
    return { totalRecords: 0 };
  }
}

// ============ API Routes ============

// GET /api - API Documentation
app.get('/api', (req, res) => {
  const apiDocs = {
    title: 'Entertainment Industry Chainhoist Database API',
    version: '2.0',
    description: 'REST API for accessing chainhoist data',
    baseUrl: `${req.protocol}://${req.get('host')}/api`,
    endpoints: {
      'GET /api/chainhoists': {
        description: 'Get all chainhoists with optional filtering',
        parameters: {
          manufacturer: 'Filter by manufacturer name',
          model: 'Filter by model name',
          classification: 'Filter by classification',
          minCapacity: 'Minimum load capacity in kg',
          maxCapacity: 'Maximum load capacity in kg',
          page: 'Page number (default: 1)',
          limit: 'Results per page (default: 50)'
        }
      },
      'GET /api/chainhoists/:id': {
        description: 'Get specific chainhoist by ID'
      },
      'GET /api/manufacturers': {
        description: 'Get all manufacturers with statistics'
      },
      'GET /api/classifications': {
        description: 'Get all classifications with counts'
      },
      'GET /api/stats': {
        description: 'Get database statistics and metadata'
      },
      'POST /api/search': {
        description: 'Advanced search with complex criteria',
        body: {
          query: 'Text search across multiple fields',
          capacityRange: { min: 'number', max: 'number' },
          manufacturers: 'Array of manufacturer names',
          classifications: 'Array of classification names',
          sortBy: 'Field to sort by',
          sortOrder: 'asc or desc',
          page: 'Page number',
          limit: 'Results per page'
        }
      }
    },
    examples: {
      'Find D8+ chainhoists': 'GET /api/chainhoists?classification=d8%2B',
      'Find high capacity hoists': 'GET /api/chainhoists?minCapacity=1000',
      'Search CM products': 'GET /api/chainhoists?manufacturer=Columbus%20McKinnon'
    }
  };

  res.json(apiDocs);
});

// GET /api/chainhoists - Get all chainhoists with optional filtering
app.get('/api/chainhoists', (req, res) => {
  try {
    const data = loadData();
    let results = [...data];

    if (req.query.manufacturer) {
      results = results.filter(item =>
        item.manufacturer.toLowerCase().includes(req.query.manufacturer.toLowerCase())
      );
    }

    if (req.query.model) {
      results = results.filter(item =>
        item.model.toLowerCase().includes(req.query.model.toLowerCase())
      );
    }

    if (req.query.classification) {
      results = results.filter(item =>
        item.classification &&
        Array.isArray(item.classification) &&
        item.classification.some(cls =>
          cls.toLowerCase().includes(req.query.classification.toLowerCase())
        )
      );
    }

    if (req.query.minCapacity) {
      const minCap = parseFloat(req.query.minCapacity);
      results = results.filter(item => {
        if (!item.loadCapacity) return false;
        const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
        return match && parseFloat(match[1]) >= minCap;
      });
    }

    if (req.query.maxCapacity) {
      const maxCap = parseFloat(req.query.maxCapacity);
      results = results.filter(item => {
        if (!item.loadCapacity) return false;
        const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
        return match && parseFloat(match[1]) <= maxCap;
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    const paginatedResults = results.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: results.length,
        pages: Math.ceil(results.length / limit)
      },
      filters: req.query
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chainhoists',
      message: error.message
    });
  }
});

// GET /api/chainhoists/:id - Get specific chainhoist
app.get('/api/chainhoists/:id', (req, res) => {
  try {
    const data = loadData();
    const chainhoist = data.find(item => item.id === req.params.id);

    if (!chainhoist) {
      return res.status(404).json({
        success: false,
        error: 'Chainhoist not found'
      });
    }

    res.json({
      success: true,
      data: chainhoist
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chainhoist',
      message: error.message
    });
  }
});

// GET /api/manufacturers - Get all manufacturers
app.get('/api/manufacturers', (req, res) => {
  try {
    const data = loadData();
    const manufacturers = [...new Set(data.map(item => item.manufacturer))].sort();

    const manufacturerStats = manufacturers.map(manufacturer => ({
      name: manufacturer,
      count: data.filter(item => item.manufacturer === manufacturer).length,
      models: [...new Set(data
        .filter(item => item.manufacturer === manufacturer)
        .map(item => item.model)
      )].length
    }));

    res.json({
      success: true,
      data: manufacturerStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch manufacturers',
      message: error.message
    });
  }
});

// GET /api/classifications - Get all classifications
app.get('/api/classifications', (req, res) => {
  try {
    const data = loadData();
    const classifications = {};

    data.forEach(item => {
      if (item.classification && Array.isArray(item.classification)) {
        item.classification.forEach(cls => {
          classifications[cls] = (classifications[cls] || 0) + 1;
        });
      }
    });

    const classificationStats = Object.entries(classifications)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: classificationStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch classifications',
      message: error.message
    });
  }
});

// GET /api/stats - Get database statistics
app.get('/api/stats', (req, res) => {
  try {
    const data = loadData();
    const report = loadReport();

    const stats = {
      totalRecords: data.length,
      manufacturers: [...new Set(data.map(item => item.manufacturer))].length,
      classifications: Object.keys(report.classificationDistribution || {}).length,
      capacityRange: {
        min: Math.min(...data
          .map(item => {
            const match = item.loadCapacity?.match(/(\d+(?:\.\d+)?)\s*kg/i);
            return match ? parseFloat(match[1]) : Infinity;
          })
          .filter(val => val !== Infinity)
        ),
        max: Math.max(...data
          .map(item => {
            const match = item.loadCapacity?.match(/(\d+(?:\.\d+)?)\s*kg/i);
            return match ? parseFloat(match[1]) : -Infinity;
          })
          .filter(val => val !== -Infinity)
        )
      },
      lastUpdated: Math.max(...data.map(item => new Date(item.lastUpdated).getTime())),
      dataCompleteness: {
        loadCapacity: data.filter(item => item.loadCapacity).length / data.length,
        liftingSpeed: data.filter(item => item.liftingSpeed).length / data.length,
        motorPower: data.filter(item => item.motorPower).length / data.length,
        classification: data.filter(item => item.classification?.length > 0).length / data.length
      }
    };

    res.json({
      success: true,
      data: stats,
      report: report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});

// POST /api/search - Advanced search endpoint
app.post('/api/search', (req, res) => {
  try {
    const data = loadData();
    const searchCriteria = req.body;
    let results = [...data];

    if (searchCriteria.query) {
      const query = searchCriteria.query.toLowerCase();
      results = results.filter(item =>
        item.manufacturer?.toLowerCase().includes(query) ||
        item.model?.toLowerCase().includes(query) ||
        item.series?.toLowerCase().includes(query) ||
        item.loadCapacity?.toLowerCase().includes(query) ||
        item.classification?.join(' ').toLowerCase().includes(query)
      );
    }

    if (searchCriteria.capacityRange) {
      const { min, max } = searchCriteria.capacityRange;
      results = results.filter(item => {
        if (!item.loadCapacity) return false;
        const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
        if (!match) return false;
        const capacity = parseFloat(match[1]);
        return (min === undefined || capacity >= min) &&
               (max === undefined || capacity <= max);
      });
    }

    if (searchCriteria.manufacturers && searchCriteria.manufacturers.length > 0) {
      results = results.filter(item =>
        searchCriteria.manufacturers.includes(item.manufacturer)
      );
    }

    if (searchCriteria.classifications && searchCriteria.classifications.length > 0) {
      results = results.filter(item =>
        item.classification &&
        Array.isArray(item.classification) &&
        searchCriteria.classifications.some(cls =>
          item.classification.includes(cls)
        )
      );
    }

    if (searchCriteria.sortBy) {
      const sortBy = searchCriteria.sortBy;
      const sortOrder = searchCriteria.sortOrder || 'asc';

      results.sort((a, b) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];

        if (sortBy === 'loadCapacity') {
          const aMatch = aVal?.match(/(\d+(?:\.\d+)?)\s*kg/i);
          const bMatch = bVal?.match(/(\d+(?:\.\d+)?)\s*kg/i);
          aVal = aMatch ? parseFloat(aMatch[1]) : 0;
          bVal = bMatch ? parseFloat(bMatch[1]) : 0;
        }

        if (sortOrder === 'desc') {
          return bVal > aVal ? 1 : -1;
        }
        return aVal > bVal ? 1 : -1;
      });
    }

    const page = searchCriteria.page || 1;
    const limit = searchCriteria.limit || 50;
    const startIndex = (page - 1) * limit;
    const paginatedResults = results.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: paginatedResults,
      total: results.length,
      page,
      limit,
      searchCriteria
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

// ============ Web Routes ============

app.get('/', (req, res) => {
  const data = loadData();
  const report = loadReport();

  const manufacturers = [...new Set(data.map(item => item.manufacturer))].sort();
  const capacities = Object.keys(report.capacityDistribution || {}).sort((a, b) => {
    const getNumber = (str) => {
      const match = str.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    };
    return getNumber(a) - getNumber(b);
  });
  const classifications = Object.keys(report.classificationDistribution || {}).sort();

  res.render('index', {
    data,
    report,
    manufacturers,
    capacities,
    classifications,
    filters: req.query,
    title: 'Electric Chainhoist Database'
  });
});

app.get('/search', (req, res) => {
  const data = loadData();
  const report = loadReport();
  const query = req.query.q?.toLowerCase() || '';

  let results = data;

  if (query) {
    results = data.filter(item => {
      return (
        (item.manufacturer?.toLowerCase().includes(query)) ||
        (item.model?.toLowerCase().includes(query)) ||
        (item.series?.toLowerCase().includes(query)) ||
        (item.loadCapacity?.toLowerCase().includes(query)) ||
        (item.classification?.join(' ').toLowerCase().includes(query))
      );
    });
  }

  if (req.query.manufacturer) {
    results = results.filter(item => item.manufacturer === req.query.manufacturer);
  }

  if (req.query.capacity) {
    results = results.filter(item => {
      if (!item.loadCapacity) return false;

      const matches = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (!matches) return false;

      const value = parseFloat(matches[1]);
      const capacityFilter = req.query.capacity;

      if (capacityFilter === '≤250 kg' && value <= 250) return true;
      if (capacityFilter === '251-500 kg' && value > 250 && value <= 500) return true;
      if (capacityFilter === '501-1000 kg' && value > 500 && value <= 1000) return true;
      if (capacityFilter === '1001-2000 kg' && value > 1000 && value <= 2000) return true;
      if (capacityFilter === '>2000 kg' && value > 2000) return true;

      return false;
    });
  }

  if (req.query.classification) {
    results = results.filter(item => {
      return item.classification &&
        Array.isArray(item.classification) &&
        item.classification.includes(req.query.classification);
    });
  }

  const manufacturers = [...new Set(data.map(item => item.manufacturer))].sort();
  const capacities = Object.keys(report.capacityDistribution || {}).sort((a, b) => {
    const getNumber = (str) => {
      const match = str.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    };
    return getNumber(a) - getNumber(b);
  });
  const classifications = Object.keys(report.classificationDistribution || {}).sort();

  res.render('search', {
    data: results,
    query,
    report,
    manufacturers,
    capacities,
    classifications,
    filters: req.query,
    resultsCount: results.length,
    title: `Search Results for "${query}"`
  });
});

app.get('/product/:id', (req, res) => {
  const data = loadData();
  const id = req.params.id;

  const product = data.find(item => item.id === id);

  if (!product) {
    return res.status(404).render('error', {
      message: 'Product not found',
      title: 'Error'
    });
  }

  const similarProducts = data.filter(item =>
    item.id !== id &&
    (item.manufacturer === product.manufacturer ||
     (item.classification && product.classification &&
      item.classification.some(c => product.classification.includes(c))))
  ).slice(0, 5);

  res.render('product', {
    product,
    similarProducts,
    title: `${product.manufacturer} - ${product.model}`
  });
});

app.get('/compare', (req, res) => {
  const data = loadData();
  const ids = req.query.ids ? req.query.ids.split(',') : [];

  const products = ids.map(id => data.find(item => item.id === id)).filter(Boolean);

  res.render('compare', {
    products,
    title: 'Compare Chainhoists'
  });
});

app.get('/stats', (req, res) => {
  const data = loadData();
  const report = loadReport();

  const capacityStats = {};
  const powerStats = {};
  const speedStats = {};

  data.forEach(item => {
    if (item.loadCapacity) {
      const matches = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value <= 250 ? '≤250 kg' :
                        value <= 500 ? '251-500 kg' :
                        value <= 1000 ? '501-1000 kg' :
                        value <= 2000 ? '1001-2000 kg' : '>2000 kg';
        capacityStats[category] = (capacityStats[category] || 0) + 1;
      }
    }

    if (item.motorPower) {
      const matches = item.motorPower.match(/(\d+(?:\.\d+)?)\s*kW/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value < 0.5 ? '<0.5 kW' :
                         value < 1 ? '0.5-1 kW' :
                         value < 2 ? '1-2 kW' : '>2 kW';
        powerStats[category] = (powerStats[category] || 0) + 1;
      }
    }

    if (item.liftingSpeed) {
      const matches = item.liftingSpeed.match(/(\d+(?:\.\d+)?)\s*m\/min/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value < 2 ? '<2 m/min' :
                         value < 4 ? '2-4 m/min' :
                         value < 8 ? '4-8 m/min' : '>8 m/min';
        speedStats[category] = (speedStats[category] || 0) + 1;
      }
    }
  });

  res.render('stats', {
    report,
    capacityStats,
    powerStats,
    speedStats,
    title: 'Database Statistics'
  });
});

// Export the app for testing
module.exports = app;
