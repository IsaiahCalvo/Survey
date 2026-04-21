/**
 * Pure attribute derivation for path-type Fabric objects rendered as SVG
 * <path> elements. Extracted from src/utils/svgAnnotationRenderers.jsx so
 * node-test (.mjs) suites can import it without pulling JSX through the
 * Node loader. Same pattern as src/components/propertiesPanelShape.js.
 *
 * UX 2026-04-21 (import-normalization Chunk 2): this is the single source
 * of truth for what visual attributes a path annotation renders with.
 * There are NO provenance-conditional branches here — imported Ink and
 * internally-drawn pen strokes produce identical attrs when their
 * behavior-gating Fabric fields match. The parity test in
 * tests/pdfAnnotationNormalization.test.mjs asserts that invariant.
 *
 * If a future regression needs a provenance-aware visual change, update
 * nativeShapeFactory AND convertInkToFabricPath to propagate the new
 * field symmetrically — never branch on isPdfImported in the renderer.
 */

/**
 * Derive the visual SVG attributes for a Fabric path object.
 *
 * @param {object} obj Fabric path JSON (partial — tolerates missing fields).
 * @returns {{ stroke: string, strokeWidth: number, fill: string, strokeLinecap: string, strokeLinejoin: string, vectorEffect: string | undefined, opacity: number }}
 */
export function renderPathToSvgAttrs(obj) {
  return {
    stroke: obj.stroke ?? '#000',
    strokeWidth: obj.strokeWidth ?? 1,
    fill: obj.fill ?? 'none',
    strokeLinecap: obj.strokeLineCap ?? 'round',
    strokeLinejoin: obj.strokeLineJoin ?? 'round',
    // UX 2026-04-21: vectorEffect="non-scaling-stroke" is emitted only
    // when the Fabric object explicitly sets strokeUniform=true. Imported
    // Ink used to set it always; that was the zoom-gap-on-imports bug.
    // Internal pen strokes leave it undefined, producing no vectorEffect.
    vectorEffect: obj.strokeUniform ? 'non-scaling-stroke' : undefined,
    opacity: obj.opacity ?? 1,
  };
}
