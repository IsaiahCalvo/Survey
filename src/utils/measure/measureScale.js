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
import {
  DIMENSION_CAPTION_BG_OPACITIES,
  DIMENSION_CAPTION_PT,
  DIMENSION_LEADER_PT,
  normalizeDimensionCaptionColor,
  normalizeDimensionCaptionPt,
  normalizeDimensionLeader,
} from './dimensionLine.js';
import {
  MEASURE_LINE_PREFIXES,
  formatDisplayArea,
  formatDisplayDepth,
  formatDisplayLength,
  formatDisplayVolume,
  scaleUsesDisplay,
} from './measureFormat.js';

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
export const MEASURE_DEPTH_MAX = 10000;
export function normalizeMeasureDepth(value) {
  const n = Number(value);
  // A depth past 10,000 drawing units is a typo (1e300 made the label
  // unreadable), so it is refused like zero.
  return Number.isFinite(n) && n > 0 && n <= MEASURE_DEPTH_MAX ? n : null;
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
  // Nightly 'measure-plus': the scale names its own format (measureFormat.js).
  if (scaleUsesDisplay(scale)) return formatDisplayLength(real * MEASURE_UNITS[scale.unit].inches, scale.display, scale.precision);
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
  if (scaleUsesDisplay(scale)) return formatDisplayArea(real * MEASURE_UNITS[scale.unit].inches ** 2, scale.display, scale.precision);
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
  if (scaleUsesDisplay(scale)) return formatDisplayArea(real * MEASURE_UNITS[scale.unit].inches ** 2, scale.display, scale.precision);
  return `${real.toFixed(2)} ${MEASURE_UNITS[scale.unit].area}`;
}

/** Volume: an area of `areaPt2` square page points times `depth` real units. */
export function formatMeasureVolume(areaPt2, depth, scale) {
  const d = normalizeMeasureDepth(depth) || 0;
  if (!isValidMeasureScale(scale)) return `${formatNumber((areaPt2 / (PT_PER_INCH * PT_PER_INCH)) * d)} cu in (no scale)`;
  const real = (areaPt2 / (scale.ptPerUnit * scale.ptPerUnit)) * d;
  if (scaleUsesDisplay(scale)) return formatDisplayVolume(real * MEASURE_UNITS[scale.unit].inches ** 3, scale.display, scale.precision);
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

/**
 * Caption (Nightly flag 'measure-edit', Drawboard PDF Pro's Measurement
 * popover): a measurement can carry, in data.measure,
 *   label        free text, shown as the caption's first line
 *   fields       which lines show: 'label' and the readings that make sense
 *                for its kind (MEASURE_CAPTION_FIELDS); unset = the label
 *                when there is one, then the kind's own reading
 *   captionSize  the caption's text size in screen px (8-24; unset = 12)
 * A mark with none of these reads exactly as before.
 */
export const MEASURE_CAPTION_FIELDS = Object.freeze({
  length: Object.freeze(['length']),
  polylength: Object.freeze(['length']),
  perimeter: Object.freeze(['perimeter', 'area']),
  area: Object.freeze(['area', 'perimeter']),
  wallArea: Object.freeze(['wallArea', 'perimeter', 'depth']),
  volume: Object.freeze(['volume', 'area', 'perimeter', 'depth']),
});

export const MEASURE_FIELD_NAMES = Object.freeze({
  label: 'Label',
  length: 'Length',
  perimeter: 'Perimeter',
  area: 'Area',
  depth: 'Depth',
  wallArea: 'Wall area',
  volume: 'Volume',
});

export const MEASURE_CAPTION_SIZE_MIN = 8;
export const MEASURE_CAPTION_SIZE_MAX = 24;
export const MEASURE_CAPTION_SIZES = Object.freeze([
  Object.freeze({ id: 'small', label: 'S', name: 'Small', px: 10 }),
  Object.freeze({ id: 'medium', label: 'M', name: 'Medium', px: 12 }),
  Object.freeze({ id: 'large', label: 'L', name: 'Large', px: 16 }),
]);
export const MEASURE_LABEL_MAX_CHARS = 80;

/** The caption lines a kind can show, label first. */
export function measureCaptionFields(kind) {
  return MEASURE_CAPTION_FIELDS[kind] ? ['label', ...MEASURE_CAPTION_FIELDS[kind]] : [];
}

/** A usable caption size (8-24 px), else null. */
export function normalizeMeasureCaptionSize(value) {
  if (value == null || value === '') return null;
  const named = MEASURE_CAPTION_SIZES.find((size) => size.id === value);
  if (named) return named.px;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(MEASURE_CAPTION_SIZE_MAX, Math.max(MEASURE_CAPTION_SIZE_MIN, n));
}

/** A label as stored: one trimmed line, at most 80 characters ('' = none). */
export function normalizeMeasureLabelText(value) {
  if (typeof value !== 'string') return '';
  // Cut on whole characters, so an emoji at the cap is never split (R5 N5c).
  return splitGraphemes(value.replace(/\s+/g, ' ').trim()).slice(0, MEASURE_LABEL_MAX_CHARS).join('');
}

/** The caption lines picked for a kind, in the kind's order; null = unset. */
export function normalizeMeasureFields(kind, value) {
  if (!Array.isArray(value)) return null;
  return measureCaptionFields(kind).filter((field) => value.includes(field));
}

/** The lines that show for a mark (the unset default resolved). */
export function measureShownFields(obj) {
  const kind = getMeasureKind(obj);
  if (!kind) return [];
  const measure = obj.data.measure;
  const picked = normalizeMeasureFields(kind, measure.fields);
  if (picked) return picked;
  const primary = MEASURE_CAPTION_FIELDS[kind][0];
  return normalizeMeasureLabelText(measure.label) ? ['label', primary] : [primary];
}

function hasCaptionSettings(measure) {
  return Boolean(measure && (
    normalizeMeasureLabelText(measure.label)
    || Array.isArray(measure.fields)
    || normalizeMeasureCaptionSize(measure.captionSize) != null
  ));
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Segment captions (Nightly 'measure-plus', Drawboard's "Show segment
 * captions"): each side of a Polylength or Perimeter shows its own length.
 * Off, Inline (along the side, on it), Upright (level, on it) or Above
 * (along the side, beside it). On (Inline) by default for a Polylength, off
 * for a Perimeter. Stored as data.measure.segments only when not the default.
 */
export const SEGMENT_CAPTION_PLACES = Object.freeze(['off', 'inline', 'upright', 'above']);
export const SEGMENT_CAPTION_KINDS = Object.freeze(['polylength', 'perimeter']);

export function defaultSegmentCaptionPlace(kind) {
  return kind === 'polylength' ? 'inline' : 'off';
}

/** How a mark's segment captions show ('off' for kinds that have none). */
export function segmentCaptionPlace(obj) {
  const kind = getMeasureKind(obj);
  if (!SEGMENT_CAPTION_KINDS.includes(kind)) return 'off';
  const saved = obj?.data?.measure?.segments;
  return SEGMENT_CAPTION_PLACES.includes(saved) ? saved : defaultSegmentCaptionPlace(kind);
}

/**
 * The mark after a Measurement popover change ({ label?, fields?, depth?,
 * captionSize? }), or the very same object when nothing changes. Typing a
 * label on a mark whose lines were picked by hand ticks Label too, so it shows.
 */
export function applyMeasureEdit(obj, changes = {}) {
  const kind = getMeasureKind(obj);
  if (!kind || !changes || typeof changes !== 'object') return obj;
  const before = obj.data.measure;
  const measure = { ...before };
  if (hasOwn(changes, 'label')) {
    const label = normalizeMeasureLabelText(changes.label);
    if (label) measure.label = label; else delete measure.label;
    const fields = normalizeMeasureFields(kind, measure.fields);
    if (label && !normalizeMeasureLabelText(before.label) && fields && !fields.includes('label')) {
      measure.fields = normalizeMeasureFields(kind, ['label', ...fields]);
    }
  }
  if (hasOwn(changes, 'fields')) {
    const fields = normalizeMeasureFields(kind, changes.fields);
    if (fields) measure.fields = fields; else delete measure.fields;
  }
  if (hasOwn(changes, 'captionSize')) {
    const size = normalizeMeasureCaptionSize(changes.captionSize);
    if (size != null && size !== MEASURE_LABEL_FONT_PX) measure.captionSize = size; else delete measure.captionSize;
  }
  if (hasOwn(changes, 'depth') && DEPTH_MEASURE_KINDS.includes(kind)) {
    const depth = normalizeMeasureDepth(changes.depth);
    if (depth) measure.depth = depth;
  }
  if (hasOwn(changes, 'ownScale')) {
    // Per-mark scale (measure-plus): a valid scale is the mark's own; null
    // puts it back on the page scale (changes.pageScale, when there is one).
    if (isValidMeasureScale(changes.ownScale)) {
      measure.scale = { ...changes.ownScale };
      measure.ownScale = true;
    } else if (changes.ownScale == null && measure.ownScale) {
      delete measure.ownScale;
      if (isValidMeasureScale(changes.pageScale)) measure.scale = { ...changes.pageScale };
      else delete measure.scale;
    }
  }
  if (hasOwn(changes, 'segmentCaptions') && SEGMENT_CAPTION_KINDS.includes(kind)
    && SEGMENT_CAPTION_PLACES.includes(changes.segmentCaptions)) {
    if (changes.segmentCaptions === defaultSegmentCaptionPlace(kind)) delete measure.segments;
    else measure.segments = changes.segmentCaptions;
  }
  if (kind === 'length' && measure.dim && typeof measure.dim === 'object') {
    // Dimension-line marks only (measure-plus): the leader and caption place.
    if (hasOwn(changes, 'leader')) {
      const leader = normalizeDimensionLeader(changes.leader);
      if (leader != null) measure.dim = { ...measure.dim, leader };
    }
    if (hasOwn(changes, 'captionPlace')) {
      const dim = { ...measure.dim };
      if (changes.captionPlace === 'above') dim.caption = 'above'; else delete dim.caption;
      measure.dim = dim;
    }
    // Caption style (Drawboard's Caption pop-over).
    if (hasOwn(changes, 'captionPt')) {
      const size = normalizeDimensionCaptionPt(changes.captionPt);
      if (size != null) {
        const dim = { ...measure.dim };
        if (size === DIMENSION_CAPTION_PT) delete dim.size; else dim.size = size;
        measure.dim = dim;
        delete measure.captionSize;
      }
    }
    if (hasOwn(changes, 'captionColor')) {
      const dim = { ...measure.dim };
      const color = normalizeDimensionCaptionColor(changes.captionColor);
      if (color) dim.color = color; else delete dim.color;
      measure.dim = dim;
    }
    if (hasOwn(changes, 'captionBg')) {
      const dim = { ...measure.dim };
      const bg = normalizeDimensionCaptionColor(changes.captionBg);
      if (bg) {
        dim.bg = bg;
        // A background picked while none showed comes in at full strength.
        if (!DIMENSION_CAPTION_BG_OPACITIES.includes(Number(dim.bgOpacity))) dim.bgOpacity = 1;
      } else {
        delete dim.bg;
        delete dim.bgOpacity;
      }
      measure.dim = dim;
    }
    if (hasOwn(changes, 'captionBgOpacity') && DIMENSION_CAPTION_BG_OPACITIES.includes(Number(changes.captionBgOpacity))) {
      measure.dim = { ...measure.dim, bgOpacity: Number(changes.captionBgOpacity) };
    }
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(measure)]);
  if ([...keys].every((key) => JSON.stringify(before[key]) === JSON.stringify(measure[key]))) return obj;
  return { ...obj, data: { ...obj.data, measure } };
}

function formatMeasureDepth(depth, scale) {
  const d = normalizeMeasureDepth(depth) || 0;
  if (!isValidMeasureScale(scale)) return `${formatNumber(d)} in (no scale)`;
  if (scaleUsesDisplay(scale)) return formatDisplayDepth(d * MEASURE_UNITS[scale.unit].inches, scale.display, scale.precision);
  return formatMeasureLength(d * scale.ptPerUnit, scale);
}

/**
 * Label text + anchor for one measurement object, or null. With a caption
 * set (see above) it also carries `lines` (what the pill shows, `text` is
 * them joined by newlines), `reading` (the plain reading, for lists and
 * exports when every line is switched off) and `fontPx` when sized.
 */
export function buildMeasureLabel(obj, pageScale) {
  const scale = markMeasureScale(obj, pageScale);
  const base = buildMeasureReading(obj, scale);
  if (!base || !hasCaptionSettings(obj.data.measure)) return base;
  const { kind } = base;
  const measure = obj.data.measure;
  const shown = measureShownFields(obj);
  const label = normalizeMeasureLabelText(measure.label);
  const readings = shown.filter((field) => field !== 'label');
  const valueOf = (field) => {
    if (field === 'depth') return formatMeasureDepth(measure.depth, scale);
    if (field === MEASURE_CAPTION_FIELDS[kind][0]) return base.text;
    const world = measurePolygonWorldPoints(obj);
    if (field === 'perimeter') return formatMeasureLength(polygonPerimeterPt(world), scale);
    if (field === 'area') return formatMeasureArea(polygonAreaPt(world), scale);
    return base.text;
  };
  const lines = [];
  if (label && shown.includes('label')) lines.push(...wrapMeasureLabelLine(label));
  for (const field of readings) {
    const value = valueOf(field);
    // One reading reads bare, as today; several say which is which.
    if (readings.length < 2) lines.push(value);
    // Nightly 'measure-plus': Drawboard's short prefixes (L = , A = ...).
    else if (scaleUsesDisplay(scale)) lines.push(`${MEASURE_LINE_PREFIXES[field]} = ${value}`);
    else lines.push(`${MEASURE_FIELD_NAMES[field]}: ${value}`);
  }
  const out = { ...base, text: lines.join('\n'), lines, reading: base.text };
  const size = normalizeMeasureCaptionSize(measure.captionSize);
  if (size != null) out.fontPx = size;
  return out;
}

export const MEASURE_LABEL_WRAP_CHARS = 32;
const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
/** Splits text into what a reader sees as single characters. */
export function splitGraphemes(text) {
  const str = String(text);
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(str), (part) => part.segment);
  return Array.from(str);
}
/** A long label breaks at spaces (or mid-word when one word is too long). */
export function wrapMeasureLabelLine(text, max = MEASURE_LABEL_WRAP_CHARS) {
  const out = [];
  let line = '';
  // Lengths count what a reader sees as one character (a grapheme), so an
  // emoji is never cut in half: not a flag, a skin tone, a family or a keycap.
  const len = (s) => splitGraphemes(s).length;
  for (let word of String(text).split(' ')) {
    while (len(word) > max) {
      if (line) { out.push(line); line = ''; }
      const chars = splitGraphemes(word);
      out.push(chars.slice(0, max).join(''));
      word = chars.slice(max).join('');
    }
    if (!word) continue;
    if (line && len(line) + 1 + len(word) > max) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.length ? out : [String(text)];
}

function buildMeasureReading(obj, pageScale) {
  const scale = markMeasureScale(obj, pageScale);
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
    // A mark on its own scale (measure-plus) says nothing about the page's.
    if (getMeasureKind(objects[i]) && isValidMeasureScale(scale) && !isOwnScaleMeasure(objects[i])) return scale;
  }
  return null;
}

/**
 * Per-mark scale (Nightly 'measure-plus', Drawboard's per-measure scale): a
 * measure with data.measure.ownScale reads in its own data.measure.scale and
 * keeps it when the page scale changes, until "Apply to existing
 * measurements" puts it back on the page scale.
 */
export function isOwnScaleMeasure(obj) {
  const measure = obj?.data?.measure;
  return Boolean(measure?.ownScale && isValidMeasureScale(measure.scale) && getMeasureKind(obj));
}

/** The scale a measure reads in: its own, else the page's. */
export function markMeasureScale(obj, pageScale) {
  return isOwnScaleMeasure(obj) ? obj.data.measure.scale : pageScale;
}

/**
 * Stamp measure metadata on a freshly built line / polygon / polyline commit
 * JSON. Wall area and Volume also keep their depth (page scale units).
 */
export function stampMeasure(json, kind, scale, { depth = null, dim = false } = {}) {
  if (!json || !MEASURE_KINDS.includes(kind)) return json;
  const measure = { kind };
  // Nightly 'measure-plus': a new Length draws as a dimension line.
  if (dim && kind === 'length') measure.dim = { leader: DIMENSION_LEADER_PT };
  if (isValidMeasureScale(scale)) measure.scale = { ...scale };
  const d = normalizeMeasureDepth(depth);
  if (d && DEPTH_MEASURE_KINDS.includes(kind)) measure.depth = d;
  return { ...json, data: { ...(json.data || {}), measure } };
}

/** New page JSON with every measurement re-stamped to `scale` (+ extra objects appended). */
export function applyPageScale(pageJson, scale, extraObjects = [], { resetOwn = false } = {}) {
  const objects = Array.isArray(pageJson?.objects) ? pageJson.objects : [];
  const restamp = (obj) => {
    if (!getMeasureKind(obj)) return obj;
    // A mark on its own scale keeps it unless the page scale is applied to
    // existing measurements too (measure-plus).
    if (isOwnScaleMeasure(obj) && !resetOwn) return obj;
    const measure = { ...obj.data.measure, scale: { ...scale } };
    delete measure.ownScale;
    return { ...obj, data: { ...obj.data, measure } };
  };
  // The kept calibration line is stamped too, or lists and exports that read
  // the mark's own scale would show it unscaled (R3-M B2).
  return { ...(pageJson || {}), objects: [...objects.map(restamp), ...(extraObjects || []).map(restamp)] };
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
const MEASURE_LABEL_LINE_EM = 1.25;

export function layoutMeasureLabel(label, unitsPerPx = 1, page = null) {
  if (!label) return null;
  const u = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1;
  // A caption (buildMeasureLabel `lines` / `fontPx`) can be several lines
  // at its own size; a plain reading is one line at 12 px, as always.
  const lines = Array.isArray(label.lines) ? label.lines : [String(label.text)];
  if (lines.length === 0) return null;
  const fontPx = normalizeMeasureCaptionSize(label.fontPx) || MEASURE_LABEL_FONT_PX;
  const lineHeightPx = fontPx * MEASURE_LABEL_LINE_EM;
  const longest = Math.max(...lines.map((line) => String(line).length));
  const fontSize = fontPx * u;
  const width = (longest * MEASURE_LABEL_CHAR_EM * fontPx + 2 * MEASURE_LABEL_PAD_X_PX) * u;
  const height = (fontPx + (lines.length - 1) * lineHeightPx + 2 * MEASURE_LABEL_PAD_Y_PX) * u;
  let cx = label.x;
  let cy = label.y;
  if (label.kind === 'length') {
    // angle is normalized to [-90, 90], so this normal always points screen-up
    // (or left for a vertical line, matching the rotated text's "up").
    const rad = ((label.angle || 0) * Math.PI) / 180;
    const offset = height / 2 + MEASURE_LABEL_GAP_PX * u;
    cx += Math.sin(rad) * offset;
    cy -= Math.cos(rad) * offset;
  } else if (Number.isFinite(label.above?.angle)) {
    // A level pill lifted off a turned segment (a Polylength's total sits
    // above its last segment, 'measure-plus'): clear of the segment and of
    // `extra` page units more (that segment's own caption).
    const rad = (label.above.angle * Math.PI) / 180;
    const halfAcross = (Math.abs(height * Math.cos(rad)) + Math.abs(width * Math.sin(rad))) / 2;
    const offset = halfAcross + MEASURE_LABEL_GAP_PX * u + (Number(label.above.extra) || 0);
    cx += Math.sin(rad) * offset;
    cy -= Math.cos(rad) * offset;
  }
  // Kept inside the page (a long caption near an edge ran off it). A caption
  // wider (or taller) than the page sits in its middle, so it overhangs both
  // edges by the least it can instead of running off one side.
  if (page && page.width > 0 && page.height > 0) {
    const rad = ((label.angle || 0) * Math.PI) / 180;
    const halfW = (Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad))) / 2;
    const halfH = (Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad))) / 2;
    cx = page.width >= 2 * halfW ? Math.min(Math.max(cx, halfW), page.width - halfW) : page.width / 2;
    cy = page.height >= 2 * halfH ? Math.min(Math.max(cy, halfH), page.height - halfH) : page.height / 2;
  }
  // One line keeps the round pill; several get a card with the same corners.
  const radius = Math.min(height / 2, (fontPx / 2 + MEASURE_LABEL_PAD_Y_PX) * u);
  return { cx, cy, fontSize, width, height, radius, angle: label.angle || 0, lines, lineHeight: lineHeightPx * u };
}
