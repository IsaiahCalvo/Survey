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
 *
 * 2026-09-22, owner's ONE-SCALE ruling (radii: pills 10, sheet tops 16,
 * popovers 9, cells 5, buttons 6 — and nothing else):
 *   - panel radius 12px / attached 0 0 8px 8px -> 9px / 0 0 9px 9px.
 *
 * RULED 2026-09-23 (owner: desktop picker smaller, slimmer — "too big ...
 * the sliders are way too thick, the input field is too thick, the text is too
 * thick"; then "put back those options, but shrink down the grid"):
 *   - the standalone desktop panel 276px -> 210px (the same 8 x 6 grid on
 *     20px cells: 8 * 20 + 7 * 4 = 188px of content, 10px padding, 1px edge);
 *   - its padding 12px -> 10px (the phone keeps 12);
 *   - the desktop bottom row gets its own slim sizes (a 24px row: 46px toggle,
 *     22px eyedropper, 24px opacity box). The 64 / 30 / 34 / 42 / 9 literals
 *     asserted below are the PHONE's board-17/18 row, which did not change;
 *     the desktop's sizes are asserted in their own test at the bottom.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/components/CompactColorPicker.jsx', import.meta.url), 'utf8');

test('attached color picker joins its header without changing standalone corners', () => {
  assert.match(SOURCE, /attachedHeader\s*=\s*false/);
  assert.match(SOURCE, /borderTop:\s*attachedHeader\s*\?\s*'none'\s*:\s*undefined/);
  // CHANGED 2026-09-22, owner's one-radius-scale ruling (pills 10, sheet tops
  // 16, popovers 9, cells 5, buttons 6): the panel was 12px standalone and
  // 0 0 8px 8px attached. A popover is 9, so both corners are 9 now.
  // CHANGED 2026-10-02 (owner, phone/desktop consistency): popover radius 8.
  assert.match(SOURCE, /borderRadius:\s*attachedHeader\s*\?\s*'0 0 8px 8px'\s*:\s*'8px'/);
});

test('the panel is 210px on the desktop (was board 19\'s 276px), full width on the phone', () => {
  // RULED 2026-09-23 (owner: the Templates entity color panel was "a box within
  // a box" and too big): a desktop host that paints the panel itself
  // (chrome={false}) gets a picker that fills it; a standalone desktop picker
  // is still the 276px board-19 panel.
  // RULED 2026-09-23 (owner: desktop picker smaller, slimmer): 276px -> 210px,
  // the 188px 8-column grid plus 10px padding and a 1px edge each side.
  assert.match(SOURCE, /width:\s*\(isPhone\s*\|\|\s*!chrome\)\s*\?\s*'100%'\s*:\s*`\$\{DESKTOP_PANEL_W\}px`/);
  assert.match(SOURCE, /const DESKTOP_CELL = 20;/);
  assert.match(SOURCE, /const DESKTOP_CONTENT_W = 8 \* DESKTOP_CELL \+ 7 \* 4;/);
  assert.match(SOURCE, /const DESKTOP_PANEL_W = DESKTOP_CONTENT_W \+ 2 \* 10 \+ 2;/);
  assert.match(SOURCE, /boxShadow:\s*chrome\s*\?\s*'0 14px 32px rgba\(0,0,0,0\.45\)'\s*:\s*'none'/);
  // A host that owns the phone bottom sheet turns the picker's own panel off so
  // the presets row runs edge to edge across the sheet's 358px band.
  assert.match(SOURCE, /chrome = true/);
  // RULED 2026-09-23 (owner: desktop picker smaller, slimmer): a standalone
  // desktop panel pads 10px (was 12); a standalone phone panel keeps 12.
  assert.match(SOURCE, /padding:\s*chrome\s*\?\s*\(isPhone\s*\?\s*'12px'\s*:\s*'10px'\)\s*:\s*0/);
  // The ring gaps are painted in the panel's own background, which is the
  // boards' --ui-toolbar. Nothing else makes a gap read as a gap.
  assert.match(SOURCE, /const panelBackground = 'var\(--surface-1\)'/);
});

test('the bottom row is one joined field: eyedropper, hex, then a 42px opacity box', () => {
  // The 64px Grid/Gradient toggle, then the field takes the rest.
  assert.match(SOURCE, /width:\s*'64px',\s*flex:\s*'0 0 64px'/);
  assert.match(SOURCE, /flex:\s*'1 1 0',\s*\n?\s*minWidth:\s*0,/);
  // The eyedropper is always drawn, in its own 34px cell on the field's left.
  assert.match(SOURCE, /aria-label="Pick a color from the page"/);
  /* DELIBERATE ASSERTION CHANGE (2026-09-22, desktop critic round). The cell is
     still 34px wide — that is what this line is for — but it no longer asks for
     a literal 30px height. The field around it is 30px with a 1px border, so its
     content box is 28: a 30px child overflowed by 2px and only `overflow:
     hidden` hid it, which made the eyedropper a THIRD height in a row that is
     meant to have one (the Grid/Gradient well came to 28, the field to 30).
     `height: '100%'` makes the cell exactly as tall as the field it sits in,
     whatever that field is, so the row cannot fall out of step again. The row's
     one height is now asserted on the well and the field below instead. */
  assert.match(SOURCE, /width:\s*'34px',[\s\S]{0,400}?height:\s*'100%'/);
  // ONE height across the bottom row: the toggle well matches the joined field.
  assert.match(SOURCE, /flex:\s*'0 0 64px',[\s\S]{0,200}?height:\s*'30px'/);
  assert.match(SOURCE, /const fieldChrome = \{\s*\n\s*height:\s*'30px'/);
  // The opacity box and its percent sign close the field.
  assert.match(SOURCE, /aria-label="Opacity percentage"/);
  assert.match(SOURCE, /width:\s*'42px',\s*\n?\s*flex:\s*'0 0 42px'/);
  assert.match(SOURCE, /paddingRight:\s*'9px',\s*color:\s*'var\(--text-3\)',\s*flexShrink:\s*0/);
});

test('the presets row and the grid mark the chosen colour in its own colour, never gold', () => {
  // The ring colour and the check ink both come from the one shared module, so
  // a picker cell and a toolbar disc can never disagree about "chosen".
  assert.match(SOURCE, /import \{ swatchCheckInk, swatchRingColour, needsSwatchHairline, normaliseQuickColour \}/);
  // RULED 2026-09-23 (owner: copy HeroUI's ColorSwatchPicker): the chosen
  // ring is now the item's 2px border in the swatch's own colour with the fill
  // shrunk to 77% inside it (src/styles/swatches.css), not a box-shadow gap.
  // The colour is still swatchRingColour, never gold.
  assert.match(SOURCE, /'--hero-swatch-ring': swatchRingColour\(preset\)/);
  assert.match(SOURCE, /'--hero-swatch-ring': swatchRingColour\(isTransparent/);
  assert.match(SOURCE, /data-selected=\{isSelected \? 'true' : 'false'\}/);
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

test('RULED 2026-09-23: every desktop picker takes one slim scale (thin sliders, a 24px row, lighter text)', () => {
  // One desktop scale for the canvas popover AND the Templates entity panel;
  // `dense` is a phone-only switch now (the Templates Entities sheet).
  assert.match(SOURCE, /const isDesktop = !isPhone;/);
  assert.match(SOURCE, /const dense = isPhone && denseLayout === true;/);
  // The same eight presets over the same eight columns, discs 20px on desktop.
  assert.match(SOURCE, /const columns = isPhone \? 12 : 8/);
  assert.match(SOURCE, /\.\.\.\(isDesktop \? \{ width: '20px', height: '20px' \} : null\)/);
  // Sliders: a 16px box to grab, 6px of paint, a 12px thumb inset by half.
  assert.match(SOURCE, /const HUE_TRACK_H = isDesktop \? 16 : \(dense \? 14 : 18\);/);
  assert.match(SOURCE, /const TRACK_PAINT_PAD = isDesktop \? 5 : 0;/);
  assert.match(SOURCE, /const THUMB_SIZE = isDesktop \? 12 : \(dense \? 12 : 16\);/);
  assert.match(SOURCE, /const THUMB_INSET = isDesktop \? 6 : \(dense \? 8 : 10\);/);
  // The bottom row: one 24px height, regular-weight 11px digits.
  assert.match(SOURCE, /\.\.\.\(isDesktop \? \{ height: '24px', font: `400 11px\/1 \$\{FONT\}` \} : null\)/);
  assert.match(SOURCE, /\.\.\.\(isDesktop \? \{ width: '46px', flex: '0 0 46px', height: '24px' \} : null\)/);
  assert.match(SOURCE, /\.\.\.\(isDesktop \? \{ width: '22px', flex: '0 0 22px' \} : null\)/);
  // RULED 2026-09-23 (owner, desktop: "100%" sat too close to the divider).
  // Was 24px; the opacity box is 29px so the divider moves left and "100" has
  // room both sides, inside the same row width and height.
  assert.match(SOURCE, /\.\.\.\(isDesktop \? \{ width: '29px', flex: '0 0 29px' \} : null\)/);
});
