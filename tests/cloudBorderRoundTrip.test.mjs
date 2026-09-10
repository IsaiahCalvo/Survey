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
  // DELIBERATE CHANGE (2026-09-09, cloud-fill-knockout): the flattener now
  // places the cloud's /AP form itself on the page (`/CloudAPn Do`) so print
  // and export can never disagree; the crown curves therefore live in the
  // form XObjects the page references, which are read here alongside the
  // page's own content streams.
  const xobjects = page.node.Resources()?.get(PDFName.of('XObject'));
  const xobjectStreams = xobjects
    ? xobjects.keys().map((key) => doc.context.lookup(xobjects.get(key)))
    : [];
  return [...streams, ...xobjectStreams]
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

// ---------------------------------------------------------------------------
// Third-party fidelity (2026-09-09): every cloud carries an /AP /N form that
// paints the engine's exact scallops, so Acrobat / Preview / Chrome / poppler
// show what the app shows instead of a plain box or their own cloud. The
// flattener paints the identical outline, and the /BE + /RD metadata still
// lets the importer (with or without our own metadata blob) rebuild the
// base shape, bump size, tilt and vertices exactly.
// ---------------------------------------------------------------------------

const readAppearanceDetails = async (bytes) => {
  const { PDFArray, PDFRawStream, decodePDFRawStream, PDFDict } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  const numbers = (value) => (value instanceof PDFArray
    ? value.asArray().map((entry) => doc.context.lookup(entry) ?? entry).map((entry) => entry.asNumber())
    : null);
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const ap = dict.get(PDFName.of('AP'));
    const apDict = ap ? doc.context.lookup(ap) : null;
    const normalRef = apDict instanceof PDFDict ? apDict.get(PDFName.of('N')) : null;
    const stream = normalRef ? doc.context.lookup(normalRef) : null;
    const content = stream instanceof PDFRawStream
      ? new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
      : null;
    return {
      subtype: String(dict.get(PDFName.of('Subtype'))?.asString?.() || '').replace(/^\//, ''),
      rect: numbers(doc.context.lookup(dict.get(PDFName.of('Rect')))),
      rd: numbers(doc.context.lookup(dict.get(PDFName.of('RD')))),
      bbox: stream ? numbers(doc.context.lookup(stream.dict.get(PDFName.of('BBox')))) : null,
      matrix: stream ? numbers(doc.context.lookup(stream.dict.get(PDFName.of('Matrix')))) : null,
      content,
    };
  });
};

const operatorCount = (content, operator) => (content.match(new RegExp(`(?:^|\\s)${operator}(?=\\s|$)`, 'g')) || []).length;

const FIDELITY_SHAPES = {
  rect: {
    id: 'ap-rect', type: 'rect', left: 30, top: 40, width: 160, height: 110,
    stroke: '#c42747', strokeWidth: 2.5, fill: 'rgba(196, 39, 71, 0.25)', data: { pdfCloudIntensity: 2 },
  },
  'rotated-rect': {
    id: 'ap-rect-rot', type: 'rect', left: 200, top: 30, width: 120, height: 80, angle: 20,
    stroke: '#c42747', strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 },
  },
  circle: {
    id: 'ap-circle', type: 'circle', left: 210, top: 120, radius: 40, scaleX: 1.5, scaleY: 1,
    stroke: '#c42747', strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 3 },
  },
  ellipse: {
    id: 'ap-ellipse', type: 'ellipse', left: 30, top: 170, rx: 70, ry: 45, angle: 0,
    stroke: '#c42747', strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 },
  },
  'rotated-ellipse': {
    id: 'ap-ellipse-rot', type: 'ellipse', left: 200, top: 190, rx: 70, ry: 40, angle: 32,
    stroke: '#c42747', strokeWidth: 2.5, fill: 'rgba(196, 39, 71, 0.25)', data: { pdfCloudIntensity: 4 },
  },
  polygon: {
    id: 'ap-polygon', type: 'polygon', left: 40, top: 40, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 120, y: 10 }, { x: 140, y: 90 }, { x: 20, y: 100 }],
    stroke: '#c42747', strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 3 },
  },
  polyline: {
    id: 'ap-polyline', type: 'polyline', left: 200, top: 175, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 70, y: 60 }, { x: 150, y: 5 }],
    stroke: '#c42747', strokeWidth: 2.5, fill: 'transparent', data: { pdfCloudIntensity: 2 },
  },
};

test('every cloud shape ships an /AP form that paints the scallops itself', async () => {
  for (const [name, shape] of Object.entries(FIDELITY_SHAPES)) {
    const bytes = await exportObjects([shape]);
    const [annot] = await readAppearanceDetails(bytes);
    assert.ok(annot.content, `${name}: /AP /N appearance stream present`);
    assert.ok(operatorCount(annot.content, 'c') >= 20, `${name}: the form paints the crowns (${operatorCount(annot.content, 'c')} curves)`);
    assert.ok(/(^|\n)1 J 1 j(\n|$)/.test(annot.content), `${name}: round caps and joins, like the screen`);
    assert.ok(/(^|\n)2\.5 w(\n|$)/.test(annot.content), `${name}: the stroke width is the annotation's`);
    assert.ok(/ RG(\n|$)/.test(annot.content) && /(^|\n)S(\n|$)/.test(annot.content), `${name}: the outline is stroked`);
    const filled = /rgba\(/.test(shape.fill);
    // DELIBERATE ASSERTION CHANGE (2026-09-09, cloud-fill-knockout): a filled
    // AND stroked cloud paints its fill knocked out under the stroke band as
    // an even-odd region (`f*`, see cloudFillKnockoutRings) instead of the
    // plain scalloped fill (`f`); a filled cloud without a stroke keeps `f`.
    // Every fidelity shape here is stroked, so `f*` is the filled form.
    assert.equal(/(^|\n)f\*(\n|$)/.test(annot.content), filled, `${name}: the scalloped region is filled (knocked out under the stroke) only when the shape has a fill`);
    assert.equal(/(^|\n)f(\n|$)/.test(annot.content), false, `${name}: no un-knocked-out fill under the stroke`);
    assert.ok(Array.isArray(annot.bbox) && annot.bbox[2] > 0 && annot.bbox[3] > 0, `${name}: /BBox`);

    // /Rect must be exactly the page box of /Matrix x /BBox: any other value
    // makes the viewer silently scale the form (PDF 32000 12.5.5).
    const angle = Number(shape.angle) || 0;
    assert.equal(Boolean(annot.matrix), angle !== 0, `${name}: /Matrix only when tilted`);
    const [a, b] = annot.matrix || [1, 0];
    const width = annot.bbox[2] - annot.bbox[0];
    const height = annot.bbox[3] - annot.bbox[1];
    const fittedWidth = Math.abs(width * a) + Math.abs(height * b);
    const fittedHeight = Math.abs(width * b) + Math.abs(height * a);
    assert.ok(Math.abs((annot.rect[2] - annot.rect[0]) - fittedWidth) < 1e-3, `${name}: /Rect width is the transformed /BBox width`);
    assert.ok(Math.abs((annot.rect[3] - annot.rect[1]) - fittedHeight) < 1e-3, `${name}: /Rect height is the transformed /BBox height`);
    if (annot.matrix) {
      assert.ok(Math.abs(-Math.atan2(b, a) * 180 / Math.PI - angle) < 1e-6, `${name}: /Matrix carries the fabric tilt`);
    }
    const expectsRd = annot.subtype === 'Square' || annot.subtype === 'Circle';
    assert.equal(Array.isArray(annot.rd), expectsRd, `${name}: /RD on Square and Circle only`);
    if (expectsRd) {
      assert.ok(annot.rd.every((value) => value > 0), `${name}: /RD insets are the scallop inflation`);
    }
  }
});

test('the flattener paints the identical cloud outline the /AP does', async () => {
  for (const [name, shape] of Object.entries(FIDELITY_SHAPES)) {
    const [annot] = await readAppearanceDetails(await exportObjects([shape]));
    const printed = await flattenedContent([shape]);
    assert.equal(operatorCount(printed, 'c'), operatorCount(annot.content, 'c'), `${name}: same crown curves when printed`);
    assert.equal(operatorCount(printed, 'm'), operatorCount(annot.content, 'm'), `${name}: same crown runs when printed`);
  }
});

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${label}: ${actual} vs ${expected}`);
};

test('export -> re-import preserves style, bump, tilt and vertices for every cloud shape', async () => {
  const { cloudVertexStateForPoints } = await import('../src/utils/pdfAnnotationAppearance.js');
  const shapes = Object.values(FIDELITY_SHAPES).map((shape) => (shape.type === 'polyline'
    ? {
        ...shape,
        data: {
          ...shape.data,
          pdfCloudVertexState: cloudVertexStateForPoints('polyline', shape.points, 1, 1),
        },
      }
    : shape));
  const objects = await reimport(await exportObjects(shapes));
  assert.equal(objects.length, shapes.length);
  const byId = Object.fromEntries(objects.map((obj) => [obj.id || obj.data?.id, obj]));
  for (const shape of shapes) {
    const obj = byId[shape.id];
    assert.ok(obj, `${shape.id} comes back`);
    // An un-tilted drawn ellipse has always re-imported as the importer's
    // circle+scale form (identity /Matrix); its effective radii must match.
    const untiltedEllipse = shape.type === 'ellipse' && !(shape.angle) && String(obj.type).toLowerCase() === 'circle';
    if (untiltedEllipse) {
      near(obj.radius * obj.scaleX, shape.rx, 1e-6, `${shape.id}: rx via radius*scaleX`);
      near(obj.radius * obj.scaleY, shape.ry, 1e-6, `${shape.id}: ry via radius*scaleY`);
    } else {
      assert.equal(String(obj.type).toLowerCase(), shape.type, `${shape.id}: same fabric type`);
    }
    assert.equal(obj.data?.pdfCloudIntensity, shape.data.pdfCloudIntensity, `${shape.id}: bump size`);
    assert.equal(obj.stroke, shape.stroke, `${shape.id}: stroke`);
    assert.equal(obj.fill, shape.fill, `${shape.id}: fill`);
    assert.equal(obj.strokeWidth, shape.strokeWidth, `${shape.id}: stroke width`);
    near(obj.angle ?? 0, shape.angle ?? 0, 1e-9, `${shape.id}: tilt`);
    for (const key of ['left', 'top', 'width', 'height', 'rx', 'ry', 'radius', 'scaleX', 'scaleY']) {
      if (untiltedEllipse && (key === 'scaleX' || key === 'scaleY')) continue;
      if (shape[key] !== undefined) near(obj[key], shape[key], 1e-9, `${shape.id}: ${key}`);
    }
    if (shape.points) {
      assert.deepEqual(obj.points.map((p) => [p.x, p.y]), shape.points.map((p) => [p.x, p.y]), `${shape.id}: vertices`);
    }
    // The base rectangle/ellipse is restored from our metadata; the /RD inset
    // the importer derives from the inflated /Rect must not shrink it again.
    assert.equal(obj.data?.pdfCloudInsets, undefined, `${shape.id}: no stray inset`);
    if (shape.data.pdfCloudVertexState) {
      assert.deepEqual(obj.data?.pdfCloudVertexState, shape.data.pdfCloudVertexState, `${shape.id}: vertex-drag memory`);
    }
  }
});

test('without our metadata, /RD still rebuilds the base rectangle and ellipse', async () => {
  const { PDFArray } = await import('pdf-lib');
  const shapes = [FIDELITY_SHAPES.rect, FIDELITY_SHAPES.circle, FIDELITY_SHAPES.ellipse, FIDELITY_SHAPES['rotated-ellipse']];
  const doc = await PDFDocument.load(await exportObjects(shapes));
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots instanceof PDFArray);
  annots.asArray().forEach((ref) => {
    doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation'));
  });
  const objects = await reimport(await doc.save());
  assert.equal(objects.length, shapes.length);
  const byType = {};
  for (const obj of objects) byType[`${obj.type}${obj.angle ? '-rot' : ''}`] = obj;

  const rect = byType.rect;
  assert.ok(rect, 'rect comes back');
  assert.equal(rect.data?.pdfCloudIntensity, 2);
  // The Square importer keeps the (inflated) /Rect as the box and carries the
  // /RD insets on the object, so the base rectangle is box + insets.
  const rectInsets = rect.data?.pdfCloudInsets || [0, 0, 0, 0];
  near(rect.left + rectInsets[0], FIDELITY_SHAPES.rect.left, 0.05, 'rect base left (via /Rect + /RD)');
  near(rect.top + rectInsets[1], FIDELITY_SHAPES.rect.top, 0.05, 'rect base top');
  near(rect.width - rectInsets[0] - rectInsets[2], FIDELITY_SHAPES.rect.width, 0.05, 'rect base width');
  near(rect.height - rectInsets[1] - rectInsets[3], FIDELITY_SHAPES.rect.height, 0.05, 'rect base height');

  // An axis-aligned cloud oval comes back as the importer's circle+scale form
  // at the base ellipse size, not the scalloped box.
  const circles = objects.filter((obj) => obj.type === 'circle');
  assert.equal(circles.length, 2, 'both axis-aligned ovals come back as circles');
  const sizes = circles.map((obj) => [obj.radius * 2 * obj.scaleX, obj.radius * 2 * obj.scaleY].map((v) => Math.round(v * 100) / 100));
  assert.ok(sizes.some(([w, h]) => Math.abs(w - 120) < 0.05 && Math.abs(h - 80) < 0.05), `circle 120x80 restored: ${JSON.stringify(sizes)}`);
  assert.ok(sizes.some(([w, h]) => Math.abs(w - 140) < 0.05 && Math.abs(h - 90) < 0.05), `ellipse 140x90 restored: ${JSON.stringify(sizes)}`);

  const tilted = byType['ellipse-rot'];
  assert.ok(tilted, 'tilted ellipse comes back tilted');
  const source = FIDELITY_SHAPES['rotated-ellipse'];
  near(tilted.angle, source.angle, 1e-6, 'tilt');
  near(tilted.rx, source.rx, 0.05, 'rx (via /BBox - /RD)');
  near(tilted.ry, source.ry, 0.05, 'ry');
  near(tilted.left + tilted.rx, source.left + source.rx, 0.05, 'centre x');
  near(tilted.top + tilted.ry, source.top + source.ry, 0.05, 'centre y');
  assert.equal(tilted.data?.pdfCloudIntensity, source.data.pdfCloudIntensity);
});
