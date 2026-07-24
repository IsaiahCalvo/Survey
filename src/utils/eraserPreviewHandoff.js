const revision = (value) => String(value ?? '');

/**
 * Chooses a bitmap baseline without flashing an older worker render between
 * rapid eraser gestures.
 */
export function selectEraserPreviewBaseline({
  expectedRevision,
  sourceRevision,
  previewRevision,
  previewVisible,
} = {}) {
  const expected = revision(expectedRevision);
  const source = revision(sourceRevision);
  const preview = revision(previewRevision);

  if (previewVisible && expected && preview === expected) return 'preview';
  if (!expected || source === expected) return 'source';
  return previewVisible ? 'preview' : 'source';
}

/**
 * Decide when the carved preview can be replaced by committed annotations.
 * Source removal is itself the final paint signal when an erase empties a
 * page. SVG-clone sessions can release as soon as the exact hidden SVG lands;
 * bitmap fallback sessions also wait for their matching canvas paint.
 */
export function isEraserPreviewFinishReady({
  expectedRevision,
  waitForNextPaint,
  finalSvgRevision,
  maskClone,
  hadSourceAtRelease,
  hasCurrentSource,
  canvasRevision,
  baselinePaintGeneration,
  currentPaintGeneration,
} = {}) {
  if (!waitForNextPaint) return true;
  if (hadSourceAtRelease && !hasCurrentSource) return true;

  const expected = revision(expectedRevision);
  const finalSvgReady = !expected || revision(finalSvgRevision) === expected;
  if (maskClone && expected && finalSvgReady) return true;

  const canvasReady = expected
    ? revision(canvasRevision) === expected
    : revision(currentPaintGeneration) !== revision(baselinePaintGeneration);
  return finalSvgReady && canvasReady;
}
