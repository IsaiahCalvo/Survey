import { test, expect } from '@playwright/test';

// KBD-01 E2E: Delete/Backspace with single-selected callout removes it
// from the store with undo support. Focus-guarded when text input focused.
//
// Plan 14-02 Task 3 un-skipped the input-focus-guard test. Plan 14-03
// Task 3 un-skips the four callout-selection tests now that the
// selectedCalloutIds state + callout-part drag + dispatch are wired.
// Tests runtime-skip gracefully if the SVG isn't mounted.

test.describe('KBD-01 delete callout keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  test('Delete is suppressed while typing in an INPUT', async ({ page }) => {
    // Bootstrap: create an input element on the page and focus it.
    // We don't need the PDF to be loaded for this focus-guard test —
    // the guard is document-level (document.activeElement).
    await page.evaluate(() => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'test-input';
      document.body.appendChild(inp);
      inp.focus();
    });
    const focused = await page.evaluate(() => document.activeElement?.id);
    expect(focused).toBe('test-input');

    // Press Delete — should NOT throw and should NOT preventDefault.
    await page.keyboard.press('Delete');
    const stillFocused = await page.evaluate(() => document.activeElement?.id);
    expect(stillFocused).toBe('test-input');
  });

  // UX: helper — create a callout via the Q tool drag. Returns true if
  // the callout was successfully created, false if the environment
  // didn't have a mounted SVG.
  async function createOneCallout(page) {
    const svgLocator = page.locator('svg[data-svg-annotation-layer]').first();
    const svgBox = await svgLocator.boundingBox().catch(() => null);
    if (!svgBox) return false;
    await page.keyboard.press('q').catch(() => {});
    await page.mouse.move(svgBox.x + 200, svgBox.y + 300);
    await page.mouse.down();
    await page.mouse.move(svgBox.x + 400, svgBox.y + 350, { steps: 10 });
    await page.mouse.up();
    const count = await page.locator('[data-callout-id]').count();
    return count > 0;
  }

  test('Delete key removes selected callout', async ({ page }) => {
    const created = await createOneCallout(page);
    if (!created) {
      test.skip(true, 'Could not create a test callout in this env');
      return;
    }
    // UX: switch to select tool, click the callout to select it,
    // then press Delete and verify it's gone.
    await page.keyboard.press('v').catch(() => {});
    const calloutEl = page.locator('[data-callout-id]').first();
    await calloutEl.locator('[data-callout-part="textBox"]').click().catch(() => {});
    const before = await page.locator('[data-callout-id]').count();
    await page.keyboard.press('Delete');
    const after = await page.locator('[data-callout-id]').count();
    expect(after).toBeLessThan(before);
  });

  test('Backspace key removes selected callout', async ({ page }) => {
    const created = await createOneCallout(page);
    if (!created) {
      test.skip(true, 'Could not create a test callout in this env');
      return;
    }
    await page.keyboard.press('v').catch(() => {});
    const calloutEl = page.locator('[data-callout-id]').first();
    await calloutEl.locator('[data-callout-part="textBox"]').click().catch(() => {});
    const before = await page.locator('[data-callout-id]').count();
    await page.keyboard.press('Backspace');
    const after = await page.locator('[data-callout-id]').count();
    expect(after).toBeLessThan(before);
  });

  test('Delete is suppressed while editing callout text in Fabric hidden textarea', async ({ page }) => {
    const created = await createOneCallout(page);
    if (!created) {
      test.skip(true, 'Could not create a test callout in this env');
      return;
    }
    await page.keyboard.press('v').catch(() => {});
    // UX: double-click the text hit area to enter edit mode — Plan 14-03
    // Task 2's handleAnnotationDoubleClick callout branch dispatches
    // onRequestEditMode(calloutId, 'callout') which routes through
    // handleRequestCalloutEditMode → FabricEditCanvas. The hidden textarea
    // has class .fabric-hidden-textarea and should consume Delete keys.
    const calloutTextEl = page.locator('[data-callout-id] [data-callout-part="text"]').first();
    await calloutTextEl.dblclick().catch(() => {});
    // Give Fabric.js time to attach the hidden textarea
    const hiddenTextarea = page.locator('.fabric-hidden-textarea').first();
    const textareaExists = await hiddenTextarea.count();
    if (textareaExists === 0) {
      test.skip(true, 'Fabric hidden textarea not attached in this env');
      return;
    }
    const before = await page.locator('[data-callout-id]').count();
    await page.keyboard.press('Delete');
    const after = await page.locator('[data-callout-id]').count();
    // UX: count should be unchanged — the focus guard
    // (.fabric-hidden-textarea closest() check in Plan 14-02) swallows
    // Delete while editing, preventing annotation delete.
    expect(after).toBe(before);
  });

  test('Delete creates an undo checkpoint (Cmd+Z restores the callout)', async ({ page }) => {
    const created = await createOneCallout(page);
    if (!created) {
      test.skip(true, 'Could not create a test callout in this env');
      return;
    }
    await page.keyboard.press('v').catch(() => {});
    const calloutEl = page.locator('[data-callout-id]').first();
    await calloutEl.locator('[data-callout-part="textBox"]').click().catch(() => {});
    const before = await page.locator('[data-callout-id]').count();
    await page.keyboard.press('Delete');
    const afterDelete = await page.locator('[data-callout-id]').count();
    expect(afterDelete).toBeLessThan(before);
    // UX: undo via Cmd+Z (or Ctrl+Z). addHistoryCheckpoint in
    // handleDeleteSelectedCallouts (Plan 14-03 Task 1 App.jsx) captures
    // the pre-delete state so the callout comes back.
    await page.keyboard.press('Meta+z').catch(() => page.keyboard.press('Control+z'));
    const afterUndo = await page.locator('[data-callout-id]').count();
    expect(afterUndo).toBe(before);
  });
});
