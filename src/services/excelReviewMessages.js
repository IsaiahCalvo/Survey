// src/services/excelReviewMessages.js
//
// Turns an import-review reason code (the `reason` on a pendingImportReview entry — see
// PDFViewer's executeExcelImport / executeAutoExcelImport) into a short plain-English
// sentence for the red review icon's hover tooltip in the Survey panel. Keep these in
// PLAIN ENGLISH: the surveyor reads them, not a developer. No codenames, no jargon.

const MESSAGES = Object.freeze({
  // Tracking-identity problems on a row that already maps to a Survey Marker.
  'duplicate-rowid': 'Two Excel rows share this item’s tracking ID. Choose which one is the original.',
  duplicate: 'Two Excel rows share this item’s tracking ID. Choose which one is the original.',
  'unknown-rowid': 'This row’s tracking ID isn’t one this survey handed out. Review it before syncing.',
  unknown: 'This row’s tracking ID isn’t one this survey handed out. Review it before syncing.',
  foreign: 'This row looks like it came from a different survey. Review it before syncing.',
  'wrong-scope': 'In Excel this item is filed under a different category. Review it before syncing.',
  malformed: 'This row’s tracking ID is damaged and can’t be read. Review it before syncing.',
  ambiguous: 'This row could match more than one item. Choose which one it belongs to.',
  // A Survey Marker the sheet no longer lists (flag only — never auto-deleted).
  'candidate-delete': 'This item is no longer in the linked Excel sheet. Review whether to remove it.',
  // The same item was edited in both places before syncing (Amendment #6).
  conflict: 'This item was changed in both Excel and the app. Choose which version to keep.'
});

const DEFAULT_MESSAGE = 'This row needs your review before it can sync.';

/**
 * @param {string} reason  the review reason code
 * @returns {string} a plain-English explanation suitable for a hover tooltip
 */
export const reviewReasonMessage = (reason) => {
  if (typeof reason === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, reason)) {
    return MESSAGES[reason];
  }
  return DEFAULT_MESSAGE;
};

export const REVIEW_REASON_MESSAGES = MESSAGES;
export const DEFAULT_REVIEW_MESSAGE = DEFAULT_MESSAGE;
