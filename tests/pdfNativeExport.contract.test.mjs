// KAL-52 — Contract assertions for the bake pipeline.
// Verifies the KAL-8 visibility contract owned by buildPdfExportAnnotationPlan
// is still honored from the bake-pipeline side: scoped annotations
// (survey, region, space, survey-region) MUST NOT be exported when the
// caller routes through the existing buildPdfExportAnnotationPlan filter
// before passing objects to bakeAnnotationsIntoPdf. This test verifies
// that the wiring shape works — DO NOT CHANGE tests/pdfSaveExportContract.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { bakeAnnotationsIntoPdf } from '../src/utils/pdfNativeExport/index.js';
import { buildPdfExportAnnotationPlan } from '../src/utils/pdfAnnotationsPdfLib.js';

async function makeBlankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

async function readSubtypes(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref).get(PDFName.of('Subtype')).decodeText());
}

test('bake honors KAL-8 scope contract when fed through buildPdfExportAnnotationPlan', async () => {
  const pageSizes = { 1: { width: 200, height: 200 } };
  const annotationsByPage = {
    1: {
      objects: [
        { id: 'regular', type: 'rect', left: 10, top: 10, width: 20, height: 20 },
        { id: 'survey', type: 'circle', left: 40, top: 10, radius: 8, moduleId: 'module-a' },
        { id: 'region', type: 'line', x1: 10, y1: 60, x2: 50, y2: 60, regionId: 'region-a' },
        { id: 'survey-region', type: 'textbox', left: 10, top: 80, width: 60, height: 20, text: 'SR', moduleId: 'module-a', regionId: 'region-a' },
      ],
    },
  };

  // Route through the existing scope filter — KAL-8 contract.
  const plan = buildPdfExportAnnotationPlan({
    annotationsByPage,
    pageSizes,
    spaces: [{ id: 'space-a', assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-a' }] }] }],
  });

  // Re-bucket plan items into the bake input shape.
  const bakeInput = {};
  for (const item of plan.items) {
    const key = String(item.pageNumber);
    bakeInput[key] = bakeInput[key] || { objects: [] };
    bakeInput[key].objects.push(item.object);
  }

  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), bakeInput);
  const subtypes = await readSubtypes(bytes);
  // Only the canvas-scope rect should round-trip; survey/region/survey-region are dropped by the planner.
  assert.deepEqual(subtypes, ['Square']);
});

test('bake supports the full v1 adapter list per KAL-52 acceptance criteria', async () => {
  // From the ticket: Square, Circle, Line, FreeText, Polygon, PolyLine, Ink
  // plus text markup: Highlight, Underline, Squiggly, StrikeOut.
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdf(), {
    1: {
      objects: [
        { type: 'rect', left: 0, top: 0, width: 10, height: 10 },
        { type: 'circle', left: 20, top: 0, radius: 5 },
        { type: 'line', x1: 0, y1: 30, x2: 30, y2: 30 },
        { type: 'textbox', left: 0, top: 40, width: 50, height: 15, text: 't' },
        { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] },
        { type: 'polyline', points: [{ x: 60, y: 60 }, { x: 80, y: 80 }] },
        { type: 'path', path: [['M', 100, 100], ['L', 120, 120]] },
        { type: 'rect', exportType: 'highlight', left: 0, top: 100, width: 10, height: 5, fill: '#ffff00' },
        { type: 'rect', exportType: 'underline', left: 20, top: 100, width: 10, height: 5 },
        { type: 'rect', exportType: 'squiggly', left: 40, top: 100, width: 10, height: 5 },
        { type: 'rect', exportType: 'strikeout', left: 60, top: 100, width: 10, height: 5 },
      ],
    },
  });
  const subtypes = (await readSubtypes(bytes)).sort();
  assert.deepEqual(subtypes, [
    'Circle', 'FreeText', 'Highlight', 'Ink',
    'Line', 'PolyLine', 'Polygon', 'Square',
    'Squiggly', 'StrikeOut', 'Underline',
  ]);
});

test('bake audit report names every annotation with a corresponding adapter', async () => {
  // Acceptance criterion: "every annotation has a corresponding adapter
  // and no annotations were silently dropped" — verified via audit object.
  const { audit } = await bakeAnnotationsIntoPdf(await makeBlankPdf(), {
    1: {
      objects: [
        { id: 'a', type: 'rect', left: 0, top: 0, width: 10, height: 10 },
        { id: 'b', type: 'circle', left: 0, top: 20, radius: 5 },
        { id: 'c', type: 'line', x1: 0, y1: 40, x2: 30, y2: 40 },
      ],
    },
  }, { returnAudit: true });

  assert.equal(audit.totalConsidered, 3);
  assert.equal(audit.written, 3);
  assert.equal(audit.skipped, 0);
  assert.deepEqual(Object.keys(audit.droppedByReason), []);
});
