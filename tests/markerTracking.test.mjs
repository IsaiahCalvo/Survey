import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORY_LIMIT,
  activityText,
  activityTimeLabel,
  dueLabel,
  isDueSoon,
  isOverdue,
  readHistory,
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
  assert.deepEqual(set, {
    status: 'in-progress', assigneeId: null, due: null, updatedAt: now(), updatedBy: 'u1',
    history: [{ at: now(), by: 'u1', field: 'status', from: 'open', to: 'in-progress' }],
  });
  const marker = { tracking: set };
  assert.equal(nextTracking(marker, { status: 'in-progress' }, { now }), set);
  const assigned = nextTracking(marker, { assigneeId: 'u2', due: '2026-11-03' }, { now, by: 'u1' });
  assert.equal(assigned.status, 'in-progress');
  assert.equal(assigned.assigneeId, 'u2');
  assert.deepEqual(assigned.history.map((e) => e.field), ['status', 'assigneeId', 'due']);
  // Back to nothing set: the field stays, so its Activity is kept.
  const cleared = nextTracking({ tracking: assigned }, { status: 'open', assigneeId: '', due: '' }, { now, by: 'u2' });
  assert.deepEqual(readTracking({ tracking: cleared }), { status: 'open', assigneeId: null, due: null });
  assert.equal(cleared.history.length, 6);
  assert.deepEqual(cleared.history.at(-1), { at: now(), by: 'u2', field: 'due', from: '2026-11-03', to: null });
});

test('Activity: capped, bad entries dropped, plain words', () => {
  let marker = {};
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    marker = { tracking: nextTracking(marker, { status: i % 2 ? 'open' : 'done' }, { now, by: 'u1' }) };
  }
  assert.equal(marker.tracking.history.length, HISTORY_LIMIT);
  assert.deepEqual(readHistory({ tracking: { history: [null, { field: 'name', at: 'x' }, { field: 'due', at: now(), from: 'bad', to: '2026-11-03', by: 7 }] } }),
    [{ at: now(), by: null, field: 'due', from: null, to: '2026-11-03' }]);
  const nameOf = (id) => ({ u1: 'Ivy', u2: 'Eddie' }[id] || 'someone');
  const today = '2026-11-09';
  const t = (e) => activityText(e, { nameOf, today });
  assert.equal(t({ field: 'status', from: 'open', to: 'in-progress' }), 'set the status to In progress');
  assert.equal(t({ field: 'status', from: 'in-progress', to: 'done' }), 'changed the status from In progress to Done');
  assert.equal(t({ field: 'assigneeId', from: null, to: 'u2' }), 'gave it to Eddie');
  assert.equal(t({ field: 'assigneeId', from: null, to: 'u2', by: 'u2' }), 'took it on');
  assert.equal(t({ field: 'assigneeId', from: 'u2', to: 'u1' }), 'moved it from Eddie to Ivy');
  assert.equal(t({ field: 'assigneeId', from: 'u2', to: null }), 'took it off Eddie');
  assert.equal(t({ field: 'due', from: null, to: '2026-11-12' }), 'set the due date to Nov 12');
  assert.equal(t({ field: 'due', from: '2026-11-12', to: '2026-11-14' }), 'moved the due date to Nov 14');
  assert.equal(t({ field: 'due', from: '2026-11-12', to: null }), 'cleared the due date');
  assert.match(activityTimeLabel(new Date(2026, 10, 9, 14, 5).toISOString(), new Date(2026, 10, 10)), /^Nov 9, 2:05 PM$/);
  assert.match(activityTimeLabel(new Date(2025, 0, 2, 0, 30).toISOString(), new Date(2026, 10, 10)), /^Jan 2, 2025, 12:30 AM$/);
  assert.equal(activityTimeLabel('nope'), '');
});

test('due soon means today or the next 3 days, not done', () => {
  const today = '2026-11-09';
  assert.equal(isDueSoon({ status: 'open', due: '2026-11-09' }, today), true);
  assert.equal(isDueSoon({ status: 'open', due: '2026-11-12' }, today), true);
  assert.equal(isDueSoon({ status: 'open', due: '2026-11-13' }, today), false);
  assert.equal(isDueSoon({ status: 'open', due: '2026-11-08' }, today), false);
  assert.equal(isDueSoon({ status: 'done', due: '2026-11-10' }, today), false);
  const pass = (m) => passesTrackingFilter(m, { dueSoon: true }, { userId: 'me', today });
  assert.equal(pass({ tracking: { status: 'open', due: '2026-11-10' } }), true);
  assert.equal(pass({}), false);
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

test('shortDayLabel: month and day, with the year only when it differs', async () => {
  const { shortDayLabel } = await import('../src/utils/markerTracking.js');
  assert.equal(shortDayLabel('2026-11-08', '2026-11-09'), 'Nov 8');
  assert.equal(shortDayLabel('2027-01-03', '2026-11-09'), 'Jan 3, 2027');
  assert.equal(shortDayLabel(null, '2026-11-09'), '');
  assert.equal(shortDayLabel('11/08/2026', '2026-11-09'), '');
});
