// Speed 2026-10-22: a full undo checkpoint used to turn the whole document
// into one JSON string about nine times (~1 s per action on Package 2). The
// fingerprint is now built from its children's and cached for shared snapshot
// pages. These tests pin that it still means "same JSON": exact bytes, exact
// lazy text, equal only when the JSON is equal, and no stale cache for live
// (editable) objects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getHistoryFingerprint,
  historyFingerprintsEqual,
  historyValuesEqual,
  summarizeHistoryDelta,
} from '../src/utils/historyHelpers.js';
import { snapshotAnnotationPages } from '../src/utils/historySnapshotShare.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

const samples = [
  null,
  undefined,
  0,
  'text with "quotes" and \\ slashes',
  [1, undefined, () => 1, { a: NaN }],
  {},
  { a: 1, b: undefined, c: () => 1, d: null, [Symbol('s')]: 1, 'odd "key"': [{ x: { y: 'z' } }] },
  { when: new Date(0), map: new Map([[1, 2]]), nested: { toJSON: () => ({ replaced: true }) } },
  Object.assign(Object.create(null), { bare: { deep: [Infinity, -0] } }),
  { annotationsByPage: { 1: { objects: [{ type: 'path', path: [['M', 1, 2]] }], version: 1 } }, surveyMarkers: {}, spaces: [] },
];

test('fingerprint text and length match JSON.stringify exactly', () => {
  for (const value of samples) {
    const expected = JSON.stringify(value ?? null);
    const fingerprint = getHistoryFingerprint(value);
    assert.equal(fingerprint.serialized, expected);
    assert.equal(fingerprint.bytes, expected.length);
    assert.equal(typeof fingerprint.hash, 'string');
  }
});

test('equal JSON gives equal fingerprints; any change does not', () => {
  const base = { annotationsByPage: { 1: { objects: [{ left: 1 }] }, 2: { objects: [] } }, surveyMarkers: { m: { x: 1 } }, spaces: [] };
  assert.ok(historyValuesEqual(base, clone(base)));
  assert.equal(getHistoryFingerprint(base).hash, getHistoryFingerprint(clone(base)).hash);

  const variants = [
    (v) => { v.annotationsByPage[1].objects[0].left = 2; },
    (v) => { v.surveyMarkers.m.x = '1'; },
    (v) => { v.annotationsByPage[3] = { objects: [] }; },
    (v) => { delete v.spaces; },
    (v) => { v.spaces = {}; },
  ];
  for (const change of variants) {
    const next = clone(base);
    change(next);
    assert.equal(historyValuesEqual(base, next), JSON.stringify(base) === JSON.stringify(next));
    assert.equal(historyValuesEqual(base, next), false);
  }
  // Same keys, other order: other JSON, so not equal.
  assert.equal(historyValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
});

test('a shared snapshot page is fingerprinted once and reused', () => {
  const live = { 1: { objects: [{ left: 1 }] }, 2: { objects: [{ left: 2 }] } };
  const first = snapshotAnnotationPages(live, clone);
  const second = snapshotAnnotationPages({ ...live, 2: { objects: [{ left: 3 }] } }, clone);
  assert.equal(first[1], second[1]);
  assert.equal(getHistoryFingerprint(first[1]), getHistoryFingerprint(second[1]));
  assert.ok(!historyValuesEqual(first, second));
  assert.deepEqual(summarizeHistoryDelta({ annotationsByPage: first }, { annotationsByPage: second }).changedPagesPreview, ['2']);
});

test('a live object edited in place is not served a stale fingerprint', () => {
  const live = { objects: [{ left: 1 }] };
  const before = getHistoryFingerprint(live);
  live.objects[0].left = 2;
  const after = getHistoryFingerprint(live);
  assert.notEqual(before.hash, after.hash);
  assert.equal(after.serialized, JSON.stringify(live));
  assert.ok(!historyFingerprintsEqual(before, after));
});

test('the viewer compares checkpoints with historyFingerprintsEqual, not whole JSON strings', () => {
  const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(source, /historyFingerprintsEqual\(lastCheckpointFingerprint, currentFingerprint\)/);
  assert.doesNotMatch(source, /Fingerprint\??\.serialized\s*===/);
});
