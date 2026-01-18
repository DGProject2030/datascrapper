// Electric Chainhoist Database Server
// Starts the Express server

const fs = require('fs');
const path = require('path');
const app = require('./app');

const port = process.env.PORT || 3000;

// Create views directory and EJS templates if they don't exist
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
            <a class="nav-link" href="/search">Browse All</a>
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
const indexTemplate = `<%- include('header') %>

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
                  <%
                    const sortedClassifications = classifications
                      .map(c => ({ name: c, count: report.classificationDistribution[c] || 0 }))
                      .sort((a, b) => b.count - a.count);
                  %>
                  <% sortedClassifications.slice(0, 6).forEach(function(cls) { %>
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                      <%= cls.name.toUpperCase() %>
                      <span class="badge bg-info rounded-pill"><%= cls.count %></span>
                    </li>
                  <% }); %>
                  <% if (sortedClassifications.length > 6) { %>
                    <li class="list-group-item text-center text-muted">+ <%= sortedClassifications.length - 6 %> more</li>
                  <% } %>
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

<%- include('footer') %>
`;

fs.writeFileSync(path.join(viewsDir, 'index.ejs'), indexTemplate);

// Create personality.ejs
const personalityTemplate = `<%- include('header') %>

<div class="row mb-4">
  <div class="col-md-12">
    <div class="card border-success">
      <div class="card-body">
        <h1 class="card-title">Personality Database</h1>
        <p class="card-text">Technical configuration data extracted from <%= summary.totalProducts %> equipment personality files.</p>

        <div class="row mt-4">
          <div class="col-md-3">
            <div class="card bg-light h-100">
              <div class="card-body text-center">
                <h3 class="text-success"><%= summary.totalProducts %></h3>
                <p class="mb-0">Total Products</p>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-light h-100">
              <div class="card-body text-center">
                <h3 class="text-primary"><%= summary.manufacturers %></h3>
                <p class="mb-0">Manufacturers</p>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-light h-100">
              <div class="card-body text-center">
                <h3 class="text-info"><%= summary.entertainmentProducts %></h3>
                <p class="mb-0">Entertainment Products</p>
              </div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card bg-light h-100">
              <div class="card-body text-center">
                <h3 class="text-warning"><%= summary.speedTypes['Variable Speed'] || 0 %></h3>
                <p class="mb-0">Variable Speed</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="row mb-4">
  <div class="col-md-6">
    <div class="card">
      <div class="card-header bg-success text-white">
        <h5 class="mb-0">By Category</h5>
      </div>
      <div class="card-body">
        <ul class="list-group list-group-flush">
          <% Object.entries(summary.categories || {}).forEach(function([cat, count]) { %>
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <%= cat %>
              <span class="badge bg-success rounded-pill"><%= count %></span>
            </li>
          <% }); %>
        </ul>
      </div>
    </div>
  </div>
  <div class="col-md-6">
    <div class="card">
      <div class="card-header bg-info text-white">
        <h5 class="mb-0">By Speed Type</h5>
      </div>
      <div class="card-body">
        <ul class="list-group list-group-flush">
          <% Object.entries(summary.speedTypes || {}).forEach(function([type, count]) { %>
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <%= type %>
              <span class="badge bg-info rounded-pill"><%= count %></span>
            </li>
          <% }); %>
        </ul>
      </div>
    </div>
  </div>
</div>

<div class="row mb-4">
  <div class="col-md-12">
    <div class="card">
      <div class="card-header bg-primary text-white">
        <h4 class="mb-0">Filter Products</h4>
      </div>
      <div class="card-body">
        <form action="/personality" method="GET" class="row g-3">
          <div class="col-md-3">
            <label for="manufacturer" class="form-label">Manufacturer</label>
            <select name="manufacturer" id="manufacturer" class="form-select">
              <option value="">All Manufacturers</option>
              <% manufacturerList.forEach(function(mfr) { %>
                <option value="<%= mfr %>" <%= filters.manufacturer === mfr ? 'selected' : '' %>><%= mfr %></option>
              <% }); %>
            </select>
          </div>
          <div class="col-md-3">
            <label for="category" class="form-label">Category</label>
            <select name="category" id="category" class="form-select">
              <option value="">All Categories</option>
              <% categoryList.forEach(function(cat) { %>
                <option value="<%= cat %>" <%= filters.category === cat ? 'selected' : '' %>><%= cat %></option>
              <% }); %>
            </select>
          </div>
          <div class="col-md-3">
            <label for="speedType" class="form-label">Speed Type</label>
            <select name="speedType" id="speedType" class="form-select">
              <option value="">All Speed Types</option>
              <% speedTypeList.forEach(function(st) { %>
                <option value="<%= st %>" <%= filters.speedType === st ? 'selected' : '' %>><%= st %></option>
              <% }); %>
            </select>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <button type="submit" class="btn btn-primary w-100">Filter</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</div>

<h2 class="mb-4">Products (<%= products.length %> results)</h2>

<div class="table-responsive">
  <table class="table table-striped table-hover">
    <thead class="table-dark">
      <tr>
        <th>Manufacturer</th>
        <th>Name</th>
        <th>Category</th>
        <th>Load Capacity</th>
        <th>Speed</th>
        <th>Speed Type</th>
        <th>Entertainment</th>
      </tr>
    </thead>
    <tbody>
      <% products.slice(0, 100).forEach(function(product) { %>
        <tr>
          <td><%= product.manufacturer %></td>
          <td>
            <a href="/personality/<%= product.manufacturerId %>/<%= product.productId %>">
              <%= product.name %>
            </a>
          </td>
          <td><span class="badge bg-secondary"><%= product.category %></span></td>
          <td><%= product.loadCapacity || '-' %></td>
          <td><%= product.liftingSpeed || '-' %></td>
          <td>
            <% if (product.speedType === 'Variable Speed') { %>
              <span class="badge bg-success">Variable</span>
            <% } else if (product.speedType === 'Fixed Speed') { %>
              <span class="badge bg-warning">Fixed</span>
            <% } else { %>
              <span class="badge bg-secondary">Unknown</span>
            <% } %>
          </td>
          <td>
            <% if (product.entertainmentIndustry) { %>
              <span class="badge bg-info">Yes</span>
            <% } else { %>
              <span class="badge bg-light text-dark">No</span>
            <% } %>
          </td>
        </tr>
      <% }); %>
    </tbody>
  </table>
</div>

<% if (products.length > 100) { %>
  <p class="text-muted">Showing first 100 of <%= products.length %> results. Use filters to narrow down.</p>
<% } %>

<%- include('footer') %>
`;

fs.writeFileSync(path.join(viewsDir, 'personality.ejs'), personalityTemplate);

// Create personality-detail.ejs
const personalityDetailTemplate = `<%- include('header') %>

<nav aria-label="breadcrumb" class="mb-4">
  <ol class="breadcrumb">
    <li class="breadcrumb-item"><a href="/">Home</a></li>
    <li class="breadcrumb-item"><a href="/personality">Personality DB</a></li>
    <li class="breadcrumb-item active"><%= product.name %></li>
  </ol>
</nav>

<div class="row">
  <div class="col-md-8">
    <div class="card mb-4">
      <div class="card-header bg-success text-white">
        <h2 class="mb-0"><%= product.manufacturer %></h2>
      </div>
      <div class="card-body">
        <h4 class="card-title"><%= product.name %></h4>

        <div class="row mt-4">
          <div class="col-md-6">
            <h5>Basic Specifications</h5>
            <table class="table table-sm">
              <tr>
                <th>Load Capacity:</th>
                <td><%= product.loadCapacity || '-' %></td>
              </tr>
              <tr>
                <th>Lifting Speed:</th>
                <td><%= product.liftingSpeed || '-' %></td>
              </tr>
              <tr>
                <th>Category:</th>
                <td><span class="badge bg-secondary"><%= product.category %></span></td>
              </tr>
              <tr>
                <th>Speed Type:</th>
                <td>
                  <% if (product.speedType === 'Variable Speed') { %>
                    <span class="badge bg-success">Variable Speed</span>
                  <% } else if (product.speedType === 'Fixed Speed') { %>
                    <span class="badge bg-warning">Fixed Speed</span>
                  <% } else { %>
                    <span class="badge bg-secondary">Unknown</span>
                  <% } %>
                </td>
              </tr>
              <tr>
                <th>Entertainment Industry:</th>
                <td>
                  <% if (product.entertainmentIndustry) { %>
                    <span class="badge bg-info">Yes</span>
                  <% } else { %>
                    <span class="badge bg-light text-dark">No</span>
                  <% } %>
                </td>
              </tr>
            </table>
          </div>
          <div class="col-md-6">
            <h5>Speed Control Parameters</h5>
            <% if (product.variableSpeedControl) { %>
              <table class="table table-sm">
                <tr>
                  <th>Min Speed:</th>
                  <td><%= product.variableSpeedControl.minSpeed || '-' %></td>
                </tr>
                <tr>
                  <th>Max Speed:</th>
                  <td><%= product.variableSpeedControl.maxSpeed || '-' %></td>
                </tr>
                <tr>
                  <th>Default Speed:</th>
                  <td><%= product.variableSpeedControl.defaultSpeed || '-' %></td>
                </tr>
                <tr>
                  <th>Max Accel:</th>
                  <td><%= product.variableSpeedControl.maxAccel || '-' %></td>
                </tr>
                <tr>
                  <th>Max Decel:</th>
                  <td><%= product.variableSpeedControl.maxDecel || '-' %></td>
                </tr>
              </table>
            <% } else { %>
              <p class="text-muted">No speed control data available</p>
            <% } %>
          </div>
        </div>

        <div class="row mt-4">
          <div class="col-md-6">
            <h5>Load Parameters</h5>
            <table class="table table-sm">
              <tr>
                <th>Underload Limit:</th>
                <td><%= product.underloadLimit || '-' %></td>
              </tr>
              <tr>
                <th>Overload Limit:</th>
                <td><%= product.overloadLimit || '-' %></td>
              </tr>
              <tr>
                <th>Loadcell Scaling:</th>
                <td><%= product.loadcellScaling || '-' %></td>
              </tr>
              <tr>
                <th>Encoder Scaling:</th>
                <td><%= product.encoderScaling || '-' %></td>
              </tr>
            </table>
          </div>
          <div class="col-md-6">
            <h5>Tuning Parameters</h5>
            <% if (product.tuningParameters) { %>
              <table class="table table-sm">
                <% Object.entries(product.tuningParameters).forEach(function([key, value]) { %>
                  <tr>
                    <th><%= key %>:</th>
                    <td><%= value %></td>
                  </tr>
                <% }); %>
              </table>
            <% } else { %>
              <p class="text-muted">No tuning parameters available</p>
            <% } %>
          </div>
        </div>

        <% if (product.manufacturerWebsite) { %>
          <div class="mt-4">
            <a href="<%= product.manufacturerWebsite %>" target="_blank" class="btn btn-outline-primary">
              Visit Manufacturer Website
            </a>
          </div>
        <% } %>
      </div>
    </div>
  </div>

  <div class="col-md-4">
    <div class="card">
      <div class="card-header bg-info text-white">
        <h5 class="mb-0">Similar Products</h5>
      </div>
      <div class="card-body">
        <% if (similarProducts.length > 0) { %>
          <ul class="list-group list-group-flush">
            <% similarProducts.forEach(function(similar) { %>
              <li class="list-group-item">
                <a href="/personality/<%= similar.manufacturerId %>/<%= similar.productId %>">
                  <%= similar.name %>
                </a>
                <br>
                <small class="text-muted"><%= similar.loadCapacity || '' %></small>
              </li>
            <% }); %>
          </ul>
        <% } else { %>
          <p class="text-muted">No similar products found</p>
        <% } %>
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-header bg-secondary text-white">
        <h5 class="mb-0">File Information</h5>
      </div>
      <div class="card-body">
        <table class="table table-sm">
          <tr>
            <th>File Name:</th>
            <td><small><%= product.fileName %></small></td>
          </tr>
          <tr>
            <th>Manufacturer ID:</th>
            <td><%= product.manufacturerId %></td>
          </tr>
          <tr>
            <th>Product ID:</th>
            <td><%= product.productId %></td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</div>

<%- include('footer') %>
`;

fs.writeFileSync(path.join(viewsDir, 'personality-detail.ejs'), personalityDetailTemplate);

// Create search.ejs (simplified - templates already exist from original file)
// The views should already exist from previous runs

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
  console.log(`\n📖 API Documentation: http://localhost:${port}/api`);
  console.log('\n🎯 Example API calls:');
  console.log(`  curl "http://localhost:${port}/api/chainhoists?manufacturer=Columbus%20McKinnon"`);
  console.log(`  curl "http://localhost:${port}/api/chainhoists?minCapacity=500"`);
  console.log(`  curl "http://localhost:${port}/api/stats"`);
  console.log('\n💡 Press Ctrl+C to stop the server');
});
