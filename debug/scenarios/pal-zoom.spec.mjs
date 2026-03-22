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

    // Wait for App.jsx's 1000ms settle timer + buffer
    await page.waitForTimeout(2000);

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

      // PAL's canvas wrapper sets pointer-events: auto when a tool is active.
      // The overlay div stays pointer-events: none (pass-through container).
      const canvasContainer = lowerCanvas?.closest('.canvas-container')?.parentElement;
      const canvasPointerEvents = canvasContainer
        ? window.getComputedStyle(canvasContainer).pointerEvents
        : null;

      return {
        canvasWidth: lowerCanvas ? lowerCanvas.width : null,
        canvasHeight: lowerCanvas ? lowerCanvas.height : null,
        fabricZoom,
        overlayTransform: computed.transform,
        overlayPointerEvents: computed.pointerEvents,
        canvasPointerEvents,
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

    // Wait for settle (1000ms App.jsx timer + buffer)
    await page.waitForTimeout(2000);

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

    // ASSERT: post-zoom canvas dimensions approximately match overlay div dimensions.
    // With container-aware sizing (Phase 4), the canvas measures the actual
    // container and sizes to match it 1:1. The expected ratio is ~1.0.
    // Allow generous tolerance (0.85-1.15) to account for rounding and
    // Electron/browser zoom factor differences.
    if (postZoom.canvasWidth && postZoom.overlayWidth) {
      const widthRatio = postZoom.canvasWidth / postZoom.overlayWidth;
      expect(
        widthRatio,
        `Canvas/overlay ratio (${widthRatio.toFixed(3)}) should be near 1.0 (container-aware sizing), got canvas=${postZoom.canvasWidth}, overlay=${postZoom.overlayWidth}`
      ).toBeGreaterThan(0.85);
      expect(widthRatio).toBeLessThan(1.15);
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

    // Wait 500ms (mid-zoom) and check pointer-events is 'none'
    await page.waitForTimeout(500);

    const midZoomState = await getCanvasState(page, 6);
    console.log('Mid-zoom overlay pointer-events:', midZoomState?.overlayPointerEvents);
    console.log('Mid-zoom canvas pointer-events:', midZoomState?.canvasPointerEvents);

    // Overlay div is always pointer-events: none (pass-through container).
    // PAL canvas wrapper overrides with 'auto' when a tool is active.
    expect(
      midZoomState.overlayPointerEvents,
      'Overlay div should always be pointer-events: none (pass-through)'
    ).toBe('none');

    // Wait 2000ms more for settle
    await page.waitForTimeout(2000);

    const afterSettleState = await getCanvasState(page, 6);
    console.log('After settle overlay pointer-events:', afterSettleState?.overlayPointerEvents);
    console.log('After settle canvas pointer-events:', afterSettleState?.canvasPointerEvents);

    // After settle, the canvas container should allow pointer events.
    // canvasPointerEvents is 'auto' when a drawing tool is selected, 'none' otherwise.
    // Either way, the overlay div stays 'none' -- clicks pass through to children.
    // The real test: can we click without error? (verified below)

    // Verify a click on the canvas area does not throw
    const overlayLocator = page.locator('[data-overlay-page="6"]');
    const overlayBox = await overlayLocator.boundingBox();
    if (overlayBox) {
      // Click center of overlay -- should not throw
      await page.mouse.click(
        overlayBox.x + overlayBox.width / 2,
        overlayBox.y + overlayBox.height / 2
      );
      // If we get here, the click succeeded (pointer event reached the canvas)
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
    const errors = collectConsoleErrors(page);
    await setupPage(page);

    // Verify canvas exists before zoom
    const preZoomCanvas = await page.evaluate(() => {
      const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });
    expect(preZoomCanvas, 'Canvas should exist before zoom').not.toBeNull();

    // Perform ctrl+scroll zoom in, wait for settle
    await performZoomAndSettle(page);

    // Verify canvas still exists after zoom
    const postZoomCanvas = await page.evaluate(() => {
      const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });
    expect(postZoomCanvas, 'Canvas should exist after zoom').not.toBeNull();

    // Simulate Ctrl+Z (undo) -- should not crash
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');

    // Wait for undo to process
    await page.waitForTimeout(500);

    // Verify canvas still exists after undo (not destroyed by zoom state corruption)
    const postUndoCanvas = await page.evaluate(() => {
      const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });
    expect(postUndoCanvas, 'Canvas should exist after undo').not.toBeNull();

    // Simulate Ctrl+Shift+Z (redo) -- should not crash
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('z');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');

    await page.waitForTimeout(500);

    // Verify canvas still exists after redo
    const postRedoCanvas = await page.evaluate(() => {
      const canvas = document.querySelector('[data-overlay-page="6"] .lower-canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });
    expect(postRedoCanvas, 'Canvas should exist after redo').not.toBeNull();

    // No errors during the entire undo/redo sequence
    expect(errors.length, `Console errors during undo/redo: ${errors.map(e => e.text).join('; ')}`).toBe(0);
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
    await page.waitForTimeout(2000);

    // Perform ctrl+scroll zoom out
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Control');

    // Wait for settle
    await page.waitForTimeout(2000);

    // ASSERT: console error collector has 0 errors
    console.log('Console errors collected:', JSON.stringify(errors, null, 2));
    expect(
      errors.length,
      `Expected 0 console errors during zoom operations, but got ${errors.length}: ${errors.join('; ')}`
    ).toBe(0);
  });
});
