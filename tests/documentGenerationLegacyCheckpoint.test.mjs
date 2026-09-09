import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { gzipSync } from 'node:zlib';
import { transformDocumentGenerationSource } from '../src/services/documentGenerationTransform.js';

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const b64 = v => Buffer.from(v).toString('base64');
const map = value => new Y.Map(Object.entries(value));
function fixture({ compressed = false, tail = true } = {}) {
  const d = new Y.Doc();
  const fabric = { type: 'rect', pageNumber: 2, left: 1, top: 2,
    data: { id: 'mark', pageNumber: 2 }, meta: { authorId: id(2) } };
  d.getMap('annotations').set('mark', map({ id: 'mark', type: 'rect', pageNumber: 2, callout: 17,
    fabric: map(fabric), meta: map({ authorId: id(2), createdAt: 123 }) }));
  d.getMap('meta').set('currentPage', 2);
  d.getMap('__annotationLatestSnapshot').set('mark', { archiveOnly: true });
  const state = Y.encodeStateAsUpdate(d), vector = Y.encodeStateVector(d);
  d.getMap('annotations').get('mark').get('fabric').set('left', 25);
  const update = Y.encodeStateAsUpdate(d, vector); d.destroy();
  const checkpoint = '9007199254740993', high = '9007199254740998';
  return { operationId: id(3), operation: { type: 'move', from: 2, to: 1 },
    pageCount: 3, pageSizes: [1, 2, 3].map(() => ({ width: 612, height: 792 })),
    sidecars: [], sourcePayload: { semantic: { version: 1, document_id: id(1), generation_id: null,
      document: { id: id(1), user_id: id(2), page_count: 3 }, wal_head: '0',
      source_object: { bucket_id: 'documents', path: `${id(2)}/file.pdf`, id: id(4), version: id(5), byte_length: '100' },
      sidecar_objects: [], sources: { annotation_snapshot: null, annotation_updates: [],
        document_annotations: [], survey_sessions: [], survey_items: [], generation_baseline: null,
        generation_snapshot: null, generation_updates: [],
        doc_yjs_state: { document_id: id(1), through_seq: checkpoint, encoding_version: compressed ? 2 : 1,
          state_base64: b64(compressed ? gzipSync(state) : state) },
        doc_yjs_updates: tail ? [{ document_id: id(1), seq: high, update_base64: b64(update) }] : [] } },
      connector_history: {}, wal_history: {} } };
}
function reload(input, result) {
  const next = structuredClone(input), s = next.sourcePayload.semantic.sources;
  next.operationId = id(7); next.pageCount = result.projection.document.page_count;
  next.pageSizes = Array.from({ length: next.pageCount }, () => ({ width: 612, height: 792 }));
  next.sourcePayload.semantic.document = result.projection.document;
  s.annotation_snapshot = { document_id: id(1), at_seq: '0', encoding_version: 1,
    snapshot_base64: b64(result.baselineUpdate) };
  const saved = result.legacyCheckpoint;
  s.doc_yjs_state = { document_id: saved.documentId, through_seq: saved.throughSeq,
    encoding_version: saved.encodingVersion, state_base64: b64(saved.state), state_vector_base64: b64(saved.stateVector) };
  // Captured old rows can remain in the archive; the new floor must skip them.
  return next;
}

for (const compressed of [false, true]) test(`legacy checkpoint reloads nested maps and exact WAL floor (gzip=${compressed})`, async () => {
  const input = fixture({ compressed }), before = structuredClone(input);
  const result = await transformDocumentGenerationSource(input), saved = result.legacyCheckpoint;
  assert.ok(saved, 'transform must return a reloadable checkpoint, not only projection JSON');
  assert.equal(saved.documentId, id(1)); assert.equal(saved.encodingVersion, 1);
  assert.equal(saved.throughSeq, '9007199254740998');
  const d = new Y.Doc(); Y.applyUpdate(d, saved.state);
  assert.deepEqual(Y.encodeStateVector(d), saved.stateVector);
  assert.deepEqual(d.getMap('annotations').toJSON(), result.projection.legacyYjs.annotations);
  const record = d.getMap('annotations').get('mark');
  assert.ok(record instanceof Y.Map); assert.ok(record.get('fabric') instanceof Y.Map);
  assert.ok(record.get('meta') instanceof Y.Map);
  assert.equal(record.get('callout'), 17, 'unrelated extension fields keep their original JSON type');
  assert.equal(record.get('fabric').get('left'), 25); assert.equal(record.get('pageNumber'), 1);
  assert.equal(record.get('meta').get('authorId'), id(2));
  assert.equal(d.share.has('__annotationLatestSnapshot'), false);
  assert.deepEqual(input, before); assert.deepEqual(result.archive.sourcePayload, before.sourcePayload);
  const next = reload(input, result); next.operation = { type: 'move', from: 1, to: 3 };
  const second = await transformDocumentGenerationSource(next);
  assert.equal(second.projection.legacyYjs.annotations.mark.pageNumber, 3);
  assert.equal(second.projection.legacyYjs.annotations.mark.fabric.left, 25);
  assert.equal(second.legacyCheckpoint.throughSeq, saved.throughSeq);
  const repeated = await transformDocumentGenerationSource(input);
  assert.deepEqual(repeated.legacyCheckpoint, saved, 'same operation yields stable bytes');
  d.destroy();
});

test('copied checkpoint retains authors and supports a second operation without old WAL resurrection', async () => {
  const input = fixture(); input.operation = { type: 'duplicate', page: 2 };
  const result = await transformDocumentGenerationSource(input), next = reload(input, result);
  const copyId = result.identityMap.annotations.mark;
  next.operation = { type: 'delete', page: 2 };
  const second = await transformDocumentGenerationSource(next);
  assert.equal(second.projection.legacyYjs.annotations.mark, undefined);
  assert.equal(second.projection.legacyYjs.annotations[copyId].pageNumber, 2);
  assert.equal(second.projection.legacyYjs.annotations[copyId].meta.authorId, id(2));
  assert.equal(second.projection.modern.annotationsByPage[2].objects[0].data.id, copyId);
});

test('checkpoint floor preserves a larger prior checkpoint and empty state is a real full update', async () => {
  const input = fixture({ tail: false });
  input.operation = { type: 'delete', page: 2 };
  const result = await transformDocumentGenerationSource(input);
  assert.equal(result.legacyCheckpoint.throughSeq, '9007199254740993');
  const d = new Y.Doc(); Y.applyUpdate(d, result.legacyCheckpoint.state);
  assert.deepEqual(d.getMap('annotations').toJSON(), {});
  assert.deepEqual(Y.encodeStateVector(d), result.legacyCheckpoint.stateVector); d.destroy();
  const next = reload(input, result); next.operation = { type: 'insert', afterPage: 1 };
  assert.deepEqual((await transformDocumentGenerationSource(next)).projection.legacyYjs.annotations, {});
});

for (const embeddedAuthor of [null, id(2), id(99)]) test(`callout checkpoint keeps nested maps, attribution and second move (author=${embeddedAuthor})`, async () => {
  const input = fixture({ tail: false }), d = new Y.Doc();
  const callout = { id: 'note', type: 'callout', pageNumber: 2, text: 'Shared note',
    arrowTip: { x: 0.1, y: 0.2 }, textBoxPosition: { x: 0.3, y: 0.4 },
    ...(embeddedAuthor ? { meta: { authorId: embeddedAuthor } } : {}) };
  d.getMap('callouts').set('note', map({ id: 'note', type: 'callout', pageNumber: 2,
    callout: map(callout), meta: map({ authorId: id(2), createdAt: 123 }) }));
  d.getMap('meta').set('settings', { labels: ['one', 'two'], enabled: false });
  input.sourcePayload.semantic.sources.doc_yjs_state.state_base64 = b64(Y.encodeStateAsUpdate(d)); d.destroy();
  const before = structuredClone(input), result = await transformDocumentGenerationSource(input), loaded = new Y.Doc();
  assert.deepEqual(input, before); assert.deepEqual(result.archive.sourcePayload, before.sourcePayload);
  Y.applyUpdate(loaded, result.legacyCheckpoint.state);
  const note = loaded.getMap('callouts').get('note');
  assert.ok(note instanceof Y.Map); assert.ok(note.get('callout') instanceof Y.Map);
  assert.ok(note.get('meta') instanceof Y.Map);
  assert.equal(note.get('callout').get('text'), 'Shared note');
  assert.equal(note.get('meta').get('authorId'), id(2), 'original envelope attribution stays intact');
  assert.equal(note.get('callout').get('meta').authorId, embeddedAuthor || id(2));
  assert.equal(result.projection.modern.annotationsByPage[1].objects[0].data.authorId, embeddedAuthor || id(2));
  assert.deepEqual(loaded.getMap('meta').toJSON(), result.projection.legacyYjs.meta);
  const next = reload(input, result); next.operation = { type: 'move', from: 1, to: 3 };
  const second = await transformDocumentGenerationSource(next);
  assert.equal(second.projection.legacyYjs.callouts.note.pageNumber, 3);
  assert.equal(second.projection.legacyYjs.callouts.note.callout.text, 'Shared note'); loaded.destroy();
});

test('two replicas can edit separate legacy fields after checkpoint reload', async () => {
  const result = await transformDocumentGenerationSource(fixture()), a = new Y.Doc(), b = new Y.Doc();
  try {
    Y.applyUpdate(a, result.legacyCheckpoint.state); Y.applyUpdate(b, result.legacyCheckpoint.state);
    const av = Y.encodeStateVector(a), bv = Y.encodeStateVector(b);
    a.getMap('annotations').get('mark').get('fabric').set('left', 80);
    b.getMap('annotations').get('mark').get('fabric').set('top', 90);
    const au = Y.encodeStateAsUpdate(a, av), bu = Y.encodeStateAsUpdate(b, bv);
    Y.applyUpdate(a, bu); Y.applyUpdate(b, au);
    assert.deepEqual(a.getMap('annotations').toJSON(), b.getMap('annotations').toJSON());
    const fabric = a.getMap('annotations').get('mark').get('fabric');
    assert.equal(fabric.get('left'), 80); assert.equal(fabric.get('top'), 90);
    assert.equal(a.getMap('annotations').get('mark').get('meta').get('authorId'), id(2));
  } finally { a.destroy(); b.destroy(); }
});
