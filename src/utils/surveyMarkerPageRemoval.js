/**
 * surveyMarkerPageRemoval.js — take deleted Survey Markers off the page.
 *
 * The page draws Survey Markers from `newSurveyMarkersByPage`
 * ({ [pageNumber]: [{ annotationId, x, y, width, height, ... }] }), not from
 * `surveyMarkers`. A delete that only removes a marker from `surveyMarkers`
 * leaves its box drawn until a reload (KAL-502: deleting a category in the
 * Survey rail). This mirrors what the ✕ delete (handleSurveyMarkerDeleted in
 * PDFViewer.jsx) does to `newSurveyMarkersByPage`:
 *   - an entry is removed when its annotationId is one of the deleted ids;
 *   - an entry with NO annotationId is removed when its box matches a deleted
 *     marker's bounds on the same page (within 5 units). An entry that names
 *     its own marker is only ever removed by its id (w53).
 *
 * Pure: returns `byPage` itself when nothing changes.
 */

const TOLERANCE = 5;

const sameBox = (a, b) => (
  Math.abs((a.x ?? a.left) - (b.x ?? b.left)) < TOLERANCE
  && Math.abs((a.y ?? a.top) - (b.y ?? b.top)) < TOLERANCE
  && Math.abs((a.width ?? (a.right - a.left)) - (b.width ?? (b.right - b.left))) < TOLERANCE
  && Math.abs((a.height ?? (a.bottom - a.top)) - (b.height ?? (b.bottom - b.top))) < TOLERANCE
);

/**
 * @param {Object} byPage  newSurveyMarkersByPage
 * @param {Array<{ id: string, pageNumber?: number, bounds?: Object }>} deleted
 * @returns {Object} the next newSurveyMarkersByPage
 */
export function removeSurveyMarkersFromPages(byPage, deleted) {
  if (!byPage || typeof byPage !== 'object' || !Array.isArray(deleted) || deleted.length === 0) return byPage;
  const ids = new Set(deleted.map((d) => d?.id).filter(Boolean));
  let changed = false;
  const next = { ...byPage };
  Object.keys(byPage).forEach((pageKey) => {
    const entries = byPage[pageKey];
    if (!Array.isArray(entries)) return;
    const boxesOnPage = deleted
      .filter((d) => d?.bounds && String(d.pageNumber) === String(pageKey))
      .map((d) => d.bounds);
    const kept = entries.filter((entry) => {
      if (!entry) return true;
      if (entry.annotationId != null) return !ids.has(entry.annotationId);
      if (entry.x === undefined || entry.y === undefined) return true;
      return !boxesOnPage.some((bounds) => sameBox(entry, bounds));
    });
    if (kept.length === entries.length) return;
    changed = true;
    if (kept.length === 0) delete next[pageKey];
    else next[pageKey] = kept;
  });
  return changed ? next : byPage;
}
