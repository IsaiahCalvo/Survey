import { test, expect } from '@playwright/test';

// CREATE-01 E2E: line creation in FabricDrawingCanvas shows dashed stroke
// + 0.6 opacity during drag. Committed line has solid stroke + opacity 1
// in saved JSON (Pitfall 1: strokeDashArray must not persist into Supabase).
// Status: SCAFFOLD — Plan 14-02 ships the preview+reset.

test.describe('CREATE-01 line/arrow dashed preview', () => {
  test.skip(true, 'Wave 0 scaffold — implementation pending Plan 14-02');

  test('line preview shows strokeDashArray=[5,5] and opacity=0.6 during drag', async ({ page }) => {
    await page.goto('/');
    // TODO 14-02: activate line tool, press mouse down, move, assert
    // Fabric.Line in-progress has strokeDashArray: [5,5] and opacity: 0.6
    // via page.evaluate inspection of the Fabric canvas state.
    expect(true).toBe(true);
  });

  test('committed line has solid stroke in saved JSON', async ({ page }) => {
    await page.goto('/');
    // TODO 14-02: activate line tool, full mouse down→move→up cycle,
    // capture saved annotation JSON via debug helper, assert
    // strokeDashArray === null and opacity === 1.
    expect(true).toBe(true);
  });

  test('committed line survives reload with solid stroke', async ({ page }) => {
    await page.goto('/');
    // TODO 14-02: create line, reload page, re-read annotation from store,
    // assert strokeDashArray === null and opacity === 1.
    expect(true).toBe(true);
  });

  test('arrow preview shows dashed style during drag', async ({ page }) => {
    await page.goto('/');
    // TODO 14-02: activate arrow tool, mouse down→move, assert dashed preview
    expect(true).toBe(true);
  });

  test('committed arrow has solid stroke in saved JSON', async ({ page }) => {
    await page.goto('/');
    // TODO 14-02: arrow creation cycle, assert saved JSON has solid stroke
    expect(true).toBe(true);
  });
});
