/**
 * Bridge Snapshot Integration Tests (INST-01, INST-02, INST-05, INST-06)
 *
 * Validates the debug bridge snapshot API returns all required fields,
 * survives JSON round-trip, tracks DOM mutations, and includes
 * performance marks.
 */

import { test, expect } from '@playwright/test';

test.describe('Debug Bridge Snapshot (INST-01, INST-02, INST-05, INST-06)', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to dev test route and wait for PDF viewer
    await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
    await page.locator('.survey-pdfjs-viewer-container').waitFor({ state: 'visible', timeout: 60_000 });

    // Wait for debug bridge to be available
    await page.waitForFunction(() => window.__debugBridge != null, { timeout: 30_000 });

    // Use readiness signal instead of arbitrary timeout
    const hasReadiness = await page.evaluate(() => !!window.__debugReady?.waitFor);
    if (hasReadiness) {
      await page.evaluate(() => window.__debugReady.waitFor('pdfLoaded', { timeout: 30000 }));
    } else {
      await page.waitForTimeout(5000);
    }

    // Navigate to page 6
    const pageInput = page.getByRole('textbox', { name: 'Current page' });
    await expect(pageInput).toBeVisible({ timeout: 15_000 });
    await pageInput.click();
    await pageInput.fill('6');
    await pageInput.press('Enter');

    // Wait for page 6 annotations
    if (hasReadiness) {
      await page.evaluate(() => window.__debugReady.waitFor('ready', { timeout: 30000 }));
    } else {
      await page.waitForTimeout(5000);
    }
  });

  test('snapshot returns all required fields (INST-01)', async ({ page }) => {
    const snap = await page.evaluate(() => window.__debugBridge.snapshot());

    // Core fields
    expect(snap.sessionMs).toBeGreaterThan(0);
    expect(snap).toHaveProperty('zoomLevel');
    expect(snap).toHaveProperty('renderedScale');
    expect(snap).toHaveProperty('targetScale');
    expect(snap).toHaveProperty('portalHostCount');
    expect(snap).toHaveProperty('freezeState');
    expect(snap).toHaveProperty('canvasContainerCount');
    expect(snap).toHaveProperty('isZooming');
    expect(snap).toHaveProperty('currentPage');
    expect(snap).toHaveProperty('visiblePages');
    expect(snap).toHaveProperty('pageStatus');
    expect(snap).toHaveProperty('signals');

    // Type checks
    expect(typeof snap.sessionMs).toBe('number');
    expect(typeof snap.portalHostCount).toBe('number');
    expect(typeof snap.canvasContainerCount).toBe('number');
    expect(Array.isArray(snap.visiblePages)).toBe(true);
    expect(Array.isArray(snap.pageStatus)).toBe(true);
    expect(snap.canvasContainerCount).toBeGreaterThanOrEqual(1);
  });

  test('snapshot is JSON-serializable (INST-02)', async ({ page }) => {
    const roundTrip = await page.evaluate(() => {
      const snap = window.__debugBridge.snapshot();
      const json = JSON.stringify(snap);
      const parsed = JSON.parse(json);
      // Verify all keys survived round-trip
      const origKeys = Object.keys(snap).sort();
      const parsedKeys = Object.keys(parsed).sort();
      return { origKeys, parsedKeys, valuesMatch: json === JSON.stringify(parsed) };
    });

    expect(roundTrip.origKeys).toEqual(roundTrip.parsedKeys);
    expect(roundTrip.valuesMatch).toBe(true);
  });

  test('mutation drain returns records with required fields (INST-05)', async ({ page }) => {
    const mutations = await page.evaluate(() => {
      const snap = window.__debugBridge.snapshot({ drainMutations: true });
      return snap.mutations;
    });

    expect(Array.isArray(mutations)).toBe(true);
    // After page navigation, there should be mutation records
    // (Syncfusion adds/removes page divs during navigation)
    if (mutations.length > 0) {
      const record = mutations[0];
      expect(record).toHaveProperty('type');
      expect(['added', 'removed']).toContain(record.type);
      expect(record).toHaveProperty('pageNumber');
      expect(record).toHaveProperty('sessionMs');
      expect(typeof record.sessionMs).toBe('number');
      expect(record).toHaveProperty('seq');
      expect(typeof record.seq).toBe('number');
    }

    // Verify drain cleared the buffer
    const snapAfter = await page.evaluate(() => window.__debugBridge.snapshot({ drainMutations: true }));
    expect(snapAfter.mutations.length).toBe(0);
  });

  test('performance marks include debug marks (INST-06)', async ({ page }) => {
    const marks = await page.evaluate(() => {
      return performance.getEntriesByType('mark')
        .filter(m => m.name.includes('_'))
        .map(m => ({ name: m.name, detail: m.detail }));
    });

    expect(marks.length).toBeGreaterThan(0);
    const markNames = marks.map(m => m.name);
    // At minimum, pdf_loaded and pal_mount should have fired
    expect(markNames.some(n => n.includes('pal_mount') || n.includes('pdf_loaded'))).toBe(true);
  });

  test('pageStatus has 4-layer status for visible pages (INST-01)', async ({ page }) => {
    const snap = await page.evaluate(() => window.__debugBridge.snapshot());

    expect(snap.pageStatus.length).toBeGreaterThan(0);
    const status = snap.pageStatus[0];
    expect(status).toHaveProperty('page');
    expect(status).toHaveProperty('visible');
    expect(status).toHaveProperty('syncfusionDom');
    expect(status).toHaveProperty('palMounted');
    expect(status).toHaveProperty('fabricCanvas');
    expect(typeof status.page).toBe('number');
    expect(typeof status.visible).toBe('boolean');
    expect(typeof status.syncfusionDom).toBe('boolean');
    expect(typeof status.palMounted).toBe('boolean');
    expect(typeof status.fabricCanvas).toBe('boolean');
  });
});
