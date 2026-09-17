import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('the Select chip sits on the rail column, not one pixel off it', () => {
  const border = declared('.mobile-pdf-tools__select-family', 'border');
  assert.match(
    String(border),
    /^0$|^none$/,
    'the Select wrapper is box-sizing: border-box, so any border on it shrinks its content '
    + `box and pushes the 30px chip off the rail's column (measured: chip at x 5.5 against `
    + `every sibling's 4.5). It declares "${border}".`,
  );

  // Its hover / focus-within / active outline has to paint somewhere.
  const active = rulesFor('.mobile-pdf-tools__select-family[data-active=\'true\']').join('\n');
  assert.match(
    active,
    /box-shadow:\s*inset/,
    'the Select wrapper still needs its active outline - draw it with an inset box-shadow, '
    + 'which paints where the border did without taking a pixel off the content box',
  );
});

test('the selection-mode caret does not own the middle of the Select chip', () => {
  const chip = token('--mobile-rail-chip');
  const caretWidth = Number(/^(\d+(?:\.\d+)?)px$/.exec(declared('.mobile-pdf-tools__select-caret', 'width'))?.[1]);
  assert.equal(Number.isFinite(caretWidth), true, 'the caret must declare a px width');
  assert.equal(declared('.mobile-pdf-tools__select-caret', 'right'), '0', 'the caret hugs the family\'s right edge');

  const pad = declared('.mobile-pdf-tools__select-caret::after', 'inset-inline');
  const start = Number(/^(-?\d+(?:\.\d+)?)px/.exec(String(pad))?.[1]);
  assert.equal(Number.isFinite(start), true, `the caret pad must declare inset-inline in px (got ${pad})`);

  // The caret is laid out against the family's padding box, which is the chip's
  // own box now that the wrapper carries no border.
  const padLeft = (chip - caretWidth) + start;
  assert.ok(
    padLeft >= chip / 2 + 2,
    `the caret's tap pad starts ${padLeft}px into a ${chip}px chip, which is on or past the `
    + `chip's own centre (${chip / 2}px). A tap on the middle of the tool's icon then opens the `
    + 'selection-mode menu instead of arming the tool.',
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

test('the title group stops short of the centred page cluster', () => {
  // The cluster is centred and measured 124px wide at 375 and 402; its left
  // edge is therefore 50% - 62. The title group starts at its own left inset.
  const CLUSTER_HALF = 62;
  const left = Number(/^(\d+(?:\.\d+)?)px$/.exec(declaredBase('.mobile-pdf-header__document', 'left'))?.[1]);
  const cap = declaredBase('.mobile-pdf-header__document', 'max-width');
  const inset = Number(/calc\(50% - (\d+(?:\.\d+)?)px\)/.exec(String(cap))?.[1]);
  assert.equal(Number.isFinite(inset), true, `the title cap must be calc(50% - Npx) (got ${cap})`);

  const gap = inset - left - CLUSTER_HALF;
  assert.ok(
    gap >= 0,
    `a clamped title ends ${-gap}px INSIDE the page cluster, which paints over it (z 3 vs 2). `
    + `The cap is calc(50% - ${inset}px) and the group starts at ${left}px, against a cluster `
    + `whose left edge is 50% - ${CLUSTER_HALF}px.`,
  );
});
