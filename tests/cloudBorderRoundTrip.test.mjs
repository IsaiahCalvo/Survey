// Cloud border style — export / re-import round trip for EVERY cloud shape.
//
// UX 2026-09-09: the Cloud border style is offered on rectangle, ellipse/circle,
// polygon and (open) polyline, and never on arrow, counter or a single straight
// line. A cloud is only really "assignable" if it survives the file: this suite
// proves each of the four shapes exports the standard /BE << /S /C /I n >>
// cloudy-border dict, and that re-importing the exported PDF restores both the
// cloud style and its bump size onto the same annotation fields the app already
// uses for rectangles (data.pdfCloudIntensity / data.pdfCloudUnitScale).
//
// It also proves the negatives: shapes that do NOT offer Cloud never write /BE,
// so a stray field can't smuggle a cloud into a line, arrow or counter.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';

import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf, convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';

const PAGE = { width: 400, height: 300 };
const BUMP = 3;

const cloneBytesForPdfjs = (bytes) => {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)) return Uint8Array.from(bytes);
  if (bytes instanceof Uint8Array) return bytes.slice();
  return bytes;
};

const makePdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return {
    name: 'cloud-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const exportObjects = async (objects) => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    return await savePDFWithAnnotationsPdfLib(
      await makePdfFile(),
      { 1: { objects } },
      { 1: { width: PAGE.width, height: PAGE.height } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-roundtrip' },
    );
  } finally {
    globalThis.window = originalWindow;
  }
};

const readAnnotDicts = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const be = dict.get(PDFName.of('BE'));
    const beDict = be ? (doc.context.lookup(be) || be) : null;
    const intensity = beDict?.get?.(PDFName.of('I'));
    return {
      subtype: String(dict.get(PDFName.of('Subtype'))?.asString?.() || '').replace(/^\//, ''),
      borderEffectStyle: String(beDict?.get?.(PDFName.of('S'))?.asString?.() || '').replace(/^\//, '') || null,
      borderEffectIntensity: intensity == null
        ? null
        : (typeof intensity.asNumber === 'function' ? intensity.asNumber() : Number(intensity)),
    };
  });
};

const reimport = async (bytes) => {
  const loadingTask = pdfjsLib.getDocument({
    data: cloneBytesForPdfjs(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
    return imported.annotationsByPage[1].objects;
  } finally {
    await loadingTask.destroy();
  }
};

const cloudData = { pdfCloudIntensity: BUMP };

const CLOUD_SHAPES = {
  rect: {
    id: 'cloud-rect', type: 'rect', left: 30, top: 40, width: 160, height: 110,
    stroke: '#c42747', strokeWidth: 2, fill: 'transparent', data: { ...cloudData },
  },
  circle: {
    id: 'cloud-circle', type: 'circle', left: 210, top: 40, radius: 55,
    width: 110, height: 110, stroke: '#c42747', strokeWidth: 2, fill: 'transparent',
    data: { ...cloudData },
  },
  polygon: {
    id: 'cloud-polygon', type: 'polygon', left: 30, top: 170,
    points: [{ x: 0, y: 0 }, { x: 120, y: 10 }, { x: 140, y: 90 }, { x: 20, y: 100 }],
    stroke: '#c42747', strokeWidth: 2, fill: 'transparent', data: { ...cloudData },
  },
  polyline: {
    id: 'cloud-polyline', type: 'polyline', left: 200, top: 175,
    points: [{ x: 0, y: 0 }, { x: 70, y: 60 }, { x: 150, y: 5 }],
    stroke: '#c42747', strokeWidth: 2, fill: 'transparent', data: { ...cloudData },
  },
};

test('every cloud shape exports the standard cloudy-border dict', async () => {
  const bytes = await exportObjects(Object.values(CLOUD_SHAPES));
  const dicts = await readAnnotDicts(bytes);
  assert.equal(dicts.length, 4);
  const bySubtype = Object.fromEntries(dicts.map((dict) => [dict.subtype, dict]));
  for (const subtype of ['Square', 'Circle', 'Polygon', 'PolyLine']) {
    assert.ok(bySubtype[subtype], `${subtype} must be exported`);
    assert.equal(bySubtype[subtype].borderEffectStyle, 'C', `${subtype} needs /BE /S /C`);
    assert.equal(bySubtype[subtype].borderEffectIntensity, BUMP, `${subtype} needs the bump size`);
  }
});

test('a drawn/tilted ellipse (fabric "ellipse") exports the cloudy border too', async () => {
  // The rect-shaped fabric 'circle' and the rx/ry fabric 'ellipse' go through
  // two different /Circle writers; both have to stamp /BE or a tilted or
  // freshly drawn oval loses its cloud on the way out.
  const bytes = await exportObjects([{
    id: 'cloud-ellipse', type: 'ellipse', left: 30, top: 40, width: 200, height: 140,
    rx: 100, ry: 70, angle: 18, stroke: '#c42747', strokeWidth: 2, fill: 'transparent',
    data: { pdfCloudIntensity: BUMP },
  }]);
  const [dict] = await readAnnotDicts(bytes);
  assert.equal(dict.subtype, 'Circle');
  assert.equal(dict.borderEffectStyle, 'C');
  assert.equal(dict.borderEffectIntensity, BUMP);
});

test('a shape that cannot be a cloud never exports a cloudy border', async () => {
  // Even with the field forced on, a line / arrow / counter must stay plain:
  // the Style menu does not offer Cloud for them, so the file must not claim it.
  const bytes = await exportObjects([
    { id: 'l', type: 'line', left: 10, top: 10, x1: -40, y1: -20, x2: 40, y2: 20, stroke: '#000', strokeWidth: 2, data: { ...cloudData } },
    { id: 'a', type: 'line', left: 10, top: 100, x1: -40, y1: 0, x2: 40, y2: 0, stroke: '#000', strokeWidth: 2, tool: 'arrow', data: { ...cloudData, arrowheadStyle: 'solidTriangle' } },
    {
      id: 'c', type: 'circle', left: 250, top: 200, radius: 14, fill: '#22c55e', stroke: '#fff', strokeWidth: 1.5,
      data: { type: 'counter', id: 'c', displayNumber: 4, pointerAngle: 180, ...cloudData },
    },
  ]);
  for (const dict of await readAnnotDicts(bytes)) {
    assert.equal(dict.borderEffectStyle, null, `${dict.subtype} must not carry /BE`);
  }
});

test('exported clouds re-import as clouds, keeping their bump size', async () => {
  const bytes = await exportObjects(Object.values(CLOUD_SHAPES));
  const objects = await reimport(bytes);
  assert.equal(objects.length, 4);
  const byType = Object.fromEntries(objects.map((obj) => [String(obj.type).toLowerCase(), obj]));
  for (const type of ['rect', 'circle', 'polygon', 'polyline']) {
    const obj = byType[type];
    assert.ok(obj, `${type} must come back`);
    assert.equal(obj.data?.pdfCloudIntensity, BUMP, `${type} keeps its bump size`);
    assert.equal(obj.data?.pdfCloudUnitScale, 1, `${type} keeps its unit scale`);
  }
});

test('an Acrobat-authored cloudy Circle imports as an ellipse cloud', () => {
  // No fixture in the tree carries a cloudy /Circle, so this drives the
  // importer directly with the dict Acrobat writes for one.
  const viewport = {
    height: 100,
    convertToViewportPoint(x, y) { return [x, 100 - y]; },
    convertToViewportRectangle(rect) {
      const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
      return [x1, y1, x2, y2];
    },
  };
  const circle = convertPdfAnnotationToFabric({
    id: 'acrobat-cloud-circle',
    subtype: 'Circle',
    rect: [10, 10, 90, 70],
    color: new Uint8ClampedArray([255, 0, 0]),
    borderWidth: 2,
    borderEffect: { style: 'C', intensity: 2 },
  }, viewport);
  assert.equal(circle.type, 'circle');
  assert.equal(circle.data?.pdfCloudIntensity, 2);

  // /BE /I carries the bump size, exactly like the /Square path.
  const strong = convertPdfAnnotationToFabric({
    id: 'acrobat-cloud-circle-strong',
    subtype: 'Circle',
    rect: [10, 10, 90, 70],
    color: new Uint8ClampedArray([255, 0, 0]),
    borderWidth: 2,
    borderEffect: { style: 'C', intensity: 4 },
  }, viewport);
  assert.equal(strong.data?.pdfCloudIntensity, 4);

  // A plain Circle stays plain.
  const plain = convertPdfAnnotationToFabric({
    id: 'acrobat-plain-circle',
    subtype: 'Circle',
    rect: [10, 10, 90, 70],
    color: new Uint8ClampedArray([255, 0, 0]),
    borderWidth: 2,
  }, viewport);
  assert.equal(plain.data?.pdfCloudIntensity, undefined);
});

test('an Acrobat-authored cloudy PolyLine imports as an open cloud', () => {
  const viewport = {
    height: 100,
    convertToViewportPoint(x, y) { return [x, 100 - y]; },
    convertToViewportRectangle(rect) {
      const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
      return [x1, y1, x2, y2];
    },
  };
  const polyline = convertPdfAnnotationToFabric({
    id: 'acrobat-cloud-polyline',
    subtype: 'PolyLine',
    rect: [10, 10, 90, 70],
    vertices: [10, 10, 50, 60, 90, 20],
    color: new Uint8ClampedArray([255, 0, 0]),
    borderWidth: 2,
    borderEffect: { style: 'C', intensity: 2 },
  }, viewport);
  assert.equal(polyline.type, 'polyline');
  assert.equal(polyline.data?.pdfCloudIntensity, 2);
  assert.ok(Array.isArray(polyline.data?.pdfCloudPathD) && polyline.data.pdfCloudPathD.length > 0);

  const plain = convertPdfAnnotationToFabric({
    id: 'acrobat-plain-polyline',
    subtype: 'PolyLine',
    rect: [10, 10, 90, 70],
    vertices: [10, 10, 50, 60, 90, 20],
    color: new Uint8ClampedArray([255, 0, 0]),
    borderWidth: 2,
  }, viewport);
  assert.equal(plain.data?.pdfCloudIntensity, undefined);
});

test('the shipped Acrobat fixture still round-trips its cloudy Square and Polygon', async () => {
  // Regression guard for the shapes the Cloud style already supported.
  const { readFileSync } = await import('node:fs');
  const bytes = new Uint8Array(readFileSync(new URL('../debug/fixtures/e2e/acrobat-authored-annotations.pdf', import.meta.url)));
  const loadingTask = pdfjsLib.getDocument({
    data: cloneBytesForPdfjs(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
    const all = Object.values(imported.annotationsByPage).flatMap((page) => page.objects || []);
    const clouds = all.filter((obj) => obj?.data?.pdfCloudIntensity != null);
    assert.ok(clouds.length >= 2, 'the fixture carries a cloudy Square and a cloudy Polygon');
    assert.ok(clouds.some((obj) => String(obj.type).toLowerCase() === 'rect'));
    assert.ok(clouds.some((obj) => String(obj.type).toLowerCase() === 'polygon'));
  } finally {
    await loadingTask.destroy();
  }
});

// ---------------------------------------------------------------------------
// Print / flatten: what prints must be the scalloped edge the screen showed,
// for the two shapes the style is new on.
// ---------------------------------------------------------------------------

const flattenedContent = async (objects) => {
  const { savePDFWithFlattenedRegularAnnotationsForPrint } = await import('../src/utils/pdfAnnotationsPdfLib.js');
  const { PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const originalWindow = globalThis.window;
  globalThis.window = {};
  let bytes;
  try {
    bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
      await makePdfFile(),
      { 1: { objects } },
      { 1: { width: PAGE.width, height: PAGE.height } },
      { returnBytes: true },
    );
  } finally {
    globalThis.window = originalWindow;
  }
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = doc.context.lookup(page.node.get(PDFName.of('Contents')));
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
};

const curveCount = (content) => (content.match(/\bc\s*$/gm) || []).length
  + (content.match(/[\d.]\s+c\b/g) || []).length;

test('printing a cloud ellipse flattens the scalloped edge, not a plain oval', async () => {
  const plain = await flattenedContent([{
    id: 'plain-ellipse', type: 'ellipse', left: 30, top: 40, width: 200, height: 140,
    rx: 100, ry: 70, stroke: '#c42747', strokeWidth: 2, fill: 'transparent',
  }]);
  const cloud = await flattenedContent([{
    id: 'cloud-ellipse', type: 'ellipse', left: 30, top: 40, width: 200, height: 140,
    rx: 100, ry: 70, stroke: '#c42747', strokeWidth: 2, fill: 'transparent',
    data: { pdfCloudIntensity: BUMP },
  }]);
  assert.ok(curveCount(cloud) > curveCount(plain) + 10,
    `a cloud ellipse prints many more curves than a plain one (${curveCount(cloud)} vs ${curveCount(plain)})`);
});

test('printing a cloud polyline flattens the scalloped run', async () => {
  const plain = await flattenedContent([{
    id: 'plain-polyline', type: 'polyline', left: 30, top: 40,
    points: [{ x: 0, y: 0 }, { x: 120, y: 90 }, { x: 240, y: 10 }],
    stroke: '#c42747', strokeWidth: 2, fill: 'transparent',
  }]);
  const cloud = await flattenedContent([{
    id: 'cloud-polyline', type: 'polyline', left: 30, top: 40,
    points: [{ x: 0, y: 0 }, { x: 120, y: 90 }, { x: 240, y: 10 }],
    stroke: '#c42747', strokeWidth: 2, fill: 'transparent',
    data: { pdfCloudIntensity: BUMP },
  }]);
  assert.ok(curveCount(cloud) > curveCount(plain) + 10,
    `a cloud polyline prints many more curves than a plain one (${curveCount(cloud)} vs ${curveCount(plain)})`);
});
