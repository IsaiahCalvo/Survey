import test from 'node:test';
import { equal } from 'node:assert/strict';

import {
  getHistoryOrder,
  shouldRedoLocalBeforeLegacy,
  shouldUndoLocalBeforeLegacy,
} from '../src/utils/historyStacks.js';

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
