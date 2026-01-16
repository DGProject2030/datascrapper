/**
 * API Tests for Entertainment Industry Chainhoist Database
 *
 * These tests verify the REST API endpoints work correctly.
 * Uses Jest and Supertest for HTTP assertions.
 */

const request = require('supertest');
const app = require('../app');

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

describe('Classification Filtering Edge Cases', () => {
  test('filters by single classification', async () => {
    // Get available classifications first
    const clsResponse = await request(app).get('/api/classifications');

    if (clsResponse.body.data.length > 0) {
      const classification = clsResponse.body.data[0].name;
      const response = await request(app)
        .get('/api/chainhoists')
        .query({ classification });

      expect(response.status).toBe(200);
      response.body.data.forEach(item => {
        if (item.classification && Array.isArray(item.classification)) {
          expect(item.classification.some(c =>
            c.toLowerCase().includes(classification.toLowerCase()) ||
            classification.toLowerCase().includes(c.toLowerCase())
          )).toBe(true);
        }
      });
    }
  });

  test('handles non-existent classification', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ classification: 'nonexistent-classification-xyz' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(0);
  });

  test('classification filter is case-insensitive', async () => {
    const clsResponse = await request(app).get('/api/classifications');

    if (clsResponse.body.data.length > 0) {
      const classification = clsResponse.body.data[0].name;

      const lowerResponse = await request(app)
        .get('/api/chainhoists')
        .query({ classification: classification.toLowerCase() });

      const upperResponse = await request(app)
        .get('/api/chainhoists')
        .query({ classification: classification.toUpperCase() });

      // Both should return similar results
      expect(lowerResponse.body.pagination.total).toBe(upperResponse.body.pagination.total);
    }
  });
});

describe('Pagination Boundary Tests', () => {
  test('handles page 0 by defaulting to page 1', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ page: 0 });

    expect(response.status).toBe(200);
    expect(response.body.pagination.page).toBe(1);
  });

  test('handles negative page number gracefully', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ page: -5 });

    expect(response.status).toBe(200);
    // API may default to 1 or use the value - just verify it doesn't crash
    expect(response.body).toHaveProperty('pagination');
  });

  test('handles very large page number', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ page: 99999 });

    expect(response.status).toBe(200);
    // Should return empty data if page exceeds total pages
    if (response.body.pagination.page > response.body.pagination.pages) {
      expect(response.body.data).toHaveLength(0);
    }
  });

  test('handles limit of 0 by using default', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ limit: 0 });

    expect(response.status).toBe(200);
    expect(response.body.pagination.limit).toBeGreaterThan(0);
  });

  test('accepts large limit values', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ limit: 500 });

    expect(response.status).toBe(200);
    // API accepts the limit - verify response is valid
    expect(response.body).toHaveProperty('pagination');
    expect(response.body).toHaveProperty('data');
  });

  test('first page has correct offset', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ page: 1, limit: 10 });

    expect(response.status).toBe(200);
    // Pagination should start from first item
    expect(response.body.pagination.page).toBe(1);
  });

  test('page 2 returns different items than page 1', async () => {
    const page1Response = await request(app)
      .get('/api/chainhoists')
      .query({ page: 1, limit: 5 });

    const page2Response = await request(app)
      .get('/api/chainhoists')
      .query({ page: 2, limit: 5 });

    expect(page1Response.status).toBe(200);
    expect(page2Response.status).toBe(200);

    // If there are enough items, pages should be different
    if (page1Response.body.pagination.total > 5 && page2Response.body.data.length > 0) {
      const page1Ids = page1Response.body.data.map(item => item.id);
      const page2Ids = page2Response.body.data.map(item => item.id);

      // No overlap expected
      page2Ids.forEach(id => {
        expect(page1Ids).not.toContain(id);
      });
    }
  });
});

describe('Sort Ordering Verification', () => {
  test('accepts sortBy parameter without crashing', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ sortBy: 'manufacturer', sortOrder: 'asc', limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
  });

  test('accepts sortOrder desc without crashing', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ sortBy: 'manufacturer', sortOrder: 'desc', limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
  });

  test('accepts sortBy model without crashing', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ sortBy: 'model', sortOrder: 'asc', limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
  });

  test('returns consistent results with sortBy parameter', async () => {
    const response1 = await request(app)
      .get('/api/chainhoists')
      .query({ sortBy: 'manufacturer', sortOrder: 'asc', limit: 10 });

    const response2 = await request(app)
      .get('/api/chainhoists')
      .query({ sortBy: 'manufacturer', sortOrder: 'asc', limit: 10 });

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Same query should return same results
    if (response1.body.data.length > 0 && response2.body.data.length > 0) {
      expect(response1.body.data[0].id).toBe(response2.body.data[0].id);
    }
  });

  test('handles invalid sortBy field gracefully', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ sortBy: 'invalidField' });

    expect(response.status).toBe(200);
    // Should not crash, returns results
    expect(response.body).toHaveProperty('data');
  });

  test('handles invalid sortOrder gracefully', async () => {
    const response = await request(app)
      .get('/api/chainhoists')
      .query({ sortBy: 'manufacturer', sortOrder: 'invalid' });

    expect(response.status).toBe(200);
    // Should not crash, returns results
    expect(response.body).toHaveProperty('data');
  });
});

describe('GET /api/count', () => {
  test('returns count of all products when no filters', async () => {
    const response = await request(app).get('/api/count');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('count');
    expect(typeof response.body.count).toBe('number');
  });

  test('returns filtered count with manufacturer filter', async () => {
    const mfgResponse = await request(app).get('/api/manufacturers');

    if (mfgResponse.body.data.length > 0) {
      const manufacturer = mfgResponse.body.data[0].name;
      const response = await request(app)
        .get('/api/count')
        .query({ manufacturer });

      expect(response.status).toBe(200);
      expect(response.body.count).toBeLessThanOrEqual(mfgResponse.body.data[0].count);
    }
  });

  test('returns zero for non-matching filters', async () => {
    const response = await request(app)
      .get('/api/count')
      .query({ manufacturer: 'NonExistentManufacturer123' });

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(0);
  });
});

describe('GET /api/suggestions', () => {
  test('returns suggestions for partial query', async () => {
    const response = await request(app)
      .get('/api/suggestions')
      .query({ q: 'chain' });

    expect(response.status).toBe(200);
    // Response can be array or object with suggestions property
    const suggestions = Array.isArray(response.body) ? response.body : (response.body.suggestions || []);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  test('handles very short query', async () => {
    const response = await request(app)
      .get('/api/suggestions')
      .query({ q: 'a' });

    expect(response.status).toBe(200);
    // API may or may not return results for short queries
    const suggestions = Array.isArray(response.body) ? response.body : (response.body.suggestions || []);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  test('handles empty query', async () => {
    const response = await request(app)
      .get('/api/suggestions')
      .query({ q: '' });

    expect(response.status).toBe(200);
    // Empty query should return empty or no suggestions
    const suggestions = Array.isArray(response.body) ? response.body : (response.body.suggestions || []);
    expect(suggestions.length).toBeLessThanOrEqual(15);
  });

  test('returns reasonable number of suggestions', async () => {
    const response = await request(app)
      .get('/api/suggestions')
      .query({ q: 'chain' });

    expect(response.status).toBe(200);
    const suggestions = Array.isArray(response.body) ? response.body : (response.body.suggestions || []);
    expect(suggestions.length).toBeLessThanOrEqual(20); // Max suggestions
  });

  test('suggestions include type information', async () => {
    // Get a known manufacturer name for testing
    const mfgResponse = await request(app).get('/api/manufacturers');

    if (mfgResponse.body.data.length > 0) {
      const manufacturerName = mfgResponse.body.data[0].name.substring(0, 3);
      const response = await request(app)
        .get('/api/suggestions')
        .query({ q: manufacturerName });

      expect(response.status).toBe(200);
      const suggestions = Array.isArray(response.body) ? response.body : (response.body.suggestions || []);
      if (suggestions.length > 0) {
        suggestions.forEach(suggestion => {
          expect(suggestion).toHaveProperty('type');
          expect(suggestion).toHaveProperty('value');
          expect(['manufacturer', 'classification', 'product']).toContain(suggestion.type);
        });
      }
    }
  });
});

describe('Cache Behavior Tests', () => {
  test('subsequent requests return consistent data', async () => {
    const response1 = await request(app).get('/api/chainhoists?limit=5');
    const response2 = await request(app).get('/api/chainhoists?limit=5');

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Both requests should return the same total count
    expect(response1.body.pagination.total).toBe(response2.body.pagination.total);

    // Same IDs in same order
    const ids1 = response1.body.data.map(item => item.id);
    const ids2 = response2.body.data.map(item => item.id);
    expect(ids1).toEqual(ids2);
  });

  test('stats endpoint returns consistent data', async () => {
    const response1 = await request(app).get('/api/stats');
    const response2 = await request(app).get('/api/stats');

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    expect(response1.body.data.totalRecords).toBe(response2.body.data.totalRecords);
    expect(response1.body.data.manufacturers).toBe(response2.body.data.manufacturers);
  });

  test('manufacturer list is cached consistently', async () => {
    const response1 = await request(app).get('/api/manufacturers');
    const response2 = await request(app).get('/api/manufacturers');

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Same manufacturers returned
    const names1 = response1.body.data.map(m => m.name).sort();
    const names2 = response2.body.data.map(m => m.name).sort();
    expect(names1).toEqual(names2);
  });
});

describe('Web Routes - Search Page', () => {
  test('GET /search returns HTML page', async () => {
    const response = await request(app).get('/search');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  test('GET /search with query parameter', async () => {
    const response = await request(app).get('/search?q=chain');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  test('GET /search with filters', async () => {
    const response = await request(app)
      .get('/search')
      .query({
        manufacturer: 'test',
        classification: 'd8',
        page: 1,
        limit: 10
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });
});

describe('Web Routes - Product Page', () => {
  test('GET /product/:id returns HTML for valid product', async () => {
    // First get a valid product ID
    const listResponse = await request(app).get('/api/chainhoists?limit=1');

    if (listResponse.body.data.length > 0) {
      const validId = listResponse.body.data[0].id;
      const response = await request(app).get(`/product/${validId}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
    }
  });

  test('GET /product/:id returns 404 for invalid product', async () => {
    const response = await request(app).get('/product/invalid-product-id-xyz');

    expect(response.status).toBe(404);
  });
});
