// Nightly 'measure-plus': Drawboard's measure formats (utils/measure/measureFormat.js),
// the delegation in measureScale.js and the dialog/viewer wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  customMeasureScale,
  defaultMeasurePrecision,
  displayForScaleUnit,
  formatDisplayArea,
  formatDisplayDepth,
  formatDisplayLength,
  formatDisplayVolume,
  groupedNumber,
  normalizeMeasurePrecision,
  parseFeetInches,
  readDefaultMeasureScale,
  saveDefaultMeasureScale,
  scaleUsesDisplay,
  withDefaultMeasureScale,
} from '../src/utils/measure/measureFormat.js';
import { formatMeasureArea, formatMeasureLength } from '../src/utils/measure/measureScale.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('feet-inches readings: primes, whole feet, rounding up to a foot, commas', () => {
  assert.equal(formatDisplayLength(84 * 12 + 8.25, 'ftin', 4), '84′-8 1/4″');
  assert.equal(formatDisplayLength(480, 'ftin', 4), '40′');
  assert.equal(formatDisplayLength(8.25, 'ftin', 4), '8 1/4″');
  assert.equal(formatDisplayLength(11.99, 'ftin', 4), '1′', '11.99″ rounds to a whole foot, never 12″');
  assert.equal(formatDisplayLength(1234 * 12 + 6, 'ftin', 2), '1,234′-6″');
  assert.equal(formatDisplayLength(0.5, 'ftin', 1), '1″');
  assert.equal(formatDisplayLength(27 * 12 + 0.5, 'ftin', 4), '27′-0 1/2″', 'under an inch keeps the 0');
  assert.equal(formatDisplayLength(8.5, 'infrac', 8), '8 1/2″', 'fractions reduce');
  assert.equal(formatDisplayLength(0.25, 'infrac', 4), '1/4″');
});

test('decimal readings carry the chosen places and unit', () => {
  assert.equal(formatDisplayLength(18, 'ft', 2), '1.50 ft');
  assert.equal(formatDisplayLength(254, 'mm', 0), '6,452 mm');
  assert.equal(formatDisplayLength(39.37, 'm', 3), '1.000 m');
  assert.equal(groupedNumber(1391.523, 2), '1,391.52');
});

test('areas, volumes and depth read in decimals; fractional displays at 0.01', () => {
  assert.equal(formatDisplayArea(1391.523 * 144, 'ftin', 16), '1,391.52 ft²');
  assert.equal(formatDisplayArea(144, 'infrac', 4), '144.00 in²');
  assert.equal(formatDisplayVolume(1728 * 2, 'ftin', 4), '2.00 ft³');
  assert.equal(formatDisplayDepth(96, 'ftin', 4), '8.00 ft');
  assert.equal(formatDisplayArea(1e6, 'mm', 1), '645,160,000.0 mm²');
});

test('precision falls back to the display default', () => {
  assert.equal(defaultMeasurePrecision('ftin'), 4);
  assert.equal(defaultMeasurePrecision('ft'), 2);
  assert.equal(normalizeMeasurePrecision('ftin', 3), 4, '1/3 is not a step');
  assert.equal(normalizeMeasurePrecision('ftin', 16), 16);
  assert.equal(normalizeMeasurePrecision('m', 9), 2);
  assert.equal(normalizeMeasurePrecision('m', 0), 0);
  assert.equal(normalizeMeasurePrecision('ft', null), 2, 'no precision is the default, not 0 places');
  assert.equal(normalizeMeasurePrecision('ft', undefined), 2);
});

test('typed feet-inches follow Drawboard: marks required, no zero or negatives', () => {
  assert.equal(parseFeetInches("8'"), 96);
  assert.equal(parseFeetInches(`8' 6"`), 102);
  assert.equal(parseFeetInches('96"'), 96);
  assert.equal(parseFeetInches('1/2"'), 0.5);
  assert.equal(parseFeetInches(`8'6 1/2"`), 102.5);
  assert.equal(parseFeetInches('8′-6″'), 102);
  for (const bad of ["8'6", '96', '8 ft', "0'", '-8\'', '', '1/0"']) assert.equal(parseFeetInches(bad), null, bad);
});

test('a custom scale: paper to real, kept in a sensible scale unit', () => {
  const s = customMeasureScale({ paper: 1, paperUnit: 'in', realText: "8'", display: 'ftin', precision: 8 });
  assert.deepEqual(s, { ptPerUnit: 9, unit: 'ft', label: '1″ = 8′', display: 'ftin', precision: 8 });
  const m = customMeasureScale({ paper: 10, paperUnit: 'mm', realText: '1', display: 'm', precision: 2 });
  assert.equal(m.unit, 'm');
  assert.ok(Math.abs(m.ptPerUnit - (10 / 25.4) * 72) < 1e-9);
  assert.equal(m.label, '10 mm = 1.0000 m');
  assert.equal(customMeasureScale({ paper: 1, realText: '8', display: 'ftin' }), null, 'feet-inches needs marks');
  assert.equal(customMeasureScale({ paper: 0, realText: "8'", display: 'ftin' }), null);
  assert.equal(customMeasureScale({ paper: 1, realText: '1e3', display: 'm' }), null);
  assert.equal(customMeasureScale({ paper: 1, paperUnit: 'pt', realText: "8'", display: 'ftin' }), null);
});

test('older scales read as before; a display switches measureScale over', () => {
  const plain = { ptPerUnit: 9, unit: 'ft' };
  assert.equal(scaleUsesDisplay(plain), false);
  const before = formatMeasureLength(9 * 84.6875, plain);
  assert.ok(!before.includes('′'), before);
  const withDisplay = { ...plain, display: 'ftin', precision: 4 };
  assert.equal(formatMeasureLength(9 * (84 + 8.25 / 12), withDisplay), '84′-8 1/4″');
  assert.equal(formatMeasureArea(81 * 100, withDisplay), '100.00 ft²');
  assert.equal(displayForScaleUnit('ft'), 'ftin');
  assert.equal(displayForScaleUnit('in'), 'infrac');
  assert.equal(displayForScaleUnit('m'), 'mm');
});

test('Set as default: saved per device, stands in only when the file set none', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readDefaultMeasureScale(storage), null);
  saveDefaultMeasureScale({ ptPerUnit: 0, unit: 'ft' }, storage);
  assert.equal(readDefaultMeasureScale(storage), null, 'a bad scale is not saved');
  const def = { ptPerUnit: 9, unit: 'ft', display: 'ftin', precision: 4, label: '1″ = 8′' };
  saveDefaultMeasureScale(def, storage);
  assert.deepEqual(readDefaultMeasureScale(storage), def);
  assert.deepEqual(withDefaultMeasureScale(null, def), { pages: {}, all: def });
  const own = { all: { ptPerUnit: 3, unit: 'in' }, pages: {} };
  assert.equal(withDefaultMeasureScale(own, def), own, "the file's own scale wins");
  const pagesOnly = { pages: { 2: { ptPerUnit: 3, unit: 'in' } } };
  assert.deepEqual(withDefaultMeasureScale(pagesOnly, def), { ...pagesOnly, all: def });
  store.set('survey.measure.defaultScale', '{bad json');
  assert.equal(readDefaultMeasureScale(storage), null);
});

test('wiring: beta flag, migration, dialog fields, viewer default', () => {
  assert.match(read('src/featureFlags.js'), /'measure-plus': Object\.freeze\(\{[\s\S]*?stage: 'beta'/);
  assert.match(read('supabase/migrations/20261110157000_measure_plus_flag.sql'), /\('measure-plus', 'off'/);
  const dialog = read('src/components/MeasureScaleDialog.jsx');
  assert.match(dialog, /isFeatureOn\('measure-plus'\)/);
  for (const attr of ['data-measure-scale-kind-option', 'data-measure-custom-paper', 'data-measure-custom-real', 'data-measure-display', 'data-measure-precision', 'data-measure-set-default']) {
    assert.ok(dialog.includes(attr), attr);
  }
  assert.match(dialog, /setDefault: plusOn && setDefault/);
  // Its drop-down lists open above the dialog's own scrim (z 1000000).
  assert.equal((dialog.match(/menuClassName="measure-scale__menu"/g) || []).length, 3);
  assert.match(read('src/components/MeasureScaleDialog.css'), /\.value-select__menu\.measure-scale__menu \{\s*z-index: 1000001;/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /withDefaultMeasureScale\(savedMeasureScaleMeta, measureDefaultScale\)/);
  assert.match(viewer, /if \(setDefault && measurePlusOn\)/);
});
