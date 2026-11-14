// Nightly 'ruler-tool' (Drawboard PDF Draw > Ruler): a straight edge that
// sits over the pages in screen space. Move it by dragging it, turn it with
// two fingers, the end grabber or the mouse wheel. A pen or highlighter line
// started just outside one of its long edges runs along that edge, so it
// comes out straight. It is never saved.
//
// The on/off switch and the ruler's place live here, outside React, so the
// desktop and phone toolbars and the drawing layer read the same state.
import { useSyncExternalStore } from 'react';

export const RULER_WIDTH = 64; // screen px across
export const RULER_REACH = 28; // screen px outside an edge where a stroke locks to it
export const RULER_SNAP_DEG = 15; // the angle settles on a multiple of this ...
export const RULER_SNAP_WITHIN = 2; // ... when it is this close

let on = false;
let place = null; // { cx, cy, angle (deg), length } in client px
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function isRulerOn() { return on; }
export function setRulerOn(next) {
  const value = Boolean(next);
  if (value === on) return;
  on = value;
  emit();
}
export const toggleRuler = () => setRulerOn(!on);
export function getRulerPlace() { return on ? place : null; }
export function setRulerPlace(next) { place = next ? { ...next } : null; emit(); }

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useRulerOn = () => useSyncExternalStore(subscribe, isRulerOn, () => false);
export const useRulerPlace = () => useSyncExternalStore(subscribe, () => place, () => null);

/** Angle in degrees, kept in (-180, 180], settled on 0 / 15 / 30 ... when near one. */
export function settleAngle(deg) {
  let a = ((Number(deg) || 0) % 360 + 360) % 360;
  if (a > 180) a -= 360;
  const nearest = Math.round(a / RULER_SNAP_DEG) * RULER_SNAP_DEG;
  return Math.abs(a - nearest) <= RULER_SNAP_WITHIN ? (nearest === -180 ? 180 : nearest || 0) : a;
}

/** The angle the readout shows: 0..180, as a protractor reads a line. */
export const readoutAngle = (deg) => {
  const a = Math.round(((Number(deg) || 0) % 180 + 180) % 180);
  return a === 180 ? 0 : a;
};

/** The two long edges: { a, b, dir, normal (pointing away from the ruler) }. */
export function rulerEdges(r, width = RULER_WIDTH) {
  if (!r) return [];
  const rad = (r.angle * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };
  const up = { x: dir.y, y: -dir.x }; // screen "up" from the ruler's point of view
  const half = r.length / 2;
  const side = (sign) => {
    const ox = r.cx + up.x * sign * (width / 2);
    const oy = r.cy + up.y * sign * (width / 2);
    return {
      a: { x: ox - dir.x * half, y: oy - dir.y * half },
      b: { x: ox + dir.x * half, y: oy + dir.y * half },
      dir,
      normal: { x: up.x * sign, y: up.y * sign },
    };
  };
  return [side(1), side(-1)];
}

/** The edge a stroke starting at (x, y) locks to, or null. */
export function rulerEdgeNear(r, x, y, { reach = RULER_REACH, width = RULER_WIDTH } = {}) {
  let best = null;
  for (const edge of rulerEdges(r, width)) {
    const dx = x - edge.a.x;
    const dy = y - edge.a.y;
    const along = dx * edge.dir.x + dy * edge.dir.y;
    const away = dx * edge.normal.x + dy * edge.normal.y;
    if (along < -reach || along > r.length + reach) continue;
    if (away < -4 || away > reach) continue;
    if (!best || Math.abs(away) < Math.abs(best.away)) best = { edge, away };
  }
  return best ? best.edge : null;
}

/** (x, y) moved straight onto the edge's line. */
export function projectOntoEdge(edge, x, y) {
  const along = (x - edge.a.x) * edge.dir.x + (y - edge.a.y) * edge.dir.y;
  return { x: edge.a.x + edge.dir.x * along, y: edge.a.y + edge.dir.y * along };
}

/** Where the ruler first appears: across the middle of the viewer, level. */
export function startingPlace(rect) {
  const length = Math.max(240, Math.min(900, (rect?.width || 800) * 0.7));
  return { cx: (rect?.left || 0) + (rect?.width || 800) / 2, cy: (rect?.top || 0) + (rect?.height || 600) / 2, angle: 0, length };
}
