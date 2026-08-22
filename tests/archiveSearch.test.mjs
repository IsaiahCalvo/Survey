import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDocumentItem,
  normalizeProjectItem,
  normalizeTemplateItem,
} from '../src/services/archiveContract.js';
import { visibleArchiveItems } from '../src/home/archiveScreenModel.js';

// Live proof: debug/scenarios/e2e-archive-search.spec.mjs
// Unique leftover after TabBar Close tab.
// Archive Search / filter / sort is local hubPreview chrome.
// Restore / Delete forever stay leftover-18 — not invented.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('HubPreview seeds Archive locally and Restore stays previewBlocked', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const makeMockArchive = \(\) => \(/);
  assert.match(preview, /name: 'Atrium'/);
  assert.match(preview, /name: 'Site plan'/);
  assert.match(preview, /name: 'Bravo checklist'/);
  assert.match(preview, /name: 'Level 1'/);
  assert.match(preview, /const \[archiveItems\] = useState\(\(\) => \(previewHasNoData \? \[\] : makeMockArchive\(\)\)\)/);
  assert.match(preview, /archiveItems=\{archiveItems\}/);
  assert.match(preview, /onRestoreArchive=\{previewBlocked\('restore archived items'\)\}/);
  assert.match(preview, /onDeleteArchiveForever=\{previewBlocked\('delete archived items forever'\)\}/);
  assert.doesNotMatch(preview, /restoreArchiveItems\(/);
  assert.doesNotMatch(preview, /deleteArchiveItemsForever\(/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /PRINT_PANEL_ENABLED/);
});

test('SurveyHub preview list skips the host container; container rejects non-UUID ids', () => {
  const hub = read('src/home/SurveyHub.jsx');
  assert.match(hub, /Array\.isArray\(archiveItems\) \?/);
  assert.match(hub, /<ArchiveScreen[\s\S]*?items=\{archiveItems\}/);
  assert.match(hub, /onRestore=\{onRestoreArchive\}/);
  assert.match(hub, /<ArchiveScreenContainer \{\.\.\.common\} \/>/);

  const container = read('src/home/ArchiveScreenContainer.jsx');
  assert.match(container, /const isUuid = \(value\) => typeof value === 'string' && UUID_RE\.test\(value\)/);
  assert.match(container, /const userId = isUuid\(user\?\.id\) \? user\.id : null/);
  assert.match(container, /loadArchive\(userId\)/);
});

test('seeded Archive Search / filter / sort is the model, not leftover-18 Restore', () => {
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
      config: { entities: [], modules: [] },
    }, { now }),
  ];

  assert.deepEqual(visibleArchiveItems(items).map((i) => i.id), ['ap1', 'ad1', 'at1']);
  assert.deepEqual(visibleArchiveItems(items, { search: 'site' }).map((i) => i.id), ['ad1']);
  assert.deepEqual(visibleArchiveItems(items, { search: 'SITE' }).map((i) => i.id), ['ad1']);
  assert.deepEqual(visibleArchiveItems(items, { search: 'Level 1' }).map((i) => i.id), ['ap1']);
  assert.deepEqual(visibleArchiveItems(items, { search: 'zzzz' }), []);
  assert.deepEqual(visibleArchiveItems(items, { filter: 'document' }).map((i) => i.id), ['ad1']);
  assert.deepEqual(visibleArchiveItems(items, { filter: 'project' }).map((i) => i.id), ['ap1']);
  assert.deepEqual(visibleArchiveItems(items, { filter: 'template' }).map((i) => i.id), ['at1']);
  assert.deepEqual(visibleArchiveItems(items, { sortKey: 'name', sortDir: 'asc' }).map((i) => i.id), ['ap1', 'at1', 'ad1']);
  assert.deepEqual(visibleArchiveItems(items, { sortKey: 'size', sortDir: 'desc' }).map((i) => i.id), ['ad1', 'ap1', 'at1']);

  const screen = read('src/home/ArchiveScreen.jsx');
  assert.match(screen, /placeholder="Search archive\.\.\."/);
  assert.match(screen, /visibleArchiveItems\(items, \{ filter, sortKey, sortDir, search \}\)/);
  assert.match(screen, /ARCHIVE_FILTERS\.map/);
  assert.match(screen, /ARCHIVE_SORT_OPTIONS\.map/);
  assert.doesNotMatch(screen, /restoreArchiveItems\(/);
  assert.doesNotMatch(screen, /setCopyModeActive\(true\)/);

  const close = read('debug/scenarios/e2e-tab-close.spec.mjs');
  assert.match(close, /Close tab/);
  assert.doesNotMatch(close, /makeMockArchive/);
});
