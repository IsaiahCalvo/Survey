const MARKUP_TYPES = new Set(['highlight', 'underline', 'squiggly', 'strikeout']);

const round = (value) => Math.round(Number(value) * 10_000) / 10_000;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const colorAlpha = (color) => {
  const match = String(color || '').match(/^rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\s*\)$/i);
  if (match?.[1] != null) return clamp01(match[1]);
  const hex = String(color || '').trim();
  if (/^#[\da-f]{8}$/i.test(hex)) return parseInt(hex.slice(7, 9), 16) / 255;
  if (/^#[\da-f]{4}$/i.test(hex)) return parseInt(hex[4] + hex[4], 16) / 255;
  return 1;
};

const colorHex = (color) => {
  const value = String(color || '').trim();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return `#${rgb.slice(1, 4).map((part) => (
      Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')
    )).join('')}`;
  }
  if (/^#[\da-f]{3,4}$/i.test(value)) {
    return `#${value.slice(1, 4).split('').map((part) => part + part).join('')}`;
  }
  if (/^#[\da-f]{6,8}$/i.test(value)) return value.slice(0, 7);
  return null;
};

export function resolveTextMarkupEditPaint(annotation, fallbackColor = '#f4d35e') {
  const storedColor = [annotation?.stroke, annotation?.fill, annotation?.data?.color]
    .find((value) => value && value !== 'none' && value !== 'transparent') || fallbackColor;
  const rawObjectOpacity = Number(annotation?.opacity ?? 1);
  const objectOpacity = Number.isFinite(rawObjectOpacity) ? clamp01(rawObjectOpacity) : 1;
  return {
    color: colorHex(storedColor) || colorHex(fallbackColor) || '#f4d35e',
    opacity: Math.round(clamp01(objectOpacity * colorAlpha(storedColor)) * 100),
  };
}

export function normalizeTextMarkupType(value) {
  const type = String(value || '').toLowerCase();
  return MARKUP_TYPES.has(type) ? type : null;
}

export function clientRectToPageQuad(clientRect, pageRect, pageSize) {
  if (!clientRect || !pageRect || !pageSize || pageRect.width <= 0 || pageRect.height <= 0) return null;
  const scaleX = Number(pageSize.width) / pageRect.width;
  const scaleY = Number(pageSize.height) / pageRect.height;
  const left = Math.max(0, Math.min(Number(pageSize.width), (clientRect.left - pageRect.left) * scaleX));
  const right = Math.max(0, Math.min(Number(pageSize.width), (clientRect.right - pageRect.left) * scaleX));
  const top = Math.max(0, Math.min(Number(pageSize.height), (clientRect.top - pageRect.top) * scaleY));
  const bottom = Math.max(0, Math.min(Number(pageSize.height), (clientRect.bottom - pageRect.top) * scaleY));
  if (right - left < 0.01 || bottom - top < 0.01) return null;
  return {
    x1: round(left), y1: round(top),
    x2: round(right), y2: round(top),
    x3: round(left), y3: round(bottom),
    x4: round(right), y4: round(bottom),
  };
}

export function rotatePageQuad(quad, rotation, unrotatedWidth, unrotatedHeight) {
  const turn = ((Number(rotation) || 0) % 360 + 360) % 360;
  const map = (x, y) => {
    if (turn === 90) return { x: unrotatedHeight - y, y: x };
    if (turn === 180) return { x: unrotatedWidth - x, y: unrotatedHeight - y };
    if (turn === 270) return { x: y, y: unrotatedWidth - x };
    return { x, y };
  };
  const points = [map(quad.x1, quad.y1), map(quad.x2, quad.y2), map(quad.x3, quad.y3), map(quad.x4, quad.y4)];
  return Object.fromEntries(points.flatMap((point, index) => [
    [`x${index + 1}`, round(point.x)],
    [`y${index + 1}`, round(point.y)],
  ]));
}

export function quadBounds(quads) {
  const xs = (quads || []).flatMap((q) => [q.x1, q.x2, q.x3, q.x4]).map(Number).filter(Number.isFinite);
  const ys = (quads || []).flatMap((q) => [q.y1, q.y2, q.y3, q.y4]).map(Number).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { left: round(left), top: round(top), width: round(right - left), height: round(bottom - top) };
}

export function mergeLineQuads(quads, tolerance = 0.75) {
  const sorted = (quads || []).filter(Boolean).slice().sort((a, b) => (a.y1 - b.y1) || (a.x1 - b.x1));
  const out = [];
  for (const quad of sorted) {
    const last = out[out.length - 1];
    const sameLine = last
      && Math.abs(last.y1 - quad.y1) <= tolerance
      && Math.abs(last.y3 - quad.y3) <= tolerance
      && quad.x1 <= last.x2 + tolerance;
    if (!sameLine) {
      out.push({ ...quad });
      continue;
    }
    last.x2 = Math.max(last.x2, quad.x2);
    last.x4 = Math.max(last.x4, quad.x4);
  }
  return out;
}

export function createTextMarkupAnnotation({
  id,
  pageNumber,
  selectionGroupId,
  markupType,
  selectedText,
  quads,
  color = '#f4d35e',
  opacity,
  overlapMode = 'layered',
  authorId = null,
}) {
  const type = normalizeTextMarkupType(markupType);
  const mergedQuads = mergeLineQuads(quads);
  const bounds = quadBounds(mergedQuads);
  if (!id || !type || !bounds || !Number.isFinite(Number(pageNumber))) return null;
  const resolvedOpacity = clamp01(opacity ?? (type === 'highlight' ? 0.38 : 1));
  const pdfType = type === 'highlight' ? 'Highlight'
    : type === 'underline' ? 'Underline'
      : type === 'squiggly' ? 'Squiggly' : 'StrikeOut';
  return {
    type: 'group',
    id,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    fill: color,
    stroke: color,
    opacity: resolvedOpacity,
    exportType: type,
    pdfAnnotationType: pdfType,
    data: {
      id,
      type: 'text-markup',
      markupType: type,
      pageNumber: Number(pageNumber),
      selectionGroupId: selectionGroupId || id,
      selectedText: String(selectedText || ''),
      quads: mergedQuads,
      overlapMode: overlapMode === 'uniform' ? 'uniform' : 'layered',
      ...(authorId ? { authorId } : {}),
    },
    meta: authorId ? { authorId } : undefined,
  };
}

export function mapOcrBoxToPage(box, sourceSize, pageSize, rotation = 0) {
  if (!box || !sourceSize?.width || !sourceSize?.height || !pageSize?.width || !pageSize?.height) return null;
  const quad = {
    x1: box.x * pageSize.width / sourceSize.width,
    y1: box.y * pageSize.height / sourceSize.height,
    x2: (box.x + box.width) * pageSize.width / sourceSize.width,
    y2: box.y * pageSize.height / sourceSize.height,
    x3: box.x * pageSize.width / sourceSize.width,
    y3: (box.y + box.height) * pageSize.height / sourceSize.height,
    x4: (box.x + box.width) * pageSize.width / sourceSize.width,
    y4: (box.y + box.height) * pageSize.height / sourceSize.height,
  };
  return rotatePageQuad(quad, rotation, pageSize.width, pageSize.height);
}

export function getSelectionPageRanges(selection, pageSizes) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
  const selectedText = String(selection.toString() || '');
  if (!selectedText.trim()) return [];
  const range = selection.getRangeAt(0);
  const pages = [];
  const textLayers = Array.from(document.querySelectorAll('.pdfjsTextLayer.is-interactive'));
  for (const textLayer of textLayers) {
    try {
      if (!range.intersectsNode(textLayer)) continue;
    } catch {
      continue;
    }
    const pageEl = textLayer.closest?.('.survey-pdfjs-page-div[data-page-number]');
    const pageNumber = Number(pageEl?.dataset?.pageNumber);
    const pageSize = pageSizes?.[pageNumber];
    if (!pageEl || !pageSize) continue;
    const pageRange = document.createRange();
    pageRange.selectNodeContents(textLayer);
    try {
      if (range.compareBoundaryPoints(0, pageRange) > 0) pageRange.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(2, pageRange) < 0) pageRange.setEnd(range.endContainer, range.endOffset);
    } catch {
      continue;
    }
    const pageText = String(pageRange.toString() || '');
    if (!pageText.trim()) continue;
    const pageRect = pageEl.getBoundingClientRect();
    const quads = Array.from(pageRange.getClientRects?.() || [])
      .map((rect) => clientRectToPageQuad(rect, pageRect, pageSize))
      .filter(Boolean);
    if (quads.length === 0) continue;
    pages.push({ pageNumber, selectedText: pageText, quads: mergeLineQuads(quads) });
  }
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

export function computeTextSelectionActionBarPosition(anchor, {
  viewportWidth,
  viewportHeight,
  chromeBottom = 0,
  barWidth = 260,
  barHeight = 40,
  margin = 8,
} = {}) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const halfBar = Math.min(barWidth, width - margin * 2) / 2;
  const center = Number(anchor?.left || 0) + Number(anchor?.width || 0) / 2;
  const left = Math.max(margin + halfBar, Math.min(width - margin - halfBar, center));
  const above = Number(anchor?.top || 0) - barHeight - margin;
  const below = Number(anchor?.top || 0) + Number(anchor?.height || 0) + margin;
  const minimumTop = Math.max(margin, Number(chromeBottom) + margin);
  const preferredTop = above >= minimumTop ? above : below;
  const top = Math.max(minimumTop, Math.min(height - barHeight - margin, preferredTop));
  return { left, top };
}

export const TEXT_MARKUP_TYPES = Object.freeze(Array.from(MARKUP_TYPES));
