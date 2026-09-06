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
 * Deliberately LEANER than the prototype: this component owns the page raster
 * and selectable pdf.js text layer. Annotation, search, link, and form overlays
 * stay in PDFViewer's per-page portal loop. Features not yet built (search,
 * text-markup select/erase, form state/authoring, print) are SAFE STUBs returning
 * benign values (Stage 4).
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
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { extractPdfOutlineBookmarks } from '../utils/bookmarkOutline';
import { resolvePinchCommitCursor, resolvePinchEndTransition } from '../utils/mobilePinchGesture';
import { trackSurveyAnalyticsEvent } from '../utils/surveyAnalytics';
import PdfjsTextLayer from './PdfjsTextLayer';
import {
  getDocumentMinimumScale,
  getWheelZoomScale,
  normalizeWheelDelta,
} from '../utils/pdfZoomMath';
import { getViewportScrollbarAxis } from '../utils/pdfViewportScrollbar';
import { LIVE_ZOOM_EVENT } from '../utils/liveZoomEvents.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// --- layout + zoom constants (ported from the prototype) ---------------------
const GAP = 16;
const PAD = 20;
const MOBILE_GAP = 12;
const MOBILE_PAD_X = 14;
const MOBILE_PAGE_MAX_WIDTH = 390;
const MIN_SCALE = 0.01;
const MAX_SCALE = 40;
// Physical iPhones terminate WKWebView's content process around 9-10x even
// when individual canvases are budgeted. Keep the desktop 4000% contract, but
// stop mobile before WebKit's compositor reaches that unrecoverable range.
const MOBILE_MAX_SCALE = 8;
// Never ask WKWebView to composite a deeply zoomed document layer below this
// ratio. At 800%, a single transform down to fit can expose >80 MP of source
// pixels and iOS terminates the WebContent process. Pinch-out checkpoints the
// same anchored preview into layout, then continues from a fresh 1x preview.
const MOBILE_LIVE_ZOOM_REBASE_MIN = 0.67;
const BASE_MAX_SCALE = 2.5; // above this the base canvas is a cheap backdrop; the detail tile owns sharpness
const MOBILE_BASE_MAX_SCALE = 1.25;
const SETTLE_MS = 110;      // commit the gesture this long after the last wheel tick
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
const PAN_START_EVENT = 'survey-pdfjs-pan-start';
const PAN_END_EVENT = 'survey-pdfjs-pan-end';
const ZOOM_START_EVENT = 'survey-pdfjs-zoom-start';
const ZOOM_END_EVENT = 'survey-pdfjs-zoom-end';
const PINCH_START_EVENT = 'survey-pdfjs-pinch-start';

function postNativePdfDiagnostic(event, detail = {}) {
  trackSurveyAnalyticsEvent(`survey_pdf_${String(event || 'diagnostic').replaceAll('-', '_')}`, detail);
  try {
    if (!window.ReactNativeWebView?.postMessage) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'survey:diagnostic',
      area: 'pdf-zoom',
      event,
      detail,
      timestamp: Date.now(),
    }));
  } catch {
    // Diagnostics must never interfere with the viewer.
  }
}

const isSpaceKey = (event) => event?.code === 'Space' || event?.key === ' ' || event?.key === 'Spacebar';
const isEditableTarget = (target) => {
  const tagName = String(target?.tagName || '').toLowerCase();
  return tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || target?.isContentEditable === true;
};
const getTouchCenter = (touches, rect) => ({
  x: ((touches[0].clientX + touches[1].clientX) / 2) - rect.left,
  y: ((touches[0].clientY + touches[1].clientY) / 2) - rect.top,
});
const getTouchDistance = (touches) => Math.hypot(
  touches[1].clientX - touches[0].clientX,
  touches[1].clientY - touches[0].clientY
);

// Chromium canvas limits + smooth-area budget (ported from spikeMetrics).
const MAX_CANVAS_DIM = 16384;
const DESKTOP_MAX_CANVAS_AREA = 80 * 1024 * 1024; // ~80 MP
const MOBILE_MAX_CANVAS_AREA = 3 * 1024 * 1024; // ~12 MiB RGBA per mobile raster buffer
const DESKTOP_MAX_OVERSCAN_PAGES = 3;
const MOBILE_MAX_OVERSCAN_PAGES = 1;
function isMobilePdfSurfaceViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
}
function resolveLayoutMetrics(isMobileSurface) {
  return isMobileSurface
    ? {
        gap: MOBILE_GAP,
        padX: MOBILE_PAD_X,
        padTop: 0,
        padBottom: 0,
        maxPageWidth: MOBILE_PAGE_MAX_WIDTH,
      }
    : {
        gap: GAP,
        padX: PAD,
        padTop: 0,
        padBottom: 0,
        maxPageWidth: null,
      };
}
function getFitWidthForContainer(containerWidth, metrics) {
  const available = Math.max(1, Number(containerWidth) - metrics.padX * 2);
  return metrics.maxPageWidth ? Math.min(available, metrics.maxPageWidth) : available;
}
function getMinimumScaleForLayout(dims, containerHeight, metrics, containerWidth) {
  return getDocumentMinimumScale({
    viewportHeight: containerHeight,
    pageHeights: dims.map((dim) => dim.h),
    viewportWidth: getFitWidthForContainer(containerWidth, metrics),
    pageWidths: dims.map((dim) => dim.w),
    pageGap: metrics.gap,
    fixedTopInset: metrics.padTop,
    fixedBottomInset: metrics.padBottom,
    absoluteMinimumScale: MIN_SCALE,
    maximumScale: MAX_SCALE,
  });
}
function clampToBudget(backingW, backingH, isMobileSurface = false) {
  const maxArea = isMobileSurface ? MOBILE_MAX_CANVAS_AREA : DESKTOP_MAX_CANVAS_AREA;
  const dimOver = Math.max(backingW, backingH) / MAX_CANVAS_DIM;
  const areaOver = Math.sqrt((backingW * backingH) / maxArea);
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
function releaseRasterCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
function pageRasterCacheGet(key) {
  const v = PAGE_RASTER_CACHE.get(key);
  if (v) { PAGE_RASTER_CACHE.delete(key); PAGE_RASTER_CACHE.set(key, v); } // touch = most-recent
  return v ? v.canvas : null;
}
function pageRasterCacheSet(key, canvas) {
  const bytes = (canvas.width * canvas.height * 4) || 0;
  const existing = PAGE_RASTER_CACHE.get(key);
  if (existing) {
    pageRasterCacheBytes -= existing.bytes;
    PAGE_RASTER_CACHE.delete(key);
    releaseRasterCanvas(existing.canvas);
  }
  if (!bytes || bytes > PAGE_RASTER_CACHE_MAX_BYTES) {
    releaseRasterCanvas(canvas);
    return;
  }
  PAGE_RASTER_CACHE.set(key, { canvas, bytes });
  pageRasterCacheBytes += bytes;
  while (pageRasterCacheBytes > PAGE_RASTER_CACHE_MAX_BYTES && PAGE_RASTER_CACHE.size > 0) {
    const oldestKey = PAGE_RASTER_CACHE.keys().next().value;
    const oldest = PAGE_RASTER_CACHE.get(oldestKey);
    PAGE_RASTER_CACHE.delete(oldestKey);
    pageRasterCacheBytes -= oldest.bytes;
    releaseRasterCanvas(oldest.canvas);
  }
}
function pageRasterCacheClearDocument(docKey) {
  const prefix = `${docKey}:`;
  for (const [key, entry] of PAGE_RASTER_CACHE.entries()) {
    if (!key.startsWith(prefix)) continue;
    PAGE_RASTER_CACHE.delete(key);
    pageRasterCacheBytes -= entry.bytes;
    releaseRasterCanvas(entry.canvas);
  }
  pageRasterCacheBytes = Math.max(0, pageRasterCacheBytes);
}

function isPdfDocumentProxy(source) {
  return Boolean(source && typeof source.getPage === 'function' && Number.isFinite(source.numPages));
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
function PdfPageCanvas({ pdf, pageIndex, pageW, pageH, renderScale, rotation, onRaster, isMobileSurface }) {
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const genRef = useRef(0);
  const baseScaleLimit = isMobileSurface ? MOBILE_BASE_MAX_SCALE : BASE_MAX_SCALE;
  const baseScale = Math.min(renderScale, baseScaleLimit);
  const tiled = renderScale > baseScaleLimit;

  useEffect(() => {
    let cancelled = false;
    const myGen = ++genRef.current;

    // Already drawn this page at this zoom/rotation? Paint it back instantly —
    // no re-raster, no "loading" flash on scroll-return.
    const docKey = (pdf?.fingerprints && pdf.fingerprints[0]) || pdf?.fingerprint || 'doc';
    const cacheKey = `${docKey}:${pageIndex}:${baseScale.toFixed(3)}:${DPR}:${rotation}`;
    const cachedCanvas = isMobileSurface ? null : pageRasterCacheGet(cacheKey);
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
      let target = null;
      let targetRetained = false;
      try {
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled || myGen !== genRef.current) return;
        const want = baseScale * DPR;
        const { factor } = clampToBudget(pageW * want, pageH * want, isMobileSurface);
        const rasterScale = want * factor;
        const viewport = page.getViewport({ scale: rasterScale, rotation: page.rotate + rotation });

        // Keep the previous bitmap visible until the replacement is complete.
        // Mobile uses a lower raster ceiling and releases this staging canvas
        // immediately after the atomic copy, avoiding both blank frames and
        // unbounded WKWebView memory spikes during rapid pinch gestures.
        target = document.createElement('canvas');
        if (!target) return;
        target.width = Math.max(1, Math.floor(viewport.width));
        target.height = Math.max(1, Math.floor(viewport.height));
        const ctx = target.getContext('2d', { alpha: false });

        if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
        const t0 = performance.now();
        // Draw the PAGE ONLY — do not bake annotation appearance into the raster.
        // The app reconstructs imported markups as its own editable SVG objects
        // (matching the Pdfjs path, which hides the engine's native markup
        // layer); baking here would double them and make erase leave baked pixels.
        const task = page.render({ canvasContext: ctx, viewport, annotationMode: pdfjsLib.AnnotationMode.DISABLE });
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
        c.width = target.width;
        c.height = target.height;
        c.getContext('2d', { alpha: false }).drawImage(target, 0, 0);
        if (!isMobileSurface) {
          // Desktop keeps the rendered bitmap so a scroll-return repaints instantly.
          pageRasterCacheSet(cacheKey, target);
          targetRetained = true;
        }
        onRaster?.(pageIndex, { ms: Math.round(performance.now() - t0), clamped: tiled });
      } catch (error) {
        postNativePdfDiagnostic('raster-error', {
          name: error?.name || 'Error',
          message: String(error?.message || 'PDF raster failed').slice(0, 180),
          page: pageIndex + 1,
        });
        /* a page may unmount mid-render; never throw out of the engine */
      } finally {
        if (target && !targetRetained) releaseRasterCanvas(target);
      }
    })();
    return () => {
      cancelled = true;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
    };
  }, [pdf, pageIndex, pageW, pageH, baseScale, rotation, tiled, onRaster, isMobileSurface]);

  useEffect(() => () => releaseRasterCanvas(canvasRef.current), []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%', background: '#fff', boxShadow: '0 2px 14px rgba(0,0,0,0.45)' }}
    />
  );
}

// --- deep-zoom detail tile: crisp visible slice over the soft base -----------
function DetailTile({ pdf, pageIndex, scale, rotation, liveZoom, interactionRef, scrollerRef, isMobileSurface }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const genRef = useRef(0);
  const progressiveTimerRef = useRef(0);
  const latestRenderRef = useRef(null);
  const lastSharpAtRef = useRef(0);
  const lastRenderStartedAtRef = useRef(0);
  const wasLiveZoomRef = useRef(1);
  const [tile, setTile] = useState(null);

  const render = useCallback(async () => {
    const host = hostRef.current;
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    if (!host || !scroller || !canvas || !pdf) return;
    // Zoom-out already has more source detail than the destination needs.
    // Rendering another temporary tile here only duplicates large canvases
    // during the exact slow-pinch path that is tightest on iPhone memory.
    if (isMobileSurface && liveZoom < 1) { setTile(null); return; }
    // Ordinary one-finger panning waits until momentum settles. A pinch is
    // different: periodically refresh the visible tile while fingers remain
    // down so a slow deep zoom does not stay blurry until release.
    if (interactionRef?.current && liveZoom === 1) return;
    const baseScaleLimit = isMobileSurface ? MOBILE_BASE_MAX_SCALE : BASE_MAX_SCALE;
    const targetScale = scale * liveZoom;
    if (targetScale <= baseScaleLimit) { setTile(null); return; }
    lastRenderStartedAtRef.current = performance.now();

    const hr = host.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const vx = Math.max(0, sr.left - hr.left);
    const vy = Math.max(0, sr.top - hr.top);
    const vw = Math.min(hr.width, sr.right - hr.left) - vx;
    const vh = Math.min(hr.height, sr.bottom - hr.top) - vy;
    if (vw <= 1 || vh <= 1) { setTile(null); return; }

    const myGen = ++genRef.current;
    let off = null;
    try {
      const page = await pdf.getPage(pageIndex + 1);
      if (myGen !== genRef.current) return;
      const viewport = page.getViewport({ scale: targetScale, rotation: page.rotate + rotation });
      const cw = Math.max(1, Math.round(vw * DPR));
      const ch = Math.max(1, Math.round(vh * DPR));
      off = document.createElement('canvas');
      off.width = cw; off.height = ch;
      const ctx = off.getContext('2d', { alpha: false });
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
      const transform = [DPR, 0, 0, DPR, -vx * DPR, -vy * DPR];
      // Page only, no baked annotation appearance — see PdfPageCanvas note.
      const task = page.render({ canvasContext: ctx, viewport, transform, annotationMode: pdfjsLib.AnnotationMode.DISABLE });
      task.onContinue = (resume) => requestAnimationFrame(resume);
      taskRef.current = task;
      try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
      if (myGen !== genRef.current) return;
      const c = canvasRef.current;
      if (!c) return;
      c.width = cw; c.height = ch;
      c.getContext('2d', { alpha: false }).drawImage(off, 0, 0);
      const cssZoom = Math.max(0.001, liveZoom);
      lastSharpAtRef.current = performance.now();
      setTile({
        left: vx / cssZoom,
        top: vy / cssZoom,
        w: vw / cssZoom,
        h: vh / cssZoom,
        liveZoom: cssZoom,
      });
    } catch {
      /* never throw out of the engine */
    } finally {
      releaseRasterCanvas(off);
    }
  }, [pdf, pageIndex, scale, rotation, liveZoom, interactionRef, scrollerRef, isMobileSurface]);

  latestRenderRef.current = render;
  useEffect(() => {
    const enteringLiveZoom = liveZoom !== 1 && wasLiveZoomRef.current === 1;
    wasLiveZoomRef.current = liveZoom;
    if (isMobileSurface && liveZoom < 1) {
      if (progressiveTimerRef.current) clearTimeout(progressiveTimerRef.current);
      progressiveTimerRef.current = 0;
      genRef.current += 1;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* settled */ } }
      taskRef.current = null;
      releaseRasterCanvas(canvasRef.current);
      setTile(null);
      return;
    }
    if (enteringLiveZoom) {
      genRef.current += 1;
      if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* settled */ } }
      releaseRasterCanvas(canvasRef.current);
      setTile(null);
    }
    if (liveZoom === 1) {
      if (progressiveTimerRef.current) clearTimeout(progressiveTimerRef.current);
      progressiveTimerRef.current = 0;
      void render();
      return;
    }
    const elapsed = performance.now() - Math.max(lastSharpAtRef.current, lastRenderStartedAtRef.current);
    if (elapsed >= 240) {
      void render();
      return;
    }
    if (!progressiveTimerRef.current) {
      progressiveTimerRef.current = window.setTimeout(() => {
        progressiveTimerRef.current = 0;
        void latestRenderRef.current?.();
      }, Math.max(16, 240 - elapsed));
    }
  }, [liveZoom, render]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
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

  useEffect(() => () => {
    if (progressiveTimerRef.current) clearTimeout(progressiveTimerRef.current);
    if (taskRef.current) { try { taskRef.current.cancel(); } catch { /* noop */ } }
    releaseRasterCanvas(canvasRef.current);
  }, []);

  const tileIsCurrent = tile && Math.abs(Math.log(Math.max(0.001, liveZoom) / tile.liveZoom)) < 0.2;

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', left: tile ? tile.left : 0, top: tile ? tile.top : 0, width: tile ? tile.w : 0, height: tile ? tile.h : 0, display: tileIsCurrent ? 'block' : 'none' }}
      />
    </div>
  );
}

const VIEWPORT_SCROLLBAR_SIZE = 12;
const VIEWPORT_SCROLLBAR_FADE_MS = 200;
const VIEWPORT_SCROLLBAR_HOLD_MS = 700;

function ViewportScrollbars({ scrollerRef, previewMetrics, disabled = false }) {
  const [visible, setVisible] = useState(false);
  const [hoveredAxis, setHoveredAxis] = useState(null);
  const [measuredMetrics, setMeasuredMetrics] = useState({});
  const fadeTimerRef = useRef(null);
  const hoveredAxisRef = useRef(null);
  const frameRef = useRef(0);
  const dragRef = useRef(null);
  const horizontalRailRef = useRef(null);
  const verticalRailRef = useRef(null);
  const horizontalThumbRef = useRef(null);
  const verticalThumbRef = useRef(null);

  const requestFrame = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const scroller = scrollerRef.current;
      if (scroller) setMeasuredMetrics({
        viewportWidth: scroller.clientWidth, viewportHeight: scroller.clientHeight,
        contentWidth: scroller.scrollWidth, contentHeight: scroller.scrollHeight,
        scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop,
      });
    });
  }, [scrollerRef]);

  const showThenFade = useCallback(() => {
    setVisible(true);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      if (!dragRef.current && !hoveredAxisRef.current) setVisible(false);
    }, VIEWPORT_SCROLLBAR_HOLD_MS);
  }, []);

  const forwardRailWheel = useCallback((event) => {
    const scrollerNode = scrollerRef.current;
    if (!scrollerNode) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      scrollerNode.dispatchEvent(new WheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        bubbles: true,
        cancelable: true,
      }));
      return;
    }
    let deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode, scrollerNode.clientWidth);
    let deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, scrollerNode.clientHeight);
    if (event.shiftKey && deltaX === 0) {
      deltaX = deltaY;
      deltaY = 0;
    }
    scrollerNode.scrollLeft += deltaX;
    scrollerNode.scrollTop += deltaY;
    showThenFade();
    requestFrame();
  }, [requestFrame, scrollerRef, showThenFade]);

  // Hover can hold a rail already shown by scroll/zoom; hidden rails never
  // wake just because a page tool moves near the viewport edge.
  const hoverRail = (axis) => {
    hoveredAxisRef.current = axis;
    setHoveredAxis(axis);
    showThenFade();
  };


  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || disabled) return undefined;
    const onScroll = () => {
      showThenFade();
      requestFrame();
    };
    const onScrollbarProximityLeave = () => {
      if (dragRef.current || !hoveredAxisRef.current) return;
      hoveredAxisRef.current = null;
      setHoveredAxis(null);
      showThenFade();
    };
    scroller.addEventListener('pointerleave', onScrollbarProximityLeave, { passive: true });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('pointerleave', onScrollbarProximityLeave);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [disabled, requestFrame, scrollerRef, showThenFade]);

  useLayoutEffect(() => {
    if (!previewMetrics || disabled) return;
    showThenFade();
    requestFrame();
  }, [disabled, previewMetrics, requestFrame, showThenFade]);

  useEffect(() => {
    if (disabled) return undefined;
    const onPointerMove = (event) => {
      const drag = dragRef.current;
      const scroller = scrollerRef.current;
      if (!drag || !scroller || drag.travel <= 0) return;
      const pointer = drag.axis === 'horizontal' ? event.clientX : event.clientY;
      const nextThumbStart = Math.max(0, Math.min(drag.travel, drag.thumbStart + pointer - drag.pointerStart));
      const nextScroll = (nextThumbStart / drag.travel) * drag.maxScroll;
      if (drag.axis === 'horizontal') {
        if (horizontalThumbRef.current) horizontalThumbRef.current.style.left = `${nextThumbStart + 6}px`;
        scroller.scrollLeft = nextScroll;
      } else {
        if (verticalThumbRef.current) verticalThumbRef.current.style.top = `${nextThumbStart + 6}px`;
        scroller.scrollTop = nextScroll;
      }
      requestFrame();
    };
    const finishDrag = (event) => {
      if (!dragRef.current) return;
      const axis = dragRef.current.axis;
      const rail = axis === 'vertical' ? verticalRailRef.current : horizontalRailRef.current;
      const rect = rail?.getBoundingClientRect();
      const hovered = event.type !== 'pointercancel' && rect
        && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom ? axis : null;
      dragRef.current = null;
      hoveredAxisRef.current = hovered;
      setHoveredAxis(hovered);
      showThenFade();
      document.documentElement.style.removeProperty('cursor');
      document.documentElement.style.removeProperty('user-select');
    };
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', finishDrag, true);
    window.addEventListener('pointercancel', finishDrag, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', finishDrag, true);
      window.removeEventListener('pointercancel', finishDrag, true);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      document.documentElement.style.removeProperty('cursor');
      document.documentElement.style.removeProperty('user-select');
    };
  }, [disabled, requestFrame, scrollerRef, showThenFade]);

  const scroller = measuredMetrics;
  const viewportWidth = previewMetrics?.viewportWidth ?? scroller?.viewportWidth ?? 0;
  const viewportHeight = previewMetrics?.viewportHeight ?? scroller?.viewportHeight ?? 0;
  const contentWidth = previewMetrics?.contentWidth ?? scroller?.contentWidth ?? viewportWidth;
  const contentHeight = previewMetrics?.contentHeight ?? scroller?.contentHeight ?? viewportHeight;
  const scrollLeft = previewMetrics?.scrollLeft ?? scroller?.scrollLeft ?? 0;
  const scrollTop = previewMetrics?.scrollTop ?? scroller?.scrollTop ?? 0;
  const horizontalTrackSize = Math.max(0, viewportWidth - VIEWPORT_SCROLLBAR_SIZE);
  const verticalTrackSize = Math.max(0, viewportHeight - VIEWPORT_SCROLLBAR_SIZE);
  const horizontal = getViewportScrollbarAxis({
    viewportSize: viewportWidth,
    contentSize: contentWidth,
    scrollOffset: scrollLeft,
    trackSize: horizontalTrackSize,
  });
  const vertical = getViewportScrollbarAxis({
    viewportSize: viewportHeight,
    contentSize: contentHeight,
    scrollOffset: scrollTop,
    trackSize: verticalTrackSize,
  });

  useEffect(() => {
    const rails = [verticalRailRef.current, horizontalRailRef.current].filter(Boolean);
    rails.forEach((rail) => rail.addEventListener('wheel', forwardRailWheel, { passive: false }));
    return () => rails.forEach((rail) => rail.removeEventListener('wheel', forwardRailWheel));
  }, [forwardRailWheel, disabled, vertical.maxScroll > 0, horizontal.maxScroll > 0]);

  if (disabled) return null;

  const startDrag = (axis, metrics) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pointer = axis === 'horizontal' ? event.clientX : event.clientY;
    dragRef.current = {
      axis,
      pointerStart: pointer,
      thumbStart: metrics.start - 6,
      travel: metrics.travel,
      maxScroll: metrics.maxScroll,
    };
    setHoveredAxis(axis);
    document.documentElement.style.cursor = 'grabbing';
    document.documentElement.style.userSelect = 'none';
    setVisible(true);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  };

  const railStyle = {
    position: 'absolute',
    zIndex: 80,
    opacity: visible ? 1 : 0,
    transition: `opacity ${VIEWPORT_SCROLLBAR_FADE_MS}ms ease-in-out, background-color ${VIEWPORT_SCROLLBAR_FADE_MS}ms ease-in-out`,
    background: 'transparent',
    pointerEvents: 'none',
  };
  const thumbStyle = {
    position: 'absolute',
    background: '#878e97',
    borderRadius: 999,
    cursor: dragRef.current ? 'grabbing' : 'grab',
    touchAction: 'none',
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'width 120ms ease-out, height 120ms ease-out',
  };

  return (
    <>
      {vertical.maxScroll > 0 && <div
        ref={verticalRailRef}
        aria-label="Viewport vertical scroll bar"
        onPointerEnter={() => hoverRail('vertical')}
        onPointerMove={() => hoverRail('vertical')}
        onPointerLeave={() => {
          if (dragRef.current) return;
          hoveredAxisRef.current = null;
          setHoveredAxis(null);
          showThenFade();
        }}
        style={{ ...railStyle, top: 0, right: 0, bottom: VIEWPORT_SCROLLBAR_SIZE, width: VIEWPORT_SCROLLBAR_SIZE }}
      >
        <div
          ref={verticalThumbRef}
          aria-label="Scrollbar shuttle"
          onPointerDown={startDrag('vertical', vertical)}
          style={{
            ...thumbStyle,
            top: vertical.start,
            left: 6,
            transform: 'translateX(-50%)',
            width: hoveredAxis === 'vertical' ? 6 : 3,
            height: vertical.size,
          }}
        />
      </div>}
      {horizontal.maxScroll > 0 && <div
        ref={horizontalRailRef}
        aria-label="Viewport horizontal scroll bar"
        onPointerEnter={() => hoverRail('horizontal')}
        onPointerMove={() => hoverRail('horizontal')}
        onPointerLeave={() => {
          if (dragRef.current) return;
          hoveredAxisRef.current = null;
          setHoveredAxis(null);
          showThenFade();
        }}
        style={{ ...railStyle, left: 0, right: VIEWPORT_SCROLLBAR_SIZE, bottom: 0, height: VIEWPORT_SCROLLBAR_SIZE }}
      >
        <div
          ref={horizontalThumbRef}
          aria-label="Scrollbar shuttle"
          onPointerDown={startDrag('horizontal', horizontal)}
          style={{
            ...thumbStyle,
            left: horizontal.start,
            top: 6,
            transform: 'translateY(-50%)',
            width: horizontal.size,
            height: hoveredAxis === 'horizontal' ? 6 : 3,
          }}
        />
      </div>}
    </>
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
  // UX: mobile parity (Phase D) — when true, a still-finger long-press on the
  // PDF surface synthesizes a contextmenu at the touch point, opening the
  // annotation / paste / region touch menu (demo App.tsx long-press handlers).
  // Gated upstream to the pan/select tools so drawing gestures are untouched.
  mobileLongPressContextMenu = false,
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
  textSelectionLayerActive = false,
  textSelectionLayerInteractive = textSelectionLayerActive,
  className = '',
  style = {},
  // eslint-disable-next-line no-unused-vars
  formDesignerEnabled = false,
  onDocumentLoaded,
  onDocumentLoadFailed,
  onPageChanged,
  onZoomChanged,
  onZoomPhase, // Stage 3: 'gesture-start' | 'settle' — lets PDFViewer bump the zoomGeneration signal
  onPanStateChange,
  onPageRendered,
  // eslint-disable-next-line no-unused-vars
  onTextSelectionEnd,
  onTextAvailability,
  onPDFBookmarksAvailable,
  onPageContainersChange,
  onMountedPagesChange,
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
  const nativePinchSurfaceRef = useRef(null);
  const nativeScrollMarkerRef = useRef(null);
  const nativeAnchorMarkerRef = useRef(null);
  const nativePanCoastMarkerRef = useRef(null);
  const nativeLiveZoomFloorRef = useRef(null);
  const pdfRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [pageSizes, setPageSizes] = useState([]);
  const [scale, setScale] = useState(1);
  const [liveZoom, setLiveZoom] = useState(1);
  const [, setLiveGestureFrame] = useState(0);
  const [range, setRange] = useState([0, -1]);
  const [containerW, setContainerW] = useState(800);
  const [containerH, setContainerH] = useState(600);
  const [isMobileSurface, setIsMobileSurface] = useState(() => isMobilePdfSurfaceViewport());
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
    onPanStateChange, onPageRendered, onPDFBookmarksAvailable, onPageContainersChange,
    onMountedPagesChange, onDocumentUnload,
  };

  const settleTimerRef = useRef(null);
  const pendingAnchorRef = useRef(null);
  const wheelRafRef = useRef(0);
  const liveZoomRef = useRef(1);
  const zoomInteractionRef = useRef(false);
  const gestureRef = useRef(null);
  const dimsPtRef = useRef([]);
  const containerWRef = useRef(800);
  const containerHRef = useRef(600);
  const topsRef = useRef([]);
  const padTopRef = useRef(0);
  const interactionModeRef = useRef(interactionMode);
  interactionModeRef.current = interactionMode;
  const spacePanRef = useRef(false);
  const panInteractionRef = useRef(false);
  const panPointerRef = useRef(null);
  const panDeltaRef = useRef({ x: 0, y: 0 });
  const panRafRef = useRef(0);
  const panInertiaRafRef = useRef(0);
  const mobileTouchRef = useRef(null);
  const suppressMobileTouchUntilRef = useRef(0);
  const layoutMetrics = useMemo(() => resolveLayoutMetrics(isMobileSurface), [isMobileSurface]);
  const layoutMetricsRef = useRef(layoutMetrics);
  layoutMetricsRef.current = layoutMetrics;

  const getPageLeftAtScale = useCallback((pageIndex, nextScale) => {
    const dim = dimsPtRef.current[pageIndex];
    if (!dim) return 0;
    const metrics = layoutMetricsRef.current;
    const viewportWidth = containerWRef.current;
    const pageWidth = dim.w * nextScale;
    return pageWidth <= viewportWidth
      ? (viewportWidth - pageWidth) / 2
      : metrics.padX;
  }, []);

  const getPageHorizontalScrollMax = useCallback((pageIndex, nextScale) => {
    const dim = dimsPtRef.current[pageIndex];
    if (!dim) return 0;
    const metrics = layoutMetricsRef.current;
    const pageWidth = dim.w * nextScale;
    return pageWidth <= containerWRef.current
      ? 0
      : pageWidth + metrics.padX * 2 - containerWRef.current;
  }, []);

  const clampHorizontalScrollForPage = useCallback((pageIndex = currentPageRef.current - 1) => {
    const el = scrollerRef.current;
    if (!el || zoomInteractionRef.current || mobileTouchRef.current?.mode === 'pinch') return;
    const safePageIndex = Math.max(0, Math.min(dimsPtRef.current.length - 1, pageIndex));
    const maxLeft = getPageHorizontalScrollMax(safePageIndex, scaleRef.current);
    const nextLeft = Math.min(Math.max(0, el.scrollLeft), maxLeft);
    if (Math.abs(el.scrollLeft - nextLeft) > 0.5) el.scrollLeft = nextLeft;
  }, [getPageHorizontalScrollMax]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQueries = [
      window.matchMedia('(max-width: 720px)'),
      window.matchMedia('(pointer: coarse)'),
    ];
    const updateMobileSurface = () => {
      setIsMobileSurface(mediaQueries.some((mq) => mq.matches));
    };
    updateMobileSurface();
    mediaQueries.forEach((mq) => {
      if (mq.addEventListener) mq.addEventListener('change', updateMobileSurface);
      else mq.addListener(updateMobileSurface);
    });
    return () => {
      mediaQueries.forEach((mq) => {
        if (mq.removeEventListener) mq.removeEventListener('change', updateMobileSurface);
        else mq.removeListener(updateMobileSurface);
      });
    };
  }, []);

  // ---- load document --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const loadStartedAt = performance.now();
    const externalPdf = isPdfDocumentProxy(activeSource) ? activeSource : null;
    const params = buildGetDocumentParams(activeSource, activePassword);
    setPageSizes([]); setNumPages(0); setRange([0, -1]);
    pageContainerMapRef.current = {};
    if (!externalPdf && !params) return undefined;

    const task = externalPdf ? null : pdfjsLib.getDocument(params);
    (async () => {
      try {
        const pdf = externalPdf || await task.promise;
        if (cancelled) {
          if (!externalPdf) { try { pdf.destroy(); } catch { /* noop */ } }
          return;
        }
        pdfRef.current = pdf;
        numPagesRef.current = pdf.numPages;
        setNumPages(pdf.numPages);

        // Paint page 1 immediately. The old path serially fetched metadata for
        // every page before React was allowed to mount a single canvas, which
        // made long PDFs feel dramatically slower than native viewers.
        const firstPage = await pdf.getPage(1);
        if (cancelled) return;
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const firstSize = { w: firstViewport.width, h: firstViewport.height };
        const sizes = Array.from({ length: pdf.numPages }, () => ({ ...firstSize }));
        setPageSizes(sizes.slice());

        const el = scrollerRef.current;
        const cw = el ? el.clientWidth : 800;
        const fitWidth = getFitWidthForContainer(cw, layoutMetricsRef.current);
        const fit = Math.max(0.2, Math.min(2, fitWidth / (sizes[0]?.w || 612)));
        setScale(fit); scaleRef.current = fit; prevScaleRef.current = fit;
        setLiveZoom(1); liveZoomRef.current = 1;
        currentPageRef.current = 1;
        if (el) {
          el.scrollLeft = 0;
          el.scrollTop = 0;
        }

        cb.current.onDocumentLoaded?.({
          pageCount: pdf.numPages,
          currentPageNumber: 1,
          zoomValue: Math.round(fit * 100),
          raw: pdf,
        });
        postNativePdfDiagnostic('first-page-layout', {
          ms: Math.round(performance.now() - loadStartedAt),
          pageCount: pdf.numPages,
        });

        // Refine mixed-size documents behind the already-visible first page.
        // Small batches avoid both a render per page and a single large burst.
        for (let start = 2; start <= pdf.numPages; start += 8) {
          const end = Math.min(pdf.numPages, start + 7);
          const batch = await Promise.all(Array.from({ length: end - start + 1 }, async (_, offset) => {
            const pageNumber = start + offset;
            const pg = await pdf.getPage(pageNumber);
            const vp = pg.getViewport({ scale: 1 });
            return { pageNumber, size: { w: vp.width, h: vp.height } };
          }));
          if (cancelled) return;
          batch.forEach(({ pageNumber, size }) => { sizes[pageNumber - 1] = size; });
          setPageSizes(sizes.slice());
        }

        try {
          const outline = await extractPdfOutlineBookmarks(pdf);
          if (!cancelled && Array.isArray(outline)) {
            bookmarksRef.current = outline;
            if (outline.length > 0) cb.current.onPDFBookmarksAvailable?.(outline);
          }
        } catch { /* bookmarks are best-effort; never block the render path */ }
      } catch (err) {
        if (cancelled || err?.name === 'RenderingCancelledException') return;
        console.warn('[PdfjsViewerContainer] document load failed', err?.name, err?.message, err?.stack);
        cb.current.onDocumentLoadFailed?.({ error: err, message: err?.message || String(err) });
        cb.current.onPageContainersChange?.({}, { reason: 'document_load_failed', count: 0 });
      }
    })();

    return () => {
      cancelled = true;
      try { task?.destroy?.(); } catch { /* noop */ }
      const prev = pdfRef.current;
      pdfRef.current = null;
      thumbCacheRef.current.clear();
      if (prev) {
        const docKey = (prev.fingerprints && prev.fingerprints[0]) || prev.fingerprint || 'doc';
        pageRasterCacheClearDocument(docKey);
        if (prev !== externalPdf) { try { prev.destroy(); } catch { /* noop */ } }
      }
      cb.current.onPageContainersChange?.({}, { reason: 'document_unload', count: 0 });
      cb.current.onDocumentUnload?.();
    };
  }, [activeSource, activePassword]);

  // ---- layout: cumulative offsets ------------------------------------------
  const layout = useMemo(() => {
    const metrics = layoutMetrics;
    const rot90 = rotation === 90 || rotation === 270;
    const dims = pageSizes.map((s) => (rot90 ? { w: s.h, h: s.w } : { w: s.w, h: s.h }));
    // UX intent: the white space between pages must stay PROPORTIONAL to page
    // size at every zoom — the same visual breathing room the pdf.js reference
    // viewer shows. A fixed screen-space gap looks oversized between shrunken
    // pages when zoomed out and cramped between enlarged pages when zoomed in.
    // Page heights already scale (dims[i].h * scale), so the gap scales the same
    // way: metrics.gap is the base at 100% (scale = 1), so 100% is unchanged and
    // the gap-to-page ratio is held constant across all zoom levels.
    const gapPx = metrics.gap * scale;
    // The document's outer top/bottom margins use the exact same proportional
    // gap as the space between pages. This makes the minimum zoom a geometric
    // boundary instead of an arbitrary percentage, including for one-page PDFs.
    let y = metrics.padTop + gapPx;
    const tops = [];
    let maxW = 0;
    for (let i = 0; i < dims.length; i += 1) {
      tops.push(y);
      y += dims[i].h * scale + gapPx;
      maxW = Math.max(maxW, dims[i].w * scale);
    }
    const contentW = maxW <= containerW
      ? containerW
      : maxW + 2 * metrics.padX;
    // rawTotalH is the un-offset content height; the FIT predicate must use this,
    // never the padTop-inclusive height. padTop vertically centers any document
    // shorter than the viewport (single page / fitting page) via marginTop on the
    // content node — NOT via scroll, so scroll stays in [0, scrollHeight-clientHeight]
    // and never goes negative. Content taller than the viewport (overflow case)
    // yields padTop=0 and the layout is unchanged.
    const rawTotalH = y + metrics.padBottom;
    const padTop = Math.max(0, (containerH - rawTotalH) / 2);
    return { tops, dims, totalH: rawTotalH, rawTotalH, padTop, contentW };
  }, [pageSizes, scale, rotation, containerW, containerH, layoutMetrics]);

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
    const metrics = layoutMetricsRef.current;
    // Gap is zoom-proportional (see layout memo), so page-band detection uses the
    // scaled gap too — keeps the current-page boundary aligned with the real layout.
    for (let i = 0; i < tops.length; i += 1) {
      if (mid >= tops[i] && mid < tops[i] + dims[i].h * scaleRef.current + metrics.gap * scaleRef.current) { page = i + 1; break; }
      if (mid >= tops[i]) page = i + 1;
    }
    clampHorizontalScrollForPage(page - 1);
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
  }, [clampHorizontalScrollForPage]);

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
    let visibleFirst = -1; let visibleLast = -1;
    for (let i = 0; i < layout.tops.length; i += 1) {
      const t = layout.tops[i];
      const b = t + layout.dims[i].h * scale;
      if (b >= lo && t <= hi) { if (first === -1) first = i; last = i; }
      if (b >= top && t <= top + vh) {
        if (visibleFirst === -1) visibleFirst = i;
        visibleLast = i;
      }
    }
    if (first === -1) { first = 0; last = -1; }
    else if (visibleFirst !== -1 && visibleLast !== -1) {
      const maxOverscanPages = isMobileSurface
        ? MOBILE_MAX_OVERSCAN_PAGES
        : DESKTOP_MAX_OVERSCAN_PAGES;
      const visibleCount = visibleLast - visibleFirst + 1;
      const availableBefore = visibleFirst - first;
      const availableAfter = last - visibleLast;
      let beforeCount = Math.min(availableBefore, Math.floor(maxOverscanPages / 2));
      let afterCount = Math.min(availableAfter, maxOverscanPages - beforeCount);
      beforeCount = Math.min(availableBefore, maxOverscanPages - afterCount);
      first = visibleFirst - beforeCount;
      last = visibleLast + afterCount;
      // Keep this explicit: visible pages are never sacrificed to the overscan budget.
      if (last - first + 1 < visibleCount) {
        first = visibleFirst;
        last = visibleLast;
      }
    }
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
    detectCurrentPage();
  }, [layout, scale, detectCurrentPage, isMobileSurface]);

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
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (nativeScrollMarkerRef.current) {
          nativeScrollMarkerRef.current.setAttribute(
            'aria-label',
            `PDF scroll position ${Math.round(el.scrollLeft)} ${Math.round(el.scrollTop)}`,
          );
        }
        recomputeWindow();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [recomputeWindow]);

  useEffect(() => { recomputeWindow(); }, [recomputeWindow]);

  // Apply the cursor anchor after the committed scale lays out. This is the
  // reference demo's single settle: one layout commit and one clamped scroll write.
  useLayoutEffect(() => {
    const p = pendingAnchorRef.current;
    if (!p) return;
    pendingAnchorRef.current = null;
    const el = scrollerRef.current;
    if (!el) return;
    const pageIndex = Number.isInteger(p.pageIndex)
      ? p.pageIndex
      : Math.max(0, currentPageRef.current - 1);
    const maxLeft = getPageHorizontalScrollMax(pageIndex, scale);
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollLeft = Math.min(Math.max(0, p.left), maxLeft);
    el.scrollTop = Math.min(Math.max(0, p.top), maxTop);
    if (nativeAnchorMarkerRef.current) {
      const error = Math.hypot(
        el.scrollLeft - Math.min(Math.max(0, p.left), maxLeft),
        el.scrollTop - Math.min(Math.max(0, p.top), maxTop),
      );
      nativeAnchorMarkerRef.current.setAttribute('aria-label', `PDF anchor settle error ${error.toFixed(2)}`);
    }
  }, [getPageHorizontalScrollMax, scale]);

  // ---- layout-space anchoring helpers --------------------------------------
  // padTopFor recomputes the centering margin at an ARBITRARY scale (so the anchor
  // math at the new scale uses the new padTop, matching the layout it will commit
  // to). Mirrors the layout memo: max(0,(containerH - rawTotalH)/2) on RAW total.
  const padTopFor = (sc) => {
    const metrics = layoutMetricsRef.current;
    const dims = dimsPtRef.current;
    // Mirror the layout memo: gap is zoom-proportional, so anchor math at an
    // arbitrary scale sc uses metrics.gap * sc to match the layout it commits to.
    const gapPx = metrics.gap * sc;
    let y = metrics.padTop + gapPx;
    for (let k = 0; k < dims.length; k += 1) y += dims[k].h * sc + gapPx;
    const rawTotalH = y + metrics.padBottom;
    return Math.max(0, (containerHRef.current - rawTotalH) / 2);
  };
  // topAt returns the page's top in SCROLL space (padTop-inclusive) so cursor
  // content-Y (el.scrollTop + cursorY) and the committed anchor are consistent.
  const topAt = (i, sc) => {
    const metrics = layoutMetricsRef.current;
    const dims = dimsPtRef.current;
    // Zoom-proportional gap (see layout memo): stack with metrics.gap * sc.
    let y = metrics.padTop + (metrics.gap * sc) + padTopFor(sc);
    for (let k = 0; k < i; k += 1) y += dims[k].h * sc + metrics.gap * sc;
    return y;
  };
  const leftAt = (i, sc) => getPageLeftAtScale(i, sc);
  const pageUnderContentY = (cY, sc) => {
    const metrics = layoutMetricsRef.current;
    const dims = dimsPtRef.current;
    // Zoom-proportional gap (see layout memo): the hit band grows/shrinks with sc.
    const gapPx = metrics.gap * sc;
    let y = metrics.padTop + gapPx + padTopFor(sc);
    for (let i = 0; i < dims.length; i += 1) {
      const h = dims[i].h * sc;
      if (cY < y + h + gapPx) return i;
      y += h + gapPx;
    }
    return Math.max(0, dims.length - 1);
  };

  const resolveGesturePreview = useCallback((gesture, requestedScale) => {
    const el = scrollerRef.current;
    const dims = dimsPtRef.current;
    if (!el || !gesture || !dims.length) return null;
    const oldScale = Number(gesture.originScale) || scaleRef.current;
    const maxScale = isMobileSurface ? MOBILE_MAX_SCALE : MAX_SCALE;
    const minimumScale = getMinimumScaleForLayout(
      dims,
      containerHRef.current,
      layoutMetricsRef.current,
      containerWRef.current,
    );
    const targetScale = Math.min(maxScale, Math.max(minimumScale, requestedScale));
    const originContentX = Number(gesture.originContentX) || 0;
    const originContentY = Number(gesture.originContentY) || 0;
    const pageIndex = pageUnderContentY(originContentY, oldScale);
    const page = dims[pageIndex];
    const fracX = Math.max(0, Math.min(1,
      (originContentX - leftAt(pageIndex, oldScale)) / Math.max(1, page.w * oldScale)));
    const fracY = (originContentY - topAt(pageIndex, oldScale)) / Math.max(1, page.h * oldScale);
    const newX = leftAt(pageIndex, targetScale) + fracX * page.w * targetScale;
    const newY = topAt(pageIndex, targetScale) + fracY * page.h * targetScale;
    const requestedCursor = resolvePinchCommitCursor(gesture);
    const maxLeft = getPageHorizontalScrollMax(pageIndex, targetScale);
    const predictedHeight = (() => {
      const metrics = layoutMetricsRef.current;
      let height = metrics.padTop + metrics.padBottom;
      dims.forEach((dim, index) => {
        height += dim.h * targetScale;
        if (index < dims.length - 1) height += metrics.gap * targetScale;
      });
      return height + padTopFor(targetScale);
    })();
    const maxTop = Math.max(0, predictedHeight - containerHRef.current);
    const left = Math.min(Math.max(0, newX - requestedCursor.x), maxLeft);
    const top = Math.min(Math.max(0, newY - requestedCursor.y), maxTop);
    const actualCursorX = newX - left;
    const actualCursorY = newY - top;
    return {
      targetScale,
      left,
      top,
      translateX: actualCursorX - gesture.originCursorX,
      translateY: actualCursorY - gesture.originCursorY,
    };
  }, [getPageHorizontalScrollMax, isMobileSurface]);

  const applyAnchoredScale = useCallback((targetScale, cursorX, cursorY, signalStart = true) => {
    const el = scrollerRef.current;
    const dims = dimsPtRef.current;
    if (!el || !dims.length) return;
    const oldScale = scaleRef.current;
    const maxScale = isMobileSurface ? MOBILE_MAX_SCALE : MAX_SCALE;
    const minimumScale = getMinimumScaleForLayout(
      dims,
      containerHRef.current,
      layoutMetricsRef.current,
      containerWRef.current,
    );
    const newScale = Math.min(maxScale, Math.max(minimumScale, targetScale));
    if (Math.abs(newScale - oldScale) < 1e-4) return;
    // Stage 3: imperative zoom (toolbar/keyboard/fit) commits instantly — signal
    // gesture-start here so Canvas tools flush before the host re-layouts. (Wheel
    // gestures already signalled on their first frame; an extra signal is harmless.)
    if (signalStart) {
      cb.current.onZoomPhase?.('gesture-start', {
        atPct: Math.round(oldScale * 100),
        source: 'imperative',
      });
    }
    const cX = el.scrollLeft + cursorX;
    const cY = el.scrollTop + cursorY;
    const i = pageUnderContentY(cY, oldScale);
    const fracX = Math.max(0, Math.min(1, (cX - leftAt(i, oldScale)) / (dims[i].w * oldScale)));
    const fracY = (cY - topAt(i, oldScale)) / (dims[i].h * oldScale);
    const newX = leftAt(i, newScale) + fracX * dims[i].w * newScale;
    const newY = topAt(i, newScale) + fracY * dims[i].h * newScale;
    pendingAnchorRef.current = { left: newX - cursorX, top: newY - cursorY, pageIndex: i };
    scaleRef.current = newScale;
    setScale(newScale);
  }, [isMobileSurface]);

  // A taller viewport or a rotation can raise the geometric floor after load.
  // Keep the rendered scale inside the same document-aware contract without
  // waiting for the next user gesture.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const dims = dimsPtRef.current;
    if (!el || dims.length === 0) return;
    const minimumScale = getMinimumScaleForLayout(
      dims,
      el.clientHeight,
      layoutMetricsRef.current,
      el.clientWidth,
    );
    if (scaleRef.current + 1e-4 < minimumScale) {
      applyAnchoredScale(minimumScale, el.clientWidth / 2, el.clientHeight / 2);
    }
  }, [applyAnchoredScale, containerH, layoutMetrics, pageSizes, rotation]);

  // ---- cursor zoom: CSS-transform preview, commit on settle ----------------
  const applyWheelZoom = useCallback(() => {
    wheelRafRef.current = 0;
    setLiveZoom(liveZoomRef.current);
    // A two-finger translation can change while the distance (and therefore
    // liveZoom) stays constant. Force that pan-only frame to paint too.
    setLiveGestureFrame((frame) => frame + 1);
  }, []);

  const setZoomInteraction = useCallback((active) => {
    if (zoomInteractionRef.current === active) return;
    zoomInteractionRef.current = active;
    window.dispatchEvent(new Event(active ? ZOOM_START_EVENT : ZOOM_END_EVENT));
  }, []);

  useLayoutEffect(() => {
    const liveScale = scale * liveZoom;
    window.dispatchEvent(new CustomEvent(LIVE_ZOOM_EVENT, {
      detail: {
        viewerId,
        scale: liveScale,
        percentage: Math.round(liveScale * 100),
        active: zoomInteractionRef.current,
      },
    }));
  }, [liveZoom, scale, viewerId]);

  const commitGesture = useCallback(() => {
    const g = gestureRef.current;
    const lz = liveZoomRef.current;
    gestureRef.current = null;
    liveZoomRef.current = 1;
    setZoomInteraction(false);
    if (!g || Math.abs(lz - 1) < 1e-4) { setLiveZoom(1); return; }
    const oldScale = scaleRef.current;
    const preview = resolveGesturePreview(g, oldScale * lz);
    if (!preview) { setLiveZoom(1); return; }
    const newScale = preview.targetScale;
    cb.current.onZoomPhase?.('settle', {
      fromPct: Math.round(oldScale * 100),
      toPct: Math.round(newScale * 100),
    });
    const commitCursor = resolvePinchCommitCursor(g);
    postNativePdfDiagnostic('gesture-settle', {
      fromPct: Math.round(oldScale * 100),
      toPct: Math.round(newScale * 100),
      cursorX: Math.round(commitCursor.x),
      cursorY: Math.round(commitCursor.y),
    });
    // Use the same clamped target scroll that the live CSS preview showed.
    // Re-deriving from the already-transformed viewport caused the release snap.
    pendingAnchorRef.current = { left: preview.left, top: preview.top };
    scaleRef.current = newScale;
    setScale(newScale);
    setLiveZoom(1);
  }, [resolveGesturePreview, setZoomInteraction]);

  const checkpointPinchGesture = useCallback((touchState, center, distance) => {
    const gesture = gestureRef.current;
    if (!gesture || !touchState) return false;
    const fromScale = scaleRef.current;
    const preview = resolveGesturePreview(gesture, fromScale * liveZoomRef.current);
    if (!preview) return false;

    // Commit the exact preview currently under the fingers without ending the
    // zoom interaction. The next touch frame starts from this smaller layout,
    // so WebKit never downscales one enormous compositor layer for the whole
    // 800%-to-fit gesture.
    pendingAnchorRef.current = { left: preview.left, top: preview.top };
    scaleRef.current = preview.targetScale;
    setScale(preview.targetScale);
    liveZoomRef.current = 1;
    setLiveZoom(1);

    touchState.startDistance = Math.max(1, distance);
    touchState.lastCenterX = center.x;
    touchState.lastCenterY = center.y;
    gestureRef.current = {
      originScale: preview.targetScale,
      originCursorX: center.x,
      originCursorY: center.y,
      currentCursorX: center.x,
      currentCursorY: center.y,
      originContentX: preview.left + center.x,
      originContentY: preview.top + center.y,
    };
    postNativePdfDiagnostic('pinch-rebase', {
      fromPct: Math.round(fromScale * 100),
      toPct: Math.round(preview.targetScale * 100),
      floor: MOBILE_LIVE_ZOOM_REBASE_MIN,
      pageCount: numPagesRef.current,
    });
    return true;
  }, [resolveGesturePreview]);

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
        gestureRef.current = {
          originScale: scaleRef.current,
          originCursorX: cursorX,
          originCursorY: cursorY,
          originContentX: el.scrollLeft + cursorX,
          originContentY: el.scrollTop + cursorY,
        };
        // Stage 3: a zoom gesture has started — let the host flush in-progress
        // Canvas drawing before the page hosts re-layout on settle.
        cb.current.onZoomPhase?.('gesture-start', {
          atPct: Math.round(scaleRef.current * 100),
          source: 'wheel',
        });
        setZoomInteraction(true);
      }
      const committed = scaleRef.current;
      const maxScale = isMobileSurface ? MOBILE_MAX_SCALE : MAX_SCALE;
      const minimumScale = getMinimumScaleForLayout(
        dimsPtRef.current,
        containerHRef.current,
        layoutMetricsRef.current,
        containerWRef.current,
      );
      const previewScale = getWheelZoomScale(committed * liveZoomRef.current, {
        deltaY: e.deltaY,
        maximumDelta: 1000,
        deltaMode: e.deltaMode,
        viewportHeight: el.clientHeight,
        minimumScale,
        maximumScale: maxScale,
      });
      liveZoomRef.current = previewScale / committed;
      if (!wheelRafRef.current) wheelRafRef.current = requestAnimationFrame(applyWheelZoom);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(commitGesture, SETTLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      setZoomInteraction(false);
    };
  }, [applyWheelZoom, commitGesture, isMobileSurface, setZoomInteraction]);

  // ---- pan: Space always overrides the active tool; writes are rAF-batched --
  const setPanInteraction = useCallback((active) => {
    if (panInteractionRef.current === active) return;
    panInteractionRef.current = active;
    if (document.documentElement) {
      if (active) document.documentElement.dataset.surveyPdfjsPanActive = 'true';
      else delete document.documentElement.dataset.surveyPdfjsPanActive;
    }
    cb.current.onPanStateChange?.(active);
    window.dispatchEvent(new Event(active ? PAN_START_EVENT : PAN_END_EVENT));
  }, []);

  const updatePanPresentation = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const dragging = Boolean(panPointerRef.current);
    const armed = spacePanRef.current || interactionModeRef.current === 'Pan';
    el.dataset.spacePan = dragging ? 'dragging' : (armed ? 'armed' : 'off');
    el.style.cursor = dragging ? 'grabbing' : (armed ? 'grab' : '');
    el.style.userSelect = armed ? 'none' : '';
  }, []);

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
    clampHorizontalScrollForPage();
  }, [clampHorizontalScrollForPage]);

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
      clampHorizontalScrollForPage();
    });
  }, [clampHorizontalScrollForPage]);

  const cancelPanInertia = useCallback((endInteraction = true) => {
    if (panInertiaRafRef.current) cancelAnimationFrame(panInertiaRafRef.current);
    panInertiaRafRef.current = 0;
    if (endInteraction) setPanInteraction(false);
  }, [setPanInteraction]);

  const startMobilePanInertia = useCallback((fingerVelocityX, fingerVelocityY) => {
    cancelPanInertia(false);
    let vx = Number(fingerVelocityX) || 0;
    let vy = Number(fingerVelocityY) || 0;
    if (Math.hypot(vx, vy) < 0.08) {
      setPanInteraction(false);
      return false;
    }
    // Finger velocity is px/ms; scroll travels in the opposite direction.
    // Exponential decay preserves direction (including diagonals) and feels
    // consistent across 60/120 Hz devices.
    let last = performance.now();
    const coastStartLeft = scrollerRef.current?.scrollLeft || 0;
    const coastStartTop = scrollerRef.current?.scrollTop || 0;
    if (nativePanCoastMarkerRef.current) {
      nativePanCoastMarkerRef.current.setAttribute('aria-label', 'PDF pan coast distance 0 0');
    }
    setPanInteraction(true);
    const tick = (now) => {
      const el = scrollerRef.current;
      if (!el) { cancelPanInertia(); return; }
      const dt = Math.min(32, Math.max(1, now - last));
      last = now;
      const beforeLeft = el.scrollLeft;
      const beforeTop = el.scrollTop;
      el.scrollLeft -= vx * dt;
      el.scrollTop -= vy * dt;
      clampHorizontalScrollForPage();
      if (nativePanCoastMarkerRef.current) {
        nativePanCoastMarkerRef.current.setAttribute(
          'aria-label',
          `PDF pan coast distance ${Math.round(Math.abs(el.scrollLeft - coastStartLeft))} ${Math.round(Math.abs(el.scrollTop - coastStartTop))}`,
        );
      }
      if (Math.abs(el.scrollLeft - beforeLeft) < 0.1) vx = 0;
      if (Math.abs(el.scrollTop - beforeTop) < 0.1) vy = 0;
      const decay = Math.exp(-dt / 325);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < 0.015) {
        panInertiaRafRef.current = 0;
        setPanInteraction(false);
        return;
      }
      panInertiaRafRef.current = requestAnimationFrame(tick);
    };
    panInertiaRafRef.current = requestAnimationFrame(tick);
    return true;
  }, [cancelPanInertia, clampHorizontalScrollForPage, setPanInteraction]);

  const finishPan = useCallback(() => {
    flushPan();
    const pointer = panPointerRef.current;
    const el = scrollerRef.current;
    panPointerRef.current = null;
    if (pointer && el) {
      try { el.releasePointerCapture(pointer.id); } catch { /* already released */ }
    }
    updatePanPresentation();
    setPanInteraction(spacePanRef.current);
  }, [flushPan, setPanInteraction, updatePanPresentation]);

  useEffect(() => {
    const activateSpacePan = (event) => {
      if (!isSpaceKey(event)) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      if (spacePanRef.current) return;
      spacePanRef.current = true;
      setPanInteraction(true);
      updatePanPresentation();
    };
    const releaseSpacePan = (event) => {
      if (event?.type === 'keyup' && !isSpaceKey(event)) return;
      if (event?.type === 'keyup') {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!spacePanRef.current && !panPointerRef.current) return;
      spacePanRef.current = false;
      finishPan();
      setPanInteraction(false);
    };
    const onVisibilityChange = () => {
      if (document.hidden) releaseSpacePan();
    };
    window.addEventListener('keydown', activateSpacePan, true);
    window.addEventListener('keyup', releaseSpacePan, true);
    window.addEventListener('blur', releaseSpacePan);
    window.addEventListener('pagehide', releaseSpacePan);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', activateSpacePan, true);
      window.removeEventListener('keyup', releaseSpacePan, true);
      window.removeEventListener('blur', releaseSpacePan);
      window.removeEventListener('pagehide', releaseSpacePan);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      spacePanRef.current = false;
      finishPan();
      setPanInteraction(false);
    };
  }, [finishPan, setPanInteraction, updatePanPresentation]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;

    const onPointerDown = (event) => {
      const armed = spacePanRef.current || interactionModeRef.current === 'Pan';
      if (!armed || event.button !== 0 || event.pointerType === 'touch') return;
      // Pan owns blank document space, never native controls layered over it.
      // Preventing pointerdown on a PDF form widget/link suppresses its focus,
      // click, and change sequence entirely on desktop.
      if (isEditableTarget(event.target)
        || event.target?.closest?.('a[href], .linkAnnotation, [data-element-id="link"], [data-text-markup-link]')) return;
      event.preventDefault();
      event.stopPropagation();
      panPointerRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      try { el.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      setPanInteraction(true);
      updatePanPresentation();
    };
    const onPointerMove = (event) => {
      const pointer = panPointerRef.current;
      if (!pointer || pointer.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      schedulePan(dx, dy);
    };
    const onPointerEnd = (event) => {
      const pointer = panPointerRef.current;
      if (!pointer || pointer.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      finishPan();
    };

    el.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    el.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    el.addEventListener('pointerup', onPointerEnd, { capture: true, passive: false });
    el.addEventListener('pointercancel', onPointerEnd, { capture: true, passive: false });
    el.addEventListener('lostpointercapture', onPointerEnd, { capture: true, passive: false });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', onPointerEnd, true);
      el.removeEventListener('pointercancel', onPointerEnd, true);
      el.removeEventListener('lostpointercapture', onPointerEnd, true);
      finishPan();
    };
  }, [finishPan, schedulePan, setPanInteraction, updatePanPresentation]);

  useEffect(() => {
    if (interactionMode !== 'Pan' && !spacePanRef.current && panPointerRef.current) {
      finishPan();
    } else {
      updatePanPresentation();
    }
  }, [finishPan, interactionMode, updatePanPresentation]);

  // Mobile interaction contract: one finger performs the active tool; two
  // fingers always pan/pinch the PDF. Safari's page pinch and native text/image
  // callouts are cancelled only inside this viewer surface.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !isMobileSurface) return undefined;

    const setMobileTouchMode = (mode) => {
      if (mode) el.dataset.mobileTouchMode = mode;
      else delete el.dataset.mobileTouchMode;
    };

    const startPinch = (touches) => {
      if (!touches || touches.length < 2) return;
      const rect = el.getBoundingClientRect();
      const center = getTouchCenter(touches, rect);
      const distance = Math.max(1, getTouchDistance(touches));
      mobileTouchRef.current = {
        mode: 'pinch',
        startDistance: distance,
        lastCenterX: center.x,
        lastCenterY: center.y,
        minPresentedLiveZoom: 1,
      };
      gestureRef.current = {
        originScale: scaleRef.current,
        originCursorX: center.x,
        originCursorY: center.y,
        currentCursorX: center.x,
        currentCursorY: center.y,
        originContentX: el.scrollLeft + center.x,
        originContentY: el.scrollTop + center.y,
      };
      liveZoomRef.current = 1;
      setLiveZoom(1);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      window.dispatchEvent(new Event(PINCH_START_EVENT));
      cb.current.onZoomPhase?.('gesture-start', {
        atPct: Math.round(scaleRef.current * 100),
        source: 'pinch',
      });
      postNativePdfDiagnostic('pinch-start', {
        atPct: Math.round(scaleRef.current * 100),
        cursorX: Math.round(center.x),
        cursorY: Math.round(center.y),
      });
      if (nativeLiveZoomFloorRef.current) {
        nativeLiveZoomFloorRef.current.setAttribute('aria-label', 'PDF live zoom floor 1.00');
      }
      setZoomInteraction(true);
      setPanInteraction(true);
      setMobileTouchMode('pinch');
    };

    const isNativeInteractionTarget = (target) => {
      const nativeTarget = target?.nodeType === 3 ? target.parentElement : target;
      if (isEditableTarget(nativeTarget)) return true;
      if (nativeTarget?.closest?.('a[href], .linkAnnotation, [data-element-id="link"]')) return true;
      return interactionModeRef.current === 'TextSelection'
        && Boolean(nativeTarget?.closest?.('.textLayer, .pdfjsTextLayer, .annotationLayer, [data-shape-kind^="text-markup-"]'));
    };

    const onTouchStart = (event) => {
      if (isNativeInteractionTarget(event.target)) return;
      cancelPanInertia();
      // Required by Safari to stop native page zoom / Tab Expose and the
      // long-press loupe before either recognizer claims the sequence.
      event.preventDefault();
      if (event.touches.length >= 2) {
        event.stopPropagation();
        startPinch(event.touches);
        return;
      }
      if (event.touches.length === 1 && interactionModeRef.current === 'Pan') {
        event.stopPropagation();
        const touch = event.touches[0];
        mobileTouchRef.current = {
          mode: 'pan',
          startX: touch.clientX,
          startY: touch.clientY,
          startTime: performance.now(),
          lastX: touch.clientX,
          lastY: touch.clientY,
          lastTime: performance.now(),
          velocityX: 0,
          velocityY: 0,
          samples: [{ x: touch.clientX, y: touch.clientY, at: performance.now() }],
        };
        setPanInteraction(true);
        setMobileTouchMode('pan');
        return;
      }

      if (event.touches.length === 1) {
        mobileTouchRef.current = { mode: 'tool' };
        setMobileTouchMode('tool');
      }
    };

    const onTouchMove = (event) => {
      if (isNativeInteractionTarget(event.target)) return;
      event.preventDefault();
      if (event.touches.length >= 2) {
        event.stopPropagation();
        if (mobileTouchRef.current?.mode !== 'pinch') startPinch(event.touches);
        const touchState = mobileTouchRef.current;
        if (!touchState || touchState.mode !== 'pinch') return;

        const rect = el.getBoundingClientRect();
        const center = getTouchCenter(event.touches, rect);
        const committedScale = scaleRef.current;
        const maxScale = isMobileSurface ? MOBILE_MAX_SCALE : MAX_SCALE;
        const distance = Math.max(1, getTouchDistance(event.touches));
        let nextLiveZoom = distance / touchState.startDistance;
        const minimumScale = getMinimumScaleForLayout(
          dimsPtRef.current,
          containerHRef.current,
          layoutMetricsRef.current,
          containerWRef.current,
        );
        nextLiveZoom = Math.max(
          minimumScale / committedScale,
          Math.min(maxScale / committedScale, nextLiveZoom),
        );

        if (nextLiveZoom < MOBILE_LIVE_ZOOM_REBASE_MIN) {
          // Do not publish the unsafe ratio to React/CSS. Commit that anchored
          // scale directly, rebase the gesture, and keep following the fingers.
          liveZoomRef.current = nextLiveZoom;
          touchState.minPresentedLiveZoom = Math.min(
            touchState.minPresentedLiveZoom || 1,
            MOBILE_LIVE_ZOOM_REBASE_MIN,
          );
          if (nativeLiveZoomFloorRef.current) {
            nativeLiveZoomFloorRef.current.setAttribute(
              'aria-label',
              `PDF live zoom floor ${touchState.minPresentedLiveZoom.toFixed(2)}`,
            );
          }
          checkpointPinchGesture(touchState, center, distance);
          return;
        }
        liveZoomRef.current = nextLiveZoom;
        touchState.minPresentedLiveZoom = Math.min(touchState.minPresentedLiveZoom || 1, nextLiveZoom);
        if (nativeLiveZoomFloorRef.current) {
          nativeLiveZoomFloorRef.current.setAttribute(
            'aria-label',
            `PDF live zoom floor ${touchState.minPresentedLiveZoom.toFixed(2)}`,
          );
        }

        // Keep the committed scroll position stable while fingers are down.
        // The CSS preview now owns both scale and translation; on release the
        // exact same clamped target scroll is committed in one layout write.
        touchState.lastCenterX = center.x;
        touchState.lastCenterY = center.y;
        if (gestureRef.current) {
          gestureRef.current.currentCursorX = center.x;
          gestureRef.current.currentCursorY = center.y;
        }

        if (!wheelRafRef.current) wheelRafRef.current = requestAnimationFrame(applyWheelZoom);
        return;
      }

      const touchState = mobileTouchRef.current;
      if (touchState?.mode === 'pinch' || touchState?.mode === 'pinch-release') {
        event.stopPropagation();
        return;
      }
      if (touchState?.mode === 'pan' && event.touches.length === 1) {
        event.stopPropagation();
        const touch = event.touches[0];
        const now = performance.now();
        const dx = touch.clientX - touchState.lastX;
        const dy = touch.clientY - touchState.lastY;
        const dt = Math.max(1, now - touchState.lastTime);
        schedulePan(dx, dy);
        touchState.velocityX = touchState.velocityX * 0.7 + (dx / dt) * 0.3;
        touchState.velocityY = touchState.velocityY * 0.7 + (dy / dt) * 0.3;
        touchState.samples.push({ x: touch.clientX, y: touch.clientY, at: now });
        touchState.samples = touchState.samples.filter((sample) => now - sample.at <= 140);
        touchState.lastX = touch.clientX;
        touchState.lastY = touch.clientY;
        touchState.lastTime = now;
        return;
      }
      // Tool gestures continue to the native Fabric/SVG handlers.
    };

    const onTouchEnd = (event) => {
      if (isNativeInteractionTarget(event.target)) return;
      event.preventDefault();
      const touchState = mobileTouchRef.current;
      if (!touchState) return;

      if (touchState.mode === 'tool') {
        mobileTouchRef.current = null;
        setMobileTouchMode(null);
        return;
      }

      event.stopPropagation();
      if (touchState.mode === 'pinch' || touchState.mode === 'pinch-release') {
        const transition = resolvePinchEndTransition(touchState.mode, event.touches.length);
        mobileTouchRef.current = transition.nextMode ? { mode: transition.nextMode } : null;
        suppressMobileTouchUntilRef.current = performance.now() + 450;
        setMobileTouchMode(transition.nextMode);
        setPanInteraction(false);
        if (transition.commit) commitGesture();
        return;
      }

      if (touchState.mode === 'pan' && event.touches.length === 0) {
        mobileTouchRef.current = null;
        suppressMobileTouchUntilRef.current = performance.now() + 180;
        setMobileTouchMode(null);
        flushPan();
        const samples = touchState.samples || [];
        const firstSample = samples[0];
        const lastSample = samples[samples.length - 1];
        const sampleDt = Math.max(1, (lastSample?.at || 0) - (firstSample?.at || 0));
        const sampleVelocityX = firstSample && lastSample ? (lastSample.x - firstSample.x) / sampleDt : 0;
        const sampleVelocityY = firstSample && lastSample ? (lastSample.y - firstSample.y) / sampleDt : 0;
        // WebKit may coalesce a fast final move into one sparse touch sample.
        // Keep a whole-gesture fallback so a real flick cannot lose momentum
        // merely because the last 140ms window contains only one event.
        const gestureDt = Math.max(1, performance.now() - touchState.startTime);
        const gestureVelocityX = (touchState.lastX - touchState.startX) / gestureDt;
        const gestureVelocityY = (touchState.lastY - touchState.startY) / gestureDt;
        const velocityX = [touchState.velocityX, sampleVelocityX, gestureVelocityX]
          .reduce((best, candidate) => (Math.abs(candidate) > Math.abs(best) ? candidate : best), 0);
        const velocityY = [touchState.velocityY, sampleVelocityY, gestureVelocityY]
          .reduce((best, candidate) => (Math.abs(candidate) > Math.abs(best) ? candidate : best), 0);
        startMobilePanInertia(velocityX, velocityY);
      }
    };

    const stopNativeGesture = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const stopNativeSelection = (event) => {
      if (isNativeInteractionTarget(event.target)) return;
      event.preventDefault();
    };
    const stopPostGestureClick = (event) => {
      if (performance.now() >= suppressMobileTouchUntilRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const stopPinchPointer = (event) => {
      if (event.pointerType !== 'touch') return;
      if (mobileTouchRef.current?.mode !== 'pinch' && performance.now() >= suppressMobileTouchUntilRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const eventTargets = [el, nativePinchSurfaceRef.current].filter(Boolean);
    eventTargets.forEach((target) => {
      target.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
      target.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
      target.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
      target.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: false });
      target.addEventListener('gesturestart', stopNativeGesture, { capture: true, passive: false });
      target.addEventListener('gesturechange', stopNativeGesture, { capture: true, passive: false });
      target.addEventListener('gestureend', stopNativeGesture, { capture: true, passive: false });
      target.addEventListener('selectstart', stopNativeSelection, true);
      target.addEventListener('contextmenu', stopNativeSelection, true);
      target.addEventListener('dragstart', stopNativeSelection, true);
      target.addEventListener('click', stopPostGestureClick, true);
      target.addEventListener('pointermove', stopPinchPointer, true);
      target.addEventListener('pointerup', stopPinchPointer, true);
      target.addEventListener('pointercancel', stopPinchPointer, true);
    });

    return () => {
      eventTargets.forEach((target) => {
        target.removeEventListener('touchstart', onTouchStart, true);
        target.removeEventListener('touchmove', onTouchMove, true);
        target.removeEventListener('touchend', onTouchEnd, true);
        target.removeEventListener('touchcancel', onTouchEnd, true);
        target.removeEventListener('gesturestart', stopNativeGesture, true);
        target.removeEventListener('gesturechange', stopNativeGesture, true);
        target.removeEventListener('gestureend', stopNativeGesture, true);
        target.removeEventListener('selectstart', stopNativeSelection, true);
        target.removeEventListener('contextmenu', stopNativeSelection, true);
        target.removeEventListener('dragstart', stopNativeSelection, true);
        target.removeEventListener('click', stopPostGestureClick, true);
        target.removeEventListener('pointermove', stopPinchPointer, true);
        target.removeEventListener('pointerup', stopPinchPointer, true);
        target.removeEventListener('pointercancel', stopPinchPointer, true);
      });
      mobileTouchRef.current = null;
      setMobileTouchMode(null);
      cancelPanInertia();
    };
  }, [applyWheelZoom, cancelPanInertia, checkpointPinchGesture, commitGesture, flushPan, isMobileSurface, schedulePan, setPanInteraction, setZoomInteraction, startMobilePanInertia]);

  // Mobile long-press → context menu (Phase D parity). Isolated, additive,
  // and passive: this effect only OBSERVES touches (it never preventDefaults or
  // stops propagation), so it cannot disturb the pan/pinch/tool contract above.
  // A single finger held still for ~380ms synthesizes a `contextmenu` MouseEvent
  // at the touch point; the app-wide right-click dispatcher
  // (utils/contextMenuDiagnostics.js) then resolves the target and opens the
  // annotation / paste / region menu — reusing the exact desktop handlers, so
  // sync/CRDT sees identical operations. Movement beyond 10px, a second finger,
  // or lift-off before the timer cancels the press.
  //
  // Demo reference: mobile-expo-go/App.tsx wires per-target long-press —
  // annotation 320ms (866-895), canvas paste 360ms (897-915), region 420ms
  // (679-699). We resolve the target AFTER the press (canvas-presentation gives
  // no per-annotation DOM to pre-detect), so a single 380ms threshold covers
  // all three rather than three separate delays.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !isMobileSurface || !mobileLongPressContextMenu) return undefined;

    const LONG_PRESS_MS = 380;
    const MOVE_CANCEL_PX = 10;
    let timer = null;
    let startX = 0;
    let startY = 0;

    const clear = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const fire = () => {
      timer = null;
      // Synthesize a right-click at the held point on whatever element is
      // topmost there. The dispatcher reads clientX/clientY + composedPath /
      // elementsFromPoint, so a real MouseEvent on the hit element resolves
      // the page + annotation/region exactly as a desktop right-click would.
      const target = document.elementFromPoint(startX, startY) || el;
      const ev = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: startX,
        clientY: startY,
        button: 2,
      });
      target.dispatchEvent(ev);
    };

    const onStart = (event) => {
      if (event.touches.length !== 1) { clear(); return; }
      // Resize/rotation handles own the entire touch sequence. Never arm the
      // annotation long-press menu beneath them; WebKit otherwise may surface
      // its native Page/Paste callout during a deliberate slow transform.
      if (event.target?.closest?.('[data-resize-handle], [data-rotation-handle]')) {
        clear();
        return;
      }
      const t = event.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      clear();
      timer = window.setTimeout(fire, LONG_PRESS_MS);
    };
    const onMove = (event) => {
      if (!timer) return;
      if (event.touches.length !== 1) { clear(); return; }
      const t = event.touches[0];
      if (Math.abs(t.clientX - startX) > MOVE_CANCEL_PX || Math.abs(t.clientY - startY) > MOVE_CANCEL_PX) {
        clear();
      }
    };

    // passive:true — guarantees we never interfere with the active touch contract.
    el.addEventListener('touchstart', onStart, { capture: true, passive: true });
    el.addEventListener('touchmove', onMove, { capture: true, passive: true });
    el.addEventListener('touchend', clear, { capture: true, passive: true });
    el.addEventListener('touchcancel', clear, { capture: true, passive: true });
    return () => {
      clear();
      el.removeEventListener('touchstart', onStart, true);
      el.removeEventListener('touchmove', onMove, true);
      el.removeEventListener('touchend', clear, true);
      el.removeEventListener('touchcancel', clear, true);
    };
  }, [isMobileSurface, mobileLongPressContextMenu]);

  // ---- imperative zoom / nav -----------------------------------------------
  const zoomToScale = useCallback((target) => {
    const el = scrollerRef.current;
    if (!el) return;
    let newScale = target;
    if (target === 'fit' || target === 'fitw') {
      const metrics = layoutMetricsRef.current;
      const s0 = pageSizes[Math.max(0, range[0])] || pageSizes[0] || { w: 612, h: 792 };
      const rot90 = rotation === 90 || rotation === 270;
      const pw = rot90 ? s0.h : s0.w;
      const ph = rot90 ? s0.w : s0.h;
      const fw = getFitWidthForContainer(el.clientWidth, metrics) / pw;
      const fh = Math.max(1, el.clientHeight - metrics.padTop - metrics.padBottom)
        / (ph + (2 * metrics.gap));
      newScale = target === 'fitw' ? fw : Math.min(fw, fh);
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
    el.scrollTop = Math.max(0, padTopRef.current + tops[i] - layoutMetricsRef.current.padTop);
    el.scrollLeft = Math.min(el.scrollLeft, getPageHorizontalScrollMax(i, scaleRef.current));
    return true;
  }, [getPageHorizontalScrollMax]);

  // ---- onZoomChanged (settle only — scale changes only on commit) ----------
  useLayoutEffect(() => {
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

  useEffect(() => {
    const mountedPages = [];
    for (let index = range[0]; index <= range[1]; index += 1) {
      if (index >= 0 && index < numPages) mountedPages.push(index + 1);
    }
    cb.current.onMountedPagesChange?.(mountedPages);
  }, [numPages, range]);

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
      getMinimumScale: () => getMinimumScaleForLayout(
        dimsPtRef.current,
        containerHRef.current,
        layoutMetricsRef.current,
        containerWRef.current,
      ),
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
      getPageOverlayHost: (page) => {
        const target = Number(page);
        if (!Number.isFinite(target) || target < 1) return null;
        const pageDiv = pageContainerMapRef.current[target]
          || contentRef.current?.querySelector(`.survey-pdfjs-page-div[data-page-number="${target}"]`);
        return pageDiv?.querySelector?.('[data-pdfjs-page-overlay-host="true"]') || null;
      },
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
  const nativePinchE2E = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('nativePinchE2E');
  const nativePinchSessionIdRef = useRef(`pdf-viewer-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // Live zoom previews the exact future layout: scale around the content point
  // captured under the original centroid, translate it toward the moving two-
  // finger centroid, then clamp that translation to the future scroll bounds.
  // Thus fitting axes stay centered, overflowing axes pan with both fingers,
  // and release commits the same scroll target without a hydration/snap frame.
  let liveTransformOrigin = '0 0';
  let liveTranslateX = 0;
  let liveTranslateY = 0;
  let renderedLiveZoom = liveZoom;
  let livePreview = null;
  const zoomGesture = gestureRef.current;
  if (zoomGesture) {
    const preview = resolveGesturePreview(zoomGesture, scale * liveZoom);
    liveTransformOrigin = `${zoomGesture.originContentX}px ${zoomGesture.originContentY - layout.padTop}px`;
    if (preview) {
      livePreview = preview;
      renderedLiveZoom = preview.targetScale / scale;
      liveTranslateX = preview.translateX;
      liveTranslateY = preview.translateY;
    }
  }

  const scrollbarPreviewMetrics = livePreview ? (() => {
    const targetScale = livePreview.targetScale;
    const metrics = layoutMetricsRef.current;
    const gapPx = metrics.gap * targetScale;
    let rawHeight = metrics.padTop + gapPx;
    let maximumPageWidth = 0;
    layout.dims.forEach((dim) => {
      rawHeight += dim.h * targetScale + gapPx;
      maximumPageWidth = Math.max(maximumPageWidth, dim.w * targetScale);
    });
    rawHeight += metrics.padBottom;
    const contentWidth = maximumPageWidth <= containerW
      ? containerW
      : maximumPageWidth + (2 * metrics.padX);
    const contentHeight = rawHeight + Math.max(0, (containerH - rawHeight) / 2);
    return {
      viewportWidth: containerW,
      viewportHeight: containerH,
      contentWidth,
      contentHeight,
      scrollLeft: livePreview.left,
      scrollTop: livePreview.top,
    };
  })() : null;

  return (
    <>
    <div
      ref={scrollerRef}
      id={viewerId}
      className={`${className}${isMobileSurface ? ' survey-pdfjs-mobile-surface' : ''}`}
      data-mobile-pdf-surface={isMobileSurface ? 'true' : 'false'}
      data-text-selection={interactionMode === 'TextSelection' ? 'true' : 'false'}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
        background: isMobileSurface ? '#070A0D' : '#12151c',
        contain: 'strict',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        touchAction: isMobileSurface ? 'none' : 'pan-x pan-y pinch-zoom',
        WebkitTouchCallout: isMobileSurface ? 'none' : undefined,
        WebkitUserSelect: isMobileSurface && interactionMode !== 'TextSelection' ? 'none' : undefined,
        WebkitUserDrag: isMobileSurface ? 'none' : undefined,
        userSelect: isMobileSurface && interactionMode !== 'TextSelection' ? 'none' : undefined,
        ...style
      }}
    >
      {nativePinchE2E && (
        <>
          {createPortal(
            <button
              ref={nativePinchSurfaceRef}
              type="button"
              aria-label="PDF gesture surface"
              tabIndex={-1}
              style={{
                position: 'fixed', left: '15vw', top: '15vh', width: '70vw', height: '60vh',
                zIndex: 2147483646, opacity: 0.001, touchAction: 'none',
              }}
            />,
            document.body,
          )}
          <span
            aria-label={`PDF viewer session ${nativePinchSessionIdRef.current}`}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <span
            aria-label={`PDF zoom scale ${Math.round(scale * 100)}`}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <span
            ref={nativeScrollMarkerRef}
            aria-label="PDF scroll position 0 0"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <span
            ref={nativeAnchorMarkerRef}
            aria-label="PDF anchor settle error 0.00"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <span
            ref={nativePanCoastMarkerRef}
            aria-label="PDF pan coast distance 0 0"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
          <span
            ref={nativeLiveZoomFloorRef}
            aria-label="PDF live zoom floor 1.00"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
        </>
      )}
      <style>{`
        [data-space-pan='armed'], [data-space-pan='armed'] * { cursor: grab !important; }
        [data-space-pan='dragging'], [data-space-pan='dragging'] * { cursor: grabbing !important; }
        html[data-survey-pdfjs-pan-active='true'] [data-eraser-cursor] { display: none !important; }
        .survey-pdfjs-mobile-surface,
        .survey-pdfjs-mobile-surface canvas,
        .survey-pdfjs-mobile-surface svg,
        .survey-pdfjs-mobile-surface img,
        .survey-pdfjs-mobile-surface .textLayer {
          -webkit-user-select: none !important;
          user-select: none !important;
          -webkit-touch-callout: none !important;
          -webkit-user-drag: none !important;
        }
        .survey-pdfjs-mobile-surface[data-text-selection='true'] {
          -webkit-user-select: text !important;
          user-select: text !important;
          -webkit-touch-callout: default !important;
        }
        .survey-pdfjs-mobile-surface input,
        .survey-pdfjs-mobile-surface textarea,
        .survey-pdfjs-mobile-surface [contenteditable='true'] {
          -webkit-user-select: text !important;
          user-select: text !important;
          -webkit-touch-callout: default !important;
        }
        .survey-pdfjs-mobile-surface .pdfjsTextLayer.is-interactive,
        .survey-pdfjs-mobile-surface .pdfjsTextLayer.is-interactive :is(span, br) {
          -webkit-user-select: text !important;
          user-select: text !important;
          -webkit-touch-callout: default !important;
          -webkit-user-drag: auto !important;
        }
      `}</style>
      {loading ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#cfd2d6' }}>
          Loading…
        </div>
      ) : (
        <div
          ref={contentRef}
          data-pdfjs-content="true"
          data-pdfjs-live-zoom={renderedLiveZoom !== 1 ? 'true' : 'false'}
          style={{
            position: 'relative', width: layout.contentW, height: layout.totalH,
            // padTop vertically centers a document shorter than the viewport via
            // margin (not scroll → scrollTop stays >= 0). Overflow docs get padTop=0.
            marginTop: layout.padTop,
            transform: renderedLiveZoom !== 1 || liveTranslateX || liveTranslateY
              ? `translate(${liveTranslateX}px, ${liveTranslateY}px) scale(${renderedLiveZoom})`
              : 'none',
            // transformOrigin is in the content node's OWN box space. On an overflowing
            // axis it is cursor-anchored (originContentX/Y captured in scroll space, Y
            // shifted by marginTop=padTop); on a fitting axis it is pinned to the
            // viewport centre so the page stays locked centred with no drift/snap. See
            // the liveTransformOrigin computation above for the full UX rationale.
            transformOrigin: liveTransformOrigin,
            // A mobile content node represents the full multi-page document.
            // `will-change: transform` can retain that huge promoted layer even
            // after a pinch settles, exhausting WKWebView across repeated deep
            // zoom cycles. WebKit promotes the active transform on demand; do
            // not ask it to keep the document layer resident.
            willChange: isMobileSurface
              ? 'auto'
              : (renderedLiveZoom !== 1 || liveTranslateX || liveTranslateY ? 'transform' : 'auto'),
          }}
        >
          {pageSizes.map((s, i) => {
            const dim = layout.dims[i];
            const left = getPageLeftAtScale(i, scale);
            const top = layout.tops[i];
            const mounted = i >= range[0] && i <= range[1];
            return (
              <div
                key={i}
                data-page-number={i + 1}
                data-page-mounted={mounted ? 'true' : 'false'}
                className="survey-pdfjs-page-div"
                id={`${viewerId}_pageDiv_${i}`}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: dim.w * scale,
                  height: dim.h * scale,
                  background: '#fff',
                  boxShadow: isMobileSurface
                    ? '0 0 0 1px #D8D8D0, 0 10px 28px rgba(0,0,0,0.35)'
                    : undefined,
                }}
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
                      isMobileSurface={isMobileSurface}
                    />
                    <DetailTile
                      pdf={pdfRef.current}
                      pageIndex={i}
                      scale={scale}
                      rotation={rotation}
                      liveZoom={liveZoom}
                      interactionRef={panInteractionRef}
                      scrollerRef={scrollerRef}
                      isMobileSurface={isMobileSurface}
                    />
                    {textSelectionLayerActive && (
                      <PdfjsTextLayer
                        pdf={pdfRef.current}
                        pageNumber={i + 1}
                        scale={scale}
                        rotation={rotation}
                        interactive={textSelectionLayerInteractive}
                        onTextAvailability={onTextAvailability}
                      />
                    )}
                  </>
                ) : (
                  <div style={{ width: '100%', height: '100%', background: '#fff' }} />
                )}
                <div
                  data-pdfjs-page-overlay-host="true"
                  data-overlay-page={i + 1}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: textSelectionLayerActive ? 41 : 30,
                    overflow: 'visible',
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
    <ViewportScrollbars
      scrollerRef={scrollerRef}
      previewMetrics={scrollbarPreviewMetrics}
      disabled={isMobileSurface}
    />
    </>
  );
});

export default PdfjsViewerContainer;
