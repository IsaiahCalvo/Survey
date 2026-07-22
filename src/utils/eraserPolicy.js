const normalize = (value) => String(value ?? '').trim().toLowerCase();

const hasVisiblePaint = (value) => {
  const paint = normalize(value);
  return paint !== ''
    && paint !== 'none'
    && paint !== 'transparent'
    && paint !== 'rgba(0,0,0,0)'
    && paint !== 'rgba(0, 0, 0, 0)';
};

// Pen/highlighter saves created before tool provenance was persisted used the
// Fabric PencilBrush serialization fingerprint below. Keep this deliberately
// narrower than a generic "open rounded path" guess: curves, imported marks,
// callout projections, and shape paths must remain atomic.
const isLegacyPencilBrushInk = (annotation) => {
  if (annotation.fill !== null) return false;
  if (!hasVisiblePaint(annotation.stroke) || Number(annotation.strokeWidth) <= 0) return false;
  if (annotation.strokeUniform !== true) return false;
  if (normalize(annotation.strokeLineCap) !== 'round') return false;
  if (normalize(annotation.strokeLineJoin) !== 'round') return false;
  if (Number(annotation.strokeMiterLimit) !== 10) return false;
  if (annotation.strokeDashArray != null) return false;
  if (annotation.data?.isCurved || annotation.data?.type) return false;
  if (annotation.annotationId || annotation.calloutId || annotation.isPdfImported) return false;

  const commands = annotation.path.map((command) => normalize(command?.[0]));
  return commands.length >= 3
    && commands[0] === 'm'
    && commands[commands.length - 1] === 'l'
    && commands.slice(1, -1).every((command) => command === 'q');
};

/**
 * Only true free-hand ink may be changed geometrically by the partial eraser.
 * Everything else remains an atomic annotation and is deleted as a whole.
 */
export function isPartialEraseEligible(annotation) {
  if (!annotation || normalize(annotation.type) !== 'path') return false;
  if (!Array.isArray(annotation.path) || annotation.path.length === 0) return false;

  const pdfAnnotationType = normalize(
    annotation.pdfAnnotationType ?? annotation.data?.pdfAnnotationType,
  );
  if (pdfAnnotationType) return pdfAnnotationType.replace(/^\//, '') === 'ink';

  const tool = normalize(annotation.tool ?? annotation.data?.tool);
  if (tool) return tool === 'pen' || tool === 'highlighter';

  // Known filled-outline ink survives repeated bites even if an old save lost
  // its tool field. The producer-owned geometry tag is unambiguous.
  if (
    normalize(annotation.paperInkGeometry) === 'v1'
    && Array.isArray(annotation.polygons)
    && annotation.polygons.length > 0
  ) return true;

  return isLegacyPencilBrushInk(annotation);
}

export function getEraserOperation(annotation, requestedMode) {
  if (requestedMode !== 'partial') return 'entire';
  return isPartialEraseEligible(annotation) ? 'partial' : 'entire';
}
