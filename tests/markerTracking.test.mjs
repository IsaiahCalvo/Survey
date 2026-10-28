import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dueLabel,
  isOverdue,
  nextTracking,
  passesTrackingFilter,
  readTracking,
  todayKey,
} from '../src/utils/markerTracking.js';
import { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';

const now = () => '2026-10-28T12:00:00.000Z';

test('readTracking fills in an untouched item and drops bad values', () => {
  assert.deepEqual(readTracking({}), { status: 'open', assigneeId: null, due: null });
  assert.deepEqual(readTracking({ tracking: { status: 'nope', assigneeId: 7, due: '10/30/2026' } }), { status: 'open', assigneeId: null, due: null });
  assert.deepEqual(readTracking({ tracking: { status: 'done', assigneeId: 'u1', due: '2026-10-30' } }), { status: 'done', assigneeId: 'u1', due: '2026-10-30' });
});

test('nextTracking stamps a change, keeps the same value for no change, clears back to nothing', () => {
  const set = nextTracking({}, { status: 'in-progress' }, { now, by: 'u1' });
  assert.deepEqual(set, { status: 'in-progress', assigneeId: null, due: null, updatedAt: now(), updatedBy: 'u1' });
  const marker = { tracking: set };
  assert.equal(nextTracking(marker, { status: 'in-progress' }, { now }), set);
  const assigned = nextTracking(marker, { assigneeId: 'u2', due: '2026-11-03' }, { now, by: 'u1' });
  assert.equal(assigned.status, 'in-progress');
  assert.equal(assigned.assigneeId, 'u2');
  assert.equal(nextTracking({ tracking: assigned }, { status: 'open', assigneeId: '', due: '' }, { now }), undefined);
});

test('late means a past due date on an item that is not done', () => {
  const today = '2026-10-28';
  assert.equal(isOverdue({ status: 'open', due: '2026-10-27' }, today), true);
  assert.equal(isOverdue({ status: 'done', due: '2026-10-27' }, today), false);
  assert.equal(isOverdue({ status: 'open', due: '2026-10-28' }, today), false);
  assert.equal(isOverdue({ status: 'open', due: null }, today), false);
});

test('dueLabel speaks in days', () => {
  const today = '2026-10-28';
  assert.equal(dueLabel('2026-10-28', today), 'Due today');
  assert.equal(dueLabel('2026-10-29', today), 'Due tomorrow');
  assert.equal(dueLabel('2026-10-27', today), '1 day late');
  assert.equal(dueLabel('2026-10-20', today), '8 days late');
  assert.equal(dueLabel('2026-11-03', today), 'Due Nov 3');
  assert.equal(dueLabel('2027-01-05', today), 'Due Jan 5, 2027');
  assert.match(todayKey(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('the chips filter by who has it, late and done', () => {
  const today = '2026-10-28';
  const mineLate = { tracking: { status: 'open', assigneeId: 'me', due: '2026-10-01' } };
  const theirsDone = { tracking: { status: 'done', assigneeId: 'them', due: '2026-10-01' } };
  const untouched = {};
  const pass = (m, f) => passesTrackingFilter(m, { mine: false, overdue: false, hideDone: false, ...f }, { userId: 'me', today });
  assert.equal(pass(untouched, {}), true);
  assert.equal(pass(mineLate, { mine: true }), true);
  assert.equal(pass(theirsDone, { mine: true }), false);
  assert.equal(pass(untouched, { mine: true }), false);
  assert.equal(pass(mineLate, { overdue: true }), true);
  assert.equal(pass(theirsDone, { overdue: true }), false);
  assert.equal(pass(theirsDone, { hideDone: true }), false);
  assert.equal(pass(untouched, { hideDone: true }), true);
  assert.equal(passesTrackingFilter(mineLate, { mine: true }, { userId: null, today }), false);
});

test('the database mirror row keeps tracking and a cleared one goes away', () => {
  const tracking = { status: 'done', assigneeId: 'u2', due: '2026-11-03', updatedAt: now(), updatedBy: 'u1' };
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u1', annotationId: 'm1', annotation: { pageNumber: 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, tracking } });
  assert.deepEqual(row.annotation_data.tracking, tracking);
  const local = mapSurveyMarkerRowToLocalAnnotation({ annotation_id: 'm1', page_number: 1, bounds: {}, annotation_data: row.annotation_data });
  assert.deepEqual(local.tracking, tracking);
  const cleared = buildSurveyMarkerRow({ documentId: 'd', userId: 'u1', annotationId: 'm1', annotation: { pageNumber: 1, bounds: {}, annotationData: { tracking } } });
  assert.equal('tracking' in JSON.parse(JSON.stringify(cleared.annotation_data)), false);
});
