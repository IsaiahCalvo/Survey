/**
 * Page-space eraser interaction surface.
 *
 * The persisted page JSON is the only annotation model. The transparent
 * surface captures a gesture, previews it in pixels, then applies the same
 * immutable geometry engine used by the PDF.js feature demo to the latest JSON.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { trackPendingEraseCommit } from '../utils/pendingEraseCommits.js';
import { calculateCalloutConnection } from '../utils/calloutGeometry';
import { isPointOnObject } from '../utils/geometryHitTest.js';
import { canModify } from '../lib/collab/permissionScope.js';
import { isAnnotationVisibleInSurveyMode } from '../utils/annotationVisibilityRules.js';
import {
  beginAnnotationGesture,
  markAnnotationPointerRelease,
  markAnnotationPreviewFrame,
} from '../utils/annotationPreviewDiag';
import {
  buildTextInkHitLayout,
  eraserPointTouchesText,
  eraserStrokeTouchesObject,
  getEraserStrokeBounds,
  getEraserCandidateId,
  sampleEraserStroke,
} from '../utils/eraserHitTest.js';
import {
  erasePageAnnotations,
  pathObjectToPagePolygons,
} from '../utils/pageSpaceEraser.js';
import {
  BOUNDS_PAD,
  CALLOUT_BOUNDS_PAD,
  boundsIntersect,
  inflateBounds,
  objectStrokeInflation,
  segmentQueryBounds,
} from '../utils/eraserBoundsPrefilter.js';
import { getEraserOperation } from '../utils/eraserPolicy.js';
import { eraserDiameterToPageRadius } from '../utils/eraserSizing.js';
import { nextEraserMutationId } from '../utils/eraserMutationId.js';
import {
  applyLocalCalloutEraseTargets,
  buildEraseIntent,
  buildLocalCalloutEraseMutations,
  buildPageEraseTargets,
  classifyEraseObjectKind,
  createEraseStorageKeyResolver,
  getEraseObjectId,
} from '../utils/annotationEraseTransaction.js';
import {
  ERASER_PREVIEW_HANDOFF_BOUND_MS,
  isEraserPreviewFinishReady,
  nextEraserPreviewHandoffState,
  selectEraserPreviewBaseline,
} from '../utils/eraserPreviewHandoff.js';
import { getCoalescedOrCurrentEvents } from '../utils/eraserPointerSamples.js';
import { paintAnnotationCanvas } from '../utils/annotationCanvasPainter.js';
import { projectPaperInkForPresentation } from '../utils/paperInkPresentation.js';
import {
  collectAtomicEraseAuditTargets,
  isAtomicEraseGeometryAuditEnabled,
  recordAtomicEraseDiagnostic,
  updateAtomicEraseDiagnostic,
} from '../utils/atomicEraseDiagnostics.js';
import {
  getSurveyMarkerEraserHitIds,
  surveyMarkerToEraserObject,
} from '../utils/surveyMarkerEraser.js';

const getEraserHandoffTestFlags = () => (
  import.meta.env.DEV
  && typeof window !== 'undefined'
  && window.__eraserHandoffTest
    ? window.__eraserHandoffTest
    : null
);

const MAX_NATIVE_ERASER_CURSOR_DIAMETER = 120;

const planPageEraseLocally = (args, blockedByIndex = []) => {
  const rejectedAnnotations = [];
  const result = erasePageAnnotations({
    ...args,
    canErase: (_object, index) => {
      const blocked = blockedByIndex[index];
      if (blocked) rejectedAnnotations.push(blocked);
      return !blocked;
    },
  });
  return { ...result, rejectedAnnotations };
};

function nativeEraserCursor(diameter) {
  const size = Math.max(4, Math.round(Number(diameter) || 20));
  if (size > MAX_NATIVE_ERASER_CURSOR_DIAMETER) return null;
  const center = size / 2;
  const radius = Math.max(1, center - 2);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="rgba(255,255,255,0.18)" stroke="white" stroke-width="3"/>`,
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="rgba(17,24,39,0.9)" stroke-width="1"/>`,
    '</svg>',
  ].join('');
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.floor(center)} ${Math.floor(center)}, crosshair`;
}

// Keep live mask reparsing independent of gesture length. A growing `d`
// rewritten on every pointermove makes the browser repeatedly parse the whole
// held gesture (quadratic total work). Completed chunks are immutable; the
// next chunk repeats the previous endpoint so round joins stay gap-free.
const LIVE_ERASE_PREVIEW_CHUNK_POINT_LIMIT = 32;

const samePreviewPoint = (left, right) => (
  left?.x === right?.x && left?.y === right?.y
);

const canDropPreviewMiddlePoint = (start, middle, end) => {
  const firstX = middle.x - start.x;
  const firstY = middle.y - start.y;
  const secondX = end.x - middle.x;
  const secondY = end.y - middle.y;
  // Exact collinearity plus forward travel preserves the swept round-capped
  // segment exactly. Backtracking points stay because they can change coverage.
  return (
    firstX * secondY === firstY * secondX
    && firstX * secondX + firstY * secondY >= 0
  );
};

const previewPathData = (points) => points.map((point, index) => (
  `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
)).join(' ');

const createLiveErasePreviewPath = (mask, radius, chunkIndex) => {
  const path = mask.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', '');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#000');
  path.setAttribute('stroke-width', String(radius * 2));
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('data-eraser-carve-chunk', String(chunkIndex));
  mask.appendChild(path);
  return path;
};

// An SVG clone shares the document-wide fragment-id namespace with its source.
// Imported ink can already contain clip paths after one partial erase, so an
// unchanged clone would duplicate those ids. Chromium may then resolve the
// visible clone's url(#clip) against the hidden real SVG, briefly blanking the
// stroke. Namespace every cloned id and its local references before insertion.
const namespaceSvgCloneFragmentIds = (cloneRoot, namespace) => {
  if (!cloneRoot || !namespace) return;
  const elements = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
  const idMap = new Map();
  elements.forEach((element) => {
    const id = element.getAttribute?.('id');
    if (!id) return;
    const namespacedId = `${namespace}-${id}`;
    idMap.set(id, namespacedId);
    element.setAttribute('id', namespacedId);
  });
  if (idMap.size === 0) return;

  const rewriteUrl = (value) => String(value).replace(
    /url\(\s*(['"]?)#([^)'" \t\r\n]+)\1\s*\)/g,
    (match, _quote, id) => (
      idMap.has(id) ? `url(#${idMap.get(id)})` : match
    ),
  );
  elements.forEach((element) => {
    [...(element.attributes || [])].forEach((attribute) => {
      let nextValue = rewriteUrl(attribute.value);
      if (nextValue.startsWith('#') && idMap.has(nextValue.slice(1))) {
        nextValue = `#${idMap.get(nextValue.slice(1))}`;
      }
      if (nextValue !== attribute.value) {
        element.setAttribute(attribute.name, nextValue);
      }
    });
  });
};

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

// --- Eraser hot-path AABB prefilter (2026-07-19, KAL-366 smoothness) -------
// A single pointer-move segment overlaps only a handful of a busy page's
// annotations, yet the old per-move preview ran the full boolean-carve engine
// (planPageEraserPreview) AND a per-object stroke hit-test over EVERY object on
// EVERY move — measured ~12ms/move (~24ms/frame with coalesced input) on a
// heavy page of dense/imported ink, which drops frames and is the drag lag. We
// snapshot each annotation's exact page-unit bounds once at pointer-down
// (browser getBBox on the live SVG layer, which is already in page units) and
// gate the expensive identification behind a cheap AABB overlap test. The
// filter can only ever FAST-REJECT objects nowhere near the cursor; anything
// that might touch still runs the identical hit-test, so preview and commit
// cannot disagree. No cached bounds for an object => never reject (conservative).
//
// CONSISTENCY FIX (2026-07-19): getBBox excludes stroke, so cached bounds must
// be inflated by each object's stroke half-width to stay a true superset of the
// hit test's `strokeWidth/2 + radius` reach — otherwise a swipe near the edge of
// a wide imported-ink stroke was fast-rejected and never carved live (the
// intermittent "doesn't take" the speedup introduced). The prefilter geometry
// now lives in eraserBoundsPrefilter.js so the superset invariant is unit-tested.

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
    // Owner ruling 2026-09-02 ("must touch the ink"): the callout box counts
    // only on its frame (or fill) or its text — a stroke running beside the
    // box or through its empty interior leaves the callout alone.
    const calloutFontSize = Number(callout.style?.fontSize || 12);
    const frameObject = {
      type: 'rect',
      left: textBox.x,
      top: textBox.y,
      width: textBox.width,
      height: textBox.height,
      fill: callout.style?.fillColor || 'transparent',
      stroke: callout.style?.borderColor || callout.style?.lineColor || '#1e293b',
      strokeWidth: Math.max(1, Number(callout.style?.lineThickness || 2)),
    };
    const textObject = {
      type: 'textbox',
      left: textBox.x,
      top: textBox.y,
      width: textBox.width,
      height: textBox.height,
      text: callout.text || '',
      fontSize: calloutFontSize,
      fontFamily: callout.style?.fontFamily || 'Helvetica',
      fontWeight: callout.style?.bold ? 'bold' : 'normal',
      fontStyle: callout.style?.italic ? 'italic' : 'normal',
      textAlign: callout.style?.textAlign || 'left',
      lineHeight: callout.style?.lineHeight || 1,
      calloutText: true,
    };
    const textLayout = buildTextInkHitLayout(textObject);
    const hit = samples.some((point) => (
      isPointOnObject(point, frameObject, eraserRadius)
      || eraserPointTouchesText(point, textObject, eraserRadius, textLayout)
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
  surveyMarkers = [],
  onEraseIntent,
  onEraseCommit,
  onEraseFlush = (commit) => commit(),
  onEraseSurveyMarker,
  renderer = 'svg',
  canEraseSurveyMarker,
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
  // KAL-89 — live survey-mode context for the classify gate: what survey mode
  // hides, the eraser must not touch (see getEraseBlockReason).
  showSurveyPanel = false,
  selectedModuleId = null,
  zoomGeneration,
  // Parent-owned lifecycle reason. `cancel` is reserved for authorization
  // loss/read-only transitions; ordinary tool/page unmounts keep `commit`.
  interruptionPolicy = 'commit',
  interruptionPolicyRef: parentInterruptionPolicyRef,
  viewerId,
  documentOwnerId,
  isLocalOnlyDocument = false,
}) => {
  const containerRef = useRef(null);
  const cursorRef = useRef(null);
  const onErasePreviewPresentationRef = useRef(onErasePreviewPresentation);
  onErasePreviewPresentationRef.current = onErasePreviewPresentation;
  const livePreviewCanvasRef = useRef(null);
  const livePreviewMaskCanvasRef = useRef(null);
  const livePreviewSourceRef = useRef(null);
  const livePreviewObserverRef = useRef(null);
  const livePreviewGuardObserverRef = useRef(null);
  const livePreviewWatchdogRef = useRef(0);
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
  const unmountCleanupRef = useRef(null);
  const interruptionPolicyRef = useRef(interruptionPolicy);
  // Pointer release may need to open IndexedDB before the atomic commit can
  // settle. Keep accepting/previewing later gestures, but serialize their
  // geometry plans so each one rebases on the previous committed survivor.
  const eraseCommitTailRef = useRef(Promise.resolve());
  const erasePlannerWorkerRef = useRef(null);
  const erasePlannerRequestsRef = useRef(new Map());
  const erasePlannerSequenceRef = useRef(0);
  const eraseAuditWorkerRef = useRef(null);
  const eraseCommitTimingRef = useRef(new Map());
  const eraseGestureSequenceRef = useRef(0);
  const latestEraseGestureRef = useRef(0);
  const mountedRef = useRef(true);
  const spaceHeldRef = useRef(false);
  // Last known pointer position in CLIENT coordinates (plus pointerType).
  // Large eraser sizes use the custom circle because native cursor images are
  // size-limited. This ref lets non-exit hide paths put that circle back under
  // a stationary pointer.
  const lastClientPosRef = useRef(null);
  const eraserDiagGestureRef = useRef(null);
  const initialZoomGenerationRef = useRef(zoomGeneration);
  // Per-gesture AABB cache: { byIndex, byCallout, bySurveyMarker }.
  // Built once at pointer-down from the live SVG layer's getBBox (see
  // buildGestureBounds); powers the per-move fast-reject prefilter.
  const gestureBoundsRef = useRef(null);

  const annotationsRef = useRef(annotations);
  const calloutsRef = useRef(callouts);
  const surveyMarkersRef = useRef(surveyMarkers);
  const onEraseIntentRef = useRef(onEraseIntent);
  const onEraseCommitRef = useRef(onEraseCommit);
  const onEraseFlushRef = useRef(onEraseFlush);
  onEraseFlushRef.current = onEraseFlush;
  const onEraseSurveyMarkerRef = useRef(onEraseSurveyMarker);
  const canEraseSurveyMarkerRef = useRef(canEraseSurveyMarker);
  const onEraseTextMarkupRef = useRef(onEraseTextMarkup);
  const eraserModeRef = useRef(eraserMode);
  const eraserSizeRef = useRef(eraserSize);
  const viewerScaleRef = useRef(viewerScale);
  const nativeCursorRef = useRef(true);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const spacesRef = useRef(spaces);
  const showSurveyPanelRef = useRef(showSurveyPanel);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const viewerIdRef = useRef(viewerId);
  const documentOwnerIdRef = useRef(documentOwnerId);
  const isLocalOnlyDocumentRef = useRef(isLocalOnlyDocument);

  // This flag belongs to the component lifetime, not to the teardown
  // callbacks' identities. A dependency-driven cleanup must never make an
  // otherwise mounted canvas reject the result of an in-flight erase.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    const worker = new Worker(
      new URL('../workers/atomicEraseAuditWorker.js', import.meta.url),
      { type: 'module' },
    );
    eraseAuditWorkerRef.current = worker;
    worker.onmessage = ({ data }) => {
      const {
        mutationId,
        geometryAudits = [],
        geometryAuditSummaries = [],
        error,
      } = data || {};
      const record = updateAtomicEraseDiagnostic(window, mutationId, {
        auditStatus: error ? 'failed' : 'complete',
        geometryAudits,
        geometryAuditSummaries,
        ...(error ? { auditError: error } : {}),
      });
      const violations = geometryAuditSummaries.filter((audit) => (
        Object.values(audit.violations || {}).some(Boolean)
      ));
      if (containerRef.current) {
        containerRef.current.dataset.eraserAuditMutationId = String(mutationId);
        containerRef.current.dataset.eraserAuditStatus = error
          ? 'failed'
          : (violations.length ? 'violation' : 'clean');
        containerRef.current.dataset.eraserAuditViolationCount = String(violations.length);
        containerRef.current.dataset.eraserAuditViolations = JSON.stringify(violations);
        const syncCommitTiming = () => {
          const commitMs = eraseCommitTimingRef.current.get(String(mutationId));
          if (containerRef.current && Number.isFinite(commitMs)) {
            containerRef.current.dataset.eraserCommitMs = String(commitMs);
            eraseCommitTimingRef.current.delete(String(mutationId));
          }
        };
        syncCommitTiming();
        if (!Number.isFinite(eraseCommitTimingRef.current.get(String(mutationId)))) {
          setTimeout(syncCommitTiming, 0);
        }
      }
      if (violations.length && isAtomicEraseGeometryAuditEnabled(window, import.meta.env.DEV)) {
        console.error('[EraserAuditViolation]', JSON.stringify({
          mutationId,
          pageNumber: record?.pageNumber,
          violations,
        }));
      } else if (record && isAtomicEraseGeometryAuditEnabled(window, import.meta.env.DEV)) {
        console.info('[EraserAudit]', {
          mutationId,
          pageNumber: record.pageNumber,
          targetCount: geometryAuditSummaries.length,
          status: error ? 'failed' : 'clean',
        });
      }
    };
    worker.onerror = (event) => {
      console.error('[EraserAuditWorker]', event?.message || 'audit worker failed');
    };
    return () => {
      eraseAuditWorkerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    const worker = new Worker(
      new URL('../workers/pageSpaceEraserWorker.js', import.meta.url),
      { type: 'module' },
    );
    erasePlannerWorkerRef.current = worker;
    worker.onmessage = ({ data }) => {
      const pending = erasePlannerRequestsRef.current.get(data?.requestId);
      if (!pending) return;
      erasePlannerRequestsRef.current.delete(data.requestId);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    };
    // beforeunload cannot await a worker. Finish its captured plan locally;
    // commit starts in this event, before navigation can discard React work.
    const flushPendingPlans = () => {
      for (const [id, pending] of erasePlannerRequestsRef.current) {
        erasePlannerRequestsRef.current.delete(id);
        try {
          const result = planPageEraseLocally(pending.args, pending.blockedByIndex);
          let flushedOutcome;
          onEraseFlushRef.current(() => { flushedOutcome = pending.flush(result); });
          pending.resolve({ flushedOutcome });
        } catch (error) { pending.reject(error); }
      }
    };
    window.addEventListener('beforeunload', flushPendingPlans);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPendingPlans();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    worker.onerror = (event) => {
      const error = new Error(event?.message || 'Eraser planner worker failed');
      for (const pending of erasePlannerRequestsRef.current.values()) {
        try {
          pending.resolve(planPageEraseLocally(pending.args, pending.blockedByIndex));
        } catch {
          pending.reject(error);
        }
      }
      erasePlannerRequestsRef.current.clear();
    };
    return () => {
      window.removeEventListener('beforeunload', flushPendingPlans);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      erasePlannerWorkerRef.current = null;
      worker.terminate();
      for (const pending of erasePlannerRequestsRef.current.values()) {
        try {
          pending.resolve(planPageEraseLocally(pending.args, pending.blockedByIndex));
        } catch (error) {
          pending.reject(error);
        }
      }
      erasePlannerRequestsRef.current.clear();
    };
  }, []);

  annotationsRef.current = annotations;
  calloutsRef.current = callouts;
  surveyMarkersRef.current = surveyMarkers;
  onEraseIntentRef.current = onEraseIntent;
  onEraseCommitRef.current = onEraseCommit;
  onEraseSurveyMarkerRef.current = onEraseSurveyMarker;
  canEraseSurveyMarkerRef.current = canEraseSurveyMarker;
  onEraseTextMarkupRef.current = onEraseTextMarkup;
  eraserModeRef.current = eraserMode;
  eraserSizeRef.current = eraserSize;
  interruptionPolicyRef.current = interruptionPolicy;
  viewerScaleRef.current = viewerScale;
  const displayEraserDiameter = Math.max(1, Number(eraserSize) || 20)
    * Math.max(0.01, Number(viewerScale) || 1);
  const eraserCursor = nativeEraserCursor(displayEraserDiameter);
  nativeCursorRef.current = Boolean(eraserCursor);
  selectedSpaceIdRef.current = selectedSpaceId;
  activeSpaceIdRef.current = activeSpaceId;
  spacesRef.current = spaces;
  showSurveyPanelRef.current = showSurveyPanel;
  selectedModuleIdRef.current = selectedModuleId;
  viewerIdRef.current = viewerId;
  documentOwnerIdRef.current = documentOwnerId;
  isLocalOnlyDocumentRef.current = isLocalOnlyDocument;

  const getPageRadius = useCallback(
    () => eraserDiameterToPageRadius(eraserSizeRef.current),
    [],
  );
  const planPageErase = useCallback((args, blockedByIndex, flush) => {
    const worker = erasePlannerWorkerRef.current;
    if (!worker) {
      return Promise.resolve(planPageEraseLocally(args, blockedByIndex));
    }
    const requestId = erasePlannerSequenceRef.current + 1;
    erasePlannerSequenceRef.current = requestId;
    return new Promise((resolve, reject) => {
      erasePlannerRequestsRef.current.set(requestId, {
        resolve,
        reject,
        args,
        blockedByIndex,
        flush,
      });
      worker.postMessage({ requestId, args, blockedByIndex });
    });
  }, []);
  const scheduleAtomicEraseAudit = useCallback((message) => {
    const send = () => {
      const worker = eraseAuditWorkerRef.current;
      if (worker) worker.postMessage(message);
      else updateAtomicEraseDiagnostic(window, message.mutationId, {
        auditStatus: 'unavailable',
        auditError: 'Eraser audit worker unavailable',
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(send, { timeout: 1000 });
    } else {
      window.setTimeout(send, 0);
    }
  }, []);
  const getInterruptionPolicy = useCallback(() => (
    parentInterruptionPolicyRef?.current === 'cancel'
    || interruptionPolicyRef.current === 'cancel'
      ? 'cancel'
      : 'commit'
  ), [parentInterruptionPolicyRef]);

  const pagePoint = useCallback((nativeEvent) => {
    const rect = containerRef.current?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((nativeEvent.clientX - rect.left) / rect.width) * pageWidth,
      y: ((nativeEvent.clientY - rect.top) / rect.height) * pageHeight,
    };
  }, [pageHeight, pageWidth]);

  // Snapshot every annotation's exact page-unit bounds once per gesture. getBBox
  // on the live SVG layer is browser-exact and already in the layer's page-unit
  // user space (same space as pointer page-points), so no transform math and no
  // risk of a hand-rolled bounds formula false-rejecting a real hit. Keyed by
  // data-annotation-index (the same key the ghost/mask DOM lookups already use)
  // and data-callout-id; multi-element annotations union their child boxes.
  const buildGestureBounds = useCallback(() => {
    const byIndex = new Map();
    const byCallout = new Map();
    const bySurveyMarker = new Map();
    gestureBoundsRef.current = { byIndex, byCallout, bySurveyMarker };
    if (typeof document === 'undefined') return;
    const surface = containerRef.current?.closest('[data-annotation-real-surface]');
    const svg = surface?.querySelector?.('svg[data-svg-annotation-layer]');
    if (!svg) return; // painted-canvas fallback / SVG mid-swap: prefilter stays a no-op
    const union = (map, key) => (element) => {
      let box;
      try { box = element.getBBox(); } catch { return; }
      if (!box || (!box.width && !box.height)) return;
      const next = { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
      const prev = map.get(key);
      map.set(key, prev ? {
        minX: Math.min(prev.minX, next.minX),
        minY: Math.min(prev.minY, next.minY),
        maxX: Math.max(prev.maxX, next.maxX),
        maxY: Math.max(prev.maxY, next.maxY),
      } : next);
    };
    svg.querySelectorAll('[data-annotation-index]').forEach((element) => {
      const key = Number(element.getAttribute('data-annotation-index'));
      if (Number.isFinite(key)) union(byIndex, key)(element);
    });
    svg.querySelectorAll('[data-callout-id]').forEach((element) => {
      union(byCallout, String(element.getAttribute('data-callout-id')))(element);
    });
    svg.querySelectorAll('[data-survey-marker-id]').forEach((element) => {
      union(bySurveyMarker, String(element.getAttribute('data-survey-marker-id')))(element);
    });
    // Inflate each geometry box by its own stroke half-width (getBBox excludes
    // stroke) so the fast-reject stays a true superset of the hit test's reach.
    // Without this, near-edge swipes over wide imported ink were dropped live.
    const objects = annotationsRef.current?.objects || [];
    for (const [key, box] of byIndex) {
      const inflated = inflateBounds(box, objectStrokeInflation(objects[key]));
      if (inflated) byIndex.set(key, inflated);
    }
    for (const [key, box] of byCallout) {
      const inflated = inflateBounds(box, CALLOUT_BOUNDS_PAD);
      if (inflated) byCallout.set(key, inflated);
    }
  }, []);

  // Fast-reject: true when this object MIGHT touch the segment (or has no cached
  // bounds, in which case we never reject). A `false` means the object is
  // provably nowhere near the cursor this move — skip its expensive hit-test.
  const indexBoundsAllow = useCallback((index, queryBounds) => {
    if (!queryBounds) return true;
    const pointer = pointerRef.current;
    if (pointer && annotationsRef.current?.objects !== pointer.sourceObjects) {
      // A collaborator replaced/reordered the page during this gesture.
      // Pointer-down bounds are stale; defer to the exact current hit test.
      return true;
    }
    const bounds = gestureBoundsRef.current?.byIndex?.get(index);
    if (!bounds) return true;
    return boundsIntersect(bounds, queryBounds);
  }, []);

  const calloutBoundsAllow = useCallback((calloutId, queryBounds) => {
    if (!queryBounds) return true;
    const bounds = gestureBoundsRef.current?.byCallout?.get(String(calloutId));
    if (!bounds) return true;
    return boundsIntersect(bounds, queryBounds);
  }, []);

  const surveyMarkerBoundsAllow = useCallback((annotationId, queryBounds) => {
    if (!queryBounds) return true;
    const bounds = gestureBoundsRef.current?.bySurveyMarker?.get(String(annotationId));
    if (!bounds) return false;
    return boundsIntersect(bounds, queryBounds);
  }, []);

  const updateEraserCursor = useCallback((point, visible = true) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const shouldShow = visible && !spaceHeldRef.current && point;
    cursor.style.display = shouldShow && !nativeCursorRef.current ? 'block' : 'none';
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
    if (livePreviewWatchdogRef.current) clearTimeout(livePreviewWatchdogRef.current);
    livePreviewWatchdogRef.current = 0;
  }, []);

  const cancelMaskCloneGuard = useCallback(() => {
    livePreviewGuardObserverRef.current?.disconnect?.();
    livePreviewGuardObserverRef.current = null;
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

  const ensureMaskCloneConnected = useCallback(() => {
    const clone = maskCloneRef.current;
    const sourceState = livePreviewSourceRef.current;
    const surface = containerRef.current?.closest('[data-annotation-real-surface]');
    if (!clone?.root || !surface?.isConnected) return false;
    if (clone.root.parentNode !== surface) surface.appendChild(clone.root);
    clone.surface = surface;
    if (sourceState) {
      sourceState.surface = surface;
      const wrapper = surface.querySelector?.('[data-diag-svg-wrapper]');
      if (wrapper) {
        if (!(sourceState.hiddenSvgWrappers instanceof Map)) {
          sourceState.hiddenSvgWrappers = new Map();
        }
        if (!sourceState.hiddenSvgWrappers.has(wrapper)) {
          sourceState.hiddenSvgWrappers.set(wrapper, wrapper.style.visibility);
        }
        wrapper.style.visibility = 'hidden';
      }
    }
    return clone.root.isConnected;
  }, []);

  const startMaskCloneGuard = useCallback((surface) => {
    cancelMaskCloneGuard();
    if (!surface || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (maskCloneRef.current?.root) ensureMaskCloneConnected();
      const sourceState = livePreviewSourceRef.current;
      if (
        sourceState?.handoffState === 'waiting'
        || sourceState?.handoffState === 'safe-hold'
      ) {
        sourceState.checkReady?.();
      }
    });
    livePreviewGuardObserverRef.current = observer;
    observer.observe(surface, {
      attributes: true,
      attributeFilter: ['data-svg-annotation-revision'],
      childList: true,
      subtree: true,
    });
  }, [cancelMaskCloneGuard, ensureMaskCloneConnected]);

  const finishLiveErasePreview = useCallback(({ immediate = false } = {}) => {
    cancelLivePreviewFinish();
    cancelMaskCloneGuard();
    const sourceState = livePreviewSourceRef.current;
    const closingClone = maskCloneRef.current;
    const completeHandoff = () => {
      livePreviewHideRafRef.current = 0;
      // A pointer-down can reuse the still-visible clone before this frame.
      // Its activation cancels this callback; the identity check is the final
      // guard against an obsolete release tearing down the new gesture.
      if (sourceState && livePreviewSourceRef.current !== sourceState) return;
      if (sourceState?.overlay?.isConnected) {
        sourceState.overlay.style.visibility = sourceState.previousVisibility;
      }
      const svgWrapper = sourceState?.surface
        ?.querySelector?.('[data-diag-svg-wrapper]')
        || containerRef.current
          ?.closest('[data-annotation-real-surface]')
          ?.querySelector('[data-diag-svg-wrapper]');
      if (maskCloneRef.current === closingClone) maskCloneRef.current = null;
      livePreviewSourceRef.current = null;
      // One before-paint swap: remove the old carved presentation and reveal
      // the already-updated committed SVG in this same callback. Keeping the
      // SVG mounted during the gesture makes a two-frame overlap unnecessary.
      if (closingClone?.root?.isConnected) closingClone.root.remove();
      hidePreviewCanvasNow();
      if (sourceState?.hiddenSvgWrappers instanceof Map) {
        sourceState.hiddenSvgWrappers.forEach((visibility, wrapper) => {
          if (wrapper?.isConnected) wrapper.style.visibility = visibility;
        });
      } else if (svgWrapper) {
        svgWrapper.style.visibility = sourceState?.previousSvgVisibility ?? '';
      }
      onErasePreviewPresentationRef.current?.(pageNumber, false);
    };

    cancelScheduledPreviewHide();
    if (immediate || !sourceState || typeof requestAnimationFrame !== 'function') {
      completeHandoff();
      return;
    }
    livePreviewHideRafRef.current = requestAnimationFrame(completeHandoff);
  }, [
    cancelLivePreviewFinish,
    cancelMaskCloneGuard,
    cancelScheduledPreviewHide,
    hidePreviewCanvasNow,
    pageNumber,
  ]);

  const restoreLiveErasePreviewImmediately = useCallback(() => {
    cancelLivePreviewFinish();
    cancelMaskCloneGuard();
    cancelScheduledPreviewHide();
    const sourceState = livePreviewSourceRef.current;
    if (sourceState?.overlay?.isConnected) {
      sourceState.overlay.style.visibility = sourceState.previousVisibility;
    }
    const svgWrapper = sourceState?.surface
      ?.querySelector?.('[data-diag-svg-wrapper]')
      || containerRef.current
        ?.closest('[data-annotation-real-surface]')
        ?.querySelector('[data-diag-svg-wrapper]');
    if (sourceState?.hiddenSvgWrappers instanceof Map) {
      sourceState.hiddenSvgWrappers.forEach((visibility, wrapper) => {
        if (wrapper?.isConnected) wrapper.style.visibility = visibility;
      });
    } else if (svgWrapper) {
      svgWrapper.style.visibility = sourceState?.previousSvgVisibility ?? '';
    }
    livePreviewSourceRef.current = null;
    removeMaskCloneNow();
    hidePreviewCanvasNow();
    onErasePreviewPresentationRef.current?.(pageNumber, false);
  }, [
    cancelLivePreviewFinish,
    cancelMaskCloneGuard,
    cancelScheduledPreviewHide,
    hidePreviewCanvasNow,
    pageNumber,
    removeMaskCloneNow,
  ]);

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
    const svgWrapper = surface?.querySelector?.('[data-diag-svg-wrapper]');
    const hideSvgForPreview = () => {
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
      previousSvgVisibility: svgWrapper?.style?.visibility || '',
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

  const drawLiveErasePreviewSegment = useCallback((points, gestureRadius = getPageRadius()) => {
    if (!points?.length) return;
    const clone = maskCloneRef.current;
    if (clone?.carve) {
      // Mask-clone mode: carve in PAGE UNITS directly (mask user space).
      const radius = gestureRadius;
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

      const gestureId = latestEraseGestureRef.current;
      if (clone.activeCarveGestureId !== gestureId) {
        clone.activeCarveGestureId = gestureId;
        clone.activeCarvePoints = [];
        if (clone.carve.getAttribute('d')) {
          clone.carveChunkCount += 1;
          clone.carve = createLiveErasePreviewPath(
            clone.mask,
            radius,
            clone.carveChunkCount,
          );
        } else {
          clone.carve.setAttribute('stroke-width', String(radius * 2));
        }
      }

      let activeChanged = false;
      for (const point of points) {
        const activePoints = clone.activeCarvePoints;
        const last = activePoints[activePoints.length - 1];
        if (samePreviewPoint(last, point)) continue;
        if (
          activePoints.length >= 2
          && canDropPreviewMiddlePoint(
            activePoints[activePoints.length - 2],
            last,
            point,
          )
        ) {
          activePoints[activePoints.length - 1] = point;
        } else {
          activePoints.push(point);
        }
        activeChanged = true;

        if (activePoints.length >= LIVE_ERASE_PREVIEW_CHUNK_POINT_LIMIT) {
          clone.carve.setAttribute('d', previewPathData(activePoints));
          const overlapPoint = activePoints[activePoints.length - 1];
          clone.carveChunkCount += 1;
          clone.carve = createLiveErasePreviewPath(
            clone.mask,
            radius,
            clone.carveChunkCount,
          );
          clone.activeCarvePoints = [overlapPoint];
          activeChanged = false;
        }
      }
      if (activeChanged && clone.activeCarvePoints.length >= 2) {
        clone.carve.setAttribute('d', previewPathData(clone.activeCarvePoints));
      }
      return;
    }
    const preview = livePreviewCanvasRef.current;
    if (!preview || preview.style.display === 'none') return;
    const context = preview.getContext('2d');
    if (!context) return;
    const radius = gestureRadius;
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
    // Use the same immutable presentation objects as the visible overlay.
    // projectPaperInkForPresentation intentionally preserves authored curves;
    // committed partial bites carry a separate clip mask instead of replacing
    // the source path with a flattened outline.
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

  // Callout pending-erase preview (2026-07-17, callout-unification seam fix).
  // WHY CALLOUTS WERE EXCLUDED HISTORICALLY: the whole-delete ghost machinery
  // above keys off annotations.objects + data-annotation-id/index DOM
  // selectors, but callouts are the historical fork — they live in the
  // separate callouts[] pipeline, render with data-callout-id (never
  // data-annotation-id), and drawAnnotationObject deliberately skips their
  // dual-rep projections (data.type === 'callout') to avoid double-painting.
  // So even when the erase engine flagged a projected callout group, neither
  // ghost path could reach its pixels, and the bespoke getCalloutHitIds test
  // (the actual callout-erase mechanism — see applyEraserAndCommit) only ran
  // at pointer-up. Net effect: a sweep whole-deleted the callout at release
  // with zero pending-erase warning. These helpers close that gap using the
  // SAME hit test the commit uses, so preview and commit cannot disagree.
  const collectPageCallouts = useCallback(() => {
    const legacyCallouts = (annotationsRef.current?.objects || [])
      .map((object) => getLegacyCalloutPayload(object, pageNumber))
      .filter(Boolean);
    return [
      ...(Array.isArray(calloutsRef.current) ? calloutsRef.current : []),
      ...legacyCallouts,
    ];
  }, [pageNumber]);

  // Which callouts under these eraser points should show the pending-erase
  // treatment. Ownership parity with getEraseBlockReason: another user's
  // callout gets NO pending-erase preview for a non-owner viewer — the eraser
  // never silently whole-deletes cross-author marks on release (any such
  // delete routes through the confirm modal), so ghosting it live would warn
  // about an erase that is not going to happen.
  const getPermittedCalloutHitIds = useCallback((
    eraserPoints,
    excludeIds,
    gestureRadius = getPageRadius(),
  ) => {
    const allCallouts = collectPageCallouts();
    if (!allCallouts.length) return [];
    const radius = gestureRadius;
    // Fast-reject callouts nowhere near the segment before the per-callout
    // geometry test (same AABB prefilter as the object hot path).
    const queryBounds = segmentQueryBounds(eraserPoints, radius);
    const nearCallouts = queryBounds
      ? allCallouts.filter((callout) => calloutBoundsAllow(callout.id, queryBounds))
      : allCallouts;
    if (!nearCallouts.length) return [];
    const hitIds = getCalloutHitIds({
      callouts: nearCallouts,
      pageNumber,
      pageWidth,
      pageHeight,
      eraserPoints,
      eraserRadius: radius,
    });
    if (!hitIds.length) return hitIds;
    const viewerId = viewerIdRef.current;
    const ownerId = documentOwnerIdRef.current;
    return hitIds.filter((id) => {
      if (excludeIds?.has(id)) return false;
      const callout = allCallouts.find((c) => c.id === id);
      // KAL-89 (review residual): the callout lane must honor the same
      // survey-visibility rule as getEraseBlockReason — what survey mode
      // hides, the eraser must not touch. getCalloutHitIds tests raw
      // geometry, so without this gate a survey-hidden canvas callout was
      // whole-erasable during a survey-mode sweep (and a survey-scoped
      // callout erasable in standard mode). Checked BEFORE the local-only
      // early return so unauthenticated/local documents are gated too;
      // both preview and commit call this exact helper.
      if (!isAnnotationVisibleInSurveyMode({
        moduleId: callout?.moduleId ?? null,
        regionId: callout?.regionId ?? null,
        showSurveyPanel: showSurveyPanelRef.current,
        selectedModuleId: selectedModuleIdRef.current,
      })) return false;
      if (!viewerId || !ownerId) return isLocalOnlyDocumentRef.current;
      if (callout?.locked === true) return false;
      return canModify({ annotation: callout, viewerId, documentOwnerId: ownerId });
    });
  }, [calloutBoundsAllow, collectPageCallouts, getPageRadius, pageHeight, pageNumber, pageWidth]);

  // Survey markers live outside annotations.objects. Their live SVG DOM IDs are
  // the visibility authority for the gesture, while PDFViewer owns the source
  // permission predicate. Both preview and commit call this exact helper.
  const getPermittedSurveyMarkerHitIds = useCallback((
    eraserPoints,
    excludeIds,
    gestureRadius = getPageRadius(),
  ) => {
    if (typeof onEraseSurveyMarkerRef.current !== 'function') return [];
    const visibleBounds = gestureBoundsRef.current?.bySurveyMarker;
    if (!(visibleBounds instanceof Map) || visibleBounds.size === 0) return [];
    const radius = gestureRadius;
    const queryBounds = segmentQueryBounds(eraserPoints, radius);
    const visibleIds = new Set(visibleBounds.keys());
    return getSurveyMarkerEraserHitIds({
      surveyMarkers: Array.isArray(surveyMarkersRef.current) ? surveyMarkersRef.current : [],
      visibleIds,
      excludeIds,
      eraserPoints,
      eraserRadius: radius,
      canErase: (annotationId) => {
        try {
          return typeof canEraseSurveyMarkerRef.current === 'function'
            ? canEraseSurveyMarkerRef.current(annotationId) === true
            : true;
        } catch {
          return false;
        }
      },
      boundsAllow: (annotationId) => surveyMarkerBoundsAllow(annotationId, queryBounds),
    });
  }, [getPageRadius, surveyMarkerBoundsAllow]);

  // Whole-delete pending-erase visual for callouts — the exact treatment
  // non-path shapes get in eraseAtomicObjectsFromPreview, ported to the
  // callout render pipeline. Mask-clone mode hides the cloned callout DOM
  // (display:none — exact by definition); painted-canvas fallback
  // destination-outs the callout's own silhouette via the painter's callouts
  // lane (drawCallout — same page-unit geometry, so it scales with zoom like
  // everything else).
  const ghostCalloutsFromPreview = useCallback((ids) => {
    if (!ids?.length) return;
    const clone = maskCloneRef.current;
    if (clone?.root) {
      for (const id of ids) {
        if (typeof CSS === 'undefined' || !CSS.escape) break;
        clone.root
          .querySelectorAll(`[data-callout-id="${CSS.escape(String(id))}"]`)
          .forEach((el) => { el.style.display = 'none'; });
      }
      return;
    }
    const preview = livePreviewCanvasRef.current;
    if (!preview || preview.style.display === 'none') return;
    const idSet = new Set(ids.map(String));
    const targets = collectPageCallouts().filter((c) => idSet.has(String(c.id)));
    if (!targets.length || typeof document === 'undefined') return;
    const mask = livePreviewMaskCanvasRef.current || document.createElement('canvas');
    livePreviewMaskCanvasRef.current = mask;
    mask.width = preview.width;
    mask.height = preview.height;
    const maskContext = mask.getContext('2d');
    const previewContext = preview.getContext('2d');
    if (!maskContext || !previewContext) return;
    const drawScale = Number(preview.dataset.canvasDrawScale) || (preview.width / pageWidth);
    const drawScaleY = Number(preview.dataset.canvasDrawScaleY) || drawScale;
    paintAnnotationCanvas(maskContext, {
      canvasWidth: mask.width,
      canvasHeight: mask.height,
      drawScale,
      drawScaleY,
      displayScale: Math.max(0.01, Number(viewerScaleRef.current) || 1),
      pageWidth,
      pageHeight,
      offsetX: Number(preview.dataset.canvasPageOffsetX) || 0,
      offsetY: Number(preview.dataset.canvasPageOffsetY) || 0,
      objects: [],
      callouts: targets,
    });
    previewContext.save();
    previewContext.setTransform(1, 0, 0, 1, 0, 0);
    previewContext.globalCompositeOperation = 'destination-out';
    previewContext.drawImage(mask, 0, 0);
    previewContext.restore();
  }, [collectPageCallouts, pageHeight, pageWidth]);

  // Whole-delete preview for survey markers. The normal path hides the entire
  // cloned SVG group (fill, border, hover/selection chrome together). The rare
  // painted fallback uses the same rect projection as the presentation canvas.
  const ghostSurveyMarkersFromPreview = useCallback((ids) => {
    if (!ids?.length) return;
    const idSet = new Set(ids.map(String));
    const clone = maskCloneRef.current;
    if (clone?.root) {
      clone.root.querySelectorAll('[data-survey-marker-id]').forEach((element) => {
        if (idSet.has(String(element.getAttribute('data-survey-marker-id')))) {
          element.style.display = 'none';
        }
      });
      return;
    }
    const preview = livePreviewCanvasRef.current;
    if (!preview || preview.style.display === 'none') return;
    const objects = (Array.isArray(surveyMarkersRef.current) ? surveyMarkersRef.current : [])
      .filter((marker) => idSet.has(String(marker?.annotationId)))
      .map(surveyMarkerToEraserObject)
      .filter(Boolean);
    if (!objects.length || typeof document === 'undefined') return;
    const mask = livePreviewMaskCanvasRef.current || document.createElement('canvas');
    livePreviewMaskCanvasRef.current = mask;
    mask.width = preview.width;
    mask.height = preview.height;
    const maskContext = mask.getContext('2d');
    const previewContext = preview.getContext('2d');
    if (!maskContext || !previewContext) return;
    const drawScale = Number(preview.dataset.canvasDrawScale) || (preview.width / pageWidth);
    paintAnnotationCanvas(maskContext, {
      canvasWidth: mask.width,
      canvasHeight: mask.height,
      drawScale,
      drawScaleY: Number(preview.dataset.canvasDrawScaleY) || drawScale,
      displayScale: Math.max(0.01, Number(viewerScaleRef.current) || 1),
      pageWidth,
      pageHeight,
      offsetX: Number(preview.dataset.canvasPageOffsetX) || 0,
      offsetY: Number(preview.dataset.canvasPageOffsetY) || 0,
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
    if (pointer.pendingCalloutIds.size) {
      const stashedCallouts = [...pointer.pendingCalloutIds]
        .filter((id) => !pointer.previewCalloutIds.has(id));
      if (stashedCallouts.length) {
        ghostCalloutsFromPreview(stashedCallouts);
        stashedCallouts.forEach((id) => pointer.previewCalloutIds.add(id));
      }
      pointer.pendingCalloutIds.clear();
    }
    if (pointer.pendingSurveyMarkerIds.size) {
      const stashedSurveyMarkers = [...pointer.pendingSurveyMarkerIds]
        .filter((id) => !pointer.previewSurveyMarkerIds.has(id));
      if (stashedSurveyMarkers.length) {
        ghostSurveyMarkersFromPreview(stashedSurveyMarkers);
        stashedSurveyMarkers.forEach((id) => pointer.previewSurveyMarkerIds.add(id));
      }
      pointer.pendingSurveyMarkerIds.clear();
    }
    if (pointer.pendingPartial && !pointer.previewHasPartial) {
      pointer.previewHasPartial = true;
      pointer.pendingPartial = false;
      drawLiveErasePreviewSegment(pointer.points, pointer.gestureConfig.radius);
      maskCarvedPathHits(pointer, pointer.points);
    }
  }, [
    drawLiveErasePreviewSegment,
    eraseAtomicObjectsFromPreview,
    ghostCalloutsFromPreview,
    ghostSurveyMarkersFromPreview,
  ]);

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
    if (getEraserHandoffTestFlags()?.forceMaskCloneUnavailable === true) return false;
    if (maskCloneRef.current?.root) {
      // Continuing session (back-to-back strokes inside the previous
      // stroke's commit-wait window). CRITICAL: kill the previous stroke's
      // pending finish observer + deferred teardown, or its belated
      // callback rips this stroke's shared clone out mid-drag (adversarial
      // review finding, 2026-07-15).
      cancelLivePreviewFinish();
      cancelScheduledPreviewHide();
      if (ensureMaskCloneConnected()) {
        const state = livePreviewSourceRef.current;
        if (state) {
          state.handoffState = 'active';
          state.checkReady = null;
        }
        maskCloneRef.current.root.dataset.eraserHandoffState = 'active';
        startMaskCloneGuard(state?.surface);
        return true;
      }
      removeMaskCloneNow();
    }
    cancelLivePreviewFinish();
    cancelScheduledPreviewHide();
    const surface = containerRef.current?.closest('[data-annotation-real-surface]');
    const wrapper = surface?.querySelector('[data-diag-svg-wrapper]');
    const svg = wrapper?.querySelector('svg[data-svg-annotation-layer]');
    if (!surface || !wrapper || !svg) return false;
    const previousSvgVisibility = wrapper.style.visibility;
    // Orphan sweep: a half-built clone from any earlier failure must never
    // survive into a new session (it would double-render under the preview).
    surface.querySelectorAll('[data-eraser-mask-clone]').forEach((el) => el.remove());
    let cloneRoot = null;
    let carve = null;
    let maskEl = null;
    try {
      const SVG_NS = 'http://www.w3.org/2000/svg';
      cloneRoot = svg.cloneNode(true);
      namespaceSvgCloneFragmentIds(
        cloneRoot,
        `eraser-preview-${pageNumber}-${latestEraseGestureRef.current}-${Date.now().toString(36)}`,
      );
      // The clone must never masquerade as the real layer for selectors,
      // diagnostics, or harnesses.
      cloneRoot.removeAttribute('data-svg-annotation-layer');
      cloneRoot.setAttribute('data-eraser-mask-clone', String(pageNumber));
      cloneRoot.setAttribute('aria-hidden', 'true');
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
      carve.setAttribute('data-eraser-carve-chunk', '0');
      mask.appendChild(keep);
      mask.appendChild(carve);
      defs.appendChild(mask);
      maskEl = mask;
      // PER-ELEMENT masking (2026-07-15, mouse-up-flicker fix): the mask is
      // DEFINED here but applied lazily to individual annotation elements as
      // the sweep actually touches them (maskCarvedPathHits). Masking forces
      // an isolated raster/blend buffer whose output differs subtly from the
      // unmasked layer — with a whole-group mask EVERY annotation softened a
      // hair during the gesture and snapped sharp on release (the visible
      // "flicker of annotations at mouse up"), and multiply-blend highlights
      // lost their page backdrop. Untouched elements now carry no mask and
      // render bit-identically; only actively-carved ink pays the residual,
      // and its pixels are legitimately changing anyway. This also stops the
      // punch from visually cutting content the commit will never erase
      // (blocked/non-erasable objects reappearing at release).
      cloneRoot.appendChild(defs);
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
    const liveMaskId = maskEl?.getAttribute('id') || '';
    maskCloneRef.current = {
      root: cloneRoot,
      carve,
      mask: maskEl,
      maskId: liveMaskId,
      activeCarveGestureId: null,
      activeCarvePoints: [],
      carveChunkCount: 0,
      maskedKeys: new Set(),
      indexHidden: new Set(),
    };
    // Non-null session state so the commit-repaint finish gate engages; the
    // warm painted canvas still carries the revision/paint-generation
    // handshake datasets even though it never becomes visible in this mode.
    const { source } = findPresentationSource();
    livePreviewSourceRef.current = {
      surface,
      source: source || null,
      overlay: null,
      previousVisibility: '',
      previousSvgVisibility,
      hiddenSvgWrappers: new Map([[wrapper, previousSvgVisibility]]),
      maskClone: true,
      handoffState: 'active',
      paintGeneration: source?.dataset?.canvasPaintGeneration || '',
    };
    cloneRoot.dataset.eraserHandoffState = 'active';
    startMaskCloneGuard(surface);
    return true;
  }, [
    cancelLivePreviewFinish,
    cancelScheduledPreviewHide,
    ensureMaskCloneConnected,
    findPresentationSource,
    pageNumber,
    pageHeight,
    pageWidth,
    removeMaskCloneNow,
    startMaskCloneGuard,
  ]);

  const scheduleLiveErasePreviewFinish = useCallback(({
    expectedRevision,
    waitForNextPaint,
    requireMutationAck = false,
  }) => {
    const sourceState = livePreviewSourceRef.current;
    if (!sourceState || (!expectedRevision && !waitForNextPaint)) {
      finishLiveErasePreview();
      return;
    }
    sourceState.handoffState = nextEraserPreviewHandoffState(
      sourceState.handoffState || 'active',
      'commit',
    );
    if (maskCloneRef.current?.root) {
      maskCloneRef.current.root.dataset.eraserHandoffState = sourceState.handoffState;
    }
    // Rebase the fallback-painter gate at pointer-up, after the gesture but
    // before React can commit the delete. Using the generation captured at
    // pointer-down lets an unrelated in-flight paint from during the drag
    // masquerade as the delete repaint and reveal stale callout/survey DOM.
    const sourceAtRelease = findPresentationSource().source;
    sourceState.hadSourceAtRelease = Boolean(sourceAtRelease || sourceState.source);
    if (sourceAtRelease) {
      sourceState.source = sourceAtRelease;
      sourceState.paintGeneration = sourceAtRelease.dataset.canvasPaintGeneration || '';
    }
    const check = () => {
      const state = livePreviewSourceRef.current;
      if (!state) return true;
      const finalSvgWrapper = state.surface
        ?.querySelector?.('[data-diag-svg-wrapper]');
      const suppressExactRepaint = (
        getEraserHandoffTestFlags()?.suppressExactRepaint === true
      );
      const svgAnnotationRevision = suppressExactRepaint
        ? '__eraser-test-suppressed__'
        : finalSvgWrapper?.dataset?.svgAnnotationRevision || '';
      const materializedMutationIds = (
        finalSvgWrapper?.dataset?.eraserMaterializedMutationIds || ''
      ).split(' ').filter(Boolean);
      const currentSource = findPresentationSource().source;
      if (currentSource) state.source = currentSource;
      const canvasAnnotationRevision = currentSource?.dataset?.canvasAnnotationRevision || '';
      const paintGeneration = currentSource?.dataset?.canvasPaintGeneration || '';
      if (isEraserPreviewFinishReady({
        expectedRevision,
        waitForNextPaint,
        finalSvgRevision: svgAnnotationRevision,
        maskClone: state.maskClone === true,
        hadSourceAtRelease: state.hadSourceAtRelease === true,
        hasCurrentSource: Boolean(currentSource),
        canvasRevision: canvasAnnotationRevision,
        baselinePaintGeneration: state.paintGeneration,
        currentPaintGeneration: paintGeneration,
        materializedMutationIds,
        requireMutationAck,
      })) {
        state.handoffState = nextEraserPreviewHandoffState(
          state.handoffState,
          'exact-paint',
        );
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
      childList: true,
      subtree: true,
      attributeFilter: [
        'data-canvas-annotation-revision',
        'data-canvas-paint-generation',
        'data-annotation-detail-active',
        'data-svg-annotation-revision',
        'data-eraser-materialized-mutation-ids',
      ],
    });
    sourceState.checkReady = check;
    livePreviewWatchdogRef.current = setTimeout(() => {
      const state = livePreviewSourceRef.current;
      if (!state || state !== sourceState || state.handoffState !== 'waiting') return;
      state.handoffState = nextEraserPreviewHandoffState(state.handoffState, 'bound');
      livePreviewObserverRef.current?.disconnect?.();
      livePreviewObserverRef.current = null;
      livePreviewWatchdogRef.current = 0;
      if (maskCloneRef.current?.root) {
        maskCloneRef.current.root.dataset.eraserHandoffState = state.handoffState;
        ensureMaskCloneConnected();
      }
    }, ERASER_PREVIEW_HANDOFF_BOUND_MS);
    check();
  }, [
    cancelLivePreviewFinish,
    ensureMaskCloneConnected,
    findPresentationSource,
    finishLiveErasePreview,
  ]);

  // The watchdog deliberately disconnects its MutationObserver at the bound.
  // A later React paint still gets one deterministic readiness check from the
  // component's layout phase, so safe-hold cannot require a pointer or zoom to
  // release and no unbounded repaint observer remains attached.
  useLayoutEffect(() => {
    const state = livePreviewSourceRef.current;
    if (
      state?.handoffState !== 'waiting'
      && state?.handoffState !== 'safe-hold'
    ) return;
    ensureMaskCloneConnected();
    state.checkReady?.();
  });

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
    // SVGAnnotationLayer deliberately hides legacy survey-marker proxy rects
    // (identified by top-level annotationId). The marker source has its own
    // visibility and permission model, so the generic annotations.objects lane
    // must never mutate that proxy behind the dedicated marker transaction.
    if (object?.annotationId) return 'survey-marker-source';

    // Locked permissions model, decision 2026-07-17: the eraser DELIBERATELY
    // stays on canModify (author-or-owner) while selection/delete moved to
    // canDelete. Rationale: erase commits destructively MID-GESTURE (whole-
    // delete ghosting + partial path carving) with no confirmation surface,
    // and the product rule is that cross-author deletes ALWAYS go through the
    // confirm modal — the eraser cannot show one per sweep. A contributor who
    // wants another user's stroke gone selects it and presses Delete, which
    // routes through the bulk-delete planner's cross-author modal. Foreign
    // strokes therefore stay visibly untouched under a contributor's eraser
    // (skip, not silent data loss). Owner behavior unchanged (canModify
    // short-circuits true).
    const currentViewerId = viewerIdRef.current;
    const currentOwnerId = documentOwnerIdRef.current;
    if (!isLocalOnlyDocumentRef.current) {
      // Registered documents fail closed through canModify itself when either
      // identity is unresolved. Local-only documents have no durable owner
      // metadata and intentionally stay on their explicit opener-owned lane.
      if (!canModify({
        annotation: object,
        viewerId: currentViewerId,
        documentOwnerId: currentOwnerId,
      })) return 'permission';
    }

    // Projected callout groups are storage proxies, not eraser geometry. Their
    // absolute child coordinates plus group left/top create a double-offset
    // ghost hitbox; the dedicated callouts[] lane is authoritative.
    if (object?.data?.type === 'callout') return 'callout-source';

    // Locked annotations: the commit engine's path lane already skips
    // locked ink, but the non-path whole-delete lane and the LIVE preview did
    // not — the preview visibly carved/ghosted a locked mark, then the commit
    // resurrected it (2026-07-19 audit). One shared rule here covers live AND
    // commit (canErase is built from this function).
    if (object?.locked === true) return 'locked';

    // KAL-89 — survey-mode gate, mirroring the space-scope rule below: what
    // survey mode hides, the eraser must not touch. Reuses the SHARED
    // visibility decision (isAnnotationVisibleInSurveyMode) so classify can
    // never disagree with the renderer: canvas-scoped marks are hidden (and
    // therefore protected) while a survey module is active, and survey-scoped
    // marks are protected outside their matching module. Region-scoped marks
    // fall through to the space-scope rules unchanged.
    if (!isAnnotationVisibleInSurveyMode({
      moduleId: object?.moduleId ?? null,
      regionId: object?.regionId ?? null,
      showSurveyPanel: showSurveyPanelRef.current,
      selectedModuleId: selectedModuleIdRef.current,
    })) return 'survey-scope';

    const objectSpaceId = object?.spaceId ?? null;
    const objectRegionId = object?.regionId ?? null;
    if (activeSpaceIdRef.current !== null && activeSpaceIdRef.current !== undefined) {
      if (objectRegionId !== null) {
        const derivedSpaceId = getSpaceIdForRegion(objectRegionId);
        if (derivedSpaceId !== null && derivedSpaceId !== activeSpaceIdRef.current) return 'space-scope';
      } else if (objectSpaceId !== null) {
        if (objectSpaceId !== activeSpaceIdRef.current) return 'space-scope';
      } else {
        // Unscoped (background) annotations under an ACTIVE space are
        // deliberately protected: SVGAnnotationLayer's interaction rules make
        // background content visible-but-not-editable inside a space, and the
        // eraser follows the same contract (skip, never silent cross-scope
        // data loss). Confirmed 2026-07-20 against the rig's K8 case; if the
        // product rule ever flips to "background erases too", this single
        // return is the switch.
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

  // Cheap per-segment ghost check for EVERY whole-delete object crossed by the
  // segment — shapes, text, stamps, AND atomic path-typed objects (clouds,
  // imported non-ink paths). The filter is the POLICY predicate
  // (getEraserOperation !== 'partial'), not a type heuristic: the old
  // type!=='path' skip left atomic paths with zero live feedback once carving
  // started (classify stops running after previewHasPartial — 2026-07-19
  // audit), which read as "shapes need multiple hits". Uses the exact touch
  // test the commit engine uses, so ghosting can never disagree with commit.
  const ghostAtomicHits = useCallback((pointer, segmentPoints) => {
    if (!segmentPoints?.length) return;
    const objects = annotationsRef.current?.objects || [];
    const radius = pointer.gestureConfig.radius;
    const mode = pointer.gestureConfig.mode;
    const queryBounds = segmentQueryBounds(segmentPoints, radius);
    const hitIds = [];
    objects.forEach((object, index) => {
      if (getEraserOperation(object, mode) === 'partial') return; // ink carves, never ghosts
      const id = getEraserCandidateId(object, index);
      if (pointer.previewAtomicIds.has(id)) return;
      if (!indexBoundsAllow(index, queryBounds)) return; // fast reject: nowhere near cursor
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
  }, [eraseAtomicObjectsFromPreview, getEraseBlockReason, indexBoundsAllow]);

  // Lazily attach the carve mask to path elements the sweep actually
  // touches (partial-erasable only). Elements keep rendering unmasked —
  // bit-identical to the live layer — until the eraser really crosses them.
  const maskCarvedPathHits = useCallback((pointer, segmentPoints) => {
    const clone = maskCloneRef.current;
    if (!clone?.maskId || !segmentPoints?.length) return;
    if (pointer.gestureConfig.mode !== 'partial') return; // entire-mode paths whole-delete via ghosts
    const objects = annotationsRef.current?.objects || [];
    const radius = pointer.gestureConfig.radius;
    const queryBounds = segmentQueryBounds(segmentPoints, radius);
    objects.forEach((object, index) => {
      if (String(object?.type || '').toLowerCase() !== 'path') return;
      // Locked eraser policy: only pen/highlighter/imported-Ink strokes are
      // partial-erasable — every other object whole-deletes even in partial
      // mode. Atomic path-typed objects must therefore NEVER get the partial
      // carve mask (they'd look part-carved mid-drag, then vanish whole at
      // release); they ghost whole via the classify → atomic lane instead.
      if (getEraserOperation(object, 'partial') !== 'partial') return;
      const id = getEraserCandidateId(object, index);
      if (clone.maskedKeys.has(id)) return;
      if (!indexBoundsAllow(index, queryBounds)) return; // fast reject: nowhere near cursor
      if (getEraseBlockReason(object)) return;
      if (!eraserStrokeTouchesObject({
        eraserPoints: segmentPoints,
        eraserRadius: radius,
        object,
      })) return;
      clone.maskedKeys.add(id);
      const stableId = String(object?.id || '');
      let targets = [];
      if (stableId && typeof CSS !== 'undefined' && CSS.escape) {
        targets = clone.root.querySelectorAll(`[data-annotation-id="${CSS.escape(stableId)}"]`);
      }
      if (!targets.length) {
        targets = clone.root.querySelectorAll(`[data-annotation-index="${index}"]`);
      }
      targets.forEach((el) => el.setAttribute('mask', `url(#${clone.maskId})`));
    });
  }, [getEraseBlockReason, indexBoundsAllow]);

  // Cheap replacement for the per-move planPageEraserPreview (full boolean-carve
  // engine). Classifies which objects the NEW segment touches — partial-erasable
  // ink (start/continue the live carve) vs whole-delete atomics (ghost) — using
  // the same eraserStrokeTouchesObject the commit path uses, gated by the AABB
  // fast-reject. The real carve geometry is still computed once at pointer-up by
  // erasePageAnnotations (the shared, pixel-identical engine — unchanged), so
  // deferring the boolean work off the hot path costs zero fidelity.
  const classifyEraserSegment = useCallback((pointer, segment) => {
    const objects = annotationsRef.current?.objects || [];
    const radius = pointer.gestureConfig.radius;
    const queryBounds = segmentQueryBounds(segment, radius);
    const mode = pointer.gestureConfig.mode;
    const partialIds = [];
    const atomicIds = [];
    objects.forEach((object, index) => {
      if (getEraseBlockReason(object)) return;
      if (!indexBoundsAllow(index, queryBounds)) return; // fast reject: nowhere near cursor
      if (!eraserStrokeTouchesObject({ eraserPoints: segment, eraserRadius: radius, object })) return;
      const id = getEraserCandidateId(object, index);
      if (getEraserOperation(object, mode) === 'partial') partialIds.push(id);
      else atomicIds.push(id);
    });
    return {
      shouldPreview: partialIds.length > 0 || atomicIds.length > 0,
      partialIds,
      atomicIds,
    };
  }, [getEraseBlockReason, indexBoundsAllow]);

  const previewEraserGesture = useCallback((pointer, segment) => {
    if (!pointer?.points?.length) return false;
    if (pointer.previewActive && maskCloneRef.current?.root) {
      const testFlags = getEraserHandoffTestFlags();
      if (testFlags?.forceCloneDisconnectOnce === true) {
        testFlags.forceCloneDisconnectOnce = false;
        maskCloneRef.current.root.remove();
      }
      // The real SVG may be removed or replaced during a React/pdf.js swap.
      // Re-parent the exact carved clone before the next paint rather than
      // dropping to flattened pixels or exposing the hidden stale layer.
      ensureMaskCloneConnected();
    }
    if (pointer.previewActive && pointer.previewHasPartial) {
      // Carving is live: O(1) punch of the new segment, plus the cheap
      // non-path ghost check so whole-delete objects crossed mid-carve still
      // vanish live instead of popping out only at release. Callouts ride the
      // same per-segment check (commit-identical hit test) so they ghost the
      // moment the sweep crosses them, exactly like other whole-delete marks.
      drawLiveErasePreviewSegment(segment, pointer.gestureConfig.radius);
      maskCarvedPathHits(pointer, segment);
      ghostAtomicHits(pointer, segment);
      const liveCalloutHits = getPermittedCalloutHitIds(
        segment,
        pointer.previewCalloutIds,
        pointer.gestureConfig.radius,
      );
      if (liveCalloutHits.length) {
        ghostCalloutsFromPreview(liveCalloutHits);
        liveCalloutHits.forEach((id) => pointer.previewCalloutIds.add(id));
      }
      const liveSurveyMarkerHits = getPermittedSurveyMarkerHitIds(
        segment,
        pointer.previewSurveyMarkerIds,
        pointer.gestureConfig.radius,
      );
      if (liveSurveyMarkerHits.length) {
        ghostSurveyMarkersFromPreview(liveSurveyMarkerHits);
        liveSurveyMarkerHits.forEach((id) => pointer.previewSurveyMarkerIds.add(id));
      }
      return true;
    }
    // Pre-carve phase classifies only the NEW segment (earlier segments were
    // already classified by earlier calls; their atomic hits accumulate in
    // previewAtomicIds). classifyEraserSegment replaced the per-move boolean
    // erase engine with the cheap commit-identical touch test + AABB fast-reject
    // (KAL-366): the heavy carve geometry now runs ONCE at pointer-up, not on
    // every pointermove, which is the whole drag-smoothness win.
    const plan = classifyEraserSegment(pointer, segment?.length ? segment : pointer.points);
    // Callout hits must also ACTIVATE the preview: a sweep that only crosses
    // a callout has no shared-store plan hits (callouts are the historical
    // fork), yet it whole-deletes the callout at release — so it needs the
    // same pending-erase presentation a shape-only sweep gets.
    const calloutHitIds = getPermittedCalloutHitIds(
      segment?.length ? segment : pointer.points,
      pointer.previewCalloutIds,
      pointer.gestureConfig.radius,
    );
    const surveyMarkerHitIds = getPermittedSurveyMarkerHitIds(
      segment?.length ? segment : pointer.points,
      pointer.previewSurveyMarkerIds,
      pointer.gestureConfig.radius,
    );
    if (!plan.shouldPreview && !calloutHitIds.length && !surveyMarkerHitIds.length) return false;
    if (!pointer.previewActive) {
      // The exact SVG clone is the only safe live presentation. A flattened
      // canvas cannot distinguish permitted ink from foreign, locked, or
      // atomic content occupying the same pixels.
      if (beginMaskClonePreview()) {
        console.log(`[EraserCarveDiag] page=${pageNumber} base=svg-mask-clone`);
        activatePointerPreview(pointer);
        if (pointer.previewHasPartial) maskCarvedPathHits(pointer, pointer.points);
      } else {
        // SVG can be transiently absent during a page swap. Keep the real
        // presentation visible and retry the exact clone on a later sample;
        // commit still uses the accumulated page-space gesture.
        pointer.pendingPartial = pointer.pendingPartial || plan.partialIds.length > 0;
        plan.atomicIds.forEach((id) => pointer.pendingAtomicIds.add(id));
        calloutHitIds.forEach((id) => pointer.pendingCalloutIds.add(id));
        surveyMarkerHitIds.forEach((id) => pointer.pendingSurveyMarkerIds.add(id));
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
      drawLiveErasePreviewSegment(pointer.points, pointer.gestureConfig.radius);
      maskCarvedPathHits(pointer, pointer.points);
    }
    const newAtomicIds = plan.atomicIds.filter((id) => !pointer.previewAtomicIds.has(id));
    if (newAtomicIds.length) {
      eraseAtomicObjectsFromPreview(newAtomicIds);
      newAtomicIds.forEach((id) => pointer.previewAtomicIds.add(id));
    }
    const newCalloutIds = calloutHitIds.filter((id) => !pointer.previewCalloutIds.has(id));
    if (newCalloutIds.length) {
      ghostCalloutsFromPreview(newCalloutIds);
      newCalloutIds.forEach((id) => pointer.previewCalloutIds.add(id));
    }
    const newSurveyMarkerIds = surveyMarkerHitIds
      .filter((id) => !pointer.previewSurveyMarkerIds.has(id));
    if (newSurveyMarkerIds.length) {
      ghostSurveyMarkersFromPreview(newSurveyMarkerIds);
      newSurveyMarkerIds.forEach((id) => pointer.previewSurveyMarkerIds.add(id));
    }
    return true;
  }, [
    activatePointerPreview,
    beginMaskClonePreview,
    classifyEraserSegment,
    drawLiveErasePreviewSegment,
    eraseAtomicObjectsFromPreview,
    ensureMaskCloneConnected,
    getPermittedCalloutHitIds,
    getPermittedSurveyMarkerHitIds,
    ghostAtomicHits,
    ghostCalloutsFromPreview,
    ghostSurveyMarkersFromPreview,
    maskCarvedPathHits,
    pageNumber,
  ]);

  const applyEraserAndCommit = useCallback(async (eraserPoints, gestureConfig = null) => {
    if (!eraserPoints?.length) return { didPaint: false, expectedRevision: null };
    if (containerRef.current) {
      containerRef.current.dataset.eraserPlanStatus = 'planning';
      containerRef.current.dataset.eraserPlanTargetCount = '0';
    }
    const latestPage = annotationsRef.current || { objects: [] };
    const radius = Number(gestureConfig?.radius) || getPageRadius();
    const mode = gestureConfig?.mode === 'entire' || gestureConfig?.mode === 'full'
      ? gestureConfig.mode
      : (gestureConfig?.mode === 'partial' ? 'partial' : eraserModeRef.current);
    const mutationId = nextEraserMutationId();
    recordAtomicEraseDiagnostic(window, {
      mutationId,
      pageNumber,
      renderer,
      gesture: {
        mode,
        radius,
        points: eraserPoints.map((point) => ({ x: point.x, y: point.y })),
        bounds: getEraserStrokeBounds(eraserPoints, radius),
      },
      auditStatus: 'planning',
      geometryAudits: [],
      geometryAuditSummaries: [],
    });
    if (containerRef.current) {
      containerRef.current.dataset.eraserMutationId = String(mutationId);
      containerRef.current.dataset.eraserAuditStatus = 'planning';
      containerRef.current.dataset.eraserAuditViolationCount = '0';
      containerRef.current.dataset.eraserAuditViolations = '[]';
    }
    const blockedByIndex = (latestPage.objects || []).map((object, index) => {
      const reason = getEraseBlockReason(object);
      if (!reason) return null;
      const id = object?.id || object?.annotationId || object?.pdfAnnotationId || `index:${index}`;
      return { id, reason };
    });
    const commitPlan = async (result) => {

    // Commit recomputes the same permitted hit lists used by the live preview.
    // Raw geometry-only hits here previously let callout commit bypass preview's
    // ownership gate; survey markers likewise stay source/visibility-gated.
    const calloutHitIds = getPermittedCalloutHitIds(eraserPoints, undefined, radius);
    const surveyMarkerHitIds = getPermittedSurveyMarkerHitIds(eraserPoints, undefined, radius);
    const commitLocalTextMarkupErase = () => {
      if (
        typeof onEraseIntentRef.current === 'function'
        || typeof onEraseTextMarkupRef.current !== 'function'
      ) return false;
      try {
        onEraseTextMarkupRef.current(pageNumber, eraserPoints, radius);
        return true;
      } catch (error) {
        console.error('Text markup erase failed:', error);
        return false;
      }
    };

    const originalObjects = Array.isArray(latestPage.objects) ? latestPage.objects : [];
    const targets = buildPageEraseTargets({
      pageNumber,
      originalObjects,
      objectMutations: result.objectMutations,
    });
    const resolveStorageKey = createEraseStorageKeyResolver(pageNumber);
    const originalRecords = originalObjects.map((object, index) => ({
      object,
      index,
      storageKey: resolveStorageKey(object),
    }));
    const targetKeys = new Set(targets.map((target) => target.storageKey));

    for (const calloutId of calloutHitIds) {
      const record = originalRecords.find(({ object }) => (
        classifyEraseObjectKind(object) === 'callout'
        && String(getEraseObjectId(object)) === String(calloutId)
      ));
      if (!record || targetKeys.has(record.storageKey)) continue;
      targets.push({
        domain: 'callout',
        storageKey: record.storageKey,
        kind: 'callout',
        operation: 'delete',
        before: record.object,
        index: record.index,
      });
      targetKeys.add(record.storageKey);
    }

    if (containerRef.current) {
      containerRef.current.dataset.eraserPlanStatus = targets.length > 0 ? 'planned' : 'empty';
      containerRef.current.dataset.eraserPlanTargetCount = String(targets.length);
      containerRef.current.dataset.eraserPlanKinds = targets.map((target) => target.kind).join(',');
    }
    const geometryAuditEnabled = isAtomicEraseGeometryAuditEnabled(
      window,
      import.meta.env.DEV,
    );
    const auditTargets = collectAtomicEraseAuditTargets({
      enabled: geometryAuditEnabled,
      mode,
      targets,
      radius,
      getAnnotationId: getEraseObjectId,
      toPagePolygons: pathObjectToPagePolygons,
    });
    updateAtomicEraseDiagnostic(window, mutationId, {
      auditStatus: auditTargets.length && geometryAuditEnabled ? 'pending-commit' : 'not-needed',
      failedStages: result.failedStages || [],
      candidateAnnotationIds: result.touchedIds,
      rejectedAnnotations: result.rejectedAnnotations || [],
      targets: targets.map((target) => ({
        storageKey: target.storageKey,
        annotationId: getEraseObjectId(target.before),
        kind: target.kind,
        operation: target.operation,
      })),
    });
    if (containerRef.current && !auditTargets.length) {
      containerRef.current.dataset.eraserAuditStatus = 'not-needed';
    }
    if (targets.length === 0) {
      const didEraseTextMarkup = commitLocalTextMarkupErase();
      for (const annotationId of surveyMarkerHitIds) {
        try {
          onEraseSurveyMarkerRef.current?.(annotationId);
        } catch (error) {
          console.error('Survey marker erase failed:', error);
        }
      }
      return {
        didPaint: didEraseTextMarkup || surveyMarkerHitIds.length > 0,
        expectedRevision: null,
      };
    }

    const expectedRevision = mutationId;
    const calloutObjectMutations = buildLocalCalloutEraseMutations(targets);
    const committedObjectMutations = [
      ...result.objectMutations,
      ...calloutObjectMutations,
    ];
    const committedCalloutIds = calloutObjectMutations
      .map((mutation) => mutation.annotationId)
      .filter((id) => id != null);
    const diagnostics = {
      source: 'eraser:commit',
      tool: 'eraser',
      action: 'eraser:apply',
      eraserMutationId: mutationId,
      eraserPoints: eraserPoints.map((point) => ({ x: point.x, y: point.y })),
      eraserRadius: radius,
      eraserMode: mode,
      eraserGestureId: eraserDiagGestureRef.current || null,
      eraserPointerBounds: getEraserStrokeBounds(eraserPoints, radius),
      failedStages: result.failedStages || [],
      candidateAnnotationIds: result.touchedIds,
      rejectedAnnotations: result.rejectedAnnotations || [],
      touchedAnnotationIds: [...new Set([...result.touchedIds, ...committedCalloutIds])],
      finalDeletedAnnotationIds: [...new Set([...result.deletedIds, ...committedCalloutIds])],
      finalChangedAnnotationIds: result.changedIds,
      objectMutations: committedObjectMutations,
      changedObjectsCount: targets.length,
    };
    const commitStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const recordCommitTiming = () => {
      const commitEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const commitMs = Math.round((commitEndedAt - commitStartedAt) * 10) / 10;
      eraseCommitTimingRef.current.set(String(mutationId), commitMs);
      updateAtomicEraseDiagnostic(window, mutationId, { timing: { commitMs } });
      if (containerRef.current) {
        containerRef.current.dataset.eraserCommitMs = String(commitMs);
      }
    };
    if (typeof onEraseIntentRef.current !== 'function') {
      const updatedJSON = {
        ...applyLocalCalloutEraseTargets(result.pageAnnotations, targets),
        eraserPresentationRevision: expectedRevision,
      };
      try {
        const commitResult = await onEraseCommitRef.current?.(updatedJSON, diagnostics);
        annotationsRef.current = updatedJSON;
        if (
          livePreviewCanvasRef.current
          && livePreviewCanvasRef.current.style.display !== 'none'
        ) {
          livePreviewCanvasRef.current.dataset.canvasAnnotationRevision = expectedRevision;
        }
        commitLocalTextMarkupErase();
        for (const annotationId of surveyMarkerHitIds) {
          onEraseSurveyMarkerRef.current?.(annotationId);
        }
        if (auditTargets.length && geometryAuditEnabled) {
          updateAtomicEraseDiagnostic(window, mutationId, { auditStatus: 'pending' });
          scheduleAtomicEraseAudit({
            mutationId,
            targets: auditTargets,
            eraserPoints,
            radius,
          });
        }
        recordCommitTiming();
        if (!geometryAuditEnabled) eraseCommitTimingRef.current.delete(String(mutationId));
        return {
          didPaint: true,
          expectedRevision,
          requireMutationAck: commitResult?.requireMutationAck === true,
        };
      } catch (error) {
        console.error('Local eraser commit failed:', error);
        return { didPaint: false, expectedRevision: null };
      }
    }
    const intent = buildEraseIntent({
      mutationId,
      pageNumber,
      renderer,
      gesture: {
        points: eraserPoints,
        radius,
        mode,
      },
      targets,
      diagnostics,
      presentationRevision: expectedRevision,
    });
    try {
      if (
        import.meta.env.DEV
        && typeof window !== 'undefined'
        && typeof window.__eraserCommitTestGate === 'function'
      ) {
        await window.__eraserCommitTestGate(intent);
      }
      const commitResult = await onEraseIntentRef.current?.(intent);
      if (commitResult?.status !== 'committed' && commitResult?.status !== 'noop') {
        const authoritativePage = commitResult?.byPage?.[String(pageNumber)]
          || commitResult?.byPage?.[pageNumber];
        if (authoritativePage) annotationsRef.current = authoritativePage;
        return { didPaint: false, expectedRevision: null };
      }
      const committedPage = commitResult?.byPage?.[String(pageNumber)]
        || commitResult?.byPage?.[pageNumber]
        || result.pageAnnotations;
      annotationsRef.current = {
        ...committedPage,
        eraserPresentationRevision: expectedRevision,
      };
      if (
        livePreviewCanvasRef.current
        && livePreviewCanvasRef.current.style.display !== 'none'
      ) {
        livePreviewCanvasRef.current.dataset.canvasAnnotationRevision = expectedRevision;
      }
      for (const annotationId of surveyMarkerHitIds) {
        try {
          onEraseSurveyMarkerRef.current?.(annotationId);
        } catch (error) {
          console.error('Survey marker erase failed:', error);
        }
      }
      if (auditTargets.length && geometryAuditEnabled) {
        updateAtomicEraseDiagnostic(window, mutationId, { auditStatus: 'pending' });
        scheduleAtomicEraseAudit({
          mutationId,
          targets: auditTargets,
          eraserPoints,
          radius,
        });
      }
      return {
        didPaint: true,
        expectedRevision,
      };
    } catch (error) {
      updateAtomicEraseDiagnostic(window, mutationId, {
        auditStatus: 'commit-failed',
        commitError: String(error?.message || error),
      });
      console.error('Atomic eraser commit failed:', error);
      return { didPaint: false, expectedRevision: null };
    } finally {
      recordCommitTiming();
      if (!geometryAuditEnabled) eraseCommitTimingRef.current.delete(String(mutationId));
    }
    };
    const result = await planPageErase({
      pageAnnotations: latestPage,
      eraserPoints,
      eraserRadius: radius,
      mode,
    }, blockedByIndex, commitPlan);
    return 'flushedOutcome' in result ? result.flushedOutcome : commitPlan(result);

  }, [
    getEraseBlockReason,
    getPageRadius,
    getPermittedCalloutHitIds,
    getPermittedSurveyMarkerHitIds,
    pageNumber,
    planPageErase,
    renderer,
    scheduleAtomicEraseAudit,
  ]);

  const queueEraserCommit = useCallback((pointer) => {
    const sessionId = pointer?.sessionId;
    const run = () => applyEraserAndCommit(pointer?.points, pointer?.gestureConfig);
    const queued = eraseCommitTailRef.current.then(run, run);
    trackPendingEraseCommit(queued);
    // A failed task must not poison later gestures. `applyEraserAndCommit`
    // normally resolves fail-closed, but keep the queue live even if an
    // unexpected exception escapes it.
    eraseCommitTailRef.current = queued.catch(() => undefined);
    return queued.then((outcome) => {
      if (!mountedRef.current || latestEraseGestureRef.current !== sessionId) {
        return outcome;
      }
      scheduleLiveErasePreviewFinish({
        expectedRevision: outcome.expectedRevision,
        waitForNextPaint: outcome.didPaint,
        requireMutationAck: outcome.requireMutationAck,
      });
      return outcome;
    }).catch((error) => {
      console.error('Eraser commit failed:', error);
      if (mountedRef.current && latestEraseGestureRef.current === sessionId) {
        finishLiveErasePreview();
      }
      return { didPaint: false, expectedRevision: null };
    });
  }, [applyEraserAndCommit, finishLiveErasePreview, scheduleLiveErasePreviewFinish]);

  const cancelPointer = useCallback(() => {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    try { pointer?.captureTarget?.releasePointerCapture(pointer.pointerId); } catch { /* already released */ }
    finishLiveErasePreview();
  }, [finishLiveErasePreview]);
  // Interrupted gestures COMMIT what was already erased instead of discarding
  // it: by the time a pointercancel / lostpointercapture / buttons-released-
  // elsewhere arrives, the user has already watched ink carve and shapes
  // ghost — silently un-erasing that work reads as "the eraser randomly
  // doesn't take" (2026-07-19 audit). Same contract as the zoom auto-commit.
  const commitInterruptedPointer = useCallback(async (pointer) => {
    if (!pointer?.points?.length) {
      finishLiveErasePreview();
      return;
    }
    try {
      markAnnotationPointerRelease(eraserDiagGestureRef.current, { action: 'eraser-stroke' });
      await queueEraserCommit(pointer);
    } catch (error) {
      console.error('Interrupted eraser commit failed:', error);
      if (latestEraseGestureRef.current === pointer.sessionId) finishLiveErasePreview();
    }
  }, [finishLiveErasePreview, queueEraserCommit]);

  const commitPointerNow = useCallback(() => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    pointerRef.current = null;
    try { pointer.captureTarget?.releasePointerCapture(pointer.pointerId); } catch { /* already released */ }
    void commitInterruptedPointer(pointer);
  }, [commitInterruptedPointer]);

  const cancelPointerNow = useCallback(() => {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    try { pointer?.captureTarget?.releasePointerCapture(pointer.pointerId); } catch { /* already released */ }
    gestureBoundsRef.current = null;
    // Revocation means the preview must be restored, never handed off to a
    // commit repaint that is no longer authorized.
    restoreLiveErasePreviewImmediately();
    updateEraserCursor(null, false);
  }, [restoreLiveErasePreviewImmediately, updateEraserCursor]);

  useLayoutEffect(() => {
    if (getInterruptionPolicy() === 'cancel') cancelPointerNow();
  }, [cancelPointerNow, getInterruptionPolicy, interruptionPolicy]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 || spaceHeldRef.current) return;
    // Read-only/locked state is also checked at gesture start. Cancelling the
    // active pointer is insufficient if the surface remains mounted.
    if (getInterruptionPolicy() === 'cancel') return;
    // One pointer owns a gesture. A palm/second pointer is input noise and
    // must not release capture, clear preview, or replace the active pen.
    if (event.isPrimary === false || pointerRef.current) return;
    lastClientPosRef.current = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
    const point = pagePoint(event.nativeEvent);
    if (!point) return;
    updateEraserCursor(point, true);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sessionId = eraseGestureSequenceRef.current + 1;
    eraseGestureSequenceRef.current = sessionId;
    latestEraseGestureRef.current = sessionId;
    pointerRef.current = {
      sessionId,
      pointerId: event.pointerId,
      points: [point],
      captureTarget: event.currentTarget,
      // Gesture behavior is immutable after pointer-down. Toolbar updates
      // affect the next gesture only, so preview and commit cannot disagree.
      gestureConfig: {
        mode: eraserModeRef.current,
        radius: getPageRadius(),
      },
      sourceObjects: annotationsRef.current?.objects,
      previewActive: false,
      previewHasPartial: false,
      previewAtomicIds: new Set(),
      previewCalloutIds: new Set(),
      previewSurveyMarkerIds: new Set(),
      pendingPartial: false,
      pendingAtomicIds: new Set(),
      pendingCalloutIds: new Set(),
      pendingSurveyMarkerIds: new Set(),
    };
    eraserDiagGestureRef.current = beginAnnotationGesture({
      surface: 'FabricEraserCanvas',
      tool: 'eraser',
      type: 'annotation',
      action: 'eraser-stroke',
      pointerDown: true,
      pageNumber,
    });
    // Snapshot page-unit bounds ONCE up front so every pointer-move can
    // fast-reject far-away annotations (the drag-smoothness prefilter).
    buildGestureBounds();
    previewEraserGesture(pointerRef.current, [point]);
  }, [
    buildGestureBounds,
    getPageRadius,
    getInterruptionPolicy,
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
    // Pointer capture owns the gesture until pointerup, pointercancel, or
    // lostpointercapture. Chromium can emit a transient hover-like
    // pointermove with buttons=0 during a long captured drag; treating that
    // sample as release made the eraser blink and permanently stop mid-drag.
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
  }, [pagePoint, previewEraserGesture, updateEraserCursor]);

  const finishPointer = useCallback((event, cancelled) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (cancelled) {
      // pointercancel (OS gesture takeover etc.): commit the erase performed
      // so far — the user already saw it happen live.
      void commitInterruptedPointer(pointer);
      // Large sizes still use the custom circle. Re-show it at the last known
      // spot after the preview swap.
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
    void queueEraserCommit(pointer);
  }, [
    commitInterruptedPointer,
    pagePoint,
    previewEraserGesture,
    queueEraserCommit,
    reshowCursorAtLastClientPos,
    updateEraserCursor,
  ]);

  const handleLostPointerCapture = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    // Losing capture mid-gesture: keep the erase performed so far.
    commitPointerNow();
    // Same reasoning as the cancelled branch of finishPointer: losing capture
    // does not mean the pointer left the wrapper — keep a visible cursor.
    reshowCursorAtLastClientPos();
  }, [commitPointerNow, reshowCursorAtLastClientPos]);

  const commitPointerForZoom = useCallback(async () => {
    const pointer = pointerRef.current;
    if (!pointer) {
      const sourceState = livePreviewSourceRef.current;
      if (
        sourceState?.handoffState === 'waiting'
        || sourceState?.handoffState === 'safe-hold'
      ) {
        // SVG viewBox remains the sole zoom owner. Retain and re-parent the
        // exact clone; only an exact committed revision may end this handoff.
        ensureMaskCloneConnected();
        sourceState.checkReady?.();
        return;
      }
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
      await queueEraserCommit(pointer);
    } catch (error) {
      console.error('Zoom-triggered eraser commit failed:', error);
      if (latestEraseGestureRef.current === pointer.sessionId) finishLiveErasePreview();
    }
  }, [
    ensureMaskCloneConnected,
    finishLiveErasePreview,
    queueEraserCommit,
  ]);

  useEffect(() => {
    if (zoomGeneration === initialZoomGenerationRef.current) return;
    initialZoomGenerationRef.current = zoomGeneration;
    // UX: zoom starting mid-swipe COMMITS the partial erase instead of
    // discarding it — the zoomGeneration contract's intent (and
    // FabricDrawingCanvas's behavior) is auto-commit before the host
    // re-layouts; a cancel here silently threw away the user's erase.
    void commitPointerForZoom();
    updateEraserCursor(null, false);
    // Large sizes use the custom circle. Re-show it once the zoom re-layout lands:
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
      // Switching to space-pan mid-gesture keeps the erase already shown
      // (commit, don't discard) — same contract as the zoom auto-commit.
      commitPointerNow();
      updateEraserCursor(null, false);
    };
    const releaseSpacePan = (event) => {
      if (event && !isSpaceKey(event)) return;
      spaceHeldRef.current = false;
    };
    // Window blur must ALWAYS release the space-pan latch (the keyup is lost
    // to the other window). Passing the FocusEvent into releaseSpacePan used
    // to trip its isSpaceKey guard and leave spaceHeldRef stuck true — the
    // large custom circle could then stay hidden until space was pressed and
    // released again.
    const releaseSpacePanOnBlur = () => releaseSpacePan(null);
    window.addEventListener('keydown', activateSpacePan, true);
    window.addEventListener('keyup', releaseSpacePan, true);
    window.addEventListener('blur', releaseSpacePanOnBlur);
    return () => {
      window.removeEventListener('keydown', activateSpacePan, true);
      window.removeEventListener('keyup', releaseSpacePan, true);
      window.removeEventListener('blur', releaseSpacePanOnBlur);
    };
  }, [commitPointerNow, updateEraserCursor]);

  // Keep unmount cleanup isolated from callback identity changes. The old
  // dependency-bound effect also ran its cleanup during ordinary rerenders,
  // which could discard an active gesture when mode/size props changed.
  unmountCleanupRef.current = () => {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    try { pointer?.captureTarget?.releasePointerCapture(pointer.pointerId); } catch { /* already released */ }
    if (
      pointer?.points?.length
      && getInterruptionPolicy() !== 'cancel'
    ) {
      try {
        markAnnotationPointerRelease(eraserDiagGestureRef.current, { action: 'eraser-stroke' });
        void queueEraserCommit(pointer);
      } catch (error) {
        console.error('Unmount-triggered eraser commit failed:', error);
      }
    }
    gestureBoundsRef.current = null;
    // Unmounting has no future paint to coordinate; clean up immediately.
    finishLiveErasePreview({ immediate: true });
    removeMaskCloneNow();
    hidePreviewCanvasNow();
    updateEraserCursor(null, false);
  };

  useLayoutEffect(() => () => {
    unmountCleanupRef.current?.();
  }, []);

  return (
    <div
      ref={containerRef}
      data-diag-eraser-wrapper={pageNumber}
      data-diag-eraser-interruption-policy={
        import.meta.env.DEV ? getInterruptionPolicy() : undefined
      }
      data-eraser-renderer={renderer}
      data-eraser-object-count={Array.isArray(annotations?.objects) ? annotations.objects.length : 0}
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
        // Keep ordinary pointer motion in the browser/OS cursor path. The old
        // JS-only circle froze whenever a settled erase briefly used the main
        // thread, even though the physical pointer had kept moving.
        cursor: eraserCursor || 'crosshair',
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
