import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeIntervals,
  keptRuns,
  segmentCircleInterval,
  segmentCapsuleIntervals,
  parseInkPath,
  segPoint,
  subSegment,
  subpathsToPathData,
  erasePathWithCapsules,
} from '../src/utils/inkEraser.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('mergeIntervals coalesces overlaps and keeps disjoint gaps', () => {
  assert.deepEqual(mergeIntervals([[0.5, 0.7], [0.1, 0.3], [0.65, 0.9]]),
    [[0.1, 0.3], [0.5, 0.9]]);
});

test('keptRuns complements erased intervals within [0,1]', () => {
  assert.deepEqual(keptRuns([[0.2, 0.4], [0.6, 0.8]]),
    [[0, 0.2], [0.4, 0.6], [0.8, 1]]);
  assert.deepEqual(keptRuns([[0, 1]]), []);
});

test('segmentCircleInterval: crossing, tangency counts, miss, containment', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 100, y: 0 };
  // circle centered above the line, radius reaches exactly to the line: tangent
  const tangent = segmentCircleInterval(p0, p1, { x: 50, y: 10 }, 10);
  assert.ok(tangent, 'rim tangency must count as touching');
  assert.ok(close(tangent[0], 0.5, 1e-3) && close(tangent[1], 0.5, 1e-3));
  // plain crossing: circle at (50,0) r=10 -> erased [0.4, 0.6]
  const cross = segmentCircleInterval(p0, p1, { x: 50, y: 0 }, 10);
  assert.ok(close(cross[0], 0.4) && close(cross[1], 0.6));
  // miss
  assert.equal(segmentCircleInterval(p0, p1, { x: 50, y: 20 }, 10), null);
  // whole segment inside a big circle
  const all = segmentCircleInterval(p0, p1, { x: 50, y: 0 }, 200);
  assert.ok(close(all[0], 0) && close(all[1], 1));
});

test('capsule body kills tunneling: cut BETWEEN two distant eraser samples', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 100, y: 0 };
  // Eraser jumped from (50,-40) to (50,40): end circles (r=10) never touch the
  // ink line, but the swept capsule crosses it at x=50.
  const e0 = { x: 50, y: -40 };
  const e1 = { x: 50, y: 40 };
  assert.equal(segmentCircleInterval(p0, p1, e0, 10), null, 'end circle alone misses');
  const ivs = segmentCapsuleIntervals(p0, p1, e0, e1, 10);
  assert.equal(ivs.length, 1, 'capsule body must cut');
  assert.ok(close(ivs[0][0], 0.4) && close(ivs[0][1], 0.6), `got ${ivs[0]}`);
});

test('parallel graze at exactly half-width cuts along the overlap', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 100, y: 0 };
  // capsule parallel to the ink, centerline 10 away, r=10: grazes the line
  const ivs = segmentCapsuleIntervals(p0, p1, { x: 20, y: 10 }, { x: 80, y: 10 }, 10);
  assert.ok(ivs.length >= 1, 'graze must register');
  assert.ok(ivs[0][0] <= 0.21 && ivs[0][1] >= 0.79, `got ${JSON.stringify(ivs)}`);
});

test('L-path middle bite splits into two subpaths at exact circle crossings', () => {
  const path = [['M', 0, 0], ['L', 100, 0]];
  const { pathData, changed } = erasePathWithCapsules(
    path, [{ a: { x: 50, y: 0 }, b: { x: 50, y: 0 } }], 10
  );
  assert.equal(changed, true);
  // Expect: M 0 0 L 40 0  M 60 0 L 100 0
  assert.equal(pathData.filter((c) => c[0] === 'M').length, 2);
  const [m1, l1, m2, l2] = pathData;
  assert.ok(close(l1[1], 40, 1e-3), `first piece ends at ${l1[1]}`);
  assert.ok(close(m2[1], 60, 1e-3), `second piece starts at ${m2[1]}`);
  assert.ok(close(m1[1], 0) && close(l2[1], 100));
});

test('Q-curve bite: survivors stay true Q segments lying on the original curve', () => {
  const path = [['M', 0, 0], ['Q', 50, 80, 100, 0]]; // symmetric arc, apex y=40
  const orig = parseInkPath(path)[0][0];
  const { pathData, changed } = erasePathWithCapsules(
    path, [{ a: { x: 50, y: 40 }, b: { x: 50, y: 40 } }], 12
  );
  assert.equal(changed, true);
  const kinds = pathData.map((c) => c[0]).join('');
  assert.ok(/^MQ+MQ+$/.test(kinds), `expected two Q runs, got ${kinds}`);
  // Every surviving endpoint must lie on the original curve (within tolerance
  // of the flattening used for interval-finding).
  const parsed = parseInkPath(pathData);
  for (const segs of parsed) {
    for (const seg of segs) {
      for (const pt of [seg.p0, seg.p1]) {
        let best = Infinity;
        for (let i = 0; i <= 200; i += 1) {
          const q = segPoint(orig, i / 200);
          best = Math.min(best, Math.hypot(q.x - pt.x, q.y - pt.y));
        }
        assert.ok(best < 0.35, `survivor endpoint ${JSON.stringify(pt)} off-curve by ${best}`);
      }
    }
  }
  // Gap endpoints sit at ~rEff from the eraser center.
  const gapEnd = parsed[0][parsed[0].length - 1].p1;
  const gapStart = parsed[1][0].p0;
  for (const pt of [gapEnd, gapStart]) {
    const d = Math.hypot(pt.x - 50, pt.y - 40);
    assert.ok(Math.abs(d - 12) < 0.6, `cut edge at distance ${d}, expected ~12`);
  }
});

test('idempotent: applying the same capsule twice changes nothing more', () => {
  const path = [['M', 0, 0], ['L', 100, 0]];
  const caps = [{ a: { x: 30, y: 0 }, b: { x: 45, y: 0 } }];
  const once = erasePathWithCapsules(path, caps, 8);
  const twice = erasePathWithCapsules(once.pathData, caps, 8);
  // Numerically identical modulo re-parse; compare serialized geometry closely.
  assert.equal(JSON.stringify(twice.pathData.map(c => c.map(v => typeof v === 'number' ? +v.toFixed(4) : v))),
    JSON.stringify(once.pathData.map(c => c.map(v => typeof v === 'number' ? +v.toFixed(4) : v))));
});

test('crumb filter drops sub-minimum pieces', () => {
  const path = [['M', 0, 0], ['L', 100, 0]];
  // bite [0.3,0.7] leaves 30-unit pieces; with minPieceLen=40 both drop
  const { pathData } = erasePathWithCapsules(
    path, [{ a: { x: 50, y: 0 }, b: { x: 50, y: 0 } }], 20, 40
  );
  assert.deepEqual(pathData, []);
});

test('fully erased -> empty path data', () => {
  const path = [['M', 40, 0], ['L', 60, 0]];
  const { pathData, changed } = erasePathWithCapsules(
    path, [{ a: { x: 50, y: 0 }, b: { x: 50, y: 0 } }], 30
  );
  assert.equal(changed, true);
  assert.deepEqual(pathData, []);
});

test('no touch -> changed false, original path returned untouched', () => {
  const path = [['M', 0, 0], ['Q', 25, 10, 50, 0]];
  const res = erasePathWithCapsules(path, [{ a: { x: 200, y: 200 }, b: { x: 210, y: 200 } }], 10);
  assert.equal(res.changed, false);
  assert.equal(res.pathData, path);
});

test('multi-subpath paths erase independently and round-trip', () => {
  const path = [['M', 0, 0], ['L', 100, 0], ['M', 0, 50], ['L', 100, 50]];
  const { pathData } = erasePathWithCapsules(
    path, [{ a: { x: 50, y: 50 }, b: { x: 50, y: 50 } }], 10
  );
  const parsed = parseInkPath(pathData);
  assert.equal(parsed.length, 3, 'first line intact + second line split in two');
  assert.ok(close(parsed[0][0].p0.y, 0) && close(parsed[0][0].p1.y, 0));
});

test('Z-closed subpath cuts like an open path with the closing edge', () => {
  const path = [['M', 0, 0], ['L', 100, 0], ['L', 100, 100], ['L', 0, 100], ['Z']];
  const { pathData, changed } = erasePathWithCapsules(
    path, [{ a: { x: 0, y: 50 }, b: { x: 0, y: 50 } }], 10
  );
  assert.equal(changed, true);
  // the closing left edge (0,100)->(0,0) gets bitten around y=50
  const parsed = parseInkPath(pathData);
  const totalSegs = parsed.reduce((n, s) => n + s.length, 0);
  assert.ok(totalSegs >= 4, 'rectangle sides survive except the bitten stretch');
});

test('subSegment exactness: sub-quadratic matches the original parameterization', () => {
  const seg = parseInkPath([['M', 0, 0], ['Q', 40, 90, 100, 10]])[0][0];
  const sub = subSegment(seg, 0.25, 0.75);
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    const a = segPoint(sub, t);
    const b = segPoint(seg, 0.25 + t * 0.5);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `mismatch at t=${t}`);
  }
});

test('subpathsToPathData round-trips through parseInkPath', () => {
  const path = [['M', 1, 2], ['Q', 3, 4, 5, 6], ['L', 7, 8], ['C', 9, 10, 11, 12, 13, 14]];
  const rt = subpathsToPathData(parseInkPath(path));
  assert.deepEqual(rt, path);
});

test('untouched tiny dot subpaths are PRESERVED (no crumb-filter deletion, no phantom change)', () => {
  // A pen-tap dot far from the eraser must survive even though it is far
  // shorter than minPieceLen — and the call must report changed:false.
  const dot = [['M', 0, 0], ['L', 0.3, 0]];
  const far = erasePathWithCapsules(dot, [{ a: { x: 40, y: 0 }, b: { x: 42, y: 0 } }], 10);
  assert.equal(far.changed, false);
  assert.equal(far.pathData, dot);
  // Multi-subpath: cutting one long subpath must not delete a distant dot.
  const multi = [['M', 0, 100], ['L', 100, 100], ['M', 200, 0], ['L', 200.3, 0]];
  const res = erasePathWithCapsules(multi, [{ a: { x: 50, y: 100 }, b: { x: 50, y: 100 } }], 10);
  assert.equal(res.changed, true);
  const dotKept = res.pathData.some((c, i) => c[0] === 'M' && c[1] === 200 && c[2] === 0);
  assert.ok(dotKept, `distant dot subpath must survive: ${JSON.stringify(res.pathData)}`);
});

test('paths outside the parser contract are left byte-identical (no silent geometry loss)', () => {
  const afterZ = [['M', 0, 0], ['L', 10, 0], ['Z'], ['L', 20, 0]];
  const r1 = erasePathWithCapsules(afterZ, [{ a: { x: 5, y: 0 }, b: { x: 5, y: 0 } }], 3);
  assert.equal(r1.changed, false);
  assert.equal(r1.pathData, afterZ);
  const exotic = [['M', 0, 0], ['A', 5, 5, 0, 0, 1, 10, 0]];
  const r2 = erasePathWithCapsules(exotic, [{ a: { x: 5, y: 0 }, b: { x: 5, y: 0 } }], 3);
  assert.equal(r2.changed, false);
  assert.equal(r2.pathData, exotic);
});
