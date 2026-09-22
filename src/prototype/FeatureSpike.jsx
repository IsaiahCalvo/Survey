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
import { useCallback, useEffect, useRef, useState } from 'react';
import PdfjsArm from './PdfjsArm';
import { useFrameMeter } from './spikeMetrics';
import { createSpikeLog } from './spikeLogger';
import { extractPdfOutlineBookmarks } from '../utils/bookmarkOutline';
import { buildSortableBookmarkTree, BOOKMARK_INDENTATION_WIDTH } from '../sidebar/bookmarkReorderUtils';

const FIXTURES = [
  { label: 'Real package (36pg)', url: '/debug-fixtures/Package%202%20-%20Rev%204%20--%20IC.pdf' },
  { label: 'Stress PDF (120pg)', url: '/debug-fixtures/spike-120-pages.pdf' },
  { label: 'Large sheet', url: '/debug-fixtures/spike-large-sheet.pdf' },
  { label: 'Annotation test', url: '/debug-fixtures/clickable-link-test.pdf' },
  { label: 'SE-011 (markups)', url: '/debug-fixtures/se011.pdf' },
];

const STRESS_DENSITIES = [0, 100, 300, 500, 600, 1000, 2000];
const QUICK_ZOOMS = [['Fit', 'fit'], ['100%', 1], ['400%', 4], ['1600%', 16]];

function editableTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

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
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover)'; }}
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
  const [tool, setTool] = useState('pen');
  const [penColor, setPenColor] = useState('#e11d48');
  const [penWidth, setPenWidth] = useState(10);
  const [textFontSize, setTextFontSize] = useState(16);
  const [eraserWidth, setEraserWidth] = useState(24);
  const [eraseMode, setEraseMode] = useState('partial');
  const [sloppiness, setSloppiness] = useState(0);
  const [stressDensity, setStressDensity] = useState(0);
  const [performanceMode, setPerformanceMode] = useState(() => (
    new URLSearchParams(window.location.search).get('mode') === 'performance'
  ));
  const [pageCount, setPageCount] = useState(0);
  const [viewerMetrics, setViewerMetrics] = useState({ zoomPct: 100, mounted: 0 });
  const [annotationMetrics, setAnnotationMetrics] = useState({ ms: 0, count: 0, tiled: false });
  const { perf, bumpActivity } = useFrameMeter(performanceMode);
  const logRef = useRef(null);
  if (!logRef.current) logRef.current = createSpikeLog();
  const performanceLog = logRef.current;
  const [logCount, setLogCount] = useState(0);
  const [savedLogMessage, setSavedLogMessage] = useState('');
  const perfRef = useRef(perf);
  const zoomRef = useRef(100);
  const benchmarkMetricsRef = useRef(viewerMetrics);
  const cursorRef = useRef({ x: 0, y: 0 });
  const lastActivityRef = useRef(-1e9);
  const viewerMetricTimerRef = useRef(0);
  const viewerMetricPendingRef = useRef(null);
  const annotationMetricTimerRef = useRef(0);
  const annotationMetricPendingRef = useRef(null);
  const annotationMetricsByPageRef = useRef(new Map());
  const [pdfDoc, setPdfDoc] = useState(null);
  const [searchBox, setSearchBox] = useState(''); // input text
  const [query, setQuery] = useState('');         // applied query (drives highlight)
  const [matchPages, setMatchPages] = useState([]); // page numbers containing a hit
  const [matchIdx, setMatchIdx] = useState(0);
  const [searchInfo, setSearchInfo] = useState('');

  const objUrlRef = useState(() => ({ url: null }))[0];
  const revokePrev = () => { if (objUrlRef.url) { URL.revokeObjectURL(objUrlRef.url); objUrlRef.url = null; } };
  useEffect(() => () => revokePrev(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { perfRef.current = perf; }, [perf]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (performanceMode) url.searchParams.set('mode', 'performance');
    else url.searchParams.delete('mode');
    window.history.replaceState(window.history.state, '', url);
  }, [performanceMode]);

  useEffect(() => {
    if (!performanceMode) return;
    const fileKind = file.src.startsWith('blob:') ? 'local desktop' : 'fixture';
    performanceLog.setContext({ file: file.name, fileKind });
    performanceLog.event('file', { file: file.name, fileKind });
    setLogCount(performanceLog.count());
  }, [file.key, performanceLog, performanceMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!performanceMode) return;
    performanceLog.event('config', {
      stress: stressDensity > 0,
      shapesPerPage: stressDensity,
    });
    setLogCount(performanceLog.count());
  }, [performanceLog, performanceMode, stressDensity]);

  useEffect(() => {
    if (!performanceMode) return undefined;
    let frame;
    let previous = performance.now();
    const tick = (now) => {
      const gap = now - previous;
      previous = now;
      if (gap > 33 && now - lastActivityRef.current < 1200) {
        performanceLog.event('long-frame', { ms: Math.round(gap), zoomPct: zoomRef.current });
        setLogCount(performanceLog.count());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [performanceLog, performanceMode]);

  useEffect(() => {
    if (!performanceMode) return undefined;
    const gesture = { current: null };
    let flushTimer = null;
    const flush = () => {
      const current = gesture.current;
      gesture.current = null;
      if (!current?.ticks) return;
      const durationSeconds = Math.max(0.001, (current.lastAt - current.startedAt) / 1000);
      performanceLog.gesture({
        cursorX: current.cursorX,
        cursorY: current.cursorY,
        ticks: current.ticks,
        durationS: Number(durationSeconds.toFixed(2)),
        ticksPerSec: Math.round(current.ticks / durationSeconds),
        deltaPerSec: Math.round(current.totalDeltaY / durationSeconds),
        startZoomPct: current.startZoom,
        endZoomPct: zoomRef.current,
        zoomPctPerSec: Math.round((zoomRef.current - current.startZoom) / durationSeconds),
        worstFrameMs: Math.round(current.worst),
        stress: stressDensity > 0,
        shapesPerPage: stressDensity,
      });
      setLogCount(performanceLog.count());
    };
    const onMove = (event) => {
      lastActivityRef.current = performance.now();
      bumpActivity();
      cursorRef.current = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
    };
    const onWheel = (event) => {
      lastActivityRef.current = performance.now();
      bumpActivity();
      if (!(event.ctrlKey || event.metaKey)) return;
      const now = performance.now();
      if (!gesture.current) {
        gesture.current = {
          ticks: 0,
          totalDeltaY: 0,
          startedAt: now,
          lastAt: now,
          startZoom: zoomRef.current,
          cursorX: Math.round(event.clientX),
          cursorY: Math.round(event.clientY),
          worst: 0,
        };
      }
      gesture.current.ticks += 1;
      gesture.current.totalDeltaY += event.deltaY;
      gesture.current.lastAt = now;
      gesture.current.worst = Math.max(gesture.current.worst, perfRef.current.worstFrame || 0);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 220);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('wheel', onWheel);
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [bumpActivity, performanceLog, performanceMode, stressDensity]);

  useEffect(() => {
    if (!performanceMode) return undefined;
    const interval = setInterval(() => {
      if (performance.now() - lastActivityRef.current > 1200) return;
      const metrics = benchmarkMetricsRef.current;
      performanceLog.sample({
        zoomPct: zoomRef.current,
        cursorX: cursorRef.current.x,
        cursorY: cursorRef.current.y,
        fps: perfRef.current.fps,
        worstFrameMs: perfRef.current.worstFrame,
        mounted: metrics.mounted,
        rasterMs: metrics.rasterMs,
        clamped: metrics.clamped,
      });
      setLogCount(performanceLog.count());
    }, 250);
    return () => clearInterval(interval);
  }, [performanceLog, performanceMode]);

  const savePerformanceLog = useCallback(async () => {
    try {
      const savedPath = await performanceLog.saveToServer();
      setSavedLogMessage(`saved to ${savedPath}`);
    } catch {
      const filename = performanceLog.save();
      setSavedLogMessage(`downloaded ${filename}`);
    }
    setTimeout(() => setSavedLogMessage(''), 6000);
  }, [performanceLog]);

  useEffect(() => {
    if (!performanceMode) return undefined;
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        savePerformanceLog();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [performanceMode, savePerformanceLog]);

  const applyQuickZoom = useCallback((value) => {
    window.__spikePdfjs?.zoomTo(value === 'fit' ? 'fitw' : value);
    performanceLog.event('quickzoom', { label: String(value) });
    setLogCount(performanceLog.count());
  }, [performanceLog]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (editableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'p') setTool('pen');
      else if (key === 'e') setTool('erase');
      else if (key === 'v') setTool('select');
      else if (key === 't') setTool('text');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => () => {
    if (viewerMetricTimerRef.current) clearTimeout(viewerMetricTimerRef.current);
    if (annotationMetricTimerRef.current) clearTimeout(annotationMetricTimerRef.current);
  }, []);

  const onViewerMetrics = useCallback((metrics) => {
    benchmarkMetricsRef.current = { ...benchmarkMetricsRef.current, ...metrics };
    zoomRef.current = metrics.zoomPct ?? zoomRef.current;
    viewerMetricPendingRef.current = metrics;
    if (viewerMetricTimerRef.current) return;
    viewerMetricTimerRef.current = setTimeout(() => {
      viewerMetricTimerRef.current = 0;
      setViewerMetrics((previous) => ({ ...previous, ...viewerMetricPendingRef.current }));
    }, 120);
  }, []);

  const onAnnotationMetrics = useCallback((_pageIndex, metrics) => {
    annotationMetricsByPageRef.current.set(_pageIndex, metrics);
    annotationMetricPendingRef.current = metrics.mountedRange;
    if (annotationMetricTimerRef.current) return;
    annotationMetricTimerRef.current = setTimeout(() => {
      annotationMetricTimerRef.current = 0;
      const [first, last] = annotationMetricPendingRef.current || [0, -1];
      let count = 0;
      let ms = 0;
      let tiled = false;
      for (const [pageIndex, info] of annotationMetricsByPageRef.current) {
        if (pageIndex < first || pageIndex > last) continue;
        count += info.count || 0;
        ms = Math.max(ms, info.ms || 0);
        tiled = tiled || Boolean(info.tiled);
      }
      setAnnotationMetrics({ count, ms, tiled });
    }, 180);
  }, []);

  const onRasterEvent = useCallback((event) => {
    if (!performanceMode) return;
    performanceLog.event('raster', event);
    setLogCount(performanceLog.count());
  }, [performanceLog, performanceMode]);

  const onZoomPhase = useCallback((phase, data) => {
    if (!performanceMode) return;
    performanceLog.event(`zoom-${phase}`, data || {});
    setLogCount(performanceLog.count());
  }, [performanceLog, performanceMode]);

  const loadFixture = (f) => { revokePrev(); annotationMetricsByPageRef.current.clear(); setTree(null); setBookmarkMsg(''); setPageCount(0); setAnnsByPage({}); setFile((p) => ({ src: f.url, key: p.key + 1, name: f.label })); };
  const loadLocal = (f) => {
    revokePrev();
    const url = URL.createObjectURL(f);
    objUrlRef.url = url;
    annotationMetricsByPageRef.current.clear();
    setTree(null); setBookmarkMsg(''); setPageCount(0); setAnnsByPage({});
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
    setPageCount(pdf.numPages);
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

  const C = {
    panel: '#1c1e21',
    text: '#9aa0a6',
    accent: '#3a7afe',
    good: '#30d158',
    warn: '#ffd60a',
    bad: '#ff453a',
    white: '#fff',
  };
  const fpsColor = perf.fps >= 55 ? C.good : perf.fps >= 30 ? C.warn : C.bad;
  const worstColor = perf.worstFrame <= 18 ? C.good : perf.worstFrame <= 33 ? C.warn : C.bad;

  return (
    <div className="feature-spike-root" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#2a2d31', color: '#e8e8e8', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @media (max-width: 640px) {
          .feature-spike-bookmarks { display: none !important; }
          .feature-spike-topbar { gap: 6px !important; padding: 6px 8px !important; }
          .feature-spike-search { order: 10; margin-left: 0 !important; width: 100%; }
          .feature-spike-search input { flex: 1; min-width: 0; width: auto !important; }
          .feature-spike-file-status { max-width: 100% !important; }
        }
      `}</style>
      {/* top bar */}
      <div className="feature-spike-topbar" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: C.panel, borderBottom: '1px solid #000', flexWrap: 'wrap' }}>
        <strong style={{ color: '#ffcf5c' }}>PDF.js Feature Demo</strong>
        <button
          type="button"
          data-testid="performance-mode-toggle"
          aria-pressed={performanceMode}
          onClick={() => setPerformanceMode((enabled) => !enabled)}
          style={{
            height: 28,
            padding: '0 10px',
            borderRadius: 4,
            cursor: 'pointer',
            border: performanceMode ? '1px solid #30d158' : '1px solid #555',
            background: performanceMode ? '#1f6f36' : '#333',
            color: '#fff',
            fontSize: 12,
            fontWeight: performanceMode ? 650 : 450,
          }}
        >
          Performance {performanceMode ? 'On' : 'Off'}
        </button>
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
        {!performanceMode && (
          <span className="feature-spike-search" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
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
        )}
        <span className="feature-spike-file-status" style={{ fontSize: 12, opacity: 0.8, marginLeft: performanceMode ? 'auto' : 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.name} · {status}
        </span>
      </div>

      <div
        data-testid="annotation-toolbar"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
          background: '#16181a', borderBottom: '1px solid #000', flexWrap: 'nowrap',
          height: 40, minHeight: 40, overflowX: 'auto', overflowY: 'hidden',
          boxSizing: 'border-box', fontSize: 12, color: '#c7cbd1',
        }}
      >
        {[
          ['pen', 'Pen', 'P'],
          ['erase', 'Erase', 'E'],
          ['select', 'Select', 'V'],
          ['text', 'Text', 'T'],
        ].map(([value, label, key]) => (
          <button
            key={value}
            type="button"
            data-tool={value}
            aria-pressed={tool === value}
            onClick={() => setTool(value)}
            style={{
              height: 28, padding: '0 9px', borderRadius: 4, cursor: 'pointer',
              border: tool === value ? '1px solid #79a2ff' : '1px solid #4b5058',
              background: tool === value ? '#2458bd' : '#2b2e33',
              color: '#f4f6f8', fontSize: 12, fontWeight: tool === value ? 650 : 450,
            }}
          >
            {label} <span style={{ opacity: 0.62 }}>{key}</span>
          </button>
        ))}

        <span style={{ width: 1, height: 22, background: '#3d4148' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Pen
          <input
            aria-label="Pen width"
            type="range"
            min="2"
            max="36"
            value={penWidth}
            onChange={(event) => setPenWidth(Number(event.target.value))}
            style={{ width: 78 }}
          />
          <output style={{ minWidth: 28 }}>{penWidth}px</output>
        </label>
        <input
          aria-label="Pen and text color"
          type="color"
          value={penColor}
          onChange={(event) => setPenColor(event.target.value)}
          style={{ width: 28, height: 24, border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Text
          <input
            aria-label="Text size"
            type="range"
            min="8"
            max="48"
            value={textFontSize}
            onChange={(event) => setTextFontSize(Number(event.target.value))}
            style={{ width: 72 }}
          />
          <output style={{ minWidth: 28 }}>{textFontSize}px</output>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Eraser
          <input
            aria-label="Eraser diameter"
            type="range"
            min="4"
            max="80"
            value={eraserWidth}
            onChange={(event) => setEraserWidth(Number(event.target.value))}
            style={{ width: 78 }}
          />
          <output style={{ minWidth: 30 }}>{eraserWidth}px</output>
        </label>
        <select
          aria-label="Erase mode"
          value={eraseMode}
          onChange={(event) => setEraseMode(event.target.value)}
          style={{ height: 28, borderRadius: 4, border: '1px solid #4b5058', background: '#2b2e33', color: '#f4f6f8', padding: '0 6px', fontSize: 12 }}
        >
          <option value="partial">Partial erase</option>
          <option value="full">Full erase</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Sloppiness
          <input
            aria-label="Stroke sloppiness"
            type="range"
            min="0"
            max="100"
            value={sloppiness}
            onChange={(event) => setSloppiness(Number(event.target.value))}
            style={{ width: 72 }}
          />
          <output style={{ minWidth: 24 }}>{sloppiness}</output>
        </label>

        <span style={{ width: 1, height: 22, background: '#3d4148' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Stress
          <select
            aria-label="Synthetic annotations per page"
            value={stressDensity}
            onChange={(event) => setStressDensity(Number(event.target.value))}
            style={{ height: 28, borderRadius: 4, border: '1px solid #4b5058', background: '#2b2e33', color: '#f4f6f8', padding: '0 6px', fontSize: 12 }}
          >
            {STRESS_DENSITIES.map((density) => (
              <option key={density} value={density}>{density ? `${density.toLocaleString()} / page` : 'Off'}</option>
            ))}
          </select>
        </label>

        <span data-testid="viewer-metrics" style={{ marginLeft: 'auto', color: '#9ea4ad', whiteSpace: 'nowrap' }}>
          {viewerMetrics.zoomPct || 100}% · {viewerMetrics.mounted || 0} pages · {viewerMetrics.annotationCount || 0} visible · {annotationMetrics.ms || 0}ms
          {stressDensity && pageCount ? ` · ${(stressDensity * pageCount).toLocaleString()} virtual` : ''}
          {annotationMetrics.tiled ? ' · tiled' : ''}
          {performanceMode ? ` · ${perf.fps} fps · ${perf.worstFrame}ms worst` : ''}
        </span>
      </div>

      {/* body: bookmark panel + viewer */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!performanceMode && (
          <div className="feature-spike-bookmarks" style={{ width: 280, background: '#202327', borderRight: '1px solid #000', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
        )}

        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <PdfjsArm
            fileSrc={file.src}
            fileKey={file.key}
            editMode
            textSelectable={!performanceMode}
            showLinks={!performanceMode}
            showForms={!performanceMode}
            searchQuery={performanceMode ? '' : query}
            annotationTool={tool}
            penColor={penColor}
            penWidth={penWidth}
            textColor={penColor}
            textFontSize={textFontSize}
            eraserWidth={eraserWidth}
            eraseMode={eraseMode}
            sloppiness={sloppiness}
            stressShapesPerPage={stressDensity}
            annsByPage={annsByPage}
            onAnnsChange={onAnns}
            onMetrics={onViewerMetrics}
            onAnnotationRender={onAnnotationMetrics}
            onStatus={setStatus}
            onDocument={onDocument}
            onRasterEvent={onRasterEvent}
            onZoomPhase={onZoomPhase}
          />
        </div>
      </div>

      {performanceMode && (
        <div
          data-testid="performance-gate"
          style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '7px 14px',
            minHeight: 44, height: 44, boxSizing: 'border-box', overflowX: 'auto',
            overflowY: 'hidden', whiteSpace: 'nowrap', background: C.panel,
            borderTop: '1px solid #000', fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {QUICK_ZOOMS.map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => applyQuickZoom(value)}
                style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => window.__spikePdfjs?.rotate?.()}
              style={{ background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}
            >
              Rotate
            </button>
          </div>
          <span style={{ color: C.text }}>zoom <strong style={{ color: C.white }}>{viewerMetrics.zoomPct ?? '—'}%</strong></span>
          <span style={{ color: C.text }}>fps <strong style={{ color: fpsColor }}>{perf.fps}</strong></span>
          <span style={{ color: C.text }}>worst <strong style={{ color: worstColor }}>{perf.worstFrame}ms</strong></span>
          <span style={{ color: C.text }}>mounted <strong style={{ color: C.white }}>{viewerMetrics.mounted ?? '—'}</strong></span>
          <span style={{ color: C.text }}>raster <strong style={{ color: C.white }}>{viewerMetrics.rasterMs ?? '—'}ms</strong></span>
          {perf.heapMB ? <span style={{ color: C.text }}>heap <strong style={{ color: C.white }}>{perf.heapMB}MB</strong></span> : null}
          <span style={{ color: C.text }}>
            gate: fps <strong style={{ color: C.good }}>≥55</strong> · worst <strong style={{ color: C.good }}>≤18ms</strong>
            {stressDensity ? ` · ${stressDensity.toLocaleString()}/page` : ''}
          </span>
          <span style={{ color: C.text }}>log <strong style={{ color: C.white }}>{logCount}</strong></span>
          {savedLogMessage ? <span style={{ color: C.good }}>{savedLogMessage}</span> : null}
          <button
            type="button"
            onClick={savePerformanceLog}
            title="Save performance log (Cmd/Ctrl+Shift+L)"
            style={{ marginLeft: 'auto', background: '#2e7d32', color: '#fff', border: 0, borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}
          >
            Save log
          </button>
        </div>
      )}
    </div>
  );
}
