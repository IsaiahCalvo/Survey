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
  assert.deepEqual(s, { ptPerUnit: 9, unit: 'ft', label: '1″ = 8′', display: 'ftin', precision: 8, custom: { paper: '1', paperUnit: 'in', real: "8'" } });
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
  assert.match(read('supabase/migrations/20261110179000_measure_plus_flag.sql'), /\('measure-plus', 'off'/);
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
  assert.equal(dl.normalizeDimensionLeader('   '), null, 'spaces are blank, not 0');
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
  assert.match(read('src/utils/measure/dimensionLayout.js'), /place: dimensionCaptionPlace\(obj\),/);
});

test('dimension line: a leader pill replaces the bend grabber and drags the leader', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /\{!dimGeo && renderLineHitPad\('midpoint'/);
  assert.match(layer, /data-handle="leader"[\s\S]{0,900}handleHandlePointerDown\(e, 'leader'\)/);
  assert.match(layer, /if \(lineEdit\.dimLeader != null \|\| lineEdit\.dimCaptionOffset\) \{/);
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /if \(handleId === 'leader'\) \{\s*if \(!isDimensionMeasure\(obj\)\) return;/);
  assert.match(hook, /lineEdit: \{ dimLeader: leader \}/);
  assert.match(hook, /action: 'leader-move',/);
  assert.match(hook, /originalLeader: null, currentLeader: null,/);
});

test('dimension line: right-click Reset leader line', () => {
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /isDimensionMeasure\(menuObj\) \? \[item\('Reset leader line', 'resetLeaderLine'/);
  assert.match(menu, /measure\.dim = \{ \.\.\.measure\.dim, leader: DIMENSION_LEADER_PT \};/);
  assert.match(menu, /menuObjEditable && dimensionLeader\(menuObj\) !== DIMENSION_LEADER_PT\),/);
});

test('dimension line: a dragged caption keeps an elbow leader; Reset caption position', async () => {
  const dl = await import('../src/utils/measure/dimensionLine.js');
  const base = { x1: 0, y1: 100, x2: 200, y2: 100 };
  // Moved right and down past its own width: vertical from the line's middle, then across.
  const g = dl.dimensionLineGeometry(base, { captionWidth: 40, captionHeight: 10.8, captionOffset: { x: 60, y: 40 } });
  assert.equal(g.segments.length, 1, 'a moved caption leaves the line whole');
  assert.deepEqual([g.caption.x, +g.caption.y.toFixed(2)], [160, 124.69]);
  assert.deepEqual(g.elbow.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), [[100, 84.69], [100, 124.69], [138, 124.69]]);
  // Straight down within its width: one vertical piece to its top.
  const down = dl.dimensionLineGeometry(base, { captionWidth: 40, captionHeight: 10.8, captionOffset: { x: 5, y: 40 } });
  assert.deepEqual(down.elbow.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), [[100, 84.69], [100, 117.29]]);
  // No offset: no elbow.
  assert.equal(dl.dimensionLineGeometry(base, { captionWidth: 40 }).elbow, null);
  assert.equal(dl.dimensionCaptionOffset({ data: { measure: { dim: { captionOffset: { x: 0, y: 0 } } } } }), null);
  assert.deepEqual(dl.dimensionCaptionOffset({ data: { measure: { dim: { captionOffset: { x: 3, y: -2 } } } } }), { x: 3, y: -2 });
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /if \(handleId === 'dim-caption'\) \{/);
  assert.match(hook, /lineEdit: \{ dimCaptionOffset: offset \}/);
  assert.match(hook, /action: 'caption-move',/);
  assert.match(hook, /originalCaptionOffset: null, currentCaptionOffset: null,/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /data-handle="dim-caption"[\s\S]{0,700}handleHandlePointerDown\(e, 'dim-caption'\)/);
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /item\('Reset caption position', 'resetCaptionPosition'/);
  assert.match(menu, /menuObjEditable && Boolean\(dimensionCaptionOffset\(menuObj\)\)\)\] : \[\]\),/);
  assert.match(read('src/utils/svgAnnotationRenderers.jsx'), /\{geo\.elbow && \(\s*<polyline data-dimension-elbow="true"/);
});

test('dimension line: the canvas twin paints the same line, chevrons and caption', async () => {
  const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
  const { stampMeasure } = await import('../src/utils/measure/measureScale.js');
  const line = {
    type: 'line', tool: 'line', x1: -100, y1: 0, x2: 100, y2: 0, left: 100, top: 100, width: 200, height: 0,
    stroke: '#e11d2e', strokeWidth: 1, opacity: 1,
  };
  const dim = stampMeasure(line, 'length', null, { dim: true });
  const calls = [];
  const context = {
    save: () => {}, restore: () => {}, translate: (...a) => calls.push(['translate', ...a]), rotate: () => {},
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...a) => calls.push(['moveTo', ...a]),
    lineTo: (...a) => calls.push(['lineTo', ...a]),
    setLineDash: () => {},
    stroke: () => calls.push(['stroke', context.lineWidth]),
    fillText: (...a) => calls.push(['fillText', ...a]),
  };
  drawAnnotationObject(context, dim);
  const strokes = calls.filter((c) => c[0] === 'stroke').map((c) => c[1]);
  // 2 extension lines at 0.5 pt, the line (in two pieces round the caption), 2 chevrons.
  assert.equal(strokes.filter((w) => w === 0.5).length, 2);
  assert.ok(strokes.filter((w) => w === 1).length >= 3);
  const text = calls.find((c) => c[0] === 'fillText');
  assert.ok(text && /no scale|in|pt/.test(String(text[1])), 'the reading is painted');
  // Nothing at the clicked points' own line: every stroke at y = 100 is an extension start.
  const moves = calls.filter((c) => c[0] === 'moveTo');
  assert.ok(moves.some((m) => Math.abs(m[2] - (100 - 15.31)) < 0.01), 'the line sits a leader off the points');
});

test('a custom scale reopens with its typed row filled, so Apply keeps it', async () => {
  const m = await import('../src/utils/measure/measureFormat.js');
  const s = m.customMeasureScale({ paper: '2', paperUnit: 'cm', realText: '2.5', display: 'm', precision: 0.01 });
  assert.deepEqual(m.customScaleInputs(s), { paper: '2', paperUnit: 'cm', real: '2.5' });
  // A custom scale saved before the typed row was kept still reopens to an
  // equal scale.
  for (const [display, realText] of [['ftin', "8'"], ['ft', '12.5'], ['m', '2.5']]) {
    const { custom, ...older } = m.customMeasureScale({ paper: '1', paperUnit: 'in', realText, display, precision: display === 'ftin' ? 16 : 0.01 });
    assert.ok(custom);
    const row = m.customScaleInputs(older);
    const again = m.customMeasureScale({ paper: row.paper, paperUnit: row.paperUnit, realText: row.real, display, precision: older.precision });
    assert.ok(Math.abs(again.ptPerUnit - older.ptPerUnit) < 1e-9, display);
  }
  const dialog = readFileSync(new URL('../src/components/MeasureScaleDialog.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /customScaleInputs\(currentScale\)/);
});

test('a library drop lands in the scale on screen, default included', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /measureScaleMetaWithDefaultRef\.current = measureScaleMeta;/);
  assert.match(viewer, /metaScaleForPage\(measureScaleMetaWithDefaultRef\.current, drop\.pageNumber\)/);
});

test('dimension line: the PDF export draws it (/AP and print), reading included', async () => {
  const { PDFDocument, PDFName, PDFArray, PDFDict, decodePDFRawStream } = await import('pdf-lib');
  const { savePDFWithAnnotationsPdfLib } = await import('../src/utils/pdfAnnotationsPdfLib.js');
  const { stampMeasure } = await import('../src/utils/measure/measureScale.js');
  const m = await import('../src/utils/measure/measureFormat.js');
  const scale = m.customMeasureScale({ paper: '1', paperUnit: 'in', realText: "8'", display: 'ftin', precision: 16 });
  const line = {
    type: 'line', tool: 'line', x1: -100, y1: 0, x2: 100, y2: 0, left: 210, top: 200, width: 200, height: 0,
    originX: 'center', originY: 'center', stroke: '#e11d2e', strokeWidth: 1, opacity: 1,
  };
  const dim = stampMeasure(line, 'length', scale, { dim: true });
  const source = await PDFDocument.create();
  source.addPage([420, 320]);
  const bytes = await source.save();
  const file = { name: 'dim.pdf', async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  const { log, warn, error } = console;
  const original = globalThis.window;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  globalThis.window = {};
  let out;
  try {
    out = await savePDFWithAnnotationsPdfLib(file, { 1: { objects: [dim] } }, { 1: { width: 420, height: 320 } }, null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'dim' });
  } finally {
    console.log = log; console.warn = warn; console.error = error; globalThis.window = original;
  }
  const doc = await PDFDocument.load(out);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).asArray().map((r) => doc.context.lookup(r));
  const lineAnnot = annots.find((d) => d instanceof PDFDict && d.get(PDFName.of('Subtype'))?.toString() === '/Line');
  assert.ok(lineAnnot, 'a /Line annotation');
  const rect = lineAnnot.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => n.asNumber());
  // The clicked points sit at PDF y = 120; the dimension line is a leader off them.
  const lineY = 320 - (200 - 15.31);
  assert.ok(rect[3] >= lineY, `the /Rect reaches the offset line (${rect[3]} >= ${lineY})`);
  const ap = lineAnnot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  const content = Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1');
  assert.match(content, /Tj/, 'the reading is drawn');
  const hexes = [...content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((x) => Buffer.from(x[1], 'hex').toString('latin1'));
  assert.ok(hexes.some((t) => /^\d+'-\d/.test(t)), `feet-inches with plain marks: ${hexes.join(' | ')}`);
});

test('dimension caption style: pt size, text colour, background and opacity', async () => {
  const dl = await import('../src/utils/measure/dimensionLine.js');
  const { stampMeasure, applyMeasureEdit } = await import('../src/utils/measure/measureScale.js');
  const line = { type: 'line', tool: 'line', x1: -100, y1: 0, x2: 100, y2: 0, left: 100, top: 100, width: 200, height: 0, stroke: '#e11d2e', strokeWidth: 1 };
  let mark = stampMeasure(line, 'length', null, { dim: true });
  assert.equal(dl.dimensionCaptionPt(mark), 9);
  assert.deepEqual(dl.dimensionCaptionStyle(mark), { color: null, bg: null, bgOpacity: 0 });
  // Size: 2 to 24 pt; 9 is the default and is not stored; a typed blank reverts.
  mark = applyMeasureEdit(mark, { captionPt: '14 pt' });
  assert.equal(mark.data.measure.dim.size, 14);
  assert.equal(dl.dimensionCaptionPt(mark), 14);
  assert.equal(applyMeasureEdit(mark, { captionPt: '   ' }), mark);
  assert.equal(dl.dimensionCaptionPt(applyMeasureEdit(mark, { captionPt: 99 })), 24);
  assert.equal(applyMeasureEdit(mark, { captionPt: 9 }).data.measure.dim.size, undefined);
  // A pt size wins over the older S / M / L size, and replaces it.
  const sized = applyMeasureEdit({ ...mark, data: { ...mark.data, measure: { ...mark.data.measure, captionSize: 16 } } }, { captionPt: 10 });
  assert.equal(sized.data.measure.captionSize, undefined);
  assert.equal(dl.dimensionCaptionPt(sized), 10);
  // Colours: a #RRGGBB or back to the line's own.
  mark = applyMeasureEdit(mark, { captionColor: '#0066d4' });
  assert.equal(dl.dimensionCaptionStyle(mark).color, '#0066D4');
  assert.equal(dl.dimensionCaptionStyle(applyMeasureEdit(mark, { captionColor: null })).color, null);
  assert.equal(dl.dimensionCaptionStyle(applyMeasureEdit(mark, { captionColor: 'red' })).color, null);
  // A background comes in at full strength; opacity steps 25 / 50 / 75 / 100.
  mark = applyMeasureEdit(mark, { captionBg: '#FFF9C4' });
  assert.deepEqual(dl.dimensionCaptionStyle(mark), { color: '#0066D4', bg: '#FFF9C4', bgOpacity: 1 });
  mark = applyMeasureEdit(mark, { captionBgOpacity: 0.5 });
  assert.equal(dl.dimensionCaptionStyle(mark).bgOpacity, 0.5);
  assert.equal(applyMeasureEdit(mark, { captionBgOpacity: 0.3 }), mark);
  const cleared = applyMeasureEdit(mark, { captionBg: null });
  assert.equal(cleared.data.measure.dim.bg, undefined);
  assert.equal(cleared.data.measure.dim.bgOpacity, undefined);
  // A plain Length has no caption style to change.
  const plain = stampMeasure(line, 'length', null);
  assert.equal(applyMeasureEdit(plain, { captionColor: '#0066D4' }), plain);

  // Every surface draws it: SVG, the canvas twin and the PDF writer.
  const svg = readFileSync(new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url), 'utf8');
  assert.match(svg, /data-dimension-caption-bg=\{style\.bg\}/);
  assert.match(svg, /fill=\{style\.color \|\| stroke\}/);
  const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
  const calls = [];
  const context = {
    globalAlpha: 1,
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {}, beginPath: () => {},
    moveTo: () => {}, lineTo: () => {}, setLineDash: () => {}, stroke: () => {},
    fillRect: (...a) => calls.push(['fillRect', context.fillStyle, context.globalAlpha, ...a]),
    fillText: (...a) => calls.push(['fillText', context.fillStyle, ...a]),
  };
  drawAnnotationObject(context, { ...mark, opacity: 1 });
  const rect = calls.find((c) => c[0] === 'fillRect');
  assert.ok(rect && rect[1] === '#FFF9C4' && rect[2] === 0.5, 'the background is painted at its opacity');
  assert.equal(calls.find((c) => c[0] === 'fillText')[1], '#0066D4');
  const pdf = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');
  assert.match(pdf, /if \(dim\.style\.bg\) \{/);
  assert.match(pdf, /color: textColor\.color,/);
  const card = readFileSync(new URL('../src/components/MeasureEditPopover.jsx', import.meta.url), 'utf8');
  for (const bit of ['data-measure-edit-caption-pt', 'data-measure-edit-caption-color', 'data-measure-edit-caption-bg', 'data-measure-edit-caption-bg-opacity']) {
    assert.ok(card.includes(bit), bit);
  }
});

test('measure-plus: a Perimeter finished at its last point stays open (a polylength)', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /const openPerimeter = action === 'finish' && resolved\.finalType === 'polygon'\s*&& measureMode === 'perimeter' && isFeatureOn\('measure-plus'\);/);
  assert.match(layer, /const tool = openPerimeter \? 'polyline' : resolved\.finalType;/);
  assert.match(layer, /if \(openPerimeter\) rawJson = stampMeasure\(builtJson, 'polylength', effectiveMeasureScale\);/);
});

test('segment captions: one per Polylength segment, upright, on the line; the total moves above the last', async () => {
  const { measureSegmentCaptions: polylengthSegmentCaptions, polylengthTotalPlace } = await import('../src/utils/measure/segmentCaptions.js');
  const { layoutMeasureLabel, buildMeasureLabel } = await import('../src/utils/measure/measureScale.js');
  const scale = { ratio: 1, unit: 'pt' };
  const obj = {
    type: 'polyline',
    left: 0,
    top: 0,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 40, y: 50 }],
    data: { measure: { kind: 'polylength' } },
  };
  const caps = polylengthSegmentCaptions(obj, scale);
  assert.equal(caps.length, 3);
  assert.deepEqual(caps.map((c) => c.text), [formatMeasureLength(100, scale), formatMeasureLength(50, scale), formatMeasureLength(60, scale)]);
  for (const c of caps) assert.ok(c.angle >= -90 && c.angle < 90, `angle ${c.angle} reads upright`);
  assert.equal(caps[0].angle, 0);
  assert.equal(caps[1].angle, -90, 'a downward segment reads bottom to top');
  assert.ok(Math.abs(caps[2].angle) < 1e-9, 'a right-to-left segment is turned the right way up');
  assert.deepEqual([caps[0].x, caps[0].y], [50, 0], 'Inline: on the segment middle');
  assert.deepEqual(polylengthSegmentCaptions({ ...obj, data: { measure: { kind: 'perimeter' } } }, scale), [], 'a Perimeter has none by default');
  assert.deepEqual(polylengthSegmentCaptions({ ...obj, data: {} }, scale), []);

  const place = polylengthTotalPlace(obj, scale);
  assert.deepEqual([place.x, place.y], [70, 50], 'the last segment middle');
  const box = layoutMeasureLabel({ ...buildMeasureLabel(obj, scale), ...place }, 1);
  assert.equal(box.cx, 70);
  assert.ok(box.cy < 50 - box.height / 2 - 4.5, 'level pill sits above the last segment and its caption');
  assert.equal(box.angle, 0);
  assert.equal(polylengthTotalPlace({ ...obj, data: {} }, scale), null);
});

test('segment captions are drawn by the SVG layer only under measure-plus', () => {
  const src = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(src, /import \{ measureSegmentCaptions, polylengthTotalPlace \} from '\.\.\/utils\/measure\/segmentCaptions\.js'/);
  assert.match(src, /label && plusOn \? polylengthTotalPlace\(obj, effectiveMeasureScale\) : null/);
  assert.match(src, /segmentCaptionMarks = useMemo\(\(\) => \{\s*if \(!isFeatureOn\('measure-plus'\)\) return \[\];/);
  assert.match(src, /data-segment-caption=\{c\.index\}/);
});

test('segment caption places: Off / Inline / Upright / Above, per mark, Perimeter sides close', async () => {
  const { measureSegmentCaptions, polylengthTotalPlace, SEGMENT_CAPTION_ABOVE_LIFT } = await import('../src/utils/measure/segmentCaptions.js');
  const { applyMeasureEdit, segmentCaptionPlace } = await import('../src/utils/measure/measureScale.js');
  const scale = { ratio: 1, unit: 'pt' };
  const poly = {
    type: 'polyline', left: 0, top: 0,
    points: [{ x: 0, y: 0 }, { x: 0, y: 80 }],
    data: { measure: { kind: 'polylength' } },
  };
  assert.equal(segmentCaptionPlace(poly), 'inline');
  const upright = applyMeasureEdit(poly, { segmentCaptions: 'upright' });
  assert.equal(upright.data.measure.segments, 'upright');
  assert.equal(measureSegmentCaptions(upright, scale)[0].angle, 0, 'Upright reads level on a vertical side');
  assert.equal(measureSegmentCaptions(poly, scale)[0].angle, -90);
  const above = measureSegmentCaptions(applyMeasureEdit(poly, { segmentCaptions: 'above' }), scale)[0];
  assert.ok(Math.abs(above.x - -9 * SEGMENT_CAPTION_ABOVE_LIFT) < 1e-9 && Math.abs(above.y - 40) < 1e-9, 'Above sits beside the side, on the text\'s up side');
  const totalAbove = polylengthTotalPlace(applyMeasureEdit(poly, { segmentCaptions: 'above' }), scale);
  assert.ok(Math.abs(totalAbove.x) < 1e-9 && Math.abs(totalAbove.y - 40) < 1e-9, 'the total measures from the side itself');
  const off = applyMeasureEdit(poly, { segmentCaptions: 'off' });
  assert.deepEqual(measureSegmentCaptions(off, scale), []);
  assert.equal(polylengthTotalPlace(off, scale), null, 'with no segment captions the total stays put');
  assert.equal(applyMeasureEdit(upright, { segmentCaptions: 'inline' }).data.measure.segments, undefined, 'the default is not stored');
  assert.equal(applyMeasureEdit(poly, { segmentCaptions: 'sideways' }), poly);

  const perim = {
    type: 'polygon', left: 0, top: 0,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    data: { measure: { kind: 'perimeter' } },
  };
  assert.equal(segmentCaptionPlace(perim), 'off');
  const shown = applyMeasureEdit(perim, { segmentCaptions: 'inline' });
  assert.equal(shown.data.measure.segments, 'inline');
  assert.deepEqual(measureSegmentCaptions(shown, scale).map((c) => c.text),
    [100, 50, 100, 50].map((v) => formatMeasureLength(v, scale)), 'four sides, the closing one too');
  assert.equal(polylengthTotalPlace(shown, scale), null, 'a Perimeter keeps its total in the middle');
  const area = { ...perim, data: { measure: { kind: 'area' } } };
  assert.equal(applyMeasureEdit(area, { segmentCaptions: 'inline' }), area);
});

test('the Measurement card offers Segment captions only for Polylength / Perimeter under measure-plus', () => {
  const src = read('src/components/MeasureEditPopover.jsx');
  assert.match(src, /const plusOn = isFeatureOn\('measure-plus'\);\s*const segmentPlace = SEGMENT_CAPTION_KINDS\.includes\(kind\) && plusOn \? segmentCaptionPlace\(mark\) : null;/);
  assert.match(src, /data-measure-edit-segments=\{place\}/);
  assert.match(src, /onPatch\?\.\(\{ segmentCaptions: place \}\)/);
});

test('per-mark scale: a measure on its own scale reads in it, keeps it on a page re-scale, and Apply to existing resets it', async () => {
  const { applyMeasureEdit, applyPageScale, buildMeasureLabel, isOwnScaleMeasure, markMeasureScale, pageScaleFromObjects, scaleFromPreset } = await import('../src/utils/measure/measureScale.js');
  const page = scaleFromPreset('1/8');
  const own = scaleFromPreset('1/4');
  const line = { type: 'line', left: 0, top: 0, width: 72, height: 0, x1: -36, y1: 0, x2: 36, y2: 0, data: { measure: { kind: 'length', scale: page } } };
  const mine = applyMeasureEdit(line, { ownScale: own });
  assert.equal(isOwnScaleMeasure(mine), true);
  assert.equal(markMeasureScale(mine, page), mine.data.measure.scale);
  // 72 pt = 1 in: 8 ft on the page scale, 4 ft on its own.
  assert.equal(buildMeasureLabel(line, page).text, formatMeasureLength(72, page));
  assert.equal(buildMeasureLabel(mine, page).text, formatMeasureLength(72, own));
  assert.notEqual(buildMeasureLabel(mine, page).text, buildMeasureLabel(line, page).text);
  // The page's scale comes from marks on the page scale only.
  assert.equal(pageScaleFromObjects([line, mine]).label, page.label);
  assert.equal(pageScaleFromObjects([mine]), null);
  const next = scaleFromPreset('1/16');
  const kept = applyPageScale({ objects: [line, mine] }, next);
  assert.equal(kept.objects[0].data.measure.scale.label, next.label);
  assert.equal(kept.objects[1].data.measure.scale.label, own.label, 'its own scale stays');
  const reset = applyPageScale({ objects: [line, mine] }, next, [], { resetOwn: true });
  assert.equal(reset.objects[1].data.measure.scale.label, next.label);
  assert.equal(reset.objects[1].data.measure.ownScale, undefined);
  // Back to the page scale from the card.
  const back = applyMeasureEdit(mine, { ownScale: null, pageScale: page });
  assert.equal(back.data.measure.ownScale, undefined);
  assert.equal(back.data.measure.scale.label, page.label);
  assert.equal(applyMeasureEdit(line, { ownScale: null, pageScale: page }), line, 'already on the page scale: no change');
});

test('the Measurement card offers a Scale drop-down and the dialog Apply to existing measurements, under measure-plus', () => {
  const card = read('src/components/MeasureEditPopover.jsx');
  assert.match(card, /const ownScale = plusOn && isOwnScaleMeasure\(mark\) \? saved\.scale : null;/);
  assert.match(card, /onPatch\?\.\(\{ ownScale: null, pageScale: scale \}\)/);
  assert.match(card, /\.measure-edit__scale-menu'\)\)/, 'a pick in the portalled list does not close the card');
  const dialog = read('src/components/MeasureScaleDialog.jsx');
  assert.match(dialog, /resetOwn: plusOn && resetOwn/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /applyPageScale\(pageJson, scale, extra, \{ resetOwn: measurePlusOn && resetOwn \}\)/);
});
