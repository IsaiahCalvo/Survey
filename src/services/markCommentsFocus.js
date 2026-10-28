// src/services/markCommentsFocus.js
//
// Opening the Comments panel from a picked mark or a comment link (Nightly,
// flag 'mark-comments'). Kept out of markComments.js so AppShell and the rail
// pull only this on first load.

// Fired on window to start a comment on a picked mark (the selection bar's
// Comment button) or open a comment from a link: { markId?, pageNumber, commentId? }.
export const OPEN_MARK_COMMENTS_EVENT = 'survey:open-mark-comments';

// A comment link (?docId=&comment=) is read before the document's rail is
// on screen: the request waits here until that rail takes it.
let pendingFocus = null;

/** Open the Comments panel: now on the rail in front, or when `documentId`'s rail mounts. */
export function requestMarkCommentsFocus(detail) {
  pendingFocus = detail?.documentId ? { ...detail } : null;
  try {
    window.dispatchEvent(new CustomEvent(OPEN_MARK_COMMENTS_EVENT, { detail }));
  } catch {
    // No DOM events here (tests).
  }
}

/** The waiting request for this document, taken once. */
export function takePendingMarkCommentsFocus(documentId) {
  if (!pendingFocus || !documentId || pendingFocus.documentId !== documentId) return null;
  const detail = pendingFocus;
  pendingFocus = null;
  return detail;
}
