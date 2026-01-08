/**
 * API Tests for Entertainment Industry Chainhoist Database
 *
 * These tests verify the REST API endpoints work correctly.
 * Uses Jest and Supertest for HTTP assertions.
 */

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Create a test app instance (mirrors the main app's API routes)
const app = express();
app.use(express.json());

// Test data paths
const CONFIG = {
  dataDir: 'chainhoist_data_processed',
  dataFile: 'chainhoist_database_processed.json',
  reportFile: 'data_quality_report.json',
};

// Load data helper
function loadData() {
  try {
    const dataPath = path.join(__dirname, '..', CONFIG.dataDir, CONFIG.dataFile);
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
    const reportPath = path.join(__dirname, '..', CONFIG.dataDir, CONFIG.reportFile);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return report;
  } catch (error) {
    console.error('Error loading report:', error);
    return { totalRecords: 0 };
  }
}

// ============ API Routes (copied from main app for isolated testing) ============

// GET /api - API Documentation
app.get('/api', (req, res) => {
  const apiDocs = {
    title: 'Entertainment Industry Chainhoist Database API',
    version: '2.0',
    description: 'REST API for accessing chainhoist data',
  };
  res.json(apiDocs);
});

// GET /api/chainhoists
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

// GET /api/chainhoists/:id
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

// GET /api/manufacturers
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

// GET /api/classifications
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

// GET /api/stats
app.get('/api/stats', (req, res) => {
  try {
    const data = loadData();
    const report = loadReport();

    const stats = {
      totalRecords: data.length,
      manufacturers: [...new Set(data.map(item => item.manufacturer))].length,
      classifications: Object.keys(report.classificationDistribution || {}).length,
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

// POST /api/search
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

// ============ TEST SUITES ============

describe('API Documentation', () => {
  test('GET /api returns API documentation', async () => {
    const response = await request(app).get('/api');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('title');
    expect(response.body).toHaveProperty('version');
    expect(response.body).toHaveProperty('description');
    expect(response.body.title).toBe('Entertainment Industry Chainhoist Database API');
  });
});

describe('GET /api/chainhoists', () => {
  test('returns list of chainhoists with success flag', async () => {
    const response = await request(app).get('/api/chainhoists');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('pagination');
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  test('returns pagination information', async () => {
    const response = await request(app).get('/api/chainhoists');

    expect(response.body.pagination).toHaveProperty('page');
    expect(response.body.pagination).toHaveProperty('limit');
    expect(response.body.pagination).toHaveProperty('total');
    expect(response.body.pagination).toHaveProperty('pages');
  });

  test('respects page and limit parameters', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ page: 1, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.pagination.page).toBe(1);
    expect(response.body.pagination.limit).toBe(10);
    expect(response.body.data.length).toBeLessThanOrEqual(10);
  });

  test('filters by manufacturer', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ manufacturer: 'Columbus' });

    expect(response.status).toBe(200);
    if (response.body.data.length > 0) {
      response.body.data.forEach(item => {
        expect(item.manufacturer.toLowerCase()).toContain('columbus');
      });
    }
  });

  test('filters by minCapacity', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ minCapacity: 500 });

    expect(response.status).toBe(200);
    response.body.data.forEach(item => {
      if (item.loadCapacity) {
        const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
        if (match) {
          expect(parseFloat(match[1])).toBeGreaterThanOrEqual(500);
        }
      }
    });
  });

  test('filters by maxCapacity', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ maxCapacity: 1000 });

    expect(response.status).toBe(200);
    response.body.data.forEach(item => {
      if (item.loadCapacity) {
        const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
        if (match) {
          expect(parseFloat(match[1])).toBeLessThanOrEqual(1000);
        }
      }
    });
  });

  test('returns filters in response', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ manufacturer: 'test', minCapacity: 100 });

    expect(response.body.filters).toHaveProperty('manufacturer', 'test');
    expect(response.body.filters).toHaveProperty('minCapacity', '100');
  });
});

describe('GET /api/chainhoists/:id', () => {
  test('returns 404 for non-existent chainhoist', async () => {
    const response = await request(app).get('/api/chainhoists/non-existent-id-12345');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Chainhoist not found');
  });

  test('returns specific chainhoist when found', async () => {
    // First get list to find a valid ID
    const listResponse = await request(app).get('/api/chainhoists?limit=1');

    if (listResponse.body.data.length > 0) {
      const validId = listResponse.body.data[0].id;
      const response = await request(app).get(`/api/chainhoists/${validId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', validId);
    }
  });
});

describe('GET /api/manufacturers', () => {
  test('returns list of manufacturers with statistics', async () => {
    const response = await request(app).get('/api/manufacturers');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  test('each manufacturer has name, count, and models', async () => {
    const response = await request(app).get('/api/manufacturers');

    if (response.body.data.length > 0) {
      response.body.data.forEach(manufacturer => {
        expect(manufacturer).toHaveProperty('name');
        expect(manufacturer).toHaveProperty('count');
        expect(manufacturer).toHaveProperty('models');
        expect(typeof manufacturer.count).toBe('number');
        expect(typeof manufacturer.models).toBe('number');
      });
    }
  });
});

describe('GET /api/classifications', () => {
  test('returns list of classifications', async () => {
    const response = await request(app).get('/api/classifications');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  test('each classification has name and count', async () => {
    const response = await request(app).get('/api/classifications');

    if (response.body.data.length > 0) {
      response.body.data.forEach(classification => {
        expect(classification).toHaveProperty('name');
        expect(classification).toHaveProperty('count');
        expect(typeof classification.count).toBe('number');
      });
    }
  });
});

describe('GET /api/stats', () => {
  test('returns database statistics', async () => {
    const response = await request(app).get('/api/stats');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('report');
  });

  test('stats include totalRecords and manufacturers count', async () => {
    const response = await request(app).get('/api/stats');

    expect(response.body.data).toHaveProperty('totalRecords');
    expect(response.body.data).toHaveProperty('manufacturers');
    expect(typeof response.body.data.totalRecords).toBe('number');
    expect(typeof response.body.data.manufacturers).toBe('number');
  });
});

describe('POST /api/search', () => {
  test('returns search results with empty criteria', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('total');
  });

  test('searches by query string', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({ query: 'chain' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('filters by capacity range', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({ capacityRange: { min: 100, max: 500 } });

    expect(response.status).toBe(200);
    response.body.data.forEach(item => {
      if (item.loadCapacity) {
        const match = item.loadCapacity.match(/(\d+(?:\.\d+)?)\s*kg/i);
        if (match) {
          const capacity = parseFloat(match[1]);
          expect(capacity).toBeGreaterThanOrEqual(100);
          expect(capacity).toBeLessThanOrEqual(500);
        }
      }
    });
  });

  test('filters by multiple manufacturers', async () => {
    // First get available manufacturers
    const mfgResponse = await request(app).get('/api/manufacturers');

    if (mfgResponse.body.data.length >= 2) {
      const manufacturers = mfgResponse.body.data.slice(0, 2).map(m => m.name);

      const response = await request(app)
        .post('/api/search')
        .send({ manufacturers });

      expect(response.status).toBe(200);
      response.body.data.forEach(item => {
        expect(manufacturers).toContain(item.manufacturer);
      });
    }
  });

  test('respects pagination in search', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({ page: 2, limit: 5 });

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(2);
    expect(response.body.limit).toBe(5);
    expect(response.body.data.length).toBeLessThanOrEqual(5);
  });

  test('returns searchCriteria in response', async () => {
    const criteria = { query: 'test', page: 1, limit: 10 };
    const response = await request(app)
      .post('/api/search')
      .send(criteria);

    expect(response.body.searchCriteria).toMatchObject(criteria);
  });
});

describe('Error Handling', () => {
  test('handles invalid page parameter gracefully', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ page: 'invalid' });

    expect(response.status).toBe(200);
    expect(response.body.pagination.page).toBe(1); // Falls back to default
  });

  test('handles invalid limit parameter gracefully', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ limit: 'invalid' });

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBe(50); // Falls back to default
  });
});
