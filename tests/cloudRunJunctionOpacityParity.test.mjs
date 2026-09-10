// Run-junction opacity parity (2026-09-09).
//
// Ported from the adversarial spec written on claude/verify2-fill-knockout and
// extended to every lane. The original defect:
//
// The fill-knockout / per-run work claims the crowns composite ONE PATH PER
// RUN, "identically in SVG, canvas presentation, flattened PDF and /AP export".
// That held while the annotation's own opacity was 1. It did NOT hold once the
// object carried an opacity below 1:
//
//   * SVG puts the opacity on the cloud's <g> (CloudOutline / cloudSvgPaintMarkup),
//     so every run is composited into the group buffer FIRST and the whole
//     group is composited ONCE — a junction covered by two runs ends up at
//     (1-(1-strokeAlpha)^2) * objectOpacity.
//   * The canvas painter multiplied globalAlpha into EVERY run stroke and the
//     PDF /AP baked the product into one ExtGState /CA used by every `S`, so a
//     junction ended up at 1-(1-strokeAlpha*objectOpacity)^2.
//
// Those two numbers differ (0.375 vs 0.4375 for strokeAlpha .5 / opacity .5),
// which is ~14/255 of visible divergence on the junction pixel between the
// screen and every export lane.
//
// THE FIX (claude/cloud-opacity-junctions): every lane now does what the SVG
// group does. The canvas painter paints the knocked-out fill AND every run on
// its scratch layer at full alpha and composites the layer once with the
// object's opacity; the /AP (and therefore the flattened print, which places
// the same form) wraps the paint in an ISOLATED TRANSPARENCY GROUP form
// (/Group << /S /Transparency /CS /DeviceRGB /I true >>) drawn by a single `Do`
// under a constant-alpha ExtGState. /CS is DeviceRGB deliberately: pdf.js
// mis-rasterises /DeviceGray groups. pdf.js, poppler and Quartz (qlmanage) were
// all measured on the shipped bytes and all three composite it correctly, so no
// union-outline fallback was needed.
//
// Lanes: librsvg (the SVG paint model), node-canvas (the presentation painter),
// pdf.js on the exported /AP and on the flattened print, and poppler on both.
// A lane whose rasteriser is not installed skips with a reason; it never fakes
// a pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { PNG } from 'pngjs';

const { resolveCloudAnnotationGeometry } = await import('../src/utils/cloudAnnotationGeometry.js');
const { buildCloudSvgPaint, cloudSvgPaintMarkup } = await import('../src/utils/cloudSvgPaint.js');
const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
const {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} = await import('../src/utils/pdfAnnotationsPdfLib.js');

const SCALE = 6;
const PAGE = { width: 320, height: 240 };
const OPACITY = 0.5;
const STROKE = { r: 196, g: 39, b: 71, a: 0.5 };
const FILL = { r: 0, g: 0, b: 255, a: 0.3 };
const object = {
  id: 'run-opacity', type: 'rect', left: 60, top: 50, width: 200, height: 140, strokeWidth: 6,
  stroke: `rgba(${STROKE.r}, ${STROKE.g}, ${STROKE.b}, ${STROKE.a})`,
  fill: `rgba(${FILL.r}, ${FILL.g}, ${FILL.b}, ${FILL.a})`,
  opacity: OPACITY,
  data: { pdfCloudIntensity: 2 },
};
const geometry = resolveCloudAnnotationGeometry(object);
const run2 = geometry.outlineRuns[2][0];
const junction = { x: run2[1] + object.left, y: run2[2] + object.top };
const midRun = { x: geometry.cusps[3].x + object.left, y: geometry.cusps[3].y + object.top };

// The one model every lane has to hit: the runs composite with each other at
// the STROKE's own alpha, and the object's opacity is applied once, to the
// result. Over the white page that is a straight lerp per channel.
const overWhite = (alpha) => [STROKE.r, STROKE.g, STROKE.b]
  .map((channel) => 255 + (channel - 255) * alpha);
const GROUP_JUNCTION_ALPHA = (1 - (1 - STROKE.a) ** 2) * OPACITY;   // .375
const GROUP_MID_RUN_ALPHA = STROKE.a * OPACITY;                     // .25
const PER_STROKE_JUNCTION_ALPHA = 1 - (1 - STROKE.a * OPACITY) ** 2; // .4375 (the defect)

const pixelAt = (png, point) => {
  const x = Math.round(point.x * SCALE);
  const y = Math.round(point.y * SCALE);
  const index = (y * png.width + x) * 4;
  return [png.data[index], png.data[index + 1], png.data[index + 2]];
};
const distance = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));

const tmp = mkdtempSync(join(tmpdir(), 'cloud-run-opacity-'));
const has = (command) => spawnSync('which', [command], { encoding: 'utf8' }).status === 0;

let pdfjs = null;
let napiCanvas = null;
try {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  napiCanvas = await import('@napi-rs/canvas');
} catch { pdfjs = null; napiCanvas = null; }
let nodeCanvas = null;
try { nodeCanvas = await import('canvas'); } catch { nodeCanvas = null; }

const svgRaster = () => {
  const model = buildCloudSvgPaint(geometry, { fill: object.fill, stroke: object.stroke, maskId: 'cloud-fill-mask-op' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width * SCALE}" height="${PAGE.height * SCALE}" viewBox="0 0 ${PAGE.width} ${PAGE.height}">`
    + `<rect width="${PAGE.width}" height="${PAGE.height}" fill="white"/>${cloudSvgPaintMarkup(model, { opacity: OPACITY })}</svg>`;
  const svgPath = join(tmp, 'op.svg');
  const pngPath = join(tmp, 'op-svg.png');
  writeFileSync(svgPath, svg);
  const result = spawnSync('rsvg-convert', ['-b', 'white', '-w', String(PAGE.width * SCALE), '-h', String(PAGE.height * SCALE), '-o', pngPath, svgPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return PNG.sync.read(readFileSync(pngPath));
};

const canvasRaster = () => {
  const canvas = nodeCanvas.createCanvas(PAGE.width * SCALE, PAGE.height * SCALE);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(SCALE, SCALE);
  drawAnnotationObject(context, object);
  context.restore();
  return PNG.sync.read(canvas.toBuffer('image/png'));
};

const blankPdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return {
    name: 'blank.pdf',
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
};
const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};
const bytesOf = (result) => (result instanceof Uint8Array ? result : result?.bytes || result?.pdfBytes || result);

const exportedBytes = async () => bytesOf(await withWindow(async () => savePDFWithAnnotationsPdfLib(
  await blankPdfFile(), { 1: { objects: [object] } }, { 1: { width: PAGE.width, height: PAGE.height } }, null,
  { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-run-opacity' },
)));
const flattenedBytes = async () => bytesOf(await withWindow(async () => savePDFWithFlattenedRegularAnnotationsForPrint(
  await blankPdfFile(), { 1: { objects: [object] } }, { 1: { width: PAGE.width, height: PAGE.height } }, null,
  { returnBytes: true, actionType: 'print', documentId: 'cloud-run-opacity-flat' },
)));

const pdfjsRaster = async (bytes) => {
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = napiCanvas.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  return PNG.sync.read(canvas.toBuffer('image/png'));
};

const popplerRaster = (bytes, tag) => {
  const pdfPath = join(tmp, `${tag}.pdf`);
  writeFileSync(pdfPath, Buffer.from(bytes));
  const result = spawnSync('pdftoppm', ['-r', String(72 * SCALE), '-png', '-singlefile', pdfPath, join(tmp, `poppler-${tag}`)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return PNG.sync.read(readFileSync(join(tmp, `poppler-${tag}.png`)));
};

// ---------------------------------------------------------------------------
// The model itself: the SVG lane is the reference, and it must land on the
// GROUP numbers, not the per-stroke ones. Without this, "every lane agrees"
// could be satisfied by making the SVG wrong too.
// ---------------------------------------------------------------------------
test('the SVG reference composites the runs inside the group, then applies the opacity once', { skip: has('rsvg-convert') ? false : 'rsvg-convert not installed' }, () => {
  const svg = svgRaster();
  assert.ok(distance(pixelAt(svg, midRun), overWhite(GROUP_MID_RUN_ALPHA)) <= 2,
    `mid-run ${pixelAt(svg, midRun)} != stroke over page at ${GROUP_MID_RUN_ALPHA}`);
  assert.ok(distance(pixelAt(svg, junction), overWhite(GROUP_JUNCTION_ALPHA)) <= 2,
    `junction ${pixelAt(svg, junction)} != two runs over page at ${GROUP_JUNCTION_ALPHA}`);
  // And it is measurably NOT the per-stroke-alpha number the export used to use.
  assert.ok(distance(pixelAt(svg, junction), overWhite(PER_STROKE_JUNCTION_ALPHA)) > 6,
    'the two compositing models must stay distinguishable for this fixture');
});

test('the canvas presentation painter matches the SVG group at the junction', { skip: nodeCanvas ? (has('rsvg-convert') ? false : 'rsvg-convert not installed') : 'node-canvas not installed' }, () => {
  const svg = svgRaster();
  const canvas = canvasRaster();
  assert.ok(distance(pixelAt(svg, midRun), pixelAt(canvas, midRun)) <= 4,
    `mid-run: svg ${pixelAt(svg, midRun)} vs canvas ${pixelAt(canvas, midRun)}`);
  assert.ok(distance(pixelAt(svg, junction), pixelAt(canvas, junction)) <= 4,
    `run junction: svg ${pixelAt(svg, junction)} vs canvas ${pixelAt(canvas, junction)}`);
});

test('a translucent cloud at object opacity < 1 composites its run junctions the same on screen and in the /AP', { skip: !has('rsvg-convert') ? 'rsvg-convert not installed' : (pdfjs && napiCanvas ? false : 'pdfjs-dist + @napi-rs/canvas not installed') }, async () => {
  const svg = svgRaster();
  const ap = await pdfjsRaster(await exportedBytes());
  // Mid-run agrees today: one run, one composite either way.
  assert.ok(distance(pixelAt(svg, midRun), pixelAt(ap, midRun)) <= 4,
    `mid-run: svg ${pixelAt(svg, midRun)} vs /AP ${pixelAt(ap, midRun)}`);
  // The junction must agree too — the per-run paint is supposed to be the
  // SAME model in both lanes.
  const svgJunction = pixelAt(svg, junction);
  const apJunction = pixelAt(ap, junction);
  assert.ok(distance(svgJunction, apJunction) <= 4,
    `run junction diverges: svg ${svgJunction} (group opacity flattens the runs) vs /AP ${apJunction} (per-run CA)`);
});

test('the flattened print composites the junction like the screen (pdf.js)', { skip: !has('rsvg-convert') ? 'rsvg-convert not installed' : (pdfjs && napiCanvas ? false : 'pdfjs-dist + @napi-rs/canvas not installed') }, async () => {
  const svg = svgRaster();
  const flat = await pdfjsRaster(await flattenedBytes());
  assert.ok(distance(pixelAt(svg, midRun), pixelAt(flat, midRun)) <= 4,
    `mid-run: svg ${pixelAt(svg, midRun)} vs flatten ${pixelAt(flat, midRun)}`);
  assert.ok(distance(pixelAt(svg, junction), pixelAt(flat, junction)) <= 4,
    `run junction: svg ${pixelAt(svg, junction)} vs flatten ${pixelAt(flat, junction)}`);
});

test('poppler rasterises the transparency group the same way (export and print)', { skip: !has('rsvg-convert') ? 'rsvg-convert not installed' : (has('pdftoppm') ? false : 'pdftoppm not installed') }, async () => {
  const svg = svgRaster();
  for (const [tag, bytes] of [['ap', await exportedBytes()], ['flat', await flattenedBytes()]]) {
    const png = popplerRaster(bytes, tag);
    assert.ok(distance(pixelAt(svg, midRun), pixelAt(png, midRun)) <= 4,
      `${tag} mid-run: svg ${pixelAt(svg, midRun)} vs poppler ${pixelAt(png, midRun)}`);
    assert.ok(distance(pixelAt(svg, junction), pixelAt(png, junction)) <= 4,
      `${tag} run junction: svg ${pixelAt(svg, junction)} vs poppler ${pixelAt(png, junction)}`);
  }
});

// ---------------------------------------------------------------------------
// Structure guard: what makes the PDF lanes match is the transparency group.
// ---------------------------------------------------------------------------
const streamText = (doc, stream) => (stream instanceof PDFRawStream
  ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
  : '');

test('the /AP wraps the cloud paint in one isolated DeviceRGB transparency group drawn at the object alpha', async () => {
  const doc = await PDFDocument.load(await exportedBytes());
  const page = doc.getPages()[0];
  const annots = page.node.Annots();
  const annot = doc.context.lookup(annots.get(0));
  const normal = doc.context.lookup(doc.context.lookup(annot.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const outer = streamText(doc, normal);
  // The appearance itself paints nothing but the group.
  assert.match(outer, /\/GSO gs/);
  assert.match(outer, /\/CloudGroup Do/);
  assert.doesNotMatch(outer, /\bS\b/, 'the outer appearance must not stroke: the runs live inside the group');
  const outerGs = doc.context.lookup(doc.context.lookup(normal.dict.get(PDFName.of('Resources'))).get(PDFName.of('ExtGState')));
  const gso = doc.context.lookup(outerGs.get(PDFName.of('GSO')));
  assert.equal(gso.get(PDFName.of('CA')).asNumber(), OPACITY);
  assert.equal(gso.get(PDFName.of('ca')).asNumber(), OPACITY);

  const xobjects = doc.context.lookup(doc.context.lookup(normal.dict.get(PDFName.of('Resources'))).get(PDFName.of('XObject')));
  const group = doc.context.lookup(xobjects.get(PDFName.of('CloudGroup')));
  const groupDict = doc.context.lookup(group.dict.get(PDFName.of('Group')));
  assert.equal(groupDict.get(PDFName.of('S')).asString(), '/Transparency');
  // DeviceRGB, not DeviceGray: pdf.js mis-rasterises /DeviceGray groups.
  assert.equal(groupDict.get(PDFName.of('CS')).asString(), '/DeviceRGB');
  assert.equal(String(groupDict.get(PDFName.of('I'))), 'true');
  const inner = streamText(doc, group);
  // Inside the group the runs are still one `S` each, at the STROKE's own
  // alpha — the object's opacity is not in here at all.
  assert.ok((inner.match(/(?:^|\s)S(?=\s|$)/g) || []).length >= 4, 'one stroke per run inside the group');
  const innerGs = doc.context.lookup(doc.context.lookup(group.dict.get(PDFName.of('Resources'))).get(PDFName.of('ExtGState')));
  const gs0 = doc.context.lookup(innerGs.get(PDFName.of('GS0')));
  assert.equal(gs0.get(PDFName.of('CA')).asNumber(), STROKE.a);
  assert.equal(gs0.get(PDFName.of('ca')).asNumber(), FILL.a);
});

test('an opaque cloud keeps the flat appearance stream (the group would be a no-op)', async () => {
  const opaque = { ...object, opacity: 1 };
  const bytes = bytesOf(await withWindow(async () => savePDFWithAnnotationsPdfLib(
    await blankPdfFile(), { 1: { objects: [opaque] } }, { 1: { width: PAGE.width, height: PAGE.height } }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-run-opaque' },
  )));
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  const annot = doc.context.lookup(page.node.Annots().get(0));
  const normal = doc.context.lookup(doc.context.lookup(annot.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const outer = streamText(doc, normal);
  assert.doesNotMatch(outer, /Do\b/);
  assert.ok((outer.match(/(?:^|\s)S(?=\s|$)/g) || []).length >= 4, 'the runs are stroked directly');
});
