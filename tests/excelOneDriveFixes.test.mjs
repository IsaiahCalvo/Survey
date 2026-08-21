import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { excelLiveSyncWriteStatus } from '../src/utils/excelLiveSyncWriteStatus.js';

const VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const BROWSER = readFileSync(new URL('../src/components/OneDriveFolderBrowser.jsx', import.meta.url), 'utf8');
const RAIL = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
const MODAL = readFileSync(
  new URL('../src/components/TemplateOverwriteWarningModal.jsx', import.meta.url),
  'utf8',
);

test('P2-09: all-failed sheet writes are not success', () => {
  assert.equal(excelLiveSyncWriteStatus({ okCount: 0, failCount: 3 }), 'all-failed');
  assert.equal(excelLiveSyncWriteStatus({ okCount: 2, failCount: 1 }), 'partial');
  assert.equal(excelLiveSyncWriteStatus({ okCount: 2, failCount: 0 }), 'ok');
  assert.match(VIEWER, /All Excel sheet writes failed/);
  assert.match(VIEWER, /Sync to Excel incomplete: some sheets failed/);
});

test('P2-04: existing OneDrive file always confirms before replace', () => {
  const start = VIEWER.indexOf('const handleOneDriveSave = useCallback');
  const body = VIEWER.slice(start, start + 2200);
  assert.match(body, /reason: templateMismatch \? 'template-mismatch' : 'file-exists'/);
  assert.match(body, /Save cancelled/);
  assert.doesNotMatch(body, /Proceed with export anyway/);
  assert.match(MODAL, /reason = 'template-mismatch'/);
  assert.match(MODAL, /Replace existing file\?/);
});

test('P2-19: Live Sync copy no longer claims real-time writeback', () => {
  assert.match(RAIL, /Automatic writeback is off/);
  assert.doesNotMatch(RAIL, /changes sync in real-time/);
  assert.doesNotMatch(RAIL, /Enable live sync for real-time Excel updates/);
});

test('P2-20: live-sync effect does not remount on session fileId', () => {
  assert.match(VIEWER, /excelSessionRef\.current = \{ sessionId, expiresAt, fileId \}/);
  assert.match(
    VIEWER,
    /\[liveSyncEnabled, selectedTemplate\?\.isOneDrive, selectedTemplate\?\.linkedExcelPath, selectedTemplate\?\.id, graphClient\]/,
  );
  assert.doesNotMatch(
    VIEWER,
    /\[liveSyncEnabled, selectedTemplate\?\.isOneDrive, selectedTemplate\?\.linkedExcelPath, selectedTemplate\?\.id, graphClient, liveSyncSupported, oneDriveFileId\]/,
  );
});

test('P2-22: OneDrive picker refreshes the MS token before listing', () => {
  assert.match(BROWSER, /refreshTokenOrThrow/);
  assert.match(BROWSER, /await refreshTokenOrThrow\(\)/);
  assert.match(VIEWER, /ensureFreshToken=\{ensureFreshToken\}/);
});
