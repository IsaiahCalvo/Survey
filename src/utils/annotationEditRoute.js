/**
 * annotationEditRoute — the single source of truth for "what does a
 * double-click / double-tap open on this annotation?".
 *
 * UX contract (2026-04-19 rule, unchanged; extracted 2026-09-15 so the
 * dblclick-in-Pan entry and the Select-tool dblclick entry cannot drift):
 *   - pen / highlighter (path)              -> no editor (handles are the
 *                                              single-click chrome).
 *   - rect / circle / ellipse / triangle    -> no editor (their single-click
 *     (non-counter)                            border handles already cover
 *                                              resize + rotate).
 *   - counter                               -> 'bbox' (swap the rotation-only
 *                                              chrome for the uniform resize
 *                                              + rotate bbox).
 *   - line / arrow                          -> 'bbox'.
 *   - polygon / polyline                    -> 'bbox' (vertex handles are the
 *                                              single-click chrome).
 *   - text / textbox / i-text               -> 'text' (inline caret editor).
 *   - anything else (stamp/image/unknown)   -> no editor. KAL-125 / CD-6: the
 *                                              old else -> 'callout' fallthrough
 *                                              could mount the orphaned callout
 *                                              canvas for any unrecognised type.
 *
 * Callouts never reach here — they are routed by callout id before the
 * annotation switch runs (see handleRequestCalloutEditMode in PDFViewer).
 */

/**
 * fabric 7 serializes capitalised class types ('Textbox', 'IText') while
 * legacy fabric-5 saves store lowercase, and live instances report lowercase.
 * Normalise before comparing or fabric-7-committed text silently loses
 * double-click edit (the dispatch fell through to the unknown-type no-op).
 */
export function normalizeAnnotationEditType(rawType) {
  const lowered = String(rawType || '').toLowerCase();
  return lowered === 'itext' ? 'i-text' : lowered;
}

const NO_EDIT_SHAPE_TYPES = new Set(['rect', 'circle', 'ellipse', 'triangle']);
const TEXT_TYPES = new Set(['textbox', 'i-text', 'text']);
const BBOX_TYPES = new Set(['line', 'polygon', 'polyline']);

/**
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
  const isCounter = annotation?.data?.type === 'counter';
  const base = { annotationType, isCounter };

  if (annotationType === 'path') {
    return { ...base, editType: null, skipReason: 'stroke' };
  }
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
