// Owner 2026-10-06 (smooth zoom on heavily marked drawings): a moved-only path
// mark is drawn with its move written into the path data instead of its own
// SVG transform (src/utils/svgPathBake.js). The drawn geometry must be exactly
// the same.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pureTranslationOf, translatePathSegmentsToD } from '../src/utils/svgPathBake.js';

const SVG_LAYER = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

// Absolute end points of a d string (enough to compare two equivalent paths).
function endPoints(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  const out = [];
  let x = 0; let y = 0; let sx = 0; let sy = 0; let cmd = null; let i = 0;
  const num = () => Number(tokens[i++]);
  const size = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
  let first = true;
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const up = cmd.toUpperCase();
    const rel = cmd !== up && !(first && up === 'M');
    if (up === 'Z') { x = sx; y = sy; out.push([x, y]); continue; }
    const a = Array.from({ length: size[up] }, num);
    if (up === 'H') x = rel ? x + a[0] : a[0];
    else if (up === 'V') y = rel ? y + a[0] : a[0];
    else { const nx = a[a.length - 2]; const ny = a[a.length - 1]; x = rel ? x + nx : nx; y = rel ? y + ny : ny; }
    if (up === 'M') { sx = x; sy = y; }
    out.push([x, y]);
    first = false;
  }
  return out;
}

test('only a pure move is written into the path', () => {
  assert.deepEqual(pureTranslationOf([1, 0, 0, 1, 435.89575, 537.173109375]), { tx: 435.89575, ty: 537.173109375 });
  assert.equal(pureTranslationOf([2, 0, 0, 2, 0, 0]), null, 'scaled: keeps its transform (stroke width scales with it)');
  assert.equal(pureTranslationOf([0, 1, -1, 0, 5, 5]), null, 'turned');
  assert.equal(pureTranslationOf([1, 0.2, 0, 1, 0, 0]), null, 'skewed');
  assert.equal(pureTranslationOf([1, 0, 0, 1, NaN, 0]), null);
  assert.equal(pureTranslationOf(null), null);
});

test('absolute commands move every coordinate by the translation', () => {
  const path = [['M', 0.3, 0.79], ['L', 0.66, 0.94], ['C', 1.13, 1.12, 1.57, 1.01, 2.05, 0.92], ['Q', 1, 1, 2, 2], ['H', 3], ['V', 4], ['A', 5, 6, 30, 0, 1, 7, 8], ['Z']];
  const d = translatePathSegmentsToD(path, 100, 200);
  assert.equal(d, 'M 100.3 200.79 L 100.66 200.94 C 101.13 201.12 101.57 201.01 102.05 200.92 Q 101 201 102 202 H 103 V 204 A 5 6 30 0 1 107 208 Z');
});

test('relative commands ride along, except a path\'s first moveto', () => {
  const path = [['m', 1, 2], ['l', 3, 4], ['c', 1, 1, 2, 2, 3, 3], ['z'], ['m', 5, 5], ['h', 2], ['v', -1]];
  const d = translatePathSegmentsToD(path, 10, 20);
  assert.equal(d, 'm 11 22 l 3 4 c 1 1 2 2 3 3 z m 5 5 h 2 v -1');
  const original = endPoints('m 1 2 l 3 4 c 1 1 2 2 3 3 z m 5 5 h 2 v -1');
  const moved = endPoints(d);
  original.forEach(([x, y], k) => {
    assert.ok(Math.abs(moved[k][0] - (x + 10)) < 1e-9 && Math.abs(moved[k][1] - (y + 20)) < 1e-9, `point ${k}`);
  });
});

test('moved paths land exactly where the transform put them (random ink)', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let run = 0; run < 25; run += 1) {
    const path = [['M', rnd() * 50, rnd() * 50]];
    for (let k = 0; k < 20; k += 1) {
      path.push(rnd() < 0.5
        ? ['L', rnd() * 50, rnd() * 50]
        : ['C', rnd() * 50, rnd() * 50, rnd() * 50, rnd() * 50, rnd() * 50, rnd() * 50]);
    }
    path.push(['Z']);
    const tx = rnd() * 2000 - 1000; const ty = rnd() * 2000 - 1000;
    const baked = endPoints(translatePathSegmentsToD(path, tx, ty));
    const local = endPoints(path.map((s) => s.join(' ')).join(' '));
    local.forEach(([x, y], k) => {
      assert.ok(Math.abs(baked[k][0] - (x + tx)) < 1e-6 && Math.abs(baked[k][1] - (y + ty)) < 1e-6);
    });
  }
});

test('anything not fully understood keeps its transform', () => {
  assert.equal(translatePathSegmentsToD([], 1, 1), null);
  assert.equal(translatePathSegmentsToD([['M', 0, 0], ['X', 1, 1]], 1, 1), null);
  assert.equal(translatePathSegmentsToD([['M', 0, 0], ['L', 1]], 1, 1), null, 'odd argument count');
  assert.equal(translatePathSegmentsToD([['M', 0, 0], ['L', 1, NaN]], 1, 1), null);
  assert.equal(translatePathSegmentsToD([['M', 0, 0]], Infinity, 1), null);
  assert.equal(translatePathSegmentsToD('M 0 0', 1, 1), null);
});

test('the SVG layer bakes only plain moved paths and keeps hit target and halo on the ink', () => {
  assert.match(SVG_LAYER, /const translation = pureTranslationOf\(createInkPathAffine\(obj, obj\?\.path\)\.matrix\);/);
  assert.match(SVG_LAYER, /const baked = renderElement\.type === 'path'/);
  assert.match(SVG_LAYER, /d=\{targetD\}\s*\n\s*transform=\{targetTransform\}\s*\n\s*stroke="#4a90e2"/);
  assert.match(SVG_LAYER, /d=\{targetD\}\s*\n\s*transform=\{targetTransform\}\s*\n\s*fill=\{inkHitProps \? inkHitProps\.fill : 'none'\}/);
});
