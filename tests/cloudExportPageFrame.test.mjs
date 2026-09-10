// Cloud export vs. the page frame (verify-export-3p, 2026-09-09).
//
// The annotated exporter writes every cloud's /Rect (and /Vertices) with a bare
// `pageHeight - y` in the UNROTATED MediaBox frame, while the app (pdf.js
// getViewport defaults to `rotation = page.rotate`) and the importer work in
// the rotated, CropBox-relative viewport. The print/flatten path goes through
// withPrintPageTransform and is correct; the /Annots path is not. On top of
// that, exportAnnotationRefHasValidGeometry discards any annotation whose
// /Rect bleeds more than 5% of the page past the CropBox - and a cloud's /Rect
// is the scallop-inflated appearance box, so big-bump clouds flush to the edge
// of a small page (A5, half-letter, A6) are silently dropped from the export.
//
// These tests are EXPECTED TO FAIL on claude/cloud-mobile-e2e: they encode the
// behaviour a correct exporter must have.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  resolveCloudAnnotationGeometry,
  sampleCloudCommands,
  transformCloudCommandsToWorld,
} from '../src/utils/cloudAnnotationGeometry.js';

const STROKE = '#c42747';

const makePdfFile = async ({ mediaBox = [0, 0, 320, 240], rotate = 0 } = {}) => {
  const source = await PDFDocument.create();
  const page = source.addPage([mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]]);
  page.setMediaBox(mediaBox[0], mediaBox[1], mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]);
  page.setCropBox(mediaBox[0], mediaBox[1], mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]);
  if (rotate) page.node.set(PDFName.of('Rotate'), source.context.obj(rotate));
  const bytes = await source.save();
  return {
    name: 'cloud-frame.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

// The page size the app hands the exporter: pdf.js' default viewport, which
// already applies /Rotate and is CropBox-sized.
const appPageSize = async (file) => {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const doc = await task.promise;
  try {
    const viewport = (await doc.getPage(1)).getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  } finally {
    await task.destroy();
  }
};

const exportObjects = async (file, objects) => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    return await savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects } },
      { 1: await appPageSize(file) },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-frame' },
    );
  } finally {
    globalThis.window = originalWindow;
  }
};

const annotCount = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  return annots instanceof PDFArray ? annots.size() : 0;
};

// Re-import WITHOUT the app's private metadata blob, so the result reflects
// what the PDF itself says (what Acrobat / Preview / Chrome / poppler show).
const reimportWithoutMetadata = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.asArray().forEach((ref) => doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation')));
  }
  const stripped = await doc.save();
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(stripped), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdfDoc = await task.promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: stripped });
    return imported.annotationsByPage?.[1]?.objects || [];
  } finally {
    await task.destroy();
  }
};

const baseBoxOf = (obj) => {
  // The Square importer keeps the inflated /Rect as the box and carries the
  // /RD insets; the base rectangle is box + insets.
  const insets = obj?.data?.pdfCloudInsets || [0, 0, 0, 0];
  return {
    left: obj.left + insets[0],
    top: obj.top + insets[1],
    width: obj.width - insets[0] - insets[2],
    height: obj.height - insets[1] - insets[3],
  };
};

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${label}: ${actual} vs ${expected}`);
};

const cloudRect = (left, top, width, height, bump = 2) => ({
  id: 'cloud-rect', type: 'rect', left, top, width, height,
  stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: bump },
});

test('a cloud on a /Rotate 90 page is exported where the app shows it', async () => {
  const file = await makePdfFile({ rotate: 90 });
  const size = await appPageSize(file);
  assert.deepEqual(size, { width: 240, height: 320 }, 'the app frame is the rotated viewport');
  const shape = cloudRect(20, 200, 60, 40);
  const bytes = await exportObjects(file, [shape]);
  assert.equal(await annotCount(bytes), 1, 'the cloud is in the file');
  const [obj] = await reimportWithoutMetadata(bytes);
  assert.ok(obj, 'the cloud re-imports');
  const box = baseBoxOf(obj);
  near(box.left, shape.left, 0.5, 'left (rotated frame)');
  near(box.top, shape.top, 0.5, 'top (rotated frame)');
  near(box.width, shape.width, 0.5, 'width (rotated frame)');
  near(box.height, shape.height, 0.5, 'height (rotated frame)');
});

test('a cloud on a page with an offset MediaBox/CropBox is exported where the app shows it', async () => {
  const file = await makePdfFile({ mediaBox: [100, 50, 420, 290] });
  const shape = cloudRect(200, 150, 60, 40);
  const bytes = await exportObjects(file, [shape]);
  assert.equal(await annotCount(bytes), 1, 'the cloud is in the file');
  const [obj] = await reimportWithoutMetadata(bytes);
  assert.ok(obj, 'the cloud re-imports');
  const box = baseBoxOf(obj);
  near(box.left, shape.left, 0.5, 'left (CropBox-relative)');
  near(box.top, shape.top, 0.5, 'top (CropBox-relative)');
});

test('a cloud drawn at the centre of a page with an offset CropBox is not dropped', async () => {
  // Same as the app's prog-05 fixture: MediaBox larger than the CropBox.
  const file = await makePdfFile({ mediaBox: [100, 50, 420, 290] });
  const bytes = await exportObjects(file, [cloudRect(60, 50, 200, 140)]);
  assert.equal(await annotCount(bytes), 1, 'the cloud is in the file');
});

test('a max-Bump cloud flush to the edge of an A5 page is still exported', async () => {
  const file = await makePdfFile({ mediaBox: [0, 0, 420, 595] });
  const bytes = await exportObjects(file, [cloudRect(0, 100, 200, 150, 6)]);
  assert.equal(await annotCount(bytes), 1, 'the cloud is in the file (the print path draws it)');
});

test('a scaled, tilted polygon cloud whose crowns bleed past a small page edge is still exported', async () => {
  const file = await makePdfFile();
  const polygon = {
    id: 'cloud-polygon', type: 'polygon', left: 60, top: 50, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 30 }, { x: 110, y: 0 }, { x: 220, y: 40 }, { x: 190, y: 150 }, { x: 60, y: 160 }],
    scaleX: 0.9, scaleY: 1.1, angle: 25,
    stroke: STROKE, strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 },
  };
  const bytes = await exportObjects(file, [polygon]);
  assert.equal(await annotCount(bytes), 1, 'the cloud is in the file (every vertex is on the page)');
});

// The crowns the app paints for an object, sampled in page space.
const paintedCrowns = (obj) => {
  const geometry = resolveCloudAnnotationGeometry(obj);
  assert.ok(geometry, 'the object is a cloud');
  const world = transformCloudCommandsToWorld(geometry.outline, geometry);
  return { commands: geometry.outline.length, points: sampleCloudCommands(world, 6).flat() };
};

const hausdorff = (a, b) => {
  const directed = (from, to) => {
    let worst = 0;
    for (const p of from) {
      let best = Infinity;
      for (const q of to) {
        const distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance < best) best = distance;
      }
      if (best > worst) worst = best;
    }
    return worst;
  };
  return Math.max(directed(a, b), directed(b, a));
};

// (c) An edge-hugging / full-page cloud re-imported WITHOUT app metadata must
// rebuild the exact base rectangle from /Rect + /RD: the crown engine is a
// pure function of the vertex coordinates, so a base rebuilt with float
// noise (320.00000000000006) or framed as inflated-box-plus-insets grew or
// lost a crown (207 vs 209 commands) and shifted the crown phase.
for (const [label, options, page] of [
  ['an unrotated page', {}, { width: 320, height: 240 }],
  ['a /Rotate 90 page', { rotate: 90 }, { width: 240, height: 320 }],
  ['an offset-box page', { mediaBox: [100, 50, 420, 290] }, { width: 320, height: 240 }],
]) {
  test(`a full-page Bump-2 cloud on ${label} re-imports with the identical crowns, metadata or not`, async () => {
    const file = await makePdfFile(options);
    assert.deepEqual(await appPageSize(file), page);
    const shape = cloudRect(0, 0, page.width, page.height, 2);
    const drawn = paintedCrowns(shape);
    const bytes = await exportObjects(file, [shape]);
    assert.equal(await annotCount(bytes), 1, 'the cloud is in the file');
    const [stripped] = await reimportWithoutMetadata(bytes);
    assert.ok(stripped, 'the cloud re-imports without metadata');
    assert.equal(stripped.data?.pdfCloudInsets, undefined, 'framed on the base rectangle, not box + insets');
    const box = baseBoxOf(stripped);
    assert.deepEqual(
      [box.left, box.top, box.width, box.height],
      [shape.left, shape.top, shape.width, shape.height],
      'the base rectangle is rebuilt exactly',
    );
    const reimported = paintedCrowns(stripped);
    assert.equal(reimported.commands, drawn.commands, 'same crown count');
    assert.ok(hausdorff(drawn.points, reimported.points) <= 1e-6, 'same crowns');
  });
}
