import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const SERVICE = readFileSync(new URL('../src/services/documentRevisionService.js', import.meta.url), 'utf8');
const PANEL = readFileSync(new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url), 'utf8');
const SIDEBAR = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
const VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('A-07: Save version flushes live marks before kal48_create_revision', () => {
  assert.match(SERVICE, /export async function flushLiveAnnotationsForRevision/);
  assert.match(SERVICE, /upsertFabricAnnotation/);
  assert.match(PANEL, /onPrepareSaveRevision/);
  assert.match(PANEL, /await onPrepareSaveRevision\(\)/);
  assert.ok(
    PANEL.indexOf('await onPrepareSaveRevision()') < PANEL.indexOf('createRevision(documentId'),
    'flush must run before createRevision',
  );
});

test('A-07: Restore applies the named snapshot to the live canvas', () => {
  assert.match(PANEL, /onApplyNamedRevision/);
  assert.match(PANEL, /getRevision\(rev\.id\)/);
  assert.match(PANEL, /onApplyNamedRevision\(full\?\.snapshot_json/);
  assert.match(VIEWER, /handleApplyNamedRevision/);
  assert.match(VIEWER, /deserializeRowsToAnnotationsByPage/);
  assert.match(VIEWER, /restoreHistoryState/);
  assert.match(SIDEBAR, /onPrepareSaveRevision=\{onPrepareSaveRevision\}/);
  assert.match(SIDEBAR, /onApplyNamedRevision=\{onApplyNamedRevision\}/);
});
