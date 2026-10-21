// Smart fill (beta): a tapped match survives a cancelled Categorize dialog,
// and matches leave once their source marker is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offeredSmartFillMatches, isSmartFillMatchSourceGone } from '../src/utils/smartFillMatches.js';

const a = { x: 0, y: 0, width: 10, height: 10 };
const b = { x: 50, y: 50, width: 10, height: 10 };

test('a match is hidden while a (pending) marker sits on it, and back after Cancel', () => {
  const pending = { annotationId: 'p1', x: 0, y: 0, width: 10, height: 10 };
  assert.deepEqual(offeredSmartFillMatches([a, b], [pending]), [b]);
  assert.deepEqual(offeredSmartFillMatches([a, b], []), [a, b]);
  assert.deepEqual(offeredSmartFillMatches([a, b], [null]), [a, b]);
});

test('matches go when their source marker leaves the page', () => {
  const src = { annotationId: 'm1', x: 100, y: 100, width: 10, height: 10 };
  assert.equal(isSmartFillMatchSourceGone('m1', [src]), false);
  assert.equal(isSmartFillMatchSourceGone('m1', []), true);
  assert.equal(isSmartFillMatchSourceGone('m1', [{ annotationId: 'm2' }]), true);
  assert.equal(isSmartFillMatchSourceGone(null, []), false);
});

test('SVG layer uses the helpers and clears matches when the source is gone', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /filterOfferedSmartFillMatches\(smartFillMatches, surveyMarkers\)/);
  const at = layer.indexOf('isSmartFillMatchSourceGone(smartFillMatchSourceRef.current, surveyMarkers)');
  assert.ok(at > 0);
  assert.match(layer.slice(at, at + 300), /setSmartFillMatches\(\[\]\)/);
});
