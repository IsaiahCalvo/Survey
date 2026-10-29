import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PULL_BEFORE_PUSH, hasRowWaitingOnChoice, pullAllowsPush } from '../excelPushGate.js';

test('a push goes ahead after a finished pull, or when the linked file is missing', () => {
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.DONE), true);
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.MISSING), true);
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.PAUSED), false);
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.FAILED), false);
  assert.equal(pullAllowsPush(undefined), false);
});

test('a row tied to a live marker that waits for a choice holds the push', () => {
  const markers = { m1: { id: 'm1' } };
  assert.equal(hasRowWaitingOnChoice([{ reason: 'conflict', markerId: 'm1' }], markers), true);
  assert.equal(hasRowWaitingOnChoice([{ reason: 'paste-above', markerId: 'm1' }], markers), true);
});

test('rows the app could not place and rows of deleted markers do not hold it', () => {
  const markers = { m1: { id: 'm1' } };
  assert.equal(hasRowWaitingOnChoice([
    { reason: 'unknown-rowid', markerId: null },
    { reason: 'malformed', markerId: null },
    { reason: 'unknown-rowid', markerId: 'gone' },
  ], markers), false);
  assert.equal(hasRowWaitingOnChoice(null, markers), false);
});
