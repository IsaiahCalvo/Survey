export declare const ANNOTATION_TYPES: readonly ["survey-marker", "ink", "freetext", "square", "circle", "line", "polyline", "polygon", "stamp", "sticky_note", "callout", "counter", "eraser", "form-field"];
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export declare const SUPPORTED_DB_TYPES: ReadonlySet<AnnotationType>;
export declare function isSupportedAnnotationType(value: string): value is AnnotationType;
//# sourceMappingURL=annotationTypes.d.ts.map