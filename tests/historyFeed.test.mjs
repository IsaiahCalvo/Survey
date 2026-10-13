// RULED 2026-09-28 owner: History option A (activity feed, prototype
// history-A.html). Pure feed / wording / geometry checks for the History panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HISTORY_TRASH_EVENT_TYPES,
  buildHistoryFeed,
  buildHistoryGroups,
  classifyHistoryRow,
  describeHistoryRow,
  historyActorName,
  historyColorName,
  historyDayLabel,
  historyRangeLabel,
  historyRowMarkIds,
  latestDeleteRowByMark,
} from '../src/utils/historyFeed.js';
import { historyAnnotationBox, historyRowGhostAnnotation } from '../src/utils/historyGeometry.js';
import { TRASH_HISTORY_EVENT_TYPES, buildPartialEraseHistoryRow, buildHistoryEventRowFromDebugEvent } from '../src/services/documentHistoryService.js';
import { summarizeHistoryActionForLog } from '../src/viewerShared.js';

const NOW = new Date('2026-09-28T15:00:00').getTime();
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

test('trash types match the History service', () => {
  assert.deepEqual([...HISTORY_TRASH_EVENT_TYPES], [...TRASH_HISTORY_EVENT_TYPES]);
});

test('a line reads "<Name> <verb> <mark>"; You for your own lines', () => {
  const mine = describeHistoryRow(row('a'), { currentUserId: 'u-me' });
  assert.equal(mine.actorShort, 'You');
  assert.equal(`${mine.verb} ${mine.noun}`, 'moved a rectangle');
  const theirs = describeHistoryRow(row('b', { user_id: 'u-maya', summary: 'Maya Chen created an ellipse on page 2', payload: { actionType: 'create', annotationType: 'ellipse' } }), { currentUserId: 'u-me' });
  assert.equal(theirs.actorShort, 'Maya');
  assert.equal(theirs.actorName, 'Maya Chen');
  assert.equal(`${theirs.verb} ${theirs.noun}`, 'added an ellipse');
  assert.equal(historyActorName({ summary: 'someone@x.com deleted a callout' }), 'someone@x.com');
});

test('every mark type gets its own words and glyph', () => {
  const kinds = [
    [{ actionType: 'create', annotationType: 'line', previewAnnotation: { type: 'line', tool: 'arrow' } }, 'added an arrow', 'arrow'],
    [{ actionType: 'ink', annotationType: 'path' }, 'added a pen stroke', 'pen'],
    [{ actionType: 'recolor', annotationType: 'rect' }, 'changed the color of a rectangle', 'rect'],
    [{ actionType: 'erase', annotationType: 'path' }, 'erased part of a pen stroke', 'pen'],
    [{ actionType: 'lock', annotationType: 'counter' }, 'locked a counter', 'counter'],
    [{ actionType: 'unlock', annotationType: 'callout' }, 'unlocked a callout', 'callout'],
    [{ actionType: 'text edit', annotationType: 'textbox' }, 'edited the text of a text box', 'textBox'],
    [{ actionType: 'create', annotationType: 'rect', restoredFromHistory: true }, 'restored a rectangle', 'rect'],
    [{ actionType: 'create', annotationType: 'surveyMarker', previewAnnotation: { type: 'surveyMarker', surveyMarker: { name: 'Door 3' } } }, 'added Survey Marker “Door 3”', 'survey'],
  ];
  for (const [payload, words, glyph] of kinds) {
    const c = classifyHistoryRow(row('x', { payload }));
    assert.equal(`${c.verb} ${c.noun}`, words);
    assert.equal(c.glyph, glyph, words);
  }
  const sm = classifyHistoryRow(row('s', { event_type: 'survey_marker_deleted', payload: { origin: 'excel-import', restoreAction: { type: 'surveyMarker', markerId: 'm1', surveyMarker: { name: 'B-12' } } } }));
  assert.equal(`${sm.verb} ${sm.noun} ${sm.suffix}`, 'deleted Survey Marker “B-12” in Excel');
  const bulk = classifyHistoryRow(row('k', { event_type: 'annotations_bulk_deleted', source: 'annotation-eraser', payload: { rawActionType: 'annotations_erase_deleted', count: 3, objects: [{}, {}, {}] } }));
  assert.equal(`${bulk.verb} ${bulk.noun} ${bulk.suffix}`, 'deleted 3 marks with the eraser');
  assert.equal(classifyHistoryRow(row('u', { event_type: 'local_annotation_undo_applied' })).kind, 'undo');
  const space = classifyHistoryRow(row('sp', { event_type: 'space_deleted', payload: { restoreAction: { spaceId: 's1', spaceName: 'Level 2' } } }));
  assert.equal(`${space.verb} ${space.noun}`, 'deleted the space “Level 2”');
});

test('repeat edits of one mark by one person close together fold into one line', () => {
  const rows = [
    row('m1', { occurred_at: at(30) }),
    row('m2', { occurred_at: at(25) }),
    row('m3', { occurred_at: at(20) }),
    row('c1', { occurred_at: at(18), payload: { actionType: 'recolor', annotationType: 'rect' } }),
    row('m4', { occurred_at: at(17) }), // after a different kind: a new line
    row('o1', { occurred_at: at(16), user_id: 'u-maya', summary: 'Maya moved a rectangle' }), // another person
    row('m5', { occurred_at: at(0) }), // same person, but > 15 min after m4
  ];
  const groups = buildHistoryGroups(rows, { currentUserId: 'u-me' });
  assert.deepEqual(groups.map((g) => g.entries.map((e) => e.key)), [['m5'], ['o1'], ['m4'], ['c1'], ['m1', 'm2', 'm3']]);
  assert.equal(groups[4].count, 3);
  assert.equal(groups[4].key, 'g:m1', 'a folded line keeps its key as it grows');
  // Creates and deletes never fold.
  const creates = buildHistoryGroups([row('a1', { payload: { actionType: 'create' } }), row('a2', { payload: { actionType: 'create' }, occurred_at: at(9) })]);
  assert.equal(creates.length, 2);
});

test('feed: newest first, day headings, filters, search', () => {
  const rows = [
    row('today', { occurred_at: at(5) }),
    row('yesterday', { occurred_at: at(60 * 24), annotation_id: 'r2' }),
    row('older', { occurred_at: at(60 * 24 * 10), annotation_id: 'r3', user_id: 'u-maya', summary: 'Maya Chen deleted a rectangle', event_type: 'annotation_deleted', payload: { restoreAction: { type: 'fabric:create' } } }),
  ];
  const { items } = buildHistoryFeed(rows, { currentUserId: 'u-me', now: NOW });
  assert.deepEqual(items.map((i) => (i.type === 'day' ? i.label : i.group.key)), ['Today', 'g:today', 'Yesterday', 'g:yesterday', 'Fri, Sep 18', 'g:older']);
  assert.equal(buildHistoryFeed(rows, { currentUserId: 'u-me', filter: 'me', now: NOW }).groupCount, 2);
  assert.equal(buildHistoryFeed(rows, { currentUserId: 'u-me', filter: 'deleted', now: NOW }).groupCount, 1);
  assert.equal(buildHistoryFeed(rows, { currentUserId: 'u-me', query: 'maya deleted', now: NOW }).groupCount, 1);
  assert.equal(historyDayLabel(NOW - 3 * 86400000, NOW), 'Friday');
  assert.equal(historyRangeLabel(NOW - 30 * 60000, NOW - 2 * 60000, NOW), '2:30–2:58 PM');
});

test('the newest delete of a mark is the one that offers Restore', () => {
  const rows = [
    row('d1', { event_type: 'annotation_deleted', occurred_at: at(40) }),
    row('d2', { event_type: 'annotation_deleted', occurred_at: at(10) }),
    row('b', { event_type: 'annotations_bulk_deleted', annotation_id: null, occurred_at: at(5), payload: { objects: [{ annotationId: 'x1' }, { annotationId: 'x2' }] } }),
  ];
  const latest = latestDeleteRowByMark(rows);
  assert.equal(latest.get('rect-1').id, 'd2');
  assert.equal(latest.get('x2').id, 'b');
  assert.deepEqual(historyRowMarkIds(rows[2]), ['x1', 'x2']);
});

test('color words for a color change', () => {
  assert.equal(historyColorName('#FF0000'), 'Red');
  assert.equal(historyColorName('#0000FF'), 'Blue');
  assert.equal(historyColorName('#000000'), 'Black');
  assert.equal(historyColorName('rgb(34, 197, 94)'), 'Green');
});

test('ghost geometry in page units', () => {
  assert.deepEqual(historyAnnotationBox({ type: 'rect', left: 10, top: 20, width: 50, height: 30, scaleX: 2, scaleY: 1 }), { x: 10, y: 20, width: 100, height: 30 });
  assert.deepEqual(historyAnnotationBox({ type: 'line', left: 5, top: 5, x1: 0, y1: 10, x2: 40, y2: 0 }), { x: 5, y: 5, width: 40, height: 10 });
  const sm = historyRowGhostAnnotation({ payload: { restoreAction: { type: 'surveyMarker', surveyMarker: { bounds: { x: 1, y: 2, width: 3, height: 4 } } } } });
  assert.deepEqual(historyAnnotationBox(sm), { x: 1, y: 2, width: 3, height: 4 });
});

test('a color change is logged as a recolor with the mark before it', () => {
  const before = { type: 'rect', left: 1, top: 1, width: 10, height: 10, stroke: '#ff0000', data: { id: 'r' } };
  const after = { ...before, stroke: '#0000ff' };
  const summary = summarizeHistoryActionForLog({ type: 'fabric:update', pageNumber: 1, annotationId: 'r', before, after });
  assert.equal(summary.actionType, 'recolor');
  assert.equal(summary.previewBefore.stroke, '#ff0000');
  const widthOnly = summarizeHistoryActionForLog({ type: 'fabric:update', pageNumber: 1, annotationId: 'r', before, after: { ...before, strokeWidth: 5 } });
  assert.equal(widthOnly.actionType, 'restyle', 'a width change is not a color change');
  const row1 = buildHistoryEventRowFromDebugEvent({ type: 'local_annotation_history_added', order: 1, timestamp: at(1), ...summary }, { documentId: 'doc', user: { id: 'u', email: 'a@b.c', user_metadata: { full_name: 'Isaiah Calvo' } } });
  assert.equal(row1.summary, 'Isaiah Calvo changed the color of a rectangle on page 1');
});

test('a Survey Marker step reads as a Survey Marker line with its page', () => {
  const marker = { pageNumber: 2, name: 'Door 3', bounds: { x: 5, y: 6, width: 7, height: 8 } };
  const summary = summarizeHistoryActionForLog({ type: 'survey-marker:batch', changes: [{ id: 'm1', before: null, after: marker }] });
  assert.equal(summary.actionType, 'create');
  assert.equal(summary.annotationType, 'surveyMarker');
  assert.equal(summary.annotationId, 'm1');
  assert.equal(summary.pageNumber, 2);
  assert.deepEqual(historyAnnotationBox(summary.previewAnnotation), { x: 5, y: 6, width: 7, height: 8 });
});

test('a partial erase writes one "erased part of" line with before and after', () => {
  const before = { type: 'path', path: [['M', 0, 0], ['L', 10, 0]], data: { id: 'p1' } };
  const after = { ...before, path: [['M', 0, 0], ['L', 4, 0]] };
  const r = buildPartialEraseHistoryRow({
    targets: [{ operation: 'replace', before, after, storageKey: 'p1' }, { operation: 'delete', before: { data: { id: 'gone' } } }],
    documentId: 'doc',
    user: { id: 'u', user_metadata: { full_name: 'Isaiah Calvo' } },
    mutationId: 'mut-1',
    pageNumber: 3,
    committedAt: at(0),
  });
  assert.equal(r.summary, 'Isaiah Calvo erased part of a pen stroke on page 3');
  assert.equal(r.client_event_id, 'annotation-erase:mut-1');
  assert.equal(r.annotation_id, 'p1');
  assert.equal(r.payload.actionType, 'erase');
  assert.ok(r.payload.previewBefore && r.payload.previewAnnotation);
  assert.equal(buildPartialEraseHistoryRow({ targets: [{ operation: 'delete', before }], documentId: 'doc', mutationId: 'm' }), null, 'a whole-mark erase keeps its trash row only');
});

test('History panel source (option A): gold only on the selected glyph, Restore gated, keys stay in the list', () => {
  const panel = readFileSync(new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url), 'utf8');
  const goldRules = panel.match(/var\(--accent\)[^;]*;/g) || [];
  assert.equal(goldRules.length, 1, 'gold: the selected line glyph only');
  assert.match(panel, /\.dh-row\.sel \.dh-g \{ color: var\(--accent\); \}/);
  assert.doesNotMatch(panel, /border[^;\n]*var\(--accent/, 'no gold boxes or rings');
  assert.match(panel, /isDeleted && canRestore && Boolean\(onRestoreHistoryActivity\)/);
  assert.match(panel, /role="listbox"/, 'Up / Down belong to the list (the nudge treats a listbox as a typing target)');
  const overlay = readFileSync(new URL('../src/components/revisions/historyPageOverlay.js', import.meta.url), 'utf8');
  assert.match(overlay, /#4a90e2/, 'the page highlight is the selection blue');
  assert.doesNotMatch(overlay, /infinite/, 'the highlight never pulses forever');
});

test('review round: renumbered counters are not "erased part of"; cut / place wording; small Before copies', () => {
  const counter = { type: 'counter', data: { id: 'c3', type: 'counter', displayNumber: 3 } };
  assert.equal(buildPartialEraseHistoryRow({
    targets: [{ operation: 'replace', cause: 'counter-renumber', before: counter, after: { ...counter, data: { ...counter.data, displayNumber: 2 } } }],
    documentId: 'doc', mutationId: 'm', pageNumber: 1,
  }), null);
  const placed = { pageNumber: 2, name: 'Door', bounds: { x: 1, y: 1, width: 4, height: 4 } };
  const cut = summarizeHistoryActionForLog({ type: 'survey-marker:batch', changes: [{ id: 'm1', before: placed, after: { name: 'Door', pageNumber: null, bounds: null } }] });
  assert.equal(cut.actionType, 'unplace');
  assert.equal(cut.pageNumber, 2, 'a cut names the page it came off');
  assert.equal(classifyHistoryRow(row('cut', { payload: { actionType: 'unplace', annotationType: 'surveyMarker' } })).verb, 'cut');
  const big = { type: 'rect', left: 0, top: 0, width: 5, height: 5, stroke: '#ff0000', data: { id: 'r', type: 'rect', notes: 'x'.repeat(5000) } };
  const moved = summarizeHistoryActionForLog({ type: 'fabric:update', pageNumber: 1, annotationId: 'r', before: big, after: { ...big, left: 9 } });
  assert.ok(JSON.stringify(moved.previewBefore).length < 400, 'the Before copy keeps only what the ghost needs');
  assert.equal(moved.previewBefore.stroke, '#ff0000');
});
