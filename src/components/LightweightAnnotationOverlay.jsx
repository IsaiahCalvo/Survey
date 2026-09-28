/**
 * Persistent Canvas2D annotation presentation for one PDF page.
 *
 * Annotation data remains the source of truth. This component paints one bitmap
 * per mounted page so pan, scroll, and live zoom move the PDF and marks together.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  calculateAnnotationCanvasBackingStore,
  paintAnnotationCanvas,
} from '../utils/annotationCanvasPainter.js';
import { calculateAnnotationDetailTile } from '../utils/annotationDetailTile.js';
import { annotationImagesReady, preloadAnnotationImages } from '../utils/annotationImageCache.js';
import { isAnnotationVisibleInContext } from '../utils/annotationVisibilityRules';
import { projectPaperInkForPresentation } from '../utils/paperInkPresentation.js';

const EMPTY_ARR = [];
const WORKER_OBJECT_THRESHOLD = 500;
const ZOOM_START_EVENT = 'survey-pdfjs-zoom-start';
const ZOOM_END_EVENT = 'survey-pdfjs-zoom-end';
const PAN_START_EVENT = 'survey-pdfjs-pan-start';
const PAN_END_EVENT = 'survey-pdfjs-pan-end';
const ZOOM_INTERACTION = 1;
const PAN_INTERACTION = 2;

const paintPayloadToCanvas = (canvas, payload, renderer = 'main') => {
  if (!canvas || !payload) return false;
  if (canvas.width !== payload.width) canvas.width = payload.width;
  if (canvas.height !== payload.height) canvas.height = payload.height;
  const context = canvas.getContext('2d');
  if (!context) return false;
  paintAnnotationCanvas(context, {
    canvasWidth: payload.width,
    canvasHeight: payload.height,
    drawScale: payload.drawScale,
    drawScaleY: payload.drawScaleY,
    displayScale: payload.displayScale,
    pageWidth: payload.pageWidth,
    pageHeight: payload.pageHeight,
    offsetX: payload.offsetX,
    offsetY: payload.offsetY,
    objects: payload.objects,
    callouts: payload.callouts,
  });
  canvas.dataset.canvasClamped = payload.clamped ? 'true' : 'false';
  canvas.dataset.canvasRenderer = renderer;
  canvas.dataset.canvasPaintGeneration = String(
    (Number(canvas.dataset.canvasPaintGeneration) || 0) + 1,
  );
  canvas.dataset.canvasAnnotationRevision = String(payload.annotationRevision ?? '');
  canvas.dataset.canvasDrawScale = String(payload.drawScale);
  canvas.dataset.canvasDrawScaleY = String(payload.drawScaleY ?? payload.drawScale);
  canvas.dataset.canvasPageOffsetX = String(payload.offsetX || 0);
  canvas.dataset.canvasPageOffsetY = String(payload.offsetY || 0);
  return true;
};

const presentPaintedCanvas = ({ baseCanvas, detailCanvas, canvas, payload }) => {
  if (!baseCanvas || !detailCanvas || !canvas || !payload) return;
  const isDetail = payload.target === 'detail';
  canvas.dataset.annotationDetailActive = isDetail ? 'true' : 'false';
  if (isDetail) {
    canvas.style.left = `${payload.tile.left}px`;
    canvas.style.top = `${payload.tile.top}px`;
    canvas.style.width = `${payload.tile.width}px`;
    canvas.style.height = `${payload.tile.height}px`;
    canvas.style.display = 'block';
    baseCanvas.style.display = 'none';
    baseCanvas.dataset.annotationDetailActive = 'false';
  } else {
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    // Device-exact box when the payload carries one (unclamped base paint);
    // '100%' otherwise — see the cssWidth comment at the payload build site.
    canvas.style.width = payload.cssWidth ? `${payload.cssWidth}px` : '100%';
    canvas.style.height = payload.cssHeight ? `${payload.cssHeight}px` : '100%';
    canvas.style.display = 'block';
    detailCanvas.style.display = 'none';
    detailCanvas.dataset.annotationDetailActive = 'false';
  }
};

const LightweightAnnotationOverlay = memo(({
  pageNumber,
  width,
  height,
  scale,
  interactionSessionId = null,
  proxyObjects = null,
  proxyCallouts = null,
  annotations,
  callouts = EMPTY_ARR,
  surveyMarkers = EMPTY_ARR,
  visible = true,
  selectedModuleId = null,
  showSurveyPanel = false,
  selectedSpaceId = null,
  activeSpaceId = null,
  activeRegions = null,
  activeRegionId = null,
  spaces = EMPTY_ARR,
  getCanvasAnnotationVisibilityState = null,
  getSurveyAnnotationVisibilityState = null,
  isRegionOverlayEnabled = null,
  layerVisibility = null,
  annotationRevision = null,
  calloutRevision = null,
  onRenderReady = null,
}) => {
  const overlayRef = useRef(null);
  const canvasRef = useRef(null);
  const detailCanvasRef = useRef(null);
  const detailTileRef = useRef(null);
  const renderViewportRef = useRef(null);
  const viewportInteractionRef = useRef(0);
  const scrollRafRef = useRef(0);
  const workerRef = useRef(null);
  const workerRequestRef = useRef(0);
  const workerSentDataRevisionRef = useRef(null);
  const workerDataVersionRef = useRef(0);
  const workerFailedRef = useRef(false);
  const workerFallbackRef = useRef(null);
  const latestPayloadRef = useRef(null);
  const readyRafRef = useRef(0);
  const renderReadyStateRef = useRef({ onRenderReady, pageNumber });
  renderReadyStateRef.current = { onRenderReady, pageNumber };
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const safeScale = Number.isFinite(Number(scale)) && Number(scale) > 0 ? Number(scale) : 1;

  const visibilityContext = useMemo(() => ({
    pageNumber,
    selectedModuleId,
    showSurveyPanel,
    selectedSpaceId,
    activeSpaceId,
    activeRegions,
    activeRegionId,
    spaces,
    getCanvasAnnotationVisibilityState,
    getSurveyAnnotationVisibilityState,
    isRegionOverlayEnabled,
    layerVisibility,
  }), [
    activeRegionId,
    activeRegions,
    activeSpaceId,
    getCanvasAnnotationVisibilityState,
    getSurveyAnnotationVisibilityState,
    isRegionOverlayEnabled,
    layerVisibility,
    pageNumber,
    selectedModuleId,
    selectedSpaceId,
    showSurveyPanel,
    spaces,
  ]);

  const surveyMarkerObjects = useMemo(() => surveyMarkers
    .filter((marker) => marker && isAnnotationVisibleInContext({
      annotation: marker,
      ...visibilityContext,
    }))
    .map((marker, index) => ({
      type: 'rect',
      annotationId: marker.annotationId || `survey-marker-${pageNumber}-${index}`,
      moduleId: marker.moduleId ?? null,
      regionId: marker.regionId ?? null,
      layer: marker.layer || null,
      left: Number(marker.x) || 0,
      top: Number(marker.y) || 0,
      width: Number(marker.width) || 0,
      height: Number(marker.height) || 0,
      fill: marker.needsEntity ? 'transparent' : (marker.color || 'rgba(255,235,59,0.25)'),
      stroke: marker.needsEntity ? '#4A90E2' : 'transparent',
      strokeWidth: marker.needsEntity ? 2 : 0,
      strokeDashArray: marker.needsEntity ? [5, 5] : null,
      // UX 2026-07-14 (zoom-scaling unification): the SVG marker border is a
      // page-unit stroke now (no vector-effect pin), so the painter must NOT
      // divide by displayScale either — flag dropped on both surfaces so the
      // border scales with zoom like rect/ellipse strokes.
      globalCompositeOperation: 'multiply',
      opacity: 1,
      scaleX: 1,
      scaleY: 1,
      angle: Number(marker.angle) || 0,
    })), [pageNumber, surveyMarkers, visibilityContext]);

  const visibleObjects = useMemo(() => {
    const source = Array.isArray(proxyObjects)
      ? proxyObjects
      : (Array.isArray(annotations?.objects) ? annotations.objects : EMPTY_ARR);
    const normalObjects = source
      .filter((object) => (
        object
        && !object.annotationId
        && isAnnotationVisibleInContext({ annotation: object, ...visibilityContext })
      ))
      .map(projectPaperInkForPresentation);
    return normalObjects.concat(surveyMarkerObjects);
  }, [
    annotationRevision,
    annotations?.objects,
    interactionSessionId,
    proxyObjects,
    surveyMarkerObjects,
    visibilityContext,
  ]);

  const visibleCallouts = useMemo(() => {
    const source = Array.isArray(proxyCallouts)
      ? proxyCallouts
      : callouts.filter((callout) => Number(callout?.pageNumber) === Number(pageNumber));
    return source.filter((callout) => (
      callout
      && (callout.pageNumber == null || Number(callout.pageNumber) === Number(pageNumber))
      && isAnnotationVisibleInContext({ annotation: callout, ...visibilityContext })
    ));
  }, [
    calloutRevision,
    callouts,
    interactionSessionId,
    pageNumber,
    proxyCallouts,
    visibilityContext,
  ]);

  const workerDataRevision = useMemo(() => {
    workerDataVersionRef.current += 1;
    return workerDataVersionRef.current;
  }, [visibleCallouts, visibleObjects]);

  const hasRenderablePreview = visibleObjects.length > 0 || visibleCallouts.length > 0;
  const useWorkerPaint = visibleObjects.length + visibleCallouts.length >= WORKER_OBJECT_THRESHOLD;

  useLayoutEffect(() => {
    if (
      !useWorkerPaint
      || typeof Worker === 'undefined'
      || typeof OffscreenCanvas === 'undefined'
    ) {
      return undefined;
    }

    let failed = false;
    let worker;
    try {
      worker = new Worker(new URL('./annotationCanvasWorker.js', import.meta.url), { type: 'module' });
    } catch (_error) {
      workerFailedRef.current = true;
      return undefined;
    }

    workerFailedRef.current = false;
    workerSentDataRevisionRef.current = null;
    workerRef.current = worker;
    const notifyReady = (interactionSessionId) => {
      if (readyRafRef.current) cancelAnimationFrame(readyRafRef.current);
      readyRafRef.current = requestAnimationFrame(() => {
        readyRafRef.current = 0;
        const readyState = renderReadyStateRef.current;
        readyState.onRenderReady?.(readyState.pageNumber, interactionSessionId);
      });
    };
    const failWorker = () => {
      if (failed) return;
      failed = true;
      workerFailedRef.current = true;
      workerRequestRef.current += 1;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      const payload = latestPayloadRef.current;
      const canvas = payload?.target === 'detail' ? detailCanvasRef.current : canvasRef.current;
      if (paintPayloadToCanvas(canvas, payload, 'main-fallback')) {
        presentPaintedCanvas({
          baseCanvas: canvasRef.current,
          detailCanvas: detailCanvasRef.current,
          canvas,
          payload,
        });
        notifyReady(payload?.interactionSessionId);
      }
    };
    workerFallbackRef.current = failWorker;

    worker.onmessage = (event) => {
      const message = event.data;
      if (message?.type === 'error') {
        failWorker();
        return;
      }
      if (message?.type !== 'rendered') return;
      const payload = latestPayloadRef.current;
      if (message.requestId !== workerRequestRef.current || message.requestId !== payload?.requestId) {
        message.bitmap?.close?.();
        return;
      }
      const canvas = payload.target === 'detail' ? detailCanvasRef.current : canvasRef.current;
      if (!canvas) {
        message.bitmap?.close?.();
        return;
      }
      if (canvas.width !== message.width) canvas.width = message.width;
      if (canvas.height !== message.height) canvas.height = message.height;
      const context = canvas.getContext('2d');
      if (!context) {
        message.bitmap?.close?.();
        failWorker();
        return;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, message.width, message.height);
      context.drawImage(message.bitmap, 0, 0);
      message.bitmap.close?.();
      canvas.dataset.canvasClamped = message.clamped ? 'true' : 'false';
      canvas.dataset.canvasRenderer = 'worker';
      canvas.dataset.canvasPaintGeneration = String(
        (Number(canvas.dataset.canvasPaintGeneration) || 0) + 1,
      );
      canvas.dataset.canvasAnnotationRevision = String(payload.annotationRevision ?? '');
      canvas.dataset.canvasDrawScale = String(payload.drawScale);
      canvas.dataset.canvasDrawScaleY = String(payload.drawScaleY ?? payload.drawScale);
      canvas.dataset.canvasPageOffsetX = String(payload.offsetX || 0);
      canvas.dataset.canvasPageOffsetY = String(payload.offsetY || 0);
      presentPaintedCanvas({
        baseCanvas: canvasRef.current,
        detailCanvas: detailCanvasRef.current,
        canvas,
        payload,
      });
      notifyReady(payload.interactionSessionId);
    };
    worker.onerror = failWorker;

    return () => {
      failed = true;
      workerRequestRef.current += 1;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      if (workerFallbackRef.current === failWorker) workerFallbackRef.current = null;
    };
  }, [useWorkerPaint]);

  useLayoutEffect(() => {
    if (!hasRenderablePreview) return undefined;
    if (!canvasRef.current || !detailCanvasRef.current || !overlayRef.current) return undefined;
    let readyFrame = 0;

    const requestPaint = (payload) => {
      const canvas = payload.target === 'detail' ? detailCanvasRef.current : canvasRef.current;
      if (!canvas) return;
      latestPayloadRef.current = payload;
      const worker = useWorkerPaint && !workerFailedRef.current ? workerRef.current : null;
      if (worker) {
        payload.requestId = workerRequestRef.current + 1;
        workerRequestRef.current = payload.requestId;
        canvas.dataset.canvasClamped = payload.clamped ? 'true' : 'false';
        canvas.dataset.canvasRenderer = 'worker-pending';
        try {
          const alreadyCached = workerSentDataRevisionRef.current === workerDataRevision;
          const { objects, callouts: payloadCallouts, ...renderOnlyPayload } = payload;
          worker.postMessage(alreadyCached
            ? { type: 'render', ...renderOnlyPayload }
            : { type: 'render', ...renderOnlyPayload, objects, callouts: payloadCallouts });
          workerSentDataRevisionRef.current = workerDataRevision;
          return;
        } catch (_error) {
          workerFallbackRef.current?.();
          return;
        }
      }

      workerRequestRef.current += 1;
      if (!paintPayloadToCanvas(canvas, payload)) return;
      presentPaintedCanvas({
        baseCanvas: canvasRef.current,
        detailCanvas: detailCanvasRef.current,
        canvas,
        payload,
      });
      if (readyFrame) cancelAnimationFrame(readyFrame);
      readyFrame = requestAnimationFrame(() => {
        readyFrame = 0;
        const readyState = renderReadyStateRef.current;
        readyState.onRenderReady?.(readyState.pageNumber, payload.interactionSessionId);
      });
    };

    const renderViewport = (force = false) => {
      if (viewportInteractionRef.current) return;
      const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const backingStore = calculateAnnotationCanvasBackingStore({
        pageWidth: safeWidth,
        pageHeight: safeHeight,
        displayScale: safeScale,
        devicePixelRatio,
      });
      let tile = null;
      if (backingStore.clamped) {
        const overlay = overlayRef.current;
        const scroller = overlay?.closest?.('.survey-pdfjs-viewer');
        tile = calculateAnnotationDetailTile({
          pageWidth: safeWidth,
          pageHeight: safeHeight,
          pageRect: overlay?.getBoundingClientRect?.(),
          viewportRect: scroller?.getBoundingClientRect?.(),
          devicePixelRatio,
          previousTile: detailTileRef.current,
          force,
        });
        if (!force && tile && tile === detailTileRef.current) return;
        if (!tile && !force) return;
      }
      detailTileRef.current = tile;

      // Device-exact CSS box for the UNCLAMPED base canvas: the page host box
      // is fractional (e.g. 605.03125px), so `width:100%` makes Chrome's
      // compositor stretch the integer-px bitmap by ~1/605 in x — a linear
      // drift that put eraser-mode marks ~1px right of the SVG at the page's
      // far edge (renderer-parity harness, 2026-07-14). Sizing the CSS box to
      // backing/dpr maps bitmap px 1:1 onto device px (no resample); the
      // ≤0.5px sliver left uncovered at the page edge is invisible. Clamped
      // (deep-zoom) backings are SMALLER than the host by design and must
      // keep stretching to fill it.
      requestPaint({
        requestId: 0,
        target: tile ? 'detail' : 'base',
        tile,
        width: tile?.backingWidth ?? backingStore.width,
        height: tile?.backingHeight ?? backingStore.height,
        cssWidth: backingStore.clamped ? null : backingStore.cssWidth,
        cssHeight: backingStore.clamped ? null : backingStore.cssHeight,
        drawScale: tile?.drawScale ?? backingStore.drawScale,
        drawScaleY: tile?.drawScaleY ?? backingStore.drawScaleY,
        displayScale: safeScale,
        pageWidth: safeWidth,
        pageHeight: safeHeight,
        offsetX: tile?.pageOffsetX ?? 0,
        offsetY: tile?.pageOffsetY ?? 0,
        objects: visibleObjects,
        callouts: visibleCallouts,
        clamped: backingStore.clamped,
        interactionSessionId,
        annotationRevision: annotations?.eraserPresentationRevision ?? annotationRevision,
        dataRevision: workerDataRevision,
      });
    };

    renderViewportRef.current = renderViewport;
    renderViewport(true);
    return () => {
      if (renderViewportRef.current === renderViewport) renderViewportRef.current = null;
      if (readyFrame) cancelAnimationFrame(readyFrame);
    };
  }, [
    annotationRevision,
    annotations?.eraserPresentationRevision,
    hasRenderablePreview,
    interactionSessionId,
    safeHeight,
    safeScale,
    safeWidth,
    useWorkerPaint,
    visibleCallouts,
    visibleObjects,
    workerDataRevision,
  ]);

  // w52 (2026-09-28): image marks (imported stamps) need a decoded image
  // before Canvas2D can draw them; the first paint skips any still decoding.
  // Repaint once they land so the canvas shows the stamp like the SVG layer.
  // (The worker path decodes in its own realm and repaints itself.)
  useEffect(() => {
    if (!hasRenderablePreview || annotationImagesReady(visibleObjects)) return undefined;
    let cancelled = false;
    preloadAnnotationImages(visibleObjects).then((loaded) => {
      if (!cancelled && loaded) renderViewportRef.current?.(true);
    });
    return () => { cancelled = true; };
  }, [hasRenderablePreview, visibleObjects]);

  useEffect(() => {
    if (!hasRenderablePreview) return undefined;
    const begin = (flag) => {
      viewportInteractionRef.current |= flag;
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    };
    const finish = (flag) => {
      viewportInteractionRef.current &= ~flag;
      if (viewportInteractionRef.current || scrollRafRef.current) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        renderViewportRef.current?.(true);
      });
    };
    const onZoomStart = () => begin(ZOOM_INTERACTION);
    const onZoomEnd = () => finish(ZOOM_INTERACTION);
    const onPanStart = () => begin(PAN_INTERACTION);
    const onPanEnd = () => finish(PAN_INTERACTION);
    window.addEventListener(ZOOM_START_EVENT, onZoomStart);
    window.addEventListener(ZOOM_END_EVENT, onZoomEnd);
    window.addEventListener(PAN_START_EVENT, onPanStart);
    window.addEventListener(PAN_END_EVENT, onPanEnd);
    return () => {
      window.removeEventListener(ZOOM_START_EVENT, onZoomStart);
      window.removeEventListener(ZOOM_END_EVENT, onZoomEnd);
      window.removeEventListener(PAN_START_EVENT, onPanStart);
      window.removeEventListener(PAN_END_EVENT, onPanEnd);
      viewportInteractionRef.current = 0;
    };
  }, [hasRenderablePreview]);

  useEffect(() => {
    if (!hasRenderablePreview) return undefined;
    const scroller = overlayRef.current?.closest?.('.survey-pdfjs-viewer');
    if (!scroller) return undefined;
    const scheduleViewportRender = () => {
      if (viewportInteractionRef.current) return;
      if (scrollRafRef.current) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        renderViewportRef.current?.(false);
      });
    };
    scroller.addEventListener('scroll', scheduleViewportRender, { passive: true });
    window.addEventListener('resize', scheduleViewportRender, { passive: true });
    // Container-aware invalidation (CLAUDE.md canvas-sizing rule): the paint
    // must follow the page host's REAL box, not the events that usually
    // precede it changing. A typed/pinch zoom can commit its final page-host
    // layout a frame after ZOOM_END's forced repaint ran, so the tile gets
    // painted against a mid-resize rect (~0.3% off) and then nothing ever
    // invalidates it — eraser entry re-presents the stale paint ~3 CSS px off
    // the SVG (user-visible E/P text bob, reproduced at typed 447% zoom).
    // The overlay is inset:0 in the page host, so observing it tracks the
    // host box exactly; the tile's pageScale guard turns no-change fires into
    // cheap no-ops for the detail path.
    let resizeObserver = null;
    if (typeof ResizeObserver === 'function' && overlayRef.current) {
      resizeObserver = new ResizeObserver(scheduleViewportRender);
      resizeObserver.observe(overlayRef.current);
    }
    return () => {
      scroller.removeEventListener('scroll', scheduleViewportRender);
      window.removeEventListener('resize', scheduleViewportRender);
      resizeObserver?.disconnect();
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    };
  }, [hasRenderablePreview, safeScale]);

  useLayoutEffect(() => () => {
    if (readyRafRef.current) cancelAnimationFrame(readyRafRef.current);
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  if (!hasRenderablePreview) return null;

  return (
    <div
      ref={overlayRef}
      data-lightweight-annotation-overlay={pageNumber}
      data-lightweight-renderer="canvas2d"
      data-lightweight-object-count={visibleObjects.length}
      data-lightweight-callout-count={visibleCallouts.length}
      data-canvas-visible={visible ? 'true' : 'false'}
      style={{
        // Fill the page host exactly (demo model: PdfjsArm's CanvasAnnotationLayer
        // is inset:0 in the page wrapper). Sizing from `pageSize * scale` px is
        // forbidden — a stale scale scalar makes the whole committed layer drift
        // off the page box (CLAUDE.md container-aware sizing rule). The `scale`
        // prop only chooses backing-store RESOLUTION, never geometry.
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        // Same stacking as the SVG layer's wrapper (zIndex 100). At the old
        // zIndex 10 the pdf.js form/link layers painted OVER canvas-rendered
        // annotations, so marks overlapping a form field vanished whenever
        // this surface served (eraser mode / proxy windows) — a z-order
        // disagreement between the two presentations of the same truth.
        zIndex: 100,
        overflow: 'hidden',
        visibility: visible ? 'visible' : 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        data-annotation-presentation-canvas={pageNumber}
        data-annotation-detail-active="false"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'block',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={detailCanvasRef}
        data-annotation-detail-canvas={pageNumber}
        data-annotation-detail-active="false"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'none',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

LightweightAnnotationOverlay.displayName = 'LightweightAnnotationOverlay';

export default LightweightAnnotationOverlay;
