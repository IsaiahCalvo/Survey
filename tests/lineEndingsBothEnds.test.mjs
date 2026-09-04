// Arrow-tool rulings (owner, 2026-09-02):
//  (a) the shaft must stop at the boundary of hollow endings (open circle,
//      open triangle) instead of running into their middle; solid endings may
//      butt against; V and bar endings meet the shaft at the tip.
//  (b) "Both ends" toggle mirrors the picked ending onto the start of the
//      arrow; it round-trips as a standard /LE pair; an imported line with two
//      different endings is never flattened into a matched pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as lineHelpers from '../src/utils/lineRenderHelpers.js';
import {
  ARROWHEAD_STYLES,
  buildLineRenderSpec,
  lineEndingBodyInset,
  resolveLineEndingStyles,
} from '../src/utils/lineRenderHelpers.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const arrow = (data, extra = {}) => ({
  type: 'line', tool: 'arrow',
  x1: -50, y1: 0, x2: 50, y2: 0,
  left: 200, top: 300, width: 100, height: 4, // centre (250, 302); tips x=200 / x=300
  stroke: '#ff0000', strokeWidth: 4,
  data: { id: data.id || 'a', ...data },
  ...extra,
});

test('lineEndingBodyInset: hollow endings inset the shaft, solid/V/bar/none do not overshoot', () => {
  const sw = 4; // headSize = 12
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.OPEN_CIRCLE, sw), 12 / 2 + 2);
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.OPEN_TRIANGLE, sw), 12 / 3 + 2);
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.SOLID_TRIANGLE, sw), 12 / 3);
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.V_SHAPE, sw), 0);
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.HORIZONTAL_LINE, sw), 0);
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.NONE, sw), 0);
});

test('buildLineRenderSpec: open-circle ends stop the shaft at the circle edge on both ends', () => {
  const spec = buildLineRenderSpec(arrow({ arrowheadStyle: 'openCircle', startArrowheadStyle: 'openCircle' }));
  assert.equal(spec.kind, 'straight');
  // centre (250, 302); tips at x=200 and x=300; circle r=6 + half stroke 2
  assert.equal(spec.line.x1, 208);
  assert.equal(spec.line.x2, 292);
  assert.equal(spec.arrowhead.kind, 'openCircle');
  assert.equal(spec.startArrowhead.kind, 'openCircle');
  assert.equal(spec.startArrowhead.tipX, 200);
  assert.equal(spec.arrowhead.tipX, 300);
});

test('buildLineRenderSpec: start ending is mirrored (opposite angle) for a diagonal double arrow', () => {
  const obj = arrow({ arrowheadStyle: 'solidTriangle', startArrowheadStyle: 'solidTriangle' }, { x1: -30, y1: -40, x2: 30, y2: 40, width: 60, height: 80 });
  const spec = buildLineRenderSpec(obj);
  const angleEnd = spec.arrowhead.angleDeg ?? spec.arrowhead.angle;
  const angleStart = spec.startArrowhead.angleDeg ?? spec.startArrowhead.angle;
  assert.ok(Math.abs((((angleStart - angleEnd) % 360) + 360) % 360 - 180) < 1e-6, `start ${angleStart} vs end ${angleEnd}`);
});

test('resolveLineEndingStyles: imported mismatched endings survive; app arrow defaults', () => {
  assert.deepEqual(resolveLineEndingStyles({ type: 'line', isPdfImported: true, data: { pdfLineEndings: ['Circle', 'Butt'] } }),
    { startStyle: 'openCircle', endStyle: 'horizontalLine' });
  assert.deepEqual(resolveLineEndingStyles(arrow({ arrowheadStyle: 'openTriangle' })),
    { startStyle: 'none', endStyle: 'openTriangle' });
  assert.deepEqual(resolveLineEndingStyles({ type: 'line', data: { id: 'p' } }),
    { startStyle: 'none', endStyle: 'none' });
});

// The exporter reads x1..y2 as page coordinates (no centre box), like the
// print-fidelity fixture does; the spec tests above cover the centre-relative
// on-screen form.
const forExport = (obj) => ({ ...obj, left: undefined, top: undefined, width: undefined, height: undefined, x1: 200, y1: 300, x2: 300, y2: 300 });

test('diamond and slash endings are their own shapes (never a V), sized like the other endings', () => {
  const { pdfLineEndingToArrowheadStyle } = lineHelpers;
  assert.equal(pdfLineEndingToArrowheadStyle('Diamond'), ARROWHEAD_STYLES.DIAMOND);
  assert.equal(pdfLineEndingToArrowheadStyle('Slash'), ARROWHEAD_STYLES.SLASH);
  const sw = 4; // headSize 12
  const diamond = lineHelpers.buildArrowheadRenderSpec(ARROWHEAD_STYLES.DIAMOND, 100, 50, 0, '#000', sw);
  assert.equal(diamond.kind, 'diamond');
  assert.equal(diamond.polygon.fill, 'none');
  assert.equal(diamond.polygon.points, '6,0 0,6 -6,0 0,-6'); // rhombus centred on the tip, along the line
  const slash = lineHelpers.buildArrowheadRenderSpec(ARROWHEAD_STYLES.SLASH, 100, 50, 0, '#000', sw);
  assert.equal(slash.kind, 'slash');
  // 12 long, crossing the tip, 30° clockwise from the perpendicular
  const len = Math.hypot(slash.line.x2 - slash.line.x1, slash.line.y2 - slash.line.y1);
  assert.ok(Math.abs(len - 12) < 1e-9);
  assert.ok(Math.abs((slash.line.x1 + slash.line.x2) / 2 - 100) < 1e-9);
  assert.ok(Math.abs((slash.line.y1 + slash.line.y2) / 2 - 50) < 1e-9);
  const ang = Math.abs(Math.atan2(slash.line.y2 - slash.line.y1, slash.line.x2 - slash.line.x1) * 180 / Math.PI) % 180;
  assert.ok(Math.abs(ang - 120) < 1e-6 || Math.abs(ang - 60) < 1e-6, `slash angle ${ang}`);
  // the diamond has an interior: the shaft stops at its near vertex; the slash crosses the tip
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.DIAMOND, sw), 6 + 2);
  assert.equal(lineEndingBodyInset(ARROWHEAD_STYLES.SLASH, sw), 0);
  const spec = buildLineRenderSpec(arrow({ arrowheadStyle: 'diamond', startArrowheadStyle: 'slash' }));
  assert.equal(spec.line.x1, 200); // slash end: no inset
  assert.equal(spec.line.x2, 292); // diamond end: 300 - 8
  assert.equal(spec.arrowhead.kind, 'diamond');
  assert.equal(spec.startArrowhead.kind, 'slash');
});

async function exportLE(objects) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const base = await doc.save();
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const bytes = await savePDFWithAnnotationsPdfLib(
      new File([base], 'src.pdf', { type: 'application/pdf' }),
      { 1: { objects: objects.map(forExport) } },
      { 1: { width: 612, height: 792 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-le' },
    );
    const out = await PDFDocument.load(bytes);
    const annots = out.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map((r) => out.context.lookup(r));
    return annots
      .filter((a) => a.get(PDFName.of('Subtype'))?.toString() === '/Line')
      .map((a) => {
        const le = a.lookup(PDFName.of('LE'));
        return le ? le.asArray().map((n) => n.toString()) : null;
      });
  } finally {
    globalThis.window = originalWindow;
  }
}

test('export: both-ends arrow writes /LE on both ends; single arrow only at the end; imported mismatch kept; plain line none', async () => {
  const les = await exportLE([
    arrow({ id: 'both', arrowheadStyle: 'openCircle', startArrowheadStyle: 'openCircle' }),
    arrow({ id: 'single', arrowheadStyle: 'solidTriangle' }),
    // An edited imported line (moved by the user) re-exports; its two
    // different endings must survive untouched.
    arrow({ id: 'imported', pdfLineEndings: ['Circle', 'Butt'], pdfImportedEditState: 'edited' }, { tool: undefined, isPdfImported: true, pdfAnnotationId: 'native-1' }),
    arrow({ id: 'plain' }, { tool: 'line' }),
    arrow({ id: 'diamond-slash', arrowheadStyle: 'diamond', startArrowheadStyle: 'slash' }),
    arrow({ id: 'v', arrowheadStyle: 'vShape' }),
  ]);
  assert.deepEqual(les, [
    ['/Circle', '/Circle'],
    ['/None', '/ClosedArrow'],
    ['/Circle', '/Butt'],
    null,
    ['/Slash', '/Diamond'],
    ['/None', '/OpenArrow'], // the V is the spec's OpenArrow, never a Slash
  ]);
});
