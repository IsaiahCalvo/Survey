/**
 * compactColorPickerLayout.test.mjs — the shared colour picker's panel and its
 * ONE bottom row, pinned to the approved pass-7 boards (17 phone grid, 18 phone
 * gradient, 19 desktop), 2026-09-21.
 *
 * CHANGED ASSERTIONS, and the ruling behind each:
 *   - standalone panel radius 8px -> 12px (board 19: the 276px panel is
 *     radius 12 with a 0 14px 32px shadow).
 *   - the opacity field was its own 72px box beside the hex box; the boards
 *     draw ONE joined 30px field holding eyedropper | # | hex | 42px opacity |
 *     %, so the 72px box and its 10px "%" are gone and the opacity input is the
 *     board's `width: '42px', flex: '0 0 42px'`.
 * The accessible name "Opacity percentage" is kept rather than the board's
 * terser "Opacity": a name is not a visual, and the longer one says more.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');

test('attached color picker joins its header without changing standalone corners', () => {
  assert.match(SOURCE, /attachedHeader\s*=\s*false/);
  assert.match(SOURCE, /borderTop:\s*attachedHeader\s*\?\s*'none'\s*:\s*undefined/);
  assert.match(SOURCE, /borderRadius:\s*attachedHeader\s*\?\s*'0 0 8px 8px'\s*:\s*'12px'/);
});

test('the panel is the board 19 panel: 276px desktop, full width on the phone', () => {
  assert.match(SOURCE, /width:\s*isPhone\s*\?\s*'100%'\s*:\s*'276px'/);
  assert.match(SOURCE, /boxShadow:\s*'0 14px 32px rgba\(0,0,0,0\.45\)'/);
  // The ring gaps are painted in the panel's own background, which is the
  // boards' --ui-toolbar. Nothing else makes a gap read as a gap.
  assert.match(SOURCE, /const panelBackground = 'var\(--surface-1\)'/);
});

test('the bottom row is one joined field: eyedropper, hex, then a 42px opacity box', () => {
  // The 64px Grid/Gradient toggle, then the field takes the rest.
  assert.match(SOURCE, /width:\s*'64px',\s*flex:\s*'0 0 64px'/);
  assert.match(SOURCE, /flex:\s*'1 1 0',\s*\n?\s*minWidth:\s*0,/);
  // The eyedropper is always drawn, in its own 34px cell on the field's left.
  assert.match(SOURCE, /aria-label="Pick a colour from the page"/);
  assert.match(SOURCE, /width:\s*'34px',\s*\n?\s*height:\s*'30px'/);
  // The opacity box and its percent sign close the field.
  assert.match(SOURCE, /aria-label="Opacity percentage"/);
  assert.match(SOURCE, /width:\s*'42px',\s*\n?\s*flex:\s*'0 0 42px'/);
  assert.match(SOURCE, /paddingRight:\s*'9px',\s*color:\s*'var\(--text-3\)',\s*flexShrink:\s*0/);
});

test('the presets row and the grid mark the chosen colour in its own colour, never gold', () => {
  // The ring colour and the check ink both come from the one shared module, so
  // a picker cell and a toolbar disc can never disagree about "chosen".
  assert.match(SOURCE, /import \{ swatchCheckInk, swatchRingColour, needsSwatchHairline, normaliseQuickColour \}/);
  assert.match(SOURCE, /0 0 0 1\.5px \$\{panelBackground\}, 0 0 0 3px \$\{swatchRingColour\(preset\)\}/);
  assert.match(SOURCE, /0 0 0 2px \$\{panelBackground\}, 0 0 0 3\.5px \$\{swatchRingColour\(/);
  assert.ok(
    !/var\(--accent/.test(SOURCE),
    'the picker must not reach for the brand gold at all: the chosen mark is the '
    + "swatch's own colour plus a check (owner, 2026-09-21)",
  );
});

test('the grid is the boards’ grid: 8 columns on the desktop, 12 on the phone', () => {
  assert.match(SOURCE, /const columns = isPhone \? 12 : 8/);
  assert.match(SOURCE, /const GRID_LIGHTNESS = \[88, 72, 56, 44, 32, 20\]/);
  assert.match(SOURCE, /const GRID_GREY_LIGHTNESS = \[100, 80, 60, 45, 25, 8\]/);
  assert.match(SOURCE, /const GRID_SATURATION = 85/);
});
