import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDocumentItem,
  normalizeProjectItem,
  normalizeTemplateItem,
} from '../src/services/archiveContract.js';
import {
  defaultExpandedIds,
  defaultPreviewCollapsedIds,
  isPreviewNodeOpen,
  isRowExpanded,
  resolveArchivePreviewItem,
  toggleExpanded,
  togglePreviewNode,
} from '../src/home/archiveScreenModel.js';

// Live proof: debug/scenarios/e2e-archive-preview.spec.mjs
// Unique leftover after Archive Search / filter / sort.
// Archive row Preview / Close preview + sibling Show documents expand.
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

test('Archive Close preview matches Documents aria-label; Restore stays previewBlocked', () => {
  const screen = read('src/home/ArchiveScreen.jsx');
  assert.match(screen, /title="Close preview" aria-label="Close preview"/);
  assert.match(screen, /const showPreview = previewOpen && !selectMode && Boolean\(previewItem\)/);
  assert.match(screen, /const previewDocument = \(id\) => \{/);
  assert.match(screen, /if \(selectMode\) return;/);
  assert.match(screen, /setPreviewId\(id\);\s*setPreviewOpen\(true\);/);
  assert.match(screen, /resolveArchivePreviewItem\(rows, previewId\)/);
  assert.match(screen, /title=\{open \? `Hide \$\{label\}` : `Show \$\{label\}`\}/);
  assert.match(screen, /title=\{expanded \? 'Hide documents' : 'Show documents'\}/);
  assert.match(screen, /e\.stopPropagation\(\); setExpandedIds\(\(prev\) => toggleExpanded\(prev, item\.id\)\)/);
  assert.doesNotMatch(screen, /restoreArchiveItems\(/);
  assert.doesNotMatch(screen, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(screen, /PRINT_PANEL_ENABLED/);

  const docs = read('src/home/DocumentsLedger.jsx');
  assert.match(docs, /title="Close preview" aria-label="Close preview"/);
  assert.match(docs, />Open file<\/button>/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /name: 'Atrium'/);
  assert.match(preview, /name: 'Site plan'/);
  assert.match(preview, /name: 'Bravo checklist'/);
  assert.match(preview, /name: 'Level 1'/);
  assert.match(preview, /onRestoreArchive=\{previewBlocked\('restore archived items'\)\}/);
  assert.match(preview, /onDeleteArchiveForever=\{previewBlocked\('delete archived items forever'\)\}/);
  assert.doesNotMatch(preview, /restoreArchiveItems\(/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
});

test('seeded Preview resolves top-level and child rows; ledger expand stays independent', () => {
  const site = resolveArchivePreviewItem(items, 'ad1');
  assert.equal(site.id, 'ad1');
  assert.equal(site.name, 'Site plan');
  assert.equal(site.type, 'document');
  assert.equal(site.projectName, 'Tower 5 — Security');

  const atrium = resolveArchivePreviewItem(items, 'ap1');
  assert.equal(atrium.id, 'ap1');
  assert.equal(atrium.type, 'project');
  assert.equal(atrium.childCount, 2);

  const child = resolveArchivePreviewItem(items, 'ac-d1');
  assert.equal(child.id, 'ac-d1');
  assert.equal(child.name, 'Level 1');
  assert.equal(child.type, 'document');
  assert.equal(child.projectName, 'Atrium');

  const bravo = resolveArchivePreviewItem(items, 'at1');
  assert.equal(bravo.id, 'at1');
  assert.equal(bravo.type, 'template');
  assert.equal(bravo.modules?.[0]?.name, 'Walk-through');
  assert.equal(bravo.entities?.[0]?.name, 'GC');

  assert.equal(resolveArchivePreviewItem(items, 'missing'), null);
  assert.equal(resolveArchivePreviewItem(items, null), null);

  const ledger = defaultExpandedIds();
  assert.equal(isRowExpanded(ledger, 'ap1'), false);
  const opened = toggleExpanded(ledger, 'ap1');
  assert.equal(isRowExpanded(opened, 'ap1'), true);
  assert.equal(isRowExpanded(ledger, 'ap1'), false);

  const previewState = defaultPreviewCollapsedIds();
  assert.equal(isPreviewNodeOpen(previewState, 'ap1:contents'), true);
  const closed = togglePreviewNode(previewState, 'ap1:contents');
  assert.equal(isPreviewNodeOpen(closed, 'ap1:contents'), false);
  assert.equal(isRowExpanded(opened, 'ap1'), true);
  assert.equal(isPreviewNodeOpen(previewState, 'ap1:contents'), true);
});

test('Archive Preview is not Documents Preview extras and not leftover-18 Restore', () => {
  const docsExtras = read('debug/scenarios/e2e-hub-docs-extras.spec.mjs');
  assert.match(docsExtras, /Preview & details/);
  assert.match(docsExtras, /Close preview/);
  assert.doesNotMatch(docsExtras, /data-archive-item-id/);
  assert.doesNotMatch(docsExtras, /Show documents/);
  assert.doesNotMatch(docsExtras, /makeMockArchive/);

  const docsOpen = read('debug/scenarios/e2e-hub-docs-open-file.spec.mjs');
  assert.match(docsOpen, /returnTab=documents/);
  assert.doesNotMatch(docsOpen, /data-archive-item-id="ad1"/);

  const search = read('debug/scenarios/e2e-archive-search.spec.mjs');
  assert.match(search, /Search archive/);
  assert.doesNotMatch(search, /Close preview/);
  assert.doesNotMatch(search, /Show documents/);

  const screen = read('src/home/ArchiveScreen.jsx');
  assert.doesNotMatch(screen, /Open file/);
  assert.doesNotMatch(screen, /Preview & details/);
  assert.match(screen, /aria-label=\{`Preview \$\{child\.name\}`\}/);
});
