import { isEndOfContentNode } from './textLayerEndOfContent.js';

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

const glyphBoundaryInNode = (documentRef, node, clientX, clientY, maxDistance = 32, spanRect = null) => {
  const text = String(node?.nodeValue || '');
  if (!text.trim()) return null;
  const spanVertical = Boolean(
    spanRect
    && text.trim().length > 1
    && spanRect.height > spanRect.width * 1.5
  );
  let best = null;
  for (let offset = 0; offset < text.length; offset += 1) {
    try {
      const range = documentRef.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect?.();
      if (!rect || (!rect.width && !rect.height)) continue;
      const distance = distanceToRect(rect, clientX, clientY);
      if (best && distance >= best.distance) continue;
      const vertical = spanRect ? spanVertical : rect.height > rect.width * 1.5;
      const after = vertical
        ? clientY >= rect.top + rect.height / 2
        : clientX >= rect.left + rect.width / 2;
      best = { distance, node, offset: offset + (after ? 1 : 0) };
    } catch { /* skip an invalid glyph range */ }
  }
  return best && best.distance <= maxDistance
    ? { node: best.node, offset: best.offset }
    : null;
};

const spanTextEntries = (root) => {
  if (!root?.querySelectorAll) return [];
  const entries = [];
  for (const span of root.querySelectorAll('span')) {
    const node = Array.from(span.childNodes || [])
      .find((child) => child.nodeType === 3 && String(child.nodeValue || '').trim());
    const rect = span.getBoundingClientRect?.();
    if (!node || !rect || (!rect.width && !rect.height)) continue;
    entries.push({ span, node, rect });
  }
  return entries;
};

const geometryBoundaryFromPoint = (documentRef, root, clientX, clientY) => {
  if (!root?.querySelectorAll || !documentRef?.createRange) return null;
  let nearestSpan = null;
  for (const { node, rect } of spanTextEntries(root)) {
    const distance = distanceToRect(rect, clientX, clientY);
    if (!nearestSpan || distance < nearestSpan.distance) nearestSpan = { distance, node, rect };
  }
  if (!nearestSpan || nearestSpan.distance > 32) return null;
  return glyphBoundaryInNode(documentRef, nearestSpan.node, clientX, clientY, 32, nearestSpan.rect);
};

const rawCaretFromPoint = (documentRef, clientX, clientY) => {
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
  return { node, offset };
};

const isBlankTextLayerHit = (node, root) => Boolean(
  !node
  || node === root
  || isEndOfContentNode(node)
  || (root && typeof node.contains === 'function' && node.contains(root))
);

const isSameBand = (rect, anchorRect, vertical) => {
  if (!anchorRect) return false;
  if (!vertical) {
    const midY = (rect.top + rect.bottom) / 2;
    const anchorMidY = (anchorRect.top + anchorRect.bottom) / 2;
    return (
      midY >= anchorRect.top - 2 && midY <= anchorRect.bottom + 2
      && anchorMidY >= rect.top - 2 && anchorMidY <= rect.bottom + 2
    );
  }
  const midX = (rect.left + rect.right) / 2;
  const anchorMidX = (anchorRect.left + anchorRect.right) / 2;
  return (
    midX >= anchorRect.left - 2 && midX <= anchorRect.right + 2
    && anchorMidX >= rect.left - 2 && anchorMidX <= rect.right + 2
  );
};

// When a drag ends past a word onto blank paper (>32px from the glyph span),
// resolve the outermost glyph crossed on that same line without jumping to
// neighbouring lines above or below (#1668, #1669).
const sameLineOvershootBoundary = (documentRef, root, anchorBoundary, startClientPoint, endClientPoint) => {
  const endX = Number(endClientPoint?.x);
  const endY = Number(endClientPoint?.y);
  if (!root || !documentRef?.createRange || !Number.isFinite(endX) || !Number.isFinite(endY)) return null;
  const anchorEl = anchorBoundary?.node?.nodeType === 3
    ? anchorBoundary.node.parentElement
    : anchorBoundary?.node;
  const anchorRect = anchorEl?.getBoundingClientRect?.();
  const vertical = Boolean(anchorRect && anchorRect.height > anchorRect.width * 1.5);
  const startX = Number.isFinite(Number(startClientPoint?.x))
    ? Number(startClientPoint.x)
    : (anchorRect ? (anchorRect.left + anchorRect.right) / 2 : endX);
  const startY = Number.isFinite(Number(startClientPoint?.y))
    ? Number(startClientPoint.y)
    : (anchorRect ? (anchorRect.top + anchorRect.bottom) / 2 : endY);
  const anchorPad = anchorRect
    ? Math.min(3, Math.max(1, (vertical ? anchorRect.width : anchorRect.height) * 0.2))
    : 0;
  const endNearAnchorBand = Boolean(
    anchorRect && (!vertical
      ? (endY >= anchorRect.top - anchorPad && endY <= anchorRect.bottom + anchorPad)
      : (endX >= anchorRect.left - anchorPad && endX <= anchorRect.right + anchorPad))
  );

  let chosen = null;
  let chosenOnAnchorLine = false;
  const isBetter = (onAnchorLine, isFurther) => {
    if (!chosen) return true;
    if (onAnchorLine !== chosenOnAnchorLine) return onAnchorLine;
    return isFurther;
  };
  for (const entry of spanTextEntries(root)) {
    const { rect } = entry;
    const onAnchorLine = isSameBand(rect, anchorRect, vertical);
    if (!vertical) {
      const containsEnd = endY >= rect.top && endY <= rect.bottom;
      if (!containsEnd && !(onAnchorLine && endNearAnchorBand)) continue;
      if (endX > startX) {
        const minX = Math.min(startX, anchorRect ? anchorRect.left : startX) - 8;
        if (rect.left > endX || rect.right < minX) continue;
        if (isBetter(onAnchorLine, !chosen || rect.right > chosen.rect.right)) {
          chosen = entry;
          chosenOnAnchorLine = onAnchorLine;
        }
      } else if (endX < startX) {
        const maxX = Math.max(startX, anchorRect ? anchorRect.right : startX) + 8;
        if (rect.right < endX || rect.left > maxX) continue;
        if (isBetter(onAnchorLine, !chosen || rect.left < chosen.rect.left)) {
          chosen = entry;
          chosenOnAnchorLine = onAnchorLine;
        }
      }
    } else {
      const containsEnd = endX >= rect.left && endX <= rect.right;
      if (!containsEnd && !(onAnchorLine && endNearAnchorBand)) continue;
      if (endY > startY) {
        const minY = Math.min(startY, anchorRect ? anchorRect.top : startY) - 8;
        if (rect.top > endY || rect.bottom < minY) continue;
        if (isBetter(onAnchorLine, !chosen || rect.bottom > chosen.rect.bottom)) {
          chosen = entry;
          chosenOnAnchorLine = onAnchorLine;
        }
      } else if (endY < startY) {
        const maxY = Math.max(startY, anchorRect ? anchorRect.bottom : startY) + 8;
        if (rect.bottom < endY || rect.top > maxY) continue;
        if (isBetter(onAnchorLine, !chosen || rect.top < chosen.rect.top)) {
          chosen = entry;
          chosenOnAnchorLine = onAnchorLine;
        }
      }
    }
  }
  if (!chosen) return null;
  return glyphBoundaryInNode(documentRef, chosen.node, endX, endY, Infinity, chosen.rect);
};

export function getCaretBoundaryFromClientPoint(documentRef, clientX, clientY, root = null) {
  if (!documentRef || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const { node, offset } = rawCaretFromPoint(documentRef, clientX, clientY);
  const nativeLayer = interactiveTextLayerForNode(node);
  // The drag guard's blank block (textLayerEndOfContent.js) is no place to
  // start or end a range: fall back to the nearest glyph.
  if (node && nativeLayer && !isEndOfContentNode(node) && (!root || (root === nativeLayer && node !== root))) {
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

const compareBoundaries = (documentRef, first, second) => {
  if (first.node === second.node) return first.offset - second.offset;
  return collapsedRangeAt(documentRef, first).compareBoundaryPoints(0, collapsedRangeAt(documentRef, second));
};

const orderedBoundaries = (documentRef, first, second) => (
  compareBoundaries(documentRef, first, second) <= 0 ? [first, second] : [second, first]
);

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

const sameBoundary = (boundary, node, offset) => Boolean(
  boundary?.node
  && boundary.node === node
  && boundary.offset === offset
);

const endpointDragFixedBoundary = (selectionSnapshot, startBoundary) => {
  if (!selectionSnapshot || selectionSnapshot.isCollapsed || selectionSnapshot.rangeCount < 1) return null;
  if (sameBoundary(startBoundary, selectionSnapshot.anchorNode, selectionSnapshot.anchorOffset)) {
    return {
      node: selectionSnapshot.focusNode,
      offset: selectionSnapshot.focusOffset,
    };
  }
  if (sameBoundary(startBoundary, selectionSnapshot.focusNode, selectionSnapshot.focusOffset)) {
    return {
      node: selectionSnapshot.anchorNode,
      offset: selectionSnapshot.anchorOffset,
    };
  }
  return null;
};

// Chromium can paint and hit a rotated pdf.js span correctly, yet still leave
// the browser Selection empty or unchanged at pointerup — or stop extending a
// drag short of the word's last letter when the pointer hits `.endOfContent`
// on blank paper (#1669). Keep native selection as the main path; only repair
// collapsed drags or extend same-line overshoots onto blank paper.
export function repairCollapsedTextDragSelection({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  selectionSnapshot,
  startBoundary,
  startClientPoint,
  endClientPoint,
} = {}) {
  const selection = windowRef?.getSelection?.();
  if (!selection) return false;
  const fixedBoundary = endpointDragFixedBoundary(selectionSnapshot, startBoundary);
  const hasNativeRange = !selection.isCollapsed && String(selection.toString() || '').length > 0;
  const textLayer = interactiveTextLayerForNode(startBoundary?.node);
  if (!startBoundary || !textLayer) return false;
  const endX = Number(endClientPoint?.x);
  const endY = Number(endClientPoint?.y);

  if (!fixedBoundary && hasNativeRange && !selectionMatchesSnapshot(selection, selectionSnapshot)) {
    if (!Number.isFinite(endX) || !Number.isFinite(endY) || selection.rangeCount < 1) return false;
    const rawCaret = rawCaretFromPoint(documentRef, endX, endY);
    if (!isBlankTextLayerHit(rawCaret.node, textLayer)) return false;
    const range = selection.getRangeAt(0);
    if (!textLayer.contains(range.startContainer) || !textLayer.contains(range.endContainer)) return false;
    const overshoot = sameLineOvershootBoundary(documentRef, textLayer, startBoundary, startClientPoint, endClientPoint);
    if (!overshoot) return false;
    try {
      const rangeStart = { node: range.startContainer, offset: range.startOffset };
      const rangeEnd = { node: range.endContainer, offset: range.endOffset };
      const dir = compareBoundaries(documentRef, overshoot, startBoundary);
      const startX = Number(startClientPoint?.x);
      const startY = Number(startClientPoint?.y);
      const startedOnBlank = Number.isFinite(startX) && Number.isFinite(startY)
        && isBlankTextLayerHit(rawCaretFromPoint(documentRef, startX, startY).node, textLayer);
      if (dir > 0) {
        const extendEnd = compareBoundaries(documentRef, overshoot, rangeEnd) > 0;
        const extendStart = startedOnBlank && compareBoundaries(documentRef, startBoundary, rangeStart) < 0;
        if (extendEnd || extendStart) {
          const nextRange = range.cloneRange();
          if (extendStart) nextRange.setStart(startBoundary.node, startBoundary.offset);
          if (extendEnd) nextRange.setEnd(overshoot.node, overshoot.offset);
          selection.removeAllRanges();
          selection.addRange(nextRange);
          documentRef.dispatchEvent?.(new windowRef.Event('selectionchange'));
          return true;
        }
      }
      if (dir < 0) {
        const extendStart = compareBoundaries(documentRef, overshoot, rangeStart) < 0;
        const extendEnd = startedOnBlank && compareBoundaries(documentRef, startBoundary, rangeEnd) > 0;
        if (extendStart || extendEnd) {
          const nextRange = range.cloneRange();
          if (extendStart) nextRange.setStart(overshoot.node, overshoot.offset);
          if (extendEnd) nextRange.setEnd(startBoundary.node, startBoundary.offset);
          selection.removeAllRanges();
          selection.addRange(nextRange);
          documentRef.dispatchEvent?.(new windowRef.Event('selectionchange'));
          return true;
        }
      }
    } catch { /* keep the native range */ }
    return false;
  }

  const rawEndCaret = Number.isFinite(endX) && Number.isFinite(endY)
    ? rawCaretFromPoint(documentRef, endX, endY)
    : { node: null, offset: 0 };
  let endBoundary = null;
  if (Number.isFinite(endX) && Number.isFinite(endY) && isBlankTextLayerHit(rawEndCaret.node, textLayer)) {
    endBoundary = sameLineOvershootBoundary(
      documentRef,
      textLayer,
      fixedBoundary || startBoundary,
      startClientPoint,
      endClientPoint,
    );
  }
  if (!endBoundary) {
    endBoundary = getCaretBoundaryFromClientPoint(documentRef, endX, endY, textLayer);
  }
  if (!endBoundary) return false;
  try {
    const movingStart = fixedBoundary || startBoundary;
    const [start, end] = orderedBoundaries(documentRef, movingStart, endBoundary);
    if (start.node === end.node && start.offset === end.offset) return false;
    const range = documentRef.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (!String(range.toString() || '').length) return false;
    if (fixedBoundary && typeof selection.setBaseAndExtent === 'function') {
      selection.setBaseAndExtent(
        fixedBoundary.node,
        fixedBoundary.offset,
        endBoundary.node,
        endBoundary.offset,
      );
    } else {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    documentRef.dispatchEvent?.(new windowRef.Event('selectionchange'));
    return !selection.isCollapsed && String(selection.toString() || '').length > 0;
  } catch {
    return false;
  }
}
