/**
 * annotationEditRoute — the ONE answer to "if the user asks this annotation to
 * open its editor, which editor opens?"
 *
 * Why this file exists
 * --------------------
 * The mapping used to live inline in PDFViewer's `onRequestEditMode`
 * (SVGAnnotationLayer double-click -> App). Drawboard PDF has no modal
 * view-vs-edit split — PAN IS A SELECTION MODE — so the same editor now opens
 * from three entries: the SVG layer's native double-click, the window-capture
 * double-tap recogniser (Pan / Text Select / every touch gesture), and the
 * edit-entry hit layer that LABELS carriers in the DOM. Forking the switch
 * would let those drift silently, which is exactly how `i-text` lost
 * double-click edit when fabric 7 started serializing capitalized class names.
 * Every caller routes through here instead.
 *
 * The mapping is DELIBERATELY identical to the pre-existing inline switch —
 * this module is an extraction, not a behaviour change:
 *   - pen / highlighter (`path`)                         -> no editor (null)
 *   - plain rect / circle / ellipse / triangle           -> no editor (null)
 *     (their single-click handles already cover resize + rotate)
 *   - counter (any base type, `data.type === 'counter'`)  -> 'bbox'
 *   - line / arrow / polygon / polyline                   -> 'bbox'
 *   - text / textbox / i-text                             -> 'text'
 *   - anything unrecognised (stamp, image, ...)           -> no editor (null)
 *     KAL-125 / CD-6: the old else -> 'callout' fallthrough could mount the
 *     orphaned callout canvas for any unrecognised type.
 *
 * Callouts never reach resolveEditTypeForAnnotation: they are not entries in
 * `annotations.objects` and are routed by callout id before the annotation
 * switch runs (handleRequestCalloutEditMode in PDFViewer).
 * `resolveEditEntryKind` DOES report 'callout' so one DOM attribute can label
 * every editor-bearing carrier on the page.
 *
 * Pure module: no React, no DOM, no imports. Safe to unit-test and safe to
 * call from a pointer handler on the hot path.
 */

/** Fabric text classes that open the inline text editor. */
export const TEXT_EDIT_ANNOTATION_TYPES = Object.freeze(['textbox', 'i-text', 'text']);

/** Types that open the uniform resize + rotate bounding-box editor. */
export const BBOX_EDIT_ANNOTATION_TYPES = Object.freeze(['line', 'polygon', 'polyline']);

/** Plain shapes whose single-click handles ARE the whole edit affordance. */
export const NO_EDITOR_SHAPE_TYPES = Object.freeze(['rect', 'circle', 'ellipse', 'triangle']);

const TEXT_TYPES = new Set(TEXT_EDIT_ANNOTATION_TYPES);
const BBOX_TYPES = new Set(BBOX_EDIT_ANNOTATION_TYPES);
const NO_EDIT_SHAPE_TYPES = new Set(NO_EDITOR_SHAPE_TYPES);

/**
 * Normalize a Fabric type string for comparison.
 *
 * fabric 7 `toObject()` emits capitalized class names ('Textbox', 'IText',
 * 'Path') while live instances and legacy fabric-5 saves store lowercase, and
 * 'IText' lowercases to 'itext' rather than the 'i-text' the rest of the app
 * uses. Normalise before comparing or fabric-7-committed text silently loses
 * double-click edit. See CLAUDE.md 2026-07-08 gotcha (3).
 *
 * @param {string|undefined|null} rawType
 * @returns {string} lowercase, hyphen-normalized type ('' when absent)
 */
export function normalizeAnnotationEditType(rawType) {
  const lowered = String(rawType || '').toLowerCase();
  return lowered === 'itext' ? 'i-text' : lowered;
}

/**
 * True when the annotation is a counter (the pin + number composite). Counters
 * are stored with a shape base type but carry `data.type === 'counter'`.
 *
 * @param {object|null|undefined} annotation
 */
export function isCounterAnnotation(annotation) {
  return annotation?.data?.type === 'counter';
}

/**
 * Which editor a double-click / double-tap on this annotation should open.
 *
 * @param {object|null} annotation  the serialized annotation object
 * @param {string} [rawType]        the type reported by the caller; falls back
 *                                  to annotation.type
 * @returns {{annotationType: string, isCounter: boolean, editType: 'text'|'bbox'|null, skipReason: string|null}}
 *          editType null means "no editor for this annotation" — the caller
 *          must no-op, never fall through to another edit host.
 */
export function resolveEditTypeForAnnotation(annotation, rawType) {
  const annotationType = normalizeAnnotationEditType(
    rawType != null ? rawType : annotation?.type,
  );
  const isCounter = isCounterAnnotation(annotation);
  const base = { annotationType, isCounter };

  // Pen / highlighter strokes have no second-level editor.
  if (annotationType === 'path') {
    return { ...base, editType: null, skipReason: 'stroke' };
  }
  // A counter keeps its bbox editor even though its base type is a shape, so
  // the plain-shape bail-out must run AFTER the counter check.
  if (!isCounter && NO_EDIT_SHAPE_TYPES.has(annotationType)) {
    return { ...base, editType: null, skipReason: 'non-counter shape' };
  }
  if (TEXT_TYPES.has(annotationType)) {
    return { ...base, editType: 'text', skipReason: null };
  }
  if (isCounter || BBOX_TYPES.has(annotationType)) {
    return { ...base, editType: 'bbox', skipReason: null };
  }
  return { ...base, editType: null, skipReason: 'unhandled type' };
}

/**
 * True when double-clicking this annotation opens the inline caret editor.
 * Used by the Pan / Text Select double-tap entry to decide whether a tap pair
 * is worth routing at all (bbox edits have their own mobile action-strip
 * entry and must not steal a pan double-tap).
 */
export function opensTextEditor(annotation, rawType) {
  return resolveEditTypeForAnnotation(annotation, rawType).editType === 'text';
}

/**
 * A short, stable label for what KIND of editor carrier this annotation is.
 * Stamped onto the SVG carrier as `data-edit-entry-kind` so a pointer handler
 * can route straight off the DOM without re-deriving from the model, and so
 * tests / the browser pane can assert "the Pan hit layer exists" by selector.
 *
 * 'text'    -> inline text editing (Drawboard: double-click opens a caret)
 * 'counter' -> bbox editor
 * 'line'    -> bbox editor (line + arrow share the Fabric `line` type)
 * 'poly'    -> bbox editor (polygon + polyline)
 * 'callout' -> callout editor (routed through handleRequestCalloutEditMode)
 * null      -> not editor-bearing; no attribute is emitted
 *
 * @param {object|null|undefined} annotation
 * @returns {'text'|'counter'|'line'|'poly'|'callout'|null}
 */
export function resolveEditEntryKind(annotation) {
  if (!annotation) return null;
  const { annotationType, editType } = resolveEditTypeForAnnotation(annotation);
  if (editType == null) return null;
  if (TEXT_TYPES.has(annotationType)) return 'text';
  if (isCounterAnnotation(annotation)) return 'counter';
  if (annotationType === 'line') return 'line';
  if (annotationType === 'polygon' || annotationType === 'polyline') return 'poly';
  return null;
}

/**
 * Convenience predicate — "does a double-click on this annotation do anything?"
 *
 * @param {object|null|undefined} annotation
 * @returns {boolean}
 */
export function isEditEntryAnnotation(annotation) {
  return resolveEditEntryKind(annotation) != null;
}
