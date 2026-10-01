/**
 * Owner 2026-10-01 (iPhone): "Expanding a category with a single item (Door ->
 * 'Door 1', 4/4) sent the panel all the way to full height, though the one item
 * was already perfectly visible. The panel should grow only when expanded
 * content would be uncomfortable to see or would need scrolling."
 *
 * The one rule (useMobileSheetMotion planSheetReveal), in numbers taken from the
 * 390x844 phone: the Survey list shows y 455..738 at Standard, and Full adds
 * 298px. These pin: fits -> nothing moves; a short scroll that keeps the tapped
 * row in view -> scroll, stay at Standard; otherwise -> grow to Full (and
 * scroll only as far as still needed, the tapped row kept in view).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSheetReveal } from '../src/mobile/useMobileSheetMotion.js';

const STANDARD = { viewTop: 455, viewBottom: 738, fullGain: 298 };

test('content that already fits never moves the sheet (Door -> Door 1)', () => {
  // Doors row at 508, its one Survey Marker row ends at 594.
  assert.deepEqual(
    planSheetReveal({ ...STANDARD, anchorTop: 508, blockBottom: 594, scrollRoom: 0 }),
    { grow: false, scrollBy: 0 },
  );
});

test('a short overflow scrolls the list and the sheet stays at Standard', () => {
  // The last Access Control marker opens 90px past the bottom; the tapped row
  // is 230px below the top, the list can scroll 120px more.
  assert.deepEqual(
    planSheetReveal({ ...STANDARD, anchorTop: 685, blockBottom: 828, scrollRoom: 120 }),
    { grow: false, scrollBy: 90 },
  );
});

test('it grows only when scrolling would push the tapped row off the top', () => {
  // Tapped row 40px under the top, block 200px past the bottom: a scroll of
  // 200 would hide the row, Full shows it all.
  assert.deepEqual(
    planSheetReveal({ ...STANDARD, anchorTop: 495, blockBottom: 938, scrollRoom: 400 }),
    { grow: true, scrollBy: 0 },
  );
});

test('it grows when the list cannot scroll far enough', () => {
  assert.deepEqual(
    planSheetReveal({ ...STANDARD, anchorTop: 600, blockBottom: 800, scrollRoom: 10 }),
    { grow: true, scrollBy: 0 },
  );
});

test('taller than Full: grow, then scroll as far as still needed without hiding the tapped row', () => {
  // 500px past the bottom: Full shows 298 of it, 202 left; the row may rise 145.
  assert.deepEqual(
    planSheetReveal({ ...STANDARD, anchorTop: 600, blockBottom: 1238, scrollRoom: 900 }),
    { grow: true, scrollBy: 145 },
  );
});

test('a sheet that cannot grow (already at Full, or one height) only scrolls', () => {
  assert.deepEqual(
    planSheetReveal({ viewTop: 157, viewBottom: 738, fullGain: 0, anchorTop: 500, blockBottom: 800, scrollRoom: 94 }),
    { grow: false, scrollBy: 62 },
  );
  // ...and never scrolls the tapped row out of view.
  assert.deepEqual(
    planSheetReveal({ viewTop: 157, viewBottom: 738, fullGain: 0, anchorTop: 177, blockBottom: 1200, scrollRoom: 900 }),
    { grow: false, scrollBy: 20 },
  );
});

test('the rule lives in the shared hook, and the Survey panel asks it instead of forcing Full', () => {
  const hook = readFileSync(new URL('../src/mobile/useMobileSheetMotion.js', import.meta.url), 'utf8');
  const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
  assert.match(hook, /export function revealInSheet\(/);
  assert.match(hook, /export function endSheetReveal\(/);
  // Typing still always grows (the keyboard must never cover the field).
  assert.match(hook, /raiseFor\('typing'\)/);
  // It settles back only once every reason it grew for is gone, and never
  // after the user moved it.
  assert.match(hook, /if \(!grow\.reasons\.delete\(reason\) \|\| grow\.reasons\.size\) return;/);
  assert.match(hook, /if \(Math\.abs\(drag\.top - drag\.startTop\) >= 1\) forgetGrow\(\);/);
  assert.doesNotMatch(rail, /mobileAccordionOpen \? SHEET_DETENT_FULL/);
  assert.match(rail, /revealInSheet\(block, \{ anchor, scroll: was\.open \}\)/);
  assert.match(rail, /endSheetReveal\(list\)/);
});
