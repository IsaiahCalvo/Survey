const revision = (value) => String(value ?? '');

// A missing paint must not keep an exact-repaint observer pending forever.
// Reaching this bound does NOT reveal the stale real layer: the presentation
// enters a safe hold with its exact carved SVG clone still visible.
export const ERASER_PREVIEW_HANDOFF_BOUND_MS = 1000;

export function nextEraserPreviewHandoffState(state, event) {
  switch (event) {
    case 'commit':
      return state === 'active' ? 'waiting' : state;
    case 'exact-paint':
      return state === 'waiting' || state === 'safe-hold' ? 'ready' : state;
    case 'bound':
      return state === 'waiting' ? 'safe-hold' : state;
    case 'cancel':
    case 'unmount':
      return 'idle';
    default:
      return state;
  }
}

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
 * Source removal is not a paint signal, including when an erase empties a
 * page. SVG-clone sessions release only when the exact hidden SVG revision
 * lands; legacy bitmap sessions also wait for their matching canvas paint.
 */
export function isEraserPreviewFinishReady({
  expectedRevision,
  waitForNextPaint,
  finalSvgRevision,
  maskClone,
  canvasRevision,
  baselinePaintGeneration,
  currentPaintGeneration,
} = {}) {
  if (!waitForNextPaint) return true;

  const expected = revision(expectedRevision);
  const finalSvgReady = !expected || revision(finalSvgRevision) === expected;
  if (maskClone && expected && finalSvgReady) return true;

  const canvasReady = expected
    ? revision(canvasRevision) === expected
    : revision(currentPaintGeneration) !== revision(baselinePaintGeneration);
  return finalSvgReady && canvasReady;
}
