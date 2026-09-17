import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Every control on the phone's tool-properties bar has to be reachable with a
 * finger on the narrowest phone we support (375 x 812 - iPhone SE / mini
 * class, and the size the 2026-09-16 sizing pass was judged at).
 *
 * The bar is a CENTRED flex row with no horizontal scroll path
 * (`justify-content: center` + `overflow: visible`). A centred row that is
 * wider than its box is clipped by half the excess at EACH end, so the moment
 * the row outgrows the box the FIRST control walks off the left - underneath
 * the 40px tool rail (rail z-index 5750 beats the strip's 5700) and then off
 * the screen entirely. There is no way to scroll it back.
 *
 * The rich-text variant of the same bar already carries this exact bug report
 * in its own comment ("A centred overflowing flex row clips equal width from
 * both ends; on a 390px phone that put Font color left of the rail with no
 * scroll path back to it") and fixes it with `justify-content: flex-start` +
 * `overflow-x: auto`. The default variant never got the same treatment.
 *
 * Measured in the app on claude/ux-polish at 375x812 (Arrow armed):
 *   Fill/border colour swatch   x = -19.8 .. 4.2   -> entirely off-screen
 *   Width field                 x =  12.2 .. 92.2  -> left 27.8px under the rail
 *   Border style                x = 100.2 .. 180.2
 *   Arrowhead style             x = 188.2 .. 312.2
 *   Arrowhead on both ends      x = 320.2 .. 394.8 -> right 19.8px off-screen
 * Callout at the same width puts its colour swatch at x = 1.8 .. 25.8, fully
 * behind the rail (document.elementFromPoint returns the Pan rail button).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(here, '..', 'src', 'mobile', 'mobilePdfViewer.css');
const jsxPath = path.join(here, '..', 'src', 'mobile', 'MobilePdfViewerChrome.jsx');
const css = readFileSync(cssPath, 'utf8');
const jsx = readFileSync(jsxPath, 'utf8');

const PHONE_WIDTH = 375;

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

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-17, quick styles).
 *
 * This test used to assert that the Arrow row FITS the 279px band with no
 * scrolling at all. The owner's quick-styles ruling of 2026-09-17 adds four
 * default colour dots and three default line widths to the front of this row
 * and says of the phone: "same order in the 36px strip at 24px controls - if it
 * overflows 279px the strip already scrolls; measure and report the total
 * width." So overflowing the band is now the sanctioned behaviour, not the
 * defect, and "fits" is no longer the thing to assert.
 *
 * What stays load-bearing, and what this file now asserts instead:
 *   - the row is measured, and its widest tool stays inside a stated budget,
 *     so nobody can widen it further without reading this number and taking a
 *     new measurement on a phone;
 *   - the row can always be scrolled back to whatever it pushes off (the test
 *     below, unchanged) - which is the ONLY reason overflow is acceptable.
 *
 * Measured in the app at 375x812 on 2026-09-17, Arrow armed, on this branch:
 *   quick colours  95.0   swatch 24.0   quick widths 84.0
 *   Width field    80.0   Border style 80.0   Arrowhead 80.0
 *   Arrowhead on both ends 74.7
 *   content 547.7 in a 279px band -> 269px of scroll, last control reachable,
 *   first dot at rest at x=48 (clear of the 40px rail).
 */
const SCROLL_BUDGET = 560;

test('the phone tool-properties bar measures its widest tool and stays inside its scroll budget', () => {
  const railWidth = tokenPx('--mobile-rail-w');
  const controlHeight = tokenPx('--mobile-strip-control-h');
  const dropdownWidth = tokenPx('--mobile-strip-dropdown-w');

  const base = ruleBody('.mobile-pdf-properties');
  const gap = Number(base.match(/gap:\s*(\d+(?:\.\d+)?)px/)[1]);
  // `padding: 0 calc(var(--mobile-rail-w) + 8px) 0 8px` - the last value is
  // the left inset, and the right inset is the rail plus that same inset.
  const padding = base.match(/padding:\s*([^;]+);/)[1];
  const padLeft = Number(padding.trim().match(/(\d+(?:\.\d+)?)px$/)[1]);
  const padRight = railWidth + padLeft;

  const arrowheadMinWidth = Number(
    jsx.match(/ariaLabel="Arrowhead style"\s*\n\s*minWidth=\{(\d+)\}/)[1],
  );

  // The quick styles that now open the row, read off their own stylesheet.
  const quickCss = readFileSync(path.join(here, '..', 'src', 'components', 'QuickStyleControls.css'), 'utf8');
  const quickPx = (selector, property) => {
    const index = quickCss.indexOf(`\n${selector} {`);
    assert.ok(index !== -1, `expected a "${selector}" rule in QuickStyleControls.css`);
    const body = quickCss.slice(quickCss.indexOf('{', index) + 1, quickCss.indexOf('}', quickCss.indexOf('{', index)));
    const match = body.match(new RegExp(`${property}:[^;]*?(\\d+(?:\\.\\d+)?)px`));
    assert.ok(match, `expected a px ${property} on ${selector}`);
    return Number(match[1]);
  };
  const dot = quickPx('.quick-style__dot', 'width');
  const dotGap = quickPx('.quick-style--colours.quick-style--phone', 'gap');
  const widthChip = quickPx('.quick-style__width', 'width');
  const quickColours = dot * 4 + dotGap * 3;
  const quickWidths = widthChip * 3; // flush: the trio reads as one control

  // The strip spans the viewport minus the rail; its own padding is what the
  // controls actually get.
  const band = (PHONE_WIDTH - railWidth) - padLeft - padRight;

  // Arrow's controls, using only sizes the stylesheets/JSX declare. The
  // "Arrowhead on both ends" toggle is a text button whose width is not
  // declared anywhere, so it is LEFT OUT of the arithmetic - it was measured
  // at 74.7 and is inside the budget's headroom.
  const controls = [
    quickColours,
    controlHeight, // colour swatch is a square of the shared control height
    quickWidths,
    dropdownWidth, // Width field
    dropdownWidth, // Border style
    arrowheadMinWidth, // Arrowhead style
  ];
  const needed = controls.reduce((sum, w) => sum + w, 0) + gap * (controls.length - 1);

  assert.ok(
    needed > band,
    `the Arrow row now needs ${needed}px against a ${band}px band; if it has come back `
    + 'inside the band, take a new measurement and simplify this test rather than leaving '
    + 'a scroll budget guarding a row that no longer scrolls',
  );
  assert.ok(
    needed <= SCROLL_BUDGET,
    `the Arrow tool-properties row needs ${needed}px, past its ${SCROLL_BUDGET}px budget. `
    + `The band at ${PHONE_WIDTH}px wide is ${band}px, so the user would have to scroll `
    + `${(needed - band).toFixed(1)}px to reach the last control. Widen the budget only after `
    + 'driving the row on a real phone and finding the far end still comfortable to reach.',
  );
});

test('the phone tool-properties bar can scroll back to a control it has pushed off', () => {
  const base = ruleBody('.mobile-pdf-properties');
  const centred = /justify-content:\s*center/.test(base);
  const scrolls = /overflow-x:\s*auto/.test(base) || /overflow:\s*auto/.test(base);

  // Either anchor the row at its start (so overflow only ever leaves the far
  // end, which a scroll can reach) or give it a scroll path - the rich-text
  // variant of this same bar does both.
  assert.ok(
    scrolls || !centred,
    'the default tool-properties bar centres its controls with no horizontal scroll path, '
    + 'so anything it overflows is clipped off the LEFT end, under the tool rail, with no '
    + 'way to reach it; .mobile-pdf-properties--text already fixes this with '
    + 'justify-content: flex-start + overflow-x: auto',
  );
});
