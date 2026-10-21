// Smart fill (beta): found matches live in each page's SVGAnnotationLayer.
// Deleting a category tells every page to drop its offered matches, so no
// blue outline is left behind for a category that no longer exists.
export const SMART_FILL_CLEAR_MATCHES_EVENT = 'smart-fill-clear-matches';

export function notifySmartFillCategoriesDeleted(categoryIds = [], markerIds = [], target = typeof window !== 'undefined' ? window : null) {
  if (!target?.dispatchEvent || typeof CustomEvent === 'undefined') return false;
  target.dispatchEvent(new CustomEvent(SMART_FILL_CLEAR_MATCHES_EVENT, { detail: { categoryIds, markerIds } }));
  return true;
}

// Matches found from a marker stay when some OTHER category is deleted; they
// go when the delete takes their source marker. Matches with no known source
// (the tool-bar search, which works from the last sample only) go on any delete.
export function shouldClearSmartFillMatches(sourceMarkerId, deletedMarkerIds = []) {
  if (sourceMarkerId == null) return true;
  return deletedMarkerIds.includes(sourceMarkerId);
}
