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
  ARCHIVE_SORT_OPTIONS,
  archiveItemSize,
  archiveTypeLabel,
  matchedOnChildOnly,
  searchArchiveItems,
  archivedDateLabel,
  buildBulkFailureMessage,
  buildBulkOutcomeMessage,
  daysRemainingLabel,
  defaultExpandedIds,
  defaultPreviewCollapsedIds,
  filterArchiveItems,
  isAllSelected,
  isPreviewNodeOpen,
  isRowExpanded,
  namedSortFor,
  nextSelectAll,
  nextSortState,
  normalizeBulkResult,
  pruneSelection,
  resolveSelection,
  resolveArchivePreviewItem,
  selectableIds,
  sortArchiveItems,
  sortStateForNamedSort,
  TEAM_AVATAR_SLOTS,
  collaboratorInitials,
  teamAvatarSlots,
  toggleExpanded,
  togglePreviewNode,
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

test('the named sorts map onto a (sortKey, sortDir) pair and order correctly', () => {
  assert.deepEqual(ARCHIVE_SORTS.map((s) => s.label), [
    'Recently archived', 'Oldest archived', 'Name A–Z', 'Name Z–A', 'Size',
  ]);
  assert.deepEqual(sortStateForNamedSort('largest'), { sortKey: 'size', sortDir: 'desc' });
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

test('the sort menu is the Documents ledger\'s list, with the date field renamed', () => {
  /* Owner asked (2026-08-07) to "filter by: file, project, most recently
     archived, size" — which is DocumentsLedger's own sortOptions
     (File / Project / Last edited / Size) with the date row renamed to
     Archive's equivalent. Same control, four rows, one word changed. */
  assert.deepEqual(
    ARCHIVE_SORT_OPTIONS.map((o) => [o.key, o.label]),
    [['name', 'File'], ['project', 'Project'], ['archived', 'Most recently archived'], ['size', 'Size']],
  );
  const DOCS = read('../src/home/DocumentsLedger.jsx');
  assert.match(DOCS, /\['name', 'File'\],\s*\n\s*\['project', 'Project'\],[\s\S]*?\['size', 'Size'\],/, 'Documents is the reference list');
  // Size opens biggest-first, exactly as the Documents ledger's size sort does.
  assert.deepEqual(nextSortState({ sortKey: 'name', sortDir: 'asc' }, 'size'), { sortKey: 'size', sortDir: 'desc' });
  assert.match(DOCS, /key === 'edited' \|\| key === 'size' \? 'desc' : 'asc'/);
});

test('sorting by size parks items that HAVE no size at the end, both directions', () => {
  /* Only documents carry bytes. A project reports the sum of its children; a
     template owns no file at all. Treating "no size" as zero would rank a
     template as the smallest thing in the list, which is a different claim. */
  const sized = (id, name, bytes) => item({ id, name, fileSize: bytes });
  const list = [
    sized('big', 'Big drawing', 9_000_000),
    item({ id: 'tpl', name: 'A template', type: 'template' }),
    sized('small', 'Small note', 1_000),
    item({ id: 'tpl2', name: 'Z template', type: 'template' }),
  ];
  assert.equal(archiveItemSize(list[0]), 9_000_000);
  assert.equal(archiveItemSize(list[1]), null, 'a template has no size, not zero');
  assert.equal(archiveItemSize(null), null);

  assert.deepEqual(
    sortArchiveItems(list, 'size', 'desc').map((i) => i.id),
    ['big', 'small', 'tpl', 'tpl2'],
  );
  // Ascending flips only the SIZED items; the sizeless ones stay at the end.
  assert.deepEqual(
    sortArchiveItems(list, 'size', 'asc').map((i) => i.id),
    ['small', 'big', 'tpl', 'tpl2'],
  );
  // Sizeless items tie-break by name so their order is stable.
  assert.deepEqual(
    sortArchiveItems([list[3], list[1]], 'size', 'desc').map((i) => i.name),
    ['A template', 'Z template'],
  );
});

test('sorting by project groups documents under their project, projectless last', () => {
  const list = [
    item({ id: 'd1', name: 'Doc one', projectName: 'Zulu' }),
    item({ id: 't1', name: 'Loose template', type: 'template' }),
    item({ id: 'p1', name: 'Alpha', type: 'project' }),
    item({ id: 'd2', name: 'Doc two', projectName: 'Alpha' }),
  ];
  // A project sorts under its OWN name; a document under its project's.
  assert.deepEqual(
    sortArchiveItems(list, 'project', 'asc').map((i) => i.id),
    ['p1', 'd2', 'd1', 't1'],
  );
  // The template has no project and lands last regardless of direction.
  assert.equal(sortArchiveItems(list, 'project', 'desc').at(-1).id, 't1');
});

test('search filters by name and reaches inside a project', () => {
  // Same rule as the Documents ledger: case-insensitive substring on the name.
  assert.deepEqual(searchArchiveItems(ALL, 'site').map((i) => i.id), ['d1']);
  assert.deepEqual(searchArchiveItems(ALL, 'SITE').map((i) => i.id), ['d1'], 'case-insensitive');
  assert.deepEqual(searchArchiveItems(ALL, '  atri  ').map((i) => i.id), ['p1'], 'trimmed');
  assert.deepEqual(searchArchiveItems(ALL, '').map((i) => i.id), ['p1', 'd1', 't1'], 'empty shows everything');
  assert.deepEqual(searchArchiveItems(ALL, 'zzzz'), []);

  // A project is kept when a CHILD matches, and its children narrow to the hits
  // so opening it shows the match rather than the whole group.
  const childHit = searchArchiveItems(ALL, 'Level 1');
  assert.deepEqual(childHit.map((i) => i.id), ['p1']);
  assert.deepEqual(childHit[0].children.map((c) => c.name), ['Level 1']);
  assert.equal(childHit[0].childCount, 1);
  // Matching the project's OWN name keeps every child.
  assert.equal(searchArchiveItems(ALL, 'Atrium')[0].children.length, 2);
  // The source list is never mutated.
  assert.equal(project.children.length, 2);

  // Such a project is force-opened, so the matching child is actually visible.
  assert.equal(matchedOnChildOnly(childHit[0], 'Level 1'), true);
  assert.equal(matchedOnChildOnly(project, 'Atrium'), false, 'a name match does not force-open');
  assert.equal(matchedOnChildOnly(project, ''), false);
  assert.equal(matchedOnChildOnly(doc, 'Site'), false, 'only projects have children');

  // Search composes with the type filter and the sort.
  assert.deepEqual(
    visibleArchiveItems(ALL, { search: 'e', filter: 'template' }).map((i) => i.id),
    ['t1'],
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

test('project children can be previewed without becoming independently selectable', () => {
  const child = resolveArchivePreviewItem(ALL, 'c1');
  assert.equal(child.id, 'c1');
  assert.equal(child.type, 'document');
  assert.equal(child.projectName, project.name);
  assert.equal(resolveArchivePreviewItem(ALL, 'p1'), project);
  assert.equal(resolveArchivePreviewItem(ALL, 'missing'), null);

  // Previewing does not broaden the destructive-action contract.
  assert.deepEqual(resolveSelection(ALL, new Set(['c1'])), []);
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
  // Owner call 2026-08-07: the rows were too skinny to read a drawing off, so
  // Archive adopts the Documents ledger's row geometry EXACTLY — the same 32px
  // select column and the same dedicated 54px thumbnail column. Only the three
  // trailing columns differ, because they carry different data.
  assert.match(SCREEN, /const grid = '32px 54px minmax\(150px,1fr\) 110px 124px 110px'/);
  const DOCUMENTS = read('../src/home/DocumentsLedger.jsx');
  assert.match(DOCUMENTS, /'32px 54px minmax\(150px,1fr\)/, 'the Documents ledger is the reference for the leading columns');
  assert.match(SCREEN, /contentVisibility: 'auto'/);
  // Every top-level row is PINNED to the Documents ledger's 51px, whatever it
  // carries. Letting content drive the height made templates 50px, documents
  // 51px and a shared project 54px — a mixed list only reads at a glance if the
  // rows form one even rhythm. Pinning follows the Templates editor's own
  // name-over-glyphs row (`height: 50, boxSizing: 'border-box'`).
  assert.match(SCREEN, /const ROW_HEIGHT = 51;/);
  assert.match(SCREEN, /height: ROW_HEIGHT, boxSizing: 'border-box'/);
  assert.match(SCREEN, /containIntrinsicSize: `0 \$\{ROW_HEIGHT\}px`/);
  const TEMPLATES_ROW = read('../src/home/TemplatesEditor.jsx');
  assert.match(TEMPLATES_ROW, /height: 50, boxSizing: 'border-box'/, 'the editor is the reference for pinning');
  // The name cell stretches instead of padding itself to height, so a glyph
  // strip cannot push the row taller than its neighbours.
  assert.match(SCREEN, /const ROW_PAD_Y = 16;/);
  assert.match(SCREEN, /padding: '0 14px 0 0',\s*\n\s*alignSelf: 'stretch'/);
  assert.match(SCREEN, /padding: `\$\{ROW_PAD_Y\}px 0`/);
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

test('every document in Archive renders at the one Documents-ledger thumbnail size', () => {
  // One helper, one size. Top-level rows, an expanded project's child rows and
  // the project preview tree all call it, so a document cannot end up smaller
  // in one place than another (the owner's complaint).
  // Owner call 2026-08-07: "make the thumbnails bigger without changing
  // anything else." Archive DELIBERATELY diverges from the Documents ledger's
  // 30px row thumb here — Archive is the screen where you decide whether to
  // rescue a drawing, so the page has to be readable. 44px is the largest that
  // fits the pinned 51px row with even breathing room above and below; the row
  // height, the 54px column and the name position are all unchanged.
  assert.match(SCREEN, /const ROW_THUMB = 44;/);
  assert.match(SCREEN, /const ROW_ART_W = 34;/);
  // The art must stay inside the thumbnail column and keep the page ratio.
  assert.ok(34 < 54, 'row art fits the 54px thumbnail column');
  assert.ok(Math.abs(34 - 44 * (8.5 / 11)) < 1, 'row art keeps the US-Letter ratio');
  assert.ok(44 < 51, 'row art fits inside the pinned row height');
  assert.match(
    SCREEN,
    /const rowThumb = \(id, filePath\) => \([\s\S]*?<PdfPageThumb[\s\S]*?doc=\{\{ id, file_path: filePath \}\}[\s\S]*?variant="row"[\s\S]*?height=\{ROW_THUMB\}/,
  );
  // The same stylised placeholder the Documents ledger falls back to — NOT the
  // old tiny doc icon — sized from the same two constants as the real thumb, so
  // a failed render never changes the column's footprint.
  assert.match(
    SCREEN,
    /fallback=\{<div style=\{\{ width: ROW_ART_W, height: ROW_THUMB, flex: 'none' \}\}><PdfThumb height=\{ROW_THUMB\} stamp="" \/><\/div>\}/,
  );
  // Documents keeps its own smaller row thumb; this asserts the two screens are
  // knowingly different rather than accidentally drifting.
  const DOCUMENTS = read('../src/home/DocumentsLedger.jsx');
  assert.match(DOCUMENTS, /variant="row"\s*\n\s*height=\{30\}/, 'Documents row thumb is unchanged at 30');
  assert.match(DOCUMENTS, /width: 23, height: 30, flex: 'none'/, 'Documents fallback is unchanged at 23x30');

  // Top-level rows fill the thumbnail column; a project/template has no page,
  // so it shows a PLAIN type icon in the same ROW_THUMB box — no tinted plate
  // behind it (owner call 2026-08-07: "we don't have that anywhere else in this
  // app"). The box stays so the column aligns and the row height cannot shift.
  assert.match(SCREEN, /const rowTypeArt = \(item, iconSize = TYPE_ICON_SIZE\) => \{[\s\S]*?if \(item\.type === 'document'\) return rowThumb\(item\.id, item\.filePath\);/);
  // A project/template's icon box is the SAME footprint a page thumbnail
  // occupies, so the art-to-name distance is one number regardless of row type.
  // Asserted through the shared constants rather than literals, so the two can
  // never disagree when the thumbnail size is tuned again.
  assert.match(SCREEN, /width: ROW_ART_W, height: ROW_THUMB/);
  assert.match(SCREEN, /const TYPE_ICON_SIZE = 24;/);
  assert.match(SCREEN, /const MOBILE_TYPE_ICON_SIZE = 24;/);
  // 2026-10-02: an Icon given no colour is currentColor now (Icons.jsx), so the
  // row asks for its content-type colour explicitly - still the shared one, never
  // a literal; a project's folder stays neutral as it always was.
  assert.match(SCREEN, /<Icon name=\{typeIcon\[item\.type\] \|\| 'doc'\} size=\{iconSize\} contentType=\{item\.type === 'project' \? undefined : item\.type\} \/>/);
  assert.doesNotMatch(SCREEN, /<Icon name=\{typeIcon\[item\.type\] \|\| 'doc'\}[^>]*color=/,
    'shared document/project/template colors remain authoritative');
  assert.match(SCREEN, /\{rowTypeArt\(item\)\}/);
  assert.match(SCREEN, /\{rowTypeArt\(item, MOBILE_TYPE_ICON_SIZE\)\}/);
  // No coloured plate may come back: no tint map, and no translucent
  // background anywhere in the screen's own styles.
  assert.doesNotMatch(SCREEN, /TYPE_TINT/);
  assert.doesNotMatch(SCREEN, /background: 'rgba\([\d,\s]+0\.\d+\)'/);

  // Child rows call the SAME helper — indented, never shrunk.
  assert.match(SCREEN, /\{rowThumb\(child\.id, child\.filePath\)\}/);
  // Intrinsic size must track the taller row or the skipped rows jump:
  // 8px padding + the 30px thumbnail + 8px padding.
  assert.match(SCREEN, /containIntrinsicSize: '0 46px'/);
});

test("the name sits the same distance from its icon as the Documents ledger's", () => {
  /* Owner call 2026-08-07: "the names of the elements and their icons to the
     left of them are too far ... the same distance that it is on the Documents
     page." Archive's name cell used to lead with a 12px chevron spacer plus an
     8px flex gap, pushing every title 20px further right than Documents'.
     Browser-measured before: 49.5px art-to-name vs Documents' 29.5px. After
     moving the disclosure into the otherwise-empty 32px lead column, both
     screens measure 29.5px on every row type.

     The name cell must therefore lead with the name block itself. */
  /* The chevron sits in a fixed-width slot that REPLACES the name cell's left
     padding rather than adding to it (owner call 2026-08-07: the disclosure
     belongs "just to the left of the title", but the 29.5px gap must survive).
     14px slot + 0 left padding == the Documents ledger's 14px padding, so the
     title's left edge is identical on both screens and on every row type. */
  assert.match(SCREEN, /const NAME_LEAD = 14;/);
  assert.match(SCREEN, /padding: '0 14px 0 0'/, 'no LEFT padding — the slot provides it');
  const DOCS = read('../src/home/DocumentsLedger.jsx');
  assert.match(DOCS, /padding: '12px 14px'/, 'Documents name cell pads 14px horizontally');

  const nameCell = SCREEN.match(/<div style=\{stickyCell\(active\)\}>[\s\S]*?\n          <\/div>/)[0];
  // The slot is ALWAYS rendered, so a row without a chevron keeps the same
  // title offset — no phantom indent, no ragged left edge.
  assert.match(nameCell, /\{nameLeadSlot\(isProject \? ledgerDisclosure\(item\.id, expanded\) : null\)\}/);
  assert.match(SCREEN, /const nameLeadSlot = \(content\) => \([\s\S]*?width: NAME_LEAD, flex: 'none'[\s\S]*?justifyContent: 'flex-end'/);
  // A flex gap would land between the slot and the title and undo the
  // alignment, so the cell has none; the one label that needs air asks for it.
  assert.doesNotMatch(SCREEN, /alignSelf: 'stretch',\s*\n\s*display: 'flex', alignItems: 'center', gap:/);
  assert.match(nameCell, /flex: 'none', marginLeft: 8/);

  // The lead COLUMN is the checkbox only now — which also restores expanding a
  // project while in select mode.
  assert.match(SCREEN, /\{selectMode \? checkGlyph\(checked\) : null\}/);
  assert.doesNotMatch(
    SCREEN,
    /\{selectMode \? checkGlyph\(checked\) : \(isProject \? ledgerDisclosure/,
    'the disclosure no longer shares the checkbox column',
  );
});

test('an archived project previews as an expandable tree of its documents', () => {
  // Owner ask: select a project, expand it, see the files inside WITH their
  // thumbnails.
  assert.match(SCREEN, /const projectPreviewTree = \(item\) => \{/);
  assert.match(SCREEN, /previewItem\.type === 'project' && projectPreviewTree\(previewItem\)/);
  // Leaves are the documents, each with the shared row thumbnail.
  assert.match(
    SCREEN,
    /const projectPreviewTree[\s\S]*?item\.children\.map\(\(child\) => \([\s\S]*?\{rowThumb\(child\.id, child\.filePath\)\}/,
  );
  assert.match(SCREEN, /\{chevron\(open\)\}<\/button>/);
});

test('the ledger tree and the preview tree are INDEPENDENT', () => {
  // Owner call 2026-08-07: "Right now they work in unison, and I don't know
  // why." Two separate states with OPPOSITE defaults — the ledger tracks
  // expanded ids (starts closed), the preview tracks collapsed ids (starts
  // open) — so neither toggle can reach the other.
  assert.match(SCREEN, /const \[expandedIds, setExpandedIds\] = useState\(defaultExpandedIds\)/);
  assert.match(SCREEN, /const \[previewCollapsedIds, setPreviewCollapsedIds\] = useState\(defaultPreviewCollapsedIds\)/);

  // Each tree has its own toggle, and each toggle touches only its own setter.
  const ledgerToggle = SCREEN.match(/const ledgerDisclosure = [\s\S]*?\);/)[0];
  assert.match(ledgerToggle, /setExpandedIds\(\(prev\) => toggleExpanded\(prev, id\)\)/);
  assert.doesNotMatch(ledgerToggle, /setPreviewCollapsedIds/);
  const previewToggle = SCREEN.match(/const previewDisclosure = [\s\S]*?\);/)[0];
  assert.match(previewToggle, /setPreviewCollapsedIds\(\(prev\) => togglePreviewNode\(prev, id\)\)/);
  assert.doesNotMatch(previewToggle, /setExpandedIds/);

  // Ledger rows read the ledger state; both preview trees read the preview one.
  assert.match(SCREEN, /isProject \? ledgerDisclosure\(item\.id, expanded\)/);
  assert.match(SCREEN, /const projectPreviewTree[\s\S]*?isPreviewNodeOpen\(previewCollapsedIds, nodeId\)/);
  assert.match(SCREEN, /const templatePreviewTree[\s\S]*?isPreviewNodeOpen\(previewCollapsedIds, moduleKey\)/);
  // No preview tree may read the ledger's expanded set any more.
  const previewTrees = SCREEN.match(/const projectPreviewTree = [\s\S]*?const renderRow =/)[0];
  assert.doesNotMatch(previewTrees, /isRowExpanded\(expandedIds/);
  assert.doesNotMatch(previewTrees, /setExpandedIds/);
});

test('the preview tree opens EXPANDED, the ledger stays collapsed', () => {
  // Opposite defaults, proven on the pure model rather than the markup.
  const ledger = defaultExpandedIds();
  assert.equal(ledger.size, 0);
  assert.equal(isRowExpanded(ledger, 'p1'), false, 'ledger rows start closed');

  const preview = defaultPreviewCollapsedIds();
  assert.equal(preview.size, 0);
  assert.equal(isPreviewNodeOpen(preview, 'p1:contents'), true, 'preview nodes start OPEN');
  assert.equal(isPreviewNodeOpen(preview, 'anything-at-all'), true);

  // Toggling a preview node closes it, and toggling again reopens it.
  const closed = togglePreviewNode(preview, 'p1:contents');
  assert.equal(isPreviewNodeOpen(closed, 'p1:contents'), false);
  assert.equal(isPreviewNodeOpen(togglePreviewNode(closed, 'p1:contents'), 'p1:contents'), true);
  // A sibling node is untouched.
  assert.equal(isPreviewNodeOpen(closed, 'p2:contents'), true);
  // The original set is never mutated — React sees a new reference each time.
  assert.equal(isPreviewNodeOpen(preview, 'p1:contents'), true);

  // The two states cannot collide: they are separate values with opposite
  // meanings for the same id. Closing the preview node leaves the ledger's
  // expanded set empty, and expanding the ledger row leaves the preview open.
  const ledgerOpened = toggleExpanded(ledger, 'p1');
  assert.equal(isRowExpanded(ledgerOpened, 'p1'), true);
  assert.equal(isPreviewNodeOpen(preview, 'p1:contents'), true, 'ledger expansion did not touch the preview');
  assert.equal(ledger.size, 0, 'preview toggling did not touch the ledger');
});

test('an archived template previews its modules, nested categories and entities', () => {
  // Owner ask: a deleted template must say what is IN it. Modules with their
  // categories underneath as a tree, plus the entities.
  assert.match(SCREEN, /const templatePreviewTree = \(item\) => \{/);
  assert.match(SCREEN, /previewItem\.type === 'template' && templatePreviewTree\(previewItem\)/);
  assert.match(SCREEN, /const modules = item\.modules \|\| \[\];/);
  assert.match(SCREEN, /const entities = item\.entities \|\| \[\];/);
  assert.match(SCREEN, /<div className="section-label">Modules<\/div>/);
  assert.match(SCREEN, /Entities<\/div>/);
  // Categories nest under their module behind the same rotating chevron.
  assert.match(SCREEN, /const moduleKey = `\$\{item\.id\}:\$\{mod\.id\}`;/);
  assert.match(SCREEN, /previewDisclosure\(moduleKey, open, 'categories'\)/);
  assert.match(SCREEN, /open && categories\.map\(\(cat\) => \(/);
  // The Templates editor's own 14px entity chip, not a new swatch shape.
  assert.match(SCREEN, /width: 14, height: 14, borderRadius: '50%'[\s\S]*?border: `1\.5px solid \$\{entity\.borderColor\}`/);
  const TEMPLATES = read('../src/home/TemplatesEditor.jsx');
  assert.match(TEMPLATES, /width: 14, height: 14, borderRadius: '50%'/, 'the editor is the reference swatch');
});

test("a project's child rows fill the same columns a top-level document does", () => {
  // Owner call 2026-08-07: "those are documents... under Type it should say
  // 'document'. Under Archived, when they were archived, and days remaining."
  // Blank cells read as missing data.
  const childBlock = SCREEN.match(/\{isProject && expanded && item\.children\.map\(\(child\) => \([\s\S]*?\)\)\}/)[0];
  assert.match(childBlock, /archiveTypeLabel\(child\.type\)/);
  assert.match(childBlock, /archivedDateLabel\(child\.archivedAt\)/);
  // The SAME days cell as a top-level row, so the urgency colour cannot mean
  // one thing in a parent row and another in the child right below it.
  assert.match(childBlock, /\{daysCell\(child, 8\)\}/);
  assert.match(SCREEN, /const daysCell = \(item, padY = ROW_PAD_Y\) => \([\s\S]*?item\.daysRemaining <= URGENT_DAYS \? DANGER : 'inherit'/);
  // No empty placeholder cells left over after the name cell.
  assert.doesNotMatch(childBlock, /<span \/>\s*\n\s*<span \/>\s*\n\s*<span \/>\s*\n\s*<\/div>/);
  assert.match(childBlock, /aria-label=\{`Preview \$\{child\.name\}`\}/);
  assert.match(childBlock, /onClick=\{\(\) => previewDocument\(child\.id\)\}/);
  assert.match(childBlock, /onKeyDown=\{\(e\) => \{/);
  assert.match(SCREEN, /resolveArchivePreviewItem\(rows, previewId\)/);
});

test('a template ROW shows its entities as glyphs under the name', () => {
  // Owner ask: "It has the name, and underneath is the glyph. It should show
  // that same way as a line item in the Archive section." Reproduces the
  // Templates editor's strip verbatim — 14px circles, cap 10, "+N", count.
  assert.match(SCREEN, /const SUBLINE_GLYPH = 14;/);
  assert.match(SCREEN, /const TEMPLATE_SWATCH_CAP = 10;/);
  const sub = SCREEN.match(/const rowSubline = \(item\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(sub, /if \(item\.type === 'template'\)/);
  assert.match(sub, /entities\.slice\(0, TEMPLATE_SWATCH_CAP\)\.map/);
  assert.match(sub, /width: SUBLINE_GLYPH, height: SUBLINE_GLYPH, borderRadius: '50%'/);
  assert.match(sub, /border: `1\.5px solid \$\{entity\.borderColor\}`/);
  assert.match(sub, /\+\{entities\.length - TEMPLATE_SWATCH_CAP\}/);
  // The wrapper is the hub's shared name-over-glyphs block.
  assert.match(SCREEN, /const sublineRow = \(children\) => \([\s\S]*?alignItems: 'center', gap: 6, marginTop: 3/);
  const TEMPLATES = read('../src/home/TemplatesEditor.jsx');
  assert.match(TEMPLATES, /alignItems: 'center', gap: 6, marginTop: 3/, 'the editor is the reference block');
  assert.match(TEMPLATES, /slice\(0, 10\)/, 'the editor is the reference cap');
  // The subline renders inside the name cell, under the name.
  assert.match(SCREEN, /\{item\.name\}<\/span>\s*\n\s*\{subline\}/);
});

test('"Shared with" excludes the signed-in owner, so it never means a team of one', () => {
  // Creating a project writes an `owner` row for its creator into
  // project_collaborators, and that auto-row carries no email — so every
  // archived project was drawing one avatar for the user themselves, rendered
  // as "T" for the "Teammate" fallback. Verified against the live database
  // 2026-08-07: all three projects with collaborator rows had exactly one, the
  // owner's, with email null.
  const SERVICE = read('../src/services/archiveService.js');
  assert.match(SERVICE, /async function withCollaborators\(items, viewerId = null\)/);
  assert.match(SERVICE, /if \(viewerId && row\.user_id === viewerId\) continue;/);
  assert.match(SERVICE, /withCollaborators\(items, userId\)/);
  // The screen's documented rule can now actually hold.
  assert.match(SCREEN, /if \(!team\.shown\.length\) return null;/);
});

test('a project ROW shows who it was shared with, under the name', () => {
  // Owner ask: "It should say the project, and then underneath, the people it
  // was shared with." Same AvatarStack + ordering the preview pane uses, at the
  // 14px size the Projects tree uses for this in-row treatment.
  const sub = SCREEN.match(/const rowSubline = \(item\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(sub, /if \(item\.type === 'project'\)/);
  assert.match(sub, /const team = teamAvatarSlots\(item\.collaborators\)/);
  assert.match(sub, /<AvatarStack[\s\S]*?team\.shown\.map\(collaboratorInitials\)/);
  assert.match(sub, /team\.overflow \? \[`\+\$\{team\.overflow\}`\] : \[\]/);
  assert.match(sub, /size=\{SUBLINE_GLYPH\}/);
  // Never a "team of one": no collaborators means no strip at all.
  assert.match(sub, /if \(!team\.shown\.length\) return null;/);
  const PROJECTS = read('../src/home/ProjectsFolderTree.jsx');
  assert.match(PROJECTS, /<AvatarStack\s*\n?\s*members=[\s\S]*?size=\{14\}/, 'the Projects tree is the reference size');
});

test("the disclosure uses the app's real chevron icon, not a text glyph", () => {
  /* Owner call 2026-08-07: "it should be the same chevron used throughout the
     app, not this." It rendered the literal "▾" character; src/Icons.jsx has
     had a real chevronDown SVG all along. */
  assert.match(SCREEN, /import AppIcon from '\.\.\/Icons'/);
  /* DELIBERATE ASSERTION CHANGE (2026-09-17, revision-2 palette approved by the
     owner): this line and the PDFViewer one below pinned the literal #8d96a6.
     That colour no longer exists in the app — the whole chrome now paints from
     src/styles/tokens.css and the muted-icon role is --text-3. What the
     assertion guards is unchanged: the disclosure chevron is the real icon at
     the SAME muted colour as the reference chevron in the viewer, not a text
     glyph and not a one-off colour. Only the spelling of that colour moved. */
  assert.match(
    SCREEN,
    /const chevron = \(open, size = CHEVRON_SIZE\) => \([\s\S]*?<AppIcon\s*\n\s*name="chevronDown"\s*\n\s*size=\{size\}\s*\n\s*color="var\(--text-3\)"/,
  );
  assert.match(SCREEN, /const CHEVRON_SIZE = 16;/);
  assert.match(SCREEN, /const MOBILE_CHEVRON_SIZE = 18;/);
  assert.match(
    SCREEN,
    /fontFamily: 'inherit', flex: 'none', width: CHEVRON_SIZE, marginRight: 4/,
    'desktop disclosure is larger and leaves air before the unchanged title edge',
  );
  // No literal chevron characters may survive anywhere in the screen.
  assert.doesNotMatch(SCREEN, /[▾▴▸▹►▼]/, 'no text-glyph chevrons remain');

  // Still ONE glyph that rotates, never a swapped down/right pair — that is
  // what keeps the open/close transition.
  assert.match(SCREEN, /transform: open \? 'rotate\(180deg\)' : 'none',\s*\n?\s*transition: 'transform \.12s'/);

  // The icon set really does export it, at the size/colour the hub already
  // uses for a disclosure chevron in a dense list.
  const ICONS = read('../src/Icons.jsx');
  assert.match(ICONS, /chevronDown: \(size, color, style, className\) => \(/);
  const VIEWER = read('../src/PDFViewer.jsx');
  // Same ruled change as above: the reference colour is the --text-3 token now,
  // not the #8d96a6 literal it resolved from.
  assert.match(VIEWER, /<Icon name="chevronDown" size=\{12\} color="var\(--text-3\)" \/>/, 'PDFViewer is the reference');

  // Both trees and the mobile card go through the same helper.
  assert.match(SCREEN, /const disclosureButton = \(open, onToggle, label = 'documents'\) => \([\s\S]*?\{chevron\(open\)\}<\/button>/);
  assert.match(SCREEN, /className="archive-mobile-disclosure"[\s\S]*?\{chevron\(expanded, MOBILE_CHEVRON_SIZE\)\}/);
});

test('mobile Archive matches the hub list inset and disclosure hit target', () => {
  assert.match(
    CSS,
    /\.survey-hub \.archive-body \{[\s\S]*?padding: 8px 10px 10px !important;/,
    'Archive starts 8px below the mobile header like Documents, Projects, and Templates',
  );
  assert.match(
    CSS,
    /\.survey-hub \.archive-mobile-disclosure \{[\s\S]*?width: 28px;[\s\S]*?height: 44px;[\s\S]*?place-items: center;/,
    'the larger mobile chevron keeps a 44px touch target without changing the card grid',
  );
  assert.match(
    CSS,
    /\.survey-hub \.archive-mobile-card-head > :first-child \{[\s\S]*?transform: none;/,
    'Archive centers its disclosure in the gutter instead of shifting it like a drag handle',
  );
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
  // 2026-10-04: the one app-wide initials rule (presenceIdentity.js, owner
  // 2026-10-02). A one-word name keeps its first two letters and an email
  // gives the first and last name part, as the account avatar and the
  // viewer's presence row already did.
  assert.equal(collaboratorInitials({ name: 'cher' }), 'CH');
  assert.equal(collaboratorInitials({ email: 'dana.smith@example.com' }), 'DS');
  assert.equal(collaboratorInitials({}), '—');
  assert.equal(collaboratorInitials(null), '—');
});

test('the header is built on the Documents / Projects structure', () => {
  /* Owner call 2026-08-07: "this should be formatted a little bit more similar
     to the Projects and Documents where I'm able to search." Both of those put
     the count and Select in the SUBTITLE, and a mobile search row plus a
     desktop Search in the actions slot. The bespoke chip row is gone. */
  const DOCS = read('../src/home/DocumentsLedger.jsx');
  const PROJECTS = read('../src/home/ProjectsFolderTree.jsx');

  // Count + Select in the subtitle, as on both reference screens.
  assert.match(SCREEN, /const subtitle = \([\s\S]*?<b>\{rows\.length\}<\/b>[\s\S]*?\{selectMode \? 'Done' : 'Select'\}/);
  assert.match(DOCS, /const subtitle = \([\s\S]*?<b>\{docs\.length\}<\/b> files/);

  // Mobile search row + desktop search in the actions slot.
  assert.match(SCREEN, /<div className="archive-mobile-search-row" ref=\{menuRef\}>/);
  assert.match(SCREEN, /<div className="archive-desktop-search" ref=\{desktopMenuRef\}>/);
  assert.match(DOCS, /<div className="documents-mobile-search-actions hub-mobile-search-actions"/);
  assert.match(DOCS, /<div className="documents-desktop-search">/);
  assert.match(PROJECTS, /<div className="projects-desktop-search">/);

  // The old segmented chip row is gone from markup AND stylesheet.
  assert.doesNotMatch(SCREEN, /archive-filter-row/);
  assert.doesNotMatch(CSS, /\.archive-filter-row/);

  // Search is a real Search field wired to the row list.
  assert.match(SCREEN, /<Search placeholder="Search archive\.\.\." value=\{search\} onChange=\{setSearch\} width=\{width\} \/>/);
  assert.match(SCREEN, /visibleArchiveItems\(items, \{ filter, sortKey, sortDir, search \}\)/);
  assert.match(SCREEN, /\[items, filter, sortKey, sortDir, search\]/, 'search is in the memo deps');
  // Empty-result copy names the reason, mirroring Documents' wording.
  assert.match(SCREEN, /'No archived items match your search\.'/);
  assert.match(DOCS, /No documents match your search\./);

  // The filter button reuses the hub's filter icon + active-sort label pattern.
  assert.match(SCREEN, /<Icon name="filter" size=\{12\} \/>\s*\n\s*<span>\{activeSortLabel\}<\/span>/);
  assert.match(DOCS, /<Icon name="filter" size=\{12\} \/>\s*\n\s*<span>\{activeSortLabel\}<\/span>/);
  // Type filtering survives, folded into that one menu rather than a chip row.
  assert.match(SCREEN, /const filterMenu = \([\s\S]*?ARCHIVE_FILTERS\.map[\s\S]*?ARCHIVE_SORT_OPTIONS\.map/);
  // The menu is styled at base scope, because Archive renders it on desktop too.
  assert.match(CSS, /^\.survey-hub \.archive-sort-menu \{/m);
});

test("expanded project children carry a page thumbnail on mobile too", () => {
  /* Owner's 2026-08-07 screenshot: an expanded project on mobile listed bare
     names with no art, so nothing said WHICH drawings travel with it. */
  const mobileChildren = SCREEN.match(/<div className="archive-mobile-children">[\s\S]*?\n          <\/div>/)[0];
  assert.match(mobileChildren, /\{rowThumb\(child\.id, child\.filePath\)\}/);
  assert.match(mobileChildren, /<span className="archive-mobile-child-name">\{child\.name\}<\/span>/);
  // The same ROW_THUMB every other document in Archive uses — a document does
  // not change size because the viewport did.
  assert.match(SCREEN, /const rowThumb = \(id, filePath\) => \([\s\S]*?height=\{ROW_THUMB\}/);
  // The child row must lay its thumbnail and name out, not stack them.
  assert.match(CSS, /\.survey-hub \.archive-mobile-child \{[^}]*display: flex/);
  assert.match(CSS, /\.survey-hub \.archive-mobile-child-name \{[^}]*text-overflow: ellipsis/);
});

test('the mobile card head ALWAYS renders three children, matching its three columns', () => {
  /* The bug the owner photographed: .archive-mobile-card-head declares three
     grid columns, but the lead cell was rendered with `{selectMode && ...}` and
     the trailing cell with `{isProject && ...}`. Outside select mode the name
     block became the FIRST child and landed in the 28px lead track — it wrapped
     one word per line and the rest of the card sat empty. Measured 148px tall
     against the Documents card's 76px.

     Conditional content must live INSIDE a cell, never in place of one. */
  const head = SCREEN.match(/<div className="archive-mobile-card-head">[\s\S]*?\n        <\/div>/)[0];
  const cells = head.match(/^\s{10}<div /gm) || [];
  assert.equal(cells.length, 3, 'exactly three unconditional cell divs');
  // No cell may be gated by a `X && (` guard at the cell level.
  assert.doesNotMatch(head, /^\s{10}\{(selectMode|isProject) &&/m);
  // The lead cell swaps its CONTENTS by mode instead.
  assert.match(head, /\{selectMode \? checkGlyph\(checked\) : \(isProject \? \(/);
  // The trailing cell carries the same type art, with the established mobile
  // icon size rather than inheriting the larger desktop ledger glyph.
  assert.match(head, /\{rowTypeArt\(item, MOBILE_TYPE_ICON_SIZE\)\}/);

  // Geometry copied from .mobile-doc-card, not invented.
  assert.match(CSS, /\.survey-hub \.archive-mobile-card-head \{[^}]*grid-template-columns: 28px minmax\(0, 1fr\) 52px/);
  assert.match(CSS, /\.survey-hub \.mobile-doc-card,[\s\S]*?grid-template-columns: 28px minmax\(0, 1fr\) 52px/);
});

test('the dev build stamp is logged to the console, never rendered on screen', () => {
  /* Owner call 2026-08-07: "get rid of the build indicator at the very
     bottom... any time I want to know what build I'm in, I should be able to
     just see my console logs. When I'm in mobile mode, this build ends up being
     this massive left rail thing that's super ugly."

     The information still matters — a stale tab served by a dead dev server
     once burned a whole bug hunt — so it moves to the console rather than
     disappearing. */
  const APP_SHELL = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(APP_SHELL, /console\.info\(`\[build\] \$\{__BUILD_STAMP__\}`\)/);
  assert.match(APP_SHELL, /if \(import\.meta\.env\.DEV && typeof __BUILD_STAMP__ !== 'undefined' && __BUILD_STAMP__\) \{/);
  // Nothing may render it any more. `${__BUILD_STAMP__}` inside the console
  // template literal is fine; a JSX child on its own line is what was removed.
  assert.doesNotMatch(APP_SHELL, /^\s*\{__BUILD_STAMP__\}\s*$/m, 'the stamp is never rendered as JSX');
  assert.doesNotMatch(APP_SHELL, /position: 'fixed',\s*\n\s*left: '6px',\s*\n\s*bottom: '6px'/, 'the fixed corner chip is gone');
  // The only surviving reads are the dev guard and the log itself.
  assert.equal((APP_SHELL.match(/__BUILD_STAMP__/g) || []).length, 4, 'comment + guard x2 + log');
  // The vite define stays, because the console log reads it.
  const VITE = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(VITE, /__BUILD_STAMP__: JSON\.stringify\(buildStamp\)/);
});

test('the mobile card list is hidden on desktop and shown under 720px', () => {
  assert.match(SCREEN, /className="archive-mobile-list slim-scroll"/);
  assert.match(SCREEN, /className="card archive-desktop-card"/);
  assert.match(CSS, /\.survey-hub \.archive-mobile-list \{\s*\n\s*display: none;/);
  assert.match(CSS, /@media screen and \(max-width: 720px\)[\s\S]*?\.survey-hub \.archive-desktop-card \{[\s\S]*?display: none !important/);
  assert.match(CSS, /@media screen and \(max-width: 720px\)[\s\S]*?\.survey-hub \.archive-mobile-list \{[\s\S]*?display: flex/);
});

test('Archive transient controls follow the shared home interaction contract', () => {
  assert.match(SCREEN, /import DismissBarrier from '\.\.\/components\/DismissBarrier';/);
  assert.match(SCREEN, /<DismissBarrier[\s\S]*?active=\{menuOpen\}[\s\S]*?insideRefs=\{\[menuRef, desktopMenuRef\]\}[\s\S]*?onDismiss=\{\(\) => setMenuOpen\(false\)\}/);
  assert.match(SCREEN, /title="Close preview"[\s\S]*?<Icon name="close" size=\{14\} \/>/);
  assert.doesNotMatch(SCREEN, /title="Close preview"[^>]*>×<\/button>/,
    'preview close uses the shared drawn icon, not a font glyph');
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
});

test('on MOBILE, Archive leaves navigation and lives behind the profile avatar', () => {
  // Owner call 2026-08-07: "in mobile, when the user clicks on their icon in
  // the top right corner, that's where they'll be able to see their archives."
  // `navItems` feeds BOTH mobile modes — the ?mobileNav=tabs bottom bar and the
  // ?mobileNav=rail drawer — so dropping Archive here removes it from both.
  assert.match(HUB_SHELL, /const navItems = primaryNavItems;/);
  assert.doesNotMatch(
    HUB_SHELL.match(/const navItems = [\s\S]*?;/)?.[0] || '',
    /archiveNavItem/,
    'Archive must not appear in either mobile navigation mode',
  );
  assert.match(HUB_SHELL, /<MobileRailNav[^>]*navItems=\{navItems\}/);
  assert.match(HUB_SHELL, /<nav className="mobile-home-tabs"[\s\S]*?\{navItems\.map/);

  // The profile menu carries it, and ONLY on the mobile instance — desktop
  // already has it pinned in the rail, so offering it twice there is noise.
  assert.match(HUB_SHELL, /const ProfileMenu = \(\{ userName, userMeta, showArchive = false, tab, onNav \}\)/);
  assert.match(HUB_SHELL, /\{showArchive && \([\s\S]*?onNav && onNav\('archive'\)[\s\S]*?Archive\s*\n?\s*<\/button>/);
  assert.match(HUB_SHELL, /<div className="mobile-profile">\s*\n\s*<ProfileMenu userName=\{userName\} userMeta=\{userMeta\} showArchive tab=\{tab\} onNav=\{onNav\} \/>/);
  // The desktop rail instance must NOT pass showArchive.
  assert.match(HUB_SHELL, /<\/nav>\s*\n\s*<ProfileMenu userName=\{userName\} userMeta=\{userMeta\} \/>/);
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
  assert.equal(filters.length, 5, 'owned documents, collaborator documents, owned projects, collaborator projects, templates');
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
