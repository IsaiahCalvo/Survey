/**
 * historyContextRestore.js — Decision 10 (KAL-90): clicking a history entry
 * must restore the EXACT context the mark belongs to, not just the page.
 *
 * Pure resolver: given a history event row (as listed by
 * documentHistoryService.listDocumentHistoryEvents) and the live spaces array,
 * work out which viewer context should be restored before navigating:
 *
 *   - spaceId / hasSpaceTarget  → survey/region mode (activeSpaceId). An explicit
 *     null spaceId means "the mark is document-level — exit space mode".
 *   - surveyPanelOpen / templateId / moduleId / categoryId → survey panel state.
 *
 * Primary source is payload.uiContext — stamped on every history debug event at
 * record time (see pushHistoryDebugEvent in PDFViewer). Legacy rows recorded
 * before stamping existed fall back to what the payload already carries:
 * the survey-marker restoreAction (full marker), the spotlight
 * previewAnnotation (moduleId/regionId), and the checkpoint context
 * (selectedCategoryId). A regionId with no explicit space stamp is mapped back
 * to its owning space via spaces[].assignedPages[].regions[].regionId.
 *
 * Returns null when the event carries no restorable context at all — the
 * caller falls back to today's page-jump-only behavior.
 */

/** Find the space that owns a region id, searching assigned pages. */
export function findSpaceIdForRegion(spaces, regionId) {
  if (!regionId || !Array.isArray(spaces)) return null;
  for (const space of spaces) {
    if (!space || !Array.isArray(space.assignedPages)) continue;
    for (const page of space.assignedPages) {
      const regions = Array.isArray(page?.regions) ? page.regions : [];
      if (regions.some((region) => region?.regionId === regionId)) {
        return space.id ?? null;
      }
    }
  }
  return null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

export function resolveHistoryEntryContext(event, { spaces = [] } = {}) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const uiContext = payload.uiContext && typeof payload.uiContext === 'object' ? payload.uiContext : null;
  const checkpointContext = payload.context && typeof payload.context === 'object' ? payload.context : null;
  const preview = payload.previewAnnotation && typeof payload.previewAnnotation === 'object' ? payload.previewAnnotation : null;
  const restoreAction = payload.restoreAction && typeof payload.restoreAction === 'object' ? payload.restoreAction : null;
  const marker = restoreAction?.surveyMarker && typeof restoreAction.surveyMarker === 'object'
    ? restoreAction.surveyMarker
    : null;

  const resolved = {};
  let any = false;

  // --- Survey/region mode (active space) -----------------------------------
  if (uiContext && 'spaceId' in uiContext) {
    // Stamped rows are authoritative — including an explicit null (document mode).
    resolved.hasSpaceTarget = true;
    resolved.spaceId = uiContext.spaceId ?? null;
    any = true;
  } else {
    // Legacy rows: the mark's own spaceId stamp wins, else derive the owning
    // space from the mark's regionId.
    const markSpaceId = firstDefined(marker?.spaceId, checkpointContext?.spaceId);
    if (markSpaceId != null) {
      resolved.hasSpaceTarget = true;
      resolved.spaceId = markSpaceId;
      any = true;
    } else {
      const regionId = firstDefined(marker?.regionId, preview?.regionId, checkpointContext?.regionId);
      if (regionId != null) {
        const ownerSpaceId = findSpaceIdForRegion(spaces, regionId);
        if (ownerSpaceId != null) {
          resolved.hasSpaceTarget = true;
          resolved.spaceId = ownerSpaceId;
          any = true;
        }
      }
    }
  }

  // --- Survey panel open/closed ---------------------------------------------
  if (uiContext && typeof uiContext.surveyPanelOpen === 'boolean') {
    resolved.hasSurveyPanel = true;
    resolved.surveyPanelOpen = uiContext.surveyPanelOpen;
    any = true;
  } else if (marker) {
    // A survey-marker row implies the mark lives in survey mode.
    resolved.hasSurveyPanel = true;
    resolved.surveyPanelOpen = true;
    any = true;
  }

  // --- Template / module / category (selected survey context) ---------------
  const templateId = firstDefined(uiContext?.templateId, marker?.templateId);
  if (templateId != null) {
    resolved.hasTemplate = true;
    resolved.templateId = templateId;
    any = true;
  }

  const moduleId = firstDefined(uiContext?.moduleId, marker?.moduleId, preview?.moduleId);
  if (moduleId != null) {
    resolved.hasModule = true;
    resolved.moduleId = moduleId;
    any = true;
  }

  const categoryId = firstDefined(
    uiContext?.categoryId,
    marker?.categoryId,
    checkpointContext?.selectedCategoryId,
  );
  if (categoryId != null) {
    resolved.hasCategory = true;
    resolved.categoryId = categoryId;
    any = true;
  }

  return any ? resolved : null;
}

/**
 * w55: does this History row's MARK live in survey context (a Survey Marker,
 * a module-scoped mark, a region/space)? Only those need the viewer switched
 * into a space/template/module to be visible. For an ordinary mark, the
 * author's screen setup at the time (survey panel open, a module selected) says
 * nothing about the mark, and applying it would close the reader's survey
 * panel or drop them into a module that hides ordinary markup.
 */
export function isSurveyScopedHistoryEvent(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const restoreAction = payload.restoreAction && typeof payload.restoreAction === 'object' ? payload.restoreAction : null;
  const preview = payload.previewAnnotation && typeof payload.previewAnnotation === 'object' ? payload.previewAnnotation : null;
  if (event?.event_type === 'survey_marker_deleted'
    || event?.event_type === 'region_deleted'
    || event?.event_type === 'space_deleted') return true;
  if (restoreAction?.type === 'surveyMarker' || restoreAction?.surveyMarker) return true;
  const annotationType = String(payload.annotationType || '').toLowerCase();
  if (annotationType.includes('survey') || annotationType === 'highlight') return true;
  if (preview && (preview.moduleId != null || preview.regionId != null)) return true;
  const reason = String(payload.reason || payload.rawActionType || '');
  return reason.startsWith('highlight:') || reason.startsWith('survey-marker:') || reason.startsWith('space:');
}
