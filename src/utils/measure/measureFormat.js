/**
 * measureFormat.js — Drawboard's number formats for measures (Nightly,
 * flag 'measure-plus'; live check deep/measure-extras.md §1, §3, §7).
 *
 * A page scale may carry `display` and `precision` (the Set page scale
 * dialog writes them while the flag is on). When it does, every reading uses
 * these formats; a scale without them reads exactly as before.
 *   display   'ftin' fractional feet-inches (84′-8 1/4″), 'infrac' fractional
 *             inches (8 1/4″), or a decimal unit: in, ft, yd, mi, mm, cm, m, km
 *   precision fractional: the inch step's denominator (1, 2, 4, 8, 16);
 *             decimal: places (0 to 4). Areas and volumes take the same
 *             places (a fractional length's area reads in decimals at 0.01).
 * Prime marks (′ ″), whole feet with no "-0″" (but 27′-0 1/2″ under an
 * inch), thousands with commas.
 */

const INCHES = Object.freeze({
  in: 1, ft: 12, yd: 36, mi: 63360, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254, km: 1000 / 0.0254,
});

export const MEASURE_DISPLAYS = Object.freeze([
  Object.freeze({ id: 'infrac', label: 'Fractional inches (in″)', fractional: true }),
  Object.freeze({ id: 'ftin', label: 'Fractional feet and inches (ft′in″)', fractional: true }),
  Object.freeze({ id: 'in', label: 'Decimal inches' }),
  Object.freeze({ id: 'ft', label: 'Decimal feet' }),
  Object.freeze({ id: 'yd', label: 'Decimal yards' }),
  Object.freeze({ id: 'mi', label: 'Decimal miles' }),
  Object.freeze({ id: 'mm', label: 'mm' }),
  Object.freeze({ id: 'cm', label: 'cm' }),
  Object.freeze({ id: 'm', label: 'm' }),
  Object.freeze({ id: 'km', label: 'km' }),
]);

export const FRACTION_PRECISIONS = Object.freeze([
  Object.freeze({ value: 1, label: '1' }),
  Object.freeze({ value: 2, label: '1/2' }),
  Object.freeze({ value: 4, label: '1/4' }),
  Object.freeze({ value: 8, label: '1/8' }),
  Object.freeze({ value: 16, label: '1/16' }),
]);
export const DECIMAL_PRECISIONS = Object.freeze([
  Object.freeze({ value: 0, label: '1' }),
  Object.freeze({ value: 1, label: '0.1' }),
  Object.freeze({ value: 2, label: '0.01' }),
  Object.freeze({ value: 3, label: '0.001' }),
  Object.freeze({ value: 4, label: '0.0001' }),
]);

const displayOf = (id) => MEASURE_DISPLAYS.find((d) => d.id === id) || null;
export const isMeasureDisplay = (id) => Boolean(displayOf(id));
export const isFractionalDisplay = (id) => Boolean(displayOf(id)?.fractional);

/** The precision a display starts at: 1/4 for fractions, 0.01 for decimals. */
export function defaultMeasurePrecision(display) {
  return isFractionalDisplay(display) ? 4 : 2;
}

export function normalizeMeasurePrecision(display, precision) {
  const list = isFractionalDisplay(display) ? FRACTION_PRECISIONS : DECIMAL_PRECISIONS;
  if (precision == null || precision === '') return defaultMeasurePrecision(display);
  const n = Number(precision);
  return list.some((p) => p.value === n) ? n : defaultMeasurePrecision(display);
}

/** 1391.523 at 2 places -> "1,391.52". */
export function groupedNumber(value, places) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const p = Math.max(0, Math.min(4, Math.round(Number(places) || 0)));
  return n.toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

// Inches as "8 1/4", "8", "1/2" at a denominator step.
function fractionalInches(inches, denominator) {
  const steps = Math.round(inches * denominator);
  const whole = Math.floor(steps / denominator);
  const rest = steps - whole * denominator;
  if (!rest) return { whole, text: String(whole) };
  const g = gcd(rest, denominator);
  const frac = `${rest / g}/${denominator / g}`;
  return { whole, text: whole ? `${whole} ${frac}` : frac };
}

/** A real length (in inches) in a display: `84′-8 1/4″`, `40′`, `8 1/4″`, `1,234.50 ft`. */
export function formatDisplayLength(realInches, display, precision) {
  const value = Math.max(0, Number(realInches) || 0);
  const p = normalizeMeasurePrecision(display, precision);
  if (display === 'ftin') {
    let feet = Math.floor(value / 12);
    let steps = Math.round((value - feet * 12) * p);
    if (steps >= 12 * p) { feet += 1; steps = 0; }
    const inches = fractionalInches(steps / p, p);
    if (!steps) return `${groupedNumber(feet, 0)}′`;
    if (!feet) return `${inches.text}″`;
    // Under an inch after whole feet reads 27′-0 1/2″, the drafting habit.
    return `${groupedNumber(feet, 0)}′-${inches.whole ? inches.text : `0 ${inches.text}`}″`;
  }
  if (display === 'infrac') {
    return `${fractionalInches(value, p).text}″`;
  }
  const unit = INCHES[display] ? display : 'in';
  return `${groupedNumber(value / INCHES[unit], p)} ${unit}`;
}

// Areas and volumes: ft-in reads square feet, fractional inches square inches.
const squareUnit = (display) => (display === 'ftin' ? 'ft' : display === 'infrac' ? 'in' : (INCHES[display] ? display : 'in'));
const placesFor = (display, precision) => (isFractionalDisplay(display) ? 2 : normalizeMeasurePrecision(display, precision));

export function formatDisplayArea(realSqInches, display, precision) {
  const unit = squareUnit(display);
  return `${groupedNumber((Number(realSqInches) || 0) / (INCHES[unit] ** 2), placesFor(display, precision))} ${unit}²`;
}

export function formatDisplayVolume(realCuInches, display, precision) {
  const unit = squareUnit(display);
  return `${groupedNumber((Number(realCuInches) || 0) / (INCHES[unit] ** 3), placesFor(display, precision))} ${unit}³`;
}

/** Depth always reads in decimals (Drawboard: `8.00 ft` beside a ft-in length). */
export function formatDisplayDepth(realInches, display, precision) {
  const unit = squareUnit(display);
  return `${groupedNumber((Number(realInches) || 0) / INCHES[unit], placesFor(display, precision))} ${unit}`;
}

/** The caption prefix when more than one reading shows. */
export const MEASURE_LINE_PREFIXES = Object.freeze({
  length: 'L', perimeter: 'P', area: 'A', depth: 'D', wallArea: 'WA', volume: 'V',
});

/** Whether a scale asks for these formats. */
export function scaleUsesDisplay(scale) {
  return Boolean(scale && isMeasureDisplay(scale.display));
}

/** Inches in one of a display's own units (for a typed custom scale). */
export function displayUnitInches(display) {
  return INCHES[squareUnit(display)];
}

/**
 * A typed feet-inches real length, Drawboard's rules (§1): 8', 8' 6", 96",
 * 1/2", 8'6 1/2". Refuses 8'6 (inches with no mark), 96 (no mark), 8 ft, 0
 * and anything negative. Returns inches, or null.
 */
export function parseFeetInches(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/[’′‘`]/g, "'")
    .replace(/[”″“]|''/g, '"');
  const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*")?$/);
  if (!m || (m[1] == null && m[2] == null)) return null;
  let inches = m[1] != null ? Number(m[1]) * 12 : 0;
  if (m[2] != null) {
    const part = m[2].trim();
    const mixed = part.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    const frac = part.match(/^(\d+)\/(\d+)$/);
    if (mixed) inches += Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : NaN;
    else if (frac) inches += Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN;
    else inches += Number(part);
  }
  return Number.isFinite(inches) && inches > 0 ? inches : null;
}

// The scale unit (MEASURE_UNITS) a display keeps its points-per-unit in, so
// the depth box and the scale bar keep asking in a sensible unit.
const SCALE_UNIT = Object.freeze({ ftin: 'ft', ft: 'ft', mi: 'ft', infrac: 'in', in: 'in', yd: 'yd', mm: 'mm', cm: 'cm', m: 'm', km: 'm' });
export const scaleUnitForDisplay = (display) => SCALE_UNIT[display] || 'in';

const PAPER_INCHES = Object.freeze({ in: 1, mm: 1 / 25.4, cm: 1 / 2.54 });
export const PAPER_UNITS = Object.freeze(['in', 'mm', 'cm']);

/**
 * A custom scale: `paper` (in / mm / cm) on the sheet is `realText` in the
 * display. Fractional displays read feet-inches marks; decimals read a plain
 * number. Returns { ptPerUnit, unit, label, display, precision } or null.
 */
export function customMeasureScale({ paper, paperUnit = 'in', realText, display, precision }) {
  const paperValue = Number(paper);
  if (!(paperValue > 0) || !Number.isFinite(paperValue) || !PAPER_INCHES[paperUnit] || !isMeasureDisplay(display)) return null;
  let realInches;
  if (isFractionalDisplay(display)) {
    realInches = parseFeetInches(realText);
  } else {
    const n = Number(String(realText ?? '').trim());
    realInches = Number.isFinite(n) && n > 0 && /^\d*\.?\d+$/.test(String(realText).trim()) ? n * INCHES[display] : null;
  }
  if (!realInches) return null;
  const unit = scaleUnitForDisplay(display);
  const unitInches = { ft: 12, in: 1, yd: 36, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 }[unit];
  const paperPt = paperValue * PAPER_INCHES[paperUnit] * 72;
  const p = normalizeMeasurePrecision(display, precision);
  const paperLabel = paperUnit === 'in' ? `${paperValue}″` : `${paperValue} ${paperUnit}`;
  return {
    ptPerUnit: paperPt / (realInches / unitInches),
    unit,
    // A decimal label drops trailing zeros: `1 cm = 2.5 m`, not `2.5000 m`.
    label: `${paperLabel} = ${isFractionalDisplay(display)
      ? formatDisplayLength(realInches, display, 16)
      : formatDisplayLength(realInches, display, 4).replace(/(\.\d*?)0+(?=\D*$)/, '$1').replace(/\.(?=\D*$)/, '')}`,
    display,
    precision: p,
    // What was typed, so the dialog reopens on it and Apply works again.
    custom: { paper: String(paper), paperUnit, real: String(realText).trim() },
  };
}

/**
 * The dialog's custom row for a saved custom scale: what was typed, or (for
 * one saved before that was kept) 1 inch of paper and the real length it
 * stands for, in the scale's own display.
 */
export function customScaleInputs(scale) {
  if (!scale || !isMeasureDisplay(scale.display)) return null;
  const c = scale.custom;
  if (c && Number(c.paper) > 0 && PAPER_INCHES[c.paperUnit] && String(c.real || '').trim()) {
    return { paper: String(c.paper), paperUnit: c.paperUnit, real: String(c.real) };
  }
  const unitInches = { ft: 12, in: 1, yd: 36, mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254 }[scale.unit];
  const ptPerUnit = Number(scale.ptPerUnit);
  if (!unitInches || !(ptPerUnit > 0)) return null;
  const realInches = (72 / ptPerUnit) * unitInches;
  const real = isFractionalDisplay(scale.display)
    ? formatDisplayLength(realInches, scale.display, 16)
    : String(Number((realInches / INCHES[scale.display]).toFixed(4)));
  return { paper: '1', paperUnit: 'in', real };
}

/** The display a preset (or older scale) starts in under 'measure-plus'. */
export function displayForScaleUnit(unit) {
  if (unit === 'ft') return 'ftin';
  if (unit === 'in') return 'infrac';
  return ['mm', 'cm', 'm', 'yd'].includes(unit) ? (unit === 'm' ? 'mm' : unit) : 'ftin';
}

// --- Set as default (this device, this person) ---------------------------

const DEFAULT_SCALE_KEY = 'survey.measure.defaultScale';
const validScale = (s) => Boolean(s) && Number(s.ptPerUnit) > 0 && Number.isFinite(Number(s.ptPerUnit)) && typeof s.unit === 'string';

/** The scale a document with none of its own starts at, or null. */
export function readDefaultMeasureScale(storage = globalThis.localStorage) {
  try {
    const s = JSON.parse(storage?.getItem(DEFAULT_SCALE_KEY) || 'null');
    return validScale(s) ? s : null;
  } catch {
    return null;
  }
}
export function saveDefaultMeasureScale(scale, storage = globalThis.localStorage) {
  if (!validScale(scale)) return;
  try { storage?.setItem(DEFAULT_SCALE_KEY, JSON.stringify(scale)); } catch { /* kept for this visit only */ }
}

/** The document's scales with the default standing in for "all pages" when it set none. */
export function withDefaultMeasureScale(meta, fallback) {
  if (!validScale(fallback) || meta?.all) return meta;
  return { ...(meta || { pages: {} }), all: { ...fallback } };
}
