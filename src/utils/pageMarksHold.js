/**
 * pageMarksHold.js — whether a document's pages wait (as blank sheets) for
 * its saved marks.
 *
 * Owner 2026-11-03: "if a PDF loads up and the page is visible, then the
 * annotations need to also be visible ... one and one." The page's drawing
 * and its saved marks appear in the same frame: while the annotation store
 * has neither painted its saved copy (the w29 preview) nor finished opening,
 * the pages hold. Rails, toolbars, pan and every tool stay live meanwhile
 * (owner 2026-11-02; tools-ready-while-opening).
 *
 * The hold ends as soon as the viewer shows marks for the document (this
 * device's own saved copy can come before the store's), at the store's
 * first paint, when it opens, when it cannot
 * open ('unavailable': the PDF shows read-only while it retries), or after
 * PAGE_MARKS_HOLD_MAX_MS, so a stalled network never leaves the page blank.
 */
import { ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE } from './annotationHydrationGate.js';

export const PAGE_MARKS_HOLD_MAX_MS = 10_000;

/**
 * @param {object} input
 * @param {boolean} input.storeEnabled  the document's marks come from the annotation store
 * @param {string|null} input.documentId the open document
 * @param {{ ready?: boolean, source?: string, documentId?: string|null }|null} input.hydration
 *        useAnnotationDoc's initialHydration
 * @param {boolean} [input.viewerShowsMarks] the viewer already shows marks for it
 * @param {boolean} [input.expired]     the hold ran PAGE_MARKS_HOLD_MAX_MS
 */
export function shouldHoldPagesForMarks({ storeEnabled, documentId, hydration, viewerShowsMarks = false, expired = false }) {
  if (!storeEnabled || !documentId || viewerShowsMarks || expired) return false;
  if (!hydration || hydration.documentId !== documentId) return true;
  if (hydration.ready === true) return false;
  if (hydration.source === ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE) return false;
  return hydration.source === 'pending';
}
