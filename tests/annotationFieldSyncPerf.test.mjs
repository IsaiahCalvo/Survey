// Per-field sync (2026-09-24) — wall-clock numbers for the store: drag frame
// write time, a 5,000-mark recolour, and rebuilding the mark list. Runs on the
// non-blocking perf lane (scripts/ci-perf-tests.mjs): a loaded runner must
// never veto a deploy on a timing reading. Correctness lives in
// tests/annotationFieldSync.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  createViewerCaptureState,
  docToByPage,
  encodeSnapshot,
  recordViewerDelivery,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';

const rect = (id, extra = {}) => ({
  type: 'rect', left: 10, top: 20, width: 100, height: 50, fill: 'transparent', stroke: '#ff0000',
  strokeWidth: 2, opacity: 1, meta: { authorId: 'user-a' }, data: { id, type: 'shape', authorId: 'user-a' }, ...extra,
});
const polyline = (id) => ({
  type: 'polyline', left: 5, top: 5, width: 100, height: 10,
  points: [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }], pathOffset: { x: 50, y: 5 },
  stroke: '#0000ff', strokeWidth: 2, fill: 'transparent', meta: { authorId: 'user-a' }, data: { id, type: 'shape', authorId: 'user-a' },
});

// Minimal viewer: a screen captured into the store after every change.
function setup(objects) {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, { 1: { objects } });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
  const viewer = createViewerCaptureState();
  const peer = { doc, viewer, screen: docToByPage(doc) };
  recordViewerDelivery(viewer, peer.screen);
  syncByPageToDoc(doc, peer.screen, { viewer });
  peer.capture = () => syncByPageToDoc(doc, peer.screen, { viewer });
  peer.edit = (id, change) => {
    peer.screen = { ...peer.screen, 1: { ...peer.screen[1], objects: peer.screen[1].objects.map((o) => (o.data.id === id ? change(o) : o)) } };
    peer.capture();
  };
  return [peer];
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function bigPage(count) {
  const objects = [];
  for (let index = 0; index < count; index += 1) {
    objects.push(rect(`m${index}`, { left: index % 500, top: Math.floor(index / 500) * 20 }));
  }
  return objects;
}

test('performance: drag frame writes are small and fast; 5,000-mark recolour and list rebuild stay quick', () => {
  const stats = {};
  // Drag frames on a 5,000-mark page.
  const [A] = setup(bigPage(5000));
  const frameBytes = [];
  A.doc.on('update', (update) => { frameBytes.push(update.length); });
  const t0 = performance.now();
  for (let frame = 1; frame <= 30; frame += 1) {
    A.edit('m42', (o) => ({ ...o, left: 42 + frame, top: frame }));
  }
  stats.dragFrameMs = (performance.now() - t0) / 30;
  stats.dragFrameBytes = Math.max(...frameBytes);
  assert.ok(stats.dragFrameBytes < 80, `a rect drag frame writes two numbers (${stats.dragFrameBytes} bytes)`);

  // Polyline drag frame (geometry group, 50 points).
  const pts = Array.from({ length: 50 }, (_, index) => ({ x: index * 2, y: index % 7 }));
  const [P] = setup([{ ...polyline('pl'), points: pts }]);
  const polyBytes = [];
  P.doc.on('update', (update) => { polyBytes.push(update.length); });
  P.edit('pl', (o) => ({ ...o, left: o.left + 3 }));
  stats.polylineFrameBytes = polyBytes[0];

  // Recolour all 5,000 marks.
  const recolourBytes = [];
  A.doc.on('update', (update) => { recolourBytes.push(update.length); });
  const t1 = performance.now();
  A.screen = { ...A.screen, 1: { ...A.screen[1], objects: A.screen[1].objects.map((o) => ({ ...o, stroke: '#010203' })) } };
  A.capture();
  stats.recolour5000Ms = performance.now() - t1;
  stats.recolour5000Bytes = recolourBytes.reduce((sum, value) => sum + value, 0);

  // List rebuild: cold (no cache) and after one remote change.
  const cold = new Y.Doc();
  Y.applyUpdate(cold, Y.encodeStateAsUpdate(A.doc));
  const t2 = performance.now();
  docToByPage(cold);
  stats.rebuildColdMs = performance.now() - t2;
  const t3 = performance.now();
  docToByPage(cold);
  stats.rebuildWarmMs = performance.now() - t3;
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(cold));
  const otherView = docToByPage(other);
  const viewer = createViewerCaptureState();
  recordViewerDelivery(viewer, otherView);
  syncByPageToDoc(other, otherView, { viewer });
  let change = null;
  other.on('update', (update) => { change = update; });
  syncByPageToDoc(other, { 1: { ...otherView[1], objects: otherView[1].objects.map((o, i) => (i === 7 ? { ...o, stroke: '#999999' } : o)) } }, { viewer });
  Y.applyUpdate(cold, change);
  const t4 = performance.now();
  const rebuilt = docToByPage(cold);
  stats.rebuildAfterOneChangeMs = performance.now() - t4;
  assert.equal(rebuilt[1].objects[7].stroke, '#999999');
  stats.snapshotBytes5000 = encodeSnapshot(cold).length;

  console.log('[field-sync perf]', JSON.stringify(Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [key, Math.round(value * 100) / 100]),
  )));
  assert.ok(stats.rebuildAfterOneChangeMs < 250, `rebuild after one change ${stats.rebuildAfterOneChangeMs}ms`);
  assert.ok(stats.recolour5000Ms < 5000, `recolour ${stats.recolour5000Ms}ms`);
  assert.ok(stats.dragFrameMs < 50, `drag frame ${stats.dragFrameMs}ms`);
});
