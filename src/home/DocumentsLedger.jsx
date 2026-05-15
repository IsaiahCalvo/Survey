/* Survey Hub — Documents tab.
   A sortable ledger of the user's documents with a side preview pane.
   Ported from the Claude Design prototype (survey-hub/layout2-ledger.jsx),
   wired to the real document shape:
     { id, name, file_size, created_at, updated_at, file_path, project_id,
       shared }
   Clicking a row opens that document in the PDF viewer via onOpenDocument.
*/
import React, { useState, useMemo, useEffect } from 'react';
import { Icon, PdfThumb } from './HubShell';

/* bytes -> "12.4 MB" style label */
const formatSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
};

const editedMs = (d) => Date.parse(d?.updated_at || d?.created_at || 0) || 0;
const formatTime = (d) => {
  const ms = editedMs(d);
  if (!ms) return { time: '—', date: '' };
  const dt = new Date(ms);
  return {
    time: dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    date: dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
};

const ledgerHeaderStyle = {
  background: 'var(--ink-700)',
  borderBottom: '1px solid var(--ink-500)',
  fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--ink-200)', fontWeight: 700,
  padding: '8px 0',
};

export default function DocumentsLedger({
  documents = [],
  projects = [],
  search = '',
  onOpenDocument,
  onShare,            // (selectedDocs) => void — opens the share popup
}) {
  const [selId, setSelId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [sortKey, setSortKey] = useState('edited');
  const [sortDir, setSortDir] = useState('desc');
  const [selectMode, setSelectMode] = useState(false);
  const [selDocs, setSelDocs] = useState(() => new Set());

  const projectName = (id) => projects.find((p) => p.id === id)?.name || null;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = documents.filter((d) => !q || (d.name || '').toLowerCase().includes(q));
    const sign = sortDir === 'asc' ? 1 : -1;
    arr = arr.slice().sort((a, b) => {
      if (sortKey === 'name') return sign * (a.name || '').localeCompare(b.name || '');
      if (sortKey === 'project') return sign * (projectName(a.project_id) || '').localeCompare(projectName(b.project_id) || '');
      if (sortKey === 'size') return sign * ((Number(a.file_size) || 0) - (Number(b.file_size) || 0));
      return sign * (editedMs(a) - editedMs(b)); // 'edited'
    });
    return arr;
  }, [documents, projects, search, sortKey, sortDir]);

  // Keep a sensible row selected for the preview pane.
  useEffect(() => {
    if (rows.length && !rows.some((d) => d.id === selId)) setSelId(rows[0].id);
  }, [rows, selId]);

  const sel = rows.find((d) => d.id === selId) || rows[0] || null;

  const onHeaderClick = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'edited' || key === 'size' ? 'desc' : 'asc'); }
  };
  const arrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const toggleDocSel = (id) => setSelDocs((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const isShared = (d) => !!(d && d.shared);
  const grid = previewOpen
    ? '32px minmax(220px,1fr) 130px 130px 80px'
    : '32px 2fr 1fr 1fr 1fr';

  if (!documents.length) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-200)', fontSize: 13 }}>
        No documents yet — upload a PDF to get started.
      </div>
    );
  }

  const selCount = selDocs.size;
  const allSel = selCount === rows.length && rows.length > 0;
  const bulkBtn = (disabled) => ({
    background: 'transparent', border: '1px solid var(--ink-500)', borderRadius: 3,
    padding: '1px 7px', fontSize: 10.5, fontFamily: 'inherit', whiteSpace: 'nowrap',
    height: 20, lineHeight: 1, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  return (
    <div style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Select-mode toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 6px', minHeight: 24 }}>
        <button
          onClick={() => { const next = !selectMode; setSelectMode(next); if (!next) setSelDocs(new Set()); }}
          style={{ background: 'transparent', border: 0, color: 'var(--gold)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, padding: 0 }}
        >
          {selectMode ? 'Done' : 'Select'}
        </button>
        {selectMode && (
          <>
            <button onClick={() => setSelDocs(allSel ? new Set() : new Set(rows.map((d) => d.id)))} style={{ ...bulkBtn(false), color: 'var(--bone-100)' }}>{allSel ? 'None' : 'All'}</button>
            <button disabled={!selCount} style={{ ...bulkBtn(!selCount), color: selCount ? 'var(--bone-100)' : 'var(--ink-300)' }}>Duplicate</button>
            <button disabled={!selCount} style={{ ...bulkBtn(!selCount), color: selCount ? 'var(--bone-100)' : 'var(--ink-300)' }}>Move/Copy</button>
            <button disabled={!selCount} title="Share" onClick={() => onShare && onShare(rows.filter((d) => selDocs.has(d.id)))} style={{ ...bulkBtn(!selCount), color: selCount ? 'var(--bone-100)' : 'var(--ink-300)' }}><Icon name="share" size={12} /></button>
            <button disabled={!selCount} title="Delete" style={{ ...bulkBtn(!selCount), color: selCount ? '#cf6f6f' : 'var(--ink-300)' }}><Icon name="trash" size={12} /></button>
            <span className="meta" style={{ fontSize: 10.5 }}>{selCount} selected</span>
          </>
        )}
      </div>

      <div className="card" style={{ display: 'grid', gridTemplateColumns: previewOpen ? '2.2fr 1fr' : '1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Ledger list */}
        <div className="slim-scroll" style={{ overflow: 'auto', borderRight: previewOpen ? '1px solid var(--ink-500)' : 0 }}>
          <div style={{ ...ledgerHeaderStyle, display: 'grid', gridTemplateColumns: grid, position: 'sticky', top: 0, zIndex: 3 }}>
            <span></span>
            <span onClick={() => onHeaderClick('name')} style={{ padding: '0 14px', display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', color: sortKey === 'name' ? 'var(--bone-100)' : 'inherit' }}>File{arrow('name')}</span>
            <span onClick={() => onHeaderClick('project')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'project' ? 'var(--bone-100)' : 'inherit' }}>Project{arrow('project')}</span>
            <span onClick={() => onHeaderClick('edited')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'edited' ? 'var(--bone-100)' : 'inherit' }}>Last edited{arrow('edited')}</span>
            <span onClick={() => onHeaderClick('size')} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === 'size' ? 'var(--bone-100)' : 'inherit' }}>Size{arrow('size')}</span>
          </div>
          {rows.map((d) => {
            const isSel = sel && d.id === sel.id;
            const isChecked = selDocs.has(d.id);
            const pName = projectName(d.project_id);
            const t = formatTime(d);
            return (
              <div
                key={d.id}
                onClick={() => {
                  if (selectMode) { toggleDocSel(d.id); return; }
                  setSelId(d.id); setPreviewOpen(true);
                }}
                onDoubleClick={() => !selectMode && onOpenDocument && onOpenDocument(d)}
                style={{
                  display: 'grid', gridTemplateColumns: grid, alignItems: 'center',
                  borderBottom: '1px solid var(--ink-600)',
                  borderLeft: !selectMode && isSel ? '2px solid var(--gold)' : '2px solid transparent',
                  background: selectMode ? (isChecked ? 'var(--ink-600)' : 'transparent') : (isSel ? 'var(--ink-600)' : 'transparent'),
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
                  {selectMode ? (
                    <span style={{ width: 14, height: 14, border: `1.4px solid ${isChecked ? 'var(--gold)' : 'var(--ink-300)'}`, background: isChecked ? 'var(--gold)' : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isChecked && <span style={{ color: '#15110a', fontSize: 10, lineHeight: 1 }}>✓</span>}
                    </span>
                  ) : (
                    isShared(d) && <Icon name="users" size={13} color="var(--ink-200)" />
                  )}
                </div>
                <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ width: 22, height: 28, flex: 'none' }}><PdfThumb height={28} /></div>
                  <span style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{d.name}</span>
                </div>
                <span className="meta" style={{ fontSize: 11.5, padding: '12px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pName || <span className="mono" style={{ color: 'var(--ink-300)' }}>N/A</span>}
                </span>
                <div className="mono" style={{ fontSize: 11, padding: '10px 0', lineHeight: 1.35 }}>
                  <div style={{ fontWeight: 600 }}>{t.time}</div>
                  <div style={{ color: 'var(--ink-300)' }}>{t.date}</div>
                </div>
                <span className="mono" style={{ fontSize: 11, padding: '12px 0' }}>{formatSize(d.file_size)}</span>
              </div>
            );
          })}
        </div>

        {/* Preview pane */}
        {previewOpen && sel && (
          <aside className="slim-scroll" style={{ padding: 18, overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="section-label">Preview</div>
              <button onClick={() => setPreviewOpen(false)} title="Close preview" style={{ background: 'transparent', border: '1px solid var(--ink-500)', color: 'var(--ink-200)', width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'grid', placeItems: 'center', padding: 0 }}>×</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, wordBreak: 'break-word' }}>{sel.name}</div>
            <div className="meta" style={{ marginTop: 4, fontSize: 11.5 }}>
              {(projectName(sel.project_id) || 'No project')} · {formatSize(sel.file_size)}
            </div>
            <div style={{ marginTop: 14 }}>
              <PdfThumb height={220} />
            </div>
            <div className="section-label" style={{ marginTop: 16 }}>Last edited</div>
            <div className="meta" style={{ marginTop: 6, fontSize: 11.5 }}>
              {formatTime(sel).time} · {formatTime(sel).date}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onOpenDocument && onOpenDocument(sel)}>Open file</button>
              <button className="btn" title="Share" onClick={() => onShare && onShare([sel])}><Icon name="share" size={12} /></button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
