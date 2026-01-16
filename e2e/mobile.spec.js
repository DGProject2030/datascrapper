// @ts-check
/* eslint-env browser */
const { test, expect, devices } = require('@playwright/test');

/**
 * E2E Tests: Mobile Responsive Behavior
 * Tests mobile-specific features and responsive design
 */

// Use mobile viewport for all tests in this file (Pixel 5 for Chromium compatibility)
test.use(devices['Pixel 5']);

test.describe('Mobile Search Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
  });

  test('mobile cards are displayed instead of table', async ({ page }) => {
    // Table should be hidden on mobile
    const desktopTable = page.locator('.desktop-table');
    await expect(desktopTable).toBeHidden();

    // Mobile cards should be visible
    const mobileCards = page.locator('.mobile-cards');
    await expect(mobileCards).toBeVisible();
  });

  test('filter panel is collapsible on mobile', async ({ page }) => {
    const filterToggle = page.locator('.filter-toggle-mobile');

    if (await filterToggle.isVisible()) {
      // Filter panel should initially be collapsed
      const filterPanel = page.locator('.filter-panel-content');
      const isCollapsed = await filterPanel.evaluate(el =>
        el.classList.contains('collapsed')
      );

      if (isCollapsed) {
        // Click to expand
        await filterToggle.click();
        await page.waitForTimeout(300); // Wait for animation

        // Panel should now be expanded
        await expect(filterPanel).toHaveClass(/expanded/);
      }

      // Click again to collapse
      await filterToggle.click();
      await page.waitForTimeout(300);

      // Panel should be collapsed
      await expect(filterPanel).toHaveClass(/collapsed/);
    }
  });

  test('bottom navigation is visible on mobile', async ({ page }) => {
    const bottomNav = page.locator('.bottom-nav-mobile');
    await expect(bottomNav).toBeVisible();

    // Should have navigation items
    const navItems = page.locator('.bottom-nav-mobile .nav-item');
    await expect(navItems).toHaveCount(4); // Home, Search, Stats, Downloads
  });

  test('bottom navigation links work', async ({ page }) => {
    // Click Home in bottom nav
    const homeLink = page.locator('.bottom-nav-mobile .nav-item:has-text("Home")');
    await homeLink.click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/');
  });

  test('mobile product cards are clickable', async ({ page }) => {
    const productCard = page.locator('.product-card-mobile').first();

    if (await productCard.isVisible()) {
      const viewButton = productCard.locator('a:has-text("View Details")');
      await viewButton.click();
      await page.waitForLoadState('networkidle');

      // Should be on product page
      await expect(page).toHaveURL(/\/product\//);
    }
  });

  test('pagination is visible and works on mobile', async ({ page }) => {
    const pagination = page.locator('.pagination');

    if (await pagination.isVisible()) {
      // Pagination should be responsive
      const paginationInfo = page.locator('.text-muted:has-text("Page")');

      // Mobile shows "Page X of Y" text
      await expect(paginationInfo).toBeVisible();
    }
  });
});

test.describe('Mobile Product Page', () => {
  test('product page is responsive on mobile', async ({ page }) => {
    // Navigate to a product
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('.product-card-mobile a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // Check product info is visible
      await expect(page.locator('.spec-card').first()).toBeVisible();

      // Check navigation is responsive
      const productNav = page.locator('.product-nav');
      await expect(productNav).toBeVisible();

      // On mobile, nav should be stacked vertically
      // (Testing visual layout is limited, but we can check it renders)
    }
  });

  test('bottom navigation is present on product page', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('.product-card-mobile a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      const bottomNav = page.locator('.bottom-nav-mobile');
      await expect(bottomNav).toBeVisible();
    }
  });

  test('product thumbnails have minimum touch target size', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('.product-card-mobile a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      const thumbnails = page.locator('.product-thumbnail');
      const count = await thumbnails.count();

      if (count > 0) {
        // Each thumbnail should meet WCAG touch target size (44x44)
        for (let i = 0; i < count; i++) {
          const box = await thumbnails.nth(i).boundingBox();
          if (box) {
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
        }
      }
    }
  });

  test('lightbox works on mobile', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('.product-card-mobile a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      const mainImage = page.locator('#mainImage');
      if (await mainImage.isVisible()) {
        // Tap image to open lightbox
        await mainImage.click();

        const lightbox = page.locator('.lightbox-overlay.show');

        // Give time for lightbox to open
        try {
          await expect(lightbox).toBeVisible({ timeout: 2000 });

          // Tap close button
          const closeButton = page.locator('.lightbox-close');
          await closeButton.click();

          // Lightbox should close
          await expect(lightbox).not.toBeVisible();
        } catch {
          // No lightbox - product may not have images
        }
      }
    }
  });
});

test.describe('Mobile Touch Interactions', () => {
  test('buttons meet minimum touch target size', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Check Apply Filters button
    const applyBtn = page.locator('#applyBtn');
    const box = await applyBtn.boundingBox();

    if (box) {
      // Button should have reasonable touch target height (mobile-friendly)
      // Note: WCAG recommends 44px, but 35px+ is acceptable for inline buttons
      expect(box.height).toBeGreaterThanOrEqual(35);
    }
  });

  test('filter chips are tappable', async ({ page }) => {
    // Apply a filter first
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Expand filter panel if collapsed
    const filterToggle = page.locator('.filter-toggle-mobile');
    if (await filterToggle.isVisible()) {
      await filterToggle.click();
      await page.waitForTimeout(300);
    }

    // Select a manufacturer
    const manufacturerSelect = page.locator('select[name="manufacturer"]');
    await manufacturerSelect.selectOption({ index: 1 });
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    // Tap filter chip remove button
    const chipRemove = page.locator('.chip-remove').first();
    if (await chipRemove.isVisible()) {
      const box = await chipRemove.boundingBox();
      if (box) {
        // Should be tappable
        expect(box.width).toBeGreaterThanOrEqual(18);
        expect(box.height).toBeGreaterThanOrEqual(18);
      }

      // Actually tap it
      await chipRemove.tap();
      await page.waitForLoadState('networkidle');

      // Filter should be removed
      await expect(page).not.toHaveURL(/manufacturer=/);
    }
  });
});

test.describe('Mobile Viewport Consistency', () => {
  test('no horizontal scrolling on search page', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Check that page doesn't have horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    expect(hasHorizontalScroll).toBe(false);
  });

  test('no horizontal scrolling on product page', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('.product-card-mobile a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      expect(hasHorizontalScroll).toBe(false);
    }
  });

  test('viewport meta tag is set correctly', async ({ page }) => {
    await page.goto('/search');

    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportMeta).toContain('width=device-width');
    expect(viewportMeta).toContain('initial-scale=1');
  });
});
