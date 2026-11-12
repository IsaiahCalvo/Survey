/**
 * Native PDF measurements (ISO 32000-1 §12.9, "Measurement properties").
 *
 * Drawboard, Bluebeam and Acrobat save a measurement as a normal Line /
 * PolyLine / Polygon annotation plus an /IT intent (LineDimension,
 * PolyLineDimension, PolygonDimension) and a /Measure dictionary that holds
 * the sheet scale. Survey used to import those as plain shapes, losing the
 * scale, and exported its own measurements without them, so other apps saw
 * plain lines (Linear KAL-539).
 *
 * The /Measure scale lives in number-format arrays: /X (along the page), and
 * /D (distance) and /A (area). The first entry's /C turns PDF points into
 * that entry's unit (for /D and /A, it turns /X's unit into theirs); each
 * later entry's /C splits the previous unit into a smaller one (ft -> in).
 * A Survey scale is { ptPerUnit, unit, label }, points per real unit.
 */

import { MEASURE_UNITS, isValidMeasureScale } from './measureScale.js';

export const PDF_MEASURE_INTENT_BY_SUBTYPE = Object.freeze({
  Line: 'LineDimension',
  PolyLine: 'PolyLineDimension',
  Polygon: 'PolygonDimension',
});

// Survey measure kind for each native measurement shape.
export const SURVEY_KIND_BY_PDF_SUBTYPE = Object.freeze({
  Line: 'length',
  PolyLine: 'polylength',
  Polygon: 'area',
});

const UNIT_ALIASES = new Map([
  ['in', 'in'], ['inch', 'in'], ['inches', 'in'], ['"', 'in'], ['″', 'in'],
  ['ft', 'ft'], ['foot', 'ft'], ['feet', 'ft'], ["'", 'ft'], ['′', 'ft'],
  ['yd', 'yd'], ['yard', 'yd'], ['yards', 'yd'],
  ['mm', 'mm'], ['millimeter', 'mm'], ['millimetre', 'mm'], ['millimeters', 'mm'], ['millimetres', 'mm'],
  ['cm', 'cm'], ['centimeter', 'cm'], ['centimetre', 'cm'], ['centimeters', 'cm'], ['centimetres', 'cm'],
  ['m', 'm'], ['meter', 'm'], ['metre', 'm'], ['meters', 'm'], ['metres', 'm'],
]);

/** Survey unit key for a PDF unit label ("ft", "Feet", "'", "m"...), else null. */
export function surveyUnitFromPdfLabel(label) {
  const key = String(label ?? '').trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES.get(key) || null;
}

/**
 * Walks one number-format array ({ U, C } entries) starting from `factor`
 * (points -> the unit before it) and returns the first entry Survey knows:
 * { unit, factor } where factor turns points into that unit. Null when no
 * entry is usable.
 */
function firstKnownUnit(formats, factor) {
  let f = factor;
  for (const format of formats) {
    const c = Number(format?.C);
    if (!(Number.isFinite(c) && c > 0)) return null;
    f *= c;
    const unit = surveyUnitFromPdfLabel(format?.U);
    if (unit) return { unit, factor: f };
  }
  return null;
}

/**
 * A Survey scale from a plain reading of a /Measure dictionary:
 * { Subtype, R, X: [{ U, C }], D: [{ U, C }], ... }. Null when it is not a
 * rectilinear measure or no unit Survey knows can be reached.
 */
export function surveyScaleFromPdfMeasure(measure) {
  if (!measure || typeof measure !== 'object') return null;
  const subtype = String(measure.Subtype || 'RL').replace(/^\//, '');
  if (subtype !== 'RL') return null; // GEO (map) measures have no sheet scale
  const x = Array.isArray(measure.X) ? measure.X : [];
  const d = Array.isArray(measure.D) ? measure.D : [];
  const xFirst = Number(x[0]?.C);
  const xFactor = Number.isFinite(xFirst) && xFirst > 0 ? xFirst : null;
  // Distance first (it is what a length reads in), then the page axis.
  const found = (d.length ? firstKnownUnit(d, xFactor ?? 1) : null) || (x.length ? firstKnownUnit(x, 1) : null);
  if (!found || !(found.factor > 0)) return null;
  const ptPerUnit = 1 / found.factor;
  const ratio = typeof measure.R === 'string' ? measure.R.trim() : '';
  const scale = { ptPerUnit, unit: found.unit, label: ratio || `1 pt = ${Math.round(found.factor * 1e4) / 1e4} ${MEASURE_UNITS[found.unit].label}` };
  return isValidMeasureScale(scale) ? scale : null;
}

/**
 * Reads a pdf-lib /Measure dictionary into the plain shape above. `lib`
 * carries pdf-lib's PDFName plus the importer's text/number readers.
 */
export function readPdfMeasureDict(dict, { context, PDFName, readText, readNumber }) {
  if (!dict || typeof dict.get !== 'function') return null;
  const look = (value) => (value && context?.lookup ? (context.lookup(value) || value) : value);
  const formats = (key) => {
    const array = look(dict.get(PDFName.of(key)));
    if (!array || typeof array.asArray !== 'function') return [];
    return array.asArray().map((entry) => {
      const format = look(entry);
      if (!format || typeof format.get !== 'function') return null;
      return { U: readText(format.get(PDFName.of('U'))), C: readNumber(format.get(PDFName.of('C'))) };
    }).filter(Boolean);
  };
  return {
    Subtype: readText(dict.get(PDFName.of('Subtype'))) || 'RL',
    R: readText(dict.get(PDFName.of('R'))) || '',
    X: formats('X'),
    D: formats('D'),
    A: formats('A'),
  };
}

/**
 * The /Measure entries for a Survey measurement on export, as plain values
 * for pdf-lib's context.obj: strings become names there, so text values go
 * through `text` (the exporter's PDF text-string builder). Null without a
 * usable scale: a measurement with no scale has nothing true to write.
 */
export function pdfMeasureEntriesForScale(scale, text) {
  if (!isValidMeasureScale(scale)) return null;
  const unit = MEASURE_UNITS[scale.unit];
  const perPoint = 1 / Number(scale.ptPerUnit);
  const numberFormat = (label, c) => ({ Type: 'NumberFormat', U: text(label), C: c, F: 'D', D: 100 });
  return {
    Type: 'Measure',
    Subtype: 'RL',
    R: text(String(scale.label || `${Math.round(Number(scale.ptPerUnit) * 1e4) / 1e4} pt = 1 ${unit.label}`)),
    X: [numberFormat(unit.label, perPoint)],
    D: [numberFormat(unit.label, 1)],
    A: [numberFormat(unit.area, 1)],
  };
}
