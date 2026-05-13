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
