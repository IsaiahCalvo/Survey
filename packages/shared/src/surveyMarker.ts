// Survey Marker type identity.
//
// A Survey Marker is an area drawn in Survey mode over a real element of the
// drawing, tagged with one Category and one Entity (see CONTEXT.md). It was
// previously called a "Survey Highlight". In the database its annotation_type
// is 'survey-marker'; rows created before the rename carry the legacy value
// 'highlight'. Always test the type through isSurveyMarkerType so both are
// recognised.
//
// Ported verbatim from src/utils/surveyMarkerType.js — single source of truth
// for desktop + mobile.

export const SURVEY_MARKER_TYPE = 'survey-marker';
export const LEGACY_SURVEY_MARKER_TYPE = 'highlight';

// Both accepted annotation_type values, for use in Supabase .in() filters.
export const SURVEY_MARKER_TYPE_VALUES: readonly string[] = [
  SURVEY_MARKER_TYPE,
  LEGACY_SURVEY_MARKER_TYPE,
];

export function isSurveyMarkerType(
  annotationType: string | null | undefined,
): boolean {
  return (
    annotationType === SURVEY_MARKER_TYPE ||
    annotationType === LEGACY_SURVEY_MARKER_TYPE
  );
}
