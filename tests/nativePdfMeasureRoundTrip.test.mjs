// Native PDF measurements (Linear KAL-539). Drawboard, Bluebeam and Acrobat
// save a measurement as a Line / PolyLine / Polygon with an /IT ...Dimension
// intent and a /Measure scale. Survey imported them as plain shapes (the
// Drawboard study's six measurement objects lost scale, units and value),
// and exported its own measurements without those entries, so the other
// apps saw plain lines. Both directions are covered here.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { buildMeasureLabel } from '../src/utils/measure/measureScale.js';
import { surveyScaleFromPdfMeasure, surveyUnitFromPdfLabel } from '../src/utils/measure/pdfMeasureDict.js';

const PAGE = { width: 400, height: 300 };

test('unit labels from other apps map to Survey units', () => {
  assert.equal(surveyUnitFromPdfLabel('ft'), 'ft');
  assert.equal(surveyUnitFromPdfLabel('Feet'), 'ft');
  assert.equal(surveyUnitFromPdfLabel("'"), 'ft');
  assert.equal(surveyUnitFromPdfLabel('in'), 'in');
  assert.equal(surveyUnitFromPdfLabel('m'), 'm');
  assert.equal(surveyUnitFromPdfLabel('mm'), 'mm');
  assert.equal(surveyUnitFromPdfLabel('furlong'), null);
});

test('a /Measure scale becomes points per unit', () => {
  // 1 in = 10 ft: one point is 10/72 ft, so 7.2 points per foot.
  const scale = surveyScaleFromPdfMeasure({ Subtype: 'RL', R: '1 in = 10 ft', X: [{ U: 'ft', C: 10 / 72 }, { U: 'in', C: 12 }], D: [{ U: 'ft', C: 1 }] });
  assert.equal(scale.unit, 'ft');
  assert.ok(Math.abs(scale.ptPerUnit - 7.2) < 1e-9);
  assert.equal(scale.label, '1 in = 10 ft');
  // Distance alone (no /X) is read from points directly.
  assert.ok(Math.abs(surveyScaleFromPdfMeasure({ D: [{ U: 'm', C: 0.01 }] }).ptPerUnit - 100) < 1e-9);
  // An unknown first unit falls through to the next one it splits into.
  const chained = surveyScaleFromPdfMeasure({ X: [{ U: 'ft-in', C: 1 / 72 }, { U: 'in', C: 12 }] });
  assert.equal(chained.unit, 'in');
  assert.ok(Math.abs(chained.ptPerUnit - 6) < 1e-9);
  // Map (GEO) measures and broken factors are refused.
  assert.equal(surveyScaleFromPdfMeasure({ Subtype: 'GEO', X: [{ U: 'm', C: 1 }] }), null);
  assert.equal(surveyScaleFromPdfMeasure({ X: [{ U: 'ft', C: 0 }] }), null);
  assert.equal(surveyScaleFromPdfMeasure({ X: [{ U: 'furlong', C: 1 }] }), null);
});

const cloneBytesForPdfjs = (bytes) => (bytes instanceof Uint8Array ? bytes.slice() : Uint8Array.from(bytes));

async function reimport(bytes) {
  const loadingTask = pdfjsLib.getDocument({ data: cloneBytesForPdfjs(bytes), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdfDoc = await loadingTask.promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
    return imported.annotationsByPage[1]?.objects || [];
  } finally {
    await loadingTask.destroy();
  }
}

const text = (value) => PDFString.of(value);
const measureDict = (context, { unit = 'ft', perPoint = 10 / 72, ratio = '1 in = 10 ft' } = {}) => context.obj({
  Type: 'Measure', Subtype: 'RL', R: text(ratio),
  X: [context.obj({ Type: 'NumberFormat', U: text(unit), C: perPoint, D: 100 })],
  D: [context.obj({ Type: 'NumberFormat', U: text(unit), C: 1, D: 100 })],
  A: [context.obj({ Type: 'NumberFormat', U: text(`sq ${unit}`), C: 1, D: 100 })],
});

// What another app writes: no Survey metadata at all.
async function otherAppPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const { context } = doc;
  const annot = (dict) => context.register(context.obj({ Type: 'Annot', C: [1, 0, 0], Border: [0, 0, 2], P: page.ref, ...dict }));
  const refs = [
    // 100 pt long line, 1 in = 10 ft -> 13.89 ft.
    annot({ Subtype: 'Line', NM: text('dim-line'), Rect: [50, 200, 150, 202], L: [50, 201, 150, 201], IT: 'LineDimension', LE: ['OpenArrow', 'OpenArrow'], Measure: measureDict(context), Contents: text("13' 11\"") }),
    // 72 x 72 pt square area -> 10 ft x 10 ft = 100 sq ft.
    annot({ Subtype: 'Polygon', NM: text('dim-area'), Rect: [200, 100, 272, 172], Vertices: [200, 100, 272, 100, 272, 172, 200, 172], IT: 'PolygonDimension', Measure: measureDict(context), Contents: text('100 sq ft') }),
    // Open run of two 72 pt segments -> 20 ft.
    annot({ Subtype: 'PolyLine', NM: text('dim-run'), Rect: [50, 50, 122, 122], Vertices: [50, 50, 122, 50, 122, 122], IT: 'PolyLineDimension', Measure: measureDict(context) }),
    // A dimension line whose scale lives in the page viewport (metres).
    annot({ Subtype: 'Line', NM: text('viewport-line'), Rect: [300, 250, 350, 252], L: [300, 251, 350, 251], IT: 'LineDimension' }),
    // Ordinary marks stay ordinary.
    annot({ Subtype: 'Line', NM: text('plain-line'), Rect: [50, 20, 150, 22], L: [50, 21, 150, 21] }),
    annot({ Subtype: 'Polygon', NM: text('plain-poly'), Rect: [300, 20, 380, 80], Vertices: [300, 20, 380, 20, 340, 80] }),
  ];
  page.node.set(PDFName.of('Annots'), context.obj(refs));
  page.node.set(PDFName.of('VP'), context.obj([context.obj({ Type: 'Viewport', BBox: [290, 240, 400, 300], Measure: measureDict(context, { unit: 'm', perPoint: 0.1, ratio: '1 pt = 0.1 m' }) })]));
  return doc.save();
}

const byPdfName = (objects) => {
  const out = {};
  for (const obj of objects) {
    const key = obj.pdfAnnotationName || obj.data?.pdfAnnotationName || obj.pdfNativeName || obj.pdfAnnotationId;
    out[key] = obj;
  }
  return out;
};

test('another app\'s measurements import as Survey measurements with their scale', async () => {
  const objects = await reimport(await otherAppPdf());
  const lines = objects.filter((o) => o.type === 'line');
  const polygons = objects.filter((o) => o.type === 'polygon');
  const polylines = objects.filter((o) => o.type === 'polyline');
  assert.equal(lines.length, 3);
  assert.equal(polygons.length, 2);
  assert.equal(polylines.length, 1);

  const dimLine = lines.find((o) => o.data?.measure && o.data.measure.scale.unit === 'ft');
  assert.ok(dimLine, 'the dimension line is a measurement');
  assert.equal(dimLine.data.measure.kind, 'length');
  assert.ok(Math.abs(dimLine.data.measure.scale.ptPerUnit - 7.2) < 1e-6);
  assert.notEqual(dimLine.tool, 'arrow', 'a dimension line is not turned into the Arrow tool');
  assert.equal(buildMeasureLabel(dimLine, dimLine.data.measure.scale).reading || buildMeasureLabel(dimLine, dimLine.data.measure.scale).text, "13' 11\"");

  const area = polygons.find((o) => o.data?.measure);
  assert.equal(area.data.measure.kind, 'area');
  assert.match(String(buildMeasureLabel(area, area.data.measure.scale).text), /100(\.00)? sq ft/);

  assert.equal(polylines[0].data.measure.kind, 'polylength');
  assert.ok(Math.abs(polylines[0].data.measure.scale.ptPerUnit - 7.2) < 1e-6);

  const viewportLine = lines.find((o) => o.data?.measure?.scale?.unit === 'm');
  assert.ok(viewportLine, 'a dimension line takes the scale of the page viewport around it');
  assert.ok(Math.abs(viewportLine.data.measure.scale.ptPerUnit - 10) < 1e-6);

  assert.equal(lines.filter((o) => !o.data?.measure).length, 1, 'the plain line stays plain');
  assert.equal(polygons.filter((o) => !o.data?.measure).length, 1, 'the plain polygon stays plain');
});

const makePdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return { name: 'measure-source.pdf', async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
};

const SCALE = { ptPerUnit: 7.2, unit: 'ft', label: '1" = 10\'' };
const SURVEY_MARKS = [
  { id: 'm-len', type: 'line', x1: 50, y1: 100, x2: 150, y2: 100, stroke: '#ff0000', strokeWidth: 2, data: { measure: { kind: 'length', scale: SCALE } } },
  { id: 'm-area', type: 'polygon', left: 200, top: 100, points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }], stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', data: { measure: { kind: 'area', scale: SCALE } } },
  { id: 'm-run', type: 'polyline', left: 50, top: 150, points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }], stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', data: { measure: { kind: 'polylength', scale: SCALE } } },
  { id: 'm-perim', type: 'polygon', left: 300, top: 150, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }], stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', data: { measure: { kind: 'perimeter', scale: SCALE } } },
  { id: 'plain', type: 'line', x1: 50, y1: 250, x2: 150, y2: 250, stroke: '#0000ff', strokeWidth: 2 },
];

async function exportSurveyMarks() {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    return await savePDFWithAnnotationsPdfLib(await makePdfFile(), { 1: { objects: SURVEY_MARKS } }, { 1: PAGE }, null, { returnBytes: true, actionType: 'pdf-export', documentId: 'native-measure' });
  } finally {
    globalThis.window = originalWindow;
  }
}

test('Survey measurements export the native intent and /Measure scale', async () => {
  const doc = await PDFDocument.load(await exportSurveyMarks());
  const dicts = doc.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map((ref) => doc.context.lookup(ref));
  const pick = (subtype, withIntent) => dicts.filter((d) => d.get(PDFName.of('Subtype')).toString() === `/${subtype}` && (withIntent ? d.has(PDFName.of('IT')) : !d.has(PDFName.of('IT'))));
  const [line] = pick('Line', true);
  assert.equal(line.get(PDFName.of('IT')).toString(), '/LineDimension');
  const measure = line.lookup(PDFName.of('Measure'));
  assert.equal(measure.get(PDFName.of('Subtype')).toString(), '/RL');
  const x0 = measure.lookup(PDFName.of('X')).lookup(0);
  assert.ok(Math.abs(x0.lookup(PDFName.of('C')).asNumber() - 1 / 7.2) < 1e-9);
  assert.equal(x0.lookup(PDFName.of('U')).decodeText(), 'ft');
  assert.equal(pick('Polygon', true)[0].get(PDFName.of('IT')).toString(), '/PolygonDimension');
  assert.equal(pick('PolyLine', true)[0].get(PDFName.of('IT')).toString(), '/PolyLineDimension');
  assert.equal(pick('Polygon', false).length, 1, 'a perimeter has no native match and writes no intent');
  assert.equal(pick('Line', false).length, 1, 'a plain line writes no intent');
});

test('the native entries alone bring a Survey measurement back (as another app re-saving it would)', async () => {
  const doc = await PDFDocument.load(await exportSurveyMarks());
  // Drop Survey's own hidden copies, leaving only what any PDF app keeps.
  for (const ref of doc.getPage(0).node.lookup(PDFName.of('Annots')).asArray()) {
    const dict = doc.context.lookup(ref);
    for (const key of [...dict.keys()]) if (key.toString().startsWith('/SurveyApp')) dict.delete(key);
  }
  doc.catalog.delete(PDFName.of('SurveyAppLayerState'));
  const objects = await reimport(await doc.save());
  const measured = objects.filter((o) => o.data?.measure).map((o) => [o.type, o.data.measure.kind, o.data.measure.scale.unit, Math.round(o.data.measure.scale.ptPerUnit * 1000) / 1000]);
  assert.deepEqual(measured.sort(), [['line', 'length', 'ft', 7.2], ['polygon', 'area', 'ft', 7.2], ['polyline', 'polylength', 'ft', 7.2]].sort());
});
