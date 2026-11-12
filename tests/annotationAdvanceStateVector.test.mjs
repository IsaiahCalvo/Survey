// Flag 'lazy-accepted-shadow' (2026-11-10): with the accepted copy of the
// marks unbuilt on the main thread, its state vector is worked forward from
// the worker's last answer over the updates kept since (advanceStateVector).
// It must equal what the built document would report, or say it cannot know
// (a struct that would wait for another).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { __test } from '../src/services/annotationDocSync.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';

const { advanceStateVector } = __test;
const vectorOf = (doc) => Y.decodeStateVector(Y.encodeStateVector(doc));
const asObject = (map) => Object.fromEntries([...map].sort(([a], [b]) => a - b));

// A seeded random walk: three writers edit maps, a nested array and text,
// exchanging some of their updates; every update reaches `accepted` in an
// order that sometimes runs ahead of what it depends on.
function* walk(seed, steps) {
  let n = seed;
  const rand = (k) => { n = (n * 1103515245 + 12345) % 2147483648; return n % k; };
  const writers = [0, 1, 2].map((i) => createDetachedYDoc(`advance-writer-${seed}-${i}`));
  const updates = [];
  for (const doc of writers) doc.on('update', (u) => updates.push(u));
  for (let i = 0; i < steps; i += 1) {
    const doc = writers[rand(3)];
    const marks = doc.getMap('marks');
    const kind = rand(5);
    if (kind === 0) marks.set(`m${rand(20)}`, { left: rand(500) });
    else if (kind === 1) marks.delete(`m${rand(20)}`);
    else if (kind === 2) doc.getArray('order').insert(0, [`p${i}`]);
    else if (kind === 3 && doc.getArray('order').length) doc.getArray('order').delete(0, 1);
    else doc.getText('note').insert(rand(doc.getText('note').length + 1), 'ab');
    // Some updates reach another writer (so later edits depend on them).
    if (rand(3) === 0) {
      const to = writers[rand(3)];
      if (to !== doc) Y.applyUpdate(to, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(to)));
    }
    while (updates.length) yield { update: updates.shift(), skipAhead: rand(6) === 0 };
  }
}

test('worked-forward vector equals the built document, or is unknown when a struct would wait', () => {
  let exact = 0;
  let unknown = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const accepted = createDetachedYDoc(`advance-accepted-${seed}`);
    const held = [];
    for (const { update, skipAhead } of walk(seed, 60)) {
      // Now and then hold one back, so the next one may arrive ahead of it.
      if (skipAhead && held.length === 0) { held.push(update); continue; }
      const batch = [update, ...held.splice(0)];
      for (const u of batch) {
        const before = vectorOf(accepted);
        const pendingBefore = Boolean(accepted.store.pendingStructs);
        const advanced = pendingBefore ? null : advanceStateVector(before, [u]);
        Y.applyUpdate(accepted, u);
        if (advanced) {
          assert.deepEqual(asObject(advanced), asObject(vectorOf(accepted)), `seed ${seed}`);
          assert.equal(accepted.store.pendingStructs, null, 'known only when nothing waits');
          exact += 1;
        } else {
          unknown += 1;
        }
      }
    }
  }
  assert.ok(exact > 1000, `most updates are worked forward (${exact} exact, ${unknown} unknown)`);
  assert.ok(unknown > 0, 'and an update ahead of its dependency is reported unknown');
});

test('several kept updates at once, and a clock gap', () => {
  const a = createDetachedYDoc('advance-a');
  const parts = [];
  a.on('update', (u) => parts.push(u));
  for (let i = 0; i < 5; i += 1) a.getMap('marks').set(`k${i}`, i);
  const empty = new Map();
  assert.deepEqual(asObject(advanceStateVector(empty, parts)), asObject(vectorOf(a)));
  // The third update alone (its client's clock starts after a gap).
  assert.equal(advanceStateVector(empty, [parts[2]]), null);
});
