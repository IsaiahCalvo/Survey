// Revision-cloud fill knockout + per-run paint + width readout (2026-09-09).
//
// Drawboard PDF parity for a FILLED cloud with a translucent stroke:
//   (a) the fill is knocked out under the whole stroke band, so an on-stroke
//       pixel is stroke-over-PAGE and never stroke-over-fill, and the fill
//       alpha stays independent of the stroke alpha;
//   (b) like the approved studio (page.tsx cloud-ink group) the crowns are
//       painted one path PER RUN, so run junctions composite per run;
//   (c) the line Width field shows and draws the Cloud style's 2.5 default.
//
// Pixel lanes rasterise the app's real output - the SVG paint model with
// librsvg, the canvas painter with node-canvas, the exported /AP and the
// flattened print with pdf.js - and sample the same three points: a crown
// apex (mid-run, on the stroke centreline), the first junction (where run 2
// starts on run 1) and the interior. A lane whose rasteriser is not installed
// skips with a reason; it never fakes a pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { PNG } from 'pngjs';
import { PATHOLOGICAL_CLOUD_SHAPES } from './fixtures/pathologicalCloudShapes.mjs';

const {
  buildCloudRenderPaths,
  hasVisibleCloudFill,
} = await import('../src/utils/pdfAnnotationAppearance.js');
const {
  cloudStrokeBandRings,
  resolveCloudAnnotationGeometry,
  sampleCloudCommands,
} = await import('../src/utils/cloudAnnotationGeometry.js');
const { buildCloudSvgPaint, cloudSvgPaintMarkup } = await import('../src/utils/cloudSvgPaint.js');
const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
const {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} = await import('../src/utils/pdfAnnotationsPdfLib.js');
const {
  ANNOTATION_WIDTH_DECIMALS,
  normalizeAnnotationSize,
  sanitizeAnnotationSizeDraft,
} = await import('../src/utils/annotationSize.js');

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Fixture: a filled rect cloud with a translucent stroke over a translucent
// fill. Wide stroke so the centreline pixel is fully inside the band.
// ---------------------------------------------------------------------------
const SCALE = 2;
const PAGE = { width: 320, height: 240 };
const STROKE = { r: 196, g: 39, b: 71, a: 0.5 };
const FILL = { r: 0, g: 0, b: 255, a: 0.3 };
const object = {
  id: 'rect-knockout', type: 'rect', left: 60, top: 50, width: 200, height: 140,
  stroke: `rgba(${STROKE.r}, ${STROKE.g}, ${STROKE.b}, ${STROKE.a})`,
  strokeWidth: 6,
  fill: `rgba(${FILL.r}, ${FILL.g}, ${FILL.b}, ${FILL.a})`,
  data: { pdfCloudIntensity: 2 },
};
const geometry = resolveCloudAnnotationGeometry(object);

const over = (top, alpha, under) => Math.round(under * (1 - alpha) + top * alpha);
const WHITE = [255, 255, 255];
const FILL_OVER_PAGE = [over(FILL.r, FILL.a, 255), over(FILL.g, FILL.a, 255), over(FILL.b, FILL.a, 255)];
const STROKE_OVER_PAGE = [over(STROKE.r, STROKE.a, 255), over(STROKE.g, STROKE.a, 255), over(STROKE.b, STROKE.a, 255)];
const STROKE_OVER_FILL = FILL_OVER_PAGE.map((channel, index) => over([STROKE.r, STROKE.g, STROKE.b][index], STROKE.a, channel));
// Two runs overlapping at a junction: 1-(1-a)^2 effective alpha.
const JUNCTION_ALPHA = 1 - (1 - STROKE.a) ** 2;
const STROKE_TWICE_OVER_PAGE = [over(STROKE.r, JUNCTION_ALPHA, 255), over(STROKE.g, JUNCTION_ALPHA, 255), over(STROKE.b, JUNCTION_ALPHA, 255)];

const samplePoints = () => {
  const apex = geometry.cusps[3];
  const run2 = geometry.outlineRuns[2][0];
  return {
    apex: { x: apex.x + object.left, y: apex.y + object.top },
    junction: { x: run2[1] + object.left, y: run2[2] + object.top },
    interior: { x: object.left + object.width / 2, y: object.top + object.height / 2 },
    page: { x: 10, y: 10 },
  };
};

const pixelAt = (png, point, scale = SCALE) => {
  const x = Math.round(point.x * scale);
  const y = Math.round(point.y * scale);
  const index = (y * png.width + x) * 4;
  return [png.data[index], png.data[index + 1], png.data[index + 2]];
};
const distance = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));

const assertKnockoutPixels = (png, lane) => {
  const points = samplePoints();
  const apex = pixelAt(png, points.apex);
  const junction = pixelAt(png, points.junction);
  const interior = pixelAt(png, points.interior);
  const page = pixelAt(png, points.page);
  assert.ok(distance(page, WHITE) <= 1, `${lane}: page stays white (${page})`);
  assert.ok(distance(interior, FILL_OVER_PAGE) <= 3, `${lane}: interior is fill over page (${interior} vs ${FILL_OVER_PAGE})`);
  // (a) knockout: stroke over PAGE on the centreline, never stroke over fill.
  assert.ok(distance(apex, STROKE_OVER_PAGE) <= 3,
    `${lane}: on-stroke pixel ${apex} must be stroke-over-page ${STROKE_OVER_PAGE}, not stroke-over-fill ${STROKE_OVER_FILL}`);
  assert.ok(distance(apex, STROKE_OVER_FILL) > 12, `${lane}: on-stroke pixel ${apex} is tinted by the fill`);
  // (b) per-run: the junction composites two runs and is darker than mid-run.
  assert.ok(distance(junction, STROKE_TWICE_OVER_PAGE) <= 4,
    `${lane}: junction pixel ${junction} must be two runs over page ${STROKE_TWICE_OVER_PAGE}`);
  assert.ok(apex[1] - junction[1] > 20, `${lane}: junction ${junction} must be darker than a mid-run pixel ${apex}`);
};

const tmp = mkdtempSync(join(tmpdir(), 'cloud-knockout-'));
const has = (command) => spawnSync('which', [command], { encoding: 'utf8' }).status === 0;

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test('per-run: the engine exposes one command array per painted run, the SVG model one path per run, one hit surface', () => {
  const paths = buildCloudRenderPaths(
    [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }],
    2, 2.5, 1, 'rectangle', { fill: true },
  );
  assert.ok(Array.isArray(paths.outlineRuns) && paths.outlineRuns.length > 1, 'more than one run');
  assert.deepEqual(paths.outlineRuns.flat(), paths.outline, 'the runs concatenate to the flat outline, in order');
  for (const run of paths.outlineRuns) {
    assert.equal(run[0][0], 'M', 'every run starts with its own M');
    assert.ok(run.every(([verb]) => verb === 'M' || verb === 'C'));
  }
  assert.ok(geometry.outlineRuns.length > 1);
  const model = buildCloudSvgPaint(geometry, { fill: object.fill, stroke: object.stroke, maskId: 'm' });
  assert.equal(model.runDs.length, geometry.outlineRuns.length, 'one SVG path per run');
  assert.equal(model.runDs.join(' '), model.outlineD, 'the per-run paths are the single outline, split');
  // The hit surface / hover glow stays ONE path along the whole outline.
  const layer = read('../src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const cloudD = cloudCommandsToPathData\(cloudHitGeometry\.outline\)/);
  assert.equal((layer.match(/data-shape-hit-target="cloud"/g) || []).length, 1);
});

test('SVG paint model: a filled, stroked cloud carries the Drawboard mask; unstroked / unfilled / open clouds do not', () => {
  const model = buildCloudSvgPaint(geometry, { fill: object.fill, stroke: object.stroke, maskId: 'cloud-fill-mask-t' });
  assert.ok(model.mask, 'mask present');
  assert.equal(model.mask.id, 'cloud-fill-mask-t');
  assert.equal(model.strokeWidth, 6);
  // The mask region covers the fill plus the stroke band around it.
  const bounds = sampleCloudCommands(geometry.fill, 6).flat();
  const minX = Math.min(...bounds.map((p) => p.x));
  const maxX = Math.max(...bounds.map((p) => p.x));
  assert.ok(model.mask.x <= minX - 3 && model.mask.x + model.mask.width >= maxX + 3);
  const markup = cloudSvgPaintMarkup(model);
  assert.match(markup, /<mask id="cloud-fill-mask-t" maskUnits="userSpaceOnUse"/);
  assert.match(markup, /<mask[^>]*><path d="[^"]+" fill="#fff" fill-rule="nonzero" stroke="none"\/><path d="[^"]+" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"\/><\/mask>/);
  assert.match(markup, /mask="url\(#cloud-fill-mask-t\)"/);
  assert.equal((markup.match(/data-run="/g) || []).length, geometry.outlineRuns.length);

  const hollow = resolveCloudAnnotationGeometry({ ...object, fill: 'transparent' });
  assert.equal(buildCloudSvgPaint(hollow, { fill: 'transparent', stroke: object.stroke }).mask, null, 'no fill, no mask');
  const unstroked = buildCloudSvgPaint(geometry, { fill: object.fill, stroke: 'transparent' });
  assert.equal(unstroked.mask, null, 'no stroke, nothing to knock out');
  assert.ok(unstroked.fillD, 'the fill still paints');
  const polyline = resolveCloudAnnotationGeometry({
    type: 'polyline', left: 0, top: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 0 }],
    pathOffset: { x: 0, y: 0 }, strokeWidth: 3, stroke: '#c42747', fill: '#ffcc00', data: { pdfCloudIntensity: 2 },
  });
  const open = buildCloudSvgPaint(polyline, { fill: '#ffcc00', stroke: '#c42747' });
  assert.equal(open.fillD, null, 'open clouds never fill');
  assert.equal(open.mask, null);
  assert.equal(hasVisibleCloudFill('rgba(0,0,0,0)'), false);
});

test('source guards: CloudOutline renders the shared model, the painter knocks out on a scratch layer, both stroke per run', () => {
  const svg = read('../src/utils/svgAnnotationRenderers.jsx');
  assert.match(svg, /buildCloudSvgPaint\(geometry/);
  assert.match(svg, /<mask\s+id=\{paint\.mask\.id\}\s+maskUnits="userSpaceOnUse"/);
  assert.match(svg, /mask=\{paint\.mask \? `url\(#\$\{paint\.mask\.id\}\)` : undefined\}/);
  assert.match(svg, /paint\.runDs\.map\(\(d, index\) => \(\s*<path key=\{index\} d=\{d\} data-run=\{index\} \/>/);
  const painter = read('../src/utils/annotationCanvasPainter.js');
  assert.match(painter, /globalCompositeOperation = 'destination-out'/);
  // 2026-09-09 — CONTRACT CHANGED, guard rewritten (run-junction opacity
  // parity): the scratch layer no longer carries only the knocked-out fill,
  // it carries the WHOLE cloud (fill + every run) at full alpha and is
  // composited once with the object's opacity, so a run junction composites
  // inside the group buffer exactly like the SVG <g opacity>. The old guard
  // named paintKnockedOutCloudFill(context, object, geometry); the knockout
  // contract it protected (scratch layer, never destination-out on the shared
  // canvas, one stroke per run) is unchanged and asserted below.
  assert.match(painter, /const painted = wantsLayer\s*&& paintCloudThroughLayer\(context, object, geometry, \{ hasFill, hasStroke, stroke: strokePaint \}\)/);
  assert.match(painter, /for \(const run of runs\) \{\s*context\.beginPath\(\);\s*traceCommandsInto\(context, run\);\s*context\.stroke\(\);/);
  // The knockout must never destination-out the shared canvas itself.
  const knockoutFn = painter.slice(painter.indexOf('const paintCloudThroughLayer'), painter.indexOf('function drawCloud('));
  // Everything the group buffer holds is painted at full alpha; the object's
  // opacity is applied exactly once, on the drawImage that composites it.
  assert.match(knockoutFn, /scratch\.globalAlpha = 1;/);
  assert.match(knockoutFn, /if \(paint\.hasStroke\) strokeCloudRuns\(scratch, geometry, paint\.stroke, geometry\.strokeWidth\);/);
  assert.match(knockoutFn, /context\.drawImage\(layer\.canvas, 0, 0\);/);
  assert.doesNotMatch(knockoutFn, /scratch\.globalAlpha = [^1]/);
  assert.doesNotMatch(knockoutFn, /context\.globalCompositeOperation = 'destination-out'/);
  const flatten = read('../src/utils/pdfAnnotationsPdfLib.js');
  assert.match(flatten, /cloudStrokeBandRings\(geometry\)/);
  assert.match(flatten, /runs\.flatMap\(\(run\) => \[\.\.\.cloudCommandsToOperators\(run, mapPoint\), 'S'\]\)/);
  assert.doesNotMatch(flatten, /SMask/, 'no soft mask: Quartz drops it inside annotation appearances');
});

// DELIBERATE CONTRACT REWRITE (2026-09-10). This test used to assert the
// SUBTRACTED region (`fill minus band`) that cloudFillKnockoutRings returned.
// That subtraction unioned the sampled fill contour with the crown lobes and
// the body polygon - three families that share exactly-coincident edges - and
// the sweep line hung for over ten minutes on some filled polygon clouds
// (left 40 / top 30, points (0,0) (210,20) (180,160) (30,130), stroke 6, bump
// 2) and threw on others, so those clouds got NO /AP and NO flattened page at
// all. The knockout is now a clip to the complement of the stroke band, and
// cloudStrokeBandRings returns that band. The property below is the same
// contract seen from the other side, and a tighter one: every vertex of the
// band is exactly half a stroke width from the outline centreline, and the
// inward tail's end - the place the old rings had to prove they excluded - is
// INSIDE the band.
test('stroke band: half a stroke width around every run, tails included, and it never hangs', () => {
  const band = cloudStrokeBandRings(geometry);
  assert.ok(band && Array.isArray(band.rings) && band.rings.length >= 1);
  assert.equal(band.mode, 'union', 'a plain rect cloud unions cleanly');
  const distanceToOutline = (point) => {
    let best = Infinity;
    for (const subpath of sampleCloudCommands(geometry.outline, 16)) {
      for (let index = 0; index + 1 < subpath.length; index += 1) {
        const a = subpath[index]; const b = subpath[index + 1];
        const abx = b.x - a.x; const aby = b.y - a.y;
        const length2 = abx * abx + aby * aby;
        const t = length2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / length2)) : 0;
        best = Math.min(best, Math.hypot(point.x - (a.x + t * abx), point.y - (a.y + t * aby)));
      }
    }
    return best;
  };
  const half = object.strokeWidth / 2;
  for (const ring of band.rings) {
    for (const point of ring) {
      const distance = distanceToOutline(point);
      assert.ok(
        Math.abs(distance - half) <= 0.25,
        `band vertex (${point.x.toFixed(2)}, ${point.y.toFixed(2)}) is ${distance.toFixed(3)} from the centreline, not ~${half}`,
      );
    }
  }
  // The tails: a run's inward tail end is covered by the band, so the fill is
  // knocked out under it too (even-odd containment across the union's rings).
  const run = geometry.outlineRuns[1];
  const tailEnd = run[run.length - 1];
  const tail = { x: tailEnd[5], y: tailEnd[6] };
  const inside = (point, polygon) => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const a = polygon[i]; const b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const containment = band.rings.filter((ring) => inside(tail, ring)).length;
  assert.equal(containment % 2, 1, 'the tail end is inside the stroke band (even-odd)');
  assert.equal(cloudStrokeBandRings(resolveCloudAnnotationGeometry({ ...object, fill: 'transparent' })), null);
  assert.equal(cloudStrokeBandRings({ ...geometry, strokeWidth: 0 }), null);
});

// REGRESSION (2026-09-10): the two filled polygon clouds that made the old
// subtraction hang / throw. Both are plain shapes a user can draw in one drag;
// neither reached the exported file before this.
//
// 2026-09-15 — the stopwatch half of this regression moved to
// tests/cloudStrokeBandPathologicalBudget.test.mjs, in the non-blocking CI perf
// lane. This file runs in a BLOCKING test shard, and an elapsed-time assertion
// there can red a shard on runner weather, which reds the run, which stops the
// production deploy. Nothing was relaxed: the shapes are the same objects, the
// budget is the same 5000ms over there, the well-formedness checks below stayed
// blocking, and a genuine hang still trips the runner's 120s per-file timeout.
// tests/ciBlockingPathWallClockBudgets.test.mjs guards the boundary.
for (const [name, shape] of Object.entries(PATHOLOGICAL_CLOUD_SHAPES)) {
  test(`stroke band is well formed on the ${name}`, () => {
    const cloud = resolveCloudAnnotationGeometry(shape);
    assert.ok(cloud, 'the cloud resolves');
    const band = cloudStrokeBandRings(cloud);
    assert.ok(band && band.rings.length >= 1, 'a band came back');
    for (const ring of band.rings) {
      assert.ok(ring.length >= 3);
      for (const point of ring) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  });
}

// ---------------------------------------------------------------------------
// PDF structure: /AP paints the knockout region even-odd + one S per run, and
// the flattened print draws the very same form.
// ---------------------------------------------------------------------------

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
const exportAnnotated = async () => bytesOf(await withWindow(async () => savePDFWithAnnotationsPdfLib(
  await blankPdfFile(), { 1: { objects: [object] } }, { 1: { width: PAGE.width, height: PAGE.height } }, null,
  { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-knockout' },
)));
const exportFlattened = async () => bytesOf(await withWindow(async () => savePDFWithFlattenedRegularAnnotationsForPrint(
  await blankPdfFile(), { 1: { objects: [object] } }, { 1: { width: PAGE.width, height: PAGE.height } }, { returnBytes: true },
)));
const streamText = (doc, ref) => {
  const stream = doc.context.lookup(ref);
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString('latin1');
};

let annotatedBytes = null;
let flattenedBytes = null;
const exports = async () => {
  annotatedBytes ||= await exportAnnotated();
  flattenedBytes ||= await exportFlattened();
  return { annotatedBytes, flattenedBytes };
};

test('/AP: the fill is clipped to the stroke band complement, one stroke per run, and the flattened print draws the same form', async () => {
  const { annotatedBytes: annotated, flattenedBytes: flattened } = await exports();
  const doc = await PDFDocument.load(annotated);
  const page = doc.getPage(0);
  const annots = page.node.Annots();
  assert.ok(annots && annots.size() === 1, 'one annotation');
  const annot = doc.context.lookup(annots.get(0));
  const ap = doc.context.lookup(annot.get(PDFName.of('AP')));
  const normalRef = ap.get(PDFName.of('N'));
  const content = streamText(doc, normalRef);
  const strokes = (content.match(/\nS\n/g) || []).length + (content.endsWith('\nS') ? 1 : 0);
  assert.equal(strokes, geometry.outlineRuns.length, 'one S operator per run');
  // DELIBERATE ASSERTION CHANGE (2026-09-10): the knockout is a CLIP now (see
  // the contract note above), so the fill is an even-odd clip to the band's
  // complement followed by the scalloped region's own nonzero `f` - not an
  // even-odd `f*` of a pre-subtracted region.
  assert.match(content, /\nW\*\nn\n/, "the fill is clipped to the stroke band's complement");
  assert.match(content, /\nf\n/, 'the scalloped region is filled through that clip');
  assert.doesNotMatch(content, /\nf\*\n/, 'no pre-subtracted even-odd region');
  // The clip is fenced so the crowns painted after it are not clipped too.
  assert.ok(content.indexOf('\nq\n') < content.indexOf('\nW*\n'), 'the clip opens its own graphics state');
  assert.ok(content.indexOf('\nQ\n') > content.indexOf('\nf\n'), 'and closes it before the stroke');
  assert.match(content, /1 J 1 j/, 'round caps and joins');
  const form = doc.context.lookup(normalRef);
  assert.equal(form.dict.get(PDFName.of('Resources')).get(PDFName.of('ExtGState'))?.get(PDFName.of('GSK')), undefined, 'no soft mask');

  // Flattened print: the page draws one XObject whose stream is byte-identical.
  const printDoc = await PDFDocument.load(flattened);
  const printPage = printDoc.getPage(0);
  const xobjects = printPage.node.Resources().get(PDFName.of('XObject'));
  assert.ok(xobjects, 'the flattened page draws the cloud as a form XObject');
  const names = xobjects.keys().map((key) => key.decodeText());
  const cloudName = names.find((name) => name.startsWith('CloudAP'));
  assert.ok(cloudName, `a CloudAP form is referenced (${names.join(', ')})`);
  const printContent = streamText(printDoc, xobjects.get(PDFName.of(cloudName)));
  assert.equal(printContent, content, 'print form == export /AP form, byte for byte');
  const pageContent = printPage.node.Contents();
  const pageOps = Array.isArray(pageContent?.asArray?.())
    ? pageContent.asArray().map((ref) => streamText(printDoc, ref)).join('\n')
    : streamText(printDoc, printPage.node.get(PDFName.of('Contents')));
  assert.match(pageOps, new RegExp(`/${cloudName} Do`));
  assert.doesNotMatch(printContent, /SMask/);
});

// ---------------------------------------------------------------------------
// Pixel lanes
// ---------------------------------------------------------------------------

test('pixels (SVG raster, librsvg): on-stroke = stroke over page, junction = two runs over page', { skip: has('rsvg-convert') ? false : 'rsvg-convert not installed' }, () => {
  const model = buildCloudSvgPaint(geometry, { fill: object.fill, stroke: object.stroke, maskId: 'cloud-fill-mask-px' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width * SCALE}" height="${PAGE.height * SCALE}" viewBox="0 0 ${PAGE.width} ${PAGE.height}">`
    + `<rect width="${PAGE.width}" height="${PAGE.height}" fill="white"/>${cloudSvgPaintMarkup(model)}</svg>`;
  const svgPath = join(tmp, 'app.svg');
  const pngPath = join(tmp, 'svg.png');
  writeFileSync(svgPath, svg);
  const result = spawnSync('rsvg-convert', ['-b', 'white', '-w', String(PAGE.width * SCALE), '-h', String(PAGE.height * SCALE), '-o', pngPath, svgPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assertKnockoutPixels(PNG.sync.read(readFileSync(pngPath)), 'svg');
});

let nodeCanvas = null;
try { nodeCanvas = await import('canvas'); } catch { nodeCanvas = null; }

test('pixels (canvas painter, node-canvas): the scratch-layer knockout and per-run strokes match the SVG', { skip: nodeCanvas ? false : 'node-canvas not installed' }, () => {
  const canvas = nodeCanvas.createCanvas(PAGE.width * SCALE, PAGE.height * SCALE);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  // An earlier annotation underneath must survive the knockout untouched.
  context.fillStyle = 'rgb(0, 128, 0)';
  context.fillRect(20, 20, 30, 30);
  drawAnnotationObject(context, object, 1);
  const png = PNG.sync.read(canvas.toBuffer('image/png'));
  assertKnockoutPixels(png, 'canvas');
  assert.deepEqual(pixelAt(png, { x: 35, y: 35 }), [0, 128, 0], 'annotations painted earlier are not punched out');
});

let pdfjs = null;
let napiCanvas = null;
try {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  napiCanvas = await import('@napi-rs/canvas');
} catch { pdfjs = null; napiCanvas = null; }

const rasterPdf = async (bytes) => {
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = napiCanvas.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  return PNG.sync.read(canvas.toBuffer('image/png'));
};

test('pixels (pdf.js raster of the exported /AP and of the flattened print)', { skip: pdfjs && napiCanvas ? false : 'pdfjs-dist + @napi-rs/canvas not installed' }, async () => {
  const { annotatedBytes: annotated, flattenedBytes: flattened } = await exports();
  assertKnockoutPixels(await rasterPdf(annotated), 'pdf.js /AP');
  assertKnockoutPixels(await rasterPdf(flattened), 'pdf.js flattened');
});

test('pixels (poppler pdftoppm of the exported /AP)', { skip: has('pdftoppm') ? false : 'pdftoppm not installed' }, async () => {
  const { annotatedBytes: annotated } = await exports();
  const pdfPath = join(tmp, 'annotated.pdf');
  writeFileSync(pdfPath, annotated);
  const result = spawnSync('pdftoppm', ['-r', String(72 * SCALE), '-png', '-singlefile', pdfPath, join(tmp, 'poppler')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assertKnockoutPixels(PNG.sync.read(readFileSync(join(tmp, 'poppler.png'))), 'poppler');
});

// ---------------------------------------------------------------------------
// (c) Width readout: 2.5 is shown, typed, committed and drawn as 2.5.
// ---------------------------------------------------------------------------

test('width readout: line widths keep one decimal, counter/eraser sizes stay whole', () => {
  assert.equal(ANNOTATION_WIDTH_DECIMALS, 1);
  assert.equal(normalizeAnnotationSize(2.5, 1, 50, ANNOTATION_WIDTH_DECIMALS), 2.5);
  assert.equal(normalizeAnnotationSize('2.5', 1, 50, ANNOTATION_WIDTH_DECIMALS), 2.5);
  assert.equal(normalizeAnnotationSize(2.55, 1, 50, ANNOTATION_WIDTH_DECIMALS), 2.6);
  assert.equal(normalizeAnnotationSize('2.', 1, 50, ANNOTATION_WIDTH_DECIMALS), 2);
  assert.equal(normalizeAnnotationSize(0.4, 1, 50, ANNOTATION_WIDTH_DECIMALS), 1, 'clamps to min');
  assert.equal(normalizeAnnotationSize(2.5, 1, 50), 3, 'whole-number fields still round (counter / eraser)');
  assert.equal(sanitizeAnnotationSizeDraft('2.5', ANNOTATION_WIDTH_DECIMALS), '2.5');
  assert.equal(sanitizeAnnotationSizeDraft('2.', ANNOTATION_WIDTH_DECIMALS), '2.');
  assert.equal(sanitizeAnnotationSizeDraft('2.55', ANNOTATION_WIDTH_DECIMALS), null, 'one decimal place only');
  assert.equal(sanitizeAnnotationSizeDraft('2.5'), null, 'whole-number fields reject decimals');
  assert.equal(sanitizeAnnotationSizeDraft('-2', ANNOTATION_WIDTH_DECIMALS), null);
});

test('width readout: the Width control, shells and viewer handlers all carry the decimal contract', () => {
  const control = read('../src/components/AnnotationSizeControl.jsx');
  assert.match(control, /decimals = 0,/);
  assert.match(control, /normalizeAnnotationSize\(rawValueText, min, max, decimals\)/);
  assert.match(control, /sanitizeAnnotationSizeDraft\(next, decimals\)/);
  assert.match(control, /inputMode: allowsDecimals \? 'decimal' : 'numeric'/);
  assert.match(control, /event\.key === '\.' && !allowsDecimals/);
  const shell = read('../src/AppShell.jsx');
  assert.match(shell, /decimals=\{bottomToolbarApi\.activeTool === 'eraser' \|\| bottomToolbarApi\.contextTool === 'counter'\s*\? 0\s*: ANNOTATION_WIDTH_DECIMALS\}/);
  const mobile = read('../src/mobile/MobilePdfViewerChrome.jsx');
  assert.equal((mobile.match(/ANNOTATION_WIDTH_DECIMALS/g) || []).length, 3, 'both mobile Width controls');
  const viewer = read('../src/PDFViewer.jsx');
  const change = viewer.slice(viewer.indexOf('const handleStrokeWidthInputChange'), viewer.indexOf('const handleStrokeWidthInputBlur'));
  const blur = viewer.slice(viewer.indexOf('const handleStrokeWidthInputBlur'), viewer.indexOf('// Handle eraser size input changes'));
  assert.match(change, /sanitizeAnnotationSizeDraft\(value, widthDecimals\)/);
  assert.match(change, /normalizeAnnotationSize\(value, minWidth, maxWidth, widthDecimals\)/);
  assert.doesNotMatch(change, /parseInt/, 'typing 2.5 must not truncate to 2');
  assert.doesNotMatch(blur, /parseInt/, 'committing 2.5 must not truncate to 2');
  assert.match(blur, /ANNOTATION_WIDTH_DECIMALS/);
  // The Cloud style default that motivated this is still 2.5.
  const database = read('../src/hooks/useDatabase.js');
  assert.match(database, /cloud: \{ strokeColor: '#c42747', strokeWidth: 2\.5, strokeOpacity: 100 \}/);
});

// ---------------------------------------------------------------------------
// Multiply blend (2026-09-10). The canvas painter (applyBlendAndOpacity) and
// the exported /AP (a /BM /Multiply ExtGState in buildCloudAppearance) both
// honoured globalCompositeOperation:'multiply'; CloudOutline never emitted
// mix-blend-mode, so a multiply cloud over a coloured backdrop rasterised
// (74,89,26) on screen against (0,82,0) in every other lane. Every plain shape
// branch in svgAnnotationRenderers.jsx sets mixBlendMode from the same flag -
// the cloud branch was the one that did not.
// ---------------------------------------------------------------------------

test('a multiply cloud emits mix-blend-mode on screen, exactly like every plain shape', () => {
  const svg = read('../src/utils/svgAnnotationRenderers.jsx');
  const cloudOutline = svg.slice(svg.indexOf('const CloudOutline = ('), svg.indexOf('export const TEXT_PADDING'));
  assert.match(cloudOutline, /style=\{multiply \? \{ mixBlendMode: 'multiply' \} : undefined\}/,
    'the cloud group carries the blend');
  // Every one of the four cloud branches (rect, polygon, polyline, ellipse)
  // has to pass the flag, or one shape type silently keeps the old behaviour.
  assert.equal((svg.match(/multiply=\{obj\.globalCompositeOperation === 'multiply'\}/g) || []).length, 4,
    'all four cloud render branches pass it');
});

test('pixels (multiply): the SVG paint model matches the canvas painter over a coloured backdrop', {
  skip: has('rsvg-convert') && nodeCanvas ? false : 'rsvg-convert + node-canvas not installed',
}, () => {
  const blended = { ...object, globalCompositeOperation: 'multiply', opacity: 0.5 };
  const backdrop = { x: 40, y: 30, width: 240, height: 180, color: 'rgb(30, 160, 60)' };
  const model = buildCloudSvgPaint(geometry, { fill: blended.fill, stroke: blended.stroke, maskId: 'cloud-multiply' });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width * SCALE}" height="${PAGE.height * SCALE}" viewBox="0 0 ${PAGE.width} ${PAGE.height}">`
    + `<rect width="${PAGE.width}" height="${PAGE.height}" fill="white"/>`
    + `<rect x="${backdrop.x}" y="${backdrop.y}" width="${backdrop.width}" height="${backdrop.height}" fill="${backdrop.color}"/>`
    + cloudSvgPaintMarkup(model, { opacity: blended.opacity, multiply: true })
    + '</svg>';
  const svgPath = join(tmp, 'multiply.svg');
  const pngPath = join(tmp, 'multiply-svg.png');
  writeFileSync(svgPath, svg);
  const result = spawnSync('rsvg-convert', ['-b', 'white', '-w', String(PAGE.width * SCALE), '-h', String(PAGE.height * SCALE), '-o', pngPath, svgPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const svgPng = PNG.sync.read(readFileSync(pngPath));

  const canvas = nodeCanvas.createCanvas(PAGE.width * SCALE, PAGE.height * SCALE);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  context.fillStyle = backdrop.color;
  context.fillRect(backdrop.x, backdrop.y, backdrop.width, backdrop.height);
  drawAnnotationObject(context, blended, 1);
  const canvasPng = PNG.sync.read(canvas.toBuffer('image/png'));

  let over = 0;
  let worst = 0;
  for (let index = 0; index < svgPng.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(svgPng.data[index + channel] - canvasPng.data[index + channel]);
      worst = Math.max(worst, delta);
      if (delta > 8) { over += 1; break; }
    }
  }
  // Before the fix the two lanes were 74/255 apart over ~850k pixels: the SVG
  // painted the cloud NORMAL while the painter multiplied it.
  assert.ok(over < svgPng.width * svgPng.height * 0.002, `${over} pixels differ by more than 8/255 (worst ${worst})`);
});
