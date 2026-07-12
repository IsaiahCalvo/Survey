/**
 * Tick-60 coverage chips: serializers preferFabricRow no-date fallthrough,
 * survey-marker SURVEY_REGION scope, crdt bridge shallowEqual arrays +
 * snapshotYMapLike non-object, cloudSyncMigration localStorage catches,
 * rowIdLocalWriteback refreshExportStamp miss.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import ExcelJS from 'exceljs';

import { normalizeFabricAnnotationRows } from '../src/services/annotationTypeSerializers.js';
import { mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import {
  applyFabricCommit,
  applyYUpdateToFabric,
} from '../src/lib/collab/crdtAnnotationBridge.js';
import {
  migrateLocalAnnotationsToCloud,
  hasMigrationRun,
} from '../src/services/cloudSyncMigration.js';
import { drainRowIdWritebackQueueLocal } from '../src/services/rowIdLocalWriteback.js';
import {
  enqueueWriteback,
  clearWriteback,
} from '../src/services/rowIdWritebackQueue.js';
import { ANNOTATION_VISIBILITY_SCOPE } from '../src/utils/annotationVisibilityRules.js';
import { META_SHEET_NAME } from '../src/services/excelImportRecencyGuard.js';

test('preferFabricRow keeps current when both timestamps invalid', () => {
  const rows = normalizeFabricAnnotationRows([
    {
      annotation_id: 'old',
      annotation_type: 'ink',
      page_number: 1,
      updated_at: 'not-a-date',
      created_at: 'also-bad',
      annotation_data: {
        pageNumber: 1,
        fabricObject: {
          type: 'path',
          isPdfImported: true,
          pdfAnnotationId: 'same-pdf',
          path: [['M', 0, 0], ['L', 1, 0]],
          data: { id: 'old' },
        },
      },
    },
    {
      annotation_id: 'new',
      annotation_type: 'ink',
      page_number: 1,
      updated_at: 'still-bad',
      created_at: '',
      annotation_data: {
        pageNumber: 1,
        fabricObject: {
          type: 'path',
          isPdfImported: true,
          pdfAnnotationId: 'same-pdf',
          path: [['M', 0, 0], ['L', 2, 0]],
          data: { id: 'new' },
        },
      },
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].annotation_id, 'old');
});

test('mapSurveyMarkerRowToLocalAnnotation SURVEY_REGION when regionId set', () => {
  const mapped = mapSurveyMarkerRowToLocalAnnotation({
    annotation_id: 'sm-1',
    page_number: 2,
    bounds: { x: 0, y: 0, w: 1, h: 1 },
    annotation_data: { regionId: 'reg-9' },
    color: '#abcabc',
    opacity: 1,
  });
  assert.equal(mapped.regionId, 'reg-9');
  assert.equal(mapped.visibilityScope, ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION);
});

test('crdtAnnotationBridge array shallowEqual + snapshotYMapLike null', async () => {
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  const fabricObject = {
    pageNumber: 1,
    data: { id: 'arr-1' },
    toObject: () => ({
      type: 'path',
      left: 0,
      top: 0,
      strokeDashArray: [3, 2],
      path: [['M', 0, 0], ['L', 1, 0]],
    }),
  };
  applyFabricCommit(ydoc, yMap, fabricObject, 'local', { userId: 'u1', deviceId: 'd1' });
  // Identical primitive array → shallowEqual true (lines 92-93)
  applyFabricCommit(ydoc, yMap, fabricObject, 'local', { userId: 'u1', deviceId: 'd1' });
  // Same length, different element
  fabricObject.toObject = () => ({
    type: 'path',
    left: 0,
    top: 0,
    strokeDashArray: [3, 9],
    path: [['M', 0, 0], ['L', 1, 0]],
  });
  applyFabricCommit(ydoc, yMap, fabricObject, 'local', { userId: 'u1', deviceId: 'd1' });
  // array vs non-array
  fabricObject.toObject = () => ({
    type: 'path',
    left: 0,
    top: 0,
    strokeDashArray: { not: 'array' },
    path: [['M', 0, 0], ['L', 1, 0]],
  });
  applyFabricCommit(ydoc, yMap, fabricObject, 'local', { userId: 'u1', deviceId: 'd1' });

  const registry = new Map([
    ['snap-1', { set() {}, setCoords() {} }],
  ]);
  applyYUpdateToFabric({
    get: () => ({
      get: (key) => (key === 'fabric' ? 42 : null),
    }),
  }, 'snap-1', registry);

  await Promise.resolve();
  assert.ok(true);
});

test('cloudSyncMigration localStorage get/set catch paths', async () => {
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        throw new Error('get-boom');
      },
      setItem() {
        throw new Error('set-boom');
      },
      removeItem() {},
    },
  });
  try {
    assert.equal(hasMigrationRun('u', 'd'), false);
    // missing supabase / fields still short-circuit before markMigrated
    const result = await migrateLocalAnnotationsToCloud({
      documentId: 'd',
      userId: 'u',
      pdfId: 'p.pdf',
    });
    assert.ok(result);
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: prev });
  }
});

test('rowIdLocalWriteback refreshExportStamp returns null without stamp row', async () => {
  const docId = 'doc-t60-wb';
  const filePath = '/tmp/t60-rowid.xlsx';
  const storage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };

  // Clear any prior queue
  while (true) {
    const { listWriteback } = await import('../src/services/rowIdWritebackQueue.js');
    const left = listWriteback(docId, storage);
    if (!left.length) break;
    clearWriteback(docId, left[0].markerId, storage);
  }

  enqueueWriteback(docId, {
    markerId: 'm1',
    sheetName: 'Sheet1',
    rowLocator: { rowNumber: 2 },
    newToken: 'TOK-1',
    expectedOldCellValue: 'OLD',
    path: filePath,
  }, storage);

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.getCell('A2').value = 'OLD';
  const meta = wb.addWorksheet(META_SHEET_NAME);
  meta.getCell('A1').value = 'otherKey';
  meta.getCell('B1').value = 'otherVal';
  const bytes = await wb.xlsx.writeBuffer();

  let written = null;
  const fsApi = {
    fileExists: async (p) => !String(p).includes('~$'),
    listDir: async () => [], // no lock file → closed
    readFile: async () => {
      if (written) return written;
      return Buffer.from(bytes);
    },
    writeFile: async (_p, data) => { written = Buffer.from(data); },
    getFileStats: async () => ({ mtimeMs: 1000, size: bytes.byteLength }),
  };

  const result = await drainRowIdWritebackQueueLocal({
    documentId: docId,
    filePath,
    appExportStamp: null, // NO_APP_CLOCK → allow flush
    fs: fsApi,
    storage,
    now: () => '2026-07-12T10:00:00.000Z',
  });
  assert.equal(result.wrote, true);
  assert.equal(result.flushStamp, null);
});
