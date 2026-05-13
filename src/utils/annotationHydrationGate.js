export const ANNOTATION_HYDRATION_PENDING = Object.freeze({
  ready: false,
  source: 'pending',
});

export const ANNOTATION_HYDRATION_READY_LOCAL = Object.freeze({
  ready: true,
  source: 'local',
});

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
    return candidates.sort((a, b) => a - b)[0];
  }
  const current = Number(currentPage);
  if (Number.isFinite(current) && current > 0) return current;
  const fallback = Number(fallbackPage);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 1;
}

export function isInitialAnnotationHydrationReady({
  isCloudBackedDocument,
  normalHydration,
  surveyHydration,
} = {}) {
  if (!isCloudBackedDocument) return true;
  return normalHydration?.ready === true && surveyHydration?.ready === true;
}

export function shouldGateFirstVisibleAnnotationPage({
  isCloudBackedDocument,
  pageNumber,
  firstVisiblePageNumber,
  normalHydration,
  surveyHydration,
} = {}) {
  if (!isCloudBackedDocument) return false;
  if (Number(pageNumber) !== Number(firstVisiblePageNumber)) return false;
  return !isInitialAnnotationHydrationReady({
    isCloudBackedDocument,
    normalHydration,
    surveyHydration,
  });
}

export function shouldCoverFirstVisibleAnnotationPage({
  isCloudBackedDocument,
  pageNumber,
  firstVisiblePageNumber,
  normalHydration,
  surveyHydration,
} = {}) {
  return shouldGateFirstVisibleAnnotationPage({
    isCloudBackedDocument,
    pageNumber,
    firstVisiblePageNumber,
    normalHydration,
    surveyHydration,
  });
}
