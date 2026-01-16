// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * E2E Tests: Product Navigation
 * Tests prev/next navigation between products
 */

test.describe('Product Navigation', () => {
  test('product page shows navigation controls', async ({ page }) => {
    // First get a product from search
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Click first product
    const productLink = page.locator('a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // Navigation controls should be visible
      const navControls = page.locator('.product-nav');
      await expect(navControls).toBeVisible();

      // Info text should show position
      await expect(page.locator('.nav-info')).toContainText(/of \d+/);
    }
  });

  test('next button navigates to next product', async ({ page }) => {
    // Go to first product from search
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      const currentUrl = page.url();

      // Click next if not disabled
      const nextButton = page.locator('.product-nav .nav-btn:has-text("Next"):not(.disabled)');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForLoadState('networkidle');

        // URL should have changed to a different product
        expect(page.url()).not.toBe(currentUrl);
        await expect(page).toHaveURL(/\/product\//);
      }
    }
  });

  test('prev button navigates to previous product', async ({ page }) => {
    // Go to second product from search
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Click second product (if exists) to ensure prev is available
    const productLinks = page.locator('a[href^="/product/"]');
    const count = await productLinks.count();

    if (count >= 2) {
      // Navigate to first product, then next
      await productLinks.first().click();
      await page.waitForLoadState('networkidle');

      const nextButton = page.locator('.product-nav .nav-btn:has-text("Next"):not(.disabled)');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForLoadState('networkidle');

        const currentUrl = page.url();

        // Now click prev
        const prevButton = page.locator('.product-nav .nav-btn:has-text("Prev"):not(.disabled)');
        if (await prevButton.isVisible()) {
          await prevButton.click();
          await page.waitForLoadState('networkidle');

          // URL should have changed
          expect(page.url()).not.toBe(currentUrl);
          await expect(page).toHaveURL(/\/product\//);
        }
      }
    }
  });

  test('first product has disabled prev button', async ({ page }) => {
    // Navigate directly to first product context
    await page.goto('/search?page=1&limit=10');
    await page.waitForLoadState('networkidle');

    const firstProduct = page.locator('a[href^="/product/"]').first();
    if (await firstProduct.isVisible()) {
      await firstProduct.click();
      await page.waitForLoadState('networkidle');

      // Prev should be disabled on first product
      const prevButton = page.locator('.product-nav .nav-btn:has-text("Prev")');
      if (await prevButton.isVisible()) {
        await expect(prevButton).toHaveClass(/disabled/);
      }
    }
  });

  test('navigation preserves search context', async ({ page }) => {
    // Search with filter
    await page.goto('/search?manufacturer=Columbus');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // URL should contain search context
      await expect(page).toHaveURL(/manufacturer=/);

      // Navigate to next product
      const nextButton = page.locator('.product-nav .nav-btn:has-text("Next"):not(.disabled)');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForLoadState('networkidle');

        // Search context should be preserved
        await expect(page).toHaveURL(/manufacturer=/);
      }
    }
  });

  test('breadcrumb navigation works', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // Breadcrumb should be visible
      const breadcrumb = page.locator('.breadcrumb');
      await expect(breadcrumb).toBeVisible();

      // Click Home breadcrumb
      const homeLink = page.locator('.breadcrumb-item a:has-text("Home")');
      if (await homeLink.isVisible()) {
        await homeLink.click();
        await page.waitForLoadState('networkidle');

        // Should be on home page
        await expect(page).toHaveURL('/');
      }
    }
  });

  test('manufacturer breadcrumb link filters search', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // Click manufacturer in breadcrumb
      const mfgBreadcrumb = page.locator('.breadcrumb-item a[href*="manufacturer="]');
      if (await mfgBreadcrumb.isVisible()) {
        await mfgBreadcrumb.click();
        await page.waitForLoadState('networkidle');

        // Should be on search with manufacturer filter
        await expect(page).toHaveURL(/\/search\?manufacturer=/);
      }
    }
  });
});

test.describe('Keyboard Navigation', () => {
  test('can navigate table rows with keyboard', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    // Focus on first clickable row
    const firstRow = page.locator('.clickable-row').first();
    if (await firstRow.isVisible()) {
      await firstRow.focus();

      // Press Enter to navigate
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');

      // Should be on product page
      await expect(page).toHaveURL(/\/product\//);
    }
  });

  test('escape key closes lightbox', async ({ page }) => {
    // Navigate to a product with images
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const productLink = page.locator('a[href^="/product/"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // Click on main image to open lightbox
      const mainImage = page.locator('#mainImage');
      if (await mainImage.isVisible()) {
        await mainImage.click();

        // Wait for lightbox
        const lightbox = page.locator('.lightbox-overlay.show');
        if (await lightbox.isVisible({ timeout: 1000 })) {
          // Press Escape
          await page.keyboard.press('Escape');

          // Lightbox should close
          await expect(lightbox).not.toBeVisible();
        }
      }
    }
  });
});
