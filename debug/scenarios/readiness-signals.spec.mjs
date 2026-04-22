/**
 * Readiness Signals Integration Tests (INST-03)
 *
 * Validates the waitFor() promise-based readiness signal system:
 * - waitFor('ready') resolves after PDF load and annotation mount
 * - waitFor('annotationsMounted', { page }) resolves for specific page
 * - waitFor() rejects on timeout with descriptive error including signal state
 */

import { test, expect } from '@playwright/test';

test.describe('Readiness Signals (INST-03)', () => {

  test('waitFor ready resolves after PDF load and annotation mount', async ({ page }) => {
    await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
    await page.locator('.e-pv-viewer-container').waitFor({ state: 'visible', timeout: 60_000 });

    // Wait for bridge availability
    await page.waitForFunction(() => window.__debugReady != null, { timeout: 30_000 });

    // Navigate to page 6
    const pageInput = page.getByRole('textbox', { name: 'Current page' });
    await expect(pageInput).toBeVisible({ timeout: 15_000 });
    await pageInput.click();
    await pageInput.fill('6');
    await pageInput.press('Enter');

    // The core test: waitFor('ready') should resolve
    const result = await page.evaluate(() =>
      window.__debugReady.waitFor('ready', { timeout: 30000 })
    );

    expect(result).toHaveProperty('condition', 'ready');
    expect(result).toHaveProperty('signals');
    expect(result.signals.pdfLoaded).toBe(true);
    expect(result.signals.zoomSettled).toBe(true);
    expect(result.signals.domSettled).toBe(true);
    expect(result.signals.annotationsMounted).toBe(true);
    expect(result).toHaveProperty('waitMs');
    expect(typeof result.waitMs).toBe('number');
  });

  test('waitFor annotationsMounted with page target resolves', async ({ page }) => {
    await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
    await page.locator('.e-pv-viewer-container').waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForFunction(() => window.__debugReady != null, { timeout: 30_000 });

    // Navigate to page 6
    const pageInput = page.getByRole('textbox', { name: 'Current page' });
    await expect(pageInput).toBeVisible({ timeout: 15_000 });
    await pageInput.click();
    await pageInput.fill('6');
    await pageInput.press('Enter');

    // Wait specifically for page 6 annotations
    const result = await page.evaluate(() =>
      window.__debugReady.waitFor('annotationsMounted', { page: 6, timeout: 30000 })
    );

    expect(result.condition).toBe('annotationsMounted');
    expect(typeof result.waitMs).toBe('number');
  });

  test('waitFor rejects on timeout with descriptive state', async ({ page }) => {
    await page.goto('/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf');
    await page.locator('.e-pv-viewer-container').waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForFunction(() => window.__debugReady != null, { timeout: 30_000 });

    // Use page 99 which doesn't exist -- should always timeout
    const rejection = await page.evaluate(async () => {
      try {
        await window.__debugReady.waitFor('annotationsMounted', { page: 99, timeout: 200 });
        return { rejected: false };
      } catch (err) {
        return { rejected: true, message: err.message };
      }
    });

    expect(rejection.rejected).toBe(true);
    expect(rejection.message).toContain('Timeout waiting for');
    expect(rejection.message).toContain('annotationsMounted');
    // The error message should include current signal state
    expect(rejection.message).toContain('pdfLoaded');
  });
});
