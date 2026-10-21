// The server-side survey write path the survey-mcp connector uses (KAL-531):
// load the Yjs annotation doc, change a marker, append the diff. These tests
// prove the CRDT mechanics in node with the real yjs and the same import-free
// shared modules the Deno edge function loads, so a change converges on an
// already-open client and never clobbers other markers.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { docToSurveyMarkers, syncSurveyMarkersToDoc } from '../supabase/functions/_shared/surveyMarkerDocSync.js';
import { bytesToPgHex, pgHexToBytes } from '../supabase/functions/_shared/pgBytea.js';

test('pgBytea round-trips arbitrary bytes, including \\ and x', () => {
  const b = new Uint8Array([0, 1, 2, 255, 16, 0x5c, 0x78, 127, 128]);
  assert.deepEqual(pgHexToBytes(bytesToPgHex(b)), b);
  assert.equal(bytesToPgHex(new Uint8Array([0, 255])), '\\x00ff');
  assert.deepEqual(pgHexToBytes('\\x'), new Uint8Array(0));
  assert.deepEqual(pgHexToBytes(b), b); // a Uint8Array passes through
});

test('a server-side marker write converges on an already-open client', () => {
  // Client A has the document open with one marker; its snapshot is persisted.
  const clientA = new Y.Doc();
  const id = `surveyMarker-${'a'.repeat(8)}`;
  syncSurveyMarkersToDoc(clientA, {
    [id]: { id, pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 }, categoryId: 'cat', name: 'D-117', checklistResponses: {} },
  });
  const snapshot = Y.encodeStateAsUpdate(clientA);

  // The edge function loads that snapshot (via the bytea hex wire form), sets
  // an answer, and emits the diff — exactly what writeMarkers does.
  const server = new Y.Doc();
  Y.applyUpdate(server, pgHexToBytes(bytesToPgHex(snapshot)));
  const markers = docToSurveyMarkers(server);
  assert.ok(markers[id], 'snapshot carried the marker to the server doc');
  const before = Y.encodeStateVector(server);
  markers[id] = { ...markers[id], checklistResponses: { c1: { selection: 'N' } } };
  const res = syncSurveyMarkersToDoc(server, markers, { origin: 'agent' });
  assert.deepEqual([res.added, res.updated, res.removed], [0, 1, 0]);
  const delta = Y.encodeStateAsUpdate(server, before);

  // The WAL row (bytea hex) reaches the open client; it applies and converges.
  Y.applyUpdate(clientA, pgHexToBytes(bytesToPgHex(delta)));
  const after = docToSurveyMarkers(clientA)[id];
  assert.deepEqual(after.checklistResponses, { c1: { selection: 'N' } });
  assert.equal(after.name, 'D-117', 'other fields are untouched');
});

test('re-writing identical marker state produces no update (idempotent)', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { m1: { id: 'm1', note: 'a' } });
  const res = syncSurveyMarkersToDoc(doc, docToSurveyMarkers(doc), { origin: 'agent' });
  assert.deepEqual([res.added, res.updated, res.removed], [0, 0, 0]);
});

// Mirrors the connector's add_note: parse the note to an object, append to its
// text, keep media and other fields, and never touch the other marker.
const noteObjectOf = (note) => {
  if (note && typeof note === 'object') return { ...note };
  if (typeof note === 'string' && note.trim().startsWith('{')) {
    try { const p = JSON.parse(note); if (p && typeof p === 'object') return p; } catch { /* plain */ }
  }
  return typeof note === 'string' && note ? { text: note } : {};
};

test('add_note appends to the note text, keeps media, and leaves other markers', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, {
    a: { id: 'a', note: { text: 'first', media: [{ id: 'm1', kind: 'photo', path: 'p/1.jpg' }] } },
    b: { id: 'b', note: 'keep' },
  });
  const markers = docToSurveyMarkers(doc);
  const obj = noteObjectOf(markers.a.note);
  const before = String(obj.text || '').trimEnd();
  obj.text = before ? `${before}\nsecond` : 'second';
  markers.a = { ...markers.a, note: obj };
  const res = syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  assert.deepEqual([res.added, res.updated, res.removed], [0, 1, 0]);
  const out = docToSurveyMarkers(doc);
  assert.equal(out.a.note.text, 'first\nsecond');
  assert.deepEqual(out.a.note.media, [{ id: 'm1', kind: 'photo', path: 'p/1.jpg' }], 'media is kept');
  assert.equal(out.b.note, 'keep', 'the untouched marker stays');
});

test('add_note on a plain-string note turns it into { text } without losing text', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { a: { id: 'a', note: 'hello' } });
  const markers = docToSurveyMarkers(doc);
  const obj = noteObjectOf(markers.a.note);
  obj.text = `${String(obj.text || '').trimEnd()}\nworld`;
  markers.a = { ...markers.a, note: obj };
  syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  assert.equal(docToSurveyMarkers(doc).a.note.text, 'hello\nworld');
});

// With the person's survey-marker-fields flag on, the connector must write the
// SAME per-field shape the app writes (fieldMaps: true). Two things to prove:
// a fieldMaps write still converges on an open client, and two connector writes
// to DIFFERENT fields of the SAME marker now MERGE instead of clobbering — the
// pre-existing whole-marker LWW the review flagged, fixed by the flag.
test('a fieldMaps write converges on an already-open client', () => {
  const clientA = new Y.Doc();
  const id = 'surveyMarker-fm';
  syncSurveyMarkersToDoc(clientA, { [id]: { id, name: 'D-9', checklistResponses: {} } }, { fieldMaps: true });
  const snapshot = Y.encodeStateAsUpdate(clientA);

  const server = new Y.Doc();
  Y.applyUpdate(server, pgHexToBytes(bytesToPgHex(snapshot)));
  const markers = docToSurveyMarkers(server);
  const before = Y.encodeStateVector(server);
  markers[id] = { ...markers[id], checklistResponses: { c1: { selection: 'N' } } };
  syncSurveyMarkersToDoc(server, markers, { origin: 'agent', fieldMaps: true });
  Y.applyUpdate(clientA, pgHexToBytes(bytesToPgHex(Y.encodeStateAsUpdate(server, before))));

  const after = docToSurveyMarkers(clientA)[id];
  assert.deepEqual(after.checklistResponses, { c1: { selection: 'N' } });
  assert.equal(after.name, 'D-9', 'other fields untouched');
});

// set_entity (connector): set or clear marker.entityId, keeping other fields —
// the same whole-dict mutate the connector runs inside writeMarkers.
test('set_entity sets and clears the entity, keeping other fields', () => {
  const doc = new Y.Doc();
  const id = 'surveyMarker-ent';
  syncSurveyMarkersToDoc(doc, { [id]: { id, name: 'D-9', categoryId: 'cat', checklistResponses: { c1: { selection: 'Y' } } } });

  let markers = docToSurveyMarkers(doc);
  markers[id] = { ...markers[id], entityId: 'ent-1' };
  syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  let after = docToSurveyMarkers(doc)[id];
  assert.equal(after.entityId, 'ent-1');
  assert.equal(after.name, 'D-9');
  assert.deepEqual(after.checklistResponses, { c1: { selection: 'Y' } });

  markers = docToSurveyMarkers(doc);
  markers[id] = { ...markers[id], entityId: null };
  syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  after = docToSurveyMarkers(doc)[id];
  assert.equal(after.entityId, null);
  assert.equal(after.name, 'D-9');
});

// create_item (connector): add a brand-new marker and append it without
// touching the markers already there.
test('create_item adds a new marker with category, page, bounds, leaving others', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { existing: { id: 'existing', name: 'keep', categoryId: 'cat' } });

  const markers = docToSurveyMarkers(doc);
  const newId = 'surveyMarker-new';
  markers[newId] = { id: newId, pageNumber: 2, bounds: { x: 5, y: 6, width: 7, height: 8 }, categoryId: 'cat', name: 'D-200', entityId: null, checklistResponses: {} };
  const res = syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  assert.deepEqual([res.added, res.updated, res.removed], [1, 0, 0]);

  const out = docToSurveyMarkers(doc);
  assert.equal(out.existing.name, 'keep', 'the existing marker stays');
  assert.deepEqual(out[newId].bounds, { x: 5, y: 6, width: 7, height: 8 });
  assert.equal(out[newId].categoryId, 'cat');
  assert.equal(out[newId].pageNumber, 2);
  assert.deepEqual(out[newId].checklistResponses, {});
});

// undo_change mechanics: the connector captures the touched fields' BEFORE
// values, then re-applies them (null → cleared). Here: set an entity on a
// marker that had none, then undo restores it to no entity, keeping other
// fields. Mirrors the server's applyUndo (null means "the field was not set").
test('undo restores an item to its state before set_entity', () => {
  const doc = new Y.Doc();
  const id = 'surveyMarker-undo-ent';
  syncSurveyMarkersToDoc(doc, { [id]: { id, name: 'D-9', categoryId: 'cat', checklistResponses: { c1: { selection: 'Y' } } } });

  // set_entity captures before = { entityId:null, entityName:null, entityColor:null }.
  const before = { entityId: null, entityName: null, entityColor: null };
  let markers = docToSurveyMarkers(doc);
  markers[id] = { ...markers[id], entityId: 'ent-1', entityName: 'Installed', entityColor: '#22aa55' };
  syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  assert.equal(docToSurveyMarkers(doc)[id].entityId, 'ent-1');

  // undo_change re-applies the before fields; null clears.
  markers = docToSurveyMarkers(doc);
  const patch = {};
  for (const [k, v] of Object.entries(before)) patch[k] = v === null ? undefined : v;
  markers[id] = { ...markers[id], ...patch };
  syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });

  const after = docToSurveyMarkers(doc)[id];
  assert.equal(after.entityId ?? null, null, 'entity cleared');
  assert.equal(after.entityName ?? null, null);
  assert.equal(after.name, 'D-9', 'other fields untouched');
  assert.deepEqual(after.checklistResponses, { c1: { selection: 'Y' } });
});

// undo of a create_item removes the marker it added (origin 'agent' allows the
// key to be dropped), leaving every other marker in place.
test('undo of a create removes just the created marker', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { keep: { id: 'keep', name: 'stay', categoryId: 'cat' } });
  const newId = 'surveyMarker-undo-new';

  let markers = docToSurveyMarkers(doc);
  markers[newId] = { id: newId, pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 }, categoryId: 'cat', name: 'D-200', checklistResponses: {} };
  syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  assert.ok(docToSurveyMarkers(doc)[newId], 'created');

  // undo_change for a create deletes the key.
  markers = docToSurveyMarkers(doc);
  delete markers[newId];
  const res = syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  assert.equal(res.removed, 1);
  const out = docToSurveyMarkers(doc);
  assert.equal(out[newId], undefined, 'created marker removed');
  assert.equal(out.keep.name, 'stay', 'the other marker stays');
});

// undo_change for set_answers restores ONLY the checklist entries that call
// set — an answer changed afterwards (or by another request) survives the undo.
// Mirrors the server's kind:'answers' undo (restore captured keys, leave rest).
test('undo of set_answers keeps a later change to a different answer', () => {
  const doc = new Y.Doc();
  const id = 'surveyMarker-undo-ans';
  syncSurveyMarkersToDoc(doc, { [id]: { id, name: 'D', categoryId: 'cat', checklistResponses: { a: { selection: 'Y' } } } });

  // The agent sets answer a → N; it captures only { a: <prior> }.
  let m = docToSurveyMarkers(doc);
  const capturedKeys = { a: ('a' in m[id].checklistResponses) ? m[id].checklistResponses.a : null };
  m[id] = { ...m[id], checklistResponses: { ...m[id].checklistResponses, a: { selection: 'N' } } };
  syncSurveyMarkersToDoc(doc, m, { origin: 'agent' });

  // Afterwards, answer b is set to Y (a different request / the person).
  m = docToSurveyMarkers(doc);
  m[id] = { ...m[id], checklistResponses: { ...m[id].checklistResponses, b: { selection: 'Y' } } };
  syncSurveyMarkersToDoc(doc, m, { origin: 'agent' });

  // Undo the agent's change: restore only key a, leave b.
  m = docToSurveyMarkers(doc);
  const responses = { ...m[id].checklistResponses };
  for (const [clId, prior] of Object.entries(capturedKeys)) {
    if (prior === null || prior === undefined) delete responses[clId];
    else responses[clId] = prior;
  }
  m[id] = { ...m[id], checklistResponses: responses };
  syncSurveyMarkersToDoc(doc, m, { origin: 'agent' });

  const after = docToSurveyMarkers(doc)[id].checklistResponses;
  assert.deepEqual(after.a, { selection: 'Y' }, 'a restored to its prior value');
  assert.deepEqual(after.b, { selection: 'Y' }, 'the later change to b survived the undo');
});

// undo_change for add_note strips ONLY the text this call appended, if the note
// still ends with it, so a note edited afterwards is left as it is.
test('undo of add_note strips just the appended segment', () => {
  const doc = new Y.Doc();
  const id = 'surveyMarker-undo-note';
  syncSurveyMarkersToDoc(doc, { [id]: { id, note: { text: 'first' } } });

  // add_note appends 'second' → seg = '\nsecond'.
  const seg = '\nsecond';
  let m = docToSurveyMarkers(doc);
  m[id] = { ...m[id], note: { ...m[id].note, text: `first${seg}` } };
  syncSurveyMarkersToDoc(doc, m, { origin: 'agent' });

  // Undo strips the segment.
  m = docToSurveyMarkers(doc);
  const current = String(m[id].note.text || '');
  if (current.endsWith(seg)) m[id] = { ...m[id], note: { ...m[id].note, text: current.slice(0, current.length - seg.length) } };
  syncSurveyMarkersToDoc(doc, m, { origin: 'agent' });

  assert.equal(docToSurveyMarkers(doc)[id].note.text, 'first', 'only the appended text was removed');
});

test('fieldMaps: concurrent writes to different fields of one marker both survive', () => {
  const origin = new Y.Doc();
  const id = 'surveyMarker-merge';
  syncSurveyMarkersToDoc(origin, { [id]: { id, name: 'D-9', note: { text: '' }, checklistResponses: {} } }, { fieldMaps: true });
  const snapshot = Y.encodeStateAsUpdate(origin);

  // Two connector calls load the same state and each change a DIFFERENT field.
  const a = new Y.Doc(); Y.applyUpdate(a, snapshot);
  const b = new Y.Doc(); Y.applyUpdate(b, snapshot);

  const beforeA = Y.encodeStateVector(a);
  const ma = docToSurveyMarkers(a);
  ma[id] = { ...ma[id], checklistResponses: { c1: { selection: 'Y' } } };
  syncSurveyMarkersToDoc(a, ma, { origin: 'agent', fieldMaps: true });
  const updateA = Y.encodeStateAsUpdate(a, beforeA);

  const beforeB = Y.encodeStateVector(b);
  const mb = docToSurveyMarkers(b);
  mb[id] = { ...mb[id], note: { text: 'checked on site' } };
  syncSurveyMarkersToDoc(b, mb, { origin: 'agent', fieldMaps: true });
  const updateB = Y.encodeStateAsUpdate(b, beforeB);

  // A client that merges both WAL rows keeps BOTH field edits.
  const client = new Y.Doc();
  Y.applyUpdate(client, snapshot);
  Y.applyUpdate(client, pgHexToBytes(bytesToPgHex(updateA)));
  Y.applyUpdate(client, pgHexToBytes(bytesToPgHex(updateB)));
  const merged = docToSurveyMarkers(client)[id];
  assert.deepEqual(merged.checklistResponses, { c1: { selection: 'Y' } }, 'A survived');
  assert.deepEqual(merged.note, { text: 'checked on site' }, 'B survived');
  assert.equal(merged.name, 'D-9');
});
