// Stage 2 MVP — deleted Survey Markers are restorable from the History panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSurveyMarkerRestoreAction,
  buildSurveyMarkerDeleteHistoryRow,
  isSurveyMarkerRestoreAction,
  applySurveyMarkerRestore,
  isProtectedFromExcelDelete,
} from '../src/services/surveyMarkerHistory.js';

const marker = {
  id: 'sm1',
  name: 'Exit Sign',
  categoryId: 'c1',
  moduleId: 'm1',
  checklistResponses: { c1: { selection: 'Y' } },
  entityId: 'e1',
  entityName: 'Acme',
  entityColor: '#ff0000',
  note: { text: 'check annually' },
  pageNumber: 4,
  bounds: { x: 10, y: 20, width: 40, height: 40 },
  excelRowIndex: 7,
  exportedAt: '2026-06-01T00:00:00.000Z',
};

test('delete history row carries a restore payload with the full marker', () => {
  const row = buildSurveyMarkerDeleteHistoryRow({
    markerId: 'sm1',
    marker,
    documentId: 'doc1',
    userId: 'u1',
    actorName: 'Isaiah',
    deletedAt: '2026-06-08T00:00:00.000Z',
  });
  // Panel marks it deleted (summary contains "deleted") and shows Restore
  // (payload.restoreAction present).
  assert.match(row.summary, /deleted/i);
  assert.match(row.summary, /Exit Sign/);
  assert.equal(row.event_type, 'survey_marker_deleted');
  assert.equal(row.page_number, 4);
  assert.ok(row.payload.restoreAction, 'restoreAction present');
  assert.equal(row.payload.restoreAction.type, 'surveyMarker');
  assert.deepEqual(row.payload.restoreAction.surveyMarker, marker);
});

test('import-origin delete row notes it came via Excel and is still restorable', () => {
  const row = buildSurveyMarkerDeleteHistoryRow({
    markerId: 'sm1',
    marker,
    documentId: 'doc1',
    origin: 'excel-import',
    deletedAt: '2026-06-08T00:00:00.000Z',
  });
  assert.match(row.summary, /deleted/i);
  assert.match(row.summary, /Excel/i);
  assert.ok(isSurveyMarkerRestoreAction(row.payload.restoreAction));
});

test('restoring rebuilds the full marker (panel row data + PDF location)', () => {
  const action = buildSurveyMarkerRestoreAction('sm1', marker);
  const result = applySurveyMarkerRestore({}, action, { restoredAt: '2026-06-08T01:00:00.000Z' });
  assert.ok(result);
  const restored = result.surveyMarkers.sm1;
  // panel row data
  assert.equal(restored.name, 'Exit Sign');
  assert.deepEqual(restored.checklistResponses, { c1: { selection: 'Y' } });
  assert.equal(restored.entityName, 'Acme');
  assert.deepEqual(restored.note, { text: 'check annually' });
  // PDF location
  assert.equal(restored.pageNumber, 4);
  assert.deepEqual(restored.bounds, { x: 10, y: 20, width: 40, height: 40 });
});

test('restored marker is pending-sync and protected from immediate Excel re-delete', () => {
  const action = buildSurveyMarkerRestoreAction('sm1', marker);
  const { surveyMarkers } = applySurveyMarkerRestore({}, action, { restoredAt: '2026-06-08T01:00:00.000Z' });
  const restored = surveyMarkers.sm1;
  // export ack cleared → treated as never-received → protected
  assert.equal('exportedAt' in restored, false);
  assert.equal('exportAckEtag' in restored, false);
  assert.equal(isProtectedFromExcelDelete(restored), true);
  assert.equal(restored.restoredAt, '2026-06-08T01:00:00.000Z');
});

test('restore is a no-op for non-surveyMarker actions', () => {
  assert.equal(applySurveyMarkerRestore({}, { type: 'fabric:delete' }), null);
  assert.equal(isSurveyMarkerRestoreAction({ type: 'surveyMarker' }), false); // missing fields
});
