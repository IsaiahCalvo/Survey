// w56 — defects found in the live two-user test (2026-09-28, bot-5 owner +
// bot-6 editor on a disposable document):
//   1. a dropped counter had no author stamp, so its own creator could not
//      Lock it (only the document owner could);
//   2. right-clicking a mark that is part of a multi-selection opened that one
//      mark's menu — Lock / Delete acted on one mark while all showed selected;
//   3. History called a restyle of a pen stroke / shape "edited text".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { groupMenuForSelectedMember } from '../src/utils/contextMenuDiagnostics.js';
import { stampAnnotationCreationIdentity } from '../src/utils/annotationStorageIdentity.js';
import { canToggleLock } from '../src/lib/collab/permissionScope.js';
import { summarizeHistoryActionForLog } from '../src/viewerShared.js';
import { buildHistoryEventRowFromDebugEvent } from '../src/services/documentHistoryService.js';

const box = (attrs) => ({ getAttribute: (name) => (name in attrs ? attrs[name] : null) });

test('defect 2: right-click on a selected member opens the selection (group) menu', () => {
  const frame = box({
    'data-group-selection-indices': '0,1,2,4',
    'data-group-selection-callout-ids': 'callout-a',
  });
  assert.deepEqual(
    groupMenuForSelectedMember({ kind: 'annotation', annotationIndex: 2, calloutId: null }, frame),
    { groupIndices: [0, 1, 2, 4], groupMarkerIds: [] },
  );
  assert.deepEqual(
    groupMenuForSelectedMember({ kind: 'counter', annotationIndex: 0, calloutId: null }, frame)?.groupIndices,
    [0, 1, 2, 4],
  );
  assert.ok(groupMenuForSelectedMember({ kind: 'callout', annotationIndex: null, calloutId: 'callout-a' }, frame));
});

test('defect 2: a mark outside the selection keeps its own menu', () => {
  const frame = box({ 'data-group-selection-indices': '0,1' });
  assert.equal(groupMenuForSelectedMember({ kind: 'annotation', annotationIndex: 3 }, frame), null);
  assert.equal(groupMenuForSelectedMember({ kind: 'callout', calloutId: 'callout-z' }, frame), null);
  assert.equal(groupMenuForSelectedMember({ kind: 'page', annotationIndex: null }, frame), null);
  assert.equal(groupMenuForSelectedMember({ kind: 'annotation', annotationIndex: 0 }, null), null, 'no selection frame');
});

test('defect 2: a one-member frame is not a group; Survey Markers and callouts count as members', () => {
  assert.deepEqual(
    groupMenuForSelectedMember(
      { kind: 'annotation', annotationIndex: 0 },
      box({ 'data-group-selection-indices': '0', 'data-group-selection-callout-ids': 'callout-a' }),
    ),
    { groupIndices: [0], groupMarkerIds: [] },
    'one mark + one callout is a group',
  );
  assert.ok(groupMenuForSelectedMember(
    { kind: 'callout', calloutId: 'callout-b' },
    box({ 'data-group-selection-indices': '', 'data-group-selection-callout-ids': 'callout-a,callout-b' }),
  ), 'two callouts are a group');
  const hook = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(hook, /\+ \(selectedCalloutIds && typeof selectedCalloutIds\.size === 'number' \? selectedCalloutIds\.size : 0\)\) >= 2/,
    'the group menu accepts a selection whose members include callouts');
  assert.equal(
    groupMenuForSelectedMember({ kind: 'annotation', annotationIndex: 0 }, box({ 'data-group-selection-indices': '0' })),
    null,
  );
  assert.deepEqual(
    groupMenuForSelectedMember(
      { kind: 'annotation', annotationIndex: 0 },
      box({ 'data-group-selection-indices': '0', 'data-group-selection-marker-ids': 'surveyMarker-1' }),
    ),
    { groupIndices: [0], groupMarkerIds: ['surveyMarker-1'] },
  );
});

test('defect 2: the dispatcher promotes the hit before calling the menu', () => {
  const source = readFileSync(new URL('../src/utils/contextMenuDiagnostics.js', import.meta.url), 'utf8');
  assert.match(source, /const promoted = groupMenuForSelectedMember\(\{ kind, annotationIndex, calloutId \}, groupBox\);/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /data-group-selection-callout-ids=\{/);
});

test('defect 1: a dropped counter carries its creator, who may then lock it', () => {
  const counter = {
    type: 'circle', left: 10, top: 10, radius: 14,
    data: { type: 'counter', id: 'c-1', displayNumber: 1, seriesId: 's1' },
  };
  const stamped = stampAnnotationCreationIdentity(counter, { authorId: 'editor-1' });
  assert.equal(stamped.meta?.authorId, 'editor-1');
  assert.equal(canToggleLock({ annotation: stamped, viewerId: 'editor-1', documentOwnerId: 'owner-1' }), true);
  assert.equal(canToggleLock({ annotation: counter, viewerId: 'editor-1', documentOwnerId: 'owner-1' }), false,
    'unstamped counter: owner only (the bug)');
  const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const commit = source.slice(source.indexOf('const commitCounterDrag = useCallback('));
  assert.match(commit.slice(0, 2500), /stampAnnotationCreationIdentity\(drag\.counter, \{ authorId: user\?\.id \?\? null \}\)/);
});

test('defect 3: a restyle is not "edited text"; a text box edit still is', () => {
  const pen = { type: 'path', fill: '#ff0000', left: 0, top: 0, data: { id: 'p1', tool: 'pen' } };
  const restyle = summarizeHistoryActionForLog({
    type: 'fabric:update', pageNumber: 1, annotationId: 'p1', before: pen, after: { ...pen, fill: '#0000ff' },
  });
  assert.equal(restyle.actionType, 'restyle');
  const row = buildHistoryEventRowFromDebugEvent(
    { type: 'local_annotation_history_added', pageNumber: 1, annotationId: 'p1', ...restyle },
    { documentId: 'd1', user: { id: 'u1', email: 'bot@example.test' } },
  );
  assert.doesNotMatch(row.summary, /edited text/);
  assert.match(row.summary, /edited a pen stroke on page 1/);

  // fabric 7 serializes the text box type capitalized.
  const box1 = { type: 'Textbox', text: 'Hello', left: 0, top: 0, data: { id: 't1' } };
  const textEdit = summarizeHistoryActionForLog({
    type: 'fabric:update', pageNumber: 1, annotationId: 't1', before: box1, after: { ...box1, text: 'Hello box' },
  });
  assert.equal(textEdit.actionType, 'text edit');
  const textRestyle = summarizeHistoryActionForLog({
    type: 'fabric:update', pageNumber: 1, annotationId: 't1', before: box1, after: { ...box1, fill: '#0000ff' },
  });
  assert.equal(textRestyle.actionType, 'text edit');
});

test('defect 3b: Lock / Unlock read "locked" / "unlocked" in History; text boxes say "text box"', () => {
  const who = { id: 'u1', email: 'bot@example.test' };
  const toRow = (summary) => buildHistoryEventRowFromDebugEvent(
    { type: 'local_annotation_history_added', pageNumber: 1, ...summary },
    { documentId: 'd1', user: who },
  ).summary;
  const rectA = { type: 'Rect', left: 5, top: 5, width: 10, height: 10, data: { id: 'r1' } };
  const lockedRect = { ...rectA, data: { ...rectA.data, lockedBy: 'u1' } };
  const one = summarizeHistoryActionForLog({ type: 'fabric:update', pageNumber: 1, annotationId: 'r1', before: rectA, after: lockedRect });
  assert.equal(one.actionType, 'lock');
  assert.equal(toRow(one), 'bot@example.test locked a rectangle on page 1');
  const back = summarizeHistoryActionForLog({ type: 'fabric:update', pageNumber: 1, annotationId: 'r1', before: lockedRect, after: rectA });
  assert.equal(toRow(back), 'bot@example.test unlocked a rectangle on page 1');

  const text = { type: 'Textbox', text: 'Hi', left: 0, top: 0, data: { id: 't1' } };
  const batch = summarizeHistoryActionForLog({
    type: 'fabric:batch', pageNumber: 1, created: [], deleted: [],
    updated: [
      { id: 'r1', before: rectA, after: lockedRect },
      { id: 't1', before: text, after: { ...text, data: { ...text.data, lockedBy: 'u1' } } },
    ],
  });
  assert.equal(batch.actionType, 'lock');
  assert.equal(toRow(batch), 'bot@example.test locked 2 annotations on page 1');

  // A lock in the same save as a move is still a move (the lock guard refuses
  // that on a locked mark anyway; here it is an unlocked mark gaining a lock).
  const movedAndLocked = summarizeHistoryActionForLog({
    type: 'fabric:update', pageNumber: 1, annotationId: 'r1', before: rectA, after: { ...lockedRect, left: 50 },
  });
  assert.equal(movedAndLocked.actionType, 'move');

  const created = summarizeHistoryActionForLog({ type: 'fabric:create', pageNumber: 1, annotationId: 't1', annotation: text });
  assert.equal(toRow(created), 'bot@example.test created a text box on page 1');
});

test('review fix: a single-mark paste is the paster\'s own unlocked mark', async () => {
  const { makePastedMarkOwn } = await import('../src/utils/familyClipboard.js');
  const source = {
    type: 'Rect', left: 1, top: 1,
    meta: { authorId: 'owner-1' },
    data: { id: 'new-id', lockedBy: 'owner-1', authorId: 'owner-1' },
  };
  const pasted = makePastedMarkOwn(JSON.parse(JSON.stringify(source)), 'editor-1');
  assert.equal(pasted.meta.authorId, 'editor-1');
  assert.equal(pasted.data.authorId, 'editor-1');
  assert.equal(pasted.data.lockedBy, undefined);
  assert.equal(canToggleLock({ annotation: pasted, viewerId: 'editor-1', documentOwnerId: 'owner-1' }), true);
  const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const paste = viewerSource.slice(viewerSource.indexOf('const pasteAnnotationAt = useCallback('));
  const body = paste.slice(0, paste.indexOf('\n  }, ['));
  assert.equal((body.match(/makePastedMarkOwn\((c|pasted), user\?\.id \|\| null\)/g) || []).length, 2,
    'both single-mark paste branches (multi-clone and single) make the paste the paster\'s own');
});

test('review fix: the group menu Delete also deletes the selected callouts (one batch)', () => {
  const hook = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  const groupDelete = hook.slice(hook.lastIndexOf("item('Delete', 'delete', () => {"));
  const body = groupDelete.slice(0, groupDelete.indexOf('}, groupHasEditable),'));
  assert.match(body, /window\.__onDeleteSelectedCallouts\(selectedCalloutIdList\)/);
  assert.match(body, /beginBatchDelete\(2, selectedCalloutIdList\)/);
  assert.ok(body.indexOf('beginBatchDelete(2') < body.indexOf('requestBulkDelete({'),
    'the mixed batch is armed before the planner runs, as the keyboard Delete does');
  const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewerSource, /beginBatchDelete: handleBeginBatchDelete,/);
});
