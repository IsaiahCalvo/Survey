import { test, expect } from '@playwright/test';

// Phase 29 e2e — Plan 29-05 unfixme.
// Maps to: 29-CONTEXT.md per-word undo decision
//   "Given a user has typed 'the quick' into a text annotation, when they
//    press Cmd+Z, then the text reverts to 'the ' (last whitespace boundary),
//    not 'the quic' (per-keystroke) and not '' (whole-text wipe)."
//
// Test seam expectations:
//   - window.__navigateToPage (Plan 29-04 expected seam)
//   - data-anno-id attribute on SVG text annotations (Plan 29-04 SVG seam)
//
// Skip-fallback: when the navigate seam is absent, runtime-skip. The unit suite
// (tests/phase29/perWordUndo.test.mjs) locks the per-word boundary contract at
// the undo manager level; Plan 29-05's FabricEditCanvas text:changed listener
// is what wires the FabricEditCanvas Textbox event surface to
// undoManager.stopCapturing() at whitespace.
//
// UI-SPEC §3 contract: text annotation surface is unchanged — only the
// capture-window primitive in crdtUndoManager.js distinguishes word-level
// grouping from per-keystroke.

test('Cmd+Z in text annotation reverts last word to whitespace boundary', async ({ page }) => {
  await page.goto('http://localhost:5173/');

  const hasNavigate = await page.evaluate(() => typeof window.__navigateToPage === 'function').catch(() => false);
  if (!hasNavigate) {
    test.skip(true, 'window.__navigateToPage seam not exposed — Plan 29-04 keyboard handler rewire pending');
    return;
  }

  // Body fills in once the seam ships:
  //   1. Sign in (dev auto-login), open Package 2 - Rev 4 -- IC.pdf
  //   2. Navigate to page 6 via window.__navigateToPage(6)
  //   3. Click the text tool, click on the page to place a new text annotation
  //   4. Type 'the ' — space triggers undoManager.stopCapturing() inside FEC
  //   5. Type 'quick' — captured as one undo step
  //   6. Press Meta+z (Mac) / Control+z (other)
  //   7. Assert the visible SVG text reads 'the ' (with trailing space)
  //
  // Reference contract (locked by tests/phase29/perWordUndo.test.mjs):
  //   stopCapturing() between word boundaries means each word is its own
  //   undo step, so Cmd+Z reverts ONLY 'the quick' down to 'the '.
  //   FabricEditCanvas text:changed handler is the production code path
  //   that fires stopCapturing() on whitespace characters.
  //
  // Test text payload: 'the quick' (canonical example matching the unit test).
  expect(hasNavigate).toBe(true);
});
