// Test plan 68 (2026-10-06): erasing part of one big, detailed pen drawing on a
// document with ~3,000 imported marks still froze the screen for 1-2 s. The
// erase commit (PDFViewer.handleEraseIntent: buildEraseHistoryBeforeSnapshot +
// prepareEraseIntentForCommit) deep-cloned EVERY page of the document three
// times per erase (~0.8 s), and re-cloned the 0.7 MB stroke for each intent.
// Only the touched pages may be copied now (a counter delete still takes the
// whole document: renumbering spans pages), and a deep-frozen intent's values
// are shared, not cloned. Same prepared intent as before (checked on the real
// item 68 data: identical digests).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEraseHistoryBeforeSnapshot,
  buildEraseIntent,
  buildPageEraseTargets,
  stableValuesMatch,
} from '../src/utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../src/utils/annotationEraseCommitPlan.js';
import { getAnnotationStorageKey } from '../src/utils/annotationStorageIdentity.js';

function importedInk(id, x = 10) {
  return {
    type: 'path',
    id,
    isPdfImported: true,
    pdfAnnotationId: `${id}R`,
    pdfAnnotationType: 'Ink',
    path: [['M', x, 10], ['C', x + 10, 0, x + 20, 20, x + 30, 10]],
    left: x,
    top: 0,
    stroke: 'transparent',
    strokeWidth: 0,
    fill: '#ff0000',
    polygons: [[[[x, 9], [x + 30, 9], [x + 30, 11], [x, 11]]]],
    data: { id, tool: 'pen' },
  };
}

function penStroke(id, points = 400) {
  const path = [['M', 0, 0]];
  for (let i = 1; i < points; i += 1) path.push(['L', i, Math.sin(i / 7) * 20]);
  return {
    type: 'path',
    id,
    path,
    polygons: [[path.map(([, x, y]) => [x, y])]],
    stroke: 'transparent',
    strokeWidth: 0,
    fill: '#e11d48',
    data: { id, tool: 'pen', authorId: 'owner' },
  };
}

function bigDocument() {
  const byPage = {};
  for (let page = 2; page <= 30; page += 1) {
    byPage[page] = { objects: Array.from({ length: 60 }, (_, i) => importedInk(`p${page}-ink-${i}`, i * 3)) };
  }
  byPage[1] = {
    objects: [
      importedInk('touched-imported'),
      penStroke('touched-pen'),
      ...Array.from({ length: 20 }, (_, i) => importedInk(`p1-ink-${i}`, 100 + i)),
    ],
  };
  return byPage;
}

function eraseIntentFor(byPage) {
  const objects = byPage[1].objects;
  const importedAfter = { ...structuredClone(objects[0]), polygons: [[[[10, 9], [20, 9], [20, 11], [10, 11]]]] };
  const penAfter = { ...structuredClone(objects[1]), polygons: [[[[0, 0], [100, 0], [100, 5], [0, 5]]]] };
  const targets = buildPageEraseTargets({
    pageNumber: 1,
    originalObjects: objects,
    objectMutations: [
      { index: 0, survivor: importedAfter },
      { index: 1, survivor: penAfter },
    ],
  });
  return buildEraseIntent({
    mutationId: 'erase:scope-test',
    pageNumber: 1,
    renderer: 'svg',
    gesture: { mode: 'partial', radius: 6, points: [{ x: 25, y: 10 }] },
    targets,
    diagnostics: { objectMutations: [{ index: 1, survivor: penAfter }] },
    presentationRevision: 'erase:scope-test',
  });
}

function withClonedRoots(fn) {
  const original = globalThis.structuredClone;
  const roots = [];
  globalThis.structuredClone = (value, options) => {
    roots.push(value);
    return original(value, options);
  };
  try {
    return { result: fn(), roots };
  } finally {
    globalThis.structuredClone = original;
  }
}

test('an erase commit copies only the touched page, never the rest of the document', () => {
  const byPage = bigDocument();
  const intent = eraseIntentFor(byPage);
  const pristine = structuredClone(byPage);
  const untouchedPages = Object.entries(byPage).filter(([page]) => page !== '1').map(([, page]) => page);
  const untouchedObjects = new Set(untouchedPages.flatMap((page) => page.objects));

  const { result: prepared, roots } = withClonedRoots(() => prepareEraseIntentForCommit({
    intent,
    annotationsByPage: buildEraseHistoryBeforeSnapshot({ annotationsByPage: byPage }, intent).annotationsByPage,
    userId: 'owner',
    includeDeleteHistory: true,
  }));

  assert.equal(roots.includes(byPage), false, 'the whole document was deep-cloned');
  for (const page of untouchedPages) assert.equal(roots.includes(page), false, 'an untouched page was deep-cloned');
  assert.equal(roots.some((root) => untouchedObjects.has(root)), false, 'an untouched mark was deep-cloned');
  const clonedBytes = roots.reduce((sum, root) => sum + (root === undefined ? 0 : JSON.stringify(root)?.length || 0), 0);
  assert.ok(clonedBytes < JSON.stringify(byPage[1]).length * 2, `cloned ${clonedBytes} chars for one touched page`);

  // Same result: both targets replaced, the imported one stamped as edited.
  assert.deepEqual(prepared.targets.map((target) => [target.storageKey, target.operation]), [
    ['touched-imported', 'replace'],
    ['touched-pen', 'replace'],
  ]);
  const importedAfter = prepared.targets[0].after;
  assert.equal(importedAfter.pdfImportedEditState, 'edited');
  assert.equal(importedAfter.data.pdfImportedEditState, 'edited');
  assert.equal(prepared.targets[1].after.pdfImportedEditState, undefined, 'a pen stroke is not an imported edit');
  assert.deepEqual(prepared.targets[1].after.polygons, [[[[0, 0], [100, 0], [100, 5], [0, 5]]]]);
  assert.deepEqual(prepared.diagnostics.finalChangedAnnotationIds, ['touched-imported', 'touched-pen']);

  // The caller's live page state is untouched: same content, and no
  // storage-key identity attached to the other pages' objects (page 1's got
  // theirs from buildPageEraseTargets, as in the app).
  assert.deepEqual(byPage, pristine);
  for (const object of untouchedObjects) assert.equal(getAnnotationStorageKey(object), null);
});

test('a prepared intent shares the first intent\'s frozen stroke instead of cloning it again', () => {
  const byPage = bigDocument();
  const intent = eraseIntentFor(byPage);
  const pen = intent.targets[1];
  assert.ok(Object.isFrozen(pen.before) && Object.isFrozen(pen.after.polygons[0][0]));

  const { result: prepared, roots } = withClonedRoots(() => prepareEraseIntentForCommit({
    intent,
    annotationsByPage: buildEraseHistoryBeforeSnapshot({ annotationsByPage: byPage }, intent).annotationsByPage,
    userId: 'owner',
  }));

  assert.equal(prepared.targets[1].before, pen.before, 'before re-cloned');
  assert.equal(prepared.targets[1].after, pen.after, 'unchanged survivor re-cloned');
  assert.equal(roots.includes(pen.before) || roots.includes(pen.after), false);
  assert.equal(prepared.diagnostics.objectMutations, intent.diagnostics.objectMutations);
  // Still immutable all the way down.
  assert.throws(() => { prepared.targets[1].after.polygons[0][0].push([1, 1]); }, TypeError);
  assert.ok(Object.isFrozen(prepared.targets[0].after) && Object.isFrozen(prepared.targets[0].after.data));
});

test('the history predecessor shares untouched pages and restores the targets', () => {
  const byPage = bigDocument();
  const intent = eraseIntentFor(byPage);
  const snapshot = { annotationsByPage: byPage, surveyMarkers: { m: { id: 'm' } } };
  const { result, roots } = withClonedRoots(() => buildEraseHistoryBeforeSnapshot(snapshot, intent));
  assert.equal(roots.length, 0, 'nothing needs a deep copy');
  assert.equal(result.annotationsByPage[2], byPage[2], 'untouched page shared');
  assert.equal(result.surveyMarkers, snapshot.surveyMarkers);
  assert.notEqual(result.annotationsByPage[1], byPage[1]);
  assert.equal(result.annotationsByPage[1].objects[0], intent.targets[0].before);
  assert.equal(result.annotationsByPage[1].objects[1], intent.targets[1].before);
  assert.notEqual(result.annotationsByPage[1].objects[2], byPage[1].objects[2], 'other touched-page marks are copies');
  assert.deepEqual(result.annotationsByPage[1].objects[2], byPage[1].objects[2]);
});

// The serializing compare stableValuesMatch replaced (kept as the oracle).
const UNSTORED = new Set(['pdfInkSourceGeometry']);
function stableSerialize(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const keys = Object.keys(value).filter((key) => !UNSTORED.has(key)).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

test('the erase compare-and-swap equality answers exactly like the old serializing compare', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const leaves = [0, -0, 1, 1.5, NaN, Infinity, null, undefined, true, false, '', 'a', '"q"', [], {}];
  const make = (depth) => {
    const r = random();
    if (depth <= 0 || r < 0.35) return leaves[Math.floor(random() * leaves.length)];
    if (r < 0.65) return Array.from({ length: Math.floor(random() * 4) }, () => make(depth - 1));
    const object = {};
    for (const key of ['a', 'b', 'data', 'pdfInkSourceGeometry'].filter(() => random() < 0.6)) object[key] = make(depth - 1);
    return object;
  };
  const mutate = (value) => {
    if (random() < 0.5) return structuredClone(value);
    if (Array.isArray(value)) return value.length ? [...value.slice(1), value[0]] : [1];
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).reverse();
      const copy = Object.fromEntries(keys.map((key) => [key, value[key]]));
      if (random() < 0.5) copy.pdfInkSourceGeometry = { any: 1 };
      else if (keys.length) copy[keys[0]] = make(1);
      return copy;
    }
    return make(1);
  };
  let equal = 0;
  for (let n = 0; n < 4000; n += 1) {
    const left = make(4);
    const right = random() < 0.5 ? mutate(left) : make(4);
    const expected = stableSerialize(left) === stableSerialize(right);
    if (expected) equal += 1;
    assert.equal(stableValuesMatch(left, right), expected, `${stableSerialize(left)} vs ${stableSerialize(right)}`);
  }
  assert.ok(equal > 500, `only ${equal} equal pairs generated`);
});
