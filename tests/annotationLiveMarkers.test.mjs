// w53 (2026-09-28) — Survey Marker / spaces live lane (display only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_MARKER_MAX_ENTRIES,
  LIVE_MARKER_VERSION,
  buildLiveMarkerPayload,
  collectLiveMarkerOverlay,
  overlayLiveSurveyMarkers,
  parseLiveMarkerPayload,
} from '../src/services/annotationLiveMarkers.js';

const rec = (x) => ({ pageNumber: 1, bounds: { x, y: 1, width: 5, height: 5 }, moduleId: 'm' });

test('build → parse round trip (markers, deletes, spaces)', () => {
  const payload = buildLiveMarkerPayload({
    writerId: 'w1',
    clientSeq: 7,
    markers: new Map([['a', rec(3)], ['b', null]]),
    spaces: [{ id: 's1', name: 'Space' }],
  });
  assert.equal(payload.v, LIVE_MARKER_VERSION);
  const parsed = parseLiveMarkerPayload(JSON.parse(JSON.stringify(payload)), { ownWriterId: 'w2' });
  assert.deepEqual(parsed.markers.get('a'), rec(3));
  assert.equal(parsed.markers.get('b'), null);
  assert.deepEqual(parsed.spaces, [{ id: 's1', name: 'Space' }]);
});

test('nothing to send, too many markers, own messages and forgeries are dropped', () => {
  assert.equal(buildLiveMarkerPayload({ writerId: 'w', clientSeq: 1, markers: new Map() }), null);
  const many = new Map(Array.from({ length: LIVE_MARKER_MAX_ENTRIES + 1 }, (_, i) => [`k${i}`, rec(i)]));
  assert.equal(buildLiveMarkerPayload({ writerId: 'w', clientSeq: 1, markers: many }), null);
  const ok = buildLiveMarkerPayload({ writerId: 'w', clientSeq: 1, markers: new Map([['a', rec(1)]]) });
  assert.equal(parseLiveMarkerPayload(ok, { ownWriterId: 'w' }), null);
  assert.equal(parseLiveMarkerPayload({ ...ok, s: -1 }), null);
  assert.equal(parseLiveMarkerPayload({ ...ok, m: [{ k: 'a', r: 'x' }] }), null);
  assert.equal(parseLiveMarkerPayload({ ...ok, m: [{ k: 'a', r: rec(1) }, { k: 'a', d: 1 }] }), null);
  assert.equal(parseLiveMarkerPayload({ ...ok, m: undefined, sp: [{ name: 'no id' }] }), null);
});

test('the overlay keeps each marker newest and the newest spaces; the store is never changed', () => {
  const overlay = collectLiveMarkerOverlay([
    { receivedAt: 2, markers: new Map([['a', rec(9)]]), spaces: [{ id: 'new' }] },
    { receivedAt: 1, markers: new Map([['a', rec(1)], ['b', null]]), spaces: [{ id: 'old' }] },
  ]);
  assert.equal(overlay.markers.get('a').bounds.x, 9);
  assert.deepEqual(overlay.spaces, [{ id: 'new' }]);
  const store = { a: rec(0), b: rec(0), c: rec(0) };
  const drawn = overlayLiveSurveyMarkers(store, overlay.markers);
  assert.equal(drawn.a.bounds.x, 9);
  assert.equal(drawn.b, undefined);
  assert.equal(store.a.bounds.x, 0, 'the store copy is untouched');
  assert.equal(overlayLiveSurveyMarkers(store, new Map()), store);
});
