// w64 (owner 2026-09-29): picking a mark on the page while History is open
// narrows the list to that mark's lines ("Showing history for this … · Clear").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHistoryFeed, historyRowMarkIds } from '../src/utils/historyFeed.js';
import {
  HISTORY_PAGE_SELECTION_EVENT,
  broadcastPageSelection,
  historyGroupTouchesMarks,
  historyMarkFilterEmptyText,
  historyMarkFilterLabel,
  historyMarkFilterNoun,
  historyRowsTouchMarks,
  mergePageSelections,
  normalizeSelectionItems,
  selectionKey,
} from '../src/utils/historyMarkFilter.js';

const NOW = new Date('2026-09-29T15:00:00').getTime();
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
const row = (id, over = {}) => ({
  id,
  client_event_id: id,
  document_id: 'doc',
  user_id: 'u-me',
  event_type: 'local_annotation_history_added',
  page_number: 1,
  annotation_id: 'rect-1',
  summary: 'Isaiah Calvo moved a rectangle on page 1',
  payload: { actionType: 'move', annotationType: 'rect' },
  occurred_at: at(10),
  ...over,
});

const rows = [
  row('r1', { occurred_at: at(300), payload: { actionType: 'create', annotationType: 'rect' } }),
  row('r2', { occurred_at: at(200) }),
  row('e1', { annotation_id: 'ell-1', occurred_at: at(150), payload: { actionType: 'create', annotationType: 'ellipse' } }),
  row('c1', { annotation_id: 'callout-1', user_id: 'u-maya', summary: 'Maya created a callout', occurred_at: at(120), payload: { actionType: 'create', annotationType: 'callout' } }),
  row('sm1', {
    annotation_id: null,
    event_type: 'checkpoint_added',
    occurred_at: at(100),
    payload: { reason: 'survey-marker:move', annotationId: 'sm-1' },
  }),
  row('b1', {
    annotation_id: null,
    event_type: 'annotations_bulk_deleted',
    occurred_at: at(60),
    payload: { objects: [{ annotationId: 'ell-2', pageNumber: 2 }, { annotationId: 'counter-9', pageNumber: 2 }] },
  }),
  row('r3', { occurred_at: at(5), payload: { actionType: 'recolor', annotationType: 'rect' } }),
];

const groupKeys = (feed) => feed.items.filter((i) => i.type === 'group').map((i) => i.group.key);

test('the page layer broadcasts its pick with the window\'s own event class and never throws', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /broadcastPageSelection\(/);
  assert.equal(HISTORY_PAGE_SELECTION_EVENT, 'annotations:page-selection');
  const seen = [];
  class FakeEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  const win = { CustomEvent: FakeEvent, dispatchEvent: (e) => { if (!(e instanceof FakeEvent)) throw new TypeError('not an Event'); seen.push(e); } };
  assert.equal(broadcastPageSelection(win, 2, [{ id: 'a', typeKey: 'rect' }]), true);
  assert.deepEqual(seen[0].detail, { pageNumber: 2, items: [{ id: 'a', typeKey: 'rect' }] });
  assert.equal(seen[0].type, HISTORY_PAGE_SELECTION_EVENT);
  assert.equal(broadcastPageSelection({ dispatchEvent: () => { throw new Error('boom'); }, CustomEvent: FakeEvent }, 1, []), false);
  assert.equal(broadcastPageSelection(null, 1, []), false);
});

test('a picked mark shows only its lines, newest first', () => {
  const feed = buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, markIds: ['rect-1'] });
  assert.deepEqual(groupKeys(feed), ['g:r3', 'g:r2', 'g:r1']);
  assert.equal(feed.groupCount, 3);
});

test('the pick ignores the Only me / Deleted chips and the search', () => {
  const feed = buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, filter: 'deleted', query: 'nothing matches', markIds: ['callout-1'] });
  assert.deepEqual(groupKeys(feed), ['g:c1']);
  const me = buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, filter: 'me', markIds: ['callout-1'] });
  assert.deepEqual(groupKeys(me), ['g:c1'], 'someone else\'s line about the mark still shows');
});

test('a multi-pick shows every picked mark\'s lines; a bulk delete counts for each mark in it', () => {
  const feed = buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, markIds: new Set(['ell-1', 'counter-9']) });
  assert.deepEqual(groupKeys(feed), ['g:b1', 'g:e1']);
});

test('Survey Markers match on their marker id', () => {
  const feed = buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, markIds: ['sm-1'] });
  assert.deepEqual(groupKeys(feed), ['g:sm1']);
});

test('no pick (null / empty) leaves the feed as it was', () => {
  const all = groupKeys(buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW }));
  assert.deepEqual(groupKeys(buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, markIds: [] })), all);
  assert.deepEqual(groupKeys(buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, markIds: null })), all);
});

test('a mark with no lines gives an empty feed', () => {
  const feed = buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW, markIds: ['never-seen'] });
  assert.equal(feed.groupCount, 0);
  assert.equal(feed.items.length, 0);
});

test('page picks merge into one pick; an empty page drops out', () => {
  const byPage = new Map([
    [3, [{ id: 'b', typeKey: 'counter' }]],
    [1, [{ id: 'a', typeKey: 'rect' }, { id: 'a', typeKey: 'rect' }]],
    [2, []],
  ]);
  assert.deepEqual(mergePageSelections(byPage), [{ id: 'a', typeKey: 'rect' }, { id: 'b', typeKey: 'counter' }]);
  assert.deepEqual(mergePageSelections({}), []);
  assert.equal(selectionKey([{ id: 'b' }, { id: 'a' }]), selectionKey([{ id: 'a' }, { id: 'b' }]));
  assert.equal(selectionKey([]), '');
  assert.deepEqual(normalizeSelectionItems([{ id: '' }, null, { id: 7, typeKey: 'space' }]), [{ id: '7', typeKey: 'mark' }]);
});

test('the bar names the mark in plain words', () => {
  assert.equal(historyMarkFilterLabel([{ id: 'a', typeKey: 'rect' }]), 'Showing history for this rectangle');
  assert.equal(historyMarkFilterLabel([{ id: 'a', typeKey: 'surveyMarker' }]), 'Showing history for this Survey Marker');
  assert.equal(historyMarkFilterLabel([{ id: 'a', typeKey: 'callout' }]), 'Showing history for this callout');
  assert.equal(historyMarkFilterLabel([{ id: 'a', typeKey: 'counter' }]), 'Showing history for this counter');
  assert.equal(historyMarkFilterNoun([{ id: 'a', typeKey: 'text' }, { id: 'b', typeKey: 'text' }]), 'these 2 text boxes');
  assert.equal(historyMarkFilterNoun([{ id: 'a', typeKey: 'rect' }, { id: 'b', typeKey: 'callout' }, { id: 'c', typeKey: 'pen' }]), 'these 3 marks');
  assert.equal(historyMarkFilterEmptyText([{ id: 'a', typeKey: 'ellipse' }]), 'This ellipse has no history yet.');
  assert.equal(historyMarkFilterEmptyText([{ id: 'a', typeKey: 'rect' }, { id: 'b', typeKey: 'rect' }]), 'These 2 rectangles have no history yet.');
  assert.match(historyMarkFilterEmptyText([{ id: 'a', typeKey: 'rect' }], { searchedAll: false }), /Load older/);
});

test('looking further back stops once a page holds the mark', () => {
  const ids = new Set(['counter-9']);
  assert.equal(historyRowsTouchMarks(rows, ids, historyRowMarkIds), true);
  assert.equal(historyRowsTouchMarks(rows.slice(0, 3), ids, historyRowMarkIds), false);
  assert.equal(historyRowsTouchMarks(rows, new Set(), historyRowMarkIds), false);
  const group = { entries: [{ markIds: ['x'] }, { markIds: ['counter-9'] }] };
  assert.equal(historyGroupTouchesMarks(group, ids), true);
  assert.equal(historyGroupTouchesMarks({ markIds: ['y'] }, ids), false);
});
