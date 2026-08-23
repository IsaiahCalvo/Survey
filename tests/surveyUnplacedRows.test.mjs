import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';
import {
  BATCH_HOLD_TITLE,
  selectUnplacedRows,
} from '../src/services/excelUnplacedRows.js';

// Live proof: debug/scenarios/e2e-survey-unplaced-rows.spec.mjs
// Unique leftover: Survey "Rows we couldn't place" DEV fixture + dismiss.
// Distinct from leftover-18 X-06 writeback / Excel actions fail-closed /
// remapped-after-CW. Do not invent a linked workbook or file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('DEV unplacedRows fixture seeds mixed + batch without stamping file.id', () => {
  const viewer = read('src/PDFViewer.jsx');
  const fixtureAt = viewer.indexOf('KAL-292 dev fixture');
  assert.ok(fixtureAt > 0, 'DEV fixture comment');
  const fixture = viewer.slice(fixtureAt, viewer.indexOf('surveyConflictByMarkerId', fixtureAt));
  assert.match(fixture, /import\.meta\.env\.DEV/);
  assert.match(fixture, /unplacedRows/);
  assert.match(fixture, /mode === 'mixed'/);
  assert.match(fixture, /mode !== 'mixed' && mode !== 'batch'/);
  assert.match(fixture, /itemName: 'Door D-114'/);
  assert.match(fixture, /reason: 'ambiguous-identity'/);
  assert.match(fixture, /Array\.from\(\{ length: 12 \}/);
  assert.match(fixture, /setPendingImportBatchHold\(true\)/);
  assert.doesNotMatch(fixture, /file\.id/);
  assert.doesNotMatch(viewer, /file\.id\s*=/);
});

test('rail surface dismisses visually and never offers apply-anyway', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const surfaceAt = rail.indexOf('const ExcelUnplacedRows =');
  assert.ok(surfaceAt > 0, 'ExcelUnplacedRows');
  const surface = rail.slice(surfaceAt, rail.indexOf('const SurveyMarkerReviewIndicator', surfaceAt));
  assert.match(surface, /aria-label="Rows we couldn’t place"/);
  assert.match(surface, /Dismiss all/);
  assert.match(surface, /aria-label=\{`Dismiss \$\{row\.itemName \|\| 'this row'\}`\}/);
  assert.match(surface, /onClick=\{\(\) => onDismissAll\?\.\(\)\}/);
  assert.match(surface, /onClick=\{\(\) => onDismiss\?\.\(row\.key\)\}/);
  assert.doesNotMatch(surface, /apply anyway|applyAnyway|onApplyUnplaced/i);
  assert.match(rail, /onDismissAll=\{onDismissAllUnplacedRows\}/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /This is VISUAL ONLY/);
  assert.match(viewer, /const handleDismissUnplacedRow = useCallback/);
  assert.match(viewer, /const handleDismissAllUnplacedRows = useCallback/);
  assert.match(viewer, /setPendingImportBatchHold\(false\)/);
});

test('leftover-18 X-06 automatic writeback stays fail-closed; this slice is not it', () => {
  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
  const spec = read('debug/scenarios/e2e-survey-unplaced-rows.spec.mjs');
  assert.match(spec, /unplacedRows=mixed/);
  assert.match(spec, /unplacedRows=batch/);
  assert.match(spec, /Dismiss all/);
  assert.match(spec, /hubPreview must not honor editor unplacedRows/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /390 unplaced mixed dismiss/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /page-rotate|viewBox `0 0 792 612`/);

  const mixed = selectUnplacedRows([
    { reason: 'ambiguous-identity', markerId: null, sheetName: 'Level 1 — Doors', sheetRowNumber: 14, itemName: 'Door D-114' },
  ]);
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.batchTitle, null);
  const batch = selectUnplacedRows(
    [{ reason: 'review', markerId: null, sheetRowNumber: 3, itemName: 'Door D-101' }],
    { batchHeld: true },
  );
  assert.equal(batch.batchTitle, BATCH_HOLD_TITLE);
  assert.equal(batch.rows[0].message, null);
});
