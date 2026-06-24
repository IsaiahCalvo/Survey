// Survey Marker type identity.
//
// The single source of truth now lives in the shared package
// (packages/shared/src/surveyMarker.ts → @survey/shared) so the desktop and
// mobile apps agree on these values. This file is kept as a thin re-export so
// the existing desktop imports of '../utils/surveyMarkerType.js' keep working
// unchanged.

export {
  SURVEY_MARKER_TYPE,
  LEGACY_SURVEY_MARKER_TYPE,
  SURVEY_MARKER_TYPE_VALUES,
  isSurveyMarkerType,
} from '@survey/shared';
