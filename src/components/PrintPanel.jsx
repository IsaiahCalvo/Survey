import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DismissBarrier from './DismissBarrier';
import Icon from '../Icons';
import './PrintPanel.css';

const printPanelDebug = (...args) => {
  if (typeof window === 'undefined' || window.__PRINT_PANEL_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

/**
 * PrintPanel — custom print dialog for Survey.
 *
 * Built from the v3 wireframes. Layout K won the J-vs-K comparison
 * (2026-06-12): three scope tabs (All / Select / Current) at the top of
 * the right rail drive every customization section below. The J variant
 * (per-section "Apply to" scope pills) and the temporary titlebar toggle
 * were removed when K was chosen — its density and single-decision scope
 * model match the home screen's design language.
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

// UX 2026-04-24: Acrobat-style orientation model. "Auto" matches each page
// to its own shape (landscape pages print landscape, portrait pages print
// portrait — no rotation applied). The explicit Portrait / Landscape
// entries force every in-scope page into that orientation, rotating as
// needed to achieve it.
// UX 2026-04-24: short labels. Auto matches each page's own shape;
// Portrait and Landscape force every in-scope page to that orientation.
const ORIENT_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
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

// UX 2026-04-24: two-stage input hygiene for every range input.
//  - `filterRangeChars` runs on every keystroke and strips anything that
//    isn't a digit / comma / dash / whitespace, so the user can never
//    type letters or punctuation into a page range field.
//  - `sanitizeRangeInput` runs on blur and normalizes the whole string:
//    reversed ranges like "12-9" are flipped to "9-12" and whitespace
//    around commas is tidied up. Applied everywhere the user types a
//    page range so behavior is consistent across the panel.
function filterRangeChars(raw) {
  return (raw || '').replace(/[^0-9,\-\s]/g, '');
}
// UX 2026-04-24: clamp every typed number in the field to the document's
// total page count so the user physically cannot enter a page that
// doesn't exist. Applied on every keystroke for the top "Pages to print"
// field — typing "999" on a 36-page PDF resolves to "36" as the digits
// land. Empty / partial inputs (e.g. "1-") pass through unchanged so
// mid-typing feels natural.
function clampRangeToMax(raw, max) {
  if (!Number.isFinite(max) || max <= 0) return raw;
  return (raw || '').replace(/\d+/g, (match) => {
    const n = parseInt(match, 10);
    if (!Number.isFinite(n)) return match;
    if (n < 1) return '1';
    if (n > max) return String(max);
    return match;
  });
}
function sanitizeRangeInput(raw, max) {
  const cleaned = filterRangeChars(raw);
  if (!cleaned.trim()) return '';
  const segments = cleaned.split(',').map((seg) => {
    const trimmed = seg.trim();
    if (!trimmed) return '';
    const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (Number.isFinite(max) && max > 0) {
        a = Math.min(Math.max(1, a), max);
        b = Math.min(Math.max(1, b), max);
      }
      if (a > b) [a, b] = [b, a];
      return `${a}-${b}`;
    }
    if (Number.isFinite(max) && max > 0 && /^\d+$/.test(trimmed)) {
      const n = Math.min(Math.max(1, parseInt(trimmed, 10)), max);
      return String(n);
    }
    return trimmed;
  }).filter((s) => s !== '');
  return segments.join(', ');
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

// G6 fix 2026-06-12: parse one "Custom W × H" dimension input. Returns the
// typed value clamped to 1–200 inches (index card → plotter roll), or the
// fallback when the field is empty/garbage. The on-blur handler writes the
// resolved value back into the field, so the user always SEES the number
// that will be used — no silent fallback.
function parseCustomInches(raw, fallback) {
  const n = parseFloat(String(raw ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(200, Math.max(1, Math.round(n * 100) / 100));
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
  const dismissInsideRefs = useMemo(() => [wrapRef], []);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  // Scroll the active row into view whenever the menu opens.
  useEffect(() => {
    if (!menuOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector('[data-active="true"]');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }, [menuOpen, value]);

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
      <DismissBarrier
        active={menuOpen}
        insideRefs={dismissInsideRefs}
        onDismiss={() => setMenuOpen(false)}
      />
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
              {p}
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

// UX 2026-04-24: round icon-only rotate buttons. Uses the standard curved
// rotate glyph that Figma / Sketch / Acrobat all ship, so users recognize
// them without a text label. Sized to feel touch-comfortable but still
// compact inside the right-rail orientation row.
const CcwArrow = () => (
  <Icon name="rotateCcw" size={14} />
);
const CwArrow = () => (
  <Icon name="rotateCw" size={14} />
);

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
  getThumbnail, // (pageNumber, { targetWidth, rotation, ... }) => Promise<{ src, width, height } | null>
  getPageContentRotation, // (pageNumber) => Promise<number> — 0/90/180/270 correction so content reads upright.
}) {
  const effectivePages = pages && pages.length ? pages : DEFAULT_MOCK_PAGES;
  const totalPages = effectivePages.length;

  // Root state
  // UX 2026-04-24: start empty so the "e.g. 2, 7-9" hint shows in the
  // input on first open. Empty is interpreted as "All" downstream, and
  // the All quick pill lights up to confirm.
  const [pagesToPrint, setPagesToPrint] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [bigPreviewOpen, setBigPreviewOpen] = useState(false);
  const [bigPreviewZoom, setBigPreviewZoom] = useState(1);

  // Top-level scope tab + the Select range
  const [kScope, setKScope] = useState('all'); // 'all' | 'select' | 'current'
  const [kSelectRange, setKSelectRange] = useState('');

  // Customization values
  const [paperSize, setPaperSize] = useState('auto');
  // UX 2026-04-24: when paper size is "Match another page…", this holds
  // the source page whose dimensions every in-scope page copies.
  const [matchPage, setMatchPage] = useState(1);
  // G6 fix 2026-06-12: real inputs behind "Custom W × H…". Stored as
  // strings so mid-typing feels natural; committed (clamped to sane
  // bounds) on blur. The print pipeline receives the parsed inches via
  // customDims on each in-scope page — no more silent Letter fallback.
  const [customW, setCustomW] = useState('8.5');
  const [customH, setCustomH] = useState('11');
  const [fitMode, setFitMode] = useState('proportional'); // 'proportional' | 'stretch'
  const [orientation, setOrientation] = useState('auto');
  const [mirrorH, setMirrorH] = useState(false);
  const [mirrorV, setMirrorV] = useState(false);
  const [markupsOn, setMarkupsOn] = useState(true);
  const [colorOn, setColorOn] = useState(true);
  // UX 2026-04-24: per-page rotation delta applied by CCW / CW clicks.
  // Stored as a map of pageNum → degrees (0/90/180/270). Merged with the
  // per-section orientation override at render + print time.
  const [pageRotations, setPageRotations] = useState({});
  // UX 2026-04-24: per-page content-based rotation detection results
  // (Acrobat-style Auto). Populated lazily as pages become visible —
  // reading the PDF's text items and picking the rotation that makes
  // the majority of text read upright. Used only when orientation ===
  // 'auto'; forced Portrait / Landscape ignore this.
  const [contentRotations, setContentRotations] = useState({});

  // Job-level
  const [copies, setCopies] = useState(1);
  const [collate, setCollate] = useState(true);
  const [duplex, setDuplex] = useState(false);
  const [destination, setDestination] = useState(printers[0]?.id || 'default');

  // Thumbnail + preview image cache — { [pageNum]: { src, width, height } }
  const [thumbCache, setThumbCache] = useState({});
  const [previewImg, setPreviewImg] = useState(null); // larger render for preview
  // UX 2026-04-23: the Bigger Preview uses its own high-res image so the
  // popped-out sheet stays crisp at 100% and survives zoom-in without
  // getting blurry. Keyed by (page, width) through the parent's render
  // cache so we never re-render unnecessarily.
  const [bigPreviewImg, setBigPreviewImg] = useState(null);

  // UX 2026-04-24: resolve the transform options for a given page INLINE
  // (no helper dependency) so the fetch effects below can reference it
  // without forward-reference issues. Everything here references only
  // state/props that are already available at the top of the component.
  const computePageOptsInline = useCallback((pageNum) => {
    // UX 2026-04-24: honor the "empty input = All" rule so that when the
    // user hasn't typed anything in Pages-to-print, every page IS in the
    // selection and the per-section scopes (rotation, mirror, markups)
    // can actually apply. Before this fix, an empty top field left every
    // page out of scope and the preview never reflected any toggle.
    const trimmedTop = (pagesToPrint || '').trim();
    const inSet = !trimmedTop || parseRange(pagesToPrint, totalPages).has(pageNum);
    if (!inSet) return { rotation: 0, mirrorH: false, mirrorV: false, withAnnotations: true, bw: false };
    const kSectionApplies = () => {
      if (kScope === 'all') return true;
      if (kScope === 'current') return pageNum === currentPage;
      if (kScope === 'select') return parseRange(kSelectRange, totalPages).has(pageNum);
      return false;
    };
    const orientApplies = kSectionApplies();
    const outputApplies = kSectionApplies();

    const manualRot = pageRotations[pageNum] || 0;
    const pg = (effectivePages || []).find((p) => p.index === pageNum);
    const natLandscape = (pg?.width || 0) > (pg?.height || 0);
    const orientOverride = orientApplies ? (
      orientation === 'portrait' ? (natLandscape ? 90 : 0)
      : orientation === 'landscape' ? (natLandscape ? 0 : 90)
      // Auto: rotate by the detected content-upright correction for this
      // page (falls back to 0 before detection resolves).
      : /* auto */ (contentRotations[pageNum] || 0)
    ) : 0;
    const rotation = (((manualRot + orientOverride) % 360) + 360) % 360;
    const resolved = {
      rotation,
      mirrorH: orientApplies ? mirrorH : false,
      mirrorV: orientApplies ? mirrorV : false,
      withAnnotations: outputApplies ? markupsOn : true,
      // UX 2026-04-24: color/BW is controlled by the output section scope
      // just like markups. The thumb strip applies this as a CSS grayscale
      // filter so toggling Color is instant across every page in scope.
      bw: outputApplies ? !colorOn : false,
    };
    if (pageNum === currentPage) {
      printPanelDebug(`[PrintPanel][DBG] opts for page=${pageNum}:`,
        `orientation=${orientation}`,
        `manualRot=${manualRot}`,
        `orientOverride=${orientOverride}`,
        `final rotation=${rotation}`,
        `mirrorH=${resolved.mirrorH}`,
        `mirrorV=${resolved.mirrorV}`,
        `withAnnotations=${resolved.withAnnotations}`,
        `orientApplies=${orientApplies}`,
        `outputApplies=${outputApplies}`,
      );
    }
    return resolved;
  }, [pagesToPrint, totalPages, kScope, kSelectRange, currentPage, pageRotations, contentRotations, effectivePages, orientation, mirrorH, mirrorV, markupsOn, colorOn]);

  // UX 2026-04-24: on every open, discard any stored auto-rotations so
  // we re-read whatever the user is looking at in the main viewer right
  // now (they may have rotated pages since the last open).
  useEffect(() => {
    if (open) setContentRotations({});
  }, [open]);

  // Lazily fetch auto-rotation per page once the panel is open. Each
  // fetch just reads the live page rotation from the main viewer, so
  // Auto orientation always matches what the user is currently seeing.
  useEffect(() => {
    if (!open || typeof getPageContentRotation !== 'function' || !effectivePages?.length) return;
    let cancelled = false;
    const order = effectivePages
      .map((p) => ({ idx: p.index, dist: Math.abs(p.index - currentPage) }))
      .sort((a, b) => a.dist - b.dist);
    (async () => {
      for (const { idx } of order) {
        if (cancelled) return;
        if (contentRotations[idx] !== undefined) continue;
        try {
          const rot = await getPageContentRotation(idx);
          if (cancelled) return;
          setContentRotations((prev) => (prev[idx] === rot ? prev : { ...prev, [idx]: rot }));
        } catch (err) {
          console.warn(`[PrintPanel] content-rotation fetch failed page=${idx}:`, err?.message || err);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, getPageContentRotation, effectivePages, currentPage]);

  // Fetch thumbnails lazily. Pdfjs's `getThumbnailDataUrl` reads from
  // the already-rendered page canvas cache, so only pages the user has
  // scrolled near will resolve. For pages not yet in view, we retry briefly.
  useEffect(() => {
    if (!open || typeof getThumbnail !== 'function' || !effectivePages?.length) return;
    let cancelled = false;
    printPanelDebug('[PrintPanel] fetchThumbs start, getThumbnail type:', typeof getThumbnail);
    const order = effectivePages
      .map((p) => ({ idx: p.index, dist: Math.abs(p.index - currentPage) }))
      .sort((a, b) => a.dist - b.dist);
    // UX 2026-04-24: kick off thumb renders in parallel (with a small
    // concurrency cap to avoid hammering the renderer) and stream each
    // one into the cache as it resolves. Sequential awaits made the strip
    // feel sluggish; parallel makes the whole strip fill in waves from the
    // current page outward. Target width dropped to 100px — the strip
    // cells are only ~46px wide at 2x DPR, so 100 is plenty crisp.
    const CONCURRENCY = 6;
    let cursor = 0;
    const runWorker = async () => {
      while (!cancelled) {
        const slot = cursor++;
        if (slot >= order.length) return;
        const { idx } = order[slot];
        const opts = computePageOptsInline(idx);
        const cacheKey = `${idx}:${opts.rotation}:${opts.mirrorH ? 1 : 0}:${opts.mirrorV ? 1 : 0}:${opts.withAnnotations ? 1 : 0}`;
        if (thumbCache[cacheKey]) continue;
        try {
          const img = await getThumbnail(idx, { targetWidth: 100, ...opts });
          if (cancelled) return;
          if (img?.src) {
            printPanelDebug(`[PrintPanel] thumb ready page=${idx} (${img.width}×${img.height})`);
            setThumbCache((prev) => ({ ...prev, [cacheKey]: img }));
          } else {
            printPanelDebug(`[PrintPanel] thumb not yet ready page=${idx} (returned ${img === null ? 'null' : 'no src'})`);
          }
        } catch (err) {
          console.warn(`[PrintPanel] thumb fetch failed page=${idx}:`, err?.message || err);
        }
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, runWorker));
    return () => { cancelled = true; };
  }, [open, getThumbnail, effectivePages, currentPage, computePageOptsInline]);

  // Load a larger render of the current page for the main preview.
  useEffect(() => {
    if (!open || typeof getThumbnail !== 'function' || !currentPage) return;
    let cancelled = false;
    const opts = computePageOptsInline(currentPage);
    printPanelDebug(`[PrintPanel] fetchPreview start page=${currentPage} opts=`, opts);
    (async () => {
      try {
        // UX 2026-04-24: bumped from 720 → 1600 so the main preview pane
        // renders at true device-pixel-ratio fidelity on Retina/HiDPI
        // screens. 720 looked noticeably soft next to the Bigger Preview
        // pop-out; 1600 matches typical on-screen preview size at 2x DPR
        // without ballooning data URL size.
        const img = await getThumbnail(currentPage, { targetWidth: 1600, ...opts });
        if (cancelled) return;
        if (img?.src) {
          printPanelDebug(`[PrintPanel] preview ready page=${currentPage} (${img.width}×${img.height})`);
          setPreviewImg({ page: currentPage, ...img });
        } else {
          printPanelDebug(`[PrintPanel] preview not ready page=${currentPage}`);
        }
      } catch (err) {
        console.warn(`[PrintPanel] preview fetch failed page=${currentPage}:`, err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [open, getThumbnail, currentPage, computePageOptsInline]);

  // UX 2026-04-23: load a high-res render for the Bigger Preview pop-out
  // whenever it's open, the page changes, or the user zooms in. Target
  // width scales with the current zoom so zooming further produces a
  // sharper image rather than an upscaled blur, capped at 3600px so we
  // don't generate absurdly large data URLs.
  useEffect(() => {
    if (!open || !bigPreviewOpen || typeof getThumbnail !== 'function' || !currentPage) return undefined;
    let cancelled = false;
    const baseWidth = 1400;
    const target = Math.min(3600, Math.round(baseWidth * Math.max(1, bigPreviewZoom)));
    const opts = computePageOptsInline(currentPage);
    (async () => {
      try {
        const img = await getThumbnail(currentPage, { targetWidth: target, ...opts });
        if (cancelled) return;
        if (img?.src) {
          printPanelDebug(`[PrintPanel] bigPreview ready page=${currentPage} (${img.width}×${img.height})`);
          setBigPreviewImg({ page: currentPage, ...img });
        }
      } catch (err) {
        console.warn(`[PrintPanel] bigPreview fetch failed page=${currentPage}:`, err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [open, bigPreviewOpen, getThumbnail, currentPage, bigPreviewZoom, computePageOptsInline]);

  // Derived: which pages are included in the top-level print range. An
  // empty input field means "All pages" so the panel feels friendly on
  // first open — the user sees the hint "e.g. 2, 7-9" in a blank field
  // and the All quick pill lit up. Typing narrows from there.
  const includedSet = useMemo(() => {
    const trimmed = (pagesToPrint || '').trim();
    if (!trimmed) {
      const full = new Set();
      for (let i = 1; i <= totalPages; i++) full.add(i);
      return full;
    }
    return parseRange(pagesToPrint, totalPages);
  }, [pagesToPrint, totalPages]);
  const includedCount = includedSet.size;

  // Clamp the current-page pointer to the included set.
  useEffect(() => {
    if (!includedSet.size) return;
    if (!includedSet.has(currentPage)) {
      const first = Math.min(...includedSet);
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

  // Every section's scope is the single `kScope`, clamped to the top-row
  // included set.
  const kScopeAppliesToCurrent = useMemo(() => {
    if (!includedSet.has(currentPage)) return false;
    if (kScope === 'all') return true;
    if (kScope === 'current') return true;
    if (kScope === 'select') return kSelectEffectiveSet.has(currentPage);
    return false;
  }, [kScope, kSelectEffectiveSet, includedSet, currentPage]);

  // Mirror/rotation preview class — every section follows the single kScope.
  const mirrorAppliesHere = kScopeAppliesToCurrent;

  const bwAppliesHere = kScopeAppliesToCurrent && !colorOn;

  // UX 2026-04-24: resolve the in-scope page set, clamped to the top-row
  // selection. Used by: (a) CCW/CW rotation handlers to know which pages to
  // rotate, (b) handlePrint to build per-page settings, and (c) the preview
  // layer to know which sections "apply" to the currently viewed page.
  const resolveScopePages = useCallback(() => {
    if (kScope === 'all') return includedOrdered;
    if (kScope === 'current') return includedSet.has(currentPage) ? [currentPage] : [];
    if (kScope === 'select') return Array.from(kSelectEffectiveSet).sort((a, b) => a - b);
    return [];
  }, [kScope, kSelectEffectiveSet, includedOrdered, includedSet, currentPage]);

  // Apply a rotation delta (90° increments) to every page in the orientation
  // section's scope. Stored mod-360 so repeated clicks cycle cleanly.
  const handleRotate = useCallback((deltaDegrees) => {
    const targetPages = resolveScopePages();
    printPanelDebug(`[PrintPanel][DBG] rotate delta=${deltaDegrees}° scope-pages=${targetPages.length} first10=`, targetPages.slice(0, 10));
    if (!targetPages.length) {
      console.warn('[PrintPanel][DBG] rotate: NO pages in scope — did the orient section narrow to empty?');
      return;
    }
    setPageRotations((prev) => {
      const next = { ...prev };
      for (const n of targetPages) {
        const cur = next[n] || 0;
        next[n] = (((cur + deltaDegrees) % 360) + 360) % 360;
      }
      printPanelDebug('[PrintPanel][DBG] rotate: pageRotations after =', next);
      return next;
    });
  }, [resolveScopePages]);

  // Resolve the orientation override for a specific page. "Auto" matches
  // the page's own shape (no rotation). Portrait / Landscape rotate only
  // pages whose native orientation doesn't already match.
  const orientationRotationForPage = useCallback((pageNum, natW, natH) => {
    const landscape = natW > natH;
    switch (orientation) {
      case 'portrait': return landscape ? 90 : 0;
      case 'landscape': return landscape ? 0 : 90;
      case 'auto':
      default: return 0;
    }
  }, [orientation]);

  // Full effective settings for a given page — the single source of truth
  // used by both the preview and the print pipeline. Returns null for pages
  // that aren't in the top-row selection (so callers can skip them entirely).
  const PAPER_ASPECTS = {
    auto: null,
    letter: 8.5 / 11,
    legal: 8.5 / 14,
    tabloid: 11 / 17,
    a4: 8.27 / 11.69,
    a3: 11.69 / 16.54,
    archD: 24 / 36,
    archE: 36 / 48,
  };
  const resolvePageSettings = useCallback((pageNum) => {
    if (!includedSet.has(pageNum)) return null;
    const pg = effectivePages.find((p) => p.index === pageNum);
    const natW = pg?.width || 8.5;
    const natH = pg?.height || 11;

    const scopeApplies = (kScope === 'all' || (kScope === 'current' && pageNum === currentPage) || (kScope === 'select' && kSelectEffectiveSet.has(pageNum)));
    const orientScopeApplies = scopeApplies;
    const outputScopeApplies = scopeApplies;
    const paperScopeApplies = scopeApplies;

    // Total rotation = user-clicked deltas + orientation override.
    const manualRot = pageRotations[pageNum] || 0;
    const orientRot = orientScopeApplies ? orientationRotationForPage(pageNum, natW, natH) : 0;
    const totalRot = (manualRot + orientRot) % 360;

    return {
      pageNumber: pageNum,
      width: natW,
      height: natH,
      rotation: totalRot,
      mirrorH: orientScopeApplies ? mirrorH : false,
      mirrorV: orientScopeApplies ? mirrorV : false,
      withAnnotations: outputScopeApplies ? markupsOn : true,
      bw: outputScopeApplies ? !colorOn : false,
      paperSize: paperScopeApplies ? paperSize : 'auto',
      fitMode: paperScopeApplies ? fitMode : 'proportional',
    };
  }, [includedSet, effectivePages, kScope, kSelectEffectiveSet, currentPage, pageRotations, orientationRotationForPage, mirrorH, mirrorV, markupsOn, colorOn, paperSize, fitMode]);

  // Effective settings for the currently previewed page (or null).
  const currentPageSettings = resolvePageSettings(currentPage);

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
    // UX 2026-04-24: resolve per-page effective settings so the App's
    // print pipeline doesn't have to re-derive scope math. Each entry
    // contains exactly what the renderer needs to bake the right pixels
    // for that page, plus the output paper size + fit mode for the final
    // composition. Pages not in the top-row selection are omitted entirely.
    const perPage = includedOrdered.map((pageNumber) => {
      const opts = computePageOptsInline(pageNumber);
      const pg = (effectivePages || []).find((p) => p.index === pageNumber);
      const natLandscape = (pg?.width || 0) > (pg?.height || 0);
      // Resolve the section applies inline (parallel to
      // computePageOptsInline so they agree).
      const kApplies = () => {
        if (kScope === 'all') return true;
        if (kScope === 'current') return pageNumber === currentPage;
        if (kScope === 'select') return parseRange(kSelectRange, totalPages).has(pageNumber);
        return false;
      };
      const paperApplies = kApplies();
      const outputApplies = kApplies();
      return {
        pageNumber,
        naturalWidth: pg?.width ?? 8.5,
        naturalHeight: pg?.height ?? 11,
        naturalLandscape: natLandscape,
        rotation: opts.rotation,
        mirrorH: opts.mirrorH,
        mirrorV: opts.mirrorV,
        withAnnotations: opts.withAnnotations,
        bw: outputApplies ? !colorOn : false,
        paperSize: paperApplies ? paperSize : 'auto',
        fitMode: paperApplies ? fitMode : 'proportional',
        orientation: paperApplies || outputApplies ? orientation : 'auto',
        // For "match another page" paper size, carry the source page's
        // dimensions along so the print pipeline can stamp every page in
        // scope onto a sheet the same shape + size as that reference.
        matchPageDims: (paperApplies && paperSize === 'match')
          ? (() => {
              const src = (effectivePages || []).find((p) => p.index === matchPage);
              return src ? { width: src.width, height: src.height } : null;
            })()
          : null,
        // G6 fix: "Custom W × H…" carries the user-typed sheet dimensions
        // (inches) so the print pipeline stamps every page in scope onto
        // exactly that sheet instead of silently falling back to Letter.
        customDims: (paperApplies && paperSize === 'custom')
          ? { width: parseCustomInches(customW, 8.5), height: parseCustomInches(customH, 11) }
          : null,
      };
    });
    const jobSpec = {
      docName,
      includedPages: includedOrdered,
      perPage,
      job: { copies, collate, duplex, destination },
      settings: { paperSize, fitMode, orientation, mirrorH, mirrorV, markupsOn, colorOn },
      scopes: { all: kScope, selectRange: kSelectRange },
    };
    printPanelDebug('[PrintPanel] PRINT pressed → jobSpec pages=', perPage.length, 'first=', perPage[0]);
    onPrint?.(jobSpec);
  }, [
    docName, includedOrdered, computePageOptsInline, effectivePages, currentPage, totalPages,
    paperSize, fitMode, orientation, mirrorH, mirrorV, markupsOn, colorOn, matchPage, customW, customH,
    copies, collate, duplex, destination,
    kScope, kSelectRange, onPrint,
  ]);

  // Diagnostic — fires every time the panel transitions open/closed so we can
  // confirm mount + teardown in the log.
  useEffect(() => {
    if (open) {
      printPanelDebug('[PrintPanel] RENDER — panel opened with', {
        totalPages, docName,
        initialIncludedCount: includedCount,
        printers: printers.map((p) => p.id),
      });
    } else {
      printPanelDebug('[PrintPanel] RENDER — panel closed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Diagnostic — log each significant control change so the full user flow
  // is reproducible from a log dump.
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] pagesToPrint =', pagesToPrint, '→ included:', includedCount); }, [pagesToPrint, includedCount, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] currentPage =', currentPage); }, [currentPage, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] paperSize =', paperSize, 'fitMode =', fitMode); }, [paperSize, fitMode, open]);
  useEffect(() => {
    if (open && paperSize === 'match') {
      const src = (effectivePages || []).find((p) => p.index === matchPage);
      printPanelDebug('[PrintPanel] matchPage =', matchPage,
        'src dims =', src ? `${src.width}x${src.height}` : 'n/a',
        'current page dims =', curPage ? `${curPage.width}x${curPage.height}` : 'n/a');
    }
  }, [matchPage, paperSize, open, effectivePages, curPage]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] orientation =', orientation); }, [orientation, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] mirrorH =', mirrorH, 'mirrorV =', mirrorV); }, [mirrorH, mirrorV, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] markupsOn =', markupsOn, 'colorOn =', colorOn); }, [markupsOn, colorOn, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] copies =', copies, 'collate =', collate, 'duplex =', duplex); }, [copies, collate, duplex, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] destination =', destination); }, [destination, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] kScope =', kScope, 'kSelectRange =', kSelectRange); }, [kScope, kSelectRange, open]);
  useEffect(() => { if (open) printPanelDebug('[PrintPanel] bigPreviewOpen =', bigPreviewOpen); }, [bigPreviewOpen, open]);

  const handleCancel = useCallback((source) => {
    printPanelDebug(`[PrintPanel] CLOSE via ${source}`);
    onClose?.();
  }, [onClose]);

  // UX 2026-04-23: preview stage measurement. Hook lives above the
  // early-return so hook order stays stable across open/closed renders.
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!open) return undefined;
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const cs = window.getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const rect = el.getBoundingClientRect();
      setStageSize({
        w: Math.max(0, rect.width - padX),
        h: Math.max(0, rect.height - padY),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // UX 2026-04-23: same measurement for the Bigger Preview stage so the
  // "Fit" zoom level actually fills the stage without leaving residual
  // scrollbars, and so that zooming above Fit is relative to a real
  // per-device baseline.
  const bigStageRef = useRef(null);
  const [bigStageSize, setBigStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!open || !bigPreviewOpen) return undefined;
    const el = bigStageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const cs = window.getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const rect = el.getBoundingClientRect();
      setBigStageSize({
        w: Math.max(0, rect.width - padX),
        h: Math.max(0, rect.height - padY),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, bigPreviewOpen]);

  if (!open) return null;

  // ─── Render helpers ───────────────────────────────────────────────────

  const renderThumb = (page) => {
    const included = includedSet.has(page.index);
    const isCurrent = page.index === currentPage;
    const kBadges = [];
    if (kScope === 'select' && kSelectEffectiveSet.has(page.index)) {
      kBadges.push(<span key="s" className="pp-thumb-bd bd-sel">S</span>);
    }
    const thumbOpts = computePageOptsInline(page.index);
    const thumbKey = `${page.index}:${thumbOpts.rotation}:${thumbOpts.mirrorH ? 1 : 0}:${thumbOpts.mirrorV ? 1 : 0}:${thumbOpts.withAnnotations ? 1 : 0}`;
    const thumb = thumbCache[thumbKey];
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
          printPanelDebug(`[PrintPanel] thumb click page=${page.index} alt=${!!e.altKey} meta=${!!e.metaKey} currentlyIncluded=${included}`);
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
        <div
          className={`pp-thumb ${page.isLandscape ? 'is-landscape' : ''} ${thumbOpts.bw ? 'is-bw' : ''}`}
          style={{ '--pp-thumb-ar': `${page.width || 8.5} / ${page.height || 11}` }}
        >
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

  // ─── Right rail ───────────────────────────────────────────────────────
  const renderRail = () => (
    <div
      className="pp-rail"
      aria-label="Print options"
      style={{ flex: '0 0 340px', width: 340, minWidth: 340, maxWidth: 340, display: 'block', background: 'var(--surface-1)', borderLeft: '1px solid var(--border)' }}
      ref={(node) => { if (node) printPanelDebug('[PrintPanel] rail mounted, rect:', node.getBoundingClientRect()); }}
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
      {kScope === 'select' && (() => {
        const kParsed = parseRange(kSelectRange, totalPages);
        let kOutOfRange = false;
        for (const n of kParsed) if (!includedSet.has(n)) { kOutOfRange = true; break; }
        return (
          <div className="pp-scope-select-input">
            <span className="pp-scope-label">Pages</span>
            <input
              type="text"
              className={kOutOfRange ? 'has-error' : ''}
              placeholder="e.g. 2, 7-9"
              value={kSelectRange}
              onChange={(e) => setKSelectRange(clampRangeToMax(filterRangeChars(e.target.value), totalPages))}
              onBlur={(e) => setKSelectRange(sanitizeRangeInput(e.target.value, totalPages))}
              title={kOutOfRange ? 'Some pages are outside the selected print range' : undefined}
            />
          </div>
        );
      })()}

      <div className="pp-section">
        <div className="pp-section-head">
          <span className="pp-section-title">Page size</span>
        </div>
        {/* UX 2026-04-24: when the user picks "Match another page…", a
            compact page picker slides in beside the paper dropdown so
            they can type or pick which page's size to copy. Every page
            in scope is then printed on that size. */}
        <div className="pp-paper-row">
          <Dropdown value={paperSize} options={PAPER_OPTIONS} onChange={setPaperSize} />
          {paperSize === 'match' && (
            <span className="pp-match-page">
              <span className="pp-match-label">of page</span>
              <PagePicker
                value={matchPage}
                options={Array.from({ length: totalPages }, (_, i) => i + 1)}
                onChange={setMatchPage}
              />
            </span>
          )}
        </div>
        {/* G6 fix 2026-06-12: real width/height inputs behind
            "Custom W × H…". Values are inches, clamped 1–200 on blur
            with the resolved number written back into the field so what
            you see is exactly the sheet that prints. */}
        {paperSize === 'custom' && (
          <div className="pp-custom-row">
            <span className="pp-match-label">W</span>
            <input
              type="text"
              inputMode="decimal"
              className="pp-custom-dim"
              aria-label="Custom sheet width in inches"
              value={customW}
              onChange={(e) => setCustomW(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => setCustomW(String(parseCustomInches(customW, 8.5)))}
            />
            <span className="pp-match-label">× H</span>
            <input
              type="text"
              inputMode="decimal"
              className="pp-custom-dim"
              aria-label="Custom sheet height in inches"
              value={customH}
              onChange={(e) => setCustomH(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => setCustomH(String(parseCustomInches(customH, 11)))}
            />
            <span className="pp-match-label">in</span>
          </div>
        )}
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
            <button className="pp-rbtn" title="Rotate counter-clockwise 90°" aria-label="Rotate counter-clockwise" type="button" onClick={() => handleRotate(-90)}>
              <CcwArrow />
            </button>
            <button className="pp-rbtn" title="Rotate clockwise 90°" aria-label="Rotate clockwise" type="button" onClick={() => handleRotate(90)}>
              <CwArrow />
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
            <button type="button" onClick={() => setCopies((c) => Math.max(1, c - 1))} aria-label="Fewer copies"><Icon name="minus" size={16} /></button>
            <input value={copies} onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            <button type="button" onClick={() => setCopies((c) => Math.min(999, c + 1))} aria-label="More copies"><Icon name="plus" size={16} /></button>
          </div>
          <Toggle on={collate} onChange={setCollate}>Collate</Toggle>
          <Toggle on={duplex} onChange={setDuplex}>Duplex</Toggle>
        </div>
      </div>
    </div>
  );

  // ─── Sheet render (preview box) ──────────────────────────────────────
  // UX 2026-04-24: rotation + mirror + markups are baked into the image
  // by the renderer, so `previewImg.width/.height` already reflect them.
  // The sheet shape is:
  //  - The user-picked paper aspect when a paper size is forced (content
  //    is letterboxed inside via object-fit contain or stretched per fit).
  //  - The image's own aspect when paper size = Auto.
  // For forced paper sizes we honor the user's orientation override so
  // a "Letter" pick with "Auto landscape" shows as Letter landscape.
  const imageAspect = (previewImg && previewImg.page === currentPage && previewImg.width && previewImg.height)
    ? (previewImg.width / previewImg.height)
    : (curPage ? curPage.width / curPage.height : 8.5 / 11);
  let aspect;
  if (currentPageSettings?.paperSize && currentPageSettings.paperSize !== 'auto') {
    // Resolve the target paper aspect. "Match another page…" copies the
    // aspect ratio of the page the user picked. Fall back to image aspect
    // if the match page isn't known yet.
    let base;
    let isMatch = false;
    if (currentPageSettings.paperSize === 'match') {
      const src = (effectivePages || []).find((p) => p.index === matchPage);
      base = src ? (src.width / src.height) : imageAspect;
      isMatch = true;
    } else if (currentPageSettings.paperSize === 'custom') {
      // G6 fix: the sheet's shape IS the typed W × H, exactly — same
      // rule as "Match another page", only the source is the user input.
      const cw = parseCustomInches(customW, 8.5);
      const ch = parseCustomInches(customH, 11);
      base = cw / ch;
      isMatch = true;
    } else {
      base = PAPER_ASPECTS[currentPageSettings.paperSize] ?? imageAspect;
    }
    // UX 2026-04-24: "Match another page" means the sheet's shape IS the
    // target page's shape, exactly — don't let auto-orientation flip it
    // back based on the currently-viewed page's own aspect. For every
    // other paper size, Auto still matches the current page's orientation
    // and Portrait/Landscape still force explicitly.
    let forceLandscape;
    if (isMatch) {
      forceLandscape = orientation === 'landscape'
        || (orientation === 'portrait' ? false : (base > 1));
    } else {
      forceLandscape = orientation === 'landscape'
        || (orientation === 'auto' && imageAspect > 1);
    }
    aspect = forceLandscape ? Math.max(base, 1 / base) : Math.min(base, 1 / base);
    printPanelDebug('[PrintPanel][DBG] paper aspect resolve:',
      `paperSize=${currentPageSettings.paperSize}`,
      `matchPage=${matchPage}`,
      `base=${base.toFixed(3)}`,
      `imageAspect=${imageAspect.toFixed(3)}`,
      `orientation=${orientation}`,
      `forceLandscape=${forceLandscape}`,
      `final aspect=${aspect.toFixed(3)}`);
  } else {
    aspect = imageAspect;
  }

  // UX 2026-04-23: compute explicit sheet pixel dimensions that satisfy
  // the aspect ratio and the measured stage box. Pure CSS with
  // `width: 100% + aspect-ratio + max-height: 100%` produced subtle
  // residual bars because the width didn't shrink after the max-height
  // clamp; explicit pixel sizing (same trick the Bigger Preview uses)
  // removes any ambiguity.
  let sheetW = 0;
  let sheetH = 0;
  if (stageSize.w > 0 && stageSize.h > 0 && aspect > 0) {
    const stageAspect = stageSize.w / stageSize.h;
    if (stageAspect > aspect) {
      sheetH = stageSize.h;
      sheetW = sheetH * aspect;
    } else {
      sheetW = stageSize.w;
      sheetH = sheetW / aspect;
    }
  }
  const sheetSizeStyle = (sheetW > 0 && sheetH > 0)
    ? { width: `${sheetW}px`, height: `${sheetH}px` }
    : { width: '100%', maxWidth: '100%', maxHeight: '100%', aspectRatio: `${aspect}` };
  // UX 2026-04-24: rotation + mirror are baked at render time, so the
  // sheet class only carries the BW filter (applied client-side via CSS
  // for instant toggling without another re-render).
  const sheetClass = [
    'pp-preview-sheet',
    bwAppliesHere ? 'is-bw' : '',
  ].filter(Boolean).join(' ');
  // Preview image fit: proportional uses object-fit contain; stretch
  // fills the sheet completely (may distort aspect).
  const previewImgFit = currentPageSettings?.fitMode === 'stretch' ? 'fill' : 'contain';

  // ─── Main render ──────────────────────────────────────────────────────
  // 2026-06-12: rendered through a portal to document.body. PDFViewer's
  // overlay ancestor creates a z-index:5000 stacking context, which buried
  // the panel's titlebar under the app's top toolbar (chrome-top-host,
  // z-index 5500) no matter how high pp-root's own z-index went. The
  // portal lifts the dialog out of that context entirely.
  return createPortal(
    <>
      <div
        className="pp-backdrop"
        onClick={() => handleCancel('backdrop click')}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      />
      <section
        className="pp-root"
        role="dialog"
        aria-label="Print"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <header className="pp-titlebar">
          <div className="pp-title">
            <span className="pp-title-name">Print — {docName}</span>
            <span className="pp-title-count">· {totalPages} pages</span>
          </div>
          <div className="pp-title-actions">
            <button className="pp-close" onClick={() => handleCancel('button')} aria-label="Close print panel"><Icon name="close" size={18} /></button>
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
                onChange={(e) => setPagesToPrint(clampRangeToMax(filterRangeChars(e.target.value), totalPages))}
                onBlur={(e) => setPagesToPrint(sanitizeRangeInput(e.target.value, totalPages))}
                placeholder="e.g. 2, 7-9"
              />
              <div className="pp-quicks">
                {/* UX 2026-04-24: All pill lights up when the input is
                    empty OR the typed range covers every page, so the
                    default state on first open reads as "All selected"
                    without needing a click. All now clears the input
                    rather than filling it — the empty field shows the
                    hint placeholder and still prints every page. */}
                <button
                  type="button"
                  className={`pp-quick ${(!pagesToPrint.trim() || includedCount === totalPages) ? 'is-active' : ''}`}
                  onClick={() => setPagesToPrint('')}
                >All</button>
                <button
                  type="button"
                  className={`pp-quick ${pagesToPrint.trim() === String(currentPage) ? 'is-active' : ''}`}
                  onClick={() => setPagesToPrint(String(currentPage))}
                >Current view</button>
                <button
                  type="button"
                  className="pp-quick"
                  onClick={() => setPagesToPrint('0')}
                >Clear</button>
              </div>
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
            ref={(node) => { if (node) printPanelDebug('[PrintPanel] pp-mid mounted, rect:', node.getBoundingClientRect()); }}
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
              <div className="pp-preview-stage" ref={stageRef}>
                <div
                  className={sheetClass}
                  style={sheetSizeStyle}
                >
                  {previewImg?.page === currentPage && previewImg.src ? (
                    <img
                      src={previewImg.src}
                      alt={`Page ${currentPage}`}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: previewImgFit, pointerEvents: 'none', background: '#fff' }}
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
                          printPanelDebug(`[PrintPanel] pager dot click page=${pageNum}`);
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
              </div>
            </div>
            {renderRail()}
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
          <div
            className="pp-bigprev"
            onClick={() => setBigPreviewOpen(false)}
            // UX 2026-04-23: trackpad pinch on Mac surfaces as a wheel
            // event with ctrlKey=true. Cmd/Ctrl + scroll wheel is also
            // common for intentional zoom. Both are mapped here to the
            // same zoom state so pinching feels native.
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const factor = Math.exp(-e.deltaY * 0.01);
                setBigPreviewZoom((z) => Math.max(0.25, Math.min(6, z * factor)));
              }
            }}
          >
            <div className="pp-bigprev-head" onClick={(e) => e.stopPropagation()}>
              <div className="pp-bigprev-title">
                {/* UX 2026-04-23: the page picker lives in the header next to
                    the "Preview" label; the bottom row is only numbered
                    rectangles and prev/next arrows. */}
                <span className="pp-bigprev-title-lead">Preview</span>
                {' '}
                <PagePicker
                  value={currentPage}
                  options={includedOrdered}
                  onChange={setCurrentPage}
                />
                <span className="pp-bigprev-title-trail">&nbsp;of {totalPages}&nbsp;<span style={{ opacity: 0.6 }}>({isLandscapePage ? 'landscape' : 'portrait'})</span></span>
              </div>
              <div className="pp-bigprev-zoom">
                <button onClick={() => setBigPreviewZoom((z) => Math.max(0.25, z - 0.25))} aria-label="Zoom out"><Icon name="minus" size={16} /></button>
                <span>{Math.round(bigPreviewZoom * 100)}%</span>
                <button onClick={() => setBigPreviewZoom((z) => Math.min(6, z + 0.25))} aria-label="Zoom in"><Icon name="plus" size={16} /></button>
                <button onClick={() => setBigPreviewZoom(1)} style={{ width: 'auto', padding: '0 10px' }}>Fit</button>
                {/* UX 2026-04-23: the close affordance is just an X icon to
                    mirror the panel title bar and standard modal pattern. */}
                <button className="pp-bigprev-close" onClick={() => setBigPreviewOpen(false)} aria-label="Close bigger preview"><Icon name="close" size={18} /></button>
              </div>
            </div>
            <div className="pp-bigprev-stage" ref={bigStageRef} onClick={(e) => e.stopPropagation()}>
              {(() => {
                // UX 2026-04-23: compute a true "fit" sheet size using
                // the measured stage — the larger side anchors to the
                // stage so 100% zoom fills the space exactly, with no
                // residual scrollbars. All zooms multiply this fit size.
                let fitW = 900;
                let fitH = 900 / aspect;
                if (bigStageSize.w > 0 && bigStageSize.h > 0 && aspect > 0) {
                  const stageAspect = bigStageSize.w / bigStageSize.h;
                  if (stageAspect > aspect) {
                    fitH = bigStageSize.h;
                    fitW = fitH * aspect;
                  } else {
                    fitW = bigStageSize.w;
                    fitH = fitW / aspect;
                  }
                }
                const w = fitW * bigPreviewZoom;
                const h = fitH * bigPreviewZoom;
                return (
              <div
                className={`pp-bigprev-sheet ${sheetClass.replace('pp-preview-sheet', '').trim()}`}
                style={{
                  width: `${w}px`,
                  height: `${h}px`,
                  transform: 'translate3d(0,0,0)',
                }}
              >
                {(bigPreviewImg?.page === currentPage && bigPreviewImg.src)
                  || (previewImg?.page === currentPage && previewImg.src) ? (
                  <img
                    src={(bigPreviewImg?.page === currentPage && bigPreviewImg.src)
                      ? bigPreviewImg.src
                      : previewImg.src}
                    alt={`Page ${currentPage}`}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: previewImgFit, pointerEvents: 'none', background: '#fff' }}
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
                );
              })()}
            </div>
            {/* UX 2026-04-23: Bigger Preview gets the same navigation
                affordances as the inline preview — previous / next arrows,
                a sliding window of numbered page rectangles, and a type-or-
                pick page selector — so the user never has to close the
                pop-out to move between pages. */}
            <div className="pp-bigprev-nav" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="pp-pager-btn"
                onClick={() => gotoDelta(-1)}
                disabled={currentIndexInIncluded <= 0}
                aria-label="Previous page"
              >‹</button>
              <span className="pp-pager-dots" role="tablist" aria-label="Included pages">
                {visiblePagerPages.map((pageNum) => {
                  const pg = effectivePages.find((p) => p.index === pageNum);
                  const isCurrent = pageNum === currentPage;
                  return (
                    <button
                      type="button"
                      key={pageNum}
                      className={`pp-pager-dot ${pg?.isLandscape ? 'is-landscape' : ''} ${isCurrent ? 'is-current' : ''}`}
                      onClick={() => setCurrentPage(pageNum)}
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
            </div>
          </div>
        )}
      </section>
    </>,
    document.body
  );
}
