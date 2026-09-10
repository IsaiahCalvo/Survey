// Plain (non-cloud) shapes ship an /AP /N appearance stream
// (verify-export-3p round 3, 2026-09-09).
//
// A /Square, /Circle, /Polygon, /PolyLine, /Line or /FreeText used to go out
// as a bare dict. PDF 32000-1 12.5.5 lets a reader synthesise an appearance,
// but most do not: macOS Quick Look / Quartz drew NOTHING, and poppler
// synthesised its own inset box (2.12pt Hausdorff off a 3pt rect). The
// annotated export looked empty in Preview while the flattened print was right.
//
// The appearance is the PRINT FLATTENER'S OWN OUTPUT drawn onto a throwaway
// page, so /AP and the flattened print cannot drift. These tests hold the
// contract that makes that safe:
//   * one /AP /N form per plain shape, with /BBox == /Rect and no /Matrix, so
//     the viewer's BBox -> Rect fit (12.5.5) is the identity;
//   * /RD back to the base rectangle / circle / text box wherever the shape's
//     geometry lives in /Rect, so a metadata-less re-import is unchanged;
//   * no leftover scratch page in the exported file.
//
// The pixel-level proof (qlmanage + poppler + pdftocairo + pdf.js rasters of
// the annotated file against the app's flattened print) lives in
// scripts/cloud-export-fidelity.mjs --shapes plain.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const PAGE = { width: 320, height: 240 };

const makePdfFile = async ({ rotate = 0 } = {}) => {
  const source = await PDFDocument.create();
  const page = source.addPage([320, 240]);
  page.setMediaBox(0, 0, 320, 240);
  page.setCropBox(0, 0, 320, 240);
  if (rotate) page.node.set(PDFName.of('Rotate'), source.context.obj(rotate));
  const bytes = await source.save();
  return {
    name: 'plain.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const exportObjects = async (file, objects, size = PAGE) => {
  const original = globalThis.window;
  globalThis.window = {};
  try {
    return await quiet(() => savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects } },
      { 1: size },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'plain-shape-appearance' },
    ));
  } finally {
    globalThis.window = original;
  }
};

const numbers = (doc, value) => {
  const resolved = doc.context.lookup(value);
  return resolved && typeof resolved.asArray === 'function'
    ? resolved.asArray().map((entry) => Number(doc.context.lookup(entry)?.asNumber?.() ?? entry))
    : null;
};

const readAnnots = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const refs = annots instanceof PDFArray ? annots.asArray() : [];
  return refs.map((ref) => {
    const dict = doc.context.lookup(ref);
    const ap = dict.get(PDFName.of('AP'));
    const apDict = ap ? doc.context.lookup(ap) : null;
    const form = apDict instanceof PDFDict ? doc.context.lookup(apDict.get(PDFName.of('N'))) : null;
    return {
      doc,
      dict,
      subtype: String(dict.get(PDFName.of('Subtype'))),
      rect: numbers(doc, dict.get(PDFName.of('Rect'))),
      rd: numbers(doc, dict.get(PDFName.of('RD'))),
      form,
      bbox: form ? numbers(doc, form.dict.get(PDFName.of('BBox'))) : null,
      matrix: form ? numbers(doc, form.dict.get(PDFName.of('Matrix'))) : null,
    };
  });
};

const reimport = async (bytes, { stripMetadata = false } = {}) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (stripMetadata && annots instanceof PDFArray) {
    annots.asArray().forEach((ref) => doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation')));
  }
  const saved = await doc.save();
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(saved), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdfDoc = await task.promise;
  try {
    const imported = await quiet(() => importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: saved }));
    return imported.annotationsByPage?.[1]?.objects || [];
  } finally {
    await task.destroy();
  }
};

const near = (actual, expected, tolerance, label) => {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `${label}: ${actual} vs ${expected} (tolerance ${tolerance})`,
  );
};

const SHAPES = {
  rect: { id: 'p-rect', type: 'rect', left: 30, top: 25, width: 120, height: 70, stroke: '#c42747', strokeWidth: 3, fill: 'transparent' },
  circle: { id: 'p-circle', type: 'circle', left: 190, top: 25, radius: 34, stroke: '#1c6fd0', strokeWidth: 2, fill: 'rgba(28, 111, 208, 0.25)' },
  polygon: { id: 'p-polygon', type: 'polygon', left: 25, top: 120, points: [{ x: 0, y: 0 }, { x: 80, y: 10 }, { x: 96, y: 64 }, { x: 14, y: 52 }], pathOffset: { x: 0, y: 0 }, stroke: '#2c8a3d', strokeWidth: 2.5, fill: 'transparent' },
  polyline: { id: 'p-polyline', type: 'polyline', left: 150, top: 120, points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 6 }], pathOffset: { x: 0, y: 0 }, stroke: '#8a2c7d', strokeWidth: 2, fill: 'transparent', data: { arrowheadStyle: 'solidTriangle' } },
  line: { id: 'p-line', type: 'line', tool: 'arrow', x1: 30, y1: 205, x2: 160, y2: 228, stroke: '#111111', strokeWidth: 2, fill: 'rgb(0,0,0)', data: { arrowheadStyle: 'solidTriangle' } },
  freetext: { id: 'p-text', type: 'textbox', left: 180, top: 175, width: 120, height: 45, text: 'Revision note', fontSize: 12, fill: '#333333', stroke: '#333333', strokeWidth: 1 },
};

const EXPECTED_SUBTYPE = {
  rect: '/Square',
  circle: '/Circle',
  polygon: '/Polygon',
  polyline: '/PolyLine',
  line: '/Line',
  freetext: '/FreeText',
};

test('every plain shape exports with an /AP /N appearance stream', async () => {
  const file = await makePdfFile();
  const bytes = await exportObjects(file, Object.values(SHAPES));
  const written = await readAnnots(bytes);
  assert.equal(written.length, Object.keys(SHAPES).length, 'every shape is in the file');
  for (const [name, shape] of Object.entries(SHAPES)) {
    const entry = written.find((item) => item.subtype === EXPECTED_SUBTYPE[name]);
    assert.ok(entry, `${name} exported as ${EXPECTED_SUBTYPE[name]}`);
    assert.ok(entry.form, `${name} carries an /AP /N form`);
    assert.equal(String(entry.form.dict.get(PDFName.of('Subtype'))), '/Form', `${name}'s appearance is a Form XObject`);
    const contents = entry.form.getContents?.();
    assert.ok(contents && contents.length > 0, `${name}'s appearance stream has content`);
    assert.ok(shape, `${name} case exists`);
  }
});

test('/BBox equals /Rect with no /Matrix, so the viewer maps the appearance 1:1', async () => {
  const file = await makePdfFile();
  const bytes = await exportObjects(file, Object.values(SHAPES));
  for (const entry of await readAnnots(bytes)) {
    assert.ok(entry.bbox, `${entry.subtype} has a /BBox`);
    entry.bbox.forEach((value, index) => {
      near(value, entry.rect[index], 1e-6, `${entry.subtype} /BBox[${index}] vs /Rect[${index}]`);
    });
    assert.ok(
      !entry.matrix || entry.matrix.every((value, index) => Math.abs(value - [1, 0, 0, 1, 0, 0][index]) < 1e-9),
      `${entry.subtype} needs no appearance /Matrix on an unrotated page`,
    );
  }
});

test('the /Rect of a shape whose geometry lives in /Rect carries /RD back to the base shape', async () => {
  const file = await makePdfFile();
  const bytes = await exportObjects(file, [SHAPES.rect, SHAPES.circle, SHAPES.freetext]);
  for (const entry of await readAnnots(bytes)) {
    assert.ok(Array.isArray(entry.rd) && entry.rd.length === 4, `${entry.subtype} carries /RD`);
    assert.ok(entry.rd.every((value) => value > 0), `${entry.subtype} /RD is a real inset`);
  }
  const square = (await readAnnots(bytes)).find((entry) => entry.subtype === '/Square');
  // Base rect = /Rect inset by /RD [left, top, right, bottom]; the shape sits
  // at left 30 / top 25 / 120 x 70 in app space on a 240pt-high page.
  const base = [
    square.rect[0] + square.rd[0],
    square.rect[1] + square.rd[3],
    square.rect[2] - square.rd[2],
    square.rect[3] - square.rd[1],
  ];
  near(base[0], 30, 0.01, 'base left');
  near(base[1], PAGE.height - (25 + 70), 0.01, 'base bottom');
  near(base[2], 30 + 120, 0.01, 'base right');
  near(base[3], PAGE.height - 25, 0.01, 'base top');
});

test('the appearance never leaves a scratch page behind', async () => {
  const file = await makePdfFile();
  const bytes = await exportObjects(file, Object.values(SHAPES));
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1, 'the exported file still has exactly one page');
});

test('adding the appearance does not move a metadata-stripped re-import', async () => {
  const file = await makePdfFile();
  for (const [name, shape] of Object.entries(SHAPES)) {
    // eslint-disable-next-line no-await-in-loop
    const bytes = await exportObjects(file, [shape]);
    // eslint-disable-next-line no-await-in-loop
    const [back] = await reimport(bytes, { stripMetadata: true });
    assert.ok(back, `${name} re-imports without our metadata`);
    if (name === 'rect' || name === 'circle') {
      const width = name === 'circle' ? shape.radius * 2 : shape.width;
      const height = name === 'circle' ? shape.radius * 2 : shape.height;
      near(back.left, shape.left, 0.1, `${name} left`);
      near(back.top, shape.top, 0.1, `${name} top`);
      near(
        name === 'circle' ? (back.radius ?? back.rx) * 2 * Math.abs(back.scaleX ?? 1) : back.width,
        width, 0.1, `${name} width`,
      );
      near(
        name === 'circle' ? (back.radius ?? back.ry) * 2 * Math.abs(back.scaleY ?? 1) : back.height,
        height, 0.1, `${name} height`,
      );
    }
    if (name === 'polygon' || name === 'polyline') {
      const world = (obj) => obj.points.map((point) => ({ x: obj.left + point.x, y: obj.top + point.y }));
      const drawn = world(shape);
      const restored = world(back);
      assert.equal(restored.length, drawn.length, `${name} vertex count`);
      drawn.forEach((point, index) => {
        near(restored[index].x, point.x, 0.1, `${name} vertex ${index} x`);
        near(restored[index].y, point.y, 0.1, `${name} vertex ${index} y`);
      });
    }
    if (name === 'line') {
      near(back.x1 ?? back.left, shape.x1, 0.5, 'line x1');
      near(back.y1 ?? back.top, shape.y1, 0.5, 'line y1');
    }
    if (name === 'freetext') {
      assert.equal(String(back.text || '').trim(), shape.text, 'freetext content');
      // The FreeText importer expands the text box by its own TEXT_PADDING
      // (6pt, unchanged by this work), so allow that constant on each side.
      near(back.left, shape.left, 6.5, 'freetext left');
      near(back.width, shape.width, 13, 'freetext width');
    }
  }
});

test('a plain shape on a /Rotate 90 page keeps /BBox mapped onto /Rect through the page frame', async () => {
  const file = await makePdfFile({ rotate: 90 });
  // pdf.js turns the viewport, so the app's page is 240 x 320 here.
  const bytes = await exportObjects(file, [SHAPES.rect], { width: 240, height: 320 });
  const [entry] = await readAnnots(bytes);
  assert.ok(entry.form, 'the rotated page still gets an appearance');
  assert.ok(entry.matrix, 'the page turn is carried by the appearance /Matrix');
  // BBox through Matrix must land exactly on /Rect - otherwise the viewer
  // scales the appearance to fit.
  const [a, b, c, d, e, f] = entry.matrix;
  const corners = [
    [entry.bbox[0], entry.bbox[1]], [entry.bbox[2], entry.bbox[1]],
    [entry.bbox[2], entry.bbox[3]], [entry.bbox[0], entry.bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const mapped = [
    Math.min(...corners.map((point) => point[0])),
    Math.min(...corners.map((point) => point[1])),
    Math.max(...corners.map((point) => point[0])),
    Math.max(...corners.map((point) => point[1])),
  ];
  mapped.forEach((value, index) => near(value, entry.rect[index], 1e-6, `mapped /BBox[${index}] vs /Rect[${index}]`));
});

test('a tilted ellipse keeps its stroke inside the appearance box and re-imports at its true size', async () => {
  // Its /AP /BBox used to be the EXACT ellipse box, so the form clipped the
  // outer half of the outline - 1.25pt of missing stroke against the flattened
  // print in poppler, cairo and Quartz. The box is padded now and /RD carries
  // the pad back, so rx / ry still come home.
  const file = await makePdfFile();
  const tilted = {
    id: 'p-ellipse', type: 'ellipse', left: 60, top: 50,
    rx: 70, ry: 40, width: 140, height: 80, angle: 27,
    stroke: '#7a2f8f', strokeWidth: 2.5, fill: 'transparent',
  };
  const bytes = await exportObjects(file, [tilted]);
  const [entry] = await readAnnots(bytes);
  assert.equal(entry.subtype, '/Circle');
  assert.ok(entry.bbox, 'the tilted ellipse ships an /AP form');
  const padX = (entry.bbox[2] - entry.bbox[0] - tilted.rx * 2) / 2;
  const padY = (entry.bbox[3] - entry.bbox[1] - tilted.ry * 2) / 2;
  assert.ok(padX >= tilted.strokeWidth / 2, `/BBox holds the outer half stroke in x (${padX})`);
  assert.ok(padY >= tilted.strokeWidth / 2, `/BBox holds the outer half stroke in y (${padY})`);
  assert.ok(Array.isArray(entry.rd) && entry.rd.every((value) => Math.abs(value - padX) < 1e-6), '/RD records the pad');

  const [back] = await reimport(bytes, { stripMetadata: true });
  assert.ok(back, 'the tilted ellipse re-imports');
  near(back.rx ?? back.radius, tilted.rx, 0.1, 'rx');
  near(back.ry ?? back.radius, tilted.ry, 0.1, 'ry');
  near(Math.abs(Number(back.angle)), tilted.angle, 0.1, 'angle');
});

test('a cloud shape keeps its own scalloped appearance, not the plain one', async () => {
  const file = await makePdfFile();
  const bytes = await exportObjects(file, [{ ...SHAPES.rect, data: { pdfCloudIntensity: 2 } }]);
  const [entry] = await readAnnots(bytes);
  assert.ok(entry.form, 'the cloud has an appearance');
  assert.ok(entry.dict.get(PDFName.of('BE')), 'the cloud still declares its /BE cloudy border effect');
  // The cloud's appearance box is inflated by the scallops, far more than the
  // plain half-stroke pad would be.
  assert.ok(entry.rd.some((value) => value > 4), `a scalloped /RD, not a half-stroke pad: ${JSON.stringify(entry.rd)}`);
});
