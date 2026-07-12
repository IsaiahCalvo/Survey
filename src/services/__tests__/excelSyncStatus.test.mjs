import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC_TONE,
  SYNC_STATUS,
  SYNC_TONE_COLORS,
  syncMessageTone,
  syncMessagePresentation,
  needsChoiceSuffix,
  rowIdWritebackMessage
} from '../excelSyncStatus.js';

test('every canonical status has a plain label and a known tone', () => {
  for (const status of Object.values(SYNC_STATUS)) {
    assert.ok(status.label.length > 0);
    assert.ok(Object.values(SYNC_TONE).includes(status.tone));
    // Plain English guard: no camelCase tokens in a user-facing label.
    assert.ok(!/[a-z][A-Z]/.test(status.label), `label "${status.label}" looks like camelCase`);
  }
});

test('failures read as error', () => {
  assert.equal(syncMessageTone('Sync failed'), SYNC_TONE.ERROR);
  assert.equal(syncMessageTone('Auto-sync failed'), SYNC_TONE.ERROR);
  assert.equal(syncMessageTone('Couldn’t reach Excel'), SYNC_TONE.ERROR);
});

test('attention-needed messages read as warn (not the same as info)', () => {
  assert.equal(syncMessageTone('Close Excel first'), SYNC_TONE.WARN);
  assert.equal(syncMessageTone('3 need your choice'), SYNC_TONE.WARN);
  assert.equal(syncMessageTone('Queued until safe'), SYNC_TONE.WARN);
});

test('completed states read as success', () => {
  assert.equal(syncMessageTone('Synced'), SYNC_TONE.SUCCESS);
  assert.equal(syncMessageTone('Saved'), SYNC_TONE.SUCCESS);
  assert.equal(syncMessageTone('Sync complete!'), SYNC_TONE.SUCCESS);
});

test('neutral / empty falls back to info', () => {
  assert.equal(syncMessageTone('No changes found'), SYNC_TONE.INFO);
  assert.equal(syncMessageTone(''), SYNC_TONE.INFO);
  assert.equal(syncMessageTone(undefined), SYNC_TONE.INFO);
});

test('warn and error are visually distinct from info', () => {
  const info = SYNC_TONE_COLORS[SYNC_TONE.INFO].color;
  const warn = SYNC_TONE_COLORS[SYNC_TONE.WARN].color;
  const error = SYNC_TONE_COLORS[SYNC_TONE.ERROR].color;
  const success = SYNC_TONE_COLORS[SYNC_TONE.SUCCESS].color;
  assert.equal(new Set([info, warn, error, success]).size, 4);
});

test('syncMessagePresentation returns the tone colors for a message', () => {
  assert.deepEqual(syncMessagePresentation('Sync failed'), SYNC_TONE_COLORS[SYNC_TONE.ERROR]);
  assert.deepEqual(syncMessagePresentation('Close Excel first'), SYNC_TONE_COLORS[SYNC_TONE.WARN]);
});

test('needsChoiceSuffix only appears when there is something to choose', () => {
  assert.equal(needsChoiceSuffix(0), '');
  assert.equal(needsChoiceSuffix(2), ' · 2 need your choice');
});

test('Row ID writeback banner strings color honestly through syncMessageTone', () => {
  // Full success reads green; anything still queued or needing the user reads amber.
  assert.equal(syncMessageTone(rowIdWritebackMessage({ status: 'completed', verified: 2, remaining: 0 })), SYNC_TONE.SUCCESS);
  assert.equal(syncMessageTone(rowIdWritebackMessage({ status: 'completed', verified: 2, remaining: 3 })), SYNC_TONE.WARN);
  assert.equal(syncMessageTone(rowIdWritebackMessage({ status: 'stopped-verify-mismatch' })), SYNC_TONE.WARN);
  assert.equal(syncMessageTone(rowIdWritebackMessage({ status: 'stopped-locked' })), SYNC_TONE.WARN);
  assert.equal(syncMessageTone(rowIdWritebackMessage({ status: 'auth-expired' })), SYNC_TONE.WARN);
  // Plain English guard, mirroring the canonical-status test.
  for (const status of ['completed', 'stopped-verify-mismatch', 'stopped-locked', 'auth-expired', 'session-unavailable']) {
    const msg = rowIdWritebackMessage({ status, verified: 1, remaining: 1 });
    if (msg) assert.ok(!/[a-z][A-Z]/.test(msg), `label "${msg}" looks like camelCase`);
  }
});


test('rowIdWritebackMessage covers local flush refusal codes', () => {
  assert.match(rowIdWritebackMessage({ status: 'excel-open', remaining: 2 }), /Close Excel/);
  assert.match(rowIdWritebackMessage({ status: 'unsafe-unknown', remaining: 1 }), /Not sure Excel is closed/);
  assert.match(rowIdWritebackMessage({ status: 'workbook-drifted', remaining: 3 }), /changed outside the app/);
  assert.match(rowIdWritebackMessage({ status: 'drifted-during-flush', remaining: 1 }), /changed outside the app/);
});
