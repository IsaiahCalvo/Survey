// ============================================================================
// FEATURE SPIKE — THROWAWAY. Renderer-Ownership: prove the pdf.js renderer can
// stand in for everything Pdfjs still does (text-related), before the cutover.
// ============================================================================
// Slim surface to troubleshoot the features Pdfjs currently owns:
//   • BOOKMARKS — detected from the PDF's own outline via pdf.js (nested / grouped /
//     nested-group), shown in a panel that matches the real app's tree model
//     (folders + bookmarks, depth-indented). Click → jump to the page.
//   • (next) text select + copy, find-in-document, clickable links, text markup.
// Reuses the REAL app utils so the data shape is identical to production:
//   extractPdfOutlineBookmarks (pdf.js getOutline walk) + buildSortableBookmarkTree.
// Route: ?spike=features
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import PdfjsArm from './PdfjsArm';
import { extractPdfOutlineBookmarks } from '../utils/bookmarkOutline';
import { buildSortableBookmarkTree, BOOKMARK_INDENTATION_WIDTH } from '../sidebar/bookmarkReorderUtils';

const FIXTURES = [
  { label: 'Real package (36pg)', url: '/debug-fixtures/Package%202%20-%20Rev%204%20--%20IC.pdf' },
  { label: 'Annotation test', url: '/debug-fixtures/clickable-link-test.pdf' },
  { label: 'SE-011 (markups)', url: '/debug-fixtures/se011.pdf' },
];

// recursive nested-tree row — folders expand/collapse, bookmarks jump to their page
function BookmarkNode({ node, depth, collapsed, onToggle, onJump }) {
  const isFolder = node.type === 'folder';
  const isOpen = !collapsed.has(node.id);
  const page = node?.dest?.pageNumber ?? node?.pageIds?.[0] ?? null;
  return (
    <>
      <div
        onClick={() => (isFolder ? onToggle(node.id) : page && onJump(page))}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px', paddingLeft: 8 + depth * BOOKMARK_INDENTATION_WIDTH,
          cursor: 'pointer', fontSize: 13, color: '#dfe2e6', borderRadius: 4,
          userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#2f3439'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        title={page ? `${node.name} — page ${page}` : node.name}
      >
        <span style={{ width: 12, opacity: 0.7, fontSize: 10 }}>
          {isFolder ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span style={{ opacity: 0.85 }}>{isFolder ? '📁' : '🔖'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        {page ? <span style={{ marginLeft: 'auto', opacity: 0.45, fontSize: 11, paddingLeft: 8 }}>p{page}</span> : null}
      </div>
      {isFolder && isOpen && (node.children || []).map((child) => (
        <BookmarkNode key={child.id} node={child} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} onJump={onJump} />
      ))}
    </>
  );
}

export default function FeatureSpike() {
  const [file, setFile] = useState({ src: FIXTURES[0].url, key: 1, name: FIXTURES[0].label });
  const [status, setStatus] = useState('');
  const [tree, setTree] = useState(null); // nested bookmark tree, or null until loaded
  const [collapsed, setCollapsed] = useState(new Set());
  const [bookmarkMsg, setBookmarkMsg] = useState('');
  const [annsByPage, setAnnsByPage] = useState({}); // imported markups, kept interactive
  const onAnns = useCallback((idx, next) => setAnnsByPage((prev) => ({ ...prev, [idx]: next })), []);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [searchBox, setSearchBox] = useState(''); // input text
  const [query, setQuery] = useState('');         // applied query (drives highlight)
  const [matchPages, setMatchPages] = useState([]); // page numbers containing a hit
  const [matchIdx, setMatchIdx] = useState(0);
  const [searchInfo, setSearchInfo] = useState('');

  const objUrlRef = useState(() => ({ url: null }))[0];
  const revokePrev = () => { if (objUrlRef.url) { URL.revokeObjectURL(objUrlRef.url); objUrlRef.url = null; } };
  useEffect(() => () => revokePrev(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFixture = (f) => { revokePrev(); setTree(null); setBookmarkMsg(''); setAnnsByPage({}); setFile((p) => ({ src: f.url, key: p.key + 1, name: f.label })); };
  const loadLocal = (f) => {
    revokePrev();
    const url = URL.createObjectURL(f);
    objUrlRef.url = url;
    setTree(null); setBookmarkMsg(''); setAnnsByPage({});
    setFile((p) => ({ src: url, key: p.key + 1, name: f.name }));
  };

  // run find-in-document: scan every page's text, collect pages with a hit, jump to first
  const runSearch = useCallback(async (text) => {
    const q = text.trim();
    setQuery(q);
    setMatchPages([]); setMatchIdx(0);
    if (!q || !pdfDoc) { setSearchInfo(''); return; }
    setSearchInfo('searching…');
    const ql = q.toLowerCase();
    const pages = [];
    let total = 0;
    for (let p = 1; p <= pdfDoc.numPages; p += 1) {
      try {
        const page = await pdfDoc.getPage(p);
        const tc = await page.getTextContent();
        const joined = tc.items.map((it) => it.str).join('').toLowerCase();
        let count = 0; let from = 0;
        while ((from = joined.indexOf(ql, from)) !== -1) { count += 1; from += ql.length; }
        if (count > 0) { pages.push(p); total += count; }
      } catch { /* skip page */ }
    }
    setMatchPages(pages);
    setSearchInfo(pages.length ? `${total} matches on ${pages.length} pages` : 'no matches');
    if (pages.length) { setMatchIdx(0); window.__spikePdfjs?.goToPage?.(pages[0]); }
  }, [pdfDoc]);

  const nextMatch = useCallback(() => {
    if (!matchPages.length) return;
    const ni = (matchIdx + 1) % matchPages.length;
    setMatchIdx(ni);
    window.__spikePdfjs?.goToPage?.(matchPages[ni]);
  }, [matchPages, matchIdx]);

  // when the renderer hands us the loaded document, pull its outline (nested/grouped)
  const onDocument = useCallback(async (pdf) => {
    setPdfDoc(pdf);
    try {
      const flat = await extractPdfOutlineBookmarks(pdf);
      if (!flat.length) { setTree([]); setBookmarkMsg('No embedded bookmarks in this PDF.'); return; }
      const nested = buildSortableBookmarkTree(flat);
      const folders = flat.filter((b) => b.type === 'folder').length;
      const maxDepth = flat.reduce((m, b) => Math.max(m, (b.outlinePath?.length || 1) - 1), 0);
      setTree(nested);
      setBookmarkMsg(`${flat.length} bookmarks · ${folders} folders · ${maxDepth} levels deep`);
    } catch (e) {
      setTree([]); setBookmarkMsg(`outline error: ${e?.message || e}`);
    }
  }, []);

  const onToggle = useCallback((id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const onJump = useCallback((page) => window.__spikePdfjs?.goToPage?.(page), []);

  const C = { panel: '#1c1e21', text: '#9aa0a6', accent: '#3a7afe' };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#2a2d31', color: '#e8e8e8', fontFamily: 'system-ui, sans-serif' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: C.panel, borderBottom: '1px solid #000', flexWrap: 'wrap' }}>
        <strong style={{ color: '#ffcf5c' }}>🧪 Feature Spike</strong>
        <label style={{ cursor: 'pointer', background: C.accent, padding: '5px 10px', borderRadius: 5, fontSize: 13 }}>
          Load PDF…
          <input type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadLocal(f); }} />
        </label>
        {FIXTURES.map((f) => (
          <button key={f.url} onClick={() => loadFixture(f)}
            style={{ background: file.name === f.label ? '#2b5fd0' : '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', fontSize: 12 }}>
            {f.label}
          </button>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <input
            value={searchBox}
            onChange={(e) => setSearchBox(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(searchBox); }}
            placeholder="Find in document…"
            style={{ background: '#2a2d31', color: '#e8e8e8', border: '1px solid #555', borderRadius: 4, padding: '4px 8px', fontSize: 12, width: 180 }}
          />
          <button onClick={() => runSearch(searchBox)} style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', fontSize: 12 }}>Find</button>
          {matchPages.length > 0 && (
            <button onClick={nextMatch} style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer', fontSize: 12 }}>Next ▾</button>
          )}
          <span style={{ fontSize: 11, color: '#9aa0a6', minWidth: 90 }}>{searchInfo}</span>
        </span>
        <span style={{ fontSize: 12, opacity: 0.8, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.name} · {status}
        </span>
      </div>

      {/* body: bookmark panel + viewer */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 280, background: '#202327', borderRight: '1px solid #000', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #000', fontSize: 12, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
            <strong style={{ color: '#dfe2e6' }}>Bookmarks</strong>
            <span style={{ marginLeft: 'auto', fontSize: 11 }}>{bookmarkMsg}</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
            {tree === null ? (
              <div style={{ padding: 12, color: C.text, fontSize: 12 }}>Loading outline…</div>
            ) : tree.length === 0 ? (
              <div style={{ padding: 12, color: C.text, fontSize: 12 }}>No bookmarks found. Try a PDF with an outline.</div>
            ) : (
              tree.map((node) => (
                <BookmarkNode key={node.id} node={node} depth={0} collapsed={collapsed} onToggle={onToggle} onJump={onJump} />
              ))
            )}
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <PdfjsArm
            fileSrc={file.src}
            fileKey={file.key}
            editMode
            textSelectable
            showLinks
            showForms
            searchQuery={query}
            annsByPage={annsByPage}
            onAnnsChange={onAnns}
            onStatus={setStatus}
            onDocument={onDocument}
          />
        </div>
      </div>
    </div>
  );
}
