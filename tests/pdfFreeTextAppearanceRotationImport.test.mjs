// A genuinely upside-down /FreeText must import upside down
// (verify-export-3p round 3, 2026-09-09).
//
// computeAppearanceRotationTransform recovers a shape's tilt from its /AP /N
// /Matrix. It returns null - "no tilt" - when the angle is within 0.05 degrees
// of 0, which is right, and it ALSO returned null within 0.05 degrees of 180.
// That second short-circuit was added for our own exporter's /Rotate 180 pages
// (where the page turn is written into /Matrix and the shape is upright on
// screen), but a half turn is only a visual no-op for a rectangle, circle or
// ellipse. For a TEXT box it is not: an upside-down label imported the right
// way up, and the text then read the wrong way against the page.
//
// The fixture is a Drawboard/Acrobat-shaped FreeText: /Rect axis-aligned, the
// rotation baked into the appearance /Matrix.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFString, PDFArray } from 'pdf-lib';

import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const PAGE = { width: 320, height: 240 };

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

/**
 * A /FreeText whose appearance carries `angleDeg` of rotation about the middle
 * of its box, exactly the way Drawboard and Acrobat store a tilted label:
 * /Rect is the axis-aligned page box of the tilted text, /AP /N /BBox is the
 * UN-rotated box and /AP /N /Matrix turns it.
 */
const makeRotatedFreeTextPdf = async ({ angleDeg, text = 'Upside down', boxWidth = 140, boxHeight = 40, pageRotate = 0 }) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  page.setMediaBox(0, 0, PAGE.width, PAGE.height);
  page.setCropBox(0, 0, PAGE.width, PAGE.height);
  if (pageRotate) page.node.set(PDFName.of('Rotate'), doc.context.obj(pageRotate));

  const theta = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Rotation about the centre of the un-rotated /BBox [0 0 w h].
  const cx = boxWidth / 2;
  const cy = boxHeight / 2;
  const matrix = [
    cos, sin, -sin, cos,
    cx - cx * cos + cy * sin,
    cy - cx * sin - cy * cos,
  ];
  const font = doc.context.register(doc.context.obj({
    Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
  }));
  const content = [
    'q', '0 0 0 rg', 'BT', '/F1 12 Tf', `1 0 0 1 6 ${(boxHeight / 2 - 4).toFixed(2)} Tm`, `(${text}) Tj`, 'ET', 'Q',
  ].join('\n');
  const form = doc.context.register(doc.context.flateStream(`${content}\n`, {
    Type: 'XObject', Subtype: 'Form', FormType: 1,
    BBox: [0, 0, boxWidth, boxHeight],
    Matrix: matrix,
    Resources: { Font: { F1: font } },
  }));

  // /Rect = axis-aligned page bounds of the rotated box, centred at (140, 120).
  const centre = { x: 140, y: 120 };
  const halfW = Math.abs((boxWidth / 2) * cos) + Math.abs((boxHeight / 2) * sin);
  const halfH = Math.abs((boxWidth / 2) * sin) + Math.abs((boxHeight / 2) * cos);
  const annot = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: [centre.x - halfW, centre.y - halfH, centre.x + halfW, centre.y + halfH],
    Contents: PDFString.of(text),
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'),
    AP: { N: form },
    Border: [0, 0, 0],
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  return doc.save();
};

const importObjects = async (bytes) => {
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdfDoc = await task.promise;
  try {
    const imported = await quiet(() => importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes }));
    return imported.annotationsByPage?.[1]?.objects || [];
  } finally {
    await task.destroy();
  }
};

const halfTurnAway = (angle) => Math.abs(Math.abs(((Number(angle) || 0) + 180) % 360 - 180) - 180);

test('a /FreeText rotated 180 degrees in its appearance imports upside down, not upright', async () => {
  const bytes = await makeRotatedFreeTextPdf({ angleDeg: 180 });
  const [obj] = await importObjects(bytes);
  assert.ok(obj, 'the text box imports');
  assert.equal(String(obj.type).toLowerCase(), 'textbox');
  assert.ok(
    halfTurnAway(obj.angle) < 0.5,
    `expected a half turn, got angle ${obj.angle}`,
  );
});

test('a /FreeText rotated 179.5 degrees is not rounded away either', async () => {
  const bytes = await makeRotatedFreeTextPdf({ angleDeg: 179.5 });
  const [obj] = await importObjects(bytes);
  assert.ok(obj, 'the text box imports');
  assert.ok(Math.abs(Math.abs(Number(obj.angle)) - 179.5) < 0.5, `expected ~179.5, got ${obj.angle}`);
});

test('an untilted /FreeText still imports upright', async () => {
  const bytes = await makeRotatedFreeTextPdf({ angleDeg: 0 });
  const [obj] = await importObjects(bytes);
  assert.ok(obj, 'the text box imports');
  assert.ok(!obj.angle || Math.abs(Number(obj.angle)) < 0.05, `expected no tilt, got ${obj.angle}`);
});

test('a half-turned Square is still treated as untilted - it looks identical either way', async () => {
  // The half-turn short-circuit stays for shapes where it is a visual no-op,
  // so this keeps the /Rotate 180 page handling that added it.
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  page.setMediaBox(0, 0, PAGE.width, PAGE.height);
  page.setCropBox(0, 0, PAGE.width, PAGE.height);
  const width = 120; const height = 70;
  const content = ['q', '0.77 0.15 0.28 RG', '2 w', `1 1 ${width - 2} ${height - 2} re`, 'S', 'Q'].join('\n');
  const form = doc.context.register(doc.context.flateStream(`${content}\n`, {
    Type: 'XObject', Subtype: 'Form', FormType: 1,
    BBox: [0, 0, width, height],
    Matrix: [-1, 0, 0, -1, width, height],
    Resources: {},
  }));
  const annot = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Square',
    Rect: [80, 85, 80 + width, 85 + height],
    C: [0.77, 0.15, 0.28],
    Border: [0, 0, 2],
    AP: { N: form },
    Contents: PDFString.of(''),
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  const [obj] = await importObjects(await doc.save());
  assert.ok(obj, 'the square imports');
  assert.ok(!obj.angle || Math.abs(Number(obj.angle)) < 0.05, `expected no tilt on a half-turned square, got ${obj.angle}`);
});

test("our own export of an upright text box on a /Rotate 180 page still imports upright", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE.width, PAGE.height]);
  page.setMediaBox(0, 0, PAGE.width, PAGE.height);
  page.setCropBox(0, 0, PAGE.width, PAGE.height);
  page.node.set(PDFName.of('Rotate'), source.context.obj(180));
  const sourceBytes = await source.save();
  const file = {
    name: 'rot180.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
  const original = globalThis.window;
  globalThis.window = {};
  let exported;
  try {
    exported = await quiet(() => savePDFWithAnnotationsPdfLib(
      file,
      { 1: { objects: [{ id: 't', type: 'textbox', left: 40, top: 60, width: 140, height: 40, text: 'Upright', fontSize: 12, fill: '#222222', stroke: 'transparent', strokeWidth: 0 }] } },
      { 1: PAGE },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'rot180-freetext' },
    ));
  } finally {
    globalThis.window = original;
  }
  const doc = await PDFDocument.load(exported);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots instanceof PDFArray && annots.size() === 1, 'the text box is exported');
  annots.asArray().forEach((ref) => doc.context.lookup(ref).delete(PDFName.of('SurveyAppAnnotation')));
  const [obj] = await importObjects(await doc.save());
  assert.ok(obj, 'the text box re-imports');
  assert.ok(!obj.angle || Math.abs(Number(obj.angle)) < 0.05, `the page turn must not read as a shape tilt, got ${obj.angle}`);
});
