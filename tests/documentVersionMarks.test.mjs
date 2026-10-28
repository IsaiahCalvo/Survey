import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  docToByPage,
  docToSurveyMarkers,
  syncByPageToDoc,
  syncSurveyMarkersToDoc,
} from '../src/services/annotationDocStore.js';
import { bytesToPgHex, gzipBytes, pgHexToBytes } from '../src/services/annotationCheckpointCore.js';
import {
  carryMarksToNewVersion,
  loadStoredAnnotationDoc,
  versionCarryWriterId,
} from '../src/services/documentVersionMarks.js';

const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

function rect(id, left, top) {
  return { type: 'rect', id, left, top, width: 40, height: 20, stroke: '#e53935', strokeWidth: 2 };
}

// A fake Supabase client holding annotation_snapshots / annotation_updates rows.
function fakeClient({ snapshot = null, updates = [] } = {}) {
  const appended = [];
  const reads = [];
  const client = {
    appended,
    reads,
    from(table) {
      const filters = {};
      let limit = Infinity;
      const q = {
        select() { return q; },
        eq(col, val) { filters[col] = val; return q; },
        gt(col, val) { filters[`${col}>`] = val; return q; },
        order() { return q; },
        limit(n) { limit = n; return q; },
        maybeSingle() {
          reads.push({ table, ...filters });
          const row = table === 'annotation_snapshots' && snapshot?.document_id === filters.document_id ? snapshot : null;
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve) {
          reads.push({ table, ...filters });
          const rows = updates
            .filter((r) => r.document_id === filters.document_id && r.seq > (filters['seq>'] ?? -Infinity))
            .sort((a, b) => a.seq - b.seq)
            .slice(0, limit);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc(name, args) {
      appended.push({ name, args });
      return Promise.resolve({ data: [{ seq: 1 }], error: null });
    },
  };
  return client;
}

function updateSince(doc, run) {
  const before = Y.encodeStateVector(doc);
  run();
  return Y.encodeStateAsUpdate(doc, before);
}

test('the whole old document (snapshot + WAL tail) lands on the new version in one row', async () => {
  const source = new Y.Doc();
  syncByPageToDoc(source, { 1: { objects: [rect('a', 10, 10)] } });
  const snapshotBytes = await gzipBytes(Y.encodeStateAsUpdate(source));
  const tail = updateSince(source, () => {
    syncByPageToDoc(source, { 1: { objects: [rect('a', 10, 10)] }, 3: { objects: [rect('b', 200, 90)] } });
    syncSurveyMarkersToDoc(source, { m1: { annotationId: 'm1', pageNumber: 2, name: 'Panel A' } });
  });

  const client = fakeClient({
    snapshot: { document_id: OLD, snapshot: bytesToPgHex(snapshotBytes), at_seq: 4, encoding_version: 2 },
    updates: [
      // Already inside the snapshot: must not be read again.
      { document_id: OLD, seq: 4, data: bytesToPgHex(new Uint8Array([0, 0])) },
      { document_id: OLD, seq: 5, data: bytesToPgHex(tail) },
    ],
  });

  const counts = await carryMarksToNewVersion({ client, fromDocumentId: OLD, toDocumentId: NEW });
  assert.deepEqual(counts, { marks: 2, surveyMarkers: 1, total: 3 });
  assert.equal(client.appended.length, 1);
  const { name, args } = client.appended[0];
  assert.equal(name, 'append_annotation_update');
  assert.equal(args.p_document_id, NEW);
  assert.equal(args.p_client_id, versionCarryWriterId(OLD));
  assert.equal(args.p_client_seq, 1);

  const copy = new Y.Doc();
  Y.applyUpdate(copy, pgHexToBytes(args.p_data));
  const byPage = docToByPage(copy);
  assert.equal(byPage[1].objects[0].left, 10);
  assert.equal(byPage[3].objects[0].left, 200);
  assert.equal(byPage[3].objects[0].top, 90);
  assert.equal(docToSurveyMarkers(copy).m1.name, 'Panel A');
});

test('an old copy with no marks writes nothing', async () => {
  const client = fakeClient();
  const counts = await carryMarksToNewVersion({ client, fromDocumentId: OLD, toDocumentId: NEW });
  assert.equal(counts.total, 0);
  assert.equal(client.appended.length, 0);
});

test('a retry sends the same receipt, so the server replays it instead of copying twice', async () => {
  const source = new Y.Doc();
  syncByPageToDoc(source, { 1: { objects: [rect('a', 1, 2)] } });
  const updates = [{ document_id: OLD, seq: 1, data: bytesToPgHex(Y.encodeStateAsUpdate(source)) }];
  const first = fakeClient({ updates });
  const second = fakeClient({ updates });
  await carryMarksToNewVersion({ client: first, fromDocumentId: OLD, toDocumentId: NEW });
  await carryMarksToNewVersion({ client: second, fromDocumentId: OLD, toDocumentId: NEW });
  assert.deepEqual(first.appended[0].args, second.appended[0].args);
});

test('a failed read or write throws, so the caller keeps the old copy in the list', async () => {
  const readFails = fakeClient();
  readFails.from = () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
  });
  await assert.rejects(carryMarksToNewVersion({ client: readFails, fromDocumentId: OLD, toDocumentId: NEW }), /snapshot read failed/);

  const source = new Y.Doc();
  syncByPageToDoc(source, { 1: { objects: [rect('a', 1, 2)] } });
  const writeFails = fakeClient({ updates: [{ document_id: OLD, seq: 1, data: bytesToPgHex(Y.encodeStateAsUpdate(source)) }] });
  writeFails.rpc = () => Promise.resolve({ data: null, error: { message: 'annotation write is not permitted' } });
  await assert.rejects(carryMarksToNewVersion({ client: writeFails, fromDocumentId: OLD, toDocumentId: NEW }), /mark copy failed/);

  await assert.rejects(carryMarksToNewVersion({ client: writeFails, fromDocumentId: OLD, toDocumentId: OLD }), /two different/);
});

test('the WAL tail is read in pages past 1000 rows', async () => {
  const source = new Y.Doc();
  const updates = [];
  for (let i = 1; i <= 1203; i += 1) {
    const u = updateSince(source, () => source.getMap('meta').set(`k${i}`, i));
    updates.push({ document_id: OLD, seq: i, data: bytesToPgHex(u) });
  }
  const doc = await loadStoredAnnotationDoc(fakeClient({ updates }), OLD);
  assert.equal(doc.getMap('meta').get('k1203'), 1203);
  assert.equal(doc.getMap('meta').size, 1203);
});

test('marks only in the old builds\' map are carried, not left behind (review P1)', async () => {
  const source = new Y.Doc();
  // An older build kept each mark as one plain { p, o } in `annotations`.
  source.getMap('annotations').set('old-ink', { p: 2, o: rect('old-ink', 33, 44) });
  const updates = [{ document_id: OLD, seq: 1, data: bytesToPgHex(Y.encodeStateAsUpdate(source)) }];
  const client = fakeClient({ updates });
  const counts = await carryMarksToNewVersion({ client, fromDocumentId: OLD, toDocumentId: NEW });
  assert.equal(counts.marks, 1);
  assert.equal(client.appended.length, 1);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, pgHexToBytes(client.appended[0].args.p_data));
  assert.equal(docToByPage(copy)[2].objects[0].left, 33);

  // Still the same bytes on a retry (fixed writer id and clock).
  const again = fakeClient({ updates });
  await carryMarksToNewVersion({ client: again, fromDocumentId: OLD, toDocumentId: NEW });
  assert.equal(again.appended[0].args.p_data, client.appended[0].args.p_data);
});

test('the new file imports its own markup: old untouched imports and the import note stay behind (review P2)', async () => {
  const source = new Y.Doc();
  syncByPageToDoc(source, {
    1: {
      objects: [
        rect('mine', 10, 10),
        { ...rect('pdf-untouched', 50, 50), isPdfImported: true, pdfAnnotationId: '12R' },
        { ...rect('pdf-edited', 90, 90), isPdfImported: true, pdfAnnotationId: '13R', pdfImportedEditState: 'edited' },
      ],
    },
  });
  source.getMap('annoMeta').set('embeddedImportedIntoMarks', { at: '2026-10-01T00:00:00Z' });
  source.getMap('annoMeta').set('embeddedImportIncomplete', { attempts: 1, pages: [3] });
  const client = fakeClient({ updates: [{ document_id: OLD, seq: 1, data: bytesToPgHex(Y.encodeStateAsUpdate(source)) }] });
  const counts = await carryMarksToNewVersion({ client, fromDocumentId: OLD, toDocumentId: NEW });
  assert.equal(counts.marks, 2);

  const copy = new Y.Doc();
  Y.applyUpdate(copy, pgHexToBytes(client.appended[0].args.p_data));
  const ids = docToByPage(copy)[1].objects.map((o) => o.id).sort();
  assert.deepEqual(ids, ['mine', 'pdf-edited']);
  assert.equal(copy.getMap('annoMeta').has('embeddedImportedIntoMarks'), false);
  assert.equal(copy.getMap('annoMeta').has('embeddedImportIncomplete'), false);
});

test('deleted PDF markup travels even with no marks, so it stays deleted', async () => {
  const source = new Y.Doc();
  source.getMap('deletedPdfAnnotations').set('1\u000012R', { pageNumber: 1, pdfAnnotationId: '12R' });
  const client = fakeClient({ updates: [{ document_id: OLD, seq: 1, data: bytesToPgHex(Y.encodeStateAsUpdate(source)) }] });
  const counts = await carryMarksToNewVersion({ client, fromDocumentId: OLD, toDocumentId: NEW });
  assert.equal(counts.total, 0);
  assert.equal(client.appended.length, 1);
});
