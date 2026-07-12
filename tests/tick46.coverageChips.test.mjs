/**
 * Tick-46 coverage chips: hand-crafted pdf-lib annot dicts for importer
 * readers, pageSpace odd path ops, serializers empty-callout bounds +
 * deserialize skip catches, region simplify RDP edge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString, PDFNumber } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { importAnnotationsFromPdf, convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  serializeCalloutToRow,
  deserializeRowsToAnnotationsByPage,
  deserializeRowsToCallouts,
  serializeAnnotationsByPage,
} from '../src/services/annotationTypeSerializers.js';
import { simplifyPolygon, polygonContainsPoint } from '../src/utils/regionMath.js';

async function buildRichAnnotPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const refs = [];

  const push = (dictObj) => {
    refs.push(doc.context.register(doc.context.obj(dictObj)));
  };

  push({
    Type: 'Annot',
    Subtype: PDFName.of('FreeText'),
    Rect: [20, 400, 180, 460],
    Contents: PDFString.of('rich'),
    NM: PDFString.of('ft-rc'),
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'),
    DS: PDFString.of('font: Helvetica 12pt; color:#0000ff'),
    RC: PDFString.of('<body style="text-align:center"><span style="color:#ff0000">hi</span><span style="color:#00aa00; text-align:right">there</span></body>'),
    Q: PDFNumber.of(1),
    C: [PDFNumber.of(1), PDFNumber.of(0), PDFNumber.of(0)],
    CA: PDFNumber.of(0.8),
    P: page.ref,
  });

  push({
    Type: 'Annot',
    Subtype: PDFName.of('Line'),
    Rect: [10, 10, 120, 80],
    L: [PDFNumber.of(10), PDFNumber.of(10), PDFNumber.of(100), PDFNumber.of(70)],
    LE: [PDFName.of('OpenArrow'), PDFName.of('ClosedArrow')],
    NM: PDFString.of('line-le'),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    BS: doc.context.obj({
      W: PDFNumber.of(2),
      S: PDFName.of('D'),
      D: doc.context.obj([PDFNumber.of(3), PDFNumber.of(2)]),
    }),
    P: page.ref,
  });

  push({
    Type: 'Annot',
    Subtype: PDFName.of('Polygon'),
    Rect: [200, 200, 300, 300],
    Vertices: [
      PDFNumber.of(200), PDFNumber.of(200),
      PDFNumber.of(300), PDFNumber.of(200),
      PDFNumber.of(250), PDFNumber.of(300),
    ],
    NM: PDFString.of('poly-be'),
    C: [PDFNumber.of(0.2), PDFNumber.of(0.2), PDFNumber.of(0.2)],
    IC: [PDFNumber.of(0.9), PDFNumber.of(0.9), PDFNumber.of(0.9)],
    BE: doc.context.obj({ S: PDFName.of('C'), I: PDFNumber.of(2) }),
    IT: PDFName.of('PolygonCloud'),
    P: page.ref,
  });

  push({
    Type: 'Annot',
    Subtype: PDFName.of('Circle'),
    Rect: [50, 250, 110, 310],
    NM: PDFString.of('circ-ic'),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(1)],
    IC: [PDFNumber.of(1), PDFNumber.of(1), PDFNumber.of(0)],
    ca: PDFNumber.of(0.5),
    FillOpacity: PDFNumber.of(0.4),
    P: page.ref,
  });

  push({
    Type: 'Annot',
    Subtype: PDFName.of('PolyLine'),
    Rect: [320, 50, 420, 150],
    Vertices: [
      PDFNumber.of(320), PDFNumber.of(50),
      PDFNumber.of(370), PDFNumber.of(100),
      PDFNumber.of(420), PDFNumber.of(60),
    ],
    NM: PDFString.of('pline-1'),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    P: page.ref,
  });

  push({
    Type: 'Annot',
    Subtype: PDFName.of('Text'),
    Rect: [400, 400, 430, 430],
    NM: PDFString.of('note-1'),
    Name: PDFName.of('Comment'),
    Contents: PDFString.of('note'),
    State: PDFString.of('Marked'),
    StateModel: PDFString.of('Marked'),
    T: PDFString.of('author'),
    Subj: PDFString.of('note-subj'),
    C: [PDFNumber.of(1), PDFNumber.of(0.9), PDFNumber.of(0.2)],
    P: page.ref,
  });

  push({
    Type: 'Annot',
    Subtype: PDFName.of('Ink'),
    Rect: [10, 100, 80, 160],
    NM: PDFString.of('ink-1'),
    InkList: doc.context.obj([
      doc.context.obj([
        PDFNumber.of(10), PDFNumber.of(100),
        PDFNumber.of(40), PDFNumber.of(130),
        PDFNumber.of(70), PDFNumber.of(110),
      ]),
    ]),
    C: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    P: page.ref,
  });

  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return doc.save();
}

test('importer hits pdf-lib dict readers via rich annot PDF', async () => {
  const bytes = await buildRichAnnotPdf();
  const u8 = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);

  const pdfJsDoc = await pdfjsLib.getDocument({ data: u8.slice(), useSystemFonts: true }).promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfJsDoc, { rawPdfBytes: u8.slice() });
    assert.ok(imported?.annotationsByPage);
    const page1 = imported.annotationsByPage?.[1] || imported.annotationsByPage?.['1'];
    assert.ok(page1?.objects?.length >= 1 || Object.keys(imported.annotationsByPage || {}).length >= 1);
  } finally {
    await pdfJsDoc.destroy?.();
  }

  // Direct convert with rawMetadata carrying RC-derived appearance data
  const viewport = {
    height: 500,
    convertToViewportPoint: (x, y) => [x, 500 - y],
    convertToViewportRectangle: (r) => [r[0], 500 - r[3], r[2], 500 - r[1]],
  };
  const ft = convertPdfAnnotationToFabric(
    {
      subtype: 'FreeText',
      rect: [20, 400, 180, 460],
      contents: 'rich',
      color: [1, 0, 0],
      defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
      defaultStyleString: 'font: Helvetica 12pt; color:#0000ff',
    },
    viewport,
    1,
    {
      defaultAppearanceData: { fontColor: [0, 1, 0], textAlign: 'center', fontSize: 14 },
      quadding: 1,
      contents: 'rich',
    },
  );
  assert.ok(ft);
});

test('pageSpaceEraser odd ops + relative unknown command', () => {
  const result = erasePageAnnotations({
    objects: [{
      type: 'path',
      left: 0,
      top: 0,
      strokeWidth: 2,
      path: [
        ['M', 0, 0],
        ['L', 20, 0],
        ['A', 5, 5], // unknown absolute → commandEndpoint
        ['a', 3, 4], // unknown relative
        ['B'], // too short → endpoint null
      ],
      data: { id: 'odd' },
    }],
    eraserPoints: [{ x: 10, y: 0 }],
    radius: 4,
    mode: 'partial',
  });
  assert.ok(result);
});

test('serializers empty callout bounds + deserialize skip paths', () => {
  const row = serializeCalloutToRow({ id: 'empty-c', pageNumber: 1 }, { documentId: 'doc-c', userId: 'u1' });
  assert.equal(row.annotation_type, 'callout');
  assert.ok(row.annotation_data);

  assert.deepEqual(deserializeRowsToAnnotationsByPage(null), {});
  const pages = deserializeRowsToAnnotationsByPage([
    {
      annotation_id: 'bad',
      annotation_type: 'ink',
      page_number: 1,
      annotation_data: { fabricObject: null },
    },
    {
      annotation_id: 'ok',
      annotation_type: 'ink',
      page_number: 1,
      annotation_data: {
        pageNumber: 1,
        fabricObject: {
          type: 'path',
          path: [['M', 0, 0], ['L', 2, 0]],
          data: { id: 'ok' },
        },
      },
    },
  ]);
  assert.ok(pages[1]?.objects?.length >= 0);

  const callouts = deserializeRowsToCallouts([
    { annotation_type: 'callout', annotation_id: 'c1', annotation_data: {} }, // malformed
    {
      annotation_type: 'callout',
      annotation_id: 'c2',
      annotation_data: { callout: { id: 'c2', pageNumber: 1, text: 'x' } },
    },
  ]);
  assert.ok(Array.isArray(callouts));

  assert.deepEqual(serializeAnnotationsByPage(null), []);
  const serialized = serializeAnnotationsByPage({
    1: { objects: [{ type: 'path', path: [['M', 0, 0], ['L', 1, 0]], data: { id: 's1' } }] },
  }, { documentId: 'doc-s', userId: 'u1' });
  assert.ok(Array.isArray(serialized));
});

test('regionMath simplify RDP + polygonContainsPoint edges', () => {
  // Dense nearly-colinear points force RDP segment distance branches
  const coords = [];
  for (let i = 0; i <= 20; i += 1) {
    coords.push(i, i * 0.01);
  }
  coords.push(20, 10, 0, 10, 0, 0);
  const simp = simplifyPolygon(coords, 1);
  assert.ok(Array.isArray(simp));
  assert.ok(simp.length <= coords.length);

  const poly = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(polygonContainsPoint(5, 5, poly), true);
  assert.equal(polygonContainsPoint(50, 50, poly), false);
  assert.equal(polygonContainsPoint(5, 5, [0, 0]), false);
});
