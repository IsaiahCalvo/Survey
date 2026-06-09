// Source contracts for the stale/export-clock guard (open item 9) — the wiring
// inside PDFViewer.jsx can't be unit-tested directly, so these tripwires assert
// the load-bearing connections stay present. If one fails, the guard was
// unwired (or renamed) — fix the wiring or update the contract deliberately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'PDFViewer.jsx'), 'utf8');

test('both import executors consult the recency guard', () => {
  const calls = src.match(/classifyWorkbookRecency\(\{/g) || [];
  assert.ok(calls.length >= 2, `expected both executors to call classifyWorkbookRecency, found ${calls.length}`);
});

test('both import handlers read the workbook export stamp at parse time', () => {
  const reads = src.match(/readWorkbookExportStamp\(workbook\)/g) || [];
  assert.ok(reads.length >= 2, `expected both handlers to read the workbook stamp, found ${reads.length}`);
});

test('auto-triggered stale/missing-clock imports refuse before any write', () => {
  assert.match(src, /blocksAutoImport/);
  assert.match(src, /staleAutoSkipMessage\(recency\.verdict\)/);
});

test('untrusted recency (accepted stale OR missing stamp) never deletes (both delete paths disabled)', () => {
  assert.match(src, /recencyDeletesDisabled = staleImportAccepted \|\| recency\.verdict === RECENCY\.MISSING_EXPORT_CLOCK/);
  assert.match(src, /if \(recencyDeletesDisabled\) return;/);
  assert.match(src, /!recencyDeletesDisabled && wasReceivedByExcel\(ann\)/);
});

test('a missing/forgotten trigger is treated as AUTO (conservative), never as manual', () => {
  assert.match(src, /importMeta\?\.trigger !== 'manual'/);
});

test('the guard reads the freshest markers via ref, not stale closure state', () => {
  const refReads = src.match(/latestAppExportStamp\(surveyMarkersRef\.current \|\| surveyMarkers\)/g) || [];
  assert.ok(refReads.length >= 2, `expected both executors to read via surveyMarkersRef, found ${refReads.length}`);
});

test('the open-time silent import is treated as an AUTO trigger (no confirm popup at open)', () => {
  assert.match(src, /handleSyncFromExcel\(\{ silent: true \}\)/);
});

test('the export writes ONE shared stamp to the metadata sheet and the identity records', () => {
  assert.match(src, /metaSheet\.getCell\('B3'\)\.value = rowIdExportId;/);
});

test('the new-columns continuation preserves the stale-guard metadata', () => {
  const threaded = src.match(/importMeta \|\| null/g) || [];
  assert.ok(threaded.length >= 2, 'handleNewColumnsDecision must pass importMeta to both executors');
});

test('3-way merge whitelist is enforced in both apply loops', () => {
  const helpers = src.match(/const mayWriteField = \(fieldKey\) =>/g) || [];
  assert.ok(helpers.length >= 2, `expected the merge whitelist in both executors, found ${helpers.length}`);
  assert.ok((src.match(/mayWriteField\(`answer:\$\{checklistId\}`\)/g) || []).length >= 2, 'answers are whitelist-gated');
  assert.ok((src.match(/mayWriteField\('entity'\)/g) || []).length >= 2, 'entity is whitelist-gated');
  assert.ok((src.match(/mayWriteField\('notes'\)/g) || []).length >= 2, 'notes are whitelist-gated');
});
