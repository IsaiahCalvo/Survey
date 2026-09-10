#!/usr/bin/env node
// Cloud export fidelity harness (2026-09-09).
//
// Proves - WITHOUT the app - that an exported / flattened PDF shows every
// cloud shape in third-party viewers exactly as the app draws it:
//
//   1. builds one fabric cloud object per case (rect, ellipse, tilted ellipse,
//      polygon, polyline; two Bump values; a filled + translucent case and a
//      tilted rect) and exports it through the app's real exporter twice -
//      as an annotated PDF (/Annots with /AP /N) and as a flattened print PDF;
//   2. rasterises the app's own on-screen SVG for that object (the exact
//      CloudOutline markup: scalloped fill under the round-capped outline)
//      with librsvg, at the same DPI;
//   3. rasterises the PDFs with INDEPENDENT renderers - pdf.js (node/canvas),
//      poppler's pdftoppm and macOS Quartz (qlmanage) when installed - and
//      pixel-diffs each against the SVG raster;
//   4. writes rasters + diff images + a JSON/markdown report to --out.
//
// A "structural" pixel is one that differs and has no similar pixel within a
// one-pixel neighbourhood in the other image, i.e. beyond anti-aliasing.
//
//   node scripts/cloud-export-fidelity.mjs --out /tmp/cloud-fidelity [--scale 2]

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { PDFDocument } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveCloudAnnotationGeometry } from '../src/utils/cloudAnnotationGeometry.js';
import { buildCloudSvgPaint, cloudSvgPaintMarkup } from '../src/utils/cloudSvgPaint.js';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] != null ? args[index + 1] : fallback;
};
const OUT = argValue('--out', join(process.cwd(), 'debug', 'cloud-export-fidelity'));
const SCALE = Number(argValue('--scale', '2'));
const DPI = 72 * SCALE;
const PAGE = { width: 320, height: 240 };
const STROKE = '#c42747';
const FILL = 'rgba(196, 39, 71, 0.25)';

mkdirSync(OUT, { recursive: true });

const cases = [];
for (const bump of [2, 4]) {
  cases.push({
    name: `rect-bump${bump}`,
    object: {
      id: `rect-${bump}`, type: 'rect', left: 60, top: 50, width: 200, height: 140,
      stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump },
    },
  });
  cases.push({
    name: `ellipse-bump${bump}`,
    object: {
      id: `ellipse-${bump}`, type: 'ellipse', left: 60, top: 50, rx: 100, ry: 70,
      width: 200, height: 140, angle: 0,
      stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump },
    },
  });
  cases.push({
    name: `ellipse-rotated-bump${bump}`,
    object: {
      id: `ellipse-rot-${bump}`, type: 'ellipse', left: 60, top: 50, rx: 100, ry: 60,
      width: 200, height: 120, angle: 32,
      stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump },
    },
  });
  cases.push({
    name: `polygon-bump${bump}`,
    object: {
      id: `polygon-${bump}`, type: 'polygon', left: 50, top: 40,
      points: [{ x: 0, y: 30 }, { x: 110, y: 0 }, { x: 220, y: 40 }, { x: 190, y: 150 }, { x: 60, y: 160 }],
      pathOffset: { x: 0, y: 0 },
      stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump },
    },
  });
  cases.push({
    name: `polyline-bump${bump}`,
    object: {
      id: `polyline-${bump}`, type: 'polyline', left: 40, top: 60,
      points: [{ x: 0, y: 100 }, { x: 80, y: 0 }, { x: 160, y: 110 }, { x: 240, y: 20 }],
      pathOffset: { x: 0, y: 0 },
      stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump },
    },
  });
}
cases.push({
  name: 'rect-filled-translucent',
  object: {
    id: 'rect-filled', type: 'rect', left: 60, top: 50, width: 200, height: 140,
    stroke: STROKE, strokeWidth: 2.5, fill: FILL, data: { pdfCloudIntensity: 2 },
  },
});
cases.push({
  name: 'ellipse-filled-opacity60',
  object: {
    id: 'ellipse-filled', type: 'ellipse', left: 60, top: 50, rx: 100, ry: 70,
    width: 200, height: 140, angle: 0, opacity: 0.6,
    stroke: STROKE, strokeWidth: 3, fill: FILL, data: { pdfCloudIntensity: 3 },
  },
});
cases.push({
  name: 'rect-rotated-filled',
  object: {
    id: 'rect-rot', type: 'rect', left: 70, top: 60, width: 180, height: 120, angle: 20,
    stroke: STROKE, strokeWidth: 2.5, fill: FILL, data: { pdfCloudIntensity: 2 },
  },
});
cases.push({
  name: 'polygon-filled-wide',
  object: {
    id: 'polygon-filled', type: 'polygon', left: 50, top: 40,
    points: [{ x: 0, y: 30 }, { x: 110, y: 0 }, { x: 220, y: 40 }, { x: 190, y: 150 }, { x: 60, y: 160 }],
    pathOffset: { x: 0, y: 0 },
    stroke: STROKE, strokeWidth: 5, fill: FILL, data: { pdfCloudIntensity: 3 },
  },
});

const blankPdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return {
    name: 'blank.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};

const exportAnnotated = (object) => withWindow(async () => savePDFWithAnnotationsPdfLib(
  await blankPdfFile(),
  { 1: { objects: [object] } },
  { 1: { width: PAGE.width, height: PAGE.height } },
  null,
  { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-fidelity' },
));

const exportFlattened = (object) => withWindow(async () => savePDFWithFlattenedRegularAnnotationsForPrint(
  await blankPdfFile(),
  { 1: { objects: [object] } },
  { 1: { width: PAGE.width, height: PAGE.height } },
  { returnBytes: true },
));

// The app's on-screen markup for a cloud: the SAME paint model CloudOutline
// (svgAnnotationRenderers.jsx) renders - fill knocked out under the stroke
// band through the mask, one <path> per run - serialised by cloudSvgPaint.js.
const appSvg = (object) => {
  const geometry = resolveCloudAnnotationGeometry(object);
  if (!geometry) throw new Error(`not a cloud: ${object.id}`);
  const model = buildCloudSvgPaint(geometry, {
    fill: object.fill,
    stroke: object.stroke || 'transparent',
    maskId: `cloud-fill-mask-${object.id}`,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width * SCALE}" height="${PAGE.height * SCALE}" viewBox="0 0 ${PAGE.width} ${PAGE.height}">`
    + `<rect width="${PAGE.width}" height="${PAGE.height}" fill="white"/>`
    + cloudSvgPaintMarkup(model, { opacity: object.opacity ?? 1 })
    + '</svg>';
};

const run = (command, commandArgs) => spawnSync(command, commandArgs, { encoding: 'utf8' });
const has = (command) => run('which', [command]).status === 0;

const rasterSvg = (svgPath, pngPath) => {
  const result = run('rsvg-convert', ['-b', 'white', '-w', String(PAGE.width * SCALE), '-h', String(PAGE.height * SCALE), '-o', pngPath, svgPath]);
  if (result.status !== 0) throw new Error(`rsvg-convert failed: ${result.stderr}`);
};

// pdf.js 6 renders in Node through @napi-rs/canvas (its NodeCanvasFactory);
// the repo does not ship that package, so point CLOUD_FIDELITY_PDFJS_DIR at a
// node_modules holding pdfjs-dist + @napi-rs/canvas (e.g. a scratch install)
// to enable the pdf.js lane. Without it the lane is skipped, not faked.
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
  console.warn('[fidelity] pdf.js raster lane skipped (set CLOUD_FIDELITY_PDFJS_DIR):', error?.message);
}

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

const rasterPoppler = (pdfPath, pngPath) => {
  if (!has('pdftoppm')) return false;
  const prefix = pngPath.replace(/\.png$/, '');
  const result = run('pdftoppm', ['-r', String(DPI), '-png', '-singlefile', pdfPath, prefix]);
  return result.status === 0 && existsSync(pngPath);
};

const rasterQuartz = (pdfPath, pngPath) => {
  if (!has('qlmanage')) return false;
  const dir = join(OUT, '_ql');
  mkdirSync(dir, { recursive: true });
  const result = run('qlmanage', ['-t', '-s', String(Math.max(PAGE.width, PAGE.height) * SCALE), '-o', dir, pdfPath]);
  const produced = join(dir, `${pdfPath.split('/').pop()}.png`);
  if (result.status !== 0 || !existsSync(produced)) return false;
  // Quicklook thumbnails carry an alpha channel; flatten onto white.
  const png = PNG.sync.read(readFileSync(produced));
  for (let index = 0; index < png.data.length; index += 4) {
    const alpha = png.data[index + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      png.data[index + channel] = Math.round(png.data[index + channel] * alpha + 255 * (1 - alpha));
    }
    png.data[index + 3] = 255;
  }
  writeFileSync(pngPath, PNG.sync.write(png));
  return true;
};

const readPng = (path) => PNG.sync.read(readFileSync(path));

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

const compare = (referencePath, candidatePath, diffPath) => {
  const reference = readPng(referencePath);
  const candidate = readPng(candidatePath);
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    return { error: `size mismatch ${reference.width}x${reference.height} vs ${candidate.width}x${candidate.height}` };
  }
  const { width, height } = reference;
  const diff = new PNG({ width, height });
  // `differing`: pixelmatch with its anti-aliasing detector ON (AA edge pixels
  // ignored). `strict`: every pixel pixelmatch flags at all, AA included -
  // reported so the tolerance is visible, not hidden.
  const differing = pixelmatch(reference.data, candidate.data, diff.data, width, height, { threshold: 0.15, includeAA: false });
  const strict = pixelmatch(reference.data, candidate.data, null, width, height, { threshold: 0.1, includeAA: true });
  writeFileSync(diffPath, PNG.sync.write(diff));
  const inkA = countInk(reference.data);
  const inkB = countInk(candidate.data);
  const structural = structuralMismatch(reference.data, candidate.data, width, height);
  return {
    pixels: width * height,
    inkReference: inkA,
    inkCandidate: inkB,
    differing,
    differingPct: Number(((differing / (width * height)) * 100).toFixed(4)),
    differingOfInkPct: Number(((differing / Math.max(1, inkA)) * 100).toFixed(2)),
    strict,
    strictOfInkPct: Number(((strict / Math.max(1, inkA)) * 100).toFixed(2)),
    structural,
    structuralPct: Number(((structural / (width * height)) * 100).toFixed(4)),
    pass: structural / (width * height) <= STRUCTURAL_TOLERANCE_PCT / 100,
  };
};

// Anything beyond anti-aliasing is a failure: at most 0.05% of the page may be
// structurally different (a single missing scallop at 144 dpi is ~0.2%).
const STRUCTURAL_TOLERANCE_PCT = 0.05;

const countInk = (data) => {
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 235 || data[index + 1] < 235 || data[index + 2] < 235) count += 1;
  }
  return count;
};

const report = [];
for (const entry of cases) {
  const base = join(OUT, entry.name);
  const annotatedPdf = `${base}.annotated.pdf`;
  const flattenedPdf = `${base}.flattened.pdf`;
  writeFileSync(annotatedPdf, await exportAnnotated(entry.object));
  writeFileSync(flattenedPdf, await exportFlattened(entry.object));
  const svgPath = `${base}.app.svg`;
  const appPng = `${base}.app.png`;
  writeFileSync(svgPath, appSvg(entry.object));
  rasterSvg(svgPath, appPng);

  const results = { case: entry.name, renderers: {} };
  const renderers = [
    ['pdfjs', (pdf, png) => rasterPdfjs(readFileSync(pdf), png)],
    ['poppler', rasterPoppler],
    ['quartz', rasterQuartz],
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
  report.push(results);
  console.log(entry.name, JSON.stringify(results.renderers));
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ scale: SCALE, dpi: DPI, page: PAGE, cases: report }, null, 2));
const lines = [
  `Scale ${SCALE} (${DPI} dpi), page ${PAGE.width}x${PAGE.height}pt -> ${PAGE.width * SCALE}x${PAGE.height * SCALE}px. Reference = the app's own SVG raster (librsvg).`,
  '',
  '| case | renderer | differing % (AA ignored) | differing % of ink | strict px (AA counted) | strict % of ink | structural px | pass |',
  '|---|---|---|---|---|---|---|---|',
];
let failures = 0;
let compared = 0;
for (const entry of report) {
  for (const [name, result] of Object.entries(entry.renderers)) {
    if (result.skipped) {
      lines.push(`| ${entry.case} | ${name} | skipped | | | | | |`);
      continue;
    }
    compared += 1;
    if (!result.pass) failures += 1;
    lines.push(`| ${entry.case} | ${name} | ${result.differingPct} | ${result.differingOfInkPct} | ${result.strict} | ${result.strictOfInkPct} | ${result.structural} | ${result.pass ? 'yes' : 'NO'} |`);
  }
}
lines.push('', `${compared - failures}/${compared} renderer comparisons within tolerance (structural <= ${STRUCTURAL_TOLERANCE_PCT}% of pixels).`);
writeFileSync(join(OUT, 'report.md'), `${lines.join('\n')}\n`);
console.log(`\nreport: ${join(OUT, 'report.md')}`);
console.log(lines[lines.length - 1]);
if (failures > 0) process.exit(1);
