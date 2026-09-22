import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * RULED CHANGE 2026-09-21 (pass 7, boards 1-7).
 *
 * The owner approved one artboard per tool, and they are explicit about this bar:
 * "Strip: 36px painted band, controls 20px, discs 16px (22px button), 11px type,
 * gap 4px, divider side margin 5px; CENTRED; essentials only; it must NEVER
 * scroll and NEVER clip - if a strip does not fit at 375px, move the least
 * essential control into the ... sheet."
 *
 * So the question this file asks has flipped. It used to assert that the Arrow
 * row OVERFLOWS (and stays inside a scroll budget), because the 2026-09-17 quick
 * styles put four colour dots and three width chips on the front of every row and
 * pushed Arrow 269px past a 375px screen. Its own comment said what to do if that
 * ever came back inside the band: "take a new measurement and simplify this test
 * rather than leaving a scroll budget guarding a row that no longer scrolls".
 * That is what this is.
 *
 * Every strip is now measured, tool by tool, against the narrowest phone we
 * support AND the reference board width, out of the widths the stylesheet and the
 * boards declare. Nothing here may exceed its band.
 *
 * Measured at 375x812 and 390x844, every tool armed (see the table below): the
 * widest strip is the arrow's at 328px against a 331px band at 375px.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '..', 'src', 'mobile', 'mobilePdfViewer.css'), 'utf8');
const jsx = readFileSync(path.join(here, '..', 'src', 'mobile', 'MobilePdfViewerChrome.jsx'), 'utf8');

// The two widths the boards were drawn and judged at.
const PHONE_WIDTHS = [375, 390];

function tokenPx(name) {
  const match = css.match(new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`));
  assert.ok(match, `expected a px value for ${name} in mobilePdfViewer.css`);
  return Number(match[1]);
}

function ruleBody(selector) {
  const index = css.indexOf(`\n${selector} {`);
  assert.ok(index !== -1, `expected a "${selector}" rule in mobilePdfViewer.css`);
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const rail = tokenPx('--mobile-rail-w');
const gap = tokenPx('--mobile-strip-gap');
const dividerInset = tokenPx('--mobile-strip-divider-inset');
const disc = tokenPx('--mobile-strip-disc-button');
const widthPill = tokenPx('--mobile-strip-dropdown-w');
const linePill = tokenPx('--mobile-strip-linestyle-w');
const seriesPill = tokenPx('--mobile-strip-series-w');
const fontPill = tokenPx('--mobile-strip-font-w');
const fontSizePill = tokenPx('--mobile-strip-fontsize-w');
const control = tokenPx('--mobile-strip-control-h');

// A divider is a 1px hairline with its stated side margin on each side.
const divider = 1 + (2 * dividerInset);
// The colour group is four 22px discs (three presets + the rainbow custom one),
// 4px apart - the picker pass's QuickColourDots, at the board's sizes.
const colourGroup = (disc * 4) + (gap * 3);
// "Aa" and "..." are the two label-sized controls. Aa is 800 12px "Aa" inside 7px
// of padding either side; measured 30.5px in the pane at both widths. "..." is a
// 22px square. Both are rounded UP here so the budget is never flattered.
const aaButton = 31;
const moreButton = disc;

// Every strip, exactly as its board draws it. `null` marks a divider.
const STRIPS = {
  pen: [colourGroup, null, widthPill],
  highlighter: [colourGroup, null, widthPill],
  line: [colourGroup, null, widthPill, linePill],
  arrow: [colourGroup, null, widthPill, linePill, null, moreButton],
  rect: [disc, null, widthPill, linePill],
  ellipse: [disc, null, widthPill, linePill],
  polygon: [disc, null, widthPill, linePill],
  polyline: [disc, null, widthPill, linePill],
  counter: [disc, null, seriesPill],
  text: [disc, null, widthPill, linePill, null, aaButton],
  callout: [disc, null, widthPill, null, aaButton, moreButton],
  eraser: [100, null, widthPill],
  select: [150],
  /*
   * ADDED 2026-09-22 — the LIVE TEXT-EDIT strip, the one strip no board draws and
   * until now the one strip that scrolled instead of being measured:
   *   colour disc | divider | font | size | divider | B I U S | alignment
   * The old row was 361px of controls in a 331px band (a 20px colour disc, a 96px
   * font pill, a 44px numeric size box, four 28px format buttons and a 104px
   * "top left" alignment pill), so the alignment control sat off the right edge of
   * a 375, 390 and 402pt phone. B / I / U / S are one group of four control-height
   * buttons with NO gap between them, which is why they price as one part.
   */
  'text-edit': [control, null, fontPill, fontSizePill, null, control * 4, control],
};

const stripWidth = (parts) => parts.reduce((sum, part) => sum + (part ?? divider), 0)
  + (gap * (parts.length - 1));

test('every phone tool strip fits its band at 375 and 390, with nothing to scroll', () => {
  const base = ruleBody('.mobile-pdf-properties');
  const padWide = Number(base.match(/padding:\s*0 (\d+(?:\.\d+)?)px/)[1]);
  // The one narrow-screen step: a device-level layout rule, not a control
  // shrinking to fit (DESIGN-SYSTEM.md "Do not shrink one control to make one
  // toolbar fit. Adjust the device-level layout rule instead.").
  const narrow = css.slice(css.indexOf('@media (max-width: 380px)'));
  const padNarrow = Number(narrow.match(/padding-left:\s*(\d+(?:\.\d+)?)px/)[1]);

  const offenders = [];
  for (const viewport of PHONE_WIDTHS) {
    const pad = viewport <= 380 ? padNarrow : padWide;
    const band = (viewport - rail) - (2 * pad);
    for (const [tool, parts] of Object.entries(STRIPS)) {
      const needed = stripWidth(parts);
      if (needed > band) {
        offenders.push(`${tool} at ${viewport}px: ${needed}px of controls in a ${band}px band`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a phone tool strip does not fit, and the strip neither scrolls nor clips, so '
    + 'these controls are simply unreachable:\n  ' + offenders.join('\n  ')
    + '\nMove the least essential control into that tool\'s "..." sheet, as the '
    + 'boards do for the arrow (Arrowhead, Arrow ends) and the callout (line '
    + 'style). Do NOT shrink a control and do NOT give the bar a scroll path.',
  );
});

/*
 * MERGE GUARD 2026-09-21 (pass 7, integration of the phone and picker passes).
 *
 * The arithmetic above prices the colour cluster out of the PHONE's own tokens,
 * but the cluster itself is the shared component in
 * src/components/QuickStyleControls.css, which carries its own numbers. The two
 * passes were built side by side: the phone measured its strips against a 24px
 * placeholder button while the picker landed the board's 22px one, and a strip
 * that fits on paper at 22 but paints at 24 would clip four discs by 8px with no
 * scroll path to reach them. So the two numbers are pinned to each other here,
 * off the boards: a 16px disc inside a 22px button on a flat 4px gap
 * (boards 1-12).
 */
test('the shared colour cluster is the size the strip arithmetic prices it at', () => {
  const quickCss = readFileSync(
    path.join(here, '..', 'src', 'components', 'QuickStyleControls.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  // A rule may group several selectors (the 22px box is shared by the preset
  // disc and the combined swatch), so look inside the whole list.
  const quickPx = (selector, property) => {
    for (const match of quickCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!match[1].split(',').map((one) => one.trim()).includes(selector)) continue;
      const found = match[2].match(new RegExp(`${property}:[^;]*?(\\d+(?:\\.\\d+)?)px`));
      if (found) return Number(found[1]);
    }
    return assert.fail(`expected a px ${property} on "${selector}" in QuickStyleControls.css`);
  };

  assert.equal(
    quickPx('.quick-style__dot', 'width'),
    disc,
    'the shared disc button and --mobile-strip-disc-button must be the same 22px',
  );
  assert.equal(quickPx('.quick-style__swatch', 'width'), disc, 'the combined swatch shares that box');
  assert.equal(quickPx('.quick-style__dot-fill', 'width'), tokenPx('--mobile-strip-disc'), 'a 16px disc');
  assert.equal(quickPx('.quick-style--colours', 'gap'), gap, 'the cluster sits on the strip gap');
});

test('the strip is centred and has no scroll path, on every variant but the live text bar', () => {
  const base = ruleBody('.mobile-pdf-properties');
  assert.match(base, /justify-content:\s*center/);
  assert.match(base, /overflow:\s*visible/);
  assert.doesNotMatch(base, /overflow-x:\s*(auto|scroll)/);

  // The bar itself takes no pointer events, so the 8px of its box that lies over
  // the page hands those taps to the document; its children take them back. That
  // is what lets each control's pad reach the full 44px.
  assert.match(base, /pointer-events:\s*none/);
  assert.match(ruleBody('.mobile-pdf-properties > *'), /pointer-events:\s*auto/);
});

test('every strip control is hit at 44px, not at the 20px it paints', () => {
  // A 20px control centred in the painted 36px band sits 8px below the box top,
  // so a -12px pad reaches -4..40 - 44px of target inside a 44px box.
  assert.equal(tokenPx('--mobile-strip-control-h'), 20);
  // Both pad rules are grouped selectors, so find the declaration block that
  // FOLLOWS the selector wherever it appears in its list.
  const padBody = (selector) => {
    const at = css.indexOf(selector);
    assert.ok(at !== -1, `expected a pad rule mentioning ${selector}`);
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  };
  for (const selector of [
    '.mobile-pdf-properties__color::after',
    '.mobile-pdf-properties > .mobile-styled-select .mobile-styled-select__trigger::after',
  ]) {
    assert.match(
      padBody(selector),
      /inset-block:\s*-12px/,
      `${selector} must reach 44px: 20px of control plus 12px above and below`,
    );
  }

  // ADDED at the pass-7 integration. The colour cluster is the shared component,
  // whose own pad is a 28px circle - a smaller finger target than the pills beside
  // it - so the phone raises it here, and it is 26 x 44 rather than 44 x 44: the
  // discs sit on a 26px pitch, so a 44-wide box would overlap its neighbour and
  // hand the press to the wrong colour. Vertically -11px on a 22px control is 44.
  assert.match(css, /--quick-style-hit-inset:\s*-11px/, 'the discs reach 44px tall');
  for (const selector of [
    '.mobile-pdf-properties .quick-style--colours .quick-style__dot::after',
    '.mobile-pdf-properties .quick-style__swatch::after',
  ]) {
    const body = padBody(selector);
    assert.match(body, /inset-inline:\s*-2px/, `${selector} stops at half the 4px gap sideways`);
    assert.match(body, /border-radius:\s*0/, `${selector} is a rectangle, so the band's edges are live`);
  }
});

test('the strip carries only the controls its board draws', () => {
  // The quick width chips are off the row (owner: "Width is a dropdown ONLY - no
  // preset chips"), and the row no longer renders them.
  assert.doesNotMatch(jsx, /<QuickWidthPresets/, 'the width chips are off the phone strip');
  // Arrowhead and Arrow ends live in the "..." sheet (board 16), not on the strip.
  const stripStart = jsx.indexOf('role="toolbar" aria-label={`${tool || \'Annotation\'} settings`}');
  const stripEnd = jsx.indexOf('BOARD 16', stripStart);
  assert.ok(stripStart > 0 && stripEnd > stripStart, 'expected to find the strip and the sheet after it');
  const strip = jsx.slice(stripStart, stripEnd);
  assert.doesNotMatch(strip, /ariaLabel="Arrowhead"/, 'the arrowhead belongs to the "..." sheet');
  assert.doesNotMatch(strip, /ariaLabel="Arrow ends"/, 'the arrow ends belong to the "..." sheet');
  assert.doesNotMatch(strip, /Both ends/, 'the old "Both ends" text toggle is gone');
});
