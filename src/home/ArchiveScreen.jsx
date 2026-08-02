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
import { useCallback, useMemo, useState } from 'react';
import { HubShell, Icon, EmptyState } from './HubShell';
import { ConfirmModal } from './BulkModals';
import { miniButtonStyle } from './hubControls';
import { showToast } from '../utils/toast';
import { DELETE_FOREVER_COPY } from '../services/archiveContract';
import {
  ARCHIVE_FILTERS,
  DEFAULT_ARCHIVE_SORT,
  archiveTypeLabel,
  archivedDateLabel,
  buildBulkFailureMessage,
  buildBulkOutcomeMessage,
  daysRemainingLabel,
  defaultCollapsedIds,
  isAllSelected,
  isRowExpanded,
  nextSelectAll,
  nextSortState,
  normalizeBulkResult,
  pruneSelection,
  resolveSelection,
  toggleCollapsed,
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
   [checkbox] [Name] [Type] [Archived] [Days remaining]. The 32px leading
   column matches the Documents ledger's select column exactly. */
const grid = '32px minmax(150px,1fr) 110px 124px 110px';

/* Rows near the end of the retention window are tinted danger so the user
   spots what is about to be purged without reading every date. Three days is
   the point where "I'll get to it later" stops being safe. */
const URGENT_DAYS = 3;

const DANGER = '#cf6f6f';

const typeIcon = { document: 'doc', project: 'folder', template: 'template' };

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
  /* Collapsed — not expanded — ids, so project groups render open by default
     and stay open when the user re-sorts or switches filters. */
  const [collapsedIds, setCollapsedIds] = useState(defaultCollapsedIds);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => visibleArchiveItems(items, { filter, sortKey, sortDir }),
    [items, filter, sortKey, sortDir],
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

  const selectedItems = useMemo(() => resolveSelection(rows, selectedIds), [rows, selectedIds]);
  const selectedCount = selectedItems.length;
  const allSelected = isAllSelected(selectedIds, rows);

  const toggleRow = (id) => setSelectedIds((prev) => toggleSelection(prev, id));

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
     ledger itself stays a pure list. */
  const subtitle = (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
      <span><b>{rows.length}</b> {rows.length === 1 ? 'item' : 'items'}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={() => setSelectedIds((prev) => nextSelectAll(prev, rows))}
          style={{ ...miniButtonStyle(), color: 'var(--bone-100)' }}
        >{allSelected ? 'None' : 'All'}</button>
        <button
          disabled={actionsDisabled}
          onClick={doRestore}
          style={miniButtonStyle({ disabled: actionsDisabled })}
        >Restore</button>
        <button
          disabled={actionsDisabled}
          onClick={() => setConfirmDelete(true)}
          style={miniButtonStyle({ disabled: actionsDisabled, danger: true })}
        >Delete forever</button>
      </span>
    </span>
  );

  /* Type filter — a segmented row. 'All' is the default because Archive is a
     mixed, short-lived list and hiding types by default would hide the very
     row someone came here to rescue. */
  const headerActions = (
    <div className="archive-filter-row" role="group" aria-label="Filter archive by type">
      {ARCHIVE_FILTERS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={`btn archive-filter-button${filter === key ? ' active' : ''}`}
          aria-pressed={filter === key}
          onClick={() => setFilter(key)}
        >{label}</button>
      ))}
    </div>
  );

  const checkGlyph = (checked) => (
    <span style={{
      width: 14, height: 14,
      border: `1.4px solid ${checked ? 'var(--gold)' : 'var(--ink-300)'}`,
      background: checked ? 'var(--gold)' : 'transparent',
      borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && <span style={{ color: '#15110a', fontSize: 10, lineHeight: 1 }}>✓</span>}
    </span>
  );

  const stickyCell = (selected) => ({
    position: 'sticky', left: 0, zIndex: 2,
    background: selected ? 'var(--ink-600)' : 'var(--ink-700)',
    padding: '12px 14px',
    display: 'flex', alignItems: 'center', gap: 8,
    minWidth: 0,
  });

  const daysCell = (item) => (
    <span
      className="mono"
      style={{
        fontSize: 11, padding: '12px 0',
        color: item.daysRemaining <= URGENT_DAYS ? DANGER : 'inherit',
      }}
    >{daysRemainingLabel(item.daysRemaining)}</span>
  );

  const renderRow = (item) => {
    const checked = selectedIds.has(item.id);
    const expanded = isRowExpanded(collapsedIds, item.id);
    const isProject = item.type === 'project' && item.childCount > 0;
    return (
      <div key={item.id}>
        <div
          onClick={() => toggleRow(item.id)}
          role="button"
          tabIndex={0}
          aria-pressed={checked}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            toggleRow(item.id);
          }}
          style={{
            display: 'grid', gridTemplateColumns: grid, alignItems: 'center',
            borderBottom: '1px solid var(--ink-600)',
            borderLeft: checked ? '2px solid var(--gold)' : '2px solid transparent',
            background: checked ? 'var(--ink-600)' : 'transparent',
            cursor: 'pointer',
            // Skip layout/paint for off-screen rows; intrinsic height matches
            // the Documents ledger's single-line rows.
            contentVisibility: 'auto',
            containIntrinsicSize: '0 50px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
            {checkGlyph(checked)}
          </div>
          <div style={stickyCell(checked)}>
            {isProject ? (
              <button
                type="button"
                title={expanded ? 'Hide documents' : 'Show documents'}
                aria-expanded={expanded}
                onClick={(e) => { e.stopPropagation(); setCollapsedIds((prev) => toggleCollapsed(prev, item.id)); }}
                style={{
                  background: 'transparent', border: 0, color: 'var(--ink-200)',
                  cursor: 'pointer', padding: 0, fontSize: 10, lineHeight: 1,
                  fontFamily: 'inherit', flex: 'none', width: 12,
                }}
              >{expanded ? '▾' : '▸'}</button>
            ) : <span style={{ width: 12, flex: 'none' }} />}
            <Icon name={typeIcon[item.type] || 'doc'} size={13} color="var(--ink-200)" />
            <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{item.name}</span>
            {item.childCount > 0 && (
              <span className="meta" style={{ fontSize: 11, flex: 'none' }}>
                {item.childCount} {item.childCount === 1 ? 'document' : 'documents'}
              </span>
            )}
          </div>
          <span className="meta" style={{ fontSize: 11.5, padding: '12px 0' }}>{archiveTypeLabel(item.type)}</span>
          <span className="mono" style={{ fontSize: 11, padding: '12px 0' }}>{archivedDateLabel(item.archivedAt)}</span>
          {daysCell(item)}
        </div>
        {/* Child documents of an archived project. Descriptive only: they are
            never selectable and carry no actions, because a project restores
            or deletes as one unit — showing them is how the user knows what
            travels with it. */}
        {isProject && expanded && item.children.map((child) => (
          <div
            key={child.id}
            style={{
              display: 'grid', gridTemplateColumns: grid, alignItems: 'center',
              borderBottom: '1px solid var(--ink-600)',
              borderLeft: '2px solid transparent',
              contentVisibility: 'auto',
              containIntrinsicSize: '0 34px',
            }}
          >
            <span />
            <div style={{ ...stickyCell(false), padding: '8px 14px 8px 44px', gap: 8 }}>
              <Icon name="doc" size={12} color="var(--ink-300)" />
              <span className="meta" style={{ fontSize: 11.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{child.name}</span>
            </div>
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    );
  };

  const renderMobileCard = (item) => {
    const checked = selectedIds.has(item.id);
    const expanded = isRowExpanded(collapsedIds, item.id);
    const isProject = item.type === 'project' && item.childCount > 0;
    return (
      <div
        key={`mobile-${item.id}`}
        className="archive-mobile-card"
        role="button"
        tabIndex={0}
        onClick={() => toggleRow(item.id)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggleRow(item.id);
        }}
        style={{
          borderColor: checked ? 'var(--gold)' : 'var(--ink-500)',
          background: checked ? 'var(--ink-600)' : 'var(--ink-700)',
        }}
      >
        <div className="archive-mobile-card-head">
          <span style={{ display: 'grid', placeItems: 'center' }}>{checkGlyph(checked)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="mobile-card-title">{item.name}</div>
            <div className="mobile-card-meta">
              {[archiveTypeLabel(item.type), archivedDateLabel(item.archivedAt), daysRemainingLabel(item.daysRemaining)].join(' · ')}
            </div>
          </div>
          {isProject && (
            <button
              type="button"
              className="archive-mobile-disclosure"
              aria-expanded={expanded}
              title={expanded ? 'Hide documents' : 'Show documents'}
              onClick={(e) => { e.stopPropagation(); setCollapsedIds((prev) => toggleCollapsed(prev, item.id)); }}
            >{expanded ? '▾' : '▸'}</button>
          )}
        </div>
        {isProject && expanded && (
          <div className="archive-mobile-children">
            {item.children.map((child) => (
              <div key={child.id} className="archive-mobile-child">{child.name}</div>
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

  const noMatchLine = (
    <div className="meta" style={{ padding: '24px 16px', fontSize: 12 }}>No archived items of this type.</div>
  );

  return (
    <>
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
          <div className="card archive-desktop-card" style={{ height: '100%', overflow: 'hidden' }}>
            <div className="slim-scroll" style={{ overflow: 'auto', height: '100%' }}>
              <div>
                <div style={{ ...ledgerHeader, display: 'grid', gridTemplateColumns: grid, position: 'sticky', top: 0, zIndex: 3 }}>
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
        danger
        onConfirm={() => { doDeleteForever(); }}
      />
    </>
  );
}
