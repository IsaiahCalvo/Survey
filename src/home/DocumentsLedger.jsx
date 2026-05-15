/* Survey Hub — Documents tab.
   Faithful port of the Claude Design prototype (survey-hub/layout2-ledger.jsx,
   Ledger_Documents): a sortable spec-ledger with a side preview pane.

   The markup, styling, spacing, columns and preview sections mirror the
   mockup element for element. Only the data is swapped: real documents are
   mapped into the display shape the markup expects. Fields the app does not
   store yet (page count, revision, per-event activity) fall back gracefully
   without changing the layout.
*/
import React, { useState, useMemo, useEffect } from 'react';
import { HubShell, Icon, AvatarStack, PdfThumb, Search } from './HubShell';
import { MoveCopyModal, ConfirmModal } from './BulkModals';

const ledgerHeader = {
  background: 'var(--ink-700)',
  borderBottom: '1px solid var(--ink-500)',
  borderTop: 0,
  fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--ink-200)', fontWeight: 700,
  padding: '8px 0',
};

const RIBBON = ['#d8a84e', '#7ab7e6', '#a6e07a', '#c293e6', '#e69a7a', '#9aa3b2'];

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
  onShare,
  onDuplicate,
  onDelete,
  onMoveCopy,
}) {
  const [selId, setSelId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [sortKey, setSortKey] = useState('edited');
  const [sortDir, setSortDir] = useState('desc');
  const [docSelectMode, setDocSelectMode] = useState(false);
  const [selDocs, setSelDocs] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || null;

  // Map each real document into the shape the ledger markup expects.
  const mapped = useMemo(() => documents.map((d, i) => {
    const ms = Date.parse(d.updated_at || d.created_at || 0) || 0;
    const dt = ms ? new Date(ms) : null;
    return {
      raw: d,
      id: d.id,
      name: d.name,
      project: projectName(d.project_id) || 'Sandbox',
      size: formatSize(d.file_size),
      sizeBytes: Number(d.file_size) || 0,
      pages: d.pages ?? d.page_count ?? null,
      rev: d.rev || '',
      editedMs: ms,
      touchedTime: dt ? dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—',
      touchedAbs: dt ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '',
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

  useEffect(() => {
    if (selId == null && docs.length) setSelId(docs[0].id);
  }, [docs, selId]);

  const sel = docs.find((d) => d.id === selId) || docs[0];
  const toggleDocSel = (id) => setSelDocs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const grid = previewOpen
    ? '32px minmax(220px,1fr) 130px 130px 80px'
    : '32px 2fr 1fr 1fr 1fr';
  const isShared = (d) => !!(d && d.shared);
  const stickyCell = (selected) => ({
    position: 'sticky', left: 0, zIndex: 2,
    background: selected ? 'var(--ink-600)' : 'var(--ink-700)',
    padding: '12px 14px',
    display: 'flex', alignItems: 'center', gap: 10,
    minWidth: 0,
  });

  const selectedRaw = () => docs.filter((d) => selDocs.has(d.id)).map((d) => d.raw);
  const clearSel = () => setSelDocs(new Set());

  const subtitle = (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
      <span><b>{docs.length}</b> files</span>
      <button
        onClick={() => { const next = !docSelectMode; setDocSelectMode(next); if (!next) setSelDocs(new Set()); }}
        style={{ background: 'transparent', border: 0, color: 'var(--gold)', borderRadius: 2, padding: 0, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontWeight: 600 }}
      >
        {docSelectMode ? 'Done' : 'Select'}
      </button>
      {docSelectMode && (() => {
        const docSelCount = selDocs.size;
        const allSel = docSelCount === docs.length && docs.length > 0;
        const baseBtn = { background: 'transparent', border: '1px solid var(--ink-500)', borderRadius: 2, padding: '1px 7px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', height: 18, lineHeight: 1, boxSizing: 'border-box', flex: 'none', display: 'inline-flex', alignItems: 'center' };
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
            <button onClick={() => setSelDocs(allSel ? new Set() : new Set(docs.map((d) => d.id)))} style={{ ...baseBtn, color: 'var(--bone-100)' }}>{allSel ? 'None' : 'All'}</button>
            <button disabled={!docSelCount} onClick={() => { onDuplicate && onDuplicate(selectedRaw()); clearSel(); }} style={{ ...baseBtn, color: docSelCount ? 'var(--bone-100)' : 'var(--ink-300)', cursor: docSelCount ? 'pointer' : 'not-allowed' }}>Duplicate</button>
            <button disabled={!docSelCount} onClick={() => setMoveOpen(true)} style={{ ...baseBtn, color: docSelCount ? 'var(--bone-100)' : 'var(--ink-300)', cursor: docSelCount ? 'pointer' : 'not-allowed' }}>Move/Copy</button>
            <button disabled={!docSelCount} title="Share" onClick={() => onShare && onShare(selectedRaw())} style={{ ...baseBtn, color: docSelCount ? 'var(--bone-100)' : 'var(--ink-300)', cursor: docSelCount ? 'pointer' : 'not-allowed' }}><Icon name="share" size={12} /></button>
            <button disabled={!docSelCount} title="Delete" onClick={() => setConfirmDelete(true)} style={{ ...baseBtn, color: docSelCount ? '#cf6f6f' : 'var(--ink-300)', cursor: docSelCount ? 'pointer' : 'not-allowed' }}><Icon name="trash" size={12} /></button>
          </span>
        );
      })()}
    </span>
  );

  const actions = (
    <>
      <Search placeholder="Search Documents..." value={search} onChange={setSearch} />
      <button className="btn primary" onClick={() => onUpload && onUpload()}><Icon name="upload" size={12} />Upload</button>
    </>
  );

  return (
    <>
    <HubShell
      tab="documents"
      onNav={onNav}
      title="Documents"
      subtitle={subtitle}
      actions={actions}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <div style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0 }}>
        <div className="card" style={{ display: 'grid', gridTemplateColumns: previewOpen ? '2.2fr 1fr' : '1fr', height: '100%', overflow: 'hidden' }}>
          <div className="slim-scroll" style={{ overflow: 'auto', borderRight: previewOpen ? '1px solid var(--ink-500)' : 0 }}>
            <div>
              <div style={{ ...ledgerHeader, display: 'grid', gridTemplateColumns: grid, position: 'sticky', top: 0, zIndex: 3 }}>
                <span></span>
                <span onClick={() => onHeaderClick('name')} style={{ position: 'sticky', left: 0, background: 'var(--ink-700)', padding: '0 14px', display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', color: sortKey === 'name' ? 'var(--bone-100)' : 'inherit' }}>File{arrow('name')}</span>
                <span onClick={() => onHeaderClick('project')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'project' ? 'var(--bone-100)' : 'inherit' }}>Project{arrow('project')}</span>
                <span onClick={() => onHeaderClick('edited')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'edited' ? 'var(--bone-100)' : 'inherit' }}>Last edited{arrow('edited')}</span>
                <span onClick={() => onHeaderClick('size')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'size' ? 'var(--bone-100)' : 'inherit' }}>Size{arrow('size')}</span>
              </div>
              {docs.length === 0 && (
                <div className="meta" style={{ padding: '24px 16px', fontSize: 12 }}>No documents yet — upload a PDF to get started.</div>
              )}
              {docs.map((d) => {
                const isSel = sel && d.id === sel.id;
                const isChecked = selDocs.has(d.id);
                return (
                  <div
                    key={d.id}
                    onClick={() => { if (docSelectMode) { toggleDocSel(d.id); return; } setSelId(d.id); setPreviewOpen(true); }}
                    onDoubleClick={() => !docSelectMode && onOpenDocument && onOpenDocument(d.raw)}
                    style={{
                      display: 'grid', gridTemplateColumns: grid, alignItems: 'center',
                      borderBottom: '1px solid var(--ink-600)',
                      borderLeft: !docSelectMode && isSel ? '2px solid var(--gold)' : '2px solid transparent',
                      background: docSelectMode ? (isChecked ? 'var(--ink-600)' : 'transparent') : (isSel ? 'var(--ink-600)' : 'transparent'),
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
                      {docSelectMode ? (
                        <span style={{ width: 14, height: 14, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--ink-300)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {isChecked && <span style={{ color: '#15110a', fontSize: 10, lineHeight: 1 }}>✓</span>}
                        </span>
                      ) : (
                        isShared(d) && <Icon name="users" size={13} color="var(--ink-200)" />
                      )}
                    </div>
                    <div style={stickyCell(docSelectMode ? isChecked : isSel)}>
                      <div style={{ width: 22, height: 28, flex: 'none' }}><PdfThumb height={28} stamp="" color={d.color} /></div>
                      <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{d.name}</span>
                    </div>
                    <span className="meta" style={{ fontSize: 11.5, padding: '12px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.project === 'Sandbox' ? <span className="mono" style={{ color: 'var(--ink-300)' }}>N/A</span> : d.project}</span>
                    <div className="mono" style={{ fontSize: 11, padding: '10px 0', lineHeight: 1.35 }}>
                      <div style={{ fontWeight: 600 }}>{d.touchedTime}</div>
                      <div style={{ color: 'var(--ink-300)' }}>{d.touchedAbs}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 11, padding: '12px 0' }}>{d.size}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {previewOpen && sel && (
            <aside className="slim-scroll" style={{ padding: 18, overflow: 'auto', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="section-label">Preview</div>
                <button onClick={() => setPreviewOpen(false)} title="Close preview" style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: 'var(--ink-200)', width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'grid', placeItems: 'center', padding: 0 }}>×</button>
              </div>
              <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700 }}>{sel.name}</div>
              <div className="meta" style={{ marginTop: 4, fontSize: 11.5 }}>
                {[sel.project === 'Sandbox' ? null : sel.project, sel.size, sel.pages != null ? `${sel.pages} pages` : null, sel.rev || null].filter(Boolean).join(' · ')}
              </div>
              <div style={{ marginTop: 14 }}>
                <PdfThumb height={220} color={sel.color} stamp={(sel.rev || '').replace(' ', '')}
                  marks={[
                    { x: 12, y: 36, w: 36, h: 16, color: 'var(--gold)' },
                    { x: 56, y: 50, w: 24, h: 22, color: 'var(--blue)' },
                    { type: 'swatch', x: 18, y: 62, w: 50, h: 6, color: 'rgba(166,224,122,0.4)' },
                    { x: 60, y: 78, w: 26, h: 10, color: 'var(--rose)' },
                  ]}
                />
              </div>
              {isShared(sel) && (
                <div style={{ marginTop: 14 }}>
                  <div className="section-label">Collaborators</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                    <AvatarStack members={['IC', 'JM', 'RD']} size={16} />
                  </div>
                </div>
              )}
              <div className="section-label" style={{ marginTop: 16 }}>Recent activity</div>
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-200)', display: 'grid', gap: 6 }}>
                <div>· Last edited {sel.touchedTime} · {sel.touchedAbs || 'recently'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onOpenDocument && onOpenDocument(sel.raw)}>Open file</button>
                <button className="btn" title="Share" onClick={() => onShare && onShare([sel.raw])}><Icon name="more" size={12} /></button>
              </div>
            </aside>
          )}
        </div>
      </div>
    </HubShell>
    <MoveCopyModal
      open={moveOpen}
      onClose={() => setMoveOpen(false)}
      projects={projects}
      count={selDocs.size}
      onConfirm={(destId, mode) => { onMoveCopy && onMoveCopy(selectedRaw(), destId, mode); clearSel(); }}
    />
    <ConfirmModal
      open={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      title="Delete documents?"
      message={`${selDocs.size} ${selDocs.size === 1 ? 'document' : 'documents'} will be removed.`}
      confirmLabel="Delete"
      danger
      onConfirm={() => { onDelete && onDelete(selectedRaw()); clearSel(); }}
    />
    </>
  );
}
