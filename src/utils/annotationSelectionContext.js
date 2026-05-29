/**
 * annotationSelectionContext.js — builds a stable key for the current annotation
 * selection context (survey panel + module/space/region selection state).
 *
 * Exports buildAnnotationSelectionContextKey (normalizes the context fields into
 * a deterministic JSON string) and didAnnotationSelectionContextChange (compares
 * a prior key to a new one). Used to detect when selection context changes so
 * annotation behavior can react only on real transitions.
 */
const normalizeContextValue = (value) => {
  if (value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value ?? null;
};

export function buildAnnotationSelectionContextKey(context = {}) {
  const normalized = {
    showSurveyPanel: normalizeContextValue(context.showSurveyPanel) === true,
    selectedModuleId: normalizeContextValue(context.selectedModuleId),
    selectedSpaceId: normalizeContextValue(context.selectedSpaceId),
    activeSpaceId: normalizeContextValue(context.activeSpaceId),
    activeRegionId: normalizeContextValue(context.activeRegionId),
    showRegionSelection: normalizeContextValue(context.showRegionSelection) === true,
    regionSelectionPage: normalizeContextValue(context.regionSelectionPage),
  };

  return JSON.stringify(normalized);
}

export function didAnnotationSelectionContextChange(previousKey, nextKey) {
  return previousKey !== null && previousKey !== undefined && previousKey !== nextKey;
}
