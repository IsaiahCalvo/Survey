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
import React, { memo, useMemo, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import {
  renderPath,
  renderRect,
  renderLine,
  renderArrow,
  renderEllipse,
  renderText,
  renderCallout,
  renderCounter,
  renderPolygon,
  renderPolyline,
} from '../utils/svgAnnotationRenderers';
import { calculateCalloutConnection } from '../utils/calloutGeometry';
import { useSVGInteraction } from '../hooks/useSVGInteraction';
// Plan 14-03 Task 3 (CREATE-01 callout half): factory for constructing a
// new callout from the click-drag creation gesture. types.js is the
// PRESERVED Plan 14-01 shim (ARROWHEAD_STYLES + defaultCalloutStyle +
// createCallout) — do NOT replace with the null stub.
import { createCallout } from './Callout/types';
import { screenToSVG, normalizeAngle } from '../utils/svgTransformMath';
import SVGSelectionOverlay from './SVGSelectionOverlay';
import RotationInputField from './RotationInputField';
import { getAnnotationBBox, getAnnotationWorldAABB, getGroupBBox, isImportedPath, isAbsoluteCoordPath, getLineEndpoints, computeLineBboxCenter } from '../utils/svgBoundingBox';
import { resolveMidpointHandlePosition } from '../utils/lineDragMath.js';
import { buildArrowheadRenderSpec } from '../utils/lineRenderHelpers.js';
import { getCurvedPath, distanceToLineSegment, getCurveEndAngle } from '../utils/lineGeometry.js';
import { ARROWHEAD_STYLES } from './Callout/types';
import { renderPathToSvgAttrs, renderPathToSvgD } from '../utils/svgPathAttrs.js';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getAnnotationVisibilityScope,
  getSpaceIdForRegionFromSpaces,
  isAnnotationVisibleInContext,
  isAnnotationVisibleByPageControl
} from '../utils/annotationVisibilityRules';
// Diagnostic: record every SVG callout's source data + DOM rects so Save Log
// can dump a full geometry comparison against the Fabric edit-mode capture.
import { captureSvgCallout } from '../utils/calloutGeometryDiag.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SELECT_DELETE_ONLY_PDF_TEXT_MARKUP_TYPES = new Set(['Underline', 'StrikeOut', 'Squiggly']);

const isSelectDeleteOnlyPdfTextMarkupObject = (obj) => {
  if (!obj?.isPdfImported) return false;
  const pdfType = obj?.pdfAnnotationType || obj?.data?.pdfAnnotationType;
  return SELECT_DELETE_ONLY_PDF_TEXT_MARKUP_TYPES.has(String(pdfType || ''));
};

// 2026-05-03 — Per-page render caps deleted. Adobe / Drawboard PDF render
// every annotation; silently dropping a user's drawing past an arbitrary
// ceiling is unacceptable. If a dense page feels laggy, the right answer
// is viewport-only painting (skip drawings outside the visible scroll
// window) — tracked as a follow-up.


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

const shouldPrioritizeLiveReveal = (obj) => {
  const type = String(obj?.type || '').toLowerCase();
  if (type === 'circle' || type === 'ellipse') {
    const fill = String(obj?.fill || '').trim().toLowerCase();
    return !!fill && fill !== 'none' && fill !== 'transparent';
  }
  if (type !== 'path' || !Array.isArray(obj?.path) || obj.path.length === 0) {
    return false;
  }
  try {
    const attrs = renderPathToSvgAttrs(obj);
    const fill = String(attrs?.fill || '').trim().toLowerCase();
    const stroke = String(attrs?.stroke || '').trim().toLowerCase();
    return attrs?.smoothClosedOutline === true && !!fill && fill !== 'none' && stroke === 'none';
  } catch {
    return false;
  }
};

const normalizeDegreesValue = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return ((numeric % 360) + 360) % 360;
};

const normalizeSurveyHighlightBoundsValue = (bounds) => {
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const widthValue = Number(bounds?.width);
  const heightValue = Number(bounds?.height);
  const widthSafe = Number.isFinite(widthValue) ? widthValue : 1;
  const heightSafe = Number.isFinite(heightValue) ? heightValue : 1;
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Math.max(1, widthSafe),
    height: Math.max(1, heightSafe),
    angle: normalizeDegreesValue(bounds?.angle),
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SVGAnnotationLayer = memo(({
  pageNumber,
  width,          // unscaled PDF page width (e.g., 612)
  height,         // unscaled PDF page height (e.g., 792)
  annotations,    // Fabric.js JSON { objects: [...] }
  callouts,       // array of callout objects
  // Survey highlights for this page. Array of:
  //   { highlightId, x, y, width, height, color, moduleId, regionId, needsBIC }
  // Rendered as SVG rects with mix-blend-mode: multiply, passed through the
  // same three-layer visibility filter as annotation objects.
  surveyHighlights,
  onUpdateSurveyHighlightBounds,
  onDeleteSurveyHighlight,
  pendingSurveyHighlightSelection,
  onPendingSurveyHighlightSelectionConsumed,
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
  // UX 2026-04-19: editType of the current edit session ('text' | 'callout' | 'bbox' | null).
  // 'bbox' means the user double-clicked a counter / line / arrow / polygon / polyline and
  // wants the uniform resize-and-rotate bounding box chrome instead of the type-specific
  // single-click handles. When set, the counter rotation-only branch and the line endpoint
  // branch are skipped so the default SVGSelectionOverlay path renders the uniform chrome.
  editingAnnotationEditType = null,
  // UX 2026-04-19: fires when the user dismisses bbox edit mode (clicks empty
  // space, clicks a different shape, presses escape). App.jsx wires this to
  // setEditingAnnotation(null) so the next click / double-click starts fresh.
  onRequestExitEdit = null,
  // Plan 14-02 Task 3 (KBD-01) — callout selection + delete wiring. Plan
  // 14-03 wires these two props at the mount sites in App.jsx; Task 3 only
  // READS them and defensively defaults both so the component stays
  // forward-compatible during the parallel wave-1 execution window. Shape:
  //   selectedCalloutIds:       Set<string> | string[] — empty iterable is
  //                             the safe default when Plan 14-03 has not
  //                             wired the state yet.
  //   onDeleteSelectedCallouts: (ids: string[]) => void — callback invoked
  //                             by the extended Delete handler when the
  //                             callout branch fires. App.jsx (Plan 14-03)
  //                             will call setCallouts + saveAnnotation-
  //                             Checkpoint to satisfy the per-action undo
  //                             pattern (Phase 9 decision).
  selectedCalloutIds,
  onDeleteSelectedCallouts,
  // UX 2026-04-21: called with (suppressCount) at the START of a multi-delete
  // (shape+callout) so App.jsx captures a single pre-mutation checkpoint and
  // suppresses the next N downstream checkpoints. Single undo covers both.
  onBeginBatchDelete,
  // Plan 14-03 Task 1: App.jsx state setter for callout selection. Called
  // by useSVGInteraction's 'callout-part' drag mode to update the selection
  // on pointerdown. Defensively defaulted to a no-op so the component stays
  // forward-compatible if any mount site hasn't wired it yet.
  onSelectedCalloutIdsChange,
  // Plan 14-03 Task 1: creation + drag-commit callbacks wired from App.jsx.
  // onCreateCallout fires from the CREATE-01 callout creation state machine
  // (Task 3); onUpdateCallout fires once at drag pointerup to capture the
  // undo checkpoint; onUpdateCalloutLive fires on every pointermove during
  // drag to repaint state without bloating the undo stack (Phase 12
  // optimistic-paint pattern).
  onCreateCallout,
  onUpdateCallout,
  onUpdateCalloutLive,
  // Fix 3 (2026-04-16): id of the callout currently being edited in
  // FabricEditCanvas, or null. When set, filteredCallouts below skips that
  // single callout so the live Fabric edit view isn't stacked on top of a
  // stale SVG copy. Replaces the previous layer-wide `visibility: hidden`
  // hack in App.jsx which blanked every other annotation on the page.
  // Mirrors the text-annotation hideForEdit pattern (:~1332).
  editingCalloutId,
  // UX: Phase 15 UAT-2 — live page-space bounds of the editing callout's
  // textbox, fed from FabricEditCanvas.onLiveTextGrow via App.jsx on every
  // Fabric Textbox 'changed' event. When present + editingCalloutId matches
  // the rendered callout's id, the renderer uses these bounds instead of the
  // stored normalized dims so line1 tracks the live edge as the box grows.
  // Shape: { left, top, width, height, text?, textLines?, fontSize?,
  // lineHeight? } in page space, or null. Plan 15-04 Step 3 added the text
  // payload so renderCallout also swaps in live-typed glyphs per keystroke.
  liveCalloutEditBounds,
  // UX: Plan 15-04 Step 3 — live page-space bounds + text for the editing
  // plain-text annotation (non-callout), same shape as liveCalloutEditBounds.
  // Keyed by editingAnnotationIndex; renderText receives it as its 3rd arg
  // so the visible SVG textbox renders the typed characters in real time
  // (Fabric's textbox is painted transparent during edit — this is the only
  // visible copy).
  liveTextEditBounds,
  // UX: pan-mode quick-click selection — App.jsx sets this to
  // { pageNumber, annotationIndex, tick } when a pan-mode single-click lands
  // on an annotation. Each instance checks whether the pageNumber matches its
  // own and, if so, calls selectAnnotation(annotationIndex). The `tick` field
  // is a monotonically increasing counter so that clicking the same
  // annotation twice in a row still re-fires the effect.
  pendingSelection,
  // Parent-driven UI-only deselect signal. App.jsx increments this when the
  // visible annotation context changes so stale selection chrome disappears
  // without saving or deleting any annotation data.
  selectionClearToken = 0,
  // UX: pan-mode hover glow — App.jsx runs a document-level mousemove
  // listener in pan mode and, via resolveAnnotationAt, broadcasts
  // { pageNumber, annotationIndex } (or null) whenever the cursor enters
  // or leaves an annotation. Each instance ignores messages for other
  // pages. Drives the same hoveredId state the Select-mode hover uses, so
  // the existing glow renders "for free" without duplicating styles.
  pendingHover,
  // UX: Cmd+C / Cmd+X hotkey handlers. The per-page keydown useEffect
  // below fires these when this page has exactly one shape selected (and
  // no text input is focused). App.jsx wraps them to stash clipboardAnnotation
  // + call handleSaveAnnotations, so keyboard Copy/Cut behave identically to
  // the right-click menu's Copy/Cut items. Callouts have their own Cut/Copy
  // path owned by the parallel callout session — this handler only runs for
  // `annotations.objects[i]` selections (selectedIds), never for callouts.
  onCopyAnnotation,
  onCutAnnotation,
  // UX: z-order reorder handler. Signature: (pageNumber, fromIndex, toIndex).
  // Fired from the keydown useEffect below on Cmd+]/Cmd+[ (with Shift for
  // full-front / full-back). App.jsx clamps toIndex and re-selects the shape
  // at the new slot so the user's selection follows the shape after reorder.
  // Same handler backs the right-click menu's Bring to Front / Forward /
  // Send Backward / to Back items.
  onReorderAnnotation,
  // UX: 2026-04-20 — Group / Ungroup handlers. Signature:
  //   onGroupSelected(pageNumber, annotationIndices[], calloutIds[])
  //   onUngroupSelected(pageNumber, annotationIndices[], calloutIds[])
  // Fired by Cmd+G / Cmd+Shift+G in the keydown useEffect below using the
  // current selectedIds + selectedCalloutIds. Right-click menu items in
  // App.jsx call the same App-level handlers directly. Defensively defaulted
  // so the layer stays mountable from older sites that haven't wired it.
  onGroupSelected,
  onUngroupSelected,
  // Phase 35 Plan 03 — per-user delete authority. Forwarded into
  // useSVGInteraction below so the marquee post-filter + click hit-test gate
  // resolve ownership against the same identity App.jsx uses for cloud sync.
  // Visible-but-locked rendering still rides the existing isInteractive prop
  // pattern (CONTEXT.md DO NOT CHANGE) — no render-logic touch in this layer.
  viewerId,
  documentOwnerId,
  // Phase 35 Plan 04 — bulk-delete interceptor. Optional callback forwarded
  // into useSVGInteraction so deleteSelected can route through App.jsx's
  // modal/toast layer. Single-line additive prop pass-through; no render-
  // logic touch (CONTEXT.md DO NOT CHANGE).
  onRequestBulkDelete,
  // 2026-05-03 — Viewport culling. App.jsx passes true for the visible page
  // and a small window above/below (currently ±2). Off-window pages skip
  // the heavy filteredAnnotations + filteredCallouts iteration so a 150-
  // page doc with thousands of strokes per page only pays render cost for
  // the pages on screen. Default true preserves pre-2026-05-03 behavior
  // for any caller that doesn't yet pass this prop. UX: matches Drawboard /
  // Adobe behavior where off-screen pages hold data only.
  isPageInRenderWindow = true,
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
  const [counterHandlePreview, setCounterHandlePreview] = useState(null);
  const counterHandlePreviewRef = useRef(null);
  const annotationsRef = useRef(annotations);
  const renderedAnnotationEntriesRef = useRef([]);
  const surveyHighlightDragRef = useRef(null);
  const [selectedSurveyHighlightId, setSelectedSurveyHighlightId] = useState(null);
  const [hoveredSurveyHighlightId, setHoveredSurveyHighlightId] = useState(null);
  const [surveyHighlightPreviewBounds, setSurveyHighlightPreviewBounds] = useState(null);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  // ---------------------------------------------------------------------------
  // Interaction hook (Phase 9)
  // ---------------------------------------------------------------------------
  const {
    selectedIds, hoveredId, inverseScale, interactionState, activeCalloutDrag, visualTransform,
    hoveredCalloutId, handleCalloutPointerEnter, handleCalloutPointerLeave,
    handleAnnotationPointerDown, handleAnnotationPointerEnter,
    handleAnnotationPointerLeave, handleAnnotationDoubleClick,
    handleSvgPointerDown, handleHandlePointerDown,
    handlePointerMove, handlePointerUp,
    isSelected, deleteSelected,
    // UX: 2026-04-20 — multi-index selection setter, used by the Ungroup
    // restore path so freed group members stay selected as a multi-set.
    selectAnnotations,
    // UX: 2026-04-21 — persisted group rotation. Renderer reads this so
    // the multi-select bbox stays tilted after group-rotate pointerup,
    // matching single-shape rotate behavior.
    persistedGroupTransform,
    // EDIT-12 Gap 1 fix (Plan 12-03): optimistic rotation paint
    applyOptimisticRotation, clearOptimisticRotation,
    // Pan-mode quick-click: App.jsx drives selection via pendingSelection.
    selectAnnotation,
    // UX: App.jsx can also drive a "clear selection on this page" command
    // through pendingSelection (annotationIndex: null). Used after right-click
    // Delete so the selection doesn't stick to the new shape that slides into
    // the deleted shape's index slot.
    deselectAll,
    // Pan-mode hover: App.jsx drives hover glow via pendingHover.
    setHoveredId,
    // UX: Phase 19 — AutoCAD marquee render state. Both null until the
    // drag crosses the 5 px min-drag threshold. Rendered as a single
    // <rect> on the root SVG with pointer-events: none so it never
    // steals events from annotations underneath.
    marqueeRect,
    marqueeDirection,
  } = useSVGInteraction({
    svgRef, annotations, pageWidth: width, pageHeight: height,
    onSaveAnnotations, onRequestEditMode,
    // UX: Phase 14 CALL-10 — wire the callout drag machinery. The hook
    // reads `callouts` to look up the original React callout by id at
    // drag-start (for whole-move delta math), dispatches selection changes
    // via onSelectedCalloutIdsChange, and repaints + commits drags via
    // onUpdateCalloutLive + onUpdateCallout (live + commit split to match
    // the Phase 12 optimistic-paint pattern).
    callouts,
    onSelectedCalloutIdsChange,
    // UX 2026-04-20: pass the current callout selection set so the hook
    // can implement Shift-click toggle for callouts symmetric with the
    // shape-side toggle. Without this, shift-clicking a callout always
    // replaced the selection — asymmetric with shape shift-click.
    selectedCalloutIds,
    onUpdateCalloutLive,
    onUpdateCallout,
    // UX: Phase 19 — marquee only activates when tool === 'select'.
    activeTool,
    // Phase 35 Plan 03 — forward per-user delete authority props to the
    // hook's marquee post-filter + click hit-test gate.
    viewerId,
    documentOwnerId,
    getSelectableAnnotationIndices: () => renderedAnnotationEntriesRef.current.map((entry) => entry.index),
    // Phase 35 Plan 04 — page number + bulk-delete interceptor for
    // deleteSelected snapshot capture and App.jsx modal routing.
    pageNumber,
    onRequestBulkDelete,
  });

  // UX: apply a pan-mode quick-click selection command from App.jsx. Matches
  // this layer's pageNumber, then calls the hook's selectAnnotation. The
  // `tick` field on pendingSelection forces re-run even if the same index is
  // clicked twice. No-op when pendingSelection is null or for a different
  // page (other layer instances ignore it). Special case: annotationIndex
  // === null is a "clear selection on this page" command (used by App.jsx
  // after right-click Delete so selectedIds doesn't stick to the shape that
  // slides into the deleted slot after the splice).
  //
  // useLayoutEffect (not useEffect) so the clear runs AFTER the commit that
  // brings in the new annotations but BEFORE the browser paints. Without
  // this, the select-tool user sees a one-frame flash where the neighbor
  // shape (now occupying the deleted index) appears selected — the save and
  // the deselect arrive in separate renders otherwise.
  useLayoutEffect(() => {
    if (!pendingSelection) return;
    if (pendingSelection.clearAll === true) {
      deselectAll();
      setSelectedSurveyHighlightId(null);
      setSurveyHighlightPreviewBounds(null);
      surveyHighlightDragRef.current = null;
      return;
    }
    if (pendingSelection.pageNumber !== pageNumber) return;
    // UX: 2026-04-20 — multi-index restore (Ungroup). When App broadcasts
    // an `annotationIndices` array (instead of the singular index), replace
    // the entire selection with that set so the freed group members stay
    // selected as a multi-selection. Single-index path below remains the
    // default for the older single-shape consumers (right-click delete /
    // pan-mode click).
    if (Array.isArray(pendingSelection.annotationIndices)) {
      setSelectedSurveyHighlightId(null);
      setSurveyHighlightPreviewBounds(null);
      surveyHighlightDragRef.current = null;
      selectAnnotations(pendingSelection.annotationIndices);
      return;
    }
    if (pendingSelection.annotationIndex === null) {
      deselectAll();
      setSelectedSurveyHighlightId(null);
      setSurveyHighlightPreviewBounds(null);
      surveyHighlightDragRef.current = null;
      return;
    }
    if (typeof pendingSelection.annotationIndex !== 'number') return;
    setSelectedSurveyHighlightId(null);
    setSurveyHighlightPreviewBounds(null);
    surveyHighlightDragRef.current = null;
    selectAnnotation(pendingSelection.annotationIndex, false);
  }, [pendingSelection, pageNumber, selectAnnotation, selectAnnotations, deselectAll]);

  useLayoutEffect(() => {
    if (!selectionClearToken) return;
    deselectAll();
    setSelectedSurveyHighlightId(null);
    setSurveyHighlightPreviewBounds(null);
    surveyHighlightDragRef.current = null;
  }, [selectionClearToken, deselectAll]);

  // UX: apply a pan-mode hover target from App.jsx. If pendingHover is null
  // OR targets a different page, clear this layer's hoveredId (a previously
  // hovered annotation should lose its glow when the cursor moves off).
  // Otherwise paint the glow by setting hoveredId to the matching index.
  // This deliberately mirrors the Select-mode onPointerEnter/Leave path so
  // one glow implementation serves both modes.
  useEffect(() => {
    if (!pendingHover || pendingHover.pageNumber !== pageNumber) {
      setHoveredId((prev) => (prev == null ? prev : null));
      return;
    }
    if (typeof pendingHover.annotationIndex !== 'number') {
      setHoveredId((prev) => (prev == null ? prev : null));
      return;
    }
    setHoveredId(pendingHover.annotationIndex);
  }, [pendingHover, pageNumber, setHoveredId]);

  // Determine pointer events mode: interactive when select tool active AND not in edit mode
  // When editingAnnotationIndex is set, FabricEditCanvas + MiniToolbar need to receive clicks
  //
  // UX: Plan 14-02 UX-01 — split the single `isInteractive` derivation into three
  // related booleans so the line/arrow/callout creation tools can get
  // pointerEvents=auto (so the crosshair cursor and creation drag register on
  // the SVG surface) WITHOUT re-enabling annotation click-to-select on those
  // tools. The three booleans have distinct jobs:
  //
  //   isSelectTool   — click-to-select / hover / double-click edit gate. Only
  //                    the Select/Text-Select tools drive annotation selection
  //                    behavior. Use this for any guard that protects
  //                    select-mode-specific handlers (existing call sites at
  //                    988/1050/1084 KEEP isInteractive because they also
  //                    need creation-tool pointer routing — see Step 3 audit).
  //   isCreationTool — line/arrow/callout tool active. Drives the crosshair
  //                    class (Step 4 below) so downstream Phase 15/16
  //                    line/arrow work inherits it for free.
  //   isInteractive  — the OR of both. Drives SVG root pointerEvents and
  //                    handleSvgPointerDown routing. All creation tools need
  //                    pointerEvents=auto so the class shows through; all
  //                    select tools need it for click-to-select.
  //
  // See 14-UI-SPEC.md Interaction Contract 1 and 14-RESEARCH.md Pitfall 3
  // (pointerEvents:none blocks crosshair cursor).
  // UX 2026-04-19: bbox edit mode (counter / line / arrow / polygon / polyline
  // double-click) runs entirely on the SVG layer — no Fabric canvas takes
  // over. So the select tool must stay "on" during bbox mode so handle
  // clicks, shape drags, and click-to-dismiss all keep working.
  const isBboxEditMode = editingAnnotationIndex != null && editingAnnotationEditType === 'bbox';
  const isCalloutTextEditMode = !!editingCalloutId;
  const isSelectTool = (activeTool === 'select' || activeTool === 'text-select')
    && !isCalloutTextEditMode
    && (editingAnnotationIndex == null || isBboxEditMode);
  // UX: line/arrow/callout tools also get pointerEvents=auto so the crosshair
  // class shows through and callout creation drag can start on the SVG
  // surface. Gated on editingAnnotationIndex == null so the creation surface
  // disables during edit mode (mirrors isSelectTool's edit-mode guard). Bbox
  // mode does NOT re-enable creation tools — the user's in "edit a shape"
  // mode, not "draw a new shape" mode.
  const isCreationTool = (activeTool === 'line' || activeTool === 'arrow' || activeTool === 'callout')
    && editingAnnotationIndex == null
    && !isCalloutTextEditMode;
  const isInteractive = isSelectTool || isCreationTool;

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
  // ---------------------------------------------------------------------------
  // Phase 14 CREATE-01 (callout half) — transient state for click-drag
  // callout creation
  // ---------------------------------------------------------------------------
  // UX: calloutCreation is null when not creating, otherwise holds
  // { arrowTip: {x, y}, currentPointer: {x, y} } in PAGE coordinates
  // (pre-normalization). Cleared on tool switch via the activeTool
  // useEffect below so a mid-drag V keystroke doesn't leave a stray
  // preview mounted. The preview JSX is rendered inside the SVG root
  // conditionally on this state.
  const [calloutCreation, setCalloutCreation] = useState(null);
  const calloutCreationRef = useRef(null);
  useEffect(() => { calloutCreationRef.current = calloutCreation; }, [calloutCreation]);

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
  // Plan 14-02 Task 3 (KBD-01) — extended the existing Phase 9 handler to
  // cover the new selectedCalloutIds branch. The existing annotation branch
  // (selectedIds + deleteSelected) is unchanged; the new callout branch
  // fires onDeleteSelectedCallouts when Plan 14-03 wires the state.
  //
  // Defensive defaults: selectedCalloutIds / onDeleteSelectedCallouts are
  // optional during the parallel wave-1 execution window. Supports both
  // Set<string> and string[] for the callout ids (Plan 14-03 will pick one
  // shape; this effect accepts either).
  const effectiveSelectedCalloutIds = selectedCalloutIds || new Set();
  const effectiveDeleteCalloutsCallback = onDeleteSelectedCallouts || (() => {});
  const calloutSelectionSize =
    effectiveSelectedCalloutIds instanceof Set
      ? effectiveSelectedCalloutIds.size
      : Array.isArray(effectiveSelectedCalloutIds)
        ? effectiveSelectedCalloutIds.length
        : 0;

  useEffect(() => {
    // UX: KBD-01 — Delete/Backspace removes selected annotation OR callout.
    // Early-return when neither selection has entries. Matches combined-tools
    // focus-guard pattern (Index.tsx:31-49) and Phase 9 per-action undo via
    // existing deleteSelected() / Plan 14-03 setCallouts pipeline.
    // See 14-UI-SPEC.md Interaction Contract 2.
    if (selectedIds.size === 0 && calloutSelectionSize === 0) return;

    const handleKeyDown = (e) => {
      // UX: only Delete/Backspace — anything else is a no-op so other
      // shortcuts (copy/paste/cmd+z) flow through normally.
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      // UX: focus guard — if the user is typing in a text input, textarea,
      // contentEditable element, or a Fabric.js hidden textarea (edit
      // mode), the Delete/Backspace belongs to that input, not to
      // annotation delete. Mirrors the existing pattern here and
      // combined-tools Index.tsx.
      const el = document.activeElement;
      if (el) {
        if (el.tagName === 'INPUT') return;
        if (el.tagName === 'TEXTAREA') return;
        if (el.isContentEditable === true) return;
        if (el.contentEditable === 'true') return;
        // UX: Fabric.js IText/Textbox edit mode wires a hidden textarea
        // into the document for IME compatibility. It's outside the
        // usual INPUT/TEXTAREA chain but still consumes Delete/Backspace
        // for text edits — skip annotation delete while it's focused.
        if (typeof el.closest === 'function' && el.closest('.fabric-hidden-textarea')) return;
      }

      e.preventDefault();

      // UX 2026-04-21: marquee multi-select can populate BOTH selections at
      // once (shape + callout). Delete both when both are populated so the
      // user's single Delete press clears the entire selection they just
      // boxed. When both sides are present we route through a single
      // batch-checkpoint opener so one Cmd+Z brings everything back in
      // one step (previously the two downstream saves produced two
      // separate undo entries).
      const hasShapes = selectedIds.size > 0;
      const hasCallouts = calloutSelectionSize > 0;
      const idsArray = hasCallouts
        ? effectiveSelectedCalloutIds instanceof Set
          ? Array.from(effectiveSelectedCalloutIds)
          : Array.isArray(effectiveSelectedCalloutIds)
            ? effectiveSelectedCalloutIds.slice()
            : []
        : [];

      if (hasShapes && hasCallouts && typeof onBeginBatchDelete === 'function') {
        onBeginBatchDelete(2, idsArray);
      }

      if (hasShapes) {
        deleteSelected();
      }

      if (hasCallouts) {
        effectiveDeleteCalloutsCallback(idsArray);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedIds,
    effectiveSelectedCalloutIds,
    calloutSelectionSize,
    deleteSelected,
    effectiveDeleteCalloutsCallback,
    onBeginBatchDelete,
  ]);

  // UX: KBD-02 — single-shape annotation hotkeys: Cmd+C (copy), Cmd+X (cut),
  // and the Illustrator/Figma/Photoshop z-order block:
  //   Cmd+]          → Bring Forward
  //   Cmd+Shift+]    → Bring to Front
  //   Cmd+[          → Send Backward
  //   Cmd+Shift+[    → Send to Back
  // Mirrors the Delete/Backspace useEffect above: each SVGAnnotationLayer
  // instance attaches its own window-level keydown listener, and the
  // early-return guarantees only the page with a single-shape selection
  // does any work. Skips when:
  //   - No shape is selected, OR more than one is (the right-click menu
  //     is single-shape too — multi-select ops are out of scope).
  //   - Fabric edit mode is live (editingAnnotationIndex != null) —
  //     keyboard shortcuts belong to the text editor in that case.
  //   - Any text input / contentEditable / Fabric hidden textarea is
  //     focused (same focus-guard as Delete/Backspace).
  // Callouts have their own Cut/Copy/Paste + (future) z-order wired by the
  // parallel callout session; this handler only reads selectedIds, so
  // callout hotkeys are untouched. Uses e.code for the brackets so the
  // shortcuts are layout-independent (Shift+] → "}" via e.key, but
  // e.code stays "BracketRight").
  useEffect(() => {
    if (selectedIds.size !== 1) return;
    // UX 2026-04-19: bbox edit mode (counter / line / polygon / polyline
    // double-click) is still SVG-owned, so copy / cut / z-order hotkeys
    // should keep working. Only true Fabric-owned edit mode (text /
    // callout) needs to yield keyboard focus to the inline editor.
    if (editingAnnotationIndex != null && editingAnnotationEditType !== 'bbox') return;

    const handleKeyDown = (e) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta || e.altKey) return;
      const k = typeof e.key === 'string' ? e.key.toLowerCase() : '';
      const code = e.code;
      const isCopy = !e.shiftKey && k === 'c';
      const isCut = !e.shiftKey && k === 'x';
      const isBracketRight = code === 'BracketRight';
      const isBracketLeft = code === 'BracketLeft';
      if (!isCopy && !isCut && !isBracketRight && !isBracketLeft) return;

      // UX: focus guard — same shape as the Delete/Backspace handler above.
      const el = document.activeElement;
      if (el) {
        if (el.tagName === 'INPUT') return;
        if (el.tagName === 'TEXTAREA') return;
        if (el.isContentEditable === true) return;
        if (el.contentEditable === 'true') return;
        if (typeof el.closest === 'function' && el.closest('.fabric-hidden-textarea')) return;
      }

      const annotationIndex = Array.from(selectedIds)[0];
      if (typeof annotationIndex !== 'number') return;

      if (isCopy && typeof onCopyAnnotation === 'function') {
        e.preventDefault();
        onCopyAnnotation(pageNumber, annotationIndex);
      } else if (isCut && typeof onCutAnnotation === 'function') {
        e.preventDefault();
        onCutAnnotation(pageNumber, annotationIndex);
      } else if (isBracketRight && typeof onReorderAnnotation === 'function') {
        // UX: direction strings ('front' / 'forward') route through the
        // handler's Figma-style overlap resolver so each press lands the
        // shape above the next spatially-overlapping neighbor, not just
        // the next slot in the array. Keeps the effect's dep array free
        // of `annotations`, which would make it re-run on every update.
        e.preventDefault();
        onReorderAnnotation(pageNumber, annotationIndex, e.shiftKey ? 'front' : 'forward');
      } else if (isBracketLeft && typeof onReorderAnnotation === 'function') {
        e.preventDefault();
        onReorderAnnotation(pageNumber, annotationIndex, e.shiftKey ? 'back' : 'backward');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, editingAnnotationIndex, pageNumber, onCopyAnnotation, onCutAnnotation, onReorderAnnotation]);

  // UX: 2026-04-21 — Group / Ungroup feature is HIDDEN app-wide. The
  // Cmd+G and Cmd+Shift+G shortcuts are short-circuited below. Wiring
  // and handlers are preserved so the matrix-per-shape rewrite can turn
  // them back on without re-plumbing. Do NOT re-enable without an explicit
  // user waiver — see handoff 2026-04-21.
  useEffect(() => {
    return;
    // eslint-disable-next-line no-unreachable
    if (editingAnnotationIndex != null && editingAnnotationEditType !== 'bbox') return;
    const totalSelected = (selectedIds?.size || 0) + calloutSelectionSize;
    if (totalSelected === 0) return;

    const handleKeyDown = (e) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta || e.altKey) return;
      const k = typeof e.key === 'string' ? e.key.toLowerCase() : '';
      if (k !== 'g') return;

      // UX: focus guard — same shape as the other hotkey handlers above.
      const el = document.activeElement;
      if (el) {
        if (el.tagName === 'INPUT') return;
        if (el.tagName === 'TEXTAREA') return;
        if (el.isContentEditable === true) return;
        if (el.contentEditable === 'true') return;
        if (typeof el.closest === 'function' && el.closest('.fabric-hidden-textarea')) return;
      }

      const annoIndices = Array.from(selectedIds || []);
      const calIds = effectiveSelectedCalloutIds instanceof Set
        ? Array.from(effectiveSelectedCalloutIds)
        : Array.isArray(effectiveSelectedCalloutIds) ? effectiveSelectedCalloutIds.slice() : [];

      if (e.shiftKey) {
        // Cmd+Shift+G — Ungroup. Allowed for any selection size; the App
        // handler no-ops if no selected member actually has a groupId.
        if (typeof onUngroupSelected !== 'function') return;
        e.preventDefault();
        onUngroupSelected(pageNumber, annoIndices, calIds);
        return;
      }

      // Cmd+G — Group. Requires at least 2 items total (single-item group
      // is a UX no-op). App handler also re-checks defensively.
      if (annoIndices.length + calIds.length < 2) return;
      if (typeof onGroupSelected !== 'function') return;
      e.preventDefault();
      onGroupSelected(pageNumber, annoIndices, calIds);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedIds,
    effectiveSelectedCalloutIds,
    calloutSelectionSize,
    editingAnnotationIndex,
    editingAnnotationEditType,
    pageNumber,
    onGroupSelected,
    onUngroupSelected,
  ]);

  // UX 2026-04-19: bbox edit mode auto-exit. When the user deselects (empty
  // click, clicks another shape, presses Delete, etc.), the edit session
  // should end too — otherwise editType stays 'bbox' forever and subsequent
  // double-clicks on other shapes are ignored by the edit cooldown. Fires
  // onRequestExitEdit when (a) this page is the one editing, (b) edit type
  // is 'bbox', and (c) the edited index is no longer in selectedIds. Escape
  // key also routes through here for a consistent dismiss path.
  useEffect(() => {
    if (editingAnnotationIndex == null) return;
    if (editingAnnotationEditType !== 'bbox') return;
    if (selectedIds.has(editingAnnotationIndex)) return;
    if (typeof onRequestExitEdit === 'function') onRequestExitEdit();
  }, [editingAnnotationIndex, editingAnnotationEditType, selectedIds, onRequestExitEdit]);

  useEffect(() => {
    if (editingAnnotationIndex == null) return;
    if (editingAnnotationEditType !== 'bbox') return;
    const onKey = (e) => {
      if (e.key === 'Escape' && typeof onRequestExitEdit === 'function') {
        onRequestExitEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingAnnotationIndex, editingAnnotationEditType, onRequestExitEdit]);

  // ---------------------------------------------------------------------------
  // Phase 14 CREATE-01 (callout half) — window-level pointermove/up while
  // in-flight
  // ---------------------------------------------------------------------------
  // UX: Once a creation drag has started (pointerdown on empty SVG space
  // with activeTool === 'callout'), track the pointer via window-level
  // listeners so the drag survives leaving the SVG bounds. On pointerup,
  // either commit via onCreateCallout (if the drag has enough distance) or
  // cancel silently (short click). Listeners are attached only while
  // calloutCreation is non-null to avoid noise when the user isn't creating.
  useEffect(() => {
    if (!calloutCreation) return;
    const onMove = (e) => {
      if (!svgRef.current) return;
      const pt = screenToSVG(svgRef.current, e.clientX, e.clientY);
      setCalloutCreation((prev) => prev ? { ...prev, currentPointer: pt } : null);
    };
    const onUp = () => {
      const state = calloutCreationRef.current;
      setCalloutCreation(null);
      if (!state) return;
      const W = width || 1;
      const H = height || 1;
      // UX: min-drag threshold — 4px in page space. Short clicks are
      // treated as cancels (no stray 0x0 callout committed).
      const dx = state.currentPointer.x - state.arrowTip.x;
      const dy = state.currentPointer.y - state.arrowTip.y;
      if (dx * dx + dy * dy < 16) return;

      const arrowTipNorm = { x: state.arrowTip.x / W, y: state.arrowTip.y / H };
      const textBoxNorm = { x: state.currentPointer.x / W, y: state.currentPointer.y / H };
      // UX: combined-tools creation formula — knee midway between textbox
      // and arrowTip, offset upward by 40 page px.
      // See COMBINED-TOOLS-AUDIT.md "Text Callout Tool → Creation flow".
      const kneeNorm = {
        x: (arrowTipNorm.x + textBoxNorm.x) / 2,
        y: arrowTipNorm.y - 40 / H,
      };
      const newCallout = createCallout(
        pageNumber,
        arrowTipNorm,
        kneeNorm,
        textBoxNorm,
        120 / W, // default textbox width ~120px normalized
        32 / H   // default textbox height ~32px normalized
      );
      if (onCreateCallout) onCreateCallout(newCallout);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [calloutCreation, width, height, pageNumber, onCreateCallout, svgRef]);

  // UX: Phase 14 CREATE-01 — clear preview state on tool switch mid-drag.
  // Without this, switching from callout tool to select mid-drag would
  // leave a stray dashed preview mounted until the next pointerup.
  useEffect(() => {
    if (activeTool !== 'callout') {
      setCalloutCreation(null);
    }
  }, [activeTool]);

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

    // Edit-mode gate: pill NEVER arms while the user is mid-edit in a
    // Fabric-owned surface (text / callout). Bbox edit mode, by contrast,
    // IS the rotation-pill experience — so leave the pill armed when
    // editingAnnotationEditType === 'bbox' so the user can type an exact
    // angle into the pill after double-clicking.
    if (editingAnnotationIndex != null && editingAnnotationEditType !== 'bbox') {
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
    const hasSingleRegularSelection = selectedIds?.size === 1;
    const hasSurveyHighlightSelection = !!selectedSurveyHighlightId && (!selectedIds || selectedIds.size === 0);
    if (!hasSingleRegularSelection && !hasSurveyHighlightSelection) {
      setRotInputVisibleDbg(false, 'no single rotation target selected');
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
  }, [selectedIds, selectedSurveyHighlightId, setRotInputVisibleDbg, editingAnnotationIndex]);

  // ---------------------------------------------------------------------------
  // EDIT-12: Derived state for RotationInputField props
  // ---------------------------------------------------------------------------
  // UX: active rotation drag forces the input visible regardless of hover
  // state — the input live-updates with the integer-rounded angle as the
  // shape rotates. This is the "drag wins" rule from CONTEXT.md.
  const isRotating = !!(visualTransform?.rotate);
  const isSurveyHighlightRotating = !!(
    surveyHighlightPreviewBounds &&
    surveyHighlightDragRef.current?.mode === 'rotate'
  );
  const showRotationInput = isRotating || isSurveyHighlightRotating || rotInputVisible;

  const selectedAnnotationIndex = (selectedIds && selectedIds.size === 1)
    ? Array.from(selectedIds)[0]
    : null;
  // UX 2026-04-20: counter pill reads data.pointerAngle + 90 so 0°
  // corresponds to "nub pointing straight up" (matches the mental model
  // the user described). Non-counter shapes read obj.angle as before.
  const _selectedObjForAngle = (selectedAnnotationIndex !== null)
    ? annotations?.objects?.[selectedAnnotationIndex]
    : null;
  const _selectedIsCounter = _selectedObjForAngle?.data?.type === 'counter';
  const _selectedCounterPreviewAngle = (
    _selectedIsCounter
    && counterHandlePreview?.annotationIndex === selectedAnnotationIndex
    && Number.isFinite(Number(counterHandlePreview.pointerAngle))
  )
    ? Number(counterHandlePreview.pointerAngle)
    : null;
  const persistedAngle = (selectedAnnotationIndex !== null)
    ? (_selectedIsCounter
        ? (((_selectedCounterPreviewAngle ?? _selectedObjForAngle?.data?.pointerAngle ?? 225) + 90 + 360) % 360)
        : (_selectedObjForAngle?.angle || 0))
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

    if (typeof annotationIndex === 'string' && annotationIndex.startsWith('survey:')) {
      const highlightId = annotationIndex.slice('survey:'.length);
      const highlight = Array.isArray(surveyHighlights)
        ? surveyHighlights.find((entry) => entry?.highlightId === highlightId)
        : null;
      if (!highlight) return;
      const nextBounds = normalizeSurveyHighlightBoundsValue({
        x: highlight.x,
        y: highlight.y,
        width: highlight.width,
        height: highlight.height,
        angle: newAngle,
      });
      onUpdateSurveyHighlightBounds?.(pageNumber, highlightId, nextBounds, {
        action: 'rotate',
      });
      setSurveyHighlightPreviewBounds(null);
      return;
    }

    // EDIT-12 Gap 1 fix: optimistic visual paint FIRST — cheap SVG transform
    // that makes the shape appear at the new angle on the next frame. This
    // matches the drag-rotate pattern (useSVGInteraction.js handlePointerMove
    // rotate branch) where visualTransform.rotate is set on every tick and
    // onSaveAnnotations only fires on pointerup. Drag feels instant because
    // the user sees the optimistic paint before the heavy save pipeline runs.
    // Typed-commit lag (UAT Gap 1) came from skipping this step and going
    // straight to onSaveAnnotations, which runs history fingerprinting +
    // JSON.stringify + deep-compare before React can re-render.
    // UX 2026-04-20: counters don't rotate via obj.angle — their pill value
    // maps to data.pointerAngle (with a -90° offset so the pill reads 0
    // when the nub points up). Skip the optimistic visual paint for
    // counters since there's no rotation transform to mirror; just commit.
    const targetObj = annotations?.objects?.[annotationIndex];
    const isCounterTarget = targetObj?.data?.type === 'counter';
    if (!isCounterTarget) {
      applyOptimisticRotation(annotationIndex, newAngle);
      pendingOptimisticRotationRef.current = { annotationIndex, angle: newAngle };
    }

    // Existing heavy save path — unchanged. Runs in parallel with the optimistic
    // paint; when the persisted annotation eventually reflects the new angle,
    // the cleanup useEffect below clears visualTransform.
    const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
    if (!updatedAnnotations.objects?.[annotationIndex]) {
      pendingOptimisticRotationRef.current = null;
      clearOptimisticRotation();
      return;
    }
    if (isCounterTarget) {
      const newPointerAngle = ((newAngle - 90) % 360 + 360) % 360;
      const prevData = updatedAnnotations.objects[annotationIndex].data || {};
      updatedAnnotations.objects[annotationIndex].data = {
        ...prevData,
        pointerAngle: newPointerAngle,
      };
    } else {
      updatedAnnotations.objects[annotationIndex].angle = newAngle;
    }
    onSaveAnnotations(updatedAnnotations, {
      source: 'rotation-input',
      action: 'rotate',
      checkpointPolicy: 'normal',
    });
  }, [
    annotations,
    onSaveAnnotations,
    applyOptimisticRotation,
    clearOptimisticRotation,
    onUpdateSurveyHighlightBounds,
    pageNumber,
    surveyHighlights,
  ]);

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
    setSurveyHighlightPreviewBounds(null);
    // No-op otherwise — input handles its own state revert. Parent doesn't
    // track typed value. Escape simply blurs the input and the displayed
    // angle snaps back to props.angle (the persisted value).
  }, [clearOptimisticRotation]);

  const commitCounterHandlePreview = useCallback((preview) => {
    if (!preview || preview.annotationIndex == null) return;
    const currentAnnotations = annotationsRef.current;
    const currentObj = currentAnnotations?.objects?.[preview.annotationIndex];
    if (currentObj?.data?.type !== 'counter') return;
    const currentAngle = Number(currentObj.data?.pointerAngle ?? 225);
    const nextAngle = Number(preview.pointerAngle);
    if (!Number.isFinite(nextAngle)) return;
    if (Math.abs(currentAngle - nextAngle) < 0.001) return;

    const updatedAnnotations = JSON.parse(JSON.stringify(currentAnnotations));
    const targetObj = updatedAnnotations.objects?.[preview.annotationIndex];
    if (!targetObj) return;
    targetObj.data = { ...(targetObj.data || {}), pointerAngle: nextAngle };
    onSaveAnnotations(updatedAnnotations, {
      source: 'counter:rotate-commit',
      action: 'counter-rotate',
      checkpointPolicy: 'normal',
    });
  }, [onSaveAnnotations]);

  useEffect(() => {
    const preview = counterHandlePreviewRef.current;
    if (!preview) return;
    if (selectedIds?.has?.(preview.annotationIndex)) return;
    commitCounterHandlePreview(preview);
    counterHandlePreviewRef.current = null;
    setCounterHandlePreview(null);
  }, [commitCounterHandlePreview, selectedIds]);

  // Issue 4 flicker fix: handleRotationInputHoverChange is a child callback,
  // so its identity matters — every reference change invalidates the child's
  // useCallback chains that depend on onHoverChange. Read rotInputVisible
  // and isRotating via refs so this callback is STABLE across visibility
  // and rotation changes.
  const isRotatingRef = useRef(false);
  useEffect(() => {
    isRotatingRef.current = isRotating || isSurveyHighlightRotating;
  }, [isRotating, isSurveyHighlightRotating]);

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
      return getSpaceIdForRegionFromSpaces(regionId, spaces);
    };
  }, [spaces]);

  // ---------------------------------------------------------------------------
  // Filter annotation objects — returns { obj, index, element }[] for wrapping
  // (Selection wrapping happens in render body to avoid useMemo invalidation
  //  on every selection/hover change)
  // ---------------------------------------------------------------------------
  const filteredAnnotations = useMemo(() => {
    // 2026-05-03 — Viewport-culling fast exit. Off-window pages return an
    // empty render set so the SVG layer is mounted (preserving layout +
    // ref stability) but does no per-object work. The page gets its full
    // render the moment isPageInRenderWindow flips true on scroll.
    if (!isPageInRenderWindow) return [];
    const objects = Array.isArray(annotations?.objects)
      ? annotations.objects
      : [];

    // DIAG: log what the SVG layer receives for each page so we can
    // cross-reference with the [PDF-IMPORT] log. Only log when there's
    // a PDF-imported object to avoid noise on non-imported pages.
    // 2026-04-30: silenced — fires per-page on every memo recompute.
    // Re-enable per session via window.__DIAG_SVG_IMPORT_RECV = true.
    if (typeof window !== 'undefined' && window.__DIAG_SVG_IMPORT_RECV) {
      try {
        const hasPdfImported = objects.some((o) => o?.isPdfImported);
        if (hasPdfImported) {
          console.log(`[SVG-RENDER] Page ${pageNumber} received ${objects.length} objects`,
            objects.map((o, i) => ({
              i,
              type: o?.type,
              pdfId: o?.pdfAnnotationId,
              text: typeof o?.text === 'string' ? o.text.slice(0, 30) : undefined,
              visible: o?.visible,
              isPdfImported: o?.isPdfImported,
              left: o?.left,
              top: o?.top,
              width: o?.width,
              height: o?.height,
            }))
          );
        }
      } catch (e) {
        console.warn('[SVG-RENDER] diag log failed', e);
      }
    }

    if (objects.length === 0) return [];

    // Diagnostic summary for user-shared logs. This answers: did this page
    // render smooth filled Drawboard/Adobe outlines, open stroked ink, or
    // duplicate path geometry? Keep it aggregate-only so dense pages do not
    // spam thousands of per-path records.
    if (typeof window !== 'undefined' && window.__SVG_PATH_RENDER_DIAG === true) {
      try {
        const pathStats = {
          pageNumber,
          inputObjects: objects.length,
          pathCount: 0,
          filledSmooth: 0,
          filledNotSmooth: 0,
          openStrokedCurved: 0,
          openStrokedLineOnly: 0,
          exactDuplicateGroups: 0,
          bboxDuplicateGroups: 0,
          sampleProblemPaths: [],
        };
        const exactGroups = new Map();
        const bboxGroups = new Map();
        objects.forEach((candidate, idx) => {
          if (String(candidate?.type || '').toLowerCase() !== 'path' || !Array.isArray(candidate?.path)) return;
          pathStats.pathCount += 1;
          const attrs = renderPathToSvgAttrs(candidate);
          const d = renderPathToSvgD(candidate, attrs);
          const hasC = /\bC\b/.test(d);
          const hasQ = /\bQ\b/.test(d);
          const hasL = /\bL\b/.test(d);
          const isFilled = attrs.stroke === 'none' && attrs.fill && attrs.fill !== 'none';
          const isStroked = attrs.stroke && attrs.stroke !== 'none';
          if (isFilled && attrs.smoothClosedOutline === true && hasC) pathStats.filledSmooth += 1;
          else if (isFilled) {
            pathStats.filledNotSmooth += 1;
            if (pathStats.sampleProblemPaths.length < 8) {
              pathStats.sampleProblemPaths.push({
                idx,
                kind: 'filled-not-smooth',
                id: candidate?.id || candidate?.data?.id || candidate?.pdfAnnotationId || null,
                fill: attrs.fill,
                stroke: attrs.stroke,
                strokeWidth: attrs.strokeWidth,
                commands: { hasC, hasQ, hasL },
                dHead: d.slice(0, 120),
              });
            }
          } else if (isStroked && (hasC || hasQ)) pathStats.openStrokedCurved += 1;
          else if (isStroked) {
            pathStats.openStrokedLineOnly += 1;
            if (pathStats.sampleProblemPaths.length < 8) {
              pathStats.sampleProblemPaths.push({
                idx,
                kind: 'open-stroked-line-only',
                id: candidate?.id || candidate?.data?.id || candidate?.pdfAnnotationId || null,
                stroke: attrs.stroke,
                strokeWidth: attrs.strokeWidth,
                vectorEffect: attrs.vectorEffect || null,
                commands: { hasC, hasQ, hasL },
                dHead: d.slice(0, 120),
              });
            }
          }
          const exactKey = `${attrs.fill}|${attrs.stroke}|${Math.round(candidate.left || 0)}|${Math.round(candidate.top || 0)}|${d}`;
          exactGroups.set(exactKey, (exactGroups.get(exactKey) || 0) + 1);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const seg of candidate.path || []) {
            for (let j = 1; j + 1 < seg.length; j += 2) {
              const x = Number(seg[j]);
              const y = Number(seg[j + 1]);
              if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          if (Number.isFinite(minX) && Number.isFinite(minY)) {
            const bboxKey = [
              attrs.fill,
              attrs.stroke,
              Math.round(candidate.left || 0),
              Math.round(candidate.top || 0),
              Math.round(maxX - minX),
              Math.round(maxY - minY),
            ].join('|');
            bboxGroups.set(bboxKey, (bboxGroups.get(bboxKey) || 0) + 1);
          }
        });
        pathStats.exactDuplicateGroups = [...exactGroups.values()].filter((count) => count > 1).length;
        pathStats.bboxDuplicateGroups = [...bboxGroups.values()].filter((count) => count > 1).length;
        if (!window.__diagSVGPathRenderStats) window.__diagSVGPathRenderStats = {};
        window.__diagSVGPathRenderStats[pageNumber] = pathStats;
        if (pathStats.pathCount > 0) {
          console.log('[SVGPathRenderStats] ' + JSON.stringify(pathStats));
        }
      } catch (diagErr) {
        console.warn('[SVGPathRenderStats] failed ' + (diagErr?.message || String(diagErr)));
      }
    }

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
      activeRegions.some((region) => region && typeof region === 'object') &&
      isOverlayEnabledForThisPage;

    const results = [];
    let count = 0;
    // Diagnostics: count each drop reason so the tool-switch probe can report
    // why the SVG layer dropped certain annotations (vs the eraser path).
    const dropReasons = {
      nullOrHiddenFlag: [],
      layerHidden: [],
      spaceMismatch: [],
      surveyHidden: [],
      scopedRegionHidden: [],
      pageScopedHidden: [],
      noElementDispatched: [],
      maxPreviewCap: [],
      // Bug 1 diag (2026-04-30): track every fabric object that the skip-guard
      // dropped because it carries a highlightId. This bucket should match the
      // count of survey highlights rendered through the dedicated memo. If a
      // survey highlight ID appears in the layer WITHOUT an entry here, it
      // means the deserializer-stamp regression is back and the same highlight
      // is rendering twice. Inspect via window.__diagSVGFilterStats[page].
      surveyHighlightSkip: [],
    };

    // UX: in eraser mode the SVG layer renders every imported annotation,
    // not just textboxes. The App.jsx wrapper stays visible in eraser mode,
    // and the FabricEraserCanvas layer above it hides each imported object
    // with opacity: 0 (see FabricEraserCanvas.jsx imported-override block)
    // — so the SVG <g> underneath is the sole visual truth. This is the
    // Phase 2 extension of the 2026-04-10 rasterizer-mismatch structural
    // fix: it eliminates the ~0.16px per-edge shift on tool switch and
    // gives us smooth eraser-mode zoom for free (SVG viewBox is GPU-
    // composited while Fabric's ResizeObserver redraw happens invisibly).
    // No early-skip gate here — the filter renders in eraser mode
    // identically to selector mode.

    // 2026-05-03 — Per-page render cap removed. UX: a hard ceiling that
    // silently drops drawings is unacceptable for a PDF annotation app —
    // Adobe / Drawboard render every stroke. If a heavy page feels laggy
    // the right answer is viewport-only painting (skip drawings outside
    // the visible scroll window), not a hard cap. Tracked as follow-up.
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (!obj) {
        dropReasons.nullOrHiddenFlag.push(i);
        continue;
      }
      // Skip legacy survey-highlight rects baked into pageAnnotations by PAL
      // (they carry a highlightId). They now render through the dedicated
      // surveyHighlightElements memo below so highlightAnnotations state stays
      // the single source of truth for survey highlights.
      if (obj.highlightId) {
        // Bug 1 diag — track every skip so the user can compare against the
        // surveyHighlightElements render set; a mismatch means the de-
        // serializer regression is back and the same highlight is rendering
        // twice (darker on second device).
        dropReasons.surveyHighlightSkip.push({ i, highlightId: obj.highlightId });
        continue;
      }
      // obj.visible is a transient Fabric runtime flag used by PAL to hide
      // non-survey annotations while survey mode is active. Fabric's toJSON
      // serializes it, so the survey-mode hide would persist into the saved
      // annotations and keep regular annotations invisible after exiting
      // survey mode. Visibility is owned by the three-layer filter below
      // (showSurveyPanel + selectedModuleId + space/region), not by this
      // persisted flag — so ignore it here.

      // --- Layer visibility check ---
      const layer = obj.layer || 'native';
      if (layerVisibility && layerVisibility[layer] === false) {
        dropReasons.layerHidden.push({ i, layer });
        continue;
      }

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
        if (derivedSpaceId === null) {
          scopedRegionAnnotationVisible = false;
        } else if (activeSpaceId === null) {
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

      if (!isVisible) {
        if (!matchesSpace) dropReasons.spaceMismatch.push({ i, derivedSpaceId, activeSpaceId });
        else if (!surveyAnnotationVisible) dropReasons.surveyHidden.push({ i, moduleId: obj.moduleId, selectedModuleId, showSurveyPanel });
        else if (!scopedRegionAnnotationVisible) dropReasons.scopedRegionHidden.push({ i, regionId: obj.regionId, activeSpaceId, activeRegionId });
        else if (!pageScopedAnnotationVisible) dropReasons.pageScopedHidden.push({ i, scope: visibilityScope });
        continue;
      }

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
        if (window.__COUNTER_SVG_DIAG) {
          console.log(`[Counter SVG p${pageNumber}] dispatching renderCounter — i=${i}, displayNumber=${obj.data.displayNumber}, fill=${obj.fill}, numberColor=${obj.data.numberColor || 'unset'}, left=${obj.left}, top=${obj.top}, radius=${obj.radius}`);
        }
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
        objectType === 'polygon' &&
        Array.isArray(obj.points) &&
        obj.points.length > 0
      ) {
        // PDF-imported polygons arrive with points[] but no path/objects —
        // needed so imported Polygon annotations render at parity with the
        // FabricEraserCanvas (which native-enlivens the same JSON).
        element = renderPolygon(obj, i);
      } else if (
        objectType === 'polyline' &&
        Array.isArray(obj.points) &&
        obj.points.length > 0
      ) {
        // Same fix as polygon, for open PolyLine annotations from the PDF.
        element = renderPolyline(obj, i);
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
      } else {
        dropReasons.noElementDispatched.push({ i, type: objectType, hasPath: Array.isArray(obj?.path), hasObjects: Array.isArray(obj?.objects) });
      }
    }

    // Diagnostics sink: stash the drop reasons on window for the tool-switch
    // capture to pick up. Only stored — not logged per-object — to avoid spam.
    if (typeof window !== 'undefined') {
      if (!window.__diagSVGFilterStats) window.__diagSVGFilterStats = {};
      window.__diagSVGFilterStats[pageNumber] = {
        inputCount: objects.length,
        renderedCount: results.length,
        dropReasons: {
          nullOrHiddenFlag: dropReasons.nullOrHiddenFlag.length,
          layerHidden: dropReasons.layerHidden.length,
          spaceMismatch: dropReasons.spaceMismatch.length,
          surveyHidden: dropReasons.surveyHidden.length,
          scopedRegionHidden: dropReasons.scopedRegionHidden.length,
          pageScopedHidden: dropReasons.pageScopedHidden.length,
          noElementDispatched: dropReasons.noElementDispatched.length,
          maxPreviewCap: dropReasons.maxPreviewCap.length,
          surveyHighlightSkip: dropReasons.surveyHighlightSkip.length,
        },
        dropDetails: dropReasons,
      };
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
    activeTool,
    editingAnnotationIndex,
    isPageInRenderWindow,
  ]);

  useLayoutEffect(() => {
    renderedAnnotationEntriesRef.current = Array.isArray(filteredAnnotations)
      ? filteredAnnotations.filter((entry) => entry?.isObjectInteractive)
      : [];
    if (typeof window !== 'undefined') {
      if (!window.__renderedAnnotationRegistry) window.__renderedAnnotationRegistry = {};
      window.__renderedAnnotationRegistry[pageNumber] = renderedAnnotationEntriesRef.current.map((entry) => ({
        index: entry.index,
        id: entry.obj?.id || null,
        fabricId: entry.obj?.data?.fabricId || null,
        highlightId: entry.obj?.highlightId || entry.obj?.data?.highlightId || null,
        type: entry.obj?.type || null,
        tool: entry.obj?.tool || null,
        dataType: entry.obj?.data?.type || null,
        moduleId: entry.obj?.moduleId || null,
        regionId: entry.obj?.regionId || null,
        spaceId: entry.obj?.spaceId || null,
      }));
    }
  }, [filteredAnnotations, pageNumber]);

  // ---------------------------------------------------------------------------
  // Survey highlight rects — synthesized from the surveyHighlights prop and
  // filtered through the same three-layer visibility rules as annotation
  // objects. They are also selectable/editable through a lightweight SVG path
  // because they live in highlightAnnotations, not annotations.objects.
  // ---------------------------------------------------------------------------
  const surveyHighlightElements = useMemo(() => {
    if (!Array.isArray(surveyHighlights) || surveyHighlights.length === 0) return [];

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
      activeRegions.some((region) => region && typeof region === 'object') &&
      isOverlayEnabledForThisPage;

    const elements = [];
    const dropReasons = {
      nullHighlight: [],
      spaceMismatch: [],
      surveyHidden: [],
      scopedRegionHidden: [],
      pageScopedHidden: [],
    };
    for (let i = 0; i < surveyHighlights.length; i++) {
      const h = surveyHighlights[i];
      if (!h) {
        dropReasons.nullHighlight.push({ i });
        continue;
      }

      const visibilityScope = getAnnotationVisibilityScope({
        moduleId: h.moduleId,
        regionId: h.regionId,
      });
      const isSurveyAnnotation =
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY ||
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
      const isScopedRegionAnnotation =
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.REGION ||
        visibilityScope === ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION;
      const derivedSpaceId = isScopedRegionAnnotation ? getSpaceIdForRegion(h.regionId) : null;

      let matchesSpace = true;
      if (hasActiveRegions && !isScopedRegionAnnotation) {
        matchesSpace = true;
      } else if (isScopedRegionAnnotation && derivedSpaceId !== null) {
        matchesSpace = activeSpaceId !== null && derivedSpaceId === activeSpaceId;
      }

      let surveyAnnotationVisible = true;
      if (isSurveyAnnotation) {
        surveyAnnotationVisible =
          showSurveyPanel && selectedModuleId !== null && h.moduleId === selectedModuleId;
      } else if (!isScopedRegionAnnotation) {
        surveyAnnotationVisible = !(showSurveyPanel && selectedModuleId !== null);
      }

      let scopedRegionAnnotationVisible = true;
      if (isScopedRegionAnnotation) {
        if (activeSpaceId === null) {
          scopedRegionAnnotationVisible = false;
        } else if (hasActiveRegions) {
          scopedRegionAnnotationVisible = true;
        } else if (activeRegionId !== null) {
          scopedRegionAnnotationVisible = h.regionId === activeRegionId;
        } else {
          scopedRegionAnnotationVisible = false;
        }
      }

      let pageScopedAnnotationVisible = true;
      if (!isScopedRegionAnnotation && selectedSpaceId !== null) {
        pageScopedAnnotationVisible = isAnnotationVisibleByPageControl({
          scope: visibilityScope,
          canvasVisible: getCanvasAnnotationVisibilityState
            ? getCanvasAnnotationVisibilityState(selectedSpaceId, pageNumber)
            : true,
          surveyVisible: getSurveyAnnotationVisibilityState
            ? getSurveyAnnotationVisibilityState(selectedSpaceId, pageNumber)
            : true,
        });
      }

      const isVisible =
        matchesSpace &&
        surveyAnnotationVisible &&
        scopedRegionAnnotationVisible &&
        pageScopedAnnotationVisible;

      if (!isVisible) {
        const detail = {
          i,
          highlightId: h.highlightId || null,
          moduleId: h.moduleId || null,
          regionId: h.regionId || null,
          scope: visibilityScope,
          selectedModuleId,
          showSurveyPanel,
          derivedSpaceId,
          activeSpaceId,
          activeRegionId,
          pageNumber,
        };
        if (!matchesSpace) dropReasons.spaceMismatch.push(detail);
        else if (!surveyAnnotationVisible) dropReasons.surveyHidden.push(detail);
        else if (!scopedRegionAnnotationVisible) dropReasons.scopedRegionHidden.push(detail);
        else if (!pageScopedAnnotationVisible) dropReasons.pageScopedHidden.push(detail);
        continue;
      }

      const pseudoRect = {
        type: 'rect',
        highlightId: h.highlightId,
        left: h.x,
        top: h.y,
        width: h.width,
        height: h.height,
        fill: h.needsBIC ? 'transparent' : (h.color || 'rgba(255,235,59,0.25)'),
        stroke: h.needsBIC ? '#4A90E2' : 'transparent',
        strokeWidth: h.needsBIC ? 2 : 0,
        strokeDashArray: h.needsBIC ? [5, 5] : undefined,
        globalCompositeOperation: 'multiply',
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        angle: normalizeDegreesValue(h.angle),
      };
      elements.push({
        highlight: h,
        bbox: pseudoRect,
        key: `survey-hl-${h.highlightId || i}`,
      });
    }
    if (typeof window !== 'undefined') {
      if (!window.__diagSurveyHighlightVisibilityStats) window.__diagSurveyHighlightVisibilityStats = {};
      window.__diagSurveyHighlightVisibilityStats[pageNumber] = {
        inputCount: surveyHighlights.length,
        renderedCount: elements.length,
        context: {
          selectedModuleId,
          showSurveyPanel,
          selectedSpaceId,
          activeSpaceId,
          activeRegionId,
          hasActiveRegions,
        },
        dropReasons: {
          nullHighlight: dropReasons.nullHighlight.length,
          spaceMismatch: dropReasons.spaceMismatch.length,
          surveyHidden: dropReasons.surveyHidden.length,
          scopedRegionHidden: dropReasons.scopedRegionHidden.length,
          pageScopedHidden: dropReasons.pageScopedHidden.length,
        },
        dropDetails: dropReasons,
      };
      if (window.__DIAG_SURVEY_REGION_VISIBILITY) {
        console.log(
          `[SurveyHighlightVisibility p${pageNumber}] ` +
          JSON.stringify(window.__diagSurveyHighlightVisibilityStats[pageNumber])
        );
      }
    }
    return elements;
  }, [
    surveyHighlights,
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
    getSpaceIdForRegion,
  ]);

  useEffect(() => {
    if (!selectedSurveyHighlightId) return;
    const stillVisible = surveyHighlightElements.some((entry) =>
      entry?.highlight?.highlightId === selectedSurveyHighlightId
    );
    if (!stillVisible) {
      setSelectedSurveyHighlightId(null);
      setSurveyHighlightPreviewBounds(null);
      surveyHighlightDragRef.current = null;
    }
  }, [selectedSurveyHighlightId, surveyHighlightElements]);

  useEffect(() => {
    if (isSelectTool) return;
    setSelectedSurveyHighlightId(null);
    setHoveredSurveyHighlightId(null);
    setSurveyHighlightPreviewBounds(null);
    surveyHighlightDragRef.current = null;
  }, [isSelectTool]);

  useEffect(() => {
    if (!isSelectTool || !selectedSurveyHighlightId) return;

    const handleKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      const el = document.activeElement;
      if (el) {
        if (el.tagName === 'INPUT') return;
        if (el.tagName === 'TEXTAREA') return;
        if (el.isContentEditable === true) return;
        if (el.contentEditable === 'true') return;
      }

      e.preventDefault();
      e.stopPropagation();
      onDeleteSurveyHighlight?.(selectedSurveyHighlightId);
      setSelectedSurveyHighlightId(null);
      setHoveredSurveyHighlightId(null);
      setSurveyHighlightPreviewBounds(null);
      surveyHighlightDragRef.current = null;
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isSelectTool, onDeleteSurveyHighlight, selectedSurveyHighlightId]);

  useLayoutEffect(() => {
    if (!pendingSurveyHighlightSelection) return;
    if (pendingSurveyHighlightSelection.pageNumber !== pageNumber) {
      setSelectedSurveyHighlightId(null);
      setSurveyHighlightPreviewBounds(null);
      surveyHighlightDragRef.current = null;
      return;
    }

    const highlightId = pendingSurveyHighlightSelection.highlightId;
    if (!highlightId) {
      setSelectedSurveyHighlightId(null);
      setSurveyHighlightPreviewBounds(null);
      surveyHighlightDragRef.current = null;
      return;
    }

    const isVisible = surveyHighlightElements.some((entry) =>
      entry?.highlight?.highlightId === highlightId
    );
    if (!isVisible) return;

    deselectAll();
    onSelectedCalloutIdsChange?.(new Set());
    setSelectedSurveyHighlightId(highlightId);
    setHoveredSurveyHighlightId(null);
    setSurveyHighlightPreviewBounds(null);
    onPendingSurveyHighlightSelectionConsumed?.(pendingSurveyHighlightSelection);
  }, [
    deselectAll,
    onSelectedCalloutIdsChange,
    onPendingSurveyHighlightSelectionConsumed,
    pageNumber,
    pendingSurveyHighlightSelection,
    surveyHighlightElements,
  ]);

  const normalizeSurveyHighlightBounds = useCallback((bounds) => {
    return normalizeSurveyHighlightBoundsValue(bounds);
  }, []);

  const resizeSurveyHighlightBoundsRotated = useCallback((bounds, handleId, point) => {
    const affectsX = !['mt', 'mb'].includes(handleId);
    const affectsY = !['ml', 'mr'].includes(handleId);
    const isLeftHandle = ['tl', 'ml', 'bl'].includes(handleId);
    const isTopHandle = ['tl', 'mt', 'tr'].includes(handleId);

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const anchorMap = {
      tl: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      tr: { x: bounds.x, y: bounds.y + bounds.height },
      bl: { x: bounds.x + bounds.width, y: bounds.y },
      br: { x: bounds.x, y: bounds.y },
      mt: { x: centerX, y: bounds.y + bounds.height },
      mb: { x: centerX, y: bounds.y },
      ml: { x: bounds.x + bounds.width, y: centerY },
      mr: { x: bounds.x, y: centerY },
    };
    const anchor = anchorMap[handleId] || { x: centerX, y: centerY };

    const angleRad = (bounds.angle * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const anchorLocalDx = anchor.x - centerX;
    const anchorLocalDy = anchor.y - centerY;
    const worldAnchorX = centerX + anchorLocalDx * cosA - anchorLocalDy * sinA;
    const worldAnchorY = centerY + anchorLocalDx * sinA + anchorLocalDy * cosA;

    const ptrDxWorld = point.x - worldAnchorX;
    const ptrDyWorld = point.y - worldAnchorY;
    const ptrDxLocal = ptrDxWorld * cosA + ptrDyWorld * sinA;
    const ptrDyLocal = -ptrDxWorld * sinA + ptrDyWorld * cosA;

    let scaleX = 1;
    let scaleY = 1;
    if (affectsX && bounds.width !== 0) {
      const signedLocalDx = isLeftHandle ? -ptrDxLocal : ptrDxLocal;
      scaleX = signedLocalDx / bounds.width;
    }
    if (affectsY && bounds.height !== 0) {
      const signedLocalDy = isTopHandle ? -ptrDyLocal : ptrDyLocal;
      scaleY = signedLocalDy / bounds.height;
    }
    if (Math.abs(scaleX) < 0.01) scaleX = (scaleX < 0 ? -1 : 1) * 0.01;
    if (Math.abs(scaleY) < 0.01) scaleY = (scaleY < 0 ? -1 : 1) * 0.01;

    const nextWidth = affectsX ? Math.max(1, bounds.width * Math.abs(scaleX)) : bounds.width;
    const nextHeight = affectsY ? Math.max(1, bounds.height * Math.abs(scaleY)) : bounds.height;

    let offsetFromAnchorX = 0;
    let offsetFromAnchorY = 0;
    if (affectsX) {
      offsetFromAnchorX = isLeftHandle ? -nextWidth / 2 : nextWidth / 2;
      if (scaleX < 0) offsetFromAnchorX = -offsetFromAnchorX;
    }
    if (affectsY) {
      offsetFromAnchorY = isTopHandle ? -nextHeight / 2 : nextHeight / 2;
      if (scaleY < 0) offsetFromAnchorY = -offsetFromAnchorY;
    }

    const worldOffsetX = offsetFromAnchorX * cosA - offsetFromAnchorY * sinA;
    const worldOffsetY = offsetFromAnchorX * sinA + offsetFromAnchorY * cosA;
    const nextCenterX = worldAnchorX + worldOffsetX;
    const nextCenterY = worldAnchorY + worldOffsetY;

    return {
      x: nextCenterX - nextWidth / 2,
      y: nextCenterY - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
      angle: bounds.angle,
    };
  }, []);

  const handleSurveyHighlightPointerDown = useCallback((e, entry) => {
    if (!isSelectTool || !entry?.highlight?.highlightId) return;
    e.stopPropagation();
    e.preventDefault();
    const startPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
    const originalBounds = normalizeSurveyHighlightBounds({
      x: entry.bbox.left,
      y: entry.bbox.top,
      width: entry.bbox.width,
      height: entry.bbox.height,
      angle: entry.bbox.angle,
    });
    deselectAll();
    onSelectedCalloutIdsChange?.(new Set());
    setSelectedSurveyHighlightId(entry.highlight.highlightId);
    surveyHighlightDragRef.current = {
      mode: 'move',
      highlightId: entry.highlight.highlightId,
      startPoint,
      originalBounds,
    };
    setSurveyHighlightPreviewBounds(null);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
  }, [deselectAll, isSelectTool, normalizeSurveyHighlightBounds, onSelectedCalloutIdsChange]);

  const handleSurveyHighlightHandlePointerDown = useCallback((e, entry, handleId) => {
    if (!isSelectTool || !entry?.highlight?.highlightId) return;
    e.stopPropagation();
    e.preventDefault();
    const startPoint = screenToSVG(svgRef.current, e.clientX, e.clientY);
    const originalBounds = normalizeSurveyHighlightBounds({
      x: entry.bbox.left,
      y: entry.bbox.top,
      width: entry.bbox.width,
      height: entry.bbox.height,
      angle: entry.bbox.angle,
    });
    const centerX = originalBounds.x + originalBounds.width / 2;
    const centerY = originalBounds.y + originalBounds.height / 2;
    setSelectedSurveyHighlightId(entry.highlight.highlightId);
    surveyHighlightDragRef.current = {
      mode: handleId === 'mtr' ? 'rotate' : 'resize',
      handleId,
      highlightId: entry.highlight.highlightId,
      startPoint,
      originalBounds,
      centerX,
      centerY,
      startPointerAngle: handleId === 'mtr'
        ? normalizeAngle(Math.atan2(startPoint.y - centerY, startPoint.x - centerX))
        : 0,
    };
    setSurveyHighlightPreviewBounds({ highlightId: entry.highlight.highlightId, bounds: originalBounds });
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
  }, [isSelectTool, normalizeSurveyHighlightBounds]);

  const updateSurveyHighlightDrag = useCallback((e, commit = false) => {
    const drag = surveyHighlightDragRef.current;
    if (!drag) return false;

    e.stopPropagation();
    e.preventDefault();
    const point = screenToSVG(svgRef.current, e.clientX, e.clientY);
    const dx = point.x - drag.startPoint.x;
    const dy = point.y - drag.startPoint.y;
    let nextBounds;
    if (drag.mode === 'rotate') {
      const pointerAngle = normalizeAngle(Math.atan2(point.y - drag.centerY, point.x - drag.centerX));
      nextBounds = {
        ...drag.originalBounds,
        angle: normalizeDegreesValue(drag.originalBounds.angle + pointerAngle - drag.startPointerAngle),
      };
    } else if (drag.mode === 'resize') {
      nextBounds = resizeSurveyHighlightBoundsRotated(drag.originalBounds, drag.handleId, point);
    } else {
      nextBounds = {
        ...drag.originalBounds,
        x: drag.originalBounds.x + dx,
        y: drag.originalBounds.y + dy,
      };
    }

    if (commit) {
      surveyHighlightDragRef.current = null;
      setSurveyHighlightPreviewBounds(null);
      const changed =
        Math.abs(nextBounds.x - drag.originalBounds.x) > 0.1 ||
        Math.abs(nextBounds.y - drag.originalBounds.y) > 0.1 ||
        Math.abs(nextBounds.width - drag.originalBounds.width) > 0.1 ||
        Math.abs(nextBounds.height - drag.originalBounds.height) > 0.1 ||
        Math.abs(nextBounds.angle - drag.originalBounds.angle) > 0.1;
      if (changed) {
        onUpdateSurveyHighlightBounds?.(pageNumber, drag.highlightId, nextBounds, {
          action: drag.mode,
        });
      }
    } else {
      setSurveyHighlightPreviewBounds({ highlightId: drag.highlightId, bounds: nextBounds });
    }
    return true;
  }, [onUpdateSurveyHighlightBounds, pageNumber, resizeSurveyHighlightBoundsRotated]);

  const renderSurveyHighlightEntry = useCallback((entry) => {
    if (!entry?.highlight?.highlightId) return null;
    const highlightId = entry.highlight.highlightId;
    const preview = surveyHighlightPreviewBounds?.highlightId === highlightId
      ? surveyHighlightPreviewBounds.bounds
      : null;
    const bbox = preview
      ? {
          ...entry.bbox,
          left: preview.x,
          top: preview.y,
          width: preview.width,
          height: preview.height,
          angle: normalizeDegreesValue(preview.angle),
        }
      : entry.bbox;
    const isSelectedHighlight = selectedSurveyHighlightId === highlightId;
    const isHoveredHighlight = hoveredSurveyHighlightId === highlightId;
    const centerX = bbox.left + bbox.width / 2;
    const centerY = bbox.top + bbox.height / 2;
    const rotationTransform = bbox.angle
      ? `rotate(${bbox.angle}, ${centerX}, ${centerY})`
      : undefined;

    return (
      <g key={entry.key} data-survey-highlight-id={highlightId}>
        <rect
          x={bbox.left}
          y={bbox.top}
          width={bbox.width}
          height={bbox.height}
          fill={bbox.fill}
          stroke={bbox.stroke}
          strokeWidth={bbox.strokeWidth}
          strokeDasharray={Array.isArray(bbox.strokeDashArray) ? bbox.strokeDashArray.join(',') : undefined}
          opacity={bbox.opacity}
          transform={rotationTransform}
          vectorEffect="non-scaling-stroke"
          style={{
            pointerEvents: 'none',
            mixBlendMode: bbox.globalCompositeOperation === 'multiply' ? 'multiply' : undefined,
          }}
        />
        {isHoveredHighlight && !isSelectedHighlight && (
          <rect
            x={bbox.left}
            y={bbox.top}
            width={bbox.width}
            height={bbox.height}
            fill="none"
            stroke="#4a90e2"
            strokeOpacity={0.4}
            strokeWidth={2 * inverseScale}
            transform={rotationTransform}
            style={{ pointerEvents: 'none' }}
          />
        )}
        <rect
          x={bbox.left}
          y={bbox.top}
          width={Math.max(bbox.width, 10)}
          height={Math.max(bbox.height, 10)}
          fill="rgba(0,0,0,0.001)"
          stroke="none"
          transform={rotationTransform}
          pointerEvents={isSelectTool ? 'all' : 'none'}
          style={{ cursor: isSelectTool ? 'move' : undefined }}
          onPointerDown={(e) => handleSurveyHighlightPointerDown(e, entry)}
          onPointerEnter={() => setHoveredSurveyHighlightId(highlightId)}
          onPointerLeave={() => setHoveredSurveyHighlightId((prev) => (prev === highlightId ? null : prev))}
        />
        {isSelectedHighlight && (
          <SVGSelectionOverlay
            bbox={{
              left: bbox.left,
              top: bbox.top,
              width: bbox.width,
              height: bbox.height,
              angle: bbox.angle,
            }}
            inverseScale={inverseScale}
            onHandleDrag={(e, handleId) => handleSurveyHighlightHandlePointerDown(e, entry, handleId)}
            isGroupSelection={false}
            hideBoundingBox={false}
            padding={0}
          />
        )}
      </g>
    );
  }, [
    handleSurveyHighlightHandlePointerDown,
    handleSurveyHighlightPointerDown,
    hoveredSurveyHighlightId,
    inverseScale,
    isSelectTool,
    selectedSurveyHighlightId,
    surveyHighlightPreviewBounds,
  ]);

  const selectedSurveyHighlightEntry = useMemo(() => {
    if (!selectedSurveyHighlightId || selectedAnnotationIndex !== null) return null;
    return surveyHighlightElements.find((entry) =>
      entry?.highlight?.highlightId === selectedSurveyHighlightId
    ) || null;
  }, [selectedAnnotationIndex, selectedSurveyHighlightId, surveyHighlightElements]);

  const selectedSurveyHighlightRotationBounds = useMemo(() => {
    if (!selectedSurveyHighlightEntry) return null;
    const highlightId = selectedSurveyHighlightEntry.highlight.highlightId;
    const preview = surveyHighlightPreviewBounds?.highlightId === highlightId
      ? surveyHighlightPreviewBounds.bounds
      : null;
    return normalizeSurveyHighlightBoundsValue({
      x: preview?.x ?? selectedSurveyHighlightEntry.bbox.left,
      y: preview?.y ?? selectedSurveyHighlightEntry.bbox.top,
      width: preview?.width ?? selectedSurveyHighlightEntry.bbox.width,
      height: preview?.height ?? selectedSurveyHighlightEntry.bbox.height,
      angle: preview?.angle ?? selectedSurveyHighlightEntry.bbox.angle,
    });
  }, [selectedSurveyHighlightEntry, surveyHighlightPreviewBounds]);

  const rotationInputAnnotationIndex = selectedSurveyHighlightRotationBounds
    ? `survey:${selectedSurveyHighlightId}`
    : selectedAnnotationIndex;
  const rotationInputAngle = selectedSurveyHighlightRotationBounds
    ? selectedSurveyHighlightRotationBounds.angle
    : liveRotationAngle;
  const rotationInputCenterViewBox = selectedSurveyHighlightRotationBounds
    ? {
        x: selectedSurveyHighlightRotationBounds.x + selectedSurveyHighlightRotationBounds.width / 2,
        y: selectedSurveyHighlightRotationBounds.y + selectedSurveyHighlightRotationBounds.height / 2,
      }
    : shapeCenterViewBox;

  // ---------------------------------------------------------------------------
  // Phase 14 CALL-10 — invisible hit-target overlays for callout parts
  // ---------------------------------------------------------------------------
  // UX: The visible chrome from renderCallout (Plan 14-01) has 2-3px lines
  // and a 2-3px arrowTip circle — too thin for reliable touch/drag. Plan
  // 14-03 Task 2 adds a sibling <g> with transparent 12px-radius circles
  // at knee + arrowTip, and transparent 12px-stroke lines overlaying
  // line1/line2, so useSVGInteraction's pointerdown hit-test sees a
  // generous drag target. The 12px size matches the deleted HTML overlay's
  // .callout-handle size in src/index.css (muscle-memory continuity per
  // 14-UI-SPEC.md Interaction Contract 4). The transparent stroke keeps
  // the overlay invisible but `pointer-events: all/stroke` makes it
  // clickable. Rendered AFTER the visible chrome (via the wrap <g> in
  // filteredCallouts) so hit targets sit on top.
  const renderCalloutHitTargets = useCallback((callout, pageSize, isSelected, isKneeDragging, options = {}) => {
    // UX: Phase 19 follow-up — in multi-selection, callout handles stay
    // hidden and a soft blue outline glow replaces them (matching the
    // annotation hover-glow style). `showGlow` also drives the callout's
    // cursor-hover indicator for solo callouts.
    const { showHandles = true, showGlow = false } = options;
    if (!callout || !callout.arrowTip || !callout.knee) return null;
    const { width: W, height: H } = pageSize;
    const atX = callout.arrowTip.x * W;
    const atY = callout.arrowTip.y * H;
    const kX = callout.knee.x * W;
    const kY = callout.knee.y * H;
    const tbX = (callout.textBoxPosition?.x ?? 0) * W;
    const tbY = (callout.textBoxPosition?.y ?? 0) * H;
    const tbW = Math.max(18, (callout.textBoxWidth ?? 0.1) * W);
    const tbH = Math.max(18, (callout.textBoxHeight ?? 0.05) * H);
    // UX: reuse the same connection calculation renderCallout uses so
    // line1/line2 hit overlays line up with the visible segments. Phase 15
    // UAT-3 (2026-04-17): borderWidth must be 0 here to match the renderer —
    // stored textbox dims already = outer visible rect. If we passed
    // lineThickness the hit lines would drift inward from the visible line
    // endpoints.
    const conn = calculateCalloutConnection(
      tbX, tbY, tbW, tbH,
      { x: kX, y: kY },
      { x: atX, y: atY },
      0
    );
    return (
      <g
        key={`callout-hit-${callout.id}`}
        data-callout-id={callout.id}
      >
        {/* UX: widened line1 hit target (textbox→knee). pointerEvents: stroke
            so transparent fill doesn't catch events away from the visible
            line; only the 12px stroke zone captures. */}
        {!conn.shouldHideLine1 && (
          <line
            data-callout-part="line1"
            x1={conn.line1Start.x}
            y1={conn.line1Start.y}
            x2={conn.effectiveKnee.x}
            y2={conn.effectiveKnee.y}
            stroke="transparent"
            strokeWidth={12}
            strokeLinecap="round"
            style={{ cursor: 'move', pointerEvents: 'stroke' }}
          />
        )}
        {/* UX: widened line2 hit target (knee→arrowTip) */}
        <line
          data-callout-part="line2"
          x1={conn.line2Start.x}
          y1={conn.line2Start.y}
          x2={atX}
          y2={atY}
          stroke="transparent"
          strokeWidth={12}
          strokeLinecap="round"
          style={{ cursor: 'move', pointerEvents: 'stroke' }}
        />
        {/* UX: enlarged arrowTip hit target — 12px radius > visible 2-3px
            circle so touches land reliably. fill=transparent +
            pointerEvents=all keeps the entire disc clickable. */}
        <circle
          data-callout-part="arrowTip"
          cx={atX}
          cy={atY}
          r={12}
          fill="transparent"
          style={{ cursor: 'grab', pointerEvents: 'all' }}
        />
        {/* UX: Phase 15 UAT-3 (2026-04-18) — knee hit target tracks the
            AUTO-ROUTED midpoint (effectiveKnee) when idle so users grab
            the visible bend after the renderer reroutes. BUT during an
            active knee drag the handle follows the raw stored knee so the
            handle stays under the cursor and doesn't snap to a computed
            midpoint mid-drag. */}
        <circle
          data-callout-part="knee"
          cx={isKneeDragging ? kX : conn.effectiveKnee.x}
          cy={isKneeDragging ? kY : conn.effectiveKnee.y}
          r={12}
          fill="transparent"
          style={{ cursor: 'grab', pointerEvents: 'all' }}
        />
        {/* UX: Phase 15 UAT-3 (2026-04-17) — visible drag chrome when the
            callout is selected. Knee + arrow tip use combined-tools'
            white/blue square look (distinguishes them from shape resize
            handles). Four textbox corners use the SAME white circle + gray
            stroke + drop shadow as regular shape corner handles (see
            SVGSelectionOverlay) so callout resize chrome matches the app's
            existing muscle memory. Corner circles carry
            data-callout-part='textBox-tl' / 'tr' / 'bl' / 'br' so the
            interaction hook can route them to a resize drag mode. */}
        {showGlow && (
          <>
            {/* UX: Phase 19 follow-up — callout hover / multi-select
                glow. Same blue outline treatment annotations use, but
                covering the whole callout: textbox border, line1 +
                line2 connector segments, and a glow ring around the
                arrow tip. pointer-events none so the glow never
                intercepts drag / click.
                2026-04-20: extend glow height by the same descender
                buffer the renderer uses so the bottom of the glow sits
                flush with the visible text-box border instead of
                floating a few pixels above it. */}
            {(() => {
              const calloutFs = Number(callout?.style?.fontSize || 12);
              const descenderBuffer = calloutFs * 0.35;
              const glowH = tbH + descenderBuffer;
              return (
                <rect
                  x={tbX - 2}
                  y={tbY - 2}
                  width={tbW + 4}
                  height={glowH + 4}
                  fill="none"
                  stroke="#4a90e2"
                  strokeOpacity={0.45}
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'none' }}
                />
              );
            })()}
            {!conn.shouldHideLine1 && (
              <line
                x1={conn.line1Start.x}
                y1={conn.line1Start.y}
                x2={conn.effectiveKnee.x}
                y2={conn.effectiveKnee.y}
                stroke="#4a90e2"
                strokeOpacity={0.45}
                strokeWidth={5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            )}
            <line
              x1={conn.line2Start.x}
              y1={conn.line2Start.y}
              x2={atX}
              y2={atY}
              stroke="#4a90e2"
              strokeOpacity={0.45}
              strokeWidth={5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
            {/* UX: Phase 19 follow-up — arrow-shaped glow that follows
                the actual triangle/V/circle/etc of the callout's
                arrowhead style. Reuses buildArrowheadRenderSpec so the
                glow geometry is exactly the same form-factor as the
                visible arrowhead. lineThickness comes from the
                callout's style when available, else the render default
                used by renderCallout. */}
            {(() => {
              const style = callout.style?.arrowheadStyle ?? ARROWHEAD_STYLES.SOLID_TRIANGLE;
              if (style === ARROWHEAD_STYLES.NONE) return null;
              const lineThickness = callout.style?.lineThickness ?? 2;
              const angleDeg = (
                Math.atan2(atY - conn.line2Start.y, atX - conn.line2Start.x)
                * 180 / Math.PI
              );
              const spec = buildArrowheadRenderSpec(style, atX, atY, angleDeg, '#4a90e2', lineThickness);
              const glowSw = Math.max(3, lineThickness + 2);
              switch (spec.kind) {
                case 'solidTriangle':
                case 'openTriangle':
                  return (
                    <polygon
                      points={spec.polygon.points}
                      transform={spec.polygon.transform}
                      fill="none"
                      stroke="#4a90e2"
                      strokeOpacity={0.45}
                      strokeWidth={glowSw}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                case 'openCircle':
                  return (
                    <circle
                      cx={spec.circle.cx}
                      cy={spec.circle.cy}
                      r={spec.circle.r}
                      fill="none"
                      stroke="#4a90e2"
                      strokeOpacity={0.45}
                      strokeWidth={glowSw}
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                case 'vShape':
                  return (
                    <polyline
                      points={spec.polyline.points}
                      fill="none"
                      stroke="#4a90e2"
                      strokeOpacity={0.45}
                      strokeWidth={glowSw}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                case 'horizontalLine':
                  return (
                    <line
                      x1={spec.line.x1} y1={spec.line.y1}
                      x2={spec.line.x2} y2={spec.line.y2}
                      stroke="#4a90e2"
                      strokeOpacity={0.45}
                      strokeWidth={glowSw}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                default:
                  return null;
              }
            })()}
          </>
        )}
        {isSelected && showHandles && (
          <>
            {/* UX: knee + arrow handles use the same white circle + gray
                stroke + drop shadow as the textbox corner handles so all
                callout chrome is visually consistent. Purely cosmetic
                (pointer-events none); the transparent hit circles above
                own click behavior. */}
            <circle
              cx={isKneeDragging ? kX : conn.effectiveKnee.x}
              cy={isKneeDragging ? kY : conn.effectiveKnee.y}
              r={7}
              fill="#ffffff"
              stroke="#d1d1d1"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{
                filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))',
                pointerEvents: 'none',
              }}
            />
            <circle
              cx={atX}
              cy={atY}
              r={7}
              fill="#ffffff"
              stroke="#d1d1d1"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{
                filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))',
                pointerEvents: 'none',
              }}
            />
            {/* Textbox corner handles — 4 corners only, interactive.
                2026-04-20: bottom handles shifted down by the same
                descender buffer the renderer applies, so the two
                lower dots land exactly on the visible bottom border
                instead of floating a few pixels above it. */}
            {(() => {
              const calloutFs = Number(callout?.style?.fontSize || 12);
              const descenderBuffer = calloutFs * 0.35;
              const bottomY = tbY + tbH + descenderBuffer;
              return [
                { id: 'tl', x: tbX,       y: tbY,     cursor: 'nwse-resize' },
                { id: 'tr', x: tbX + tbW, y: tbY,     cursor: 'nesw-resize' },
                { id: 'bl', x: tbX,       y: bottomY, cursor: 'nesw-resize' },
                { id: 'br', x: tbX + tbW, y: bottomY, cursor: 'nwse-resize' },
              ];
            })().map((p) => (
              <circle
                key={`cb-corner-${p.id}`}
                data-callout-part={`textBox-${p.id}`}
                cx={p.x}
                cy={p.y}
                r={7}
                fill="#ffffff"
                stroke="#d1d1d1"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={{
                  filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))',
                  cursor: p.cursor,
                  pointerEvents: 'all',
                }}
              />
            ))}
          </>
        )}
      </g>
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Filter and render callout annotations
  // ---------------------------------------------------------------------------
  // UX: CALL-10 (Phase 14 Plan 14-03) — SVGAnnotationLayer now owns callout
  // rendering. This useMemo dispatches through svgAnnotationRenderers.renderCallout
  // with the Plan 14-01 signature `(callout, index, pageSize, calculateConnection)`
  // and emits data-callout-id / data-callout-part attributes for event delegation
  // (same pattern as v2.2 EDIT-13 rotation-handle delegation). Plan 14-01 revised
  // the renderer; Plan 14-03 unwinds the `return [];` short-circuit that was
  // gating it off. See 14-RESEARCH.md Example 2 + 14-CONTEXT.md Area 1 for the
  // decision. The legacy CalloutOverlay system in src/components/Callout/* is
  // replaced by null-render stubs in Plan 14-03 Task 1 — no doubled visuals
  // because the old system renders nothing.
  //
  // Plan 14-03 Task 2: we also wrap each rendered callout with an invisible
  // hit-target overlay group (transparent circles at arrowTip/knee, widened
  // line1/line2 strokes) sized to 12px for touch targets. The existing
  // visible renderCallout chrome stays exactly as Plan 14-01 shipped it; the
  // hit overlays sit on top for pointer capture.
  const filteredCallouts = useMemo(() => {
    // 2026-05-03 — Viewport-culling fast exit (parity with filteredAnnotations).
    if (!isPageInRenderWindow) return [];
    if (!Array.isArray(callouts) || callouts.length === 0) return [];
    const pageSize = { width, height };
    const elements = [];
    let count = 0;

    for (let i = 0; i < callouts.length; i++) {
      // 2026-05-03 — Callout render cap removed for parity with the per-page
      // shape/path cap removal. Same UX rationale: never silently drop a
      // user's drawing. If perf needs help, viewport-only painting is the
      // right tool.
      const callout = callouts[i];
      if (!callout) continue;

      // UX: per-page filter — only show callouts for this page
      if (callout.pageNumber !== pageNumber) continue;

      if (!isAnnotationVisibleInContext({
        annotation: callout,
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
      })) {
        continue;
      }

      const previewPatch = visualTransform?.calloutPreviews?.[callout.id] || null;
      const displayCallout = previewPatch ? { ...callout, ...previewPatch } : callout;

      // UX: Phase 15 UAT-1 restructure (2026-04-17) — when a callout is in
      // edit mode, render its 4 static chrome parts (line1, line2, arrowTip,
      // textBox rect) but skip the text foreignObject. FabricEditCanvas
      // overlays the textbox child via the known-good text-edit path; the
      // static parts remain as visual anchors underneath. Replaces the prior
      // full-callout skip which left the edit canvas orphaned visually.
      // UX 2026-04-20 (revised): SVG callout text stays visible during its
      // own edit so it's the single source of truth in both view and edit
      // states. Fabric's letters are transparent during callout edit
      // (FabricEditCanvas loadCalloutAnnotation sets fill: rgba(0,0,0,0))
      // so there's no double-ghost — only one rendering, matching view.
      // The live bounds broadcast below keeps the SVG text width/height
      // in lockstep with Fabric's wrap as the user types.
      const hideText = false;
      // UX: Phase 15 UAT-2 — pass live textbox bounds only to the currently-
      // editing callout so line1 retracts to the live edge as the textbox
      // auto-grows. Other callouts render from stored normalized dims.
      const liveBoundsForCallout = (editingCalloutId && displayCallout.id === editingCalloutId)
        ? (liveCalloutEditBounds || null)
        : null;

      // UX: Phase 15 UAT-3 (2026-04-18) — during an active knee, textbox,
      // or textbox-resize drag on THIS callout, renderCallout skips the
      // auto-routing branch so line1/line2 meet at the raw stored knee.
      // Release-time rollback handles invalid drops. Other drags keep
      // the auto-routing path.
      const dragPart = activeCalloutDrag && activeCalloutDrag.id === displayCallout.id
        ? activeCalloutDrag.partType
        : null;
      const skipAutoRoute = dragPart === 'knee'
        || dragPart === 'textBox'
        || dragPart === 'textBoxResize';
      // UX: CALL-10 — new signature takes pageSize object, emits data attributes
      const element = renderCallout(displayCallout, i, pageSize, calculateCalloutConnection, hideText, liveBoundsForCallout, skipAutoRoute);
      if (!element) continue;

      // UX: Phase 14 Task 2 — invisible hit-target overlays for callout
      // parts. The 12px radius / 12px line strokeWidth matches the deleted
      // HTML overlay's .callout-handle size (muscle-memory continuity per
      // 14-UI-SPEC.md Interaction Contract 4). The group carries
      // data-callout-id so useSVGInteraction's pointerdown hit-test can
      // identify which callout was clicked even when the visible chrome
      // is too thin for touch.
      // UX: Phase 15 UAT-3 — visible handles paint only when this callout
      // is in the current selection set.
      const isSelected = effectiveSelectedCalloutIds.has
        ? effectiveSelectedCalloutIds.has(displayCallout.id)
        : false;
      // UX: Phase 15 UAT-3 (2026-04-18) — during knee / textbox / textbox
      // resize drags the knee handle stays pinned to its stored location
      // (no auto-routed midpoint drift) so overlapping the knee with the
      // dragged textbox doesn't make the knee "jump." All recalculation
      // defers to mouse-up.
      const isKneeDragging = !!activeCalloutDrag
        && activeCalloutDrag.id === callout.id
        && (
          activeCalloutDrag.partType === 'knee'
          || activeCalloutDrag.partType === 'textBox'
          || activeCalloutDrag.partType === 'textBoxResize'
        );
      // UX: Phase 19 follow-up — group-selection parity for callouts.
      // Compute total selection count (annotations + callouts). When
      // more than one thing is selected overall, the callout's handles
      // hide and it paints the same hover-glow style as group-member
      // annotations. Cursor hover on a non-selected callout also paints
      // the glow so there's a "you can click me" affordance for users.
      const totalSelected =
        (selectedIds?.size || 0) + (effectiveSelectedCalloutIds?.size || 0);
      const isMultiSelect = totalSelected > 1;
      const isHovered = hoveredCalloutId === displayCallout.id;
      // UX 2026-04-20: hide the callout's corner/knee/arrow-tip handles
      // while the user is in text-edit mode for that same callout. Edit is
      // text-content-only; the user doesn't need resize/knee chrome
      // competing with the growing text box. Handles re-appear after
      // commit because editingCalloutId clears.
      const isEditingThisCallout = editingCalloutId === displayCallout.id;
      const showHandles = isSelected && !isMultiSelect && !isEditingThisCallout;
      const showGlow = (isSelected && isMultiSelect) || (!isSelected && isHovered);
      const hitTargets = renderCalloutHitTargets(
        displayCallout,
        pageSize,
        isSelected,
        isKneeDragging,
        { showHandles, showGlow },
      );

      // UX: 2026-04-20 v2 — group-move callout ride-along. When this
      // callout is part of an active group-move drag, wrap it in a live
      // translate transform so it tracks the cursor in lockstep with the
      // group's annotations. Replaces the prior setCallouts-per-frame
      // approach which caused visible lag (callout trailed behind shapes
      // because state had to round-trip through App.jsx every frame).
      // The actual position write happens once at pointerup.
      const groupMoveTransform = (
        visualTransform?.id === 'group'
        && visualTransform?.affectedCalloutIds
        && visualTransform.affectedCalloutIds.has?.(displayCallout.id)
      )
        ? `translate(${visualTransform.dx || 0}, ${visualTransform.dy || 0})`
        : undefined;

      elements.push(
        // UX: wrap visible element + invisible hit targets in a shared
        // fragment via an outer <g> so the hit targets render AFTER the
        // visible chrome (on top of it, catching pointer events).
        // eslint-disable-next-line react/jsx-key
        <g
          key={`callout-wrap-${displayCallout.id || i}`}
          transform={groupMoveTransform}
          onPointerEnter={() => handleCalloutPointerEnter(displayCallout.id)}
          onPointerLeave={() => handleCalloutPointerLeave(displayCallout.id)}
        >
          {element}
          {hitTargets}
        </g>
      );
      count++;
    }

    return elements;
    // NOTE: activeTool removed from deps (it doesn't affect rendering, only
    // interaction). renderCallout and calculateCalloutConnection are
    // module-scope imports — stable. renderCalloutHitTargets is a stable
    // useCallback derived from calculateCalloutConnection (module import).
    // visualTransform added 2026-04-20 v2 — drives the group-move callout
    // ride-along translate so callouts stay in lockstep with annotations
    // during group drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callouts, pageNumber, selectedModuleId, showSurveyPanel, selectedSpaceId, activeSpaceId, activeRegions, activeRegionId, spaces, getCanvasAnnotationVisibilityState, getSurveyAnnotationVisibilityState, isRegionOverlayEnabled, layerVisibility, width, height, editingCalloutId, liveCalloutEditBounds, effectiveSelectedCalloutIds, activeCalloutDrag, visualTransform, isPageInRenderWindow]);

  // Diagnostic: after the SVG callouts are laid out, walk the DOM and record
  // the source data + every rendered element's screen rect per callout id.
  // Save Log reads window.__calloutGeomBuffer on demand.
  useEffect(() => {
    if (!Array.isArray(callouts) || callouts.length === 0) return;
    // Double-RAF so foreignObject children have laid out. Single RAF can fire
    // before the browser has run the foreignObject's block-layout pass on
    // Chromium — the second frame is safe.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        for (let i = 0; i < callouts.length; i++) {
          const c = callouts[i];
          if (!c || c.pageNumber !== pageNumber) continue;
          captureSvgCallout(c, pageNumber, {
            editingCalloutId: editingCalloutId || null,
            pageSize: { width, height },
          });
        }
      });
    });
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [callouts, pageNumber, editingCalloutId, width, height]);

  const objectCount = filteredAnnotations.length;
  const calloutCount = filteredCallouts.length;

  // 2026-05-03 — Time-sliced reveal. UX: on first paint of a heavy page
  // (12k+ pen strokes from a survey doc) the browser used to lock up for
  // ~1-2 seconds while React mounted every <path>. Now we paint in waves
  // of REVEAL_STEP per animation frame: the user sees strokes appear
  // progressively, the browser stays responsive, and total time-to-full
  // is the same. The initial seed of REVEAL_STEP means small pages
  // (under the seed) render in one shot — no staging tax. revealCount
  // never decreases, so a subsequent edit that adds a single annotation
  // catches the new entry on the next frame without re-staging the
  // already-painted set.
  const REVEAL_STEP = 300;
  const [revealCount, setRevealCount] = useState(REVEAL_STEP);
  useEffect(() => {
    if (revealCount >= filteredAnnotations.length) return;
    const handle = requestAnimationFrame(() => {
      setRevealCount((c) => Math.min(c + REVEAL_STEP, filteredAnnotations.length));
    });
    return () => cancelAnimationFrame(handle);
  }, [revealCount, filteredAnnotations.length]);
  const stagedAnnotations = useMemo(() => {
    if (revealCount >= filteredAnnotations.length) return filteredAnnotations;
    return filteredAnnotations.filter((entry, position) => (
      position < revealCount || shouldPrioritizeLiveReveal(entry?.obj)
    ));
  }, [filteredAnnotations, revealCount]);

  const importedDebugRows = useMemo(() => (
    filteredAnnotations
      .filter(({ obj }) => obj?.isPdfImported)
      .map(({ obj, index }) => summarizeImportedSvgAnnotationForDebug(obj, index))
  ), [filteredAnnotations]);
  const importedDebugSignature = useMemo(
    () => JSON.stringify(importedDebugRows),
    [importedDebugRows]
  );

  const applyLineEditPreview = useCallback((obj, lineEdit) => {
    if (!obj || !lineEdit) return obj;
    const nextData = { ...(obj.data || {}) };
    if (lineEdit.hasMidpoint && lineEdit.midpoint) {
      nextData.midpoint = lineEdit.midpoint;
    } else {
      delete nextData.midpoint;
    }
    return {
      ...obj,
      left: lineEdit.left,
      top: lineEdit.top,
      width: lineEdit.width,
      height: lineEdit.height,
      x1: lineEdit.x1,
      y1: lineEdit.y1,
      x2: lineEdit.x2,
      y2: lineEdit.y2,
      data: nextData,
    };
  }, []);

  // Log mount/unmount
  // 2026-04-30: silenced — re-fires on every objectCount/calloutCount/size
  // change, not just true mount. Re-enable via window.__DIAG_SVG_MOUNT = true.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__DIAG_SVG_MOUNT) {
      console.log(
        `[SVG p${pageNumber}] MOUNT — ${objectCount} annotations, ${calloutCount} callouts, viewBox=${width}x${height}`
      );
    }
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
      // 2026-04-30: silenced — emits a JSON blob per page on every imported
      // annotation change. Re-enable via window.__DIAG_SVG_RENDER_SUMMARY = true.
      if (typeof window !== 'undefined' && window.__DIAG_SVG_RENDER_SUMMARY) {
        console.log(
          `[SVG-Imported p${pageNumber}] renderSummary — imported=${importedDebugRows.length}, activeSpaceId=${activeSpaceId}, selectedSpaceId=${selectedSpaceId}, activeRegionId=${activeRegionId}, showSurveyPanel=${showSurveyPanel}, rows=${JSON.stringify(importedDebugRows.slice(0, 12))}`
        );
      }
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
  // 2026-04-30: silenced — fires on EVERY render of every page. Re-enable
  // per session via window.__DIAG_SVG_RENDER = true.
  if (typeof window !== 'undefined' && window.__DIAG_SVG_RENDER) {
    console.log(
      `[SVG p${pageNumber}] render — ${objectCount} objs, viewBox=${width}x${height}`
    );
  }

  // ---------------------------------------------------------------------------
  // Render: wrap each annotation with hit-area, hover, and interaction handlers
  // ---------------------------------------------------------------------------
  const wrappedAnnotations = stagedAnnotations
    .map(({ obj, index: i, element, isObjectInteractive }) => {
    // During resize, create a temporary modified copy for rendering
    // (Imported paths use SVG transform instead — handled in computedTransform below)
    let renderObj = obj;
    let renderElement = element;
    if (visualTransform?.previewObjects && visualTransform.previewObjects[i]) {
      renderObj = visualTransform.previewObjects[i];
      const previewType = String(renderObj.type || '').toLowerCase();
      if (renderObj?.data?.type === 'counter') {
        renderElement = renderCounter(renderObj, i);
      } else if (previewType === 'path' && Array.isArray(renderObj.path) && renderObj.path.length > 0) {
        renderElement = renderPath(renderObj, i);
      } else if (previewType === 'rect') {
        renderElement = renderRect(renderObj, i);
      } else if (previewType === 'line') {
        renderElement = renderLine(renderObj, i);
      } else if (previewType === 'group' && Array.isArray(renderObj.objects) && renderObj.objects.length > 0) {
        renderElement = renderArrow(renderObj, i);
      } else if (previewType === 'circle' || previewType === 'ellipse') {
        renderElement = renderEllipse(renderObj, i);
      } else if (previewType === 'polygon' && Array.isArray(renderObj.points) && renderObj.points.length > 0) {
        renderElement = renderPolygon(renderObj, i);
      } else if (previewType === 'polyline' && Array.isArray(renderObj.points) && renderObj.points.length > 0) {
        renderElement = renderPolyline(renderObj, i);
      } else if (previewType === 'textbox' || previewType === 'i-text' || previewType === 'text') {
        renderElement = renderText(renderObj, i);
      }
    }
    if (
      obj?.data?.type === 'counter'
      && counterHandlePreview?.annotationIndex === i
      && Number.isFinite(Number(counterHandlePreview.pointerAngle))
    ) {
      renderObj = {
        ...obj,
        data: {
          ...(obj.data || {}),
          pointerAngle: Number(counterHandlePreview.pointerAngle),
        },
      };
      renderElement = renderCounter(renderObj, i);
    }
    if (
      obj?.data?.type === 'counter'
      && visualTransform?.id === i
      && Number.isFinite(Number(visualTransform.counterPointerAngle))
    ) {
      renderObj = {
        ...renderObj,
        data: {
          ...(renderObj.data || {}),
          pointerAngle: Number(visualTransform.counterPointerAngle),
        },
      };
      renderElement = renderCounter(renderObj, i);
    }
    if (visualTransform?.lineEdit && visualTransform.id === i) {
      renderObj = applyLineEditPreview(obj, visualTransform.lineEdit);
      renderElement = renderLine(renderObj, i);
    }
    const absoluteCoordPath = isAbsoluteCoordPath(obj);
    if (visualTransform?.resize && visualTransform.id === i && !isImportedPath(obj) && !absoluteCoordPath) {
      renderObj = {
        ...obj,
        scaleX: visualTransform.resize.scaleX,
        scaleY: visualTransform.resize.scaleY,
        left: visualTransform.resize.left,
        top: visualTransform.resize.top,
      };
      // UX 2026-04-19: lines and arrows don't honor scaleX in the line
      // renderer (endpoints come straight from left/width/x1/x2), so the
      // live preview has to bake the scale into those fields directly —
      // just like the polygon/polyline path bakes it into points + scale.
      // Resolve the line's current absolute endpoints, scale them around
      // the drag anchor, then rewrite renderObj with the new endpoint-
      // derived bbox + offsets. Arrows follow the same path once they
      // route their line child through the same drag handler (future).
      const objectType = String(renderObj.type || '').toLowerCase();
      if (objectType === 'line') {
        const vr = visualTransform.resize;
        const cx = (obj.left ?? 0) + (obj.width ?? 0) / 2;
        const cy = (obj.top ?? 0) + (obj.height ?? 0) / 2;
        const absX1 = cx + (obj.x1 ?? 0);
        const absY1 = cy + (obj.y1 ?? 0);
        const absX2 = cx + (obj.x2 ?? 0);
        const absY2 = cy + (obj.y2 ?? 0);
        const sx = Math.max(0.01, Math.abs(vr.scaleX));
        const sy = Math.max(0.01, Math.abs(vr.scaleY));
        // Step 1: scale endpoints + stored midpoint around the LOCAL
        // anchor in pre-rotation frame. This produces a naive new
        // shape whose local anchor stayed put but whose curve-
        // inclusive bbox center (the rotation pivot) has drifted.
        const naiveX1 = vr.anchorX + (absX1 - vr.anchorX) * sx;
        const naiveY1 = vr.anchorY + (absY1 - vr.anchorY) * sy;
        const naiveX2 = vr.anchorX + (absX2 - vr.anchorX) * sx;
        const naiveY2 = vr.anchorY + (absY2 - vr.anchorY) * sy;
        const storedMid = obj?.data?.midpoint;
        const naiveMid = storedMid
          ? { x: vr.anchorX + (storedMid.x - vr.anchorX) * sx, y: vr.anchorY + (storedMid.y - vr.anchorY) * sy }
          : null;
        // Step 2: Δ-compensation so the WORLD anchor (the visible
        // handle edge the user is pulling AGAINST) stays pinned at
        // any angle. Same (R - I)·Δ shift used by endpoint/midpoint
        // drag. Without this, a rotated line grows in both directions
        // as the pivot drifts — which is the exact symptom reported
        // 2026-04-20.
        const pivotOld = computeLineBboxCenter(
          { x1: absX1, y1: absY1, x2: absX2, y2: absY2 },
          storedMid || null,
        );
        const pivotNaive = computeLineBboxCenter(
          { x1: naiveX1, y1: naiveY1, x2: naiveX2, y2: naiveY2 },
          naiveMid,
        );
        const angleRadR = ((obj.angle ?? 0) * Math.PI) / 180;
        const cosR = Math.cos(angleRadR);
        const sinR = Math.sin(angleRadR);
        const dXr = pivotNaive.x - pivotOld.x;
        const dYr = pivotNaive.y - pivotOld.y;
        const shiftXr = (cosR - 1) * dXr - sinR * dYr;
        const shiftYr = sinR * dXr + (cosR - 1) * dYr;
        const newAbsX1 = naiveX1 + shiftXr;
        const newAbsY1 = naiveY1 + shiftYr;
        const newAbsX2 = naiveX2 + shiftXr;
        const newAbsY2 = naiveY2 + shiftYr;
        const shiftedMid = naiveMid
          ? { x: naiveMid.x + shiftXr, y: naiveMid.y + shiftYr }
          : null;
        const newBoxLeft = Math.min(newAbsX1, newAbsX2);
        const newBoxTop = Math.min(newAbsY1, newAbsY2);
        const newBoxW = Math.max(1, Math.abs(newAbsX2 - newAbsX1));
        const newBoxH = Math.max(1, Math.abs(newAbsY2 - newAbsY1));
        const newCx = newBoxLeft + newBoxW / 2;
        const newCy = newBoxTop + newBoxH / 2;
        const newData = shiftedMid
          ? { ...obj.data, midpoint: shiftedMid }
          : obj.data;
        renderObj = {
          ...obj,
          left: newBoxLeft,
          top: newBoxTop,
          width: newBoxW,
          height: newBoxH,
          x1: newAbsX1 - newCx,
          y1: newAbsY1 - newCy,
          x2: newAbsX2 - newCx,
          y2: newAbsY2 - newCy,
          scaleX: 1,
          scaleY: 1,
          data: newData,
        };
      }
      // Re-render the element with modified props
      // UX 2026-04-20: counter pins must re-dispatch to renderCounter during
      // resize, not to renderEllipse — otherwise the live drag preview loses
      // the nub tip and the number and the user sees a plain circle until
      // they release. Mirror the initial dispatch's counter-first ordering.
      if (renderObj?.data?.type === 'counter') {
        renderElement = renderCounter(renderObj, i);
      } else if (objectType === 'path' && Array.isArray(renderObj.path) && renderObj.path.length > 0) {
        renderElement = renderPath(renderObj, i);
      } else if (objectType === 'rect') {
        renderElement = renderRect(renderObj, i);
      } else if (objectType === 'line') {
        renderElement = renderLine(renderObj, i);
      } else if (objectType === 'group' && Array.isArray(renderObj.objects) && renderObj.objects.length > 0) {
        renderElement = renderArrow(renderObj, i);
      } else if (objectType === 'circle' || objectType === 'ellipse') {
        renderElement = renderEllipse(renderObj, i);
      } else if (objectType === 'polygon' && Array.isArray(renderObj.points) && renderObj.points.length > 0) {
        renderElement = renderPolygon(renderObj, i);
      } else if (objectType === 'polyline' && Array.isArray(renderObj.points) && renderObj.points.length > 0) {
        renderElement = renderPolyline(renderObj, i);
      } else if (objectType === 'textbox' || objectType === 'i-text' || objectType === 'text') {
        renderElement = renderText(renderObj, i);
      }
    }

    const bbox = getAnnotationBBox(renderObj);
    const annotationIsSelected = selectedIds.has(i);
    // UX: Phase 19 follow-up — members of a multi-selection share the
    // same visual treatment as cursor-hover (blue glow) instead of each
    // getting their own dashed box. The outer group union box and its
    // handles carry the "you have a group selection" affordance, so the
    // inner per-annotation dashed boxes were redundant and noisy. Single-
    // selection (size === 1) keeps its own full overlay with handles.
    // UX: Phase 19 follow-up — treat combined selection count (annotation
    // + callout) as the "is this a multi-select?" signal. Using just
    // selectedIds.size missed the case where the user picked one
    // annotation plus one callout, which left the annotation still
    // rendering its own single-shape bounding box with handles.
    const totalSelectedForHover =
      (selectedIds?.size || 0) + (effectiveSelectedCalloutIds?.size || 0);
    const annotationIsHovered = (hoveredId === i && !annotationIsSelected)
      || (annotationIsSelected && totalSelectedForHover > 1);

    // Compute transform attribute based on interaction mode
    const computedTransform = (() => {
      if (!visualTransform) return undefined;
      // Single annotation visual transform (from Plan 02)
      if (typeof visualTransform.id === 'number' && visualTransform.id === i) {
        if (visualTransform.resize) {
          // Imported paths: use SVG transform to scale around anchor point
          if (isImportedPath(obj) || absoluteCoordPath) {
            const { scaleX, scaleY, anchorX, anchorY } = visualTransform.resize;
            return `translate(${anchorX}, ${anchorY}) scale(${scaleX}, ${scaleY}) translate(${-anchorX}, ${-anchorY})`;
          }
          // Standard objects (including lines after 2026-04-19 endpoint bake):
          // element is re-rendered at new scale, no transform needed.
          return undefined;
        }
        if (visualTransform.rotate) {
          // Use deltaAngle for the wrapper — the annotation renderer already applies
          // its committed angle internally, so we only add the change to avoid double-rotation.
          const { deltaAngle, cx, cy } = visualTransform.rotate;
          return `rotate(${deltaAngle}, ${cx}, ${cy})`;
        }
        if (visualTransform.counterPointerAngle != null) {
          return undefined;
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
    // UX 2026-04-19: bbox edit mode (counter / line / arrow / polygon /
    // polyline double-click) does NOT mount a Fabric edit canvas — the SVG
    // layer renders the uniform resize + rotate chrome itself. The shape
    // must stay visible with pointer-events active, otherwise the user sees
    // a bounding box with no shape inside and no way to dismiss.
    const isBboxEdit = isBeingEdited && editingAnnotationEditType === 'bbox';
    // Plan 15-04 Step 1: extended "SVG stays visible as the visual truth" pattern
    // from shapes to textbox + i-text + text. Sidesteps the Canvas 2D vs SVG
    // rasterizer divergence documented in CLAUDE.md 2026-04-10 and fixes the
    // edit-enter visual jump (Bug C). Fabric will be rendered transparently in
    // a follow-up step so only the caret shows; for now both layers may
    // visually overlap while we confirm the swap is structurally safe.
    const objTypeForEdit = String(obj.type || '').toLowerCase();
    const EDIT_IN_PLACE_TYPES = ['rect', 'circle', 'ellipse', 'triangle', 'textbox', 'i-text', 'text'];
    const TEXT_EDIT_TYPES = ['textbox', 'i-text', 'text'];
    const isInPlaceEdit = isBeingEdited && EDIT_IN_PLACE_TYPES.includes(objTypeForEdit);
    const hideForEdit = isBeingEdited && !isInPlaceEdit && !isBboxEdit;

    // UX 2026-04-20 (revised): SVG paints the text during edit AND view so
    // the user sees one consistent rendering across both states — no weight
    // or spacing jump on edit entry/exit. Fabric's glyphs are transparent
    // in edit mode (FabricEditCanvas existing-text path), so only the caret
    // and selection highlight come from Fabric. liveTextEditBounds feeds
    // per-keystroke width/height/text so the SVG box grows with Fabric's
    // wrap as the user types.
    if (isBeingEdited && TEXT_EDIT_TYPES.includes(objTypeForEdit)) {
      renderElement = renderText(renderObj, i, liveTextEditBounds || null, false);
    }

    return (
      <g
        key={`wrapper-${obj.id || i}`}
        data-annotation-index={i}
        data-annotation-id={obj.id || ''}
        data-pdf-annotation-id={obj?.pdfAnnotationId || obj?.data?.pdfAnnotationId || ''}
        data-pdf-annotation-type={obj?.pdfAnnotationType || obj?.data?.pdfAnnotationType || ''}
        // Phase 29 (Plan 29-04 Info 1 resolution) — e2e test seams.
        // data-anno-id mirrors the CRDT-side annoId (Plan 29-02 bridge writes
        // the same key into Y.Map), giving Playwright a stable selector that
        // survives Fabric.js internal handle churn. data-author-id surfaces
        // meta.authorId from the Y.Map sidecar (Plan 29-06 awareness consumer
        // reads this attribute too) so two-clients-undo-isolation can verify
        // per-user attribution without scraping internal state. Pure attribute
        // pass-through — ZERO behavior change. CLAUDE.md SVG rule honored
        // (viewBox owns all zoom; no JS coordination added).
        data-anno-id={obj?.data?.id || obj?.id || ''}
        data-author-id={obj?.__meta?.authorId ?? obj?.data?.authorId ?? ''}
        style={{
          cursor: annotationIsSelected ? 'move' : (annotationIsHovered ? 'pointer' : undefined),
          opacity: hideForEdit ? 0 : undefined,
          // UX 2026-04-19: bbox edit mode keeps pointer events live so the
          // user can click the SVG handles (resize + rotate) and drag the
          // shape inside the uniform box. Without this, the handles render
          // but don't react to clicks.
          pointerEvents: (isBeingEdited && !isBboxEdit) ? 'none' : undefined,
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
          const isSelectDeleteOnlyPdfTextMarkupHitTarget = isSelectDeleteOnlyPdfTextMarkupObject(renderObj);

          if (objTypeLower === 'line') {
            const ep = getLineEndpoints(renderObj);
            const isArrow = renderObj.tool === 'arrow';
            const arrowStyle = renderObj.data?.arrowheadStyle ?? (isArrow ? ARROWHEAD_STYLES.SOLID_TRIANGLE : ARROWHEAD_STYLES.NONE);
            // UX 2026-04-20: the hover-glow arrowhead must point along the
            // same direction as the SVG arrowhead. For curved lines/arrows
            // the SVG arrowhead rotates to the bezier's tangent at t=1 (via
            // getCurveEndAngle) — the straight chord angle used previously
            // made the glow triangle face a different direction than the
            // visible one once the line was bent.
            const __mp = renderObj.data?.midpoint;
            const __isCurved = !!__mp
              && distanceToLineSegment(__mp, { x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 }) > 1;
            const arrowAngleDeg = __isCurved
              ? getCurveEndAngle({ x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 }, __mp)
              : (Math.atan2(ep.y2 - ep.y1, ep.x2 - ep.x1) * 180 / Math.PI);
            // UX 2026-04-20: mirror renderLine's rotation wrapper so the
            // hover glow + hit area rotate with the line. Pivot is the
            // curve-inclusive bbox center (same as renderLine, the bbox-
            // edit overlay, and the single-click handle wrapper) so every
            // surface that reacts to the user's pointer lines up with
            // the visible rotated shape instead of sitting at a stale
            // pre-rotation position.
            const lineAngle = renderObj.angle ?? 0;
            const lineBC = computeLineBboxCenter(
              { x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 },
              renderObj.data?.midpoint || null,
            );
            const lineCx = lineBC.x;
            const lineCy = lineBC.y;
            const lineRotate = lineAngle !== 0
              ? `rotate(${lineAngle}, ${lineCx}, ${lineCy})`
              : undefined;
            // UX 2026-04-20: curved lines / arrows need the hover glow and
            // the invisible hit area to trace the bezier, not the straight
            // chord between endpoints. Detect curve via the same 1-px
            // hysteresis renderLine uses (distanceToLineSegment > 1) and
            // fall back to a straight segment when the midpoint is within
            // the threshold or absent.
            const lineMidpoint = renderObj.data?.midpoint;
            const lineIsCurved = !!lineMidpoint
              && distanceToLineSegment(lineMidpoint, { x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 }) > 1;
            const lineCurveD = lineIsCurved
              ? getCurvedPath({ x: ep.x1, y: ep.y1 }, { x: ep.x2, y: ep.y2 }, lineMidpoint)
              : null;
            return (
              <g transform={lineRotate}>
                {/* Hover highlight along the line */}
                {annotationIsHovered && (
                  lineIsCurved ? (
                    <path
                      d={lineCurveD}
                      stroke="#4a90e2"
                      strokeOpacity={0.4}
                      strokeWidth={Math.max(6, (renderObj.strokeWidth || 2) + 4)}
                      strokeLinecap="round"
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                  ) : (
                    <line
                      x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2}
                      stroke="#4a90e2"
                      strokeOpacity={0.4}
                      strokeWidth={Math.max(6, (renderObj.strokeWidth || 2) + 4)}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                  )
                )}
                {/* UX: Phase 19 follow-up — arrow tool gets a glow that
                    follows the arrowhead's actual shape (triangle / V /
                    open circle / etc) so the affordance matches the
                    visible form-factor, not just a thick bar behind it. */}
                {annotationIsHovered && isArrow && arrowStyle !== ARROWHEAD_STYLES.NONE && (() => {
                  const spec = buildArrowheadRenderSpec(
                    arrowStyle, ep.x2, ep.y2, arrowAngleDeg, '#4a90e2',
                    renderObj.strokeWidth || 2,
                  );
                  const glowSw = Math.max(3, (renderObj.strokeWidth || 2) + 2);
                  switch (spec.kind) {
                    case 'solidTriangle':
                    case 'openTriangle':
                      return (
                        <polygon
                          points={spec.polygon.points}
                          transform={spec.polygon.transform}
                          fill="none"
                          stroke="#4a90e2"
                          strokeOpacity={0.45}
                          strokeWidth={glowSw}
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: 'none' }}
                        />
                      );
                    case 'openCircle':
                      return (
                        <circle
                          cx={spec.circle.cx} cy={spec.circle.cy} r={spec.circle.r}
                          fill="none" stroke="#4a90e2" strokeOpacity={0.45}
                          strokeWidth={glowSw}
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: 'none' }}
                        />
                      );
                    case 'vShape':
                      return (
                        <polyline
                          points={spec.polyline.points}
                          fill="none" stroke="#4a90e2" strokeOpacity={0.45}
                          strokeWidth={glowSw}
                          strokeLinecap="round" strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: 'none' }}
                        />
                      );
                    case 'horizontalLine':
                      return (
                        <line
                          x1={spec.line.x1} y1={spec.line.y1}
                          x2={spec.line.x2} y2={spec.line.y2}
                          stroke="#4a90e2" strokeOpacity={0.45}
                          strokeWidth={glowSw}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                          style={{ pointerEvents: 'none' }}
                        />
                      );
                    default:
                      return null;
                  }
                })()}
                {/* Invisible thick hit area — path when curved so clicks
                    along the bend register, line otherwise. */}
                {lineIsCurved ? (
                  <path
                    d={lineCurveD}
                    stroke="transparent"
                    fill="none"
                    strokeWidth={Math.max(12, (renderObj.strokeWidth || 2) + 10)}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents={isSelectTool && isObjectInteractive ? 'stroke' : 'none'}
                    onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                    onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                    onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                    onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                  />
                ) : (
                  <line
                    x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2}
                    stroke="transparent"
                    strokeWidth={Math.max(12, (renderObj.strokeWidth || 2) + 10)}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    // UX: Plan 14-02 UX-01 — gate on isSelectTool (not
                    // isInteractive) so click-to-select / hover / double-click
                    // only fire in Select mode. Line/arrow/callout creation
                    // tools flow their pointer events to handleSvgPointerDown
                    // on the SVG root instead of re-selecting this existing
                    // annotation mid-drag.
                    pointerEvents={isSelectTool && isObjectInteractive ? 'stroke' : 'none'}
                    onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                    onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                    onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                    onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                  />
                )}
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
                    // UX: strokeWidth in viewBox units (no vectorEffect) so it
                    // auto-scales via the SVG transform — matches generic rect
                    // hover outline below (~line 997). Using non-scaling-stroke
                    // + `2 * inverseScale` double-scaled the glow at low zoom.
                    strokeWidth={2 * inverseScale}
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
                  // UX: Plan 14-02 UX-01 — counter hit-area click-to-select
                  // is gated on isSelectTool so line/arrow/callout creation
                  // tools do NOT re-enter this counter's selection state
                  // mid-drag. Creation-tool clicks pass through to
                  // handleSvgPointerDown on the SVG root.
                  pointerEvents={isSelectTool && isObjectInteractive ? 'all' : 'none'}
                  onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                  onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                  onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                  onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                />
              </g>
            );
          }

          // UX: shape-tracing hover halos for polygon / polyline / rect /
          // circle / ellipse. Each branch duplicates the shape's own geometry
          // as a fat transparent-blue stroke so the halo hugs the outline
          // instead of a bbox rectangle around it. Hit-area stays a bbox rect
          // (unchanged from the old generic branch) so click-to-select
          // behavior is identical. Width formula Math.max(6, sw + 4) matches
          // the line-hover pattern at :1360-1369.
          if ((objTypeLower === 'polygon' || objTypeLower === 'polyline')
              && Array.isArray(renderObj.points) && renderObj.points.length > 0) {
            const isPolygonShape = objTypeLower === 'polygon';
            const pointsStr = renderObj.points
              .map((p) => `${p?.x ?? 0},${p?.y ?? 0}`)
              .join(' ');
            const shapeLeft = renderObj.left ?? 0;
            const shapeTop = renderObj.top ?? 0;
            const shapeAngle = renderObj.angle ?? 0;
            const shapeSx = renderObj.scaleX ?? 1;
            const shapeSy = renderObj.scaleY ?? 1;
            const shapePathOffsetX = renderObj.pathOffset?.x || 0;
            const shapePathOffsetY = renderObj.pathOffset?.y || 0;
            // UX 2026-04-20: match renderPolygon / renderPolyline rotation
            // center. The previous `rotate(${angle})` with no center spun the
            // hover glow around the parent group's origin, not the shape
            // centroid — so the glow flew off to the wrong position the
            // moment the user rotated a polygon/polyline. Compute the same
            // rotCenter (scaled, pathOffset-adjusted centroid of the point
            // array) the shape renderer uses so the glow traces the rotated
            // shape exactly.
            const shapePointXs = renderObj.points.map((p) => (typeof p?.x === 'number' ? p.x : 0));
            const shapePointYs = renderObj.points.map((p) => (typeof p?.y === 'number' ? p.y : 0));
            const shapeRawCenterX = (Math.min(...shapePointXs) + Math.max(...shapePointXs)) / 2;
            const shapeRawCenterY = (Math.min(...shapePointYs) + Math.max(...shapePointYs)) / 2;
            const shapeRotCenterX = shapeSx * (shapeRawCenterX - shapePathOffsetX);
            const shapeRotCenterY = shapeSy * (shapeRawCenterY - shapePathOffsetY);
            let shapeTransform = `translate(${shapeLeft}, ${shapeTop})`;
            if (shapeAngle !== 0) {
              shapeTransform += ` rotate(${shapeAngle}, ${shapeRotCenterX}, ${shapeRotCenterY})`;
            }
            if (shapeSx !== 1 || shapeSy !== 1) shapeTransform += ` scale(${shapeSx}, ${shapeSy})`;
            shapeTransform += ` translate(${-shapePathOffsetX}, ${-shapePathOffsetY})`;
            const sw = renderObj.strokeWidth || 1;
            const hitRotate = bbox.angle
              ? `rotate(${bbox.angle}, ${bbox.left + bbox.width / 2}, ${bbox.top + bbox.height / 2})`
              : undefined;
            return (
              <g>
                {annotationIsHovered && (
                  isPolygonShape ? (
                    <polygon
                      points={pointsStr}
                      transform={shapeTransform}
                      fill="none"
                      stroke="#4a90e2"
                      strokeOpacity={0.4}
                      strokeWidth={Math.max(6, sw + 4)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect={renderObj.strokeUniform ? 'non-scaling-stroke' : undefined}
                      style={{ pointerEvents: 'none' }}
                    />
                  ) : (
                    <polyline
                      points={pointsStr}
                      transform={shapeTransform}
                      fill="none"
                      stroke="#4a90e2"
                      strokeOpacity={0.4}
                      strokeWidth={Math.max(6, sw + 4)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect={renderObj.strokeUniform ? 'non-scaling-stroke' : undefined}
                      style={{ pointerEvents: 'none' }}
                    />
                  )
                )}
                <rect
                  x={bbox.left}
                  y={bbox.top}
                  width={isSelectDeleteOnlyPdfTextMarkupHitTarget ? Math.max(bbox.width, 1) : Math.max(bbox.width, 10)}
                  height={isSelectDeleteOnlyPdfTextMarkupHitTarget ? Math.max(bbox.height, 1) : Math.max(bbox.height, 10)}
                  transform={hitRotate}
                  fill="transparent"
                  stroke="none"
                  pointerEvents={isSelectTool && isObjectInteractive ? 'all' : 'none'}
                  onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                  onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                  onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                  onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                />
              </g>
            );
          }

          if (objTypeLower === 'rect') {
            // Rect hover: fat stroked rectangle tracing the shape's own edges.
            // Dims come straight from the renderRect formula (renderObj.width
            // * scaleX, etc.) so the halo aligns to the drawn rect, not the
            // bbox AABB (they coincide for non-rotated rects; for rotated
            // rects the rect renders with its own rotate transform).
            const rectW = Math.abs((renderObj.width || 0) * (renderObj.scaleX || 1));
            const rectH = Math.abs((renderObj.height || 0) * (renderObj.scaleY || 1));
            const rectL = renderObj.left || 0;
            const rectT = renderObj.top || 0;
            const rectCX = rectL + rectW / 2;
            const rectCY = rectT + rectH / 2;
            const sw = renderObj.strokeWidth || 1;
            const rectRotate = renderObj.angle
              ? `rotate(${renderObj.angle}, ${rectCX}, ${rectCY})`
              : undefined;
            const hitRotate = bbox.angle
              ? `rotate(${bbox.angle}, ${bbox.left + bbox.width / 2}, ${bbox.top + bbox.height / 2})`
              : undefined;
            return (
              <g>
                {annotationIsHovered && (
                  <rect
                    x={rectL}
                    y={rectT}
                    width={rectW}
                    height={rectH}
                    transform={rectRotate}
                    fill="none"
                    stroke="#4a90e2"
                    strokeOpacity={0.4}
                    strokeWidth={Math.max(6, sw + 4)}
                    strokeLinejoin="round"
                    vectorEffect={renderObj.strokeUniform ? 'non-scaling-stroke' : undefined}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                <rect
                  x={bbox.left}
                  y={bbox.top}
                  width={isSelectDeleteOnlyPdfTextMarkupHitTarget ? Math.max(bbox.width, 1) : Math.max(bbox.width, 10)}
                  height={isSelectDeleteOnlyPdfTextMarkupHitTarget ? Math.max(bbox.height, 1) : Math.max(bbox.height, 10)}
                  transform={hitRotate}
                  fill="transparent"
                  stroke="none"
                  pointerEvents={isSelectTool && isObjectInteractive ? 'all' : 'none'}
                  onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                  onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                  onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                  onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                />
              </g>
            );
          }

          if (objTypeLower === 'circle' || objTypeLower === 'ellipse') {
            // Ellipse/circle hover: fat stroked ellipse at the same cx/cy/rx/ry
            // as renderEllipse. Circle uses radius*scale; ellipse uses rx/ry*scale.
            let rx;
            let ry;
            if (objTypeLower === 'circle' || renderObj.radius != null) {
              rx = (renderObj.radius || 0) * Math.abs(renderObj.scaleX || 1);
              ry = (renderObj.radius || 0) * Math.abs(renderObj.scaleY || 1);
            } else {
              rx = (renderObj.rx || 0) * Math.abs(renderObj.scaleX || 1);
              ry = (renderObj.ry || 0) * Math.abs(renderObj.scaleY || 1);
            }
            const cx = (renderObj.left || 0) + rx;
            const cy = (renderObj.top || 0) + ry;
            const sw = renderObj.strokeWidth || 1;
            const ellipseRotate = renderObj.angle
              ? `rotate(${renderObj.angle}, ${cx}, ${cy})`
              : undefined;
            const hitRotate = bbox.angle
              ? `rotate(${bbox.angle}, ${bbox.left + bbox.width / 2}, ${bbox.top + bbox.height / 2})`
              : undefined;
            return (
              <g>
                {annotationIsHovered && (
                  <ellipse
                    cx={cx}
                    cy={cy}
                    rx={rx}
                    ry={ry}
                    transform={ellipseRotate}
                    fill="none"
                    stroke="#4a90e2"
                    strokeOpacity={0.4}
                    strokeWidth={Math.max(6, sw + 4)}
                    vectorEffect={renderObj.strokeUniform ? 'non-scaling-stroke' : undefined}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                <rect
                  x={bbox.left}
                  y={bbox.top}
                  width={Math.max(bbox.width, 10)}
                  height={Math.max(bbox.height, 10)}
                  transform={hitRotate}
                  fill="transparent"
                  stroke="none"
                  pointerEvents={isSelectTool && isObjectInteractive ? 'all' : 'none'}
                  onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                  onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                  onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                  onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                />
              </g>
            );
          }

          if (objTypeLower === 'path' && Array.isArray(renderObj.path) && renderObj.path.length > 0) {
            // UX: pen-stroke hover halo and hit target both trace the actual
            // path geometry, not the surrounding bbox. Small marks like an
            // "i" dot and its stem must remain independently selectable.
            const pathAttrs = renderPathToSvgAttrs(renderObj);
            const pathD = renderPathToSvgD(renderObj, pathAttrs);
            const isFilledPdfInkOutline =
              pathAttrs.smoothClosedOutline === true &&
              pathAttrs.stroke === 'none' &&
              pathAttrs.fill &&
              pathAttrs.fill !== 'none';
            const pathLeft = renderObj.left ?? 0;
            const pathTop = renderObj.top ?? 0;
            const pathAngle = renderObj.angle ?? 0;
            const pathScaleX = renderObj.scaleX ?? 1;
            const pathScaleY = renderObj.scaleY ?? 1;
            const pathOffsetX = renderObj.pathOffset?.x || 0;
            const pathOffsetY = renderObj.pathOffset?.y || 0;
            // UX 2026-04-21: match renderPath exactly — rotate around the
            // path's OWN bbox center (not the local origin), or the hover
            // halo lands off the visible stroke once a rotation is applied.
            // Without this pivot, the halo rotates around the translate
            // anchor while the real stroke rotates around its bbox center,
            // producing the "blue glow detached from the stroke" symptom.
            let pathRawMinX = Infinity, pathRawMinY = Infinity;
            let pathRawMaxX = -Infinity, pathRawMaxY = -Infinity;
            for (const seg of renderObj.path) {
              for (let j = 1; j + 1 < seg.length; j += 2) {
                const x = seg[j];
                const y = seg[j + 1];
                if (typeof x === 'number' && typeof y === 'number') {
                  if (x < pathRawMinX) pathRawMinX = x;
                  if (x > pathRawMaxX) pathRawMaxX = x;
                  if (y < pathRawMinY) pathRawMinY = y;
                  if (y > pathRawMaxY) pathRawMaxY = y;
                }
              }
            }
            const pathHasBounds = Number.isFinite(pathRawMinX) && Number.isFinite(pathRawMinY);
            const pathRotCenterX = pathHasBounds
              ? pathScaleX * ((pathRawMinX + pathRawMaxX) / 2 - pathOffsetX)
              : 0;
            const pathRotCenterY = pathHasBounds
              ? pathScaleY * ((pathRawMinY + pathRawMaxY) / 2 - pathOffsetY)
              : 0;
            let pathTransform = `translate(${pathLeft}, ${pathTop})`;
            if (pathAngle !== 0) pathTransform += ` rotate(${pathAngle}, ${pathRotCenterX}, ${pathRotCenterY})`;
            if (pathScaleX !== 1 || pathScaleY !== 1) pathTransform += ` scale(${pathScaleX}, ${pathScaleY})`;
            pathTransform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;
            const sw = renderObj.strokeWidth || 1;
            const hoverStrokeWidth = isFilledPdfInkOutline
              ? Math.max(1.25 * inverseScale, Math.min(2 * inverseScale, sw + 0.5))
              : Math.max(6, sw + 4);
            const hitStrokeWidth = isFilledPdfInkOutline
              ? Math.max(0.75 * inverseScale, 0.75)
              : isSelectDeleteOnlyPdfTextMarkupHitTarget
                ? Math.max(4, pathAttrs.strokeWidth || sw || 1)
              : Math.max(12, pathAttrs.strokeWidth || sw || 1, 3 * inverseScale);
            const pathPointerEvents = isSelectTool && isObjectInteractive
              ? (isSelectDeleteOnlyPdfTextMarkupHitTarget ? 'stroke' : 'all')
              : 'none';
            const pathRawWidth = pathHasBounds ? Math.max(0, pathRawMaxX - pathRawMinX) : 0;
            const pathRawHeight = pathHasBounds ? Math.max(0, pathRawMaxY - pathRawMinY) : 0;
            const useThinPathHitBox = !isSelectDeleteOnlyPdfTextMarkupHitTarget && pathHasBounds && Math.min(pathRawWidth, pathRawHeight) <= 10;
            return (
              <g>
                {annotationIsHovered && (
                  <path
                    d={pathD}
                    transform={pathTransform}
                    stroke="#4a90e2"
                    strokeOpacity={0.4}
                    strokeWidth={hoverStrokeWidth}
                    fill={isFilledPdfInkOutline ? '#4a90e2' : 'none'}
                    fillOpacity={isFilledPdfInkOutline ? 0.12 : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect={renderObj.strokeUniform ? 'non-scaling-stroke' : undefined}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                <path
                  d={pathD}
                  transform={pathTransform}
                  fill={isFilledPdfInkOutline ? 'rgba(0,0,0,0.001)' : 'none'}
                  stroke={isFilledPdfInkOutline ? 'none' : 'rgba(0,0,0,0.001)'}
                  strokeWidth={hitStrokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect={pathAttrs.vectorEffect}
                  pointerEvents={pathPointerEvents}
                  data-path-hit-target="true"
                  onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onMouseDown={(e) => handleAnnotationPointerDown(e, i)}
                  onMouseMove={handlePointerMove}
                  onMouseUp={handlePointerUp}
                  onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                  onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                  onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                />
                {useThinPathHitBox && (
                  <rect
                    x={pathRawMinX - 4}
                    y={pathRawMinY - 6}
                    width={Math.max(1, pathRawWidth) + 8}
                    height={Math.max(1, pathRawHeight) + 12}
                    transform={pathTransform}
                    fill="rgba(0,0,0,0.001)"
                    stroke="none"
                    pointerEvents={pathPointerEvents}
                    data-path-bbox-hit-target="true"
                    onPointerDown={(e) => handleAnnotationPointerDown(e, i)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onMouseDown={(e) => handleAnnotationPointerDown(e, i)}
                    onMouseMove={handlePointerMove}
                    onMouseUp={handlePointerUp}
                    onPointerEnter={(e) => handleAnnotationPointerEnter(e, i)}
                    onPointerLeave={(e) => handleAnnotationPointerLeave(e, i)}
                    onDoubleClick={(e) => handleAnnotationDoubleClick(e, i)}
                  />
                )}
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
                width={isSelectDeleteOnlyPdfTextMarkupHitTarget ? Math.max(bbox.width, 1) : Math.max(bbox.width, 10)}
                height={isSelectDeleteOnlyPdfTextMarkupHitTarget ? Math.max(bbox.height, 1) : Math.max(bbox.height, 10)}
                fill="transparent"
                stroke="none"
                // UX: Plan 14-02 UX-01 — generic annotation hit-area gated on
                // isSelectTool so creation tools (line/arrow/callout) don't
                // re-select existing annotations mid-drag. See the isSelectTool
                // vs isInteractive comment at the derivation site (~line 142).
                pointerEvents={isSelectTool && isObjectInteractive ? 'all' : 'none'}
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
      // UX: Plan 14-02 UX-01 — apply `tool-crosshair` class when the user is
      // in a creation tool (line / arrow / callout) AND no drag is in
      // progress. The class is defined in src/index.css and sets
      // `cursor: crosshair`. Dragging state wins via the inline
      // `cursor: 'grabbing'` rule below because inline style beats class
      // specificity. See 14-UI-SPEC.md Interaction Contract 1.
      className={(isCreationTool && interactionState !== 'dragging') ? 'tool-crosshair' : undefined}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: isCreationTool ? 'auto' : 'none',
        overflow: 'hidden',
        cursor: interactionState === 'dragging' ? 'grabbing'
              : interactionState === 'rotating' ? 'crosshair'
              : undefined,
      }}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (isInteractive) {
          e.stopPropagation(); // Prevent Syncfusion from seeing SVG events (SVGAnimatedString crash)
          // UX: Phase 14 CREATE-01 (callout half) — when the callout tool
          // is active and the click lands on empty SVG space (NOT inside
          // an existing callout), start a transient creation drag. If the
          // click is inside an existing callout, fall through to
          // handleSvgPointerDown which dispatches the callout-part drag
          // via useSVGInteraction (Plan 14-03 Task 2).
          if (activeTool === 'callout' && !e.target?.closest?.('[data-callout-id]')) {
            // UX: Phase 15 UAT-3 — clicking empty space with the callout
            // tool active also dismisses any currently-selected callout so
            // starting a new callout doesn't leave stale handles on the
            // previous one. Matches Select-mode behavior where clicking
            // empty space deselects.
            if (onSelectedCalloutIdsChange) onSelectedCalloutIdsChange(new Set());
            const pt = screenToSVG(svgRef.current, e.clientX, e.clientY);
            setCalloutCreation({ arrowTip: pt, currentPointer: pt });
            e.preventDefault();
            return;
          }
          const annotationWrapper = e.target?.closest?.('[data-annotation-index]');
          if (annotationWrapper && svgRef.current?.contains?.(annotationWrapper)) {
            const annotationIndex = Number(annotationWrapper.getAttribute('data-annotation-index'));
            if (Number.isInteger(annotationIndex)) {
              setSelectedSurveyHighlightId(null);
              setSurveyHighlightPreviewBounds(null);
              surveyHighlightDragRef.current = null;
              handleAnnotationPointerDown(e, annotationIndex);
              return;
            }
          }
          setSelectedSurveyHighlightId(null);
          setSurveyHighlightPreviewBounds(null);
          surveyHighlightDragRef.current = null;
          handleSvgPointerDown(e);
        }
      }}
      onPointerMove={isInteractive ? (e) => {
        if (surveyHighlightDragRef.current && updateSurveyHighlightDrag(e, false)) return;
        handlePointerMove(e);
      } : undefined}
      onPointerUp={isInteractive ? (e) => {
        if (surveyHighlightDragRef.current && updateSurveyHighlightDrag(e, true)) return;
        handlePointerUp(e);
      } : undefined}
      onPointerCancel={isInteractive ? () => {
        if (surveyHighlightDragRef.current) {
          surveyHighlightDragRef.current = null;
          setSurveyHighlightPreviewBounds(null);
        }
      } : undefined}
      // UX: Phase 15 UAT #1 — double-click anywhere inside a callout (text
      // foreignObject, connector segments, arrowTip, knee) must enter edit
      // mode so the user can type/edit text. The existing
      // handleAnnotationDoubleClick already hit-tests data-callout-id and
      // calls onRequestEditMode(id, 'callout'), but without this root-level
      // binding the handler never fires when the click target is inside
      // the callout's foreignObject (no onDoubleClick on that element).
      // The handler safely no-ops for non-callout double-clicks on the SVG
      // background because its secondary branch requires annotations.objects[index]
      // and `index` is undefined here. Gated on isSelectTool so double-
      // clicking empty space during creation tools doesn't misfire.
      onDoubleClick={isSelectTool ? handleAnnotationDoubleClick : undefined}
    >
      {wrappedAnnotations}
      {/* Survey highlights are stored outside annotations.objects, so this
          path owns their click, move, and resize behavior. */}
      {surveyHighlightElements.length > 0 && (
        <g className="survey-highlights" style={{ pointerEvents: isSelectTool ? 'auto' : 'none' }}>
          {surveyHighlightElements.map(renderSurveyHighlightEntry)}
        </g>
      )}
      {filteredCallouts}
      {/* UX: Plan 15-04 Issue 2 — new-text creation preview. FabricEditCanvas
          paints the in-flight textbox transparent during create (same pattern
          as existing-text edit) and broadcasts live bounds with
          `isCreating: true`. Here we synthesize a textbox render-obj from the
          bounds alone (there's no backing annotation yet) and route it
          through renderText so the SVG is the visible truth from the first
          frame — no Fabric→SVG swap on commit. */}
      {liveTextEditBounds?.isCreating && liveTextEditBounds.width > 0 && (
        <g style={{ pointerEvents: 'none' }}>
          {renderText({
            type: 'textbox',
            left: liveTextEditBounds.left,
            top: liveTextEditBounds.top,
            width: liveTextEditBounds.width,
            height: liveTextEditBounds.height,
            scaleX: 1,
            scaleY: 1,
            angle: 0,
            fontSize: liveTextEditBounds.fontSize || 16,
            fontFamily: liveTextEditBounds.fontFamily || 'Helvetica',
            fill: liveTextEditBounds.fill || '#007AFF',
            stroke: liveTextEditBounds.stroke || '#000000',
            strokeWidth: liveTextEditBounds.strokeWidth ?? 1,
            text: liveTextEditBounds.text || '',
            opacity: 1,
          }, 'text-creation-preview', liveTextEditBounds)}
        </g>
      )}
      {/* UX: Phase 14 CREATE-01 (callout half) — transient click-drag
          preview. Dashed at 0.6 opacity so the committed callout is
          visually distinct (solid, full opacity). Cleared on pointerup
          (via the window listener), tool switch, or empty drag. See
          14-UI-SPEC.md Interaction Contract 3 callout preview composition
          and 14-CONTEXT.md Area 4 CREATE-01 callout preview. */}
      {calloutCreation && (
        <g className="callout-preview" opacity={0.6} style={{ pointerEvents: 'none' }}>
          {(() => {
            const previewW = 120;
            const previewH = 32;
            const tbX = calloutCreation.currentPointer.x;
            const tbY = calloutCreation.currentPointer.y;
            const arrowTip = calloutCreation.arrowTip;
            const knee = {
              x: (arrowTip.x + tbX) / 2,
              y: arrowTip.y - 40,
            };
            // Keep the ghost geometry in lockstep with the committed callout
            // renderer: connector starts on the textbox edge, not its center.
            const conn = calculateCalloutConnection(tbX, tbY, previewW, previewH, knee, arrowTip, 0);
            return (
              <>
                <rect
                  x={tbX}
                  y={tbY}
                  width={previewW}
                  height={previewH}
                  fill="transparent"
                  stroke="#1e293b"
                  strokeWidth={Math.max(1, 2 * 0.7)}
                  strokeDasharray="5,5"
                  rx={0}
                  ry={0}
                  vectorEffect="non-scaling-stroke"
                />
                {!conn.shouldHideLine1 && (
                  <line
                    x1={conn.line1Start.x}
                    y1={conn.line1Start.y}
                    x2={conn.effectiveKnee.x}
                    y2={conn.effectiveKnee.y}
                    stroke="#1e293b"
                    strokeWidth={2}
                    strokeDasharray="5,5"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <line
                  x1={conn.line2Start.x}
                  y1={conn.line2Start.y}
                  x2={arrowTip.x}
                  y2={arrowTip.y}
                  stroke="#1e293b"
                  strokeWidth={2}
                  strokeDasharray="5,5"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={arrowTip.x}
                  cy={arrowTip.y}
                  r={Math.max(2, 2 + 0.4)}
                  fill="#1e293b"
                />
              </>
            );
          })()}
        </g>
      )}
      {/* UX: Phase 19 — AutoCAD marquee rectangle. Blue solid fill when
          dragging left-to-right (Window mode, selects only fully enclosed
          annotations). Green dashed when dragging right-to-left (Crossing
          mode, selects any annotation the box touches). Rendered above
          annotation content but below the selection/hover overlays below,
          with pointer-events: none so it never intercepts events headed
          for annotations underneath. Constants copied verbatim from the
          dormant Fabric reference (see 19-CONTEXT.md → Visual treatment). */}
      {marqueeRect && (
        <rect
          x={marqueeRect.left}
          y={marqueeRect.top}
          width={marqueeRect.width}
          height={marqueeRect.height}
          fill={marqueeDirection === 'window'
            ? 'rgba(0, 100, 255, 0.15)'
            : 'rgba(0, 200, 100, 0.15)'}
          stroke={marqueeDirection === 'window'
            ? 'rgba(0, 100, 255, 0.8)'
            : 'rgba(0, 200, 100, 0.8)'}
          strokeWidth={1}
          strokeDasharray={marqueeDirection === 'window' ? undefined : '5,5'}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {/* Selection overlays — rendered on top of all annotations */}
      {/* Single selection: individual bounding box with handles.
          UX: Phase 19 follow-up — suppress this when a callout is also
          selected. With one annotation + one callout the combined count
          is > 1, which means the outer group union bbox should be the
          only chrome — same as two annotations. */}
      {selectedIds.size === 1 && (effectiveSelectedCalloutIds?.size || 0) === 0 && Array.from(selectedIds).map((selectedIndex) => {
        const obj = visualTransform?.previewObjects?.[selectedIndex]
          || annotations?.objects?.[selectedIndex];
        if (!obj) return null;
        const isSelectDeleteOnlyPdfTextMarkup = isSelectDeleteOnlyPdfTextMarkupObject(obj);

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
        const editIsCounter = obj.data?.type === 'counter';
        const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
        // UX 2026-04-19: when THIS counter is in bbox edit mode (user
        // double-clicked it), fall through to the default SVGSelectionOverlay
        // so the uniform resize + rotate chrome renders. In any other edit
        // state, hide the SVG chrome — the edit canvas owns the surface.
        // The broad `editingAnnotationIndex != null` guard catches state-
        // desync edge cases where editingAnnotationIndex is set but
        // selectedIndex briefly doesn't match (e.g. mid-double-click frame).
        const counterInBboxMode = editIsCounter && isBeingEditedNow && editingAnnotationEditType === 'bbox';
        if (editIsCounter && editingAnnotationIndex != null && !counterInBboxMode) return null;
        if (isBeingEditedNow && editIsBorderFlush && !isSelectDeleteOnlyPdfTextMarkup) return null;

        // Counter selection (not in bbox edit mode): render only the rotation handle at the
        // nubbin tip. No dashed bbox, no resize handles — Shottr-style minimal chrome.
        // Drag updates `data.pointerAngle` live with checkpointPolicy:'skip', then commits
        // a single normal checkpoint on pointerup so the rotation is one undo entry.
        if (editIsCounter && !counterInBboxMode) {
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
          const pointerAngleDeg = counterHandlePreview?.annotationIndex === selectedIndex
            ? Number(counterHandlePreview.pointerAngle)
            : (obj.data?.pointerAngle ?? 225);
          const angleRad = (pointerAngleDeg * Math.PI) / 180;
          // Match renderCounter's tipExtension formula exactly so the handle sits ON
          // the visible nubbin tip, not floating beside it.
          const tipExtension = Math.max(5, radius * 0.5);
          const tipX = cx + Math.cos(angleRad) * (radius + tipExtension);
          const tipY = cy + Math.sin(angleRad) * (radius + tipExtension);
          // UX: dampened handle sizing. Raw `7 * inverseScale` renders a
          // constant 7 screen px, which is too big *relative to the pin* at
          // low zoom (pin shrinks in page-space, handle stays constant, so
          // the handle dwarfs the pin at 25%). sqrt curve softens the growth
          // so the handle feels proportional across zoom levels — mirrors
          // SVGSelectionOverlay.jsx:35 for rect/circle handle sizing.
          const is = Math.sqrt(inverseScale);
          const handleR = 7 * is;
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
                  // UX: same sqrt damping as handleR above — CSS filter px
                  // work in screen space, so raw inverseScale produces 4× the
                  // shadow at 25% zoom. Matches SVGSelectionOverlay.jsx:48.
                  filter: `drop-shadow(0 ${1 * is}px ${3 * is}px rgba(0,0,0,0.25))`,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                  counterRotateDragRef.current = {
                    annotationIndex: selectedIndex,
                    centerX: cx,
                    centerY: cy,
                  };
                  const preview = {
                    annotationIndex: selectedIndex,
                    pointerAngle: pointerAngleDeg,
                  };
                  counterHandlePreviewRef.current = preview;
                  setCounterHandlePreview(preview);
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
                  const preview = {
                    annotationIndex: selectedIndex,
                    pointerAngle: newAngleDeg,
                  };
                  counterHandlePreviewRef.current = preview;
                  setCounterHandlePreview(preview);
                }}
                onPointerUp={(e) => {
                  const drag = counterRotateDragRef.current;
                  counterRotateDragRef.current = null;
                  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
                  if (!drag || drag.annotationIndex !== selectedIndex) return;
                }}
                onPointerCancel={() => {
                  counterRotateDragRef.current = null;
                }}
              />
            </g>
          );
        }

        let selectionObj = (visualTransform?.lineEdit && visualTransform.id === selectedIndex)
          ? applyLineEditPreview(obj, visualTransform.lineEdit)
          : obj;
        if (
          selectionObj?.data?.type === 'counter'
          && visualTransform?.id === selectedIndex
          && Number.isFinite(Number(visualTransform.counterPointerAngle))
        ) {
          selectionObj = {
            ...selectionObj,
            data: {
              ...(selectionObj.data || {}),
              pointerAngle: Number(visualTransform.counterPointerAngle),
            },
          };
        }

        // Apply visualTransform to bbox so overlay follows annotation live during drag/resize/rotate
        let bbox = getAnnotationBBox(selectionObj);
        let overlayTransform;
        if (visualTransform && typeof visualTransform.id === 'number' && visualTransform.id === selectedIndex) {
          if (visualTransform.resize) {
            // During resize: recompute bbox from a transformed copy of the object so
            // type-specific bbox math (e.g. textbox descender buffer) is applied fresh
            // instead of being scaled along with the stored bbox height.
            const resizeObjType = String(obj.type || '').toLowerCase();
            if (resizeObjType === 'line') {
              // UX 2026-04-19 / 20: live-resize bbox for lines.
              // Mirrors the shifted-final-points math used by the
              // visible shape render above so the dashed frame
              // traces the exact same new shape. Three steps:
              //   1. Scale endpoints + midpoint in LOCAL frame
              //      around the local anchor → naive new points.
              //   2. Compute Δ between the naive curve-inclusive
              //      bbox center and the original, and derive the
              //      (R - I)·Δ shift that pins the world anchor at
              //      any rotation angle.
              //   3. Shift all three points by that vector, then
              //      derive the curve-inclusive bbox that the
              //      SVGSelectionOverlay should render.
              const vr = visualTransform.resize;
              const cx = (obj.left ?? 0) + (obj.width ?? 0) / 2;
              const cy = (obj.top ?? 0) + (obj.height ?? 0) / 2;
              const absX1 = cx + (obj.x1 ?? 0);
              const absY1 = cy + (obj.y1 ?? 0);
              const absX2 = cx + (obj.x2 ?? 0);
              const absY2 = cy + (obj.y2 ?? 0);
              const sx = Math.max(0.01, Math.abs(vr.scaleX));
              const sy = Math.max(0.01, Math.abs(vr.scaleY));
              const naiveX1 = vr.anchorX + (absX1 - vr.anchorX) * sx;
              const naiveY1 = vr.anchorY + (absY1 - vr.anchorY) * sy;
              const naiveX2 = vr.anchorX + (absX2 - vr.anchorX) * sx;
              const naiveY2 = vr.anchorY + (absY2 - vr.anchorY) * sy;
              const storedMid = obj?.data?.midpoint;
              const naiveMid = storedMid
                ? {
                    x: vr.anchorX + (storedMid.x - vr.anchorX) * sx,
                    y: vr.anchorY + (storedMid.y - vr.anchorY) * sy,
                  }
                : null;
              const pivotOldL = computeLineBboxCenter(
                { x1: absX1, y1: absY1, x2: absX2, y2: absY2 },
                storedMid || null,
              );
              const pivotNaiveL = computeLineBboxCenter(
                { x1: naiveX1, y1: naiveY1, x2: naiveX2, y2: naiveY2 },
                naiveMid,
              );
              const angleRadL = ((obj.angle ?? 0) * Math.PI) / 180;
              const cosL = Math.cos(angleRadL);
              const sinL = Math.sin(angleRadL);
              const dXL = pivotNaiveL.x - pivotOldL.x;
              const dYL = pivotNaiveL.y - pivotOldL.y;
              const shiftXL = (cosL - 1) * dXL - sinL * dYL;
              const shiftYL = sinL * dXL + (cosL - 1) * dYL;
              const finalX1 = naiveX1 + shiftXL;
              const finalY1 = naiveY1 + shiftYL;
              const finalX2 = naiveX2 + shiftXL;
              const finalY2 = naiveY2 + shiftYL;
              const finalMid = naiveMid
                ? { x: naiveMid.x + shiftXL, y: naiveMid.y + shiftYL }
                : null;
              // Curve-inclusive bbox of the shifted shape.
              const xsLive = [finalX1, finalX2];
              const ysLive = [finalY1, finalY2];
              if (finalMid) {
                const Cxc = 2 * finalMid.x - 0.5 * finalX1 - 0.5 * finalX2;
                const Cyc = 2 * finalMid.y - 0.5 * finalY1 - 0.5 * finalY2;
                const denomX = finalX1 - 2 * Cxc + finalX2;
                const denomY = finalY1 - 2 * Cyc + finalY2;
                if (Math.abs(denomX) > 1e-9) {
                  const tx = (finalX1 - Cxc) / denomX;
                  if (tx > 0 && tx < 1) {
                    const o = 1 - tx;
                    xsLive.push(o * o * finalX1 + 2 * o * tx * Cxc + tx * tx * finalX2);
                  }
                }
                if (Math.abs(denomY) > 1e-9) {
                  const ty = (finalY1 - Cyc) / denomY;
                  if (ty > 0 && ty < 1) {
                    const o = 1 - ty;
                    ysLive.push(o * o * finalY1 + 2 * o * ty * Cyc + ty * ty * finalY2);
                  }
                }
              }
              const minXL = Math.min(...xsLive);
              const maxXL = Math.max(...xsLive);
              const minYL = Math.min(...ysLive);
              const maxYL = Math.max(...ysLive);
              bbox = {
                left: minXL,
                top: minYL,
                width: Math.max(1, maxXL - minXL),
                height: Math.max(1, maxYL - minYL),
                angle: obj.angle ?? 0,
              };
            } else if (isImportedPath(obj) || isAbsoluteCoordPath(obj)) {
              const sourceBbox = getAnnotationBBox(obj);
              bbox = {
                left: visualTransform.resize.left,
                top: visualTransform.resize.top,
                width: sourceBbox.width * Math.abs(visualTransform.resize.scaleX),
                height: sourceBbox.height * Math.abs(visualTransform.resize.scaleY),
                angle: sourceBbox.angle ?? 0,
              };
            } else {
              const transformedObj = {
                ...obj,
                scaleX: visualTransform.resize.scaleX,
                scaleY: visualTransform.resize.scaleY,
                left: visualTransform.resize.left,
                top: visualTransform.resize.top,
              };
              bbox = getAnnotationBBox(transformedObj);
            }
          } else if (visualTransform.rotate) {
            // During rotate: update angle on bbox
            bbox = { ...bbox, angle: visualTransform.rotate.angle };
          } else {
            // During move: apply translate to the overlay group
            overlayTransform = `translate(${visualTransform.dx}, ${visualTransform.dy})`;
          }
        }

        // Line-type annotations: endpoint handles only on single-click (no bbox, no dashed outline).
        // UX 2026-04-19: when the line is in bbox edit mode (user double-clicked
        // it), fall through to the default SVGSelectionOverlay so the uniform
        // resize + rotate chrome appears instead of the endpoint handles.
        const isLineType = String(selectionObj.type || '').toLowerCase() === 'line';
        const lineInBboxMode = isLineType && isBeingEditedNow && editingAnnotationEditType === 'bbox';
        if (isLineType && !lineInBboxMode) {
          const ep = getLineEndpoints(selectionObj);
          const dx = overlayTransform ? (visualTransform?.dx || 0) : 0;
          const dy = overlayTransform ? (visualTransform?.dy || 0) : 0;
          const isArrow = selectionObj.tool === 'arrow';
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
          // Phase 15 LINE-01 / ARROW-01 — midpoint curvature handle.
          // Position: saved data.midpoint if curved (the bezier passes through
          // it at t=0.5 by construction), geometric midpoint if straight.
          // Offset by the same visual-drag transform (dx, dy) as the endpoints
          // so all three handles move together during a 'move' drag.
          const dataMidpoint = selectionObj.data?.midpoint;
          const midpointBase = resolveMidpointHandlePosition(
            { x: ep.x1, y: ep.y1 },
            { x: ep.x2, y: ep.y2 },
            dataMidpoint,
          );
          // UX: 3rd handle, visibly smaller than endpoints (r=5 vs r=7) to
          // signal "secondary control" per 15-UI-SPEC §A. Same white-fill /
          // blue-ring / drop-shadow as the endpoints so the visual language
          // is unified. cursor:'grab' so all three handles share grabbable
          // semantics. Dispatches handleId='midpoint' to the existing hook
          // dispatcher — wired in useSVGInteraction.js Plan 15-03 Task 3.
          const midpointR = 5 * handleIs;
          // UX 2026-04-20: rotate the endpoint + midpoint handles with the
          // line so single-click selection chrome tracks the rotated shape
          // instead of sitting at the pre-rotation endpoints. Pivot is
          // the curve-inclusive bbox center — same one renderLine, the
          // bbox-edit frame, and the hit-area wrapper all use.
          const lineSelAngle = selectionObj.angle ?? 0;
          const lineSelBC = computeLineBboxCenter(
            { x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 },
            selectionObj.data?.midpoint || null,
          );
          const lineSelCx = lineSelBC.x + dx;
          const lineSelCy = lineSelBC.y + dy;
          const lineSelRotate = lineSelAngle !== 0
            ? `rotate(${lineSelAngle}, ${lineSelCx}, ${lineSelCy})`
            : undefined;
          return (
            <g key={`selection-wrapper-${selectedIndex}`} transform={lineSelRotate}>
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
              {/* Phase 15 midpoint curvature handle — Phase 15 LINE-01/ARROW-01.
                  Smaller r than endpoints (5 vs 7) marks it as a "secondary
                  control" per 15-UI-SPEC §A. Sits on the curve at t=0.5 when
                  curved, geometric midpoint when straight. onPointerDown
                  dispatches 'midpoint' handleId to the existing
                  handleHandlePointerDown hook (see useSVGInteraction.js). */}
              <circle
                data-handle="midpoint"
                cx={midpointBase.x + dx}
                cy={midpointBase.y + dy}
                r={midpointR}
                fill="#ffffff"
                stroke="#4a90e2"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={handleStyle}
                onPointerDown={(e) => { e.stopPropagation(); handleHandlePointerDown(e, 'midpoint'); }}
              >
                {/* Browser-native tooltip per 15-UI-SPEC §Copywriting. */}
                <title>Drag to bend</title>
              </circle>
            </g>
          );
        }

        // Border-flush types: handles sit directly on the shape's own stroke, no dashed bbox
        const objType = String(obj.type || '').toLowerCase();
        const isBorderFlush = objType === 'text' || objType === 'textbox' || objType === 'i-text' || objType === 'rect';

        // UX 2026-04-20: polygon / polyline single-click shows one grab dot
        // per vertex (the shape's proprietary handles), NOT the default
        // dashed-box overlay. Double-click (bbox edit mode) keeps the
        // uniform resize + rotate chrome per the handoff contract.
        const isPolyShape = (objType === 'polygon' || objType === 'polyline')
          && Array.isArray(obj.points) && obj.points.length > 0;
        const polyInBboxMode = isPolyShape && isBeingEditedNow && editingAnnotationEditType === 'bbox';
        if (isPolyShape && !polyInBboxMode) {
          const pLeft = obj.left ?? 0;
          const pTop = obj.top ?? 0;
          const pAngle = obj.angle ?? 0;
          const pScaleX = obj.scaleX ?? 1;
          const pScaleY = obj.scaleY ?? 1;
          const pPathOffsetX = obj.pathOffset?.x || 0;
          const pPathOffsetY = obj.pathOffset?.y || 0;
          const pxs = obj.points.map((p) => Number(p?.x) || 0);
          const pys = obj.points.map((p) => Number(p?.y) || 0);
          const pRawCx = (Math.min(...pxs) + Math.max(...pxs)) / 2;
          const pRawCy = (Math.min(...pys) + Math.max(...pys)) / 2;
          const pRotCenterX = pScaleX * (pRawCx - pPathOffsetX);
          const pRotCenterY = pScaleY * (pRawCy - pPathOffsetY);
          const radP = (pAngle * Math.PI) / 180;
          const cosP = Math.cos(radP);
          const sinP = Math.sin(radP);
          // Replicate renderPolygon transform chain per-point to get each
          // vertex's world position: translate → rotate → scale → pathOffset.
          const worldPoints = obj.points.map((p) => {
            const lx = (Number(p?.x) || 0) - pPathOffsetX;
            const ly = (Number(p?.y) || 0) - pPathOffsetY;
            const sx = lx * pScaleX;
            const sy = ly * pScaleY;
            const dx = sx - pRotCenterX;
            const dy = sy - pRotCenterY;
            const rx = pRotCenterX + dx * cosP - dy * sinP;
            const ry = pRotCenterY + dx * sinP + dy * cosP;
            return { x: pLeft + rx, y: pTop + ry };
          });
          // Dampened inverse scale mirrors SVGSelectionOverlay + endpoint
          // handles so vertex dots feel proportional across zoom levels.
          const vHandleIs = Math.sqrt(inverseScale);
          const vHandleR = 6 * vHandleIs;
          const vHandleStyle = {
            filter: `drop-shadow(0 ${1 * vHandleIs}px ${3 * vHandleIs}px rgba(0,0,0,0.15))`,
            cursor: 'grab',
            pointerEvents: 'auto',
          };
          return (
            <g key={`selection-wrapper-${selectedIndex}`} transform={overlayTransform}>
              {worldPoints.map((wp, i) => (
                <circle
                  key={`vertex-${i}`}
                  cx={wp.x}
                  cy={wp.y}
                  r={vHandleR}
                  fill="#ffffff"
                  stroke="#4a90e2"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  style={vHandleStyle}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleHandlePointerDown(e, `vertex-${i}`);
                  }}
                />
              ))}
            </g>
          );
        }

        // UX 2026-04-20: lines now pivot around the curve-inclusive
        // bbox center everywhere — renderLine, the hit area, single-
        // click handles, drag math, and resize math all resolve to the
        // same point. SVGSelectionOverlay's default rotate transform
        // uses bbox.left + bbox.width/2 which IS that same center
        // (because getLineBBox emits the curve-inclusive tight bbox
        // whose geometric middle equals computeLineBboxCenter). No
        // rotationCenter override needed — keep it null so the default
        // wins for both lines and every other shape type.
        let overlayRotationCenter = null;

        // UX 2026-04-20: counter in bbox edit mode uses a CANONICAL (nub-
        // up) bbox that spans the bubble + nub extension, rotated as a
        // whole by (pointerAngle + 90) around the bubble center. This
        // places the rotation handle / pill directly in front of the
        // nub tip at any angle (at 0° / nub up → above the bbox) and
        // keeps the bbox hugging the whole pin as it swings. The counter
        // bubble + number stay upright because the renderer never reads
        // obj.angle for counters.
        if (counterInBboxMode) {
          const counterBboxObj = (visualTransform?.resize && visualTransform.id === selectedIndex)
            ? {
                ...selectionObj,
                scaleX: visualTransform.resize.scaleX,
                scaleY: visualTransform.resize.scaleY,
                left: visualTransform.resize.left,
                top: visualTransform.resize.top,
              }
            : selectionObj;
          const rawRadius = counterBboxObj.radius || 14;
          const r = rawRadius * Math.abs(counterBboxObj.scaleX || 1);
          const bodyX = (counterBboxObj.left || 0) + r;
          const bodyY = (counterBboxObj.top || 0) + r;
          const tipExt = Math.max(5, r * 0.5);
          const pointerAngleDeg = counterBboxObj.data?.pointerAngle != null
            ? counterBboxObj.data.pointerAngle
            : 225;
          const overlayAngleDeg = ((pointerAngleDeg + 90) % 360 + 360) % 360;
          bbox = {
            left: bodyX - r,
            top: bodyY - r - tipExt,
            width: 2 * r,
            height: 2 * r + tipExt,
            angle: overlayAngleDeg,
          };
          overlayRotationCenter = { x: bodyX, y: bodyY };
        }

        // UX 2026-04-20 diag: log the bbox that the default
        // SVGSelectionOverlay is about to render for a line/arrow, along
        // with the overlay's own rotation-pivot choice (bbox center) and
        // the endpoint midpoint for comparison. Scoped to line-family
        // objects so the log stream stays focused. Throttled per object
        // via the same 150ms per-id clock used by getLineBBox /
        // renderLine. Drop this side-by-side next to [LineBboxDiag]
        // getLineBBox entries to see exactly what the overlay pivot was
        // when the user clicked/rotated/released.
        if (window.__LINE_BBOX_DIAG) try {
          const objTypeLower = String(obj.type || '').toLowerCase();
          if (objTypeLower === 'line' || objTypeLower === 'group') {
            const nowMs = (typeof performance !== 'undefined' && performance.now)
              ? performance.now()
              : Date.now();
            if (!window.__lineOverlayLastLog) window.__lineOverlayLastLog = new Map();
            const key = obj?.id ?? `idx:${selectedIndex}`;
            const last = window.__lineOverlayLastLog.get(key) || 0;
            if (nowMs - last >= 150) {
              window.__lineOverlayLastLog.set(key, nowMs);
              const bboxCx = bbox.left + bbox.width / 2;
              const bboxCy = bbox.top + bbox.height / 2;
              const effCx = overlayRotationCenter?.x ?? bboxCx;
              const effCy = overlayRotationCenter?.y ?? bboxCy;
              const payload = {
                ts: new Date().toISOString(),
                selectedIndex,
                objId: obj?.id ?? null,
                objType: obj?.type ?? null,
                tool: obj?.tool ?? null,
                isBeingEditedNow,
                editType: editingAnnotationEditType ?? null,
                lineInBboxMode,
                hasVisualTransform: !!(visualTransform && visualTransform.id === selectedIndex),
                visualTransformKind: visualTransform?.resize
                  ? 'resize'
                  : visualTransform?.rotate
                    ? 'rotate'
                    : (visualTransform?.dx || visualTransform?.dy) ? 'move' : null,
                bboxPassedToOverlay: bbox,
                bboxGeometricCenter: { x: bboxCx, y: bboxCy },
                explicitRotationCenter: overlayRotationCenter,
                effectiveRotationPivot: { x: effCx, y: effCy },
                pivotDeltaFromBboxCenter: {
                  dx: effCx - bboxCx,
                  dy: effCy - bboxCy,
                },
                isBorderFlush,
                padding: isBorderFlush ? 0 : 2,
              };
              console.log('[LineBboxDiag] overlayMount ' + JSON.stringify(payload));
            }
          }
        } catch (_) { /* swallow diag errors */ }

        return (
          <g key={`selection-wrapper-${selectedIndex}`} transform={overlayTransform}>
            <SVGSelectionOverlay
              key={`selection-${selectedIndex}`}
              bbox={bbox}
              inverseScale={inverseScale}
              onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
              // UX 2026-04-19: only mask the overlay handles when the edit
              // surface is a Fabric canvas (which would render its own
              // handles). In bbox edit mode the SVG layer IS the edit
              // surface — it must show the corner + edge + rotate handles
              // itself, so drop the mask in that case.
              isGroupSelection={isBeingEditedNow && editingAnnotationEditType !== 'bbox'}
              hideBoundingBox={isBorderFlush && !isSelectDeleteOnlyPdfTextMarkup}
              padding={isBorderFlush && !isSelectDeleteOnlyPdfTextMarkup ? 0 : 2}
              rotationCenter={overlayRotationCenter}
              selectionGlowOnly={isSelectDeleteOnlyPdfTextMarkup}
            />
          </g>
        );
      })}
      {/* Multi-select: individual dashed boxes (no handles) + group union box with handles */}
      {(selectedIds.size + (effectiveSelectedCalloutIds?.size || 0)) > 1 && (
        <>
          {/* UX: Phase 19 follow-up — individual dashed boxes per member
              were removed. Each selected annotation now picks up the
              cursor-hover blue glow via the shared annotationIsHovered
              branch in the annotation render path above. The outer group
              union box below is the only selection chrome rendered for
              a multi-selection. */}
          {/* Group union bounding box with handles */}
          {(() => {
            // UX: 2026-04-20 v2 — during a group-rotate drag the outer
            // dashed bbox should rotate as a rigid frame WITH the shapes.
            // Without this, the per-render world-AABB recomputation makes
            // the bbox grow / shrink to wrap the rotated shapes' axis-
            // aligned silhouettes, which looks wrong (resize during
            // rotate). When visualTransform.groupRotate is present, use
            // the snapshot bbox captured at drag start and apply a rotate
            // transform around the original pivot — same trick as
            // single-shape rotate via SVGSelectionOverlay's transform.
            const groupRotateLive = visualTransform?.id === 'group'
              ? visualTransform?.groupRotate
              : null;
            // UX: 2026-04-21 v7 — while a group-resize is in flight on a
            // rotated group, the hook broadcasts the new (tilted) frame
            // dims + center so we can redraw the dashed box to match the
            // live pointer drag. This keeps the tilt AND hugs the shapes.
            const groupResizeLive = visualTransform?.id === 'group'
              ? visualTransform?.groupResize
              : null;

            // UX 2026-04-20: use the rotation-aware world AABB so a rotated
            // line / arrow / shape in the selection contributes its true
            // on-screen silhouette to the outer dashed frame. Passing the
            // LOCAL bbox here caused the group frame to clip the visible
            // arc of a rotated curved line or arrow when combined with a
            // non-rotated shape.
            const bboxes = Array.from(selectedIds)
              .map(idx => visualTransform?.previewObjects?.[idx] || annotations?.objects?.[idx])
              .filter(Boolean)
              .map(obj => getAnnotationWorldAABB(obj));
            // UX: Phase 19 follow-up — callouts participate in the group
            // union bbox too. Without this, a selection mixing annotations
            // and callouts drew an outer box that only covered the
            // annotations, leaving callouts stranded outside the group.
            if (effectiveSelectedCalloutIds && callouts && callouts.length > 0) {
              const pageW = width;
              const pageH = height;
              for (const callout of callouts) {
                if (!callout || !effectiveSelectedCalloutIds.has?.(callout.id)) continue;
                const previewPatch = visualTransform?.calloutPreviews?.[callout.id] || null;
                const displayCallout = previewPatch ? { ...callout, ...previewPatch } : callout;
                // UX: Phase 19 follow-up bugfix — the app-wide callouts
                // array mixes callouts from every PDF page. Without
                // this page filter, a selection that included callouts
                // on OTHER pages would balloon this page's outer
                // dashed box to cover those off-page callouts. Match
                // the same filter the callout render loop uses.
                if (displayCallout.pageNumber !== pageNumber) continue;
                // Defensive: skip callouts with missing anchors so a
                // malformed record can't drag the bbox toward (0,0).
                const at = displayCallout.arrowTip;
                const kn = displayCallout.knee;
                const tp = displayCallout.textBoxPosition;
                if (!at || !kn || !tp) continue;
                const tbW = Number.isFinite(displayCallout.textBoxWidth) ? displayCallout.textBoxWidth : 0;
                const tbH = Number.isFinite(displayCallout.textBoxHeight) ? displayCallout.textBoxHeight : 0;
                const xs = [at.x, kn.x, tp.x, tp.x + tbW].map((n) => n * pageW);
                const ys = [at.y, kn.y, tp.y, tp.y + tbH].map((n) => n * pageH);
                bboxes.push({
                  left: Math.min(...xs),
                  top: Math.min(...ys),
                  width: Math.max(...xs) - Math.min(...xs),
                  height: Math.max(...ys) - Math.min(...ys),
                });
              }
            }
            if (bboxes.length === 0) return null;
            // UX: 2026-04-21 — three sources of bbox geometry, in priority:
            //   1. Live group-rotate drag → snapshot bbox + live angle.
            //   2. Persisted group rotation (from a prior group-rotate
            //      commit on this same selection) → persisted snapshot
            //      bbox + persisted angle + accumulated dx/dy. Keeps the
            //      frame tilted past pointerup, matching single-shape
            //      rotate behavior.
            //   3. Default → live union of member world AABBs.
            const persistedSig = persistedGroupTransform
              ? persistedGroupTransform.selectionSig
              : null;
            const liveSig = (() => {
              const a = Array.from(selectedIds || []).slice().sort((x, y) => x - y).join(',');
              const cArr = (effectiveSelectedCalloutIds instanceof Set)
                ? Array.from(effectiveSelectedCalloutIds).slice().sort()
                : [];
              return `${a}|${cArr.join(',')}`;
            })();
            const persistedActive = persistedGroupTransform
              && persistedSig === liveSig;

            // UX: 2026-04-21 v5 — the frame center must sit on the actual
            // rotation pivot, NOT the live AABB centroid. Rigid rotation
            // around a fixed pivot moves each shape's CENTER but keeps the
            // frame's center at the pivot (a point rotated around itself
            // stays put). Earlier v4 used the live AABB centroid, which
            // drifts off the pivot whenever shapes are asymmetric around
            // it: a rotated shape's axis-aligned box grows, so the union
            // midpoint slides relative to the true pivot and the frame
            // visibly detaches from the shapes. The snapshot bbox's center
            // IS the pivot (that's where we captured it at drag start), so
            // use that as the frame center. Accumulated post-rotate moves
            // are tracked in the persisted dx/dy (pivot shifts with the
            // group), and any in-progress move is handled by a translate
            // on the wrapping group.
            const liveUnion = (bboxes.length > 0) ? getGroupBBox(bboxes) : null;

            // Choose the bbox dimensions. Priority: live resize (scaled
            // snapshot dims), persisted snapshot (tilted frame post-rotate),
            // live rotate snapshot, fall back to live union.
            let bboxW;
            let bboxH;
            if (groupResizeLive) {
              bboxW = groupResizeLive.width;
              bboxH = groupResizeLive.height;
            } else if (persistedActive) {
              bboxW = persistedGroupTransform.snapshotBbox.width;
              bboxH = persistedGroupTransform.snapshotBbox.height;
            } else if (groupRotateLive) {
              bboxW = groupRotateLive.snapshotBbox.width;
              bboxH = groupRotateLive.snapshotBbox.height;
            } else {
              bboxW = liveUnion?.width || 0;
              bboxH = liveUnion?.height || 0;
            }

            // Frame center: live resize's computed new center when active,
            // else snapshot pivot + accumulated moves for persisted/active
            // rotation, else live union centroid.
            let centerX;
            let centerY;
            if (groupResizeLive) {
              centerX = groupResizeLive.centerX;
              centerY = groupResizeLive.centerY;
            } else if (persistedActive) {
              const src = persistedGroupTransform.snapshotBbox;
              centerX = src.left + src.width / 2 + (persistedGroupTransform.dx || 0);
              centerY = src.top + src.height / 2 + (persistedGroupTransform.dy || 0);
            } else if (groupRotateLive) {
              const src = groupRotateLive.snapshotBbox;
              centerX = src.left + src.width / 2;
              centerY = src.top + src.height / 2;
            } else if (liveUnion) {
              centerX = liveUnion.left + liveUnion.width / 2;
              centerY = liveUnion.top + liveUnion.height / 2;
            } else {
              centerX = 0;
              centerY = 0;
            }

            const groupBBox = {
              left: centerX - bboxW / 2,
              top: centerY - bboxH / 2,
              width: bboxW,
              height: bboxH,
            };

            // Rotation transform: spin the frame around its own center
            // (which IS the rotation pivot). That keeps the dashed box
            // perfectly aligned with the rigid shape rotation.
            const persAngle = persistedActive ? (persistedGroupTransform.angle || 0) : 0;
            const liveAngle = groupRotateLive
              ? (groupRotateLive.angle || 0)
              : (groupResizeLive ? 0 : 0);
            // During a live resize on a rotated group, the frame must keep
            // the persisted tilt. persAngle already carries that; the
            // liveAngle stays 0 because there's no in-flight rotation.
            const liveDx = (visualTransform?.id === 'group' && !groupRotateLive)
              ? (visualTransform.dx || 0)
              : 0;
            const liveDy = (visualTransform?.id === 'group' && !groupRotateLive)
              ? (visualTransform.dy || 0)
              : 0;
            const totalAngle = persAngle + liveAngle;

            let groupDragTransform;
            if (totalAngle && (liveDx || liveDy)) {
              groupDragTransform = `translate(${liveDx} ${liveDy}) rotate(${totalAngle}, ${centerX}, ${centerY})`;
            } else if (totalAngle) {
              groupDragTransform = `rotate(${totalAngle}, ${centerX}, ${centerY})`;
            } else if (liveDx || liveDy) {
              groupDragTransform = `translate(${liveDx} ${liveDy})`;
            } else {
              groupDragTransform = undefined;
            }
            // UX: Phase 19 follow-up — right-click inside the outer
            // dashed box should open a group context menu (cut/copy/
            // paste/delete/z-order all at once). The hit-test resolver
            // walks data attributes looking for annotations first, then
            // falls back to this marker so empty space inside the group
            // box dispatches a 'group' kind instead of 'page'.
            // Indices are serialized as CSV so the dispatcher can read
            // them without cross-boundary state sharing.
            const groupIndicesCsv = Array.from(selectedIds).join(',');
            return (
              <g
                key="group-selection-wrapper"
                transform={groupDragTransform}
                data-group-selection-bbox="true"
                data-group-selection-indices={groupIndicesCsv}
              >
                <SVGSelectionOverlay
                  key="group-selection"
                  bbox={groupBBox}
                  inverseScale={inverseScale}
                  onHandleDrag={(e, handleId) => handleHandlePointerDown(e, handleId)}
                  isGroupSelection={false}
                  strokeOpacity={0.6}
                  // UX: 2026-04-21 — multi-selection frame is ALWAYS move-
                  // only. Group rotate / group resize handles are hidden
                  // app-wide until the matrix-per-shape rewrite ships. The
                  // dashed frame remains visible so the user still sees what
                  // is selected, and drag-to-move still works because that
                  // initiates from a member-shape pointerdown (not from the
                  // overlay's handles). Do NOT re-enable without an explicit
                  // user waiver — see handoff 2026-04-21.
                  moveOnly={true}
                />
                {/* Invisible hit-test rect so the resolver's
                    getBoundingClientRect fallback has a concrete
                    element at the union bbox. pointer-events: none so
                    it never steals events from annotations underneath. */}
                <rect
                  x={groupBBox.left}
                  y={groupBBox.top}
                  width={groupBBox.width}
                  height={groupBBox.height}
                  fill="none"
                  stroke="none"
                  pointerEvents="none"
                  data-group-selection-hitbox="true"
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
      angle={rotationInputAngle}
      annotationIndex={rotationInputAnnotationIndex}
      isRotating={isRotating || isSurveyHighlightRotating}
      isVisible={showRotationInput && rotationInputAnnotationIndex !== null}
      shapeCenterViewBox={rotationInputCenterViewBox}
      onCommit={handleRotationInputCommit}
      onCancel={handleRotationInputCancel}
      onHoverChange={handleRotationInputHoverChange}
    />
    </>
  );
});

SVGAnnotationLayer.displayName = 'SVGAnnotationLayer';

export default SVGAnnotationLayer;
