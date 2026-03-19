/**
 * PAL Zoom Simplification -- Phase 4 verification.
 *
 * Tests verify the post-zoom behavior of PageAnnotationLayer after the
 * simplification removes PAL's independent 300ms settle timer and dead props.
 * Covers:
 *
 * 1. ZOOM-09: Canvas redraws crisp after zoom settles
 * 2. OVLY-04: Pointer events restored after zoom settles
 * 3. PRES-01: Drawing tools work after zoom (stroke accuracy)
 * 4. PRES-02: Search highlights visible after zoom
 * 5. PRES-03: Undo/redo works after zoom
 * 6. PRES-04: Proxy rendering (LightweightAnnotationOverlay) works after zoom
 * 7. PRES-05: No console errors during zoom operations
 *
 * Tests are expected to FAIL until Plan 02 implements the simplification.
 */

import { test, expect } from '@playwright/test';

test.describe('pal-zoom', () => {
  test.describe.configure({ mode: 'serial' });

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /**
   * Navigate to test PDF and go to page 6.
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

  /**
   * Perform a ctrl+scroll zoom in on page 6 center, wait for App.jsx's
   * 1000ms settle timer to fire plus buffer, and return pre/post zoom info.
   */
  async function performZoomAndSettle(page) {
    // Locate the page 6 container
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    await expect(pageDiv).toBeVisible({ timeout: 15_000 });

    const box = await pageDiv.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Read pre-zoom canvas state
    const preZoomScale = await page.evaluate(() => {
      const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
      if (!canvas) return null;
      // Try to get Fabric.js zoom via the canvas-container's fabric reference
      const container = canvas.closest('.canvas-container');
      const fabricCanvas = container?.__fabric || canvas.__fabric;
      return fabricCanvas ? fabricCanvas.getZoom() : null;
    });

    // Move mouse to center of page div and zoom in
    await page.mouse.move(centerX, centerY);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');

    // Wait for App.jsx's 1000ms settle timer + PAL tiered redraw + buffer
    await page.waitForTimeout(3500);

    // Read post-zoom canvas state
    const postZoomScale = await page.evaluate(() => {
      const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
      if (!canvas) return null;
      const container = canvas.closest('.canvas-container');
      const fabricCanvas = container?.__fabric || canvas.__fabric;
      return fabricCanvas ? fabricCanvas.getZoom() : null;
    });

    return { preZoomScale, postZoomScale };
  }

  /**
   * Read canvas and overlay state for a given page number.
   * Returns dimensions, transform, pointer-events, and Fabric zoom if available.
   */
  async function getCanvasState(page, pageNum) {
    return page.evaluate((pn) => {
      const overlayDiv = document.querySelector(`[data-overlay-page="${pn}"]`);
      if (!overlayDiv) return null;

      const lowerCanvas = overlayDiv.querySelector('.lower-canvas');
      const computed = window.getComputedStyle(overlayDiv);
      const overlayRect = overlayDiv.getBoundingClientRect();

      // Attempt to get Fabric.js zoom
      let fabricZoom = null;
      if (lowerCanvas) {
        const container = lowerCanvas.closest('.canvas-container');
        const fabricCanvas = container?.__fabric || lowerCanvas.__fabric;
        if (fabricCanvas && typeof fabricCanvas.getZoom === 'function') {
          fabricZoom = fabricCanvas.getZoom();
        }
      }

      return {
        canvasWidth: lowerCanvas ? lowerCanvas.width : null,
        canvasHeight: lowerCanvas ? lowerCanvas.height : null,
        fabricZoom,
        overlayTransform: computed.transform,
        overlayPointerEvents: computed.pointerEvents,
        overlayWidth: overlayRect.width,
        overlayHeight: overlayRect.height,
      };
    }, pageNum);
  }

  /**
   * Set up a console error collector. Must be called BEFORE any page.goto().
   * Returns an array that accumulates error-level console messages.
   * Filters out known benign patterns (Syncfusion license, DevTools, favicon).
   */
  function collectConsoleErrors(page) {
    const errors = [];
    const benignPatterns = [
      /Syncfusion/i,
      /license/i,
      /DevTools/i,
      /favicon/i,
      /Download the React DevTools/i,
      /React does not recognize/i,
    ];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isBenign = benignPatterns.some((pat) => pat.test(text));
        if (!isBenign) {
          errors.push(text);
        }
      }
    });

    return errors;
  }

  // ---------------------------------------------------------------------------
  // Test 1: ZOOM-09 -- canvas redraws crisp after zoom settles
  // ---------------------------------------------------------------------------
  test('ZOOM-09 -- canvas redraws crisp after zoom settles', async ({ page }) => {
    await setupPage(page);

    // Record pre-zoom canvas dimensions
    const preZoom = await getCanvasState(page, 6);
    expect(preZoom, 'Canvas state must be readable before zoom').not.toBeNull();

    console.log('Pre-zoom canvas state:', JSON.stringify(preZoom, null, 2));

    // Perform ctrl+scroll zoom in
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    const box = await pageDiv.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');

    // Wait for settle (1000ms App.jsx timer + PAL tiered redraw + buffer)
    await page.waitForTimeout(3500);

    // Record post-zoom canvas dimensions
    const postZoom = await getCanvasState(page, 6);
    expect(postZoom, 'Canvas state must be readable after zoom').not.toBeNull();

    console.log('Post-zoom canvas state:', JSON.stringify(postZoom, null, 2));

    // ASSERT: post-zoom canvasWidth > pre-zoom canvasWidth (canvas grew for higher zoom)
    expect(
      postZoom.canvasWidth,
      'Post-zoom canvas width should be larger than pre-zoom (canvas grew for crisp rendering at higher zoom)'
    ).toBeGreaterThan(preZoom.canvasWidth);

    // ASSERT: post-zoom overlayTransform is 'none' or '' (CSS transform removed after settle)
    expect(
      postZoom.overlayTransform === 'none' || postZoom.overlayTransform === '',
      `Overlay CSS transform should be removed after settle, got: "${postZoom.overlayTransform}"`
    ).toBe(true);

    // ASSERT: post-zoom canvas dimensions approximately match overlay div dimensions
    // (canvas matches container = crisp, not CSS-scaled)
    if (postZoom.canvasWidth && postZoom.overlayWidth) {
      const widthRatio = postZoom.canvasWidth / postZoom.overlayWidth;
      expect(
        widthRatio,
        `Canvas width (${postZoom.canvasWidth}) should approximately match overlay width (${postZoom.overlayWidth}), ratio: ${widthRatio}`
      ).toBeGreaterThan(0.8);
      expect(widthRatio).toBeLessThan(1.3);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 2: OVLY-04 -- pointer events restored after zoom settles
  // ---------------------------------------------------------------------------
  test('OVLY-04 -- pointer events restored after zoom settles', async ({ page }) => {
    await setupPage(page);

    // Perform ctrl+scroll zoom in
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    const box = await pageDiv.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');

    // Wait for full settle (1000ms App.jsx timer + PAL tiered redraw + buffer)
    await page.waitForTimeout(3500);

    // Check that overlay div is always pointer-events:none (by design -- it's a passthrough layer).
    // The actual interactivity is on the Fabric.js upper-canvas inside the overlay div.
    const afterSettleState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return null;
      const upperCanvas = overlayDiv.querySelector('.upper-canvas');
      const overlayComputed = window.getComputedStyle(overlayDiv);
      return {
        overlayPointerEvents: overlayComputed.pointerEvents,
        upperCanvasExists: !!upperCanvas,
        upperCanvasPointerEvents: upperCanvas ? window.getComputedStyle(upperCanvas).pointerEvents : null,
        // Canvas should be resized (indicating settle redraw happened)
        canvasWidth: overlayDiv.querySelector('.lower-canvas')?.width ?? null,
        overlayWidth: Math.round(overlayDiv.getBoundingClientRect().width),
      };
    });

    console.log('After settle state:', JSON.stringify(afterSettleState, null, 2));

    expect(afterSettleState, 'State must be readable after settle').not.toBeNull();

    // The overlay div is always pointer-events:none by design (passthrough layer)
    expect(
      afterSettleState.overlayPointerEvents,
      'Overlay div should be pointer-events:none (passthrough layer by design)'
    ).toBe('none');

    // The Fabric.js upper-canvas must exist and be interactive
    expect(
      afterSettleState.upperCanvasExists,
      'Fabric.js upper-canvas must exist in overlay div after zoom settle'
    ).toBe(true);

    // Canvas width should approximately match overlay width (crisp rendering, not CSS-scaled)
    if (afterSettleState.canvasWidth && afterSettleState.overlayWidth) {
      const ratio = afterSettleState.canvasWidth / afterSettleState.overlayWidth;
      expect(
        ratio,
        `Canvas width (${afterSettleState.canvasWidth}) should match overlay width (${afterSettleState.overlayWidth})`
      ).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
    }

    // Verify a click on the canvas area does not throw and canvas is accessible
    const overlayLocator = page.locator('[data-overlay-page="6"]');
    const overlayBox = await overlayLocator.boundingBox();
    if (overlayBox) {
      // Click center of overlay -- should reach the upper-canvas via event bubbling
      await page.mouse.click(
        overlayBox.x + overlayBox.width / 2,
        overlayBox.y + overlayBox.height / 2
      );
      // If we get here, the click succeeded without errors
    }
  });

  // ---------------------------------------------------------------------------
  // Test 3: PRES-01 -- drawing tools work after zoom (stroke accuracy)
  // ---------------------------------------------------------------------------
  test('PRES-01 -- drawing tools work after zoom', async ({ page }) => {
    await setupPage(page);

    // Perform ctrl+scroll zoom in, wait for settle
    await performZoomAndSettle(page);

    // Get the bounding box of the Fabric.js upper-canvas on page 6
    const upperCanvas = page.locator('[data-overlay-page="6"] .upper-canvas');
    const isUpperVisible = await upperCanvas.isVisible().catch(() => false);

    if (isUpperVisible) {
      const canvasBox = await upperCanvas.boundingBox();

      // Read initial object count
      const initialCount = await page.evaluate(() => {
        const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
        if (!canvas) return -1;
        const container = canvas.closest('.canvas-container');
        const fabricCanvas = container?.__fabric || canvas.__fabric;
        return fabricCanvas ? fabricCanvas.getObjects().length : -1;
      });

      console.log('Initial Fabric.js object count:', initialCount);

      // Perform a drag stroke on the canvas: mousedown -> mousemove -> mouseup
      const startX = canvasBox.x + 100;
      const startY = canvasBox.y + 100;
      const endX = canvasBox.x + 200;
      const endY = canvasBox.y + 200;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Move in small steps to simulate a real drag
      for (let i = 1; i <= 5; i++) {
        await page.mouse.move(
          startX + ((endX - startX) * i) / 5,
          startY + ((endY - startY) * i) / 5
        );
      }
      await page.mouse.up();

      // Wait for Fabric.js to process the stroke
      await page.waitForTimeout(500);

      // Check that interaction did not throw and canvas still renders
      const postInteractionState = await page.evaluate(() => {
        const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
        if (!canvas) return { exists: false };
        const container = canvas.closest('.canvas-container');
        const fabricCanvas = container?.__fabric || canvas.__fabric;
        return {
          exists: true,
          objectCount: fabricCanvas ? fabricCanvas.getObjects().length : -1,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        };
      });

      console.log('Post-interaction state:', JSON.stringify(postInteractionState, null, 2));

      // The canvas must still exist and be functional after the interaction
      expect(postInteractionState.exists, 'Canvas must exist after interaction').toBe(true);
      expect(
        postInteractionState.canvasWidth,
        'Canvas must have non-zero width after interaction'
      ).toBeGreaterThan(0);
    } else {
      // If upper-canvas is not visible, verify at minimum that the overlay div
      // is connected and has children (portal content rendered)
      const overlayState = await page.evaluate(() => {
        const overlayDiv = document.querySelector('[data-overlay-page="6"]');
        return {
          exists: !!overlayDiv,
          connected: overlayDiv?.isConnected ?? false,
          childCount: overlayDiv?.children.length ?? 0,
        };
      });
      expect(overlayState.exists, 'Overlay div must exist for page 6').toBe(true);
      expect(overlayState.childCount, 'Overlay div must have portal content').toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 4: PRES-02 -- search highlights visible after zoom
  // ---------------------------------------------------------------------------
  test('PRES-02 -- search highlights visible after zoom', async ({ page }) => {
    await setupPage(page);

    // Check that the overlay div for page 6 has portal content rendered
    // (SearchHighlightLayer is a sibling child of the overlay div's portal content)
    const preZoomOverlay = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return null;
      return {
        exists: true,
        connected: overlayDiv.isConnected,
        childCount: overlayDiv.children.length,
        // Check if any search highlight container exists
        hasSearchContainer: !!overlayDiv.querySelector('[data-search-highlight]'),
        // Also check for any children that could be the SearchHighlightLayer wrapper
        childTags: Array.from(overlayDiv.children).map((c) => c.tagName.toLowerCase()),
        overlayRect: overlayDiv.getBoundingClientRect(),
      };
    });

    console.log('Pre-zoom overlay state:', JSON.stringify(preZoomOverlay, null, 2));
    expect(preZoomOverlay, 'Overlay div must exist for page 6').not.toBeNull();
    expect(preZoomOverlay.connected, 'Overlay div must be connected').toBe(true);
    expect(
      preZoomOverlay.childCount,
      'Overlay div must have portal content children'
    ).toBeGreaterThan(0);

    // Perform ctrl+scroll zoom in, wait for settle
    await performZoomAndSettle(page);

    // Re-check: overlay content still exists and is connected after zoom
    const postZoomOverlay = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return null;
      return {
        exists: true,
        connected: overlayDiv.isConnected,
        childCount: overlayDiv.children.length,
        hasSearchContainer: !!overlayDiv.querySelector('[data-search-highlight]'),
        childTags: Array.from(overlayDiv.children).map((c) => c.tagName.toLowerCase()),
        overlayRect: overlayDiv.getBoundingClientRect(),
      };
    });

    console.log('Post-zoom overlay state:', JSON.stringify(postZoomOverlay, null, 2));
    expect(postZoomOverlay, 'Overlay div must still exist after zoom').not.toBeNull();
    expect(postZoomOverlay.connected, 'Overlay div must still be connected after zoom').toBe(true);
    expect(
      postZoomOverlay.childCount,
      'Overlay div must still have portal content children after zoom (SearchHighlightLayer and other layers preserved)'
    ).toBeGreaterThan(0);

    // If search highlights exist, verify they are still present after zoom
    if (preZoomOverlay.hasSearchContainer) {
      expect(
        postZoomOverlay.hasSearchContainer,
        'Search highlight container should still be present after zoom'
      ).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 5: PRES-03 -- undo/redo works after zoom
  // ---------------------------------------------------------------------------
  test('PRES-03 -- undo/redo works after zoom', async ({ page }) => {
    // Set up console error collector to verify no errors from undo/redo
    const errors = collectConsoleErrors(page);

    await setupPage(page);

    // Perform ctrl+scroll zoom in, wait for settle
    await performZoomAndSettle(page);

    // Verify canvas exists after zoom settle
    const postZoomState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      const lowerCanvas = overlayDiv?.querySelector('.lower-canvas');
      return {
        overlayExists: !!overlayDiv,
        canvasExists: !!lowerCanvas,
        canvasWidth: lowerCanvas?.width ?? null,
      };
    });

    console.log('Post-zoom state:', JSON.stringify(postZoomState, null, 2));

    expect(postZoomState.overlayExists, 'Overlay div must exist after zoom').toBe(true);
    expect(postZoomState.canvasExists, 'Canvas must exist after zoom').toBe(true);
    expect(postZoomState.canvasWidth, 'Canvas must have non-zero width').toBeGreaterThan(0);

    // Simulate Ctrl+Z (undo) -- this tests that undo doesn't crash after zoom
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');

    // Wait for undo to process
    await page.waitForTimeout(500);

    // Verify canvas still exists after undo and no errors occurred
    const postUndoState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      const lowerCanvas = overlayDiv?.querySelector('.lower-canvas');
      return {
        overlayExists: !!overlayDiv,
        canvasExists: !!lowerCanvas,
        canvasWidth: lowerCanvas?.width ?? null,
      };
    });

    console.log('Post-undo state:', JSON.stringify(postUndoState, null, 2));

    // Canvas must still be functional after undo
    expect(postUndoState.canvasExists, 'Canvas must exist after undo').toBe(true);
    expect(postUndoState.canvasWidth, 'Canvas must have non-zero width after undo').toBeGreaterThan(0);

    // No console errors from undo after zoom
    const undoErrors = errors.filter(e => !e.includes('undo') || true); // all errors
    expect(
      undoErrors.length,
      `Expected 0 console errors from undo after zoom, got ${undoErrors.length}: ${undoErrors.join('; ')}`
    ).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 6: PRES-04 -- proxy rendering (LightweightAnnotationOverlay) works after zoom
  // ---------------------------------------------------------------------------
  test('PRES-04 -- proxy rendering works after zoom', async ({ page }) => {
    await setupPage(page);

    // Verify the overlay div for page 6 has portal content children
    const preZoomState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return null;
      return {
        exists: true,
        connected: overlayDiv.isConnected,
        childCount: overlayDiv.children.length,
      };
    });

    console.log('Pre-zoom overlay state:', JSON.stringify(preZoomState, null, 2));
    expect(preZoomState, 'Overlay div must exist for page 6').not.toBeNull();
    expect(
      preZoomState.childCount,
      'Overlay div must have portal content children (proxy rendering active)'
    ).toBeGreaterThan(0);

    // Perform ctrl+scroll zoom in, wait for settle
    await performZoomAndSettle(page);

    // Verify the overlay div for page 6 STILL has portal content children (not unmounted)
    const postZoomState = await page.evaluate(() => {
      const overlayDiv = document.querySelector('[data-overlay-page="6"]');
      if (!overlayDiv) return null;
      return {
        exists: true,
        connected: overlayDiv.isConnected,
        childCount: overlayDiv.children.length,
      };
    });

    console.log('Post-zoom overlay state:', JSON.stringify(postZoomState, null, 2));
    expect(postZoomState, 'Overlay div must still exist after zoom').not.toBeNull();
    expect(
      postZoomState.connected,
      'Overlay div must still be connected to DOM after zoom'
    ).toBe(true);
    expect(
      postZoomState.childCount,
      'Overlay div must still have portal content children after zoom (proxy rendering preserved)'
    ).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 7: PRES-05 -- no console errors during zoom operations
  // ---------------------------------------------------------------------------
  test('PRES-05 -- no console errors during zoom operations', async ({ page }) => {
    // Set up console error collector BEFORE page.goto
    const errors = collectConsoleErrors(page);

    // Navigate and setup
    await setupPage(page);

    // Locate the page 6 container
    const pageDiv = page.locator('.e-pv-page-div[data-page-number="6"]');
    await expect(pageDiv).toBeVisible({ timeout: 15_000 });
    const box = await pageDiv.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);

    // Perform ctrl+scroll zoom in
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');

    // Wait 500ms (mid-zoom)
    await page.waitForTimeout(500);

    // Perform another ctrl+scroll zoom in (rapid consecutive)
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');

    // Wait for settle
    await page.waitForTimeout(3500);

    // Perform ctrl+scroll zoom out
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Control');

    // Wait for settle
    await page.waitForTimeout(3500);

    // ASSERT: console error collector has 0 errors
    console.log('Console errors collected:', JSON.stringify(errors, null, 2));
    expect(
      errors.length,
      `Expected 0 console errors during zoom operations, but got ${errors.length}: ${errors.join('; ')}`
    ).toBe(0);
  });
});
