// Pure helpers for Flattened PDF export (#1769).
//
// On-screen, Survey mode isolates Survey markers from ordinary drawn marks
// (#1613) and browser Print mirrors what is on screen. Flattened PDF export
// ("Export PDF… > Flattened") burns in every visible/checked layer's marks —
// both Survey markers AND drawn marks/callouts — regardless of whether the
// user is currently in Survey mode or normal mode.

import { surveyMarkerRenderEntry } from './surveyMarkerFamily.js';
import { calloutsWithoutHiddenLayers, withoutHiddenLayers } from './layers.js';

/**
 * Style every Survey marker with its resolved entity color / needsEntity state
 * for PDF export, without filtering by the active UI Survey mode or module.
 */
export function buildExportableSurveyMarkers(
  surveyMarkers = {},
  { normalizeColor = null, resolveRenderEntry = surveyMarkerRenderEntry } = {},
) {
  const result = {};
  for (const [annotationId, marker] of Object.entries(surveyMarkers || {})) {
    if (!marker || typeof marker !== 'object') continue;
    const entry = resolveRenderEntry(annotationId, marker, normalizeColor);
    result[annotationId] = {
      ...marker,
      annotationId,
      color: entry ? (entry.color || null) : (marker?.color || null),
      needsEntity: entry ? entry.needsEntity === true : marker?.needsEntity === true,
    };
  }
  return result;
}

/**
 * Build the mode-independent mark bundle for Flattened PDF export: all drawn
 * marks and callouts not on hidden layers, plus all styled Survey markers.
 */
export function buildFlattenedExportMarks({
  annotationsByPage = {},
  callouts = [],
  surveyMarkers = {},
  hiddenLayerIds = null,
  normalizeSurveyMarkerColor = null,
} = {}) {
  return {
    annotationsByPage: withoutHiddenLayers(annotationsByPage || {}, hiddenLayerIds),
    callouts: calloutsWithoutHiddenLayers(callouts || [], hiddenLayerIds),
    surveyMarkers: buildExportableSurveyMarkers(surveyMarkers, {
      normalizeColor: normalizeSurveyMarkerColor,
    }),
  };
}
