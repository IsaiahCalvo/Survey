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
//   • A deliberate canvas-budget CLAMP that makes the pdf.js-direct deep-zoom
//     "crispness cliff" visible (the exact point tiling becomes necessary).
//   • Interactive, page-locked annotation overlay on every mounted page.
// ============================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import InteractiveOverlay from './InteractiveOverlay';
import { clampToBudget } from './spikeMetrics';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const GAP = 16;
const PAD = 20;
const MIN_SCALE = 0.1;
const MAX_SCALE = 40;
const SETTLE_MS = 150;          // commit the gesture this long after the last wheel tick
const WHEEL_GAIN = 0.01;        // matches EmbedPDF: factor = 1 - deltaY * WHEEL_GAIN
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

// --- one mounted page: double-buffered, DPR-correct, cancellable raster -------
// The canvas FILLS its wrapper (width/height 100%). The wrapper is sized to the
// live display scale by the parent, so: (a) the bitmap upscales instantly during
// a zoom gesture (render-on-settle), and (b) rotation is correct for free — the
// rotated bitmap fills a rotated-aspect wrapper instead of being squashed into an
// unrotated CSS box.
function PdfPageCanvas({ pdf, pageIndex, pageW, pageH, renderScale, rotation, onRaster }) {
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const genRef = useRef(0);

  // Crisp raster, debounced via renderScale (committed scale). Renders into an
  // offscreen canvas, then blits to the visible one on success → no white flash.
  useEffect(() => {
    let cancelled = false;
    const myGen = ++genRef.current;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled || myGen !== genRef.current) return;

      const want = renderScale * DPR;
      const backingW = pageW * want;
      const backingH = pageH * want;
      const { factor, clamped } = clampToBudget(backingW, backingH);
      const rasterScale = want * factor;
      const viewport = page.getViewport({ scale: rasterScale, rotation });

      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.floor(viewport.width));
      off.height = Math.max(1, Math.floor(viewport.height));
      const ctx = off.getContext('2d', { alpha: false });

      if (taskRef.current) { try { taskRef.current.cancel(); } catch {} }
      const t0 = performance.now();
      const task = page.render({ canvasContext: ctx, viewport });
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
      onRaster?.(pageIndex, { ms, clamped, backingW: off.width, backingH: off.height });
    })();
    return () => { cancelled = true; if (taskRef.current) { try { taskRef.current.cancel(); } catch {} } };
  }, [pdf, pageIndex, pageW, pageH, renderScale, rotation]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', background: '#fff', boxShadow: '0 2px 14px rgba(0,0,0,0.45)' }} />;
}

export default function PdfjsArm({ fileSrc, fileKey, annsByPage, ensureSeed, onAnnsChange, onMetrics, onStatus }) {
  const scrollerRef = useRef(null);
  const pdfRef = useRef(null);
  const [numPages, setNumPages] = useState(0);
  const [pageSizes, setPageSizes] = useState([]); // [{w,h}] in PDF points
  const [scale, setScale] = useState(1);          // committed (rasterized) scale
  const [liveZoom, setLiveZoom] = useState(1);    // transient gesture multiplier (CSS transform only)
  const [rotation, setRotation] = useState(0);
  const [range, setRange] = useState([0, -1]);    // [firstMounted, lastMounted]
  const [containerW, setContainerW] = useState(800);

  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
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

  // ---- load document --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setPageSizes([]); setNumPages(0); setRange([0, -1]);
    onStatus?.('loading…');
    (async () => {
      try {
        const task = pdfjsLib.getDocument({ url: fileSrc, isEvalSupported: false });
        const pdf = await task.promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        const sizes = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const pg = await pdf.getPage(i);
          if (cancelled) return;
          const vp = pg.getViewport({ scale: 1, rotation: 0 });
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

  // seed default annotations for pages as they enter the mounted window
  useEffect(() => {
    if (range[1] < range[0]) return;
    for (let i = range[0]; i <= range[1]; i++) {
      const dim = layout.dims[i];
      if (dim) ensureSeed(i, dim.w, dim.h);
    }
  }, [range, layout, ensureSeed]);

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

  // ---- metrics reporting ----------------------------------------------------
  const onRaster = useCallback((idx, info) => {
    rasterInfoRef.current = info;
    onMetrics?.({ zoomPct: Math.round(scaleRef.current * liveZoomRef.current * 100), mounted: Math.max(0, range[1] - range[0] + 1), rasterMs: info.ms, clamped: info.clamped, backingW: info.backingW, backingH: info.backingH });
  }, [onMetrics, range]);

  useEffect(() => {
    onMetrics?.({ zoomPct: Math.round(scale * liveZoom * 100), mounted: Math.max(0, range[1] - range[0] + 1), rasterMs: rasterInfoRef.current.ms, clamped: rasterInfoRef.current.clamped, backingW: rasterInfoRef.current.backingW, backingH: rasterInfoRef.current.backingH });
  }, [scale, liveZoom, range, onMetrics]);

  // ---- expose controls to parent via window (simple for a throwaway) --------
  useEffect(() => {
    const api = { zoomTo, rotate: () => setRotation((r) => (r === 0 ? 90 : r === 90 ? 270 : 0)) };
    window.__spikePdfjs = api;
    return () => { if (window.__spikePdfjs === api) delete window.__spikePdfjs; };
  }, [zoomTo]);

  const loading = pageSizes.length === 0;

  return (
    <div
      ref={scrollerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#3a3d42', contain: 'strict' }}
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
                      onRaster={onRaster}
                    />
                    <InteractiveOverlay
                      pageWidth={dim.w}
                      pageHeight={dim.h}
                      annotations={annsByPage[i]}
                      onChange={(next) => onAnnsChange(i, next)}
                    />
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
