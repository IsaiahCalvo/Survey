// Survey Marker type identity.
//
// A Survey Marker is an area drawn in Survey mode over a real element of the
// drawing, tagged with one Category and one Entity (see CONTEXT.md). It was
// previously called a "Survey Highlight". In the database its annotation_type
// is 'survey-marker'; rows created before the rename carry the legacy value
// 'highlight'. Always test the type through isSurveyMarkerType so both are
// recognised.

export const SURVEY_MARKER_TYPE = 'survey-marker';
export const LEGACY_SURVEY_MARKER_TYPE = 'highlight';

export function isSurveyMarkerType(annotationType) {
  return annotationType === SURVEY_MARKER_TYPE
    || annotationType === LEGACY_SURVEY_MARKER_TYPE;
}
