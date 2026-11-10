/**
 * Measure tools (Length / Area / Perimeter, and on Nightly Polylength,
 * Wall area and Volume) + page scale.
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
 * the page scale is read back from them after a reload. A scale set on a page
 * with no measurements yet, or on all pages at once (Drawboard Projects'
 * "apply to all pages", 2026-10-27), is kept in the document's synced meta
 * under MEASURE_SCALES_META_KEY: { all: scale | null, pages: { [n]: scale } }.
 */

import { computeLineBboxCenter } from '../svgBoundingBox.js';

export const MEASURE_UNITS = Object.freeze({
  in: { inches: 1, label: 'in', area: 'sq in', volume: 'cu in' },
  ft: { inches: 12, label: 'ft', area: 'sq ft', volume: 'cu ft' },
  yd: { inches: 36, label: 'yd', area: 'sq yd', volume: 'cu yd' },
  mm: { inches: 1 / 25.4, label: 'mm', area: 'mm²', volume: 'mm³' },
  cm: { inches: 1 / 2.54, label: 'cm', area: 'cm²', volume: 'cm³' },
  m: { inches: 1 / 0.0254, label: 'm', area: 'm²', volume: 'm³' },
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

// Drawboard Projects trial audit (2026-11-09, Nightly flag 'measure-depth'):
// Polylength (an open run of segments), and Wall area / Volume, which take a
// depth: wall area = perimeter x depth, volume = area x depth.
export const MEASURE_KINDS = Object.freeze(['length', 'area', 'perimeter', 'polylength', 'wallArea', 'volume']);

// Measure kinds drawn with the Polygon tool; Polylength rides the Polyline
// tool; the rest ride the Line tool.
export const POLYGON_MEASURE_KINDS = Object.freeze(['area', 'perimeter', 'wallArea', 'volume']);
export const POLYLINE_MEASURE_KINDS = Object.freeze(['polylength']);

// Kinds that need a depth (in the page scale's unit) before they draw.
export const DEPTH_MEASURE_KINDS = Object.freeze(['wallArea', 'volume']);

export function measureBaseTool(kind) {
  if (POLYGON_MEASURE_KINDS.includes(kind)) return 'polygon';
  if (POLYLINE_MEASURE_KINDS.includes(kind)) return 'polyline';
  return 'line';
}

/** Whether a measure kind commits on this base tool ('polygon' / 'polyline'). */
export function isPolyMeasureFor(tool, kind) {
  return (tool === 'polygon' || tool === 'polyline') && MEASURE_KINDS.includes(kind) && measureBaseTool(kind) === tool;
}

/** A usable depth: a finite number above zero, else null. */
export function normalizeMeasureDepth(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const MEASURE_DEPTH_STORAGE_KEY = 'survey:measure-depth';

export function loadMeasureDepth(storage = globalThis.localStorage) {
  try {
    return normalizeMeasureDepth(storage?.getItem(MEASURE_DEPTH_STORAGE_KEY)) || 1;
  } catch {
    return 1;
  }
}

export function rememberMeasureDepth(depth, storage = globalThis.localStorage) {
  const d = normalizeMeasureDepth(depth);
  if (!d) return;
  try {
    storage?.setItem(MEASURE_DEPTH_STORAGE_KEY, String(d));
  } catch {
    // Private browsing can refuse storage; the depth still applies this session.
  }
}

export const MEASURE_SCALES_META_KEY = 'measureScales';

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

/**
 * Wall area: an outline of `perimeterPt` page points times `depth` real units
 * (the page scale's unit). Without a scale the outline is read in paper inches
 * and the depth in inches, and the text says so.
 */
export function formatMeasureWallArea(perimeterPt, depth, scale) {
  const d = normalizeMeasureDepth(depth) || 0;
  if (!isValidMeasureScale(scale)) return `${formatNumber((perimeterPt / PT_PER_INCH) * d)} sq in (no scale)`;
  const real = (perimeterPt / scale.ptPerUnit) * d;
  return `${real.toFixed(2)} ${MEASURE_UNITS[scale.unit].area}`;
}

/** Volume: an area of `areaPt2` square page points times `depth` real units. */
export function formatMeasureVolume(areaPt2, depth, scale) {
  const d = normalizeMeasureDepth(depth) || 0;
  if (!isValidMeasureScale(scale)) return `${formatNumber((areaPt2 / (PT_PER_INCH * PT_PER_INCH)) * d)} cu in (no scale)`;
  const real = (areaPt2 / (scale.ptPerUnit * scale.ptPerUnit)) * d;
  return `${real.toFixed(2)} ${MEASURE_UNITS[scale.unit].volume}`;
}

/** Length of an open run of points (no closing edge). */
export function polylineLengthPt(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return sum;
}

/** The point halfway along an open run, where its label sits. */
export function polylineMidpoint(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const half = polylineLengthPt(points) / 2;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg > 0 && walked + seg >= half) {
      const t = (half - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += seg;
  }
  return { ...points[0] };
}

/** Length of a closed polygon's outline, closing edge included. */
export function polygonPerimeterPt(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

function shoelaceAreaPt(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Where segment ab properly crosses segment cd (not at an end), or null.
function segmentCrossing(a, b, c, d) {
  const rx = b.x - a.x; const ry = b.y - a.y;
  const sx = d.x - c.x; const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

// A shape whose outline crosses itself (a bow tie) cancels to 0 under the
// plain shoelace sum (deep test 2026-11-10: it read 0.00 mm²). Split it at
// each crossing into simple loops and add their areas.
function splitLoopAreaPt(points, depth) {
  const n = points.length;
  if (n < 3) return 0;
  if (depth < 64) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
        const x = segmentCrossing(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]);
        if (!x) continue;
        const first = [...points.slice(0, i + 1), x, ...points.slice(j + 1)];
        const second = [x, ...points.slice(i + 1, j + 1)];
        return splitLoopAreaPt(first, depth + 1) + splitLoopAreaPt(second, depth + 1);
      }
    }
  }
  return shoelaceAreaPt(points);
}

export function polygonAreaPt(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  return points.length > 200 ? shoelaceAreaPt(points) : splitLoopAreaPt(points, 0);
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
  if (kind === 'polylength') {
    if (world.length < 2) return null;
    const lengthPt = polylineLengthPt(world);
    const at = polylineMidpoint(world);
    return { kind, text: formatMeasureLength(lengthPt, scale), x: at.x, y: at.y, angle: 0, value: lengthPt };
  }
  if (world.length < 3) return null;
  const c = polygonCentroid(world);
  const depth = normalizeMeasureDepth(obj?.data?.measure?.depth);
  if (kind === 'wallArea') {
    const perimeterPt = polygonPerimeterPt(world);
    return { kind, text: formatMeasureWallArea(perimeterPt, depth, scale), x: c.x, y: c.y, angle: 0, value: perimeterPt * (depth || 0) };
  }
  if (kind === 'volume') {
    const areaPt2 = polygonAreaPt(world);
    return { kind, text: formatMeasureVolume(areaPt2, depth, scale), x: c.x, y: c.y, angle: 0, value: areaPt2 * (depth || 0) };
  }
  if (kind === 'perimeter') {
    const perimeterPt = polygonPerimeterPt(world);
    return { kind, text: formatMeasureLength(perimeterPt, scale), x: c.x, y: c.y, angle: 0, value: perimeterPt };
  }
  const areaPt2 = polygonAreaPt(world);
  return { kind, text: formatMeasureArea(areaPt2, scale), x: c.x, y: c.y, angle: 0, value: areaPt2 };
}

/** The document's saved scales, cleaned: { all, pages }. */
export function normalizeMeasureScaleMeta(value) {
  const all = isValidMeasureScale(value?.all) ? { ...value.all } : null;
  const pages = {};
  if (value?.pages && typeof value.pages === 'object') {
    for (const [page, scale] of Object.entries(value.pages)) {
      if (Number(page) > 0 && isValidMeasureScale(scale)) pages[String(Number(page))] = { ...scale };
    }
  }
  return { all, pages };
}

/** The saved scale a page reads when its measurements carry none. */
export function metaScaleForPage(meta, pageNumber) {
  return meta?.pages?.[String(pageNumber)] || meta?.all || null;
}

/** The meta after a scale is set on one page, or on every page. */
export function nextMeasureScaleMeta(meta, pageNumber, scale, { allPages = false } = {}) {
  const current = normalizeMeasureScaleMeta(meta);
  if (!isValidMeasureScale(scale)) return current;
  if (allPages) return { all: { ...scale }, pages: {} };
  return { all: current.all, pages: { ...current.pages, [String(pageNumber)]: { ...scale } } };
}

// Recent scales: this screen's last few picks, newest first (Drawboard keeps
// five). A per-viewer convenience, so browser storage, and every read and
// write survives storage being blocked.
const RECENT_SCALES_KEY = 'survey:measure-recent-scales';
export const RECENT_SCALES_MAX = 5;

function sameScale(a, b) {
  return a.unit === b.unit && Math.abs(Number(a.ptPerUnit) - Number(b.ptPerUnit)) < 1e-9;
}

export function addRecentMeasureScale(list, scale) {
  if (!isValidMeasureScale(scale)) return Array.isArray(list) ? list : [];
  const rest = (Array.isArray(list) ? list : []).filter((s) => isValidMeasureScale(s) && !sameScale(s, scale));
  return [{ ptPerUnit: Number(scale.ptPerUnit), unit: scale.unit, label: scale.label }, ...rest].slice(0, RECENT_SCALES_MAX);
}

export function loadRecentMeasureScales(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage?.getItem(RECENT_SCALES_KEY) || '[]');
    return Array.isArray(list) ? list.filter(isValidMeasureScale).slice(0, RECENT_SCALES_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRecentMeasureScale(scale, storage = globalThis.localStorage) {
  const next = addRecentMeasureScale(loadRecentMeasureScales(storage), scale);
  try { storage?.setItem(RECENT_SCALES_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  return next;
}

/**
 * A scale bar for the page: a round real length (1, 2 or 5 times a power of
 * ten, in the scale's unit) whose drawn length lands near `targetPx` screen
 * pixels at the current zoom. `unitsPerPx` is page points per screen pixel.
 */
export function measureScaleBar(scale, unitsPerPx = 1, targetPx = 120) {
  if (!isValidMeasureScale(scale)) return null;
  const u = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1;
  const targetReal = (targetPx * u) / scale.ptPerUnit;
  const power = 10 ** Math.floor(Math.log10(targetReal));
  let step = power;
  for (const m of [1, 2, 5, 10]) {
    if (m * power <= targetReal) step = m * power;
  }
  const real = Number(step.toPrecision(6));
  const lengthPt = real * scale.ptPerUnit;
  const text = scale.unit === 'ft' && real >= 1
    ? `${real}'`
    : `${real} ${MEASURE_UNITS[scale.unit].label}`;
  return { real, lengthPt, text };
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

/**
 * Stamp measure metadata on a freshly built line / polygon / polyline commit
 * JSON. Wall area and Volume also keep their depth (page scale units).
 */
export function stampMeasure(json, kind, scale, { depth = null } = {}) {
  if (!json || !MEASURE_KINDS.includes(kind)) return json;
  const measure = { kind };
  if (isValidMeasureScale(scale)) measure.scale = { ...scale };
  const d = normalizeMeasureDepth(depth);
  if (d && DEPTH_MEASURE_KINDS.includes(kind)) measure.depth = d;
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
