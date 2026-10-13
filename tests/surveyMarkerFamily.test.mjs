// w53 (2026-09-28) — Survey Markers in the one annotation family.
// Pure rules: stack placement among marks, mixed restack, the undo half,
// marquee / lasso picking and the canvas list patch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVEY_MARKER_HISTORY_TYPE,
  applySelectionOp,
  applySurveyMarkerHistoryAction,
  buildFamilyStack,
  buildSurveyMarkerHistoryAction,
  collectSurveyMarkerHistoryActions,
  invertSurveyMarkerHistoryAction,
  markerIdsByGap,
  patchSurveyMarkerRenderPages,
  planFamilyReorder,
  resolveMarkerGap,
  resolveSurveyMarkerLassoHits,
  resolveSurveyMarkerMarqueeHits,
  stackOnTop,
  surveyMarkerRenderEntry,
  translateSurveyMarkerRecord,
} from '../src/utils/surveyMarkerFamily.js';
import {
  applyAnnotationHistoryAction,
  invertAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { reorderSelectionInStack } from '../src/utils/annotationFamilyRules.js';
import { computeExcelSyncFingerprint } from '../src/utils/excelSyncDirtyState.js';

const mark = (id) => ({ type: 'rect', left: 0, top: 0, width: 10, height: 10, data: { id } });
const A = mark('a');
const B = mark('b');
const C = mark('c');

const kinds = (stack) => stack.map((entry) => (entry.kind === 'mark' ? `m${entry.index}` : entry.id));

test('a marker with no stack draws on top of every mark (pre-w53 look)', () => {
  assert.equal(resolveMarkerGap([A, B], null), 2);
  assert.deepEqual(kinds(buildFamilyStack([A, B], [{ id: 'x' }])), ['m0', 'm1', 'x']);
});

test('a marker sits right above its `after` mark, else right below `before`, else top', () => {
  assert.equal(resolveMarkerGap([A, B, C], { after: 'a' }), 1);
  assert.equal(resolveMarkerGap([A, B, C], { after: 'gone', before: 'c' }), 2);
  assert.equal(resolveMarkerGap([A, B, C], { after: 'gone', before: 'gone2' }), 3);
  assert.equal(resolveMarkerGap([A, B, C], { after: null, before: 'gone', bottom: true }), 0);
});

test('markers in one gap keep their order among themselves', () => {
  const stack = buildFamilyStack([A, B], [
    { id: 'y', stack: { after: 'a', order: 2 } },
    { id: 'x', stack: { after: 'a', order: 1 } },
  ]);
  assert.deepEqual(kinds(stack), ['m0', 'x', 'y', 'm1']);
  assert.deepEqual([...markerIdsByGap([A, B], [{ id: 'x', stack: { after: 'a' } }])], [[1, ['x']]]);
});

test('with no markers the mixed planner is exactly reorderSelectionInStack', () => {
  for (const direction of ['front', 'back', 'forward', 'backward']) {
    const plain = reorderSelectionInStack([A, B, C], [0, 1], direction);
    const family = planFamilyReorder([A, B, C], [], { selectedIndices: [0, 1], direction });
    assert.deepEqual(family.objects, plain.objects, direction);
    assert.deepEqual(family.selectedIndices, plain.selectedIndices, direction);
    assert.equal(family.changed, plain.changed, direction);
  }
});

test('Bring a marker to front: it goes above every mark and names the top mark', () => {
  const plan = planFamilyReorder([A, B], [{ id: 'x', stack: { after: null, bottom: true } }], {
    selectedMarkerIds: ['x'], direction: 'front',
  });
  assert.equal(plan.changed, true);
  assert.equal(plan.objectsChanged, false);
  assert.deepEqual(plan.markerStacks.get('x'), { after: 'b', before: null, order: 0 });
});

// The order a plan draws: its marks plus every marker with its written stack.
const drawn = (plan, markers) => kinds(buildFamilyStack(
  plan.objects,
  markers.map((m) => (plan.markerStacks.has(m.id) ? { ...m, stack: plan.markerStacks.get(m.id) } : m)),
)).map((k) => (k.startsWith('m') ? plan.objects[Number(k.slice(1))].data.id : k));

test('restacking marks never rewrites a marker that stays where it is', () => {
  // x (no stack) floats on top; sending b to the back leaves x on top, so
  // x's record is not written (every write is a whole-record write).
  const plan = planFamilyReorder([A, B], [{ id: 'x' }], { selectedIndices: [1], direction: 'back' });
  assert.deepEqual(plan.objects, [B, A]);
  assert.equal(plan.markerStacks.size, 0);
  assert.deepEqual(plan.selectedIndices, [0]);
  // …but a mark brought above a floating marker pins it below.
  const front = planFamilyReorder([A, B], [{ id: 'x' }, { id: 'y' }], { selectedIndices: [0], direction: 'front' });
  assert.deepEqual(drawn(front, [{ id: 'x' }, { id: 'y' }]), ['b', 'x', 'y', 'a']);
});

test('a mixed selection moves as one block and keeps its own order', () => {
  // stack: A, x, B, C  → select A and x, bring to front → B, C, A, x
  const markers = [{ id: 'x', stack: { after: 'a', before: 'b', order: 0 } }];
  const plan = planFamilyReorder([A, B, C], markers, {
    selectedIndices: [0], selectedMarkerIds: ['x'], direction: 'front',
  });
  assert.deepEqual(plan.objects, [B, C, A]);
  assert.deepEqual(drawn(plan, markers), ['b', 'c', 'a', 'x']);
  assert.deepEqual(plan.selectedIndices, [2]);
});

test('one item forward jumps past the nearest neighbour it overlaps', () => {
  const markers = [{ id: 'x', stack: { after: null, before: 'a', bottom: true, order: 0 } }];
  // x, A, B, C — x overlaps only C
  const overlaps = (from, to) => to.kind === 'mark' && to.index === 2;
  const plan = planFamilyReorder([A, B, C], markers, { selectedMarkerIds: ['x'], direction: 'forward', overlaps });
  assert.deepEqual(plan.markerStacks.get('x'), { after: 'c', before: null, order: 0 });
  const none = planFamilyReorder([A, B, C], markers, { selectedMarkerIds: ['x'], direction: 'forward', overlaps: () => false });
  assert.equal(none.changed, false);
});

test('stackOnTop names the page top mark', () => {
  const stack = stackOnTop([A, B]);
  assert.equal(stack.after, 'b');
  assert.equal(stackOnTop([]).bottom, true);
});

test('undo half: build / invert / field-level apply', () => {
  const before = { pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 }, name: 'Door 1' };
  const after = translateSurveyMarkerRecord(before, 10, 20);
  assert.deepEqual(after.bounds, { x: 11, y: 22, width: 3, height: 4 });
  const action = buildSurveyMarkerHistoryAction([{ id: 'm', before, after }]);
  assert.equal(action.type, SURVEY_MARKER_HISTORY_TYPE);
  assert.equal(buildSurveyMarkerHistoryAction([{ id: 'm', before, after: before }]), null);
  // Excel renamed the marker after the move: Undo puts the bounds back and
  // keeps the new name.
  const now = { m: { ...after, name: 'Door 1 (Excel)' } };
  const undone = applySurveyMarkerHistoryAction(now, invertSurveyMarkerHistoryAction(action));
  assert.deepEqual(undone.markers.m.bounds, before.bounds);
  assert.equal(undone.markers.m.name, 'Door 1 (Excel)');
  assert.deepEqual(undone.changedIds, ['m']);
  // A marker deleted meanwhile stays deleted.
  assert.deepEqual(applySurveyMarkerHistoryAction({}, action).changedIds, []);
  // Create / remove.
  const create = buildSurveyMarkerHistoryAction([{ id: 'n', before: null, after }]);
  assert.ok(applySurveyMarkerHistoryAction({}, create).markers.n);
  assert.equal(applySurveyMarkerHistoryAction({ n: after }, invertSurveyMarkerHistoryAction(create)).markers.n, undefined);
});

test('the page lane carries a marker child untouched and inverts it', () => {
  const markerAction = buildSurveyMarkerHistoryAction([{ id: 'm', before: { bounds: { x: 0 } }, after: { bounds: { x: 5 } } }]);
  const byPage = { 1: { objects: [A] } };
  const batch = { type: 'fabric:document-batch', actions: [markerAction] };
  assert.deepEqual(applyAnnotationHistoryAction(byPage, batch), byPage);
  const inverted = invertAnnotationHistoryAction(batch);
  assert.equal(inverted.actions[0].changes[0].after.bounds.x, 0);
  assert.equal(collectSurveyMarkerHistoryActions(inverted).length, 1);
});

test('marquee window / crossing and lasso pick markers like marks', () => {
  const members = [
    { id: 'in', box: { left: 10, top: 10, width: 10, height: 10, angle: 0 } },
    { id: 'edge', box: { left: 45, top: 10, width: 10, height: 10, angle: 0 } },
  ];
  const rect = { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 };
  assert.deepEqual(resolveSurveyMarkerMarqueeHits(members, rect, 'window'), ['in']);
  assert.deepEqual(resolveSurveyMarkerMarqueeHits(members, rect, 'crossing'), ['in', 'edge']);
  const polygon = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }];
  assert.deepEqual(resolveSurveyMarkerLassoHits(members, polygon, 'window'), ['in']);
  assert.deepEqual(resolveSurveyMarkerLassoHits(members, polygon, 'crossing'), ['in', 'edge']);
  assert.deepEqual([...applySelectionOp(new Set(['a']), ['b'], 'add')], ['a', 'b']);
  assert.deepEqual([...applySelectionOp(new Set(['a', 'b']), ['b'], 'subtract')], ['a']);
  assert.deepEqual([...applySelectionOp(new Set(['a']), ['b'], 'replace')], ['b']);
});

test('the canvas list patch keeps slots, moves pages, drops other modules', () => {
  const rec = (page, x, moduleId = 'mod') => ({ pageNumber: page, bounds: { x, y: 0, width: 5, height: 5 }, moduleId, entityColor: '#f00' });
  const byPage = { 1: [{ annotationId: 'a', x: 0 }, { annotationId: 'b', x: 0 }, { annotationId: 'pending', x: 0 }] };
  const markers = { a: rec(1, 9), b: rec(2, 3), c: rec(1, 1), d: rec(1, 1, 'other') };
  const next = patchSurveyMarkerRenderPages(byPage, markers, ['a', 'b', 'c', 'd'], { selectedModuleId: 'mod' });
  assert.deepEqual(next[1].map((e) => e.annotationId), ['a', 'pending', 'c']);
  assert.equal(next[1][0].x, 9);
  assert.deepEqual(next[2].map((e) => e.annotationId), ['b']);
  const entry = surveyMarkerRenderEntry('a', { ...rec(1, 0), stack: { after: 'z' } });
  assert.deepEqual(entry.stack, { after: 'z' });
});

test('restacking a marker never makes the linked Excel read "not synced"', () => {
  const template = { id: 't', linkedExcelPath: '/x.xlsx' };
  const base = { m: { name: 'Door', bounds: { x: 1 } } };
  const restacked = { m: { ...base.m, stack: { after: 'a' } } };
  assert.equal(
    computeExcelSyncFingerprint(template, base).hash,
    computeExcelSyncFingerprint(template, restacked).hash,
  );
});
