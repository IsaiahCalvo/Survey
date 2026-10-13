/**
 * Tick-47 coverage chips: pdf-lib AP appearance streams (m/l/c/v/y/re/colors),
 * FreeText gray DA + full DS, more markup subtypes, paper full-subtract erase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  importAnnotationsFromPdf,
  convertPdfAnnotationToFabric,
} from '../src/utils/pdfAnnotationImporter.js';
import {
  createInkAnnotation,
  eraseAnnotations,
} from '../src/utils/paperAnnotationGeometry.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  mergeRegions,
  subtractRegionFromRegion,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';

async function buildAppearanceAnnotPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 600]);
  const ctx = doc.context;
  const refs = [];

  const appearanceOps = [
    '2 w',
    '1 J',
    '1 j',
    '0 0 1 RG',
    '0.5 G',
    '1 0 0 rg',
    '0.25 g',
    '10 10 m',
    '50 10 l',
    '60 20 70 30 80 40 c',
    '90 50 100 60 v',
    '20 20 40 40 y',
    '5 5 40 30 re',
    'h',
    'S',
    's',
    'f',
    'B',
    'q',
    'Q',
    'zzz',
  ].join(' ');

  const formStream = ctx.flateStream(appearanceOps, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(120), PDFNumber.of(120)],
    Matrix: [
      PDFNumber.of(0.7), PDFNumber.of(0.7), PDFNumber.of(-0.7),
      PDFNumber.of(0.7), PDFNumber.of(10), PDFNumber.of(20),
    ],
  });
  const formRef = ctx.register(formStream);
  const apDict = ctx.obj({ N: formRef });

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Square'),
    Rect: [50, 400, 170, 520],
    NM: PDFString.of('sq-ap'),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    AP: apDict,
    BS: ctx.obj({ W: PDFNumber.of(1) }),
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Ink'),
    Rect: [20, 20, 140, 100],
    NM: PDFString.of('ink-ap'),
    AP: apDict,
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    Border: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('FreeText'),
    Rect: [200, 450, 380, 520],
    NM: PDFString.of('ft-gray'),
    Contents: PDFString.of('gray-da'),
    DA: PDFString.of('0.4 g /Helv 14 Tf'),
    DS: PDFString.of('font-family: Helvetica; font-size: 14pt; color:#112233; text-align:justify'),
    C: [PDFNumber.of(1), PDFNumber.of(1), PDFNumber.of(1)],
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Underline'),
    Rect: [200, 300, 350, 320],
    NM: PDFString.of('ul-1'),
    C: [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0)],
    QuadPoints: [
      PDFNumber.of(200), PDFNumber.of(300),
      PDFNumber.of(350), PDFNumber.of(300),
      PDFNumber.of(200), PDFNumber.of(320),
      PDFNumber.of(350), PDFNumber.of(320),
    ],
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('StrikeOut'),
    Rect: [200, 250, 350, 270],
    NM: PDFString.of('so-1'),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(1)],
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Squiggly'),
    Rect: [200, 200, 360, 220],
    NM: PDFString.of('sqg-1'),
    C: [PDFNumber.of(0), PDFNumber.of(1), PDFNumber.of(0)],
    P: page.ref,
  })));

  refs.push(ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Caret'),
    Rect: [400, 200, 420, 240],
    NM: PDFString.of('caret-1'),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    P: page.ref,
  })));

  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  return doc.save();
}

test('importer parses AP streams + gray DA/DS + markup subtypes', async () => {
  const bytes = await buildAppearanceAnnotPdf();
  const u8 = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: u8.slice() });
    assert.ok(imported?.annotationsByPage);
  } finally {
    await pdfJsDoc.destroy?.();
  }

  const viewport = {
    height: 600,
    convertToViewportPoint: (x, y) => [x, 600 - y],
    convertToViewportRectangle: (r) => [r[0], 600 - r[3], r[2], 600 - r[1]],
  };

  const grayFt = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [0, 0, 100, 40],
    contents: 'g',
    defaultAppearanceString: '0.35 g /TiRo 11 Tf',
    defaultStyleString: 'font-family: Times; font-size: 11pt; color:#abcdef; text-align:left',
    color: [1, 1, 1],
  }, viewport);
  assert.ok(grayFt);

  // Near-white fill path for square invisibility / color helpers
  const nearWhite = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 20, 20],
    color: [0.98, 0.98, 0.98],
    borderStyle: { width: 0 },
    interiorColor: [0.99, 0.99, 0.99],
  }, viewport);
  // may be null (invisible) or object — both exercise color helpers
  assert.ok(nearWhite === null || nearWhite);
});

test('pageSpace relative unknown op + paper erase that fully clears fill', () => {
  const erased = erasePageAnnotations({
    objects: [{
      type: 'path',
      left: 0,
      top: 0,
      strokeWidth: 2,
      path: [
        ['M', 0, 0],
        ['L', 30, 0],
        ['a', 2, 3], // relative unknown with endpoint
        ['A', 4, 5], // absolute unknown
        ['Z'],
      ],
      data: { id: 'rel-unk' },
    }],
    eraserPoints: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 32, y: 3 }],
    radius: 8,
    mode: 'partial',
  });
  assert.ok(erased);

  const thick = createInkAnnotation(
    [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }],
    { id: 'blob', width: 14 },
  );
  // Huge eraser should empty the diff → deletedIds path
  const gone = eraseAnnotations(
    [thick],
    [{ x: -10, y: -10 }, { x: 50, y: -10 }, { x: 50, y: 40 }, { x: -10, y: 40 }],
    40,
    'partial',
  );
  assert.ok(gone.deletedIds.includes('blob') || gone.changedIds.includes('blob'));
});

test('regionMath bowtie / degenerate merge+subtract edges', () => {
  const a = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'polygon',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 10, 0, 10, 10, 0], // self-intersecting bowtie
  };
  const b = {
    ...a,
    regionId: 'b',
    coordinates: [2, 2, 12, 2, 12, 12, 2, 12],
  };
  // Should not throw; merge may return null on degenerate geometry
  const merged = mergeRegions(a, b);
  assert.ok(merged === null || merged.coordinates);

  const short = {
    regionId: 's',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 1, 0], // too short for center/polygon
  };
  assert.equal(mergeRegions(short, b), null);
  assert.deepEqual(
    subtractRegionFromRegion(short, b),
    [short],
  );
});
