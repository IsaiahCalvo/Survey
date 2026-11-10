/**
 * realLength.js — read the real length typed while calibrating (Nightly,
 * flag 'calibrate-entry'; Drawboard PDF Pro trial audit 2026-11-10).
 *
 * Plans are dimensioned in feet and inches, so the box takes what is written
 * on them: 20', 20' 6", 20'-6", 20-6 (feet), 6", 12 1/2", 3/4", 20 ft 6 in,
 * 6 m, 3.5 cm, 450 mm, 2 yd, as well as a plain number in the picked unit. A length with foot or inch
 * marks is turned into the picked unit, so 20' with Metres picked reads 6.096.
 */
import { MEASURE_UNITS } from './measureScale.js';

const NUM = String.raw`(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)`;

function number(text) {
  const t = String(text).trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : NaN;
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN;
  return Number(t);
}

/** The typed length in `unit`, or null when it can't be read or is not above 0. */
export function parseRealLength(input, unit) {
  if (!MEASURE_UNITS[unit]) return null;
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[’′‘`]/g, "'")
    .replace(/[”″“]|''/g, '"');
  if (!text) return null;
  // 6 m, 3.5 cm, 450mm, 2 yd: a number with a unit word, turned into `unit`
  // (R4-A: metric was refused with no reason).
  const withUnit = text.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?|yds?|yards?)\.?$/);
  if (withUnit) {
    const word = withUnit[2];
    const from = word.startsWith('mm') || word.startsWith('milli') ? 'mm'
      : word.startsWith('c') ? 'cm'
        : word.startsWith('y') ? 'yd' : 'm';
    const value = (Number(withUnit[1]) * MEASURE_UNITS[from].inches) / MEASURE_UNITS[unit].inches;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const feetRe = new RegExp(`${NUM}\\s*(?:'|ft\\.?|feet|foot)`);
  const inchRe = new RegExp(`${NUM}\\s*(?:"|in\\.?|inch(?:es)?)`);
  const ft = text.match(feetRe);
  const rest = ft ? text.replace(ft[0], ' ') : text;
  const inch = rest.match(inchRe);
  let inches = null;
  if (ft || inch) {
    const leftover = (inch ? rest.replace(inch[0], ' ') : rest).replace(/[-\s,]+/g, '');
    // 20' 6 (inches with no mark after a foot mark)
    let bare = 0;
    if (leftover) {
      if (!ft || inch) return null;
      bare = number(leftover);
      if (!Number.isFinite(bare)) return null;
    }
    inches = (ft ? number(ft[1]) * 12 : 0) + (inch ? number(inch[1]) : 0) + bare;
  } else if (unit === 'ft') {
    // 20-6: architectural feet-inches with a dash.
    const dash = text.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)$/);
    if (dash) inches = number(dash[1]) * 12 + number(dash[2]);
  }
  const value = inches != null ? inches / MEASURE_UNITS[unit].inches : number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** What the traced line measures on paper, in plain words ("5 in on paper"). */
export function paperLengthWords(lengthPt, metric = false) {
  const pt = Number(lengthPt);
  if (!(pt > 0)) return '';
  const inches = pt / 72;
  if (metric) return `${Math.round(inches * 25.4 * 10) / 10} mm on paper`;
  return `${Math.round(inches * 100) / 100} in on paper`;
}
