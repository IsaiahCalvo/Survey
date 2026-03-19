/**
 * Render Loop Rewrite -- Phase 3 verification.
 *
 * Tests are expected to FAIL until Plan 02 rewrites the render loop.
 * The current code still uses stableLiveRoot as the portal target, so
 * Test 4 (portal target verification) will fail.
 *
 * Covers:
 * 1. ZOOM-01: Annotations stay visible during ctrl+scroll zoom
 * 2. ZOOM-01: Annotations stay visible during toolbar zoom
 * 3. ZOOM-02: Annotations positioned correctly -- no jump or snap
 * 4. Portal target verification: portals target overlay divs, not old stable-live-root
 * 5. Bounded portal creation: portals only created for pages with annotations/regions
 */

import { test, expect } from '@playwright/test';

test.describe('render-loop', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Shared helper: navigate to test PDF and go to page 6.
   * Copied from zoom-handler.spec.mjs for consistency.
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

  test('annotations stay visible during ctrl+scroll zoom', async ({ page }) => {
    await setupPage(page);

    // Locate the page 6 container to target wheel events
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    await expect(pageDiv).toBeVisible({ timeout: 15_000 });

    // Get the bounding box to target the wheel event at center
    const box = await pageDiv.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Move mouse to center of page div
    await page.mouse.move(centerX, centerY);

    // Perform ctrl+scroll zoom (zoom in)
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');

    // Wait 500ms (mid-zoom) then check annotations are visible
    await page.waitForTimeout(500);

    // Verify overlay div for page 6 has children (portal content rendered)
    const midZoomState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return { exists: false, childCount: 0, connected: false };
      return {
        exists: true,
        childCount: overlayDiv.children.length,
        connected: overlayDiv.isConnected,
      };
    });

    console.log('Mid-zoom overlay state:', JSON.stringify(midZoomState, null, 2));

    expect(
      midZoomState.exists,
      'Overlay div for page 6 must exist during zoom'
    ).toBe(true);
    expect(
      midZoomState.childCount,
      'Overlay div must have children (portal content) during zoom -- annotations should never disappear'
    ).toBeGreaterThan(0);

    // Wait 2000ms for settle, then verify overlay div still has children
    await page.waitForTimeout(2000);

    const afterSettleState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return { exists: false, childCount: 0, connected: false };
      return {
        exists: true,
        childCount: overlayDiv.children.length,
        connected: overlayDiv.isConnected,
      };
    });

    console.log('After settle overlay state:', JSON.stringify(afterSettleState, null, 2));

    expect(
      afterSettleState.exists,
      'Overlay div for page 6 must exist after settle'
    ).toBe(true);
    expect(
      afterSettleState.childCount,
      'Overlay div must still have children (portal content) after settle'
    ).toBeGreaterThan(0);
  });

  test('annotations stay visible during toolbar zoom', async ({ page }) => {
    await setupPage(page);

    // Try multiple selectors for the zoom-in button (Syncfusion built-in or custom toolbar)
    const zoomInBtnById = page.locator('button#e-pv-zoom-in-btn');
    const zoomInBtnByClass = page.locator('.e-pv-zoom-in-btn');

    // The app uses a custom zoom toolbar. Zoom controls are grouped near the
    // zoom percentage input. The zoom-in button is the second btn-icon button
    // in the flex container that holds zoom controls.
    const zoomInput = page.locator('input[aria-label="Zoom percentage"]');
    const zoomContainer = zoomInput.locator(
      'xpath=ancestor::div[.//button[contains(@class,"btn-icon")]]'
    ).last();
    const zoomInBtnCustom = zoomContainer.locator('button.btn-icon').nth(1);

    // Try each selector, click whichever is visible
    let clicked = false;
    for (const btn of [zoomInBtnById, zoomInBtnByClass, zoomInBtnCustom]) {
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    expect(clicked, 'At least one zoom-in button selector must be visible').toBe(true);

    // Wait 500ms then check annotations are visible
    await page.waitForTimeout(500);

    const midZoomState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return { exists: false, childCount: 0 };
      return {
        exists: true,
        childCount: overlayDiv.children.length,
      };
    });

    console.log('Mid toolbar zoom overlay state:', JSON.stringify(midZoomState, null, 2));

    expect(
      midZoomState.exists,
      'Overlay div for page 6 must exist during toolbar zoom'
    ).toBe(true);
    expect(
      midZoomState.childCount,
      'Overlay div must have children (portal content) during toolbar zoom'
    ).toBeGreaterThan(0);

    // Wait 2000ms for settle, verify overlay div still has children
    await page.waitForTimeout(2000);

    const afterSettleState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return { exists: false, childCount: 0 };
      return {
        exists: true,
        childCount: overlayDiv.children.length,
      };
    });

    console.log('After toolbar zoom settle overlay state:', JSON.stringify(afterSettleState, null, 2));

    expect(
      afterSettleState.exists,
      'Overlay div for page 6 must exist after toolbar zoom settle'
    ).toBe(true);
    expect(
      afterSettleState.childCount,
      'Overlay div must still have children after toolbar zoom settle'
    ).toBeGreaterThan(0);
  });

  test('annotations positioned correctly -- no jump or snap', async ({ page }) => {
    await setupPage(page);

    // Locate the page 6 container
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    await expect(pageDiv).toBeVisible({ timeout: 15_000 });

    /**
     * Helper: capture the position of the first child inside the overlay div
     * relative to the overlay div itself.
     */
    async function captureOverlayChildPosition() {
      return page.evaluate(() => {
        const overlayDiv = document.querySelector('[data-overlay-page="6"]');
        if (!overlayDiv || overlayDiv.children.length === 0) {
          return null;
        }
        const overlayRect = overlayDiv.getBoundingClientRect();
        const childRect = overlayDiv.children[0].getBoundingClientRect();
        return {
          top: childRect.top - overlayRect.top,
          left: childRect.left - overlayRect.left,
        };
      });
    }

    // Before zoom: capture baseline position
    const beforeZoom = await captureOverlayChildPosition();
    console.log('Before zoom position:', JSON.stringify(beforeZoom, null, 2));

    // Perform ctrl+scroll zoom in
    const box = await pageDiv.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');

    // Wait 500ms (mid-zoom): capture position
    await page.waitForTimeout(500);
    const midZoom = await captureOverlayChildPosition();
    console.log('Mid-zoom position:', JSON.stringify(midZoom, null, 2));

    // Wait 2000ms for settle: capture position
    await page.waitForTimeout(2000);
    const afterSettle = await captureOverlayChildPosition();
    console.log('After settle position:', JSON.stringify(afterSettle, null, 2));

    // All three captures must be non-null (content exists at all points)
    expect(beforeZoom, 'Overlay child must exist before zoom').not.toBeNull();
    expect(midZoom, 'Overlay child must exist mid-zoom').not.toBeNull();
    expect(afterSettle, 'Overlay child must exist after settle').not.toBeNull();

    // Position should be at top:0, left:0 relative to overlay div at all points.
    // CSS transform handles scaling -- position stays fixed.
    // During mid-zoom, CSS transform scale() on the overlay div causes
    // getBoundingClientRect() to report slightly different values (the transform
    // scales the bounding box). Allow 3px tolerance for mid-zoom phases and 1px
    // for the final settle comparison.
    const midZoomTolerance = 3;
    const settleTolerance = 1;

    // Before -> mid-zoom: allow CSS transform offset
    expect(
      Math.abs(midZoom.top - beforeZoom.top),
      `Top position delta (before -> mid-zoom) should be < ${midZoomTolerance}px, got ${Math.abs(midZoom.top - beforeZoom.top)}px`
    ).toBeLessThanOrEqual(midZoomTolerance);
    expect(
      Math.abs(midZoom.left - beforeZoom.left),
      `Left position delta (before -> mid-zoom) should be < ${midZoomTolerance}px, got ${Math.abs(midZoom.left - beforeZoom.left)}px`
    ).toBeLessThanOrEqual(midZoomTolerance);

    // Mid-zoom -> after settle: allow CSS transform offset
    expect(
      Math.abs(afterSettle.top - midZoom.top),
      `Top position delta (mid-zoom -> settle) should be < ${midZoomTolerance}px, got ${Math.abs(afterSettle.top - midZoom.top)}px`
    ).toBeLessThanOrEqual(midZoomTolerance);
    expect(
      Math.abs(afterSettle.left - midZoom.left),
      `Left position delta (mid-zoom -> settle) should be < ${midZoomTolerance}px, got ${Math.abs(afterSettle.left - midZoom.left)}px`
    ).toBeLessThanOrEqual(midZoomTolerance);

    // Before -> after settle: no net displacement (strict)
    expect(
      Math.abs(afterSettle.top - beforeZoom.top),
      `Top position delta (before -> settle) should be < ${settleTolerance}px, got ${Math.abs(afterSettle.top - beforeZoom.top)}px`
    ).toBeLessThanOrEqual(settleTolerance);
    expect(
      Math.abs(afterSettle.left - beforeZoom.left),
      `Left position delta (before -> settle) should be < ${settleTolerance}px, got ${Math.abs(afterSettle.left - beforeZoom.left)}px`
    ).toBeLessThanOrEqual(settleTolerance);
  });

  test('portals target overlay divs not old stable-live-root', async ({ page }) => {
    await setupPage(page);

    const portalTargetState = await page.evaluate(() => {
      // Check overlay divs have React-rendered content
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      const overlayHasContent = overlayDiv ? overlayDiv.children.length > 0 : false;
      const overlayChildCount = overlayDiv ? overlayDiv.children.length : 0;

      // Check old stable-live-root divs do NOT have React-rendered annotation content
      const stableLiveRoots = document.querySelectorAll('[data-stable-live-root]');
      const stableLiveRootResults = Array.from(stableLiveRoots).map(div => ({
        connected: div.isConnected,
        childCount: div.children.length,
        hasContent: div.children.length > 0,
      }));

      // Old system: stable-live-root divs should NOT have content
      // (they should either not exist or be empty)
      const anyStableLiveRootHasContent = stableLiveRootResults.some(r => r.hasContent);

      return {
        overlayExists: !!overlayDiv,
        overlayHasContent,
        overlayChildCount,
        stableLiveRootCount: stableLiveRoots.length,
        stableLiveRootResults,
        anyStableLiveRootHasContent,
      };
    });

    console.log('Portal target state:', JSON.stringify(portalTargetState, null, 2));

    // Overlay divs must have content (portals render here)
    expect(
      portalTargetState.overlayExists,
      'Overlay div for page 6 must exist'
    ).toBe(true);
    expect(
      portalTargetState.overlayHasContent,
      'Overlay div for page 6 must have React-rendered content (portal children)'
    ).toBe(true);

    // Old stable-live-root divs should NOT have content
    // (they should either not exist or be empty after render loop rewrite)
    expect(
      portalTargetState.anyStableLiveRootHasContent,
      'Old stable-live-root divs should NOT have React-rendered annotation content -- portals should target overlay divs instead'
    ).toBe(false);
  });

  test('portals only created for pages with annotations or regions', async ({ page }) => {
    await setupPage(page);

    const portalDistribution = await page.evaluate(() => {
      const allOverlays = document.querySelectorAll('[data-overlay-page]');
      const results = Array.from(allOverlays).map(div => ({
        page: div.getAttribute('data-overlay-page'),
        connected: div.isConnected,
        childCount: div.children.length,
        hasContent: div.children.length > 0,
      }));

      const withContent = results.filter(r => r.hasContent);
      const withoutContent = results.filter(r => !r.hasContent);

      return {
        totalOverlays: results.length,
        withContentCount: withContent.length,
        withoutContentCount: withoutContent.length,
        pagesWithContent: withContent.map(r => r.page),
        pagesWithoutContent: withoutContent.map(r => r.page),
        allResults: results,
      };
    });

    console.log('Portal distribution:', JSON.stringify(portalDistribution, null, 2));

    // Page 6 (which has annotations) should have portal content
    expect(
      portalDistribution.pagesWithContent,
      'Page 6 (annotated page) must have portal content'
    ).toContain('6');

    // At least one overlay div should have content (page 6)
    expect(
      portalDistribution.withContentCount,
      'At least one overlay div should have portal content'
    ).toBeGreaterThanOrEqual(1);

    // NOT ALL overlay divs should have content -- pages without annotations
    // should have empty overlay divs (no unbounded portal creation)
    expect(
      portalDistribution.withoutContentCount,
      'Some overlay divs should be empty (pages without annotations) -- proves portals are not created for every page'
    ).toBeGreaterThanOrEqual(1);

    // Total overlays with content should be less than total overlays
    // (proves the filter is working -- not every page gets a portal)
    expect(
      portalDistribution.withContentCount,
      'Pages with portal content should be fewer than total overlay divs'
    ).toBeLessThan(portalDistribution.totalOverlays);
  });
});
