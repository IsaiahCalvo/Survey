/**
 * Measure tools (Length / Area) + per-page scale.
 *
 * A scale is { ptPerUnit, unit, label }: how many PDF points one real unit
 * spans on the sheet. The math (real length -> points-per-unit, unit table)
 * is ported from the takeoff repo's calibration-utils.js (computePxPerInch),
 * re-expressed in PDF points so it is zoom-independent: annotations live in
 * page space (SVG viewBox owns zoom), so no zoom factor ever enters here.
 *
 * Storage: annotations sync per object, so a page has no field of its own.
 * Every measurement carries the page scale in data.measure.scale; calibrating
 * re-stamps every measurement on the page in one save (one undo step), and
 * the page scale is read back from them after a reload.
 */

import { computeLineBboxCenter } from '../svgBoundingBox.js';

export const MEASURE_UNITS = Object.freeze({
  in: { inches: 1, label: 'in', area: 'sq in' },
  ft: { inches: 12, label: 'ft', area: 'sq ft' },
  yd: { inches: 36, label: 'yd', area: 'sq yd' },
  mm: { inches: 1 / 25.4, label: 'mm', area: 'mm²' },
  cm: { inches: 1 / 2.54, label: 'cm', area: 'cm²' },
  m: { inches: 1 / 0.0254, label: 'm', area: 'm²' },
});

const PT_PER_INCH = 72;

// Paper inches per one real unit. 1/4" = 1' -> 0.25 paper inch per foot.
export const MEASURE_PRESETS = Object.freeze([
  { id: '1/16', label: '1/16" = 1\'', paperIn: 1 / 16, unit: 'ft' },
  { id: '1/8', label: '1/8" = 1\'', paperIn: 1 / 8, unit: 'ft' },
  { id: '3/16', label: '3/16" = 1\'', paperIn: 3 / 16, unit: 'ft' },
  { id: '1/4', label: '1/4" = 1\'', paperIn: 1 / 4, unit: 'ft' },
  { id: '3/8', label: '3/8" = 1\'', paperIn: 3 / 8, unit: 'ft' },
  { id: '1/2', label: '1/2" = 1\'', paperIn: 1 / 2, unit: 'ft' },
  { id: '3/4', label: '3/4" = 1\'', paperIn: 3 / 4, unit: 'ft' },
  { id: '1', label: '1" = 1\'', paperIn: 1, unit: 'ft' },
  { id: '1:1', label: '1:1', paperIn: 1, unit: 'in' },
  { id: '1:50', label: '1:50', paperIn: (1 / 25.4) / 50 * 1000, unit: 'm' },
  { id: '1:100', label: '1:100', paperIn: (1 / 25.4) / 100 * 1000, unit: 'm' },
]);

export const MEASURE_KINDS = Object.freeze(['length', 'area']);

export function isValidMeasureScale(scale) {
  return !!scale
    && Number.isFinite(Number(scale.ptPerUnit))
    && Number(scale.ptPerUnit) > 0
    && Object.prototype.hasOwnProperty.call(MEASURE_UNITS, scale.unit);
}

export function scaleFromPreset(presetId) {
  const preset = MEASURE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  return { ptPerUnit: preset.paperIn * PT_PER_INCH, unit: preset.unit, label: preset.label };
}

/** Calibrate: a line of `lengthPt` page points is `realLength` `unit` long. */
export function scaleFromCalibration(lengthPt, realLength, unit) {
  const pt = Number(lengthPt);
  const real = Number(realLength);
  if (!MEASURE_UNITS[unit] || !(pt > 0) || !(real > 0) || !Number.isFinite(pt) || !Number.isFinite(real)) return null;
  const ptPerUnit = pt / real;
  return { ptPerUnit, unit, label: `${formatNumber(real)} ${MEASURE_UNITS[unit].label} (calibrated)` };
}

function formatNumber(n) {
  return String(Math.round(n * 100) / 100);
}

export function formatMeasureLength(lengthPt, scale) {
  if (!isValidMeasureScale(scale)) return `${formatNumber(lengthPt / PT_PER_INCH)} in (no scale)`;
  const real = lengthPt / scale.ptPerUnit;
  if (scale.unit === 'ft') {
    // Surveyors read feet-inches: 12' 6".
    let feet = Math.floor(real);
    let inches = Math.round((real - feet) * 12);
    if (inches === 12) { feet += 1; inches = 0; }
    return `${feet}' ${inches}"`;
  }
  return `${real.toFixed(2)} ${MEASURE_UNITS[scale.unit].label}`;
}

export function formatMeasureArea(areaPt2, scale) {
  if (!isValidMeasureScale(scale)) return `${formatNumber(areaPt2 / (PT_PER_INCH * PT_PER_INCH))} sq in (no scale)`;
  const real = areaPt2 / (scale.ptPerUnit * scale.ptPerUnit);
  return `${real.toFixed(2)} ${MEASURE_UNITS[scale.unit].area}`;
}

export function polygonAreaPt(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function polygonCentroid(points) {
  let x = 0;
  let y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

export function getMeasureKind(obj) {
  const kind = obj?.data?.measure?.kind;
  return MEASURE_KINDS.includes(kind) ? kind : null;
}

/** World (page-space) endpoints of a fabric Line JSON, same math as getLineEndpoints. */
export function measureLineEndpoints(obj) {
  const cx = (obj.left ?? 0) + (obj.width ?? 0) / 2;
  const cy = (obj.top ?? 0) + (obj.height ?? 0) / 2;
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  const rad = ((obj.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (x, y) => {
    const dx = (x ?? 0) * sx;
    const dy = (y ?? 0) * sy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  return [at(obj.x1, obj.y1), at(obj.x2, obj.y2)];
}

/** World vertices of a polygon JSON; mirrors renderPolygon's transform chain. */
export function measurePolygonWorldPoints(obj) {
  const pts = Array.isArray(obj?.points) ? obj.points : [];
  if (!pts.length) return [];
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  const ox = obj.pathOffset?.x || 0;
  const oy = obj.pathOffset?.y || 0;
  const xs = pts.map((p) => Number(p?.x) || 0);
  const ys = pts.map((p) => Number(p?.y) || 0);
  const rcx = sx * ((Math.min(...xs) + Math.max(...xs)) / 2 - ox);
  const rcy = sy * ((Math.min(...ys) + Math.max(...ys)) / 2 - oy);
  const rad = ((obj.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return pts.map((p) => {
    const dx = ((Number(p?.x) || 0) - ox) * sx - rcx;
    const dy = ((Number(p?.y) || 0) - oy) * sy - rcy;
    return { x: left + rcx + dx * cos - dy * sin, y: top + rcy + dx * sin + dy * cos };
  });
}

/**
 * A length measurement's drawn path in world space. A bent line (the middle
 * handle pulled off the chord) is the renderer's quadratic through
 * data.midpoint, rotated about the same curve-inclusive bbox centre, so the
 * value is the length of the curve the user sees, not of its chord.
 */
export function measureLinePath(obj) {
  const mid = obj?.data?.midpoint;
  if (!mid || !Number.isFinite(mid.x) || !Number.isFinite(mid.y)) {
    const [a, b] = measureLineEndpoints(obj);
    return { a, b, mid: null };
  }
  const cx = (obj.left ?? 0) + (obj.width ?? 0) / 2;
  const cy = (obj.top ?? 0) + (obj.height ?? 0) / 2;
  const ep = { x1: cx + (obj.x1 ?? 0), y1: cy + (obj.y1 ?? 0), x2: cx + (obj.x2 ?? 0), y2: cy + (obj.y2 ?? 0) };
  const pivot = computeLineBboxCenter(ep, mid);
  const rad = ((obj.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = (x, y) => ({
    x: pivot.x + (x - pivot.x) * cos - (y - pivot.y) * sin,
    y: pivot.y + (x - pivot.x) * sin + (y - pivot.y) * cos,
  });
  return { a: rot(ep.x1, ep.y1), b: rot(ep.x2, ep.y2), mid: rot(mid.x, mid.y) };
}

// Arc length of the quadratic through a, mid (t = 0.5) and b. 128 chords is
// far below a hundredth of a point on any curve that fits on a sheet.
export function quadraticArcLength(a, mid, b) {
  const c = { x: 2 * mid.x - 0.5 * a.x - 0.5 * b.x, y: 2 * mid.y - 0.5 * a.y - 0.5 * b.y };
  const steps = 128;
  let length = 0;
  let prev = a;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const pt = {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
    length += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
  }
  return length;
}

/** Label text + anchor for one measurement object, or null. */
export function buildMeasureLabel(obj, scale) {
  const kind = getMeasureKind(obj);
  if (!kind) return null;
  if (kind === 'length') {
    const { a, b, mid } = measureLinePath(obj);
    const lengthPt = mid ? quadraticArcLength(a, mid, b) : Math.hypot(b.x - a.x, b.y - a.y);
    // A quadratic's tangent at t = 0.5 is parallel to its chord, so the label
    // sits on the curve's middle and reads along the chord either way.
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return {
      kind,
      text: formatMeasureLength(lengthPt, scale),
      x: mid ? mid.x : (a.x + b.x) / 2,
      y: mid ? mid.y : (a.y + b.y) / 2,
      angle,
      value: lengthPt,
    };
  }
  const world = measurePolygonWorldPoints(obj);
  if (world.length < 3) return null;
  const areaPt2 = polygonAreaPt(world);
  const c = polygonCentroid(world);
  return { kind, text: formatMeasureArea(areaPt2, scale), x: c.x, y: c.y, angle: 0, value: areaPt2 };
}

/** The page's scale as saved on its measurements (last one wins). */
export function pageScaleFromObjects(objects) {
  if (!Array.isArray(objects)) return null;
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const scale = objects[i]?.data?.measure?.scale;
    if (getMeasureKind(objects[i]) && isValidMeasureScale(scale)) return scale;
  }
  return null;
}

/** Stamp measure metadata on a freshly built line / polygon commit JSON. */
export function stampMeasure(json, kind, scale) {
  if (!json || !MEASURE_KINDS.includes(kind)) return json;
  const measure = { kind };
  if (isValidMeasureScale(scale)) measure.scale = { ...scale };
  return { ...json, data: { ...(json.data || {}), measure } };
}

/** New page JSON with every measurement re-stamped to `scale` (+ extra objects appended). */
export function applyPageScale(pageJson, scale, extraObjects = []) {
  const objects = Array.isArray(pageJson?.objects) ? pageJson.objects : [];
  const next = objects.map((obj) => (getMeasureKind(obj)
    ? { ...obj, data: { ...obj.data, measure: { ...obj.data.measure, scale: { ...scale } } } }
    : obj));
  return { ...(pageJson || {}), objects: [...next, ...extraObjects] };
}

/**
 * Screen-constant layout for a measure label pill (Drawboard parity).
 * `unitsPerPx` is the layer's inverseScale (page units per screen px), so the
 * label reads at a fixed ~12 px at any zoom with no zoom coordination: it is
 * just multiplied into page units. A length label sits at the line's midpoint,
 * pushed perpendicular to the line toward screen-up, clear of the line and of
 * its endpoint handles; an area label sits on the centroid.
 */
export const MEASURE_LABEL_FONT_PX = 12;
export const MEASURE_LABEL_PAD_X_PX = 6;
export const MEASURE_LABEL_PAD_Y_PX = 3;
export const MEASURE_LABEL_GAP_PX = 8;
const MEASURE_LABEL_CHAR_EM = 0.6;

export function layoutMeasureLabel(label, unitsPerPx = 1) {
  if (!label) return null;
  const u = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1;
  const fontSize = MEASURE_LABEL_FONT_PX * u;
  const width = (String(label.text).length * MEASURE_LABEL_CHAR_EM * MEASURE_LABEL_FONT_PX
    + 2 * MEASURE_LABEL_PAD_X_PX) * u;
  const height = (MEASURE_LABEL_FONT_PX + 2 * MEASURE_LABEL_PAD_Y_PX) * u;
  let cx = label.x;
  let cy = label.y;
  if (label.kind === 'length') {
    // angle is normalized to [-90, 90], so this normal always points screen-up
    // (or left for a vertical line, matching the rotated text's "up").
    const rad = ((label.angle || 0) * Math.PI) / 180;
    const offset = height / 2 + MEASURE_LABEL_GAP_PX * u;
    cx += Math.sin(rad) * offset;
    cy -= Math.cos(rad) * offset;
  }
  return { cx, cy, fontSize, width, height, radius: height / 2, angle: label.angle || 0 };
}
