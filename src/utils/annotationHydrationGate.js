/**
 * annotationHydrationGate.js — the hydration states a document's annotation
 * store reports while it opens (useAnnotationDoc's `initialHydration`).
 *
 * Owner 2026-11-02: no page waits for these any more. Every tool works the
 * moment a page is drawn; edits made while the store opens are laid on top of
 * the stored marks when it is ready (openingEditsMerge.js). The states still
 * decide when the store may be written to, imported into and read for sync.
 */
export const ANNOTATION_HYDRATION_PENDING = Object.freeze({
  ready: false,
  source: 'pending',
});

export const ANNOTATION_HYDRATION_READY_LOCAL = Object.freeze({
  ready: true,
  source: 'local',
});

// The durable store could not be opened (e.g. a WAL read timed out; w26,
// 2026-09-24). Hydration is NOT ready — nothing may import into or write to
// the store — so the document is read-only (useAnnotationDoc) while the open
// is retried; the PDF shows without its marks, which appear when it succeeds.
export const ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE = 'unavailable';

// Open speed (w29, 2026-09-24): the store is still opening, but the marks
// from this device's saved copy (or the cloud snapshot) are already painted.
// Hydration is NOT ready (nothing imports or writes yet).
export const ANNOTATION_HYDRATION_PREVIEW_SOURCE = 'preview';
