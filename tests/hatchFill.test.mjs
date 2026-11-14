// Nightly 'hatch-fill' (Drawboard shape fill > Hatch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import {
  applyHatch, HATCH_PATTERNS, HATCH_SPACING, hatchOutline, hatchPaint, hatchPatternOf, hatchSegments, hatchShapeKind,
} from '../src/utils/hatchFill.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rect = (extra = {}) => ({ id: 'r1', type: 'rect', left: 100, top: 50, width: 60, height: 30, stroke: '#ff0000', strokeWidth: 2, fill: 'transparent', ...extra });
const inside = (p, o, eps = 1e-6) => p.x >= o.left - eps && p.x <= o.left + o.width + eps && p.y >= o.top - eps && p.y <= o.top + o.height + eps;

test('hatch-fill is a Nightly beta flag with a seeded off row', () => {
  assert.equal(FEATURE_FLAGS['hatch-fill']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261113190000_drawboard_tool_flags.sql'), /\('hatch-fill', 'off'/);
});

test('only closed shapes take a hatch; set and clear make new objects', () => {
  assert.equal(hatchShapeKind(rect()), 'rect');
  assert.equal(hatchShapeKind({ type: 'ellipse', rx: 5, ry: 5 }), 'ellipse');
  assert.equal(hatchShapeKind({ type: 'polygon', points: [] }), 'polygon');
  assert.equal(hatchShapeKind({ type: 'path' }), null);
  assert.equal(hatchShapeKind(rect({ data: { type: 'note' } })), null, 'sticky notes stay plain');
  assert.equal(hatchShapeKind(rect({ globalCompositeOperation: 'multiply' })), null, 'highlight boxes stay plain');
  const r = rect();
  const hatched = applyHatch(r, 'crosshatch');
  assert.equal(hatchPatternOf(hatched), 'crosshatch');
  assert.equal(r.data, undefined, 'the old object is untouched');
  assert.equal(hatchPatternOf(applyHatch(hatched, null)), null);
  assert.equal(hatchPatternOf(applyHatch(r, 'nope')), null);
});

test('horizontal lines are evenly spaced and run edge to edge', () => {
  const o = rect();
  const segs = hatchSegments(hatchOutline(o), 'horizontal');
  assert.equal(segs.length, Math.round(o.height / HATCH_SPACING) - 1, 'a line every step, a step in from each edge');
  for (const s of segs) {
    assert.ok(Math.abs(s.y1 - s.y2) < 1e-9);
    assert.ok(Math.abs(Math.min(s.x1, s.x2) - o.left) < 1e-6 && Math.abs(Math.max(s.x1, s.x2) - (o.left + o.width)) < 1e-6);
  }
});

test('every pattern stays inside the shape, and a crosshatch is two diagonal sets', () => {
  const o = rect();
  for (const p of HATCH_PATTERNS) {
    const segs = hatchSegments(hatchOutline(o), p.id);
    assert.ok(segs.length > 0, p.id);
    for (const s of segs) assert.ok(inside({ x: s.x1, y: s.y1 }, o) && inside({ x: s.x2, y: s.y2 }, o), p.id);
  }
  const d = hatchSegments(hatchOutline(o), 'diagonal').length;
  const b = hatchSegments(hatchOutline(o), 'back-diagonal').length;
  assert.equal(hatchSegments(hatchOutline(o), 'crosshatch').length, d + b);
});

test('a concave polygon gets its lines split around the notch', () => {
  // An L shape: the top half is only the left column.
  const L = { type: 'polygon', left: 0, top: 0, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 60 }, { x: 0, y: 60 }] };
  const segs = hatchSegments(hatchOutline(L), 'vertical');
  const atX = (x) => segs.filter((s) => Math.abs(s.x1 - x) < 1e-6);
  const right = segs.find((s) => s.x1 > 25);
  assert.ok(right);
  assert.ok(Math.min(right.y1, right.y2) >= 30 - 1e-6, 'right of the notch only the lower half is hatched');
  assert.ok(atX(segs[0].x1).length === 1);
});

test('the pattern turns with the shape', () => {
  const flat = hatchPaint(applyHatch(rect(), 'horizontal'));
  const turned = hatchPaint(applyHatch(rect({ angle: 30 }), 'horizontal'));
  const slope = (s) => Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI;
  assert.ok(Math.abs(slope(flat.segments[0]) % 180) < 1e-6);
  assert.ok(Math.abs(((slope(turned.segments[0]) % 180) + 180) % 180 - 30) < 1e-6);
  assert.equal(flat.color, '#ff0000', 'drawn in the border colour');
  assert.equal(hatchPaint(applyHatch(rect({ stroke: 'rgba(0,0,0,0)' }), 'grid')).color, '#000000');
});

test('screen, panel and print are wired', () => {
  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /export const renderRect = withHatch\(renderRectBase\);/);
  assert.match(renderers, /export const renderEllipse = withHatch\(renderEllipseBase\);/);
  assert.match(renderers, /export const renderPolygon = withHatch\(renderPolygonBase\);/);
  assert.match(renderers, /pointerEvents="none"\s+data-hatch-for/);
  assert.match(read('src/components/SelectionPropertiesPanel.jsx'), /data-props-hatch-pattern=\{p\.id\}/);
  assert.match(read('src/PDFViewer.jsx'), /setSelectedHatch: hatchFillEnabled \? handleSetSelectedHatch : null/);
  assert.match(read('src/utils/pdfAnnotationsPdfLib.js'), /if \(drawn && obj\?\.data\?\.hatch\) drawFlattenedHatch\(page, obj, pageHeight, offset\);/);
});

test('an exported hatched rectangle carries the lines in its appearance', async () => {
  const source = await PDFDocument.create();
  source.addPage([420, 320]);
  const raw = await source.save();
  const file = { name: 'h.pdf', async arrayBuffer() { return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); } };
  const exportOne = async (object) => {
    const { log, warn, error } = console;
    const original = globalThis.window;
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    globalThis.window = {};
    try {
      return await savePDFWithAnnotationsPdfLib(file, { 1: { objects: [object] } }, { 1: { width: 420, height: 320 } }, null,
        { returnBytes: true, actionType: 'pdf-export', documentId: 'hatch-export' });
    } finally {
      console.log = log; console.warn = warn; console.error = error; globalThis.window = original;
    }
  };
  const apText = async (bytes) => {
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    assert.ok(annots instanceof PDFArray);
    const dict = doc.context.lookup(annots.get(0));
    const ap = dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
    return Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1');
  };
  const plain = await apText(await exportOne(rect()));
  const hatched = await apText(await exportOne(applyHatch(rect(), 'horizontal')));
  const lines = (text) => (text.match(/ l\b/g) || []).length;
  assert.ok(lines(hatched) >= lines(plain) + Math.round(30 / HATCH_SPACING) - 1, `hatched appearance has the lines (${lines(plain)} -> ${lines(hatched)})`);
});

test('an exported hatched cloud carries the lines in its cloud appearance', async () => {
  const source = await PDFDocument.create();
  source.addPage([420, 320]);
  const raw = await source.save();
  const file = { name: 'c.pdf', async arrayBuffer() { return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); } };
  const exportOne = async (object) => {
    const { log, warn, error } = console;
    const original = globalThis.window;
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    globalThis.window = {};
    try {
      return await savePDFWithAnnotationsPdfLib(file, { 1: { objects: [object] } }, { 1: { width: 420, height: 320 } }, null,
        { returnBytes: true, actionType: 'pdf-export', documentId: 'hatch-cloud-export' });
    } finally {
      console.log = log; console.warn = warn; console.error = error; globalThis.window = original;
    }
  };
  const apText = async (bytes) => {
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    const dict = doc.context.lookup(annots.get(0));
    const ap = dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
    return Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1');
  };
  const cloud = (extra = {}) => rect({ width: 120, height: 60, data: { pdfCloudIntensity: 1, ...(extra.data || {}) } });
  const plain = await apText(await exportOne(cloud()));
  const hatched = await apText(await exportOne(applyHatch(cloud(), 'horizontal')));
  const lineOps = (text) => (text.match(/ m [\d.-]+ [\d.-]+ l/g) || []).length;
  assert.equal(lineOps(plain), 0);
  const expected = hatchSegments([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 60 }, { x: 0, y: 60 }], 'horizontal').length;
  assert.ok(expected >= 9);
  assert.equal(lineOps(hatched), expected, 'the same lines the page draws');
  assert.match(hatched, /0\.75 w/);
});
