/**
 * Tick-58 coverage chips: highlight create catch, removeMatching empty id,
 * fabricPathToSvgPath Q/C via flatten print, paper erase bounds-overlap but
 * no polygon overlap, unknown export default switch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { eraseAnnotations } from '../src/utils/paperAnnotationGeometry.js';
import { SURVEY_MARKER_TYPE } from '../src/utils/surveyMarkerType.js';

function throwOnNth(base, prop, n = 3) {
  let count = 0;
  return new Proxy(base, {
    get(target, key, receiver) {
      if (key === prop) {
        count += 1;
        if (count >= n) throw new Error(`${String(prop)}-boom`);
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

async function minimalPdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
  };
}

test('pdfLib highlight catch + empty pdfAnnotationId removeMatching + unknown type', async () => {
  const pdfFile = await minimalPdfFile();
  const result = await savePDFWithAnnotationsPdfLib(
    pdfFile,
    {
      1: {
        objects: [
          throwOnNth({
            type: 'rect',
            exportType: SURVEY_MARKER_TYPE,
            fill: '#ffff00',
            left: 10,
            top: 10,
            width: 40,
            height: 12,
            data: { id: 'hl-throw' },
          }, 'fill', 3),
          {
            type: 'rect',
            left: 5,
            top: 5,
            width: 10,
            height: 10,
            stroke: '#000',
            isPdfImported: true,
            pdfImportedEditState: 'edited',
            pdfAnnotationId: '', // removeMatching early return
            data: { id: 'edit-no-id', pdfImportedEditState: 'edited' },
          },
          {
            type: 'unknown-widget',
            left: 0,
            top: 0,
            data: { id: 'unk' },
          },
          {
            type: 'path',
            left: 0,
            top: 0,
            stroke: '#0a0',
            strokeWidth: 2,
            path: [
              ['M', 0, 0],
              ['Q', 5, 10, 10, 0],
              ['C', 12, 5, 14, 5, 20, 0],
              ['L', 25, 0],
            ],
            data: { id: 'ok-path' },
          },
        ],
      },
    },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, documentId: 'doc-t58' },
  );
  assert.ok(result);
});

test('flattened print export covers Q/C svg path conversion', async () => {
  const pdfFile = await minimalPdfFile();
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    pdfFile,
    {
      1: {
        objects: [{
          type: 'path',
          left: 0,
          top: 0,
          stroke: '#000000',
          strokeWidth: 2,
          path: [
            ['M', 0, 20],
            ['Q', 10, 0, 20, 20],
            ['C', 25, 30, 35, 30, 40, 20],
            ['L', 50, 20],
          ],
          data: { id: 'flat-qc' },
        }],
      },
    },
    { 1: { width: 200, height: 200 } },
  );
  assert.ok(bytes);
});

test('paper erase: bounds overlap but polygon set misses eraser', () => {
  const result = eraseAnnotations(
    [{
      id: 'lie-bounds',
      forcePolygon: true,
      fill: '#151a18',
      strokeWidth: 0,
      // Bounds claim overlap with eraser near origin
      bounds: { x: 0, y: 0, w: 40, h: 40 },
      // Actual geometry is far away → intersection empty
      polygons: [[[[200, 200], [230, 200], [230, 230], [200, 230], [200, 200]]]],
      cmds: [
        ['M', 200, 200],
        ['L', 230, 200],
        ['L', 230, 230],
        ['L', 200, 230],
        ['Z'],
      ],
    }],
    [{ x: 5, y: 5 }, { x: 15, y: 5 }],
    8,
    'partial',
  );
  assert.ok(result.annotations.some((a) => a.id === 'lie-bounds'));
  assert.ok(!result.changedIds.includes('lie-bounds'));
});
