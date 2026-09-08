import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { materializeAnnotationGenerationState } from '../src/services/annotationGenerationState.js';
import { syncByPageToDoc, docToByPage } from '../src/services/annotationDocStore.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

test('captures full form, marker and unknown metadata values without changing or sharing the source', () => {
  const doc = new Y.Doc();
  const form = { type: 'form-field', pageNumber: 2,
    data: { id: 'form-field:2:7R', fieldId: '7R', fieldName: 'inspection.date', value: '', rect: [1,2,3,4] },
    meta: { authorId: 'original-author', createdAt: 123 } };
  doc.getMap('annotations').set('form-field:2:7R', { p: 2, o: form });
  doc.getMap('surveyMarkers').set('marker', { pageNumber: 2, annotationId: 'marker',
    userId: 'marker-author', checklistResponses: { question: { answer: false, note: 'kept' } } });
  doc.getMap('annoMeta').set('future-feature', { nested: [null, false, 0, ''] });
  doc.getMap('annoMeta').set('calloutsList', null);
  const before = Y.encodeStateAsUpdate(doc);
  const roots = [...doc.share.keys()];
  const result = materializeAnnotationGenerationState(doc);
  assert.equal(result.version, 1);
  assert.deepEqual(result.annotationsByPage[2].objects, [form]);
  assert.equal(result.surveyMarkers.marker.checklistResponses.question.answer, false);
  assert.deepEqual(result.annoMeta, { 'future-feature': { nested: [null,false,0,''] }, calloutsList: null });
  assert.deepEqual(result.deletedPdfAnnotations, []);
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  assert.deepEqual([...doc.share.keys()], roots);
  assert.throws(() => { result.annotationsByPage[2].objects[0].data.value = 'changed'; }, TypeError);
  assert.throws(() => { result.annoMeta['future-feature'].nested.push('changed'); }, TypeError);
  form.data.value = 'later';
  assert.equal(result.annotationsByPage[2].objects[0].data.value, '');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  doc.destroy();
});

test('pending or ambiguous erase effects block capture; acknowledged tombstones stay only in old history', () => {
  const doc = new Y.Doc();
  const outbox = doc.getMap('eraseOutbox');
  for (const entry of [null, {}, { status: 'pending', effects: [] },
    { status: 'acknowledged', mutationId: 'erase', effects: [{ key: 'unfinished' }], acknowledgedEffectKeys: [] },
    { status: 'acknowledged', mutationId: 'different', effects: [], acknowledgedEffectKeys: [] }]) {
    outbox.set('erase', entry);
    assert.throws(() => materializeAnnotationGenerationState(doc), { code: 'ANNOTATION_GENERATION_STATE_INVALID' });
  }
  const ack = { mutationId: 'erase', actorUserId: 'actor', status: 'acknowledged',
    committedAt: null, effectCount: 2, effects: [], acknowledgedEffectKeys: [] };
  outbox.set('erase', ack);
  assert.deepEqual(materializeAnnotationGenerationState(doc), {
    version: 1, annotationsByPage: {}, deletedPdfAnnotations: [], surveyMarkers: {}, annoMeta: {},
  });
  assert.deepEqual(outbox.get('erase'), ack);
  doc.destroy();
});

test('malformed records cannot silently disappear from a generation', () => {
  for (const [root, key, value] of [
    ['annotations', 'bad', null], ['annotations', 'bad', { p: 0, o: { type: 'path' } }],
    ['annotations', 'bad', { p: 1, o: [] }], ['annotations', 'bad', { p: 1, o: { type: 'path' }, extra: 'lost' }],
    ['surveyMarkers', 'bad', null], ['surveyMarkers', 'bad', { pageNumber: -1 }],
    ['deletedPdfAnnotations', 'bad', { pageNumber: 1 }],
    ['annotationEraserOps', 'bad', {}],
  ]) {
    const doc = new Y.Doc(); doc.getMap(root).set(key, value);
    assert.throws(() => materializeAnnotationGenerationState(doc), { code: 'ANNOTATION_GENERATION_STATE_INVALID' }, root);
    doc.destroy();
  }
});

test('materializes partial eraser survivors without intent or source-history mutation', () => {
  const doc = new Y.Doc();
  const ink = { type: 'path', path: [['M',0,50],['L',100,50]], left: 0, top: 0,
    stroke: '#f00', strokeWidth: 20, fill: null, strokeLineCap: 'round', strokeLineJoin: 'round',
    data: { id: 'ink', tool: 'pen' }, meta: { authorId: 'artist' } };
  syncByPageToDoc(doc, { 1: { objects: [ink] } });
  const points = [{ x: 50, y: 50 }];
  const erased = erasePageAnnotations({ pageAnnotations: docToByPage(doc)[1], eraserPoints: points,
    eraserRadius: 12, mode: 'partial' });
  assert.ok(erased.changedIds.length > 0);
  syncByPageToDoc(doc, { 1: { ...erased.pageAnnotations, eraserMutation: {
    id: 'erase-one', pageNumber: 1, points, radius: 12, mode: 'partial', touchedIds: erased.touchedIds,
    changedIds: erased.changedIds, deletedIds: erased.deletedIds, objectMutations: erased.objectMutations,
  } } }, { eraserWriterId: 'eraser' });
  const before = Y.encodeStateAsUpdate(doc);
  const result = materializeAnnotationGenerationState(doc);
  const survivor = result.annotationsByPage[1].objects[0];
  assert.deepEqual(survivor.path, erased.pageAnnotations.objects[0].path);
  assert.notDeepEqual(survivor.path, ink.path);
  assert.equal(survivor.meta.authorId, 'artist');
  assert.equal(survivor.data.id, 'ink');
  assert.deepEqual(Object.keys(result.annotationsByPage[1]), ['objects']);
  const fresh = new Y.Doc(); syncByPageToDoc(fresh, result.annotationsByPage);
  assert.equal(fresh.getMap('annotationEraserOps').size, 0);
  assert.deepEqual(docToByPage(fresh)[1].objects[0].path, survivor.path, 'new base is not erased again');
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  doc.destroy(); fresh.destroy();
});

test('preserves native deletion identity from both explicit records and deleted lanes', () => {
  const doc = new Y.Doc();
  const first = { pageNumber: 1, pdfAnnotationId: '7R', pdfAnnotationType: 'Ink',
    pdfNativeAnnotationIdentity: { sourceRef: '7R', sourcePage: 1 } };
  const second = { pageNumber: 2, pdfAnnotationId: '8R', pdfAnnotationType: 'Highlight' };
  doc.getMap('deletedPdfAnnotations').set('1\u00007R', first);
  doc.getMap('annotationEraserOps').set('writer\u0000gone', { writerId: 'writer', storageKey: 'gone',
    annotationId: 'gone', operationId: 'erased', pageNumber: 2, deleted: true, survivor: null,
    base: null, deletedPdfAnnotation: second });
  const result = materializeAnnotationGenerationState(doc);
  assert.deepEqual(result.deletedPdfAnnotations, [first, second]);
  assert.deepEqual(result.annotationsByPage, {});
  assert.ok(Object.isFrozen(result.deletedPdfAnnotations[0].pdfNativeAnnotationIdentity));
  doc.destroy();
});

test('unknown nonempty maps and list roots fail closed, including decoded roots; empty unknown maps are harmless', () => {
  const source = new Y.Doc(); source.getMap('future').set('value', 1);
  const decoded = new Y.Doc(); Y.applyUpdate(decoded, Y.encodeStateAsUpdate(source));
  for (const doc of [source, decoded]) assert.throws(() => materializeAnnotationGenerationState(doc), /unknown nonempty root/);
  source.getMap('future').clear();
  assert.equal(materializeAnnotationGenerationState(source).version, 1);
  const list = new Y.Doc(); list.getArray('annotations').push([{ p: 1, o: { type: 'path' } }]);
  assert.throws(() => materializeAnnotationGenerationState(list), /root/);
  for (const doc of [source, decoded, list]) doc.destroy();
});

test('decoded map roots materialize without converting input roots or writing Yjs updates', () => {
  const source = new Y.Doc(); source.getMap('annoMeta').set('unknown', { a: [1,2] });
  const decoded = new Y.Doc(); Y.applyUpdate(decoded, Y.encodeStateAsUpdate(source));
  const root = decoded.share.get('annoMeta'); let updates = 0;
  decoded.on('update', () => { updates++; });
  assert.deepEqual(materializeAnnotationGenerationState(decoded).annoMeta, { unknown: { a: [1,2] } });
  assert.equal(decoded.share.get('annoMeta'), root);
  assert.equal(updates, 0);
  source.destroy(); decoded.destroy();
});

test('non-JSON values are rejected rather than serialized away', () => {
  const cyclic = {}; cyclic.self = cyclic;
  const extended = new Array(1); extended.extra = 'would be dropped';
  const getter = {}; Object.defineProperty(getter, 'value', { enumerable: true, get() { throw new Error('must not execute'); } });
  for (const value of [undefined, NaN, Infinity, new Date(), new Map(), new Uint8Array([1]),
    1n, Symbol('bad'), () => 1, cyclic, getter, [,,], extended, { nested: undefined }]) {
    const doc = new Y.Doc(); const wrapper = { value: 'initial' }; doc.getMap('annoMeta').set('test', wrapper);
    // Yjs values are mutable; validate before invoking a serializer that could
    // erase a Date/undefined/function or recurse into a cycle.
    wrapper.value = value;
    assert.throws(() => materializeAnnotationGenerationState(doc), { code: 'ANNOTATION_GENERATION_STATE_INVALID' });
    doc.destroy();
  }
});

test('retains callout payload, author aliases, marker extension keys and known space metadata', () => {
  const doc = new Y.Doc();
  const callout = { type: 'group', authorId: 'first', id: 'callout',
    data: { id: 'callout', type: 'callout', legacyCallout: { id: 'callout', pageNumber: 3,
      text: 'Exact note', meta: { authorId: 'first' }, leader: { x: 0.2, y: 0.4 } } },
    objects: [{ type: 'textbox', text: 'Exact note' }] };
  doc.getMap('annotations').set('callout', { p: 3, o: callout });
  // Prototype-like IDs are ordinary JSON keys and must not be lost to {} assignment.
  doc.getMap('surveyMarkers').set('__proto__', { pageNumber: 3, annotationId: '__proto__', future: { keep: true } });
  const spaces = [{ id: 'space', assignedPages: [{ pageId: 3, regions: [{ regionId: 'region', polygon: [[0,0],[1,1]] }] }] }];
  doc.getMap('annoMeta').set('spaces', spaces);
  doc.getMap('annoMeta').set('__proto__', { retained: true });
  const state = materializeAnnotationGenerationState(doc);
  assert.deepEqual(state.annotationsByPage[3].objects, [callout]);
  assert.deepEqual(state.annoMeta.spaces, spaces);
  assert.equal(Object.hasOwn(state.surveyMarkers, '__proto__'), true);
  assert.deepEqual(state.surveyMarkers.__proto__.future, { keep: true });
  assert.deepEqual(state.annoMeta.__proto__, { retained: true });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  doc.destroy();
});

test('rejects missing history dependencies, destroyed docs and non-doc inputs', () => {
  const source = new Y.Doc(); const updates = [];
  source.on('update', update => updates.push(update));
  source.getMap('annoMeta').set('a', 1); source.getMap('annoMeta').set('b', 2);
  const partial = new Y.Doc(); Y.applyUpdate(partial, updates[1]);
  assert.throws(() => materializeAnnotationGenerationState(partial), /unresolved Yjs history/);
  Y.applyUpdate(partial, updates[0]);
  assert.deepEqual(materializeAnnotationGenerationState(partial).annoMeta, { a: 1, b: 2 });
  source.destroy();
  for (const bad of [source, null, {}, { share: new Map() }]) {
    assert.throws(() => materializeAnnotationGenerationState(bad), /live Y.Doc required/);
  }
  partial.destroy();
});

test('legacy storage identity is deterministic and source objects remain untouched', () => {
  const doc = new Y.Doc();
  const object = { type: 'path', data: { id: 'old-alias', userId: 'original' }, id: 'old-alias' };
  doc.getMap('annotations').set('stable-storage-key', { p: 1, o: object });
  const first = materializeAnnotationGenerationState(doc);
  const second = materializeAnnotationGenerationState(doc);
  assert.deepEqual(first, second);
  assert.equal(first.annotationsByPage[1].objects[0].data.id, 'stable-storage-key');
  assert.equal(first.annotationsByPage[1].objects[0].data.userId, 'original');
  assert.equal(object.data.id, 'old-alias');
  doc.destroy();
});

test('competing native tombstones and ambiguous analytic lanes cannot be silently collapsed', () => {
  const doc = new Y.Doc();
  doc.getMap('deletedPdfAnnotations').set('1\u00007R', { pageNumber: 1, pdfAnnotationId: '7R', pdfAnnotationType: 'Ink' });
  doc.getMap('annotationEraserOps').set('writer\u0000gone', { writerId: 'writer', storageKey: 'gone',
    operationId: 'erased', pageNumber: 1, deleted: true, survivor: null, base: null,
    deletedPdfAnnotation: { pageNumber: 1, pdfAnnotationId: '7R', pdfAnnotationType: 'Highlight' } });
  assert.throws(() => materializeAnnotationGenerationState(doc), /ambiguous native deletion/);
  doc.destroy();
  const lanes = new Y.Doc();
  const base = { type: 'path', path: [['M',0,0],['L',100,0]], data: { id: 'ink' } };
  lanes.getMap('annotations').set('ink', { p: 1, o: base });
  for (const writer of ['a','b']) lanes.getMap('annotationEraserOps').set(`${writer}\u0000ink`, {
    writerId: writer, storageKey: 'ink', operationId: writer, pageNumber: 1, deleted: false,
    base, survivor: { ...base, path: [['M',0,0],['L',writer === 'a' ? 30 : 60,0]] },
  });
  assert.throws(() => materializeAnnotationGenerationState(lanes), /ambiguous eraser lanes/);
  lanes.destroy();
});
