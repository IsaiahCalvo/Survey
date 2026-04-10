/**
 * Source of truth for annotation visibility and page-level visibility controls.
 *
 * Scope model:
 * - Canvas-scoped: moduleId=null, regionId=null
 * - Survey-scoped: moduleId!=null, regionId=null
 * - Region-scoped: moduleId=null, regionId!=null
 * - Survey-region-scoped: moduleId!=null, regionId!=null
 *
 * UX model:
 * - Keep one visibility control on screen in the Spaces UI.
 * - In regular space context, that control is the light bulb and it only affects
 *   canvas-scoped annotations for the page.
 * - In survey context, that control is the survey icon and it only affects
 *   survey-scoped annotations for the page.
 * - Region-scoped and survey-region-scoped annotations are controlled by the
 *   overlay slider, not by the page visibility icon.
 *
 * Backward compatibility:
 * - Legacy data stored canvas visibility under showBackgroundAnnotations.
 * - New code uses showCanvasAnnotations explicitly and mirrors it back to the
 *   legacy field so older flows keep working.
 */

export const ANNOTATION_VISIBILITY_SCOPE = Object.freeze({
  CANVAS: 'canvas',
  SURVEY: 'survey',
  REGION: 'region',
  SURVEY_REGION: 'survey-region'
});

export const PAGE_VISIBILITY_CONTROL_MODE = Object.freeze({
  CANVAS: 'canvas',
  SURVEY: 'survey'
});

export function isScopedToSurvey(moduleId) {
  return moduleId !== null && moduleId !== undefined;
}

export function isScopedToRegion(regionId) {
  return regionId !== null && regionId !== undefined;
}

export function getAnnotationVisibilityScope({ moduleId = null, regionId = null } = {}) {
  const hasSurveyScope = isScopedToSurvey(moduleId);
  const hasRegionScope = isScopedToRegion(regionId);

  if (hasSurveyScope && hasRegionScope) {
    return ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
  }
  if (hasSurveyScope) {
    return ANNOTATION_VISIBILITY_SCOPE.SURVEY;
  }
  if (hasRegionScope) {
    return ANNOTATION_VISIBILITY_SCOPE.REGION;
  }
  return ANNOTATION_VISIBILITY_SCOPE.CANVAS;
}

export function isSurveyVisibilityContext({ showSurveyPanel = false, selectedModuleId = null } = {}) {
  return Boolean(showSurveyPanel && selectedModuleId !== null && selectedModuleId !== undefined);
}

export function getPageVisibilityControlMode({ showSurveyPanel = false, selectedModuleId = null } = {}) {
  return isSurveyVisibilityContext({ showSurveyPanel, selectedModuleId })
    ? PAGE_VISIBILITY_CONTROL_MODE.SURVEY
    : PAGE_VISIBILITY_CONTROL_MODE.CANVAS;
}

export function normalizeRegionVisibility(region = {}) {
  const canvasVisible =
    region.showCanvasAnnotations ?? region.showBackgroundAnnotations ?? true;
  const surveyVisible = region.showSurveyAnnotations ?? true;

  return {
    ...region,
    showCanvasAnnotations: canvasVisible !== false,
    showBackgroundAnnotations: canvasVisible !== false,
    showSurveyAnnotations: surveyVisible !== false
  };
}

export function normalizePageRegions(regions = []) {
  return Array.isArray(regions) ? regions.map((region) => normalizeRegionVisibility(region)) : [];
}

export function getPageAnnotationVisibilityState(page) {
  const primaryRegion = page?.regions?.[0];
  const normalizedRegion = primaryRegion ? normalizeRegionVisibility(primaryRegion) : null;

  return {
    canvasVisible: normalizedRegion ? normalizedRegion.showCanvasAnnotations !== false : true,
    surveyVisible: normalizedRegion ? normalizedRegion.showSurveyAnnotations !== false : true
  };
}

export function getActivePageRegionId({
  activeSpaceId = null,
  pageId = null,
  spaces = [],
  isRegionOverlayEnabled = null
} = {}) {
  if (!activeSpaceId || pageId === null || pageId === undefined) {
    return null;
  }

  const activeSpace = Array.isArray(spaces)
    ? spaces.find((space) => space?.id === activeSpaceId)
    : null;
  if (!activeSpace) {
    return null;
  }

  const page = activeSpace.assignedPages?.find((assignedPage) => assignedPage?.pageId === pageId);
  if (!page) {
    return null;
  }

  if (typeof isRegionOverlayEnabled === 'function' && !isRegionOverlayEnabled(activeSpaceId, pageId, page)) {
    return null;
  }

  const primaryRegion = Array.isArray(page.regions)
    ? page.regions.find((region) => region?.regionId)
    : null;

  return primaryRegion?.regionId || null;
}

export function isAnnotationVisibleByPageControl({
  scope,
  canvasVisible = true,
  surveyVisible = true
}) {
  switch (scope) {
    case ANNOTATION_VISIBILITY_SCOPE.CANVAS:
      return canvasVisible !== false;
    case ANNOTATION_VISIBILITY_SCOPE.SURVEY:
      return surveyVisible !== false;
    default:
      return true;
  }
}
