// Electric Chainhoist Database Viewer
// A simple Express.js application to view and search the chainhoist database

const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

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
app.use(express.json()); // Add JSON parsing middleware for API

// Load data
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

// Load report
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

// API Routes
// GET /api/chainhoists - Get all chainhoists with optional filtering
app.get('/api/chainhoists', (req, res) => {
  try {
    const data = loadData();
    let results = [...data];
    
    // Apply filters
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
    
    // Pagination
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
    
    // Text search across multiple fields
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
    
    // Capacity range
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
    
    // Multiple manufacturers
    if (searchCriteria.manufacturers && searchCriteria.manufacturers.length > 0) {
      results = results.filter(item => 
        searchCriteria.manufacturers.includes(item.manufacturer)
      );
    }
    
    // Multiple classifications  
    if (searchCriteria.classifications && searchCriteria.classifications.length > 0) {
      results = results.filter(item => 
        item.classification && 
        Array.isArray(item.classification) &&
        searchCriteria.classifications.some(cls => 
          item.classification.includes(cls)
        )
      );
    }
    
    // Sort results
    if (searchCriteria.sortBy) {
      const sortBy = searchCriteria.sortBy;
      const sortOrder = searchCriteria.sortOrder || 'asc';
      
      results.sort((a, b) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];
        
        // Handle capacity sorting
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
    
    // Pagination
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

// API Documentation endpoint
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

// Routes
app.get('/', (req, res) => {
  const data = loadData();
  const report = loadReport();
  
  const manufacturers = [...new Set(data.map(item => item.manufacturer))].sort();
  const capacities = Object.keys(report.capacityDistribution || {}).sort((a, b) => {
    // Sort capacities in ascending order
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
      // Search in multiple fields
      return (
        (item.manufacturer?.toLowerCase().includes(query)) ||
        (item.model?.toLowerCase().includes(query)) ||
        (item.series?.toLowerCase().includes(query)) ||
        (item.loadCapacity?.toLowerCase().includes(query)) ||
        (item.classification?.join(' ').toLowerCase().includes(query))
      );
    });
  }
  
  // Apply filters
  if (req.query.manufacturer) {
    results = results.filter(item => item.manufacturer === req.query.manufacturer);
  }
  
  if (req.query.capacity) {
    // Filter by capacity category
    results = results.filter(item => {
      if (!item.loadCapacity) return false;
      
      // Extract numeric value from capacity
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
    // Filter by classification
    results = results.filter(item => {
      return item.classification && 
        Array.isArray(item.classification) && 
        item.classification.includes(req.query.classification);
    });
  }
  
  const manufacturers = [...new Set(data.map(item => item.manufacturer))].sort();
  const capacities = Object.keys(report.capacityDistribution || {}).sort((a, b) => {
    // Sort capacities in ascending order
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
  
  // Find similar products
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
  
  // Generate additional statistics
  const capacityStats = {};
  const powerStats = {};
  const speedStats = {};
  
  data.forEach(item => {
    // Process capacity
    if (item.loadCapacity) {
      const matches = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value <= 250 ? '≤250 kg' :
                        value <= 500 ? '251-500 kg' :
                        value <= 1000 ? '501-1000 kg' :
                        value <= 2000 ? '1001-2000 kg' : '>2000 kg';
        
        if (!capacityStats[category]) {
          capacityStats[category] = 1;
        } else {
          capacityStats[category]++;
        }
      }
    }
    
    // Process power
    if (item.motorPower) {
      const matches = item.motorPower.match(/(\d+(?:\.\d+)?)\s*kW/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value < 0.5 ? '<0.5 kW' :
                         value < 1 ? '0.5-1 kW' :
                         value < 2 ? '1-2 kW' : '>2 kW';
        
        if (!powerStats[category]) {
          powerStats[category] = 1;
        } else {
          powerStats[category]++;
        }
      }
    }
    
    // Process speed
    if (item.liftingSpeed) {
      const matches = item.liftingSpeed.match(/(\d+(?:\.\d+)?)\s*m\/min/i);
      if (matches) {
        const value = parseFloat(matches[1]);
        const category = value < 2 ? '<2 m/min' :
                         value < 4 ? '2-4 m/min' :
                         value < 8 ? '4-8 m/min' : '>8 m/min';
        
        if (!speedStats[category]) {
          speedStats[category] = 1;
        } else {
          speedStats[category]++;
        }
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

// Create views directory and EJS templates
const viewsDir = path.join(__dirname, 'views');
if (!fs.existsSync(viewsDir)) {
  fs.mkdirSync(viewsDir, { recursive: true });
}

// Create layout.ejs
const layoutTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= title %> | Entertainment Industry Chainhoist Database</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    .product-card {
      height: 100%;
      transition: transform 0.2s;
    }
    .product-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    .navbar-brand {
      font-weight: bold;
    }
    .spec-label {
      font-weight: bold;
      color: #555;
    }
    .classification-badge {
      font-size: 0.8rem;
      margin-right: 0.3rem;
    }
  </style>
</head>
<body>
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-4">
    <div class="container">
      <a class="navbar-brand" href="/">Entertainment Chainhoist DB</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav me-auto">
          <li class="nav-item">
            <a class="nav-link" href="/">Home</a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="/stats">Statistics</a>
          </li>
        </ul>
        <form class="d-flex" action="/search" method="GET">
          <input class="form-control me-2" type="search" name="q" placeholder="Search chainhoists..." aria-label="Search">
          <button class="btn btn-outline-light" type="submit">Search</button>
        </form>
      </div>
    </div>
  </nav>

  <div class="container mb-5">
    <%- body %>
  </div>

  <footer class="bg-dark text-white py-4 mt-5">
    <div class="container">
      <div class="row">
        <div class="col-md-6">
          <h5>Entertainment Industry Chainhoist Database</h5>
          <p class="text-muted">A comprehensive collection of electric chainhoists used in the entertainment industry.</p>
        </div>
        <div class="col-md-3">
          <h5>Quick Links</h5>
          <ul class="list-unstyled">
            <li><a href="/" class="text-white">Home</a></li>
            <li><a href="/stats" class="text-white">Statistics</a></li>
            <li><a href="/search" class="text-white">Search</a></li>
          </ul>
        </div>
        <div class="col-md-3">
          <h5>Disclaimer</h5>
          <p class="small text-muted">This database is for informational purposes only. Always consult manufacturer specifications for critical applications.</p>
        </div>
      </div>
      <hr>
      <p class="text-center text-muted mb-0">&copy; <%= new Date().getFullYear() %> Entertainment Industry Chainhoist Database</p>
    </div>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</body>
</html>`;

fs.writeFileSync(path.join(viewsDir, 'layout.ejs'), layoutTemplate);

// Create index.ejs
const indexTemplate = `<% layout('layout.ejs') -%>

<div class="row mb-4">
  <div class="col-md-12">
    <div class="card border-primary">
      <div class="card-body">
        <h1 class="card-title">Entertainment Industry Electric Chainhoist Database</h1>
        <p class="card-text">This database contains information on <%= data.length %> electric chainhoists used in the entertainment industry.</p>
        
        <div class="row mt-4">
          <div class="col-md-4">
            <div class="card bg-light h-100">
              <div class="card-body">
                <h5 class="card-title">Manufacturers</h5>
                <p class="card-text">Featuring <%= manufacturers.length %> manufacturers</p>
                <ul class="list-group">
                  <% manufacturers.slice(0, 5).forEach(function(manufacturer) { %>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                      <%= manufacturer %>
                      <span class="badge bg-primary rounded-pill"><%= data.filter(item => item.manufacturer === manufacturer).length %></span>
                    </li>
                  <% }); %>
                  <% if (manufacturers.length > 5) { %>
                    <li class="list-group-item text-center text-muted">+ <%= manufacturers.length - 5 %> more</li>
                  <% } %>
                </ul>
              </div>
            </div>
          </div>
          
          <div class="col-md-4">
            <div class="card bg-light h-100">
              <div class="card-body">
                <h5 class="card-title">Load Capacities</h5>
                <p class="card-text">Chainhoists by load capacity</p>
                <ul class="list-group">
                  <% capacities.forEach(function(capacity) { %>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                      <%= capacity %>
                      <span class="badge bg-success rounded-pill"><%= report.capacityDistribution[capacity] %></span>
                    </li>
                  <% }); %>
                </ul>
              </div>
            </div>
          </div>
          
          <div class="col-md-4">
            <div class="card bg-light h-100">
              <div class="card-body">
                <h5 class="card-title">Classifications</h5>
                <p class="card-text">Chainhoists by industry classification</p>
                <ul class="list-group">
                  <% classifications.forEach(function(classification) { %>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                      <%= classification.toUpperCase() %>
                      <span class="badge bg-info rounded-pill"><%= report.classificationDistribution[classification] %></span>
                    </li>
                  <% }); %>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="row mb-4">
  <div class="col-md-12">
    <div class="card">
      <div class="card-header bg-primary text-white">
        <h4 class="mb-0">Filter Chainhoists</h4>
      </div>
      <div class="card-body">
        <form action="/search" method="GET" class="row g-3">
          <div class="col-md-3">
            <label for="manufacturer" class="form-label">Manufacturer</label>
            <select name="manufacturer" id="manufacturer" class="form-select">
              <option value="">Any Manufacturer</option>
              <% manufacturers.forEach(function(manufacturer) { %>
                <option value="<%= manufacturer %>" <%= filters.manufacturer === manufacturer ? 'selected' : '' %>><%= manufacturer %></option>
              <% }); %>
            </select>
          </div>
          
          <div class="col-md-3">
            <label for="capacity" class="form-label">Load Capacity</label>
            <select name="capacity" id="capacity" class="form-select">
              <option value="">Any Capacity</option>
              <% capacities.forEach(function(capacity) { %>
                <option value="<%= capacity %>" <%= filters.capacity === capacity ? 'selected' : '' %>><%= capacity %></option>
              <% }); %>
            </select>
          </div>
          
          <div class="col-md-3">
            <label for="classification" class="form-label">Classification</label>
            <select name="classification" id="classification" class="form-select">
              <option value="">Any Classification</option>
              <% classifications.forEach(function(classification) { %>
                <option value="<%= classification %>" <%= filters.classification === classification ? 'selected' : '' %>><%= classification.toUpperCase() %></option>
              <% }); %>
            </select>
          </div>
          
          <div class="col-md-3 d-flex align-items-end">
            <button type="submit" class="btn btn-primary w-100">Filter Results</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</div>

<h2 class="mb-4">Featured Chainhoists</h2>

<div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4">
  <% data.slice(0, 6).forEach(function(item) { %>
    <div class="col">
      <div class="card h-100 product-card">
        <div class="card-header bg-light">
          <h5 class="card-title mb-0"><%= item.manufacturer %></h5>
        </div>
        <div class="card-body">
          <h6 class="card-subtitle mb-2 text-muted"><%= item.model %></h6>
          
          <% if (item.classification && Array.isArray(item.classification)) { %>
            <div class="mb-2">
              <% item.classification.forEach(function(cls) { %>
                <span class="badge bg-info classification-badge"><%= cls.toUpperCase() %></span>
              <% }); %>
            </div>
          <% } %>
          
          <p class="card-text">
            <% if (item.loadCapacity) { %>
              <span class="d-block"><strong>Capacity:</strong> <%= item.loadCapacity %></span>
            <% } %>
            <% if (item.liftingSpeed) { %>
              <span class="d-block"><strong>Speed:</strong> <%= item.liftingSpeed %></span>
            <% } %>
            <% if (item.motorPower) { %>
              <span class="d-block"><strong>Power:</strong> <%= item.motorPower %></span>
            <% } %>
          </p>
        </div>
        <div class="card-footer bg-white">
          <a href="/product/<%= item.id %>" class="btn btn-sm btn-outline-primary">View Details</a>
        </div>
      </div>
    </div>
  <% }); %>
</div>

<div class="d-grid gap-2 col-md-6 mx-auto mt-4">
  <a href="/search" class="btn btn-primary">View All Chainhoists</a>
</div>
`;

fs.writeFileSync(path.join(viewsDir, 'index.ejs'), indexTemplate);

// Create search.ejs
const searchTemplate = `<% layout('layout.ejs') -%>

<h1 class="mb-4"><%= title %></h1>

<div class="row mb-4">
  <div class="col-md-12">
    <div class="card">
      <div class="card-header bg-primary text-white">
        <h4 class="mb-0">Filter Results</h4>
      </div>
      <div class="card-body">
        <form action="/search" method="GET" class="row g-3">
          <div class="col-md-3">
            <label for="q" class="form-label">Search Terms</label>
            <input type="text" class="form-control" id="q" name="q" value="<%= query %>">
          </div>
          
          <div class="col-md-3">
            <label for="manufacturer" class="form-label">Manufacturer</label>
            <select name="manufacturer" id="manufacturer" class="form-select">
              <option value="">Any Manufacturer</option>
              <% manufacturers.forEach(function(manufacturer) { %>
                <option value="<%= manufacturer %>" <%= filters.manufacturer === manufacturer ? 'selected' : '' %>><%= manufacturer %></option>
              <% }); %>
            </select>
          </div>
          
          <div class="col-md-2">
            <label for="capacity" class="form-label">Load Capacity</label>
            <select name="capacity" id="capacity" class="form-select">
              <option value="">Any Capacity</option>
              <% capacities.forEach(function(capacity) { %>
                <option value="<%= capacity %>" <%= filters.capacity === capacity ? 'selected' : '' %>><%= capacity %></option>
              <% }); %>
            </select>
          </div>
          
          <div class="col-md-2">
            <label for="classification" class="form-label">Classification</label>
            <select name="classification" id="classification" class="form-select">
              <option value="">Any Classification</option>
              <% classifications.forEach(function(classification) { %>
                <option value="<%= classification %>" <%= filters.classification === classification ? 'selected' : '' %>><%= classification.toUpperCase() %></option>
              <% }); %>
            </select>
          </div>
          
          <div class="col-md-2 d-flex align-items-end">
            <button type="submit" class="btn btn-primary w-100">Apply Filters</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</div>

<p class="text-muted"><%= resultsCount %> chainhoists found</p>

<% if (data.length === 0) { %>
  <div class="alert alert-info">
    <h4 class="alert-heading">No results found!</h4>
    <p>Try adjusting your search criteria or filters to find more chainhoists.</p>
  </div>
<% } else { %>
  <div class="table-responsive">
    <table class="table table-striped table-hover">
      <thead class="table-dark">
        <tr>
          <th>Manufacturer</th>
          <th>Model</th>
          <th>Series</th>
          <th>Capacity</th>
          <th>Speed</th>
          <th>Classification</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <% data.forEach(function(item) { %>
          <tr>
            <td><%= item.manufacturer %></td>
            <td><%= item.model %></td>
            <td><%= item.series || '-' %></td>
            <td><%= item.loadCapacity || '-' %></td>
            <td><%= item.liftingSpeed || '-' %></td>
            <td>
              <% if (item.classification && Array.isArray(item.classification)) { %>
                <% item.classification.forEach(function(cls) { %>
                  <span class="badge bg-info classification-badge"><%= cls.toUpperCase() %></span>
                <% }); %>
              <% } else { %>
                -
              <% } %>
            </td>
            <td>
              <a href="/product/<%= item.id %>" class="btn btn-sm btn-outline-primary">Details</a>
            </td>
          </tr>
        <% }); %>
      </tbody>
    </table>
  </div>
<% } %>
`;

fs.writeFileSync(path.join(viewsDir, 'search.ejs'), searchTemplate);

// Create product.ejs
const productTemplate = `<% layout('layout.ejs') -%>

<div class="row mb-4">
  <div class="col-md-12">
    <nav aria-label="breadcrumb">
      <ol class="breadcrumb">
        <li class="breadcrumb-item"><a href="/">Home</a></li>
        <li class="breadcrumb-item"><a href="/search?manufacturer=<%= encodeURIComponent(product.manufacturer) %>"><%= product.manufacturer %></a></li>
        <li class="breadcrumb-item active" aria-current="page"><%= product.model %></li>
      </ol>
    </nav>
  </div>
</div>

<div class="row mb-4">
  <div class="col-md-8">
    <div class="card">
      <div class="card-header bg-primary text-white">
        <h2 class="mb-0"><%= product.manufacturer %> <%= product.model %></h2>
      </div>
      <div class="card-body">
        <% if (product.series) { %>
          <p class="text-muted">Series: <%= product.series %></p>
        <% } %>
        
        <% if (product.classification && Array.isArray(product.classification)) { %>
          <div class="mb-3">
            <% product.classification.forEach(function(cls) { %>
              <span class="badge bg-info classification-badge"><%= cls.toUpperCase() %></span>
            <% }); %>
          </div>
        <% } %>
        
        <div class="row mt-4">
          <div class="col-md-6">
            <h4>Technical Specifications</h4>
            <table class="table table-striped">
              <tbody>
                <tr>
                  <td class="spec-label">Load Capacity</td>
                  <td><%= product.loadCapacity || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Lifting Speed</td>
                  <td><%= product.liftingSpeed || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Secondary Speed</td>
                  <td><%= product.secondarySpeed || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Chain Fall</td>
                  <td><%= product.chainFall || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Motor Power</td>
                  <td><%= product.motorPower || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Duty Cycle</td>
                  <td><%= product.dutyCycle || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Voltage Options</td>
                  <td>
                    <% if (product.voltageOptions && Array.isArray(product.voltageOptions)) { %>
                      <%= product.voltageOptions.join(', ') %>
                    <% } else if (product.voltageOptions) { %>
                      <%= product.voltageOptions %>
                    <% } else { %>
                      Not specified
                    <% } %>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="col-md-6">
            <h4>Physical Characteristics</h4>
            <table class="table table-striped">
              <tbody>
                <tr>
                  <td class="spec-label">Weight</td>
                  <td><%= product.weight || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Dimensions</td>
                  <td><%= product.dimensions || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Chain Container</td>
                  <td><%= product.chainContainer || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Body Material</td>
                  <td><%= product.bodyMaterial || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Chain Material</td>
                  <td><%= product.chainMaterial || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Noise Level</td>
                  <td><%= product.noiseLevel || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Hook Type</td>
                  <td><%= product.hookType || 'Not specified' %></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <div class="row mt-4">
          <div class="col-md-6">
            <h4>Entertainment Industry Specifics</h4>
            <table class="table table-striped">
              <tbody>
                <tr>
                  <td class="spec-label">Quiet Operation</td>
                  <td><%= product.quietOperation ? 'Yes' : 'No' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Body Color</td>
                  <td>
                    <% if (product.bodyColor && Array.isArray(product.bodyColor)) { %>
                      <%= product.bodyColor.join(', ') %>
                    <% } else if (product.bodyColor) { %>
                      <%= product.bodyColor %>
                    <% } else { %>
                      Not specified
                    <% } %>
                  </td>
                </tr>
                <tr>
                  <td class="spec-label">Dynamic Lifting Approved</td>
                  <td><%= product.dynamicLifting ? 'Yes' : 'No' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Lifting Over People Approved</td>
                  <td><%= product.liftingOverPeople ? 'Yes' : 'No' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Common Applications</td>
                  <td>
                    <% if (product.commonApplications && Array.isArray(product.commonApplications)) { %>
                      <%= product.commonApplications.join(', ') %>
                    <% } else if (product.commonApplications) { %>
                      <%= product.commonApplications %>
                    <% } else { %>
                      Not specified
                    <% } %>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="col-md-6">
            <h4>Safety Features</h4>
            <table class="table table-striped">
              <tbody>
                <tr>
                  <td class="spec-label">Upper Limit Switch</td>
                  <td><%= product.upperLimitSwitch || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Lower Limit Switch</td>
                  <td><%= product.lowerLimitSwitch || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Overload Protection</td>
                  <td><%= product.overloadProtection || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Emergency Stop</td>
                  <td><%= product.emergencyStop || 'Not specified' %></td>
                </tr>
                <tr>
                  <td class="spec-label">Additional Safety Features</td>
                  <td>
                    <% if (product.additionalSafety && Array.isArray(product.additionalSafety)) { %>
                      <%= product.additionalSafety.join(', ') %>
                    <% } else if (product.additionalSafety) { %>
                      <%= product.additionalSafety %>
                    <% } else { %>
                      Not specified
                    <% } %>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <% if (product.url) { %>
          <div class="mt-4">
            <a href="<%= product.url %>" target="_blank" class="btn btn-outline-primary">
              <i class="fas fa-external-link-alt"></i> View Original Source
            </a>
          </div>
        <% } %>
        
        <% if (product.datasheet) { %>
          <div class="mt-2">
            <a href="<%= product.datasheet %>" target="_blank" class="btn btn-outline-secondary">
              <i class="fas fa-file-pdf"></i> Download Datasheet
            </a>
          </div>
        <% } %>
      </div>
    </div>
  </div>
  
  <div class="col-md-4">
    <div class="card">
      <div class="card-header bg-secondary text-white">
        <h4 class="mb-0">Similar Products</h4>
      </div>
      <div class="card-body">
        <% if (similarProducts.length > 0) { %>
          <% similarProducts.forEach(function(similar) { %>
            <div class="mb-3 pb-3 border-bottom">
              <h6><a href="/product/<%= similar.id %>"><%= similar.manufacturer %> <%= similar.model %></a></h6>
              <% if (similar.loadCapacity) { %>
                <small class="text-muted">Capacity: <%= similar.loadCapacity %></small>
              <% } %>
            </div>
          <% }); %>
        <% } else { %>
          <p class="text-muted">No similar products found.</p>
        <% } %>
      </div>
    </div>
  </div>
</div>`;

fs.writeFileSync(path.join(viewsDir, 'product.ejs'), productTemplate);

// Start the server
app.listen(port, () => {
  console.log('\n🚀 Enhanced Chainhoist Database Server Started!');
  console.log('==============================================');
  console.log(`📊 Web Interface: http://localhost:${port}`);
  console.log(`🔌 REST API: http://localhost:${port}/api`);
  console.log('\n📋 Available API Endpoints:');
  console.log('  GET  /api/chainhoists     - List all chainhoists');
  console.log('  GET  /api/chainhoists/:id - Get specific chainhoist');
  console.log('  GET  /api/manufacturers   - List manufacturers');
  console.log('  GET  /api/classifications - List classifications');
  console.log('  GET  /api/stats          - Database statistics');
  console.log('  POST /api/search         - Advanced search');
  console.log('\n📖 API Documentation: http://localhost:${port}/api');
  console.log('\n🎯 Example API calls:');
  console.log(`  curl "http://localhost:${port}/api/chainhoists?manufacturer=Columbus%20McKinnon"`);
  console.log(`  curl "http://localhost:${port}/api/chainhoists?minCapacity=500"`);
  console.log(`  curl "http://localhost:${port}/api/stats"`);
  console.log('\n💡 Press Ctrl+C to stop the server');
});