// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * E2E Tests: Search Flow
 * Tests the complete search -> filter -> product detail flow
 */

test.describe('Search Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start from the search page
    await page.goto('/search');
  });

  test('search page loads successfully', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Chainhoist Database/i);

    // Check filter form is visible
    await expect(page.locator('form[action="/search"]')).toBeVisible();

    // Check results container exists (table or cards)
    const resultsContainer = page.locator('.table-responsive').or(page.locator('.mobile-cards')).or(page.locator('table'));
    await expect(resultsContainer.first()).toBeVisible();
  });

  test('can search by text query', async ({ page }) => {
    // Enter search term
    const searchInput = page.locator('input[name="q"]');
    await searchInput.fill('chain');

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Wait for results to load
    await page.waitForLoadState('networkidle');

    // URL should contain query parameter
    await expect(page).toHaveURL(/q=chain/);

    // Results should be displayed
    const resultsCount = page.locator('.pagination-info');
    await expect(resultsCount).toBeVisible();
  });

  test('can filter by manufacturer', async ({ page }) => {
    // Select a manufacturer from dropdown
    const manufacturerSelect = page.locator('select[name="manufacturer"]');
    await manufacturerSelect.selectOption({ index: 1 }); // Select first non-empty option

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Wait for results
    await page.waitForLoadState('networkidle');

    // URL should contain manufacturer parameter
    await expect(page).toHaveURL(/manufacturer=/);

    // Active filter chip should be visible
    await expect(page.locator('.filter-chip')).toBeVisible();
  });

  test('can filter by classification', async ({ page }) => {
    // Select a classification from dropdown
    const classificationSelect = page.locator('select[name="classification"]');
    const options = await classificationSelect.locator('option').count();

    if (options > 1) {
      await classificationSelect.selectOption({ index: 1 });
      await page.locator('button[type="submit"]').click();
      await page.waitForLoadState('networkidle');

      // URL should contain classification parameter
      await expect(page).toHaveURL(/classification=/);
    }
  });

  test('can remove filter using chip', async ({ page }) => {
    // First apply a filter
    const manufacturerSelect = page.locator('select[name="manufacturer"]');
    await manufacturerSelect.selectOption({ index: 1 });
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    // Click remove on filter chip
    const removeChip = page.locator('.chip-remove').first();
    if (await removeChip.isVisible()) {
      await removeChip.click();
      await page.waitForLoadState('networkidle');

      // Filter should be removed from URL
      await expect(page).not.toHaveURL(/manufacturer=/);
    }
  });

  test('clicking product row navigates to product detail', async ({ page }) => {
    // Wait for table to load
    await page.waitForSelector('.clickable-row, .product-card-mobile');

    // Click first product row/card
    const productLink = page.locator('.clickable-row a[href^="/product/"], .product-card-mobile a[href^="/product/"]').first();

    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // Should be on product page
      await expect(page).toHaveURL(/\/product\//);
    }
  });

  test('search with no results shows empty state', async ({ page }) => {
    // Search for something that won't exist
    const searchInput = page.locator('input[name="q"]');
    await searchInput.fill('xyznonexistentproduct123');
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    // Should show no results message or zero count
    const noResultsHeading = page.getByRole('heading', { name: 'No Results Found' });
    await expect(noResultsHeading).toBeVisible();
  });

  test('pagination works correctly', async ({ page }) => {
    // Wait for pagination to be visible (only if there are enough results)
    const pagination = page.locator('.pagination');

    if (await pagination.isVisible()) {
      // Click page 2 if available
      const page2Link = page.locator('.pagination .page-link:has-text("2")');

      if (await page2Link.isVisible()) {
        await page2Link.click();
        await page.waitForLoadState('networkidle');

        // URL should contain page=2
        await expect(page).toHaveURL(/page=2/);

        // Page 2 should be active
        await expect(page.locator('.pagination .page-item.active')).toContainText('2');
      }
    }
  });

  test('per page limit selector works', async ({ page }) => {
    const limitSelect = page.locator('#limitSelect');

    if (await limitSelect.isVisible()) {
      // Change to 25 per page
      await limitSelect.selectOption('25');
      await page.waitForLoadState('networkidle');

      // URL should contain limit=25
      await expect(page).toHaveURL(/limit=25/);
    }
  });
});

test.describe('Search to Product Flow', () => {
  test('complete flow: search -> filter -> view product', async ({ page }) => {
    // 1. Go to search page
    await page.goto('/search');

    // 2. Enter search query
    await page.locator('input[name="q"]').fill('chain');
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    // 3. Verify search results appear
    const resultsInfo = page.locator('.pagination-info');
    await expect(resultsInfo).toBeVisible();

    // 4. Click on first product
    const firstProductLink = page.locator('a[href^="/product/"]').first();
    await firstProductLink.click();
    await page.waitForLoadState('networkidle');

    // 5. Verify product page loaded
    await expect(page).toHaveURL(/\/product\//);

    // 6. Check product details are visible
    await expect(page.locator('.spec-card .card-header').first()).toBeVisible();

    // 7. Verify "Back to search results" link is present
    const backLink = page.locator('a:has-text("Back to search")');
    if (await backLink.isVisible()) {
      await backLink.click();
      await page.waitForLoadState('networkidle');

      // Should return to search with query preserved
      await expect(page).toHaveURL(/\/search/);
    }
  });
});
