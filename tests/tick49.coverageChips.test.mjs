/**
 * Tick-49 coverage chips: FreeText/Circle/Square rotation via _appearance
 * matrix, callout AP textbox rect multi-subpath, ink norm diag, titleObj,
 * polyline lineCoordinates fallback, backfill cutover lookup throw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
} from '../src/utils/pdfAnnotationImporter.js';
import { runBackfill } from '../src/lib/collab/crdtBackfill.js';
import { __resetDocumentMetadataCacheForTests } from '../src/services/documentMetadataResolver.js';
import {
  mergeRegions,
  subtractRegionFromRegion,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';

function makeViewport(h = 600) {
  return {
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

const rotatedAppearance = {
  matrix: [0.707, 0.707, -0.707, 0.707, 0, 0],
  bbox: [0, 0, 80, 40],
  path: [
    ['M', 0, 0], ['L', 80, 0], ['L', 80, 40], ['L', 0, 40], ['Z'],
  ],
  strokeColor: [1, 0, 0],
  hasStroke: true,
  hasFill: false,
};

test('importer rotation transforms + callout appearance textbox + ink diag', () => {
  const viewport = makeViewport();

  const rotatedFt = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [10, 100, 120, 180],
    contents: 'tilted',
    color: [0, 0, 0],
    borderStyle: { width: 1 },
    defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
    _appearance: rotatedAppearance,
  }, viewport);
  assert.ok(rotatedFt);
  assert.ok(rotatedFt.angle || rotatedFt.type === 'textbox');

  const rotatedCircle = convertPdfAnnotationToFabric({
    subtype: 'Circle',
    rect: [0, 0, 100, 60],
    color: [0, 0, 1],
    interiorColor: [1, 1, 0],
    borderStyle: { width: 1 },
    ca: 0.5,
    _appearance: {
      matrix: [0.866, 0.5, -0.5, 0.866, 0, 0],
      bbox: [0, 0, 100, 40],
    },
  }, viewport);
  assert.ok(rotatedCircle);
  assert.equal(rotatedCircle.type, 'ellipse');

  const rotatedSquare = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 90, 50],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
    _appearance: rotatedAppearance,
  }, viewport);
  assert.ok(rotatedSquare);

  // Callout FreeText with multi-subpath appearance → textbox rect extraction
  const callout = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [0, 0, 200, 120],
    contents: 'c',
    intent: 'FreeTextCallout',
    calloutLine: [10, 10, 40, 40, 80, 50],
    color: [1, 0, 0],
    borderStyle: { width: 1 },
    defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
    _appearance: {
      path: [
        // line-ish open path first
        ['M', 10, 10], ['L', 40, 40],
        // then closed rectangle-like text box
        ['M', 50, 60], ['L', 150, 60], ['L', 150, 100], ['C', 140, 110, 60, 110, 50, 100], ['Z'],
      ],
      strokeColor: [1, 0, 0],
    },
  }, viewport);
  assert.ok(callout);

  // titleObj / contentsObj
  const note = convertPdfAnnotationToFabric({
    subtype: 'Text',
    rect: [0, 0, 20, 20],
    titleObj: { str: '  Author  ' },
    contentsObj: { str: '  note body  ' },
    color: [1, 0.9, 0.2],
  }, viewport);
  assert.ok(note);

  // PolyLine falls back to lineCoordinates when vertices missing
  const pline = convertPdfAnnotationToFabric({
    subtype: 'PolyLine',
    rect: [0, 0, 40, 40],
    lineCoordinates: [0, 0, 40, 40],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(pline);

  // Highlight missing rect
  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'Highlight',
    color: [1, 1, 0],
  }, viewport), null);

  // Ink norm diagnostic path
  globalThis.window = { __INK_NORM_DIAG: true };
  try {
    const ink = convertInkToFabricPath({
      subtype: 'Ink',
      color: [0, 0, 0],
      borderStyle: { width: 2 },
      inkLists: [[[0, 0], [10, 0], [10, 10]]],
      id: 'ink-diag',
    }, viewport);
    assert.ok(ink);
  } finally {
    delete globalThis.window;
  }

  // AutoCAD SHX via titleObj
  const shx = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 40, 20],
    titleObj: { str: 'AutoCAD SHX Text' },
    contents: 'ABC',
    borderStyle: { width: 1 },
    color: [0, 0, 0],
  }, viewport);
  assert.ok(shx?.data?.isAutoCadShxText);
});

test('backfill cutover lookup throw + count probe throw', async () => {
  __resetDocumentMetadataCacheForTests();
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  // Seed enough entries so wait loop is skipped
  for (let i = 0; i < 5; i += 1) yMap.set(`x${i}`, new Y.Map());

  const result = await runBackfill({
    ydoc,
    documentId: 'doc-lookup-throw',
    userId: 'u1',
    markCutoverComplete: true,
    yMapAnnotations: yMap,
    supabase: {
      from() {
        throw new Error('meta-boom');
      },
    },
    existingHydrateRows: [],
  });
  // Falls through after warn; may run as leader with empty rows
  assert.ok(result?.ranAs);

  __resetDocumentMetadataCacheForTests();
  const ydoc2 = new Y.Doc();
  const yMap2 = ydoc2.getMap('annotations');
  // Small map + sealed + no dedupe → count probe path; make count throw
  const supabase2 = {
    from(table) {
      if (table === 'documents') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'u2',
                  cutover_completed_at: '2026-01-01T00:00:00Z',
                  annotations_changed_at: null,
                  locked_at: null,
                  locked_by: null,
                  locked_label: null,
                  tool_preferences: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'document_annotations') {
        return {
          select: () => {
            throw new Error('count-boom');
          },
        };
      }
      const b = {};
      const self = () => b;
      for (const m of ['select', 'eq', 'in', 'order', 'range']) b[m] = self;
      b.then = (resolve) => resolve({ data: [], error: null });
      return b;
    },
  };
  // Skip 1.5s wait by putting one entry then clearing? Wait only if size===0.
  // Put temporary then... actually size 0 triggers wait. Seed 1 entry so wait skipped,
  // but still < 50 hard floor for sealed recovery.
  yMap2.set('only', new Y.Map());
  const r2 = await runBackfill({
    ydoc: ydoc2,
    supabase: supabase2,
    documentId: 'doc-count-throw',
    userId: 'u2',
    markCutoverComplete: true,
    yMapAnnotations: yMap2,
  });
  assert.ok(r2?.ranAs);

  ydoc.destroy();
  ydoc2.destroy();
  __resetDocumentMetadataCacheForTests();
});

test('regionMath subtract non-overlap poly failure path', () => {
  const a = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
  };
  const tiny = {
    ...a,
    regionId: 't',
    coordinates: [0, 0, 0.001, 0, 0.001, 0.001, 0, 0.001],
  };
  // Degenerate tiny region may fail polygon conversion in subtract/merge
  const sub = subtractRegionFromRegion(a, tiny);
  assert.ok(Array.isArray(sub));
  const merged = mergeRegions(tiny, a);
  assert.ok(merged === null || merged.coordinates);
});
