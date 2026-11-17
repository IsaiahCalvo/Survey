import test from 'node:test';
import assert from 'node:assert/strict';
import { keepOnScreenFit } from '../src/utils/keepOnScreen.js';
import { placeHangingPopover } from '../src/components/useHangingPopoverPlace.js';
import { nestPageMenuItems, buildPageMenuItems, buildCanvasPageItems } from '../src/sidebar/pageMenuItems.js';

test('a menu inside the window is left alone', () => {
  assert.deepEqual(keepOnScreenFit({ rect: { left: 100, top: 100, width: 200, height: 300 }, viewportWidth: 1280, viewportHeight: 800 }),
    { dx: 0, dy: 0, maxHeight: null, maxWidth: null });
});

test('a menu past the bottom right slides back in', () => {
  const fit = keepOnScreenFit({ rect: { left: 1200, top: 700, width: 200, height: 300 }, viewportWidth: 1280, viewportHeight: 800 });
  assert.equal(fit.dx, 1280 - 8 - 200 - 1200);
  assert.equal(fit.dy, 800 - 8 - 300 - 700);
});

test('a menu taller than the window is capped and sits 8px from the top', () => {
  const fit = keepOnScreenFit({ rect: { left: 10, top: 127, width: 180, height: 674 }, viewportWidth: 1280, viewportHeight: 500 });
  assert.equal(fit.maxHeight, 484);
  assert.equal(fit.dy, 8 - 127);
});

test('a menu off the top comes down', () => {
  const fit = keepOnScreenFit({ rect: { left: 10, top: -40, width: 180, height: 200 }, viewportWidth: 1280, viewportHeight: 800 });
  assert.equal(fit.dy, 48);
});

const bar = { left: 400, top: 120, right: 700, bottom: 156, width: 300, height: 36 };
const bounds = { left: 0, top: 104, right: 1232, bottom: 800 };

test('the Line card flips below the bar when there is no room above it', () => {
  const place = placeHangingPopover({ barRect: bar, width: 196, height: 297, preferred: 'above', bounds });
  assert.equal(place.side, 'below');
  assert.equal(place.maxHeight, null);
});

test('the Line card keeps its side when it fits', () => {
  const low = { ...bar, top: 600, bottom: 636 };
  assert.equal(placeHangingPopover({ barRect: low, width: 196, height: 297, preferred: 'above', bounds }).side, 'above');
});

test('the Line card scrolls on the roomier side when neither fits', () => {
  const mid = { ...bar, top: 300, bottom: 336 };
  const place = placeHangingPopover({ barRect: mid, width: 196, height: 600, preferred: 'above', bounds: { ...bounds, bottom: 600 } });
  assert.equal(place.side, 'below');
  assert.ok(place.maxHeight > 0 && place.maxHeight < 600);
});

test('the Line card slides in from the window edge', () => {
  const edge = { ...bar, left: 1100, right: 1240, width: 140 };
  const place = placeHangingPopover({ barRect: edge, width: 196, height: 100, preferred: 'below', bounds });
  assert.equal(place.dx, Math.round((1232 - 8 - 196) - (1170 - 98)));
});

test('the page menu nests its rarer rows into submenus', () => {
  const available = Object.fromEntries(['cut', 'copy', 'paste', 'duplicate', 'insertBlank', 'rotate', 'mirror', 'reset', 'delete', 'selectAll', 'pasteInPlace', 'setScale', 'selectText', 'unlockAll', 'move'].map((k) => [k, true]));
  const flat = [
    { key: 'pasteMarks', label: 'Paste', icon: 'paste' },
    ...buildCanvasPageItems({ available }),
    { key: 'sep-marks', separator: true },
    ...buildPageMenuItems({ pageNumber: 3, pageCount: 5, available, move: { canUp: true, canDown: true } }),
  ];
  const rows = nestPageMenuItems(flat);
  const keys = rows.map((r) => r.key);
  assert.deepEqual(keys, ['header', 'pasteMarks', 'pasteInPlace', 'selectAll', 'unlockAll', 'setScale', 'sep-nest-1', 'insertPage', 'copyMovePage', 'rotatePage', 'sep-nest-2', 'delete']);
  assert.equal(rows.find((r) => r.key === 'delete').label, 'Delete page');
  assert.deepEqual(rows.find((r) => r.key === 'copyMovePage').submenu.map((r) => r.key), ['cut', 'copy', 'pasteAbove', 'pasteBelow', 'duplicate', 'moveUp', 'moveDown']);
  // Every action of the flat list is still there.
  const all = rows.flatMap((r) => (r.submenu ? r.submenu : [r])).filter((r) => !r.separator && !r.header).map((r) => r.key).sort();
  const want = flat.filter((r) => !r.separator && !r.header).map((r) => r.key).sort();
  assert.deepEqual(all, want);
});

test('a submenu with one row shows that row plainly', () => {
  const rows = nestPageMenuItems([{ key: 'insertAbove', label: 'Blank page above' }, { key: 'delete', label: 'Delete' }]);
  assert.deepEqual(rows.map((r) => r.key), ['insertAbove', 'sep-nest-1', 'delete']);
});
