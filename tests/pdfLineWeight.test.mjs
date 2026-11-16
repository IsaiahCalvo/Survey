// Ignore PDF line weight (Nightly 'thin-lines'; Drawboard "Ignore line weight").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PDF_LINE_WEIGHT_KEY,
  applyUniformLineWeight,
  isIgnoreLineWeightOn,
  loadIgnoreLineWeight,
  setIgnoreLineWeight,
  uniformLineWeightKeySuffix,
  uniformLineWidthFor,
} from '../src/utils/pdfLineWeight.js';

const memory = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('saved on this device; blocked storage reads as off', () => {
  const s = memory();
  assert.equal(loadIgnoreLineWeight(s), false);
  setIgnoreLineWeight(true, { storage: s });
  assert.equal(s.m.get(PDF_LINE_WEIGHT_KEY), 'uniform');
  assert.equal(loadIgnoreLineWeight(s), true);
  assert.equal(loadIgnoreLineWeight({ getItem() { throw new Error('blocked'); } }), false);
  setIgnoreLineWeight(false, { storage: s });
});

test('one canvas pixel at any zoom, rotation or flip', () => {
  assert.equal(uniformLineWidthFor({ a: 1, b: 0, c: 0, d: 1 }), 1);
  assert.equal(uniformLineWidthFor({ a: 4, b: 0, c: 0, d: -4 }), 0.25);
  const r = Math.SQRT1_2 * 2;
  assert.ok(Math.abs(uniformLineWidthFor({ a: r, b: r, c: -r, d: r }) - 0.5) < 1e-9);
  assert.equal(uniformLineWidthFor({ a: 0, b: 0, c: 0, d: 0 }), 1);
  assert.equal(uniformLineWidthFor(null), 1);
});

test('strokes follow the live switch and keep the drawing\'s own width afterwards', () => {
  const seen = [];
  const ctx = {
    lineWidth: 7,
    getTransform: () => ({ a: 2, b: 0, c: 0, d: 2 }),
    stroke() { seen.push(this.lineWidth); },
    strokeRect() { seen.push(this.lineWidth); },
  };
  applyUniformLineWeight(ctx);
  applyUniformLineWeight(ctx); // once only
  const s = memory();
  setIgnoreLineWeight(false, { storage: s });
  ctx.stroke();
  setIgnoreLineWeight(true, { storage: s });
  assert.equal(isIgnoreLineWeightOn(), true);
  assert.equal(uniformLineWeightKeySuffix(), '~uniform-lines');
  ctx.stroke();
  ctx.strokeRect(0, 0, 1, 1);
  assert.deepEqual(seen, [7, 0.5, 0.5]);
  assert.equal(ctx.lineWidth, 7);
  setIgnoreLineWeight(false, { storage: s });
  assert.equal(uniformLineWeightKeySuffix(), '');
});

test('the viewer wraps its page and tile canvases and keys their cache by the look', () => {
  const src = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.equal(src.match(/if \(isIgnoreLineWeightOn\(\)\) applyUniformLineWeight\(ctx\);/g)?.length, 2);
  assert.match(src, /uniformLineWeightKeySuffix\(\)/);
  const card = readFileSync(new URL('../src/components/ThinLinesMenu.jsx', import.meta.url), 'utf8');
  assert.match(card, /Ignore line weight/);
});
