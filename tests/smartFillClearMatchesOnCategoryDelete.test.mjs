// Smart fill (beta): deleting a category must drop leftover blue match outlines
// found from its marker, and keep matches found from another category's marker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SMART_FILL_CLEAR_MATCHES_EVENT,
  notifySmartFillCategoriesDeleted,
  shouldClearSmartFillMatches,
} from '../src/survey/smartFillMatchEvents.js';

test('notify dispatches the clear-matches event with deleted categories and markers', () => {
  const target = new EventTarget();
  let seen = null;
  target.addEventListener(SMART_FILL_CLEAR_MATCHES_EVENT, (e) => { seen = e.detail; });
  assert.equal(notifySmartFillCategoriesDeleted(['c1'], ['m1', 'm2'], target), true);
  assert.deepEqual(seen, { categoryIds: ['c1'], markerIds: ['m1', 'm2'] });
});

test('notify is a no-op without a target', () => {
  assert.equal(notifySmartFillCategoriesDeleted(['c1'], [], null), false);
});

test('matches go only when their source marker is deleted, or when the source is unknown', () => {
  assert.equal(shouldClearSmartFillMatches('m1', ['m1']), true);
  assert.equal(shouldClearSmartFillMatches('m1', ['m2']), false);
  assert.equal(shouldClearSmartFillMatches('m1', []), false);
  assert.equal(shouldClearSmartFillMatches(null, []), true);
});

test('category delete notifies, and the SVG layer clears its matches on it', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const start = viewer.indexOf('const handleDeleteSurveyCategoryDefinition = useCallback(');
  const body = viewer.slice(start, viewer.indexOf('}, [', start));
  assert.match(body, /notifySmartFillCategoriesDeleted\(categoryIds, /);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  const at = layer.indexOf('window.addEventListener(SMART_FILL_CLEAR_MATCHES_EVENT');
  assert.ok(at > 0);
  const handler = layer.slice(layer.lastIndexOf('const onClear', at), at);
  assert.match(handler, /shouldClearSmartFillMatches\(smartFillMatchSourceRef\.current/);
  assert.match(handler, /setSmartFillMatches\(\[\]\)/);
});
