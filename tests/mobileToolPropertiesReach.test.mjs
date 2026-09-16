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

test('the phone tool-properties bar fits its widest tool at 375px', () => {
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

  // The strip spans the viewport minus the rail; its own padding is what the
  // controls actually get.
  const band = (PHONE_WIDTH - railWidth) - padLeft - padRight;

  // Arrow's controls, using only sizes the stylesheet/JSX declare. The
  // "Arrowhead on both ends" toggle is a text button whose width is not
  // declared here, so it is LEFT OUT - the row already overflows without it.
  const controls = [
    controlHeight, // colour swatch is a square of the shared control height
    dropdownWidth, // Width field
    dropdownWidth, // Border style
    arrowheadMinWidth, // Arrowhead style
  ];
  const needed = controls.reduce((sum, w) => sum + w, 0) + gap * (controls.length - 1);

  assert.ok(
    needed <= band,
    `the Arrow tool-properties row needs ${needed}px but only ${band}px is available at `
    + `${PHONE_WIDTH}px wide; a centred row loses ${((needed - band) / 2).toFixed(1)}px off each `
    + 'end, which puts the colour swatch behind the tool rail',
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
