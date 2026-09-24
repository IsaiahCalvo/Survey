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
  repairStackedInkDuplicates,
  readAnnotationObject,
} from '../src/services/annotationDocStore.js';
import {
  migrateCalloutsMetaToAnnotationsMap,
  getUnmigratedMetaCallouts,
} from '../src/services/calloutMetaMigration.js';
import {
  calloutToAnnotationObject,
  deriveCalloutsFromByPage,
  projectCalloutsIntoByPage,
} from '../src/utils/calloutAnnotationBridge.js';

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

function filledInk(id, {
  path = [['M', 221, 295], ['L', 222, 263], ['L', 224, 263], ['L', 223, 295], ['Z']],
  page = 1,
  fill = '#ff0000',
  tool = 'pen',
  extra = {},
} = {}) {
  return {
    page,
    object: {
      type: 'path',
      left: 0,
      top: 0,
      width: 14,
      height: 121,
      path,
      fill,
      stroke: 'transparent',
      strokeWidth: 0,
      sourceWidth: 3,
      paperInkGeometry: 'v1',
      paperEraserGeometry: 'v1',
      data: { id, tool },
      ...extra,
    },
  };
}

test('extractAnnotationId reads data.id, then id, then annotationId', () => {
  assert.equal(extractAnnotationId({ data: { id: 'a' }, id: 'b' }), 'a');
  assert.equal(extractAnnotationId({ id: 'b' }), 'b');
  assert.equal(extractAnnotationId({ annotationId: 'c' }), 'c');
  assert.equal(extractAnnotationId({ id: 7 }), '7');
  assert.equal(extractAnnotationId({}), null);
});

test('repairStackedInkDuplicates collapses eight regenerated-looking copies to one durable record', () => {
  const doc = new Y.Doc();
  const map = getAnnotationsMap(doc);
  for (let index = 0; index < 8; index += 1) {
    const id = `streak-${index}`;
    const { page, object } = filledInk(id);
    map.set(id, { p: page, o: object });
  }

  const result = repairStackedInkDuplicates(doc);
  const objects = docToByPage(doc)[1].objects;

  assert.equal(result.scanned, 8);
  assert.equal(result.duplicateGroups, 1);
  assert.equal(result.removed, 7);
  assert.equal(objects.length, 1, 'one canonical fragment remains instead of eight stacked copies');
  assert.equal(objects[0].data.id, 'streak-0', 'earliest stored copy survives');
  assert.deepEqual(result.removedIds, [
    'streak-1',
    'streak-2',
    'streak-3',
    'streak-4',
    'streak-5',
    'streak-6',
    'streak-7',
  ]);

  let secondPassUpdates = 0;
  doc.on('update', () => { secondPassUpdates += 1; });
  const secondPass = repairStackedInkDuplicates(doc);
  assert.equal(secondPass.removed, 0);
  assert.equal(secondPassUpdates, 0, 'an already-clean document emits no Yjs update');
});

test('repairStackedInkDuplicates keeps a canonically keyed copy', () => {
  const doc = new Y.Doc();
  const map = getAnnotationsMap(doc);
  const mismatched = filledInk('canonical-id');
  const canonical = filledInk('canonical-id');
  map.set('wrong-map-key', { p: mismatched.page, o: mismatched.object });
  map.set('canonical-id', { p: canonical.page, o: canonical.object });

  const result = repairStackedInkDuplicates(doc);

  assert.deepEqual(result.removedIds, ['wrong-map-key']);
  assert.equal(map.has('canonical-id'), true);
  assert.equal(map.has('wrong-map-key'), false);
});

test('repairStackedInkDuplicates is exact and ink-only', () => {
  const doc = new Y.Doc();
  const map = getAnnotationsMap(doc);
  const base = filledInk('base');
  map.set('base', { p: base.page, o: base.object });

  const changedPath = filledInk('changed-path', {
    path: [['M', 221, 295], ['L', 223, 263], ['L', 225, 263], ['L', 223, 295], ['Z']],
  });
  map.set('changed-path', { p: changedPath.page, o: changedPath.object });

  const changedStyle = filledInk('changed-style', { fill: '#00ff00' });
  map.set('changed-style', { p: changedStyle.page, o: changedStyle.object });

  const otherPage = filledInk('other-page', { page: 2 });
  map.set('other-page', { p: otherPage.page, o: otherPage.object });

  const shapeA = {
    type: 'rect',
    left: 10,
    top: 10,
    width: 20,
    height: 20,
    data: { id: 'shape-a' },
  };
  const shapeB = { ...shapeA, data: { id: 'shape-b' } };
  map.set('shape-a', { p: 1, o: shapeA });
  map.set('shape-b', { p: 1, o: shapeB });

  const pristineA = filledInk('pristine-a');
  delete pristineA.object.paperEraserGeometry;
  const pristineB = filledInk('pristine-b');
  delete pristineB.object.paperEraserGeometry;
  map.set('pristine-a', { p: pristineA.page, o: pristineA.object });
  map.set('pristine-b', { p: pristineB.page, o: pristineB.object });

  const result = repairStackedInkDuplicates(doc);

  assert.equal(result.removed, 0);
  assert.equal(
    map.size,
    8,
    'different geometry/style/page, non-ink objects, and pristine stacked ink are preserved',
  );
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

test('objects without a stable id are copy-on-write promoted to durable data.id values', () => {
  const doc = new Y.Doc();
  const legacy = { type: 'path' };
  const res = syncByPageToDoc(doc, { 1: { objects: [legacy, mark('a', 1)] } });
  assert.equal(res.skipped, 0);
  assert.equal(res.added, 2);
  assert.equal(countObjects(docToByPage(doc)), 2);
  assert.deepEqual(legacy, { type: 'path' }, 'source payload is not mutated');
  const promoted = docToByPage(doc)[1].objects[0];
  assert.match(promoted.data.id, /^path-/);
  assert.equal(getAnnotationsMap(doc).has(promoted.data.id), true);
  assert.equal([...getAnnotationsMap(doc).keys()].some((key) => key.startsWith('\u0000')), false);
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

// --- Document-level meta (spaces; historically also the callouts blob) ---
//
// These tests pin the GENERIC meta machinery: read-back, change-only writes,
// and survival through snapshot+tail. They still use 'calloutsList' as a sample
// key for historical continuity, but as of Slice 6 (2026-07-17) the LIVE app no
// longer persists callouts there — callout groups ride the `annotations` map
// per-id (see the Slice 6 section below), and legacy docs tombstone this key to
// null via migrateCalloutsMetaToAnnotationsMap. Spaces still ride meta.

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

// ---------------------------------------------------------------------------
// Callout-unification Slice 6 (2026-07-17) — callouts ride the annotations map.
//
// The historical write-contamination guard (data.type==='callout' skipped in
// syncByPageToDoc) is GONE: projected callout groups persist per-id in the SAME
// `annotations` Y.Map as every other object, carrying the verbatim normalized
// payload as data.legacyCallout (lossless). Legacy docs that persisted callouts
// as the coarse `calloutsList` META blob are converted once on open by
// migrateCalloutsMetaToAnnotationsMap, which then tombstones the meta to null.
// ---------------------------------------------------------------------------

function normalizedCallout(id, page, text = 'note') {
  return {
    id,
    pageNumber: page,
    arrowTip: { x: 0.1, y: 0.2 },
    knee: { x: 0.25, y: 0.2 },
    textBoxPosition: { x: 0.4, y: 0.15 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.08,
    text,
    style: { fontSize: 14, bold: true, borderColor: '#123456', fontFamily: 'Arial' },
    meta: { authorId: 'user-1' },
  };
}

function calloutGroup(id, page, text = 'note') {
  const obj = calloutToAnnotationObject(normalizedCallout(id, page, text), { width: 612, height: 792 });
  obj.pageNumber = page;
  return obj;
}

test('syncByPageToDoc: a projected callout group syncs per-id like every other object', () => {
  const doc = new Y.Doc();
  const byPage = {
    1: { objects: [mark('pen-1', 1), calloutGroup('co-1', 1, 'hello')] },
  };
  const res = syncByPageToDoc(doc, byPage);
  assert.equal(res.added, 2, 'pen AND callout group both added');
  assert.equal(res.skipped, 0, 'nothing is skipped anymore');
  const map = getAnnotationsMap(doc);
  assert.equal(map.has('pen-1'), true);
  assert.equal(map.has('co-1'), true, 'the callout group is keyed by its stable id');
  const out = docToByPage(doc);
  assert.equal(out[1].objects.length, 2);
  assert.ok(out[1].objects.some((o) => o?.data?.type === 'callout'));
});

test('callout group round-trips losslessly through snapshot + reopen (incl. legacyCallout meta/style)', () => {
  const author = new Y.Doc();
  const source = normalizedCallout('co-rt', 3, 'round trip');
  const group = calloutToAnnotationObject(source, { width: 612, height: 792 });
  group.pageNumber = 3;
  syncByPageToDoc(author, { 3: { objects: [group] } });

  // Reopen from durable bytes only (the wire/snapshot encoding path).
  const reopened = hydrateDoc(encodeSnapshot(author), [], new Y.Doc());
  const out = docToByPage(reopened);
  const revived = out[3].objects.find((o) => o?.data?.type === 'callout');
  assert.ok(revived, 'callout group survived reopen');
  assert.equal(revived.data.id, 'co-rt');
  // The verbatim normalized payload — id, geometry fractions, text, style
  // (bold/border/font), and the author chain — is byte-identical.
  assert.deepEqual(revived.data.legacyCallout, source);
  // The recoverable normalized fractions backup also survives.
  assert.deepEqual(revived.data.legacyNormalizedCoords.arrowTip, { x: 0.1, y: 0.2 });
  // Derive (the read half of the flip) recovers the exact source callout.
  assert.deepEqual(deriveCalloutsFromByPage(out), [source]);
});

test('re-syncing an identical callout group produces ZERO updates', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 2: { objects: [calloutGroup('co-idem', 2)] } });
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = syncByPageToDoc(doc, { 2: { objects: [calloutGroup('co-idem', 2)] } });
  assert.equal(updates, 0, 'deterministic projection => steady-state reopen emits no ops');
  assert.deepEqual(res, { added: 0, updated: 0, removed: 0, skipped: 0 });
});

test('deleting a callout removes its map entry (and edits update in place)', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [calloutGroup('co-a', 1), calloutGroup('co-b', 1), mark('pen-1', 1)] } });
  // Edit co-a's text, delete co-b, keep the pen.
  const res = syncByPageToDoc(doc, { 1: { objects: [calloutGroup('co-a', 1, 'edited'), mark('pen-1', 1)] } });
  assert.deepEqual(res, { added: 0, updated: 1, removed: 1, skipped: 0 });
  const map = getAnnotationsMap(doc);
  assert.equal(map.has('co-a'), true);
  assert.equal(map.has('co-b'), false, 'deleted callout is gone from the map');
  assert.equal(map.has('pen-1'), true);
  const derived = deriveCalloutsFromByPage(docToByPage(doc));
  assert.deepEqual(derived.map((c) => c.id), ['co-a']);
  assert.equal(derived[0].text, 'edited');
});

// --- calloutsList META → annotations-map migration (calloutMetaMigration.js) ---

test('migration: meta-only legacy doc → map populated, meta tombstoned to null', () => {
  const doc = new Y.Doc();
  const legacy = [normalizedCallout('m-1', 2, 'first'), normalizedCallout('m-2', 5, 'second')];
  setMetaValue(doc, 'calloutsList', legacy);

  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: { 2: { width: 612, height: 792 }, 5: { width: 612, height: 792 } } });
  assert.equal(res.migrated, true);
  assert.equal(res.tombstoned, true);
  assert.equal(res.calloutCount, 2);
  assert.equal(res.source, 'meta');

  const map = getAnnotationsMap(doc);
  assert.equal(map.has('m-1'), true);
  assert.equal(map.has('m-2'), true);
  assert.equal(getMetaValue(doc, 'calloutsList'), null, 'meta blob is tombstoned');
  // Lossless: derive recovers the exact legacy entries.
  assert.deepEqual(deriveCalloutsFromByPage(docToByPage(doc)), legacy);
});

test('migration: second run on a migrated doc is a true zero-op', () => {
  const doc = new Y.Doc();
  setMetaValue(doc, 'calloutsList', [normalizedCallout('m-1', 2)]);
  migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });

  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  assert.equal(updates, 0, 'no Yjs update fires on the second open');
  assert.equal(res.migrated, false);
  assert.equal(res.tombstoned, false);
  assert.equal(res.source, 'annotations-map');
});

test('migration: unmeasured pages fall back to US-Letter but legacyCallout stays exact (fallback read)', () => {
  // A legacy doc opened before any page is measured: projection uses the
  // US-Letter fallback for group pixel geometry, but the embedded verbatim
  // payload keeps the exact fractions — nothing is lost, and the viewer's
  // on-measure re-projection rebuilds the children at real dims later.
  const doc = new Y.Doc();
  const legacy = [normalizedCallout('m-frac', 7, 'fractions')];
  setMetaValue(doc, 'calloutsList', legacy);
  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  assert.equal(res.migrated, true);
  const derived = deriveCalloutsFromByPage(docToByPage(doc));
  assert.deepEqual(derived, legacy, 'derive recovers the exact normalized callout');
});

test('migration: map-authoritative doc with a stale meta list only tombstones (crash recovery)', () => {
  // Simulates a migration that wrote the map but died before the tombstone:
  // next open must not duplicate anything — one bounded op (the tombstone).
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 4: { objects: [calloutGroup('co-live', 4)] } });
  setMetaValue(doc, 'calloutsList', [normalizedCallout('co-live', 4)]);

  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  assert.equal(res.migrated, false);
  assert.equal(res.tombstoned, true);
  assert.equal(res.source, 'annotations-map');
  assert.equal(updates, 1, 'exactly one op: the meta tombstone');
  assert.equal(getMetaValue(doc, 'calloutsList'), null);
  assert.equal(getAnnotationsMap(doc).has('co-live'), true, 'the group is untouched');
});

test('migration: fresh doc (no meta, no callouts) emits zero ops', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, byPageFrom(['pen-only', 1]));
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  assert.equal(updates, 0);
  assert.deepEqual(res, {
    migrated: false,
    tombstoned: false,
    calloutCount: 0,
    migratedCount: 0,
    droppedCount: 0,
    source: 'none',
  });
  assert.equal(getMetaValue(doc, 'calloutsList'), undefined, 'a never-written meta stays unwritten');
});

// --- Slice 6 hardening (2026-07-17) — tombstone safety + viewer-safe opens ---

test('migration: a string pageNumber meta entry is coerced and migrated, never dropped', () => {
  // The live render path coerces (PDFViewer.jsx ~1953 Number(callout?.pageNumber));
  // a string-page callout is renderable and must survive the migration.
  const doc = new Y.Doc();
  const entry = { ...normalizedCallout('m-str', 3, 'string page'), pageNumber: '3' };
  setMetaValue(doc, 'calloutsList', [entry]);

  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: { 3: { width: 612, height: 792 } } });
  assert.equal(res.migrated, true);
  assert.equal(res.migratedCount, 1);
  assert.equal(res.droppedCount, 0);
  assert.equal(res.tombstoned, true, 'verified-complete migration tombstones the meta');
  assert.equal(getAnnotationsMap(doc).has('m-str'), true);
  const derived = deriveCalloutsFromByPage(docToByPage(doc));
  assert.equal(derived.length, 1);
  assert.equal(derived[0].id, 'm-str');
  assert.equal(derived[0].pageNumber, 3, 'pageNumber is normalized to the coerced number');
  assert.equal(derived[0].text, 'string page');
});

test('migration: an id-less meta entry blocks the tombstone and leaves the meta intact', () => {
  const doc = new Y.Doc();
  const idLess = { ...normalizedCallout('temp', 1, 'no id') };
  delete idLess.id;
  const legacy = [normalizedCallout('m-ok', 1, 'has id'), idLess];
  setMetaValue(doc, 'calloutsList', legacy);

  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  // The verifiable entry still migrates…
  assert.equal(res.migrated, true);
  assert.equal(res.migratedCount, 1);
  assert.equal(getAnnotationsMap(doc).has('m-ok'), true);
  // …but the unverifiable one blocks the tombstone: the meta stays as the
  // recovery copy.
  assert.equal(res.tombstoned, false);
  assert.equal(res.droppedCount, 1);
  assert.deepEqual(getMetaValue(doc, 'calloutsList'), legacy, 'meta blob intact as the recovery copy');

  // A repeat open converges to zero ops (already-migrated id skipped, id-less
  // still blocks) — never a tombstone, never churn.
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const again = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  assert.equal(updates, 0, 'repeat run with the same unverifiable entry is a zero-op');
  assert.equal(again.tombstoned, false);
  assert.deepEqual(getMetaValue(doc, 'calloutsList'), legacy);
});

test('migration: crash-prefix partial map — absent meta entries migrate, present ids stay authoritative, then tombstone', () => {
  // Simulates a migration that wrote page-1 entries and died before page 2 and
  // the tombstone. Branch 1 must not just tombstone: the missing entries
  // migrate first, and the map's (possibly newer) copy of co-1 is untouched.
  const doc = new Y.Doc();
  const newerCo1 = calloutGroup('co-1', 1, 'newer than the blob');
  syncByPageToDoc(doc, { 1: { objects: [newerCo1] } });
  const staleCo1 = normalizedCallout('co-1', 1, 'stale blob copy');
  const missingCo2 = normalizedCallout('co-2', 2, 'never landed');
  setMetaValue(doc, 'calloutsList', [staleCo1, missingCo2]);

  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: { 1: { width: 612, height: 792 }, 2: { width: 612, height: 792 } } });
  assert.equal(res.migrated, true);
  assert.equal(res.migratedCount, 1, 'only the absent entry is written');
  assert.equal(res.calloutCount, 2, 'both meta entries verified in the map');
  assert.equal(res.tombstoned, true);
  assert.equal(updates, 1, 'map write + tombstone are ONE atomic update');

  const map = getAnnotationsMap(doc);
  assert.equal(map.has('co-2'), true, 'the crash-lost entry landed');
  assert.equal(
    // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field
    // storage): marks are nested maps now, read through readAnnotationObject.
    readAnnotationObject(doc, 'co-1').data.legacyCallout.text,
    'newer than the blob',
    'the map copy of co-1 is authoritative — never overwritten by the stale blob',
  );
  assert.equal(getMetaValue(doc, 'calloutsList'), null);
});

test('migration: an empty-list meta produces ZERO ops (stale [] is never tombstoned)', () => {
  // Old builds wrote calloutsList=[] on virtually every doc. Tombstoning those
  // would make every legacy open a WRITE — which viewer-tier RLS rejects.
  const doc = new Y.Doc();
  setMetaValue(doc, 'calloutsList', []);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  assert.equal(updates, 0, 'no Y.Doc op for an empty meta list');
  assert.equal(res.migrated, false);
  assert.equal(res.tombstoned, false);
  assert.deepEqual(getMetaValue(doc, 'calloutsList'), [], 'the stale [] stays put (harmless)');
});

test('migration: the whole meta→map migration is ONE atomic Yjs update', () => {
  const doc = new Y.Doc();
  setMetaValue(doc, 'calloutsList', [
    normalizedCallout('a-1', 1),
    normalizedCallout('a-2', 2),
    normalizedCallout('a-3', 2),
  ]);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const res = migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes: {} });
  assert.equal(res.migrated, true);
  assert.equal(res.tombstoned, true);
  assert.equal(updates, 1, 'three map writes + the tombstone commit as a single update');
});

test('read-only fallback: getUnmigratedMetaCallouts performs ZERO ops and the callouts still render', () => {
  // Viewer-tier opens must not write, but legacy meta callouts must still
  // render: the hook projects getUnmigratedMetaCallouts' entries into the
  // LOCAL byPage only. This pins the module half of that contract.
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [calloutGroup('already-migrated', 1)] } });
  setMetaValue(doc, 'calloutsList', [
    normalizedCallout('already-migrated', 1, 'in the map'),
    { ...normalizedCallout('legacy-only', 2, 'meta only'), pageNumber: '2' },
  ]);

  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const fallback = getUnmigratedMetaCallouts(doc);
  assert.equal(updates, 0, 'the read-only companion never touches the doc');
  assert.deepEqual(fallback.ids, ['legacy-only'], 'only entries absent from the map are returned');
  assert.equal(fallback.callouts.length, 1);
  assert.equal(fallback.callouts[0].pageNumber, 2, 'pageNumber normalized like the write path');

  // The local projection renders BOTH the map-native and the fallback callout…
  const byPage = docToByPage(doc);
  const combined = [...deriveCalloutsFromByPage(byPage), ...fallback.callouts];
  const projected = projectCalloutsIntoByPage(byPage, combined, { 1: { width: 612, height: 792 }, 2: { width: 612, height: 792 } });
  const renderedIds = Object.values(projected)
    .flatMap((p) => p.objects.filter((o) => o?.data?.type === 'callout').map((o) => o.data.id));
  assert.deepEqual(renderedIds.sort(), ['already-migrated', 'legacy-only']);
  assert.equal(updates, 0, '…still with zero doc ops');
  // …and the meta stays untouched for the next writable open to migrate.
  assert.equal(Array.isArray(getMetaValue(doc, 'calloutsList')), true);
});
