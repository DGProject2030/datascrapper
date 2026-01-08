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
