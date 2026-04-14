/**
 * SVGAnnotationLayer
 *
 * SVG annotation layer that renders Fabric.js JSON annotations
 * as SVG elements using viewBox-based auto-scaling. Supports click-to-select,
 * hover feedback, and selection overlays (bounding box + handles).
 *
 * Key architecture:
 * - Single <svg viewBox="0 0 pageWidth pageHeight"> per page
 * - All coordinates in unscaled PDF page space
 * - Browser handles zoom scaling automatically via viewBox
 * - vector-effect="non-scaling-stroke" keeps stroke widths constant
 * - mix-blend-mode: multiply for highlight annotations
 * - pathOffset transform chain for correct pen stroke positioning
 * - Selection handles use inverseScale for constant visual pixel size
 *
 * Phase 8 Plan 01: Tier 1 types (paths, rects, lines, arrows) + stubs for tier 2
 * Phase 8 Plan 02: Tier 2 types (ellipse, text, callouts) + full three-layer filtering
 * Phase 9 Plan 01: Click-to-select, hover feedback, selection overlay with handles
 * Phase 9 Plan 02: Drag-to-move, resize-by-handle, rotation visual + pointer wiring
 * Phase 9 Plan 03: Multi-select group ops (group-move visual, group bbox, delete)
 */
import React, { memo, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import {
  renderPath,
  renderRect,
  renderLine,
  renderArrow,
  renderEllipse,
  renderText,
  renderCallout,
  renderCounter,
} from '../utils/svgAnnotationRenderers';
import { calculateCalloutConnection } from '../utils/calloutGeometry';
import { useSVGInteraction } from '../hooks/useSVGInteraction';
import SVGSelectionOverlay from './SVGSelectionOverlay';
import RotationInputField from './RotationInputField';
import { getAnnotationBBox, getGroupBBox, isImportedPath, getLineEndpoints } from '../utils/svgBoundingBox';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getAnnotationVisibilityScope,
  isAnnotationVisibleByPageControl
} from '../utils/annotationVisibilityRules';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PREVIEW_OBJECTS = 420;
const MAX_PREVIEW_CALLOUTS = 140;


const formatDashArrayForDebug = (dashArray) => {
  if (!Array.isArray(dashArray) || dashArray.length === 0) return 'none';
  return dashArray
    .map((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : value;
    })
    .join(',');
};

const formatPdfLineEndingsForDebug = (lineEndings) => {
  if (!Array.isArray(lineEndings) || lineEndings.length === 0) return 'none';
  return lineEndings
    .map((value) => (typeof value === 'string' ? value.replace(/^\//, '') : 'None'))
    .join('>');
};

const summarizeImportedSvgAnnotationForDebug = (obj, index) => ({
  id: obj?.pdfAnnotationId || `idx-${index}`,
  pdfType: obj?.pdfAnnotationType || 'unknown',
  renderType: obj?.type || 'unknown',
  renderPartType: obj?.data?.type || null,
  renderTool: obj?.tool || null,
  dash: formatDashArrayForDebug(obj?.strokeDashArray),
  lineEndings: formatPdfLineEndingsForDebug(obj?.data?.pdfLineEndings),
  isImportedPath: isImportedPath(obj),
  spaceId: obj?.spaceId || null,
  regionId: obj?.regionId || null,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SVGAnnotationLayer = memo(({
  pageNumber,
  width,          // unscaled PDF page width (e.g., 612)
  height,         // unscaled PDF page height (e.g., 792)
  annotations,    // Fabric.js JSON { objects: [...] }
  callouts,       // array of callout objects
  // Filtering props
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
  // Selection / interaction props (Phase 9)
  onSaveAnnotations,   // (updatedJSON, saveContext) => void
  onRequestEditMode,   // (annotationIndex, annotationType) => void
  activeTool,          // string — current tool (e.g., 'pan', 'pen', etc.)
  editingAnnotationIndex, // number | null — index of annotation currently being edited in FabricEditCanvas (hidden in SVG)
}) => {
  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const svgRef = useRef(null);
  const importedDebugRef = useRef(null);
  // Tracks an in-flight counter rotation drag so pointermove updates can carry
  // the counter center (in viewBox/page space) without recomputing it each frame.
  // Cleared on pointerup.
  const counterRotateDragRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Interaction hook (Phase 9)
  // ---------------------------------------------------------------------------
  const {
    selectedIds, hoveredId, inverseScale, interactionState, visualTransform,
    handleAnnotationPointerDown, handleAnnotationPointerEnter,
    handleAnnotationPointerLeave, handleAnnotationDoubleClick,
    handleSvgPointerDown, handleHandlePointerDown,
    handlePointerMove, handlePointerUp,
    isSelected, deleteSelected,
    // EDIT-12 Gap 1 fix (Plan 12-03): optimistic rotation paint
    applyOptimisticRotation, clearOptimisticRotation,
  } = useSVGInteraction({
    svgRef, annotations, pageWidth: width, pageHeight: height,
    onSaveAnnotations, onRequestEditMode,
  });

  // Determine pointer events mode: interactive when select tool active AND not in edit mode
  // When editingAnnotationIndex is set, FabricEditCanvas + MiniToolbar need to receive clicks
  const isInteractive = (activeTool === 'select' || activeTool === 'text-select') && editingAnnotationIndex == null;

  // ---------------------------------------------------------------------------
  // EDIT-12: RotationInputField visibility state machine (Phase 12 Plan 02)
  // ---------------------------------------------------------------------------
  // 3-state machine: hidden / visible / closing(grace).
  // - Visible after 150ms hover-intent on the mtr handle, OR immediately on
  //   active rotation drag.
  // - 500ms grace period after cursor leaves the handle so the user can
  //   travel to the input pill and click into it.
  // - Hidden when no shape is selected, or after grace expiry without re-entry.
  // Drag overrides everything (computed below as `showRotationInput`).
  const [rotInputVisible, setRotInputVisible] = useState(false);
  const rotInputHoverTimerRef = useRef(null);
  const rotInputCloseTimerRef = useRef(null);
  // UX: rotInputHoveredRef tracks whether the cursor is currently over EITHER
  // the mtr handle OR the input pill. The 500ms close timer only fires when
  // both are false. This bridges the gap between the SVG handle (DOM-level
  // pointerenter listener) and the HTML input portal (React onPointerEnter).
  const rotInputHoveredRef = useRef(false);

  // Issue 4 visibility-flicker fix (Commit H): mirror rotInputVisible into a
  // ref so the DOM event handlers (onEnter/onLeave inside the visibility
  // effect) can read the current value via the ref WITHOUT having
  // rotInputVisible in their effect's dependency array. Reading rotInputVisible
  // directly inside the closures forced the effect to re-run on every
  // visibility change — which tore down and re-attached the pointerenter/
  // pointerleave listeners on the mtr handle. That tear-down/re-attach
  // ate pointer events and put the visibility into a flicker loop.
  // The ref lets the closures stay current without re-running the effect.
  const rotInputVisibleRef = useRef(false);
  useEffect(() => { rotInputVisibleRef.current = rotInputVisible; }, [rotInputVisible]);

  // Diagnostic helper: wrap setRotInputVisible so we can log who's toggling
  // visibility and from where. The flicker investigation needs to know which
  // call site is firing in the loop.
  const setRotInputVisibleDbg = useCallback((next, reason) => {
    if (typeof next === 'function') {
      setRotInputVisible(prev => {
        const computed = next(prev);
        console.log(`[SVGAnnotationLayer] setRotInputVisible(${computed}) reason=${reason} prev=${prev}`);
        return computed;
      });
    } else {
      console.log(`[SVGAnnotationLayer] setRotInputVisible(${next}) reason=${reason}`);
      setRotInputVisible(next);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Delete key handler — delete selected annotations on Delete/Backspace
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const handleKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      // Don't delete if user is typing in a form field
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.contentEditable === 'true')) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, deleteSelected]);

  // ---------------------------------------------------------------------------
  // EDIT-13 (Phase 13 Plan 13-01): Delegated hover-intent listeners on svgRef
  // ---------------------------------------------------------------------------
  // Event delegation pattern: ONE pair of listeners on the stable svgRef.current
  // (SVG root ancestor, persists across all selection / edit-mode / annotation
  // reconciliations). Fires onOver/onOut for the mtr handle via
  // e.target.closest('[data-rotation-handle="mtr"]') so the mtr <g> can be
  // unmounted/remounted by React reconciliation without re-attaching listeners.
  //
  // Uses pointerover/pointerout (which BUBBLE per DOM Level 3 Events) rather
  // than pointerenter/pointerleave (which do NOT bubble and never reach svgRef
  // from descendants). The `e.relatedTarget && mtr.contains(e.relatedTarget)`
  // guard emulates enter/leave semantics (ignore internal-subtree traversals).
  //
  // Replaces the Phase 12 direct-attach pattern at :232-297 which had a
  // stale-ref bug when the mtr <g> DOM node was replaced by React reconciliation
  // (Gap 3 from v2.1 12-VERIFICATION.md).
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    // Edit-mode gate: pill NEVER arms while the user is mid-edit. Un-arms on
    // edit entry (clears pending open timer and any visible pill). This is the
    // effect-top short-circuit that closes Gap 3 alongside the delegation fix.
    if (editingAnnotationIndex != null) {
      setRotInputVisibleDbg(false, 'in edit mode');
      if (rotInputHoverTimerRef.current) {
        clearTimeout(rotInputHoverTimerRef.current);
        rotInputHoverTimerRef.current = null;
      }
      if (rotInputCloseTimerRef.current) {
        clearTimeout(rotInputCloseTimerRef.current);
        rotInputCloseTimerRef.current = null;
      }
      return;
    }

    // UX: only show input when exactly one shape is selected. Multi-select and
    // empty selection clear timers and hide the pill (visibility gate).
    if (!selectedIds || selectedIds.size !== 1) {
      setRotInputVisibleDbg(false, 'selectedIds.size !== 1');
      if (rotInputHoverTimerRef.current) {
        clearTimeout(rotInputHoverTimerRef.current);
        rotInputHoverTimerRef.current = null;
      }
      if (rotInputCloseTimerRef.current) {
        clearTimeout(rotInputCloseTimerRef.current);
        rotInputCloseTimerRef.current = null;
      }
      return;
    }

    const onOver = (e) => {
      const mtr = e.target?.closest?.('[data-rotation-handle="mtr"]');
      if (!mtr) return;
      // Emulate pointerenter: fire only when the pointer crosses INTO the mtr
      // subtree from outside. If relatedTarget is already inside mtr, this is
      // just internal bubbling — ignore.
      if (e.relatedTarget && mtr.contains(e.relatedTarget)) return;

      // Read visibility via ref (Issue 4 flicker fix) so this closure stays
      // current without forcing the effect to re-run on every visibility flip.
      rotInputHoveredRef.current = true;
      // Cancel any pending close timer — user came back to the handle
      if (rotInputCloseTimerRef.current) {
        clearTimeout(rotInputCloseTimerRef.current);
        rotInputCloseTimerRef.current = null;
      }
      // UX: 150ms hover-intent open delay matches tooltip conventions —
      // prevents flicker when the cursor crosses the handle without intent.
      if (!rotInputVisibleRef.current && !rotInputHoverTimerRef.current) {
        rotInputHoverTimerRef.current = setTimeout(() => {
          setRotInputVisibleDbg(true, '150ms hover-intent fired');
          rotInputHoverTimerRef.current = null;
        }, 150);
      }
    };

    const onOut = (e) => {
      const mtr = e.target?.closest?.('[data-rotation-handle="mtr"]');
      if (!mtr) return;
      // Emulate pointerleave: fire only when the pointer crosses OUT of the mtr
      // subtree to something outside. If relatedTarget is still inside mtr, this
      // is internal bubbling — ignore.
      if (e.relatedTarget && mtr.contains(e.relatedTarget)) return;

      rotInputHoveredRef.current = false;
      // Cancel pending open timer if user left before 150ms elapsed
      if (rotInputHoverTimerRef.current) {
        clearTimeout(rotInputHoverTimerRef.current);
        rotInputHoverTimerRef.current = null;
      }
      // UX: 500ms grace close gives the user time to travel ~100px from the
      // handle to the input pill and click into it. Only fires the actual
      // hide if the cursor still isn't over the input or handle when the
      // timer expires AND the pill input doesn't currently hold focus.
      // The activeElement guard is the load-bearing fix from Plan 12-02 Round 7:
      // pointerenter on the portaled pill div doesn't always fire (cursor can
      // teleport over it during a click), so hover state alone is unreliable.
      // If the user is typing in the input, we know they're engaged regardless
      // of hover. DO NOT REMOVE the activeElement check.
      if (rotInputVisibleRef.current && !rotInputCloseTimerRef.current) {
        rotInputCloseTimerRef.current = setTimeout(() => {
          const ae = document.activeElement;
          const focusedInPill = !!(ae && ae.closest && ae.closest('[data-rotation-input-field]'));
          if (focusedInPill) {
            // Plan 12-02 Round 7 fix — DO NOT remove
          } else if (!rotInputHoveredRef.current) {
            setRotInputVisibleDbg(false, '500ms grace expired (mtr leave path)');
          }
          rotInputCloseTimerRef.current = null;
        }, 500);
      }
    };

    svgEl.addEventListener('pointerover', onOver);
    svgEl.addEventListener('pointerout', onOut);

    return () => {
      svgEl.removeEventListener('pointerover', onOver);
      svgEl.removeEventListener('pointerout', onOut);
      if (rotInputHoverTimerRef.current) clearTimeout(rotInputHoverTimerRef.current);
      if (rotInputCloseTimerRef.current) clearTimeout(rotInputCloseTimerRef.current);
    };
    // CRITICAL: rotInputVisible is INTENTIONALLY NOT in the deps. We read it
    // via rotInputVisibleRef.current inside the closures so this effect only
    // re-runs when selectedIds or editingAnnotationIndex changes. This prevents
    // the visibility flicker loop where every setRotInputVisible(true/false)
    // tore down and re-attached the pointerover/pointerout listeners, eating
    // pointer events. The eslint-disable below is LOAD-BEARING. Do NOT add
    // annotations, visualTransform, or rotInputVisible to the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, setRotInputVisibleDbg, editingAnnotationIndex]);

  // ---------------------------------------------------------------------------
  // EDIT-12: Derived state for RotationInputField props
  // ---------------------------------------------------------------------------
  // UX: active rotation drag forces the input visible regardless of hover
  // state — the input live-updates with the integer-rounded angle as the
  // shape rotates. This is the "drag wins" rule from CONTEXT.md.
  const isRotating = !!(visualTransform?.rotate);
  const showRotationInput = isRotating || rotInputVisible;

  const selectedAnnotationIndex = (selectedIds && selectedIds.size === 1)
    ? Array.from(selectedIds)[0]
    : null;
  // Live angle source: read from visualTransform during drag (single source
  // of truth — Pitfall 9), otherwise from the persisted obj.angle.
  const persistedAngle = (selectedAnnotationIndex !== null)
    ? (annotations?.objects?.[selectedAnnotationIndex]?.angle || 0)
    : 0;
  const liveRotationAngle = isRotating ? visualTransform.rotate.angle : persistedAngle;

  // EDIT-12: shape center in viewBox (page) coordinates. RotationInputField
  // converts this to screen coords via svgRef.current.getScreenCTM() and
  // uses it as the "anchor" for the radial pill placement (pill sits along
  // the ray from shapeCenter through the mtr handle, on the OUTSIDE).
  // The center is the bbox center of the unrotated bbox — invariant under
  // rotation since the SVGSelectionOverlay rotates around (cx, cy).
  //
  // useMemo is critical (Issue 4 fix): without it, this returns a fresh
  // {x, y} object on every parent render, which invalidates RotationInputField's
  // position useEffect dependency array on every parent re-render. That triggers
  // a high-frequency render loop on the child which interferes with the
  // controlled-input onChange and silently drops typed characters. Memoizing
  // on [selectedAnnotationIndex, annotations] gives a stable reference until
  // the selected annotation actually changes.
  const shapeCenterViewBox = useMemo(() => {
    if (selectedAnnotationIndex === null) return null;
    const obj = annotations?.objects?.[selectedAnnotationIndex];
    if (!obj) return null;
    const bbox = getAnnotationBBox(obj);
    return {
      x: bbox.left + bbox.width / 2,
      y: bbox.top + bbox.height / 2,
    };
  }, [selectedAnnotationIndex, annotations]);

  // EDIT-12 Gap 1 fix (Plan 12-03): track pending optimistic rotation so the
  // cleanup useEffect (below) can clear visualTransform once the persisted
  // annotation angle catches up. Stored in a ref (not state) so setting it
  // does not trigger a re-render.
  const pendingOptimisticRotationRef = useRef(null);

  const handleRotationInputCommit = useCallback((annotationIndex, newAngle) => {
    if (annotationIndex === null || annotationIndex === undefined) return;

    // EDIT-12 Gap 1 fix: optimistic visual paint FIRST — cheap SVG transform
    // that makes the shape appear at the new angle on the next frame. This
    // matches the drag-rotate pattern (useSVGInteraction.js handlePointerMove
    // rotate branch) where visualTransform.rotate is set on every tick and
    // onSaveAnnotations only fires on pointerup. Drag feels instant because
    // the user sees the optimistic paint before the heavy save pipeline runs.
    // Typed-commit lag (UAT Gap 1) came from skipping this step and going
    // straight to onSaveAnnotations, which runs history fingerprinting +
    // JSON.stringify + deep-compare before React can re-render.
    applyOptimisticRotation(annotationIndex, newAngle);
    pendingOptimisticRotationRef.current = { annotationIndex, angle: newAngle };

    // Existing heavy save path — unchanged. Runs in parallel with the optimistic
    // paint; when the persisted annotation eventually reflects the new angle,
    // the cleanup useEffect below clears visualTransform.
    const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
    if (!updatedAnnotations.objects?.[annotationIndex]) {
      pendingOptimisticRotationRef.current = null;
      clearOptimisticRotation();
      return;
    }
    updatedAnnotations.objects[annotationIndex].angle = newAngle;
    onSaveAnnotations(updatedAnnotations, {
      source: 'rotation-input',
      action: 'rotate',
      checkpointPolicy: 'normal',
    });
  }, [annotations, onSaveAnnotations, applyOptimisticRotation, clearOptimisticRotation]);

  // EDIT-12 Gap 1 fix (Plan 12-03): clear the optimistic visualTransform
  // once the persisted annotation angle catches up to the pending commit.
  // This is the counterpart to the optimistic set in handleRotationInputCommit.
  //
  // We round both angles to integers before comparing because the input UI
  // only displays/accepts integer degrees (per 12-CONTEXT.md "Integer degrees
  // only"); the persisted angle may be a float from drag-rotate or from
  // prior edits. Rounding avoids a false "still pending" state when the
  // stored angle is e.g. 135.0000001.
  //
  // Running on `annotations` prop change means this fires on the React
  // render that includes the new angle — exactly the moment the optimistic
  // paint becomes redundant and can be cleared. We do NOT read or write
  // visualTransform directly here (it's owned by useSVGInteraction);
  // clearOptimisticRotation() routes through the hook's setter.
  useEffect(() => {
    const pending = pendingOptimisticRotationRef.current;
    if (!pending) return;
    const persistedObj = annotations?.objects?.[pending.annotationIndex];
    if (!persistedObj) {
      pendingOptimisticRotationRef.current = null;
      clearOptimisticRotation();
      return;
    }
    const persistedAngle = persistedObj.angle || 0;
    if (Math.round(persistedAngle) === Math.round(pending.angle)) {
      pendingOptimisticRotationRef.current = null;
      clearOptimisticRotation();
    }
  }, [annotations, clearOptimisticRotation]);

  const handleRotationInputCancel = useCallback(() => {
    // EDIT-12 Gap 1 fix (Plan 12-03): drop any in-flight optimistic paint on
    // Escape. Prevents a brief visual flash if the user types + Enter and
    // then Escape in quick succession.
    if (pendingOptimisticRotationRef.current) {
      pendingOptimisticRotationRef.current = null;
      clearOptimisticRotation();
    }
    // No-op otherwise — input handles its own state revert. Parent doesn't
    // track typed value. Escape simply blurs the input and the displayed
    // angle snaps back to props.angle (the persisted value).
  }, [clearOptimisticRotation]);

  // Issue 4 flicker fix: handleRotationInputHoverChange is a child callback,
  // so its identity matters — every reference change invalidates the child's
  // useCallback chains that depend on onHoverChange. Read rotInputVisible
  // and isRotating via refs so this callback is STABLE across visibility
  // and rotation changes.
  const isRotatingRef = useRef(false);
  useEffect(() => { isRotatingRef.current = isRotating; }, [isRotating]);

  const handleRotationInputHoverChange = useCallback((hovered) => {
    console.log(`[SVGAnnotationLayer] pill onHoverChange(${hovered}) visibleRef=${rotInputVisibleRef.current} rotatingRef=${isRotatingRef.current}`);
    rotInputHoveredRef.current = hovered;
    if (hovered) {
      // Cancel grace timer if cursor entered the input itself — keeps the
      // pill open while the user is interacting with it.
      if (rotInputCloseTimerRef.current) {
        console.log(`[SVGAnnotationLayer] pill onHoverChange(true) — cancelling close timer`);
        clearTimeout(rotInputCloseTimerRef.current);
        rotInputCloseTimerRef.current = null;
      }
    } else {
      // UX: cursor left the input — start the same 500ms grace timer so
      // the user can travel back to the handle without dismissing the pill.
      // Suppressed during active rotation drag (drag overrides visibility).
      if (rotInputVisibleRef.current && !rotInputCloseTimerRef.current && !isRotatingRef.current) {
        console.log(`[SVGAnnotationLayer] pill onHoverChange(false) — scheduling 500ms grace`);
        rotInputCloseTimerRef.current = setTimeout(() => {
          // Same activeElement guard as the mtr-leave path — if the user is
          // currently typing in the pill input, never hide regardless of hover.
          const ae = document.activeElement;
          const focusedInPill = !!(ae && ae.closest && ae.closest('[data-rotation-input-field]'));
          if (focusedInPill) {
            console.log(`[SVGAnnotationLayer] grace timer expired but pill input is focused, NOT hiding`);
          } else if (!rotInputHoveredRef.current) {
            setRotInputVisibleDbg(false, '500ms grace expired (pill leave path)');
          } else {
            console.log(`[SVGAnnotationLayer] grace timer expired but cursor came back, NOT hiding`);
          }
          rotInputCloseTimerRef.current = null;
        }, 500);
      }
    }
    // No reactive deps — all state read via refs. setRotInputVisibleDbg is
    // already stable (useCallback with empty deps).
  }, [setRotInputVisibleDbg]);

  // ---------------------------------------------------------------------------
  // Helper: derive spaceId from regionId by searching through spaces data
  // ---------------------------------------------------------------------------
  const getSpaceIdForRegion = useMemo(() => {
    return (regionId) => {
      if (!regionId || !spaces || spaces.length === 0) return null;
      for (const space of spaces) {
        for (const page of (space.assignedPages || [])) {
          for (const region of (page.regions || [])) {
            if (region.regionId === regionId) return space.id;
          }
        }
      }
      return null;
    };
  }, [spaces]);

  // ---------------------------------------------------------------------------
  // Filter annotation objects — returns { obj, index, element }[] for wrapping
  // (Selection wrapping happens in render body to avoid useMemo invalidation
  //  on every selection/hover change)
  // ---------------------------------------------------------------------------
  const filteredAnnotations = useMemo(() => {
    const objects = Array.isArray(annotations?.objects)
      ? annotations.objects
      : [];

    if (objects.length === 0) return [];

    // Compute region overlay state for this page
    let isOverlayEnabledForThisPage = false;
    if (activeRegions !== null && selectedSpaceId && isRegionOverlayEnabled) {
      const space = spaces?.find((s) => s.id === selectedSpaceId);
      if (space) {
        const page = space.assignedPages?.find((p) => p.pageId === pageNumber);
        if (page) {
          isOverlayEnabledForThisPage = isRegionOverlayEnabled(selectedSpaceId, pageNumber, page);
        }
      }
    }
    const hasActiveRegions =
      activeRegions !== null &&
      Array.isArray(activeRegions) &&
      activeRegions.length > 0 &&
      isOverlayEnabledForThisPage;

    const results = [];
    let count = 0;

    for (let i = 0; i < objects.length; i++) {
      if (count >= MAX_PREVIEW_OBJECTS) break;

      const obj = objects[i];
      if (!obj || obj.visible === false) continue;

      // --- Layer visibility check ---
      const layer = obj.layer || 'native';
      if (layerVisibility && layerVisibility[layer] === false) continue;

      // --- Three-layer filtering (ported from PAL lines 8625-8840) ---
      const visibilityScope = getAnnotationVisibilityScope({
        moduleId: obj.moduleId,
        regionId: obj.regionId
      });
      const isSurveyAnnotation =
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY ||
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
      const isScopedRegionAnnotation =
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.REGION ||
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
      const derivedSpaceId = isScopedRegionAnnotation ? getSpaceIdForRegion(obj.regionId) : null;

      // 1. Space matching
      let matchesSpace = true;
      if (hasActiveRegions && !isScopedRegionAnnotation) {
        matchesSpace = true;
      } else if (isScopedRegionAnnotation && derivedSpaceId !== null) {
        matchesSpace = activeSpaceId !== null && derivedSpaceId === activeSpaceId;
      } else {
        matchesSpace = true;
      }

      // 2. Survey visibility
      let surveyAnnotationVisible = true;
      if (isSurveyAnnotation) {
        surveyAnnotationVisible =
          showSurveyPanel && selectedModuleId !== null && obj.moduleId === selectedModuleId;
      } else if (!isScopedRegionAnnotation) {
        surveyAnnotationVisible = !(showSurveyPanel && selectedModuleId !== null);
      }

      // 3. Scoped region visibility
      let scopedRegionAnnotationVisible = true;
      if (isScopedRegionAnnotation) {
        if (activeSpaceId === null) {
          scopedRegionAnnotationVisible = false;
        } else if (hasActiveRegions) {
          scopedRegionAnnotationVisible = true;
        } else if (activeRegionId !== null) {
          scopedRegionAnnotationVisible = obj.regionId === activeRegionId;
        } else {
          scopedRegionAnnotationVisible = false;
        }
      }

      // 4. Page-level visibility controls for canvas-scoped vs survey-scoped annotations.
      let pageScopedAnnotationVisible = true;
      if (!isScopedRegionAnnotation && selectedSpaceId !== null) {
        pageScopedAnnotationVisible = isAnnotationVisibleByPageControl({
          scope: visibilityScope,
          canvasVisible: getCanvasAnnotationVisibilityState
            ? getCanvasAnnotationVisibilityState(selectedSpaceId, pageNumber)
            : true,
          surveyVisible: getSurveyAnnotationVisibilityState
            ? getSurveyAnnotationVisibilityState(selectedSpaceId, pageNumber)
            : true
        });
      }

      // 5. Final visibility
      const isVisible =
        matchesSpace &&
        surveyAnnotationVisible &&
        scopedRegionAnnotationVisible &&
        pageScopedAnnotationVisible;

      if (!isVisible) continue;

      // Match PAL interaction rules:
      // - Background annotations stay visible in a space when the lightbulb is on,
      //   but they are not selectable/editable.
      // - Region-scoped annotations remain interactive only inside the active space.
      const isObjectInteractive = (() => {
        if (activeSpaceId !== null) {
          return isScopedRegionAnnotation && derivedSpaceId === activeSpaceId;
        }
        return true;
      })();

      // --- Type dispatch ---
      const objectType = String(obj.type || '').toLowerCase();
      let element = null;

      if (obj.data && obj.data.type === 'counter') {
        console.log(`[Counter SVG p${pageNumber}] dispatching renderCounter — i=${i}, displayNumber=${obj.data.displayNumber}, fill=${obj.fill}, left=${obj.left}, top=${obj.top}, radius=${obj.radius}`);
        element = renderCounter(obj, i);
      } else if (objectType === 'path' && Array.isArray(obj.path) && obj.path.length > 0) {
        element = renderPath(obj, i);
      } else if (objectType === 'rect') {
        element = renderRect(obj, i);
      } else if (objectType === 'line') {
        element = renderLine(obj, i);
      } else if (
        objectType === 'group' &&
        Array.isArray(obj.objects) &&
        obj.objects.length > 0
      ) {
        const hasLineChild = obj.objects.some(
          (o) => o && (o.type === 'line' || o.type === 'polyline' || o.type === 'path')
        );
        if (hasLineChild) {
          element = renderArrow(obj, i);
        }
      } else if (objectType === 'circle' || objectType === 'ellipse') {
        element = renderEllipse(obj, i);
      } else if (
        objectType === 'textbox' ||
        objectType === 'i-text' ||
        objectType === 'text'
      ) {
        element = renderText(obj, i);
      }

      if (element) {
        results.push({ obj, index: i, element, isObjectInteractive });
        count++;
      }
    }

    return results;
  }, [
    annotations?.objects,
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
    getSpaceIdForRegion,
  ]);

  // ---------------------------------------------------------------------------
  // Filter and render callout annotations
  // ---------------------------------------------------------------------------
  const filteredCallouts = useMemo(() => {
    if (!Array.isArray(callouts) || callouts.length === 0) return [];
    // CalloutOverlay (in PageAnnotationLayer) handles ALL callout rendering and interaction
    // across all tool modes (callout, select, pan). SVG layer must never render callouts
    // to avoid doubled visuals.
    return [];

    const elements = [];
    let count = 0;

    for (let i = 0; i < callouts.length; i++) {
      if (count >= MAX_PREVIEW_CALLOUTS) break;

      const callout = callouts[i];
      if (!callout) continue;

      // Page filter
      if (callout.pageNumber !== pageNumber) continue;

      // Module filtering: when survey panel open with module selected,
      // only show callouts matching that module
      if (showSurveyPanel && selectedModuleId) {
        if (callout.moduleId !== selectedModuleId) continue;
      }

      const element = renderCallout(callout, i, width, height, calculateCalloutConnection);
      if (element) {
        elements.push(element);
        count++;
      }
    }

    return elements;
  }, [callouts, pageNumber, showSurveyPanel, selectedModuleId, width, height, activeTool]);

  const objectCount = filteredAnnotations.length;
  const calloutCount = filteredCallouts.length;
  const importedDebugRows = useMemo(() => (
    filteredAnnotations
      .filter(({ obj }) => obj?.isPdfImported)
      .map(({ obj, index }) => summarizeImportedSvgAnnotationForDebug(obj, index))
  ), [filteredAnnotations]);
  const importedDebugSignature = useMemo(
    () => JSON.stringify(importedDebugRows),
    [importedDebugRows]
  );

  // Log mount/unmount
  useEffect(() => {
    console.log(
      `[SVG p${pageNumber}] MOUNT — ${objectCount} annotations, ${calloutCount} callouts, viewBox=${width}x${height}`
    );
    return () => {
      // Cleanup on unmount
    };
  }, [pageNumber, objectCount, calloutCount, width, height]);

  useEffect(() => {
    if (importedDebugRows.length === 0) {
      importedDebugRef.current = importedDebugSignature;
      return;
    }
    if (importedDebugRef.current !== importedDebugSignature) {
      console.log(
        `[SVG-Imported p${pageNumber}] renderSummary — imported=${importedDebugRows.length}, activeSpaceId=${activeSpaceId}, selectedSpaceId=${selectedSpaceId}, activeRegionId=${activeRegionId}, showSurveyPanel=${showSurveyPanel}, rows=${JSON.stringify(importedDebugRows.slice(0, 12))}`
      );
      importedDebugRef.current = importedDebugSignature;
    }
  }, [
    activeRegionId,
    activeSpaceId,
    importedDebugRows,
    importedDebugSignature,
    pageNumber,
    selectedSpaceId,
    showSurveyPanel
  ]);

  // Log every render (to detect re-renders during zoom)
  console.log(
    `[SVG p${pageNumber}] render — ${objectCount} objs, viewBox=${width}x${height}`
  );

  // ---------------------------------------------------------------------------
  // Render: wrap each annotation with hit-area, hover, and interaction handlers
  // ---------------------------------------------------------------------------
  const wrappedAnnotations = filteredAnnotations
    .map(({ obj, index: i, element, isObjectInteractive }) => {
    // During resize, create a temporary modified copy for rendering
    // (Imported paths use SVG transform instead — handled in computedTransform below)
    let renderObj = obj;
    let renderElement = element;
    if (visualTransform?.resize && visualTransform.id === i && !isImportedPath(obj)) {
      renderObj = {
        ...obj,
        scaleX: visualTransform.resize.scaleX,
        scaleY: visualTransform.resize.scaleY,
        left: visualTransform.resize.left,
        top: visualTransform.resize.top,
      };
      // Re-render the element with modified props
      const objectType = String(renderObj.type || '').toLowerCase();
      if (objectType === 'path' && Array.isArray(renderObj.path) && renderObj.path.length > 0) {
        renderElement = renderPath(renderObj, i);
      } else if (objectType === 'rect') {
        renderElement = renderRect(renderObj, i);
      } else if (objectType === 'line') {
        renderElement = renderLine(renderObj, i);
      } else if (objectType === 'group' && Array.isArray(renderObj.objects) && renderObj.objects.length > 0) {
        renderElement = renderArrow(renderObj, i);
      } else if (objectType === 'circle' || objectType === 'ellipse') {
        renderElement = renderEllipse(renderObj, i);
      } else if (objectType === 'textbox' || objectType === 'i-text' || objectType === 'text') {
        renderElement = renderText(renderObj, i);
      }
    }

    const bbox = getAnnotationBBox(renderObj);
    const annotationIsSelected = selectedIds.has(i);
    const annotationIsHovered = hoveredId === i && !annotationIsSelected;

    // Compute transform attribute based on interaction mode
    const computedTransform = (() => {
      if (!visualTransform) return undefined;
      // Single annotation visual transform (from Plan 02)
      if (typeof visualTransform.id === 'number' && visualTransform.id === i) {
        if (visualTransform.resize) {
          // Imported paths: use SVG transform to scale around anchor point
          if (isImportedPath(obj)) {
            const { scaleX, scaleY, anchorX, anchorY } = visualTransform.resize;
            return `translate(${anchorX}, ${anchorY}) scale(${scaleX}, ${scaleY}) translate(${-anchorX}, ${-anchorY})`;
          }
          // Standard objects: element is re-rendered at new scale, no transform needed
          return undefined;
        }
        if (visualTransform.rotate) {
          // Use deltaAngle for the wrapper — the annotation renderer already applies
          // its committed angle internally, so we only add the change to avoid double-rotation.
          const { deltaAngle, cx, cy } = visualTransform.rotate;
          return `rotate(${deltaAngle}, ${cx}, ${cy})`;
        }
        // Move: simple translate
        return `translate(${visualTransform.dx}, ${visualTransform.dy})`;
      }
      // Group visual transform (Plan 03)
      if (visualTransform.id === 'group' && visualTransform.affectedIds?.has(i)) {
        return `translate(${visualTransform.dx}, ${visualTransform.dy})`;
      }
      return undefined;
    })();

    const isBeingEdited = editingAnnotationIndex != null && i === editingAnnotationIndex;
    // Shape edit: SVG stays visible as the visual truth while Fabric provides an
    // invisible hit-zone + handles. This sidesteps the Canvas 2D vs SVG rasterizer
    // stroke difference documented in CLAUDE.md 2026-04-10. Text/callout still hide
    // SVG so Fabric can render live content.
    const objTypeForEdit = String(obj.type || '').toLowerCase();
    const isShapeEdit = isBeingEdited && ['rect', 'circle', 'ellipse', 'triangle'].includes(objTypeForEdit);
    const hideForEdit = isBeingEdited && !isShapeEdit;

    return (
      <g
        key={`wrapper-${obj.id || i}`}
        data-annotation-index={i}
        data-annotation-id={obj.id || ''}
        style={{
          cursor: annotationIsSelected ? 'move' : (annotationIsHovered ? 'pointer' : undefined),
          opacity: hideForEdit ? 0 : undefined,
          pointerEvents: isBeingEdited ? 'none' : undefined,
        }}
        transform={computedTransform}
      >
        {/* Actual annotation render — pointerEvents none so clicks pass to hit rect */}
        <g style={{ pointerEvents: 'none' }}>
          {renderElement}
        </g>
        {/* Hover outline + hit area — line uses line-shaped hit, counter uses
            pin-shaped outline matching renderCounter, others use rect */}
        {(() => {
          const objTypeLower = String(renderObj.type || '').toLowerCase();
          const isCounterObj = renderObj.data?.type === 'counter';

          if (objTypeLower === 'line') {
            const ep = getLineEndpoints(renderObj);
            return (
              <g>
                {/* Hover highlight along the line */}
                {annotationIsHovered && (
                  <line
                    x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2}
                    stroke="#4a90e2"
                    strokeOpacity={0.4}
                    strokeWidth={Math.max(6, (renderObj.strokeWidth || 2) + 4)}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {/* Invisible thick line hit area */}
                <line
                  x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2}
                  stroke="transparent"
                  strokeWidth={Math.max(12, (renderObj.strokeWidth || 2) + 10)}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents={isInteractive && isObjectInteractive ? 'stroke' : 'none'}
                  onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                  onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                  onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                  onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                />
              </g>
            );
          }

          if (isCounterObj) {
            // UX: counter hover outline hugs the pin shape (circle body + nub),
            // NOT the enclosing bbox rect — a square-glow around a pin-shaped
            // counter looks wrong. Geometry mirrors renderCounter exactly so
            // the glow tracks the nub direction via data.pointerAngle. Tangent
            // + long-arc path matches svgAnnotationRenderers.jsx:541-564.
            const r = (renderObj.radius || 14) * Math.abs(renderObj.scaleX || 1);
            const cx = (renderObj.left || 0) + r;
            const cy = (renderObj.top || 0) + r;
            const pointerAngleDeg = renderObj.data?.pointerAngle ?? 225;
            const angleRad = (pointerAngleDeg * Math.PI) / 180;
            const tipExt = Math.max(5, r * 0.5);
            const tipDistance = r + tipExt;
            const tipX = cx + Math.cos(angleRad) * tipDistance;
            const tipY = cy + Math.sin(angleRad) * tipDistance;
            const tangentHalfAngle = Math.acos(r / tipDistance);
            const t1a = angleRad + tangentHalfAngle;
            const t2a = angleRad - tangentHalfAngle;
            const t1x = cx + Math.cos(t1a) * r;
            const t1y = cy + Math.sin(t1a) * r;
            const t2x = cx + Math.cos(t2a) * r;
            const t2y = cy + Math.sin(t2a) * r;
            const pinPathD = `M ${tipX},${tipY} L ${t1x},${t1y} A ${r},${r} 0 1 1 ${t2x},${t2y} Z`;
            return (
              <g>
                {/* Pin-shaped hover glow — stroke only so the number + fill
                    show through. pointer-events none; hit detection stays on
                    the invisible hit-area rect below. */}
                {annotationIsHovered && (
                  <path
                    d={pinPathD}
                    fill="none"
                    stroke="#4a90e2"
                    strokeOpacity={0.4}
                    strokeWidth={2 * inverseScale}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {/* Invisible hit-area rect — unchanged from generic branch.
                    Counter pin extends beyond the circle bbox via the nub, but
                    click target remains the circle bbox for simplicity. */}
                <rect
                  x={bbox.left}
                  y={bbox.top}
                  width={Math.max(bbox.width, 10)}
                  height={Math.max(bbox.height, 10)}
                  fill="transparent"
                  stroke="none"
                  pointerEvents={isInteractive && isObjectInteractive ? 'all' : 'none'}
                  onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                  onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                  onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                  onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                />
              </g>
            );
          }

          return (
            <g transform={bbox.angle ? `rotate(${bbox.angle}, ${bbox.left + bbox.width / 2}, ${bbox.top + bbox.height / 2})` : undefined}>
              {/* Hover outline (shown before click, not when already selected) */}
              {annotationIsHovered && (
                <rect
                  x={bbox.left}
                  y={bbox.top}
                  width={bbox.width}
                  height={bbox.height}
                  fill="none"
                  stroke="#4a90e2"
                  strokeOpacity={0.4}
                  strokeWidth={2 * inverseScale}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {/* Invisible hit-area rect ON TOP for easier clicking */}
              <rect
                x={bbox.left}
                y={bbox.top}
                width={Math.max(bbox.width, 10)}
                height={Math.max(bbox.height, 10)}
                fill="transparent"
                stroke="none"
                pointerEvents={isInteractive && isObjectInteractive ? 'all' : 'none'}
                onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
              />
            </g>
          );
        })()}
      </g>
    );
  });

  return (
    <>
    <svg
      ref={svgRef}
      data-svg-annotation-layer={pageNumber}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: isInteractive ? 'auto' : 'none',
        overflow: 'hidden',
        cursor: interactionState === 'dragging' ? 'grabbing'
              : interactionState === 'rotating' ? 'crosshair'
              : undefined,
      }}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (isInteractive) {
          e.stopPropagation(); // Prevent Syncfusion from seeing SVG events (SVGAnimatedString crash)
          handleSvgPointerDown(e);
        }
      }}
      onPointerMove={isInteractive ? handlePointerMove : undefined}
      onPointerUp={isInteractive ? handlePointerUp : undefined}
    >
      {wrappedAnnotations}
      {filteredCallouts}
      {/* Selection overlays — rendered on top of all annotations */}
      {/* Single selection: individual bounding box with handles */}
      {selectedIds.size === 1 && Array.from(selectedIds).map((selectedIndex) => {
        const obj = annotations?.objects?.[selectedIndex];
        if (!obj) return null;

        // During edit: FabricEditCanvas provides its own handles. For border-flush types
        // (rect, text) there's no dashed bbox to preserve, so hide the overlay entirely.
        // For non-border-flush types (circle, ellipse, triangle), keep the dashed bbox
        // visible but strip the handles (Fabric provides those).
        // Counter is a special case: bbox + resize handles are never shown — Shottr UX is
        // a single rotation handle at the nubbin tip in selection mode, and the floating
        // mini-toolbar (color + size) in edit mode. Selection-mode rotation handle is
        // rendered below; edit-mode short-circuit returns null to clear the SVG selection
        // chrome and let FabricEditCanvas + MiniToolbar own the surface.
        const editObjType = String(obj.type || '').toLowerCase();
        const editIsBorderFlush = editObjType === 'text' || editObjType === 'textbox' || editObjType === 'i-text' || editObjType === 'rect';
        // [COUNTER WIP — DO NOT TOUCH] Counter select-mode rotation handle
        // and counter hover-outline path are mid-debug as of 2026-04-14.
        // Another session: leave editIsCounter / counterRotateDragRef /
        // counter hover branch alone. Coordinate via the user first.
        const editIsCounter = obj.data?.type === 'counter';
        const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
        // [COUNTER WIP — DO NOT TOUCH] Counter edit-mode short-circuit stays
        // identical — unrelated to Gap 4. Counter branch below is owned by
        // another session.
        if (isBeingEditedNow && editIsCounter) return null;
        // EDIT-14 (Phase 13 Plan 13-02): Border-flush shapes at angle=0 still
        // short-circuit (clean edit surface, no SVG chrome). Border-flush
        // shapes at angle !== 0 fall through to render SVGSelectionOverlay
        // with isEditing=true, which emits an mtr-only visual-only overlay.
        // Fix A / Architecture Option C. See `.planning/phases/13-.../13-02-PLAN.md`.
        // Read `obj.angle` directly (NOT `bbox.angle`) — bbox is computed
        // below at :~1179, not in scope yet. getAnnotationBBox propagates
        // obj.angle ?? 0 so these are equivalent for this check.
        const editAngle = obj.angle || 0;
        // TEMP UAT probe (revert after 13-02 approval) — logs when the narrowed
        // border-flush short-circuit is evaluated during edit mode. If editAngle !== 0,
        // the short-circuit now passes through instead of returning null, and
        // SVGSelectionOverlay will render in its isEditing=true branch.
        if (isBeingEditedNow && editIsBorderFlush) {
          // eslint-disable-next-line no-console
          console.log('[EDIT-14 probe] short-circuit check', {
            selectedIndex,
            editObjType,
            editAngle,
            shortCircuits: editAngle === 0,
            fallsThrough: editAngle !== 0,
          });
        }
        if (isBeingEditedNow && editIsBorderFlush && editAngle === 0) return null;

        // Counter selection (not in edit mode): render only the rotation handle at the
        // nubbin tip. No dashed bbox, no resize handles — Shottr-style minimal chrome.
        // Drag updates `data.pointerAngle` live with checkpointPolicy:'skip', then commits
        // a single normal checkpoint on pointerup so the rotation is one undo entry.
        if (editIsCounter) {
          // Apply visualTransform translate so the rotation handle follows the counter
          // during a live drag (otherwise the handle stays anchored to the stored
          // position while the SVG counter visually moves with visualTransform.dx/dy).
          const counterDragTransform = (visualTransform && typeof visualTransform.id === 'number'
              && visualTransform.id === selectedIndex && !visualTransform.resize && !visualTransform.rotate)
            ? `translate(${visualTransform.dx || 0}, ${visualTransform.dy || 0})`
            : undefined;
          const radius = (obj.radius || 14) * Math.abs(obj.scaleX || 1);
          const cx = (obj.left || 0) + radius;
          const cy = (obj.top || 0) + radius;
          // Use existing data.pointerAngle (default 225°, matches renderCounter default).
          const pointerAngleDeg = obj.data?.pointerAngle ?? 225;
          const angleRad = (pointerAngleDeg * Math.PI) / 180;
          // Match renderCounter's tipExtension formula exactly so the handle sits ON
          // the visible nubbin tip, not floating beside it.
          const tipExtension = Math.max(5, radius * 0.5);
          const tipX = cx + Math.cos(angleRad) * (radius + tipExtension);
          const tipY = cy + Math.sin(angleRad) * (radius + tipExtension);
          // Screen-pixel-sized handle so it stays a constant ~7px regardless of zoom.
          // Matches the line-endpoint handle sizing pattern at line ~680 below.
          const handleR = 7 * inverseScale;
          return (
            <g key={`counter-rotate-wrapper-${selectedIndex}`} transform={counterDragTransform}>
              <circle
                cx={tipX}
                cy={tipY}
                r={handleR}
                fill="#ffffff"
                stroke="#4a90e2"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{
                  // UX: rotation handle is the only interactive chrome in counter
                  // selection mode (Shottr UX). Cursor 'grab' signals draggability;
                  // pointer-events 'auto' so it remains hit-testable even though the
                  // surrounding SVG layer flips to pointer-events:none in edit mode.
                  cursor: 'grab',
                  pointerEvents: 'auto',
                  filter: `drop-shadow(0 ${1 * inverseScale}px ${3 * inverseScale}px rgba(0,0,0,0.25))`,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                  counterRotateDragRef.current = {
                    annotationIndex: selectedIndex,
                    centerX: cx,
                    centerY: cy,
                  };
                }}
                onPointerMove={(e) => {
                  const drag = counterRotateDragRef.current;
                  if (!drag || drag.annotationIndex !== selectedIndex) return;
                  const svgEl = svgRef.current;
                  if (!svgEl) return;
                  // Convert client coords to viewBox (page-space) coords.
                  // The SVG viewBox is "0 0 width height" with preserveAspectRatio:'none',
                  // so a simple linear mapping works.
                  const rect = svgEl.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) return;
                  const px = ((e.clientX - rect.left) / rect.width) * width;
                  const py = ((e.clientY - rect.top) / rect.height) * height;
                  const newAngleDeg = Math.atan2(py - drag.centerY, px - drag.centerX) * 180 / Math.PI;
                  const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
                  const targetObj = updatedAnnotations.objects?.[selectedIndex];
                  if (!targetObj) return;
                  targetObj.data = { ...(targetObj.data || {}), pointerAngle: newAngleDeg };
                  onSaveAnnotations(updatedAnnotations, {
                    source: 'counter:rotate-live',
                    action: 'counter-rotate',
                    checkpointPolicy: 'skip',
                  });
                }}
                onPointerUp={(e) => {
                  const drag = counterRotateDragRef.current;
                  counterRotateDragRef.current = null;
                  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                  if (!drag || drag.annotationIndex !== selectedIndex) return;
                  // Commit a single normal checkpoint so the entire rotation is one
                  // undo step. The SVG already shows the final angle from the last
                  // skip-checkpointed save, so we re-save the same JSON with normal
                  // policy to flush the checkpoint.
                  if (!annotations?.objects?.[selectedIndex]) return;
                  onSaveAnnotations(annotations, {
                    source: 'counter:rotate-commit',
                    action: 'counter-rotate',
                    checkpointPolicy: 'normal',
                  });
                }}
                onPointerCancel={() => {
                  counterRotateDragRef.current = null;
                }}
              />
            </g>
          );
        }

        // Apply visualTransform to bbox so overlay follows annotation live during drag/resize/rotate
        let bbox = getAnnotationBBox(obj);
        let overlayTransform;
        if (visualTransform && typeof visualTransform.id === 'number' && visualTransform.id === selectedIndex) {
          if (visualTransform.resize) {
            // During resize: recompute bbox from a transformed copy of the object so
            // type-specific bbox math (e.g. textbox descender buffer) is applied fresh
            // instead of being scaled along with the stored bbox height.
            const transformedObj = {
              ...obj,
              scaleX: visualTransform.resize.scaleX,
              scaleY: visualTransform.resize.scaleY,
              left: visualTransform.resize.left,
              top: visualTransform.resize.top,
            };
            bbox = getAnnotationBBox(transformedObj);
          } else if (visualTransform.rotate) {
            // During rotate: update angle on bbox
            bbox = { ...bbox, angle: visualTransform.rotate.angle };
          } else {
            // During move: apply translate to the overlay group
            overlayTransform = `translate(${visualTransform.dx}, ${visualTransform.dy})`;
          }
        }

        // Line-type annotations: endpoint handles only (no bbox, no dashed outline)
        const isLineType = String(obj.type || '').toLowerCase() === 'line';
        if (isLineType) {
          const ep = getLineEndpoints(obj);
          const dx = overlayTransform ? (visualTransform?.dx || 0) : 0;
          const dy = overlayTransform ? (visualTransform?.dy || 0) : 0;
          const isArrow = obj.tool === 'arrow';
          // Arrow: handle at arrowhead tip (ep2) and line start (ep1)
          // Line: handles at both endpoints
          // Dampened inverse scale (sqrt) to match SVGSelectionOverlay handle sizing
          const handleIs = Math.sqrt(inverseScale);
          const handleR = 7 * handleIs;
          const handleStyle = {
            filter: `drop-shadow(0 ${1 * handleIs}px ${3 * handleIs}px rgba(0,0,0,0.15))`,
            cursor: 'grab',
            pointerEvents: 'auto',
          };
          return (
            <g key={`selection-wrapper-${selectedIndex}`}>
              {/* Start handle (line start / arrow tail) */}
              <circle
                cx={ep.x1 + dx} cy={ep.y1 + dy}
                r={handleR}
                fill="#ffffff"
                stroke="#4a90e2"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={handleStyle}
                onPointerDown={(e) => { e.stopPropagation(); handleHandlePointerDown(e, 'p1'); }}
              />
              {/* End handle — same style as start handle, centered on arrowhead */}
              <circle
                cx={ep.x2 + dx} cy={ep.y2 + dy}
                r={handleR}
                fill="#ffffff"
                stroke="#4a90e2"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={handleStyle}
                onPointerDown={(e) => { e.stopPropagation(); handleHandlePointerDown(e, 'p2'); }}
              />
            </g>
          );
        }

        // Border-flush types: handles sit directly on the shape's own stroke, no dashed bbox
        const objType = String(obj.type || '').toLowerCase();
        const isBorderFlush = objType === 'text' || objType === 'textbox' || objType === 'i-text' || objType === 'rect';

        return (
          <g key={`selection-wrapper-${selectedIndex}`} transform={overlayTransform}>
            <SVGSelectionOverlay
              key={`selection-${selectedIndex}`}
              bbox={bbox}
              inverseScale={inverseScale}
              onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
              isGroupSelection={isBeingEditedNow}
              hideBoundingBox={isBorderFlush}
              padding={isBorderFlush ? 0 : 2}
              isEditing={isBeingEditedNow}
            />
          </g>
        );
      })}
      {/* Multi-select: individual dashed boxes (no handles) + group union box with handles */}
      {selectedIds.size > 1 && (
        <>
          {/* Individual dashed boxes for each selected annotation (no handles) */}
          {Array.from(selectedIds).map((selectedIndex) => {
            const obj = annotations?.objects?.[selectedIndex];
            if (!obj) return null;
            const bbox = getAnnotationBBox(obj);
            // Apply group drag transform
            const groupDragTransform = (visualTransform?.id === 'group' && visualTransform.affectedIds?.has(selectedIndex))
              ? `translate(${visualTransform.dx}, ${visualTransform.dy})`
              : undefined;
            return (
              <g key={`selection-wrapper-${selectedIndex}`} transform={groupDragTransform}>
                <SVGSelectionOverlay
                  key={`selection-${selectedIndex}`}
                  bbox={bbox}
                  inverseScale={inverseScale}
                  onHandleDrag={() => {}}
                  isGroupSelection={true}
                />
              </g>
            );
          })}
          {/* Group union bounding box with handles */}
          {(() => {
            const bboxes = Array.from(selectedIds)
              .map(idx => annotations?.objects?.[idx])
              .filter(Boolean)
              .map(obj => getAnnotationBBox(obj));
            if (bboxes.length === 0) return null;
            const groupBBox = getGroupBBox(bboxes);
            // Apply group drag transform to union box
            const groupDragTransform = (visualTransform?.id === 'group')
              ? `translate(${visualTransform.dx}, ${visualTransform.dy})`
              : undefined;
            return (
              <g key="group-selection-wrapper" transform={groupDragTransform}>
                <SVGSelectionOverlay
                  key="group-selection"
                  bbox={groupBBox}
                  inverseScale={inverseScale}
                  onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
                  isGroupSelection={false}
                  strokeOpacity={0.6}
                />
              </g>
            );
          })()}
        </>
      )}
    </svg>
    {/* EDIT-12 (Phase 12 Plan 02): RotationInputField portals into the
        overlay div that hosts SVGAnnotationLayer. Sits as a sibling to the
        <svg> in the React tree so it can co-receive parent state updates,
        but renders into svgRef.current.parentElement (resolved at runtime
        because the ref isn't attached on the very first render — the
        component early-returns null when hostEl is null, so safe). */}
    <RotationInputField
      svgRef={svgRef}
      hostEl={svgRef.current?.parentElement || null}
      angle={liveRotationAngle}
      annotationIndex={selectedAnnotationIndex}
      isRotating={isRotating}
      isVisible={showRotationInput && selectedAnnotationIndex !== null}
      shapeCenterViewBox={shapeCenterViewBox}
      onCommit={handleRotationInputCommit}
      onCancel={handleRotationInputCancel}
      onHoverChange={handleRotationInputHoverChange}
    />
    </>
  );
});

SVGAnnotationLayer.displayName = 'SVGAnnotationLayer';

export default SVGAnnotationLayer;
