// Imported ink polygons rebuilt only when read (2026-11-10): a read mark's
// derived polygons are the same numbers as before to every kind of reader,
// and no reader that skips them (box, viewer bookkeeping) builds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DERIVED_POLYGONS_MARKER,
  derivePolygonsFromPath,
  fromStoredMarkObject,
  toStoredMarkObject,
} from '../src/services/annotationMarkCodec.js';
import { getAnnotationBBox } from '../src/utils/svgBoundingBox.js';
import { createViewerCaptureState, recordViewerDelivery } from '../src/services/annotationDocStore.js';

const path = [['M', 0, 0], ['L', 40, 0], ['L', 40, 12], ['L', 0, 12], ['Z']];
const stored = () => ({
  type: 'path',
  left: 5,
  top: 6,
  path,
  fill: '#000',
  stroke: null,
  polygons: DERIVED_POLYGONS_MARKER,
  data: { id: 'ink-1', type: 'path' },
});

test('every reader sees the same polygons as an eager rebuild', () => {
  const expected = derivePolygonsFromPath(path, 'nonzero');
  assert.ok(Array.isArray(expected) && expected.length > 0);
  assert.deepEqual(fromStoredMarkObject(stored()).polygons, expected, 'direct read');
  assert.deepEqual({ ...fromStoredMarkObject(stored()) }.polygons, expected, 'spread');
  assert.deepEqual(JSON.parse(JSON.stringify(fromStoredMarkObject(stored()))).polygons, expected, 'JSON');
  assert.deepEqual(structuredClone(fromStoredMarkObject(stored())).polygons, expected, 'structured clone');
  assert.ok(Object.keys(fromStoredMarkObject(stored())).includes('polygons'), 'listed as a key');
  assert.deepEqual(toStoredMarkObject(fromStoredMarkObject(stored())).polygons, DERIVED_POLYGONS_MARKER, 'stores back as the marker');
});

test('read once, then a plain data property; writes and deletes work', () => {
  const mark = fromStoredMarkObject(stored());
  const first = mark.polygons;
  assert.equal(mark.polygons, first, 'the same array each read');
  assert.ok('value' in Object.getOwnPropertyDescriptor(mark, 'polygons'), 'settled to a data property');
  const other = fromStoredMarkObject(stored());
  other.polygons = [];
  assert.deepEqual(other.polygons, [], 'a write before any read wins');
  const gone = fromStoredMarkObject(stored());
  delete gone.polygons;
  assert.equal('polygons' in gone, false);
  const frozen = Object.freeze(fromStoredMarkObject(stored()));
  assert.deepEqual(frozen.polygons, first, 'a frozen copy still answers');
});

test('a box and the viewer bookkeeping do not build them', () => {
  const mark = fromStoredMarkObject(stored());
  getAnnotationBBox(mark);
  getAnnotationBBox({ ...stored(), polygons: undefined, angle: 30 });
  const rotated = fromStoredMarkObject({ ...stored(), angle: 30 });
  getAnnotationBBox(rotated);
  recordViewerDelivery(createViewerCaptureState(), { 1: { objects: [mark] } });
  for (const target of [mark, rotated]) {
    assert.equal('value' in Object.getOwnPropertyDescriptor(target, 'polygons'), false, 'still not built');
  }
});
