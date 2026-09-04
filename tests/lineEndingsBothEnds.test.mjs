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
    { startStyle: 'openCircle', endStyle: 'horizontalLine', interiorColor: null });
  assert.deepEqual(resolveLineEndingStyles(arrow({ arrowheadStyle: 'openTriangle' })),
    { startStyle: 'none', endStyle: 'openTriangle', interiorColor: null });
  assert.deepEqual(resolveLineEndingStyles({ type: 'line', data: { id: 'p' } }),
    { startStyle: 'none', endStyle: 'none', interiorColor: null });
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

// The full arrow matrix (owner 2026-09-04: enumerate, never sample): every
// ending × straight / bent × one end / both ends. For every cell the shaft
// must end exactly `inset` before the tip along the tangent arriving there,
// and each head must sit on the tangent of its own end.
const MATRIX_STYLES = Object.values(ARROWHEAD_STYLES);
const parseQuad = (d) => {
  const m = /^M ([-\d.e]+),([-\d.e]+) Q ([-\d.e]+),([-\d.e]+) ([-\d.e]+),([-\d.e]+)$/.exec(d);
  assert.ok(m, `quadratic path expected, got ${d}`);
  const n = m.slice(1).map(Number);
  return { p0: { x: n[0], y: n[1] }, c: { x: n[2], y: n[3] }, p2: { x: n[4], y: n[5] } };
};
for (const style of MATRIX_STYLES) {
  for (const bent of [false, true]) {
    for (const both of [false, true]) {
      test(`matrix: ${style} · ${bent ? 'bent' : 'straight'} · ${both ? 'both ends' : 'end only'}`, () => {
        const sw = 3;
        const inset = lineEndingBodyInset(style, sw);
        const obj = arrow({ arrowheadStyle: style, ...(both ? { startArrowheadStyle: style } : {}),
          ...(bent ? { midpoint: { x: 260, y: 340 } } : {}) },
          { x1: -60, y1: 30, x2: 60, y2: -30, left: 190, top: 270, width: 120, height: 60, strokeWidth: sw });
        const spec = buildLineRenderSpec(obj);
        const tipStart = { x: 190, y: 330 }; const tipEnd = { x: 310, y: 270 };
        const startInset = both ? inset : 0;
        assert.equal(spec.arrowhead.kind === 'none', style === 'none');
        assert.equal(spec.startArrowhead.kind === 'none', !both || style === 'none');
        if (!bent) {
          assert.equal(spec.kind, 'straight');
          const ang = Math.atan2(tipEnd.y - tipStart.y, tipEnd.x - tipStart.x);
          assert.ok(Math.abs(Math.hypot(spec.line.x2 - tipEnd.x, spec.line.y2 - tipEnd.y) - inset) < 1e-9, 'end inset');
          assert.ok(Math.abs(Math.hypot(spec.line.x1 - tipStart.x, spec.line.y1 - tipStart.y) - startInset) < 1e-9, 'start inset');
          if (style !== 'none') assert.ok(Math.abs(spec.arrowhead.angleDeg - ang * 180 / Math.PI) < 1e-9);
          if (both && style !== 'none') assert.ok(Math.abs(((spec.startArrowhead.angleDeg - spec.arrowhead.angleDeg) % 360 + 360) % 360 - 180) < 1e-9);
        } else {
          assert.equal(spec.kind, 'curved');
          const { p0, c, p2 } = parseQuad(spec.path.d);
          // body ends are `inset` away from the tips, measured along the curve
          // (chord distance is within 2% of arc distance for these insets)
          const dEnd = Math.hypot(p2.x - tipEnd.x, p2.y - tipEnd.y);
          const dStart = Math.hypot(p0.x - tipStart.x, p0.y - tipStart.y);
          assert.ok(Math.abs(dEnd - inset) <= Math.max(0.02 * inset, 1e-6), `end inset ${dEnd} vs ${inset}`);
          assert.ok(Math.abs(dStart - startInset) <= Math.max(0.02 * startInset, 1e-6), `start inset ${dStart} vs ${startInset}`);
          // the body's own end tangent points at the tip (so the shaft never cuts into the head)
          if (inset > 0) {
            const tangent = Math.atan2(p2.y - c.y, p2.x - c.x);
            const toTip = Math.atan2(tipEnd.y - p2.y, tipEnd.x - p2.x);
            assert.ok(Math.abs(((tangent - toTip) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.15, 'end tangent aims at tip');
          }
          // heads use their own end's tangent: start head must NOT equal end head + 180 on a bent arrow
          if (both && style !== 'none') {
            const control = { x: 2 * 260 - 0.5 * tipStart.x - 0.5 * tipEnd.x, y: 2 * 340 - 0.5 * tipStart.y - 0.5 * tipEnd.y };
            const expectedStart = Math.atan2(tipStart.y - control.y, tipStart.x - control.x) * 180 / Math.PI;
            const expectedEnd = Math.atan2(tipEnd.y - control.y, tipEnd.x - control.x) * 180 / Math.PI;
            assert.ok(Math.abs(spec.startArrowhead.angleDeg - expectedStart) < 1e-9, 'start head on start tangent');
            assert.ok(Math.abs(spec.arrowhead.angleDeg - expectedEnd) < 1e-9, 'end head on end tangent');
            assert.ok(Math.abs(((spec.startArrowhead.angleDeg - spec.arrowhead.angleDeg) % 360 + 360) % 360 - 180) > 1, 'bent: the two tangents differ');
          }
        }
      });
    }
  }
}

test('polyline body stops at hollow endings on its first and last segment', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const out = lineHelpers.insetOpenPolylinePoints(pts, 8, 5);
  assert.deepEqual(out, [{ x: 8, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 95 }]);
  // never past the segment's other end
  assert.deepEqual(lineHelpers.insetOpenPolylinePoints([{ x: 0, y: 0 }, { x: 3, y: 0 }], 10, 0), [{ x: 3, y: 0 }, { x: 3, y: 0 }]);
});

test('Circle / Diamond / Square endings fill with the interior colour and stay hollow without one; Square is a square, not a bar', () => {
  const { pdfLineEndingToArrowheadStyle, buildArrowheadRenderSpec } = lineHelpers;
  assert.equal(pdfLineEndingToArrowheadStyle('Square'), 'square');
  assert.equal(pdfLineEndingToArrowheadStyle('Butt'), 'horizontalLine');
  const sq = buildArrowheadRenderSpec('square', 100, 50, 0, '#000', 4);
  assert.equal(sq.kind, 'square');
  assert.equal(sq.polygon.points, '-6,-6 6,-6 6,6 -6,6');
  assert.equal(sq.polygon.fill, 'none');
  assert.equal(lineEndingBodyInset('square', 4), 8);
  for (const style of ['openCircle', 'diamond', 'square']) {
    const filled = buildArrowheadRenderSpec(style, 100, 50, 0, '#000', 4, { fill: '#fabf33' });
    const hollow = buildArrowheadRenderSpec(style, 100, 50, 0, '#000', 4);
    const shape = (spec) => spec.circle || spec.polygon;
    assert.equal(shape(filled).fill, '#fabf33', `${style} filled`);
    assert.equal(shape(hollow).fill, 'none', `${style} hollow`);
  }
  // triangles / V / bar / slash ignore the interior colour (solid keeps the stroke colour)
  assert.equal(buildArrowheadRenderSpec('solidTriangle', 0, 0, 0, '#000', 4, { fill: '#fabf33' }).polygon.fill, '#000');
  assert.equal(buildArrowheadRenderSpec('openTriangle', 0, 0, 0, '#000', 4, { fill: '#fabf33' }).polygon.fill, 'none');
  // whole-line resolution: imported with /IC → filled; without → hollow; app-drawn → hollow
  const imported = { type: 'line', isPdfImported: true, x1: 0, y1: 0, x2: 100, y2: 0, strokeWidth: 4, data: { pdfLineEndings: ['Diamond', 'Circle'], pdfInteriorColor: '#fabf33' } };
  const filledSpec = buildLineRenderSpec(imported);
  assert.equal(filledSpec.startArrowhead.polygon.fill, '#fabf33');
  assert.equal(filledSpec.arrowhead.circle.fill, '#fabf33');
  const hollowSpec = buildLineRenderSpec({ ...imported, data: { pdfLineEndings: ['Square', 'Diamond'] } });
  assert.equal(hollowSpec.startArrowhead.kind, 'square');
  assert.equal(hollowSpec.startArrowhead.polygon.fill, 'none');
  assert.equal(hollowSpec.arrowhead.polygon.fill, 'none');
  assert.equal(buildLineRenderSpec(arrow({ arrowheadStyle: 'diamond' })).arrowhead.polygon.fill, 'none');
});

test('imported OpenArrow is the V; ClosedArrow is filled only with an interior colour', () => {
  const { pdfLineEndingToArrowheadStyle } = lineHelpers;
  assert.equal(pdfLineEndingToArrowheadStyle('OpenArrow'), 'vShape');
  assert.equal(pdfLineEndingToArrowheadStyle('ClosedArrow'), 'solidTriangle');
  assert.equal(pdfLineEndingToArrowheadStyle('ClosedArrow', { hasInteriorColor: false }), 'openTriangle');
  const imported = { type: 'line', isPdfImported: true, data: { pdfLineEndings: ['ClosedArrow', 'OpenArrow'] } };
  assert.deepEqual(resolveLineEndingStyles(imported), { startStyle: 'openTriangle', endStyle: 'vShape', interiorColor: null });
  assert.deepEqual(resolveLineEndingStyles({ ...imported, data: { ...imported.data, pdfInteriorColor: '#ff0000' } }),
    { startStyle: 'solidTriangle', endStyle: 'vShape', interiorColor: '#ff0000' });
  // app-drawn: no /IC ever, the classic filled head stays filled
  assert.deepEqual(resolveLineEndingStyles({ type: 'line', tool: 'arrow', lineEnding2: 'ClosedArrow', data: {} }).endStyle, 'solidTriangle');
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
        return le ? { le: le.asArray().map((n) => n.toString()), hasIC: Boolean(a.get(PDFName.of('IC'))) } : null;
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
    arrow({ id: 'hollow', arrowheadStyle: 'openTriangle' }),
    arrow({ id: 'filled-imported', pdfLineEndings: ['Diamond', 'Circle'], pdfInteriorColor: '#fabf33', pdfImportedEditState: 'edited' }, { tool: undefined, isPdfImported: true, pdfAnnotationId: 'native-2' }),
    arrow({ id: 'square-app', arrowheadStyle: 'square' }),
  ]);
  assert.deepEqual(les.map((l) => l && l.le), [
    ['/Circle', '/Circle'],
    ['/None', '/ClosedArrow'],
    ['/Circle', '/Butt'],
    null,
    ['/Slash', '/Diamond'],
    ['/None', '/OpenArrow'], // the V is the spec's OpenArrow, never a Slash
    ['/None', '/ClosedArrow'], // hollow triangle = ClosedArrow without /IC
    ['/Diamond', '/Circle'], // imported filled endings keep their own /IC
    ['/None', '/Square'],
  ]);
  // a filled head carries /IC so other viewers fill it; hollow-only lines carry none
  assert.deepEqual(les.map((l) => l && l.hasIC), [false, true, false, null, false, false, false, true, false]);
});
