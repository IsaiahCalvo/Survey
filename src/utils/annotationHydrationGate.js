/**
 * annotationHydrationGate.js — pure rules for whether to gate/cover a page's
 * annotation layer while cloud sync hydrates.
 *
 * Exports hydration-state constants, resolveFirstVisibleAnnotationPage,
 * isInitialAnnotationHydrationReady, and shouldGate/CoverFirstVisibleAnnotationPage.
 * Cloud-backed documents gate the first visible page until the authoritative
 * annotation state for the current document is ready. Local documents never
 * gate because their annotations load synchronously with the PDF.
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
// the store — but the page must not stay covered: the PDF shows without its
// marks while useAnnotationDoc retries the open, and the marks appear when it
// succeeds.
export const ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE = 'unavailable';

// Open speed (w29, 2026-09-24): the store is still opening, but the marks
// from this device's saved copy (or the cloud snapshot) are already painted.
// Hydration is NOT ready (nothing imports or writes), yet the first page
// should show the PDF and those marks instead of the grey loading cover. Its
// input stays blocked until hydration is ready, behind a see-through cover.
export const ANNOTATION_HYDRATION_PREVIEW_SOURCE = 'preview';

/**
 * True while the first visible page may show previewed marks: the document's
 * store is opening with an early paint in place (and survey hydration, which
 * the gate also waits for, is ready for this document).
 */
export function isFirstVisibleAnnotationPagePreviewing({
  documentId,
  isCloudBackedDocument,
  normalHydration,
  surveyHydration,
} = {}) {
  if (!isCloudBackedDocument) return false;
  if (normalHydration?.ready === true) return false;
  if (normalHydration?.source !== ANNOTATION_HYDRATION_PREVIEW_SOURCE) return false;
  if (surveyHydration?.ready !== true) return false;
  if (documentId) {
    return normalHydration?.documentId === documentId
      && surveyHydration?.documentId === documentId;
  }
  return true;
}

function isUnavailableFor(hydration, documentId) {
  return hydration?.source === ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE
    && (!documentId || hydration?.documentId === documentId);
}

export function resolveFirstVisibleAnnotationPage({
  visiblePages,
  currentPage,
  fallbackPage = 1,
} = {}) {
  const candidates = [];
  if (visiblePages && typeof visiblePages[Symbol.iterator] === 'function') {
    for (const page of visiblePages) {
      const pageNumber = Number(page);
      if (Number.isFinite(pageNumber) && pageNumber > 0) candidates.push(pageNumber);
    }
  }
  if (candidates.length > 0) {
    return Math.min(...candidates);
  }
  const current = Number(currentPage);
  if (Number.isFinite(current) && current > 0) return current;
  const fallback = Number(fallbackPage);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 1;
}

function isInitialAnnotationHydrationReady({
  documentId,
  isCloudBackedDocument,
  normalHydration,
  surveyHydration,
} = {}) {
  if (!isCloudBackedDocument) return true;
  if (surveyHydration?.ready !== true) return false;
  // An unavailable store uncovers the page (the PDF renders without marks).
  if (isUnavailableFor(normalHydration, documentId)) {
    return !documentId || surveyHydration?.documentId === documentId;
  }
  if (normalHydration?.ready !== true) return false;

  // React may render once with the previous document's ready state before the
  // hydration effects reset. Never let that stale readiness uncover a new PDF.
  if (documentId) {
    return normalHydration?.documentId === documentId
      && surveyHydration?.documentId === documentId;
  }
  return true;
}

export function shouldGateFirstVisibleAnnotationPage({
  documentId,
  isCloudBackedDocument,
  pageNumber,
  firstVisiblePageNumber,
  normalHydration,
  surveyHydration,
} = {}) {
  if (!isCloudBackedDocument) return false;
  if (Number(pageNumber) !== Number(firstVisiblePageNumber)) return false;
  return !isInitialAnnotationHydrationReady({
    documentId,
    isCloudBackedDocument,
    normalHydration,
    surveyHydration,
  });
}

export function shouldCoverFirstVisibleAnnotationPage({
  documentId,
  isCloudBackedDocument,
  pageNumber,
  firstVisiblePageNumber,
  normalHydration,
  surveyHydration,
} = {}) {
  return shouldGateFirstVisibleAnnotationPage({
    documentId,
    isCloudBackedDocument,
    pageNumber,
    firstVisiblePageNumber,
    normalHydration,
    surveyHydration,
  });
}
