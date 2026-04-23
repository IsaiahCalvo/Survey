import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './PrintPanel.css';

/**
 * PrintPanel — custom print dialog for Survey.
 *
 * Built directly from the v3 wireframes (options J and K). A temporary
 * top-bar toggle lets the user flip between the two variants so they can
 * feel both side-by-side; once a winner is picked, the toggle and the
 * losing branch come out.
 *
 * J variant: each customization section carries its own "Apply to" scope
 *   pills — All selected / Pages… / This page.
 * K variant: three scope tabs (All / Select / Current) at the top of the
 *   right rail drive every section below.
 *
 * The panel is non-destructive: closing or canceling discards every setting.
 * Hitting Print forwards the finalized settings via `onPrint(jobSpec)` —
 * the caller is responsible for the actual printer / PDF pipeline.
 */

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const PAPER_OPTIONS = [
  { id: 'auto', label: 'Auto (native size)' },
  { id: 'letter', label: 'Letter · 8.5 × 11 in' },
  { id: 'legal', label: 'Legal · 8.5 × 14 in' },
  { id: 'tabloid', label: 'Tabloid · 11 × 17 in' },
  { id: 'a4', label: 'A4 · 8.27 × 11.69 in' },
  { id: 'a3', label: 'A3 · 11.69 × 16.54 in' },
  { id: 'archD', label: 'Arch D · 24 × 36 in' },
  { id: 'archE', label: 'Arch E · 36 × 48 in' },
  { id: 'match', label: 'Match another page…' },
  { id: 'custom', label: 'Custom W × H…' },
];

const ORIENT_OPTIONS = [
  { id: 'auto-portrait', label: 'Auto portrait' },
  { id: 'auto-landscape', label: 'Auto landscape' },
  { id: 'portrait', label: 'Portrait (force)' },
  { id: 'landscape', label: 'Landscape (force)' },
];

// Fallback page list so the panel can render in isolation (e.g. dev / tests).
const DEFAULT_MOCK_PAGES = Array.from({ length: 12 }, (_, i) => {
  const isLandscape = i < 3 || (i >= 6 && i < 9);
  return { index: i + 1, width: isLandscape ? 36 : 8.5, height: isLandscape ? 24 : 11, isLandscape };
});

// ─────────────────────────────────────────────────────────────────────────
// Range helpers — parse "1,3,4-8" → Set<number>, and back.
// ─────────────────────────────────────────────────────────────────────────

function parseRange(str, totalPages) {
  const out = new Set();
  if (!str || typeof str !== 'string') return out;
  const parts = str.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = Math.max(1, parseInt(m[1], 10));
      let b = Math.min(totalPages, parseInt(m[2], 10));
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 1 && n <= totalPages) out.add(n);
    }
  }
  return out;
}

function compactRange(set) {
  const arr = Array.from(set).sort((a, b) => a - b);
  if (!arr.length) return '';
  const runs = [];
  let start = arr[0];
  let prev = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    const cur = arr[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      runs.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = cur;
      prev = cur;
    }
  }
  return runs.join(', ');
}

// ─────────────────────────────────────────────────────────────────────────
// Small building blocks
// ─────────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange, children }) {
  return (
    <span
      className={`pp-tog ${on ? 'is-on' : ''}`}
      role="switch"
      tabIndex={0}
      aria-checked={on}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!on);
        }
      }}
    >
      <span className="pp-tog-sw" />
      {children}
    </span>
  );
}

// UX 2026-04-23: inline page picker used in the preview header. Behaves
// like an editable combo-box: you can type a page number directly, or
// click the caret to open a floating list capped at ten visible rows and
// scrollable for longer ranges. Typing an unknown page keeps the preview
// on the current page; committing a valid included page jumps to it.
function PagePicker({ value, options, onChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  // Scroll the active row into view whenever the menu opens.
  useEffect(() => {
    if (!menuOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-active="true"]');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }, [menuOpen, value]);

  // Close when clicking outside the picker.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDocMouseDown = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [menuOpen]);

  const commit = useCallback((raw) => {
    const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(n) && options.includes(n)) {
      onChange(n);
      setDraft(String(n));
    } else {
      setDraft(String(value));
    }
  }, [onChange, options, value]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft);
      setMenuOpen(false);
    } else if (e.key === 'Escape') {
      setDraft(String(value));
      setMenuOpen(false);
    } else if (e.key === 'ArrowDown' && !menuOpen) {
      setMenuOpen(true);
    }
  };

  return (
    <span className="pp-ppicker" ref={wrapRef}>
      <input
        ref={inputRef}
        className="pp-preview-page-input"
        type="text"
        inputMode="numeric"
        value={draft}
        aria-label="Jump to page"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onFocus={() => setMenuOpen(true)}
        onClick={() => setMenuOpen(true)}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => {
          // Defer so an option click on the popup still registers.
          setTimeout(() => commit(draft), 120);
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="pp-ppicker-caret"
        aria-label="Open page list"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setMenuOpen((v) => !v);
          inputRef.current?.focus();
        }}
      >▾</button>
      {menuOpen && options.length > 0 && (
        <ul className="pp-ppicker-menu" role="listbox" ref={listRef}>
          {options.map((p) => (
            <li
              key={p}
              role="option"
              aria-selected={p === value}
              data-active={p === value}
              className={`pp-ppicker-opt ${p === value ? 'is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(p);
                setDraft(String(p));
                setMenuOpen(false);
              }}
            >
              Page {p}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

function Dropdown({ value, options, onChange, width }) {
  return (
    <div className="pp-dd" style={width ? { width } : undefined}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
      <span className="pp-dd-caret">▾</span>
    </div>
  );
}

// CCW / CW arrow glyphs — compact, matching the wireframe spec.
const CcwArrow = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M20 14H8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <polyline points="12 8 8 14 12 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CwArrow = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M4 10h12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <polyline points="12 4 16 10 12 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// J-variant scope row: three pills + a "Pages…" text input that's only active
// when the middle pill is selected. The active scope determines what pages
// this particular section applies to.
function ScopePills({ scope, onChange, totalRangeLabel, currentPage }) {
  const setMode = (mode) => onChange({ ...scope, mode });
  const setRange = (range) => onChange({ ...scope, range });
  return (
    <div className="pp-scope-row">
      <span className="pp-scope-label">Apply to</span>
      <button
        className={`pp-pill ${scope.mode === 'all' ? 'is-active' : ''}`}
        type="button"
        onClick={() => setMode('all')}
      >
        All selected
      </button>
      <button
        className={`pp-pill ${scope.mode === 'pages' ? 'is-active' : ''}`}
        type="button"
        onClick={() => setMode('pages')}
      >
        Pages…
      </button>
      <button
        className={`pp-pill ${scope.mode === 'current' ? 'is-active' : ''}`}
        type="button"
        onClick={() => setMode('current')}
      >
        This page
      </button>
      <input
        type="text"
        className="pp-pill-range"
        placeholder="e.g. 2,7-9"
        value={scope.mode === 'all' ? totalRangeLabel : scope.mode === 'current' ? String(currentPage || '') : scope.range}
        onChange={(e) => setRange(e.target.value)}
        onFocus={() => setMode('pages')}
        disabled={scope.mode !== 'pages'}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export default function PrintPanel({
  open,
  onClose,
  onPrint,
  docName = 'Untitled.pdf',
  pages,
  printers = [{ id: 'default', label: 'System printer (default)' }],
  defaultVariant = 'J',
  getThumbnail, // (pageNumber, { targetWidth }) => Promise<{ src, width, height } | null>
}) {
  const effectivePages = pages && pages.length ? pages : DEFAULT_MOCK_PAGES;
  const totalPages = effectivePages.length;

  // Root state
  const [variant, setVariant] = useState(defaultVariant);
  const [pagesToPrint, setPagesToPrint] = useState(`1-${totalPages}`);
  const [currentPage, setCurrentPage] = useState(1);
  const [bigPreviewOpen, setBigPreviewOpen] = useState(false);
  const [bigPreviewZoom, setBigPreviewZoom] = useState(1);

  // J-variant: per-section scope + value
  const defaultScope = { mode: 'all', range: '' };
  const [paperScopeJ, setPaperScopeJ] = useState(defaultScope);
  const [orientScopeJ, setOrientScopeJ] = useState(defaultScope);
  const [outputScopeJ, setOutputScopeJ] = useState(defaultScope);

  // K-variant: top-level scope tab + the Select range
  const [kScope, setKScope] = useState('all'); // 'all' | 'select' | 'current'
  const [kSelectRange, setKSelectRange] = useState('');

  // Shared customization values (each variant stores its own answer for the
  // section, but since the settings themselves are identical, one state bag
  // per section serves both).
  const [paperSize, setPaperSize] = useState('auto');
  const [fitMode, setFitMode] = useState('proportional'); // 'proportional' | 'stretch'
  const [orientation, setOrientation] = useState('auto-portrait');
  const [mirrorH, setMirrorH] = useState(false);
  const [mirrorV, setMirrorV] = useState(false);
  const [markupsOn, setMarkupsOn] = useState(true);
  const [colorOn, setColorOn] = useState(true);

  // Job-level
  const [copies, setCopies] = useState(1);
  const [collate, setCollate] = useState(true);
  const [duplex, setDuplex] = useState(false);
  const [destination, setDestination] = useState(printers[0]?.id || 'default');

  // Thumbnail + preview image cache — { [pageNum]: { src, width, height } }
  const [thumbCache, setThumbCache] = useState({});
  const [previewImg, setPreviewImg] = useState(null); // larger render for preview

  // Fetch thumbnails lazily. Syncfusion's `getThumbnailDataUrl` reads from
  // the already-rendered page canvas cache, so only pages the user has
  // scrolled near will resolve. For pages not yet in view, we retry briefly.
  useEffect(() => {
    if (!open || typeof getThumbnail !== 'function' || !effectivePages?.length) return;
    let cancelled = false;
    console.log('[PrintPanel] fetchThumbs start, getThumbnail type:', typeof getThumbnail);
    const order = effectivePages
      .map((p) => ({ idx: p.index, dist: Math.abs(p.index - currentPage) }))
      .sort((a, b) => a.dist - b.dist);
    (async () => {
      for (const { idx } of order) {
        if (cancelled) return;
        if (thumbCache[idx]) continue;
        try {
          const img = await getThumbnail(idx, { targetWidth: 140 });
          if (cancelled) return;
          if (img?.src) {
            console.log(`[PrintPanel] thumb ready page=${idx} (${img.width}×${img.height})`);
            setThumbCache((prev) => ({ ...prev, [idx]: img }));
          } else {
            console.log(`[PrintPanel] thumb not yet ready page=${idx} (returned ${img === null ? 'null' : 'no src'})`);
          }
        } catch (err) {
          console.warn(`[PrintPanel] thumb fetch failed page=${idx}:`, err?.message || err);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, getThumbnail, effectivePages, currentPage]);

  // Load a larger render of the current page for the main preview.
  useEffect(() => {
    if (!open || typeof getThumbnail !== 'function' || !currentPage) return;
    let cancelled = false;
    console.log(`[PrintPanel] fetchPreview start page=${currentPage}`);
    (async () => {
      try {
        const img = await getThumbnail(currentPage, { targetWidth: 720 });
        if (cancelled) return;
        if (img?.src) {
          console.log(`[PrintPanel] preview ready page=${currentPage} (${img.width}×${img.height})`);
          setPreviewImg({ page: currentPage, ...img });
        } else {
          console.log(`[PrintPanel] preview not ready page=${currentPage}`);
        }
      } catch (err) {
        console.warn(`[PrintPanel] preview fetch failed page=${currentPage}:`, err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [open, getThumbnail, currentPage]);

  // Derived: which pages are included in the top-level print range
  const includedSet = useMemo(
    () => parseRange(pagesToPrint, totalPages),
    [pagesToPrint, totalPages]
  );
  const includedCount = includedSet.size;
  const totalRangeLabel = useMemo(() => compactRange(includedSet), [includedSet]);

  // Clamp the current-page pointer to the included set.
  useEffect(() => {
    if (!includedSet.size) return;
    if (!includedSet.has(currentPage)) {
      const first = Array.from(includedSet).sort((a, b) => a - b)[0];
      setCurrentPage(first);
    }
  }, [includedSet, currentPage]);

  const includedOrdered = useMemo(
    () => Array.from(includedSet).sort((a, b) => a - b),
    [includedSet]
  );
  const currentIndexInIncluded = Math.max(0, includedOrdered.indexOf(currentPage));

  // UX 2026-04-23: the pager strip under the preview shows a sliding window
  // of at most 10 page rectangles so it never wraps to a second row, even on
  // a 99-page PDF. When the user advances past the 10th included page, the
  // earliest rectangle drops off the left; going back does the reverse. The
  // window only shifts when the current page would otherwise fall outside
  // it, so a stationary user sees a stable row.
  const PAGER_WINDOW = 10;
  const [pagerWindowStart, setPagerWindowStart] = useState(0);
  useEffect(() => {
    const total = includedOrdered.length;
    if (total <= PAGER_WINDOW) {
      if (pagerWindowStart !== 0) setPagerWindowStart(0);
      return;
    }
    const maxStart = Math.max(0, total - PAGER_WINDOW);
    setPagerWindowStart((prev) => {
      let next = prev;
      if (currentIndexInIncluded < next) next = currentIndexInIncluded;
      else if (currentIndexInIncluded > next + PAGER_WINDOW - 1) {
        next = currentIndexInIncluded - PAGER_WINDOW + 1;
      }
      return Math.max(0, Math.min(maxStart, next));
    });
  }, [currentIndexInIncluded, includedOrdered.length, pagerWindowStart]);
  const visiblePagerPages = includedOrdered.slice(
    pagerWindowStart,
    pagerWindowStart + PAGER_WINDOW
  );

  const gotoDelta = useCallback((delta) => {
    if (!includedOrdered.length) return;
    const next = includedOrdered[Math.min(includedOrdered.length - 1, Math.max(0, currentIndexInIncluded + delta))];
    if (next) setCurrentPage(next);
  }, [includedOrdered, currentIndexInIncluded]);

  // Keyboard: ← / → step through pages, Esc closes, ⌘/Ctrl+Enter prints.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (bigPreviewOpen) setBigPreviewOpen(false);
        else onClose?.();
      } else if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        const isInField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
        if (!isInField) { e.preventDefault(); gotoDelta(1); }
      } else if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        const isInField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
        if (!isInField) { e.preventDefault(); gotoDelta(-1); }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bigPreviewOpen, gotoDelta]);

  const togglePageInclusion = useCallback((pageNum) => {
    const next = new Set(includedSet);
    if (next.has(pageNum)) next.delete(pageNum);
    else next.add(pageNum);
    setPagesToPrint(compactRange(next) || '');
  }, [includedSet]);

  const curPage = effectivePages.find((p) => p.index === currentPage) || effectivePages[0];
  const isLandscapePage = !!curPage?.isLandscape;

  // UX 2026-04-23: every per-section scope is clamped to the pages the user
  // chose in the top row. Typing "1-99" in a section's Pages… field when the
  // top row is narrowed to 4-8 silently collapses to 4-8 — otherwise a
  // section could claim to apply to a page the user never chose to print,
  // and the preview/print pipeline would pretend to act on pages outside the
  // print range. This is the single source of truth for that clamp.
  const intersectWithIncluded = useCallback((pageSet) => {
    const out = new Set();
    for (const n of pageSet) if (includedSet.has(n)) out.add(n);
    return out;
  }, [includedSet]);

  // K Select range, clamped to the top-row included set.
  const kSelectEffectiveSet = useMemo(
    () => intersectWithIncluded(parseRange(kSelectRange, totalPages)),
    [kSelectRange, totalPages, intersectWithIncluded]
  );

  // Whether a J-variant section scope currently applies to the previewed page.
  const applyToCurrent = useCallback((scope) => {
    if (!scope) return true;
    // Any scope that doesn't include the current page in the top-row set is
    // automatically not applying — a section can never touch pages that
    // aren't being printed.
    if (!includedSet.has(currentPage)) return false;
    if (scope.mode === 'all') return true;
    if (scope.mode === 'current') return true;
    if (scope.mode === 'pages') {
      return intersectWithIncluded(parseRange(scope.range, totalPages)).has(currentPage);
    }
    return false;
  }, [includedSet, currentPage, totalPages, intersectWithIncluded]);

  // For K: every section's scope is the single `kScope`, also clamped to
  // the top-row included set.
  const kScopeAppliesToCurrent = useMemo(() => {
    if (!includedSet.has(currentPage)) return false;
    if (kScope === 'all') return true;
    if (kScope === 'current') return true;
    if (kScope === 'select') return kSelectEffectiveSet.has(currentPage);
    return false;
  }, [kScope, kSelectEffectiveSet, includedSet, currentPage]);

  // Mirror/rotation preview class — gated by which section's scope they belong
  // to. For J, mirror lives in the Orient section; for K, it's just kScope.
  const mirrorAppliesHere = variant === 'J'
    ? applyToCurrent(orientScopeJ)
    : kScopeAppliesToCurrent;

  const bwAppliesHere = variant === 'J'
    ? applyToCurrent(outputScopeJ) && !colorOn
    : kScopeAppliesToCurrent && !colorOn;

  const markupsShowOnPreview = variant === 'J'
    ? (applyToCurrent(outputScopeJ) ? markupsOn : true)
    : (kScopeAppliesToCurrent ? markupsOn : true);

  // Quick "Current · page N" tab label for K.
  const kTabLabels = {
    all: `All`,
    select: `Select`,
    current: `Current`,
  };
  const kTabSubs = {
    all: `every page · ${includedCount}`,
    select: `page range · ${kSelectEffectiveSet.size}`,
    current: `page ${currentPage} · 1`,
  };

  // ─── Actions ──────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    const jobSpec = {
      docName,
      variant,
      includedPages: includedOrdered,
      settings: {
        paperSize, fitMode, orientation,
        mirrorH, mirrorV,
        markupsOn, colorOn,
        copies, collate, duplex,
        destination,
      },
      scopes: variant === 'J'
        ? { paper: paperScopeJ, orient: orientScopeJ, output: outputScopeJ }
        : { all: kScope, selectRange: kSelectRange },
    };
    console.log('[PrintPanel] PRINT pressed → jobSpec:', jobSpec);
    onPrint?.(jobSpec);
  }, [
    docName, variant, includedOrdered,
    paperSize, fitMode, orientation, mirrorH, mirrorV, markupsOn, colorOn,
    copies, collate, duplex, destination,
    paperScopeJ, orientScopeJ, outputScopeJ, kScope, kSelectRange, onPrint,
  ]);

  // Diagnostic — fires every time the panel transitions open/closed so we can
  // confirm mount + teardown in the log.
  useEffect(() => {
    if (open) {
      console.log('[PrintPanel] RENDER — panel opened with', {
        totalPages, variant, docName,
        initialIncludedCount: includedCount,
        printers: printers.map((p) => p.id),
      });
    } else {
      console.log('[PrintPanel] RENDER — panel closed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Diagnostic — log each significant control change so the full user flow
  // is reproducible from a log dump.
  useEffect(() => { if (open) console.log('[PrintPanel] variant =', variant); }, [variant, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] pagesToPrint =', pagesToPrint, '→ included:', includedCount); }, [pagesToPrint, includedCount, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] currentPage =', currentPage); }, [currentPage, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] paperSize =', paperSize, 'fitMode =', fitMode); }, [paperSize, fitMode, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] orientation =', orientation); }, [orientation, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] mirrorH =', mirrorH, 'mirrorV =', mirrorV); }, [mirrorH, mirrorV, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] markupsOn =', markupsOn, 'colorOn =', colorOn); }, [markupsOn, colorOn, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] copies =', copies, 'collate =', collate, 'duplex =', duplex); }, [copies, collate, duplex, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] destination =', destination); }, [destination, open]);
  useEffect(() => { if (open && variant === 'J') console.log('[PrintPanel][J] paperScope =', paperScopeJ); }, [paperScopeJ, variant, open]);
  useEffect(() => { if (open && variant === 'J') console.log('[PrintPanel][J] orientScope =', orientScopeJ); }, [orientScopeJ, variant, open]);
  useEffect(() => { if (open && variant === 'J') console.log('[PrintPanel][J] outputScope =', outputScopeJ); }, [outputScopeJ, variant, open]);
  useEffect(() => { if (open && variant === 'K') console.log('[PrintPanel][K] kScope =', kScope, 'kSelectRange =', kSelectRange); }, [kScope, kSelectRange, variant, open]);
  useEffect(() => { if (open) console.log('[PrintPanel] bigPreviewOpen =', bigPreviewOpen); }, [bigPreviewOpen, open]);

  const handleCancel = useCallback((source) => {
    console.log(`[PrintPanel] CLOSE via ${source}`);
    onClose?.();
  }, [onClose]);

  if (!open) return null;

  // ─── Render helpers ───────────────────────────────────────────────────

  const renderThumb = (page) => {
    const included = includedSet.has(page.index);
    const isCurrent = page.index === currentPage;
    const kBadges = [];
    if (variant === 'K' && kScope === 'select' && kSelectEffectiveSet.has(page.index)) {
      kBadges.push(<span key="s" className="pp-thumb-bd bd-sel">S</span>);
    }
    const thumb = thumbCache[page.index];
    // UX 2026-04-23: each thumb is a vertical cell with the page preview on
    // top and the page number as a label below. Overlaying the number used
    // to be unreadable when the PDF page had dark or busy content at the
    // bottom edge; pulling it out gives consistent contrast and leaves the
    // preview entirely visible.
    return (
      <div
        key={page.index}
        className={`pp-thumb-cell ${included ? '' : 'is-excluded'} ${isCurrent ? 'is-current' : ''}`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          console.log(`[PrintPanel] thumb click page=${page.index} alt=${!!e.altKey} meta=${!!e.metaKey} currentlyIncluded=${included}`);
          if (e.altKey) {
            togglePageInclusion(page.index);
          } else {
            if (!included) togglePageInclusion(page.index);
            setCurrentPage(page.index);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setCurrentPage(page.index);
          if (e.key === ' ') { e.preventDefault(); togglePageInclusion(page.index); }
        }}
        title={`Page ${page.index}${included ? '' : ' (excluded — alt-click or click to include)'} · click to view, alt-click to toggle`}
      >
        <div className={`pp-thumb ${page.isLandscape ? 'is-landscape' : ''}`}>
          {thumb?.src ? (
            <img
              src={thumb.src}
              alt={`Page ${page.index}`}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
            />
          ) : (
            <div className="pp-thumb-face" />
          )}
          {kBadges.length > 0 && <div className="pp-thumb-badges">{kBadges}</div>}
        </div>
        <div className="pp-thumb-num">{page.index}</div>
      </div>
    );
  };

  // ─── Right rail: J variant ────────────────────────────────────────────
  const renderRailJ = () => (
    <div
      className="pp-rail"
      aria-label="Print options"
      style={{ flex: '0 0 360px', width: 360, minWidth: 360, maxWidth: 360, display: 'block', background: '#242428', borderLeft: '1px solid #333' }}
      ref={(node) => { if (node) console.log('[PrintPanel][J] rail mounted, rect:', node.getBoundingClientRect()); }}
    >
      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Page size</span>
        </div>
        <ScopePills scope={paperScopeJ} onChange={setPaperScopeJ} totalRangeLabel={totalRangeLabel} currentPage={currentPage} />
        <Dropdown value={paperSize} options={PAPER_OPTIONS} onChange={setPaperSize} />
        <div className="pp-fit-row">
          <span className="pp-hint" style={{ margin: 0 }}>Fit</span>
          <div className="pp-seg">
            <button className={fitMode === 'proportional' ? 'is-active' : ''} onClick={() => setFitMode('proportional')}>Proportional</button>
            <button className={fitMode === 'stretch' ? 'is-active' : ''} onClick={() => setFitMode('stretch')}>Stretch</button>
          </div>
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Page orientation</span>
          <span className="pp-section-hint">auto matches each page's aspect</span>
        </div>
        <ScopePills scope={orientScopeJ} onChange={setOrientScopeJ} totalRangeLabel={totalRangeLabel} currentPage={currentPage} />
        <div className="pp-orient-row">
          <Dropdown value={orientation} options={ORIENT_OPTIONS} onChange={setOrientation} />
          <div className="pp-rotbtns" aria-label="Rotate content">
            <button className="pp-rbtn" title="Rotate counter-clockwise 90°" type="button">
              <CcwArrow /><span>CCW</span>
            </button>
            <button className="pp-rbtn" title="Rotate clockwise 90°" type="button">
              <CwArrow /><span>CW</span>
            </button>
          </div>
        </div>
        <div className="pp-tog-row">
          <Toggle on={mirrorH} onChange={setMirrorH}>Mirror H</Toggle>
          <Toggle on={mirrorV} onChange={setMirrorV}>Mirror V</Toggle>
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Output</span>
        </div>
        <ScopePills scope={outputScopeJ} onChange={setOutputScopeJ} totalRangeLabel={totalRangeLabel} currentPage={currentPage} />
        <div className="pp-tog-row">
          <Toggle on={markupsOn} onChange={setMarkupsOn}>Markups</Toggle>
          <Toggle on={colorOn} onChange={setColorOn}>Color</Toggle>
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Copies</span>
          <span className="pp-section-hint">whole job</span>
        </div>
        <div className="pp-copies-row">
          <div className="pp-stepper">
            <button type="button" onClick={() => setCopies((c) => Math.max(1, c - 1))} aria-label="Fewer copies">−</button>
            <input value={copies} onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            <button type="button" onClick={() => setCopies((c) => Math.min(999, c + 1))} aria-label="More copies">+</button>
          </div>
          <Toggle on={collate} onChange={setCollate}>Collate</Toggle>
          <Toggle on={duplex} onChange={setDuplex}>Duplex</Toggle>
        </div>
        <div className="pp-section-hint" style={{ marginTop: 4, marginLeft: 0 }}>
          Collate: 1,2,3 / 1,2,3 · Off: 1,1 / 2,2
        </div>
      </div>
    </div>
  );

  // ─── Right rail: K variant ────────────────────────────────────────────
  const renderRailK = () => (
    <div
      className="pp-rail"
      aria-label="Print options"
      style={{ flex: '0 0 360px', width: 360, minWidth: 360, maxWidth: 360, display: 'block', background: '#242428', borderLeft: '1px solid #333' }}
      ref={(node) => { if (node) console.log('[PrintPanel][K] rail mounted, rect:', node.getBoundingClientRect()); }}
    >
      <div className="pp-scope-tabs" role="tablist" aria-label="Customization scope">
        {['all', 'select', 'current'].map((id) => (
          <button
            key={id}
            type="button"
            className={`pp-scope-tab ${kScope === id ? 'is-active' : ''}`}
            onClick={() => setKScope(id)}
            role="tab"
            aria-selected={kScope === id}
          >
            {kTabLabels[id]}
            <small>{kTabSubs[id]}</small>
          </button>
        ))}
      </div>
      {kScope === 'select' && (
        <div className="pp-scope-select-input">
          <span className="pp-scope-label">Pages</span>
          <input
            type="text"
            placeholder="e.g. 2, 7-9"
            value={kSelectRange}
            onChange={(e) => setKSelectRange(e.target.value)}
          />
        </div>
      )}

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Page size</span>
        </div>
        <Dropdown value={paperSize} options={PAPER_OPTIONS} onChange={setPaperSize} />
        <div className="pp-fit-row">
          <span className="pp-hint" style={{ margin: 0 }}>Fit</span>
          <div className="pp-seg">
            <button className={fitMode === 'proportional' ? 'is-active' : ''} onClick={() => setFitMode('proportional')}>Proportional</button>
            <button className={fitMode === 'stretch' ? 'is-active' : ''} onClick={() => setFitMode('stretch')}>Stretch</button>
          </div>
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Page orientation</span>
          <span className="pp-section-hint">auto matches aspect</span>
        </div>
        <div className="pp-orient-row">
          <Dropdown value={orientation} options={ORIENT_OPTIONS} onChange={setOrientation} />
          <div className="pp-rotbtns" aria-label="Rotate content">
            <button className="pp-rbtn" title="Rotate counter-clockwise 90°" type="button">
              <CcwArrow /><span>CCW</span>
            </button>
            <button className="pp-rbtn" title="Rotate clockwise 90°" type="button">
              <CwArrow /><span>CW</span>
            </button>
          </div>
        </div>
        <div className="pp-tog-row">
          <Toggle on={mirrorH} onChange={setMirrorH}>Mirror H</Toggle>
          <Toggle on={mirrorV} onChange={setMirrorV}>Mirror V</Toggle>
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Output</span>
        </div>
        <div className="pp-tog-row">
          <Toggle on={markupsOn} onChange={setMarkupsOn}>Markups</Toggle>
          <Toggle on={colorOn} onChange={setColorOn}>Color</Toggle>
        </div>
      </div>

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Copies</span>
          <span className="pp-section-hint">whole job</span>
        </div>
        <div className="pp-copies-row">
          <div className="pp-stepper">
            <button type="button" onClick={() => setCopies((c) => Math.max(1, c - 1))} aria-label="Fewer copies">−</button>
            <input value={copies} onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            <button type="button" onClick={() => setCopies((c) => Math.min(999, c + 1))} aria-label="More copies">+</button>
          </div>
          <Toggle on={collate} onChange={setCollate}>Collate</Toggle>
          <Toggle on={duplex} onChange={setDuplex}>Duplex</Toggle>
        </div>
      </div>
    </div>
  );

  // ─── Sheet render (preview box) ──────────────────────────────────────
  const aspect = curPage ? (curPage.width / curPage.height) : (8.5 / 11);
  // Max box 320×260 in preview, sheet fits within.
  const maxW = 320, maxH = 260;
  let sheetW, sheetH;
  if (aspect >= 1) {
    sheetW = Math.min(maxW, maxH * aspect);
    sheetH = sheetW / aspect;
  } else {
    sheetH = Math.min(maxH, maxW / aspect);
    sheetW = sheetH * aspect;
  }

  const sheetClass = [
    'pp-preview-sheet',
    bwAppliesHere ? 'is-bw' : '',
    mirrorAppliesHere && mirrorH && mirrorV ? 'is-mirror-hv' : '',
    mirrorAppliesHere && mirrorH && !mirrorV ? 'is-mirror-h' : '',
    mirrorAppliesHere && !mirrorH && mirrorV ? 'is-mirror-v' : '',
  ].filter(Boolean).join(' ');

  // ─── Main render ──────────────────────────────────────────────────────
  return (
    <>
      <div className="pp-backdrop" onClick={() => handleCancel('backdrop click')} />
      <section
        className="pp-root"
        role="dialog"
        aria-label="Print"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pp-titlebar">
          <div className="pp-title">
            <span className="pp-title-name">Print — {docName}</span>
            <span className="pp-title-count">· {totalPages} pages</span>
          </div>
          <div className="pp-title-actions">
            {/* TEMP — remove once a winner is chosen */}
            <div className="pp-variant-toggle" role="group" aria-label="Compare design variant">
              <span className="pp-variant-label">variant</span>
              <button
                type="button"
                className={variant === 'J' ? 'is-active' : ''}
                onClick={() => setVariant('J')}
              >J</button>
              <button
                type="button"
                className={variant === 'K' ? 'is-active' : ''}
                onClick={() => setVariant('K')}
              >K</button>
            </div>
            <button className="pp-close" onClick={() => handleCancel('button')} aria-label="Close print panel">✕</button>
          </div>
        </header>

        <div className="pp-body">
          {/* Top scope bar — shared between J and K. */}
          <div className="pp-topbar">
            <div className="pp-topbar-row">
              <span className="pp-label">Pages to print</span>
              <input
                className="pp-range-input"
                value={pagesToPrint}
                onChange={(e) => setPagesToPrint(e.target.value)}
                placeholder={`1-${totalPages}`}
              />
              <div className="pp-quicks">
                <button type="button" className="pp-quick" onClick={() => setPagesToPrint(`1-${totalPages}`)}>All</button>
                <button type="button" className="pp-quick" onClick={() => setPagesToPrint(String(currentPage))}>Current view</button>
                <button type="button" className="pp-quick" onClick={() => setPagesToPrint('')}>Clear</button>
              </div>
              <span className="pp-hint">Type <span className="pp-kbd">1,3,4-8</span> · or click thumbnails to toggle</span>
              <span className="pp-totals"><strong>{includedCount}</strong> of {totalPages} included</span>
            </div>
            <div className="pp-strip" role="list" aria-label="Pages">
              {effectivePages.map(renderThumb)}
            </div>
          </div>

          {/* Mid: preview + right rail */}
          <div
            className="pp-mid"
            style={{ display: 'flex', flexDirection: 'row', minHeight: 0, minWidth: 0, overflow: 'hidden', height: '100%' }}
            ref={(node) => { if (node) console.log('[PrintPanel] pp-mid mounted, rect:', node.getBoundingClientRect()); }}
          >
            <div className="pp-preview-col">
              <div className="pp-preview-top">
                {/* UX 2026-04-23: preview header shows a compact "viewing
                    page" label and a custom page picker. Users can either
                    type a page number directly into the field OR open a
                    caret-triggered dropdown that shows the full list of
                    included pages, capped at 10 rows tall and scrollable
                    for longer ranges. Invalid typed values snap back to
                    the current page on blur. */}
                <span className="pp-preview-sub">
                  Preview · viewing page&nbsp;
                  <PagePicker
                    value={currentPage}
                    options={includedOrdered}
                    onChange={setCurrentPage}
                  />
                </span>
                <button
                  type="button"
                  className="pp-bigprev-btn"
                  onClick={() => { setBigPreviewZoom(1); setBigPreviewOpen(true); }}
                >
                  ⤢ Bigger preview
                </button>
              </div>
              <div className="pp-preview-stage">
                <div
                  className={sheetClass}
                  style={{ width: `${sheetW}px`, height: `${sheetH}px` }}
                >
                  {previewImg?.page === currentPage && previewImg.src ? (
                    <img
                      src={previewImg.src}
                      alt={`Page ${currentPage}`}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', background: '#fff' }}
                    />
                  ) : (
                    <>
                      <div className="pp-sheet-label">
                        Page {currentPage} · {isLandscapePage ? 'Landscape' : 'Portrait'} · {curPage ? `${curPage.width}×${curPage.height}"` : ''}
                      </div>
                      <div className="pp-sheet-face">Loading page…</div>
                    </>
                  )}
                </div>
              </div>
              <div className="pp-pager">
                <button
                  type="button"
                  className="pp-pager-btn"
                  onClick={() => gotoDelta(-1)}
                  disabled={currentIndexInIncluded <= 0}
                  aria-label="Previous page"
                >‹</button>
                {/* UX 2026-04-23: the "X / Y" label used to live here — it
                    moved up into the preview header as an editable page
                    picker, so this row stays dedicated to the sliding
                    window of page rectangles. */}
                {/* UX 2026-04-23: pager dots only show the pages that will
                    actually print. If the user narrows to "1-3, 5-7", only
                    six rectangles appear. Each rectangle is clickable and
                    jumps the preview to that page — a quick mini-navigator
                    parallel to the ←/→ arrows on either side. */}
                <span className="pp-pager-dots" role="tablist" aria-label="Included pages">
                  {visiblePagerPages.map((pageNum) => {
                    const pg = effectivePages.find((p) => p.index === pageNum);
                    const isCurrent = pageNum === currentPage;
                    return (
                      <button
                        type="button"
                        key={pageNum}
                        className={`pp-pager-dot ${pg?.isLandscape ? 'is-landscape' : ''} ${isCurrent ? 'is-current' : ''}`}
                        onClick={() => {
                          console.log(`[PrintPanel] pager dot click page=${pageNum}`);
                          setCurrentPage(pageNum);
                        }}
                        aria-label={`Jump to page ${pageNum}`}
                        aria-current={isCurrent ? 'page' : undefined}
                        title={`Page ${pageNum}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </span>
                <button
                  type="button"
                  className="pp-pager-btn"
                  onClick={() => gotoDelta(1)}
                  disabled={currentIndexInIncluded >= includedOrdered.length - 1}
                  aria-label="Next page"
                >›</button>
                <span className="pp-pager-kbdhint">← / → keys</span>
              </div>
            </div>
            {variant === 'J' ? renderRailJ() : renderRailK()}
          </div>
        </div>

        {/* Footer */}
        <footer className="pp-footer">
          <div className="pp-footer-dest">
            <span>🖨</span>
            <Dropdown
              value={destination}
              options={[
                ...printers.map((p) => ({ id: p.id, label: p.label })),
                { id: 'pdf', label: 'Save as PDF…' },
              ]}
              onChange={setDestination}
            />
          </div>
          <div className="pp-footer-totals">
            <strong>{includedCount}</strong> pages · <strong>{copies}</strong> {copies === 1 ? 'copy' : 'copies'}
          </div>
          <div className="pp-footer-cta">
            <button type="button" className="pp-btn-cancel" onClick={() => handleCancel('button')}>Cancel</button>
            <button type="button" className="pp-btn-print" disabled={!includedCount} onClick={handlePrint}>
              Print {includedCount} {includedCount === 1 ? 'page' : 'pages'}
            </button>
          </div>
        </footer>

        {/* Bigger preview pop-out */}
        {bigPreviewOpen && (
          <div className="pp-bigprev" onClick={() => setBigPreviewOpen(false)}>
            <div className="pp-bigprev-head" onClick={(e) => e.stopPropagation()}>
              <div>
                Preview · page <strong>{currentPage}</strong> of {totalPages}
                &nbsp;<span style={{ opacity: 0.6 }}>({isLandscapePage ? 'landscape' : 'portrait'})</span>
              </div>
              <div className="pp-bigprev-zoom">
                <button onClick={() => setBigPreviewZoom((z) => Math.max(0.25, z - 0.25))}>−</button>
                <span>{Math.round(bigPreviewZoom * 100)}%</span>
                <button onClick={() => setBigPreviewZoom((z) => Math.min(4, z + 0.25))}>+</button>
                <button onClick={() => setBigPreviewZoom(1)} style={{ width: 'auto', padding: '0 10px' }}>Fit</button>
                <button className="pp-bigprev-close" onClick={() => setBigPreviewOpen(false)} style={{ marginLeft: 8 }}>Close</button>
              </div>
            </div>
            <div className="pp-bigprev-stage" onClick={(e) => e.stopPropagation()}>
              <div
                className={`pp-bigprev-sheet ${sheetClass.replace('pp-preview-sheet', '').trim()}`}
                style={{
                  width: `${900 * bigPreviewZoom}px`,
                  height: `${(900 / aspect) * bigPreviewZoom}px`,
                  transform: 'translate3d(0,0,0)',
                }}
              >
                {previewImg?.page === currentPage && previewImg.src ? (
                  <img
                    src={previewImg.src}
                    alt={`Page ${currentPage}`}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', background: '#fff' }}
                  />
                ) : (
                  <>
                    <div className="pp-sheet-label">
                      Page {currentPage} · {isLandscapePage ? 'Landscape' : 'Portrait'} · {curPage ? `${curPage.width}×${curPage.height}"` : ''}
                    </div>
                    <div className="pp-sheet-face">Loading page…</div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
