// Overlay layers (Drawboard Projects trial audit 2026-11-09, Nightly inside
// 'document-versions'): new red / old blue like Drawboard, an ink per layer,
// and an older layer that can be moved, scaled and turned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPARE_NEW_INK,
  COMPARE_OLD_INK,
  MAX_OVERLAYS,
  OVERLAY_INKS,
  clampOverlayScale,
  composeLayers,
  inkRgb,
  layerMatrix,
  makeOverlayLayer,
  nextFreeInk,
  normalizeRotation,
} from '../src/utils/versionCompare.js';

test('new is red and old is blue, as in Drawboard; a new layer takes a free ink', () => {
  assert.equal(COMPARE_NEW_INK, 'rgb(255, 0, 0)');
  assert.equal(COMPARE_OLD_INK, 'rgb(0, 87, 255)');
  assert.equal(OVERLAY_INKS.length, 5);
  assert.equal(nextFreeInk(['red']), 'blue');
  assert.equal(nextFreeInk(['red', 'blue']), 'green');
  assert.equal(nextFreeInk(OVERLAY_INKS.map((i) => i.key)), 'blue', 'all used: fall back to blue');
  assert.equal(inkRgb('nope'), COMPARE_NEW_INK);
  assert.deepEqual(makeOverlayLayer({ id: 'v1' }, ['red']), { version: { id: 'v1' }, ink: 'blue', visible: true, offset: { x: 0, y: 0 }, scale: 1, rotation: 0 });
  assert.equal(MAX_OVERLAYS, 3);
});

test('scale and turn stay in range', () => {
  assert.equal(clampOverlayScale(0.5), 0.5);
  assert.equal(clampOverlayScale(0), 1);
  assert.equal(clampOverlayScale('x'), 1);
  assert.equal(clampOverlayScale(50), 10);
  assert.equal(normalizeRotation(270), -90);
  assert.equal(normalizeRotation(-190), 170);
  assert.equal(normalizeRotation(360), 0);
  assert.equal(normalizeRotation('junk'), 0);
});

test('a layer is scaled and turned about the page centre, then moved', () => {
  const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const page = { pixelsPerPoint: 3, centerX: 50, centerY: 25 };
  assert.deepEqual(layerMatrix({ offset: { x: 2, y: -1 } }, page), [1, 0, 0, 1, 6, -3]);
  const turned = layerMatrix({ rotation: 90 }, page);
  assert.deepEqual(at(turned, 50, 25), [50, 25], 'the centre stays put');
  assert.deepEqual(at(turned, 60, 25), [50, 35], 'a point right of centre turns to below it');
  const half = layerMatrix({ scale: 0.5 }, page);
  assert.deepEqual(at(half, 100, 50), [75, 37.5]);
});

test('composeLayers draws the base, then each visible older layer multiplied with its own transform', () => {
  const ops = [];
  const ctx = {
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    setTransform: (...m) => ops.push(['transform', ...m]),
    fillRect: (...a) => ops.push(['fill', ctx.globalCompositeOperation, ...a]),
    drawImage: (img, x, y) => ops.push(['draw', img, ctx.globalCompositeOperation, x, y]),
  };
  composeLayers(ctx, {
    width: 100,
    height: 50,
    base: 'NEW',
    layers: [{ canvas: 'OLD', offset: { x: 1, y: 0 } }, { canvas: null }],
    pixelsPerPoint: 2,
  });
  assert.deepEqual(ops, [
    'save',
    ['fill', 'source-over', 0, 0, 100, 50],
    ['draw', 'NEW', 'source-over', 0, 0],
    'save',
    ['transform', 1, 0, 0, 1, 2, 0],
    ['draw', 'OLD', 'multiply', 0, 0],
    'restore',
    'restore',
  ]);
});

test('the compare dialog offers the layer controls and gets every version', () => {
  const dialog = readFileSync(new URL('../src/components/VersionCompareDialog.jsx', import.meta.url), 'utf8');
  for (const label of ['label="Scale"', 'label="Turn"', 'label="X"', 'label="Y"', 'Lay over another version']) assert.ok(dialog.includes(label), label);
  assert.match(dialog, /composeLayers\(/);
  const button = readFileSync(new URL('../src/components/DocumentVersionsButton.jsx', import.meta.url), 'utf8');
  assert.match(button, /versions=\{state\.versions\} onClose=\{state\.closeCompare\}/);
});
