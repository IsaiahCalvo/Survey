/* Survey Hub — Archive tab (KAL-430).

   The recovery screen for everything a user archived in the last 30 days:
   documents, projects (with their documents shown beneath them) and
   templates. Two actions only — Restore and Delete forever. No Copy, no
   Move, no Share: an archived row is parked, not in play.

   Structure mirrors DocumentsLedger element for element (one shared grid
   template for the header and the rows, sticky name cell, 14x14 gold check
   glyphs, a desktop ledger plus a mobile card list) so the two screens feel
   like the same product.

   This component is presentational: items and callbacks come in as props and
   every decision it makes lives in ./archiveScreenModel so it can be tested
   without a DOM.
*/
import { useCallback, useMemo, useRef, useState } from 'react';
import { HubShell, Icon, EmptyState, PdfThumb, AvatarStack, Search } from './HubShell';
/* The app-wide icon set. Aliased because HubShell exports its own `Icon` for
   the hub's type glyphs; this one carries the shared chevrons. */
import AppIcon from '../Icons';
import { ConfirmModal } from './BulkModals';
import DismissBarrier from '../components/DismissBarrier';
import PdfPageThumb from './PdfPageThumb';
import { useStorage } from '../hooks/useDatabase';
import { showToast } from '../utils/toast';
import { DELETE_FOREVER_COPY } from '../services/archiveContract';
import {
  ARCHIVE_FILTERS,
  DEFAULT_ARCHIVE_SORT,
  ARCHIVE_SORT_OPTIONS,
  archiveTypeLabel,
  archivedDateLabel,
  matchedOnChildOnly,
  namedSortFor,
  buildBulkFailureMessage,
  buildBulkOutcomeMessage,
  collaboratorInitials,
  daysRemainingLabel,
  defaultExpandedIds,
  defaultPreviewCollapsedIds,
  fileSizeLabel,
  isAllSelected,
  isPreviewNodeOpen,
  isRowExpanded,
  nextSelectAll,
  nextSortState,
  normalizeBulkResult,
  pruneSelection,
  resolveArchivePreviewItem,
  resolveSelection,
  teamAvatarSlots,
  timeRemainingLabel,
  toggleExpanded,
  togglePreviewNode,
  toggleSelection,
  visibleArchiveItems,
} from './archiveScreenModel';

const ledgerHeader = {
  background: 'var(--ink-700)',
  borderBottom: '1px solid var(--ink-500)',
  borderTop: 0,
  fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--ink-200)', fontWeight: 700,
  padding: '8px 0',
};

/* One template, used by the header and every row so the columns cannot drift:
   [checkbox] [thumbnail] [Name] [Type] [Archived] [Days remaining]. The 32px
   leading column and the 54px thumbnail column match the Documents ledger's
   exactly, so an Archive row is the same height and the same shape as the
   Documents row it came from — the owner asked for rows he can actually read
   the drawing off, not a skinnier variant. */
const grid = '32px 54px minmax(150px,1fr) 110px 124px 110px';

/* Row thumbnail height, shared by the ledger rows, an expanded project's child
   rows and the project preview tree. One number, so a document is the same
   size wherever it appears in Archive.

   Owner call 2026-08-07: "make the thumbnails bigger without changing anything
   else." 44px is the largest a page can be inside the pinned 51px row and still
   keep an even 3.5px above and below — so the drawing is readable at a glance
   while the row rhythm, the 54px column and the name position all stay put. */
const ROW_THUMB = 44;

/* Width of a row's art, kept at the US-Letter ratio so a page is never
   distorted: 44px tall x 8.5/11 = 34px. Still inside the 54px thumbnail column
   (10px of breathing room each side). Projects and templates reserve the same
   box so the column stays aligned across every row type. */
const ROW_ART_W = 34;

/* Desktop Archive disclosure size. It stays smaller than the mobile control,
   but must remain legible beside the full-size ledger typography. */
const CHEVRON_SIZE = 16;
/* Mobile cards use the same disclosure size as the hub's other expandable
   mobile rows; the denser desktop ledger keeps the 16px glyph above. */
const MOBILE_CHEVRON_SIZE = 18;

/* The name cell's leading slot, which holds a project's disclosure chevron.
   It is exactly the Documents ledger's name-cell left padding (14px), and it
   REPLACES that padding rather than adding to it. That is what lets the
   chevron sit between the icon column and the title — hugging the title, per
   the owner's 2026-08-07 call — without moving the title: every row's name
   still starts 14px past the thumbnail column, so the art-to-name distance
   stays the 29.5px that matches Documents. Rows with no chevron keep the same
   empty slot, so nothing gains a phantom indent and the names stay aligned. */
const NAME_LEAD = 14;

/* Every top-level row is pinned to this height, whatever it carries — a plain
   name, a name over entity chips, or a name over shared-with avatars. The
   Documents ledger measures 51px, and a mixed list only reads "at a glance" if
   the rows form one even rhythm; letting content drive the height made
   templates 50px, documents 51px and a shared project 54px. Pinning it is the
   Templates editor's own approach for its name-over-glyphs row
   (TemplatesEditor.jsx ~1618: `height: 50, boxSizing: 'border-box'`). */
const ROW_HEIGHT = 51;

/* Rows near the end of the retention window are tinted danger so the user
   spots what is about to be purged without reading every date. Three days is
   the point where "I'll get to it later" stops being safe. */
const URGENT_DAYS = 3;

/* The app's one destructive red (KAL-72, docs/ui/colors.md). Archive uses it
   for "Delete forever" and to tint rows inside the final days of the retention
   window, so it has to be the same red the rest of the app warns with. */
const DANGER = 'var(--danger-text)';

const typeIcon = { document: 'doc', project: 'folder', template: 'template' };

/* A project and a template have no page to render, so they show a PLAIN type
   icon in the thumbnail column — no tinted tile behind it (owner call
   2026-08-07: "we don't have that anywhere else in this app"). Nothing on the
   hub's desktop surfaces puts a coloured plate behind an icon, so neither does
   this. Both layouts use 24px to balance against the 44px document thumbnail
   without pretending the type glyph is itself a page preview. */
const TYPE_ICON_SIZE = 24;
const MOBILE_TYPE_ICON_SIZE = 24;

export default function ArchiveScreen({
  items = [],
  loading = false,
  error = null,
  onRestore,
  onDeleteForever,
  onNav,
  user,
  templatesLocked = false,
}) {
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState(DEFAULT_ARCHIVE_SORT.sortKey);
  const [sortDir, setSortDir] = useState(DEFAULT_ARCHIVE_SORT.sortDir);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  /* Selection is OFF until the user asks for it, exactly like the Documents
     ledger: clicking a row previews it, and only "Select" turns rows into
     checkboxes. Archive holds things you are deciding about — making every row
     a live checkbox invites an accidental "Delete forever". */
  const [selectMode, setSelectMode] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  /* Expanded — not collapsed — ids, so project groups render CLOSED by default
     and whatever the user opens stays open across sorts and filter changes. */
  const [expandedIds, setExpandedIds] = useState(defaultExpandedIds);
  /* The preview tree's OWN state, deliberately not the one above (owner call
     2026-08-07). Collapsed-ids semantics, so the pane opens already expanded:
     selecting a thing to look inside it should not need a second click. */
  const [previewCollapsedIds, setPreviewCollapsedIds] = useState(defaultPreviewCollapsedIds);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Name search, matching the Documents ledger's. */
  const [search, setSearch] = useState('');
  /* The one filter/sort menu, shared by the mobile and desktop header slots. */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const desktopMenuRef = useRef(null);

  const rows = useMemo(
    () => visibleArchiveItems(items, { filter, sortKey, sortDir, search }),
    [items, filter, sortKey, sortDir, search],
  );

  const onHeaderClick = (key) => {
    const next = nextSortState({ sortKey, sortDir }, key);
    setSortKey(next.sortKey);
    setSortDir(next.sortDir);
  };
  const arrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  const headerCell = (key, label, extra = {}) => (
    <span
      onClick={() => onHeaderClick(key)}
      style={{
        cursor: 'pointer', userSelect: 'none',
        color: sortKey === key ? 'var(--bone-100)' : 'inherit',
        ...extra,
      }}
    >{label}{arrow(key)}</span>
  );

  const { downloadDocument } = useStorage();

  /* The previewed row, resolved against what is actually on screen: a row that
     was just restored, or filtered out, must not keep a stale pane open. A
     project's child document may be previewed even though it remains excluded
     from restore/delete selection. */
  const previewItem = useMemo(
    () => resolveArchivePreviewItem(rows, previewId),
    [rows, previewId],
  );
  const showPreview = previewOpen && !selectMode && Boolean(previewItem);

  /* Avatar slots for the previewed item — owners, then editors, then viewers,
     with the last slot turning into "+N" when more people exist than fit. */
  const previewTeam = useMemo(
    () => teamAvatarSlots(previewItem?.collaborators),
    [previewItem],
  );

  const selectedItems = useMemo(() => resolveSelection(rows, selectedIds), [rows, selectedIds]);
  const selectedCount = selectedItems.length;
  const allSelected = isAllSelected(selectedIds, rows);

  const toggleRow = (id) => setSelectedIds((prev) => toggleSelection(prev, id));

  const previewDocument = (id) => {
    if (selectMode) return;
    setPreviewId(id);
    setPreviewOpen(true);
  };

  /* Run a bulk action and report per-item truth. A resolved
     { succeeded, failed } produces the split message; a plain resolve counts
     as full success; a rejection counts as a full failure. Either way the
     selection is pruned to whatever still exists afterwards. */
  const runBulk = useCallback(async (action, handler) => {
    const batch = resolveSelection(rows, selectedIds);
    if (!batch.length || !handler) return;
    setBusy(true);
    try {
      const result = await handler(batch);
      const outcome = buildBulkOutcomeMessage(action, normalizeBulkResult(result, batch));
      if (outcome) showToast(outcome.message, outcome.type);
    } catch (_e) {
      const outcome = buildBulkFailureMessage(action, batch);
      if (outcome) showToast(outcome.message, outcome.type);
    } finally {
      setBusy(false);
      setSelectedIds((prev) => pruneSelection(prev, items));
    }
  }, [rows, selectedIds, items]);

  const doRestore = () => runBulk('restore', onRestore);
  const doDeleteForever = () => runBulk('delete', onDeleteForever);

  const actionsDisabled = busy || selectedCount === 0;

  /* Bulk actions live in the header subtitle, exactly like Documents, so the
     ledger itself stays a pure list — and, like Documents, they only appear
     once the user has turned selection on. */
  /* The classes are the shared phone-header ones (see hub.css): on a phone the
     count sits on the title's baseline in row 1, Select sits at the right end of
     that row beside the avatar, and the bulk actions take over row 2. Archive
     used to be the one screen that shared this header without sharing its
     layout, so its count and buttons ran off the end of the title line. */
  const subtitle = (
    <span className="archive-mobile-summary" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
      <span className="archive-mobile-count"><b>{rows.length}</b> {rows.length === 1 ? 'item' : 'items'}</span>
      <span className="archive-mobile-select-row mobile-header-select-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={() => {
            const next = !selectMode;
            setSelectMode(next);
            if (!next) setSelectedIds(new Set());
          }}
          className="mobile-header-select-button hub-btn hub-btn--tertiary"
        >{selectMode ? 'Done' : 'Select'}</button>
        {selectMode && (
          <span className="mobile-header-select-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
            <button
              onClick={() => setSelectedIds((prev) => nextSelectAll(prev, rows))}
              className="hub-btn"
            >{allSelected ? 'None' : 'All'}</button>
            <button
              disabled={actionsDisabled}
              onClick={doRestore}
              className="hub-btn"
            >Restore</button>
            <button
              disabled={actionsDisabled}
              onClick={() => setConfirmDelete(true)}
              className="hub-btn is-danger"
            >Delete forever</button>
          </span>
        )}
      </span>
    </span>
  );

  /* ----------------------------------------------------------------------
     Header — rebuilt on the Documents / Projects structure (owner call
     2026-08-07: "this should be formatted a little bit more similar to the
     Projects and Documents where I'm able to search").

     Both of those screens build the same thing: the count and the Select
     button live in the SUBTITLE, and the actions slot holds a mobile search
     row (a filter menu plus a full-width Search) and a desktop Search. Archive
     now does exactly that, so its bespoke chip row is gone.

     One deliberate difference: the menu renders on desktop too. On Documents
     the menu is mobile-only because its desktop equivalent is clicking a column
     header — and Archive has those. But no column header can express "show me
     only templates", and Archive is the one screen with a mixed list, so
     removing the menu on desktop would delete a capability rather than move it.
     Same control, same markup, rendered in both slots.
     ---------------------------------------------------------------------- */
  const activeSortLabel = ARCHIVE_SORT_OPTIONS.find(({ key }) => key === sortKey)?.label
    || namedSortFor(sortKey, sortDir)?.label
    || 'Sort';

  const filterMenu = (
    <div className="archive-sort-menu" role="menu">
      {/* Type — Archive's own axis. Kept inside the one menu rather than a
          separate chip row so the actions slot holds what the other screens
          hold: a search field. */}
      <div className="archive-sort-menu-label" role="presentation">Show</div>
      {ARCHIVE_FILTERS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="menuitemradio"
          aria-checked={filter === key}
          className={filter === key ? 'active' : ''}
          onClick={() => { setFilter(key); setMenuOpen(false); }}
        >
          <span>{label}</span>
          <span>{filter === key ? <AppIcon name="check" size={12} /> : null}</span>
        </button>
      ))}
      <div className="archive-sort-menu-label" role="presentation">Sort by</div>
      {ARCHIVE_SORT_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="menuitemradio"
          aria-checked={sortKey === key}
          className={sortKey === key ? 'active' : ''}
          onClick={() => { onHeaderClick(key); }}
        >
          <span>{label}</span>
          <span>{sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
        </button>
      ))}
    </div>
  );

  const filterButton = (
    <button
      className="btn archive-filter-button"
      type="button"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={() => setMenuOpen((open) => !open)}
    >
      <Icon name="filter" size={12} />
      <span>{activeSortLabel}</span>
    </button>
  );

  const searchField = (width) => (
    <Search placeholder="Search archive..." value={search} onChange={setSearch} width={width} />
  );

  const headerActions = (
    <>
      {/* Mobile: filter menu + full-width search, exactly the
          .documents-mobile-search-row arrangement. */}
      <div className="archive-mobile-search-row" ref={menuRef}>
        {filterButton}
        {menuOpen && filterMenu}
        {searchField('100%')}
      </div>
      {/* Desktop: the same two controls, at their natural widths. */}
      <div className="archive-desktop-search" ref={desktopMenuRef}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          {filterButton}
          {menuOpen && filterMenu}
        </span>
        {searchField(240)}
      </div>
    </>
  );

  /* UX 2026-09-22: the resting edge is --border, not --ink-300. --ink-300 is
     --text-disabled, which fails contrast deliberately (2.54:1 on this card), so
     an empty box looked switched off instead of empty. --border is 3.60:1 and is
     the token for a hairline that has to be seen. 1.4px width unchanged. */
  const checkGlyph = (checked) => (
    <span style={{
      width: 14, height: 14,
      border: `1.4px solid ${checked ? 'var(--gold)' : 'var(--border-strong)'}`,
      background: checked ? 'var(--gold)' : 'transparent',
      borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && <AppIcon name="check" size={10} color="var(--accent-text)" />}
    </span>
  );

  /* Vertical padding on the row's text cells. The Documents ledger's rows come
     out at 51px because its "Last edited" cell stacks a time over a date;
     Archive's columns are all single-line, so the same 51px is bought with
     padding instead. The owner asked for rows exactly the size of the
     Documents tab's — a 30px thumbnail in a row that hugs it reads as a
     different, tighter list. */
  const ROW_PAD_Y = 16;

  const stickyCell = (selected) => ({
    position: 'sticky', left: 0, zIndex: 2,
    background: selected ? 'var(--ink-600)' : 'var(--ink-700)',
    /* No vertical padding: ROW_HEIGHT governs, and `alignSelf: stretch` makes
       the cell's background fill the row while its own flex centring handles
       the content. Padding here would fight the pinned height, and a row whose
       name cell carries a glyph strip would end up taller than its neighbours —
       which is exactly what happened when this was padding-driven (templates
       came out 50px, a project with avatars 54px, documents 51px). */
    /* No LEFT padding: the 14px NAME_LEAD slot provides it, and holds the
       disclosure chevron inside that same 14px. Padding plus a slot would push
       the title 14px further right than the Documents ledger's. No flex `gap`
       either — it would land between the slot and the title and undo the
       alignment; the one place that needs spacing (the "N documents" label)
       asks for it explicitly. */
    padding: '0 14px 0 0',
    alignSelf: 'stretch',
    display: 'flex', alignItems: 'center',
    minWidth: 0,
  });

  /* One days-remaining cell for top-level rows AND a project's child rows, so
     the urgency colour cannot mean one thing in one place and another below it.
     Only the vertical padding differs, because child rows sit tighter. */
  const daysCell = (item, padY = ROW_PAD_Y) => (
    <span
      className="mono"
      style={{
        fontSize: 11, padding: `${padY}px 0`,
        color: item.daysRemaining <= URGENT_DAYS ? DANGER : 'inherit',
      }}
    >{daysRemainingLabel(item.daysRemaining)}</span>
  );

  /* The app's real chevron from src/Icons.jsx — an SVG, not the literal
     down-triangle CHARACTER this used to render (owner call 2026-08-07: "it
     should be the same chevron used throughout the app, not this"). The test
     forbids any text-glyph chevron in this file, so do not reintroduce one even
     in a comment.

     Still ONE glyph that rotates rather than a swapped down/right pair, so the
     open/close transition survives the swap. */
  const chevron = (open, size = CHEVRON_SIZE) => (
    <AppIcon
      name="chevronDown"
      size={size}
      color="var(--text-3)"
      style={{
        display: 'block', flex: 'none',
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform .12s',
      }}
    />
  );

  /* One disclosure BUTTON shared by both trees — same glyph, same hit area —
     but each caller passes its own toggle, because the ledger tree and the
     preview tree are independent (see archiveScreenModel). Sharing the control
     is a look; sharing the state was the bug. */
  const disclosureButton = (open, onToggle, label = 'documents') => (
    <button
      type="button"
      title={open ? `Hide ${label}` : `Show ${label}`}
      aria-expanded={open}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        background: 'transparent', border: 0, color: 'var(--ink-200)',
        cursor: 'pointer', padding: 0, lineHeight: 1,
        fontFamily: 'inherit', flex: 'none', width: CHEVRON_SIZE, marginRight: 4,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{chevron(open)}</button>
  );

  /* The name cell's leading slot. Always rendered at the same width so the
     title's left edge never moves. The wider chevron overhangs toward the icon
     while its right margin leaves 4px of breathing room before the title. */
  const nameLeadSlot = (content) => (
    <span style={{
      width: NAME_LEAD, flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
    }}>{content}</span>
  );

  /* The ledger's own toggle — touches expandedIds and nothing else. */
  const ledgerDisclosure = (id, open) => disclosureButton(
    open,
    () => setExpandedIds((prev) => toggleExpanded(prev, id)),
  );

  /* The preview's own toggle — touches previewCollapsedIds and nothing else. */
  const previewDisclosure = (id, open, label) => disclosureButton(
    open,
    () => setPreviewCollapsedIds((prev) => togglePreviewNode(prev, id)),
    label,
  );

  /* A document's real first page, at the one row size. Identical to the
     Documents ledger's row thumbnail — same variant, same height, same
     stylised placeholder when the page cannot be rendered — because the user
     is choosing between drawings and a name alone does not tell you which one
     is about to be destroyed. */
  const rowThumb = (id, filePath) => (
    <PdfPageThumb
      doc={{ id, file_path: filePath }}
      downloadDocument={downloadDocument}
      variant="row"
      height={ROW_THUMB}
      fallback={<div style={{ width: ROW_ART_W, height: ROW_THUMB, flex: 'none' }}><PdfThumb height={ROW_THUMB} stamp="" /></div>}
    />
  );

  /* ----------------------------------------------------------------------
     Row subline — the glyph strip under a row's name.

     Owner goal 2026-08-07: "at a glance ... they can see exactly what they're
     looking at ... we're mixing documents, projects and templates." A name and
     a type word do not distinguish two templates from each other, so a row
     carries the same identifying marks the screen that OWNS that object shows:

       template — its entity colour chips, exactly as the Templates editor
                  draws them beside a template (TemplatesEditor.jsx ~1630).
       project  — who it is shared with, exactly as the Projects tree draws a
                  project's team (ProjectsFolderTree.jsx ~912).

     Both of those are already one shared pattern in the hub: a 12.5px/600 name
     over a 14px glyph strip at marginTop 3, gap 6, with a count in `mono meta`
     at 9.5. Reproduced here verbatim — including the 14px glyph size, which is
     the size the hub uses for this in-row treatment everywhere (the 22px
     avatars are the preview-pane size, not the row size).
     ---------------------------------------------------------------------- */
  const SUBLINE_GLYPH = 14;
  const sublineRow = (children) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>{children}</div>
  );

  /* Up to 10 entity swatches fit before the row gets crowded; any beyond that
     collapse into a "+N" overflow pill. Same cap and same pill the Templates
     editor uses. */
  const TEMPLATE_SWATCH_CAP = 10;

  const rowSubline = (item) => {
    if (item.type === 'template') {
      const entities = item.entities || [];
      if (!entities.length) return null;
      return sublineRow(
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {entities.slice(0, TEMPLATE_SWATCH_CAP).map((entity) => (
              <span
                key={entity.id}
                title={entity.name}
                style={{
                  width: SUBLINE_GLYPH, height: SUBLINE_GLYPH, borderRadius: '50%', flex: 'none',
                  background: entity.color, border: `1.5px solid ${entity.borderColor}`,
                }}
              />
            ))}
            {entities.length > TEMPLATE_SWATCH_CAP && (
              <span className="mono meta" style={{ fontSize: 9.5 }}>+{entities.length - TEMPLATE_SWATCH_CAP}</span>
            )}
          </div>
          <span className="mono meta" style={{ fontSize: 9.5 }}>{entities.length}</span>
        </>,
      );
    }
    if (item.type === 'project') {
      /* Only when the project really was shared. Archive never invents a
         "team of one" out of the owner — everything here is theirs by
         definition, so an owner-only glyph would say nothing. */
      const team = teamAvatarSlots(item.collaborators);
      if (!team.shown.length) return null;
      return sublineRow(
        <>
          <AvatarStack
            members={[
              ...team.shown.map(collaboratorInitials),
              ...(team.overflow ? [`+${team.overflow}`] : []),
            ]}
            size={SUBLINE_GLYPH}
          />
          <span className="mono meta" style={{ fontSize: 9.5 }}>{(item.collaborators || []).length}</span>
        </>,
      );
    }
    return null;
  };

  /* What fills a top-level row's thumbnail column: a page for a document, a
     plain type icon for a project or a template. The icon still occupies the
     same ROW_THUMB box so the column stays aligned and the row height cannot
     shift as the list mixes types — but the box is invisible. */
  const rowTypeArt = (item, iconSize = TYPE_ICON_SIZE) => {
    if (item.type === 'document') return rowThumb(item.id, item.filePath);
    return (
      /* Same 23x30 footprint a page thumbnail occupies, so the distance from
         the art to the name is identical whatever the row's type — a mixed
         list has one left edge, not one per type. */
      <div style={{
        width: ROW_ART_W, height: ROW_THUMB, flex: 'none',
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name={typeIcon[item.type] || 'doc'} size={iconSize} />
      </div>
    );
  };

  /* ----------------------------------------------------------------------
     Preview-pane contents trees.

     A project and a template have no page to render, so the pane would
     otherwise be a name and two dates — nothing you could safely decide
     "delete forever" on. Both therefore show what is INSIDE them, using the
     same disclosure and the same visual vocabulary as the screens that own
     these objects (the Projects tree and the Templates editor).

     Both trees scroll inside their own box rather than growing the pane, so
     the Archived / Time remaining block stays pinned where it always is.
     ---------------------------------------------------------------------- */
  const treeScroller = {
    marginTop: 8, flex: '0 1 auto', minHeight: 0, overflow: 'auto',
    display: 'flex', flexDirection: 'column', gap: 2,
  };

  /* An archived project, as a tree whose leaves are its documents. Opens
     EXPANDED and is driven by previewCollapsedIds — its own state, entirely
     separate from the ledger row's. Toggling here leaves the ledger alone and
     vice versa. */
  const projectPreviewTree = (item) => {
    const nodeId = `${item.id}:contents`;
    const open = isPreviewNodeOpen(previewCollapsedIds, nodeId);
    return (
      <div style={{ marginTop: 14, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="section-label">Contents</div>
        <div className="slim-scroll" style={treeScroller}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            {item.childCount > 0
              ? previewDisclosure(nodeId, open)
              : <span style={{ width: 12, flex: 'none' }} />}
            <Icon name="folder" size={13} color="var(--gold)" />
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{item.name}</span>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-3)', flex: 'none' }}>{item.childCount}</span>
          </div>
          {item.childCount === 0 && (
            <div className="meta" style={{ fontSize: 11.5, padding: '6px 0 6px 20px' }}>This project has no documents.</div>
          )}
          {open && item.children.map((child) => (
            /* Indented leaf, carrying the same 30px page thumbnail the ledger
               rows use — these files go with the project, so the owner needs
               to see them before restoring or destroying it. */
            <button
              key={child.id}
              type="button"
              onClick={() => previewDocument(child.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 20px',
                width: '100%', border: 0, background: 'transparent', color: 'inherit',
                fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
              }}
            >
              {rowThumb(child.id, child.filePath)}
              <span className="meta" style={{ fontSize: 11.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{child.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  /* An archived template, as its contents: modules with their categories
     nested underneath, then the entities. Naming, the disclosure and the
     entity colour swatches are the Templates editor's, so an archived
     template reads as the same object the editor shows. */
  const templatePreviewTree = (item) => {
    const modules = item.modules || [];
    const entities = item.entities || [];
    return (
      <div style={{ marginTop: 14, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="section-label">Modules</div>
        <div className="slim-scroll" style={treeScroller}>
          {modules.length === 0 && (
            <div className="meta" style={{ fontSize: 11.5, padding: '4px 0' }}>This template has no modules.</div>
          )}
          {modules.map((mod) => {
            /* Module ids are scoped by template id: a legacy template with no
               stored ids falls back to positional ones, which would otherwise
               collide between two templates in the same expanded set. */
            const moduleKey = `${item.id}:${mod.id}`;
            const open = isPreviewNodeOpen(previewCollapsedIds, moduleKey);
            const categories = mod.categories || [];
            return (
              <div key={mod.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  {categories.length > 0
                    ? previewDisclosure(moduleKey, open, 'categories')
                    : <span style={{ width: 12, flex: 'none' }} />}
                  <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{mod.name}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-3)', flex: 'none' }}>
                    {categories.length} {categories.length === 1 ? 'category' : 'categories'}
                  </span>
                </div>
                {open && categories.map((cat) => (
                  /* Categories are the leaves: their checklist lines are
                     counted, not listed. The preview answers "is this the
                     template I meant?" — a full checklist would bury that. */
                  <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0 3px 20px' }}>
                    <span className="meta" style={{ fontSize: 11.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{cat.name}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-3)', flex: 'none' }}>
                      {cat.itemCount} {cat.itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {/* Entities — the same 14px colour chip the Templates editor draws
            beside a template, at full strength with its own border colour, so
            an entity set is recognisable at a glance. */}
        <div className="section-label" style={{ marginTop: 14, flex: 'none' }}>Entities</div>
        <div className="slim-scroll" style={{ ...treeScroller, flex: '0 1 auto' }}>
          {entities.length === 0 && (
            <div className="meta" style={{ fontSize: 11.5, padding: '4px 0' }}>This template has no entities.</div>
          )}
          {entities.map((entity) => (
            <div key={entity.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <span style={{
                width: 14, height: 14, borderRadius: '50%', flex: 'none',
                background: entity.color, border: `1.5px solid ${entity.borderColor}`,
              }} />
              <span style={{ fontSize: 11.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{entity.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderRow = (item) => {
    const checked = selectedIds.has(item.id);
    /* A project kept in the list only because a CHILD matched the search opens
       automatically — otherwise the row that justified the match sits hidden
       behind a collapsed chevron. */
    const expanded = isRowExpanded(expandedIds, item.id) || matchedOnChildOnly(item, search);
    const isProject = item.type === 'project' && item.childCount > 0;
    const active = selectMode ? checked : previewId === item.id;
    const subline = rowSubline(item);
    const activate = () => {
      if (selectMode) { toggleRow(item.id); return; }
      setPreviewId(item.id);
      setPreviewOpen(true);
    };
    return (
      <div key={item.id}>
        <div
          onClick={activate}
          role="button"
          tabIndex={0}
          aria-pressed={selectMode ? checked : undefined}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            activate();
          }}
          style={{
            display: 'grid', gridTemplateColumns: grid, alignItems: 'center',
            // UX 2026-09-22: the row divider. --ink-600 (= --surface-3) on a
            // --surface-2 card measured 1.16:1, so the Archive list had no rows
            // to speak of. --surface-3 is the SELECTED colour, not a boundary
            // one — hence the background below still uses it. --border is 3.60:1.
            borderBottom: '1px solid var(--border)',
            // Transparent on purpose: reserves the 2px the gold selected edge
            // fills, so the row does not shift when it becomes active.
            borderLeft: active ? '2px solid var(--gold)' : '2px solid transparent',
            background: active ? 'var(--ink-600)' : 'transparent',
            cursor: 'pointer',
            height: ROW_HEIGHT, boxSizing: 'border-box',
            // Skip layout/paint for off-screen rows; the intrinsic size is the
            // real pinned height, so skipped rows reserve exactly their space.
            contentVisibility: 'auto',
            containIntrinsicSize: `0 ${ROW_HEIGHT}px`,
          }}
        >
          {/* Lead column — the select checkbox only. The disclosure used to
              live here too, which put it out at the far left of the row; the
              owner asked for it "just to the left of the title", so it moved
              into the name cell's leading slot. Keeping this column
              checkbox-only also means a project can be expanded WHILE
              selecting, which the shared cell had made impossible. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
            {selectMode ? checkGlyph(checked) : null}
          </div>
          {/* Thumbnail column — its own cell, centred so every thumbnail lines
              up under the next, exactly as the Documents ledger does it. The
              type glyph moved here out of the name cell: one type mark per row,
              at a size the user can actually read the page off. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {rowTypeArt(item)}
          </div>
          <div style={stickyCell(active)}>
            {/* Leading slot — the disclosure sits here, immediately left of the
                title and hugging it, inside the 14px that would otherwise be
                the name cell's left padding. Always present so the title's
                left edge is identical on every row. */}
            {nameLeadSlot(isProject ? ledgerDisclosure(item.id, expanded) : null)}
            {/* Name over its glyph strip — the hub's one "identify this row"
                block, shared with the Projects tree and the Templates editor. */}
            <div style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{item.name}</span>
              {subline}
            </div>
            {item.childCount > 0 && (
              <span className="meta" style={{ fontSize: 11, flex: 'none', marginLeft: 8 }}>
                {item.childCount} {item.childCount === 1 ? 'document' : 'documents'}
              </span>
            )}
          </div>
          <span className="meta" style={{ fontSize: 11.5, padding: `${ROW_PAD_Y}px 0` }}>{archiveTypeLabel(item.type)}</span>
          <span className="mono" style={{ fontSize: 11, padding: `${ROW_PAD_Y}px 0` }}>{archivedDateLabel(item.archivedAt)}</span>
          {daysCell(item)}
        </div>
        {/* Child documents of an archived project. They remain excluded from
            restore/delete selection because the project acts as one unit, but
            each document can still be inspected in the same preview pane as a
            top-level archived document. */}
        {isProject && expanded && item.children.map((child) => (
          <div
            key={child.id}
            role="button"
            tabIndex={selectMode ? -1 : 0}
            aria-label={`Preview ${child.name}`}
            aria-pressed={!selectMode ? previewId === child.id : undefined}
            onClick={() => previewDocument(child.id)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              previewDocument(child.id);
            }}
            style={{
              display: 'grid', gridTemplateColumns: grid, alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              borderLeft: previewId === child.id ? '2px solid var(--gold)' : '2px solid transparent',
              background: previewId === child.id ? 'var(--ink-600)' : 'transparent',
              cursor: selectMode ? 'default' : 'pointer',
              contentVisibility: 'auto',
              // 8px padding + the 30px row thumbnail + 8px padding.
              containIntrinsicSize: '0 46px',
            }}
          >
            <span />
            <span />
            <div style={{ ...stickyCell(false), padding: '8px 14px 8px 44px', gap: 8 }}>
              {/* The same real first-page thumbnail the Documents ledger puts on
                  its rows, at the SAME size — a child document is not a lesser
                  document, and the owner has to recognise it before the whole
                  project is destroyed. Indented rather than sitting in the
                  thumbnail column, so the nesting stays legible. */}
              {rowThumb(child.id, child.filePath)}
              <span className="meta" style={{ fontSize: 11.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{child.name}</span>
            </div>
            {/* A child row IS a document, so it fills the same three columns a
                top-level document does, through the same formatters and the
                same urgency colour. Three blank cells read as missing data —
                and these rows are exactly the ones whose expiry the user needs,
                because a project takes them all with it. */}
            <span className="meta" style={{ fontSize: 11.5, padding: '8px 0' }}>{archiveTypeLabel(child.type)}</span>
            <span className="mono" style={{ fontSize: 11, padding: '8px 0' }}>{archivedDateLabel(child.archivedAt)}</span>
            {daysCell(child, 8)}
          </div>
        ))}
      </div>
    );
  };

  const renderMobileCard = (item) => {
    const checked = selectedIds.has(item.id);
    /* A project kept in the list only because a CHILD matched the search opens
       automatically — otherwise the row that justified the match sits hidden
       behind a collapsed chevron. */
    const expanded = isRowExpanded(expandedIds, item.id) || matchedOnChildOnly(item, search);
    const isProject = item.type === 'project' && item.childCount > 0;
    /* UX 2026-09-22: the row is a line item in the one Archive panel, so its
       selected look is the panel's — a --surface-3 step and a 2px gold left
       edge, set in hub.css. It used to be an inline border and fill, which
       outranked every class rule and drew a gold box all the way round the
       card; the owner's ruling is a single edge, never a box. */
    return (
      <div
        key={`mobile-${item.id}`}
        className={`archive-mobile-card${checked ? ' is-selected' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => { if (selectMode) toggleRow(item.id); }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (selectMode) toggleRow(item.id);
        }}
      >
        {/* THREE grid children, ALWAYS — never conditionally rendered.
            .archive-mobile-card-head declares three columns, so a card that
            omitted its first child put the name into the 28px lead column,
            wrapped the metadata one word per line and left the rest of the card
            empty (measured 148px tall against the Documents card's 74px; the
            owner's screenshot showed worse). Conditional content goes INSIDE a
            cell, never in place of one — the Documents card does the same. */}
        <div className="archive-mobile-card-head">
          <div style={{ display: 'grid', placeItems: 'center', minWidth: 0 }}>
            {selectMode ? checkGlyph(checked) : (isProject ? (
              <button
                type="button"
                className="archive-mobile-disclosure"
                aria-expanded={expanded}
                title={expanded ? 'Hide documents' : 'Show documents'}
                onClick={(e) => { e.stopPropagation(); setExpandedIds((prev) => toggleExpanded(prev, item.id)); }}
              >{chevron(expanded, MOBILE_CHEVRON_SIZE)}</button>
            ) : null)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="mobile-card-title">{item.name}</div>
            <div className="mobile-card-meta">
              {[archiveTypeLabel(item.type), archivedDateLabel(item.archivedAt), daysRemainingLabel(item.daysRemaining)].join(' · ')}
            </div>
          </div>
          {/* Trailing cell — the same type art the desktop row shows, in the
              slot the Documents card fills with its page thumbnail. */}
          <div style={{ display: 'grid', placeItems: 'center', minWidth: 0 }}>
            {rowTypeArt(item, MOBILE_TYPE_ICON_SIZE)}
          </div>
        </div>
        {isProject && expanded && (
          /* Child documents. These were a bare name with no art at all, so an
             expanded project on mobile said nothing about WHICH drawings travel
             with it (owner's 2026-08-07 screenshot). They now carry the same
             30px page thumbnail every other document in Archive uses — the
             desktop child rows, the desktop ledger rows and the project preview
             tree all render ROW_THUMB, and a document should not change size
             just because the viewport did.

             Deliberately NOT the mobile Documents card's 52x54 art: that is a
             CARD's primary art, and three of them stacked inside one card is
             how the 148px monster card looked before it was fixed. */
          <div className="archive-mobile-children">
            {item.children.map((child) => (
              <div key={child.id} className="archive-mobile-child">
                {rowThumb(child.id, child.filePath)}
                <span className="archive-mobile-child-name">{child.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  /* Loading: a few placeholder rows in the real row geometry, so the ledger
     does not jump when the data lands. */
  const skeletonRows = (
    <div role="status" aria-busy="true" aria-label="Loading archive">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="hub-loading-document-row"
          style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center' }}
        >
          <span />
          {/* The thumbnail column reserves its real 23x30 footprint, or the
              rows shuffle sideways the moment the data lands. */}
          <span className="hub-skeleton-block" style={{ height: 30, width: 23, margin: '0 auto' }} />
          <span className="hub-skeleton-block" style={{ height: 12, width: '58%', marginLeft: 14 }} />
          <span className="hub-skeleton-block" style={{ height: 10, width: 62 }} />
          <span className="hub-skeleton-block" style={{ height: 10, width: 84 }} />
          <span className="hub-skeleton-block" style={{ height: 10, width: 54 }} />
        </div>
      ))}
    </div>
  );

  const emptyState = (
    <EmptyState
      icon="clock"
      line="Nothing in Archive"
      actionIcon="doc"
      actionLabel="Go to documents"
      onAction={() => onNav && onNav('documents')}
    />
  );

  const errorLine = (
    <div className="meta" style={{ padding: '24px 16px', fontSize: 12, color: DANGER }}>
      {typeof error === 'string' ? error : (error?.message || 'Archive could not be loaded.')}
    </div>
  );

  /* A search that finds nothing says so in the Documents ledger's words ("No
     documents match your search."); an empty type filter keeps its own
     message. Naming the reason is what tells the user whether to clear the
     search box or the filter. */
  const noMatchLine = (
    <div className="meta" style={{ padding: '24px 16px', fontSize: 12 }}>
      {search.trim() ? 'No archived items match your search.' : 'No archived items of this type.'}
    </div>
  );

  return (
    <>
      <DismissBarrier
        active={menuOpen}
        insideRefs={[menuRef, desktopMenuRef]}
        onDismiss={() => setMenuOpen(false)}
      />
      <HubShell
        tab="archive"
        onNav={onNav}
        title="Archive"
        subtitle={subtitle}
        actions={headerActions}
        userName={user?.name || user?.email?.split('@')[0] || 'You'}
        // Left undefined on purpose: HubShell's profile badge then falls back
        // to the live "Synced · <tier>" text. Archive has no status of its own.
        userMeta={undefined}
        templatesLocked={templatesLocked}
      >
        <div className="archive-body" style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0 }}>
          <div className="card archive-desktop-card" style={{ display: 'grid', gridTemplateColumns: showPreview ? '2.2fr 1fr' : '1fr', height: '100%', overflow: 'hidden' }}>
            <div className="slim-scroll" style={{ overflow: 'auto', height: '100%', borderRight: showPreview ? '1px solid var(--ink-500)' : 0 }}>
              <div>
                <div style={{ ...ledgerHeader, display: 'grid', gridTemplateColumns: grid, position: 'sticky', top: 0, zIndex: 3 }}>
                  <span></span>
                  {/* The thumbnail column carries no header, exactly as in
                      Documents, so "Name" sits over the name. */}
                  <span></span>
                  {headerCell('name', 'Name', { padding: '0 14px', display: 'flex', alignItems: 'center' })}
                  {headerCell('type', 'Type')}
                  {headerCell('archived', 'Archived')}
                  {headerCell('days', 'Days remaining')}
                </div>
                {error ? errorLine : null}
                {!error && loading ? skeletonRows : null}
                {!error && !loading && rows.length === 0 && (
                  items.length === 0
                    ? <div style={{ paddingTop: 96 }}>{emptyState}</div>
                    : noMatchLine
                )}
                {!error && !loading && rows.map(renderRow)}
              </div>
            </div>
            {showPreview && (
              /* Preview pane — same shape as the Documents ledger's. You are
                 deciding whether to rescue or destroy this thing, so it has to
                 be identifiable without leaving Archive. A document shows its
                 real first page; a project and a template have no page, so
                 they show what is inside them as a tree instead. */
              <aside style={{ padding: 18, position: 'relative', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 'none' }}>
                  <div className="section-label">Preview</div>
                  <button onClick={() => setPreviewOpen(false)} title="Close preview" className="hub-icon-btn">
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{previewItem.name}</div>
                <div className="meta" style={{ marginTop: 4, fontSize: 11.5, flex: 'none' }}>
                  {[
                    archiveTypeLabel(previewItem.type),
                    previewItem.projectName || null,
                    previewItem.type === 'document' ? fileSizeLabel(previewItem.fileSize) : null,
                    previewItem.type === 'document' && previewItem.pageCount != null ? `${previewItem.pageCount} pages` : null,
                    previewItem.type === 'project' && previewItem.childCount
                      ? `${previewItem.childCount} ${previewItem.childCount === 1 ? 'document' : 'documents'}`
                      : null,
                  ].filter(Boolean).join(' · ')}
                </div>
                {previewItem.type === 'document' && (
                  <div style={{ marginTop: 14, height: 360, flex: '0 1 auto', minHeight: 0 }}>
                    <PdfPageThumb
                      key={previewItem.id}
                      doc={{ id: previewItem.id, file_path: previewItem.filePath }}
                      downloadDocument={downloadDocument}
                      variant="preview"
                      fill
                      priority
                      fallback={<div style={{ width: '100%', height: '100%' }}><PdfThumb height="100%" /></div>}
                    />
                  </div>
                )}
                {previewItem.type === 'project' && projectPreviewTree(previewItem)}
                {previewItem.type === 'template' && templatePreviewTree(previewItem)}
                {previewTeam.shown.length > 0 && (
                  /* Shared with — shown ONLY when this item really has other
                     people on it. Unlike the Documents ledger, Archive does not
                     draw a "team of one" from the signed-in user: everything
                     here belongs to that user by definition, so an owner-only
                     glyph would say nothing. When the block IS here it is a
                     warning worth reading before Delete forever — other people
                     still have this. */
                  <div style={{ marginTop: 14, flex: 'none' }}>
                    <div className="section-label">Shared with</div>
                    <div style={{ marginTop: 8 }}>
                      <AvatarStack
                        members={[
                          ...previewTeam.shown.map(collaboratorInitials),
                          ...(previewTeam.overflow ? [`+${previewTeam.overflow}`] : []),
                        ]}
                        size={22}
                      />
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 'auto', paddingTop: 14, flex: 'none' }}>
                  <div className="section-label">Archived</div>
                  <div style={{ marginTop: 8, fontSize: 12 }}>{archivedDateLabel(previewItem.archivedAt)}</div>
                  <div className="section-label" style={{ marginTop: 14 }}>Time remaining</div>
                  <div
                    className="mono"
                    style={{ marginTop: 8, fontSize: 12, color: previewItem.daysRemaining <= URGENT_DAYS ? DANGER : 'inherit' }}
                  >{timeRemainingLabel(previewItem.expiresAt)}</div>
                </div>
              </aside>
            )}
          </div>
          <div className="archive-mobile-list slim-scroll">
            {error ? errorLine : null}
            {!error && loading ? skeletonRows : null}
            {!error && !loading && rows.length === 0 && (items.length === 0 ? emptyState : noMatchLine)}
            {!error && !loading && rows.map(renderMobileCard)}
          </div>
        </div>
      </HubShell>
      {/* Permanent deletion always confirms — this is the one action in the
          app with no undo. ConfirmModal closes itself after onConfirm. */}
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={DELETE_FOREVER_COPY.title}
        message={DELETE_FOREVER_COPY.message}
        confirmLabel={DELETE_FOREVER_COPY.confirmLabel}
        busyLabel="Deleting…"
        danger
        onConfirm={() => doDeleteForever()}
      />
    </>
  );
}
