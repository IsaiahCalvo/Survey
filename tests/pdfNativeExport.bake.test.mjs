// KAL-52 — Phase D bake function tests.
// Verifies bakeAnnotationsIntoPdf writes editable native PDF annotations
// for every v1-supported subtype and that the resulting bytes round-trip
// through the existing low-level Annot lookups (the same shape the
// importer relies on).

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { bakeAnnotationsIntoPdf } from '../src/utils/pdfNativeExport/index.js';

const PAGE_W = 200;
const PAGE_H = 200;

async function makeBlankPdfBytes() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  return doc.save();
}

async function readAnnots(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    return {
      subtype: dict.get(PDFName.of('Subtype'))?.decodeText?.() || null,
      rect: dict.get(PDFName.of('Rect'))?.asArray?.()?.map((n) => (typeof n.value === 'function' ? n.value() : Number(n))) || null,
      name: dict.get(PDFName.of('NM'))?.decodeText?.() || null,
      hasContents: Boolean(dict.get(PDFName.of('Contents'))),
      hasL: Boolean(dict.get(PDFName.of('L'))),
      hasVertices: Boolean(dict.get(PDFName.of('Vertices'))),
      hasInkList: Boolean(dict.get(PDFName.of('InkList'))),
      hasQuadPoints: Boolean(dict.get(PDFName.of('QuadPoints'))),
    };
  });
}

test('bake writes every v1 subtype as a native annotation dict', async () => {
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    1: {
      objects: [
        { id: 'sq', type: 'rect', left: 10, top: 10, width: 20, height: 20, stroke: '#111111' },
        { id: 'ci', type: 'circle', left: 40, top: 10, radius: 8, stroke: '#111111' },
        { id: 'ln', type: 'line', x1: 10, y1: 60, x2: 50, y2: 60, stroke: '#111111' },
        { id: 'ft', type: 'textbox', left: 10, top: 80, width: 60, height: 20, text: 'Note', fill: '#111111' },
        { id: 'pg', type: 'polygon', left: 80, top: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }], stroke: '#111111' },
        { id: 'pl', type: 'polyline', left: 110, top: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], stroke: '#111111' },
        { id: 'ik', type: 'path', path: [['M', 130, 130], ['L', 150, 150]], stroke: '#111111' },
        { id: 'hl', type: 'rect', exportType: 'highlight', left: 10, top: 130, width: 30, height: 10, fill: '#ffff00' },
        { id: 'un', type: 'rect', exportType: 'underline', left: 50, top: 130, width: 30, height: 10, fill: '#ff0000' },
        { id: 'sq2', type: 'rect', exportType: 'squiggly', left: 90, top: 130, width: 30, height: 10, fill: '#ff0000' },
        { id: 'st', type: 'rect', exportType: 'strikeout', left: 130, top: 130, width: 30, height: 10, fill: '#ff0000' },
      ],
    },
  });
  const annots = await readAnnots(bytes);
  const subtypes = annots.map((a) => a.subtype).sort();
  assert.deepEqual(subtypes, [
    'Circle', 'FreeText', 'Highlight', 'Ink',
    'Line', 'PolyLine', 'Polygon', 'Square',
    'Squiggly', 'StrikeOut', 'Underline',
  ]);
});

test('bake returns audit object on returnAudit=true', async () => {
  const result = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    1: {
      objects: [
        { id: 'sq', type: 'rect', left: 10, top: 10, width: 20, height: 20 },
        { id: 'unk', type: 'something-bogus' },
        { id: 'bad-rect', type: 'rect', left: 0, top: 0, width: 0, height: 0 },
      ],
    },
  }, { returnAudit: true });

  assert.equal(result.audit.totalConsidered, 3);
  assert.equal(result.audit.written, 1);
  assert.equal(result.audit.skipped, 2);
  assert.equal(result.audit.byPdfSubtype.Square, 1);
  assert.equal(result.audit.droppedByReason['no-adapter'], 1);
  assert.equal(result.audit.droppedByReason['adapter-returned-null'], 1);
});

test('bake reports missing-pdf-page when page key is out of range', async () => {
  const result = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    99: { objects: [{ type: 'rect', left: 0, top: 0, width: 10, height: 10 }] },
  }, { returnAudit: true });
  assert.equal(result.audit.written, 0);
  assert.equal(result.audit.droppedByReason['missing-pdf-page'], 1);
});

test('bake preserves existing annotations on the page', async () => {
  // Pre-seed the source PDF with an existing native circle annotation,
  // then bake a Square on top — the original should survive.
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_W, PAGE_H]);
  const native = source.context.register(source.context.obj({
    Type: 'Annot',
    Subtype: 'Circle',
    Rect: [20, 160, 40, 180],
    Border: [0, 0, 1],
    Contents: '',
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), source.context.obj([native]));
  const sourceBytes = await source.save();

  const baked = await bakeAnnotationsIntoPdf(sourceBytes, {
    1: { objects: [{ type: 'rect', left: 60, top: 60, width: 20, height: 20 }] },
  });
  const annots = await readAnnots(baked);
  const subtypes = annots.map((a) => a.subtype).sort();
  assert.deepEqual(subtypes, ['Circle', 'Square']);
});

test('bake round-trips by reading back annotation Rect with Y-flip preserved', async () => {
  // The round-trip contract: an app annotation at (left=10, top=20,
  // width=40, height=30) in app-space MUST come back from PDF as the
  // same rect when re-parsed.
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    1: {
      objects: [
        { id: 'roundtrip-sq', type: 'rect', left: 10, top: 20, width: 40, height: 30, stroke: '#000000' },
      ],
    },
  });
  const annots = await readAnnots(bytes);
  assert.equal(annots.length, 1);
  const [x1, y1, x2, y2] = annots[0].rect;
  // Convert back to app space and assert tolerance < 0.5px
  const appLeft = x1;
  const appTop = PAGE_H - y2;
  const appWidth = x2 - x1;
  const appHeight = y2 - y1;
  assert.ok(Math.abs(appLeft - 10) < 0.5);
  assert.ok(Math.abs(appTop - 20) < 0.5);
  assert.ok(Math.abs(appWidth - 40) < 0.5);
  assert.ok(Math.abs(appHeight - 30) < 0.5);
});

test('bake honors KAL-8 contract: caller controls scope filtering', async () => {
  // The bake function itself does not inspect moduleId/regionId/spaceId —
  // it bakes whatever the caller passes. The KAL-8 contract is owned by
  // the upstream buildPdfExportAnnotationPlan in pdfAnnotationsPdfLib.js,
  // which we do not touch (DO NOT CHANGE).
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    1: {
      objects: [
        // Caller is responsible for not passing these in for KAL-8
        // compliance — we should still bake what we're given.
        { id: 'scoped', type: 'rect', left: 10, top: 10, width: 20, height: 20, moduleId: 'mod-1' },
      ],
    },
  });
  const annots = await readAnnots(bytes);
  assert.equal(annots.length, 1);
  assert.equal(annots[0].subtype, 'Square');
});
