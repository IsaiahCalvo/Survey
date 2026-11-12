/*
 * Drawboard keeps a drawn arrow's head inside the page: the line end stops
 * short of the edge by as much as the head reaches past it (Drawboard PDF Pro
 * trial, t2-tools-deep.md: Survey's head poked about 6.6 pt past the edge).
 * Pure: the head's footprint comes from the same spec the page draws.
 */
import { buildArrowheadRenderSpec } from './lineRenderHelpers.js';
import { lineEndingCreateOptions } from './lineEndingDefaults.js';

const pointsOf = (text) => String(text || '').trim().split(/\s+/).map((pair) => pair.split(',').map(Number))
  .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

/**
 * The page box an ending covers when its tip sits at (tipX, tipY) and the line
 * runs in at angleDeg, or null for no ending.
 * @returns {{ minX:number, minY:number, maxX:number, maxY:number } | null}
 */
export function arrowheadBounds(style, tipX, tipY, angleDeg, strokeWidth, geometry = null) {
  const spec = buildArrowheadRenderSpec(style, tipX, tipY, angleDeg, '#000', Number(strokeWidth) || 2, { geometry });
  if (!spec || spec.kind === 'none') return null;
  const pts = [];
  let pad = 0;
  // Drawboard's heads (Nightly 'line-endings'): page-space shapes. A mitred
  // corner can reach past its point by up to the miter limit (4) x half the
  // stroke, so pad by that much for outlined shapes.
  for (const shape of spec.shapes || []) {
    if (shape.type === 'circle') {
      pts.push([shape.cx - shape.r, shape.cy - shape.r], [shape.cx + shape.r, shape.cy + shape.r]);
    } else {
      for (const p of shape.points) pts.push([p.x, p.y]);
    }
    if (shape.stroke && shape.stroke !== 'none' && shape.strokeWidth > 0) {
      pad = Math.max(pad, (shape.strokeWidth / 2) * (shape.type === 'circle' || (shape.points.length < 3) ? 1 : 2));
    }
  }
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  if (spec.polygon) {
    // Local points under translate(tip) rotate(angle).
    for (const [x, y] of pointsOf(spec.polygon.points)) pts.push([tipX + x * cos - y * sin, tipY + x * sin + y * cos]);
    if (spec.polygon.stroke) pad = (Number(spec.polygon.strokeWidth) || 0) / 2;
  }
  if (spec.polyline) {
    pts.push(...pointsOf(spec.polyline.points));
    pad = (Number(spec.polyline.strokeWidth) || 0) / 2;
  }
  if (spec.line) {
    pts.push([spec.line.x1, spec.line.y1], [spec.line.x2, spec.line.y2]);
    pad = (Number(spec.line.strokeWidth) || 0) / 2;
  }
  if (spec.circle) {
    const r = Number(spec.circle.r) || 0;
    pts.push([spec.circle.cx - r, spec.circle.cy - r], [spec.circle.cx + r, spec.circle.cy + r]);
    pad = (Number(spec.circle.strokeWidth) || 0) / 2;
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}

/**
 * A line end (already held on the page) moved in so its ending stays on the
 * page too. The start is where the line comes from. Bad input, no ending or a
 * head that already fits comes back unchanged.
 */
export function keepArrowheadOnPage(start, end, options = {}) {
  // A sideways nudge turns the head a little, so check again (twice is plenty).
  let kept = end;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = keepArrowheadOnPageOnce(start, kept, options);
    if (next === kept) break;
    kept = next;
  }
  return kept;
}

function keepArrowheadOnPageOnce(start, end, { style, strokeWidth, pageWidth, pageHeight, geometry = null } = {}) {
  if (!start || !end || ![start.x, start.y, end.x, end.y].every(Number.isFinite)) return end;
  if (!(pageWidth > 0 && pageHeight > 0)) return end;
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) return end;
  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  const box = arrowheadBounds(style, end.x, end.y, angle, strokeWidth, geometry);
  if (!box) return end;
  let dx = 0;
  let dy = 0;
  if (box.maxX > pageWidth + 1e-9) dx = pageWidth - box.maxX;
  else if (box.minX < -1e-9) dx = -box.minX;
  if (box.maxY > pageHeight + 1e-9) dy = pageHeight - box.maxY;
  else if (box.minY < -1e-9) dy = -box.minY;
  if (!dx && !dy) return end;
  // Pull the end back along the line, so a snapped angle keeps its slope; a
  // head that only hangs over sideways (the line runs along that edge) moves
  // straight in instead.
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  const ux = (end.x - start.x) / len;
  const uy = (end.y - start.y) / len;
  const along = Math.max(
    dx && Math.abs(ux) > 0.2 && Math.sign(dx) === -Math.sign(ux) ? Math.abs(dx / ux) : 0,
    dy && Math.abs(uy) > 0.2 && Math.sign(dy) === -Math.sign(uy) ? Math.abs(dy / uy) : 0,
  );
  const x = end.x - ux * along;
  const y = end.y - uy * along;
  const restX = dx && !(Math.abs(ux) > 0.2 && Math.sign(dx) === -Math.sign(ux)) ? dx : 0;
  const restY = dy && !(Math.abs(uy) > 0.2 && Math.sign(dy) === -Math.sign(uy)) ? dy : 0;
  return { ...end, x: x + restX, y: y + restY };
}

/**
 * The end of a line being drawn with the Arrow tool, kept so its head fits on
 * the page (the tool's picked head, or the solid triangle it falls back to,
 * as buildLineRenderSpec does). Any other tool's point comes back unchanged.
 */
export function keepDrawnArrowOnPage(tool, start, end, { arrowheadStyle, strokeWidth, pageWidth, pageHeight } = {}) {
  // Nightly 'line-endings': a Line or an Arrow with Drawboard's End head.
  const drawboard = lineEndingCreateOptions(tool);
  if (drawboard.endingSet) {
    return keepArrowheadOnPage(start, end, {
      style: drawboard.arrowheadStyle, strokeWidth: Number(strokeWidth) || 3, pageWidth, pageHeight, geometry: drawboard.endingSet,
    });
  }
  if (tool !== 'arrow') return end;
  const style = arrowheadStyle || 'solidTriangle';
  return keepArrowheadOnPage(start, end, { style, strokeWidth: Number(strokeWidth) || 3, pageWidth, pageHeight });
}
