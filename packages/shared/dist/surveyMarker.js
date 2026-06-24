"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SURVEY_MARKER_TYPE_VALUES = exports.LEGACY_SURVEY_MARKER_TYPE = exports.SURVEY_MARKER_TYPE = void 0;
exports.isSurveyMarkerType = isSurveyMarkerType;
exports.SURVEY_MARKER_TYPE = 'survey-marker';
exports.LEGACY_SURVEY_MARKER_TYPE = 'highlight';
// Both accepted annotation_type values, for use in Supabase .in() filters.
exports.SURVEY_MARKER_TYPE_VALUES = [
    exports.SURVEY_MARKER_TYPE,
    exports.LEGACY_SURVEY_MARKER_TYPE,
];
function isSurveyMarkerType(annotationType) {
    return (annotationType === exports.SURVEY_MARKER_TYPE ||
        annotationType === exports.LEGACY_SURVEY_MARKER_TYPE);
}
//# sourceMappingURL=surveyMarker.js.map