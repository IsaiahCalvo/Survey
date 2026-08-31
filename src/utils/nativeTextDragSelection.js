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

const distanceToRect = (rect, clientX, clientY) => Math.hypot(
  Math.max(rect.left - clientX, 0, clientX - rect.right),
  Math.max(rect.top - clientY, 0, clientY - rect.bottom),
);

const geometryBoundaryFromPoint = (documentRef, root, clientX, clientY) => {
  if (!root?.querySelectorAll || !documentRef?.createRange) return null;
  let nearestSpan = null;
  for (const span of root.querySelectorAll('span')) {
    const node = Array.from(span.childNodes || [])
      .find((child) => child.nodeType === 3 && String(child.nodeValue || '').trim());
    const rect = span.getBoundingClientRect?.();
    if (!node || !rect || (!rect.width && !rect.height)) continue;
    const distance = distanceToRect(rect, clientX, clientY);
    if (!nearestSpan || distance < nearestSpan.distance) nearestSpan = { distance, node };
  }
  if (!nearestSpan || nearestSpan.distance > 32) return null;

  let best = null;
  for (const node of [nearestSpan.node]) {
    const text = String(node.nodeValue || '');
    if (!text.trim()) continue;
    for (let offset = 0; offset < text.length; offset += 1) {
      try {
        const range = documentRef.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect?.();
        if (!rect || (!rect.width && !rect.height)) continue;
        const distance = distanceToRect(rect, clientX, clientY);
        if (best && distance >= best.distance) continue;
        const vertical = rect.height > rect.width * 1.5;
        const after = vertical
          ? clientY >= rect.top + rect.height / 2
          : clientX >= rect.left + rect.width / 2;
        best = { distance, node, offset: offset + (after ? 1 : 0) };
      } catch { /* skip an invalid glyph range */ }
    }
  }
  return best && best.distance <= 32
    ? { node: best.node, offset: best.offset }
    : null;
};

export function getCaretBoundaryFromClientPoint(documentRef, clientX, clientY, root = null) {
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
  const nativeLayer = interactiveTextLayerForNode(node);
  if (node && nativeLayer && (!root || (root === nativeLayer && node !== root))) {
    return { node, offset: clampBoundaryOffset(node, offset) };
  }
  return geometryBoundaryFromPoint(documentRef, root, clientX, clientY);
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

export function captureNativeSelectionSnapshot(selection) {
  if (!selection) return null;
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    rangeCount: selection.rangeCount,
    isCollapsed: selection.isCollapsed,
  };
}

const selectionMatchesSnapshot = (selection, snapshot) => Boolean(
  snapshot
  && selection.anchorNode === snapshot.anchorNode
  && selection.anchorOffset === snapshot.anchorOffset
  && selection.focusNode === snapshot.focusNode
  && selection.focusOffset === snapshot.focusOffset
  && selection.rangeCount === snapshot.rangeCount
  && selection.isCollapsed === snapshot.isCollapsed
);

// Chromium can paint and hit a rotated pdf.js span correctly, yet still leave
// the browser Selection empty or unchanged at pointerup. Keep native selection
// as the main path; only rebuild the Range when this drag did not create one.
export function repairCollapsedTextDragSelection({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  selectionSnapshot,
  startBoundary,
  endClientPoint,
} = {}) {
  const selection = windowRef?.getSelection?.();
  if (!selection) return false;
  const hasNativeRange = !selection.isCollapsed && String(selection.toString() || '').length > 0;
  if (hasNativeRange && !selectionMatchesSnapshot(selection, selectionSnapshot)) return false;
  const textLayer = interactiveTextLayerForNode(startBoundary?.node);
  if (!startBoundary || !textLayer) return false;
  const endBoundary = getCaretBoundaryFromClientPoint(
    documentRef,
    Number(endClientPoint?.x),
    Number(endClientPoint?.y),
    textLayer,
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
