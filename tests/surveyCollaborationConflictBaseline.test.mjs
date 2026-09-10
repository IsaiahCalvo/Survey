import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  docToSurveyMarkers,
  getMetaValue,
  setMetaValue,
  syncSurveyMarkersToDoc,
} from '../src/services/annotationDocStore.js';

// Legacy v1 characterization only. These tests record the current whole-value
// conflict boundary so a later v2 field-level model can have its own desired
// behavior suite without rewriting history.

const marker = (id, checklistResponses = {}) => ({
  annotationId: id,
  pageNumber: 1,
  bounds: { x: 1, y: 2, width: 3, height: 4 },
  categoryId: 'category',
  checklistResponses,
});

function branchFrom(snapshot, clientID) {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, snapshot);
  return doc;
}

function captureUpdate(doc, change) {
  const updates = [];
  doc.on('update', update => updates.push(update));
  change();
  assert.ok(updates.length > 0, 'the branch change must create a real Yjs update');
  return Y.mergeUpdates(updates);
}

function coldReplay(snapshot, tails) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  for (const tail of tails) Y.applyUpdate(doc, tail);
  return doc;
}

const orders = (a, b) => [
  ['A then B', [a, b]],
  ['B then A', [b, a]],
];

test('legacy v1 same-marker checklist edits converge by replacing one whole marker value', t => {
  const baseValue = marker('mark', { existing: { selection: 'Y' } });
  const base = new Y.Doc();
  base.clientID = 10;
  syncSurveyMarkersToDoc(base, { mark: baseValue });
  const snapshot = Y.encodeStateAsUpdate(base);
  const localA = marker('mark', {
    existing: { selection: 'Y' }, aOnly: { selection: 'Y' },
  });
  const localB = marker('mark', {
    existing: { selection: 'Y' }, bOnly: { selection: 'N' },
  });
  const a = branchFrom(snapshot, 20);
  const b = branchFrom(snapshot, 30);
  const updateA = captureUpdate(a, () => syncSurveyMarkersToDoc(a, { mark: localA }));
  const updateB = captureUpdate(b, () => syncSurveyMarkersToDoc(b, { mark: localB }));

  for (const [label, tails] of orders(updateA, updateB)) {
    const merged = coldReplay(snapshot, tails);
    assert.deepEqual(docToSurveyMarkers(merged).mark, localB,
      `${label}: client B's whole marker wins; aOnly is lost rather than field-merged`);
    const reopened = coldReplay(Y.encodeStateAsUpdate(merged), []);
    assert.deepEqual(docToSurveyMarkers(reopened).mark, localB);
  }
  t.diagnostic(`v1 witness ${JSON.stringify({ base: baseValue.checklistResponses,
    localA: localA.checklistResponses, localB: localB.checklistResponses,
    merged: localB.checklistResponses })}`);
});

test('legacy v1 coarse spaces edits converge by replacing the whole spaces array', t => {
  const baseValue = [{ id: 'space', name: 'Base', assignedPages: [] }];
  const localA = [{ id: 'space', name: 'A rename', assignedPages: [] }];
  const localB = [{ id: 'space', name: 'Base', assignedPages: [{ pageId: 2, regions: [] }] }];
  const base = new Y.Doc();
  base.clientID = 10;
  setMetaValue(base, 'spaces', baseValue);
  const snapshot = Y.encodeStateAsUpdate(base);
  const a = branchFrom(snapshot, 20);
  const b = branchFrom(snapshot, 30);
  const updateA = captureUpdate(a, () => setMetaValue(a, 'spaces', localA));
  const updateB = captureUpdate(b, () => setMetaValue(b, 'spaces', localB));

  for (const [label, tails] of orders(updateA, updateB)) {
    const merged = coldReplay(snapshot, tails);
    assert.deepEqual(getMetaValue(merged, 'spaces'), localB,
      `${label}: client B's whole array wins; A's rename is lost`);
    const reopened = coldReplay(Y.encodeStateAsUpdate(merged), []);
    assert.deepEqual(getMetaValue(reopened, 'spaces'), localB);
  }
  t.diagnostic(`v1 witness ${JSON.stringify({ base: baseValue, localA, localB, merged: localB })}`);
});

test('legacy v1 different marker keys form a union in both delivery orders and cold replay', () => {
  const base = new Y.Doc();
  base.clientID = 10;
  const snapshot = Y.encodeStateAsUpdate(base);
  const markerA = marker('mark-a', { a: { selection: 'Y' } });
  const markerB = marker('mark-b', { b: { selection: 'N' } });
  const a = branchFrom(snapshot, 20);
  const b = branchFrom(snapshot, 30);
  const updateA = captureUpdate(a, () => syncSurveyMarkersToDoc(a, { 'mark-a': markerA }));
  const updateB = captureUpdate(b, () => syncSurveyMarkersToDoc(b, { 'mark-b': markerB }));

  const expected = { 'mark-a': markerA, 'mark-b': markerB };
  for (const [label, tails] of orders(updateA, updateB)) {
    const merged = coldReplay(snapshot, tails);
    assert.deepEqual(docToSurveyMarkers(merged), expected, `${label}: distinct marker keys merge`);
    assert.deepEqual(docToSurveyMarkers(coldReplay(Y.encodeStateAsUpdate(merged), [])), expected);
  }
});
