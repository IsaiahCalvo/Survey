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
} = {}) {
  if (!isCloudBackedDocument) return true;
  return normalHydration?.ready === true;
}

export function shouldGateFirstVisibleAnnotationPage({
  isCloudBackedDocument,
  pageNumber,
  firstVisiblePageNumber,
  normalHydration,
  surveyHydration,
} = {}) {
  // Cloud documents now follow the collaborative-editor rule: keep the last
  // good annotation layer visible while fresh sync state hydrates in the
  // background. Hiding the page during hydration caused repeated blank-screen
  // failures even though Supabase/Y.Doc still had the annotations.
  if (Number(pageNumber) !== Number(firstVisiblePageNumber)) return false;
  if (isCloudBackedDocument) return false;
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
