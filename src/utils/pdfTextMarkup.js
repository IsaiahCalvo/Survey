const MARKUP_TYPES = new Set(['highlight', 'underline', 'squiggly', 'strikeout', 'link', 'redact']);

export const TEXT_MARKUP_DEFAULT_PAINT = Object.freeze({
  // UX default: highlights stay translucent so the selected text remains easy to read.
  highlight: Object.freeze({ color: '#f5c229', opacity: 40 }),
  // UX default: underline strokes stay opaque so thin page-unit lines remain clear.
  underline: Object.freeze({ color: '#ef3029', opacity: 100 }),
  // UX default: squiggles use a deep green (5.5:1 on white) — the preset greens are all neon and vanish on paper; distinct from underline red and strike blue.
  squiggly: Object.freeze({ color: '#15803d', opacity: 100 }),
  // UX default: strike-through strokes stay opaque so thin page-unit lines remain clear.
  strikeout: Object.freeze({ color: '#3d63dc', opacity: 100 }),
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
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol === 'mailto:') return url.href;
    const hostname = url.hostname.toLowerCase();
    if (!hostname || hostname.includes('%')) return null;
    const isLocalhost = hostname === 'localhost';
    const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
      && hostname.split('.').every((part) => Number(part) <= 255);
    const isIpv6 = /^\[[\da-f:.]+\]$/i.test(hostname) && hostname.includes(':');
    const labels = hostname.split('.');
    const isDomain = labels.length > 1
      && labels.every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))
      && /^(?:[a-z]{2,}|xn--[a-z\d-]{2,})$/i.test(labels.at(-1));
    return isLocalhost || isIpv4 || isIpv6 || isDomain ? url.href : null;
  } catch {
    return null;
  }
}

export function buildTextMarkupLinkRegions(annotations, pageSize) {
  const width = Number(pageSize?.width);
  const height = Number(pageSize?.height);
  if (!(width > 0) || !(height > 0)) return [];
  return (annotations || []).flatMap((annotation, annotationIndex) => {
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
        annotationId: annotation.id || annotation.data.id || null,
        annotationIndex,
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

export function getTextMarkupUnderlineInset(annotation, quadHeight, lineWidth = 1.2) {
  const strokeInset = Math.max(0, Number(lineWidth) || 0) / 2;
  if (annotation?.isPdfImported) return strokeInset;
  // A browser Range rect covers the CSS line box, including leading below the
  // glyph baseline. PDF QuadPoints already hug the glyphs. Pull marks created
  // from a live browser selection up by one quarter of that line box so both
  // sources paint on the same visual baseline.
  return Math.max(strokeInset, Math.max(0, Number(quadHeight) || 0) / 4);
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
  color,
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
  const defaultPaint = TEXT_MARKUP_DEFAULT_PAINT[type];
  const resolvedColor = type === 'redact' ? '#000000' : type === 'link' ? '#2563eb' : (color || defaultPaint?.color);
  const resolvedOpacity = type === 'redact' || type === 'link'
    ? 1
    : clamp01(opacity ?? ((defaultPaint?.opacity ?? 100) / 100));
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

export function getTextMarkupSelectionChrome(annotation) {
  if (annotation?.data?.type !== 'text-markup') {
    return { hideBoundingBox: false, hideResizeHandles: false };
  }
  const hasRangeModel = Array.isArray(annotation.data.textRangeModel?.runs)
    && annotation.data.textRangeModel.runs.length > 0;
  return {
    hideBoundingBox: hasRangeModel,
    hideResizeHandles: !hasRangeModel,
  };
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

const textRangeDragState = (handleId, candidate, fixed, crossedOverride) => ({
  _textRangeDragHandle: handleId,
  _textRangeHandleCrossed: typeof crossedOverride === 'boolean'
    ? crossedOverride
    : (handleId === 'ml' ? candidate > fixed : candidate < fixed),
});

const importedRunVerticalBounds = (annotation, run) => {
  if (!annotation?.isPdfImported) return null;
  const storedRange = annotation?.data?.textRange;
  if (!Number.isFinite(storedRange?.start) || !Number.isFinite(storedRange?.end)) return null;
  if (Math.min(Number(storedRange.end), Number(run.end)) <= Math.max(Number(storedRange.start), Number(run.start))) {
    return null;
  }
  const runCenter = (Number(run.top) + Number(run.bottom)) / 2;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const quad of annotation?.data?.quads || []) {
    const values = [quad.y1, quad.y2, quad.y3, quad.y4].map(Number);
    if (!values.every(Number.isFinite)) continue;
    const top = Math.min(...values);
    const bottom = Math.max(...values);
    const distance = Math.abs(runCenter - ((top + bottom) / 2));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { top, bottom };
    }
  }
  return best;
};

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
  const rawCandidate = target.start + (target.end - target.start) * visualRatio;
  let candidate = Math.round(rawCandidate);
  const fixed = Number.isFinite(Number(fixedOffset))
    ? Number(fixedOffset)
    : (handleId === 'ml' ? Number(storedRange.end) : Number(storedRange.start));
  if (candidate === fixed && rawCandidate !== fixed) {
    candidate = rawCandidate > fixed ? Math.ceil(rawCandidate) : Math.floor(rawCandidate);
  }
  let { start, end } = orderedOffsets(candidate, fixed, storedRange, handleId);
  const textLength = String(model.text || '').length;
  const pointerPastTargetEnd = target.rtl ? pointer.x <= target.left : pointer.x >= target.right;
  const pointerPastTargetStart = target.rtl ? pointer.x >= target.right : pointer.x <= target.left;
  const crossedAtTextBoundary = candidate === fixed && (
    (handleId === 'ml' && fixed === textLength && target.end === textLength && pointerPastTargetEnd)
    || (handleId === 'mr' && fixed === 0 && target.start === 0 && pointerPastTargetStart)
  );
  if (end <= start && crossedAtTextBoundary) {
    if (handleId === 'ml' && fixed > 0) {
      start = fixed - 1;
      end = fixed;
    } else if (handleId === 'mr' && fixed < textLength) {
      start = fixed;
      end = fixed + 1;
    }
  }
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
    // PDF authored QuadPoints can be tighter than pdf.js text-item bounds.
    // Keep the authored Y values for lines that were already selected. A
    // horizontal range resize must never make squiggles or strikeouts jump.
    const authoredVertical = importedRunVerticalBounds(annotation, run);
    const top = authoredVertical?.top ?? run.top;
    const bottom = authoredVertical?.bottom ?? run.bottom;
    quads.push({
      x1: round(left), y1: top, x2: round(right), y2: top,
      x3: round(left), y3: bottom, x4: round(right), y4: bottom,
    });
  }
  const mergedQuads = mergeLineQuads(quads);
  const bounds = quadBounds(mergedQuads);
  if (!bounds) return null;
  return {
    ...annotation,
    ...textRangeDragState(handleId, candidate, fixed, crossedAtTextBoundary ? true : undefined),
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

export function computeTextMarkupPickerPosition(selectionRect, {
  viewportWidth,
  viewportHeight,
  hostBottom = 0,
  // UX defaults: match the shared picker shell so placement clears the mark.
  pickerWidth = 286,
  pickerHeight = 320,
  margin = 8,
  gap = 12,
} = {}) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const popupWidth = Math.min(Math.max(1, Number(pickerWidth) || 286), Math.max(1, width - margin * 2));
  const popupHeight = Math.min(Math.max(1, Number(pickerHeight) || 320), Math.max(1, height - margin * 2));
  const minimumTop = Math.max(margin, Number(hostBottom) + margin);
  const clampLeft = (left) => Math.max(margin, Math.min(width - popupWidth - margin, left));
  const clampTop = (top) => Math.max(minimumTop, Math.min(height - popupHeight - margin, top));
  const fallback = {
    left: clampLeft((width - popupWidth) / 2),
    top: clampTop(minimumTop),
  };
  const left = Number(selectionRect?.left);
  const top = Number(selectionRect?.top);
  const right = Number(selectionRect?.right ?? (left + Number(selectionRect?.width)));
  const bottom = Number(selectionRect?.bottom ?? (top + Number(selectionRect?.height)));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return fallback;
  const overlaps = (candidate) => (
    candidate.left < right
    && candidate.left + popupWidth > left
    && candidate.top < bottom
    && candidate.top + popupHeight > top
  );
  if (!overlaps(fallback)) return fallback;
  const candidates = [
    { left: left - gap - popupWidth, top: fallback.top },
    { left: right + gap, top: fallback.top },
    { left: fallback.left, top: top - gap - popupHeight },
    { left: fallback.left, top: bottom + gap },
  ].map((candidate) => ({ left: clampLeft(candidate.left), top: clampTop(candidate.top) }))
    .filter((candidate) => !overlaps(candidate));
  candidates.sort((a, b) => (
    Math.hypot(a.left - fallback.left, a.top - fallback.top)
    - Math.hypot(b.left - fallback.left, b.top - fallback.top)
  ));
  return candidates[0] || fallback;
}

export const TEXT_MARKUP_TYPES = Object.freeze(Array.from(MARKUP_TYPES));
