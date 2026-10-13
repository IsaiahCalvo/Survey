// Owner 2026-10-02: while drawing a Spaces area on the desktop, the Add /
// Subtract sign is a small badge 12px right and down of the crosshair, drawn
// as part of ONE cursor image so it moves with the system pointer and never
// trails it (it used to be a floating DOM "+" that looked like a second
// crosshair and lagged a fast sweep).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  areaDrawCursor,
  AREA_CURSOR_HOTSPOT,
  AREA_CURSOR_BADGE_OFFSET,
  AREA_CURSOR_ADD_COLOR,
  AREA_CURSOR_SUBTRACT_COLOR,
} from '../src/utils/areaDrawCursor.js';

const svgOf = (cursor) => decodeURIComponent(cursor.match(/url\("data:image\/svg\+xml,([^"]+)"\)/)[1]);

test('the add and subtract cursors are one image: crosshair + offset badge, crosshair fallback', () => {
  const add = areaDrawCursor('add');
  const sub = areaDrawCursor('subtract');
  assert.notEqual(add, sub);
  for (const cursor of [add, sub]) {
    assert.match(cursor, new RegExp(`\\) ${AREA_CURSOR_HOTSPOT} ${AREA_CURSOR_HOTSPOT}, crosshair$`));
  }
  assert.equal(AREA_CURSOR_BADGE_OFFSET, 12);
  const centre = AREA_CURSOR_HOTSPOT + AREA_CURSOR_BADGE_OFFSET;
  assert.match(svgOf(add), new RegExp(`<circle cx="${centre}" cy="${centre}"`));
  assert.match(svgOf(add), new RegExp(`stroke="${AREA_CURSOR_ADD_COLOR}"`));
  assert.match(svgOf(sub), new RegExp(`stroke="${AREA_CURSOR_SUBTRACT_COLOR}"`));
  // plus has a vertical stroke, minus does not
  assert.match(svgOf(add), new RegExp(`M${centre} ${centre - 3}V${centre + 3}`));
  assert.doesNotMatch(svgOf(sub), new RegExp(`M${centre} ${centre - 3}V`));
  // red is the app's --danger
  const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, new RegExp(`--danger: ${AREA_CURSOR_SUBTRACT_COLOR};`));
});

test('RegionSelectionTool uses the cursor image and no floating DOM sign', () => {
  const src = readFileSync(new URL('../src/RegionSelectionTool.jsx', import.meta.url), 'utf8');
  assert.match(src, /areaDrawCursor\(effectiveSelectionMode === REGION_OPERATIONS\.SUBTRACT \? 'subtract' : 'add'\)/);
  assert.doesNotMatch(src, /addIndicatorRef|subtractIndicatorRef/);
  assert.doesNotMatch(src, /Floating (Plus|Minus) Sign Indicator/);
});
