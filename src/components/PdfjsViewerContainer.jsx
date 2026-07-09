/**
 * PdfjsViewerContainer.jsx — the owned pdf.js PDF engine container
 * (Phase 37 — owned pdf.js renderer).
 *
 * A production React component that renders PDF pages directly on pdfjs-dist and
 * satisfies the viewer imperative-ref contract used by PDFViewer.
 *
 * Ported from the proven throwaway prototype (src/prototype/PdfjsArm.jsx):
 *   • continuous, virtualized multi-page scroll (cumulative offsets + placeholders)
 *   • cursor-anchored zoom that holds (CSS-transform during the gesture, re-raster
 *     on settle) — the whole point of owning the renderer
 *   • DPR-correct, double-buffered, cancellable rasters + a deep-zoom detail tile
 *
 * Deliberately LEANER than the prototype: in the real app the overlay layers
 * (annotations, text-select, search, forms) are supplied by PDFViewer's own
 * per-page overlay portal loop, mounted into the page hosts this container
 * exposes. So this container only DRAWS pages + exposes correct page hosts +
 * answers the contract. Features not yet built (search, text-markup select/erase,
 * form state/authoring, print) are SAFE STUBs returning benign values (Stage 4).
 *
 * INVARIANTS honored: imports the pdf.js worker the production-proven way; never
 * statically imports from src/prototype; introduces NO JavaScript zoom
 * coordination that fights SVGAnnotationLayer's viewBox or the Canvas
 * zoomGeneration signal (Stage 3 wires that); never throws out of a contract
 * method or callback (PDFViewer assumes the handle never throws).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { extractPdfOutlineBookmarks } from '../utils/bookmarkOutline';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// --- layout + zoom constants (ported from the prototype) ---------------------
const GAP = 16;
const PAD = 20;
const MIN_SCALE = 0.1;
const MAX_SCALE = 40;
const BASE_MAX_SCALE = 2.5; // above this the base canvas is a cheap backdrop; the detail tile owns sharpness
const SETTLE_MS = 110;      // commit the gesture this long after the last wheel tick
const WHEEL_GAIN = 0.01;    // factor = 1 - deltaY * WHEEL_GAIN
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

// Chromium canvas limits + smooth-area budget (ported from spikeMetrics).
const MAX_CANVAS_DIM = 16384;
const MAX_CANVAS_AREA = 80 * 1024 * 1024; // ~80 MP
const MAX_MOUNTED = 12; // ponytail: cap pages rasterized at once (see recomputeWindow) — kills the zoom-out flicker burst
function clampToBudget(backingW, backingH) {
  const dimOver = Math.max(backingW, backingH) / MAX_CANVAS_DIM;
  const areaOver = Math.sqrt((backingW * backingH) / MAX_CANVAS_AREA);
  const over = Math.max(dimOver, areaOver, 1);
  return { factor: over > 1 ? 1 / over : 1, clamped: over > 1 };
}

// --- rendered-page raster cache (Figma-style: draw once, paint back instantly) -
// When a page scrolls out of the mount window its React component unmounts and the
// canvas is destroyed; scrolling back re-rasterized it from scratch (the visible
// "loading" flash the owner reported). This module-level cache keeps the rendered
// page bitmap so a return visit paints synchronously with no re-raster. The cached
// image is the PDF PAGE ONLY (annotations are a separate SVG overlay, so it never
// goes stale from edits). Keyed by document + page + raster scale + rotation; the
// key already collapses all zoom > BASE_MAX_SCALE to one entry. Bounded by a byte
// ceiling (LRU eviction) so a 36-page file stays fully cached at reading zoom while
// huge files never grow memory without limit.
const PAGE_RASTER_CACHE = new Map(); // key -> { canvas, bytes }
let pageRasterCacheBytes = 0;
const PAGE_RASTER_CACHE_MAX_BYTES = 256 * 1024 * 1024;
function pageRasterCacheGet(key) {
  const v = PAGE_RASTER_CACHE.get(key);
  if (v) { PAGE_RASTER_CACHE.delete(key); PAGE_RASTER_CACHE.set(key, v); } // touch = most-recent
  return v ? v.canvas : null;
}
function pageRasterCacheSet(key, canvas) {
  const bytes = (canvas.width * canvas.height * 4) || 0;
  const existing = PAGE_RASTER_CACHE.get(key);
  if (existing) { pageRasterCacheBytes -= existing.bytes; PAGE_RASTER_CACHE.delete(key); }
  PAGE_RASTER_CACHE.set(key, { canvas, bytes });
  pageRasterCacheBytes += bytes;
  while (pageRasterCacheBytes > PAGE_RASTER_CACHE_MAX_BYTES && PAGE_RASTER_CACHE.size > 1) {
    const oldestKey = PAGE_RASTER_CACHE.keys().next().value;
    const oldest = PAGE_RASTER_CACHE.get(oldestKey);
    PAGE_RASTER_CACHE.delete(oldestKey);
    pageRasterCacheBytes -= oldest.bytes;
  }
}

// Normalize the app's documentSource into pdf.js getDocument params. The app
// passes a Uint8Array (PDFViewer setPdfjsDocumentBytes); we also accept
// ArrayBuffer, a data: URI, or a plain URL string for parity. pdf.js neuters
// the buffer it receives, so byte sources are CLONED here.
function buildGetDocumentParams(source, password) {
  if (source == null) return null;
  const base = { isEvalSupported: false };
  if (password) base.password = password;
  if (source instanceof Uint8Array) return { ...base, data: source.slice(0) };
  if (source instanceof ArrayBuffer) return { ...base, data: new Uint8Array(source.slice(0)) };
  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      try {
        const b64 = source.slice(source.indexOf(',') + 1);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return { ...base, data: bytes };
      } catch {
        return null;
      }
    }
    return { ...base, url: source };
  }
  if (source && typeof source === 'object' && (source.data || source.url)) {
    return { ...base, ...source };
  }
  return null;
}

// --- one mounted page: double-buffered, DPR-correct, cancellable raster -------
function PdfPageCanvas({ pdf, pageIndex, pageW, pageH, renderScale, rotation, onRaster }) {
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const genRef = useRef(0);
  const baseScale = Math.min(renderScale, BASE_MAX_SCALE);
  const tiled = renderScale > BASE_MAX_SCALE;

  // useLayoutEffect (not useEffect): a page re-entering the mount window
  // (scroll return, MAX_MOUNTED window shift on zoom) starts as a blank
  // canvas; a passive effect paints it one frame AFTER mount — a visible
  // white flash. The cache blit below is synchronous, so running it before
  // the browser paints makes a cache-hit remount pixel-perfect on its very
  // first frame. The raster path stays async and double-buffered.
  useLayoutEffect(() => {
    let cancelled = false;
    const myGen = ++genRef.current;

    // Already drawn this page at this zoom/rotation? Paint it back instantly —
    // no re-raster, no "loading" flash on scroll-return.
    const docKey = (pdf?.fingerprints && pdf.fingerprints[0]) || pdf?.fingerprint || 'doc';
    const cacheKey = `${docKey}:${pageIndex}:${baseScale.toFixed(3)}:${DPR}:${rotation}`;
    const cachedCanvas = pageRasterCacheGet(cacheKey);
    if (cachedCanvas) {
      const c = canvasRef.current;
      if (c) {
        c.width = cachedCanvas.width;
        c.height = cachedCanvas.height;
        c.getContext('2d', { alpha: false }).drawImage(cachedCanvas, 0, 0);
      }
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled || myGen !== genRef.current) return;
        const want = baseScale * DPR;
        const { factor } = clampToBudget(pageW * want, pageH * want);
        const rasterScale = want * factor;
        const viewport = page.getViewport({ scale: rasterScale, rotation: page.rotate + rotation });

        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.floor(viewport.width));
        off.height = Math.max(1, Math.floor(viewport.height));
        const ctx = off.getContext('2d', { alpha: false });

        if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
        const t0 = performance.now();
        // Draw the PAGE ONLY — do not bake annotation appearance into the raster.
        // The app reconstructs imported markups as its own editable SVG objects
        // (matching the Pdfjs path, which hides the engine's native markup
        // layer); baking here would double them and make erase leave baked pixels.
        const task = page.render({ canvasContext: ctx, viewport, annotationMode: pdfjsLib.AnnotationMode.DISABLE });
        taskRef.current = task;
        try {
          await task.promise;
        } catch (e) {
          if (e?.name === 'RenderingCancelledException') return;
          throw e;
        }
        if (cancelled || myGen !== genRef.current) return;

        const c = canvasRef.current;
        if (!c) return;
        c.width = off.width;
        c.height = off.height;
        c.getContext('2d', { alpha: false }).drawImage(off, 0, 0);
        // Keep the rendered bitmap so a scroll-return repaints instantly.
        pageRasterCacheSet(cacheKey, off);
        onRaster?.(pageIndex, { ms: Math.round(performance.now() - t0), clamped: tiled });
      } catch {
        /* a page may unmount mid-render; never throw out of the engine */
      }
    })();
    return () => {
      cancelled = true;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
    };
  }, [pdf, pageIndex, pageW, pageH, baseScale, rotation, tiled, onRaster]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%', background: '#fff', boxShadow: '0 2px 14px rgba(0,0,0,0.45)' }}
    />
  );
}

// --- deep-zoom detail tile: crisp visible slice over the soft base -----------
function DetailTile({ pdf, pageIndex, scale, rotation, liveZoom, scrollerRef }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const genRef = useRef(0);
  const [tile, setTile] = useState(null);

  const render = useCallback(async () => {
    const host = hostRef.current;
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    if (!host || !scroller || !canvas || !pdf || liveZoom !== 1) return;
    if (scale <= BASE_MAX_SCALE) { setTile(null); return; }

    const hr = host.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const vx = Math.max(0, sr.left - hr.left);
    const vy = Math.max(0, sr.top - hr.top);
    const vw = Math.min(hr.width, sr.right - hr.left) - vx;
    const vh = Math.min(hr.height, sr.bottom - hr.top) - vy;
    if (vw <= 1 || vh <= 1) { setTile(null); return; }

    const myGen = ++genRef.current;
    try {
      const page = await pdf.getPage(pageIndex + 1);
      if (myGen !== genRef.current) return;
      const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
      const cw = Math.max(1, Math.round(vw * DPR));
      const ch = Math.max(1, Math.round(vh * DPR));
      const off = document.createElement('canvas');
      off.width = cw; off.height = ch;
      const ctx = off.getContext('2d', { alpha: false });
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
      const transform = [DPR, 0, 0, DPR, -vx * DPR, -vy * DPR];
      // Page only, no baked annotation appearance — see PdfPageCanvas note.
      const task = page.render({ canvasContext: ctx, viewport, transform, annotationMode: pdfjsLib.AnnotationMode.DISABLE });
      taskRef.current = task;
      try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
      if (myGen !== genRef.current) return;
      const c = canvasRef.current;
      if (!c) return;
      c.width = cw; c.height = ch;
      c.getContext('2d', { alpha: false }).drawImage(off, 0, 0);
      setTile({ left: vx, top: vy, w: vw, h: vh });
    } catch {
      /* never throw out of the engine */
    }
  }, [pdf, pageIndex, scale, rotation, liveZoom, scrollerRef]);

  useEffect(() => { render(); }, [render]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let t;
    const onScroll = () => { clearTimeout(t); t = setTimeout(() => render(), 70); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScroll); clearTimeout(t); };
  }, [render, scrollerRef]);

  useEffect(() => () => { if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } } }, []);

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', left: tile ? tile.left : 0, top: tile ? tile.top : 0, width: tile ? tile.w : 0, height: tile ? tile.h : 0, display: tile ? 'block' : 'none' }}
      />
    </div>
  );
}

let pdfjsContainerSeq = 0;

const PdfjsViewerContainer = forwardRef(function PdfjsViewerContainer({
  id,
  // eslint-disable-next-line no-unused-vars -- accepted for older callsites; pdf.js needs no resource path
  resourceUrl,
  documentSource,
  // The following props are accepted for compatibility with older PDFViewer callsites.
  // pdf.js handles these concerns differently; do not crash on a forwarded prop.
  // interactionMode === 'Pan' drives the drag-to-pan handler below (Pdfjs
  // is implemented locally by the owned pdf.js engine.
  interactionMode = 'Pan',
  // eslint-disable-next-line no-unused-vars
  initialRenderPages = 6,
  // eslint-disable-next-line no-unused-vars
  scrollDelayMs = 160,
  // eslint-disable-next-line no-unused-vars
  suspendContainerRefresh = false,
  // eslint-disable-next-line no-unused-vars
  restrictZoomRequest = false,
  // eslint-disable-next-line no-unused-vars
  textHighlightModeActive = false,
  // eslint-disable-next-line no-unused-vars
  textHighlightColor = '#ffff00',
  // eslint-disable-next-line no-unused-vars
  textHighlightOpacity = 0.5,
  // eslint-disable-next-line no-unused-vars
  textMarkupMode = null,
  // eslint-disable-next-line no-unused-vars
  textMarkupColor = null,
  // eslint-disable-next-line no-unused-vars
  textMarkupOpacity = null,
  className = '',
  style = {},
  // eslint-disable-next-line no-unused-vars
  formDesignerEnabled = false,
  onDocumentLoaded,
  onDocumentLoadFailed,
  onPageChanged,
  onZoomChanged,
  onZoomPhase, // Stage 3: 'gesture-start' | 'settle' — lets PDFViewer bump the zoomGeneration signal
  onPageRendered,
  // eslint-disable-next-line no-unused-vars
  onTextSelectionEnd,
  onPDFBookmarksAvailable,
  onPageContainersChange,
  // eslint-disable-next-line no-unused-vars
  onDebugEvent,
  onDocumentUnload,
  // eslint-disable-next-line no-unused-vars
  onFormFieldAdd,
  // eslint-disable-next-line no-unused-vars
  onFormFieldSelect,
  // eslint-disable-next-line no-unused-vars
  onFormFieldUnselect,
  // eslint-disable-next-line no-unused-vars
  onFormFieldRemove,
  // eslint-disable-next-line no-unused-vars
  onFormFieldPropertiesChange,
  // eslint-disable-next-line no-unused-vars
  onFormFieldClick,
  // eslint-disable-next-line no-unused-vars
  onFormFieldDoubleClick,
}, ref) {
  const viewerId = useMemo(() => id || `pdfjsViewer_${(pdfjsContainerSeq += 1)}`, [id]);
  const rotation = 0; // intrinsic /Rotate is baked by pdf.js; app handles rotation by rewriting bytes

  const scrollerRef = useRef(null);
  const contentRef = useRef(null);
  const pdfRef = useRef(null);
  // Stable, React-owned slot INSIDE the transformed content node. The app appends its
  // annotation/form/link/text overlay here so it rides the page's own zoom/scroll
  // transform as one piece (the demo's structure). It has no React children, so an
  // imperatively-appended subtree inside it is never disturbed by reconciliation.
  const overlayHostRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [pageSizes, setPageSizes] = useState([]);
  const [scale, setScale] = useState(1);
  const [liveZoom, setLiveZoom] = useState(1);
  const [range, setRange] = useState([0, -1]);
  const [containerW, setContainerW] = useState(800);
  const [containerH, setContainerH] = useState(600);
  // Drives a `transition: transform` on the content node ONLY while the settle glide
  // is running (never during the live gesture, where the transform must update
  // per-frame with no transition). The ref is the synchronous source of truth used
  // inside rAF; this state just mirrors it so the JSX re-renders the gated style.
  const [settleAnimating, setSettleAnimating] = useState(false);

  // imperative document source (prop-driven, overridable via load())
  const [activeSource, setActiveSource] = useState(documentSource);
  const [activePassword, setActivePassword] = useState('');
  useEffect(() => { setActiveSource(documentSource); setActivePassword(''); }, [documentSource]);

  // refs that keep zoom/render effects from re-running when callbacks change
  const scaleRef = useRef(scale);
  scaleRef.current = scale; // keep in sync during render so same-frame reads aren't stale
  const numPagesRef = useRef(0);
  const currentPageRef = useRef(1);
  const prevScaleRef = useRef(null);
  const bookmarksRef = useRef([]);
  const thumbCacheRef = useRef(new Map());
  const pageContainerMapRef = useRef({});
  const lastEmittedMapRef = useRef({});

  const cb = useRef({});
  cb.current = {
    onDocumentLoaded, onDocumentLoadFailed, onPageChanged, onZoomChanged, onZoomPhase,
    onPageRendered, onPDFBookmarksAvailable, onPageContainersChange, onDocumentUnload,
  };

  const settleTimerRef = useRef(null);
  const pendingAnchorRef = useRef(null);
  const wheelRafRef = useRef(0);
  const liveZoomRef = useRef(1);
  const gestureRef = useRef(null);
  const dimsPtRef = useRef([]);
  const containerWRef = useRef(800);
  const containerHRef = useRef(600);
  const topsRef = useRef([]);
  const padTopRef = useRef(0);
  // ---- animated-settle state ------------------------------------------------
  // The gesture's live CSS transform previews the new size on the OLD layout; the
  // committed re-layout can land the anchored point at a clamped scroll (top of a
  // multi-page doc, a centered page). A hard swap shows that delta as a snap. The
  // settle TWEENS the scroll from the gesture-end position to the committed clamped
  // target while the OLD painted content + transform stay visible (transition gates
  // the transform glide), then swaps to the committed layout under cover of the
  // glide so the re-raster appears in place. A generation counter aborts a stale
  // tween the instant a new wheel gesture starts.
  const settleAnimatingRef = useRef(false);
  const settleRafRef = useRef(0);
  const settleGenRef = useRef(0);
  const settleTweenFromRef = useRef(null); // {left,top} captured at gesture-end to glide from
  const SETTLE_ANIM_MS = 160;

  // ---- load document --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const params = buildGetDocumentParams(activeSource, activePassword);
    setPageSizes([]); setNumPages(0); setRange([0, -1]);
    pageContainerMapRef.current = {};
    if (!params) return undefined;

    const task = pdfjsLib.getDocument(params);
    (async () => {
      try {
        const pdf = await task.promise;
        if (cancelled) { try { pdf.destroy(); } catch { /* noop */ } return; }
        pdfRef.current = pdf;
        numPagesRef.current = pdf.numPages;
        setNumPages(pdf.numPages);

        const sizes = [];
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const pg = await pdf.getPage(i);
          if (cancelled) return;
          const vp = pg.getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setPageSizes(sizes);

        const el = scrollerRef.current;
        const cw = el ? el.clientWidth : 800;
        const fit = Math.max(0.2, Math.min(2, (cw - 2 * PAD) / (sizes[0]?.w || 612)));
        setScale(fit); scaleRef.current = fit; prevScaleRef.current = fit;
        setLiveZoom(1); liveZoomRef.current = 1;
        currentPageRef.current = 1;

        cb.current.onDocumentLoaded?.({
          pageCount: pdf.numPages,
          currentPageNumber: 1,
          zoomValue: Math.round(fit * 100),
          raw: pdf,
        });

        try {
          const outline = await extractPdfOutlineBookmarks(pdf);
          if (!cancelled && Array.isArray(outline)) {
            bookmarksRef.current = outline;
            if (outline.length > 0) cb.current.onPDFBookmarksAvailable?.(outline);
          }
        } catch { /* bookmarks are best-effort; never block the render path */ }
      } catch (err) {
        if (cancelled || err?.name === 'RenderingCancelledException') return;
        cb.current.onDocumentLoadFailed?.({ error: err, message: err?.message || String(err) });
        cb.current.onPageContainersChange?.({}, { reason: 'document_load_failed', count: 0 });
      }
    })();

    return () => {
      cancelled = true;
      try { task.destroy?.(); } catch { /* noop */ }
      const prev = pdfRef.current;
      pdfRef.current = null;
      thumbCacheRef.current.clear();
      if (prev) { try { prev.destroy(); } catch { /* noop */ } }
      cb.current.onPageContainersChange?.({}, { reason: 'document_unload', count: 0 });
      cb.current.onDocumentUnload?.();
    };
  }, [activeSource, activePassword]);

  // ---- layout: cumulative offsets ------------------------------------------
  const layout = useMemo(() => {
    const rot90 = rotation === 90 || rotation === 270;
    const dims = pageSizes.map((s) => (rot90 ? { w: s.h, h: s.w } : { w: s.w, h: s.h }));
    let y = PAD;
    const tops = [];
    let maxW = 0;
    for (let i = 0; i < dims.length; i += 1) {
      tops.push(y);
      y += dims[i].h * scale + GAP;
      maxW = Math.max(maxW, dims[i].w * scale);
    }
    const contentW = Math.max(containerW, maxW + 2 * PAD);
    // rawTotalH is the un-offset content height; the FIT predicate must use this,
    // never the padTop-inclusive height. padTop vertically centers any document
    // shorter than the viewport (single page / fitting page) via marginTop on the
    // content node — NOT via scroll, so scroll stays in [0, scrollHeight-clientHeight]
    // and never goes negative. Content taller than the viewport (overflow case)
    // yields padTop=0 and the layout is unchanged.
    const rawTotalH = y - GAP + PAD;
    const padTop = Math.max(0, (containerH - rawTotalH) / 2);
    return { tops, dims, totalH: rawTotalH, rawTotalH, padTop, contentW };
  }, [pageSizes, scale, rotation, containerW, containerH]);

  dimsPtRef.current = layout.dims;
  containerWRef.current = containerW;
  containerHRef.current = containerH;
  topsRef.current = layout.tops;
  padTopRef.current = layout.padTop;

  // ---- current-page detection + onPageChanged ------------------------------
  const detectCurrentPage = useCallback(() => {
    const el = scrollerRef.current;
    const tops = topsRef.current;
    const dims = dimsPtRef.current;
    if (!el || !tops.length) return;
    // tops are in raw content space; padTop (the centering margin) shifts the
    // painted pages down by that much relative to the scroll origin.
    const padTop = padTopRef.current;
    const mid = el.scrollTop + el.clientHeight / 2 - padTop;
    let page = 1;
    for (let i = 0; i < tops.length; i += 1) {
      if (mid >= tops[i] && mid < tops[i] + dims[i].h * scaleRef.current + GAP) { page = i + 1; break; }
      if (mid >= tops[i]) page = i + 1;
    }
    if (page !== currentPageRef.current) {
      const prev = currentPageRef.current;
      currentPageRef.current = page;
      cb.current.onPageChanged?.({
        currentPageNumber: page,
        previousPageNumber: prev ?? null,
        pageCount: numPagesRef.current,
        raw: { scrollTop: el.scrollTop },
      });
    }
  }, []);

  // ---- which pages are mounted ---------------------------------------------
  const recomputeWindow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !layout.tops.length) return;
    // layout.tops are raw-content-space; padTop shifts pages down relative to
    // scroll, so the visibility window is expressed in raw space by subtracting it.
    const padTop = layout.padTop;
    const top = el.scrollTop - padTop;
    const vh = el.clientHeight;
    const over = vh * 1.2;
    const lo = top - over;
    const hi = top + vh + over;
    let first = -1; let last = -1;
    for (let i = 0; i < layout.tops.length; i += 1) {
      const t = layout.tops[i];
      const b = t + layout.dims[i].h * scale;
      if (b >= lo && t <= hi) { if (first === -1) first = i; last = i; }
    }
    if (first === -1) { first = 0; last = -1; }
    // ponytail: cap simultaneously-mounted pages. Zooming far out used to put 50+
    // pages in the 1.2-viewport band → a single-frame raster burst = the flicker.
    // Keep a bounded window centered on the viewport; far pages stay placeholders
    // (only reachable at extreme zoom-out). Raise MAX_MOUNTED if scroll buffering
    // ever feels thin.
    else if (last - first + 1 > MAX_MOUNTED) {
      const midY = top + vh / 2;
      let anchor = first;
      for (let i = first; i <= last; i += 1) { if (layout.tops[i] <= midY) anchor = i; else break; }
      last = Math.min(layout.tops.length - 1, anchor + Math.ceil(MAX_MOUNTED / 2));
      first = Math.max(0, last - MAX_MOUNTED + 1);
    }
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
    detectCurrentPage();
  }, [layout, scale, detectCurrentPage]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const update = () => {
      setContainerW(el.clientWidth);
      // containerH drives padTop (vertical centering). Guard against a 0 height
      // during mount/teardown so padTop doesn't transiently center against nothing.
      const h = el.clientHeight;
      if (h > 0) setContainerH(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; recomputeWindow(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [recomputeWindow]);

  useEffect(() => { recomputeWindow(); }, [recomputeWindow]);

  // ---- apply cursor anchor after the new scale lays out --------------------
  // The committed layout has been measured (scrollWidth/Height now reflect the new
  // scale), so we can clamp the anchored scroll to valid bounds. For an imperative/
  // toolbar zoom this snaps instantly. For a WHEEL gesture the settle requests a
  // GLIDE: tween scrollTop/scrollLeft from the gesture-end position to this clamped
  // target over SETTLE_ANIM_MS so the page eases into its (centered/clamped) resting
  // spot instead of snapping. The page is already at the committed size, so only the
  // position moves — no size jump, no blank flash (committed content is painted).
  useLayoutEffect(() => {
    const p = pendingAnchorRef.current;
    if (!p) return;
    pendingAnchorRef.current = null;
    const el = scrollerRef.current;
    if (!el) return;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const targetLeft = Math.min(Math.max(0, p.left), maxLeft);
    const targetTop = Math.min(Math.max(0, p.top), maxTop);

    const tweenFrom = settleTweenFromRef.current;
    settleTweenFromRef.current = null;
    if (!tweenFrom) {
      el.scrollLeft = targetLeft;
      el.scrollTop = targetTop;
      return;
    }

    // Animated settle: glide from the captured gesture-end scroll to the target.
    const fromLeft = tweenFrom.left;
    const fromTop = tweenFrom.top;
    if (Math.abs(fromLeft - targetLeft) < 0.5 && Math.abs(fromTop - targetTop) < 0.5) {
      el.scrollLeft = targetLeft;
      el.scrollTop = targetTop;
      settleAnimatingRef.current = false;
      setSettleAnimating(false);
      return;
    }
    const myGen = settleGenRef.current; // bumped on commit; a new gesture bumps again
    settleAnimatingRef.current = true;
    setSettleAnimating(true);
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const easeOut = (x) => 1 - (1 - x) * (1 - x) * (1 - x); // cubic ease-out
    const finish = () => {
      settleRafRef.current = 0;
      settleAnimatingRef.current = false;
      setSettleAnimating(false);
    };
    const step = () => {
      // Abort the instant a newer gesture/commit superseded this tween.
      if (myGen !== settleGenRef.current) { settleRafRef.current = 0; return; }
      const elNow = scrollerRef.current;
      if (!elNow) { finish(); return; }
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const k = Math.min(1, (now - t0) / SETTLE_ANIM_MS);
      const e = easeOut(k);
      const maxL = Math.max(0, elNow.scrollWidth - elNow.clientWidth);
      const maxT = Math.max(0, elNow.scrollHeight - elNow.clientHeight);
      elNow.scrollLeft = Math.min(Math.max(0, fromLeft + (targetLeft - fromLeft) * e), maxL);
      elNow.scrollTop = Math.min(Math.max(0, fromTop + (targetTop - fromTop) * e), maxT);
      if (k < 1) settleRafRef.current = requestAnimationFrame(step);
      else finish();
    };
    settleRafRef.current = requestAnimationFrame(step);
  }, [scale]);

  // ---- layout-space anchoring helpers --------------------------------------
  const contentWAt = (sc) => {
    const dims = dimsPtRef.current;
    let maxW = 0;
    for (const d of dims) maxW = Math.max(maxW, d.w * sc);
    return Math.max(containerWRef.current, maxW + 2 * PAD);
  };
  // padTopFor recomputes the centering margin at an ARBITRARY scale (so the anchor
  // math at the new scale uses the new padTop, matching the layout it will commit
  // to). Mirrors the layout memo: max(0,(containerH - rawTotalH)/2) on RAW total.
  const padTopFor = (sc) => {
    const dims = dimsPtRef.current;
    let y = PAD;
    for (let k = 0; k < dims.length; k += 1) y += dims[k].h * sc + GAP;
    const rawTotalH = y - GAP + PAD;
    return Math.max(0, (containerHRef.current - rawTotalH) / 2);
  };
  // topAt returns the page's top in SCROLL space (padTop-inclusive) so cursor
  // content-Y (el.scrollTop + cursorY) and the committed anchor are consistent.
  const topAt = (i, sc) => {
    const dims = dimsPtRef.current;
    let y = PAD + padTopFor(sc);
    for (let k = 0; k < i; k += 1) y += dims[k].h * sc + GAP;
    return y;
  };
  const leftAt = (i, sc) => (contentWAt(sc) - dimsPtRef.current[i].w * sc) / 2;
  const pageUnderContentY = (cY, sc) => {
    const dims = dimsPtRef.current;
    let y = PAD + padTopFor(sc);
    for (let i = 0; i < dims.length; i += 1) {
      const h = dims[i].h * sc;
      if (cY < y + h + GAP) return i;
      y += h + GAP;
    }
    return Math.max(0, dims.length - 1);
  };

  const applyAnchoredScale = useCallback((targetScale, cursorX, cursorY) => {
    const el = scrollerRef.current;
    const dims = dimsPtRef.current;
    if (!el || !dims.length) return;
    const oldScale = scaleRef.current;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale));
    if (Math.abs(newScale - oldScale) < 1e-4) return;
    // Stage 3: imperative zoom (toolbar/keyboard/fit) commits instantly — signal
    // gesture-start here so Canvas tools flush before the host re-layouts. (Wheel
    // gestures already signalled on their first frame; an extra signal is harmless.)
    cb.current.onZoomPhase?.('gesture-start', { atPct: Math.round(oldScale * 100) });
    const cX = el.scrollLeft + cursorX;
    const cY = el.scrollTop + cursorY;
    const i = pageUnderContentY(cY, oldScale);
    const fracX = (cX - leftAt(i, oldScale)) / (dims[i].w * oldScale);
    const fracY = (cY - topAt(i, oldScale)) / (dims[i].h * oldScale);
    const newX = leftAt(i, newScale) + fracX * dims[i].w * newScale;
    const newY = topAt(i, newScale) + fracY * dims[i].h * newScale;
    pendingAnchorRef.current = { left: newX - cursorX, top: newY - cursorY };
    scaleRef.current = newScale;
    setScale(newScale);
  }, []);

  // ---- cursor zoom: CSS-transform preview, commit on settle ----------------
  const applyWheelZoom = useCallback(() => {
    wheelRafRef.current = 0;
    setLiveZoom(liveZoomRef.current);
  }, []);

  // Cancel an in-flight settle glide and hand control back. Bumping the generation
  // makes any queued rAF step bail; clearing the rAF stops the next frame. Called
  // when a fresh wheel gesture starts mid-glide so a stale tween never fights it.
  const abortSettle = useCallback(() => {
    settleGenRef.current += 1;
    if (settleRafRef.current) { cancelAnimationFrame(settleRafRef.current); settleRafRef.current = 0; }
    settleTweenFromRef.current = null;
    settleAnimatingRef.current = false;
    setSettleAnimating(false);
  }, []);

  const commitGesture = useCallback(() => {
    const g = gestureRef.current;
    const lz = liveZoomRef.current;
    gestureRef.current = null;
    liveZoomRef.current = 1;
    if (!g || Math.abs(lz - 1) < 1e-4) { setLiveZoom(1); return; }
    const el = scrollerRef.current;
    const oldScale = scaleRef.current;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * lz));
    // Only arm the GLIDE when the scale actually commits to a new value (otherwise
    // applyAnchoredScale early-returns, no re-layout fires, and the layout effect
    // would never consume the tween — leaving a stale settleTweenFromRef). Capture
    // the gesture-end scroll so the post-commit layout effect eases the page from
    // here to the clamped/centered committed position, instead of snapping when the
    // live transform's anchor differs from the clamped committed scroll. Bump the
    // settle generation so any earlier glide is superseded.
    if (el && Math.abs(newScale - oldScale) >= 1e-4) {
      settleGenRef.current += 1;
      if (settleRafRef.current) { cancelAnimationFrame(settleRafRef.current); settleRafRef.current = 0; }
      settleTweenFromRef.current = { left: el.scrollLeft, top: el.scrollTop };
    }
    // applyAnchoredScale writes scaleRef synchronously, sets pendingAnchor, and
    // setScale → re-layout; the layout effect then reads settleTweenFromRef and
    // tweens. Resetting liveZoom to 1 here swaps the committed (correctly-sized)
    // raster in at the same paint, so there is no size jump and no blank flash —
    // only the scroll position eases.
    applyAnchoredScale(oldScale * lz, g.originCursorX, g.originCursorY);
    setLiveZoom(1);
  }, [applyAnchoredScale]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      if (!gestureRef.current) {
        // A fresh gesture starts: kill any in-flight settle glide so a stale tween
        // never fights the new live transform, then hand control to the gesture.
        abortSettle();
        gestureRef.current = {
          originCursorX: cursorX,
          originCursorY: cursorY,
          originContentX: el.scrollLeft + cursorX,
          originContentY: el.scrollTop + cursorY,
        };
        // Stage 3: a zoom gesture has started — let the host flush in-progress
        // Canvas drawing before the page hosts re-layout on settle.
        cb.current.onZoomPhase?.('gesture-start', { atPct: Math.round(scaleRef.current * 100) });
      }
      const committed = scaleRef.current;
      let lz = liveZoomRef.current * (1 - e.deltaY * WHEEL_GAIN);
      lz = Math.max(MIN_SCALE / committed, Math.min(MAX_SCALE / committed, lz));
      // DRIFT CLAMP (rubber-band): the live transform is unbounded, so zooming can
      // drag content far past where it can validly rest (above the top of a
      // multi-page doc, or a centered page drifting off-center). Project where the
      // anchored scroll WOULD land at this candidate lz; if it falls outside the
      // valid [0, maxTop] band, ease lz back toward the value that keeps it just
      // inside, so the preview can't run away and the settle has little to correct.
      try {
        const dims = dimsPtRef.current;
        if (dims.length) {
          const candScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, committed * lz));
          const cX = el.scrollLeft + cursorX;
          const cY = el.scrollTop + cursorY;
          const pi = pageUnderContentY(cY, committed);
          const fracY = (cY - topAt(pi, committed)) / (dims[pi].h * committed);
          const projTop = topAt(pi, candScale) + fracY * dims[pi].h * candScale - cursorY;
          // Project the new total content height to estimate the valid maxTop.
          let yTot = PAD + padTopFor(candScale);
          for (let k = 0; k < dims.length; k += 1) yTot += dims[k].h * candScale + GAP;
          const projTotalH = yTot - GAP + PAD;
          const projMaxTop = Math.max(0, projTotalH - el.clientHeight);
          const SLACK = 48; // px of rubber-band the preview may exceed before resisting
          let resist = 1;
          if (projTop < -SLACK) resist = SLACK / Math.max(SLACK, -projTop); // over the top
          else if (projTop > projMaxTop + SLACK) resist = SLACK / Math.max(SLACK, projTop - projMaxTop);
          if (resist < 1) {
            // Pull lz back toward the previous lz by the resistance factor (soft).
            const prevLz = liveZoomRef.current;
            lz = prevLz + (lz - prevLz) * resist;
            lz = Math.max(MIN_SCALE / committed, Math.min(MAX_SCALE / committed, lz));
          }
        }
      } catch { /* never throw from the wheel handler */ }
      liveZoomRef.current = lz;
      if (!wheelRafRef.current) wheelRafRef.current = requestAnimationFrame(applyWheelZoom);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(commitGesture, SETTLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      // Tear down any in-flight settle glide so it can't fire after unmount.
      settleGenRef.current += 1;
      if (settleRafRef.current) { cancelAnimationFrame(settleRafRef.current); settleRafRef.current = 0; }
    };
  }, [applyWheelZoom, commitGesture, abortSettle]);

  // ---- drag-to-pan (interactionMode === 'Pan') -----------------------------
  // The owned pdf.js engine owns its own pan: when the Pan tool is active,
  // pressing on the page and dragging scrolls the viewport by the inverse of the
  // pointer delta. (Pdfjs delegated this to viewerBase.panOnMouseMove; that
  // path is dead under the pdf.js cutover, so nothing scrolled before this.)
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || interactionMode !== 'Pan') return undefined;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pid = null;
    const onDown = (e) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      pid = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (_e) { /* not capturable */ }
      el.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      if (!dragging) return;
      el.scrollLeft -= e.clientX - lastX;
      el.scrollTop -= e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      try { if (pid != null) el.releasePointerCapture(pid); } catch (_e) { /* already released */ }
      pid = null;
      el.style.cursor = 'grab';
    };
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerup', onUp, { passive: true });
    el.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.style.cursor = '';
    };
  }, [interactionMode]);

  // ---- imperative zoom / nav -----------------------------------------------
  const zoomToScale = useCallback((target) => {
    const el = scrollerRef.current;
    if (!el) return;
    let newScale = target;
    if (target === 'fit' || target === 'fitw') {
      const s0 = pageSizes[Math.max(0, range[0])] || pageSizes[0] || { w: 612, h: 792 };
      const rot90 = rotation === 90 || rotation === 270;
      const pw = rot90 ? s0.h : s0.w;
      const ph = rot90 ? s0.w : s0.h;
      const fw = (el.clientWidth - 2 * PAD) / pw;
      newScale = target === 'fitw' ? fw : Math.min(fw, (el.clientHeight - 2 * PAD) / ph);
    }
    applyAnchoredScale(newScale, el.clientWidth / 2, el.clientHeight / 2);
  }, [pageSizes, range, applyAnchoredScale]);

  const goToPage = useCallback((n) => {
    const el = scrollerRef.current;
    const tops = topsRef.current;
    if (!el || !tops.length) return false;
    const i = Math.max(0, Math.min(tops.length - 1, (Number(n) || 1) - 1));
    // tops are raw-content-space; padTop shifts the painted page down by that much.
    // (When padTop > 0 the whole doc fits and maxTop clamps this to 0 anyway.)
    el.scrollTop = Math.max(0, padTopRef.current + tops[i] - PAD);
    return true;
  }, []);

  // ---- onZoomChanged (settle only — scale changes only on commit) ----------
  useEffect(() => {
    if (prevScaleRef.current == null) { prevScaleRef.current = scale; return; }
    if (Math.abs(prevScaleRef.current - scale) > 1e-4) {
      const from = prevScaleRef.current;
      prevScaleRef.current = scale;
      cb.current.onZoomChanged?.({
        zoomValue: Math.round(scale * 100),
        raw: { fromPct: Math.round(from * 100), toPct: Math.round(scale * 100), scale },
      });
    }
  }, [scale]);

  // ---- build + diff-emit the {pageNumber: element} map ----------------------
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const next = {};
    root.querySelectorAll('.survey-pdfjs-page-div[data-page-number]').forEach((el) => {
      const pageNumber = Number(el.getAttribute('data-page-number'));
      if (Number.isFinite(pageNumber) && pageNumber > 0 && el.isConnected) next[pageNumber] = el;
    });
    pageContainerMapRef.current = next;
    const prev = lastEmittedMapRef.current;
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    let changed = prevKeys.length !== nextKeys.length;
    if (!changed) { for (const k of nextKeys) { if (prev[k] !== next[k]) { changed = true; break; } } }
    if (changed) {
      lastEmittedMapRef.current = next;
      cb.current.onPageContainersChange?.({ ...next }, { reason: 'layout', count: nextKeys.length });
    }
  }, [range, numPages, scale]);

  // ---- thumbnails -----------------------------------------------------------
  const getThumbnailDataUrl = useCallback(async (pageNumber, opts = {}) => {
    const pdf = pdfRef.current;
    const n = Number(pageNumber);
    if (!pdf || !Number.isFinite(n) || n < 1) return null;
    const targetWidth = Math.max(1, Math.round(Number(opts.targetWidth) || 160));
    const cacheKey = `${n}:${targetWidth}`;
    if (thumbCacheRef.current.has(cacheKey)) return thumbCacheRef.current.get(cacheKey);
    try {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: targetWidth / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const url = canvas.toDataURL('image/jpeg', 0.7);
      thumbCacheRef.current.set(cacheKey, url);
      return url;
    } catch {
      return null;
    }
  }, []);

  const onRaster = useCallback((idx) => {
    cb.current.onPageRendered?.({ pageNumber: idx + 1, timestamp: performance.now() });
  }, []);

  // ---- imperative handle: the full engine contract -------------------------
  useImperativeHandle(ref, () => {
    const noop = () => {};
    return {
      // navigation
      goToPage,
      goToBookmarkSource: () => false, // Stage 4 — caller falls back to goToPage
      resolveBookmarkPageFromSource: () => null,
      navigationModule: { goToPage },
      // state getters (method + property forms)
      getPageCount: () => numPagesRef.current || 0,
      getCurrentPage: () => currentPageRef.current || 1,
      getZoomValue: () => Math.round((scaleRef.current || 1) * 100),
      get pageCount() { return numPagesRef.current || 0; },
      get currentPageNumber() { return currentPageRef.current || 1; },
      get zoomValue() { return Math.round((scaleRef.current || 1) * 100); },
      get element() { return scrollerRef.current; },
      get viewerBase() {
        return {
          getZoomFactor: () => scaleRef.current || 1,
          pageSize: dimsPtRef.current.map((d) => ({ width: d.w, height: d.h })),
        };
      },
      // per-page DOM resolution (overlay-pinning seam)
      getPageContainer: (page) => {
        const target = Number(page);
        if (!Number.isFinite(target) || target < 1) return null;
        const known = pageContainerMapRef.current[target];
        if (known?.isConnected) return known;
        const root = contentRef.current;
        return root?.querySelector(`.survey-pdfjs-page-div[data-page-number="${target}"]`) || null;
      },
      getPageContainers: () => ({ ...pageContainerMapRef.current }),
      getViewerContainer: () => scrollerRef.current,
      getPageLayerContainer: () => contentRef.current,
      // Stable slot inside the transformed content for the app's overlay layers.
      getOverlayHost: () => overlayHostRef.current,
      // zoom
      magnificationModule: {
        zoomTo: (pct) => { const s = Number(pct) / 100; if (Number.isFinite(s)) zoomToScale(s); },
        fitToPage: () => zoomToScale('fit'),
        fitToWidth: () => zoomToScale('fitw'),
        initiateMouseZoom: (x, y, pct) => { const s = Number(pct) / 100; if (Number.isFinite(s)) applyAnchoredScale(s, Number(x) || 0, Number(y) || 0); },
      },
      // document / thumbnails / bookmarks
      load: (source, password = '') => { setActiveSource(source); setActivePassword(password || ''); },
      saveAsBlob: async () => null,            // Stage 4 (export path uses pdf-lib elsewhere)
      print: () => false,                       // Stage 4.4
      getThumbnailDataUrl,
      getPDFBookmarks: () => bookmarksRef.current.slice(),
      // text search — Stage 4.1
      findTextAsync: async () => null,
      searchText: () => false,
      refreshTextSearchHighlights: () => false,
      searchToMatch: async () => false,
      cancelTextSearch: noop,
      // text selection + markup — Stage 4.2
      selectTextMarkupAtPoint: () => null,
      selectTextMarkupAtClientPoint: () => null,
      deleteSelectedTextMarkupAnnotation: () => false,
      eraseTextMarkupAtPoints: () => 0,
      clearTextSelection: noop,
      textSelectionModule: { clearTextSelection: noop },
      // form fields — Stage 4.3 / 4.5
      setDesignerMode: () => false,
      setFormFieldMode: () => false,
      addFormField: () => null,
      updateFormField: () => false,
      deleteFormField: () => false,
      selectFormField: () => false,
      getFormFieldCollection: () => [],
    };
  }, [goToPage, zoomToScale, applyAnchoredScale, getThumbnailDataUrl]);

  const loading = pageSizes.length === 0;

  return (
    <div
      ref={scrollerRef}
      id={viewerId}
      className={className}
      style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#3a3d42', contain: 'strict', ...style }}
    >
      {loading ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#cfd2d6' }}>
          Loading…
        </div>
      ) : (
        <div
          ref={contentRef}
          style={{
            position: 'relative', width: layout.contentW, height: layout.totalH,
            // padTop vertically centers a document shorter than the viewport via
            // margin (not scroll → scrollTop stays >= 0). Overflow docs get padTop=0.
            marginTop: layout.padTop,
            transform: liveZoom !== 1 ? `scale(${liveZoom})` : 'none',
            // transformOrigin is in the content node's OWN box space. originContentX/Y
            // were captured in scroll space; marginTop (padTop) offsets the box top
            // from the scroll origin, so the Y must subtract padTop to keep the
            // cursor-anchored origin exact when a short/centered doc is padded.
            // (padTop is 0 for any doc taller than the viewport, so this is a no-op
            // in the common multi-page case.)
            transformOrigin: gestureRef.current ? `${gestureRef.current.originContentX}px ${gestureRef.current.originContentY - layout.padTop}px` : '0 0',
            // Transition is gated ON only while the settle glide runs — NEVER during
            // the live gesture (where liveZoom updates per-frame and any transition
            // would lag the cursor anchoring). During settle the transform is already
            // 'none', so this only eases incidental transform changes, never the live
            // preview. The position glide itself is driven by the scroll rAF tween.
            transition: settleAnimating && liveZoom === 1 && !gestureRef.current ? 'transform 160ms ease-out' : 'none',
            willChange: liveZoom !== 1 ? 'transform' : 'auto',
          }}
        >
          {pageSizes.map((s, i) => {
            const dim = layout.dims[i];
            const left = (layout.contentW - dim.w * scale) / 2;
            const top = layout.tops[i];
            const mounted = i >= range[0] && i <= range[1];
            return (
              <div
                key={i}
                data-page-number={i + 1}
                className="survey-pdfjs-page-div"
                id={`${viewerId}_pageDiv_${i}`}
                style={{ position: 'absolute', left, top, width: dim.w * scale, height: dim.h * scale }}
              >
                {mounted ? (
                  <>
                    <PdfPageCanvas
                      pdf={pdfRef.current}
                      pageIndex={i}
                      pageW={s.w}
                      pageH={s.h}
                      renderScale={scale}
                      rotation={rotation}
                      onRaster={onRaster}
                    />
                    <DetailTile
                      pdf={pdfRef.current}
                      pageIndex={i}
                      scale={scale}
                      rotation={rotation}
                      liveZoom={liveZoom}
                      scrollerRef={scrollerRef}
                    />
                  </>
                ) : (
                  // ponytail: white blank-page placeholder (was a dark "Page N" box).
                  // It flashes for ~1 frame when a page enters the window on zoom-settle;
                  // white blends into the rasterized page so the pop is near-invisible.
                  <div style={{ width: '100%', height: '100%', background: '#fff' }} />
                )}
              </div>
            );
          })}
          {/* Stable overlay slot — rides the same scale(liveZoom) transform as the pages.
              The app mounts its overlay layers in here so they zoom as one piece. */}
          <div
            ref={overlayHostRef}
            data-pdfjs-overlay-host="true"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />
        </div>
      )}
    </div>
  );
});

export default PdfjsViewerContainer;
