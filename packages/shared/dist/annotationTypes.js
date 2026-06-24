"use strict";
// Annotation type identity — the canonical `annotation_type` values stored in
// the document_annotations table.
//
// The value list is kept in lock-step with SUPPORTED_DB_TYPES in
// src/services/annotationTypeSerializers.js. Sharing it here gives desktop and
// mobile one source of truth for the annotation-type vocabulary.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_DB_TYPES = exports.ANNOTATION_TYPES = void 0;
exports.isSupportedAnnotationType = isSupportedAnnotationType;
exports.ANNOTATION_TYPES = [
    'survey-marker',
    'ink',
    'freetext',
    'square',
    'circle',
    'line',
    'polyline',
    'polygon',
    'stamp',
    'sticky_note',
    'callout',
    'counter',
    'eraser',
    'form-field',
];
// Set form, mirrors SUPPORTED_DB_TYPES in annotationTypeSerializers.js.
exports.SUPPORTED_DB_TYPES = new Set(exports.ANNOTATION_TYPES);
function isSupportedAnnotationType(value) {
    return exports.SUPPORTED_DB_TYPES.has(value);
}
//# sourceMappingURL=annotationTypes.js.map