import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import {
  createManagedLocalEditingContext,
  isManagedLocalEditingContext,
} from '../src/utils/managedLocalEditingContext.js';
import {
  canModify, canDelete, canEraseCanvasAnnotation, filterEraserCommitIds,
  canModifySurveyMarker, canCommitSurveyMarkerErase,
} from '../src/lib/collab/permissionScope.js';
import { buildBulkDeletePlan } from '../src/lib/collab/bulkDeletePlan.js';
import { filterMarqueeHits } from '../src/utils/marqueeSelection.js';
import { isAnnotationVisibleInSurveyMode } from '../src/utils/annotationVisibilityRules.js';
import { applyAnnotationHistoryAction, buildAnnotationHistoryAction, invertAnnotationHistoryAction,
  filterAnnotationHistoryActionByOwner } from '../src/utils/annotationLocalHistory.js';

const localId = 'local:8ad364a5-786f-470f-858d-253c52bff3bd';
function localFile(overrides = {}) {
  return Object.assign(new File(['%PDF-1.7'], 'device.pdf', { type: 'application/pdf' }), {
    localId, _surveyPdfId: localId, storageMode: 'local', ...overrides,
  });
}
const imported = { id: 'imported', type: 'path', data: { id: 'imported', authorId: 'original-author' } };
const locked = { id: 'locked', type: 'path', locked: true, data: { id: 'locked', authorId: 'original-author' } };
const anonymous = { id: 'anonymous', type: 'path', data: { id: 'anonymous' } };

test('only exact managed File shape receives local capability; metadata never creates cloud identity', () => {
  const file = localFile();
  const context = createManagedLocalEditingContext(file);
  assert.equal(isManagedLocalEditingContext(context), true);
  assert.equal(file.id, undefined);
  assert.equal(Object.isFrozen(context), true);
  for (const bad of [null, {}, new Blob(['pdf']), { ...file }, localFile({ id: 'cloud-id' }),
    localFile({ id: '' }), localFile({ storageMode: 'cloud' }), localFile({ localId: 'local:short' }),
    localFile({ localId: undefined }), localFile({ _surveyPdfId: 'other' })]) {
    assert.equal(createManagedLocalEditingContext(bad), null);
  }
  for (const copy of [{ ...context }, JSON.parse(JSON.stringify(context)), false, 'local', null]) {
    assert.equal(isManagedLocalEditingContext(copy), false);
    assert.equal(canModify({ annotation: imported, localDocumentContext: copy }), false);
    assert.equal(canDelete({ annotation: imported, localDocumentContext: copy }), false);
  }
});

test('a context stops authorizing when its bound File moves to another local or cloud scope', () => {
  for (const change of [{ id: 'cloud-id' }, { storageMode: 'cloud' }, { _surveyPdfId: 'other' },
    { localId: 'local:c02b66e4-9dd8-48b7-8025-9e7410962963', _surveyPdfId: 'local:c02b66e4-9dd8-48b7-8025-9e7410962963' }]) {
    const file = localFile();
    const context = createManagedLocalEditingContext(file);
    Object.assign(file, change);
    assert.equal(isManagedLocalEditingContext(context), false);
    assert.equal(canDelete({ annotation: imported, localDocumentContext: context }), false);
  }
});

test('guest and signed-in local editing preserve imported authors and protect locks', () => {
  const localDocumentContext = createManagedLocalEditingContext(localFile());
  const before = structuredClone([imported, locked, anonymous]);
  for (const viewerId of [null, 'signed-in-later']) {
    const scope = { viewerId, documentOwnerId: null, localDocumentContext };
    for (const annotation of [imported, anonymous]) {
      assert.equal(canModify({ annotation, ...scope }), true);
      assert.equal(canDelete({ annotation, ...scope }), true);
      assert.equal(canEraseCanvasAnnotation({ annotation, knownSurveyMarkerIds: new Set(), ...scope }), true);
    }
    for (const annotation of [null, locked]) {
      assert.equal(canModify({ annotation, ...scope }), false);
      assert.equal(canDelete({ annotation, ...scope }), false);
      assert.equal(canEraseCanvasAnnotation({ annotation, ...scope }), false);
    }
    assert.equal(canEraseCanvasAnnotation({ annotation: { type: 'path' }, ...scope }), false);
    assert.deepEqual(filterEraserCommitIds({ annotationIds: ['imported', 'locked', 'unknown'],
      annotations: [imported, locked], ...scope }), ['imported']);
    const surveyMarker = { userId: 'original-author' };
    assert.equal(canModifySurveyMarker({ surveyMarker, ...scope }), true);
    assert.equal(canCommitSurveyMarkerErase({ surveyMarker, ...scope }), true);
    assert.equal(canCommitSurveyMarkerErase({ surveyMarker: { ...surveyMarker, locked: true }, ...scope }), false);
  }
  assert.deepEqual([imported, locked, anonymous], before);
});

test('cloud guest, foreign modification, and confirmed cloud delete policy stay unchanged', () => {
  const guest = { viewerId: null, documentOwnerId: 'cloud-owner' };
  assert.equal(canModify({ annotation: imported, ...guest }), false);
  assert.equal(canDelete({ annotation: imported, ...guest }), false);
  assert.equal(canCommitSurveyMarkerErase({ surveyMarker: { userId: 'original-author' }, ...guest }), false);
  const collaborator = { viewerId: 'collaborator', documentOwnerId: 'cloud-owner' };
  assert.equal(canModify({ annotation: imported, ...collaborator }), false);
  assert.equal(canDelete({ annotation: imported, ...collaborator }), true);
  assert.equal(buildBulkDeletePlan({ candidateIds: ['imported'], annotations: [imported], ...collaborator }).mode,
    'collaborator-cross-author');
  assert.equal(canModify({ annotation: imported, viewerId: 'cloud-owner', documentOwnerId: 'cloud-owner' }), true);
});

test('local bulk and marquee admit imported and anonymous marks without relabeling them', () => {
  const localDocumentContext = createManagedLocalEditingContext(localFile());
  const annotations = [imported, anonymous, locked];
  const before = structuredClone(annotations);
  assert.deepEqual(buildBulkDeletePlan({ candidateIds: ['imported', 'anonymous', 'locked', 'unknown'],
    annotations, localDocumentContext }), {
    mode: 'owner-own-only', count: 2, ownIds: ['imported', 'anonymous'], foreignIds: [],
  });
  assert.deepEqual(filterMarqueeHits([0, 1, 2, 3], { objects: annotations }, null, null, localDocumentContext), [0, 1]);
  assert.deepEqual(filterMarqueeHits([0, 1], { objects: annotations }, null, null, false), []);
  assert.deepEqual(annotations, before);
});

// Execute production callback bodies, not a duplicate of their permission rules.
const sourceCache = new Map();
function sourceTree(path) {
  if (!sourceCache.has(path)) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    sourceCache.set(path, { source, tree: parse(source, { sourceType: 'module', plugins: ['jsx'] }) });
  }
  return sourceCache.get(path);
}
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  }
  return null;
}
function callback(path, name, scope) {
  const { tree, source } = sourceTree(path);
  const node = findNode(tree, node => node.type === 'VariableDeclarator' && node.id.name === name);
  assert.ok(node, `${name} exists`);
  const fn = node.init.type === 'ArrowFunctionExpression' ? node.init : node.init.arguments[0];
  return new Function(...Object.keys(scope), `return (${source.slice(fn.start, fn.end)});`)(...Object.values(scope));
}

test('actual SVG selection/delete callbacks use device ownership and keep locked marks', () => {
  const localDocumentContext = createManagedLocalEditingContext(localFile());
  const annotations = { objects: [imported, locked, anonymous] };
  let saved;
  let plannerCalls = 0;
  const scope = { annotations, localDocumentContext, viewerId: null, documentOwnerId: null, canModify, canDelete,
    selectedIds: new Set([0, 1, 2]), deepClone: structuredClone,
    onSaveAnnotations: next => { saved = next; }, deselectAll() {}, pageNumber: 1,
    onRequestBulkDelete(request) {
      plannerCalls++;
      const plan = buildBulkDeletePlan({ candidateIds: request.candidateIds,
        annotations: annotations.objects, localDocumentContext });
      assert.equal(plan.mode, 'owner-own-only');
      request.runDelete();
    },
  };
  const select = callback('hooks/useSVGInteraction.js', 'canSelectAnnotationByIndex', scope);
  assert.equal(select(0), true); assert.equal(select(1), false);
  callback('hooks/useSVGInteraction.js', 'deleteSelected', scope)();
  assert.deepEqual(saved.objects, [locked]);
  assert.equal(plannerCalls, 1);
  for (const bad of [false, { ...localDocumentContext }]) {
    saved = null;
    const denied = { ...scope, localDocumentContext: bad };
    assert.equal(callback('hooks/useSVGInteraction.js', 'canSelectAnnotationByIndex', denied)(0), false);
    callback('hooks/useSVGInteraction.js', 'deleteSelected', denied)();
    assert.equal(saved, null);
  }
});

test('actual eraser preview/commit block reason uses local proof and rejects cloud guests', () => {
  const localDocumentContext = createManagedLocalEditingContext(localFile());
  const ref = current => ({ current });
  const scope = { viewerIdRef: ref(null), documentOwnerIdRef: ref(null), localDocumentContextRef: ref(localDocumentContext),
    isLocalOnlyDocumentRef: ref(false), canModify, isAnnotationVisibleInSurveyMode,
    showSurveyPanelRef: ref(false), selectedModuleIdRef: ref(null), activeSpaceIdRef: ref(null), selectedSpaceIdRef: ref(null),
    getSpaceIdForRegion: () => null,
  };
  const reason = callback('components/FabricEraserCanvas.jsx', 'getEraseBlockReason', scope);
  assert.equal(reason(imported), null);
  assert.ok(reason(locked));
  scope.localDocumentContextRef.current = null;
  assert.equal(reason(imported), 'permission');
  scope.localDocumentContextRef.current = { ...localDocumentContext };
  assert.equal(reason(imported), 'permission');
  scope.localDocumentContextRef.current = false;
  assert.equal(reason(imported), 'permission');
});

test('actual mixed callout and saved marker callbacks permit local guest without changing authors', () => {
  const managedLocalEditingContext = createManagedLocalEditingContext(localFile());
  const mixedDeleteBatchRef = { current: null };
  const scope = { managedLocalEditingContext, user: null, documentOwnerId: null, canDelete,
    callouts: [imported, locked], mixedDeleteBatchRef };
  callback('PDFViewer.jsx', 'handleBeginBatchDelete', scope)(2, ['imported', 'locked']);
  assert.deepEqual(mixedDeleteBatchRef.current.calloutIds, ['imported']);
  const marker = { userId: 'original-author' };
  const markerScope = { managedLocalEditingContext, user: null, eraseDocumentOwnerId: null, canCommitSurveyMarkerErase,
    surveyMarkersRef: { current: { saved: marker, locked: { ...marker, locked: true } } }, newSurveyMarkersByPage: {} };
  const canErase = callback('PDFViewer.jsx', 'canEraseSurveyMarker', markerScope);
  assert.equal(canErase('saved'), true);
  assert.equal(canErase('locked'), false);
  assert.equal(canErase('unknown'), false);
  assert.deepEqual(marker, { userId: 'original-author' });
});

test('all actual viewer renderers receive the same context, with no managed no-id bypass', () => {
  const { tree } = sourceTree('PDFViewer.jsx');
  const renderers = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement' && ['PageAnnotationLayer', 'SVGAnnotationLayer', 'FabricEraserCanvas'].includes(node.name.name)) renderers.push(node);
    for (const value of Object.values(node)) if (value && typeof value === 'object') {
      for (const child of Array.isArray(value) ? value : [value]) walk(child);
    }
  }
  walk(tree);
  assert.equal(renderers.length, 4);
  for (const renderer of renderers) {
    const attribute = renderer.attributes.find(attr => attr.name?.name === 'localDocumentContext');
    assert.equal(attribute?.value?.expression?.name, 'managedLocalEditingContext');
    if (renderer.name.name === 'FabricEraserCanvas') {
      const guard = renderer.attributes.find(attr => attr.name?.name === 'isLocalOnlyDocument').value.expression;
      assert.equal(guard.type, 'LogicalExpression');
      assert.equal(guard.right.operator, '!==');
      assert.equal(guard.right.left.property.name, 'storageMode');
      assert.equal(guard.right.right.value, 'local');
    }
  }
});

test('legacy canvas memo cannot retain an old local capability or cloud permission scope', () => {
  const { source, tree } = sourceTree('PageAnnotationLayer.jsx');
  const memo = findNode(tree, node => node.type === 'CallExpression' && node.arguments?.[1]?.params?.[0]?.name === 'prevProps');
  assert.ok(memo, 'production custom memo comparator exists');
  const node = memo.arguments[1];
  const equal = new Function(`return (${source.slice(node.start, node.end)});`)();
  const before = { scale: 1, localDocumentContext: createManagedLocalEditingContext(localFile()),
    viewerId: null, documentOwnerId: null, canEraseSurveyMarker: () => true };
  assert.equal(equal(before, before), true);
  for (const change of [{ localDocumentContext: null }, { localDocumentContext: false },
    { viewerId: 'new-actor' }, { documentOwnerId: 'new-owner' }, { canEraseSurveyMarker: () => false }]) {
    assert.equal(equal(before, { ...before, ...change }), false, `changed ${Object.keys(change)[0]} must refresh refs`);
  }
});

test('actual context-menu Cut gate allows local imported marks and denies local locks or invalid context', () => {
  const localDocumentContext = createManagedLocalEditingContext(localFile());
  const scope = { localDocumentContext, viewerId: null, documentOwnerId: null, canModify };
  const canCut = callback('hooks/useAnnotationContextMenu.jsx', 'canModifyObj', scope);
  assert.equal(canCut(imported), true);
  assert.equal(canCut(locked), false);
  for (const bad of [false, { ...localDocumentContext }]) {
    assert.equal(callback('hooks/useAnnotationContextMenu.jsx', 'canModifyObj', { ...scope, localDocumentContext: bad })(imported), false);
  }
  assert.equal(callback('hooks/useAnnotationContextMenu.jsx', 'canModifyObj', {
    ...scope, localDocumentContext: null, viewerId: 'collaborator', documentOwnerId: 'cloud-owner',
  })(imported), false);
});

test('local deletion Undo/Redo and document-batch history preserve all original authors and lock state', () => {
  const localDocumentContext = createManagedLocalEditingContext(localFile());
  const original = { 1: { objects: [imported, anonymous, locked] } };
  const nextPage = { objects: [locked] };
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: original[1], nextPage });
  const documentAction = { type: 'fabric:document-batch', actions: [action] };
  for (const userId of [null, 'signed-in-later']) {
    const allowed = filterAnnotationHistoryActionByOwner(documentAction, userId, null, localDocumentContext);
    assert.equal(allowed, documentAction);
    const deleted = applyAnnotationHistoryAction(original, allowed);
    assert.deepEqual(deleted[1].objects, [locked]);
    const undo = filterAnnotationHistoryActionByOwner(invertAnnotationHistoryAction(allowed), userId, null, localDocumentContext);
    assert.deepEqual(applyAnnotationHistoryAction(deleted, undo), original);
    assert.deepEqual(applyAnnotationHistoryAction(applyAnnotationHistoryAction(deleted, undo), allowed), deleted);
  }
  assert.equal(filterAnnotationHistoryActionByOwner(documentAction, null, null), null);
  assert.equal(filterAnnotationHistoryActionByOwner(documentAction, null, null, { ...localDocumentContext }), null);
  assert.equal(filterAnnotationHistoryActionByOwner(documentAction, 'other', 'cloud-owner'), null);
});

test('every viewer local history guard receives the context and callback dependencies track it', () => {
  const { tree } = sourceTree('PDFViewer.jsx');
  for (const name of ['applyLocalAnnotationHistoryAction', 'pushLocalAnnotationHistoryAction',
    'commitTextMarkupDocumentTransaction', 'handleDeleteCounterSeries']) {
    const variable = findNode(tree, node => node.type === 'VariableDeclarator' && node.id.name === name);
    const call = findNode(variable, node => node.type === 'CallExpression' && node.callee.name === 'filterAnnotationHistoryActionByOwner');
    assert.equal(call?.arguments?.[3]?.name, 'managedLocalEditingContext', `${name} forwards device ownership`);
    assert.ok(variable.init.arguments[1].elements.some(node => node.name === 'managedLocalEditingContext'), `${name} does not retain old context`);
  }
  const menu = findNode(tree, node => node.type === 'CallExpression' && node.callee.name === 'renderAnnotationContextMenu');
  assert.equal(menu.arguments[2].properties.find(node => node.key.name === 'localDocumentContext').value.name,
    'managedLocalEditingContext');
});
