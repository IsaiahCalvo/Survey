/* Survey Hub — Documents tab.
   Faithful port of the Claude Design prototype (survey-hub/layout2-ledger.jsx,
   Ledger_Documents): a sortable spec-ledger with a side preview pane.

   The markup, styling, spacing, columns and preview sections mirror the
   mockup element for element. Only the data is swapped: real documents are
   mapped into the display shape the markup expects. Fields the app does not
   store yet (page count, revision, per-event activity) fall back gracefully
   without changing the layout.
*/
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { HubShell, Icon, Avatar, PdfThumb, Search, EmptyState } from './HubShell';
import { countLabel } from './countLabel.js';
import { presenceInitials, PRESENCE_SELF_TINT, PRESENCE_INK } from '../components/presenceIdentity.js';
import SectionIconButton, { SelectModeButtons } from '../components/SectionIconButton.jsx';
import { MoveCopyModal, RenameModal } from './BulkModals';
import PdfPageThumb from './PdfPageThumb';
import { useThumbnailBackfill } from '../hooks/useThumbnailBackfill';
import { useStorage } from '../hooks/useDatabase';
import Spinner from '../components/Spinner';
import DismissBarrier from '../components/DismissBarrier';
import useModalFocusTrap from './useModalFocusTrap';

const ledgerHeader = {
  background: 'var(--ink-700)',
  borderBottom: '1px solid var(--ink-500)',
  borderTop: 0,
  /* Column labels: 11/600 in normal case with no tracking, the viewer's
     label style (owner 2026-10-02, UI consistency audit). */
  fontSize: 11, letterSpacing: 0,
  color: 'var(--ink-200)', fontWeight: 600,
  padding: '8px 0',
};

// Survey calm gold (2026-10-01): no ribbon colour equals the accent gold.
const RIBBON = ['#f0883e', '#7ab7e6', '#a6e07a', '#c293e6', '#e69a7a', '#9aa3b2'];
/* The row menu wears the shared home menu (hub.css .hub-menu / .hub-menu__item,
   owner 2026-10-02): 28px items at 12px on desktop, 44px at 15px on the phone. */
const isPhoneWidth = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(max-width: 720px)').matches;

function DocumentActionMenu({ anchorRect, items, onClose, minWidth = 168 }) {
  const ref = useRef(null);

  if (!anchorRect) return null;

  const phone = isPhoneWidth();
  const menuWidth = phone ? Math.max(minWidth, 200) : minWidth;
  const estHeight = items.length * (phone ? 44 : 28) + 10;
  let top = anchorRect.bottom + 4;
  if (top + estHeight > window.innerHeight - 8) top = Math.max(8, anchorRect.top - estHeight - 4);
  const left = Math.max(8, Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8));

  return createPortal(
    <>
      <DismissBarrier insideRefs={[ref]} onDismiss={onClose} />
      <div
        ref={ref}
        role="menu"
        className="hub-menu"
        style={{ top, left, minWidth: menuWidth }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className={`hub-menu__item${it.danger ? ' is-danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { if (it.disabled) return; onClose(); it.onClick && it.onClick(); }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

/* The Team avatar is YOUR face: the one initials rule and the calm own-face
   grey the account avatar and the viewer's presence row use (owner
   2026-10-02), not a gold disc with its own initials rule. */
const initialsOf = (name) => presenceInitials(name || 'You');

const longDate = (value) => {
  const ms = Date.parse(value || 0) || 0;
  return ms
    ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
};

const formatSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
};

export default function DocumentsLedger({
  documents = [],
  projects = [],
  user = null,
  templatesLocked = false,
  onNav,
  onOpenDocument,
  onUpload,
  uploadBusy = false,
  onShare,
  onDuplicate,
  onDelete,
  onRename,
  onMoveCopy,
  onLockDocument,
}) {
  const [selId, setSelId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [sortKey, setSortKey] = useState('edited');
  const [sortDir, setSortDir] = useState('desc');
  const [docSelectMode, setDocSelectMode] = useState(false);
  const [selDocs, setSelDocs] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveMode, setMoveMode] = useState('move');
  const [renameTarget, setRenameTarget] = useState(null);
  const [docMenu, setDocMenu] = useState(null);
  const [clipboardDoc, setClipboardDoc] = useState(null);
  const [mobileDetailId, setMobileDetailId] = useState(null);
  const [mobileSortOpen, setMobileSortOpen] = useState(false);
  const mobileSortRef = useRef(null);
  const mobileDetailModalRef = useRef(null);
  const mobileDetailCloseRef = useRef(null);
  const mobileDetailOpenerRef = useRef(null);
  const closeMobileDetail = useCallback(() => setMobileDetailId(null), []);
  useModalFocusTrap({
    active: Boolean(mobileDetailId),
    containerRef: mobileDetailModalRef,
    initialFocusRef: mobileDetailCloseRef,
    returnFocusRef: mobileDetailOpenerRef,
    onClose: closeMobileDetail,
  });

  /* Supabase storage helper — let PdfPageThumb fetch a document's bytes to
     render its real first page via the authenticated download (private bucket). */
  const { downloadDocument } = useStorage();

  const projectNameById = useMemo(() => {
    const m = new Map();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  // Map each real document into the shape the ledger markup expects.
  const mapped = useMemo(() => documents.map((d, i) => {
    // Use '' (not 0) as the empty fallback: Date.parse(0) coerces to the string
    // "0" and resolves to Jan 1 2000, whereas Date.parse('') is NaN → no date.
    const ms = Date.parse(d.updated_at || d.created_at || '') || 0;
    const dt = ms ? new Date(ms) : null;
    return {
      raw: d,
      id: d.id,
      name: d.name,
      project: projectNameById.get(d.project_id) || 'Sandbox',
      size: formatSize(d.file_size),
      sizeBytes: Number(d.file_size) || 0,
      pages: d.pages ?? d.page_count ?? null,
      rev: d.rev || '',
      editedMs: ms,
      touchedTime: dt ? dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—',
      touchedAbs: dt ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      lastEditedAbs: longDate(d.updated_at || d.created_at),
      uploadedAbs: longDate(d.created_at),
      color: RIBBON[i % RIBBON.length],
      shared: !!d.shared,
    };
  }), [documents, projects]);

  const onHeaderClick = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'edited' || key === 'size' ? 'desc' : 'asc'); }
  };
  const arrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const docs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = mapped.filter((d) => !q || (d.name || '').toLowerCase().includes(q));
    const sign = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'name') arr.sort((a, b) => sign * a.name.localeCompare(b.name));
    else if (sortKey === 'project') arr.sort((a, b) => sign * (a.project || '').localeCompare(b.project || ''));
    else if (sortKey === 'edited') arr.sort((a, b) => sign * (a.editedMs - b.editedMs));
    else if (sortKey === 'size') arr.sort((a, b) => sign * (a.sizeBytes - b.sizeBytes));
    return arr;
  }, [mapped, search, sortKey, sortDir]);
  const mobileDetailDoc = docs.find((d) => d.id === mobileDetailId) || null;

  /* Idle thumbnail backfill (2026-09-23): fills missing thumbnails one at a
     time, in the order shown, only while this list is on screen. The
     sentinel below is how it knows: hidden hub → no client rects → paused. */
  const backfillHostRef = useRef(null);
  const backfillDocs = useMemo(() => docs.map((d) => d.raw), [docs]);
  useThumbnailBackfill(backfillDocs, { downloadDocument, hostRef: backfillHostRef });

  useEffect(() => {
    if (selId == null && docs.length) setSelId(docs[0].id);
  }, [docs, selId]);

  const sel = docs.find((d) => d.id === selId) || docs[0];
  const toggleDocSel = (id) => setSelDocs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Columns: [select/shared icon] [thumbnail — no header] [File name]
  // [Project] [Last edited] [Size]. The thumbnail has its own column so the
  // "File" header sits over the name, and every thumbnail is centred in a
  // fixed-width column, aligned under one another.
  // With nothing selectable (empty ledger) the preview pane never renders —
  // don't reserve a blank grid column/border for it.
  const showPreview = previewOpen && docs.length > 0;
  const grid = showPreview
    ? '32px 54px minmax(150px,1fr) 124px 124px 72px'
    : '32px 54px 2fr 1fr 1fr 1fr';
  const stickyCell = (selected) => ({
    position: 'sticky', left: 0, zIndex: 2,
    background: selected ? 'var(--ink-600)' : 'var(--ink-700)',
    padding: '12px 14px',
    display: 'flex', alignItems: 'center', gap: 10,
    minWidth: 0,
  });

  const selectedRaw = () => docs.filter((d) => selDocs.has(d.id)).map((d) => d.raw);
  const clearSel = () => setSelDocs(new Set());
  const showDocumentDetails = (doc) => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches) {
      mobileDetailOpenerRef.current = docMenu?.trigger || document.activeElement;
      setMobileDetailId(doc.id);
      return;
    }
    setSelId(doc.id);
    setPreviewOpen(true);
  };

  const sortOptions = [
    ['name', 'File'],
    ['project', 'Project'],
    ['edited', 'Last edited'],
    ['size', 'Size'],
  ];
  const activeSortLabel = sortOptions.find(([key]) => key === sortKey)?.[1] || 'Sort';

  const subtitle = (
    <>
    <DismissBarrier
      active={mobileSortOpen}
      insideRefs={[mobileSortRef]}
      onDismiss={() => setMobileSortOpen(false)}
    />
    <span className="documents-mobile-summary" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
      <span className="documents-file-count"><b>{docs.length}</b> {docs.length === 1 ? 'file' : 'files'}</span>
      <span className="documents-select-row mobile-header-select-row documents-mobile-select-sort-row">
        <span className="documents-mobile-select-main">
          <SectionIconButton
            action="select"
            label={docSelectMode ? 'Done' : 'Select'}
            active={docSelectMode}
            className="mobile-header-select-button"
            onClick={() => { const next = !docSelectMode; setDocSelectMode(next); if (!next) setSelDocs(new Set()); }}
          />
          {docSelectMode && (() => {
            const docSelCount = selDocs.size;
            const allSel = docSelCount === docs.length && docs.length > 0;
            return (
              <span className="documents-select-actions mobile-header-select-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                <SelectModeButtons
                  phone
                  count={docSelCount}
                  allSelected={allSel}
                  onToggleAll={() => setSelDocs(allSel ? new Set() : new Set(docs.map((d) => d.id)))}
                  onDuplicate={() => { onDuplicate && onDuplicate(selectedRaw()); clearSel(); }}
                  onMove={() => { setMoveMode('move'); setMoveOpen(true); }}
                  onCopy={() => { setMoveMode('copy'); setMoveOpen(true); }}
                  onShare={() => onShare && onShare(selectedRaw())}
                  onDelete={async () => { if (!onDelete) return; const ran = await onDelete(selectedRaw()); if (ran !== false) clearSel(); }}
                />
              </span>
            );
          })()}
        </span>
      </span>
    </span>
    </>
  );

  /* The sort control. It belongs with the search field in the header's second
     row — both narrow the list you are looking at — so it renders inside the
     actions slot below rather than beside "Select" on a row of its own. Its
     label IS the live sort, which is why it keeps a visible label instead of
     collapsing to a glyph. */
  const mobileSortControl = (
    <span className="documents-mobile-sort-control" ref={mobileSortRef}>
      <button
        className="btn documents-mobile-filter"
        type="button"
        aria-haspopup="menu"
        aria-expanded={mobileSortOpen}
        onClick={() => setMobileSortOpen((open) => !open)}
      >
        <span className="documents-mobile-filter-visual">
          <Icon name="filter" size={12} />
          <span>{activeSortLabel}</span>
        </span>
      </button>
      {mobileSortOpen && (
        <div className="documents-mobile-sort-menu" role="menu">
          {sortOptions.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className={sortKey === key ? 'active' : ''}
              onClick={() => { onHeaderClick(key); setMobileSortOpen(false); }}
            >
              <span>{label}</span>
              <span>{sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );

  /* KAL-73: cloud uploads run in the background after the picker closes; the
     Upload button is the one fixed point that can show that work honestly.
     Ring + participle label, disabled until the bytes are durable. */
  const uploadButtonBody = uploadBusy
    ? (<><Spinner size={14} color="currentColor" />Uploading…</>)
    : (<><Icon name="upload" size={12} />Upload</>);
  const actions = (
    <>
      <div className="documents-mobile-search-actions hub-mobile-search-actions">
        <Search placeholder="Search documents..." value={search} onChange={setSearch} width="100%" />
        {mobileSortControl}
        <button className="btn primary hub-mobile-primary-action" disabled={uploadBusy} onClick={() => onUpload && onUpload()}>{uploadButtonBody}</button>
      </div>
      <div className="documents-desktop-search">
        <Search placeholder="Search documents..." value={search} onChange={setSearch} />
      </div>
      <button className="btn primary documents-desktop-upload" disabled={uploadBusy} onClick={() => onUpload && onUpload()}>{uploadButtonBody}</button>
    </>
  );

  const mobileDocMeta = (d) => (
    [d.project === 'Sandbox' ? null : d.project, d.touchedAbs || d.lastEditedAbs, d.size]
      .filter(Boolean)
      .join(' · ') || 'No details'
  );
  const openMobileDoc = (d) => {
    if (docSelectMode) { toggleDocSel(d.id); return; }
    onOpenDocument && onOpenDocument(d.raw);
  };
  const openDocMenu = (e, d) => {
    e.stopPropagation();
    const trigger = e.currentTarget;
    const rect = e.currentTarget.getBoundingClientRect();
    setDocMenu((cur) => (cur && cur.id === d.id ? null : { id: d.id, rect, trigger }));
  };
  const renderMobileMore = (d) => (
    <button
      type="button"
      onClick={(e) => openDocMenu(e, d)}
      className="hub-icon-btn"
      title="More" aria-label="More"
    ><Icon name="more" size={14} /></button>
  );
  /* UX 2026-09-22: an unchecked box has no fill, so its edge is the whole
     control and must clear WCAG 1.4.11's 3:1. It used to be --ink-300
     (= --text-disabled), which fails contrast on purpose — 2.54:1 on this card,
     so an empty box read as a disabled one. --border is 3.60:1. Checked stays
     gold, and the 1.4px width is unchanged. Same swap in the row checkbox below
     and in ArchiveScreen / ProjectsFolderTree. */
  const renderMobileCheck = (d, size = 18) => {
    const isChecked = selDocs.has(d.id);
    return (
      <span style={{ width: size, height: size, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--border-strong)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isChecked && <Icon name="check" size={11} color="var(--accent-text)" />}
      </span>
    );
  };
  const renderMobileThumb = (d, height = 54) => (
    <div className="mobile-doc-thumbnail" style={{ height }}>
      <PdfPageThumb
        doc={d.raw}
        downloadDocument={downloadDocument}
        variant="preview"
        height={height}
        fill
        fallback={<PdfThumb height={height} stamp="" color={d.color} />}
      />
    </div>
  );
  const renderMobileCard = (d) => {
    const isChecked = selDocs.has(d.id);
    return (
      <div
        key={`mobile-${d.id}`}
        data-document-id={d.id}
        className={`mobile-doc-card${docSelectMode && isChecked ? ' is-selected' : ''}`}
        onClick={() => openMobileDoc(d)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          openMobileDoc(d);
        }}
      >
        <div style={{ display: 'grid', placeItems: 'center', minWidth: 0 }}>
          {docSelectMode ? renderMobileCheck(d) : renderMobileMore(d)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="mobile-card-title">{d.name}</div>
          <div className="mobile-card-meta">{mobileDocMeta(d)}</div>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', minWidth: 0 }}>
          {renderMobileThumb(d)}
        </div>
      </div>
    );
  };

  return (
    <>
    <span ref={backfillHostRef} aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} />
    <HubShell
      tab="documents"
      onNav={onNav}
      title="Documents"
      subtitle={subtitle}
      actions={actions}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <div className="documents-ledger-body" style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0 }}>
        <div className="card documents-desktop-card" style={{ display: 'grid', gridTemplateColumns: showPreview ? '2.2fr 1fr' : '1fr', height: '100%', overflow: 'hidden' }}>
          <div className="slim-scroll" style={{ overflow: 'auto', borderRight: showPreview ? '1px solid var(--ink-500)' : 0 }}>
            <div>
              <div style={{ ...ledgerHeader, display: 'grid', gridTemplateColumns: grid, position: 'sticky', top: 0, zIndex: 3 }}>
                <span></span>
                <span></span>
                <span onClick={() => onHeaderClick('name')} style={{ padding: '0 14px', display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', color: sortKey === 'name' ? 'var(--bone-100)' : 'inherit' }}>File{arrow('name')}</span>
                <span onClick={() => onHeaderClick('project')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'project' ? 'var(--bone-100)' : 'inherit' }}>Project{arrow('project')}</span>
                <span onClick={() => onHeaderClick('edited')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'edited' ? 'var(--bone-100)' : 'inherit' }}>Last edited{arrow('edited')}</span>
                <span onClick={() => onHeaderClick('size')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'size' ? 'var(--bone-100)' : 'inherit' }}>Size{arrow('size')}</span>
              </div>
              {docs.length === 0 && (
                mapped.length === 0 ? (
                  <div style={{ paddingTop: 96 }}>
                    <EmptyState
                      icon="doc"
                      line="No documents yet"
                      description="Upload your first PDF to start surveying."
                      actionIcon="upload"
                      actionLabel="Upload PDF"
                      onAction={() => onUpload && onUpload()}
                    />
                  </div>
                ) : (
                  <div className="meta" style={{ padding: '24px 16px', fontSize: 12 }}>No documents match your search.</div>
                )
              )}
              {docs.map((d) => {
                const isSel = sel && d.id === sel.id;
                const isChecked = selDocs.has(d.id);
                return (
                  <div
                    key={d.id}
                    data-document-id={d.id}
                    onClick={() => { if (docSelectMode) { toggleDocSel(d.id); return; } setSelId(d.id); setPreviewOpen(true); }}
                    onDoubleClick={() => !docSelectMode && onOpenDocument && onOpenDocument(d.raw)}
                    style={{
                      display: 'grid', gridTemplateColumns: grid, alignItems: 'center',
                      // UX 2026-09-22: the row divider. It was --ink-600
                      // (= --surface-3) on a --surface-2 card: 1.16:1, so the
                      // ledger read as one unbroken block. --surface-3 means
                      // SELECTED and is not a boundary colour; --border is
                      // 3.60:1 here.
                      borderBottom: '1px solid var(--border)',
                      borderLeft: !docSelectMode && isSel ? '2px solid var(--gold)' : '2px solid transparent',
                      background: docSelectMode ? (isChecked ? 'var(--ink-600)' : 'transparent') : (isSel ? 'var(--ink-600)' : 'transparent'),
                      cursor: 'pointer',
                      // Skip layout/paint for off-screen rows. Intrinsic height ~50px:
                      // the two-line "last edited" cell dominates the 30px thumbnail.
                      contentVisibility: 'auto',
                      containIntrinsicSize: '0 50px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
                      {docSelectMode ? (
                        <span style={{ width: 14, height: 14, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--border-strong)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {isChecked && <Icon name="check" size={10} color="var(--accent-text)" />}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const trigger = e.currentTarget;
                            const rect = e.currentTarget.getBoundingClientRect();
                            setDocMenu((cur) => (cur && cur.id === d.id ? null : { id: d.id, rect, trigger }));
                          }}
                          className="hub-icon-btn"
                          title="More" aria-label="More"
                        ><Icon name="more" size={14} /></button>
                      )}
                    </div>
                    {/* Thumbnail column — its own cell, centred so every
                        thumbnail lines up under the next. A real first-page
                        render, fixed in height with width set to the page's
                        true aspect ratio. Shares the by-id render cache with
                        the preview pane; falls back to the stylised
                        placeholder on failure. */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PdfPageThumb
                        doc={d.raw}
                        downloadDocument={downloadDocument}
                        variant="row"
                        height={30}
                        fallback={<div style={{ width: 23, height: 30, flex: 'none' }}><PdfThumb height={30} stamp="" color={d.color} /></div>}
                      />
                    </div>
                    <div style={stickyCell(docSelectMode ? isChecked : isSel)}>
                      <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{d.name}</span>
                    </div>
                    <span className="meta" style={{ fontSize: 12, padding: '12px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.project === 'Sandbox' ? <span className="mono" style={{ color: 'var(--text-3)' }}>N/A</span> : d.project}</span>
                    <div className="mono" style={{ fontSize: 11, padding: '10px 0', lineHeight: 1.35 }}>
                      <div style={{ fontWeight: 600 }}>{d.touchedTime}</div>
                      <div style={{ color: 'var(--text-3)' }}>{d.touchedAbs}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 11, padding: '12px 0' }}>{d.size}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {showPreview && sel && (
            /* Preview pane — a fixed-height flex column that NEVER scrolls.
               The preview sits at a set size with a flexible gap below it;
               the details, Collaborators (when shared), Recent activity and
               the action buttons keep their natural size and sit at the
               bottom. */
            <aside style={{ padding: 18, position: 'relative', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 'none' }}>
                <div className="section-label">Preview</div>
                <button onClick={() => setPreviewOpen(false)} title="Close preview" aria-label="Close preview" className="hub-icon-btn"><Icon name="close" size={13} /></button>
              </div>
              <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, flex: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel.name}</div>
              <div className="meta" style={{ marginTop: 4, fontSize: 12, flex: 'none' }}>
                {[sel.project === 'Sandbox' ? null : sel.project, sel.size, sel.pages != null ? countLabel(sel.pages, 'page') : null, sel.rev || null].filter(Boolean).join(' · ')}
              </div>
              {/* Preview viewport — a set custom size; the page is contained
                  inside at its true aspect ratio, letterboxed against a dark
                  backdrop. It can shrink (never scroll) on a short pane. */}
              <div style={{ marginTop: 14, height: 360, flex: '0 1 auto', minHeight: 0 }}>
                <PdfPageThumb
                  key={sel.id}
                  doc={sel.raw}
                  downloadDocument={downloadDocument}
                  variant="preview"
                  fill
                  priority
                  fallback={
                    <div style={{ width: '100%', height: '100%' }}>
                      <PdfThumb height="100%" color={sel.color} stamp={(sel.rev || '').replace(' ', '')}
                        marks={[
                          { x: 12, y: 36, w: 36, h: 16, color: 'var(--gold)' },
                          { x: 56, y: 50, w: 24, h: 22, color: 'var(--blue)' },
                          { type: 'swatch', x: 18, y: 62, w: 50, h: 6, color: 'var(--accent-soft-strong)' },
                          { x: 60, y: 78, w: 26, h: 10, color: 'var(--slate)' },
                        ]}
                      />
                    </div>
                  }
                />
              </div>
              {/* Team — always shown directly under the preview: at least the
                  document's owner (the signed-in user). A real teammates
                  feature will add more people here later. */}
              <div style={{ marginTop: 14, flex: 'none' }}>
                <div className="section-label">Team</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <Avatar initials={initialsOf(user?.name || user?.email || 'You')} size={22} color={PRESENCE_SELF_TINT} ink={PRESENCE_INK} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{user?.name || user?.email?.split('@')[0] || 'You'}</span>
                </div>
              </div>
              {/* Last edited + Uploaded dates. */}
              <div style={{ marginTop: 14, flex: 'none', display: 'grid', gap: 10 }}>
                <div>
                  <div className="section-label">Last edited</div>
                  <div className="mono" style={{ fontSize: 12, marginTop: 3 }}>{sel.lastEditedAbs}</div>
                </div>
                <div>
                  <div className="section-label">Uploaded</div>
                  <div className="mono" style={{ fontSize: 12, marginTop: 3 }}>{sel.uploadedAbs}</div>
                </div>
              </div>
              {/* Flexible spacer — soaks up spare height so the action buttons
                  stay pinned at the bottom while the Team and dates sit high,
                  just under the preview. */}
              <div style={{ flex: 1, minHeight: 0 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flex: 'none' }}>
                <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onOpenDocument && onOpenDocument(sel.raw)}>Open file</button>
                <button className="btn documents-preview-share" title="Share" aria-label="Share" onClick={() => onShare && onShare([sel.raw])}><Icon name="share" size={16} /></button>
              </div>
            </aside>
          )}
        </div>
        <div className="documents-mobile-list slim-scroll">
          {docs.length === 0 && (
            mapped.length === 0 ? (
              <EmptyState
                icon="doc"
                line="No documents yet"
                description="Upload your first PDF to start surveying."
                actionIcon="upload"
                actionLabel="Upload PDF"
                onAction={() => onUpload && onUpload()}
              />
            ) : (
              <div className="meta" style={{ padding: '18px 4px', fontSize: 12 }}>No documents match your search.</div>
            )
          )}
          {docs.length > 0 && docs.map(renderMobileCard)}
        </div>
        {mobileDetailDoc ? (
          <div className="documents-mobile-detail-scrim" onClick={closeMobileDetail}>
            <section
              ref={mobileDetailModalRef}
              className="documents-mobile-detail-modal slim-scroll"
              role="dialog"
              aria-modal="true"
              aria-label={`${mobileDetailDoc.name} details`}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="documents-mobile-detail-head">
                <div>
                  <span>Document details</span>
                  <strong>{mobileDetailDoc.name}</strong>
                </div>
                <button ref={mobileDetailCloseRef} type="button" title="Close details" aria-label="Close details" onClick={closeMobileDetail} className="hub-icon-btn"><Icon name="close" size={13} /></button>
              </div>
              <div className="documents-mobile-detail-meta">
                {[mobileDetailDoc.project === 'Sandbox' ? null : mobileDetailDoc.project, mobileDetailDoc.size, mobileDetailDoc.pages != null ? countLabel(mobileDetailDoc.pages, 'page') : null].filter(Boolean).join(' · ')}
              </div>
              <div className="documents-mobile-detail-preview">
                <PdfPageThumb
                  doc={mobileDetailDoc.raw}
                  downloadDocument={downloadDocument}
                  variant="preview"
                  fill
                  priority
                  fallback={<PdfThumb height="100%" color={mobileDetailDoc.color} stamp={(mobileDetailDoc.rev || '').replace(' ', '')} />}
                />
              </div>
              <div className="documents-mobile-detail-facts">
                <div>
                  <span>Team</span>
                  <div className="documents-mobile-detail-owner">
                    <Avatar initials={initialsOf(user?.name || user?.email || 'You')} size={22} color={PRESENCE_SELF_TINT} ink={PRESENCE_INK} />
                    <strong>{user?.name || user?.email?.split('@')[0] || 'You'}</strong>
                  </div>
                </div>
                <div><span>Last edited</span><strong>{mobileDetailDoc.lastEditedAbs}</strong></div>
                <div><span>Uploaded</span><strong>{mobileDetailDoc.uploadedAbs}</strong></div>
              </div>
              {/* Same pair as the desktop preview panel: a wide Open file,
                  then Share as an icon at the right (owner: icons over words
                  for actions; phone and desktop match). */}
              <div className="documents-mobile-detail-actions">
                <button type="button" className="btn primary" onClick={() => { setMobileDetailId(null); onOpenDocument && onOpenDocument(mobileDetailDoc.raw); }}>Open file</button>
                <button type="button" className="btn documents-preview-share" title="Share" aria-label="Share" onClick={() => { setMobileDetailId(null); onShare && onShare([mobileDetailDoc.raw]); }}><Icon name="share" size={18} /></button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </HubShell>
    <MoveCopyModal
      open={moveOpen}
      initialMode={moveMode}
      onClose={() => setMoveOpen(false)}
      projects={projects}
      count={selDocs.size}
      onConfirm={async (destId, mode) => {
        await onMoveCopy?.(selectedRaw(), destId, mode);
        clearSel();
      }}
    />
    <RenameModal
      open={!!renameTarget}
      onClose={() => setRenameTarget(null)}
      title="Rename document"
      initialName={renameTarget?.name || ''}
      onConfirm={(name) => onRename?.(renameTarget, name)}
    />
    {docMenu && (() => {
      const doc = docs.find((d) => d.id === docMenu.id);
      if (!doc) return null;
      const locked = doc.raw?.locked_at != null;
      const canLock = user?.id && doc.raw?.user_id === user.id;
      return (
        <DocumentActionMenu
          anchorRect={docMenu.rect}
          onClose={() => setDocMenu(null)}
          items={[
            { label: 'Preview & details', onClick: () => showDocumentDetails(doc) },
            { label: 'Rename', onClick: () => setRenameTarget(doc.raw) },
            { label: 'Copy', onClick: () => setClipboardDoc(doc.raw) },
            { label: 'Paste', disabled: !clipboardDoc, onClick: () => clipboardDoc && onDuplicate && onDuplicate([clipboardDoc]) },
            { label: 'Delete', danger: true, onClick: () => onDelete && onDelete([doc.raw]) },
            { label: 'Share', onClick: () => onShare && onShare([doc.raw]) },
            {
              label: locked ? 'Unlock document' : 'Lock document',
              disabled: !canLock,
              onClick: () => onLockDocument && onLockDocument(doc.raw),
            },
          ]}
        />
      );
    })()}
    </>
  );
}
