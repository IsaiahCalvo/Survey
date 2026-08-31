const interactiveTextLayerForNode = (node) => {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return element?.closest?.('.pdfjsTextLayer.is-interactive') || null;
};

const clampBoundaryOffset = (node, rawOffset) => {
  const maximum = node?.nodeType === 3
    ? String(node.nodeValue || '').length
    : Number(node?.childNodes?.length || 0);
  return Math.max(0, Math.min(maximum, Number(rawOffset) || 0));
};

export function getCaretBoundaryFromClientPoint(documentRef, clientX, clientY) {
  if (!documentRef || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  let node = null;
  let offset = 0;
  try {
    const position = documentRef.caretPositionFromPoint?.(clientX, clientY);
    node = position?.offsetNode || null;
    offset = position?.offset;
  } catch { /* use the WebKit fallback */ }
  if (!node) {
    try {
      const range = documentRef.caretRangeFromPoint?.(clientX, clientY);
      node = range?.startContainer || null;
      offset = range?.startOffset;
    } catch { /* unsupported point */ }
  }
  if (!node || !interactiveTextLayerForNode(node)) return null;
  return { node, offset: clampBoundaryOffset(node, offset) };
}

const collapsedRangeAt = (documentRef, boundary) => {
  const range = documentRef.createRange();
  range.setStart(boundary.node, boundary.offset);
  range.collapse(true);
  return range;
};

const orderedBoundaries = (documentRef, first, second) => {
  if (first.node === second.node) {
    return first.offset <= second.offset ? [first, second] : [second, first];
  }
  const firstRange = collapsedRangeAt(documentRef, first);
  const secondRange = collapsedRangeAt(documentRef, second);
  return firstRange.compareBoundaryPoints(0, secondRange) <= 0
    ? [first, second]
    : [second, first];
};

// Chromium can paint and hit a rotated pdf.js span correctly, yet still leave
// the browser Selection empty at pointerup. Keep native selection as the main
// path; only rebuild the same browser Range from the two caret hit points when
// that native path failed.
export function repairCollapsedTextDragSelection({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  startBoundary,
  endClientPoint,
} = {}) {
  const selection = windowRef?.getSelection?.();
  if (!selection || (!selection.isCollapsed && String(selection.toString() || '').length > 0)) return false;
  if (!startBoundary || !interactiveTextLayerForNode(startBoundary.node)) return false;
  const endBoundary = getCaretBoundaryFromClientPoint(
    documentRef,
    Number(endClientPoint?.x),
    Number(endClientPoint?.y),
  );
  if (!endBoundary) return false;
  try {
    const [start, end] = orderedBoundaries(documentRef, startBoundary, endBoundary);
    if (start.node === end.node && start.offset === end.offset) return false;
    const range = documentRef.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (!String(range.toString() || '').length) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    documentRef.dispatchEvent?.(new windowRef.Event('selectionchange'));
    return !selection.isCollapsed;
  } catch {
    return false;
  }
}
