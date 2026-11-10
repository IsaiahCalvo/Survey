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

test('dimension line: offset, extensions past it, chevrons, line broken round the caption', async () => {
  const dl = await import('../src/utils/measure/dimensionLine.js');
  const g = dl.dimensionLineGeometry({ x1: 0, y1: 100, x2: 200, y2: 100 }, { leader: 15.31, captionWidth: 40 });
  // Drawn left to right, the line sits 15.31 pt above (y-down page space).
  assert.deepEqual([g.a.x, +g.a.y.toFixed(2), g.b.x, +g.b.y.toFixed(2)], [0, 84.69, 200, 84.69]);
  assert.equal(+g.extensions[0][1].y.toFixed(2), 82.69, 'extension runs 2 pt past the line');
  assert.equal(g.segments.length, 2);
  assert.equal(+(g.segments[1][0].x - g.segments[0][1].x).toFixed(2), 46, 'gap = caption + 3 pt each side');
  assert.deepEqual(g.chevrons[0].map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), [[7, 80.69], [0, 84.69], [7, 88.69]]);
  assert.equal(g.caption.angle, 0);
  // Right to left: the text still reads upright.
  const back = dl.dimensionLineGeometry({ x1: 200, y1: 100, x2: 0, y2: 100 }, { captionWidth: 40 });
  assert.equal(((back.caption.angle % 360) + 360) % 360, 0);
  // A turned mark counts its turn: 170° on the page flips the text.
  const turned = dl.dimensionLineGeometry({ x1: 0, y1: 0, x2: 100, y2: 0 }, { turn: 170 });
  assert.equal(turned.caption.angle, 180);
  // Too short for the caption: one piece, the caption just off the line.
  const short = dl.dimensionLineGeometry({ x1: 0, y1: 0, x2: 30, y2: 0 }, { captionWidth: 40 });
  assert.equal(short.segments.length, 1);
  assert.ok(short.caption.y < short.a.y);
  assert.equal(dl.dimensionLineGeometry({ x1: 1, y1: 1, x2: 1, y2: 1 }), null);
});

test('dimension line: stamped only on a new Length with the flag; drawn by renderLine', async () => {
  const { stampMeasure } = await import('../src/utils/measure/measureScale.js');
  const dl = await import('../src/utils/measure/dimensionLine.js');
  const line = { type: 'Line', x1: -50, y1: 0, x2: 50, y2: 0, left: 0, top: 0, width: 100, height: 0 };
  assert.equal(dl.isDimensionMeasure(stampMeasure(line, 'length', null)), false);
  const dim = stampMeasure(line, 'length', null, { dim: true });
  assert.equal(dl.isDimensionMeasure(dim), true);
  assert.equal(dl.dimensionLeader(dim), 15.31);
  assert.equal(dl.isDimensionMeasure(stampMeasure({ type: 'polygon', points: [] }, 'area', null, { dim: true })), false);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /stampMeasure\(json, 'length', effectiveMeasureScale, \{ dim: isFeatureOn\('measure-plus'\) \}\)/);
  assert.match(layer, /if \(isDimensionMeasure\(obj\)\) return;/);
  assert.match(read('src/utils/svgAnnotationRenderers.jsx'), /if \(spec\.kind !== 'curved' && isDimensionMeasure\(obj\)\) \{/);
});

test('dimension line: the drag draft is the dimension line and has no pill', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /measureMode === 'length' && shapeCreation\.tool === 'line' && isFeatureOn\('measure-plus'\)\s*\? stampMeasure\(draftJson, 'length', effectiveMeasureScale, \{ dim: true \}\)/);
  assert.match(layer, /&& !\(measureMode === 'length' && isFeatureOn\('measure-plus'\)\)\s*&& renderMeasureLabel\(/);
});

test('dimension line: Leader and Inline / Above are edited on dimension marks only', async () => {
  const { stampMeasure, applyMeasureEdit } = await import('../src/utils/measure/measureScale.js');
  const dl = await import('../src/utils/measure/dimensionLine.js');
  assert.equal(dl.normalizeDimensionLeader('24,5'), 24.5);
  assert.equal(dl.normalizeDimensionLeader('-8.126'), -8.13, 'negative flips the side');
  assert.equal(dl.normalizeDimensionLeader('99999'), dl.DIMENSION_LEADER_MAX_PT);
  assert.equal(dl.normalizeDimensionLeader('-0'), 0);
  assert.equal(dl.normalizeDimensionLeader('abc'), null);
  assert.equal(dl.normalizeDimensionLeader(''), null);
  const line = { type: 'Line', x1: -50, y1: 0, x2: 50, y2: 0, left: 0, top: 0, width: 100, height: 0 };
  const dim = stampMeasure(line, 'length', null, { dim: true });
  const longer = applyMeasureEdit(dim, { leader: '30' });
  assert.equal(dl.dimensionLeader(longer), 30);
  assert.equal(applyMeasureEdit(dim, { leader: 'x' }), dim, 'a bad leader changes nothing');
  const above = applyMeasureEdit(dim, { captionPlace: 'above' });
  assert.equal(dl.dimensionCaptionPlace(above), 'above');
  assert.equal(dl.dimensionCaptionPlace(applyMeasureEdit(above, { captionPlace: 'inline' })), 'inline');
  assert.equal(applyMeasureEdit(above, { captionPlace: 'inline' }).data.measure.dim.caption, undefined);
  // A plain Length has no dim to edit.
  const plain = stampMeasure(line, 'length', null);
  assert.equal(applyMeasureEdit(plain, { leader: 30, captionPlace: 'above' }), plain);
  // Above keeps the line whole and sets the caption beside it, past the line.
  const g = dl.dimensionLineGeometry({ x1: 0, y1: 100, x2: 200, y2: 100 }, { captionWidth: 40, captionHeight: 21.6, place: 'above' });
  assert.equal(g.segments.length, 1);
  assert.equal(+g.caption.y.toFixed(2), +(84.69 - 10.8 - 2).toFixed(2));
  // Flipped side: the caption follows below.
  const flip = dl.dimensionLineGeometry({ x1: 0, y1: 100, x2: 200, y2: 100 }, { leader: -15.31, captionWidth: 40, place: 'above' });
  assert.ok(flip.caption.y > flip.a.y);
  // Caption size S / M / L scales the 9 pt caption from Medium.
  const { MEASURE_LABEL_FONT_PX } = await import('../src/utils/measure/measureScale.js');
  assert.equal(MEASURE_LABEL_FONT_PX, 12, 'dimensionLine.js scales from this base');
  assert.equal(dl.dimensionCaptionPt(dim), 9);
  assert.equal(dl.dimensionCaptionPt(applyMeasureEdit(dim, { captionSize: 16 })), 12);
  // Wiring: the card shows the fields for dimension marks only.
  const card = read('src/components/MeasureEditPopover.jsx');
  assert.match(card, /\{isDim && \(\s*<label className="measure-edit__field">\s*<span className="measure-edit__name">Leader<\/span>/);
  assert.match(card, /onClick=\{\(\) => onPatch\?\.\(\{ captionPlace: place \}\)\}/);
  assert.match(read('src/utils/svgAnnotationRenderers.jsx'), /place: dimensionCaptionPlace\(obj\),/);
});

test('dimension line: a leader pill replaces the bend grabber and drags the leader', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /\{!dimGeo && renderLineHitPad\('midpoint'/);
  assert.match(layer, /data-handle="leader"[\s\S]{0,900}handleHandlePointerDown\(e, 'leader'\)/);
  assert.match(layer, /if \(lineEdit\.dimLeader != null\) \{/);
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /if \(handleId === 'leader'\) \{\s*if \(!isDimensionMeasure\(obj\)\) return;/);
  assert.match(hook, /lineEdit: \{ dimLeader: leader \}/);
  assert.match(hook, /action: 'leader-move',/);
  assert.match(hook, /originalLeader: null, currentLeader: null,/);
});
