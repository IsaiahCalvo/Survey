import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectUnplacedRows,
  unplacedReasonMessage,
  unplacedRowKey,
  isWholeChangeSetHeld,
  BATCH_HOLD_NOTICE,
  BATCH_HOLD_TITLE,
  UNPLACED_ONLY_REASON_MESSAGES,
} from '../excelUnplacedRows.js';
import { DEFAULT_REVIEW_MESSAGE } from '../excelReviewMessages.js';

// --- the regression this whole surface exists for -------------------------------------

test('null-marker review entries reach the surface instead of being dropped', () => {
  const { rows } = selectUnplacedRows([
    { reason: 'ambiguous-identity', markerId: null, sheetName: 'Doors', sheetRowNumber: 14, itemName: 'D-114' },
    { reason: 'conflict', markerId: 'marker-1' }, // has a Survey Marker → belongs to the row icon
    { reason: 'unknown-rowid', markerId: null, sheetName: 'Doors', sheetRowNumber: 21, itemName: 'D-121' },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.itemName), ['D-114', 'D-121']);
  assert.deepEqual(rows.map((r) => r.rowNumber), [14, 21]);
  assert.deepEqual(rows.map((r) => r.sheetName), ['Doors', 'Doors']);
});

test('every unplaced row carries a plain-English reason', () => {
  const { rows } = selectUnplacedRows([
    { reason: 'ambiguous-identity', markerId: null },
    { reason: 'foreign', markerId: null },
    { reason: 'something-the-server-invented', markerId: null },
  ]);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(row.message && row.message.length > 0);
    // Plain English guard: no reason code / camelCase token leaks into the copy.
    assert.ok(!/[a-z][A-Z]/.test(row.message), `"${row.message}" looks like it contains camelCase`);
    assert.ok(!row.message.includes('-'), `"${row.message}" looks like it contains a reason code`);
  }
  assert.equal(rows[2].message, DEFAULT_REVIEW_MESSAGE);
});

test('unplaced-only reasons never say "marker" instead of "Survey Marker"', () => {
  for (const message of Object.values(UNPLACED_ONLY_REASON_MESSAGES)) {
    assert.ok(!/\bmarkers?\b/.test(message), `"${message}" says "marker" instead of "Survey Marker"`);
  }
});

// --- collapses to nothing --------------------------------------------------------------

test('no unplaced rows means no surface at all', () => {
  for (const input of [[], null, undefined, [{ reason: 'conflict', markerId: 'm1' }]]) {
    const result = selectUnplacedRows(input);
    assert.equal(result.rows.length, 0);
    assert.equal(result.batchNotice, null);
    assert.equal(result.batchTitle, null);
  }
});

test('a batch hold with no unplaced rows still renders nothing', () => {
  const result = selectUnplacedRows([{ reason: 'review', markerId: 'm1' }], { batchHeld: true });
  assert.equal(result.rows.length, 0);
  assert.equal(result.batchNotice, null);
});

// --- whole-batch rejection is explained once -------------------------------------------

test('a whole-batch hold explains itself once and not on every row', () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({
    reason: 'review', markerId: null, sheetName: 'Doors', sheetRowNumber: i + 3, itemName: `D-${i}`,
  }));
  const result = selectUnplacedRows(entries, { batchHeld: true });
  assert.equal(result.rows.length, 8);
  assert.equal(result.batchNotice, BATCH_HOLD_NOTICE);
  assert.equal(result.batchTitle, BATCH_HOLD_TITLE);
  // The reason is NOT repeated on each row.
  assert.ok(result.rows.every((r) => r.message === null));
  // …but each row is still recognisable.
  assert.ok(result.rows.every((r) => r.itemName && r.rowNumber));
});

test('without a batch hold every row keeps its own reason', () => {
  const result = selectUnplacedRows([{ reason: 'review', markerId: null }], { batchHeld: false });
  assert.equal(result.batchNotice, null);
  assert.ok(result.rows[0].message.length > 0);
});

// --- detecting the whole-change-set rejection -------------------------------------------

test('every row held with nothing written is a whole-change-set hold', () => {
  assert.equal(isWholeChangeSetHeld({
    outcomes: [{ outcome: 'review' }, { outcome: 'review' }, { outcome: 'review' }],
    writebackJobs: [],
  }), true);
});

test('a partial hold is not a whole-change-set hold', () => {
  assert.equal(isWholeChangeSetHeld({
    outcomes: [{ outcome: 'review' }, { outcome: 'applied' }],
    writebackJobs: [],
  }), false);
  // Rows were written, so the server judged them individually.
  assert.equal(isWholeChangeSetHeld({
    outcomes: [{ outcome: 'review' }, { outcome: 'review' }],
    writebackJobs: [{ markerAnnotationId: 'm1' }],
  }), false);
  // A single held row is not a batch.
  assert.equal(isWholeChangeSetHeld({ outcomes: [{ outcome: 'review' }], writebackJobs: [] }), false);
  assert.equal(isWholeChangeSetHeld({}), false);
  assert.equal(isWholeChangeSetHeld(null), false);
});

// --- keys / fallbacks --------------------------------------------------------------------

test('rows get stable, distinct keys', () => {
  const entries = [
    { reason: 'review', markerId: null, opUuid: 'op-a' },
    { reason: 'review', markerId: null, scopeKey: 'm:c', sheetRowNumber: 4 },
    { reason: 'review', markerId: null, scopeKey: 'm:c', sheetRowNumber: 5 },
  ];
  const keys = selectUnplacedRows(entries).rows.map((r) => r.key);
  assert.equal(new Set(keys).size, 3);
  assert.equal(keys[0], 'op:op-a');
  // The key a caller recomputes for dismissal matches the one the surface rendered.
  entries.forEach((entry, index) => assert.equal(unplacedRowKey(entry, index), keys[index]));
});

test('a row with no sheet row number falls back to its position, and an unnamed row survives', () => {
  const { rows } = selectUnplacedRows([
    { reason: 'review', markerId: null, rowIndex: 6, itemName: '   ' },
  ]);
  assert.equal(rows[0].rowNumber, 7); // rowIndex is 0-based over the sheet's data rows
  assert.equal(rows[0].itemName, null);
  assert.equal(rows[0].sheetName, null);
});

test('unplaced-only reasons win over the shared review vocabulary', () => {
  assert.equal(unplacedReasonMessage('review'), UNPLACED_ONLY_REASON_MESSAGES.review);
  assert.match(unplacedReasonMessage('ambiguous-identity'), /more than one Survey Marker/i);
  assert.match(unplacedReasonMessage('stale'), /changed this item first/i);
  // Codes shared with the per-row review icon still resolve through that vocabulary.
  assert.match(unplacedReasonMessage('foreign'), /different survey/i);
});
