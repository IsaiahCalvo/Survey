import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reviewReasonMessage, DEFAULT_REVIEW_MESSAGE, REVIEW_REASON_MESSAGES } from '../excelReviewMessages.js';

test('every known reason maps to a non-empty plain sentence', () => {
  for (const [reason, msg] of Object.entries(REVIEW_REASON_MESSAGES)) {
    assert.equal(reviewReasonMessage(reason), msg);
    assert.ok(msg.length > 0);
    // Plain English guard: no obvious codenames / camelCase tokens leak into the tooltip.
    assert.ok(!/[a-z][A-Z]/.test(msg), `message for "${reason}" looks like it contains camelCase`);
  }
});

test('candidate-delete explains the item is gone from the sheet', () => {
  assert.match(reviewReasonMessage('candidate-delete'), /no longer in the linked Excel sheet/i);
});

test('duplicate reasons ask the user to pick the original', () => {
  assert.match(reviewReasonMessage('duplicate-rowid'), /which one is the original/i);
  assert.match(reviewReasonMessage('duplicate'), /which one is the original/i);
});

test('unknown reason falls back to the generic review sentence', () => {
  assert.equal(reviewReasonMessage('something-new'), DEFAULT_REVIEW_MESSAGE);
  assert.equal(reviewReasonMessage(undefined), DEFAULT_REVIEW_MESSAGE);
  assert.equal(reviewReasonMessage(null), DEFAULT_REVIEW_MESSAGE);
});
