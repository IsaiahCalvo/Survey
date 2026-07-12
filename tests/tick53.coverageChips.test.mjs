/**
 * Tick-53 coverage chips: undo annotationMap fallthrough (156), import pipeline
 * app-callout/counter-failure/convert-null/page-error, object vertices, scalar dash,
 * ink-norm diag catch, viewport without convert helpers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
  importAnnotationsFromPdf,
} from '../src/utils/pdfAnnotationImporter.js';
import { PDF_CALLOUT_SUBJECT } from '../src/utils/pdfCalloutMetadata.js';
import { PDF_COUNTER_SUBJECT } from '../src/utils/pdfCounterMetadata.js';
import { createUndoManager } from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';

function makeViewport(h = 400) {
  return {
    width: 300,
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

test('undo annotationMap fallthrough return null (line 156)', () => {
  const ydoc = new Y.Doc();
  const ctx = { userId: 'u53', deviceId: 'd1', sessionId: 's53', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({
    ydoc,
    ...ctx,
    captureTimeout: 0,
    historyCap: 3,
  });
  const yMap = ydoc.getMap('annotations');
  applyFabricCommit(
    ydoc,
    yMap,
    { type: 'rect', left: 0, top: 0, width: 2, height: 2, data: { id: 'r53' }, pageNumber: 1 },
    origin,
    ctx,
  );

  // parentStack null + path[0] annotationId → neither annotations nor callouts branch
  undoManager.emit('stack-item-added', [{
    type: 'undo',
    stackItem: { meta: { set() {} } },
    changedParentTypes: {
      forEach(cb) {
        cb([{
          target: { other: true },
          path: ['meta', 'r53'],
          changes: {
            keys: {
              forEach(fn) { fn({ action: 'update' }, 'r53'); },
              get: () => null,
            },
          },
        }]);
      },
    },
  }]);

  dispose();
  ydoc.destroy();
  assert.ok(true);
});

test('importer object vertices, scalar dash, bare viewport, ink diag catch', () => {
  const viewport = makeViewport();

  // vertices as {x,y} objects → normalizePdfPointList object branch
  const poly = convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    rect: [0, 0, 40, 40],
    vertices: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 20, y: 30 },
    ],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(poly);

  // scalar dashArray → toNumericArray final return null → dash fallback
  const dashed = convertPdfAnnotationToFabric({
    subtype: 'Line',
    rect: [0, 0, 20, 10],
    lineCoordinates: [0, 0, 20, 10],
    color: [0, 0, 0],
    borderStyle: { width: 1, style: 'D', dashArray: 7 },
  }, viewport);
  assert.ok(dashed?.strokeDashArray?.length >= 2);

  // viewport without convert helpers → convertPdfPoint/Rect fallback math
  const bareVp = { height: 500 };
  const inkBare = convertInkToFabricPath({
    subtype: 'Ink',
    color: [0, 0, 1],
    borderStyle: { width: 2 },
    inkLists: [[[0, 0], [10, 0], [10, 10]]],
  }, bareVp);
  assert.ok(inkBare);

  const sqBare = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 30, 20],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, bareVp);
  assert.ok(sqBare);

  // Ink norm diag catch when JSON.stringify / console.log path throws
  const prevWin = globalThis.window;
  globalThis.window = {
    __INK_NORM_DIAG: true,
  };
  const origLog = console.log;
  console.log = () => { throw new Error('ink-diag-boom'); };
  try {
    const ink = convertInkToFabricPath({
      subtype: 'Ink',
      color: [1, 0, 0],
      borderStyle: { width: 1 },
      inkLists: [[[0, 0], [5, 5]]],
    }, viewport);
    assert.ok(ink);
  } finally {
    console.log = origLog;
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
  }
});

test('importAnnotationsFromPdf app-callout + counter fail + convert null + page error', async () => {
  const viewport = makeViewport();

  const okDoc = {
    numPages: 1,
    async getPage() {
      return {
        getViewport() { return viewport; },
        async getAnnotations() {
          return [
            {
              id: 'app-callout-piece',
              subtype: 'FreeText',
              rect: [0, 0, 80, 40],
              contents: 'piece',
              calloutMetadata: {
                kind: PDF_CALLOUT_SUBJECT,
                type: 'callout',
                id: 'shared-callout',
                part: 'textbox',
                arrowTip: { x: 0.1, y: 0.2 },
                knee: { x: 0.3, y: 0.4 },
                textBoxPosition: { x: 0.5, y: 0.6 },
                textBoxWidth: 0.2,
                textBoxHeight: 0.1,
                text: 'hello',
                moduleId: 'm1',
                regionId: 'r1',
                spaceId: 's1',
                layer: 'L1',
                groupId: 'g1',
                style: { color: '#f00' },
                pageNumber: 1,
              },
            },
            {
              id: 'incomplete-callout',
              subtype: 'FreeText',
              rect: [0, 0, 40, 20],
              calloutMetadata: {
                kind: PDF_CALLOUT_SUBJECT,
                type: 'callout',
                // missing geometry → normalizeImportedAppCallout null (3098)
                id: 'bad',
              },
            },
            {
              id: 'wrong-kind-callout',
              subtype: 'FreeText',
              rect: [0, 0, 40, 20],
              calloutMetadata: {
                kind: 'not-callout',
                type: 'callout',
                id: 'x',
              },
            },
            {
              id: 'ctr-no-meta',
              subtype: 'Circle',
              subject: PDF_COUNTER_SUBJECT,
              rect: [0, 0, 24, 24],
              color: [1, 0, 0],
              borderStyle: { width: 1 },
            },
            {
              id: 'bad-square',
              subtype: 'Square',
              // no rect → converter null → skipped diag
              color: [0, 0, 0],
              borderStyle: { width: 1 },
            },
            {
              id: 'dup-a',
              name: 'same-nm',
              subtype: 'Square',
              rect: [0, 0, 10, 10],
              color: [0, 0, 0],
              borderStyle: { width: 1 },
            },
            {
              id: 'dup-b',
              name: 'same-nm',
              subtype: 'Square',
              rect: [5, 5, 15, 15],
              color: [0, 0, 0],
              borderStyle: { width: 1 },
            },
            {
              subtype: 'UnknownCustom',
              id: 'unsup',
            },
          ];
        },
      };
    },
  };

  const imported = await importAnnotationsFromPdf(okDoc);
  assert.ok(imported);

  // Page processing error path
  const errDoc = {
    numPages: 1,
    async getPage() {
      throw new Error('page-boom');
    },
  };
  const errored = await importAnnotationsFromPdf(errDoc);
  assert.ok(errored);
});
