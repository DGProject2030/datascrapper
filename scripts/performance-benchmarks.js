#!/usr/bin/env node
/**
 * Performance Benchmarks for Chainhoist Database
 *
 * Measures and validates performance targets:
 * - Initial page load: < 500ms
 * - Search with filters: < 100ms
 * - API response: < 50ms
 *
 * Usage:
 *   node scripts/performance-benchmarks.js [options]
 *
 * Options:
 *   --verbose    Show detailed timing breakdown
 *   --iterations Number of iterations (default: 10)
 *   --json       Output results as JSON
 *   --ci         CI mode - exit with error if thresholds exceeded
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  pageLoad: 500,      // Initial page load
  searchFilter: 100,  // Search with filters
  apiResponse: 50     // Raw API response
};

// Test endpoints
const ENDPOINTS = {
  // Page loads
  pages: [
    { name: 'Homepage', path: '/', threshold: THRESHOLDS.pageLoad },
    { name: 'Search Page', path: '/search', threshold: THRESHOLDS.pageLoad },
    { name: 'Product Page', path: '/product/0', threshold: THRESHOLDS.pageLoad },
    { name: 'Personality Page', path: '/personality', threshold: THRESHOLDS.pageLoad }
  ],
  // Search with filters
  searches: [
    { name: 'Search: no filters', path: '/search?limit=10', threshold: THRESHOLDS.searchFilter },
    { name: 'Search: text query', path: '/search?q=chain&limit=10', threshold: THRESHOLDS.searchFilter },
    { name: 'Search: manufacturer', path: '/search?manufacturer=Columbus&limit=10', threshold: THRESHOLDS.searchFilter },
    { name: 'Search: classification', path: '/search?classification=D8&limit=10', threshold: THRESHOLDS.searchFilter },
    { name: 'Search: multiple filters', path: '/search?q=hoist&manufacturer=Yale&limit=10', threshold: THRESHOLDS.searchFilter }
  ],
  // API endpoints
  apis: [
    { name: 'API: products list', path: '/api/products?limit=10', threshold: THRESHOLDS.apiResponse },
    { name: 'API: single product', path: '/api/products/0', threshold: THRESHOLDS.apiResponse },
    { name: 'API: count', path: '/api/products/count', threshold: THRESHOLDS.apiResponse },
    { name: 'API: manufacturers', path: '/api/manufacturers', threshold: THRESHOLDS.apiResponse },
    { name: 'API: suggestions', path: '/api/suggestions?q=chain', threshold: THRESHOLDS.apiResponse },
    { name: 'API: search', path: '/api/products?q=chain&limit=10', threshold: THRESHOLDS.apiResponse },
    { name: 'API: filtered', path: '/api/products?manufacturer=Columbus&limit=10', threshold: THRESHOLDS.apiResponse }
  ]
};

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  verbose: args.includes('--verbose') || args.includes('-v'),
  json: args.includes('--json'),
  ci: args.includes('--ci'),
  iterations: parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] || '10', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000'
};

/**
 * Make an HTTP request and measure response time
 */
function measureRequest(url) {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const req = protocol.request(url, {
      method: 'GET',
      timeout: 10000
    }, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1_000_000; // Convert to ms

        resolve({
          statusCode: res.statusCode,
          duration,
          size: Buffer.byteLength(data, 'utf8')
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Run benchmark for a single endpoint
 */
async function benchmarkEndpoint(endpoint, iterations) {
  const url = `${options.baseUrl}${endpoint.path}`;
  const results = [];

  // Warm-up request
  try {
    await measureRequest(url);
  } catch (err) {
    return {
      ...endpoint,
      error: err.message,
      passed: false
    };
  }

  // Benchmark iterations
  for (let i = 0; i < iterations; i++) {
    try {
      const result = await measureRequest(url);
      results.push(result);
    } catch (err) {
      results.push({ error: err.message });
    }
  }

  // Calculate statistics
  const validResults = results.filter(r => !r.error);
  if (validResults.length === 0) {
    return {
      ...endpoint,
      error: 'All requests failed',
      passed: false
    };
  }

  const durations = validResults.map(r => r.duration);
  const sorted = [...durations].sort((a, b) => a - b);

  const stats = {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: durations.reduce((a, b) => a + b, 0) / durations.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1],
    successRate: (validResults.length / results.length) * 100,
    avgSize: validResults.reduce((a, b) => a + b.size, 0) / validResults.length
  };

  return {
    ...endpoint,
    stats,
    passed: stats.p95 <= endpoint.threshold,
    iterations: results.length,
    successful: validResults.length
  };
}

/**
 * Run all benchmarks
 */
async function runBenchmarks() {
  console.log('Performance Benchmarks - Chainhoist Database\n');
  console.log(`Base URL: ${options.baseUrl}`);
  console.log(`Iterations: ${options.iterations}`);
  console.log(`Thresholds: Page Load < ${THRESHOLDS.pageLoad}ms, Search < ${THRESHOLDS.searchFilter}ms, API < ${THRESHOLDS.apiResponse}ms\n`);

  const allResults = {
    timestamp: new Date().toISOString(),
    baseUrl: options.baseUrl,
    iterations: options.iterations,
    thresholds: THRESHOLDS,
    categories: {}
  };

  let totalPassed = 0;
  let totalFailed = 0;

  // Check if server is running
  try {
    await measureRequest(options.baseUrl);
  } catch (err) {
    console.error(`\nError: Cannot connect to ${options.baseUrl}`);
    console.error('Make sure the server is running (npm start)\n');
    process.exit(1);
  }

  // Run benchmarks for each category
  for (const [category, endpoints] of Object.entries(ENDPOINTS)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Category: ${category.toUpperCase()}`);
    console.log('='.repeat(60));

    const categoryResults = [];

    for (const endpoint of endpoints) {
      process.stdout.write(`  Testing: ${endpoint.name}... `);

      const result = await benchmarkEndpoint(endpoint, options.iterations);
      categoryResults.push(result);

      if (result.error) {
        console.log(`ERROR: ${result.error}`);
        totalFailed++;
      } else {
        const status = result.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
        console.log(`${status} (p95: ${result.stats.p95.toFixed(1)}ms, threshold: ${endpoint.threshold}ms)`);

        if (result.passed) {
          totalPassed++;
        } else {
          totalFailed++;
        }

        if (options.verbose) {
          console.log(`    Min: ${result.stats.min.toFixed(1)}ms | Max: ${result.stats.max.toFixed(1)}ms | Avg: ${result.stats.avg.toFixed(1)}ms`);
          console.log(`    Median: ${result.stats.median.toFixed(1)}ms | P99: ${result.stats.p99.toFixed(1)}ms`);
          console.log(`    Success Rate: ${result.stats.successRate.toFixed(0)}% | Avg Size: ${(result.stats.avgSize / 1024).toFixed(1)}KB`);
        }
      }
    }

    allResults.categories[category] = categoryResults;
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const total = totalPassed + totalFailed;
  const passRate = (totalPassed / total * 100).toFixed(1);

  console.log(`\nTotal Tests: ${total}`);
  console.log(`Passed: \x1b[32m${totalPassed}\x1b[0m`);
  console.log(`Failed: \x1b[31m${totalFailed}\x1b[0m`);
  console.log(`Pass Rate: ${passRate}%`);

  // Category summaries
  console.log('\nCategory Breakdown:');
  for (const [category, results] of Object.entries(allResults.categories)) {
    const catPassed = results.filter(r => r.passed).length;
    const catTotal = results.length;
    const avgP95 = results
      .filter(r => r.stats)
      .reduce((sum, r) => sum + r.stats.p95, 0) / results.filter(r => r.stats).length;

    console.log(`  ${category}: ${catPassed}/${catTotal} passed (avg p95: ${avgP95.toFixed(1)}ms)`);
  }

  // JSON output
  if (options.json) {
    allResults.summary = {
      total,
      passed: totalPassed,
      failed: totalFailed,
      passRate: parseFloat(passRate)
    };

    const jsonPath = `./benchmark-results-${Date.now()}.json`;
    require('fs').writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
    console.log(`\nResults saved to: ${jsonPath}`);
  }

  // CI mode exit code
  if (options.ci && totalFailed > 0) {
    console.log('\nCI Mode: Exiting with error due to failed benchmarks');
    process.exit(1);
  }

  return allResults;
}

/**
 * Generate performance report
 */
function generateReport(results) {
  console.log('\n\n');
  console.log('Performance Recommendations:');
  console.log('-'.repeat(40));

  const slowEndpoints = [];

  for (const [category, endpoints] of Object.entries(results.categories)) {
    for (const endpoint of endpoints) {
      if (endpoint.stats && !endpoint.passed) {
        slowEndpoints.push({
          category,
          ...endpoint,
          overThreshold: endpoint.stats.p95 - endpoint.threshold
        });
      }
    }
  }

  if (slowEndpoints.length === 0) {
    console.log('\nAll endpoints are within performance thresholds!');
  } else {
    console.log('\nSlow endpoints that need optimization:');

    slowEndpoints.sort((a, b) => b.overThreshold - a.overThreshold);

    for (const endpoint of slowEndpoints) {
      console.log(`\n  ${endpoint.name}`);
      console.log(`    P95: ${endpoint.stats.p95.toFixed(1)}ms (${endpoint.overThreshold.toFixed(1)}ms over threshold)`);

      // Provide specific recommendations based on endpoint type
      if (endpoint.path.includes('/api/')) {
        console.log('    Recommendations:');
        console.log('      - Enable response caching');
        console.log('      - Add database indexes for filtered fields');
        console.log('      - Consider pagination for large result sets');
      } else if (endpoint.path.includes('/search')) {
        console.log('    Recommendations:');
        console.log('      - Cache common search queries');
        console.log('      - Optimize template rendering');
        console.log('      - Lazy load non-critical content');
      } else {
        console.log('    Recommendations:');
        console.log('      - Enable compression for responses');
        console.log('      - Minify CSS/JS assets');
        console.log('      - Implement client-side caching');
      }
    }
  }
}

// Main execution
(async () => {
  try {
    const results = await runBenchmarks();
    generateReport(results);
  } catch (err) {
    console.error('Benchmark error:', err.message);
    process.exit(1);
  }
})();
