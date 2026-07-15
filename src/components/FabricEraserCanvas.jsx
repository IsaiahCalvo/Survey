/**
 * Page-space eraser interaction surface.
 *
 * The persisted page JSON is the only annotation model. The transparent
 * surface captures a gesture, previews it in pixels, then applies the same
 * immutable geometry engine used by the PDF.js feature demo to the latest JSON.
 */
import { memo, useCallback, useEffect, useRef } from 'react';
import { calculateCalloutConnection } from '../utils/calloutGeometry';
import { canModify } from '../lib/collab/permissionScope.js';
import {
  beginAnnotationGesture,
  markAnnotationPointerRelease,
  markAnnotationPreviewFrame,
} from '../utils/annotationPreviewDiag';
import {
  eraserStrokeTouchesObject,
  getEraserStrokeBounds,
  getEraserCandidateId,
  sampleEraserStroke,
} from '../utils/eraserHitTest.js';
import { erasePageAnnotations } from '../utils/pageSpaceEraser.js';
import { eraserDiameterToPageRadius } from '../utils/eraserSizing.js';
import { selectEraserPreviewBaseline } from '../utils/eraserPreviewHandoff.js';
import { planPageEraserPreview } from '../utils/eraserPreviewPlan.js';
import { getCoalescedOrCurrentEvents } from '../utils/eraserPointerSamples.js';
import { paintAnnotationCanvas } from '../utils/annotationCanvasPainter.js';
import { projectPaperInkForPresentation } from '../utils/paperInkPresentation.js';

let presentationRevisionSequence = 0;

const distanceToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx + (point.y - start.y) * dy
  ) / lengthSq));
  return Math.hypot(
    point.x - (start.x + t * dx),
    point.y - (start.y + t * dy),
  );
};

const pointInRect = (point, rect, radius) => (
  point.x >= rect.x - radius
  && point.x <= rect.x + rect.width + radius
  && point.y >= rect.y - radius
  && point.y <= rect.y + rect.height + radius
);

const getLegacyCalloutPayload = (object, fallbackPageNumber) => {
  const callout = object?.callout || (object?.type === 'callout' ? object : null);
  if (!callout || typeof callout !== 'object' || !callout.id) return null;
  return { ...callout, pageNumber: callout.pageNumber ?? fallbackPageNumber };
};

const getCalloutHitIds = ({
  callouts,
  pageNumber,
  pageWidth,
  pageHeight,
  eraserPoints,
  eraserRadius,
}) => {
  if (!Array.isArray(callouts) || callouts.length === 0) return [];
  const samples = sampleEraserStroke(eraserPoints, eraserRadius);
  const hitIds = [];
  const lineTolerance = eraserRadius + 8;

  for (const callout of callouts) {
    if (
      !callout?.id
      || Number(callout.pageNumber) !== Number(pageNumber)
      || hitIds.includes(callout.id)
    ) continue;
    const textBox = {
      x: Number(callout.textBoxPosition?.x || 0) * pageWidth,
      y: Number(callout.textBoxPosition?.y || 0) * pageHeight,
      width: Math.max(18, Number(callout.textBoxWidth ?? 0.1) * pageWidth),
      height: Math.max(18, Number(callout.textBoxHeight ?? 0.05) * pageHeight),
    };
    const knee = {
      x: Number(callout.knee?.x || 0) * pageWidth,
      y: Number(callout.knee?.y || 0) * pageHeight,
    };
    const arrowTip = {
      x: Number(callout.arrowTip?.x || 0) * pageWidth,
      y: Number(callout.arrowTip?.y || 0) * pageHeight,
    };
    const connection = calculateCalloutConnection(
      textBox.x,
      textBox.y,
      textBox.width,
      textBox.height,
      knee,
      arrowTip,
      0,
    );
    const hit = samples.some((point) => (
      pointInRect(point, textBox, eraserRadius)
      || Math.hypot(point.x - arrowTip.x, point.y - arrowTip.y) <= lineTolerance
      || Math.hypot(
        point.x - connection.effectiveKnee.x,
        point.y - connection.effectiveKnee.y,
      ) <= lineTolerance
      || (
        !connection.shouldHideLine1
        && distanceToSegment(point, connection.line1Start, connection.effectiveKnee) <= lineTolerance
      )
      || distanceToSegment(point, connection.line2Start, arrowTip) <= lineTolerance
    ));
    if (hit) hitIds.push(callout.id);
  }
  return hitIds;
};

const FabricEraserCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  annotations,
  callouts = [],
  onEraseCommit,
  onEraseCallout,
  onEraseTextMarkup,
  // UX (2026-07-14, E/P text-bob fix): reports when this page's live erase
  // preview is on screen (true at activation, false when the preview
  // finishes/cancels). PDFViewer uses it to keep the SVG layer presenting in
  // eraser mode until a stroke actually carves — swapping renderers on mere
  // tool switch exposed ±1 device px rasterizer snap differences at
  // fractional zoom stops (the user-visible text bob on E/P toggling).
  onErasePreviewPresentation,
  eraserMode = 'partial',
  eraserSize = 20,
  viewerScale,
  selectedSpaceId,
  activeSpaceId,
  spaces,
  zoomGeneration,
  viewerId,
  documentOwnerId,
}) => {
  const containerRef = useRef(null);
  const cursorRef = useRef(null);
  const onErasePreviewPresentationRef = useRef(onErasePreviewPresentation);
  onErasePreviewPresentationRef.current = onErasePreviewPresentation;
  const livePreviewCanvasRef = useRef(null);
  const livePreviewMaskCanvasRef = useRef(null);
  const livePreviewSourceRef = useRef(null);
  const livePreviewObserverRef = useRef(null);
  const livePreviewHideRafRef = useRef(0);
  // Mask-clone carve preview (2026-07-14): {root, carve, indexHidden}. The
  // live carve renders on a CLONE of the real SVG layer (same engine, same
  // box, same viewBox → bit-identical raster) with a vector mask doing the
  // destination-out. Any bitmap copy — hand-painted OR photographed — hits a
  // rasterization floor (~1% of ink pixels of AA disagreement, measured via
  // agent-cli/diag-photo-fidelity.mjs), so a bitmap handoff always shimmers
  // at stroke start; the clone has no bitmap anywhere and therefore no floor.
  const maskCloneRef = useRef(null);
  const pointerRef = useRef(null);
  const spaceHeldRef = useRef(false);
  // Last known pointer position in CLIENT coordinates (plus pointerType).
  // The wrapper hardcodes cursor:'none', so any window where the custom
  // circle is hidden while the pointer hovers the wrapper leaves the user
  // with NO visible cursor until the next pointermove. This ref lets the
  // hide paths that are not real pointer exits (zoom re-layout, pointer
  // cancel, lost capture) put the circle back under a stationary pointer.
  const lastClientPosRef = useRef(null);
  const eraserDiagGestureRef = useRef(null);
  const initialZoomGenerationRef = useRef(zoomGeneration);

  const annotationsRef = useRef(annotations);
  const calloutsRef = useRef(callouts);
  const onEraseCommitRef = useRef(onEraseCommit);
  const onEraseCalloutRef = useRef(onEraseCallout);
  const onEraseTextMarkupRef = useRef(onEraseTextMarkup);
  const eraserModeRef = useRef(eraserMode);
  const eraserSizeRef = useRef(eraserSize);
  const viewerScaleRef = useRef(viewerScale);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const spacesRef = useRef(spaces);
  const viewerIdRef = useRef(viewerId);
  const documentOwnerIdRef = useRef(documentOwnerId);

  annotationsRef.current = annotations;
  calloutsRef.current = callouts;
  onEraseCommitRef.current = onEraseCommit;
  onEraseCalloutRef.current = onEraseCallout;
  onEraseTextMarkupRef.current = onEraseTextMarkup;
  eraserModeRef.current = eraserMode;
  eraserSizeRef.current = eraserSize;
  viewerScaleRef.current = viewerScale;
  selectedSpaceIdRef.current = selectedSpaceId;
  activeSpaceIdRef.current = activeSpaceId;
  spacesRef.current = spaces;
  viewerIdRef.current = viewerId;
  documentOwnerIdRef.current = documentOwnerId;

  const getPageRadius = useCallback(
    () => eraserDiameterToPageRadius(eraserSizeRef.current),
    [],
  );

  const pagePoint = useCallback((nativeEvent) => {
    const rect = containerRef.current?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((nativeEvent.clientX - rect.left) / rect.width) * pageWidth,
      y: ((nativeEvent.clientY - rect.top) / rect.height) * pageHeight,
    };
  }, [pageHeight, pageWidth]);

  const updateEraserCursor = useCallback((point, visible = true) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const shouldShow = visible && !spaceHeldRef.current && point;
    cursor.style.display = shouldShow ? 'block' : 'none';
    if (!shouldShow) return;
    const displayScale = Math.max(
      0.01,
      Number(viewerScaleRef.current) || 1,
    );
    const diameter = Math.max(1, Number(eraserSizeRef.current) || 20) * displayScale;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate3d(${point.x * displayScale - diameter / 2}px, ${point.y * displayScale - diameter / 2}px, 0)`;
  }, []);

  // Re-show the eraser circle at the last known pointer position, but only
  // when that position is still inside the wrapper (mouse/pen only — touch
  // has no hover cursor, so a re-shown circle would be a phantom). Used by
  // hide paths that do not correspond to the pointer actually leaving:
  // zoom-settle, pointercancel, and lostpointercapture.
  const reshowCursorAtLastClientPos = useCallback(() => {
    const last = lastClientPosRef.current;
    if (!last || last.pointerType === 'touch') {
      updateEraserCursor(null, false);
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect?.();
    const inside = rect && rect.width > 0 && rect.height > 0
      && last.x >= rect.left && last.x <= rect.right
      && last.y >= rect.top && last.y <= rect.bottom;
    if (!inside) {
      updateEraserCursor(null, false);
      return;
    }
    updateEraserCursor(pagePoint({ clientX: last.x, clientY: last.y }), true);
  }, [pagePoint, updateEraserCursor]);

  const findPresentationSource = useCallback(() => {
    const surface = containerRef.current?.closest('[data-annotation-real-surface]');
    const detailSource = surface?.querySelector?.(
      'canvas[data-annotation-detail-active="true"]',
    );
    const source = detailSource || surface?.querySelector?.(
      `canvas[data-annotation-presentation-canvas="${pageNumber}"]`,
    );
    return { surface, source };
  }, [pageNumber]);

  const cancelLivePreviewFinish = useCallback(() => {
    livePreviewObserverRef.current?.disconnect?.();
    livePreviewObserverRef.current = null;
  }, []);

  const cancelScheduledPreviewHide = useCallback(() => {
    if (livePreviewHideRafRef.current) cancelAnimationFrame(livePreviewHideRafRef.current);
    livePreviewHideRafRef.current = 0;
  }, []);

  const hidePreviewCanvasNow = useCallback(() => {
    cancelScheduledPreviewHide();
    const preview = livePreviewCanvasRef.current;
    if (!preview) return;
    preview.getContext('2d')?.clearRect(0, 0, preview.width, preview.height);
    preview.dataset.canvasAnnotationRevision = '';
    preview.style.display = 'none';
  }, [cancelScheduledPreviewHide]);

  const removeMaskCloneNow = useCallback(() => {
    const clone = maskCloneRef.current;
    maskCloneRef.current = null;
    if (clone?.root?.isConnected) clone.root.remove();
  }, []);

  const finishLiveErasePreview = useCallback(() => {
    cancelLivePreviewFinish();
    const sourceState = livePreviewSourceRef.current;
    if (sourceState?.overlay?.isConnected) {
      sourceState.overlay.style.visibility = sourceState.previousVisibility;
    }
    // Defensive twin of the activation-time hide: if React never re-mounted
    // the SVG wrapper (prop unwired), don't leave it invisible forever.
    const svgWrapper = containerRef.current
      ?.closest('[data-annotation-real-surface]')
      ?.querySelector('[data-diag-svg-wrapper]');
    if (svgWrapper) svgWrapper.style.visibility = '';
    const hadSession = Boolean(sourceState);
    const closingClone = maskCloneRef.current;
    maskCloneRef.current = null; // no further carve writes to this session
    livePreviewSourceRef.current = null;
    onErasePreviewPresentationRef.current?.(pageNumber, false);
    if (!hadSession) {
      if (closingClone?.root?.isConnected) closingClone.root.remove();
      hidePreviewCanvasNow();
      return;
    }
    // Hold the carved preview (canvas or mask clone) on screen for two
    // frames: the SVG layer only remounts on the React render that follows
    // the presentation callback above, so tearing down in this same frame
    // would blank every annotation for one frame — a visible blink at each
    // commit.
    cancelScheduledPreviewHide();
    livePreviewHideRafRef.current = requestAnimationFrame(() => {
      livePreviewHideRafRef.current = requestAnimationFrame(() => {
        livePreviewHideRafRef.current = 0;
        if (closingClone?.root?.isConnected) closingClone.root.remove();
        if (livePreviewSourceRef.current) return; // a new gesture took over
        hidePreviewCanvasNow();
      });
    });
  }, [cancelLivePreviewFinish, cancelScheduledPreviewHide, hidePreviewCanvasNow, pageNumber]);

  const beginLiveErasePreview = useCallback(() => {
    cancelLivePreviewFinish();
    cancelScheduledPreviewHide();
    const preview = livePreviewCanvasRef.current;
    const { surface, source } = findPresentationSource();
    const overlay = source?.closest?.('[data-lightweight-annotation-overlay]');
    if (!preview || !surface || !source || !overlay || source.width <= 0 || source.height <= 0) {
      return false;
    }
    const expectedRevision = annotationsRef.current?.eraserPresentationRevision || '';
    const baseline = selectEraserPreviewBaseline({
      expectedRevision,
      sourceRevision: source.dataset.canvasAnnotationRevision || '',
      previewRevision: preview.dataset.canvasAnnotationRevision || '',
      previewVisible: preview.style.display !== 'none' && Boolean(livePreviewSourceRef.current),
    });
    const sourceGeometryKey = [
      source.width,
      source.height,
      source.dataset.canvasDrawScale || '',
      source.dataset.canvasPageOffsetX || '0',
      source.dataset.canvasPageOffsetY || '0',
    ].join(':');
    // Hide the mounted SVG layer synchronously (same imperative pattern as
    // the overlay hide below): the preview's destination-out holes are
    // transparent, so an SVG copy underneath would show un-erased ink through
    // them for the frame(s) until React processes the presentation state.
    const hideSvgForPreview = () => {
      const svgWrapper = surface?.querySelector?.('[data-diag-svg-wrapper]');
      if (svgWrapper) svgWrapper.style.visibility = 'hidden';
      onErasePreviewPresentationRef.current?.(pageNumber, true);
    };
    if (
      baseline === 'preview'
      && livePreviewSourceRef.current
      && preview.dataset.canvasGeometryKey === sourceGeometryKey
    ) {
      livePreviewSourceRef.current.source = source;
      livePreviewSourceRef.current.surface = surface;
      livePreviewSourceRef.current.overlay = overlay;
      preview.style.display = 'block';
      overlay.style.visibility = 'hidden';
      hideSvgForPreview();
      return true;
    }

    const previousSourceState = livePreviewSourceRef.current;
    if (previousSourceState?.overlay?.isConnected) {
      previousSourceState.overlay.style.visibility = previousSourceState.previousVisibility;
    }
    preview.width = source.width;
    preview.height = source.height;
    preview.style.right = 'auto';
    preview.style.bottom = 'auto';
    preview.style.left = source.style.left;
    preview.style.top = source.style.top;
    preview.style.width = source.style.width;
    preview.style.height = source.style.height;
    const context = preview.getContext('2d');
    if (!context) return false;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(source, 0, 0);
    livePreviewSourceRef.current = {
      surface,
      source,
      overlay,
      previousVisibility: overlay.style.visibility,
      paintGeneration: source.dataset.canvasPaintGeneration || '',
    };
    preview.dataset.canvasAnnotationRevision = source.dataset.canvasAnnotationRevision || '';
    preview.dataset.canvasDrawScale = source.dataset.canvasDrawScale || String(source.width / pageWidth);
    preview.dataset.canvasDrawScaleY = source.dataset.canvasDrawScaleY || String(source.height / pageHeight);
    preview.dataset.canvasPageOffsetX = source.dataset.canvasPageOffsetX || '0';
    preview.dataset.canvasPageOffsetY = source.dataset.canvasPageOffsetY || '0';
    preview.dataset.canvasGeometryKey = sourceGeometryKey;
    preview.style.display = 'block';
    overlay.style.visibility = 'hidden';
    hideSvgForPreview();
    return true;
  }, [cancelLivePreviewFinish, cancelScheduledPreviewHide, findPresentationSource, pageHeight, pageNumber, pageWidth]);

  const drawLiveErasePreviewSegment = useCallback((points) => {
    if (!points?.length) return;
    const clone = maskCloneRef.current;
    if (clone?.carve) {
      // Mask-clone mode: carve in PAGE UNITS directly (mask user space).
      const radius = getPageRadius();
      clone.carve.setAttribute('stroke-width', String(radius * 2));
      if (points.length === 1) {
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(points[0].x));
        dot.setAttribute('cy', String(points[0].y));
        dot.setAttribute('r', String(radius));
        dot.setAttribute('fill', '#000');
        clone.mask?.appendChild(dot);
        return;
      }
      let d = clone.carve.getAttribute('d') || '';
      d += ` M ${points[0].x} ${points[0].y}`;
      for (let index = 1; index < points.length; index += 1) {
        d += ` L ${points[index].x} ${points[index].y}`;
      }
      clone.carve.setAttribute('d', d.trim());
      return;
    }
    const preview = livePreviewCanvasRef.current;
    if (!preview || preview.style.display === 'none') return;
    const context = preview.getContext('2d');
    if (!context) return;
    const radius = getPageRadius();
    const drawScale = Number(preview.dataset.canvasDrawScale) || (preview.width / pageWidth);
    const drawScaleY = Number(preview.dataset.canvasDrawScaleY) || drawScale;
    const pageOffsetX = Number(preview.dataset.canvasPageOffsetX) || 0;
    const pageOffsetY = Number(preview.dataset.canvasPageOffsetY) || 0;
    context.save();
    context.setTransform(
      drawScale,
      0,
      0,
      drawScaleY,
      -pageOffsetX * drawScale,
      -pageOffsetY * drawScaleY,
    );
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000';
    context.strokeStyle = '#000';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = radius * 2;
    context.beginPath();
    if (points.length === 1) {
      context.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
      }
      context.stroke();
    }
    context.restore();
  }, [getPageRadius, pageWidth]);

  const eraseAtomicObjectsFromPreview = useCallback((ids) => {
    if (!ids?.length) return;
    const clone = maskCloneRef.current;
    if (clone?.root) {
      // Mask-clone mode: whole-object ghosting = hide the cloned elements
      // outright (display:none) — exact by definition, no silhouette mask.
      // Match by STABLE annotation id first: data-annotation-index is the
      // render-position at clone time and goes stale the moment a commit or
      // remote edit shifts the array (adversarial review finding,
      // 2026-07-15); index is only the fallback for id-less legacy objects.
      const objects = annotationsRef.current?.objects || [];
      for (const id of ids) {
        if (clone.indexHidden.has(id)) continue;
        clone.indexHidden.add(id);
        const index = objects.findIndex((object, i) => getEraserCandidateId(object, i) === id);
        const stableId = index >= 0 ? String(objects[index]?.id || '') : '';
        let targets = [];
        if (stableId && typeof CSS !== 'undefined' && CSS.escape) {
          targets = clone.root.querySelectorAll(`[data-annotation-id="${CSS.escape(stableId)}"]`);
        }
        if (!targets.length && index >= 0) {
          targets = clone.root.querySelectorAll(`[data-annotation-index="${index}"]`);
        }
        targets.forEach((el) => { el.style.display = 'none'; });
      }
      return;
    }
    const preview = livePreviewCanvasRef.current;
    if (!preview || preview.style.display === 'none') return;
    const idSet = new Set(ids);
    // The preview snapshot was painted from presentation-PROJECTED objects
    // (LightweightAnnotationOverlay maps projectPaperInkForPresentation), so
    // the ghost mask must carve the same projected geometry — masking the raw
    // stroked centerline leaves outline slivers of wide ink until the commit
    // repaint.
    const objects = (annotationsRef.current?.objects || []).filter((object, index) => (
      idSet.has(getEraserCandidateId(object, index))
    )).map(projectPaperInkForPresentation);
    if (!objects.length || typeof document === 'undefined') return;
    const mask = livePreviewMaskCanvasRef.current || document.createElement('canvas');
    livePreviewMaskCanvasRef.current = mask;
    mask.width = preview.width;
    mask.height = preview.height;
    const maskContext = mask.getContext('2d');
    const previewContext = preview.getContext('2d');
    if (!maskContext || !previewContext) return;
    const drawScale = Number(preview.dataset.canvasDrawScale) || (preview.width / pageWidth);
    const drawScaleY = Number(preview.dataset.canvasDrawScaleY) || drawScale;
    const pageOffsetX = Number(preview.dataset.canvasPageOffsetX) || 0;
    const pageOffsetY = Number(preview.dataset.canvasPageOffsetY) || 0;
    paintAnnotationCanvas(maskContext, {
      canvasWidth: mask.width,
      canvasHeight: mask.height,
      drawScale,
      drawScaleY,
      displayScale: Math.max(0.01, Number(viewerScaleRef.current) || 1),
      pageWidth,
      pageHeight,
      offsetX: pageOffsetX,
      offsetY: pageOffsetY,
      objects,
    });
    previewContext.save();
    previewContext.setTransform(1, 0, 0, 1, 0, 0);
    previewContext.globalCompositeOperation = 'destination-out';
    previewContext.drawImage(mask, 0, 0);
    previewContext.restore();
  }, [pageHeight, pageWidth]);

  // Flip a pointer's preview live and replay everything stashed while
  // activation was pending (photo decode in flight, or the old
  // presentation-not-painted failure window).
  const activatePointerPreview = useCallback((pointer) => {
    pointer.previewActive = true;
    if (pointer.pendingAtomicIds.size) {
      const stashed = [...pointer.pendingAtomicIds]
        .filter((id) => !pointer.previewAtomicIds.has(id));
      if (stashed.length) {
        eraseAtomicObjectsFromPreview(stashed);
        stashed.forEach((id) => pointer.previewAtomicIds.add(id));
      }
      pointer.pendingAtomicIds.clear();
    }
    if (pointer.pendingPartial && !pointer.previewHasPartial) {
      pointer.previewHasPartial = true;
      pointer.pendingPartial = false;
      drawLiveErasePreviewSegment(pointer.points);
    }
  }, [drawLiveErasePreviewSegment, eraseAtomicObjectsFromPreview]);

  // ROOT FIX for "annotations look different while erasing" (2026-07-14):
  // the live carve renders on a CLONE of the real SVG layer — same engine,
  // same box, same viewBox, so its raster is bit-identical to what was
  // already on screen — with an SVG <mask> playing the destination-out role
  // (white base rect = keep, black round-capped stroke path = carve) and
  // whole-object ghosts hidden via display:none on the cloned elements.
  // Every bitmap alternative was measured and rejected: the hand-painted
  // twin diverges by engine rules at fractional zooms (border rows, glyph
  // snap — the "annotations look different" class), and even a photograph
  // of the SVG (blob-URL <img> drawImage) keeps a ~1%-of-ink-pixels AA
  // disagreement because the isolated image rasterizer anti-aliases
  // differently (measured in agent-cli/diag-photo-fidelity.mjs; phase
  // baking/snapping did not move it). The clone is also synchronous — no
  // decode wait, no canvas tainting. Carve coordinates are PAGE UNITS
  // straight from the pointer (the mask lives in the clone's user space),
  // so there is no transform to disagree with anything.
  const beginMaskClonePreview = useCallback(() => {
    if (maskCloneRef.current?.root?.isConnected) {
      // Continuing session (back-to-back strokes inside the previous
      // stroke's commit-wait window). CRITICAL: kill the previous stroke's
      // pending finish observer + deferred teardown, or its belated
      // callback rips this stroke's shared clone out mid-drag (adversarial
      // review finding, 2026-07-15).
      cancelLivePreviewFinish();
      cancelScheduledPreviewHide();
      return true;
    }
    cancelLivePreviewFinish();
    cancelScheduledPreviewHide();
    const surface = containerRef.current?.closest('[data-annotation-real-surface]');
    const wrapper = surface?.querySelector('[data-diag-svg-wrapper]');
    const svg = wrapper?.querySelector('svg[data-svg-annotation-layer]');
    if (!surface || !wrapper || !svg) return false;
    // Orphan sweep: a half-built clone from any earlier failure must never
    // survive into a new session (it would double-render under the preview).
    surface.querySelectorAll('[data-eraser-mask-clone]').forEach((el) => el.remove());
    let cloneRoot = null;
    let carve = null;
    let maskEl = null;
    try {
      const SVG_NS = 'http://www.w3.org/2000/svg';
      cloneRoot = svg.cloneNode(true);
      // The clone must never masquerade as the real layer for selectors,
      // diagnostics, or harnesses.
      cloneRoot.removeAttribute('data-svg-annotation-layer');
      cloneRoot.setAttribute('data-eraser-mask-clone', String(pageNumber));
      cloneRoot.setAttribute('aria-hidden', 'true');
      const group = document.createElementNS(SVG_NS, 'g');
      while (cloneRoot.firstChild) group.appendChild(cloneRoot.firstChild);
      const defs = document.createElementNS(SVG_NS, 'defs');
      const mask = document.createElementNS(SVG_NS, 'mask');
      const maskId = `eraser-carve-mask-${pageNumber}-${Date.now().toString(36)}`;
      mask.setAttribute('id', maskId);
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      // Region padded well past the page: the mask CLIPS its own content, so
      // a page-bounds region would truncate carve circles at the page edge
      // (the canvas destination-out never clipped there).
      mask.setAttribute('x', '-256');
      mask.setAttribute('y', '-256');
      mask.setAttribute('width', String(pageWidth + 512));
      mask.setAttribute('height', String(pageHeight + 512));
      const keep = document.createElementNS(SVG_NS, 'rect');
      keep.setAttribute('x', '0');
      keep.setAttribute('y', '0');
      keep.setAttribute('width', String(pageWidth));
      keep.setAttribute('height', String(pageHeight));
      keep.setAttribute('fill', '#fff');
      carve = document.createElementNS(SVG_NS, 'path');
      carve.setAttribute('d', '');
      carve.setAttribute('fill', 'none');
      carve.setAttribute('stroke', '#000');
      carve.setAttribute('stroke-linecap', 'round');
      carve.setAttribute('stroke-linejoin', 'round');
      mask.appendChild(keep);
      mask.appendChild(carve);
      defs.appendChild(mask);
      maskEl = mask;
      group.setAttribute('mask', `url(#${maskId})`);
      // Known bounded residual (measured 2026-07-15,
      // agent-cli/diag-multiply-during-erase.mjs): the masked group is an
      // isolated blend context, so mix-blend-mode:multiply content
      // (highlighter, survey-marker highlight) tints against the clone's own
      // backdrop instead of the PDF page WHILE a stroke is active (~2.8% of
      // the highlight's pixels shift subtly, restored at release). Strictly
      // smaller than the old bitmap path, which flattened multiply the whole
      // time eraser mode was on. Do not "fix" by unwrapping multiply
      // elements — that reorders paint and looks worse.
      cloneRoot.appendChild(defs);
      cloneRoot.appendChild(group);
      cloneRoot.style.position = 'absolute';
      cloneRoot.style.inset = '0';
      cloneRoot.style.width = '100%';
      cloneRoot.style.height = '100%';
      cloneRoot.style.zIndex = '100'; // same stacking as the SVG wrapper it replaces
      cloneRoot.style.pointerEvents = 'none';
      cloneRoot.style.visibility = 'visible';
      surface.appendChild(cloneRoot);
    } catch {
      if (cloneRoot?.isConnected) cloneRoot.remove();
      return false;
    }
    wrapper.style.visibility = 'hidden';
    onErasePreviewPresentationRef.current?.(pageNumber, true);
    maskCloneRef.current = { root: cloneRoot, carve, mask: maskEl, indexHidden: new Set() };
    // Non-null session state so the commit-repaint finish gate engages; the
    // warm painted canvas still carries the revision/paint-generation
    // handshake datasets even though it never becomes visible in this mode.
    const { source } = findPresentationSource();
    livePreviewSourceRef.current = {
      surface,
      source: source || null,
      overlay: null,
      previousVisibility: '',
      maskClone: true,
      paintGeneration: source?.dataset?.canvasPaintGeneration || '',
    };
    return true;
  }, [cancelLivePreviewFinish, cancelScheduledPreviewHide, findPresentationSource, pageNumber, pageHeight, pageWidth]);

  const scheduleLiveErasePreviewFinish = useCallback(({ expectedRevision, waitForNextPaint }) => {
    const sourceState = livePreviewSourceRef.current;
    if (!sourceState || (!expectedRevision && !waitForNextPaint)) {
      finishLiveErasePreview();
      return;
    }
    const check = () => {
      const state = livePreviewSourceRef.current;
      if (!state) return true;
      const currentSource = findPresentationSource().source;
      if (!currentSource) {
        finishLiveErasePreview();
        return true;
      }
      state.source = currentSource;
      const canvasAnnotationRevision = currentSource.dataset.canvasAnnotationRevision || '';
      const paintGeneration = currentSource.dataset.canvasPaintGeneration || '';
      if (
        (expectedRevision && canvasAnnotationRevision === expectedRevision)
        || (!expectedRevision && waitForNextPaint && paintGeneration !== state.paintGeneration)
      ) {
        finishLiveErasePreview();
        return true;
      }
      return false;
    };
    cancelLivePreviewFinish();
    const observer = new MutationObserver(check);
    livePreviewObserverRef.current = observer;
    observer.observe(sourceState.surface, {
      attributes: true,
      subtree: true,
      attributeFilter: [
        'data-canvas-annotation-revision',
        'data-canvas-paint-generation',
        'data-annotation-detail-active',
      ],
    });
    check();
  }, [cancelLivePreviewFinish, findPresentationSource, finishLiveErasePreview]);

  const getSpaceIdForRegion = useCallback((regionId) => {
    if (!regionId) return null;
    for (const space of Array.isArray(spacesRef.current) ? spacesRef.current : []) {
      for (const page of Array.isArray(space?.assignedPages) ? space.assignedPages : []) {
        const match = (Array.isArray(page?.regions) ? page.regions : [])
          .find((region) => region?.regionId === regionId);
        if (match) return space.id;
      }
    }
    return null;
  }, []);

  const getEraseBlockReason = useCallback((object) => {
    const currentViewerId = viewerIdRef.current;
    const currentOwnerId = documentOwnerIdRef.current;
    if (currentViewerId && currentOwnerId && !canModify({
      annotation: object,
      viewerId: currentViewerId,
      documentOwnerId: currentOwnerId,
    })) return 'permission';

    const objectSpaceId = object?.spaceId ?? null;
    const objectRegionId = object?.regionId ?? null;
    if (activeSpaceIdRef.current !== null && activeSpaceIdRef.current !== undefined) {
      if (objectRegionId !== null) {
        const derivedSpaceId = getSpaceIdForRegion(objectRegionId);
        if (derivedSpaceId !== null && derivedSpaceId !== activeSpaceIdRef.current) return 'space-scope';
      } else if (objectSpaceId !== null) {
        if (objectSpaceId !== activeSpaceIdRef.current) return 'space-scope';
      } else {
        return 'space-scope';
      }
    } else if (
      selectedSpaceIdRef.current !== null
      && selectedSpaceIdRef.current !== undefined
      && objectSpaceId !== null
      && objectSpaceId !== selectedSpaceIdRef.current
    ) {
      return 'space-scope';
    }
    return null;
  }, [getSpaceIdForRegion]);

  // Cheap per-segment ghost check for whole-delete NON-PATH objects (stamps,
  // rects, text). Uses the exact bounds test the commit engine uses for these
  // objects, so preview ghosting can never disagree with the commit — and no
  // polygon expansion runs. Full-policy PATH objects are deliberately not
  // checked here (a bounds test would false-positive and ghost objects the
  // commit keeps); they still ghost via the plan path before carving starts.
  const ghostAtomicNonPathHits = useCallback((pointer, segmentPoints) => {
    if (!segmentPoints?.length) return;
    const objects = annotationsRef.current?.objects || [];
    const radius = getPageRadius();
    const hitIds = [];
    objects.forEach((object, index) => {
      if (String(object?.type || '').toLowerCase() === 'path') return;
      const id = getEraserCandidateId(object, index);
      if (pointer.previewAtomicIds.has(id)) return;
      if (getEraseBlockReason(object)) return;
      if (!eraserStrokeTouchesObject({
        eraserPoints: segmentPoints,
        eraserRadius: radius,
        object,
      })) return;
      hitIds.push(id);
    });
    if (hitIds.length) {
      eraseAtomicObjectsFromPreview(hitIds);
      hitIds.forEach((id) => pointer.previewAtomicIds.add(id));
    }
  }, [eraseAtomicObjectsFromPreview, getEraseBlockReason, getPageRadius]);

  const previewEraserGesture = useCallback((pointer, segment) => {
    if (!pointer?.points?.length) return false;
    if (pointer.previewActive && pointer.previewHasPartial) {
      // Carving is live: O(1) punch of the new segment, plus the cheap
      // non-path ghost check so whole-delete objects crossed mid-carve still
      // vanish live instead of popping out only at release.
      drawLiveErasePreviewSegment(segment);
      ghostAtomicNonPathHits(pointer, segment);
      return true;
    }
    // Pre-carve phase plans only the NEW segment: earlier segments were
    // already planned by earlier calls (their atomic hits accumulate in
    // previewAtomicIds), so per-sample cost stays flat instead of re-running
    // the boolean erase engine over the whole gesture path every pointermove.
    const plan = planPageEraserPreview({
      pageAnnotations: annotationsRef.current || { objects: [] },
      eraserPoints: segment?.length ? segment : pointer.points,
      eraserRadius: getPageRadius(),
      mode: eraserModeRef.current,
      canErase: (object) => !getEraseBlockReason(object),
    });
    if (!plan.shouldPreview) return false;
    if (!pointer.previewActive) {
      // Mask-clone first (bit-identical, synchronous); the painted-canvas
      // copy only serves the exotic failure path (SVG missing mid-swap).
      if (beginMaskClonePreview()) {
        console.log(`[EraserCarveDiag] page=${pageNumber} base=svg-mask-clone`);
        activatePointerPreview(pointer);
      } else if (beginLiveErasePreview()) {
        console.log(`[EraserCarveDiag] page=${pageNumber} base=painted-fallback`);
        activatePointerPreview(pointer);
      } else {
        // Activation can legitimately fail (presentation canvas not painted
        // yet, page mid-swap). Stash this segment's outcome so the first
        // successful activation replays it — otherwise a hit inside the
        // failure window would never carve/ghost for the rest of the gesture.
        pointer.pendingPartial = pointer.pendingPartial || plan.partialIds.length > 0;
        plan.atomicIds.forEach((id) => pointer.pendingAtomicIds.add(id));
        return false;
      }
    }
    if (!pointer.previewHasPartial && (plan.partialIds.length > 0 || pointer.pendingPartial)) {
      // UX: ink carving must appear the moment the eraser first touches
      // erasable ink — even when the gesture began on a whole-delete object
      // (previously the gesture never upgraded and the carve stayed invisible
      // until release). Punch the accumulated path once, then every later
      // sample takes the cheap per-segment punch above — demo-parity feel.
      // Known preview approximation (self-corrects at commit): the punch is a
      // blind destination-out over the flat snapshot, so path stretches over
      // blocked/whole-delete content carve visually until the commit repaint.
      pointer.previewHasPartial = true;
      pointer.pendingPartial = false;
      drawLiveErasePreviewSegment(pointer.points);
    }
    const newAtomicIds = plan.atomicIds.filter((id) => !pointer.previewAtomicIds.has(id));
    if (newAtomicIds.length) {
      eraseAtomicObjectsFromPreview(newAtomicIds);
      newAtomicIds.forEach((id) => pointer.previewAtomicIds.add(id));
    }
    return true;
  }, [
    activatePointerPreview,
    beginLiveErasePreview,
    beginMaskClonePreview,
    drawLiveErasePreviewSegment,
    eraseAtomicObjectsFromPreview,
    getEraseBlockReason,
    getPageRadius,
    ghostAtomicNonPathHits,
    pageNumber,
  ]);

  const applyEraserAndCommit = useCallback((eraserPoints) => {
    if (!eraserPoints?.length) return { didPaint: false, expectedRevision: null };
    const latestPage = annotationsRef.current || { objects: [] };
    const radius = getPageRadius();
    const rejectedById = new Map();
    const canErase = (object, index) => {
      const reason = getEraseBlockReason(object);
      if (reason) {
        const id = object?.id || object?.annotationId || object?.pdfAnnotationId || `index:${index}`;
        rejectedById.set(id, { id, reason });
      }
      return !reason;
    };
    const result = erasePageAnnotations({
      pageAnnotations: latestPage,
      eraserPoints,
      eraserRadius: radius,
      mode: eraserModeRef.current,
      canErase,
    });

    const legacyCallouts = (latestPage.objects || [])
      .map((object) => getLegacyCalloutPayload(object, pageNumber))
      .filter(Boolean);
    const calloutHitIds = getCalloutHitIds({
      callouts: [...(Array.isArray(calloutsRef.current) ? calloutsRef.current : []), ...legacyCallouts],
      pageNumber,
      pageWidth,
      pageHeight,
      eraserPoints,
      eraserRadius: radius,
    });

    let expectedRevision = null;
    if (result.didChange) {
      presentationRevisionSequence += 1;
      expectedRevision = `eraser:${Date.now().toString(36)}:${presentationRevisionSequence}`;
      const updatedJSON = {
        ...result.pageAnnotations,
        eraserPresentationRevision: expectedRevision,
      };
      const diagnostics = {
        source: 'eraser:commit',
        tool: 'eraser',
        action: 'eraser:apply',
        eraserGestureId: eraserDiagGestureRef.current || null,
        eraserPointerBounds: getEraserStrokeBounds(eraserPoints, radius),
        candidateAnnotationIds: result.touchedIds,
        rejectedAnnotations: [...rejectedById.values()],
        touchedAnnotationIds: result.touchedIds,
        finalDeletedAnnotationIds: result.deletedIds,
        finalChangedAnnotationIds: result.changedIds,
        objectDelta: updatedJSON.objects.length - (latestPage.objects?.length || 0),
        changedObjectsCount: result.deletedIds.length + result.changedIds.length,
      };
      annotationsRef.current = updatedJSON;
      if (livePreviewCanvasRef.current?.style.display !== 'none') {
        livePreviewCanvasRef.current.dataset.canvasAnnotationRevision = expectedRevision;
      }
      const commitStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        onEraseCommitRef.current?.(updatedJSON, diagnostics);
      } catch (error) {
        annotationsRef.current = latestPage;
        console.error('Eraser commit failed:', error);
        expectedRevision = null;
      } finally {
        const commitEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (containerRef.current) {
          containerRef.current.dataset.eraserCommitMs = String(
            Math.round((commitEndedAt - commitStartedAt) * 10) / 10,
          );
        }
      }
    }

    if (calloutHitIds.length) {
      try {
        onEraseCalloutRef.current?.(calloutHitIds);
      } catch (error) {
        console.error('Callout erase failed:', error);
      }
    }
    try {
      onEraseTextMarkupRef.current?.(pageNumber, eraserPoints, radius);
    } catch (error) {
      console.error('Text markup erase failed:', error);
    }

    return {
      didPaint: result.didChange || calloutHitIds.length > 0,
      expectedRevision,
    };
  }, [getEraseBlockReason, getPageRadius, pageHeight, pageNumber, pageWidth]);

  const cancelPointer = useCallback(() => {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    try { pointer?.captureTarget?.releasePointerCapture(pointer.pointerId); } catch { /* already released */ }
    finishLiveErasePreview();
  }, [finishLiveErasePreview]);

  const handlePointerDown = useCallback((event) => {
    lastClientPosRef.current = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
    if (event.button !== 0 || spaceHeldRef.current) return;
    if (pointerRef.current) cancelPointer();
    const point = pagePoint(event.nativeEvent);
    if (!point) return;
    updateEraserCursor(point, true);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      pointerId: event.pointerId,
      points: [point],
      captureTarget: event.currentTarget,
      previewActive: false,
      previewHasPartial: false,
      previewAtomicIds: new Set(),
      pendingPartial: false,
      pendingAtomicIds: new Set(),
    };
    eraserDiagGestureRef.current = beginAnnotationGesture({
      surface: 'FabricEraserCanvas',
      tool: 'eraser',
      type: 'annotation',
      action: 'eraser-stroke',
      pointerDown: true,
      pageNumber,
    });
    previewEraserGesture(pointerRef.current, [point]);
  }, [
    cancelPointer,
    pageNumber,
    pagePoint,
    previewEraserGesture,
    updateEraserCursor,
  ]);

  const handlePointerMove = useCallback((event) => {
    lastClientPosRef.current = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
    const point = pagePoint(event.nativeEvent);
    updateEraserCursor(point, true);
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (event.buttons === 0) {
      cancelPointer();
      return;
    }
    event.preventDefault();
    markAnnotationPreviewFrame(eraserDiagGestureRef.current, { action: 'eraser-stroke' });
    const nativeEvents = getCoalescedOrCurrentEvents(event.nativeEvent);
    for (const nativeEvent of nativeEvents) {
      const point = pagePoint(nativeEvent);
      const last = pointer.points[pointer.points.length - 1];
      if (point && (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.2)) {
        pointer.points.push(point);
        previewEraserGesture(pointer, last ? [last, point] : [point]);
      }
    }
  }, [cancelPointer, pagePoint, previewEraserGesture, updateEraserCursor]);

  const finishPointer = useCallback((event, cancelled) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (cancelled) {
      finishLiveErasePreview();
      // Not a real pointer exit: if the pointer still hovers the wrapper the
      // native cursor is 'none', so hiding the circle here would leave no
      // visible cursor until the next move. Re-show at the last known spot.
      reshowCursorAtLastClientPos();
      return;
    }
    event.preventDefault();
    const releasePoint = pagePoint(event.nativeEvent);
    const lastPoint = pointer.points[pointer.points.length - 1];
    if (
      releasePoint
      && (!lastPoint || Math.hypot(releasePoint.x - lastPoint.x, releasePoint.y - lastPoint.y) >= 0.2)
    ) {
      pointer.points.push(releasePoint);
      previewEraserGesture(pointer, lastPoint ? [lastPoint, releasePoint] : [releasePoint]);
    }
    updateEraserCursor(releasePoint, true);
    markAnnotationPointerRelease(eraserDiagGestureRef.current, { action: 'eraser-stroke' });
    const outcome = applyEraserAndCommit(pointer.points);
    scheduleLiveErasePreviewFinish({
      expectedRevision: outcome.expectedRevision,
      waitForNextPaint: outcome.didPaint,
    });
  }, [
    applyEraserAndCommit,
    finishLiveErasePreview,
    pagePoint,
    previewEraserGesture,
    reshowCursorAtLastClientPos,
    scheduleLiveErasePreviewFinish,
    updateEraserCursor,
  ]);

  const handleLostPointerCapture = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    cancelPointer();
    // Same reasoning as the cancelled branch of finishPointer: losing capture
    // does not mean the pointer left the wrapper — keep a visible cursor.
    reshowCursorAtLastClientPos();
  }, [cancelPointer, reshowCursorAtLastClientPos]);

  const commitPointerForZoom = useCallback(() => {
    const pointer = pointerRef.current;
    if (!pointer) {
      // Pointer-less bumps (zoom while idle, settle, watchdog): tear down any
      // preview handoff still waiting on its commit repaint, exactly like the
      // old cancel path did — otherwise a frozen old-scale snapshot rides the
      // zoom re-layout until the observer fires.
      finishLiveErasePreview();
      return;
    }
    pointerRef.current = null;
    try { pointer.captureTarget?.releasePointerCapture(pointer.pointerId); } catch { /* already released */ }
    // This runs inside a React effect, not a DOM event handler: a geometry
    // engine throw here would escape to the error boundary and unmount the
    // viewer mid-zoom. Degrade to the old cancel behavior instead.
    try {
      markAnnotationPointerRelease(eraserDiagGestureRef.current, { action: 'eraser-stroke' });
      const outcome = applyEraserAndCommit(pointer.points);
      scheduleLiveErasePreviewFinish({
        expectedRevision: outcome.expectedRevision,
        waitForNextPaint: outcome.didPaint,
      });
    } catch (error) {
      console.error('Zoom-triggered eraser commit failed:', error);
      finishLiveErasePreview();
    }
  }, [applyEraserAndCommit, finishLiveErasePreview, scheduleLiveErasePreviewFinish]);

  useEffect(() => {
    if (zoomGeneration === initialZoomGenerationRef.current) return;
    initialZoomGenerationRef.current = zoomGeneration;
    // UX: zoom starting mid-swipe COMMITS the partial erase instead of
    // discarding it — the zoomGeneration contract's intent (and
    // FabricDrawingCanvas's behavior) is auto-commit before the host
    // re-layouts; a cancel here silently threw away the user's erase.
    commitPointerForZoom();
    updateEraserCursor(null, false);
    // Cursor-visibility fix: the hide above plus the wrapper's cursor:'none'
    // means a stationary pointer has NO visible cursor from zoom-start until
    // the next pointermove. Re-show the circle once the zoom re-layout lands:
    // primary signal is the wrapper's actual resize (fresh rect at that
    // moment, so placement is exact); the timeout is a fallback for clamped
    // zooms where zoomGeneration bumped but the size never changes.
    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      let sawInitialObservation = false;
      observer = new ResizeObserver(() => {
        // observe() always delivers one immediate notification with the
        // CURRENT size — the real zoom re-layout is the next one.
        if (!sawInitialObservation) {
          sawInitialObservation = true;
          return;
        }
        observer.disconnect();
        reshowCursorAtLastClientPos();
      });
      observer.observe(containerRef.current);
    }
    const reshowFallbackTimer = setTimeout(reshowCursorAtLastClientPos, 400);
    return () => {
      observer?.disconnect();
      clearTimeout(reshowFallbackTimer);
    };
  }, [commitPointerForZoom, reshowCursorAtLastClientPos, updateEraserCursor, zoomGeneration]);

  useEffect(() => {
    const isSpaceKey = (event) => event.code === 'Space' || event.key === ' ';
    const activateSpacePan = (event) => {
      if (!isSpaceKey(event)) return;
      spaceHeldRef.current = true;
      cancelPointer();
      updateEraserCursor(null, false);
    };
    const releaseSpacePan = (event) => {
      if (event && !isSpaceKey(event)) return;
      spaceHeldRef.current = false;
    };
    // Window blur must ALWAYS release the space-pan latch (the keyup is lost
    // to the other window). Passing the FocusEvent into releaseSpacePan used
    // to trip its isSpaceKey guard and leave spaceHeldRef stuck true — the
    // circle could then never re-show (wrapper cursor is 'none' → no visible
    // cursor at all) until space was pressed and released again.
    const releaseSpacePanOnBlur = () => releaseSpacePan(null);
    window.addEventListener('keydown', activateSpacePan, true);
    window.addEventListener('keyup', releaseSpacePan, true);
    window.addEventListener('blur', releaseSpacePanOnBlur);
    return () => {
      window.removeEventListener('keydown', activateSpacePan, true);
      window.removeEventListener('keyup', releaseSpacePan, true);
      window.removeEventListener('blur', releaseSpacePanOnBlur);
    };
  }, [cancelPointer, updateEraserCursor]);

  useEffect(() => () => {
    pointerRef.current = null;
    // Unmounting — no SVG remount to wait for; tear down the mask clone and
    // preview canvas now instead of leaving the deferred double-rAF cleanup
    // to fire on detached nodes.
    removeMaskCloneNow();
    finishLiveErasePreview();
    hidePreviewCanvasNow();
    updateEraserCursor(null, false);
  }, [finishLiveErasePreview, hidePreviewCanvasNow, removeMaskCloneNow, updateEraserCursor]);

  return (
    <div
      ref={containerRef}
      data-diag-eraser-wrapper={pageNumber}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishPointer(event, false)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerEnter={(event) => {
        lastClientPosRef.current = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
        updateEraserCursor(pagePoint(event.nativeEvent), true);
      }}
      onPointerLeave={() => {
        // A real exit: forget the position so no later re-show path (zoom
        // settle, cancel, lost capture) resurrects a phantom circle.
        lastClientPosRef.current = null;
        updateEraserCursor(null, false);
      }}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        touchAction: 'none',
        zIndex: 101,
        cursor: 'none',
      }}
    >
      <canvas
        ref={livePreviewCanvasRef}
        data-eraser-live-preview={pageNumber}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          display: 'none',
          pointerEvents: 'none',
        }}
      />
      <div
        ref={cursorRef}
        data-eraser-cursor="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'none',
          boxSizing: 'border-box',
          border: '1px solid rgba(17, 24, 39, 0.9)',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.18)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.72)',
          pointerEvents: 'none',
          willChange: 'transform',
        }}
      />
    </div>
  );
});

FabricEraserCanvas.displayName = 'FabricEraserCanvas';

export default FabricEraserCanvas;
