// Nightly 'pen-types': Drawboard PDF's three pens (measured live 2026-11-10,
// endings-and-pens.md). One shared width; the type decides how it varies:
//   Basic        "Fixed width"    - the same width all along.
//   Pro          "Variable width" - with a pen, pressure: 0.05 -> 0.5w,
//                                   0.13 -> 0.75w, 0.27 and up -> w; with a
//                                   mouse or finger, speed: slow = w, fast
//                                   about 0.5w, and a short taper at the start.
//   Calligraphy  "Dynamic width"  - the direction of travel (screen y down):
//                                   down 1.75w, down-right 1.2w, down-left
//                                   0.75w, sideways or any upward move 0.5w.
// The factors are stored per centerline point (data.penWidths) so a width
// change keeps the shape of the stroke.
import { useSyncExternalStore } from 'react';
import { isFeatureOn } from '../featureFlags.js';

export const PEN_TYPES = Object.freeze([
  Object.freeze({ id: 'basic', label: 'Basic', sub: 'Fixed width' }),
  Object.freeze({ id: 'pro', label: 'Pro', sub: 'Variable width' }),
  Object.freeze({ id: 'calligraphy', label: 'Calligraphy', sub: 'Dynamic width' }),
]);
export const PEN_TYPE_STORAGE_KEY = 'survey.penType';
const isPenType = (id) => PEN_TYPES.some((type) => type.id === id);

let current = null;
const listeners = new Set();
const read = () => {
  if (current == null) {
    let stored = null;
    try { stored = typeof localStorage !== 'undefined' ? localStorage.getItem(PEN_TYPE_STORAGE_KEY) : null; } catch { stored = null; }
    current = isPenType(stored) ? stored : 'basic';
  }
  return current;
};

export function getPenType() { return read(); }

export function setPenType(id) {
  if (!isPenType(id) || read() === id) return;
  current = id;
  try { localStorage.setItem(PEN_TYPE_STORAGE_KEY, id); } catch { /* private mode */ }
  listeners.forEach((fn) => fn());
}

export function usePenType() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, read, read);
}

/** The pen type a new Pen stroke uses: the pick while the flag is on, else Basic. */
export function activePenType() {
  return isFeatureOn('pen-types') ? read() : 'basic';
}

export function resetPenTypeForTests() { current = null; }

// ---------------------------------------------------------------------------
// Width factors (1 = the picked width).

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Pro with a pen: Drawboard's pressure curve. */
export function proPressureFactor(pressure) {
  const p = Number(pressure) || 0;
  if (p <= 0.05) return 0.5;
  if (p <= 0.13) return lerp(0.5, 0.75, (p - 0.05) / 0.08);
  if (p <= 0.27) return lerp(0.75, 1, (p - 0.13) / 0.14);
  return 1;
}

// Pro with a mouse: page units per millisecond. Slower than SLOW is full
// width; faster than FAST is half.
const PRO_SLOW = 0.25;
const PRO_FAST = 1.5;
export function proSpeedFactor(speed) {
  return 1 - 0.5 * clamp01((Number(speed) - PRO_SLOW) / (PRO_FAST - PRO_SLOW));
}

// Calligraphy: Drawboard's measured widths by direction (degrees, y down).
const CALLIGRAPHY_TABLE = [[0, 0.5], [45, 1.2], [90, 1.75], [135, 0.75], [180, 0.5]];
export function calligraphyFactor(angleDeg) {
  let a = ((Number(angleDeg) % 360) + 360) % 360;
  if (a > 180) return 0.5; // any upward move is thin
  for (let i = 1; i < CALLIGRAPHY_TABLE.length; i += 1) {
    const [a1, f1] = CALLIGRAPHY_TABLE[i];
    if (a <= a1) {
      const [a0, f0] = CALLIGRAPHY_TABLE[i - 1];
      const t = (a - a0) / (a1 - a0);
      // Eased between the measured points so the width turns smoothly.
      return lerp(f0, f1, (1 - Math.cos(Math.PI * t)) / 2);
    }
  }
  return 0.5;
}

// Smooth a list of factors along the stroke by arc length (window ~ w).
function smoothAlong(points, factors, span) {
  if (factors.length < 3 || !(span > 0)) return factors;
  const out = new Array(factors.length);
  let prev = factors[0];
  out[0] = prev;
  for (let i = 1; i < factors.length; i += 1) {
    const ds = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const k = 1 - Math.exp(-ds / span);
    prev += (factors[i] - prev) * k;
    out[i] = prev;
  }
  return out;
}

/**
 * Factor per point for a stroke drawn with this pen type, or null for Basic.
 * Points may carry t (ms), p (pressure) and k (pointer type) from the pointer.
 */
export function penWidthFactors(points, type, width = 2) {
  if (!Array.isArray(points) || points.length === 0 || (type !== 'pro' && type !== 'calligraphy')) return null;
  const w = Math.max(0.5, Number(width) || 2);
  const n = points.length;
  if (type === 'calligraphy') {
    // Direction from a short look-around (about one width each way), so a
    // jittery mouse does not flicker the nib.
    const raw = points.map((pt, i) => {
      let a = i;
      let b = i;
      while (a > 0 && Math.hypot(pt.x - points[a].x, pt.y - points[a].y) < w) a -= 1;
      while (b < n - 1 && Math.hypot(points[b].x - pt.x, points[b].y - pt.y) < w) b += 1;
      const dx = points[b].x - points[a].x;
      const dy = points[b].y - points[a].y;
      if (dx === 0 && dy === 0) return null;
      return calligraphyFactor((Math.atan2(dy, dx) * 180) / Math.PI);
    });
    const firstKnown = raw.find((f) => f != null) ?? 1;
    let last = firstKnown;
    const filled = raw.map((f) => (f == null ? last : (last = f)));
    return smoothAlong(points, filled, w * 0.75);
  }
  // Pro.
  const pens = points.filter((pt) => pt.k === 'pen' && Number(pt.p) > 0).length;
  if (pens > n / 2) {
    return smoothAlong(points, points.map((pt) => proPressureFactor(pt.p)), w * 0.5);
  }
  const timed = points.every((pt) => Number.isFinite(pt.t));
  const raw = points.map((pt, i) => {
    if (!timed || i === 0) return 1;
    const prev = points[i - 1];
    const dt = Math.max(1, pt.t - prev.t);
    return proSpeedFactor(Math.hypot(pt.x - prev.x, pt.y - prev.y) / dt);
  });
  const smooth = smoothAlong(points, raw, w * 2);
  // A short taper at the start: from half width to full over 4 widths.
  let travelled = 0;
  return smooth.map((f, i) => {
    if (i > 0) travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return Math.min(f, 0.5 + 0.5 * clamp01(travelled / (4 * w)));
  });
}
