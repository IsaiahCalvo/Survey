// Pages-panel leftover ops: Mirror V / Reset / Cut / Copy / Paste.
// Extract is not a handler — do not invent one. Wave 6 already executed
// Mirror H. Duplicate / rotate / insert / move are other receipts.

const EMPTY_TRANSFORM = { rotation: 0, mirrorH: false, mirrorV: false };

export function togglePageMirror(current = {}, pageNumber, direction) {
  const existing = current[pageNumber] || { ...EMPTY_TRANSFORM };
  const key = direction === 'horizontal' ? 'mirrorH' : 'mirrorV';
  return {
    ...current,
    [pageNumber]: {
      ...existing,
      [key]: !existing[key],
    },
  };
}

export function resetPageTransform(current = {}, pageNumber) {
  const next = { ...current };
  delete next[pageNumber];
  return next;
}

export function cssForPageTransform(transform) {
  const next = transform || EMPTY_TRANSFORM;
  const parts = [];
  if (next.rotation) parts.push(`rotate(${next.rotation}deg)`);
  if (next.mirrorH) parts.push('scaleX(-1)');
  if (next.mirrorV) parts.push('scaleY(-1)');
  return parts.length ? parts.join(' ') : 'none';
}

export function resolvePagePaste({
  sourcePageNumber,
  targetPageNumber,
  pasteType,
} = {}) {
  if (!sourcePageNumber || !pasteType) return { kind: 'ignore' };
  if (pasteType === 'cut' && sourcePageNumber === targetPageNumber) {
    return { kind: 'clear-clipboard' };
  }
  if (pasteType === 'cut') {
    return {
      kind: 'mutate',
      operation: {
        type: 'move',
        from: sourcePageNumber,
        to: sourcePageNumber <= targetPageNumber ? targetPageNumber : targetPageNumber + 1,
      },
      clearClipboard: true,
    };
  }
  if (pasteType === 'copy') {
    return {
      kind: 'mutate',
      operation: {
        type: 'copy',
        source: sourcePageNumber,
        afterPage: targetPageNumber,
      },
      clearClipboard: false,
    };
  }
  return { kind: 'ignore' };
}
