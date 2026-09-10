import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';

import {
  applyEraseHistoryTransitionOnDoc,
  buildEraseIntent,
  commitEraseIntent,
} from '../src/utils/annotationEraseTransaction.js';
import {
  initializeSurveyCrdtV2,
  materializeSurveyCrdtV2,
  updateSurveyMarkersV2,
} from '../src/services/documentSurveyCrdtV2.js';
import { getEraserOpsMap } from '../src/services/annotationDocStore.js';

const marker = (name = 'M1') => ({
  annotationId: 'm1', name, pageNumber: 1,
  bounds: { x: 10, y: 10, width: 20, height: 20 },
  entityId: 'gc', entityName: 'General Contractor', entityColor: '#112233',
  checklistResponses: { c1: { value: 'Y' } },
});

function setup() {
  const doc = new Y.Doc();
  initializeSurveyCrdtV2(doc, { surveyMarkers: { m1: marker() } });
  doc.getMap('annotations').set('shape-1', {
    p: 1,
    o: { id: 'shape-1', type: 'rect', left: 1, top: 2, width: 3, height: 4 },
  });
  const intent = buildEraseIntent({
    mutationId: 'erase-mixed-1', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 1, y: 1 }], radius: 8, mode: 'partial' },
    targets: [{
      domain: 'page-object', storageKey: 'shape-1', kind: 'shape', operation: 'delete',
      before: doc.getMap('annotations').get('shape-1').o,
    }],
    surveyMarkerTargets: [{ markerId: 'm1', expectedMarker: marker() }],
  });
  return { doc, intent };
}

const options = {
  actorUserId: 'actor-a', eraserWriterId: 'writer-a',
  permissionContext: { mode: 'registered', viewerId: 'actor-a', documentOwnerId: 'actor-a' },
};

function defineOwn(target, key, value) {
  Object.defineProperty(target, key, { configurable: true, enumerable: true, writable: true, value });
  return target;
}

test('mixed ordinary and survey erase commits once, survives reopen, and cycles fresh incarnations', async () => {
  const { doc, intent } = setup();
  const result = await commitEraseIntent({ doc, intent, ...options });
  assert.equal(result.status, 'committed');
  assert.deepEqual(result.surveyMarkerIdsCommitted, ['m1']);
  assert.equal([...getEraserOpsMap(doc).values()].some(lane => lane?.deleted === true), true);
  assert.deepEqual(materializeSurveyCrdtV2(doc).surveyMarkers, {});

  const undo = applyEraseHistoryTransitionOnDoc({
    doc, transition: result.historyTransition, direction: 'undo',
  });
  assert.equal(undo.status, 'applied');
  assert.deepEqual(materializeSurveyCrdtV2(doc).surveyMarkers.m1, marker());
  const firstRestoreIncarnation = doc.getMap('surveyMarkerLifecycle').get('m1').incarnationId;

  const redo = applyEraseHistoryTransitionOnDoc({
    doc, transition: result.historyTransition, direction: 'redo',
  });
  assert.equal(redo.status, 'applied');
  assert.equal(materializeSurveyCrdtV2(doc).surveyMarkers.m1, undefined);
  assert.equal(doc.getMap('surveyMarkerLifecycle').get('m1').incarnationId, firstRestoreIncarnation);

  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc, transition: result.historyTransition, direction: 'undo',
  }).status, 'applied');
  assert.notEqual(doc.getMap('surveyMarkerLifecycle').get('m1').incarnationId, firstRestoreIncarnation);

  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(materializeSurveyCrdtV2(reopened).surveyMarkers.m1, marker());
});

test('mixed planning failure changes neither ordinary nor survey state', async () => {
  const { doc, intent } = setup();
  const before = Y.encodeStateAsUpdate(doc);
  await assert.rejects(commitEraseIntent({
    doc, intent, ...options,
    injectFailure(stage) { if (stage === 'before-core-commit') throw new Error('stop'); },
  }), /stop/);
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  assert.ok(doc.getMap('annotations').has('shape-1'));
  assert.deepEqual(materializeSurveyCrdtV2(doc).surveyMarkers.m1, marker());
});

test('survey permission failure leaves the mixed ordinary and survey gesture unchanged', async () => {
  const { doc, intent } = setup();
  const before = Y.encodeStateAsUpdate(doc);
  const result = await commitEraseIntent({
    doc, intent, ...options, validateSurveyTarget: () => false,
  });
  assert.deepEqual(result, {
    status: 'cancelled', reason: 'permission', mutationId: 'erase-mixed-1',
  });
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  assert.ok(doc.getMap('annotations').has('shape-1'));
  assert.deepEqual(materializeSurveyCrdtV2(doc).surveyMarkers.m1, marker());
});

test('safe own proto marker data survives erase, undo, and a cold reopen', async () => {
  const doc = new Y.Doc();
  const nested = defineOwn({}, '__proto__', { retained: true });
  const protoMarker = {
    annotationId: '__proto__', pageNumber: 1,
    bounds: { x: 1, y: 2, width: 3, height: 4 }, extension: nested,
  };
  const markers = defineOwn({}, '__proto__', protoMarker);
  initializeSurveyCrdtV2(doc, { surveyMarkers: markers });
  const intent = buildEraseIntent({
    mutationId: 'erase-proto', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 1, y: 1 }], radius: 4, mode: 'whole' },
    surveyMarkerTargets: [{ markerId: '__proto__', expectedMarker: protoMarker }],
  });
  const result = await commitEraseIntent({ doc, intent, ...options });
  assert.equal(result.status, 'committed');
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc, transition: result.historyTransition, direction: 'undo',
  }).status, 'applied');
  const reopened = new Y.Doc();
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
  const restored = materializeSurveyCrdtV2(reopened).surveyMarkers;
  assert.equal(Object.hasOwn(restored, '__proto__'), true);
  assert.equal(Object.hasOwn(restored.__proto__.extension, '__proto__'), true);
  assert.deepEqual(restored.__proto__.extension.__proto__, { retained: true });
  assert.equal(Object.prototype.retained, undefined);
});

test('undo and redo reject a collaborator recreation of the public marker id', async () => {
  const { doc, intent } = setup();
  const result = await commitEraseIntent({ doc, intent, ...options });
  updateSurveyMarkersV2(doc, current => ({ ...current, m1: marker('peer recreation') }));
  const beforeUndo = Y.encodeStateAsUpdate(doc);
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc, transition: result.historyTransition, direction: 'undo',
  }).status, 'conflict');
  assert.deepEqual(Y.encodeStateAsUpdate(doc), beforeUndo);
});

test('foreign, reused, and stale survey plans cannot write', async () => {
  const { doc, intent } = setup();
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  const { prepareSurveyMarkerEraseV2, sealPreparedSurveyCrdtV2Plan,
    applyPreparedSurveyCrdtV2Plan } = await import('../src/services/documentSurveyCrdtV2.js');
  const prepared = prepareSurveyMarkerEraseV2(doc, {
    mutationId: 'plan-1', targets: [{ markerId: 'm1', expectedMarker: marker() }],
  });
  assert.equal(sealPreparedSurveyCrdtV2Plan(other, prepared.token), false);
  updateSurveyMarkersV2(doc, current => ({ ...current, m1: { ...current.m1, note: 'later' } }));
  assert.equal(sealPreparedSurveyCrdtV2Plan(doc, prepared.token), false);
  assert.throws(() => applyPreparedSurveyCrdtV2Plan(doc, prepared.token), /foreign, stale, or unsealed/);
});

test('redo rejects a peer edit to the restored marker with zero writes', async () => {
  const { doc, intent } = setup();
  const result = await commitEraseIntent({ doc, intent, ...options });
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc, transition: result.historyTransition, direction: 'undo',
  }).status, 'applied');
  updateSurveyMarkersV2(doc, current => ({
    ...current,
    m1: { ...current.m1, note: 'peer edit must survive' },
  }));
  const beforeRedo = Y.encodeStateAsUpdate(doc);
  assert.deepEqual(applyEraseHistoryTransitionOnDoc({
    doc, transition: result.historyTransition, direction: 'redo',
  }), { status: 'conflict', reason: 'survey-history-marker-conflict' });
  assert.deepEqual(Y.encodeStateAsUpdate(doc), beforeRedo);
  assert.equal(materializeSurveyCrdtV2(doc).surveyMarkers.m1.note, 'peer edit must survive');
});

test('concurrent disjoint marker undos merge in both orders and retain exact redos', async () => {
  const source = new Y.Doc();
  initializeSurveyCrdtV2(source, {
    surveyMarkers: { m1: marker('M1'), m2: { ...marker('M2'), annotationId: 'm2' } },
  });
  const intent = buildEraseIntent({
    mutationId: 'erase-two-markers', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 1, y: 1 }], radius: 8, mode: 'partial' },
    surveyMarkerTargets: [
      { markerId: 'm1', expectedMarker: marker('M1') },
      { markerId: 'm2', expectedMarker: { ...marker('M2'), annotationId: 'm2' } },
    ],
  });
  const erased = await commitEraseIntent({ doc: source, intent, ...options });
  const base = Y.encodeStateAsUpdate(source);
  const peerA = new Y.Doc();
  const peerB = new Y.Doc();
  Y.applyUpdate(peerA, base);
  Y.applyUpdate(peerB, base);
  const transitionFor = markerId => ({
    ...erased.historyTransition,
    surveyMarkers: { ...erased.historyTransition.surveyMarkers, markerIds: [markerId] },
  });
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc: peerA, transition: transitionFor('m1'), direction: 'undo',
  }).status, 'applied');
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc: peerB, transition: transitionFor('m2'), direction: 'undo',
  }).status, 'applied');
  const updateA = Y.encodeStateAsUpdate(peerA);
  const updateB = Y.encodeStateAsUpdate(peerB);

  for (const updates of [[updateA, updateB], [updateB, updateA]]) {
    const merged = new Y.Doc();
    for (const update of updates) Y.applyUpdate(merged, update);
    assert.deepEqual(Object.keys(materializeSurveyCrdtV2(merged).surveyMarkers).sort(), ['m1', 'm2']);
    assert.equal(applyEraseHistoryTransitionOnDoc({
      doc: merged, transition: transitionFor('m1'), direction: 'redo',
    }).status, 'applied');
    assert.equal(applyEraseHistoryTransitionOnDoc({
      doc: merged, transition: transitionFor('m2'), direction: 'redo',
    }).status, 'applied');
    assert.deepEqual(materializeSurveyCrdtV2(merged).surveyMarkers, {});
  }
});

test('an altered survey retry cannot reuse another erase mutation id', async () => {
  const doc = new Y.Doc();
  const m2 = { ...marker('M2'), annotationId: 'm2' };
  initializeSurveyCrdtV2(doc, { surveyMarkers: { m1: marker('M1'), m2 } });
  const erase = expectedMarker => buildEraseIntent({
    mutationId: 'same-erase-id', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 1, y: 1 }], radius: 8, mode: 'partial' },
    surveyMarkerTargets: [{ markerId: expectedMarker.annotationId, expectedMarker }],
  });
  assert.equal((await commitEraseIntent({ doc, intent: erase(marker('M1')), ...options })).status, 'committed');
  const beforeRetry = Y.encodeStateAsUpdate(doc);
  assert.deepEqual(await commitEraseIntent({ doc, intent: erase(m2), ...options }), {
    status: 'cancelled', reason: 'erase-replay-conflict', mutationId: 'same-erase-id',
  });
  assert.deepEqual(Y.encodeStateAsUpdate(doc), beforeRetry);
  assert.deepEqual(materializeSurveyCrdtV2(doc).surveyMarkers.m2, m2);
});

test('history capacity rejects a new erase before writes and preserves old undo records', async () => {
  const doc = new Y.Doc();
  initializeSurveyCrdtV2(doc, { surveyMarkers: { m1: marker('M1') } });
  const first = await commitEraseIntent({ doc, intent: buildEraseIntent({
    mutationId: 'retained-erase', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 1, y: 1 }], radius: 8, mode: 'partial' },
    surveyMarkerTargets: [{ markerId: 'm1', expectedMarker: marker('M1') }],
  }), ...options });
  const many = Object.fromEntries(Array.from({ length: 4_096 }, (_, index) => {
    const id = `capacity-${index}`;
    return [id, { ...marker(id), annotationId: id }];
  }));
  updateSurveyMarkersV2(doc, () => many);
  const oversized = buildEraseIntent({
    mutationId: 'capacity-overflow', pageNumber: 1, renderer: 'svg',
    gesture: { points: [{ x: 1, y: 1 }], radius: 8, mode: 'partial' },
    surveyMarkerTargets: Object.entries(many).map(([markerId, expectedMarker]) => ({
      markerId, expectedMarker,
    })),
  });
  const beforeOverflow = Y.encodeStateAsUpdate(doc);
  assert.deepEqual(await commitEraseIntent({ doc, intent: oversized, ...options }), {
    status: 'cancelled', reason: 'survey-erase-history-capacity', mutationId: 'capacity-overflow',
  });
  assert.deepEqual(Y.encodeStateAsUpdate(doc), beforeOverflow);
  updateSurveyMarkersV2(doc, () => ({}));
  assert.equal(applyEraseHistoryTransitionOnDoc({
    doc, transition: first.historyTransition, direction: 'undo',
  }).status, 'applied');
  assert.equal(materializeSurveyCrdtV2(doc).surveyMarkers.m1.name, 'M1');
});
