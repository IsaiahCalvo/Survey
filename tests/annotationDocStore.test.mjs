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
  getMetaValue,
  setMetaValue,
  docToSurveyMarkers,
  syncSurveyMarkersToDoc,
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

test('prevByPage fast-path skips unchanged pages but still applies deletes', () => {
  const doc = new Y.Doc();
  const page6 = { objects: [mark('a', 6), mark('b', 6)] };
  const page7 = { objects: [mark('c', 7)] };
  const first = { 6: page6, 7: page7 };
  syncByPageToDoc(doc, first);

  // Next state: page 6 is the SAME reference (unchanged), page 7 is removed.
  const second = { 6: page6 };
  const res = syncByPageToDoc(doc, second, { prevByPage: first });
  // page 6 untouched (no re-add/update), page 7's mark deleted.
  assert.deepEqual(res, { added: 0, updated: 0, removed: 1, skipped: 0 });
  const out = docToByPage(doc);
  assert.deepEqual(out[6].objects.map((o) => o.data.id).sort(), ['a', 'b']);
  assert.equal(out[7], undefined);

  // And an unchanged page reference produces zero ops.
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  syncByPageToDoc(doc, second, { prevByPage: second });
  assert.equal(updates, 0);
});

test('a multi-page import emits one bounded op PER page, not one giant op', () => {
  // Resilience: the embedded import of pages 6-11 must not ride on a single
  // all-or-nothing write. Each changed page is its own transaction → its own op.
  const doc = new Y.Doc();
  const updates = [];
  doc.on('update', (u) => updates.push(u));
  syncByPageToDoc(doc, byPageFrom(
    ['p6', 6], ['p7', 7], ['p8', 8], ['p9', 9], ['p10', 10], ['p11', 11],
  ));
  assert.equal(updates.length, 6, 'six changed pages => six separate ops');
  // All still present.
  assert.equal(Object.keys(docToByPage(doc)).length, 6);
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
  const opened = hydrateDoc(snapshot, tail, new Y.Doc());
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
  const reopened = hydrateDoc(snapshot, tail, new Y.Doc());
  const out = docToByPage(reopened);
  assert.ok(out[11]?.objects.some((o) => o.data.id === 'fresh-stroke'),
    'the page-11 stroke is present after reload');
});

// --- Document-level meta (callouts, and the home for spaces + survey markers) ---
//
// Callouts already ride this path in the live app (setMeta('calloutsList', ...));
// spaces and survey markers will move onto the SAME meta path. These tests pin
// the contract: read-back, change-only writes, and survival through snapshot+tail.

function callout(id, page, label = 'note') {
  return { id, pageNumber: page, anchor: { x: 1, y: 2 }, knee: { x: 3, y: 4 }, label };
}

test('meta value round-trips: setMetaValue then getMetaValue returns the same list', () => {
  const doc = new Y.Doc();
  const list = [callout('c1', 6), callout('c2', 11)];
  const wrote = setMetaValue(doc, 'calloutsList', list);
  assert.equal(wrote, true, 'first write reports a change');
  assert.deepEqual(getMetaValue(doc, 'calloutsList'), list);
});

test('re-setting identical meta produces ZERO updates (never spams the log)', () => {
  const doc = new Y.Doc();
  const list = [callout('c1', 6)];
  setMetaValue(doc, 'calloutsList', list);

  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const wrote = setMetaValue(doc, 'calloutsList', [callout('c1', 6)]); // deep-equal copy
  assert.equal(updates, 0, 'no Yjs update for an unchanged meta value');
  assert.equal(wrote, false, 'setMetaValue reports no change');
});

test('changing a meta value fires exactly one update', () => {
  const doc = new Y.Doc();
  setMetaValue(doc, 'calloutsList', [callout('c1', 6)]);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const wrote = setMetaValue(doc, 'calloutsList', [callout('c1', 6, 'edited')]);
  assert.equal(updates, 1, 'one edit => one durable op');
  assert.equal(wrote, true);
});

test('meta survives snapshot + tail reopen alongside annotations (the open path)', () => {
  // Author: some annotations AND a callouts meta list, then a later edit as a tail op.
  const author = new Y.Doc();
  syncByPageToDoc(author, byPageFrom(['a', 6]));
  setMetaValue(author, 'calloutsList', [callout('c1', 6)]);
  const snapshot = encodeSnapshot(author);

  const tail = [];
  author.on('update', (u) => tail.push(u));
  // After the snapshot: draw a mark and add a second callout — both must replay.
  syncByPageToDoc(author, byPageFrom(['a', 6], ['b', 7]));
  setMetaValue(author, 'calloutsList', [callout('c1', 6), callout('c2', 11)]);

  const reopened = hydrateDoc(snapshot, tail, new Y.Doc());
  assert.deepEqual(
    getMetaValue(reopened, 'calloutsList').map((c) => c.id).sort(),
    ['c1', 'c2'],
    'both callouts present after snapshot+tail reopen',
  );
  assert.equal(countObjects(docToByPage(reopened)), 2, 'annotations also survived');
});

test('independent meta keys do not clobber each other (callouts vs spaces vs surveyMarkers)', () => {
  // The migration parks three different concerns under three meta keys in ONE doc.
  const doc = new Y.Doc();
  setMetaValue(doc, 'calloutsList', [callout('c1', 6)]);
  setMetaValue(doc, 'spaces', [{ id: 's1', name: 'Floor 1', assignedPages: [] }]);
  setMetaValue(doc, 'surveyMarkers', { m1: { bounds: { x: 0, y: 0, w: 10, h: 10 } } });

  const snapshot = encodeSnapshot(doc);
  const reopened = hydrateDoc(snapshot, [], new Y.Doc());
  assert.equal(getMetaValue(reopened, 'calloutsList').length, 1);
  assert.equal(getMetaValue(reopened, 'spaces')[0].name, 'Floor 1');
  assert.ok(getMetaValue(reopened, 'surveyMarkers').m1, 'survey marker key intact');
});

// --- Survey markers (flat dict in their own keyed map) ---
//
// Survey markers are bounding-box + metadata records keyed by annotationId, not
// per-page fabric objects. They use a dedicated keyed map with minimal per-marker
// diff so a single placement is one small op, never a giant whole-dict re-write.

function surveyMarker(id, page, extra = {}) {
  return {
    annotationId: id,
    pageNumber: page,
    bounds: { x: 1, y: 2, width: 10, height: 10 },
    categoryId: 'cat-1',
    checklistResponses: {},
    color: '#FFFF00',
    opacity: 0.3,
    ...extra,
  };
}

test('survey markers round-trip through their keyed map', () => {
  const doc = new Y.Doc();
  const markers = { m1: surveyMarker('m1', 6), m2: surveyMarker('m2', 11) };
  syncSurveyMarkersToDoc(doc, markers);
  const out = docToSurveyMarkers(doc);
  assert.deepEqual(Object.keys(out).sort(), ['m1', 'm2']);
  assert.equal(out.m1.pageNumber, 6);
  assert.equal(out.m2.bounds.width, 10);
});

test('survey markers: re-syncing identical state produces ZERO updates', () => {
  const doc = new Y.Doc();
  const markers = { m1: surveyMarker('m1', 6) };
  syncSurveyMarkersToDoc(doc, markers);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = syncSurveyMarkersToDoc(doc, { m1: surveyMarker('m1', 6) });
  assert.equal(updates, 0, 'no Yjs update for unchanged survey markers');
  assert.deepEqual(res, { added: 0, updated: 0, removed: 0 });
});

test('survey markers: minimal add / edit / delete', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { m1: surveyMarker('m1', 6), m2: surveyMarker('m2', 6) });
  // edit m1's checklist response, drop m2, add m3
  const res = syncSurveyMarkersToDoc(doc, {
    m1: surveyMarker('m1', 6, { checklistResponses: { q1: { selection: 'yes' } } }),
    m3: surveyMarker('m3', 7),
  });
  assert.deepEqual(res, { added: 1, updated: 1, removed: 1 });
  const out = docToSurveyMarkers(doc);
  assert.deepEqual(Object.keys(out).sort(), ['m1', 'm3']);
  assert.equal(out.m1.checklistResponses.q1.selection, 'yes');
});

test('survey markers: a bulk seed batches into several ops, all survive reopen', () => {
  // 600 markers with batchSize 250 => 3 add transactions (resilient, bounded).
  const doc = new Y.Doc();
  const updates = [];
  doc.on('update', (u) => updates.push(u));
  const many = {};
  for (let i = 0; i < 600; i += 1) many[`m${i}`] = surveyMarker(`m${i}`, (i % 11) + 1);
  const res = syncSurveyMarkersToDoc(doc, many, { batchSize: 250 });
  assert.equal(res.added, 600);
  assert.equal(updates.length, 3, '600 markers / 250 per batch => 3 bounded ops');

  const snapshot = encodeSnapshot(doc);
  const reopened = hydrateDoc(snapshot, [], new Y.Doc());
  assert.equal(Object.keys(docToSurveyMarkers(reopened)).length, 600, 'all markers survive reopen');
});

test('survey markers survive snapshot + tail reopen alongside annotations and meta', () => {
  const author = new Y.Doc();
  syncByPageToDoc(author, byPageFrom(['a', 6]));
  setMetaValue(author, 'calloutsList', [callout('c1', 6)]);
  syncSurveyMarkersToDoc(author, { m1: surveyMarker('m1', 6) });
  const snapshot = encodeSnapshot(author);

  const tail = [];
  author.on('update', (u) => tail.push(u));
  // After the snapshot: add a second survey marker (a tail op).
  syncSurveyMarkersToDoc(author, { m1: surveyMarker('m1', 6), m2: surveyMarker('m2', 9) });

  const reopened = hydrateDoc(snapshot, tail, new Y.Doc());
  assert.deepEqual(Object.keys(docToSurveyMarkers(reopened)).sort(), ['m1', 'm2']);
  assert.equal(getMetaValue(reopened, 'calloutsList').length, 1, 'callouts still intact');
  assert.equal(countObjects(docToByPage(reopened)), 1, 'annotations still intact');
});

test('concurrent edits on two clients merge with no lost update (CRDT)', () => {
  const base = new Y.Doc();
  syncByPageToDoc(base, byPageFrom(['shared', 6]));
  const baseState = encodeSnapshot(base);

  // Two devices fork from the same baseline.
  const deviceA = hydrateDoc(baseState, [], new Y.Doc());
  const deviceB = hydrateDoc(baseState, [], new Y.Doc());

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
