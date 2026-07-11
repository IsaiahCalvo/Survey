const normalize = (value) => String(value ?? '').trim().toLowerCase();

const hasVisiblePaint = (value) => {
  const paint = normalize(value);
  return paint !== ''
    && paint !== 'none'
    && paint !== 'transparent'
    && paint !== 'rgba(0,0,0,0)'
    && paint !== 'rgba(0, 0, 0, 0)';
};

const isLegacyFreehandPath = (annotation) => {
  if (hasVisiblePaint(annotation.fill)) return false;
  if (!hasVisiblePaint(annotation.stroke) || Number(annotation.strokeWidth) <= 0) return false;
  if (normalize(annotation.strokeLineCap) !== 'round') return false;
  if (normalize(annotation.strokeLineJoin) !== 'round') return false;
  if (annotation.path.some((command) => normalize(command?.[0]) === 'z')) return false;
  const drawableCommands = annotation.path.filter((command) => (
    ['l', 'q', 'c'].includes(normalize(command?.[0]))
  ));
  return drawableCommands.length >= 1
    || drawableCommands.some((command) => ['q', 'c'].includes(normalize(command?.[0])));
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
  return isLegacyFreehandPath(annotation);
}

export function getEraserOperation(annotation, requestedMode) {
  if (requestedMode !== 'partial') return 'entire';
  return isPartialEraseEligible(annotation) ? 'partial' : 'entire';
}
