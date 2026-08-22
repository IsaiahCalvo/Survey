// Keep-active after a survey stamp, and what module-step does to arming.
// Placement lives in PDFViewer (high-risk — not rewired). Module-step lives
// in SurveySpacesRail.selectSurveyModule. Node proves the product rules.

export function resolveSurveyKeepAfterPlace({
  keepCategoryActive = false,
  mobileMode = false,
} = {}) {
  if (keepCategoryActive) {
    return { clearCategory: false, nextTool: 'survey-marker' };
  }
  return {
    clearCategory: true,
    nextTool: mobileMode ? 'pan' : 'survey-marker',
  };
}

export function resolveSurveyKeepOnModuleChange({
  keepCategoryActive = false,
} = {}) {
  return {
    clearCategory: true,
    keepCategoryActive: Boolean(keepCategoryActive),
    nextTool: 'survey-marker',
  };
}

export function resolveSurveyKeepChromeVisible({
  surface = 'desktop',
  activeCategoryDropdown = null,
  activeTool = null,
  showSurveyPanel = false,
} = {}) {
  if (surface === 'mobile') {
    return Boolean(
      showSurveyPanel
      && ['survey-marker', 'pan', 'select'].includes(activeTool),
    );
  }
  return activeCategoryDropdown === 'survey';
}
