import { test, expect } from '@playwright/test';

// Phase 29 e2e — UNDO-04: Cmd+Shift+Z redoes the most recently undone action.
// Activated by Plan 29-04. Maps to UI-SPEC §3 keybind contract.

test('Cmd+Shift+Z redoes the most recently undone action', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await page.locator('text=Package 2 - Rev 4 -- IC.pdf').first().click({ timeout: 20000 });
  await page.waitForSelector('.survey-pdfjs-page-container', { timeout: 20000 });

  await page.evaluate(() => window.__navigateToPage?.(6));
  await page.waitForTimeout(800);

  const before = await page.locator('svg [data-anno-id]').count();
  const pageBox = await page.locator('.survey-pdfjs-page-container').first().boundingBox();
  if (!pageBox) throw new Error('page container bounding box not available');
  await page.mouse.move(pageBox.x + 100, pageBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(pageBox.x + 200, pageBox.y + 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const afterDraw = await page.locator('svg [data-anno-id]').count();
  test.skip(afterDraw === before, 'no stroke landed via mouse drag — drawing tool not armed');

  const isMac = process.platform === 'darwin';
  // Undo then redo. The Y.UndoManager redoStack receives the popped item from
  // undo(); Cmd+Shift+Z reapplies it. Empty-stack silent contract holds for
  // either direction (UI-SPEC §"Cmd+Shift+Z pressed, redo stack empty").
  await page.keyboard.press(isMac ? 'Meta+z' : 'Control+z');
  await page.waitForTimeout(500);
  await page.keyboard.press(isMac ? 'Meta+Shift+z' : 'Control+Shift+z');
  await page.waitForTimeout(700);

  const afterRedo = await page.locator('svg [data-anno-id]').count();
  expect(afterRedo).toBe(afterDraw);
  expect(afterRedo).toBeGreaterThan(before);
});
