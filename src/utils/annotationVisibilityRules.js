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
  return Array.isArray(regions)
    ? regions
      .filter((region) => region && typeof region === 'object')
      .map((region) => normalizeRegionVisibility(region))
    : [];
}

export function getPageAnnotationVisibilityState(page) {
  const primaryRegion = Array.isArray(page?.regions)
    ? page.regions.find((region) => region && typeof region === 'object')
    : null;
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

export function getSpaceIdForRegionFromSpaces(regionId, spaces = []) {
  if (!regionId || !Array.isArray(spaces) || spaces.length === 0) return null;

  for (const space of spaces) {
    for (const page of (space?.assignedPages || [])) {
      for (const region of (page?.regions || [])) {
        if (region?.regionId === regionId) return space.id;
      }
    }
  }

  return null;
}

/**
 * Decision 11 companion — single source of truth for whether a NEWLY CREATED
 * annotation should be stamped with the active regionId.
 *
 * Mirrors the pen-stroke rule that has always lived inline in
 * FabricDrawingCanvas.shouldAssignRegionId (which now delegates here): stamp
 * only when a region is active AND its space is the annotation-scoping space
 * AND that space has the page assigned AND the region actually exists on the
 * page AND the region overlay toggle is not off. Callout creation
 * (SVGAnnotationLayer) uses the same helper so callouts and pen strokes can
 * never drift apart.
 *
 * @param {object} args
 * @param {string|null} args.regionId — the active region id (activeRegionId)
 * @param {string|null} args.spaceId — the annotation-scoping space id
 *   (activeSpaceId ?? selectedSpaceId, i.e. PDFViewer's annotationSpaceId)
 * @param {number} args.pageNumber — page the annotation is being created on
 * @param {Array} args.spaces — current spaces array
 * @param {Function|null} args.isRegionOverlayEnabled — overlay toggle checker
 * @returns {boolean}
 */
export function shouldStampActiveRegionId({
  regionId = null,
  spaceId = null,
  pageNumber,
  spaces = [],
  isRegionOverlayEnabled = null
} = {}) {
  if (!regionId || !spaceId) return false;

  const currentSpaces = Array.isArray(spaces) ? spaces : [];
  const space = currentSpaces.find((entry) => entry?.id === spaceId);
  if (!space) return false;

  const assignedPage = space.assignedPages?.find((page) => page?.pageId === pageNumber);
  if (!assignedPage) return false;

  const pageRegions = Array.isArray(assignedPage.regions) ? assignedPage.regions : [];
  if (!pageRegions.some((region) => region?.regionId === regionId)) {
    return false;
  }

  if (typeof isRegionOverlayEnabled === 'function') {
    return isRegionOverlayEnabled(spaceId, pageNumber, assignedPage) !== false;
  }

  return true;
}

export function isAnnotationVisibleInContext({
  annotation,
  pageNumber,
  selectedModuleId = null,
  showSurveyPanel = false,
  selectedSpaceId = null,
  activeSpaceId = null,
  activeRegions = null,
  activeRegionId = null,
  spaces = [],
  getCanvasAnnotationVisibilityState = null,
  getSurveyAnnotationVisibilityState = null,
  isRegionOverlayEnabled = null,
  layerVisibility = null
} = {}) {
  if (!annotation) return false;

  const layer = annotation.layer || 'native';
  if (layerVisibility && layerVisibility[layer] === false) {
    return false;
  }

  const visibilityScope = getAnnotationVisibilityScope({
    moduleId: annotation.moduleId,
    regionId: annotation.regionId
  });
  const isSurveyAnnotation =
    visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY ||
    visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
  const isScopedRegionAnnotation =
    visibilityScope === ANNOTATION_VISIBILITY_SCOPE.REGION ||
    visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;

  let isOverlayEnabledForThisPage = false;
  if (activeRegions !== null && selectedSpaceId && typeof isRegionOverlayEnabled === 'function') {
    const space = Array.isArray(spaces)
      ? spaces.find((candidate) => candidate?.id === selectedSpaceId)
      : null;
    const page = space?.assignedPages?.find((candidate) => candidate?.pageId === pageNumber);
    if (page) {
      isOverlayEnabledForThisPage = isRegionOverlayEnabled(selectedSpaceId, pageNumber, page);
    }
  }
  const hasActiveRegions =
    activeRegions !== null &&
    Array.isArray(activeRegions) &&
    activeRegions.some((region) => region && typeof region === 'object') &&
    isOverlayEnabledForThisPage;

  const derivedSpaceId = isScopedRegionAnnotation
    ? getSpaceIdForRegionFromSpaces(annotation.regionId, spaces)
    : null;

  let matchesSpace = true;
  if (hasActiveRegions && !isScopedRegionAnnotation) {
    matchesSpace = true;
  } else if (isScopedRegionAnnotation && derivedSpaceId !== null) {
    matchesSpace = activeSpaceId !== null && derivedSpaceId === activeSpaceId;
  }

  let surveyAnnotationVisible = true;
  if (isSurveyAnnotation) {
    surveyAnnotationVisible =
      showSurveyPanel && selectedModuleId !== null && annotation.moduleId === selectedModuleId;
  } else if (!isScopedRegionAnnotation) {
    surveyAnnotationVisible = !(showSurveyPanel && selectedModuleId !== null);
  }

  let scopedRegionAnnotationVisible = true;
  if (isScopedRegionAnnotation) {
    if (activeSpaceId === null) {
      scopedRegionAnnotationVisible = false;
    } else if (hasActiveRegions) {
      scopedRegionAnnotationVisible = true;
    } else if (activeRegionId !== null) {
      scopedRegionAnnotationVisible = annotation.regionId === activeRegionId;
    } else {
      scopedRegionAnnotationVisible = false;
    }
  }

  let pageScopedAnnotationVisible = true;
  if (!isScopedRegionAnnotation && selectedSpaceId !== null) {
    pageScopedAnnotationVisible = isAnnotationVisibleByPageControl({
      scope: visibilityScope,
      canvasVisible: typeof getCanvasAnnotationVisibilityState === 'function'
        ? getCanvasAnnotationVisibilityState(selectedSpaceId, pageNumber)
        : true,
      surveyVisible: typeof getSurveyAnnotationVisibilityState === 'function'
        ? getSurveyAnnotationVisibilityState(selectedSpaceId, pageNumber)
        : true
    });
  }

  return matchesSpace &&
    surveyAnnotationVisible &&
    scopedRegionAnnotationVisible &&
    pageScopedAnnotationVisible;
}
