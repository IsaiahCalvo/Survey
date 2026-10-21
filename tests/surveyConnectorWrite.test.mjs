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

test('add_note appends and never deletes the other markers', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { a: { id: 'a', note: 'first' }, b: { id: 'b', note: 'keep' } });
  const markers = docToSurveyMarkers(doc);
  const prev = (typeof markers.a.note === 'string' && markers.a.note) ? markers.a.note : (markers.a.notes || '');
  markers.a = { ...markers.a, note: `${prev}\nsecond`, notes: `${prev}\nsecond` };
  const res = syncSurveyMarkersToDoc(doc, markers, { origin: 'agent' });
  assert.deepEqual([res.added, res.updated, res.removed], [0, 1, 0]);
  const out = docToSurveyMarkers(doc);
  assert.equal(out.a.note, 'first\nsecond');
  assert.equal(out.b.note, 'keep', 'the untouched marker stays');
});
