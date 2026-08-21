import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const DEV_TEST_ROUTE = readFileSync(new URL('../src/DevTestRoute.jsx', import.meta.url), 'utf8');
const SIDEBAR = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
const VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const HISTORY = readFileSync(new URL('../src/services/documentHistoryService.js', import.meta.url), 'utf8');
const REVISIONS = readFileSync(new URL('../src/services/documentRevisionService.js', import.meta.url), 'utf8');
const PANEL = readFileSync(new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url), 'utf8');
const SUPABASE = readFileSync(new URL('../src/supabaseClient.js', import.meta.url), 'utf8');

test('W4-03: ?testPdf= stamps a local History id and never a cloud file.id', () => {
  assert.match(DEV_TEST_ROUTE, /tier:\s*['"]developer['"]/);
  assert.match(DEV_TEST_ROUTE, /__localHistoryDocumentId = `dev-testpdf:\$\{pdfName\}`/);
  assert.doesNotMatch(DEV_TEST_ROUTE, /file\.id\s*=/);
});

test('W4-03: production History stays gated on documentId', () => {
  assert.match(SIDEBAR, /\{documentId && <HistoryButton/);
  assert.match(PANEL, /if \(!documentId\) return null;/);
});

test('W4-03: viewer History uses getHistoryDocumentId, not a forged file.id', () => {
  assert.match(VIEWER, /getHistoryDocumentId/);
  assert.match(VIEWER, /const currentDocumentId = getHistoryDocumentId\(pdfFile\)/);
  assert.match(VIEWER, /const historyDocumentId = getHistoryDocumentId\(pdfFile\)/);
  assert.doesNotMatch(
    VIEWER.slice(VIEWER.indexOf('const currentDocumentId'), VIEWER.indexOf('const currentDocumentId') + 80),
    /pdfFile\?\.id \|\| null/,
  );
});

test('W4-03: History/revision services skip live Supabase on ?testPdf=', () => {
  assert.match(SUPABASE, /isSupabaseAvailable = \(\) => supabase !== null && !isDevTestPdfRoute\(\)/);
  assert.match(HISTORY, /export function getHistoryDocumentId/);
  assert.match(HISTORY, /if \(!isDevTestPdfRoute\(\)\) return null;/);
  assert.match(HISTORY, /if \(!isSupabaseAvailable\(\)\) return \{ data: null, error: null \}/);
  assert.match(HISTORY, /if \(!isSupabaseAvailable\(\) \|\| !documentId\) return mergeHistoryRows/);
  assert.match(REVISIONS, /if \(!documentId \|\| !isSupabaseAvailable\(\)\) return \[\]/);
  assert.match(REVISIONS, /requireCloudRevisions\('createRevision'\)/);
  assert.match(PANEL, /if \(!isSupabaseAvailable\(\)\) return;/);
});
