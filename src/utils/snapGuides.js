/**
 * snapGuides.js — Drawboard-style snapping for moved / resized / rotated
 * marks (canvas audit 2026-10-13, chunks 2 + 3).
 *
 * The numbers are Drawboard PDF 5.9.3's own (bundle Snapping.jsx l.64148-64760,
 * transform modifiers l.59700-59800 — see scratchpad drawboardDeep/CANVAS.md):
 *   - a dragged mark's edges line up with other marks' edges, and its centre
 *     with their centres, within 6 SCREEN px (so it feels the same at every
 *     zoom); each axis snaps on its own;
 *   - a dashed guide (1.9 px, 5 px dashes) runs 24 px past both marks, with a
 *     small X on every lined-up corner / centre;
 *   - holding Alt drags freely. (Drawboard uses Ctrl / Cmd, but here Cmd /
 *     Ctrl + press already MOVES a selection from inside its box (w58) and
 *     whole-moves a callout, so it cannot also mean "no snapping". Alt has
 *     no job mid-drag, and Drawboard's own Alt already means "free" for
 *     rotation and "from the centre" for resize.)
 *   - the snapping switch (the rail's magnet button, Shift+S, Settings >
 *     Annotations) turns all of it off until switched back on;
 *   - no page-edge snapping (Drawboard has none).
 *
 * All geometry is in PAGE units (the SVG viewBox), so guides are drawn in the
 * viewBox and zoom stays owned by it (CLAUDE.md). Only the threshold and the
 * guide stroke are converted from screen px with `inverseScale` (page units
 * per screen px).
 *
 * Pure JS — the Node test runner imports it directly.
 */

import { readAnnotationSnapping } from './annotationPreferences.js';

export const SNAP_DISTANCE_PX = 6;
export const SNAP_GUIDE_OVERHANG_PX = 24;
export const SNAP_GUIDE_STROKE_PX = 1.9;
export const SNAP_GUIDE_DASH_PX = 5;
export const SNAP_MARK_HALF_PX = 2.83; // Drawboard: Math.SQRT1_2 * 4
/** Two values this close (page units) count as lined up (Drawboard: 0.01). */
export const SNAP_ALIGN_EPS = 0.01;

/** Rotation: right-angle magnet (no key) and the hard Shift step. */
export const ROTATE_MAGNET_DEG = 4;
export const ROTATE_SHIFT_STEP_DEG = 15;

/** Alt held: this frame of the drag is free of snapping (see header). */
export function isSnapFreeModifier(event) {
  return !!(event && event.altKey);
}

/**
 * Snapping switched off (the rail's magnet button, Shift+S, Settings) or Alt
 * held: no lining up with other marks. Rotation drops only its right-angle
 * magnet (snapRotationDegrees); Shift's steps still apply.
 */
export function isAnnotationSnapFree(event) {
  return !readAnnotationSnapping() || isSnapFreeModifier(event);
}

/** Page units for the 6 px screen threshold. */
export function snapThreshold(inverseScale, px = SNAP_DISTANCE_PX) {
  const inv = Number(inverseScale);
  return px * (Number.isFinite(inv) && inv > 0 ? inv : 1);
}

/** { left, top, width, height } -> edges + centre, or null when unusable. */
export function boxEdges(box) {
  if (!box) return null;
  const left = Number(box.left);
  const top = Number(box.top);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  const right = left + Math.max(0, width);
  const bottom = top + Math.max(0, height);
  return { left, top, right, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

export function shiftBox(box, dx, dy) {
  if (!box) return box;
  return { ...box, left: box.left + dx, top: box.top + dy };
}

/** The smallest box around all of `boxes` (a multi-selection snaps as one). */
export function unionBox(boxes) {
  let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
  for (const box of boxes || []) {
    const e = boxEdges(box);
    if (!e) continue;
    l = Math.min(l, e.left); t = Math.min(t, e.top);
    r = Math.max(r, e.right); b = Math.max(b, e.bottom);
  }
  if (!Number.isFinite(l)) return null;
  return { left: l, top: t, width: r - l, height: b - t };
}

/** Does `box` touch the `area` box (both { left, top, width, height })? */
export function boxesTouch(box, area) {
  const a = boxEdges(box);
  const b = boxEdges(area);
  if (!a || !b) return false;
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/**
 * The features of a box that snap on each axis. `which` picks a subset:
 * a move uses all of them; a resize only the edge(s) being dragged.
 * kind 'edge' only meets edges, kind 'center' only centres (Drawboard).
 */
export function snapFeatures(box, which = null) {
  const e = boxEdges(box);
  if (!e) return { x: [], y: [] };
  const want = (name) => !which || which.includes(name);
  const x = [];
  const y = [];
  if (want('left')) x.push({ name: 'left', kind: 'edge', value: e.left });
  if (want('right')) x.push({ name: 'right', kind: 'edge', value: e.right });
  if (want('cx')) x.push({ name: 'cx', kind: 'center', value: e.cx });
  if (want('top')) y.push({ name: 'top', kind: 'edge', value: e.top });
  if (want('bottom')) y.push({ name: 'bottom', kind: 'edge', value: e.bottom });
  if (want('cy')) y.push({ name: 'cy', kind: 'center', value: e.cy });
  return { x, y };
}

const targetValues = (edges, axis, kind) => {
  if (axis === 'x') return kind === 'center' ? [edges.cx] : [edges.left, edges.right];
  return kind === 'center' ? [edges.cy] : [edges.top, edges.bottom];
};

/**
 * Nearest snap on each axis: how far to shift the moving features so the
 * closest one lands exactly on another mark's edge / centre. 0 on an axis
 * with nothing within `threshold`.
 *
 * @param {{x: Array, y: Array}} features - from snapFeatures
 * @param {Array} targets - other marks' boxes { left, top, width, height }
 * @param {number} threshold - page units
 */
export function findSnapOffset(features, targets, threshold) {
  const result = { dx: 0, dy: 0, snappedX: false, snappedY: false };
  if (!(threshold > 0)) return result;
  const edgesList = (targets || []).map(boxEdges).filter(Boolean);
  for (const axis of ['x', 'y']) {
    let best = Infinity;
    let offset = 0;
    for (const f of features?.[axis] || []) {
      if (!Number.isFinite(f.value)) continue;
      for (const edges of edgesList) {
        for (const value of targetValues(edges, axis, f.kind)) {
          const d = Math.abs(value - f.value);
          if (d <= threshold && d < best) {
            best = d;
            offset = value - f.value;
          }
        }
      }
    }
    if (best !== Infinity) {
      if (axis === 'x') { result.dx = offset; result.snappedX = true; }
      else { result.dy = offset; result.snappedY = true; }
    }
  }
  return result;
}

/**
 * Guides for a FINAL box: one line for every feature that sits exactly on
 * another mark's matching feature. An edge line spans both boxes; a centre
 * line runs centre to centre. Lines on the same axis + value merge. The
 * renderer adds the 24 px overhang. Points = the lined-up corners / centres.
 *
 * @returns {{ lines: Array<{axis, value, min, max}>, points: Array<{x, y}> } | null}
 */
export function buildSnapGuides(box, features, targets, eps = SNAP_ALIGN_EPS) {
  const moving = boxEdges(box);
  if (!moving) return null;
  const edgesList = (targets || []).map(boxEdges).filter(Boolean);
  const lines = [];
  const points = [];
  const addPoint = (x, y) => {
    if (!points.some((p) => Math.abs(p.x - x) < eps && Math.abs(p.y - y) < eps)) points.push({ x, y });
  };
  for (const axis of ['x', 'y']) {
    const cross = axis === 'x' ? ['top', 'bottom', 'cy'] : ['left', 'right', 'cx'];
    for (const f of features?.[axis] || []) {
      if (!Number.isFinite(f.value)) continue;
      const hits = edgesList.filter((edges) => targetValues(edges, axis, f.kind)
        .some((value) => Math.abs(value - f.value) < eps));
      if (!hits.length) continue;
      const spanOf = (edges) => (f.kind === 'center'
        ? [edges[cross[2]], edges[cross[2]]]
        : [edges[cross[0]], edges[cross[1]]]);
      let [min, max] = spanOf(moving);
      for (const edges of hits) {
        const [a, b] = spanOf(edges);
        min = Math.min(min, a);
        max = Math.max(max, b);
      }
      const existing = lines.find((line) => line.axis === axis && Math.abs(line.value - f.value) < eps);
      if (existing) {
        existing.min = Math.min(existing.min, min);
        existing.max = Math.max(existing.max, max);
      } else {
        lines.push({ axis, value: f.value, min, max });
      }
      for (const edges of [moving, ...hits]) {
        const [a, b] = spanOf(edges);
        for (const c of a === b ? [a] : [a, b]) {
          if (axis === 'x') addPoint(f.value, c);
          else addPoint(c, f.value);
        }
      }
    }
  }
  return lines.length ? { lines, points } : null;
}

/**
 * One call for a move: snap `box` (already moved by the raw pointer delta)
 * to `targets`. Returns the extra shift to apply. Guides are built later from
 * the box that is really shown (after any page clamp) with buildSnapGuides.
 */
export function snapMoveBox(box, targets, threshold) {
  return findSnapOffset(snapFeatures(box), targets, threshold);
}

/**
 * One frame of a plain box move (the Survey Marker drag in
 * SVGAnnotationLayer keeps its own drag state): snapped delta + guides.
 */
export function snapMoveFrame(box, dx, dy, targets, threshold) {
  const off = snapMoveBox(shiftBox(box, dx, dy), targets, threshold);
  const ndx = dx + off.dx;
  const ndy = dy + off.dy;
  const shown = shiftBox(box, ndx, ndy);
  return { dx: ndx, dy: ndy, guides: buildSnapGuides(shown, snapFeatures(shown), targets) };
}

/**
 * One frame of an upright box resize whose dragged handle sits on the
 * pointer: the dragged edge(s) pull to other marks' edges. Returns the
 * snapped pointer and the moving features (for buildSnapGuides).
 */
export function snapResizePoint(point, handleId, targets, threshold) {
  const affectsX = !['mt', 'mb'].includes(handleId);
  const affectsY = !['ml', 'mr'].includes(handleId);
  const features = {
    x: affectsX ? [{ name: 'edge', kind: 'edge', value: point.x }] : [],
    y: affectsY ? [{ name: 'edge', kind: 'edge', value: point.y }] : [],
  };
  const off = findSnapOffset(features, targets, threshold);
  const x = point.x + off.dx;
  const y = point.y + off.dy;
  return {
    x,
    y,
    features: {
      x: affectsX ? [{ name: 'edge', kind: 'edge', value: x }] : [],
      y: affectsY ? [{ name: 'edge', kind: 'edge', value: y }] : [],
    },
  };
}

/** Same guide set? (skips a React state update per pointer frame). */
export function sameSnapGuides(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (!!a.endpoint !== !!b.endpoint) return false;
  if (a.endpoint && (Math.abs(a.endpoint.x - b.endpoint.x) > 1e-6 || Math.abs(a.endpoint.y - b.endpoint.y) > 1e-6)) return false;
  if (a.lines.length !== b.lines.length || a.points.length !== b.points.length) return false;
  const near = (p, q) => Math.abs(p - q) < 1e-6;
  for (let i = 0; i < a.lines.length; i += 1) {
    const p = a.lines[i]; const q = b.lines[i];
    if (p.axis !== q.axis || !near(p.value, q.value) || !near(p.min, q.min) || !near(p.max, q.max)) return false;
  }
  for (let i = 0; i < a.points.length; i += 1) {
    if (!near(a.points[i].x, b.points[i].x) || !near(a.points[i].y, b.points[i].y)) return false;
  }
  return true;
}

/**
 * Which marks take part in snapping, both as the thing dragged and as a
 * target. Freehand ink and highlighter strokes have no real edges (their box
 * is wobble), and text highlights / underlines belong to the PDF's words, so
 * they neither snap nor pull other marks. Everything else snaps by its box.
 */
export function isSnappableMark(obj) {
  if (!obj) return false;
  const data = obj.data || {};
  if (data.type === 'text-markup') return false;
  const tool = String(obj.tool || data.tool || '').toLowerCase();
  if (tool === 'pen' || tool === 'highlighter' || tool === 'ink') return false;
  const type = String(obj.type || '').toLowerCase();
  if (type === 'path') {
    const cloud = data.lineStyle === 'cloud' || data.style?.lineStyle === 'cloud'
      || data.cloud === true || data.borderStyle === 'cloud';
    if (!cloud) return false;
  }
  return true;
}

/**
 * The box a mark snaps by. A counter snaps by its round body, not the nub
 * (nubs point different ways, so a row of counters lines up by their
 * bubbles); other marks by their on-page box.
 */
export function snapBoxForMark(obj, worldBox) {
  if (obj?.data?.type === 'counter') {
    const r = (Number(obj.radius) || 14) * Math.abs(Number(obj.scaleX) || 1);
    const left = Number(obj.left) || 0;
    const top = Number(obj.top) || 0;
    return { left, top, width: 2 * r, height: 2 * r };
  }
  return worldBox || null;
}

/**
 * The box a callout snaps by: its text box as drawn (the renderer adds a
 * descender band of 0.35 x font size under the stored box). The arrow tip
 * points at the drawing, so it is not an edge anything should line up with.
 * Callout geometry is stored 0-1 of the page; the box is in page units.
 */
export function calloutSnapBox(callout, pageWidth, pageHeight) {
  const pos = callout?.textBoxPosition;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  const W = pageWidth || 1;
  const H = pageHeight || 1;
  const fontSize = Number(callout.style?.fontSize ?? callout.fontSize ?? 12) || 12;
  return {
    left: pos.x * W,
    top: pos.y * H,
    width: (Number(callout.textBoxWidth) || 0) * W,
    height: (Number(callout.textBoxHeight) || 0) * H + fontSize * 0.35,
  };
}

/**
 * Photos and stamps (both stored as type 'image') keep their proportions on
 * a corner drag without Shift, so they are never squashed by accident
 * (Drawboard: images and signatures always keep them).
 */
export function keepsProportions(obj) {
  return String(obj?.type || '').toLowerCase() === 'image';
}

/**
 * Rotation feel (Drawboard, audit numbers): no key = whole degrees with a
 * magnet to 0 / 90 / 180 / 270 within 4°; Shift = hard 15° steps; Alt =
 * free. With snapping switched off (`magnet` false, the device preference)
 * there is no right-angle magnet, only whole degrees; Shift still steps.
 * The result is NOT wrapped to [0, 360) — callers keep
 * their own range (a group delta may be negative).
 */
export function snapRotationDegrees(angle, { shift = false, free = false, magnet = readAnnotationSnapping() } = {}) {
  const a = Number(angle);
  if (!Number.isFinite(a) || free) return a;
  if (shift) return Math.round(a / ROTATE_SHIFT_STEP_DEG) * ROTATE_SHIFT_STEP_DEG;
  const right = Math.round(a / 90) * 90;
  if (magnet && Math.abs(a - right) <= ROTATE_MAGNET_DEG) return right;
  return Math.round(a);
}

/** Is this angle (degrees) a right angle, so guides read as square? */
export function isRightAngle(angle, eps = 0.01) {
  const a = ((Number(angle) % 90) + 90) % 90;
  return a < eps || 90 - a < eps;
}

/**
 * Shift + corner keeps proportions by following the BIGGER move (Drawboard),
 * so the corner stays under the pointer on that axis — not the average,
 * which let the corner slide away from the pointer. Scales are signed (a
 * flip keeps its sign per axis); `startX/startY` are the scales at grab.
 */
export function lockAspectToBiggerMove(scaleX, scaleY, startX = 1, startY = 1) {
  const sx0 = Math.abs(Number(startX)) || 1;
  const sy0 = Math.abs(Number(startY)) || 1;
  const kx = Math.abs(Number(scaleX) || 0) / sx0;
  const ky = Math.abs(Number(scaleY) || 0) / sy0;
  const k = Math.abs(kx - 1) >= Math.abs(ky - 1) ? kx : ky;
  return {
    scaleX: (scaleX < 0 ? -1 : 1) * sx0 * k,
    scaleY: (scaleY < 0 ? -1 : 1) * sy0 * k,
  };
}
