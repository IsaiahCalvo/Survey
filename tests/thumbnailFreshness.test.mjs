/* Thumbnail freshness (owner 2026-09-23: "thumbnails that are just out of
   date, and they don't update ... should always be updated, but lightweight").

   Covers the three pieces that make that true without polling:
     1. the staleness key (services/thumbnailSignature.js),
     2. the one-at-a-time idle backfill queue (services/thumbnailBackfill.js),
     3. the durable cache carrying the key + "do not retry" markers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';

import { computeThumbnailSignature, isThumbnailCurrent } from '../src/services/thumbnailSignature.js';
import { createThumbnailBackfill } from '../src/services/thumbnailBackfill.js';
import { createThumbnailStore } from '../src/services/thumbnailStore.js';

const rect = (over = {}) => ({ type: 'rect', left: 10, top: 20, width: 30, height: 40, stroke: '#f00', data: { id: 'r1' }, ...over });
const pdf = { numPages: 3, width: 612, height: 792, rotate: 0, byteLength: 1000 };
const sig = (over = {}) => computeThumbnailSignature({ fileStamp: 'doc::sha', pdf, objects: [rect()], callouts: [], ...over });

// ---------------------------------------------------------------- staleness key

test('same content on any device gives the same key', () => {
  assert.equal(sig(), sig());
  assert.match(sig(), /^v1:[0-9a-z]+:1$/);
});

test('a markup edit on page 1 moves the key; undoing it moves it back', () => {
  const before = sig();
  const edited = sig({ objects: [rect(), rect({ data: { id: 'r2' }, left: 200 })] });
  const moved = sig({ objects: [rect({ left: 11 })] });
  assert.notEqual(edited, before);
  assert.notEqual(moved, before);
  assert.equal(sig({ objects: [rect()] }), before, 'undo restores the exact key');
});

test('an in-place page edit (rotate / delete / reorder) moves the key even though the file path did not', () => {
  const before = sig();
  assert.notEqual(sig({ pdf: { ...pdf, rotate: 90 } }), before);
  assert.notEqual(sig({ pdf: { ...pdf, numPages: 2, byteLength: 900 } }), before);
  assert.notEqual(sig({ pdf: { ...pdf, byteLength: 1001 } }), before);
});

test('property order, selection/editing flags and unpainted callout projections are not edits', () => {
  const before = sig();
  const reordered = Object.fromEntries(Object.entries(rect()).reverse());
  assert.equal(sig({ objects: [reordered] }), before);
  assert.equal(sig({ objects: [rect({ hasBorders: false, hasControls: false, selected: true })] }), before);
  const projection = { type: 'group', data: { type: 'callout', id: 'c1' }, left: 5 };
  assert.equal(sig({ objects: [rect(), projection] }), before, 'callouts are hashed from the callouts list');
  assert.notEqual(sig({ callouts: [{ id: 'c1', pageNumber: 1, text: 'hi' }] }), before);
});

test('a cached entry is current only when it carries the same key', () => {
  const key = sig();
  assert.equal(isThumbnailCurrent({ url: 'data:x', signature: key }, key), true);
  assert.equal(isThumbnailCurrent({ url: 'data:x', signature: 'v1:old:1' }, key), false);
  // A backfilled bare page (no key) is never "current" for an open document.
  assert.equal(isThumbnailCurrent({ url: 'data:x', signature: null }, key), false);
  assert.equal(isThumbnailCurrent(null, key), false);
});

// ---------------------------------------------------------------- backfill queue

function harness({ cached = new Set(), busy = () => false, fail = new Map() } = {}) {
  const events = [];
  let active = 0;
  let maxActive = 0;
  const backfill = createThumbnailBackfill({
    keyOf: (doc) => doc?.id,
    needsThumbnail: async (doc) => !cached.has(doc.id),
    generate: async (doc) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`gen:${doc.id}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const remaining = fail.get(doc.id) || 0;
      if (remaining > 0) { fail.set(doc.id, remaining - 1); throw new Error('offline'); }
      cached.add(doc.id);
    },
    waitForIdle: async () => { events.push('idle'); },
    isBusy: busy,
    sleep: async (ms) => { events.push(`sleep:${ms}`); },
    gapMs: 750,
    busyRetryMs: 2000,
  });
  return { backfill, events, cached, get maxActive() { return maxActive; } };
}
const docs = (...ids) => ids.map((id) => ({ id }));

test('backfill: exactly one document at a time, paced by a gap, only after idle', async () => {
  const h = harness();
  h.backfill.setDocuments(docs('a', 'b', 'c'));
  await h.backfill.whenIdle();
  assert.equal(h.maxActive, 1, 'never two generations in flight');
  assert.deepEqual(h.events.filter((e) => e.startsWith('gen')), ['gen:a', 'gen:b', 'gen:c']);
  // idle before every job, a gap between jobs, none after the last one
  assert.deepEqual(h.events, ['idle', 'gen:a', 'sleep:750', 'idle', 'gen:b', 'sleep:750', 'idle', 'gen:c']);
  assert.equal(h.backfill.stats.generated, 3);
});

test('backfill: resumable — documents already cached are skipped without work; only real work is paced', async () => {
  const h = harness({ cached: new Set(['a', 'c']) });
  h.backfill.setDocuments(docs('a', 'b', 'c'));
  await h.backfill.whenIdle();
  assert.deepEqual(h.events.filter((e) => e.startsWith('gen')), ['gen:b']);
  // One gap, after the one real render; the cache hits cost no pacing.
  assert.deepEqual(h.events, ['idle', 'idle', 'gen:b', 'sleep:750', 'idle']);
  assert.equal(h.backfill.stats.alreadyCached, 2);
});

test('backfill: waits while the user is busy (drawing, typing, list hidden) and never works meanwhile', async () => {
  let busyChecks = 0;
  const h = harness({ busy: () => (busyChecks += 1) <= 3 });
  h.backfill.setDocuments(docs('a'));
  await h.backfill.whenIdle();
  const firstGen = h.events.indexOf('gen:a');
  assert.deepEqual(h.events.slice(0, firstGen), ['idle', 'sleep:2000', 'idle', 'sleep:2000', 'idle', 'sleep:2000', 'idle']);
  assert.equal(h.backfill.stats.busyWaits, 3);
});

test('backfill: a visible row jumps the queue', async () => {
  const h = harness();
  h.backfill.setDocuments(docs('a', 'b', 'c', 'd'));
  h.backfill.prioritize({ id: 'd' });
  await h.backfill.whenIdle();
  const order = h.events.filter((e) => e.startsWith('gen'));
  assert.equal(order[0], 'gen:d');
  assert.equal(order.length, 4, 'each document exactly once');
});

test('backfill: a failing document is retried a bounded number of times, then left alone', async () => {
  const h = harness({ fail: new Map([['a', 99]]) });
  h.backfill.setDocuments(docs('a', 'b'));
  await h.backfill.whenIdle();
  assert.deepEqual(h.events.filter((e) => e.startsWith('gen')), ['gen:a', 'gen:b', 'gen:a']);
  assert.equal(h.backfill.stats.failed, 1);
  // A later list refresh does not restart it this session.
  h.backfill.setDocuments(docs('a', 'b'));
  await h.backfill.whenIdle();
  assert.equal(h.events.filter((e) => e === 'gen:a').length, 2);
});

test('backfill: stop() halts the queue before the next document', async () => {
  const h = harness();
  h.backfill.setDocuments(docs('a', 'b', 'c'));
  h.backfill.stop();
  await h.backfill.whenIdle();
  assert.ok(h.events.filter((e) => e.startsWith('gen')).length <= 1);
  assert.equal(h.backfill.pending, 0);
});

// ---------------------------------------------------------------- durable cache

test('the cache keeps which content an image was made from, and remembers skips', async () => {
  const store = createThumbnailStore({ indexedDb: fakeIndexedDB, timeoutMs: 2000 });
  await store.put('d::sha', { url: 'data:image/webp;base64,AA', aspect: 0.77, signature: 'v1:abc:3', source: 'markup' });
  const hit = await store.get('d::sha');
  assert.equal(hit.signature, 'v1:abc:3');
  assert.equal(hit.source, 'markup');
  assert.ok(hit.savedAt > 0);
  // Rows written before signatures existed read back as unknown, not as current.
  await store.put('old::p', { url: 'data:image/jpeg;base64,BB', aspect: 1 });
  assert.equal((await store.get('old::p')).signature, null);

  assert.equal(await store.getSkip('big::p'), null);
  assert.equal(await store.putSkip('big::p', 'too-large'), true);
  assert.equal((await store.getSkip('big::p')).reason, 'too-large');
  await store.clear();
  assert.equal(await store.getSkip('big::p'), null, 'clear() forgets skips too');
  await store.close();
});
