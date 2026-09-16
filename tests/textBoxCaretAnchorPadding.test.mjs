/**
 * REGRESSION — the caret must land between the letters the user clicked in a
 * plain TEXT BOX, not one letter away.
 *
 * Measured live on claude/edit-modes-integration @ 2ebec3b3 (dev server, page
 * zoom 100%, textbox "ABCDEFGHIJKLMNOP" at the default 16px):
 *
 *   carrier  <g data-annotation-index="4">   left 513.8  width 183
 *   editor   contentEditable box             left 519.8  width 171
 *
 * The carrier is the WHOLE text box; the editor covers the box inset by
 * TEXT_PADDING (6 page units) on each side. buildCaretAnchor records the click
 * as a fraction of the carrier (both edit entries hand the carrier straight in
 * — useSVGInteraction's readCaretAnchor and PDFViewer's double-tap recogniser),
 * and TextEditOverlay re-resolves that fraction against the editor's own rect.
 * Because the two boxes differ by 2 * TEXT_PADDING in width, the caret is
 * displaced by up to +TEXT_PADDING at the left edge of the string and
 * -TEXT_PADDING at the right edge — over half a character at the default font,
 * which moves the caret a whole letter for any click near either end.
 *
 * Observed in the running app (offsets read from document.getSelection()):
 *   Pan @100%        click 4.2px into "A"  -> offset 1, expected 0
 *   Rectangle Select click 2.2px into "A"  -> offset 1, expected 0
 *   Rectangle Select click in "P"'s right half -> offset 15, expected 16
 *   Lasso Select     click 1.2px into "A"  -> offset 1, expected 0
 *   Text Select      click 1.2px into "A"  -> offset 1, expected 0
 *   Pan @195%        click 4.3px into "A"  -> offset 1, expected 0
 *
 * A CALLOUT is unaffected: caretAnchorHostFor narrows its carrier to
 * [data-callout-part="text"], which is the same box the editor covers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCaretAnchor, resolveCaretAnchorPoint } from '../src/utils/doubleTapEditEntry.js';

/** The <g data-annotation-index> carrier, as the edit entries hand it over. */
const CARRIER_RECT = { left: 513.8, top: 373.26, width: 183, height: 33 };
/** TextEditOverlay's contentEditable — the box the caret is resolved against. */
const EDITOR_RECT = { left: 519.8, top: 379.26, width: 171, height: 20.97 };
/** Client x of every character boundary of "ABCDEFGHIJKLMNOP" on the one line. */
const GLYPH_BOUNDARIES = [
  519.8, 530.47, 541.14, 552.7, 564.25, 574.92, 584.7, 597.14,
  608.7, 613.14, 621.14, 631.81, 640.71, 654.04, 665.59, 678.04, 688.71,
];
const LINE_Y = 389;

const hostStub = (rect) => ({ getBoundingClientRect: () => rect });

/** The offset a caret at this client x resolves to — nearest glyph boundary. */
const offsetAt = (x) => {
  let best = 0;
  for (let i = 1; i < GLYPH_BOUNDARIES.length; i += 1) {
    if (Math.abs(x - GLYPH_BOUNDARIES[i]) < Math.abs(x - GLYPH_BOUNDARIES[best])) best = i;
  }
  return best;
};

/** Where the mounted editor actually drops the caret for a click at x. */
const caretOffsetFor = (x) => {
  const anchor = buildCaretAnchor({ x, y: LINE_Y, host: hostStub(CARRIER_RECT) });
  const point = resolveCaretAnchorPoint(anchor, EDITOR_RECT);
  return offsetAt(point.x);
};

test('the caret lands on the letter boundary the user clicked in a text box', () => {
  // Click 2.2px into "A" (10.67px wide): plainly the left edge of the string.
  assert.equal(caretOffsetFor(522), offsetAt(522), 'click on the first letter');
  // Click in the right half of the last letter "P".
  assert.equal(caretOffsetFor(686), offsetAt(686), 'click on the last letter');
  // Mid-string is already correct — kept so a fix cannot regress it.
  assert.equal(caretOffsetFor(600), offsetAt(600), 'click mid-string');
});

test('a text-box caret anchor is measured against the box the editor covers', () => {
  // The anchor must be expressed against the editor's own content box, so a
  // click anywhere on the glyph run re-resolves onto the same pixel.
  const anchor = buildCaretAnchor({ x: 522, y: LINE_Y, host: hostStub(CARRIER_RECT) });
  const point = resolveCaretAnchorPoint(anchor, EDITOR_RECT);
  assert.ok(
    Math.abs(point.x - 522) < 1,
    `caret point drifted ${(point.x - 522).toFixed(2)}px from the click`,
  );
});
