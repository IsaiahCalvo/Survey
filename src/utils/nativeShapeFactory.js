/**
 * Single source of truth for native Fabric object defaults per shape type.
 * Any import converter and any drawing component must produce objects that
 * match these specs field-for-field, excluding provenance fields
 * (isPdfImported, pdfAnnotationId, pdfAnnotationType) which survive as
 * metadata only.
 *
 * Tested via tests/pdfAnnotationNormalization.test.mjs — asserts imported
 * annotations match internal-drawn equivalents for behavior-gating fields.
 *
 * UX 2026-04-21: Created as part of import-normalization Chunk 2 to
 * eliminate the zoom-gap-on-imports bug (imports had strokeUniform=true,
 * internal pen strokes had it undefined — the SVG renderer translated the
 * former into vectorEffect="non-scaling-stroke", producing a hairline
 * split at 200% zoom visible only on imports).
 */

export function makeInternalPenPathSpec({ stroke = '#000000', strokeWidth = 1 } = {}) {
  return {
    type: 'path',
    stroke,
    strokeWidth,
    fill: null,
    // UX intent: pen strokes scale naturally with zoom — never non-scaling.
    // Setting strokeUniform undefined (by omission) matches the internal
    // FabricDrawingCanvas behavior; imported Ink used to set it to true,
    // which produced a vectorEffect mismatch at 200% zoom.
    strokeUniform: undefined,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  };
}
