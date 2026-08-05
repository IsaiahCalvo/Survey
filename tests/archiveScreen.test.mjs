/* KAL-430 — Archive screen.
   Two strategies, matching tests/homeInitialLoadingSkeletons.test.mjs: pure
   model functions asserted on their return values, plus source-text
   assertions that lock in the wiring the JSX cannot be rendered to prove
   (no jsdom, no React test renderer in this repo). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ARCHIVE_FILTERS,
  ARCHIVE_SORTS,
  archiveTypeLabel,
  archivedDateLabel,
  buildBulkFailureMessage,
  buildBulkOutcomeMessage,
  daysRemainingLabel,
  defaultExpandedIds,
  filterArchiveItems,
  isAllSelected,
  isRowExpanded,
  namedSortFor,
  nextSelectAll,
  nextSortState,
  normalizeBulkResult,
  pruneSelection,
  resolveSelection,
  selectableIds,
  sortArchiveItems,
  sortStateForNamedSort,
  TEAM_AVATAR_SLOTS,
  collaboratorInitials,
  teamAvatarSlots,
  toggleExpanded,
  toggleSelection,
  visibleArchiveItems,
} from '../src/home/archiveScreenModel.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SCREEN = read('../src/home/ArchiveScreen.jsx');
const CSS = read('../src/home/hub.css');

const item = (over) => ({
  type: 'document',
  id: 'x',
  name: 'X',
  ownerId: 'u1',
  projectId: null,
  projectName: null,
  archiveGroupId: null,
  archivedAt: '2026-07-10T00:00:00.000Z',
  expiresAt: '2026-08-09T00:00:00.000Z',
  daysRemaining: 20,
  children: [],
  childCount: 0,
  ...over,
});

const doc = item({ id: 'd1', name: 'Site plan', archivedAt: '2026-07-20T00:00:00.000Z', daysRemaining: 10 });
const project = item({
  type: 'project',
  id: 'p1',
  name: 'Atrium',
  archiveGroupId: 'g1',
  archivedAt: '2026-07-25T00:00:00.000Z',
  daysRemaining: 15,
  children: [
    { type: 'document', id: 'c1', name: 'Level 1', projectId: 'p1', archiveGroupId: 'g1' },
    { type: 'document', id: 'c2', name: 'Level 2', projectId: 'p1', archiveGroupId: 'g1' },
  ],
  childCount: 2,
});
const template = item({ type: 'template', id: 't1', name: 'Bravo checklist', archivedAt: '2026-07-01T00:00:00.000Z', daysRemaining: 1 });
const ALL = [project, doc, template];

test('all four type filters narrow the list, and All shows everything', () => {
  assert.deepEqual(ARCHIVE_FILTERS.map((f) => f.key), ['all', 'document', 'project', 'template']);
  assert.deepEqual(ARCHIVE_FILTERS.map((f) => f.label), ['All', 'Documents', 'Projects', 'Templates']);

  assert.deepEqual(filterArchiveItems(ALL, 'all').map((i) => i.id), ['p1', 'd1', 't1']);
  assert.deepEqual(filterArchiveItems(ALL, 'document').map((i) => i.id), ['d1']);
  assert.deepEqual(filterArchiveItems(ALL, 'project').map((i) => i.id), ['p1']);
  assert.deepEqual(filterArchiveItems(ALL, 'template').map((i) => i.id), ['t1']);
  // Filtering never mutates the source list.
  assert.deepEqual(ALL.map((i) => i.id), ['p1', 'd1', 't1']);
});

test('all four named sorts map onto a (sortKey, sortDir) pair and order correctly', () => {
  assert.deepEqual(ARCHIVE_SORTS.map((s) => s.label), [
    'Recently archived', 'Oldest archived', 'Name A–Z', 'Name Z–A',
  ]);
  assert.deepEqual(sortStateForNamedSort('recent'), { sortKey: 'archived', sortDir: 'desc' });
  assert.deepEqual(sortStateForNamedSort('oldest'), { sortKey: 'archived', sortDir: 'asc' });
  assert.deepEqual(sortStateForNamedSort('az'), { sortKey: 'name', sortDir: 'asc' });
  assert.deepEqual(sortStateForNamedSort('za'), { sortKey: 'name', sortDir: 'desc' });
  assert.equal(namedSortFor('archived', 'desc').label, 'Recently archived');
  assert.equal(namedSortFor('name', 'desc').label, 'Name Z–A');

  assert.deepEqual(sortArchiveItems(ALL, 'archived', 'desc').map((i) => i.id), ['p1', 'd1', 't1']);
  assert.deepEqual(sortArchiveItems(ALL, 'archived', 'asc').map((i) => i.id), ['t1', 'd1', 'p1']);
  assert.deepEqual(sortArchiveItems(ALL, 'name', 'asc').map((i) => i.name), ['Atrium', 'Bravo checklist', 'Site plan']);
  assert.deepEqual(sortArchiveItems(ALL, 'name', 'desc').map((i) => i.name), ['Site plan', 'Bravo checklist', 'Atrium']);

  // Header clicks: same column flips direction, a new column adopts its own
  // natural first direction.
  assert.deepEqual(nextSortState({ sortKey: 'archived', sortDir: 'desc' }, 'archived'), { sortKey: 'archived', sortDir: 'asc' });
  assert.deepEqual(nextSortState({ sortKey: 'archived', sortDir: 'desc' }, 'name'), { sortKey: 'name', sortDir: 'asc' });
  assert.deepEqual(nextSortState({ sortKey: 'name', sortDir: 'asc' }, 'archived'), { sortKey: 'archived', sortDir: 'desc' });

  assert.deepEqual(
    visibleArchiveItems(ALL, { filter: 'all', sortKey: 'name', sortDir: 'asc' }).map((i) => i.id),
    ['p1', 't1', 'd1'],
  );
});

test('project rows start COLLAPSED and stay put across sorting and filtering', () => {
  // Owner call 2026-08-04: Archive is a scan-and-rescue list, so groups start
  // closed rather than burying the top-level rows under their children.
  const expanded = defaultExpandedIds();
  assert.equal(expanded.size, 0);
  assert.equal(isRowExpanded(expanded, 'p1'), false);

  const afterOpen = toggleExpanded(expanded, 'p1');
  assert.equal(isRowExpanded(afterOpen, 'p1'), true);
  // The original set is untouched — React sees a new reference each time.
  assert.equal(isRowExpanded(expanded, 'p1'), false);
  assert.equal(isRowExpanded(toggleExpanded(afterOpen, 'p1'), 'p1'), false);

  // Expansion is not derived from the list, so re-sorting/re-filtering cannot
  // reset it: whatever the user opened stays open.
  visibleArchiveItems(ALL, { filter: 'project', sortKey: 'name', sortDir: 'desc' });
  assert.equal(isRowExpanded(afterOpen, 'p1'), true);
});

test('only top-level items are selectable — a project child never is', () => {
  assert.deepEqual(selectableIds(ALL), ['p1', 'd1', 't1']);
  const childIds = project.children.map((c) => c.id);
  for (const id of childIds) assert.equal(selectableIds(ALL).includes(id), false);

  const selected = toggleSelection(new Set(), 'p1');
  assert.deepEqual([...selected], ['p1']);
  // Resolving hands back whole top-level items, never children.
  const resolved = resolveSelection(ALL, selected);
  assert.deepEqual(resolved.map((i) => i.id), ['p1']);
  assert.equal(resolved[0].childCount, 2);
  // A child id in the selection resolves to nothing.
  assert.deepEqual(resolveSelection(ALL, new Set(['c1'])), []);
  assert.deepEqual([...toggleSelection(selected, 'p1')], []);
});

test('select all operates over the currently filtered list only', () => {
  const documentsOnly = visibleArchiveItems(ALL, { filter: 'document' });
  const all = nextSelectAll(new Set(), documentsOnly);
  assert.deepEqual([...all], ['d1']);
  assert.equal(isAllSelected(all, documentsOnly), true);
  // Same selection against the unfiltered list is NOT "all".
  assert.equal(isAllSelected(all, ALL), false);
  // Toggling again clears.
  assert.deepEqual([...nextSelectAll(all, documentsOnly)], []);
  // Nothing visible: never reads as "all selected".
  assert.equal(isAllSelected(new Set(), []), false);

  // After a restore removes rows, stale ids drop out of the selection.
  assert.deepEqual([...pruneSelection(new Set(['p1', 'd1']), [doc])], ['d1']);
});

test('days remaining and type labels read plainly', () => {
  assert.equal(daysRemainingLabel(29), '29 days');
  assert.equal(daysRemainingLabel(1), '1 day');
  assert.equal(daysRemainingLabel(0), 'Today');
  assert.equal(daysRemainingLabel(-4), 'Today');
  assert.equal(archiveTypeLabel('document'), 'Document');
  assert.equal(archiveTypeLabel('project'), 'Project');
  assert.equal(archiveTypeLabel('template'), 'Template');
  assert.equal(archivedDateLabel(''), '—');
  assert.equal(typeof archivedDateLabel('2026-07-20T00:00:00.000Z'), 'string');
});

test('bulk outcome copy names what succeeded and what did not', () => {
  assert.deepEqual(buildBulkOutcomeMessage('restore', { succeeded: [doc, project], failed: [] }), {
    message: 'Restored 2 items.', type: 'success',
  });
  assert.deepEqual(buildBulkOutcomeMessage('restore', { succeeded: [doc], failed: [] }), {
    message: 'Restored 1 item.', type: 'success',
  });
  assert.deepEqual(buildBulkOutcomeMessage('restore', { succeeded: [project, template], failed: [doc] }), {
    message: 'Restored 2 items. 1 could not be restored: Site plan.', type: 'error',
  });
  assert.deepEqual(buildBulkOutcomeMessage('delete', { succeeded: [], failed: [doc] }), {
    message: 'Could not delete 1 item: Site plan.', type: 'error',
  });
  assert.deepEqual(buildBulkOutcomeMessage('delete', { succeeded: [doc], failed: [] }), {
    message: 'Deleted 1 item.', type: 'success',
  });
  assert.equal(buildBulkOutcomeMessage('restore', { succeeded: [], failed: [] }), null);
  // A rejection means nothing landed.
  assert.deepEqual(buildBulkFailureMessage('restore', [doc, project]), {
    message: 'Could not restore 2 items: Site plan, Atrium.', type: 'error',
  });

  // A plain resolve (or undefined) counts as full success; a result object
  // with a failed[] list is surfaced per item.
  assert.deepEqual(normalizeBulkResult(undefined, [doc]), { succeeded: [doc], failed: [] });
  assert.deepEqual(
    normalizeBulkResult({ succeeded: [project], failed: [{ item: doc, error: new Error('nope') }] }, [project, doc]),
    { succeeded: [project], failed: [doc] },
  );
});

test('the screen wires the archive contract, confirmation and toasts', () => {
  assert.match(SCREEN, /import \{ ConfirmModal \} from '\.\/BulkModals'/);
  assert.match(SCREEN, /import \{ DELETE_FOREVER_COPY \} from '\.\.\/services\/archiveContract'/);
  assert.match(SCREEN, /import \{ showToast \} from '\.\.\/utils\/toast'/);
  assert.match(SCREEN, /<ConfirmModal[\s\S]*?title=\{DELETE_FOREVER_COPY\.title\}/);
  assert.match(SCREEN, /message=\{DELETE_FOREVER_COPY\.message\}/);
  assert.match(SCREEN, /confirmLabel=\{DELETE_FOREVER_COPY\.confirmLabel\}/);
  assert.match(SCREEN, /danger\n\s*onConfirm=/);
  assert.match(SCREEN, /showToast\(outcome\.message, outcome\.type\)/);
});

test('the screen offers Restore and Delete forever, and nothing else', () => {
  assert.match(SCREEN, />Restore</);
  assert.match(SCREEN, />Delete forever</);
  assert.match(SCREEN, /disabled=\{actionsDisabled\}/);
  assert.doesNotMatch(SCREEN, /Move\/Copy|MoveCopyModal|>Duplicate<|>Share<|>Copy</);
  assert.doesNotMatch(SCREEN, /onShare|onDuplicate|onMoveCopy/);
});

test('the screen mirrors the Documents ledger structure and states', () => {
  assert.match(SCREEN, /<HubShell[\s\S]*?tab="archive"/);
  assert.match(SCREEN, /const grid = '32px minmax\(150px,1fr\) 110px 124px 110px'/);
  assert.match(SCREEN, /contentVisibility: 'auto'/);
  assert.match(SCREEN, /containIntrinsicSize: '0 50px'/);
  assert.match(SCREEN, /sortKey === key \? 'var\(--bone-100\)' : 'inherit'/);
  assert.match(SCREEN, /hub-skeleton-block/);
  assert.match(SCREEN, /hub-loading-document-row/);
  assert.match(SCREEN, /<EmptyState[\s\S]*?icon="clock"[\s\S]*?line="Nothing in Archive"/);
  assert.match(SCREEN, /allSelected \? 'None' : 'All'/);
  // Children are descriptive: no checkbox, no per-child action.
  assert.match(SCREEN, /item\.children\.map/);
  assert.doesNotMatch(SCREEN, /toggleRow\(child\.id\)/);
});

test('the preview pane renders the real first page, ahead of any row thumbnails', () => {
  // The preview is the one image on this screen, so it takes the shared
  // render queue's priority slot instead of queueing behind a list the user
  // has already left.
  assert.match(
    SCREEN,
    /<PdfPageThumb\s+key=\{previewItem\.id\}[\s\S]*?doc=\{\{ id: previewItem\.id, file_path: previewItem\.filePath \}\}[\s\S]*?variant="preview"[\s\S]*?priority/,
  );
  assert.match(SCREEN, /downloadDocument\}/);
  assert.match(SCREEN, /const \{ downloadDocument \} = useStorage\(\)/);
});

test("an expanded project's child rows show the same page thumbnail as a Documents row", () => {
  // variant="row" — the small real-aspect thumbnail, NOT the big preview one.
  assert.match(
    SCREEN,
    /<PdfPageThumb\s+doc=\{\{ id: child\.id, file_path: child\.filePath \}\}[\s\S]*?variant="row"/,
  );
  // The old icon-only row is the fallback now, never the default.
  assert.match(SCREEN, /fallback=\{<Icon name="doc" size=\{12\} color="var\(--ink-300\)" \/>\}/);
  // Intrinsic size must track the taller row or the skipped rows jump.
  assert.match(SCREEN, /containIntrinsicSize: '0 40px'/);
});

test('the preview shows collaborator glyphs only when the item really is shared', () => {
  // Reuses the hub's existing overlapping stack, not a new visual pattern.
  assert.match(SCREEN, /import \{[^}]*AvatarStack[^}]*\} from '\.\/HubShell'/);
  assert.match(SCREEN, /previewTeam\.shown\.length > 0 && \(/);
  assert.match(SCREEN, /<AvatarStack[\s\S]*?previewTeam\.shown\.map\(collaboratorInitials\)/);
  assert.match(SCREEN, /previewTeam\.overflow \? \[`\+\$\{previewTeam\.overflow\}`\] : \[\]/);
  // Archive must NOT fall back to the signed-in user the way Documents does:
  // every archived item is the owner's by definition, so a solo item shows
  // no glyphs at all.
  assert.doesNotMatch(SCREEN, /initialsOf\(user\?\.name/);
});

test('avatar slots fill owners first, then editors, then viewers', () => {
  const person = (role, name) => ({ id: name, name, role });
  assert.equal(TEAM_AVATAR_SLOTS, 5);

  // 2 owners + 3 editors fits exactly: the 2 owners first, then the 3 editors,
  // everyone shown, no overflow glyph.
  const exact = teamAvatarSlots([
    person('editor', 'Ed One'), person('owner', 'Ola One'), person('editor', 'Ed Two'),
    person('owner', 'Ola Two'), person('editor', 'Ed Three'),
  ]);
  assert.deepEqual(exact.shown.map((p) => p.name), ['Ola One', 'Ola Two', 'Ed One', 'Ed Two', 'Ed Three']);
  assert.equal(exact.overflow, 0);

  // Viewers never displace an owner or an editor.
  const mixed = teamAvatarSlots([
    person('viewer', 'Vi One'), person('viewer', 'Vi Two'),
    person('owner', 'Ola One'), person('editor', 'Ed One'),
  ]);
  assert.deepEqual(mixed.shown.map((p) => p.name), ['Ola One', 'Ed One', 'Vi One', 'Vi Two']);
  assert.equal(mixed.overflow, 0);

  // More people than slots: the LAST slot becomes "+N", and the lowest-priority
  // people are the ones it stands for.
  const over = teamAvatarSlots([
    ...Array.from({ length: 6 }, (_, i) => person('owner', `Ola ${i}`)),
    person('editor', 'Ed One'),
  ]);
  assert.equal(over.shown.length, TEAM_AVATAR_SLOTS - 1);
  assert.deepEqual(over.shown.map((p) => p.role), ['owner', 'owner', 'owner', 'owner']);
  assert.equal(over.overflow, 3);

  // Ordering is stable within a role, so glyphs do not shuffle between renders.
  assert.deepEqual(
    teamAvatarSlots([person('editor', 'B'), person('editor', 'A')]).shown.map((p) => p.name),
    ['B', 'A'],
  );

  assert.deepEqual(teamAvatarSlots(), { shown: [], overflow: 0 });
  assert.deepEqual(teamAvatarSlots([]), { shown: [], overflow: 0 });
});

test('avatar initials come from the name, falling back to the invited email', () => {
  assert.equal(collaboratorInitials({ name: 'Isaiah Calvo' }), 'IC');
  assert.equal(collaboratorInitials({ name: 'cher' }), 'C');
  assert.equal(collaboratorInitials({ email: 'dana.smith@example.com' }), 'D');
  assert.equal(collaboratorInitials({}), '—');
  assert.equal(collaboratorInitials(null), '—');
});

test('the mobile card list is hidden on desktop and shown under 720px', () => {
  assert.match(SCREEN, /className="archive-mobile-list slim-scroll"/);
  assert.match(SCREEN, /className="card archive-desktop-card"/);
  assert.match(CSS, /\.survey-hub \.archive-mobile-list \{\s*\n\s*display: none;/);
  assert.match(CSS, /@media \(max-width: 720px\)[\s\S]*?\.survey-hub \.archive-desktop-card \{[\s\S]*?display: none !important/);
  assert.match(CSS, /@media \(max-width: 720px\)[\s\S]*?\.survey-hub \.archive-mobile-list \{[\s\S]*?display: flex/);
});

/* ------------------------------------------------------------------------
   Hub wiring (KAL-280 navigation + KAL-430 integration). The Archive screen
   is useless if the rail cannot reach it, or if the live lists keep showing
   archived rows, so both ends are locked here.
   ------------------------------------------------------------------------ */

const HUB_SHELL = readFileSync(new URL('../src/home/HubShell.jsx', import.meta.url), 'utf8');
const SURVEY_HUB = readFileSync(new URL('../src/home/SurveyHub.jsx', import.meta.url), 'utf8');
const CONTAINER = readFileSync(new URL('../src/home/ArchiveScreenContainer.jsx', import.meta.url), 'utf8');
const DATABASE_HOOKS = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');

test('Archive renders in its own bottom rail group, directly above the profile', () => {
  // Being LAST inside `.nav` was not enough: `.who` carries margin-top:auto, so
  // the flexible space opened up BELOW Archive and it stayed glued to the main
  // tabs at the top of the rail. Archive must render in its own group that
  // takes the space itself, immediately before the profile chip.
  assert.match(HUB_SHELL, /const archiveNavItem = \['archive', 'clock', 'Archive', false\]/);
  assert.doesNotMatch(
    HUB_SHELL.match(/const primaryNavItems = \[[\s\S]*?\];/)?.[0] || '',
    /archive/,
    'Archive must not sit in the primary tab group',
  );
  // Render order: primary nav, then the archive group, then the profile chip.
  assert.match(
    HUB_SHELL,
    /<nav className="nav nav-bottom">\s*\{navBtn\(\.\.\.archiveNavItem\)\}\s*<\/nav>\s*<ProfileMenu/,
  );
  // The bottom group is what claims the rail's flexible space now.
  assert.match(CSS, /\.survey-hub \.nav-bottom \{[^}]*margin-top: auto/);
  // Mobile has no bottom anchor, so it keeps one flat list including Archive.
  assert.match(HUB_SHELL, /const navItems = \[\.\.\.primaryNavItems, archiveNavItem\]/);
});

test('the hub routes the archive tab to the data container, lazily', () => {
  assert.match(SURVEY_HUB, /const ArchiveScreenContainer = lazy\(\(\) => import\('\.\/ArchiveScreenContainer'\)\)/);
  assert.match(SURVEY_HUB, /tab === 'archive' &&[\s\S]*?<ArchiveScreenContainer \{\.\.\.common\} \/>/);
});

test('the container is the only place Archive touches Supabase', () => {
  assert.match(CONTAINER, /from '\.\.\/services\/archiveService'/);
  assert.match(CONTAINER, /loadArchive\(userId\)/);
  assert.match(CONTAINER, /restoreArchiveItems\(selected\)/);
  assert.match(CONTAINER, /deleteArchiveItemsForever\(selected\)/);
  // The presentational screen must stay free of any data access.
  assert.doesNotMatch(SCREEN, /supabaseClient|archiveService|loadArchive/);
});

test('archived rows leave the Documents, Projects and Templates lists', () => {
  // One filter per live read. `archived` (the Free-tier downgrade flag) and
  // `user_archived_at` (the 30-day Archive) are separate and both survive.
  const filters = DATABASE_HOOKS.match(/\.is\('user_archived_at', null\)/g) || [];
  assert.equal(filters.length, 4, 'owned documents, collaborator documents, projects, templates');
  assert.match(DATABASE_HOOKS, /\.eq\('archived', false\)\s*\n[\s\S]{0,400}?\.is\('user_archived_at', null\)/);
});

test('restoring announces the change so live lists refetch without a reload', () => {
  assert.match(CONTAINER, /notifyLibraryChanged\(\)/);
  const subscriptions = DATABASE_HOOKS.match(/subscribeLibraryChange\(\(\) => \{/g) || [];
  assert.equal(subscriptions.length, 3, 'documents, projects and templates all resubscribe');
  const bus = readFileSync(new URL('../src/hooks/libraryChangeBus.js', import.meta.url), 'utf8');
  assert.match(bus, /export function subscribeLibraryChange/);
  assert.match(bus, /export function notifyLibraryChanged/);
});
