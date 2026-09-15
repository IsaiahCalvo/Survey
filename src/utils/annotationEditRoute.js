/**
 * annotationEditRoute — the ONE answer to "if the user asks this annotation to
 * open its editor, which editor opens?"
 *
 * Why this file exists
 * --------------------
 * Until now the mapping lived inline in PDFViewer's `onRequestEditMode`
 * (SVGAnnotationLayer double-click -> App). Drawboard PDF opens the SAME editor
 * from Pan as it does from Select (Pan/Select interaction contract: "Drawboard
 * has no modal view-vs-edit split - PAN IS A SELECTION MODE"), so a second
 * entry point now needs the same mapping. Forking the switch would let the two
 * entry points drift silently, which is exactly how `i-text` lost double-click
 * edit when fabric 7 started serializing capitalized class names. Every caller
 * routes through here instead.
 *
 * The mapping is DELIBERATELY identical to the pre-existing inline switch -
 * this module is an extraction, not a behaviour change:
 *   - pen / highlighter (`path`)                         -> no editor (null)
 *   - plain rect / circle / ellipse / triangle            -> no editor (null)
 *     (their single-click handles already cover resize + rotate)
 *   - counter (any base type, `data.type === 'counter'`)  -> 'bbox'
 *   - line / arrow / polygon / polyline                   -> 'bbox'
 *   - text / textbox / i-text                             -> 'text'
 *   - anything unrecognised (stamp, image, ...)           -> no editor (null)
 * Callouts never reach resolveEditTypeForAnnotation: they are not entries in
 * `annotations.objects` and route through `handleRequestCalloutEditMode`.
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

/**
 * Normalize a Fabric type string for comparison.
 *
 * fabric 7 `toObject()` emits capitalized class names ('Textbox', 'IText',
 * 'Path') while live instances and legacy fabric-5 saves store lowercase, and
 * 'IText' lowercases to 'itext' rather than the 'i-text' the rest of the app
 * uses. See CLAUDE.md 2026-07-08 gotcha (3).
 *
 * @param {string|undefined|null} type
 * @returns {string} lowercase, hyphen-normalized type ('' when absent)
 */
export function normalizeAnnotationTypeForEdit(type) {
  const lowered = String(type || '').toLowerCase();
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
 * @param {object|null|undefined} annotation Fabric-serialized annotation object
 * @returns {'text'|'bbox'|null} null means "no editor - do nothing"
 */
export function resolveEditTypeForAnnotation(annotation) {
  if (!annotation) return null;
  const type = normalizeAnnotationTypeForEdit(annotation.type);
  const isCounter = isCounterAnnotation(annotation);
  // Pen / highlighter strokes have no second-level editor.
  if (type === 'path') return null;
  // A counter keeps its bbox editor even though its base type is a shape, so
  // the plain-shape bail-out must run AFTER the counter check.
  if (!isCounter && NO_EDITOR_SHAPE_TYPES.includes(type)) return null;
  if (TEXT_EDIT_ANNOTATION_TYPES.includes(type)) return 'text';
  if (isCounter || BBOX_EDIT_ANNOTATION_TYPES.includes(type)) return 'bbox';
  // KAL-125 / CD-6: unknown type (stamp / image / ...) is an explicit no-op.
  return null;
}

/**
 * A short, stable label for what KIND of editor carrier this annotation is.
 * Stamped onto the SVG carrier as `data-edit-entry-kind` so a pointer handler
 * can route straight off the DOM without re-deriving from the model, and so
 * tests / the browser pane can assert "the Pan hit layer exists" by selector.
 *
 * 'text'    -> inline text editing (Drawboard: double-click opens a textarea)
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
  const type = normalizeAnnotationTypeForEdit(annotation.type);
  if (resolveEditTypeForAnnotation(annotation) == null) return null;
  if (TEXT_EDIT_ANNOTATION_TYPES.includes(type)) return 'text';
  if (isCounterAnnotation(annotation)) return 'counter';
  if (type === 'line') return 'line';
  if (type === 'polygon' || type === 'polyline') return 'poly';
  return null;
}

/**
 * Convenience predicate - "does a double-click on this annotation do anything?"
 *
 * @param {object|null|undefined} annotation
 * @returns {boolean}
 */
export function isEditEntryAnnotation(annotation) {
  return resolveEditEntryKind(annotation) != null;
}
