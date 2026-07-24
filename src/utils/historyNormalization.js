const TRANSIENT_HISTORY_KEYS = new Set([
  '_originalHasControls',
  '_originalHasBorders',
  '_lastLeft',
  '_lastTop',
  '_dragSessionId',
  'hasBorders',
  'hasControls',
  'lockMovementX',
  'lockMovementY',
  'lockScalingFlip',
  'perPixelTargetFind',
  'targetFindTolerance',
  'hoverCursor',
  'moveCursor',
  'selectable',
  'evented',
  'dirty',
  'cacheKey',
  'isMoving',
]);

export function normalizeCanvasJsonForHistory(value) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;

    const normalized = {};
    Object.entries(node).forEach(([key, child]) => {
      if (!TRANSIENT_HISTORY_KEYS.has(key)) normalized[key] = walk(child);
    });

    if (normalized.partType === 'knee' || normalized.partType === 'arrowTip') {
      normalized.opacity = 0;
    }

    return normalized;
  };

  return walk(value);
}
