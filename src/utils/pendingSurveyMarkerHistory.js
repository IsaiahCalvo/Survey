import { deepClone } from './deepClone.js';

export function capturePendingSurveyMarkerUi(state = {}) {
  return deepClone({
    newSurveyMarkersByPage: state.newSurveyMarkersByPage || {},
    pendingSurveyMarker: state.pendingSurveyMarker ?? null,
    pendingSurveyMarkerSelection: state.pendingSurveyMarkerSelection ?? null,
    pendingEntitySelection: state.pendingEntitySelection ?? null,
    pendingSurveyMarkerName: state.pendingSurveyMarkerName ?? null,
    surveyMarkerNameInput: state.surveyMarkerNameInput ?? null,
  });
}

function matchesMarker(value, annotationId) {
  return String(
    value?.surveyMarker?.id
      ?? value?.surveyMarker?.annotationId
      ?? value?.annotationId
      ?? value?.id
      ?? '',
  ) === String(annotationId);
}

function pendingMarkerId(value) {
  const markerId = value?.surveyMarker?.id
    ?? value?.surveyMarker?.annotationId
    ?? value?.id
    ?? value?.annotationId;
  return typeof markerId === 'string' && markerId.length > 0 ? markerId : null;
}

export function collectPendingSurveyMarkerDraftIds(state = {}) {
  const ids = new Set();
  for (const value of [
    state.pendingSurveyMarker,
    state.pendingEntitySelection,
    state.pendingSurveyMarkerName,
  ]) {
    const markerId = pendingMarkerId(value);
    if (markerId) ids.add(markerId);
  }
  return ids;
}

export function buildPendingSurveyMarkerProjection({
  previousByPage = {},
  savedMarkers = {},
  selectedModuleId = null,
  pendingMarkerIds = new Set(),
  requireExplicitPending = false,
} = {}) {
  const projectedByPage = {};
  const projectedIds = new Set();
  const explicitPendingIds = pendingMarkerIds instanceof Set
    ? pendingMarkerIds
    : new Set(pendingMarkerIds || []);

  for (const [pageNumberValue, pageMarkers] of Object.entries(previousByPage || {})) {
    if (!Array.isArray(pageMarkers)) continue;
    for (const marker of pageMarkers) {
      const markerId = typeof marker?.annotationId === 'string'
        ? marker.annotationId
        : null;
      if (!markerId || marker.moduleId !== selectedModuleId) continue;
      if (Object.prototype.hasOwnProperty.call(savedMarkers || {}, markerId)) continue;
      if (requireExplicitPending && !explicitPendingIds.has(markerId)) continue;
      if (projectedIds.has(markerId)) continue;

      const pageNumber = Number.parseInt(pageNumberValue, 10);
      if (!Number.isFinite(pageNumber)) continue;
      if (!projectedByPage[pageNumber]) projectedByPage[pageNumber] = [];
      projectedByPage[pageNumber].push(marker);
      projectedIds.add(markerId);
    }
  }

  return projectedByPage;
}

export function deletePendingSurveyMarkerUi(state, annotationId) {
  const current = capturePendingSurveyMarkerUi(state);
  if (!annotationId) return current;
  const newSurveyMarkersByPage = {};
  for (const [pageNumber, markers] of Object.entries(
    current.newSurveyMarkersByPage || {},
  )) {
    const remaining = (Array.isArray(markers) ? markers : []).filter(
      (marker) => String(marker?.annotationId ?? marker?.id ?? '') !== String(annotationId),
    );
    if (remaining.length > 0) newSurveyMarkersByPage[pageNumber] = remaining;
  }
  const deletingNamedMarker = matchesMarker(
    current.pendingSurveyMarkerName,
    annotationId,
  );
  return {
    newSurveyMarkersByPage,
    pendingSurveyMarker: matchesMarker(current.pendingSurveyMarker, annotationId)
      ? null
      : current.pendingSurveyMarker,
    pendingSurveyMarkerSelection: matchesMarker(
      current.pendingSurveyMarkerSelection,
      annotationId,
    )
      ? null
      : current.pendingSurveyMarkerSelection,
    pendingEntitySelection: matchesMarker(current.pendingEntitySelection, annotationId)
      ? null
      : current.pendingEntitySelection,
    pendingSurveyMarkerName: deletingNamedMarker
      ? null
      : current.pendingSurveyMarkerName,
    surveyMarkerNameInput: deletingNamedMarker
      ? null
      : current.surveyMarkerNameInput,
  };
}
