// ============================================================================
// PROTOTYPE — THROWAWAY. Arm A: own the renderer on pdf.js.
// ============================================================================
// A real mini-viewer built directly on pdfjs-dist (no wrapper library):
//   • CONTINUOUS multi-page scroll with VIRTUALIZATION — cumulative page-offset
//     layout + placeholder boxes sized per page so the scrollbar is stable for
//     100+ pages; only pages within ~1.2 viewports of the scroll position mount
//     a canvas. Everything else is a cheap gray placeholder.
//   • CURSOR-ANCHORED ZOOM that HOLDS — ctrl/⌘+wheel zooms about the pointer
//     using new_scroll = (old_scroll + cursor)*ratio - cursor (the pdf.js/Acrobat
//     formula). The committed scale persists; it never snaps back.
//   • RENDER-ON-SETTLE — during the gesture each page CSS-upscales its existing
//     bitmap (instant, temporarily soft); ~180ms after the last wheel tick every
//     visible page re-rasters crisply at the new scale.
//   • DPR-correct, double-buffered rasters with RenderTask cancellation + a
//     generation guard so stale renders never paint.
//   • DEEP-ZOOM TILING — when a full-page raster would exceed the canvas budget
//     (the "crispness cliff"), a DetailTile renders just the VISIBLE slice of the
//     page at full DPR over the soft base, so deep zoom stays sharp. Pixel count
//     is bounded by the viewport, never the (huge) page, so it can't clamp.
//   • IMPORTED ANNOTATIONS — the page's real ink/shape/text markups render via
//     pdf.js's own appearance streams (true smoothing + semi-transparent fills),
//     kept crisp at deep zoom by the same DetailTile re-raster (read-only display).
// ============================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { clampToBudget } from './spikeMetrics';
import { extractInkAnnotations } from './InteractiveOverlay';
import CanvasAnnotationLayer from './CanvasAnnotationLayer';
import SpikeTextLayer from './SpikeTextLayer';
import SpikeLinkLayer from './SpikeLinkLayer';
import SpikeFormLayer from './SpikeFormLayer';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const GAP = 16;
const PAD = 20;
const MIN_SCALE = 0.1;
const MAX_SCALE = 40;
// Above this committed scale the full-page base canvas STOPS rendering crisp and
// becomes a cheap low-res backdrop (rendered at most at BASE_MAX_SCALE), while the
// viewport-sized DetailTile owns sharpness. 2.5 keeps the frozen backdrop reasonably
// sharp during deep-zoom panning. (NOTE: the dominant render cost is executing the
// page's ~400 ink appearance streams, which is resolution-independent — so lowering
// this cap barely speeds the raster; the real lever is a separate annotation layer.)
const BASE_MAX_SCALE = 2.5;
const SETTLE_MS = 110;          // commit the gesture this long after the last wheel tick
const WHEEL_GAIN = 0.01;        // matches EmbedPDF: factor = 1 - deltaY * WHEEL_GAIN
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
const PAN_START_EVENT = 'spike-pdf-pan-start';
const PAN_END_EVENT = 'spike-pdf-pan-end';

const isSpaceKey = (event) => event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
const isEditableTarget = (target) => target instanceof HTMLInputElement
  || target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || target?.isContentEditable;

// --- PERF-GATE STRESS SEED ----------------------------------------------------
// Synthetic dense annotation swarm in PAGE SPACE (points, scale-independent) so it
// rides the same viewBox-CSS-transform path as the real SVGAnnotationLayer. A mix
// of multi-Bézier pen strokes + filled marker dots — the geometry the overlay pays
// for during a cursor-zoom. Deterministic per page so it doesn't reshuffle on every
// re-render. Generated lazily per MOUNTED page, so memory stays virtualization-bounded.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STRESS_PALETTE = ['255,45,85', '10,132,255', '48,209,88', '255,214,10', '191,90,242'];
function makeStressShapes(n, w, h, pageIndex) {
  const rnd = mulberry32((0x9e3779b9 ^ ((pageIndex + 1) * 2654435761)) >>> 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const cx = rnd() * w;
    const cy = rnd() * h;
    const col = STRESS_PALETTE[(i + pageIndex) % STRESS_PALETTE.length];
    if (i % 3 === 0) {
      const s = 6 + rnd() * 22;
      out.push({ id: `st${pageIndex}_${i}`, type: 'mark', source: 'stress', cmds: [['M', cx, cy], ['L', cx + s, cy], ['L', cx + s, cy + s], ['L', cx, cy + s], ['Z']], filled: true, paint: `rgba(${col},0.5)`, strokeWidth: 1 });
    } else {
      const cmds = [['M', cx, cy]];
      let px = cx; let py = cy;
      const segs = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < segs; k++) {
        const nx = Math.max(0, Math.min(w, px + (rnd() - 0.5) * 140));
        const ny = Math.max(0, Math.min(h, py + (rnd() - 0.5) * 140));
        cmds.push(['C', px + (rnd() - 0.5) * 90, py + (rnd() - 0.5) * 90, nx + (rnd() - 0.5) * 90, ny + (rnd() - 0.5) * 90, nx, ny]);
        px = nx; py = ny;
      }
      out.push({ id: `st${pageIndex}_${i}`, type: 'mark', source: 'stress', cmds, filled: false, paint: `rgba(${col},0.9)`, strokeWidth: 1.2 + rnd() * 1.6 });
    }
  }
  return out;
}

// --- one mounted page: double-buffered, DPR-correct, cancellable raster -------
// The canvas FILLS its wrapper (width/height 100%). The wrapper is sized to the
// live display scale by the parent, so: (a) the bitmap upscales instantly during
// a zoom gesture (render-on-settle), and (b) rotation is correct for free — the
// rotated bitmap fills a rotated-aspect wrapper instead of being squashed into an
// unrotated CSS box.
function PdfPageCanvas({ pdf, pageIndex, pageW, pageH, renderScale, rotation, bakeAnnotations, onRaster }) {
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const genRef = useRef(0);
  // Above BASE_MAX_SCALE the base is a fixed cheap backdrop: it renders ONCE at the
  // cap and does NOT re-raster as you zoom/pan deeper (the effect keys on baseScale,
  // which stops changing past the cap). DetailTile owns sharpness up there.
  const baseScale = Math.min(renderScale, BASE_MAX_SCALE);
  const tiled = renderScale > BASE_MAX_SCALE;

  // Crisp raster, debounced via renderScale (committed scale). Renders into an
  // offscreen canvas, then blits to the visible one on success → no white flash.
  useEffect(() => {
    let cancelled = false;
    const myGen = ++genRef.current;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled || myGen !== genRef.current) return;

      // clampToBudget kept as a final safety net for very large pages.
      const want = baseScale * DPR;
      const backingW = pageW * want;
      const backingH = pageH * want;
      const { factor } = clampToBudget(backingW, backingH);
      const rasterScale = want * factor;
      const viewport = page.getViewport({ scale: rasterScale, rotation: page.rotate + rotation });

      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.floor(viewport.width));
      off.height = Math.max(1, Math.floor(viewport.height));
      const ctx = off.getContext('2d', { alpha: false });

      if (taskRef.current) { try { taskRef.current.cancel(); } catch {} }
      const t0 = performance.now();
      const annotationMode = bakeAnnotations ? undefined : pdfjsLib.AnnotationMode.DISABLE;
      const task = page.render({ canvasContext: ctx, viewport, annotationMode });
      task.onContinue = (resume) => requestAnimationFrame(resume);
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
      const ms = Math.round(performance.now() - t0);
      onRaster?.(pageIndex, { ms, clamped: tiled, backingW: off.width, backingH: off.height });
    })();
    return () => { cancelled = true; if (taskRef.current) { try { taskRef.current.cancel(); } catch {} } };
  }, [pdf, pageIndex, pageW, pageH, baseScale, rotation, bakeAnnotations]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', background: '#fff', boxShadow: '0 2px 14px rgba(0,0,0,0.45)' }} />;
}

// --- DEEP-ZOOM DETAIL TILE ----------------------------------------------------
// When the full-page raster would clamp (deep zoom → blur), render ONLY the slice
// of this page currently inside the scroller viewport, at full DPR, and lay it
// over the soft base canvas. The slice can never be bigger than the viewport, so
// the pixel count is bounded and never hits the canvas budget = crisp deep zoom.
// Re-renders on settle (committed scale) and on scroll; idle during a live gesture
// (the base canvas CSS-scales meanwhile, then this re-sharpens on settle).
function DetailTile({ pdf, pageIndex, scale, rotation, liveZoom, interactionRef, bakeAnnotations, scrollerRef, onRasterEvent }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const genRef = useRef(0);
  const [tile, setTile] = useState(null); // { left, top, w, h } CSS within wrapper

  const render = useCallback(async () => {
    const host = hostRef.current;
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    if (!host || !scroller || !canvas || !pdf || liveZoom !== 1 || interactionRef?.current) return;

    const hr = host.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    // Tile whenever the base has dropped to its cheap backdrop (committed scale past
    // the cap); below that the base is already crisp, so no tile needed.
    if (scale <= BASE_MAX_SCALE) { setTile(null); return; }

    // Visible slice of this page, in the page's own (already-scaled) CSS px.
    const vx = Math.max(0, sr.left - hr.left);
    const vy = Math.max(0, sr.top - hr.top);
    const vw = Math.min(hr.width, sr.right - hr.left) - vx;
    const vh = Math.min(hr.height, sr.bottom - hr.top) - vy;
    if (vw <= 1 || vh <= 1) { setTile(null); return; }

    const myGen = ++genRef.current;
    const page = await pdf.getPage(pageIndex + 1);
    if (myGen !== genRef.current) return;

    const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
    const cw = Math.max(1, Math.round(vw * DPR));
    const ch = Math.max(1, Math.round(vh * DPR));
    const off = document.createElement('canvas');
    off.width = cw; off.height = ch;
    const ctx = off.getContext('2d', { alpha: false });

    if (taskRef.current) { try { taskRef.current.cancel(); } catch {} }
    // Shift the page output so the visible slice lands at the canvas origin, at DPR.
    // Renders WITH annotation appearances (default), so the markups in the visible
    // slice come back crisp at the current zoom instead of upscaled-and-blurry.
    const transform = [DPR, 0, 0, DPR, -vx * DPR, -vy * DPR];
    // Match the base canvas: bake in view mode, DISABLE in edit mode (overlay owns
    // the marks). Deep-zoom tiles stay crisp either way; in edit mode the overlay's
    // vector marks scale crisply on their own.
    const annotationMode = bakeAnnotations ? undefined : pdfjsLib.AnnotationMode.DISABLE;
    const task = page.render({ canvasContext: ctx, viewport, transform, annotationMode });
    task.onContinue = (resume) => requestAnimationFrame(resume);
    taskRef.current = task;
    const t0 = performance.now();
    try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
    if (myGen !== genRef.current) return;

    const c = canvasRef.current;
    if (!c) return;
    c.width = cw; c.height = ch;
    c.getContext('2d', { alpha: false }).drawImage(off, 0, 0);
    setTile({ left: vx, top: vy, w: vw, h: vh });
    onRasterEvent?.({ kind: 'tile', page: pageIndex + 1, ms: Math.round(performance.now() - t0), tiled: true, mp: Math.round((cw * ch) / 1048576), zoomPct: Math.round(scale * 100) });
  }, [pdf, pageIndex, scale, rotation, liveZoom, interactionRef, bakeAnnotations, scrollerRef, onRasterEvent]);

  // re-render on scale / rotation / settle
  useEffect(() => { render(); }, [render]);

  // re-render on scroll (debounced), only meaningful while settled
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let t;
    const onScroll = () => {
      if (interactionRef?.current) return;
      clearTimeout(t);
      t = setTimeout(() => render(), 70);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScroll); clearTimeout(t); };
  }, [render, scrollerRef, interactionRef]);

  useEffect(() => {
    const onPanStart = () => {
      if (!taskRef.current) return;
      try { taskRef.current.cancel(); } catch { /* already settled */ }
    };
    const onPanEnd = () => render();
    window.addEventListener(PAN_START_EVENT, onPanStart);
    window.addEventListener(PAN_END_EVENT, onPanEnd);
    return () => {
      window.removeEventListener(PAN_START_EVENT, onPanStart);
      window.removeEventListener(PAN_END_EVENT, onPanEnd);
    };
  }, [render]);

  useEffect(() => () => { if (taskRef.current) { try { taskRef.current.cancel(); } catch {} } }, []);

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', left: tile ? tile.left : 0, top: tile ? tile.top : 0, width: tile ? tile.w : 0, height: tile ? tile.h : 0, display: tile ? 'block' : 'none' }}
      />
    </div>
  );
}

export default function PdfjsArm({
  fileSrc,
  fileKey,
  editMode = false,
  stressShapesPerPage = 0,
  textSelectable = false,
  showLinks = false,
  showForms = false,
  searchQuery = '',
  annotationTool = 'select',
  penColor = '#e11d48',
  penWidth = 10,
  textColor = '#111827',
  textFontSize = 16,
  eraserWidth = 24,
  eraseMode = 'partial',
  sloppiness = 0,
  annsByPage,
  onAnnsChange,
  onAnnotationRender,
  onMetrics,
  onStatus,
  onRasterEvent,
  onZoomPhase,
  onDocument,
}) {
  const scrollerRef = useRef(null);
  const pdfRef = useRef(null);
  const [numPages, setNumPages] = useState(0);
  const [pageSizes, setPageSizes] = useState([]); // [{w,h}] in PDF points
  const [scale, setScale] = useState(1);          // committed (rasterized) scale
  const [liveZoom, setLiveZoom] = useState(1);    // transient gesture multiplier (CSS transform only)
  const [rotation, setRotation] = useState(0);
  const [range, setRange] = useState([0, -1]);    // [firstMounted, lastMounted]
  const [containerW, setContainerW] = useState(800);
  // Edit mode disables pdf.js annotation baking. Imported and native marks share
  // one page-space model and one Canvas2D renderer, so there is no duplicate visual
  // while zooming or panning and no SVG/Fabric handoff during editing.
  const anns = annsByPage || {};
  const annsRef = useRef(anns);
  annsRef.current = anns;
  const extractingRef = useRef(new Set()); // pages with an in-flight extraction
  const stressAppliedRef = useRef(new Map());
  const pdfLibRef = useRef(null);          // pdf-lib doc (real annotation dicts: pts, color, /CA opacity)
  const [libReady, setLibReady] = useState(false);

  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  // Debug hooks captured in refs so wiring them never re-runs the zoom/raster effects.
  const onRasterEventRef = useRef(onRasterEvent);
  const onZoomPhaseRef = useRef(onZoomPhase);
  const onAnnotationRenderRef = useRef(onAnnotationRender);
  useEffect(() => {
    onRasterEventRef.current = onRasterEvent;
    onZoomPhaseRef.current = onZoomPhase;
    onAnnotationRenderRef.current = onAnnotationRender;
  }, [onRasterEvent, onZoomPhase, onAnnotationRender]);
  const settleTimerRef = useRef(null);
  const pendingAnchorRef = useRef(null);
  const wheelRafRef = useRef(0);
  const liveZoomRef = useRef(1);                  // accumulated gesture multiplier
  const gestureRef = useRef(null);                // { originCursorX/Y (viewport px), originContentX/Y }
  const lastCursorRef = useRef({ x: 0, y: 0 });
  const rasterInfoRef = useRef({ ms: 0, clamped: false, backingW: 0, backingH: 0 });
  // live layout snapshot so the stable (memo-free) zoom callbacks can anchor
  // against the REAL centered/padded layout instead of an origin-scaling proxy.
  const dimsPtRef = useRef([]);
  const containerWRef = useRef(800);
  const topsRef = useRef([]); // current per-page top offsets (for goToPage)
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const spacePanRef = useRef(false);
  const panPointerRef = useRef(null);
  const panDeltaRef = useRef({ x: 0, y: 0 });
  const panRafRef = useRef(0);

  // ---- load document --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setPageSizes([]); setNumPages(0); setRange([0, -1]);
    stressAppliedRef.current.clear();
    pdfLibRef.current = null; setLibReady(false);
    onStatus?.('loading…');
    // pdf-lib reads the REAL annotation dicts (points, /C color, /CA opacity, /BS
    // width) the way the app's importer does — pdf.js's getAnnotations hides /CA.
    fetch(fileSrc).then((r) => r.arrayBuffer()).then((buf) => PDFDocument.load(buf, { updateMetadata: false }))
      .then((doc) => { if (!cancelled) { pdfLibRef.current = doc; setLibReady(true); } })
      .catch(() => {});
    (async () => {
      try {
        const task = pdfjsLib.getDocument({ url: fileSrc, isEvalSupported: false });
        const pdf = await task.promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        onDocument?.(pdf);
        setNumPages(pdf.numPages);
        const sizes = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const pg = await pdf.getPage(i);
          if (cancelled) return;
          // No rotation arg → pdf.js defaults to the page's intrinsic /Rotate, so
          // these dims are already rotation-baked (a /Rotate-270 page reports its
          // displayed landscape size). This is how the Walkthrough production
          // renderer gets mixed orientations right: trust pdf.js, no manual swap.
          const vp = pg.getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setPageSizes(sizes);
        // initial scale: fit the first page's width to the container
        const el = scrollerRef.current;
        const cw = el ? el.clientWidth : 800;
        const fit = Math.max(0.2, Math.min(2, (cw - 2 * PAD) / (sizes[0]?.w || 612)));
        setScale(fit); scaleRef.current = fit; setLiveZoom(1); liveZoomRef.current = 1;
        onStatus?.(`${pdf.numPages} pages`);
      } catch (e) {
        onStatus?.(`ERROR: ${e?.message || e}`);
      }
    })();
    return () => { cancelled = true; };
  }, [fileSrc, fileKey]);

  // ---- layout: cumulative offsets (depends on sizes + scale + rotation) ------
  const layout = useMemo(() => {
    const rot90 = rotation === 90 || rotation === 270;
    const dims = pageSizes.map((s) => (rot90 ? { w: s.h, h: s.w } : { w: s.w, h: s.h }));
    let y = PAD;
    const tops = [];
    let maxW = 0;
    for (let i = 0; i < dims.length; i++) {
      tops.push(y);
      y += dims[i].h * scale + GAP;
      maxW = Math.max(maxW, dims[i].w * scale);
    }
    const contentW = Math.max(containerW, maxW + 2 * PAD);
    return { tops, dims, totalH: y - GAP + PAD, contentW };
  }, [pageSizes, scale, rotation, containerW]);

  // keep the layout snapshot refs current for the stable zoom callbacks
  dimsPtRef.current = layout.dims;
  containerWRef.current = containerW;
  topsRef.current = layout.tops;

  // ---- recompute which pages are mounted ------------------------------------
  const recomputeWindow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !layout.tops.length) return;
    const top = el.scrollTop;
    const vh = el.clientHeight;
    const over = vh * 1.2;
    const lo = top - over;
    const hi = top + vh + over;
    let first = -1, last = -1;
    for (let i = 0; i < layout.tops.length; i++) {
      const t = layout.tops[i];
      const b = t + layout.dims[i].h * scale;
      if (b >= lo && t <= hi) { if (first === -1) first = i; last = i; }
    }
    if (first === -1) { first = 0; last = -1; }
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
  }, [layout, scale]);

  // measure container width
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // scroll listener (passive, rAF-coalesced)
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; recomputeWindow(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [recomputeWindow]);

  // recompute window whenever layout changes (scale/sizes/rotation)
  useEffect(() => { recomputeWindow(); }, [recomputeWindow]);

  // ---- space-hold pan: native screen deltas, one scroll write per frame -----
  const flushPan = useCallback(() => {
    if (panRafRef.current) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = 0;
    }
    const el = scrollerRef.current;
    const delta = panDeltaRef.current;
    panDeltaRef.current = { x: 0, y: 0 };
    if (!el || (!delta.x && !delta.y)) return;
    el.scrollLeft -= delta.x;
    el.scrollTop -= delta.y;
  }, []);

  const schedulePan = useCallback((dx, dy) => {
    panDeltaRef.current.x += dx;
    panDeltaRef.current.y += dy;
    if (panRafRef.current) return;
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = 0;
      const el = scrollerRef.current;
      const delta = panDeltaRef.current;
      panDeltaRef.current = { x: 0, y: 0 };
      if (!el) return;
      el.scrollLeft -= delta.x;
      el.scrollTop -= delta.y;
    });
  }, []);

  const finishPan = useCallback(() => {
    flushPan();
    const pointer = panPointerRef.current;
    const el = scrollerRef.current;
    if (pointer && el) {
      try { el.releasePointerCapture(pointer.id); } catch { /* already released */ }
    }
    panPointerRef.current = null;
    if (el) {
      el.dataset.spacePan = spacePanRef.current ? 'armed' : 'off';
      el.style.cursor = spacePanRef.current ? 'grab' : 'default';
      el.style.userSelect = spacePanRef.current ? 'none' : 'auto';
    }
  }, [flushPan]);

  useEffect(() => {
    const activate = (event) => {
      if (!isSpaceKey(event) || isEditableTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (spacePanRef.current) return;
      spacePanRef.current = true;
      const el = scrollerRef.current;
      if (el) {
        el.dataset.spacePan = 'armed';
        el.style.cursor = 'grab';
        el.style.userSelect = 'none';
      }
      window.dispatchEvent(new Event(PAN_START_EVENT));
    };
    const release = (event) => {
      if (event && !isSpaceKey(event)) return;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!spacePanRef.current && !panPointerRef.current) return;
      spacePanRef.current = false;
      finishPan();
      window.dispatchEvent(new Event(PAN_END_EVENT));
    };
    const onVisibility = () => { if (document.hidden) release(); };
    window.addEventListener('keydown', activate, true);
    window.addEventListener('keyup', release, true);
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', activate, true);
      window.removeEventListener('keyup', release, true);
      window.removeEventListener('blur', release);
      window.removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', onVisibility);
      finishPan();
    };
  }, [finishPan]);

  const onPanPointerDown = useCallback((event) => {
    if (!spacePanRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const el = scrollerRef.current;
    if (!el) return;
    el.setPointerCapture(event.pointerId);
    panPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    el.dataset.spacePan = 'dragging';
    el.style.cursor = 'grabbing';
  }, []);

  const onPanPointerMove = useCallback((event) => {
    const pointer = panPointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    schedulePan(dx, dy);
  }, [schedulePan]);

  const onPanPointerEnd = useCallback((event) => {
    const pointer = panPointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finishPan();
  }, [finishPan]);

  // ---- apply the cursor anchor AFTER the new scale lays out ------------------
  useLayoutEffect(() => {
    const p = pendingAnchorRef.current;
    if (!p) return;
    pendingAnchorRef.current = null;
    const el = scrollerRef.current;
    if (!el) return;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollLeft = Math.min(Math.max(0, p.left), maxLeft);
    el.scrollTop = Math.min(Math.max(0, p.top), maxTop);
  }, [scale]);

  // ---- layout-space anchoring (keeps the point under the cursor FIXED) -------
  // The on-screen position of a page point is NOT a pure scaling about origin 0:
  // pages are centered in contentW (which has a max(containerW,…) clamp) and the
  // cumulative tops carry scale-invariant PAD + i·GAP. So we anchor by mapping the
  // cursor to (page index, fraction within page) at the OLD scale, then placing
  // that exact point back under the cursor using the REAL layout at the NEW scale.
  const contentWAt = (sc) => {
    const dims = dimsPtRef.current;
    let maxW = 0;
    for (const d of dims) maxW = Math.max(maxW, d.w * sc);
    return Math.max(containerWRef.current, maxW + 2 * PAD);
  };
  const topAt = (i, sc) => {
    const dims = dimsPtRef.current;
    let y = PAD;
    for (let k = 0; k < i; k++) y += dims[k].h * sc + GAP;
    return y;
  };
  const leftAt = (i, sc) => (contentWAt(sc) - dimsPtRef.current[i].w * sc) / 2;
  const pageUnderContentY = (cY, sc) => {
    const dims = dimsPtRef.current;
    let y = PAD;
    for (let i = 0; i < dims.length; i++) {
      const h = dims[i].h * sc;
      if (cY < y + h + GAP) return i;
      y += h + GAP;
    }
    return Math.max(0, dims.length - 1);
  };

  // Set a new committed scale while keeping the content point under (cursorX,
  // cursorY) (viewport-relative px) fixed. Returns nothing; caller owns renderScale.
  const applyAnchoredScale = useCallback((targetScale, cursorX, cursorY) => {
    const el = scrollerRef.current;
    const dims = dimsPtRef.current;
    if (!el || !dims.length) return;
    const oldScale = scaleRef.current;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale));
    if (Math.abs(newScale - oldScale) < 1e-4) return;

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

  // ---- cursor zoom: instant CSS-transform preview, commit on settle ----------
  // During the gesture the WHOLE page-stack scales as one rigid unit about the
  // cursor (content + overlay locked together, no per-frame re-layout = buttery
  // and perfectly pinned). On settle we commit to the real layout at the new
  // scale (re-raster) and reset the transform. Gain matches EmbedPDF exactly.
  const applyWheelZoom = useCallback(() => {
    wheelRafRef.current = 0;
    setLiveZoom(liveZoomRef.current); // one transform update per frame
  }, []);

  const commitGesture = useCallback(() => {
    const g = gestureRef.current;
    const lz = liveZoomRef.current;
    gestureRef.current = null;
    liveZoomRef.current = 1;
    if (!g || Math.abs(lz - 1) < 1e-4) { setLiveZoom(1); return; }
    // commit: real layout at committed*lz, cursor anchored at the gesture origin
    onZoomPhaseRef.current?.('settle', { fromPct: Math.round(scaleRef.current * 100), toPct: Math.round(scaleRef.current * lz * 100) });
    applyAnchoredScale(scaleRef.current * lz, g.originCursorX, g.originCursorY);
    setLiveZoom(1);
  }, [applyAnchoredScale]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel = native scroll/pan
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      lastCursorRef.current = { x: e.clientX, y: e.clientY };
      if (!gestureRef.current) {
        gestureRef.current = {
          originCursorX: cursorX,
          originCursorY: cursorY,
          originContentX: el.scrollLeft + cursorX,
          originContentY: el.scrollTop + cursorY,
        };
        onZoomPhaseRef.current?.('gesture-start', { atPct: Math.round(scaleRef.current * 100) });
      }
      const committed = scaleRef.current;
      let lz = liveZoomRef.current * (1 - e.deltaY * WHEEL_GAIN);
      lz = Math.max(MIN_SCALE / committed, Math.min(MAX_SCALE / committed, lz));
      liveZoomRef.current = lz;
      if (!wheelRafRef.current) wheelRafRef.current = requestAnimationFrame(applyWheelZoom);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(commitGesture, SETTLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current); };
  }, [applyWheelZoom, commitGesture]);

  // ---- quick zoom / rotate (anchored to viewport center) --------------------
  const zoomTo = useCallback((target) => {
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
  }, [pageSizes, range, rotation, applyAnchoredScale]);

  // ---- extract the real markups for mounted pages (edit mode only) ----------
  // Lazily reads each visible page's annotations into editable page-space objects
  // (cached in annsByPage, lifted to the parent so it survives scroll unmounts).
  // Guarded so a page is fetched once; rotation is baked into the viewport used.
  useEffect(() => {
    if (!editMode || !pdfRef.current || !pdfLibRef.current || range[1] < range[0]) return;
    const lib = pdfLibRef.current;
    for (let i = range[0]; i <= range[1]; i++) {
      const stressKey = `${fileKey}:${rotation}:${stressShapesPerPage}`;
      if (anns[i] !== undefined) {
        if (stressAppliedRef.current.get(i) !== stressKey) {
          const base = anns[i].filter((annotation) => annotation.source !== 'stress');
          const dim = layout.dims[i];
          const synthetic = stressShapesPerPage > 0
            ? makeStressShapes(stressShapesPerPage, dim.w, dim.h, i)
            : [];
          stressAppliedRef.current.set(i, stressKey);
          onAnnsChange?.(i, [...base, ...synthetic]);
        }
        continue;
      }
      if (extractingRef.current.has(i)) continue;
      extractingRef.current.add(i);
      // Marks are valid page data regardless of effect re-runs (no cancelled-flag
      // gate — that once silently dropped the heavy page and never retried). pdf-lib
      // gives the real dict (color + /CA opacity); the pdf.js viewport does the
      // rotation-correct point mapping.
      (async () => {
        try {
          const page = await pdfRef.current.getPage(i + 1);
          const vp = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
          const libPage = lib.getPages()[i];
          const real = libPage ? extractInkAnnotations(libPage, vp, lib.context) : [];
          // The imported marks stay first-class + interactive. The PERF-GATE stress
          // swarm is layered ON TOP (additive, same page space) so we exercise import
          // + add-on annotations together — never replacing the imported ones.
          const synthetic = stressShapesPerPage > 0 ? makeStressShapes(stressShapesPerPage, vp.width, vp.height, i) : [];
          stressAppliedRef.current.set(i, stressKey);
          onAnnsChange?.(i, [...real, ...synthetic]);
        } catch { /* ignore — page may have unmounted */ }
        finally { extractingRef.current.delete(i); }
      })();
    }
  }, [editMode, libReady, range, rotation, anns, onAnnsChange, stressShapesPerPage, fileKey, layout.dims]);

  // ---- metrics reporting ----------------------------------------------------
  const onRaster = useCallback((idx, info) => {
    rasterInfoRef.current = info;
    onRasterEventRef.current?.({ kind: 'base', page: idx + 1, ms: info.ms, tiled: info.clamped, mp: Math.round(((info.backingW || 0) * (info.backingH || 0)) / 1048576), zoomPct: Math.round(scaleRef.current * liveZoomRef.current * 100) });
    onMetrics?.({ zoomPct: Math.round(scaleRef.current * liveZoomRef.current * 100), mounted: Math.max(0, range[1] - range[0] + 1), rasterMs: info.ms, clamped: info.clamped, backingW: info.backingW, backingH: info.backingH });
  }, [onMetrics, range]);

  useEffect(() => {
    let annotationCount = 0;
    for (let i = range[0]; i <= range[1]; i += 1) {
      annotationCount += anns[i]?.length ?? stressShapesPerPage;
    }
    onMetrics?.({
      zoomPct: Math.round(scale * liveZoom * 100),
      mounted: Math.max(0, range[1] - range[0] + 1),
      annotationCount,
      rasterMs: rasterInfoRef.current.ms,
      clamped: rasterInfoRef.current.clamped,
      backingW: rasterInfoRef.current.backingW,
      backingH: rasterInfoRef.current.backingH,
    });
  }, [scale, liveZoom, range, anns, stressShapesPerPage, onMetrics]);

  // jump the scroller so page N lands at the top (bookmark / outline navigation)
  const goToPage = useCallback((n) => {
    const el = scrollerRef.current;
    const tops = topsRef.current;
    if (!el || !tops.length) return;
    const i = Math.max(0, Math.min(tops.length - 1, (Number(n) || 1) - 1));
    el.scrollTop = Math.max(0, tops[i] - PAD);
  }, []);

  // CSS for the pdf.js text layer (glyph positioning) + form layer (widget elements)
  useEffect(() => {
    if (!textSelectable && !showForms) return undefined;
    const style = document.createElement('style');
    style.textContent = `
      .spikeTextLayer { color: transparent; user-select: text; -webkit-user-select: text; }
      .spikeTextLayer > span { position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; }
      .spikeTextLayer ::selection { background: rgba(58,122,254,0.45); }
      .spikeTextLayer ::-moz-selection { background: rgba(58,122,254,0.45); }
      .spikeFormLayer { pointer-events: none; }
      .spikeFormLayer section { position: absolute; pointer-events: auto; box-sizing: border-box; }
      .spikeFormLayer .textWidgetAnnotation input, .spikeFormLayer .textWidgetAnnotation textarea,
      .spikeFormLayer .choiceWidgetAnnotation select, .spikeFormLayer .buttonWidgetAnnotation input {
        width: 100%; height: 100%; box-sizing: border-box; margin: 0; font: inherit; padding: 0 2px;
        background: rgba(60,130,255,0.06); border: 1px solid rgba(60,130,255,0.55); color: #111;
      }
      .spikeFormLayer .buttonWidgetAnnotation.checkBox input,
      .spikeFormLayer .buttonWidgetAnnotation.radioButton input { appearance: auto; -webkit-appearance: auto; background: #fff; }
      [data-space-pan='armed'], [data-space-pan='armed'] * { cursor: grab !important; }
      [data-space-pan='dragging'], [data-space-pan='dragging'] * { cursor: grabbing !important; }
      [data-space-pan]:not([data-space-pan='off']) [data-eraser-cursor] { display: none !important; }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, [textSelectable, showForms]);

  // ---- expose controls to parent via window (simple for a throwaway) --------
  useEffect(() => {
    const api = {
      zoomTo,
      goToPage,
      rotate: () => setRotation((r) => (r === 0 ? 90 : r === 90 ? 270 : 0)),
      getAnnotations: (pageIndex = 0) => annsRef.current[pageIndex] || [],
      getViewportState: () => ({
        scale: scaleRef.current,
        liveZoom: liveZoomRef.current,
        mountedRange: rangeRef.current,
        scrollLeft: scrollerRef.current?.scrollLeft || 0,
        scrollTop: scrollerRef.current?.scrollTop || 0,
      }),
    };
    window.__spikePdfjs = api;
    return () => { if (window.__spikePdfjs === api) delete window.__spikePdfjs; };
  }, [zoomTo, goToPage]);

  const loading = pageSizes.length === 0;

  return (
    <div
      ref={scrollerRef}
      data-space-pan={spacePanRef.current ? (panPointerRef.current ? 'dragging' : 'armed') : 'off'}
      onPointerDownCapture={onPanPointerDown}
      onPointerMoveCapture={onPanPointerMove}
      onPointerUpCapture={onPanPointerEnd}
      onPointerCancelCapture={onPanPointerEnd}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
        background: '#3a3d42',
        contain: 'strict',
        cursor: spacePanRef.current ? (panPointerRef.current ? 'grabbing' : 'grab') : 'default',
        userSelect: spacePanRef.current ? 'none' : 'auto',
      }}
    >
      {loading ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#cfd2d6' }}>
          Loading pdf.js document…
        </div>
      ) : (
        <div
          style={{
            position: 'relative', width: layout.contentW, height: layout.totalH,
            transform: liveZoom !== 1 ? `scale(${liveZoom})` : 'none',
            transformOrigin: gestureRef.current ? `${gestureRef.current.originContentX}px ${gestureRef.current.originContentY}px` : '0 0',
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
                data-page-index={i}
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
                      bakeAnnotations={!editMode}
                      onRaster={onRaster}
                    />
                    <DetailTile
                      pdf={pdfRef.current}
                      pageIndex={i}
                      scale={scale}
                      rotation={rotation}
                      liveZoom={liveZoom}
                      interactionRef={spacePanRef}
                      bakeAnnotations={!editMode}
                      scrollerRef={scrollerRef}
                      onRasterEvent={onRasterEvent}
                    />
                    {textSelectable && (
                      <SpikeTextLayer
                        pdf={pdfRef.current}
                        pageIndex={i}
                        scale={scale}
                        rotation={rotation}
                        searchQuery={searchQuery}
                      />
                    )}
                    {editMode && (
                      <CanvasAnnotationLayer
                        pageWidth={dim.w}
                        pageHeight={dim.h}
                        renderScale={scale}
                        liveZoom={liveZoom}
                        annotations={anns[i] || []}
                        interactive
                        tool={annotationTool}
                        penColor={penColor}
                        penWidth={penWidth}
                        textColor={textColor}
                        textFontSize={textFontSize}
                        eraserWidth={eraserWidth}
                        eraseMode={eraseMode}
                        sloppiness={sloppiness}
                        panActiveRef={spacePanRef}
                        scrollerRef={scrollerRef}
                        onChange={(next) => onAnnsChange?.(i, next)}
                        onRenderMetrics={(info) => onAnnotationRenderRef.current?.(i, { ...info, mountedRange: range })}
                      />
                    )}
                    {showForms && (
                      <SpikeFormLayer
                        pdf={pdfRef.current}
                        pageIndex={i}
                        scale={scale}
                        rotation={rotation}
                      />
                    )}
                    {showLinks && (
                      <SpikeLinkLayer
                        pdf={pdfRef.current}
                        pageIndex={i}
                        scale={scale}
                        rotation={rotation}
                      />
                    )}
                  </>
                ) : (
                  <div style={{ width: '100%', height: '100%', background: '#33363b', border: '1px solid #2a2c30', display: 'grid', placeItems: 'center', color: '#6b7077', fontSize: 13 }}>
                    Page {i + 1}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
