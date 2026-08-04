export function resolvePinchCommitCursor(gesture) {
  return {
    x: Number.isFinite(gesture?.currentCursorX) ? gesture.currentCursorX : gesture?.originCursorX,
    y: Number.isFinite(gesture?.currentCursorY) ? gesture.currentCursorY : gesture?.originCursorY,
  };
}

export function resolvePinchEndTransition(mode, remainingTouchCount) {
  const remaining = Math.max(0, Number(remainingTouchCount) || 0);
  if (mode === 'pinch') {
    return { commit: true, nextMode: remaining > 0 ? 'pinch-release' : null };
  }
  if (mode === 'pinch-release') {
    return { commit: false, nextMode: remaining > 0 ? 'pinch-release' : null };
  }
  return { commit: false, nextMode: mode || null };
}
