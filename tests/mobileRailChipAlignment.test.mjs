import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pxToken } from './helpers/cssTokens.mjs';

const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/*
 * Three phone-sweep contracts, all measured in the pane at 375x812 with the
 * fixture open (debug/fixtures/e2e/prog-07-form-fields.pdf, byte-padded):
 *
 * 1. The Text/Rectangle Select chip sits on the rail's column like every other
 *    chip. It painted at x 5.5, y 80 inside a wrapper correctly placed at
 *    4.5, 79 - the wrapper's 1px transparent border plus box-sizing: border-box
 *    left a 28px content box for a 30px chip - while Pan, Draw, Shapes, Text,
 *    the kebab and Version history all paint at x 4.5. Now 4.5, 79.
 * 2. The selection-mode caret's transparent pad does not own the chip's centre.
 *    With `inset-inline: -6px 0` the pad spanned x 19.5..33.5 over the chip's
 *    full height: document.elementFromPoint(20.5, 95) - the chip's exact centre
 *    - returned "Selection mode", and a probe grid found the caret owning 16 of
 *    the chip's 30px at every y. Now the chip owns its centre and its left 18px.
 * 3. The title group and the centred page cluster meet with a gutter instead of
 *    overlapping by 1px. Measured gap: -1px before, 7px after.
 */

const rulesFor = (selector) => {
  const bodies = [];
  for (const [, selectors, block] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((one) => one.trim() === selector)) bodies.push(block);
  }
  assert.ok(bodies.length, `${selector} rule not found`);
  return bodies;
};

const declared = (selector, property) => {
  let raw = null;
  for (const body of rulesFor(selector)) {
    const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body);
    if (match) raw = match[1].trim();
  }
  return raw;
};

const token = (name) => {
  const match = new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(css);
  assert.notEqual(match, null, `${name} must be declared in px`);
  return Number(match[1]);
};

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-22, board 7 owner ruling). Contracts 1
 * and 2 above both described the Select chip's SPLIT BUTTON - the wrapper that
 * had to carry no border, and the caret pad that must not own the chip's
 * centre. The owner removed the split button entirely: "Remove the caret, the
 * popover menu and its state... The chip becomes a plain 28px rail chip like
 * the others; armed = gold glyph only." The wrapper's inset ring WAS the gold
 * box he reported, so the old test's "it still needs its active outline"
 * assertion now asserts the defect. Both are replaced by one contract that
 * says the split button is gone, which is what keeps it from coming back.
 */
test('the Select chip is a plain rail chip - no wrapper, no caret, no gold box', () => {
  for (const selector of [
    '.mobile-pdf-tools__select-family',
    '.mobile-pdf-tools__select-caret',
    '.mobile-pdf-select-mode__menu',
  ]) {
    assert.equal(
      css.includes(selector),
      false,
      `${selector} is still styled. The Select chip is a plain rail chip now: the wrapper's `
      + 'inset accent ring was the gold border box the owner reported around the armed chip, '
      + 'and the caret opened the pop-up he asked to delete.',
    );
  }

  // The one state an armed rail chip is allowed: the glyph turns gold.
  const armed = rulesFor('.mobile-pdf-tools__button.is-active').join('\n');
  assert.match(armed, /color:\s*var\(--accent\)/, 'an armed rail chip turns its glyph gold');
  assert.doesNotMatch(
    armed,
    /box-shadow|border-color:\s*var\(--accent|background:\s*(?!transparent)/,
    'armed is the gold glyph ONLY - no fill, no border, no box',
  );
});

// The first declaration, which is the base rule - the @media (max-width: 340px)
// branch further down overrides both of these with a fixed pair of its own and
// is a separate, unmeasured case.
const declaredBase = (selector, property) => {
  for (const body of rulesFor(selector)) {
    const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body);
    if (match) return match[1].trim();
  }
  return null;
};

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-17, phone header pass). Owner ruling,
 * testing the phone build: "The page navigation, '2 / 99', doesn't fit
 * properly; it needs to fit 3 digits, a slash, and 3 digits perfectly." The
 * page pill is now sized from "999 / 999" rather than from 68px, so the cluster
 * this test measures against is 152px wide, not the 124px the old constant
 * named - and the title cap is a calc over the cluster token rather than a
 * literal, precisely so the two can never disagree again.
 *
 * What the test guards is unchanged and is now stricter: a clamped title must
 * still stop short of the cluster's left edge, AT WHATEVER WIDTH the pill is,
 * because the cluster half and the cap are both resolved from the stylesheet's
 * own tokens instead of being repeated here. The literal-only shape of the cap
 * is the one assertion that had to go; it was never the contract.
 */
test('the title group stops short of the centred page cluster', () => {
  const root = /:root\s*\{([^}]*)\}/.exec(css)[1];
  // prev + gap + pill + gap + next, centred, so its left edge is 50% - half.
  const clusterHalf = pxToken(root, '--mobile-page-cluster-w') / 2;
  const left = Number(/^(\d+(?:\.\d+)?)px$/.exec(declaredBase('.mobile-pdf-header__document', 'left'))?.[1]);
  const cap = String(declaredBase('.mobile-pdf-header__document', 'max-width'));

  // calc(50% - <inset>), where the inset may itself be a calc over tokens.
  const insetSource = /^calc\(50% - (.+)\)$/.exec(cap)?.[1];
  assert.notEqual(insetSource, undefined, `the title cap must be calc(50% - <inset>) (got ${cap})`);
  const inset = pxToken(`--probe: ${insetSource};\n${root}`, '--probe');

  const gap = inset - left - clusterHalf;
  assert.ok(
    gap >= 0,
    `a clamped title ends ${-gap}px INSIDE the page cluster, which paints over it (z 3 vs 2). `
    + `The cap resolves to 50% - ${inset}px and the group starts at ${left}px, against a cluster `
    + `whose left edge is 50% - ${clusterHalf}px.`,
  );
  // The gutter the owner asked for is the group's own left inset, both sides.
  assert.equal(gap, left, `the title should keep a ${left}px gutter before the cluster, not ${gap}px`);
});
