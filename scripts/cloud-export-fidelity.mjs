#!/usr/bin/env node
// Cloud export fidelity harness (2026-09-09).
//
// Proves - WITHOUT the app - that an exported / flattened PDF shows every
// cloud shape in third-party viewers exactly where and how the app draws it,
// on every page frame the app can meet:
//
//   1. builds one fabric cloud object per case (rect, ellipse, tilted ellipse,
//      polygon, polyline; several Bump values; filled / translucent / tilted
//      cases; edge-hugging and full-page shapes) on a set of PAGE FRAMES -
//      an unrotated page, /Rotate 90 / 180 / 270 pages, pages whose MediaBox
//      or CropBox does not start at (0, 0), and small pages (A6, A5, half
//      letter) - and exports each through the app's real exporter twice: as
//      an annotated PDF (/Annots with /AP /N) and as a flattened print PDF;
//   2. rasterises the app's own on-screen SVG for that object (the exact
//      CloudOutline markup: scalloped fill under the round-capped outline) in
//      the app's page frame (pdf.js' default viewport: CropBox-sized, /Rotate
//      applied) with librsvg, at the same DPI;
//   3. rasterises the PDFs with INDEPENDENT renderers - pdf.js (node/canvas),
//      poppler's pdftoppm and pdftocairo, and macOS Quartz (qlmanage) when
//      installed - and compares each against the SVG raster with metrics that
//      catch a half-point shift: the ink centroid delta, the symmetric
//      Hausdorff distance between the ink masks (exact Euclidean distance
//      transform), the ink bounding box, and the older structural pixel count;
//   4. re-imports the annotated PDF WITH and WITHOUT the app's metadata and
//      checks the object lands at the same place with the same crowns;
//   5. writes rasters + diff images + a JSON/markdown report to --out.
//
//   node scripts/cloud-export-fidelity.mjs --out /tmp/cloud-fidelity [--scale 4]
//        [--pages base,rot90,...] [--only rect-bump2,...]
//
// pdf.js 6 renders in Node through @napi-rs/canvas; the repo does not ship it,
// so point CLOUD_FIDELITY_PDFJS_DIR at a node_modules holding pdfjs-dist +
// @napi-rs/canvas (a scratch install) to enable the pdf.js raster lane and the
// re-import checks. Without it those lanes are skipped, not faked.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  cloudCommandsToPathData,
  resolveCloudAnnotationGeometry,
  sampleCloudCommands,
  transformCloudCommandsToWorld,
} from '../src/utils/cloudAnnotationGeometry.js';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] != null ? args[index + 1] : fallback;
};
const OUT = argValue('--out', join(process.cwd(), 'debug', 'cloud-export-fidelity'));
const SCALE = Number(argValue('--scale', '4'));
const DPI = 72 * SCALE;
const ONLY_PAGES = argValue('--pages', '').split(',').filter(Boolean);
const ONLY_CASES = argValue('--only', '').split(',').filter(Boolean);
const STROKE = '#c42747';
const FILL = 'rgba(196, 39, 71, 0.25)';

// In-app capture mode: `--fixture <pdf> --page <n> --capture <json>` exports
// ONE object captured from the running app (its fabric object plus the exact
// SVG path `d` and group transform read from the app's DOM) onto page <n> of a
// real fixture, and judges the PDF renderers against the app's own markup.
const FIXTURE = argValue('--fixture', '');
const FIXTURE_PAGE = Number(argValue('--page', '1'));
const CAPTURE = argValue('--capture', '') ? JSON.parse(readFileSync(argValue('--capture', ''), 'utf8')) : null;

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Page frames. `mediaBox` / `cropBox` are PDF user-space boxes [x0 y0 x1 y1];
// `rotate` is the page's /Rotate. The app's frame for each is whatever pdf.js
// reports as the default viewport (measured below, never assumed).
// ---------------------------------------------------------------------------
const PAGE_FRAMES = {
  base: { mediaBox: [0, 0, 320, 240] },
  rot90: { mediaBox: [0, 0, 320, 240], rotate: 90 },
  rot180: { mediaBox: [0, 0, 320, 240], rotate: 180 },
  rot270: { mediaBox: [0, 0, 320, 240], rotate: 270 },
  'offset-box': { mediaBox: [100, 50, 420, 290] },
  'offset-box-rot90': { mediaBox: [100, 50, 420, 290], rotate: 90 },
  'cropbox-inside-mediabox': { mediaBox: [0, 0, 500, 400], cropBox: [60, 40, 380, 280] },
  'cropbox-inside-mediabox-rot270': { mediaBox: [0, 0, 500, 400], cropBox: [60, 40, 380, 280], rotate: 270 },
  a6: { mediaBox: [0, 0, 298, 420] },
  a5: { mediaBox: [0, 0, 420, 595] },
  'half-letter': { mediaBox: [0, 0, 396, 612] },
  'a5-rot90': { mediaBox: [0, 0, 420, 595], rotate: 90 },
};

// ---------------------------------------------------------------------------
// Shape cases, authored in the APP frame (fractions of the frame so every
// page size gets the same coverage). `edge` cases hug or fill the page.
// ---------------------------------------------------------------------------
const frameCases = (frame) => {
  if (CAPTURE) {
    return [{ name: CAPTURE.name || 'app-capture', object: CAPTURE.object, dom: CAPTURE.d ? { d: CAPTURE.d, transform: CAPTURE.group?.transform, stroke: CAPTURE.path?.stroke, strokeWidth: CAPTURE.path?.strokeWidth, opacity: CAPTURE.group?.opacity } : null }];
  }
  const W = frame.width; const H = frame.height;
  const r = (fx, fy, fw, fh) => ({ left: Math.round(W * fx), top: Math.round(H * fy), width: Math.round(W * fw), height: Math.round(H * fh) });
  const cases = [];
  for (const bump of [2, 4]) {
    const box = r(0.19, 0.21, 0.62, 0.58);
    cases.push({ name: `rect-bump${bump}`, object: { id: `rect-${bump}`, type: 'rect', ...box, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump } } });
    cases.push({ name: `ellipse-bump${bump}`, object: { id: `ellipse-${bump}`, type: 'ellipse', left: box.left, top: box.top, rx: box.width / 2, ry: box.height / 2, width: box.width, height: box.height, angle: 0, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump } } });
    cases.push({ name: `ellipse-rotated-bump${bump}`, object: { id: `ellipse-rot-${bump}`, type: 'ellipse', left: box.left, top: box.top, rx: box.width / 2, ry: box.height / 2.4, width: box.width, height: box.height / 1.2, angle: 32, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump } } });
    const poly = r(0.16, 0.17, 0.69, 0.67);
    cases.push({ name: `polygon-bump${bump}`, object: { id: `polygon-${bump}`, type: 'polygon', left: poly.left, top: poly.top, points: [{ x: 0, y: poly.height * 0.19 }, { x: poly.width * 0.5, y: 0 }, { x: poly.width, y: poly.height * 0.25 }, { x: poly.width * 0.86, y: poly.height * 0.94 }, { x: poly.width * 0.27, y: poly.height }], pathOffset: { x: 0, y: 0 }, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump } } });
    const line = r(0.12, 0.25, 0.75, 0.46);
    cases.push({ name: `polyline-bump${bump}`, object: { id: `polyline-${bump}`, type: 'polyline', left: line.left, top: line.top, points: [{ x: 0, y: line.height * 0.9 }, { x: line.width * 0.33, y: 0 }, { x: line.width * 0.67, y: line.height }, { x: line.width, y: line.height * 0.18 }], pathOffset: { x: 0, y: 0 }, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump } } });
  }
  const filled = r(0.19, 0.21, 0.62, 0.58);
  cases.push({ name: 'rect-filled-translucent', object: { id: 'rect-filled', type: 'rect', ...filled, stroke: STROKE, strokeWidth: 2.5, fill: FILL, data: { pdfCloudIntensity: 2 } } });
  cases.push({ name: 'ellipse-filled-opacity60', object: { id: 'ellipse-filled', type: 'ellipse', left: filled.left, top: filled.top, rx: filled.width / 2, ry: filled.height / 2, width: filled.width, height: filled.height, angle: 0, opacity: 0.6, stroke: STROKE, strokeWidth: 3, fill: FILL, data: { pdfCloudIntensity: 3 } } });
  const tilted = r(0.22, 0.25, 0.56, 0.5);
  cases.push({ name: 'rect-rotated-filled', object: { id: 'rect-rot', type: 'rect', ...tilted, angle: 20, stroke: STROKE, strokeWidth: 2.5, fill: FILL, data: { pdfCloudIntensity: 2 } } });
  const wide = r(0.16, 0.17, 0.69, 0.67);
  cases.push({ name: 'polygon-filled-wide', object: { id: 'polygon-filled', type: 'polygon', left: wide.left, top: wide.top, points: [{ x: 0, y: wide.height * 0.19 }, { x: wide.width * 0.5, y: 0 }, { x: wide.width, y: wide.height * 0.25 }, { x: wide.width * 0.86, y: wide.height * 0.94 }, { x: wide.width * 0.27, y: wide.height }], pathOffset: { x: 0, y: 0 }, stroke: STROKE, strokeWidth: 5, fill: FILL, data: { pdfCloudIntensity: 3 } } });
  cases.push({ name: 'polygon-scaled-tilted', object: { id: 'polygon-scaled', type: 'polygon', left: Math.round(W * 0.2), top: Math.round(H * 0.2), points: [{ x: 0, y: 30 }, { x: W * 0.35, y: 0 }, { x: W * 0.6, y: 40 }, { x: W * 0.55, y: H * 0.5 }, { x: W * 0.2, y: H * 0.55 }], pathOffset: { x: 0, y: 0 }, scaleX: 0.9, scaleY: 1.1, angle: 25, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 } } });
  // Edge-hugging and full-page shapes: the scalloped appearance box bleeds off
  // the page while the base geometry sits exactly on its edge.
  cases.push({ name: 'edge-rect-left-bump6', edge: true, object: { id: 'edge-left', type: 'rect', left: 0, top: Math.round(H * 0.2), width: Math.round(W * 0.45), height: Math.round(H * 0.45), stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 6 } } });
  cases.push({ name: 'edge-rect-corner-bump2', edge: true, object: { id: 'edge-corner', type: 'rect', left: Math.round(W * 0.55), top: Math.round(H * 0.55), width: W - Math.round(W * 0.55), height: H - Math.round(H * 0.55), stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 } } });
  cases.push({ name: 'edge-rect-fullpage-bump2', edge: true, object: { id: 'edge-full', type: 'rect', left: 0, top: 0, width: W, height: H, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 } } });
  cases.push({ name: 'edge-ellipse-top-bump4', edge: true, object: { id: 'edge-ellipse', type: 'ellipse', left: Math.round(W * 0.2), top: 0, rx: Math.round(W * 0.3), ry: Math.round(H * 0.2), width: Math.round(W * 0.6), height: Math.round(H * 0.4), angle: 0, stroke: STROKE, strokeWidth: 2.5, fill: FILL, data: { pdfCloudIntensity: 4 } } });
  cases.push({ name: 'edge-polygon-bottom-bump3', edge: true, object: { id: 'edge-polygon', type: 'polygon', left: 0, top: Math.round(H * 0.5), points: [{ x: 0, y: H - Math.round(H * 0.5) }, { x: Math.round(W * 0.3), y: 0 }, { x: W, y: Math.round(H * 0.1) }, { x: W, y: H - Math.round(H * 0.5) }], pathOffset: { x: 0, y: 0 }, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 3 } } });
  cases.push({ name: 'edge-polyline-right-bump2', edge: true, object: { id: 'edge-polyline', type: 'polyline', left: Math.round(W * 0.4), top: Math.round(H * 0.1), points: [{ x: 0, y: 0 }, { x: W - Math.round(W * 0.4), y: Math.round(H * 0.3) }, { x: Math.round(W * 0.2), y: Math.round(H * 0.7) }], pathOffset: { x: 0, y: 0 }, stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 } } });
  return ONLY_CASES.length ? cases.filter((entry) => ONLY_CASES.includes(entry.name)) : cases;
};

// ---------------------------------------------------------------------------
// Renderers and helpers
// ---------------------------------------------------------------------------
let pdfjs = null;
let createCanvas = null;
try {
  const dir = process.env.CLOUD_FIDELITY_PDFJS_DIR;
  if (dir) {
    pdfjs = await import(join(dir, 'pdfjs-dist/legacy/build/pdf.mjs'));
    ({ createCanvas } = await import(join(dir, '@napi-rs/canvas/index.js')));
  } else {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    ({ createCanvas } = await import('@napi-rs/canvas'));
  }
} catch (error) {
  pdfjs = null;
  createCanvas = null;
  console.warn('[fidelity] pdf.js raster + re-import lanes skipped (set CLOUD_FIDELITY_PDFJS_DIR):', error?.message);
}

const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};

const quiet = async (fn) => {
  const log = console.log; const error = console.error; const warn = console.warn;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.error = error; console.warn = warn; }
};

const makePdfFile = async (frame) => {
  let bytes;
  if (frame.fixture) {
    // One page of a real fixture - its boxes and /Rotate - with its own
    // annotations and page content removed so the only ink measured is the
    // exported cloud.
    const fixture = await PDFDocument.load(readFileSync(frame.fixture));
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(fixture, [frame.page - 1]);
    copied.node.delete(PDFName.of('Annots'));
    copied.node.delete(PDFName.of('Contents'));
    single.addPage(copied);
    bytes = await single.save();
  } else {
    const [mx0, my0, mx1, my1] = frame.mediaBox;
    const source = await PDFDocument.create();
    const page = source.addPage([mx1 - mx0, my1 - my0]);
    page.setMediaBox(mx0, my0, mx1 - mx0, my1 - my0);
    const [cx0, cy0, cx1, cy1] = frame.cropBox || frame.mediaBox;
    page.setCropBox(cx0, cy0, cx1 - cx0, cy1 - cy0);
    if (frame.rotate) page.node.set(PDFName.of('Rotate'), source.context.obj(frame.rotate));
    bytes = await source.save();
  }
  return {
    name: 'frame.pdf',
    bytes,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

// The app's page frame: pdf.js' default viewport (CropBox-sized, /Rotate applied).
const appFrame = async (file) => {
  if (!pdfjs) {
    // Fallback: derive it the way pdf.js does (rotate swaps width/height).
    const frame = file.frameSpec;
    if (!frame?.mediaBox) throw new Error('fixture frames need the pdf.js lane (set CLOUD_FIDELITY_PDFJS_DIR)');
    const box = frame.cropBox || frame.mediaBox;
    const width = box[2] - box[0]; const height = box[3] - box[1];
    return (frame.rotate || 0) % 180 === 90 ? { width: height, height: width } : { width, height };
  }
  const task = pdfjs.getDocument({ data: Uint8Array.from(file.bytes), disableWorker: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const viewport = (await doc.getPage(1)).getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  } finally {
    await task.destroy();
  }
};

// Metric self-test: CLOUD_FIDELITY_INJECT_ANNOT_SHIFT_PT=<pt> nudges every
// exported /Annots entry (its /Rect and /AP form matrices) by that many points
// in user space AFTER export, so the report must show the shift - proof that
// the comparison catches a sub-point displacement of the /Annots path alone.
const INJECT_ANNOT_SHIFT_PT = Number(process.env.CLOUD_FIDELITY_INJECT_ANNOT_SHIFT_PT || 0);
const injectAnnotShift = async (bytes) => {
  if (!INJECT_ANNOT_SHIFT_PT) return bytes;
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return bytes;
  for (const ref of annots.asArray()) {
    const dict = doc.context.lookup(ref);
    const rect = doc.context.lookup(dict.get(PDFName.of('Rect'))).asArray().map((n) => n.asNumber());
    dict.set(PDFName.of('Rect'), doc.context.obj([rect[0] + INJECT_ANNOT_SHIFT_PT, rect[1], rect[2] + INJECT_ANNOT_SHIFT_PT, rect[3]]));
    const ap = doc.context.lookup(dict.get(PDFName.of('AP')));
    const form = ap && doc.context.lookup(ap.get(PDFName.of('N')));
    const matrix = form?.dict?.get(PDFName.of('Matrix'));
    const values = matrix ? doc.context.lookup(matrix).asArray().map((n) => n.asNumber()) : [1, 0, 0, 1, 0, 0];
    values[4] += INJECT_ANNOT_SHIFT_PT;
    form.dict.set(PDFName.of('Matrix'), doc.context.obj(values));
  }
  return doc.save();
};

const exportAnnotated = (file, frame, object) => quiet(() => withWindow(async () => injectAnnotShift(await savePDFWithAnnotationsPdfLib(
  file,
  { 1: { objects: [object] } },
  { 1: { width: frame.width, height: frame.height } },
  null,
  { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-fidelity' },
))));

const exportFlattened = (file, frame, object) => quiet(() => withWindow(async () => savePDFWithFlattenedRegularAnnotationsForPrint(
  file,
  { 1: { objects: [object] } },
  { 1: { width: frame.width, height: frame.height } },
  { returnBytes: true },
)));

// The app's on-screen markup for a cloud (svgAnnotationRenderers CloudOutline).
// A DOM capture is used verbatim: the path, transform and paint the running
// app actually rendered.
const appSvg = (object, frame, dom = null) => {
  if (dom) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width * SCALE}" height="${frame.height * SCALE}" viewBox="0 0 ${frame.width} ${frame.height}">`
      + `<rect width="${frame.width}" height="${frame.height}" fill="white"/>`
      + `<g transform="${dom.transform || ''}" opacity="${dom.opacity ?? 1}">`
      + `<path d="${dom.d}" fill="none" stroke="${dom.stroke || object.stroke}" stroke-width="${dom.strokeWidth || object.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
      + '</g></svg>';
  }
  const geometry = resolveCloudAnnotationGeometry(object);
  if (!geometry) throw new Error(`not a cloud: ${object.id}`);
  const fillPath = geometry.fill
    ? `<path d="${cloudCommandsToPathData(geometry.fill)}" fill="${object.fill}" fill-rule="nonzero" stroke="none"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width * SCALE}" height="${frame.height * SCALE}" viewBox="0 0 ${frame.width} ${frame.height}">`
    + `<rect width="${frame.width}" height="${frame.height}" fill="white"/>`
    + `<g transform="${geometry.transform}" opacity="${object.opacity ?? 1}">`
    + fillPath
    + `<path d="${cloudCommandsToPathData(geometry.outline)}" fill="none" stroke="${object.stroke || 'transparent'}" stroke-width="${geometry.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
    + '</g></svg>';
};

const run = (command, commandArgs) => spawnSync(command, commandArgs, { encoding: 'utf8' });
const has = (command) => run('which', [command]).status === 0;

const rasterSvg = (svgPath, pngPath, frame) => {
  const result = run('rsvg-convert', ['-b', 'white', '-w', String(frame.width * SCALE), '-h', String(frame.height * SCALE), '-o', pngPath, svgPath]);
  if (result.status !== 0) throw new Error(`rsvg-convert failed: ${result.stderr}`);
};

const rasterPdfjs = async (bytes, pngPath) => {
  if (!pdfjs || !createCanvas) return false;
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    writeFileSync(pngPath, canvas.toBuffer('image/png'));
    return true;
  } finally {
    await task.destroy();
  }
};

// poppler renders the MediaBox unless told otherwise; the app frame is the
// CropBox, so both lanes crop. Both honour /Rotate on their own.
const rasterPoppler = (pdfPath, pngPath) => {
  if (!has('pdftoppm')) return false;
  const prefix = pngPath.replace(/\.png$/, '');
  const result = run('pdftoppm', ['-r', String(DPI), '-cropbox', '-png', '-singlefile', pdfPath, prefix]);
  return result.status === 0 && existsSync(pngPath);
};

const rasterCairo = (pdfPath, pngPath) => {
  if (!has('pdftocairo')) return false;
  const prefix = pngPath.replace(/\.png$/, '');
  const result = run('pdftocairo', ['-r', String(DPI), '-cropbox', '-png', '-singlefile', pdfPath, prefix]);
  return result.status === 0 && existsSync(pngPath);
};

const flattenAlphaOntoWhite = (png) => {
  for (let index = 0; index < png.data.length; index += 4) {
    const alpha = png.data[index + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      png.data[index + channel] = Math.round(png.data[index + channel] * alpha + 255 * (1 - alpha));
    }
    png.data[index + 3] = 255;
  }
  return png;
};

const rasterQuartz = (pdfPath, pngPath, frame) => {
  if (!has('qlmanage')) return false;
  const dir = join(OUT, '_ql');
  mkdirSync(dir, { recursive: true });
  const result = run('qlmanage', ['-t', '-s', String(Math.max(frame.width, frame.height) * SCALE), '-o', dir, pdfPath]);
  const produced = join(dir, `${pdfPath.split('/').pop()}.png`);
  if (result.status !== 0 || !existsSync(produced)) return false;
  // Quicklook thumbnails carry an alpha channel; flatten onto white.
  writeFileSync(pngPath, PNG.sync.write(flattenAlphaOntoWhite(PNG.sync.read(readFileSync(produced)))));
  return true;
};

const readPng = (path) => PNG.sync.read(readFileSync(path));

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
const colourDistance = (a, ai, b, bi) => Math.max(
  Math.abs(a[ai] - b[bi]),
  Math.abs(a[ai + 1] - b[bi + 1]),
  Math.abs(a[ai + 2] - b[bi + 2]),
);

// Pixels that differ AND have no similar pixel within `radius` in the other
// image (both directions) - anti-aliasing never survives this test, a missing
// or displaced scallop does.
const structuralMismatch = (a, b, width, height, radius = 1, tolerance = 40) => {
  let count = 0;
  const check = (from, to) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (colourDistance(from, index, to, index) <= tolerance) continue;
        let matched = false;
        for (let dy = -radius; dy <= radius && !matched; dy += 1) {
          for (let dx = -radius; dx <= radius && !matched; dx += 1) {
            const nx = x + dx; const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (colourDistance(from, index, to, (ny * width + nx) * 4) <= tolerance) matched = true;
          }
        }
        if (!matched) count += 1;
      }
    }
  };
  check(a, b);
  check(b, a);
  return count;
};

// A cloud whose base sits ON the page edge keeps only crown slivers on the
// page, nearly all of them within a couple of points of the edge: too little
// interior ink for a meaningful centroid (see EDGE_ZONE_PT / EDGE_INK_SHARE).
const EDGE_ZONE_PT = 2;
const EDGE_INK_SHARE = 0.75;

// Ink mask: any pixel visibly darker than paper (the crimson stroke and the
// fill both qualify; anti-aliased fringes lighter than this do not).
const inkMask = (data, width, height, threshold = 200) => {
  const mask = new Uint8Array(width * height);
  let count = 0;
  let nearEdge = 0;
  const zone = EDGE_ZONE_PT * SCALE;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (Math.min(data[index], data[index + 1], data[index + 2]) >= threshold) continue;
      mask[y * width + x] = 1;
      count += 1;
      if (x < zone || y < zone || x >= width - zone || y >= height - zone) nearEdge += 1;
    }
  }
  return { mask, count, nearEdge };
};

const maskStats = (mask, width, height) => {
  let count = 0; let sx = 0; let sy = 0;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      count += 1; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!count) return null;
  return {
    count,
    centroid: { x: (sx / count + 0.5) / SCALE, y: (sy / count + 0.5) / SCALE },
    bbox: { left: minX / SCALE, top: minY / SCALE, right: (maxX + 1) / SCALE, bottom: (maxY + 1) / SCALE },
  };
};

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), squared
// distances in pixels from every pixel to the nearest ink pixel of `mask`.
const INF = 1e20;
const edt1d = (f, n, d, v, z) => {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q += 1) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
};
const distanceTransform = (mask, width, height) => {
  const grid = new Float64Array(width * height);
  for (let index = 0; index < grid.length; index += 1) grid[index] = mask[index] ? 0 : INF;
  const size = Math.max(width, height);
  const f = new Float64Array(size); const d = new Float64Array(size);
  const v = new Int32Array(size); const z = new Float64Array(size + 1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = grid[y * width + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x += 1) grid[y * width + x] = d[x];
  }
  return grid;
};

// Directed Hausdorff (max) and its 99th percentile, in points, from the ink
// of `from` to the nearest ink of `to`. Clip-tolerant: renderers disagree on
// whether a crown sliver that only just peeks onto the page gets painted at
// all (poppler's Splash drops a three-pixel sliver on the last rows that
// librsvg, cairo, pdf.js and Quartz all paint), so a pixel never counts for
// more than its own distance to the page edge - a sliver at the edge can only
// contribute the width of the sliver, while a displaced, rotated, mirrored or
// missing crown in the page interior still contributes its full distance.
const directedHausdorff = (fromMask, toDistance, width, height) => {
  const distances = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!fromMask[index]) continue;
      const toEdge = Math.min(x + 1, y + 1, width - x, height - y);
      distances.push(Math.min(Math.sqrt(toDistance[index]), toEdge));
    }
  }
  if (!distances.length) return { max: Infinity, p99: Infinity };
  distances.sort((a, b) => a - b);
  return {
    max: distances[distances.length - 1] / SCALE,
    p99: distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.99))] / SCALE,
  };
};

// Tolerances. Two families of comparison:
//
//  * annotated vs flattened, SAME renderer - the /Annots page-frame mapping
//    under test against the print path (withPrintPageTransform), with the
//    renderer's own rasterisation cancelled out. The ink centroid moves by
//    exactly the shift of the shape, so 0.1pt catches a half-point shift
//    outright; Hausdorff 0.5pt catches a rotated, mirrored or re-shaped cloud.
//  * renderer vs the app's own raster - bounds how far any third-party viewer
//    is from what the app shows. Renderers rasterise strokes differently
//    (pdf.js in node squeezes horizontal strokes on a rotated letter page by
//    a pixel, poppler's Splash paints rounder caps), which alone moves a
//    centroid by up to ~0.35pt at 288 dpi, so this family allows 0.5pt on the
//    centroid and 1pt Hausdorff (one pixel is 0.25pt). The structural count is
//    the older anti-aliasing-proof pixel test kept for continuity.
const SAME_RENDERER_CENTROID_TOLERANCE_PT = 0.1;
const SAME_RENDERER_HAUSDORFF_TOLERANCE_PT = 0.5;
const CENTROID_TOLERANCE_PT = 0.5;
const HAUSDORFF_TOLERANCE_PT = 1.0;
const STRUCTURAL_TOLERANCE_PCT = 0.05;

const compare = (referencePath, candidatePath, diffPath, tolerances = { centroid: CENTROID_TOLERANCE_PT, hausdorff: HAUSDORFF_TOLERANCE_PT }) => {
  const reference = readPng(referencePath);
  const candidate = readPng(candidatePath);
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    return { pass: false, error: `size mismatch ${reference.width}x${reference.height} vs ${candidate.width}x${candidate.height}` };
  }
  const { width, height } = reference;
  const diff = new PNG({ width, height });
  const differing = pixelmatch(reference.data, candidate.data, diff.data, width, height, { threshold: 0.15, includeAA: false });
  writeFileSync(diffPath, PNG.sync.write(diff));
  const structural = structuralMismatch(reference.data, candidate.data, width, height);
  const inkA = inkMask(reference.data, width, height);
  const inkB = inkMask(candidate.data, width, height);
  const statsA = maskStats(inkA.mask, width, height);
  const statsB = maskStats(inkB.mask, width, height);
  if (!statsA || !statsB) {
    return { pass: false, error: `no ink: reference=${inkA.count} candidate=${inkB.count}`, inkReference: inkA.count, inkCandidate: inkB.count };
  }
  const distanceA = distanceTransform(inkA.mask, width, height);
  const distanceB = distanceTransform(inkB.mask, width, height);
  const aToB = directedHausdorff(inkA.mask, distanceB, width, height);
  const bToA = directedHausdorff(inkB.mask, distanceA, width, height);
  // Edge-dominated ink (most of it within EDGE_ZONE_PT of the page edge) is
  // judged by Hausdorff alone: its centroid only measures how each renderer
  // clips the edge.
  const edgeDominated = inkA.nearEdge >= inkA.count * EDGE_INK_SHARE || inkB.nearEdge >= inkB.count * EDGE_INK_SHARE;
  const centroidDelta = edgeDominated ? null : {
    x: statsB.centroid.x - statsA.centroid.x,
    y: statsB.centroid.y - statsA.centroid.y,
  };
  const centroidDistance = centroidDelta ? Math.hypot(centroidDelta.x, centroidDelta.y) : null;
  const hausdorff = Math.max(aToB.max, bToA.max);
  const hausdorffP99 = Math.max(aToB.p99, bToA.p99);
  const bboxDelta = ['left', 'top', 'right', 'bottom'].map((key) => statsB.bbox[key] - statsA.bbox[key]);
  const structuralPct = (structural / (width * height)) * 100;
  return {
    pixels: width * height,
    inkReference: inkA.count,
    inkCandidate: inkB.count,
    inkRatio: Number((inkB.count / inkA.count).toFixed(4)),
    differing,
    differingPct: Number(((differing / (width * height)) * 100).toFixed(4)),
    structural,
    structuralPct: Number(structuralPct.toFixed(4)),
    edgeDominated,
    centroidDeltaPt: centroidDelta ? { x: Number(centroidDelta.x.toFixed(4)), y: Number(centroidDelta.y.toFixed(4)) } : null,
    centroidDistancePt: centroidDistance === null ? null : Number(centroidDistance.toFixed(4)),
    hausdorffPt: Number(hausdorff.toFixed(4)),
    hausdorffP99Pt: Number(hausdorffP99.toFixed(4)),
    bboxDeltaPt: bboxDelta.map((value) => Number(value.toFixed(3))),
    pass: (edgeDominated || centroidDistance <= tolerances.centroid)
      && hausdorff <= tolerances.hausdorff
      && structuralPct <= STRUCTURAL_TOLERANCE_PCT,
  };
};

// ---------------------------------------------------------------------------
// Re-import: the annotated PDF read back WITH and WITHOUT the app's private
// metadata must land the object at the same place with the same crowns.
// ---------------------------------------------------------------------------
const paintedCrowns = (object) => {
  const geometry = resolveCloudAnnotationGeometry(object);
  if (!geometry) return null;
  const world = transformCloudCommandsToWorld(geometry.outline, geometry);
  const points = sampleCloudCommands(world, 6).flat();
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity; let sx = 0; let sy = 0;
  for (const point of points) {
    if (point.x < minX) minX = point.x; if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y; if (point.y > maxY) maxY = point.y;
    sx += point.x; sy += point.y;
  }
  return { commands: geometry.outline.length, points, bounds: [minX, minY, maxX, maxY], centroid: { x: sx / points.length, y: sy / points.length } };
};

const pointSetHausdorff = (a, b) => {
  const directed = (from, to) => {
    let worst = 0;
    for (const p of from) {
      let best = Infinity;
      for (const q of to) {
        const dx = p.x - q.x; const dy = p.y - q.y;
        const distance = dx * dx + dy * dy;
        if (distance < best) best = distance;
      }
      if (best > worst) worst = best;
    }
    return Math.sqrt(worst);
  };
  return Math.max(directed(a, b), directed(b, a));
};

const REIMPORT_HAUSDORFF_TOLERANCE_PT = { withMetadata: 1e-6, withoutMetadata: 1.0 };

const reimport = async (bytes, stripMetadata) => {
  if (!pdfjs) return null;
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (stripMetadata && annots instanceof PDFArray) {
    annots.asArray().forEach((ref) => doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation')));
  }
  const saved = await doc.save();
  const task = pdfjs.getDocument({ data: Uint8Array.from(saved), disableWorker: true, verbosity: 0 });
  const pdfDoc = await task.promise;
  try {
    const imported = await quiet(() => importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: saved }));
    return imported.annotationsByPage?.[1]?.objects || [];
  } finally {
    await task.destroy();
  }
};

const reimportCheck = async (bytes, object, label) => {
  const objects = await reimport(bytes, label === 'withoutMetadata');
  if (objects === null) return { skipped: true };
  const drawn = paintedCrowns(object);
  const candidates = objects.map(paintedCrowns).filter(Boolean);
  if (candidates.length !== 1 || !drawn) {
    return { pass: false, error: `expected one cloud back, got ${candidates.length} of ${objects.length} objects` };
  }
  const [back] = candidates;
  const hausdorff = pointSetHausdorff(drawn.points, back.points);
  const centroid = Math.hypot(back.centroid.x - drawn.centroid.x, back.centroid.y - drawn.centroid.y);
  return {
    commands: [drawn.commands, back.commands],
    sameCommandCount: drawn.commands === back.commands,
    centroidDistancePt: Number(centroid.toFixed(6)),
    hausdorffPt: Number(hausdorff.toFixed(6)),
    boundsDeltaPt: back.bounds.map((value, index) => Number((value - drawn.bounds[index]).toFixed(4))),
    pass: hausdorff <= REIMPORT_HAUSDORFF_TOLERANCE_PT[label] && centroid <= CENTROID_TOLERANCE_PT,
  };
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const report = [];
const frames = FIXTURE
  ? { [`fixture-p${FIXTURE_PAGE}`]: { fixture: FIXTURE, page: FIXTURE_PAGE } }
  : PAGE_FRAMES;
const frameNames = Object.keys(frames).filter((name) => !ONLY_PAGES.length || ONLY_PAGES.includes(name));
for (const frameName of frameNames) {
  const spec = frames[frameName];
  const file = await makePdfFile(spec);
  file.frameName = frameName;
  file.frameSpec = spec;
  const frame = await appFrame(file);
  const frameDir = join(OUT, frameName);
  mkdirSync(frameDir, { recursive: true });
  console.log(spec.fixture
    ? `\n== page ${frameName}: ${spec.fixture} page ${spec.page} -> app frame ${frame.width}x${frame.height}`
    : `\n== page ${frameName}: MediaBox ${JSON.stringify(spec.mediaBox)} CropBox ${JSON.stringify(spec.cropBox || spec.mediaBox)} /Rotate ${spec.rotate || 0} -> app frame ${frame.width}x${frame.height}`);
  for (const entry of frameCases(frame)) {
    const base = join(frameDir, entry.name);
    const annotatedPdf = `${base}.annotated.pdf`;
    const flattenedPdf = `${base}.flattened.pdf`;
    const annotatedBytes = await exportAnnotated(file, frame, entry.object);
    const flattenedBytes = await exportFlattened(file, frame, entry.object);
    writeFileSync(annotatedPdf, annotatedBytes);
    writeFileSync(flattenedPdf, flattenedBytes);
    const svgPath = `${base}.app.svg`;
    const appPng = `${base}.app.png`;
    writeFileSync(svgPath, appSvg(entry.object, frame, entry.dom));
    rasterSvg(svgPath, appPng, frame);

    const annotCount = (await PDFDocument.load(annotatedBytes)).getPage(0).node.lookup(PDFName.of('Annots'));
    const results = {
      page: frameName,
      frame,
      case: entry.name,
      edge: Boolean(entry.edge),
      annotsWritten: annotCount instanceof PDFArray ? annotCount.size() : 0,
      renderers: {},
      reimport: {},
    };
    const renderers = [
      ['pdfjs', (pdf, png) => rasterPdfjs(readFileSync(pdf), png)],
      ['poppler', rasterPoppler],
      ['cairo', rasterCairo],
      ['quartz', (pdf, png) => rasterQuartz(pdf, png, frame)],
    ];
    for (const [kind, pdfPath] of [['annotated', annotatedPdf], ['flattened', flattenedPdf]]) {
      for (const [name, raster] of renderers) {
        const png = `${base}.${kind}.${name}.png`;
        // eslint-disable-next-line no-await-in-loop
        const ok = await raster(pdfPath, png);
        if (!ok) {
          results.renderers[`${kind}.${name}`] = { skipped: true };
          continue;
        }
        results.renderers[`${kind}.${name}`] = compare(appPng, png, `${base}.${kind}.${name}.diff.png`);
      }
    }
    // The /Annots path against the print path under the same renderer.
    for (const [name] of renderers) {
      const annotatedPng = `${base}.annotated.${name}.png`;
      const flattenedPng = `${base}.flattened.${name}.png`;
      if (!existsSync(annotatedPng) || !existsSync(flattenedPng)) {
        results.renderers[`annotated-vs-flattened.${name}`] = { skipped: true };
        continue;
      }
      results.renderers[`annotated-vs-flattened.${name}`] = compare(
        flattenedPng,
        annotatedPng,
        `${base}.annotated-vs-flattened.${name}.diff.png`,
        { centroid: SAME_RENDERER_CENTROID_TOLERANCE_PT, hausdorff: SAME_RENDERER_HAUSDORFF_TOLERANCE_PT },
      );
    }
    for (const label of ['withMetadata', 'withoutMetadata']) {
      // eslint-disable-next-line no-await-in-loop
      results.reimport[label] = await reimportCheck(annotatedBytes, entry.object, label);
    }
    report.push(results);
    const summary = Object.entries(results.renderers)
      .map(([name, result]) => (result.skipped ? `${name}:skip` : `${name}:${result.pass ? 'ok' : 'FAIL'}(c${result.centroidDistancePt ?? '?'} h${result.hausdorffPt ?? '?'})`))
      .join(' ');
    const reimportSummary = Object.entries(results.reimport)
      .map(([name, result]) => (result.skipped ? `${name}:skip` : `${name}:${result.pass ? 'ok' : 'FAIL'}(${result.commands ? result.commands.join('/') : result.error} h${result.hausdorffPt ?? '?'})`))
      .join(' ');
    console.log(`${entry.name.padEnd(28)} annots=${results.annotsWritten} ${summary} | ${reimportSummary}`);
  }
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({
  scale: SCALE,
  dpi: DPI,
  tolerances: { sameRendererCentroidPt: SAME_RENDERER_CENTROID_TOLERANCE_PT, sameRendererHausdorffPt: SAME_RENDERER_HAUSDORFF_TOLERANCE_PT, centroidPt: CENTROID_TOLERANCE_PT, hausdorffPt: HAUSDORFF_TOLERANCE_PT, structuralPct: STRUCTURAL_TOLERANCE_PCT, reimportHausdorffPt: REIMPORT_HAUSDORFF_TOLERANCE_PT },
  pages: frames,
  capture: CAPTURE ? { name: CAPTURE.name, source: CAPTURE.source, object: CAPTURE.object } : null,
  cases: report,
}, null, 2));

const lines = [
  `Scale ${SCALE} (${DPI} dpi). Reference = the app's own SVG raster (librsvg) in the app's page frame (pdf.js default viewport: CropBox-sized, /Rotate applied).`,
  `Pass, renderer vs app = ink centroid within ${CENTROID_TOLERANCE_PT}pt, clip-tolerant symmetric Hausdorff within ${HAUSDORFF_TOLERANCE_PT}pt, structural pixels <= ${STRUCTURAL_TOLERANCE_PCT}%.`,
  `Pass, annotated vs flattened under the same renderer (the /Annots page-frame mapping against the print path) = centroid within ${SAME_RENDERER_CENTROID_TOLERANCE_PT}pt, Hausdorff within ${SAME_RENDERER_HAUSDORFF_TOLERANCE_PT}pt.`,
  '',
  '| page | case | renderer | annots | centroid dpt | hausdorff pt (p99) | bbox dpt | ink ratio | structural px | pass |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
let failures = 0;
let compared = 0;
for (const entry of report) {
  for (const [name, result] of Object.entries(entry.renderers)) {
    if (result.skipped) {
      lines.push(`| ${entry.page} | ${entry.case} | ${name} | ${entry.annotsWritten} | skipped | | | | | |`);
      continue;
    }
    compared += 1;
    if (!result.pass) failures += 1;
    if (result.error) {
      lines.push(`| ${entry.page} | ${entry.case} | ${name} | ${entry.annotsWritten} | ${result.error} | | | | | NO |`);
      continue;
    }
    lines.push(`| ${entry.page} | ${entry.case} | ${name} | ${entry.annotsWritten} | ${result.edgeDominated ? 'edge-dominated' : result.centroidDistancePt} | ${result.hausdorffPt} (${result.hausdorffP99Pt}) | ${result.bboxDeltaPt.join(', ')} | ${result.inkRatio} | ${result.structural} | ${result.pass ? 'yes' : 'NO'} |`);
  }
}
lines.push('', '| page | case | re-import | commands (drawn/back) | centroid dpt | hausdorff pt | bounds dpt | pass |', '|---|---|---|---|---|---|---|---|');
let reimportFailures = 0;
let reimportCompared = 0;
for (const entry of report) {
  for (const [name, result] of Object.entries(entry.reimport)) {
    if (result.skipped) {
      lines.push(`| ${entry.page} | ${entry.case} | ${name} | skipped | | | | |`);
      continue;
    }
    reimportCompared += 1;
    if (!result.pass) reimportFailures += 1;
    if (result.error) {
      lines.push(`| ${entry.page} | ${entry.case} | ${name} | ${result.error} | | | | NO |`);
      continue;
    }
    lines.push(`| ${entry.page} | ${entry.case} | ${name} | ${result.commands.join(' / ')} | ${result.centroidDistancePt} | ${result.hausdorffPt} | ${result.boundsDeltaPt.join(', ')} | ${result.pass ? 'yes' : 'NO'} |`);
  }
}
lines.push('', `${compared - failures}/${compared} renderer comparisons within tolerance; ${reimportCompared - reimportFailures}/${reimportCompared} re-import checks within tolerance.`);
writeFileSync(join(OUT, 'report.md'), `${lines.join('\n')}\n`);
console.log(`\nreport: ${join(OUT, 'report.md')}`);
console.log(lines[lines.length - 1]);
if (failures > 0 || reimportFailures > 0) process.exit(1);
