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
