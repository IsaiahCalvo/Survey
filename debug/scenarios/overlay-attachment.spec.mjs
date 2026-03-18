/**
 * Overlay Attachment Foundation -- OVLY-01 verification.
 *
 * Proves overlay divs are:
 * 1. Direct children of Syncfusion e-pv-page-div elements
 * 2. Styled with position:absolute, width:100%, height:100%, pointer-events:none, z-index:20
 * 3. Marked with data-overlay-page attribute matching the page number
 * 4. Not interfering with existing annotation rendering
 */

import { test, expect } from '@playwright/test';

test.describe('overlay-attachment', () => {

  test('overlay divs are direct children of page divs with correct styling', async ({ page }) => {
    // Step 1: Navigate to dev test route with test PDF
    await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');

    // Step 2: Wait for PDF viewer to load
    await page.locator('.e-pv-viewer-container').waitFor({
      state: 'visible',
      timeout: 60_000,
    });

    // Wait for Syncfusion + PDF.js initialization
    await page.waitForTimeout(5000);

    // Step 3: Navigate to page 6 (first page with annotations)
    const pageInput = page.getByRole('textbox', { name: 'Current page' });
    await expect(pageInput).toBeVisible({ timeout: 15_000 });
    await pageInput.click();
    await pageInput.fill('6');
    await pageInput.press('Enter');

    // Wait for page change + overlay attachment
    await page.waitForTimeout(5000);

    // Step 4: Verify overlay divs exist as direct children of e-pv-page-div
    const overlayResults = await page.evaluate(() => {
      const overlayDivs = document.querySelectorAll('[data-overlay-page]');
      if (overlayDivs.length === 0) {
        return { count: 0, pages: [], errors: ['No overlay divs found'] };
      }

      const pages = [];
      const errors = [];

      overlayDivs.forEach(div => {
        const pageNum = div.getAttribute('data-overlay-page');
        const parent = div.parentElement;
        const isDirectChild = parent?.classList?.contains('e-pv-page-div');
        const parentPageNum = parent?.getAttribute?.('data-page-number');
        const style = div.style;

        const result = {
          pageNumber: pageNum,
          isDirectChild,
          parentPageNumber: parentPageNum,
          pageNumbersMatch: pageNum === parentPageNum,
          isConnected: div.isConnected,
          position: style.position,
          top: style.top,
          left: style.left,
          width: style.width,
          height: style.height,
          pointerEvents: style.pointerEvents,
          zIndex: style.zIndex,
        };

        pages.push(result);

        // Validate each overlay div
        if (!isDirectChild) {
          errors.push(`Page ${pageNum}: not a direct child of e-pv-page-div (parent class: ${parent?.className})`);
        }
        if (pageNum !== parentPageNum) {
          errors.push(`Page ${pageNum}: data-overlay-page (${pageNum}) does not match parent data-page-number (${parentPageNum})`);
        }
        if (style.position !== 'absolute') {
          errors.push(`Page ${pageNum}: position is '${style.position}', expected 'absolute'`);
        }
        if (style.width !== '100%') {
          errors.push(`Page ${pageNum}: width is '${style.width}', expected '100%'`);
        }
        if (style.height !== '100%') {
          errors.push(`Page ${pageNum}: height is '${style.height}', expected '100%'`);
        }
        if (style.pointerEvents !== 'none') {
          errors.push(`Page ${pageNum}: pointer-events is '${style.pointerEvents}', expected 'none'`);
        }
        if (style.zIndex !== '20') {
          errors.push(`Page ${pageNum}: z-index is '${style.zIndex}', expected '20'`);
        }
      });

      return { count: overlayDivs.length, pages, errors };
    });

    // Log results for debugging
    console.log(`Overlay divs found: ${overlayResults.count}`);
    overlayResults.pages.forEach(p => {
      console.log(`  Page ${p.pageNumber}: directChild=${p.isDirectChild}, match=${p.pageNumbersMatch}, pos=${p.position}, w=${p.width}, h=${p.height}, pe=${p.pointerEvents}, z=${p.zIndex}`);
    });
    if (overlayResults.errors.length > 0) {
      console.log('Errors:', overlayResults.errors);
    }

    // Assertions
    expect(overlayResults.count, 'At least one overlay div must exist').toBeGreaterThanOrEqual(1);
    expect(overlayResults.errors, `Overlay validation errors: ${overlayResults.errors.join('; ')}`).toHaveLength(0);

    // Verify every detected overlay div passes all checks
    for (const p of overlayResults.pages) {
      expect(p.isDirectChild, `Page ${p.pageNumber} overlay must be direct child of e-pv-page-div`).toBe(true);
      expect(p.pageNumbersMatch, `Page ${p.pageNumber} overlay data-overlay-page must match parent data-page-number`).toBe(true);
      expect(p.position, `Page ${p.pageNumber} overlay position`).toBe('absolute');
      expect(p.width, `Page ${p.pageNumber} overlay width`).toBe('100%');
      expect(p.height, `Page ${p.pageNumber} overlay height`).toBe('100%');
      expect(p.pointerEvents, `Page ${p.pageNumber} overlay pointer-events`).toBe('none');
      expect(p.zIndex, `Page ${p.pageNumber} overlay z-index`).toBe('20');
    }
  });

  test('existing annotations still render after overlay divs are attached', async ({ page }) => {
    // Step 1: Navigate to dev test route with test PDF
    await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');

    // Step 2: Wait for PDF viewer to load
    await page.locator('.e-pv-viewer-container').waitFor({
      state: 'visible',
      timeout: 60_000,
    });

    await page.waitForTimeout(5000);

    // Step 3: Navigate to page 6 (first page with annotations)
    const pageInput = page.getByRole('textbox', { name: 'Current page' });
    await expect(pageInput).toBeVisible({ timeout: 15_000 });
    await pageInput.click();
    await pageInput.fill('6');
    await pageInput.press('Enter');

    await page.waitForTimeout(5000);

    // Step 4: Wait for Fabric.js canvas content (same check as smoke test)
    await page.locator('.canvas-container').first().waitFor({
      state: 'visible',
      timeout: 30_000,
    });

    await page.waitForTimeout(2000);

    // Step 5: Verify canvas has actual content (non-blank pixels)
    const hasCanvasContent = await page.evaluate(() => {
      const containers = document.querySelectorAll('.canvas-container');
      if (containers.length === 0) return false;

      for (const container of containers) {
        const canvases = container.querySelectorAll('canvas');
        for (const canvas of canvases) {
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let nonBlankPixels = 0;
            for (let i = 0; i < data.length; i += 400) {
              const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
              if (a > 0 && !(r === 255 && g === 255 && b === 255)) {
                nonBlankPixels++;
              }
            }
            if (nonBlankPixels > 10) return true;
          } catch {
            continue;
          }
        }
      }
      return false;
    });

    // Step 6: Verify overlay divs exist AND annotations still render
    const overlayCount = await page.locator('[data-overlay-page]').count();

    console.log(`Overlay divs: ${overlayCount}, Canvas content present: ${hasCanvasContent}`);

    expect(overlayCount, 'Overlay divs must exist').toBeGreaterThanOrEqual(1);
    expect(hasCanvasContent, 'Existing annotations must still render (non-blank canvas content) after overlay divs are added').toBe(true);
  });

});
