import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reviewReasonMessage,
  REVIEW_REASON_MESSAGES,
  DEFAULT_REVIEW_MESSAGE,
} from '../src/services/excelReviewMessages.js';

test('reviewReasonMessage returns known plain-English tooltips', () => {
  assert.equal(
    reviewReasonMessage('duplicate-rowid'),
    REVIEW_REASON_MESSAGES['duplicate-rowid'],
  );
  assert.equal(reviewReasonMessage('conflict'), REVIEW_REASON_MESSAGES.conflict);
  assert.equal(reviewReasonMessage('candidate-delete'), REVIEW_REASON_MESSAGES['candidate-delete']);
});

test('reviewReasonMessage falls back for unknown reasons', () => {
  assert.equal(reviewReasonMessage('not-a-reason'), DEFAULT_REVIEW_MESSAGE);
  assert.equal(reviewReasonMessage(null), DEFAULT_REVIEW_MESSAGE);
});
