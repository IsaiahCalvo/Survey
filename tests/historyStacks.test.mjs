import test from 'node:test';
import { equal } from 'node:assert/strict';

import {
  getHistoryOrder,
  shouldRedoLocalBeforeLegacy,
  shouldUndoLocalBeforeLegacy,
} from '../src/utils/historyStacks.js';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';

test('undo chooses the newest action across local and legacy history', () => {
  const local = { __historyMeta: { checkpointId: 4 } };
  const legacy = { checkpointId: 3 };

  equal(shouldUndoLocalBeforeLegacy(local, legacy), true);
});

test('undo keeps legacy first when legacy is newer than local history', () => {
  const local = { __historyMeta: { checkpointId: 2 } };
  const legacy = { checkpointId: 5 };

  equal(shouldUndoLocalBeforeLegacy(local, legacy), false);
});

test('redo chooses the oldest undone action across local and legacy history', () => {
  const local = { __historyMeta: { checkpointId: 7 } };
  const legacy = { checkpointId: 4 };

  equal(shouldRedoLocalBeforeLegacy(local, legacy), false);
});

test('history order falls back to timestamps when checkpoint id is missing', () => {
  equal(getHistoryOrder({ createdAt: '2026-05-08T22:00:00.000Z' }), 1778277600000);
});

test('atomic eraser checkpoints stay eligible for the legacy undo/redo lane', () => {
  equal(isLegacyAnnotationHistoryMeta({ reason: 'eraser:gesture' }), true);
});

test('survey marker move checkpoints stay eligible for the legacy undo/redo lane', () => {
  equal(isLegacyAnnotationHistoryMeta({ reason: 'survey-marker:move' }), true);
});

test('space checkpoints stay eligible for the legacy undo/redo lane', () => {
  equal(isLegacyAnnotationHistoryMeta({ reason: 'space:delete' }), true);
});

test('undoing an answer puts back the answers but keeps the Complete it set', async () => {
  const { scopeLegacyRestoreToOwnSlices } = await import('../src/utils/historyStacks.js');
  const { deepEqual } = await import('node:assert/strict');
  const meta = { reason: 'survey-marker:answer', context: { annotationId: 'm1' } };
  const before = {
    surveyMarkers: { m1: { name: 'Door 1', entityId: 'open' }, m2: { name: 'Door 2' } },
    pendingSurveyMarkerUi: { newSurveyMarkersByPage: { 1: [{ annotationId: 'm1', color: 'grey' }] } },
  };
  const now = {
    surveyMarkers: {
      m1: { name: 'Door 1', entityId: 'done', checklistResponses: { c1: { selection: 'Y' } } },
      m2: { name: 'Door 2 renamed' },
    },
    pendingSurveyMarkerUi: { newSurveyMarkersByPage: { 1: [{ annotationId: 'm1', color: 'green' }] } },
  };
  const undone = scopeLegacyRestoreToOwnSlices(meta, now, before, { direction: 'undo' });
  deepEqual(undone.surveyMarkers, { m1: { name: 'Door 1', entityId: 'done' }, m2: { name: 'Door 2 renamed' } });
  deepEqual(undone.pendingSurveyMarkerUi, now.pendingSurveyMarkerUi);
  const redone = scopeLegacyRestoreToOwnSlices(meta, undone, now, { direction: 'redo' });
  deepEqual(redone.surveyMarkers.m1, now.surveyMarkers.m1);
});
