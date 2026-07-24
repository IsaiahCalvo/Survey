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
