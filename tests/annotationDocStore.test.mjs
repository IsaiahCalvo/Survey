import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  extractAnnotationId,
  getAnnotationsMap,
  docToByPage,
  syncByPageToDoc,
  encodeSnapshot,
  hydrateDoc,
} from '../src/services/annotationDocStore.js';

// Helper: a minimal annotation object shaped like a Fabric path with a stable id.
function mark(id, page, extra = {}) {
  return { type: 'path', stroke: '#ff0000', data: { id }, pageNumber: page, ...extra };
}

function byPageFrom(...entries) {
  // entries: [id, page] or [obj, page]
  const byPage = {};
  for (const [thing, page] of entries) {
    const obj = typeof thing === 'string' ? mark(thing, page) : thing;
    if (!byPage[page]) byPage[page] = { objects: [] };
    byPage[page].objects.push(obj);
  }
  return byPage;
}

function countObjects(byPage) {
  return Object.values(byPage).reduce((n, p) => n + (p.objects?.length || 0), 0);
}

test('extractAnnotationId reads data.id, then id, then annotationId', () => {
  assert.equal(extractAnnotationId({ data: { id: 'a' }, id: 'b' }), 'a');
  assert.equal(extractAnnotationId({ id: 'b' }), 'b');
  assert.equal(extractAnnotationId({ annotationId: 'c' }), 'c');
  assert.equal(extractAnnotationId({ id: 7 }), '7');
  assert.equal(extractAnnotationId({}), null);
});

test('byPage round-trips through the Y.Doc grouped by page', () => {
  const doc = new Y.Doc();
  const byPage = byPageFrom(['a', 6], ['b', 6], ['c', 11]);
  syncByPageToDoc(doc, byPage);

  const out = docToByPage(doc);
  assert.equal(countObjects(out), 3);
  assert.deepEqual(out[6].objects.map((o) => o.data.id).sort(), ['a', 'b']);
  assert.deepEqual(out[11].objects.map((o) => o.data.id), ['c']);
});

test('re-syncing identical state produces ZERO updates (never spams the log)', () => {
  const doc = new Y.Doc();
  const byPage = byPageFrom(['a', 6], ['b', 7]);
  syncByPageToDoc(doc, byPage);

  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = syncByPageToDoc(doc, byPage); // identical
  assert.equal(updates, 0, 'no Yjs update should fire for unchanged state');
  assert.deepEqual(res, { added: 0, updated: 0, removed: 0, skipped: 0 });
});

test('sync applies adds, edits, and deletes minimally', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, byPageFrom(['a', 6], ['b', 6], ['c', 7]));

  // Remove b, edit a (color change), add d.
  const editedA = mark('a', 6, { stroke: '#00ff00' });
  const next = {
    6: { objects: [editedA, mark('d', 6)] },
    7: { objects: [mark('c', 7)] },
  };
  const res = syncByPageToDoc(doc, next);
  assert.deepEqual(res, { added: 1, updated: 1, removed: 1, skipped: 0 });

  const out = docToByPage(doc);
  assert.deepEqual(out[6].objects.map((o) => o.data.id).sort(), ['a', 'd']);
  assert.equal(out[6].objects.find((o) => o.data.id === 'a').stroke, '#00ff00');
  assert.equal(out[7].objects.length, 1);
});

test('objects without a stable id are skipped, not dropped silently into bad keys', () => {
  const doc = new Y.Doc();
  const res = syncByPageToDoc(doc, { 1: { objects: [{ type: 'path' }, mark('a', 1)] } });
  assert.equal(res.skipped, 1);
  assert.equal(res.added, 1);
  assert.equal(countObjects(docToByPage(doc)), 1);
});

test('snapshot + tail replay reconstructs the full document (the open path)', () => {
  // Author doc: pages 6-11 each get a mark — the exact scenario that vanished.
  const author = new Y.Doc();
  syncByPageToDoc(author, byPageFrom(['p6', 6], ['p7', 7], ['p8', 8]));
  const snapshot = encodeSnapshot(author);
  const snapAtSeq = []; // (no tail yet)

  // After the snapshot, the user draws on pages 9, 10, and 11 — each a tail op.
  const tail = [];
  author.on('update', (u) => tail.push(u));
  syncByPageToDoc(author, byPageFrom(
    ['p6', 6], ['p7', 7], ['p8', 8], ['p9', 9], ['p10', 10], ['p11', 11],
  ));

  // Open path: a fresh client applies snapshot then the tail.
  const opened = hydrateDoc(snapshot, tail);
  const out = docToByPage(opened);
  const ids = Object.values(out).flatMap((p) => p.objects.map((o) => o.data.id)).sort();
  assert.deepEqual(ids, ['p10', 'p11', 'p6', 'p7', 'p8', 'p9']);
  assert.ok(out[11], 'page 11 mark survived snapshot+tail reopen');
  void snapAtSeq;
});

test('a fresh pen stroke is durable as a single tail update and survives reopen', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, byPageFrom(['existing', 6]));
  const snapshot = encodeSnapshot(doc);

  const tail = [];
  doc.on('update', (u) => tail.push(u));
  // Draw one stroke on page 11.
  syncByPageToDoc(doc, byPageFrom(['existing', 6], ['fresh-stroke', 11]));
  assert.equal(tail.length, 1, 'one mutation => one durable op');

  // Simulate close + reopen from durable storage only.
  const reopened = hydrateDoc(snapshot, tail);
  const out = docToByPage(reopened);
  assert.ok(out[11]?.objects.some((o) => o.data.id === 'fresh-stroke'),
    'the page-11 stroke is present after reload');
});

test('concurrent edits on two clients merge with no lost update (CRDT)', () => {
  const base = new Y.Doc();
  syncByPageToDoc(base, byPageFrom(['shared', 6]));
  const baseState = encodeSnapshot(base);

  // Two devices fork from the same baseline.
  const deviceA = hydrateDoc(baseState);
  const deviceB = hydrateDoc(baseState);

  // A adds a mark on page 7; B adds a different mark on page 8 — simultaneously.
  const aUpdates = [];
  const bUpdates = [];
  deviceA.on('update', (u) => aUpdates.push(u));
  deviceB.on('update', (u) => bUpdates.push(u));
  syncByPageToDoc(deviceA, byPageFrom(['shared', 6], ['fromA', 7]));
  syncByPageToDoc(deviceB, byPageFrom(['shared', 6], ['fromB', 8]));

  // Exchange updates.
  for (const u of bUpdates) Y.applyUpdate(deviceA, u);
  for (const u of aUpdates) Y.applyUpdate(deviceB, u);

  const idsA = Object.values(docToByPage(deviceA)).flatMap((p) => p.objects.map((o) => o.data.id)).sort();
  const idsB = Object.values(docToByPage(deviceB)).flatMap((p) => p.objects.map((o) => o.data.id)).sort();
  assert.deepEqual(idsA, ['fromA', 'fromB', 'shared']);
  assert.deepEqual(idsB, ['fromA', 'fromB', 'shared'], 'both devices converge, neither edit lost');
});
