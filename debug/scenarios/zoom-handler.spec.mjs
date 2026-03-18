/**
 * Zoom Handler CSS Transforms -- Phase 2 verification.
 *
 * Proves overlay divs receive CSS transform: scale(ratio) during zoom and
 * transforms are removed after the 1000ms settle timer. Covers:
 *
 * 1. ZOOM-03: Ctrl+scroll wheel zoom
 * 2. ZOOM-04: Toolbar zoom buttons
 * 3. ZOOM-05: Dropdown zoom percentage selection
 * 4. ZOOM-06: Fit-to-page
 * 5. ZOOM-07: Fit-to-width
 * 6. ZOOM-10: Rapid consecutive zooms (no stuck transforms)
 * 7. OVLY-02: Debug visual indicators active during Phase 2
 *
 * Tests are expected to FAIL until Plan 02 implements the CSS transform logic.
 */

import { test, expect } from '@playwright/test';

test.describe('zoom-handler', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Shared helper: query all overlay divs and return their transform state.
   */
  async function getOverlayTransforms(page) {
    return page.evaluate(() => {
      const overlays = document.querySelectorAll('[data-overlay-page]');
      return Array.from(overlays).map(div => ({
        page: div.getAttribute('data-overlay-page'),
        connected: div.isConnected,
        transform: window.getComputedStyle(div).transform,
        transformOrigin: window.getComputedStyle(div).transformOrigin,
      }));
    });
  }

  /**
   * Shared helper: navigate to test PDF and go to page 6.
   */
  async function setupPage(page) {
    // Navigate to test PDF
    await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');

    // Wait for PDF viewer to load
    await page.locator('.e-pv-viewer-container').waitFor({
      state: 'visible',
      timeout: 60_000,
    });

    // Wait for Syncfusion + PDF.js initialization
    await page.waitForTimeout(5000);

    // Navigate to page 6 (first page with annotations)
    const pageInput = page.getByRole('textbox', { name: 'Current page' });
    await expect(pageInput).toBeVisible({ timeout: 15_000 });
    await pageInput.click();
    await pageInput.fill('6');
    await pageInput.press('Enter');

    // Wait for page navigation + overlay attachment
    await page.waitForTimeout(5000);
  }

  test('overlay divs have CSS transform during ctrl+scroll zoom', async ({ page }) => {
    await setupPage(page);

    // Locate the page 6 container to target wheel events
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    await expect(pageDiv).toBeVisible({ timeout: 15_000 });

    // Get the bounding box to target the wheel event
    const box = await pageDiv.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Move mouse to center of page div
    await page.mouse.move(centerX, centerY);

    // Perform ctrl+scroll zoom (zoom in)
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');

    // Wait for transform to apply
    await page.waitForTimeout(200);

    // Verify at least one connected overlay has a CSS transform applied
    const duringZoom = await getOverlayTransforms(page);
    console.log('During ctrl+scroll zoom transforms:', JSON.stringify(duringZoom, null, 2));

    const transformedOverlays = duringZoom.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      transformedOverlays.length,
      'At least one overlay on page 6 should have CSS transform during ctrl+scroll zoom'
    ).toBeGreaterThanOrEqual(1);

    // Wait for settle timer (1000ms) + buffer
    await page.waitForTimeout(1500);

    // Verify transforms are removed after settle
    const afterSettle = await getOverlayTransforms(page);
    console.log('After settle transforms:', JSON.stringify(afterSettle, null, 2));

    const stuckOverlays = afterSettle.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      stuckOverlays.length,
      'All overlay transforms should be removed after settle'
    ).toBe(0);
  });

  test('toolbar zoom buttons apply CSS transform to overlay divs', async ({ page }) => {
    await setupPage(page);

    // Find and click the zoom-in toolbar button
    const zoomInBtn = page.locator(
      'button[id*="zoomIn"], .e-pv-zoom-in-btn, [title="Zoom in"]'
    ).first();
    await expect(zoomInBtn).toBeVisible({ timeout: 15_000 });
    await zoomInBtn.click();

    // Wait for transform to apply
    await page.waitForTimeout(200);

    // Verify at least one overlay has a transform
    const duringZoom = await getOverlayTransforms(page);
    console.log('During toolbar zoom transforms:', JSON.stringify(duringZoom, null, 2));

    const transformedOverlays = duringZoom.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      transformedOverlays.length,
      'At least one overlay should have CSS transform during toolbar zoom'
    ).toBeGreaterThanOrEqual(1);

    // Wait for settle timer + buffer
    await page.waitForTimeout(1500);

    // Verify transforms are removed after settle
    const afterSettle = await getOverlayTransforms(page);
    console.log('After settle transforms:', JSON.stringify(afterSettle, null, 2));

    const stuckOverlays = afterSettle.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      stuckOverlays.length,
      'All overlay transforms should be removed after toolbar zoom settle'
    ).toBe(0);
  });

  test('dropdown zoom applies CSS transform to overlay divs', async ({ page }) => {
    await setupPage(page);

    // Find the zoom percentage dropdown
    // Syncfusion zoom dropdown typically shows a percentage value
    const zoomDropdown = page.locator(
      '.e-pv-zoom-drop-down, [title="Zoom"], input[aria-label*="zoom"], .e-pv-zoom-drop-down-input'
    ).first();
    await expect(zoomDropdown).toBeVisible({ timeout: 15_000 });

    // Click the dropdown to open it
    await zoomDropdown.click();
    await page.waitForTimeout(500);

    // Select a different zoom level (150%)
    // Syncfusion dropdown items are typically in a popup list
    const zoomOption = page.locator('text=150%').first();
    if (await zoomOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await zoomOption.click();
    } else {
      // Fallback: try typing a zoom value directly if it's an input
      await zoomDropdown.fill('150');
      await zoomDropdown.press('Enter');
    }

    // Wait for transform to apply
    await page.waitForTimeout(200);

    // Verify at least one overlay has a transform
    const duringZoom = await getOverlayTransforms(page);
    console.log('During dropdown zoom transforms:', JSON.stringify(duringZoom, null, 2));

    const transformedOverlays = duringZoom.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      transformedOverlays.length,
      'At least one overlay should have CSS transform during dropdown zoom'
    ).toBeGreaterThanOrEqual(1);

    // Wait for settle timer + buffer
    await page.waitForTimeout(1500);

    // Verify transforms are removed after settle
    const afterSettle = await getOverlayTransforms(page);
    console.log('After settle transforms:', JSON.stringify(afterSettle, null, 2));

    const stuckOverlays = afterSettle.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      stuckOverlays.length,
      'All overlay transforms should be removed after dropdown zoom settle'
    ).toBe(0);
  });

  test('fit-to-page applies CSS transform to overlay divs', async ({ page }) => {
    await setupPage(page);

    // Find and click the fit-to-page button
    const fitPageBtn = page.locator(
      '[title="Fit to page"], button[id*="fitPage"], .e-pv-fit-page-btn'
    ).first();
    await expect(fitPageBtn).toBeVisible({ timeout: 15_000 });
    await fitPageBtn.click();

    // Wait for transform to apply
    await page.waitForTimeout(200);

    // Verify at least one overlay has a transform
    const duringZoom = await getOverlayTransforms(page);
    console.log('During fit-to-page transforms:', JSON.stringify(duringZoom, null, 2));

    const transformedOverlays = duringZoom.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      transformedOverlays.length,
      'At least one overlay should have CSS transform during fit-to-page'
    ).toBeGreaterThanOrEqual(1);

    // Wait for settle timer + buffer
    await page.waitForTimeout(1500);

    // Verify transforms are removed after settle
    const afterSettle = await getOverlayTransforms(page);
    console.log('After settle transforms:', JSON.stringify(afterSettle, null, 2));

    const stuckOverlays = afterSettle.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      stuckOverlays.length,
      'All overlay transforms should be removed after fit-to-page settle'
    ).toBe(0);
  });

  test('fit-to-width applies CSS transform to overlay divs', async ({ page }) => {
    await setupPage(page);

    // Find and click the fit-to-width button
    const fitWidthBtn = page.locator(
      '[title="Fit to width"], button[id*="fitWidth"], .e-pv-fit-width-btn'
    ).first();
    await expect(fitWidthBtn).toBeVisible({ timeout: 15_000 });
    await fitWidthBtn.click();

    // Wait for transform to apply
    await page.waitForTimeout(200);

    // Verify at least one overlay has a transform
    const duringZoom = await getOverlayTransforms(page);
    console.log('During fit-to-width transforms:', JSON.stringify(duringZoom, null, 2));

    const transformedOverlays = duringZoom.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      transformedOverlays.length,
      'At least one overlay should have CSS transform during fit-to-width'
    ).toBeGreaterThanOrEqual(1);

    // Wait for settle timer + buffer
    await page.waitForTimeout(1500);

    // Verify transforms are removed after settle
    const afterSettle = await getOverlayTransforms(page);
    console.log('After settle transforms:', JSON.stringify(afterSettle, null, 2));

    const stuckOverlays = afterSettle.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      stuckOverlays.length,
      'All overlay transforms should be removed after fit-to-width settle'
    ).toBe(0);
  });

  test('rapid consecutive zooms do not leave stuck transforms', async ({ page }) => {
    await setupPage(page);

    // Locate the page 6 container
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    await expect(pageDiv).toBeVisible({ timeout: 15_000 });

    const box = await pageDiv.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Move mouse to center of page div
    await page.mouse.move(centerX, centerY);

    // Perform 5 rapid ctrl+scroll zoom events with only 50ms between each
    await page.keyboard.down('Control');
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(50);
    }
    await page.keyboard.up('Control');

    // Wait briefly for transforms to be applied
    await page.waitForTimeout(200);

    // Verify transforms are currently applied
    const duringRapidZoom = await getOverlayTransforms(page);
    console.log('During rapid zoom transforms:', JSON.stringify(duringRapidZoom, null, 2));

    const transformedOverlays = duringRapidZoom.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      transformedOverlays.length,
      'At least one overlay should have CSS transform during rapid zoom'
    ).toBeGreaterThanOrEqual(1);

    // Wait for settle timer (1000ms from LAST zoom event) + buffer
    await page.waitForTimeout(1500);

    // Verify ALL overlay transforms are removed -- no stuck transforms
    const afterSettle = await getOverlayTransforms(page);
    console.log('After rapid zoom settle transforms:', JSON.stringify(afterSettle, null, 2));

    const stuckOverlays = afterSettle.filter(
      o => o.connected && o.transform !== 'none'
    );
    expect(
      stuckOverlays.length,
      'No overlay transforms should remain stuck after rapid zoom settle'
    ).toBe(0);

    // Verify overlays are still connected to the DOM (not detached)
    const disconnectedOverlays = afterSettle.filter(o => !o.connected);
    console.log('Disconnected overlays after rapid zoom:', disconnectedOverlays.length);

    // All overlays returned from the query should be connected
    // (disconnected ones wouldn't be found by querySelectorAll anyway)
    expect(
      afterSettle.every(o => o.connected),
      'All queried overlay divs should still be connected to the DOM after rapid zoom'
    ).toBe(true);
  });

  test('overlay divs have debug visual indicators during Phase 2', async ({ page }) => {
    await setupPage(page);

    // Verify at least one overlay div has Phase 2 debug indicators
    const indicators = await page.evaluate(() => {
      const overlays = document.querySelectorAll('[data-overlay-page]');
      return Array.from(overlays)
        .filter(div => div.isConnected)
        .map(div => {
          const computed = window.getComputedStyle(div);
          return {
            page: div.getAttribute('data-overlay-page'),
            background: computed.background,
            backgroundColor: computed.backgroundColor,
            border: computed.border,
            borderStyle: computed.borderStyle,
            borderColor: computed.borderColor,
          };
        });
    });

    console.log('Debug indicator state:', JSON.stringify(indicators, null, 2));

    expect(indicators.length, 'At least one overlay div must exist').toBeGreaterThanOrEqual(1);

    // Check that at least one overlay has the Phase 2 debug visual indicators:
    //   background containing rgba(0, 128, 255 (semi-transparent blue)
    //   border containing dashed and rgba(0, 128, 255
    const hasDebugBackground = indicators.some(
      ind =>
        ind.background.includes('rgba(0, 128, 255') ||
        ind.backgroundColor.includes('rgba(0, 128, 255')
    );
    const hasDebugBorder = indicators.some(
      ind =>
        ind.border.includes('dashed') &&
        (ind.border.includes('rgba(0, 128, 255') ||
         ind.borderColor.includes('rgba(0, 128, 255'))
    );

    expect(
      hasDebugBackground,
      'At least one overlay should have debug background rgba(0, 128, 255, ...) during Phase 2'
    ).toBe(true);
    expect(
      hasDebugBorder,
      'At least one overlay should have dashed debug border with rgba(0, 128, 255, ...) during Phase 2'
    ).toBe(true);
  });
});
