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

test('excel auto-sync checkpoints stay eligible for the legacy undo/redo lane', () => {
  equal(isLegacyAnnotationHistoryMeta({ reason: 'excel:auto-sync' }), true);
});

test('excel prefix covers manual sync; unrelated reasons stay ineligible', () => {
  equal(isLegacyAnnotationHistoryMeta({ reason: 'excel:manual-sync' }), true);
  equal(isLegacyAnnotationHistoryMeta({ reason: 'zoom:fit' }), false);
  equal(isLegacyAnnotationHistoryMeta({ reason: '' }), false);
  equal(isLegacyAnnotationHistoryMeta({}), false);
});
