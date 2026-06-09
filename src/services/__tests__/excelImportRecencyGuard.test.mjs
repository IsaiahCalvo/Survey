import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECENCY,
  RECENCY_TOLERANCE_MS,
  classifyWorkbookRecency,
  latestAppExportStamp,
  readWorkbookExportStamp,
  staleAutoSkipMessage,
  staleManualConfirmText
} from '../excelImportRecencyGuard.js';

const T0 = '2026-06-09T10:00:00.000Z';
const T0_MINUS_1H = '2026-06-09T09:00:00.000Z';
const T0_PLUS_1H = '2026-06-09T11:00:00.000Z';

// ── classifyWorkbookRecency ──────────────────────────────────────────────────

test('workbook older than the app clock by more than the tolerance → stale-workbook', () => {
  const r = classifyWorkbookRecency({ workbookExportStamp: T0_MINUS_1H, appExportStamp: T0 });
  assert.equal(r.verdict, RECENCY.STALE_WORKBOOK);
  assert.equal(r.blocksAutoImport, true);
  assert.equal(r.needsManualConfirm, true);
});

test('workbook equal to the app clock → current', () => {
  const r = classifyWorkbookRecency({ workbookExportStamp: T0, appExportStamp: T0 });
  assert.equal(r.verdict, RECENCY.CURRENT);
  assert.equal(r.blocksAutoImport, false);
});

test('workbook newer than the app clock → current (a newer export elsewhere is fine)', () => {
  const r = classifyWorkbookRecency({ workbookExportStamp: T0_PLUS_1H, appExportStamp: T0 });
  assert.equal(r.verdict, RECENCY.CURRENT);
});

test('legacy write-skew inside the tolerance window is NOT stale', () => {
  const skewed = new Date(Date.parse(T0) - (RECENCY_TOLERANCE_MS - 1000)).toISOString();
  const r = classifyWorkbookRecency({ workbookExportStamp: skewed, appExportStamp: T0 });
  assert.equal(r.verdict, RECENCY.CURRENT);
});

test('just past the tolerance boundary IS stale', () => {
  const past = new Date(Date.parse(T0) - (RECENCY_TOLERANCE_MS + 1000)).toISOString();
  const r = classifyWorkbookRecency({ workbookExportStamp: past, appExportStamp: T0 });
  assert.equal(r.verdict, RECENCY.STALE_WORKBOOK);
});

test('no readable workbook stamp → missing-export-clock (blocks auto, manual may proceed)', () => {
  for (const stamp of [null, undefined, '', '   ', 'not-a-date']) {
    const r = classifyWorkbookRecency({ workbookExportStamp: stamp, appExportStamp: T0 });
    assert.equal(r.verdict, RECENCY.MISSING_EXPORT_CLOCK, `stamp=${JSON.stringify(stamp)}`);
    assert.equal(r.blocksAutoImport, true);
    assert.equal(r.needsManualConfirm, false);
  }
});

test('app never exported → no-app-clock (guard abstains entirely)', () => {
  for (const stamp of [null, 'garbage']) {
    const r = classifyWorkbookRecency({ workbookExportStamp: T0, appExportStamp: stamp });
    assert.equal(r.verdict, RECENCY.NO_APP_CLOCK, `appStamp=${JSON.stringify(stamp)}`);
    assert.equal(r.blocksAutoImport, false);
    assert.equal(r.needsManualConfirm, false);
  }
});

// ── latestAppExportStamp ─────────────────────────────────────────────────────

test('latestAppExportStamp picks the newest lastExportId across markers', () => {
  const markers = {
    a: { excelSync: { lastExportId: T0_MINUS_1H } },
    b: { excelSync: { lastExportId: T0 } },
    c: { name: 'never exported' }
  };
  assert.equal(latestAppExportStamp(markers), T0);
});

test('latestAppExportStamp falls back to exportedAt and ignores junk', () => {
  const markers = {
    a: { exportedAt: T0_MINUS_1H },
    b: { excelSync: { lastExportId: 'not-a-date' }, exportedAt: T0 },
    c: { excelSync: null }
  };
  assert.equal(latestAppExportStamp(markers), T0);
});

test('latestAppExportStamp returns null when nothing was ever exported', () => {
  assert.equal(latestAppExportStamp({}), null);
  assert.equal(latestAppExportStamp(null), null);
  assert.equal(latestAppExportStamp({ a: { name: 'x' } }), null);
});

// ── readWorkbookExportStamp (duck-typed ExcelJS workbook) ────────────────────

const stubWorkbook = (cells) => ({
  getWorksheet: (name) =>
    name === '_SurveyMetadata' && cells
      ? { getCell: (addr) => ({ value: cells[addr] }) }
      : undefined
});

test('reads the stamp from the standard A3/B3 layout', () => {
  const wb = stubWorkbook({ A1: 'template_id', B1: 't1', A3: 'export_timestamp', B3: T0 });
  assert.equal(readWorkbookExportStamp(wb), T0);
});

test('finds the stamp on a different row and converts a Date cell to ISO', () => {
  const wb = stubWorkbook({ A5: 'export_timestamp', B5: new Date(T0) });
  assert.equal(readWorkbookExportStamp(wb), T0);
});

test('missing sheet, missing row, or blank value → null', () => {
  assert.equal(readWorkbookExportStamp(stubWorkbook(null)), null);
  assert.equal(readWorkbookExportStamp(stubWorkbook({ A1: 'template_id' })), null);
  assert.equal(readWorkbookExportStamp(stubWorkbook({ A3: 'export_timestamp', B3: '' })), null);
  assert.equal(readWorkbookExportStamp({}), null);
  assert.equal(readWorkbookExportStamp(null), null);
});

// ── plain-English surfaces ───────────────────────────────────────────────────

test('messages are plain English and tone-matched (warn keywords present)', () => {
  assert.match(staleAutoSkipMessage(RECENCY.STALE_WORKBOOK), /looks older/);
  assert.match(staleAutoSkipMessage(RECENCY.MISSING_EXPORT_CLOCK), /no sync stamp/);
  assert.match(staleManualConfirmText(), /OLDER/);
  assert.match(staleManualConfirmText(), /Nothing will be deleted/);
});
