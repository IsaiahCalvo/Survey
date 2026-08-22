import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETE_FOREVER_COPY,
  normalizeDocumentItem,
  normalizeProjectItem,
  normalizeTemplateItem,
} from '../src/services/archiveContract.js';
import {
  buildBulkFailureMessage,
  isAllSelected,
  nextSelectAll,
  pruneSelection,
  resolveSelection,
  selectableIds,
  toggleSelection,
  visibleArchiveItems,
} from '../src/home/archiveScreenModel.js';

// Live proof: debug/scenarios/e2e-archive-select.spec.mjs
// Unique leftover after Archive row Preview / Close preview + Show documents.
// Archive Select / All / None / Done is local hubPreview chrome.
// Restore / Delete forever stay leftover-18 — not invented.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const now = Date.parse('2026-08-22T12:00:00.000Z');
const items = [
  normalizeProjectItem(
    {
      id: 'ap1', user_id: 'dev-hubpreview-user', name: 'Atrium',
      user_archived_at: '2026-08-20T10:00:00.000Z', archive_group_id: 'ag1',
    },
    [
      { id: 'ac-d1', name: 'Level 1', project_id: 'ap1', archive_group_id: 'ag1', file_size: 1_200_000, user_archived_at: '2026-08-20T10:00:00.000Z' },
      { id: 'ac-d2', name: 'Level 2', project_id: 'ap1', archive_group_id: 'ag1', file_size: 800_000, user_archived_at: '2026-08-20T10:00:00.000Z' },
    ],
    { now },
  ),
  normalizeDocumentItem(
    {
      id: 'ad1', user_id: 'dev-hubpreview-user', name: 'Site plan',
      project_id: 'p1', file_size: 4_200_000, user_archived_at: '2026-08-14T10:00:00.000Z',
    },
    { projectName: 'Tower 5 — Security', now },
  ),
  normalizeTemplateItem({
    id: 'at1', user_id: 'dev-hubpreview-user', name: 'Bravo checklist',
    user_archived_at: '2026-08-02T10:00:00.000Z',
    config: {
      entities: [{ id: 'ae1', name: 'GC', color: 'rgba(216,168,78,0.5)' }],
      modules: [{
        id: 'am1',
        name: 'Walk-through',
        categories: [{ id: 'ac1', name: 'Cameras', checklist: [{ id: 'ai1', text: 'Is the camera labeled?' }] }],
      }],
    },
  }, { now }),
];

test('Archive Select / All / None / Done is local chrome; Restore stays previewBlocked', () => {
  const screen = read('src/home/ArchiveScreen.jsx');
  assert.match(screen, /className="archive-mobile-summary"/);
  assert.match(screen, /className="archive-select-row mobile-header-select-row"/);
  assert.match(screen, /className="archive-select-actions mobile-header-select-actions"/);
  assert.match(screen, /\{selectMode \? 'Done' : 'Select'\}/);
  assert.match(screen, /allSelected \? 'None' : 'All'/);

  const css = read('src/home/hub.css');
  assert.match(css, /:not\(\.archive-mobile-summary\)/);
  assert.match(css, /\.survey-hub \.archive-mobile-summary \{\s*display: contents !important;/);
  assert.match(screen, /setSelectedIds\(\(prev\) => nextSelectAll\(prev, rows\)\)/);
  assert.match(screen, /if \(!next\) setSelectedIds\(new Set\(\)\);/);
  assert.match(screen, /const showPreview = previewOpen && !selectMode && Boolean\(previewItem\)/);
  assert.match(screen, /if \(selectMode\) \{ toggleRow\(item\.id\); return; \}/);
  assert.match(screen, /if \(selectMode\) return;/);
  assert.match(screen, /const doRestore = \(\) => runBulk\('restore', onRestore\);/);
  assert.match(screen, /onClick=\{\(\) => setConfirmDelete\(true\)\}/);
  assert.match(screen, /onConfirm=\{\(\) => doDeleteForever\(\)\}/);
  assert.doesNotMatch(screen, /restoreArchiveItems\(/);
  assert.doesNotMatch(screen, /deleteArchiveItemsForever\(/);
  assert.doesNotMatch(screen, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(screen, /PRINT_PANEL_ENABLED/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /name: 'Atrium'/);
  assert.match(preview, /name: 'Site plan'/);
  assert.match(preview, /name: 'Bravo checklist'/);
  assert.match(preview, /onRestoreArchive=\{previewBlocked\('restore archived items'\)\}/);
  assert.match(preview, /onDeleteArchiveForever=\{previewBlocked\('delete archived items forever'\)\}/);
  assert.doesNotMatch(preview, /restoreArchiveItems\(/);
  assert.doesNotMatch(preview, /deleteArchiveItemsForever\(/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);

  assert.equal(DELETE_FOREVER_COPY.title, 'Delete forever?');
  assert.equal(DELETE_FOREVER_COPY.confirmLabel, 'Delete forever');
});

test('All / None operate over visible top-level rows; children stay excluded; fail-closed keeps ids', () => {
  const visible = visibleArchiveItems(items);
  assert.deepEqual(visible.map((item) => item.id), ['ap1', 'ad1', 'at1']);
  assert.deepEqual(selectableIds(visible), ['ap1', 'ad1', 'at1']);
  assert.equal(selectableIds(visible).includes('ac-d1'), false);

  const one = toggleSelection(new Set(), 'ad1');
  assert.deepEqual([...one], ['ad1']);
  assert.equal(isAllSelected(one, visible), false);
  assert.deepEqual(resolveSelection(visible, one).map((item) => item.name), ['Site plan']);

  const all = nextSelectAll(one, visible);
  assert.deepEqual([...all], ['ap1', 'ad1', 'at1']);
  assert.equal(isAllSelected(all, visible), true);
  const none = nextSelectAll(all, visible);
  assert.deepEqual([...none], []);

  const documentsOnly = visibleArchiveItems(items, { filter: 'document' });
  const docsAll = nextSelectAll(new Set(), documentsOnly);
  assert.deepEqual([...docsAll], ['ad1']);
  assert.equal(isAllSelected(docsAll, documentsOnly), true);
  assert.equal(isAllSelected(docsAll, visible), false);

  assert.deepEqual(resolveSelection(visible, new Set(['ac-d1'])), []);
  assert.deepEqual([...pruneSelection(all, items)], ['ap1', 'ad1', 'at1']);

  const restoreFail = buildBulkFailureMessage('restore', resolveSelection(visible, one));
  assert.deepEqual(restoreFail, {
    message: 'Could not restore 1 item: Site plan.',
    type: 'error',
  });
  const deleteFail = buildBulkFailureMessage('delete', resolveSelection(visible, new Set(['at1'])));
  assert.deepEqual(deleteFail, {
    message: 'Could not delete 1 item: Bravo checklist.',
    type: 'error',
  });
});

test('Archive Select is not Documents Select and not leftover-18 Restore writeback', () => {
  const docs = read('src/home/DocumentsLedger.jsx');
  assert.match(docs, /\{docSelectMode \? 'Done' : 'Select'\}/);
  assert.match(docs, />Duplicate<\/button>/);
  assert.match(docs, />Move\/Copy<\/button>/);
  assert.doesNotMatch(docs, />Restore<\/button>/);
  assert.doesNotMatch(docs, />Delete forever<\/button>/);
  assert.doesNotMatch(docs, /data-archive-item-id/);

  const previewSpec = read('debug/scenarios/e2e-archive-preview.spec.mjs');
  assert.match(previewSpec, /Close preview/);
  assert.match(previewSpec, /Show documents/);
  assert.doesNotMatch(previewSpec, /Could not restore 1 item: Site plan/);
  assert.doesNotMatch(previewSpec, /allOverVisibleOnly/);

  const searchSpec = read('debug/scenarios/e2e-archive-search.spec.mjs');
  assert.match(searchSpec, /Search archive/);
  assert.doesNotMatch(searchSpec, /allOverVisibleOnly/);
  assert.doesNotMatch(searchSpec, /childExcluded/);

  const screen = read('src/home/ArchiveScreen.jsx');
  assert.doesNotMatch(screen, />Duplicate<\/button>/);
  assert.doesNotMatch(screen, />Move\/Copy<\/button>/);
  assert.match(screen, />Restore<\/button>/);
  assert.match(screen, />Delete forever<\/button>/);
});
