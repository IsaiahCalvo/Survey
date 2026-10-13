// w25 (2026-09-24) — opening "Package 2 - Rev 4 -- IC.pdf" froze the page.
//
// Per-field sync stores every mark as a nested Y.Map, so one capture that
// writes hundreds of marks is thousands of structs, each pointing at its own
// mark's map. The outbox's causal-dependency scan decoded every pending
// record's whole update once per such reference (structs x records full
// decodes): 300 marks behind 10 pending records took ~90 s of blocking work.
// These tests pin the answers (same as the naive scan) and the work (each
// pending update decoded at most once, however many structs reference it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { __test } from '../src/services/annotationDocSync.js';
import { writeAnnotationMark } from '../src/services/annotationMarkStore.js';

const { causalDependenciesForUpdate, clockRangeDecodeCount } = __test;

const rect = (id, extra = {}) => ({
  type: 'rect', left: 10, top: 20, width: 100, height: 50, fill: 'transparent', stroke: '#ff0000',
  strokeWidth: 2, opacity: 1, meta: { authorId: 'user-a' }, data: { id, type: 'shape', authorId: 'user-a' }, ...extra,
});

// The scan as it was before w25 — the reference answer.
function naiveRanges(update) {
  const ranges = new Map();
  for (const struct of Y.decodeUpdate(update).structs) {
    const client = Number(struct.id?.client);
    const start = Number(struct.id?.clock);
    const end = start + Number(struct.length || 0);
    const existing = ranges.get(client);
    ranges.set(client, existing
      ? { start: Math.min(existing.start, start), end: Math.max(existing.end, end) }
      : { start, end });
  }
  return ranges;
}
function naiveCovering(records, client, clock, excludeKey) {
  for (const candidate of records) {
    if (candidate.key === excludeKey) continue;
    const range = naiveRanges(candidate.update).get(client);
    if (range && range.start <= clock && clock < range.end) return candidate.key;
  }
  return null;
}
function naiveDependencies(state, update, excludeKey = null) {
  const dependencies = new Set();
  const accepted = Y.decodeStateVector(Y.encodeStateVector(state.acceptedDoc));
  const records = [...state.appendRecords.values()];
  for (const [client, range] of naiveRanges(update)) {
    const acceptedClock = Number(accepted.get(client)) || 0;
    if (range.start > acceptedClock) {
      const dependency = naiveCovering(records, client, range.start - 1, excludeKey);
      if (dependency) dependencies.add(dependency);
    }
  }
  for (const struct of Y.decodeUpdate(update).structs) {
    for (const reference of [struct.origin, struct.rightOrigin, struct.parent]) {
      const client = Number(reference?.client);
      const clock = Number(reference?.clock);
      if (!Number.isFinite(client) || !Number.isFinite(clock)) continue;
      if (clock < (Number(accepted.get(client)) || 0)) continue;
      const dependency = naiveCovering(records, client, clock, excludeKey);
      if (dependency) dependencies.add(dependency);
    }
  }
  return [...dependencies].sort();
}

function captureUpdates(doc) {
  const updates = [];
  doc.on('update', (update) => updates.push(new Uint8Array(update)));
  return updates;
}

test('a bulk mark write behind pending records decodes each record once, not once per struct', () => {
  const doc = new Y.Doc();
  const updates = captureUpdates(doc);
  const PENDING = 10;
  const MARKS = 300;
  for (let r = 0; r <= PENDING; r += 1) {
    doc.transact(() => {
      for (let i = 0; i < MARKS; i += 1) writeAnnotationMark(doc, `m${r}-${i}`, 1 + (i % 36), rect(`m${r}-${i}`));
    });
  }
  const appendRecords = new Map(updates.slice(0, PENDING).map((update, i) => [`k${i}`, { key: `k${i}`, update }]));
  const state = { acceptedDoc: new Y.Doc(), appendRecords };
  const last = updates[PENDING];
  assert.ok(Y.decodeUpdate(last).structs.length > 1000, 'the bulk write is thousands of structs');

  const before = clockRangeDecodeCount();
  const dependencies = causalDependenciesForUpdate(state, last, 'last');
  // Every pending update decoded at most once (+1 for the update itself).
  assert.ok(clockRangeDecodeCount() - before <= PENDING + 1, `decodes: ${clockRangeDecodeCount() - before}`);
  // The same writer's previous record is the one causal predecessor.
  assert.deepEqual(dependencies, [`k${PENDING - 1}`]);
  // A second scan over the same records decodes nothing new.
  const again = clockRangeDecodeCount();
  causalDependenciesForUpdate(state, last, 'last');
  assert.ok(clockRangeDecodeCount() - again <= 1);
});

test('same answers as the naive scan: a collaborator field edit depends on the record that created the mark', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const aUpdates = captureUpdates(a);
  const bUpdates = captureUpdates(b);
  a.transact(() => { for (let i = 0; i < 20; i += 1) writeAnnotationMark(a, `m${i}`, 1, rect(`m${i}`)); });
  a.transact(() => { for (let i = 20; i < 40; i += 1) writeAnnotationMark(a, `m${i}`, 2, rect(`m${i}`)); });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  // b recolours a mark from a's FIRST record, then one from the second.
  b.transact(() => writeAnnotationMark(b, 'm3', 1, rect('m3', { stroke: '#00ff00' })));
  b.transact(() => writeAnnotationMark(b, 'm25', 2, rect('m25', { stroke: '#0000ff' })));
  const records = [
    { key: 'a0', update: aUpdates[0] },
    { key: 'a1', update: aUpdates[1] },
    { key: 'b0', update: bUpdates.at(-2) },
  ];
  const state = { acceptedDoc: new Y.Doc(), appendRecords: new Map(records.map((r) => [r.key, r])) };
  for (const [update, key] of [[bUpdates.at(-2), 'b0'], [bUpdates.at(-1), 'b1'], [aUpdates[1], 'a1']]) {
    assert.deepEqual(
      causalDependenciesForUpdate(state, update, key),
      naiveDependencies(state, update, key),
      `dependencies of ${key}`,
    );
  }
  assert.ok(causalDependenciesForUpdate(state, bUpdates.at(-2), 'b0').includes('a0'));
  assert.ok(causalDependenciesForUpdate(state, bUpdates.at(-1), 'b1').includes('a1'));

  // Accepted records are no longer dependencies.
  const accepted = new Y.Doc();
  Y.applyUpdate(accepted, aUpdates[0]);
  const acceptedState = { acceptedDoc: accepted, appendRecords: state.appendRecords };
  assert.deepEqual(
    causalDependenciesForUpdate(acceptedState, bUpdates.at(-2), 'b0'),
    naiveDependencies(acceptedState, bUpdates.at(-2), 'b0'),
  );
  assert.ok(!causalDependenciesForUpdate(acceptedState, bUpdates.at(-2), 'b0').includes('a0'));
});
