/**
 * historyGeometry.js — RULED 2026-09-28 owner: History option A.
 *
 * Geometry of a stored mark (the fabric-shaped JSON History rows carry in
 * payload.previewAnnotation / previewBefore / restoreAction) in PAGE units —
 * the annotation layer's viewBox (0 0 pageWidth pageHeight). Used by the
 * History panel to:
 *   - zoom the view to a mark that is not on screen yet,
 *   - draw the dashed ghost of a deleted mark, or of where / how a mark was
 *     before a move, resize or color change.
 * The shape transform is the one the History spotlight has always used
 * (w55-verified against the live page); it lives here so it is node-tested.
 */

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function historyPathToD(path) {
  if (!Array.isArray(path)) return '';
  return path
    .filter(Array.isArray)
    .map((command) => command.map((part) => (typeof part === 'number' ? Number(part.toFixed(2)) : part)).join(' '))
    .join(' ');
}

export function historyPointsToString(points) {
  if (!Array.isArray(points)) return '';
  return points
    .map((point) => {
      if (Array.isArray(point)) return `${num(point[0])},${num(point[1])}`;
      return `${num(point?.x)},${num(point?.y)}`;
    })
    .join(' ');
}

export function historyPathBounds(path) {
  if (!Array.isArray(path)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of path) {
    if (!Array.isArray(seg)) continue;
    for (let i = 1; i + 1 < seg.length; i += 2) {
      const x = Number(seg[i]);
      const y = Number(seg[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

function typeOf(annotation) {
  return String(annotation?.type || annotation?.data?.type || annotation?.pdfAnnotationType || '').toLowerCase();
}

function rotatedBox(x, y, w, h, angle, cx = x + w / 2, cy = y + h / 2) {
  if (!angle) return { x, y, width: w, height: h };
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [
    cx + (px - cx) * cos - (py - cy) * sin,
    cy + (px - cx) * sin + (py - cy) * cos,
  ]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * The box a mark covers on its page, in page units, or null.
 * { x, y, width, height }
 */
export function historyAnnotationBox(annotation) {
  if (!annotation || typeof annotation !== 'object') return null;
  const type = typeOf(annotation);
  const left = num(annotation.left);
  const top = num(annotation.top);
  const scaleX = num(annotation.scaleX, 1) || 1;
  const scaleY = num(annotation.scaleY, 1) || 1;
  const angle = num(annotation.angle);
  if (Array.isArray(annotation.path)) {
    const b = historyPathBounds(annotation.path);
    if (!b) return null;
    const offX = num(annotation.pathOffset?.x);
    const offY = num(annotation.pathOffset?.y);
    const x1 = left + scaleX * (b.minX - offX);
    const y1 = top + scaleY * (b.minY - offY);
    const x2 = left + scaleX * (b.maxX - offX);
    const y2 = top + scaleY * (b.maxY - offY);
    const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    return angle ? rotatedBox(box.x, box.y, box.width, box.height, angle) : box;
  }
  if (Array.isArray(annotation.points) && annotation.points.length > 1) {
    const pts = annotation.points.map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p?.x), num(p?.y)]));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  if ((type.includes('line') || type === 'arrow') && [annotation.x1, annotation.y1, annotation.x2, annotation.y2].every((v) => Number.isFinite(Number(v)))) {
    const ax = left + num(annotation.x1);
    const ay = top + num(annotation.y1);
    const bx = left + num(annotation.x2);
    const by = top + num(annotation.y2);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
  }
  const width = Math.abs(num(annotation.width) * scaleX);
  const height = Math.abs(num(annotation.height) * scaleY);
  if (!(width > 0) && !(height > 0)) return null;
  const x = annotation.originX === 'center' ? left - width / 2 : left;
  const y = annotation.originY === 'center' ? top - height / 2 : top;
  return angle ? rotatedBox(x, y, width, height, angle) : { x, y, width, height };
}

/**
 * An SVG element drawing the mark's outline in page units (for a ghost), or
 * null. The caller styles it (dashed, color, opacity).
 */
export function buildHistoryShapeNode(doc, annotation) {
  if (!doc || !annotation || typeof annotation !== 'object') return null;
  const NS = 'http://www.w3.org/2000/svg';
  const type = typeOf(annotation);
  const left = num(annotation.left);
  const top = num(annotation.top);
  const angle = num(annotation.angle);
  const scaleX = num(annotation.scaleX, 1);
  const scaleY = num(annotation.scaleY, 1);
  let node = null;
  if (Array.isArray(annotation.path)) {
    const d = historyPathToD(annotation.path);
    if (!d) return null;
    node = doc.createElementNS(NS, 'path');
    node.setAttribute('d', d);
    const offX = num(annotation.pathOffset?.x);
    const offY = num(annotation.pathOffset?.y);
    const b = historyPathBounds(annotation.path);
    const rcx = b ? scaleX * ((b.minX + b.maxX) / 2 - offX) : 0;
    const rcy = b ? scaleY * ((b.minY + b.maxY) / 2 - offY) : 0;
    let transform = `translate(${left}, ${top})`;
    if (angle) transform += ` rotate(${angle}, ${rcx}, ${rcy})`;
    if (scaleX !== 1 || scaleY !== 1) transform += ` scale(${scaleX}, ${scaleY})`;
    transform += ` translate(${-offX}, ${-offY})`;
    node.setAttribute('transform', transform);
    return node;
  }
  if (Array.isArray(annotation.points) && annotation.points.length > 1) {
    node = doc.createElementNS(NS, type.includes('polygon') ? 'polygon' : 'polyline');
    node.setAttribute('points', historyPointsToString(annotation.points));
    return node;
  }
  if ((type.includes('line') || type === 'arrow') && [annotation.x1, annotation.y1, annotation.x2, annotation.y2].every((v) => Number.isFinite(Number(v)))) {
    node = doc.createElementNS(NS, 'line');
    node.setAttribute('x1', `${left + num(annotation.x1)}`);
    node.setAttribute('y1', `${top + num(annotation.y1)}`);
    node.setAttribute('x2', `${left + num(annotation.x2)}`);
    node.setAttribute('y2', `${top + num(annotation.y2)}`);
    return node;
  }
  const box = historyAnnotationBox({ ...annotation, angle: 0 });
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  if (type.includes('circle') || type.includes('ellipse')) {
    node = doc.createElementNS(NS, 'ellipse');
    node.setAttribute('cx', `${box.x + box.width / 2}`);
    node.setAttribute('cy', `${box.y + box.height / 2}`);
    node.setAttribute('rx', `${box.width / 2}`);
    node.setAttribute('ry', `${box.height / 2}`);
  } else {
    node = doc.createElementNS(NS, 'rect');
    node.setAttribute('x', `${box.x}`);
    node.setAttribute('y', `${box.y}`);
    node.setAttribute('width', `${box.width}`);
    node.setAttribute('height', `${box.height}`);
    node.setAttribute('rx', type === 'surveymarker' ? '2' : '1');
  }
  if (angle) node.setAttribute('transform', `rotate(${angle} ${box.x + box.width / 2} ${box.y + box.height / 2})`);
  return node;
}

/**
 * A bulk delete (select + Delete, or the eraser removing several marks): one
 * ghost per mark, each with its page and id.
 * [{ markId, pageNumber, annotation }]
 */
export function historyBulkGhosts(row) {
  const objects = Array.isArray(row?.payload?.objects) ? row.payload.objects : [];
  const out = [];
  for (const object of objects) {
    const ra = object?.restoreAction || {};
    const annotation = historyRowGhostAnnotation({ payload: { restoreAction: ra } });
    const pageNumber = Number(object?.pageNumber ?? ra.pageNumber ?? ra.region?.pageId);
    const markId = object?.annotationId || ra.annotationId || ra.annotation?.data?.id || ra.annotation?.id
      || ra.created?.[0]?.id || ra.markerId || ra.callout?.id || null;
    if (annotation && Number.isFinite(pageNumber) && pageNumber > 0) out.push({ markId, pageNumber, annotation });
  }
  return out;
}

/** The box around several boxes (or null). */
export function historyUnionBox(boxes) {
  const list = (boxes || []).filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  const r = Math.max(...list.map((b) => b.x + b.width));
  const btm = Math.max(...list.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

/** The stored copy of the mark a row is about (for a ghost), or null. */
export function historyRowGhostAnnotation(row) {
  const payload = row?.payload || {};
  const ra = payload.restoreAction || {};
  if (ra.type === 'surveyMarker') {
    const b = ra.surveyMarker?.bounds;
    return b ? { type: 'surveyMarker', left: num(b.x), top: num(b.y), width: num(b.width), height: num(b.height), angle: num(b.angle) } : null;
  }
  if (payload.previewAnnotation) return payload.previewAnnotation;
  if (ra.annotation) return ra.annotation;
  if (Array.isArray(ra.created) && ra.created[0]?.annotation) return ra.created[0].annotation;
  if (ra.callout && typeof ra.callout === 'object') {
    const c = ra.callout;
    const box = c.box || c.textBox || c;
    if (Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.width))) {
      return { type: 'rect', left: num(box.x), top: num(box.y), width: num(box.width), height: num(box.height) };
    }
  }
  if (ra.region?.bounds) {
    const b = ra.region.bounds;
    return { type: 'rect', left: num(b.x ?? b.left), top: num(b.y ?? b.top), width: num(b.width), height: num(b.height) };
  }
  return null;
}
