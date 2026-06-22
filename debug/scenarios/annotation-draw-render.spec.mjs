/**
 * Annotation draw → render → survive-zoom safety net.
 *
 * This is the first end-to-end guard for the most dangerous regression class on
 * the fragile annotation files (PageAnnotationLayer, SVGAnnotationLayer, the
 * Fabric drawing canvas, and the container-aware canvas sizing): a user draws a
 * mark and it silently fails to render, or vanishes when the page resizes on zoom.
 *
 * It drives the real running app (pdf.js engine) through the dev `?testPdf=`
 * route — no backend, no auth pollution — and asserts purely on what renders:
 *
 *   1. Arming the pen mounts the Fabric drawing canvas.
 *   2. A real mouse-drag stroke becomes a rendered annotation on the page.
 *   3. The rendered annotation survives a ctrl+wheel zoom (the zoomGeneration /
 *      container-aware sizing invariant holds — the mark is not dropped).
 *   4. No console errors fire during draw or zoom.
 *
 * NOTE on persistence: the `?testPdf=` fixture route is a transient preview and
 * does NOT persist a drawn mark across reload (real persistence is the cloud sync
 * path, which is already covered by the headless agent-cli proofs:
 * survey-roundtrip.mjs, proof-snapshot-invariant.mjs). So this spec deliberately
 * asserts render + zoom-survival, not reload-survival.
 */

import { test, expect } from '@playwright/test';

const TEST_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const PDF_ID = 'Package 2 - Rev 4 -- IC.pdf-6300878';

/**
 * Count drawn marks on a page. Reads BOTH the Fabric drawing canvas (which gets
 * the object immediately on stroke commit) and the app's render registry (which
 * can lag a frame), and returns the larger — so the assertion sees the mark as
 * soon as either surface reflects it.
 */
async function drawnCountForPage(page, pageNum) {
  return page.evaluate((pn) => {
    let registryCount = 0;
    const reg = window.__renderedAnnotationRegistry || {};
    const v = reg[String(pn)];
    if (Array.isArray(v)) registryCount = v.length;
    else if (v && typeof v.size === 'number') registryCount = v.size;
    else if (v && typeof v === 'object') registryCount = Object.keys(v).length;

    let fabricCount = 0;
    const overlay = document.querySelector(`[data-overlay-page="${pn}"]`);
    const lower = overlay?.querySelector('.lower-canvas');
    const container = lower?.closest('.canvas-container');
    const fabric = container?.__fabric || lower?.__fabric;
    if (fabric && typeof fabric.getObjects === 'function') fabricCount = fabric.getObjects().length;

    return Math.max(registryCount, fabricCount);
  }, pageNum);
}

/** Collect non-benign console errors. Must be called before page.goto(). */
function collectConsoleErrors(page) {
  const errors = [];
  const benign = [/Syncfusion/i, /license/i, /DevTools/i, /favicon/i, /React does not recognize/i];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!benign.some((p) => p.test(text))) errors.push(text);
    }
  });
  return errors;
}

test.describe('annotation-draw-render', () => {
  test('a drawn pen stroke renders and survives a zoom', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Auto-dismiss the "unsaved changes" beforeunload guard if a nav fires.
    page.on('dialog', (d) => d.accept().catch(() => {}));

    // ── Load the test PDF on the pdf.js engine ──
    await page.goto(TEST_PDF);
    await page.getByRole('button', { name: 'Draw' }).waitFor({ state: 'visible', timeout: 60_000 });
    // Let pdf.js + overlay hosts finish first paint.
    await page.waitForTimeout(6000);

    const page1 = page.locator('.e-pv-page-div[data-page-number="1"]');
    await expect(page1).toBeVisible({ timeout: 15_000 });
    await page1.scrollIntoViewIfNeeded();

    const before = await drawnCountForPage(page, 1);
    expect(before, 'Fixture should load with no annotations on page 1').toBe(0);

    // ── Arm the pen (mounts the Fabric drawing canvas on every page) ──
    await page.getByRole('button', { name: 'Draw' }).click();
    await page.waitForTimeout(1500);
    const penState = await page.evaluate(() => {
      const r = window.__debugBridge.snapshot();
      return { canvasContainerCount: r.canvasContainerCount, lastDrawTool: localStorage.getItem('lastDrawTool') };
    });
    expect(penState.lastDrawTool, 'Clicking Draw should arm the pen tool').toBe('pen');
    expect(penState.canvasContainerCount, 'Arming the pen should mount Fabric drawing canvases').toBeGreaterThan(0);

    // ── Draw a real multi-point stroke in the center of page 1 ──
    const box = await page1.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 60, cy - 20);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx - 60 + i * 15, cy - 20 + Math.sin(i) * 12);
    }
    await page.mouse.up();

    // ── Core assertion: the stroke became a drawn mark (poll — commit can lag) ──
    await expect
      .poll(() => drawnCountForPage(page, 1), {
        message: 'A drawn pen stroke must render as an annotation on page 1',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(1);

    // ── Zoom in and confirm the mark is not dropped on resize ──
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await page.waitForTimeout(2500);

    const afterZoom = await drawnCountForPage(page, 1);
    expect(afterZoom, 'The drawn annotation must still render after a zoom (zoomGeneration / sizing invariant)').toBeGreaterThanOrEqual(1);

    // ── No console errors during the whole draw + zoom sequence ──
    expect(errors.length, `Console errors during draw/zoom: ${errors.join(' | ')}`).toBe(0);
  });
});
