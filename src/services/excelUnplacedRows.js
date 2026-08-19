// src/services/excelUnplacedRows.js
//
// KAL-292 — "Rows we couldn't place".
//
// A `pendingImportReview` entry that carries NO markerId belongs to no Survey Marker,
// so it can never hang off a Survey-panel row the way the red review icon does. Before
// this module those entries were silently dropped from the UI: the user's Excel edits
// simply did not appear and nothing anywhere said why. This turns them into a compact,
// dismissable list at the top of the Survey panel.
//
// Two rules govern the copy here:
//   1. PLAIN ENGLISH. A surveyor reads this, not a developer. No reason codes, no jargon.
//   2. "Survey Marker" is always written in full — never "marker".
//
// SECURITY NOTE: this surface is READ-ONLY on purpose. It explains and it dismisses; it
// deliberately offers NO "apply anyway", because a null-marker row is exactly the row the
// server-side gate refused to write. An apply-anyway button would route around that gate.

import { reviewReasonMessage } from './excelReviewMessages.js';

// Reason codes that ONLY ever show up on an unplaced (null-marker) row, so they have no
// entry in excelReviewMessages (which explains rows that DO map to a Survey Marker).
//   'ambiguous-identity' — rowImportMatcher pass 3c: the row's content overlaps more than
//                          one leftover Survey Marker, so it is never guessed at.
//   'review'            — a server outcome: the change-set gate held this row, no write.
//   'stale'             — a server outcome: a newer edit already landed on that item.
const UNPLACED_ONLY_MESSAGES = Object.freeze({
  'ambiguous-identity': 'More than one Survey Marker could match this row, so nothing was changed.',
  review: 'This change was held for review before anything was written.',
  stale: 'Someone else changed this item first, so this older edit wasn’t applied.',
});

/**
 * Plain-English explanation for one unplaced row.
 * Falls back to the shared review vocabulary (which has its own safe default).
 * @param {string} reason  the review reason code
 * @returns {string}
 */
export const unplacedReasonMessage = (reason) => {
  if (typeof reason === 'string'
    && Object.prototype.hasOwnProperty.call(UNPLACED_ONLY_MESSAGES, reason)) {
    return UNPLACED_ONLY_MESSAGES[reason];
  }
  return reviewReasonMessage(reason);
};

// Shown ONCE at the top when the server held the whole change-set instead of judging
// each row. Repeating the identical per-row reason a hundred times is worse than useless.
// The wording leads with the fact (nothing was applied) and then names the usual cause —
// the shared-survey business-cloud gate — without asserting it as certain, because the
// client only sees "every row held, nothing written", not the server's internal reason.
export const BATCH_HOLD_NOTICE =
  'None of your Excel changes were applied this time — every row was held before anything was written. '
  + 'This usually happens when a survey is shared with other people and the linked workbook isn’t saved '
  + 'in your work Microsoft account (OneDrive for Business or SharePoint). Nothing in the app was changed.';

export const BATCH_HOLD_TITLE = 'Your Excel changes weren’t applied';

/**
 * True when the last server change-set was rejected wholesale rather than row by row:
 * every outcome came back held for review and the server wrote nothing at all.
 * That is the exact shape the shared-document business gate returns.
 *
 * @param {{outcomes?:Array, writebackJobs?:Array}} result  the submitChangeSet result
 * @returns {boolean}
 */
export const isWholeChangeSetHeld = (result) => {
  const outcomes = Array.isArray(result?.outcomes) ? result.outcomes : [];
  if (outcomes.length < 2) return false; // a single held row is not a "whole batch"
  if (Array.isArray(result?.writebackJobs) && result.writebackJobs.length > 0) return false;
  return outcomes.every((o) => o && o.outcome === 'review');
};

/**
 * Stable identity for one unplaced row, used as the React key and the dismiss handle.
 * Server rows carry an opUuid; local rows are identified by scope + sheet row + reason.
 */
export const unplacedRowKey = (entry, index) => {
  if (entry?.opUuid) return `op:${entry.opUuid}`;
  const scope = entry?.scopeKey ?? '';
  const row = entry?.sheetRowNumber ?? entry?.rowIndex ?? '';
  return `row:${scope}#${row}#${entry?.reason ?? ''}#${index}`;
};

/**
 * Build the "rows we couldn't place" surface from the last import's review set.
 *
 * @param {Array} entries            pendingImportReview
 * @param {{batchHeld?:boolean}} opt batchHeld = the whole change-set was held at once
 * @returns {{rows:Array, batchNotice:string|null, batchTitle:string|null}}
 *          `rows` is empty when there is nothing to show — callers render NOTHING then,
 *          so this surface adds no permanent chrome to the Survey panel.
 */
export const selectUnplacedRows = (entries, { batchHeld = false } = {}) => {
  const list = Array.isArray(entries) ? entries : [];
  const rows = [];
  list.forEach((entry, index) => {
    if (!entry || entry.markerId) return; // rows that DO map to a Survey Marker use the row icon
    const rowNumber = Number.isInteger(entry.sheetRowNumber) && entry.sheetRowNumber > 0
      ? entry.sheetRowNumber
      : (Number.isInteger(entry.rowIndex) && entry.rowIndex >= 0 ? entry.rowIndex + 1 : null);
    const itemName = typeof entry.itemName === 'string' && entry.itemName.trim()
      ? entry.itemName.trim()
      : null;
    rows.push({
      key: unplacedRowKey(entry, index),
      reason: entry.reason || null,
      sheetName: typeof entry.sheetName === 'string' && entry.sheetName.trim()
        ? entry.sheetName.trim()
        : null,
      rowNumber,
      itemName,
      // Suppressed under a batch hold: the single notice at the top already says why,
      // and stamping the same sentence on every row buries the list.
      message: batchHeld ? null : unplacedReasonMessage(entry.reason),
    });
  });
  const held = Boolean(batchHeld) && rows.length > 0;
  return {
    rows,
    batchNotice: held ? BATCH_HOLD_NOTICE : null,
    batchTitle: held ? BATCH_HOLD_TITLE : null,
  };
};

export const UNPLACED_ONLY_REASON_MESSAGES = UNPLACED_ONLY_MESSAGES;
