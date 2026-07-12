/**
 * Tick-57 coverage chips: whenSynced waiting path, catchUpTail outer .catch,
 * create* catch tails (square/circle/line/poly/freetext), removeMatchingNative,
 * paper erase no-overlap keep, callout deserialize catch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as Y from 'yjs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import {
  openAnnotationDoc,
} from '../src/services/annotationDocSync.js';
import {
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { eraseAnnotations } from '../src/utils/paperAnnotationGeometry.js';

function throwOnNth(base, prop, n = 2) {
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

async function pdfFileWithNamedAnnot(nm = 'native-edit-1') {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const ctx = doc.context;
  const annot = ctx.register(ctx.obj({
    Type: 'Annot',
    Subtype: PDFName.of('Square'),
    Rect: [10, 10, 40, 40],
    NM: PDFString.of(nm),
    C: [0, 0, 0],
    P: page.ref,
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
  const bytes = await doc.save();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
  };
}

test('annotationDocSync whenSynced once path + catchUpTail outer catch', async () => {
  mock.module('y-indexeddb', {
    namedExports: {
      IndexeddbPersistence: class {
        constructor() {
          this.synced = false;
        }
        once(_event, cb) {
          queueMicrotask(cb);
        }
        destroy() {}
      },
    },
  });

  let phase = 'open';
  const supabase = {
    from(table) {
      if (phase === 'catchup' && table === 'annotation_updates') {
        throw new Error('catchup-chain-boom');
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
          upsert: async () => ({ error: null }),
        };
      }
      if (table === 'annotation_updates') {
        const b = {};
        const self = () => b;
        for (const m of ['select', 'eq', 'gt', 'order', 'limit']) b[m] = self;
        b.then = (resolve) => resolve({ data: [], error: null });
        b.insert = () => ({
          select: () => ({
            single: async () => ({ data: { seq: 1 }, error: null }),
          }),
        });
        b.limit = () => Promise.resolve({ data: [], error: null });
        return b;
      }
      throw new Error(table);
    },
    channel() {
      const ch = {
        on() { return ch; },
        subscribe(cb) {
          queueMicrotask(() => {
            phase = 'catchup';
            cb('SUBSCRIBED');
          });
          return ch;
        },
      };
      return ch;
    },
    removeChannel: async () => {},
  };

  const prevIDB = globalThis.indexedDB;
  globalThis.indexedDB = { open() { return {}; } };
  try {
    const doc = new Y.Doc();
    const handle = await openAnnotationDoc({
      documentId: 'doc-t57',
      supabase,
      clientId: 'c57',
      enableLocal: true,
      enableRealtime: true,
      doc,
    });
    await new Promise((r) => setTimeout(r, 80));
    await handle.destroy();
    doc.destroy();
  } finally {
    if (prevIDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = prevIDB;
    mock.reset();
  }
});

test('pdfLib create* catch tails + removeMatchingNative on edited import', async () => {
  const pdfFile = await pdfFileWithNamedAnnot('native-edit-1');

  const result = await savePDFWithAnnotationsPdfLib(
    pdfFile,
    {
      1: {
        objects: [
          throwOnNth({
            type: 'rect',
            stroke: '#000',
            fill: '#ffffff',
            width: 10,
            height: 10,
            left: 0,
            top: 0,
            data: { id: 'sq-throw' },
          }, 'fill', 3),
          throwOnNth({
            type: 'circle',
            stroke: '#000',
            fill: '#eeeeee',
            radius: 5,
            left: 0,
            top: 0,
            data: { id: 'ci-throw' },
          }, 'fill', 3),
          throwOnNth({
            type: 'line',
            stroke: '#000000',
            x1: 0,
            y1: 0,
            x2: 10,
            y2: 10,
            data: { id: 'ln-throw' },
          }, 'stroke', 3),
          throwOnNth({
            type: 'polygon',
            stroke: '#000',
            fill: '#cccccc',
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }],
            left: 0,
            top: 0,
            data: { id: 'pg-throw' },
          }, 'fill', 3),
          throwOnNth({
            type: 'polyline',
            stroke: '#111111',
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }],
            left: 0,
            top: 0,
            data: { id: 'pl-throw' },
          }, 'stroke', 3),
          throwOnNth({
            type: 'textbox',
            text: 'hi',
            fill: '#222222',
            left: 0,
            top: 0,
            width: 40,
            height: 20,
            data: { id: 'ft-throw' },
          }, 'fill', 3),
          // Edited imported → removeMatchingNative by NM
          {
            type: 'rect',
            left: 10,
            top: 160,
            width: 30,
            height: 30,
            stroke: '#ff0000',
            strokeWidth: 1,
            isPdfImported: true,
            pdfAnnotationId: 'native-edit-1',
            pdfImportedEditState: 'edited',
            data: { id: 'edited-import', pdfImportedEditState: 'edited' },
          },
        ],
      },
    },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, documentId: 'doc-t57-export' },
  );
  assert.ok(result);
});

test('paperAnnotationGeometry erase keeps non-overlapping polygon subject', () => {
  const annotations = [{
    id: 'far',
    type: 'ink',
    polygons: [[[[100, 100], [120, 100], [120, 120], [100, 120], [100, 100]]]],
    cmds: [['M', 100, 100], ['L', 120, 100], ['L', 120, 120], ['L', 100, 120], ['Z']],
    fill: '#000',
    stroke: null,
    strokeWidth: 0,
  }];
  const result = eraseAnnotations(
    annotations,
    [{ x: 0, y: 0 }, { x: 5, y: 0 }],
    3,
    'partial',
  );
  assert.ok(result.annotations.some((a) => a.id === 'far'));
  assert.ok(!result.changedIds.includes('far'));
});
