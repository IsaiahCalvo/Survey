import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/*
 * ADVERSARIAL VERIFICATION, 2026-09-16 (verify-icons-defects).
 *
 * The phone tool-settings strip (.mobile-pdf-properties) sits in a fixed box:
 * 375px screen - 44px tool rail - 8px/52px padding = 331px of usable width.
 * Several tools need more than that. Measured live in the Browser pane at
 * 375x812 with a real PDF open:
 *
 *   Arrow    content 416px in a 331px box
 *              "Solid Triangle" (arrowhead style) spans 253..377 - sliced at 375
 *              "Both ends"      spans 385..459.7 - entirely off the screen
 *   Callout  content 372px in a 331px box - "Text formatting" off at 385..416
 *   Text     content 372px in a 331px box - "Text formatting" off at 385..416
 *
 * The overflow cannot be reached. The strip itself is overflow-x: visible and
 * every ancestor that could scroll it (.mobile-pdf-work-area) is
 * overflow-x: hidden; setting scrollLeft leaves it at 0.
 *
 * The 2026-09-16 defect pass added `justify-content: safe center` here, which
 * correctly stopped the colour swatch being clipped off the LEFT edge. But
 * `safe` only moves the overflow to the other end - it does not make it
 * reachable, so the far end of the Arrow, Callout and Text strips is still
 * unusable on a phone. The sibling `--text` strip already solves this with
 * flex-start + its own scroll; the non-text strip has no equivalent.
 *
 * This test fails on purpose. It passes once the non-text strip can be scrolled
 * (or otherwise reach its overflowing controls) the way the text strip can.
 */

const CSS = new URL('../src/mobile/mobilePdfViewer.css', import.meta.url);

/** The declarations inside the first rule whose selector list matches. */
const ruleBody = (css, selectorTest) => {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectorTest(match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim())) return match[2];
  }
  return null;
};

const declaration = (body, property) => {
  if (!body) return null;
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
  return match ? match[1].trim() : null;
};

test('the phone tool-settings strip can reach controls that overflow it', async () => {
  const css = await readFile(CSS, 'utf8');

  // The text strip is the reference: it already scrolls its own overflow.
  const textStrip = ruleBody(css, (s) => s.includes('.mobile-pdf-properties--text') && !s.includes('--actions'));
  assert.ok(textStrip, '.mobile-pdf-properties--text rule not found');
  const textOverflow = declaration(textStrip, 'overflow-x') || declaration(textStrip, 'overflow');
  assert.match(
    String(textOverflow),
    /auto|scroll/,
    'the text strip is supposed to be the reference that scrolls its overflow',
  );

  /*
   * RULED CHANGE 2026-09-21 (pass 7, boards 1-7: "CENTRED ... it must NEVER
   * scroll and NEVER clip"). This used to demand the SAME scroll path on the
   * tool strip, because Arrow / Callout / Text overflowed a 331px box by up to
   * 85px. The approved boards fix that at the source instead: the quick width
   * chips come off the row, the arrowhead and the arrow ends move into the
   * tool's "..." sheet, and the widest remaining strip is 328px against a 331px
   * band. A reachability test for a row that fits would be guarding nothing, so
   * it asserts the reason it fits: no scroll, and every strip measured.
   * The measurement itself lives in tests/mobileToolPropertiesReach.test.mjs.
   */
  const base = ruleBody(css, (s) => s === '.mobile-pdf-properties');
  assert.ok(base, '.mobile-pdf-properties rule not found');
  const baseOverflow = declaration(base, 'overflow-x') || declaration(base, 'overflow');
  assert.match(
    String(baseOverflow),
    /visible/,
    'the tool strip must not scroll: it is measured to fit 375px, and a centred '
    + 'row with a scroll path would be back to losing its first control under the '
    + `tool rail (overflow is currently ${baseOverflow})`,
  );
  assert.match(
    String(declaration(base, 'justify-content')),
    /center/,
    'the boards centre this row',
  );
});
