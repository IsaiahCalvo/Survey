import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSurveyMarkerTransferTarget,
  pickInTemplate,
  planSurveyMarkerTransfer,
  surveyMarkerTransferTargets,
} from '../src/utils/surveyMarkerTransfer.js';
import { applySurveyMarkerHistoryAction, buildSurveyMarkerHistoryAction, invertSurveyMarkerHistoryAction } from '../src/utils/surveyMarkerFamily.js';

const doc = {
  id: 't1', name: 'Doors',
  modules: [
    { id: 'install', name: 'Installation', categories: [{ id: 'door', name: 'Door' }, { id: 'cam', name: 'Camera' }] },
    { id: 'empty', name: 'Empty', categories: [] },
    { id: 'trim', name: 'Trim out', categories: [{ id: 'door2', name: 'Door' }] },
  ],
};
const other = { id: 't2', name: 'Other', modules: [{ id: 'x', name: 'X', categories: [{ id: 'xc', name: 'Xc' }] }] };
const bare = { id: 't3', name: 'No categories', modules: [{ id: 'y', name: 'Y', categories: [] }] };

test('targets: the document template first, then others with somewhere to go', () => {
  const targets = surveyMarkerTransferTargets(doc, [other, doc, bare]);
  assert.deepEqual(targets.map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(targets[0].modules.map((m) => m.id), ['install', 'empty', 'trim']);
});

test('picker starts in the same module on another category', () => {
  const targets = surveyMarkerTransferTargets(doc, [other]);
  assert.deepEqual(defaultSurveyMarkerTransferTarget(targets, { templateId: 't1', moduleId: 'install', categoryId: 'door' }), { templateId: 't1', moduleId: 'install', categoryId: 'cam' });
  // A module with no categories is skipped.
  assert.deepEqual(pickInTemplate(targets[0], { moduleId: 'empty' }), { templateId: 't1', moduleId: 'install', categoryId: 'door' });
  assert.deepEqual(pickInTemplate(targets[1], { moduleId: 'install' }), { templateId: 't2', moduleId: 'x', categoryId: 'xc' });
});

const markers = {
  a: { id: 'a', name: 'D-1', moduleId: 'install', categoryId: 'door', pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4, angle: 15 }, checklistResponses: { q: { selection: 'Y' } }, notes: 'keep', entityId: 'e1', color: '#f00', userId: 'u1', excelSync: { rowId: 'r' } },
  b: { id: 'b', name: 'D-2', moduleId: 'install', categoryId: 'door', pageNumber: 1, bounds: { x: 5, y: 6, width: 3, height: 4 }, userId: 'u2' },
};

test('move keeps the record and changes only its module and category; undo puts it back', () => {
  const plan = planSurveyMarkerTransfer({ mode: 'move', markers, ids: ['a'], moduleId: 'trim', categoryId: 'door2' });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.changes[0].after, { ...markers.a, moduleId: 'trim', categoryId: 'door2' });
  const action = buildSurveyMarkerHistoryAction(plan.changes);
  const moved = applySurveyMarkerHistoryAction(markers, action).markers;
  assert.equal(moved.a.categoryId, 'door2');
  assert.deepEqual(moved.a.checklistResponses, markers.a.checklistResponses);
  const back = applySurveyMarkerHistoryAction(moved, invertSurveyMarkerHistoryAction(action)).markers;
  assert.deepEqual(back.a, markers.a);
});

test('move refuses markers it may not change and a no-op move', () => {
  const locked = planSurveyMarkerTransfer({ mode: 'move', markers, ids: ['a', 'b'], moduleId: 'install', categoryId: 'cam', mayEdit: (r) => r.userId === 'u1' });
  assert.equal(locked.ok, false);
  assert.match(locked.reason, /not yours to move/);
  assert.equal(planSurveyMarkerTransfer({ mode: 'move', markers, ids: ['a'], moduleId: 'install', categoryId: 'door' }).ok, false);
});

test('copy makes new markers at the same place with the same name, no answers and no Excel identity', () => {
  let n = 0;
  const plan = planSurveyMarkerTransfer({ mode: 'copy', markers, ids: ['a'], moduleId: 'x', categoryId: 'xc', mintId: () => `new-${++n}`, userId: 'me', mayEdit: () => false });
  assert.equal(plan.ok, true);
  const copy = plan.changes[0].after;
  assert.equal(plan.changes[0].before, null);
  assert.equal(copy.id, 'new-1');
  assert.equal(copy.name, 'D-1');
  assert.deepEqual(copy.bounds, markers.a.bounds);
  assert.equal(copy.moduleId, 'x');
  assert.equal(copy.categoryId, 'xc');
  assert.deepEqual(copy.checklistResponses, {});
  assert.equal(copy.userId, 'me');
  assert.equal(copy.entityId, 'e1');
  assert.equal(copy.excelSync, undefined);
  assert.equal(copy.notes, undefined);
});

test('a destination is required', () => {
  assert.equal(planSurveyMarkerTransfer({ mode: 'move', markers, ids: ['a'], moduleId: 'install' }).ok, false);
  assert.equal(planSurveyMarkerTransfer({ mode: 'copy', markers, ids: ['gone'], moduleId: 'x', categoryId: 'xc', mintId: () => 'z' }).ok, false);
});
