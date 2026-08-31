const MARKUP_TYPES = new Set(['highlight', 'underline', 'squiggly', 'strikeout', 'link', 'redact']);

export const TEXT_MARKUP_DEFAULT_PAINT = Object.freeze({
  highlight: Object.freeze({ color: '#f5c229', opacity: 30 }),
  underline: Object.freeze({ color: '#ef3029', opacity: 30 }),
  squiggly: Object.freeze({ color: '#f0f1f4', opacity: 30 }),
  strikeout: Object.freeze({ color: '#3d63dc', opacity: 30 }),
});

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

export function normalizeTextLinkUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function buildTextMarkupLinkRegions(annotations, pageSize) {
  const width = Number(pageSize?.width);
  const height = Number(pageSize?.height);
  if (!(width > 0) || !(height > 0)) return [];
  return (annotations || []).flatMap((annotation) => {
    if (annotation?.data?.type !== 'text-markup' || annotation.data.markupType !== 'link') return [];
    const url = normalizeTextLinkUrl(annotation.data.linkUrl);
    const pageNumber = Math.trunc(Number(annotation.data.linkPageNumber));
    if (!url && !(pageNumber > 0)) return [];
    return (annotation.data.quads || []).map((quad, index) => {
      const xs = [quad.x1, quad.x2, quad.x3, quad.x4].map(Number);
      const ys = [quad.y1, quad.y2, quad.y3, quad.y4].map(Number);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
      return {
        id: `${annotation.id || annotation.data.id || 'link'}-${index}`,
        mode: pageNumber > 0 ? 'page' : 'web',
        url,
        pageNumber: pageNumber > 0 ? pageNumber : null,
        left: `${left / width * 100}%`,
        top: `${top / height * 100}%`,
        width: `${(right - left) / width * 100}%`,
        height: `${(bottom - top) / height * 100}%`,
      };
    }).filter(Boolean);
  });
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
  textRange,
  textRangeModel,
  quads,
  color = '#f4d35e',
  opacity,
  overlapMode = 'layered',
  linkUrl = null,
  linkPageNumber = null,
  authorId = null,
}) {
  const type = normalizeTextMarkupType(markupType);
  const resolvedLinkUrl = type === 'link' ? normalizeTextLinkUrl(linkUrl) : null;
  const resolvedLinkPageNumber = type === 'link' && Number(linkPageNumber) >= 1
    ? Math.trunc(Number(linkPageNumber))
    : null;
  const mergedQuads = mergeLineQuads(quads);
  const bounds = quadBounds(mergedQuads);
  if (!id || !type || !bounds || !Number.isFinite(Number(pageNumber)) || (type === 'link' && !resolvedLinkUrl && !resolvedLinkPageNumber)) return null;
  const resolvedColor = type === 'redact' ? '#000000' : type === 'link' ? '#2563eb' : color;
  const resolvedOpacity = type === 'redact' || type === 'link' ? 1 : clamp01(opacity ?? 0.3);
  const pdfType = type === 'highlight' ? 'Highlight'
    : type === 'underline' ? 'Underline'
      : type === 'squiggly' ? 'Squiggly'
        : type === 'strikeout' ? 'StrikeOut'
          : type === 'link' ? 'Link' : 'Redact';
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
    fill: resolvedColor,
    stroke: resolvedColor,
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
      ...(textRange && Number.isFinite(textRange.start) && Number.isFinite(textRange.end)
        ? { textRange: { start: textRange.start, end: textRange.end } }
        : {}),
      ...(textRangeModel?.runs?.length ? { textRangeModel } : {}),
      quads: mergedQuads,
      overlapMode: overlapMode === 'uniform' ? 'uniform' : 'layered',
      ...(resolvedLinkUrl ? { linkUrl: resolvedLinkUrl } : {}),
      ...(resolvedLinkPageNumber ? { linkPageNumber: resolvedLinkPageNumber } : {}),
      ...(authorId ? { authorId } : {}),
    },
    meta: authorId ? { authorId } : undefined,
  };
}

const orderedTextMarkupQuads = (annotation) => (Array.isArray(annotation?.data?.quads)
  ? annotation.data.quads.map((quad, index) => ({ quad, index })).sort((a, b) => {
      const ay = Math.min(Number(a.quad.y1), Number(a.quad.y2), Number(a.quad.y3), Number(a.quad.y4));
      const by = Math.min(Number(b.quad.y1), Number(b.quad.y2), Number(b.quad.y3), Number(b.quad.y4));
      return ay - by || Math.min(Number(a.quad.x1), Number(a.quad.x3)) - Math.min(Number(b.quad.x1), Number(b.quad.x3));
    })
  : []);

export function getTextMarkupRangeHandlePositions(annotation) {
  const ordered = orderedTextMarkupQuads(annotation);
  if (!ordered.length) return null;
  const first = ordered[0].quad;
  const last = ordered.at(-1).quad;
  const centerY = (quad) => (
    Math.min(Number(quad.y1), Number(quad.y2), Number(quad.y3), Number(quad.y4))
    + Math.max(Number(quad.y1), Number(quad.y2), Number(quad.y3), Number(quad.y4))
  ) / 2;
  const positions = {
    ml: { x: Math.min(Number(first.x1), Number(first.x3)), y: centerY(first) },
    mr: { x: Math.max(Number(last.x2), Number(last.x4)), y: centerY(last) },
  };
  const crossed = typeof annotation?._textRangeHandleCrossed === 'boolean'
    ? annotation._textRangeHandleCrossed
    : annotation?.data?.textRangeHandleCrossed === true;
  if (crossed) {
    return { ml: positions.mr, mr: positions.ml };
  }
  return positions;
}

export function getTextMarkupRangeFixedOffset(annotation, handleId) {
  const range = annotation?.data?.textRange;
  if (!Number.isFinite(Number(range?.start)) || !Number.isFinite(Number(range?.end))) return undefined;
  const crossed = typeof annotation?._textRangeHandleCrossed === 'boolean'
    ? annotation._textRangeHandleCrossed
    : annotation?.data?.textRangeHandleCrossed === true;
  if (handleId === 'ml') return crossed ? Number(range.start) : Number(range.end);
  if (handleId === 'mr') return crossed ? Number(range.end) : Number(range.start);
  return undefined;
}

export function getTextMarkupStackAtPoint(annotations, point, tolerance = 2) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  const pad = Math.max(0, Number(tolerance) || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  return (annotations || []).flatMap((annotation, index) => {
    if (annotation?.data?.type !== 'text-markup' || annotation.visible === false) return [];
    const hit = (annotation.data.quads || []).some((quad) => {
      const xs = [quad.x1, quad.x2, quad.x3, quad.x4].map(Number);
      const ys = [quad.y1, quad.y2, quad.y3, quad.y4].map(Number);
      if (![...xs, ...ys].every(Number.isFinite)) return false;
      return x >= Math.min(...xs) - pad
        && x <= Math.max(...xs) + pad
        && y >= Math.min(...ys) - pad
        && y <= Math.max(...ys) + pad;
    });
    return hit ? [index] : [];
  });
}

const textNodesFor = (root) => {
  if (!root || typeof document === 'undefined') return [];
  const walker = document.createTreeWalker(root, globalThis.NodeFilter?.SHOW_TEXT ?? 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
};

const absoluteTextOffset = (root, container, offset) => {
  try {
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(container, offset);
    return prefix.toString().length;
  } catch {
    return null;
  }
};

const boundaryAtTextOffset = (root, rawOffset) => {
  const nodes = textNodesFor(root);
  if (!nodes.length) return null;
  let offset = Math.max(0, Number(rawOffset) || 0);
  for (const node of nodes) {
    const length = node.nodeValue?.length || 0;
    if (offset <= length) return { node, offset };
    offset -= length;
  }
  const last = nodes.at(-1);
  return { node: last, offset: last.nodeValue?.length || 0 };
};

const textOffsetAtClientPoint = (root, clientX, clientY) => {
  const nodes = textNodesFor(root);
  let base = 0;
  let bestNode = null;
  let bestBase = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects?.() || []);
    for (const rect of rects) {
      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const distance = dy * 10_000 + dx;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestNode = node;
        bestBase = base;
      }
    }
    base += node.nodeValue?.length || 0;
  }
  if (!bestNode) return null;
  const length = bestNode.nodeValue?.length || 0;
  let bestOffset = 0;
  let bestXDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < length; index += 1) {
    const character = document.createRange();
    character.setStart(bestNode, index);
    character.setEnd(bestNode, index + 1);
    const rect = character.getBoundingClientRect?.();
    if (!rect?.width && !rect?.height) continue;
    for (const [offset, edge] of [[index, rect.left], [index + 1, rect.right]]) {
      const distance = Math.abs(clientX - edge);
      if (distance < bestXDistance) {
        bestXDistance = distance;
        bestOffset = offset;
      }
    }
  }
  return bestBase + bestOffset;
};

const orderedOffsets = (candidate, fixedOffset, storedRange, handleId) => {
  const fixed = Number.isFinite(Number(fixedOffset))
    ? Number(fixedOffset)
    : (handleId === 'ml' ? Number(storedRange.end) : Number(storedRange.start));
  return { start: Math.min(candidate, fixed), end: Math.max(candidate, fixed) };
};

const textRangeDragState = (handleId, candidate, fixed) => ({
  _textRangeDragHandle: handleId,
  _textRangeHandleCrossed: handleId === 'ml' ? candidate > fixed : candidate < fixed,
});

const resizeTextMarkupFromStoredModel = (annotation, handleId, pointer, fixedOffset) => {
  const storedRange = annotation?.data?.textRange;
  const model = annotation?.data?.textRangeModel;
  const runs = Array.isArray(model?.runs) ? model.runs : [];
  if (!Number.isFinite(storedRange?.start) || !Number.isFinite(storedRange?.end) || !runs.length) return null;
  let target = null;
  let targetDistance = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    const dx = pointer.x < run.left ? run.left - pointer.x : pointer.x > run.right ? pointer.x - run.right : 0;
    const dy = pointer.y < run.top ? run.top - pointer.y : pointer.y > run.bottom ? pointer.y - run.bottom : 0;
    const distance = dy * 10_000 + dx;
    if (distance < targetDistance) {
      targetDistance = distance;
      target = run;
    }
  }
  if (!target || target.end <= target.start || target.right <= target.left) return null;
  const ratio = Math.max(0, Math.min(1, (pointer.x - target.left) / (target.right - target.left)));
  const visualRatio = target.rtl ? 1 - ratio : ratio;
  const candidate = target.start + Math.round((target.end - target.start) * visualRatio);
  const fixed = Number.isFinite(Number(fixedOffset))
    ? Number(fixedOffset)
    : (handleId === 'ml' ? Number(storedRange.end) : Number(storedRange.start));
  const { start, end } = orderedOffsets(candidate, fixed, storedRange, handleId);
  if (end <= start) return null;
  const quads = [];
  for (const run of runs) {
    const rangeStart = Math.max(start, run.start);
    const rangeEnd = Math.min(end, run.end);
    if (rangeEnd <= rangeStart) continue;
    const length = run.end - run.start;
    let leftRatio = (rangeStart - run.start) / length;
    let rightRatio = (rangeEnd - run.start) / length;
    if (run.rtl) [leftRatio, rightRatio] = [1 - rightRatio, 1 - leftRatio];
    const left = run.left + (run.right - run.left) * leftRatio;
    const right = run.left + (run.right - run.left) * rightRatio;
    quads.push({
      x1: round(left), y1: run.top, x2: round(right), y2: run.top,
      x3: round(left), y3: run.bottom, x4: round(right), y4: run.bottom,
    });
  }
  const mergedQuads = mergeLineQuads(quads);
  const bounds = quadBounds(mergedQuads);
  if (!bounds) return null;
  return {
    ...annotation,
    ...textRangeDragState(handleId, candidate, fixed),
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    data: {
      ...annotation.data,
      quads: mergedQuads,
      selectedText: String(model.text || '').slice(start, end),
      textRange: { start, end },
    },
  };
};

const resizeTextMarkupFromTextLayer = (annotation, handleId, pointer, pageWidth, pageHeight, fixedOffset) => {
  if (typeof document === 'undefined' || !Number.isFinite(pointer.y)) return null;
  const storedRange = annotation?.data?.textRange;
  const pageNumber = Number(annotation?.data?.pageNumber);
  if (!Number.isFinite(storedRange?.start) || !Number.isFinite(storedRange?.end) || !Number.isFinite(pageNumber)) return null;
  const pageEl = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`);
  const textLayer = pageEl?.querySelector?.('.pdfjsTextLayer.is-interactive');
  const pageRect = pageEl?.getBoundingClientRect?.();
  if (!textLayer || !pageRect?.width || !pageRect?.height || !pageWidth || !pageHeight) return null;
  const clientX = pageRect.left + pointer.x * pageRect.width / pageWidth;
  const clientY = pageRect.top + pointer.y * pageRect.height / pageHeight;
  const candidate = textOffsetAtClientPoint(textLayer, clientX, clientY);
  if (!Number.isFinite(candidate)) return null;
  const fixed = Number.isFinite(Number(fixedOffset))
    ? Number(fixedOffset)
    : (handleId === 'ml' ? Number(storedRange.end) : Number(storedRange.start));
  const { start, end } = orderedOffsets(candidate, fixed, storedRange, handleId);
  if (end <= start) return null;
  const startBoundary = boundaryAtTextOffset(textLayer, start);
  const endBoundary = boundaryAtTextOffset(textLayer, end);
  if (!startBoundary || !endBoundary) return null;
  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  const selectedText = range.toString();
  if (!selectedText) return null;
  const quads = mergeLineQuads(Array.from(range.getClientRects?.() || [])
    .map((rect) => clientRectToPageQuad(rect, pageRect, { width: pageWidth, height: pageHeight }))
    .filter(Boolean));
  const bounds = quadBounds(quads);
  if (!bounds) return null;
  return {
    ...annotation,
    ...textRangeDragState(handleId, candidate, fixed),
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    data: { ...annotation.data, quads, selectedText, textRange: { start, end } },
  };
};

export function resizeTextMarkupHorizontalEdge(annotation, handleId, pointerX, pageWidth, pageHeight, fixedTextOffset) {
  if (annotation?.data?.type !== 'text-markup' || !['ml', 'mr'].includes(handleId)) return annotation;
  const quads = Array.isArray(annotation.data.quads)
    ? annotation.data.quads.map((quad) => ({ ...quad }))
    : [];
  const pointer = typeof pointerX === 'object'
    ? { x: Number(pointerX?.x), y: Number(pointerX?.y) }
    : { x: Number(pointerX), y: Number.NaN };
  if (quads.length === 0 || !Number.isFinite(pointer.x)) return annotation;
  const storedModelResult = resizeTextMarkupFromStoredModel(annotation, handleId, pointer, fixedTextOffset);
  if (storedModelResult) return storedModelResult;
  const textLayerResult = resizeTextMarkupFromTextLayer(annotation, handleId, pointer, pageWidth, pageHeight, fixedTextOffset);
  if (textLayerResult) return textLayerResult;
  // Old saved marks do not contain a stable text boundary model. Changing
  // their quads would leave Copy/PDF export tied to stale selectedText.
  if (String(annotation.data.selectedText || '')) return annotation;

  const ordered = orderedTextMarkupQuads({ data: { quads } });
  let endpointPosition = handleId === 'ml' ? 0 : ordered.length - 1;
  if (Number.isFinite(pointer.y)) {
    endpointPosition = ordered.reduce((best, entry, index) => {
      const top = Math.min(Number(entry.quad.y1), Number(entry.quad.y2), Number(entry.quad.y3), Number(entry.quad.y4));
      const bottom = Math.max(Number(entry.quad.y1), Number(entry.quad.y2), Number(entry.quad.y3), Number(entry.quad.y4));
      const center = (top + bottom) / 2;
      const bestQuad = ordered[best].quad;
      const bestCenter = (
        Math.min(Number(bestQuad.y1), Number(bestQuad.y2), Number(bestQuad.y3), Number(bestQuad.y4))
        + Math.max(Number(bestQuad.y1), Number(bestQuad.y2), Number(bestQuad.y3), Number(bestQuad.y4))
      ) / 2;
      return Math.abs(pointer.y - center) < Math.abs(pointer.y - bestCenter) ? index : best;
    }, endpointPosition);
  }
  const retained = handleId === 'ml'
    ? ordered.slice(endpointPosition)
    : ordered.slice(0, endpointPosition + 1);
  const nextQuads = retained.map(({ quad }) => quad);
  const endpointQuad = nextQuads[handleId === 'ml' ? 0 : nextQuads.length - 1];
  if (!endpointQuad) return annotation;
  const pageRight = Number.isFinite(Number(pageWidth)) && Number(pageWidth) > 0
    ? Number(pageWidth)
    : Number.POSITIVE_INFINITY;
  const minimumRangeWidth = 0.5;
  if (handleId === 'ml') {
    for (const quad of [endpointQuad]) {
      const right = Math.min(Number(quad.x2), Number(quad.x4));
      const nextLeft = round(Math.max(0, Math.min(pointer.x, right - minimumRangeWidth)));
      quad.x1 = nextLeft;
      quad.x3 = nextLeft;
    }
  } else {
    for (const quad of [endpointQuad]) {
      const left = Math.max(Number(quad.x1), Number(quad.x3));
      const nextRight = round(Math.min(pageRight, Math.max(pointer.x, left + minimumRangeWidth)));
      quad.x2 = nextRight;
      quad.x4 = nextRight;
    }
  }

  const bounds = quadBounds(nextQuads);
  if (!bounds) return annotation;
  return {
    ...annotation,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    data: { ...annotation.data, quads: nextQuads },
  };
}

export function finalizeTextMarkupHorizontalEdge(
  annotation,
  currentPreview,
  handleId,
  releasePointer,
  pageWidth,
  pageHeight,
  fixedTextOffset,
) {
  const releasePreview = resizeTextMarkupHorizontalEdge(
    annotation,
    handleId,
    releasePointer,
    pageWidth,
    pageHeight,
    fixedTextOffset,
  );
  return releasePreview === annotation
    ? (currentPreview || annotation)
    : releasePreview;
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
    const start = absoluteTextOffset(textLayer, pageRange.startContainer, pageRange.startOffset);
    const end = absoluteTextOffset(textLayer, pageRange.endContainer, pageRange.endOffset);
    const runs = [];
    let textOffset = 0;
    for (const node of textNodesFor(textLayer)) {
      const text = String(node.nodeValue || '');
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      const rect = nodeRange.getBoundingClientRect?.();
      const quad = clientRectToPageQuad(rect, pageRect, pageSize);
      if (text && quad) {
        runs.push({
          start: textOffset,
          end: textOffset + text.length,
          left: quad.x1,
          top: quad.y1,
          right: quad.x2,
          bottom: quad.y3,
          rtl: getComputedStyle(node.parentElement || textLayer).direction === 'rtl',
        });
      }
      textOffset += text.length;
    }
    pages.push({
      pageNumber,
      selectedText: pageText,
      quads: mergeLineQuads(quads),
      ...(Number.isFinite(start) && Number.isFinite(end) ? { textRange: { start, end } } : {}),
      ...(runs.length ? { textRangeModel: { text: textLayer.textContent || '', runs } } : {}),
    });
  }
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

export function restorePdfjsTextSelection(selectionPayload) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const pages = (selectionPayload?.pages || [])
    .filter((page) => Number.isFinite(page?.textRange?.start) && Number.isFinite(page?.textRange?.end))
    .slice()
    .sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber));
  if (!pages.length) return false;
  const first = pages[0];
  const last = pages.at(-1);
  const firstLayer = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${first.pageNumber}"] .pdfjsTextLayer.is-interactive`);
  const lastLayer = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${last.pageNumber}"] .pdfjsTextLayer.is-interactive`);
  const start = boundaryAtTextOffset(firstLayer, first.textRange.start);
  const end = boundaryAtTextOffset(lastLayer, last.textRange.end);
  if (!start || !end) return false;
  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const nativeSelection = window.getSelection();
    nativeSelection.removeAllRanges();
    nativeSelection.addRange(range);
    return !nativeSelection.isCollapsed;
  } catch {
    return false;
  }
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
