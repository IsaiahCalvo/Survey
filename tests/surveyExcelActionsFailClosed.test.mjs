import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';

// Excel actions chevron leftover after item Copy → space.
// Live proof: debug/scenarios/e2e-survey-excel-actions-failclosed.spec.mjs
// Distinct from leftover-18 X-06 silent writeback and from EXPORT download.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop Excel actions chevron is always compiled-in (not gated off the path)', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const cluster = rail.slice(
    rail.indexOf('Compact survey Excel EXPORT'),
    rail.indexOf('{/* Copy to Spaces button */}'),
  );
  assert.match(cluster, /aria-label="Excel actions"/);
  assert.match(cluster, /linkedExcelReady = Boolean\(selectedTemplate\.linkedExcelPath\) && linkedExcelExists === true/);
  assert.doesNotMatch(cluster, /linkedExcelPath \|\| linkedExcelExists !== true\) \? \(/);
  assert.match(cluster, /mobileMode \? null : !copyModeActive/);
  assert.doesNotMatch(cluster, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(cluster, /data-counter-nubbin-handle/);
});

test('Open linked / Update existing toast fail-closed without a path and do not write', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const cluster = rail.slice(
    rail.indexOf('aria-label="Excel actions"'),
    rail.indexOf('{/* Copy to Spaces button */}'),
  );
  assert.match(cluster, /aria-label="Open linked"/);
  assert.match(cluster, /aria-label="Update existing"/);
  assert.match(cluster, /aria-disabled=\{!linkedExcelReady\}/);
  assert.match(cluster, /No Excel file is linked to this survey/);
  assert.match(cluster, /if \(!excelPath \|\| linkedExcelExists !== true\)/);
  assert.match(cluster, /if \(!selectedTemplate\.linkedExcelPath \|\| linkedExcelExists !== true\)/);
  const push = cluster.slice(cluster.indexOf('aria-label="Update existing"'), cluster.indexOf('Push to Excel'));
  assert.match(push, /handleExportSurveyToExcel\(selectedTemplate\.linkedExcelPath\)/);
  assert.match(push, /if \(!selectedTemplate\.linkedExcelPath \|\| linkedExcelExists !== true\)/);
  assert.doesNotMatch(cluster, /setCopyModeActive\(true\)/);
});

test('leftover-18 X-06 automatic writeback gate stays fail-closed (not this slice)', () => {
  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
  assert.equal(isSilentWritebackBlocked(false), false);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handleOpenExcel = useCallback\(async \(\) => \{/);
  assert.match(viewer, /if \(!selectedTemplate\?\.linkedExcelPath\) \{\s*showToast\('No Excel file linked to this survey\.'/);
});
