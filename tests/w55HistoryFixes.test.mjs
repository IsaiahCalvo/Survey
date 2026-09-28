// w55 — History + undo fixes (phase 2a). Pure-function guards for the
// defects found in the 2026-09-28 audit (docs/HISTORY-REDESIGN-PROPOSAL.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyAnnotationHistoryAction,
  dropAlreadyPresentRestoreTargets,
} from '../src/utils/annotationLocalHistory.js';
import { applySurveyMarkerRestore, buildSurveyMarkerRestoreAction } from '../src/services/surveyMarkerHistory.js';
import {
  buildHistoryEventRowFromDebugEvent,
  capLocalHistoryStore,
  isTrashHistoryEvent,
  TRASH_HISTORY_EVENT_TYPES,
} from '../src/services/documentHistoryService.js';
import { isSurveyScopedHistoryEvent } from '../src/utils/historyContextRestore.js';
import { summarizeHistoryActionForLog } from '../src/viewerShared.js';

const user = { id: 'u1', email: 'i@example.com', user_metadata: { full_name: 'Isaiah Calvo' } };
const rect = (id, left) => ({ type: 'rect', id, left, top: 10, width: 50, height: 40, data: { annotationId: id } });

test('defect 1: Restore never overwrites a mark that is already back', () => {
  const deleteTime = rect('r1', 10);
  const restoreAction = { type: 'fabric:create', pageNumber: 1, annotationId: 'r1', annotation: deleteTime };
  const edited = { 1: { objects: [rect('r1', 300)] } };
  assert.equal(dropAlreadyPresentRestoreTargets(edited, restoreAction), null, 'present -> nothing to restore');
  const gone = { 1: { objects: [] } };
  assert.equal(dropAlreadyPresentRestoreTargets(gone, restoreAction), restoreAction, 'missing -> restore as is');
  const applied = applyAnnotationHistoryAction(gone, restoreAction);
  assert.equal(applied[1].objects.length, 1);
});

test('defect 1: batch restore keeps only the marks that are missing', () => {
  const action = {
    type: 'fabric:batch',
    pageNumber: 1,
    created: [
      { id: 'a', annotation: rect('a', 1) },
      { id: 'b', annotation: rect('b', 2) },
    ],
  };
  const page = { 1: { objects: [rect('a', 99)] } };
  const trimmed = dropAlreadyPresentRestoreTargets(page, action);
  assert.deepEqual(trimmed.created.map((entry) => entry.id), ['b']);
  assert.equal(dropAlreadyPresentRestoreTargets({ 1: { objects: [rect('a', 1), rect('b', 2)] } }, action), null);
});

test('defect 2: Survey Marker restore leaves a live marker exactly as it is', () => {
  const marker = { name: 'Door 104', pageNumber: 2, answers: { a: 'old' }, exportedAt: '2026-09-01' };
  const action = buildSurveyMarkerRestoreAction('m1', marker);
  const live = { m1: { ...marker, answers: { a: 'new' }, exportedAt: '2026-09-20' } };
  const result = applySurveyMarkerRestore(live, action, { restoredAt: 'now' });
  assert.equal(result.alreadyPresent, true);
  assert.equal(result.surveyMarkers, live, 'no new map, nothing changed');
  const back = applySurveyMarkerRestore({}, action, { restoredAt: 'now' });
  assert.equal(back.alreadyPresent, undefined);
  assert.equal(back.marker.exportedAt, undefined, 'a real restore still clears the Excel stamp');
});

test('defect 4: only trash rows count as deleted items (never undo/redo rows)', () => {
  for (const type of TRASH_HISTORY_EVENT_TYPES) assert.equal(isTrashHistoryEvent({ event_type: type }), true);
  assert.equal(isTrashHistoryEvent({
    event_type: 'local_annotation_undo_applied',
    summary: 'Isaiah undid an edit',
    payload: { rawActionType: 'fabric:delete', restoreAction: { type: 'fabric:create' } },
  }), false);
  assert.ok(TRASH_HISTORY_EVENT_TYPES.includes('survey_marker_deleted'));
});

test('defect 5: the proposed SQL protects Survey Marker trash rows everywhere', () => {
  const prune = readFileSync(new URL('../supabase/proposed/20260925_w36_prune_annotation_wal_and_history.sql', import.meta.url), 'utf8');
  const keepStart = prune.indexOf('ranked.event_type NOT IN');
  const keepList = prune.slice(keepStart, prune.indexOf('LIMIT p_max_rows', keepStart));
  assert.match(keepList, /'survey_marker_deleted'/);
  const fix = readFileSync(new URL('../supabase/proposed/20260928_w55_protect_survey_marker_trash_rows.sql', import.meta.url), 'utf8');
  assert.equal((fix.match(/'survey_marker_deleted'/g) || []).length >= 4, true, 'trigger, sweep, index, prune');
});

test('defect 11: the device copy of History is capped', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const rows = (doc, n, ageDays = 0) => Array.from({ length: n }, (_, i) => ({
    document_id: doc,
    client_event_id: `${doc}-${i}`,
    occurred_at: new Date(now - ageDays * 864e5 - i * 1000).toISOString(),
  }));
  const store = { a: rows('a', 250), old: rows('old', 5, 90) };
  for (let d = 0; d < 14; d += 1) store[`d${d}`] = rows(`d${d}`, 3, d + 1);
  const capped = capLocalHistoryStore(store, { now });
  assert.equal(capped.a.length, 100, 'at most 100 rows per document');
  assert.equal(capped.old, undefined, 'nothing older than 60 days');
  assert.equal(Object.keys(capped).length, 10, 'at most 10 documents');
});

test('defect 17: wording — articles, ellipse, resize, restore', () => {
  const row = (extra) => buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added', checkpointId: 1, pageNumber: 1, itemCount: 1, ...extra,
  }, { documentId: 'doc', user }).summary;
  assert.equal(row({ actionType: 'create', annotationType: 'ellipse' }), 'Isaiah Calvo created an ellipse on page 1');
  assert.equal(row({ actionType: 'create', annotationType: 'arrow' }), 'Isaiah Calvo created an arrow on page 1');
  assert.equal(row({ actionType: 'create', annotationType: 'rect' }), 'Isaiah Calvo created a rectangle on page 1');
  assert.equal(row({ actionType: 'create', annotationType: 'ellipse', restoredFromHistory: true }), 'Isaiah Calvo restored an ellipse on page 1');
  const before = { type: 'ellipse', left: 10, top: 10, width: 100, height: 60, scaleX: 1, scaleY: 1, angle: 0 };
  const after = { ...before, left: 40, width: 70 }; // left-handle drag: shifts AND resizes
  const summary = summarizeHistoryActionForLog({ type: 'fabric:update', pageNumber: 1, annotationId: 'e', before, after });
  assert.equal(summary.actionType, 'resize');
});

test('defect 13: only survey-scoped rows move the reader into survey context', () => {
  assert.equal(isSurveyScopedHistoryEvent({
    event_type: 'local_annotation_history_added',
    payload: { annotationType: 'rect', uiContext: { surveyPanelOpen: false, spaceId: null } },
  }), false, 'an ordinary mark never changes the reader\'s panel or space');
  assert.equal(isSurveyScopedHistoryEvent({ event_type: 'survey_marker_deleted', payload: {} }), true);
  assert.equal(isSurveyScopedHistoryEvent({ event_type: 'x', payload: { previewAnnotation: { moduleId: 'mod-1' } } }), true);
  assert.equal(isSurveyScopedHistoryEvent({ event_type: 'region_deleted', payload: {} }), true);
});

test('History panel source guards (defects 3, 10, 14, 15, 16, 18)', () => {
  const panel = readFileSync(new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /const NAMED_VERSIONS_ENABLED = false;/, 'named versions hidden until rebuilt');
  const lastHook = panel.lastIndexOf('useMemo(');
  assert.ok(panel.indexOf('if (!documentId) return null;') > lastHook, 'early return below every hook');
  assert.doesNotMatch(panel, /infinite/, 'highlight never pulses forever');
  assert.doesNotMatch(panel, /'stroke', 'var\(--accent\)'/, 'no gold highlight');
  assert.doesNotMatch(panel, /solid var\(--accent\)'/, 'no gold selected box');
  assert.match(panel, /canRestore && Boolean\(onRestoreHistoryActivity\)/, 'Restore only for people who can edit');
  assert.match(panel, /clickSeq !== activityClickSeqRef\.current/, 'stale retries stop');
});
