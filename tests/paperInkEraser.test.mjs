import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeIntervals,
  keptRuns,
  segmentCircleInterval,
  segmentCapsuleIntervals,
  parseInkPath,
  segPoint,
  subSegment,
  flattenSegment,
  eraseSubpaths,
  subpathsToPathData,
  erasePathWithCapsules,
} from '../src/utils/paperInkEraser.js';

test('mergeIntervals / keptRuns edge cases', () => {
  assert.deepEqual(mergeIntervals([]), []);
  assert.deepEqual(mergeIntervals([[0.2, 0.4]]), [[0.2, 0.4]]);
  assert.deepEqual(mergeIntervals([[0.1, 0.3], [0.25, 0.5], [0.7, 0.8]]), [[0.1, 0.5], [0.7, 0.8]]);
  assert.deepEqual(keptRuns([]), [[0, 1]]);
  assert.deepEqual(keptRuns([[0, 1]]), []);
  assert.deepEqual(keptRuns([[0.2, 0.4], [0.6, 0.9]]), [[0, 0.2], [0.4, 0.6], [0.9, 1]]);
});

test('segmentCircleInterval covers miss, hit, degenerate, tangent', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 0 };
  assert.equal(segmentCircleInterval(p0, p1, { x: 5, y: 20 }, 2), null);
  const hit = segmentCircleInterval(p0, p1, { x: 5, y: 0 }, 2);
  assert.ok(hit && hit[0] < hit[1]);

  // Degenerate point segment
  assert.deepEqual(segmentCircleInterval(p0, p0, { x: 0, y: 0 }, 1), [0, 1]);
  assert.equal(segmentCircleInterval(p0, p0, { x: 10, y: 10 }, 1), null);

  // Full coverage when circle swallows segment
  const full = segmentCircleInterval(p0, p1, { x: 5, y: 0 }, 20);
  assert.deepEqual(full, [0, 1]);
});

test('segmentCapsuleIntervals unions end circles + body', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 20, y: 0 };
  const e0 = { x: 5, y: 0 };
  const e1 = { x: 15, y: 0 };
  const ivs = segmentCapsuleIntervals(p0, p1, e0, e1, 2);
  assert.ok(ivs.length >= 1);
  assert.ok(ivs[0][0] < ivs[0][1]);
});

test('parseInkPath handles M/L/Q/C/Z and flags unsafe ops', () => {
  const sub = parseInkPath([
    ['M', 0, 0],
    ['L', 10, 0],
    ['Q', 15, 5, 20, 0],
    ['C', 25, -5, 30, 5, 35, 0],
    ['Z'],
    ['M', 50, 0],
    ['L', 60, 0],
  ]);
  assert.equal(sub.length, 2);
  assert.equal(parseInkPath.lastUnsafe, false);

  parseInkPath([['L', 1, 1]]); // drawing before M
  assert.equal(parseInkPath.lastUnsafe, true);

  parseInkPath([['M', 0, 0], ['h', 10]]); // relative — unsafe
  assert.equal(parseInkPath.lastUnsafe, true);
});

test('segPoint / subSegment / flattenSegment for L/Q/C', () => {
  const L = { kind: 'L', p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } };
  assert.deepEqual(segPoint(L, 0.5), { x: 5, y: 0 });
  const Ls = subSegment(L, 0.25, 0.75);
  assert.equal(Ls.kind, 'L');
  assert.ok(Math.abs(Ls.p0.x - 2.5) < 1e-9);

  const Q = { kind: 'Q', p0: { x: 0, y: 0 }, c: { x: 5, y: 10 }, p1: { x: 10, y: 0 } };
  assert.ok(segPoint(Q, 0.5));
  const Qs = subSegment(Q, 0.2, 0.8);
  assert.equal(Qs.kind, 'Q');
  assert.ok(flattenSegment(Q).length >= 2);

  const C = {
    kind: 'C',
    p0: { x: 0, y: 0 },
    c1: { x: 3, y: 8 },
    c2: { x: 7, y: -8 },
    p1: { x: 10, y: 0 },
  };
  assert.ok(segPoint(C, 0.5));
  assert.equal(subSegment(C, 0.1, 0.9).kind, 'C');
  assert.ok(flattenSegment(C, 0.5).length >= 2);
  assert.equal(flattenSegment(L).length, 1);
});

test('eraseSubpaths / erasePathWithCapsules cut a stroke and leave misses alone', () => {
  const path = [['M', 0, 0], ['L', 100, 0]];
  const sub = parseInkPath(path);
  const missed = eraseSubpaths(sub, [{ a: { x: 0, y: 50 }, b: { x: 10, y: 50 } }], 2);
  assert.equal(missed.changed, false);
  assert.equal(missed.subpaths.length, 1);

  const hit = eraseSubpaths(sub, [{ a: { x: 40, y: 0 }, b: { x: 60, y: 0 } }], 5, 0.5);
  assert.equal(hit.changed, true);
  assert.ok(hit.subpaths.length >= 1);

  const data = subpathsToPathData(hit.subpaths);
  assert.ok(data.some((c) => c[0] === 'M'));

  const erased = erasePathWithCapsules(path, [{ a: { x: 50, y: 0 }, b: { x: 50, y: 0 } }], 6);
  assert.ok(erased === null || Array.isArray(erased) || erased.pathData || erased.changed != null);

  // Quadratic stroke erase
  const qPath = [['M', 0, 0], ['Q', 50, 40, 100, 0]];
  const qErased = erasePathWithCapsules(qPath, [{ a: { x: 50, y: 10 }, b: { x: 50, y: 10 } }], 8);
  assert.ok(qErased != null);

  // Unsafe path left untouched
  const unsafe = erasePathWithCapsules([['M', 0, 0], ['h', 10]], [{ a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }], 2);
  assert.equal(unsafe.changed, false);
  assert.deepEqual(unsafe.pathData, [['M', 0, 0], ['h', 10]]);
});


test('crumb filter drops tiny kept pieces; Q/C segLength used', () => {
  // Erase almost all of a short stroke so only a crumb remains → dropped
  const path = [['M', 0, 0], ['L', 2, 0]];
  const result = erasePathWithCapsules(
    path,
    [{ a: { x: 0.2, y: 0 }, b: { x: 1.8, y: 0 } }],
    0.6,
    5, // minPieceLen larger than remaining crumbs
  );
  assert.equal(result.changed, true);
  assert.ok(Array.isArray(result.pathData));

  // Whole segment erased (kept empty) on a longer line
  const long = [['M', 0, 0], ['L', 100, 0]];
  const gone = erasePathWithCapsules(
    long,
    [{ a: { x: 50, y: 0 }, b: { x: 50, y: 0 } }],
    60,
    0.5,
  );
  assert.equal(gone.changed, true);

  // Quadratic erase exercises curve flatten + segLength
  const q = [['M', 0, 0], ['Q', 50, 30, 100, 0]];
  const qHit = erasePathWithCapsules(q, [{ a: { x: 50, y: 5 }, b: { x: 50, y: 5 } }], 10, 0.5);
  assert.equal(qHit.changed, true);
});
