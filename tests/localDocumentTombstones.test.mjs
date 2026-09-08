import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { buildLocalDocumentState, createLocalDocumentStateReader } from '../src/services/localDocumentState.js';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';
import { createLocalDocumentDraftStore } from '../src/services/localDocumentDraftStore.js';
import { getPdfAnnotationMutationState, filterRestoredPdfAnnotationTombstones } from '../src/utils/textMarkupGroupTransactions.js';

const localId = 'local:12345678-1234-1234-1234-123456789abc';
const fileFor = state => ({ localId: state.pdfId, _surveyPdfId: state.pdfId, storageMode: 'local', _localDocumentState: state });
const read = file => JSON.parse(createLocalDocumentStateReader(file).getItem(`pdfData_${file.localId}`));
const identity = () => ({ v: 1, pageNumber: 2, annotsIndex: 0, fingerprint: {
  subtype: 'Highlight', rect: [10, 20, 30, 40], flags: 4, nm: 'native-name', contents: 'Keep source text',
  title: 'Original author', subject: '', quadPoints: [10, 40, 30, 40, 10, 20, 30, 20],
  inkList: [], line: [], vertices: [], calloutLine: [],
} });
const source = () => ({ 2: { objects: [{ pdfAnnotationId: 'annot_p1_0', pdfAnnotationType: 'Highlight',
  data: { pdfNativeAnnotationIdentity: identity() } }] } });
const tombstones = () => getPdfAnnotationMutationState(source(), {}).deletedPdfAnnotations;
const snapshot = (pdfId = localId, deletedPdfAnnotations = tombstones()) => buildLocalDocumentState({ pdfId, deletedPdfAnnotations });
const pdf = () => new File(['%PDF-1.7\noriginal native annotations\n%%EOF'], 'native.pdf', { type: 'application/pdf' });

test('optional tombstones preserve version-one six-key format and legacy bytes', () => {
  const legacy = buildLocalDocumentState({ pdfId: localId });
  assert.equal(legacy.entries[`pdfData_${localId}`], '{"items":{},"annotations":{}}');
  assert.equal(Object.hasOwn(read(fileFor(legacy)), 'deletedPdfAnnotations'), false);
  const state = snapshot();
  assert.equal(state.version, 1); assert.equal(Object.keys(state.entries).length, 6);
  assert.deepEqual(read(fileFor(state)).deletedPdfAnnotations, tombstones());
  assert.deepEqual(read(fileFor(snapshot(localId, []))).deletedPdfAnnotations, []);
});

test('snapshot and reader own native identity metadata without renaming or dropping it', () => {
  const input = tombstones(); input[0].extraIdentity = { source: ['retain', 0, null, false] };
  const expected = structuredClone(input); const state = snapshot(localId, input);
  const reader = createLocalDocumentStateReader(fileFor(state));
  input[0].pdfNativeAnnotationIdentity.fingerprint.title = 'Changed'; input.length = 0;
  state.entries[`pdfData_${localId}`] = '{}';
  const raw = reader.getItem(`pdfData_${localId}`);
  assert.deepEqual(JSON.parse(raw).deletedPdfAnnotations, expected);
  JSON.parse(raw).deletedPdfAnnotations[0].pageNumber = 9;
  assert.deepEqual(JSON.parse(reader.getItem(`pdfData_${localId}`)).deletedPdfAnnotations, expected);
  assert.deepEqual(filterRestoredPdfAnnotationTombstones(expected, source()), [], 'restoring live native mark still wins');
});

test('invalid tombstone shapes fail on build and saved-state read without losing the saved copy', () => {
  const valid = tombstones()[0];
  const bad = [null, {}, [null], [[]], [{}], [{ ...valid, pageNumber: 0 }],
    [{ ...valid, pageNumber: '2' }], [{ ...valid, pageNumber: 1.2 }],
    [{ ...valid, pdfAnnotationId: '' }], [{ ...valid, pdfAnnotationId: 7 }],
    [{ ...valid, pdfAnnotationType: {} }], [{ ...valid, pdfNativeAnnotationIdentity: [] }]];
  for (const value of bad) {
    assert.throws(() => snapshot(localId, value), /native deletion/i);
    const state = buildLocalDocumentState({ pdfId: localId });
    const raw = JSON.stringify({ items: {}, annotations: {}, deletedPdfAnnotations: value });
    state.entries[`pdfData_${localId}`] = raw;
    assert.throws(() => createLocalDocumentStateReader(fileFor(state)), /native deletion/i);
    assert.equal(state.entries[`pdfData_${localId}`], raw);
  }
});

test('unsupported JSON metadata cannot silently disappear or run accessors while saving', () => {
  const cycle = {}; cycle.self = cycle;
  const getter = Object.defineProperty({}, 'hidden', { enumerable: true, get() { assert.fail('getter executed'); } });
  const sparse = []; sparse.length = 1;
  for (const extra of [undefined, NaN, Infinity, 1n, () => 1, new Date(), new Map(), new Uint8Array([1]), cycle, getter, sparse]) {
    const entry = { ...tombstones()[0], extra };
    assert.throws(() => snapshot(localId, [entry]), /native deletion/i);
  }
});

test('canonical cold reopen retains tombstones alongside exact original bytes', async () => {
  const indexedDB = new IDBFactory(); const store = createLocalDocumentStore({ indexedDB });
  const row = await store.importLocalDocument(pdf());
  await store.saveLocalDocumentState(row.localId, snapshot(row.localId), { expectedRevision: 1 });
  store.close(); const cold = createLocalDocumentStore({ indexedDB });
  try {
    const opened = await cold.openLocalDocument(row.localId);
    assert.equal(await opened.text(), await pdf().text());
    assert.deepEqual(read(opened).deletedPdfAnnotations, tombstones());
  } finally { cold.close(); }
});

test('cold draft and independent recovery copy retain full tombstones and explicit undo clearing', async () => {
  const indexedDB = new IDBFactory(); const drafts = createLocalDocumentDraftStore({ indexedDB });
  const managed = Object.assign(pdf(), { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 });
  const writer = drafts.createWriter(managed); const receipt = await writer.capture(snapshot());
  await writer.seal(); drafts.close();
  const cold = createLocalDocumentDraftStore({ indexedDB }); const library = createLocalDocumentStore({ indexedDB });
  try {
    const recovered = await cold.readDraft(receipt.sessionId, { expectedSequence: receipt.sequence });
    assert.deepEqual(read(fileFor(recovered.state)).deletedPdfAnnotations, tombstones());
    const copy = await library.importLocalDocumentCopy(recovered.file, recovered.state);
    assert.notEqual(copy.localId, localId);
    const opened = await library.openLocalDocument(copy.localId);
    assert.deepEqual(read(opened).deletedPdfAnnotations, tombstones());
    assert.equal(await opened.text(), await pdf().text());
    await library.saveLocalDocumentState(copy.localId, snapshot(copy.localId, []), { expectedRevision: 1 });
    assert.deepEqual(read(await library.openLocalDocument(copy.localId)).deletedPdfAnnotations, []);
    assert.deepEqual(read(fileFor((await cold.readDraft(receipt.sessionId, { expectedSequence: receipt.sequence })).state)).deletedPdfAnnotations,
      tombstones(), 'clearing independent copy cannot alter retained recovery');
  } finally { cold.close(); library.close(); }
});
