import { test, expect } from '@playwright/test';

// KBD-01 E2E: Delete/Backspace with single-selected callout removes it
// from the store with undo support. Focus-guarded when text input focused.
// Status: SCAFFOLD — Plan 14-02 ships the handler, Plan 14-03 wires the
// callout selection state that this test depends on.

test.describe('KBD-01 delete callout keyboard', () => {
  test.skip(true, 'Wave 0 scaffold — implementation pending Plan 14-02 + 14-03');

  test('Delete key removes selected callout', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: create callout, select it, press Delete, assert removed
    expect(true).toBe(true);
  });

  test('Backspace key removes selected callout', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: create callout, select it, press Backspace, assert removed
    expect(true).toBe(true);
  });

  test('Delete is suppressed while typing in an INPUT', async ({ page }) => {
    await page.goto('/');
    // TODO 14-02: focus a text input, press Delete, assert no callout removed
    expect(true).toBe(true);
  });

  test('Delete is suppressed while typing in callout edit textarea', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: create callout, double-click to edit, press Delete, assert no removal
    expect(true).toBe(true);
  });

  test('Delete creates an undo checkpoint', async ({ page }) => {
    await page.goto('/');
    // TODO 14-03: create callout, select, Delete, Cmd+Z, assert restored
    expect(true).toBe(true);
  });
});
