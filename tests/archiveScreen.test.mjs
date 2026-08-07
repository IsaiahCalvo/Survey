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
  assert.match(SCREEN, /padding: '0 14px',\s*\n\s*alignSelf: 'stretch'/);
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
  assert.match(SCREEN, /const ROW_THUMB = 30;/);
  assert.match(
    SCREEN,
    /const rowThumb = \(id, filePath\) => \([\s\S]*?<PdfPageThumb[\s\S]*?doc=\{\{ id, file_path: filePath \}\}[\s\S]*?variant="row"[\s\S]*?height=\{ROW_THUMB\}/,
  );
  // The same stylised placeholder the Documents ledger falls back to, at the
  // same 23x30 footprint — NOT the old tiny doc icon.
  assert.match(
    SCREEN,
    /fallback=\{<div style=\{\{ width: 23, height: ROW_THUMB, flex: 'none' \}\}><PdfThumb height=\{ROW_THUMB\} stamp="" \/><\/div>\}/,
  );
  const DOCUMENTS = read('../src/home/DocumentsLedger.jsx');
  assert.match(DOCUMENTS, /variant="row"\s*\n\s*height=\{30\}/, 'Documents is the reference height');
  assert.match(DOCUMENTS, /width: 23, height: 30, flex: 'none'/, 'Documents is the reference fallback');

  // Top-level rows fill the thumbnail column; a project/template has no page,
  // so it shows a PLAIN type icon in the same ROW_THUMB box — no tinted plate
  // behind it (owner call 2026-08-07: "we don't have that anywhere else in this
  // app"). The box stays so the column aligns and the row height cannot shift.
  assert.match(SCREEN, /const rowTypeArt = \(item\) => \{[\s\S]*?if \(item\.type === 'document'\) return rowThumb\(item\.id, item\.filePath\);/);
  assert.match(SCREEN, /width: ROW_THUMB, height: ROW_THUMB/);
  assert.match(SCREEN, /<Icon name=\{typeIcon\[item\.type\] \|\| 'doc'\} size=\{TYPE_ICON_SIZE\} color="var\(--ink-200\)" \/>/);
  assert.match(SCREEN, /\{rowTypeArt\(item\)\}/);
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

test('the rotating chevron is the one disclosure glyph, matching the Templates editor', () => {
  // Never a swapped ▾/▸ pair — one glyph that rotates.
  assert.match(
    SCREEN,
    /const chevron = \(open\) => \([\s\S]*?color: '#8d96a6', fontSize: 10[\s\S]*?transform: open \? 'rotate\(180deg\)' : 'none', transition: 'transform \.12s'/,
  );
  const TEMPLATES = read('../src/home/TemplatesEditor.jsx');
  assert.match(TEMPLATES, /transform: open \? 'rotate\(180deg\)' : 'none', transition: 'transform \.12s'/);
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
