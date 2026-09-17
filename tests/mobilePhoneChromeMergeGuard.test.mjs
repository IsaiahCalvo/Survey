import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * REGRESSION GUARD (verify-pal-phone, 2026-09-17).
 *
 * main 1e5a18dc9 ("fit '999 / 999' in the page pill and centre the format
 * glyphs") added two STRUCTURAL properties to src/mobile/mobilePdfViewer.css:
 *
 *   .mobile-pdf-header__page-total          white-space: nowrap
 *   .mobile-pdf-text-defaults__format > btn display: grid; place-items: center
 *
 * claude/palette-v2 branched before that commit and rewrote both blocks for the
 * revision-2 palette. Merging the branch onto main therefore CONFLICTS in both
 * places, and the branch's own side of each conflict carries only the colour
 * change - it silently drops the structural property. Measured live in the pane
 * at 375x812 with the branch's side forced on:
 *
 *   display: block  ->  the B / I / U / S glyphs sit dy -1.50px above centre
 *                       (grid + place-items: center measures dx 0.00, dy 0.00)
 *
 * Nothing in the suite noticed, because 1e5a18dc9 shipped without a guard.
 * This test is that guard: it fails on the branch's own resolution and passes
 * on one that keeps main's structure alongside palette-v2's tokens.
 */

const CSS = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8');

const ruleBody = (selector) => {
  const at = CSS.indexOf(selector);
  assert.notEqual(at, -1, `missing rule for ${selector}`);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  assert.ok(open !== -1 && close !== -1, `unterminated rule for ${selector}`);
  return CSS.slice(open + 1, close);
};

test('the page pill total never wraps', () => {
  const body = ruleBody('.mobile-pdf-header__page-total');
  assert.match(
    body,
    /white-space:\s*nowrap/,
    'the "/ 999" half of the page pill must keep white-space: nowrap (main 1e5a18dc9); '
    + `rule body is "${body.trim()}"`,
  );
});

test('the text-defaults format buttons centre their glyph on the box, not a baseline', () => {
  const body = ruleBody('.mobile-pdf-text-defaults__format > button');
  assert.match(
    body,
    /display:\s*grid/,
    'B / I / U / S must stay display: grid (main 1e5a18dc9); a block button centres its '
    + `glyph on a font baseline and sits 1.5px high. Rule body is "${body.trim()}"`,
  );
  assert.match(
    body,
    /place-items:\s*center/,
    `B / I / U / S must keep place-items: center. Rule body is "${body.trim()}"`,
  );
});

test('the live strip format buttons centre the same way', () => {
  const body = ruleBody('.mobile-pdf-properties__format {');
  assert.match(body, /display:\s*grid/, `rule body is "${body.trim()}"`);
  assert.match(body, /place-items:\s*center/, `rule body is "${body.trim()}"`);
});

test('the page total and the format buttons paint tokens, not the old literals', () => {
  for (const selector of [
    '.mobile-pdf-header__page-total',
    '.mobile-pdf-text-defaults__format > button',
    '.mobile-pdf-properties__format {',
  ]) {
    const body = ruleBody(selector);
    for (const banned of ['#a8b0bf', '#f2f2f2', '#242a33', '#343a45', '#2a2218']) {
      assert.ok(
        !body.toLowerCase().includes(banned),
        `${selector} still paints the literal ${banned}; the revision-2 palette `
        + '(src/styles/tokens.css, owner approved 2026-09-17) owns these colours.',
      );
    }
  }
});
