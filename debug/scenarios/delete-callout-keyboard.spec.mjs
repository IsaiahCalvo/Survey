import { test, expect } from '@playwright/test';

// KBD-01 E2E: Delete/Backspace with single-selected callout removes it
// from the store with undo support. Focus-guarded when text input focused.
//
// Plan 14-02 Task 3 un-skipped ONLY the input-focus-guard test. The four
// callout-selection tests remain skipped until Plan 14-03 wires the
// selectedCalloutIds state updates and the callout selection pointer
// dispatch in useSVGInteraction.

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
    // Verify the input stays focused (i.e., the key went to the input,
    // not to the annotation handler).
    await page.keyboard.press('Delete');

    const stillFocused = await page.evaluate(() => document.activeElement?.id);
    expect(stillFocused).toBe('test-input');
  });

  test.skip('Delete key removes selected callout', async () => {
    // Deferred to Plan 14-03 — requires callout selection state wiring
    // (selectedCalloutIds) + selectable callout render path.
  });

  test.skip('Backspace key removes selected callout', async () => {
    // Deferred to Plan 14-03 — requires callout selection state wiring.
  });

  test.skip('Delete is suppressed while typing in callout edit textarea', async () => {
    // Deferred to Plan 14-03 — requires callout edit-mode entry via
    // FabricEditCanvas + calloutEditAdapter.
  });

  test.skip('Delete creates an undo checkpoint', async () => {
    // Deferred to Plan 14-03 — requires end-to-end callout save pipeline
    // + saveAnnotationCheckpoint wiring for callouts.
  });
});
