import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasPendingDeleteMark,
  triageCandidateDelete,
  markPendingDelete,
  clearPendingDeleteMark,
} from '../src/services/excelDeleteGrace.js';

test('hasPendingDeleteMark detects either grace field', () => {
  assert.equal(hasPendingDeleteMark(null), false);
  assert.equal(hasPendingDeleteMark({}), false);
  assert.equal(hasPendingDeleteMark({ pendingDeleteSince: 1 }), true);
  assert.equal(hasPendingDeleteMark({ pendingDeleteSeq: 2 }), true);
});

test('triageCandidateDelete defers first miss and same-ingest marks', () => {
  assert.equal(triageCandidateDelete(null), 'defer');
  assert.equal(triageCandidateDelete({ pendingDeleteSeq: 5 }, { ingestSeq: 5 }), 'defer');
  assert.equal(triageCandidateDelete({ pendingDeleteSince: 1 }, { ingestSeq: 9 }), 'trash');
  assert.equal(triageCandidateDelete({ pendingDeleteSeq: 3 }, { ingestSeq: 4 }), 'trash');
});

test('markPendingDelete stamps once and preserves existing marks', () => {
  const stamped = markPendingDelete({ rowId: 'r1' }, { ingestSeq: 7, now: 123 });
  assert.equal(stamped.pendingDeleteSince, 123);
  assert.equal(stamped.pendingDeleteSeq, 7);
  assert.equal(stamped.rowId, 'r1');
  assert.equal(markPendingDelete(stamped, { ingestSeq: 99 }), stamped);

  const noSeq = markPendingDelete({}, { ingestSeq: 'bad', now: 1 });
  assert.equal(noSeq.pendingDeleteSince, 1);
  assert.equal(noSeq.pendingDeleteSeq, undefined);

  const fromNull = markPendingDelete(null, { now: 5 });
  assert.equal(fromNull.pendingDeleteSince, 5);
});

test('clearPendingDeleteMark removes grace fields or returns same ref', () => {
  const unmarked = { a: 1 };
  assert.equal(clearPendingDeleteMark(unmarked), unmarked);
  assert.equal(clearPendingDeleteMark(null), null);
  assert.deepEqual(
    clearPendingDeleteMark({ a: 1, pendingDeleteSince: 9, pendingDeleteSeq: 2 }),
    { a: 1 },
  );
});
