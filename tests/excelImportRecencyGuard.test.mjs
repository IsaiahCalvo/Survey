import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECENCY,
  RECENCY_TOLERANCE_MS,
  META_SHEET_NAME,
  META_STAMP_KEY,
  readWorkbookExportStamp,
  latestAppExportStamp,
  classifyWorkbookRecency,
  staleAutoSkipMessage,
  staleManualConfirmText,
} from '../src/services/excelImportRecencyGuard.js';

function workbookStub(rows) {
  return {
    getWorksheet(name) {
      if (name !== META_SHEET_NAME) return null;
      return {
        getCell(addr) {
          const match = String(addr).match(/^([AB])(\d+)$/);
          if (!match) return { value: null };
          const [, col, row] = match;
          const entry = rows[Number(row) - 1];
          if (!entry) return { value: null };
          return { value: col === 'A' ? entry[0] : entry[1] };
        },
      };
    },
  };
}

test('readWorkbookExportStamp finds metadata stamp and fails safe', () => {
  assert.equal(readWorkbookExportStamp(null), null);
  assert.equal(readWorkbookExportStamp({ getWorksheet() { return null; } }), null);
  assert.equal(
    readWorkbookExportStamp(workbookStub([[META_STAMP_KEY, '2024-01-02T00:00:00.000Z']])),
    '2024-01-02T00:00:00.000Z',
  );
  assert.equal(
    readWorkbookExportStamp(workbookStub([[META_STAMP_KEY, new Date('2024-05-01T12:00:00Z')]])),
    new Date('2024-05-01T12:00:00Z').toISOString(),
  );
  assert.equal(
    readWorkbookExportStamp({
      getWorksheet() { throw new Error('boom'); },
    }),
    null,
  );
});

test('latestAppExportStamp picks newest identity/export stamp', () => {
  assert.equal(latestAppExportStamp(null), null);
  assert.equal(
    latestAppExportStamp({
      a: { exportedAt: '2024-01-01T00:00:00.000Z' },
      b: { excelSync: { lastExportId: '2024-02-01T00:00:00.000Z' } },
      c: null,
    }),
    '2024-02-01T00:00:00.000Z',
  );
});

test('classifyWorkbookRecency covers all verdicts', () => {
  assert.equal(classifyWorkbookRecency({}).verdict, RECENCY.NO_APP_CLOCK);
  assert.equal(
    classifyWorkbookRecency({ appExportStamp: '2024-01-01T00:00:00.000Z' }).verdict,
    RECENCY.MISSING_EXPORT_CLOCK,
  );
  const stale = classifyWorkbookRecency({
    appExportStamp: '2024-06-01T00:00:00.000Z',
    workbookExportStamp: '2024-01-01T00:00:00.000Z',
  });
  assert.equal(stale.verdict, RECENCY.STALE_WORKBOOK);
  assert.equal(stale.blocksAutoImport, true);
  assert.equal(stale.needsManualConfirm, true);

  const current = classifyWorkbookRecency({
    appExportStamp: '2024-06-01T00:00:00.000Z',
    workbookExportStamp: '2024-06-01T00:01:00.000Z',
    toleranceMs: RECENCY_TOLERANCE_MS,
  });
  assert.equal(current.verdict, RECENCY.CURRENT);
  assert.equal(current.blocksAutoImport, false);
});

test('user-facing stale copy helpers', () => {
  assert.match(staleAutoSkipMessage(RECENCY.MISSING_EXPORT_CLOCK), /no sync stamp/);
  assert.match(staleAutoSkipMessage(RECENCY.STALE_WORKBOOK), /older than your latest export/);
  assert.match(staleManualConfirmText(), /Import anyway/);
});


test('readWorkbookExportStamp handles Date and invalid stamps', () => {
  assert.equal(
    readWorkbookExportStamp(workbookStub([[META_STAMP_KEY, new Date('2024-06-01T00:00:00.000Z')]])),
    '2024-06-01T00:00:00.000Z',
  );
  assert.equal(
    readWorkbookExportStamp(workbookStub([[META_STAMP_KEY, new Date('not-a-date')]])),
    null,
  );
  assert.equal(
    readWorkbookExportStamp(workbookStub([[META_STAMP_KEY, '   ']])),
    null,
  );
});

test('latestAppExportStamp ignores invalid Date stamps via parseStampMs', () => {
  assert.equal(
    latestAppExportStamp({
      m1: { exportedAt: new Date('not-a-date') },
      m2: { excelSync: { lastExportId: '2024-03-01T00:00:00.000Z' } },
    }),
    '2024-03-01T00:00:00.000Z',
  );
});
