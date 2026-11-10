// Measurement popover data (Nightly flag 'measure-edit', Drawboard PDF Pro
// trial audit 2026-11-10): a measurement's label, caption lines, caption size
// and depth live on data.measure, and buildMeasureLabel honours them. A mark
// with none of them reads exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineCommitJSON, buildPolyShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';
import {
  MEASURE_LABEL_FONT_PX,
  applyMeasureEdit,
  buildMeasureLabel,
  layoutMeasureLabel,
  measureCaptionFields,
  measureShownFields,
  normalizeMeasureCaptionSize,
  normalizeMeasureLabelText,
  scaleFromPreset,
  stampMeasure,
} from '../src/utils/measure/measureScale.js';
import { planSelectionQuickBar } from '../src/utils/selectionQuickBar.js';

const QUARTER = scaleFromPreset('1/4');
const ROOM = [{ x: 100, y: 300 }, { x: 280, y: 300 }, { x: 280, y: 390 }, { x: 100, y: 390 }];

const length = () => stampMeasure(buildLineCommitJSON({ tool: 'line', id: 'len', start: { x: 100, y: 100 }, end: { x: 460, y: 100 }, strokeColor: '#000', strokeOpacity: 100, strokeWidth: 2 }), 'length', QUARTER);
const poly = (kind, opts) => stampMeasure(buildPolyShapeCommitJSON({ tool: 'polygon', id: kind, points: ROOM, strokeColor: '#000', strokeOpacity: 100, fillColor: '#000', fillOpacity: 0, strokeWidth: 2 }), kind, QUARTER, opts);
const withMeasure = (obj, extra) => ({ ...obj, data: { ...obj.data, measure: { ...obj.data.measure, ...extra } } });

test('unset: every kind reads exactly as before (no new keys on the label)', () => {
  const len = buildMeasureLabel(length(), QUARTER);
  assert.deepEqual(Object.keys(len).sort(), ['angle', 'kind', 'text', 'value', 'x', 'y']);
  assert.equal(len.text, '20\' 0"');
  assert.equal(buildMeasureLabel(poly('area'), QUARTER).text, '50.00 sq ft');
  assert.equal(buildMeasureLabel(poly('perimeter'), QUARTER).text, '30\' 0"');
  assert.equal(buildMeasureLabel(poly('volume', { depth: 8 }), QUARTER).text, '400.00 cu ft');
  for (const kind of ['area', 'perimeter', 'wallArea', 'volume']) {
    assert.equal(buildMeasureLabel(poly(kind, { depth: 8 }), QUARTER).lines, undefined, kind);
  }
  // The pill is laid out exactly as before too.
  const box = layoutMeasureLabel(len, 1);
  assert.equal(box.fontSize, MEASURE_LABEL_FONT_PX);
  assert.equal(box.height, MEASURE_LABEL_FONT_PX + 6);
  assert.equal(box.radius, box.height / 2);
});

test('a label is the first caption line, above the reading', () => {
  const label = buildMeasureLabel(withMeasure(length(), { label: '  Wall   A ' }), QUARTER);
  assert.deepEqual(label.lines, ['Wall A', '20\' 0"']);
  assert.equal(label.text, 'Wall A\n20\' 0"');
  assert.equal(label.reading, '20\' 0"');
  assert.equal(label.value, buildMeasureLabel(length(), QUARTER).value);
  const box = layoutMeasureLabel(label, 1);
  assert.ok(box.height > MEASURE_LABEL_FONT_PX + 6, 'two lines are taller');
  assert.deepEqual(box.lines, label.lines);
});

test('fields: the reading can be switched off; several readings are named', () => {
  const off = buildMeasureLabel(withMeasure(length(), { label: 'Wall A', fields: ['label'] }), QUARTER);
  assert.deepEqual(off.lines, ['Wall A']);
  assert.equal(off.reading, '20\' 0"');
  const none = buildMeasureLabel(withMeasure(length(), { fields: [] }), QUARTER);
  assert.deepEqual(none.lines, []);
  assert.equal(none.text, '');
  assert.equal(layoutMeasureLabel(none, 1), null, 'nothing to draw');
  const area = buildMeasureLabel(withMeasure(poly('area'), { fields: ['area', 'perimeter'] }), QUARTER);
  assert.deepEqual(area.lines, ['Area: 50.00 sq ft', 'Perimeter: 30\' 0"']);
  // Only the readings that make sense for the kind; order is the kind's own.
  const len = buildMeasureLabel(withMeasure(length(), { fields: ['area', 'length', 'volume'] }), QUARTER);
  assert.deepEqual(len.lines, ['20\' 0"']);
  assert.deepEqual(measureCaptionFields('length'), ['label', 'length']);
  assert.deepEqual(measureCaptionFields('volume'), ['label', 'volume', 'area', 'perimeter', 'depth']);
  assert.deepEqual(measureCaptionFields('wallArea'), ['label', 'wallArea', 'perimeter', 'depth']);
});

test('depth: a volume reads area x depth, and can show its depth', () => {
  const vol = withMeasure(poly('volume', { depth: 8 }), { fields: ['volume', 'depth'] });
  assert.deepEqual(buildMeasureLabel(vol, QUARTER).lines, ['Volume: 400.00 cu ft', 'Depth: 8\' 0"']);
  const deeper = applyMeasureEdit(vol, { depth: 10 });
  assert.equal(deeper.data.measure.depth, 10);
  assert.deepEqual(buildMeasureLabel(deeper, QUARTER).lines, ['Volume: 500.00 cu ft', 'Depth: 10\' 0"']);
  // A length has no depth.
  const len = length();
  assert.equal(applyMeasureEdit(len, { depth: 4 }), len);
  // A bad depth keeps the old one.
  assert.equal(applyMeasureEdit(vol, { depth: -2 }), vol);
});

test('size: a caption reads at its own size (8-24 px)', () => {
  const big = buildMeasureLabel(withMeasure(length(), { captionSize: 16 }), QUARTER);
  assert.equal(big.text, '20\' 0"');
  assert.deepEqual(big.lines, ['20\' 0"']);
  assert.equal(big.fontPx, 16);
  const box = layoutMeasureLabel(big, 2);
  assert.equal(box.fontSize, 32);
  assert.equal(normalizeMeasureCaptionSize(3), 8);
  assert.equal(normalizeMeasureCaptionSize(99), 24);
  assert.equal(normalizeMeasureCaptionSize('large'), 16);
  assert.equal(normalizeMeasureCaptionSize(''), null);
  assert.equal(normalizeMeasureCaptionSize('x'), null);
});

test('applyMeasureEdit: one change at a time, nothing else touched', () => {
  const mark = length();
  assert.equal(applyMeasureEdit(mark, {}), mark, 'no change returns the same object');
  assert.equal(applyMeasureEdit(mark, { label: '   ' }), mark, 'a blank label is no label');
  const labelled = applyMeasureEdit(mark, { label: 'Wall A' });
  assert.equal(labelled.data.measure.label, 'Wall A');
  assert.deepEqual(labelled.data.measure.scale, mark.data.measure.scale);
  assert.equal(labelled.strokeWidth, mark.strokeWidth);
  // Unticking the reading.
  const bare = applyMeasureEdit(labelled, { fields: ['label'] });
  assert.deepEqual(bare.data.measure.fields, ['label']);
  assert.deepEqual(measureShownFields(bare), ['label']);
  // Clearing the label removes the key; medium size is the default (no key).
  const cleared = applyMeasureEdit(applyMeasureEdit(labelled, { label: '' }), { captionSize: 12 });
  assert.equal('label' in cleared.data.measure, false);
  assert.equal('captionSize' in cleared.data.measure, false);
  // A label typed on hand-picked lines ticks Label so it shows.
  const picked = applyMeasureEdit(mark, { fields: ['length'] });
  assert.deepEqual(applyMeasureEdit(picked, { label: 'Run 1' }).data.measure.fields, ['label', 'length']);
  assert.equal(normalizeMeasureLabelText('x'.repeat(200)).length, 80);
});

test('quick bar: Measurement only for exactly one picked measurement with the write published', () => {
  const api = { selectedMeasure: { id: 'len', mark: length(), scale: QUARTER }, patchSelectedMeasure: () => {} };
  const one = [{ id: 'len', typeKey: 'line' }];
  assert.equal(planSelectionQuickBar({ items: one, api }).measure, true);
  assert.equal(planSelectionQuickBar({ items: one, api, locked: true }).measure, undefined);
  assert.equal(planSelectionQuickBar({ items: [...one, { id: 'b', typeKey: 'rect' }], api }).measure, undefined);
  assert.equal(planSelectionQuickBar({ items: [{ id: 'other', typeKey: 'line' }], api }).measure, undefined);
  // Flag off: PDFViewer publishes neither, and the plan is exactly today's.
  assert.equal('measure' in planSelectionQuickBar({ items: one, api: {} }), false);
});

test('markups list and PDF export carry the caption', async () => {
  const { buildMarkupRows } = await import('../src/utils/markupList.js');
  const { PDFArray, PDFDocument, PDFName } = await import('pdf-lib');
  const { savePDFWithAnnotationsPdfLib } = await import('../src/utils/pdfAnnotationsPdfLib.js');
  const captioned = withMeasure(length(), { label: 'Wall A' });
  const hidden = withMeasure(poly('area'), { fields: [] });
  const rows = buildMarkupRows({ 1: { objects: [captioned, hidden, length()] } });
  assert.deepEqual(rows.map((row) => row.text), ['Wall A · 20\' 0"', '50.00 sq ft', '20\' 0"']);

  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const bytes = await source.save();
  const file = { name: 'blank.pdf', async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  const out = await savePDFWithAnnotationsPdfLib(file, { 1: { objects: [captioned, hidden] } }, { 1: { width: 612, height: 792 } }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'measure-edit' });
  const doc = await PDFDocument.load(out);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  const contents = {};
  for (let i = 0; i < annots.size(); i += 1) {
    const dict = annots.lookup(i);
    contents[dict.get(PDFName.of('Subtype')).toString()] = dict.get(PDFName.of('Contents')).decodeText();
  }
  assert.equal(contents['/Line'], 'Wall A\n20\' 0"');
  // Every line switched off on the page: the file still keeps the reading.
  assert.equal(contents['/Polygon'], '50.00 sq ft');
});
