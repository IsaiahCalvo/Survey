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
import { screenToSVG } from '../utils/svgTransformMath';
import SVGSelectionOverlay from './SVGSelectionOverlay';
import RotationInputField from './RotationInputField';
import { getAnnotationBBox, getGroupBBox, isImportedPath, getLineEndpoints } from '../utils/svgBoundingBox';
import { resolveMidpointHandlePosition } from '../utils/lineDragMath.js';
import {
  ANNOTATION_VISIBILITY_SCOPE,
  getAnnotationVisibilityScope,
  isAnnotationVisibleByPageControl
} from '../utils/annotationVisibilityRules';
// Diagnostic: record every SVG callout's source data + DOM rects so Save Log
// can dump a full geometry comparison against the Fabric edit-mode capture.
import { captureSvgCallout } from '../utils/calloutGeometryDiag.js';

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
    // Pan-mode quick-click: App.jsx drives selection via pendingSelection.
    selectAnnotation,
    // UX: App.jsx can also drive a "clear selection on this page" command
    // through pendingSelection (annotationIndex: null). Used after right-click
    // Delete so the selection doesn't stick to the new shape that slides into
    // the deleted shape's index slot.
    deselectAll,
    // Pan-mode hover: App.jsx drives hover glow via pendingHover.
    setHoveredId,
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
    onUpdateCalloutLive,
    onUpdateCallout,
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
    if (pendingSelection.pageNumber !== pageNumber) return;
    if (pendingSelection.annotationIndex === null) {
      deselectAll();
      return;
    }
    if (typeof pendingSelection.annotationIndex !== 'number') return;
    selectAnnotation(pendingSelection.annotationIndex, false);
  }, [pendingSelection, pageNumber, selectAnnotation, deselectAll]);

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
  const isSelectTool = (activeTool === 'select' || activeTool === 'text-select') && editingAnnotationIndex == null;
  // UX: line/arrow/callout tools also get pointerEvents=auto so the crosshair
  // class shows through and callout creation drag can start on the SVG
  // surface. Gated on editingAnnotationIndex == null so the creation surface
  // disables during edit mode (mirrors isSelectTool's edit-mode guard).
  const isCreationTool = (activeTool === 'line' || activeTool === 'arrow' || activeTool === 'callout') && editingAnnotationIndex == null;
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

      // UX: annotations take precedence — if both are somehow selected,
      // delete the annotation first. Plan 14-03's selection state
      // management guarantees mutual exclusivity, but this ordering is
      // defensive in case a race leaves both populated.
      if (selectedIds.size > 0) {
        deleteSelected();
        return;
      }

      // UX: callout branch — convert Set or Array to a plain Array for
      // the callback. App.jsx's wrapper (Plan 14-03) calls setCallouts
      // and saveAnnotationCheckpoint for per-action undo (Phase 9
      // pattern).
      if (calloutSelectionSize > 0) {
        const idsArray = effectiveSelectedCalloutIds instanceof Set
          ? Array.from(effectiveSelectedCalloutIds)
          : Array.isArray(effectiveSelectedCalloutIds)
            ? effectiveSelectedCalloutIds.slice()
            : [];
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
    if (editingAnnotationIndex != null) return;

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

    // DIAG: log what the SVG layer receives for each page so we can
    // cross-reference with the [PDF-IMPORT] log. Only log when there's
    // a PDF-imported object to avoid noise on non-imported pages.
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

    for (let i = 0; i < objects.length; i++) {
      if (count >= MAX_PREVIEW_OBJECTS) {
        dropReasons.maxPreviewCap.push(i);
        continue;
      }

      const obj = objects[i];
      if (!obj || obj.visible === false) {
        dropReasons.nullOrHiddenFlag.push(i);
        continue;
      }

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
        console.log(`[Counter SVG p${pageNumber}] dispatching renderCounter — i=${i}, displayNumber=${obj.data.displayNumber}, fill=${obj.fill}, numberColor=${obj.data.numberColor || 'unset'}, left=${obj.left}, top=${obj.top}, radius=${obj.radius}`);
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
  ]);

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
  const renderCalloutHitTargets = useCallback((callout, pageSize) => {
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
    // line1/line2 hit overlays line up with the visible segments.
    const conn = calculateCalloutConnection(
      tbX, tbY, tbW, tbH,
      { x: kX, y: kY },
      { x: atX, y: atY },
      callout.style?.lineThickness || 2
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
        {/* UX: invisible knee hit target — no visible chrome in Phase 14;
            Phase 17/18 will add visible selection handles that reuse the
            same data-callout-part='knee' delegation. */}
        <circle
          data-callout-part="knee"
          cx={kX}
          cy={kY}
          r={12}
          fill="transparent"
          style={{ cursor: 'grab', pointerEvents: 'all' }}
        />
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
    if (!Array.isArray(callouts) || callouts.length === 0) return [];
    const pageSize = { width, height };
    const elements = [];
    let count = 0;

    for (let i = 0; i < callouts.length; i++) {
      // MAX_PREVIEW_CALLOUTS guard — existing constant, do NOT change
      if (count >= MAX_PREVIEW_CALLOUTS) break;

      const callout = callouts[i];
      if (!callout) continue;

      // UX: per-page filter — only show callouts for this page
      if (callout.pageNumber !== pageNumber) continue;

      // UX: module filter — when survey panel is open with a selected module,
      // only show callouts matching that module (existing rule, preserved)
      if (showSurveyPanel && selectedModuleId) {
        if (callout.moduleId !== selectedModuleId) continue;
      }

      // UX: Phase 15 UAT-1 restructure (2026-04-17) — when a callout is in
      // edit mode, render its 4 static chrome parts (line1, line2, arrowTip,
      // textBox rect) but skip the text foreignObject. FabricEditCanvas
      // overlays the textbox child via the known-good text-edit path; the
      // static parts remain as visual anchors underneath. Replaces the prior
      // full-callout skip which left the edit canvas orphaned visually.
      // Plan 15-04 Step 2 — Previously the SVG callout's textbox rect + text
      // hid during edit so the Fabric overlay could render its own. Now that
      // the Fabric textbox is transparent (fill+stroke rgba 0), the SVG
      // callout stays visible and serves as the visual truth. No more
      // "border grows" effect from the overlay's slightly different bounds.
      const hideText = false;
      // UX: Phase 15 UAT-2 — pass live textbox bounds only to the currently-
      // editing callout so line1 retracts to the live edge as the textbox
      // auto-grows. Other callouts render from stored normalized dims.
      const liveBoundsForCallout = (editingCalloutId && callout.id === editingCalloutId)
        ? (liveCalloutEditBounds || null)
        : null;

      // UX: CALL-10 — new signature takes pageSize object, emits data attributes
      const element = renderCallout(callout, i, pageSize, calculateCalloutConnection, hideText, liveBoundsForCallout);
      if (!element) continue;

      // UX: Phase 14 Task 2 — invisible hit-target overlays for callout
      // parts. The 12px radius / 12px line strokeWidth matches the deleted
      // HTML overlay's .callout-handle size (muscle-memory continuity per
      // 14-UI-SPEC.md Interaction Contract 4). The group carries
      // data-callout-id so useSVGInteraction's pointerdown hit-test can
      // identify which callout was clicked even when the visible chrome
      // is too thin for touch.
      const hitTargets = renderCalloutHitTargets(callout, pageSize);

      elements.push(
        // UX: wrap visible element + invisible hit targets in a shared
        // fragment via an outer <g> so the hit targets render AFTER the
        // visible chrome (on top of it, catching pointer events).
        // eslint-disable-next-line react/jsx-key
        <g key={`callout-wrap-${callout.id || i}`}>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callouts, pageNumber, showSurveyPanel, selectedModuleId, width, height, editingCalloutId, liveCalloutEditBounds]);

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
    const hideForEdit = isBeingEdited && !isInPlaceEdit;

    // Plan 15-04 Step 3 — when the currently-edited annotation is text, swap
    // in a live-rendered version driven by Fabric's per-keystroke bounds+text
    // payload. The filteredAnnotations useMemo renders from stored obj only;
    // per-keystroke repaint happens here, so the memo doesn't churn on every
    // letter typed.
    if (isBeingEdited && TEXT_EDIT_TYPES.includes(objTypeForEdit) && liveTextEditBounds) {
      renderElement = renderText(renderObj, i, liveTextEditBounds);
    }

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
            // Same transform chain as renderPolygon / renderPolyline.
            let shapeTransform = `translate(${shapeLeft}, ${shapeTop})`;
            if (shapeAngle !== 0) shapeTransform += ` rotate(${shapeAngle})`;
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
            // UX: pen-stroke hover halo traces the actual stroke geometry
            // (soft blue glow along the squiggle), not the surrounding bbox
            // rectangle — matches the line hover pattern above at :1360-1369.
            // A bbox-rect halo around a freehand stroke looks disconnected
            // from the shape. Hit-area stays as the bbox rect (same behavior
            // as before this change) so click target is unchanged; only the
            // visual glow is stroke-shaped.
            const pathD = renderObj.path.map((seg) => seg.join(' ')).join(' ');
            const pathLeft = renderObj.left ?? 0;
            const pathTop = renderObj.top ?? 0;
            const pathAngle = renderObj.angle ?? 0;
            const pathScaleX = renderObj.scaleX ?? 1;
            const pathScaleY = renderObj.scaleY ?? 1;
            const pathOffsetX = renderObj.pathOffset?.x || 0;
            const pathOffsetY = renderObj.pathOffset?.y || 0;
            // Same transform chain as renderPath in svgAnnotationRenderers.jsx:72-75.
            let pathTransform = `translate(${pathLeft}, ${pathTop})`;
            if (pathAngle !== 0) pathTransform += ` rotate(${pathAngle})`;
            if (pathScaleX !== 1 || pathScaleY !== 1) pathTransform += ` scale(${pathScaleX}, ${pathScaleY})`;
            pathTransform += ` translate(${-pathOffsetX}, ${-pathOffsetY})`;
            const sw = renderObj.strokeWidth || 1;
            return (
              <g>
                {annotationIsHovered && (
                  <path
                    d={pathD}
                    transform={pathTransform}
                    stroke="#4a90e2"
                    strokeOpacity={0.4}
                    // UX: match line-hover width formula — Math.max(6, sw + 4).
                    // Ensures thin strokes still get a visible halo floor.
                    strokeWidth={Math.max(6, sw + 4)}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect={renderObj.strokeUniform ? 'non-scaling-stroke' : undefined}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {/* Bbox hit area — unchanged from generic branch. Keeps the
                    click target identical so hover-swap is purely visual. */}
                <rect
                  x={bbox.left}
                  y={bbox.top}
                  width={Math.max(bbox.width, 10)}
                  height={Math.max(bbox.height, 10)}
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
          // UX: Phase 14 CREATE-01 (callout half) — when the callout tool
          // is active and the click lands on empty SVG space (NOT inside
          // an existing callout), start a transient creation drag. If the
          // click is inside an existing callout, fall through to
          // handleSvgPointerDown which dispatches the callout-part drag
          // via useSVGInteraction (Plan 14-03 Task 2).
          if (activeTool === 'callout' && !e.target?.closest?.('[data-callout-id]')) {
            const pt = screenToSVG(svgRef.current, e.clientX, e.clientY);
            setCalloutCreation({ arrowTip: pt, currentPointer: pt });
            e.preventDefault();
            return;
          }
          handleSvgPointerDown(e);
        }
      }}
      onPointerMove={isInteractive ? handlePointerMove : undefined}
      onPointerUp={isInteractive ? handlePointerUp : undefined}
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
      {filteredCallouts}
      {/* UX: Phase 14 CREATE-01 (callout half) — transient click-drag
          preview. Dashed at 0.6 opacity so the committed callout is
          visually distinct (solid, full opacity). Cleared on pointerup
          (via the window listener), tool switch, or empty drag. See
          14-UI-SPEC.md Interaction Contract 3 callout preview composition
          and 14-CONTEXT.md Area 4 CREATE-01 callout preview. */}
      {calloutCreation && (
        <g className="callout-preview" opacity={0.6} style={{ pointerEvents: 'none' }}>
          {/* Dashed textbox at currentPointer (120x32 default) */}
          <rect
            x={calloutCreation.currentPointer.x}
            y={calloutCreation.currentPointer.y}
            width={120}
            height={32}
            fill="#ffffff"
            stroke="#1e293b"
            strokeWidth={2}
            strokeDasharray="5,5"
            rx={4}
            ry={4}
          />
          {/* Dashed connector line 1: textbox-center → knee */}
          <line
            x1={calloutCreation.currentPointer.x + 60}
            y1={calloutCreation.currentPointer.y + 16}
            x2={(calloutCreation.arrowTip.x + calloutCreation.currentPointer.x) / 2}
            y2={calloutCreation.arrowTip.y - 40}
            stroke="#1e293b"
            strokeWidth={2}
            strokeDasharray="5,5"
            strokeLinecap="round"
          />
          {/* Dashed connector line 2: knee → arrowTip */}
          <line
            x1={(calloutCreation.arrowTip.x + calloutCreation.currentPointer.x) / 2}
            y1={calloutCreation.arrowTip.y - 40}
            x2={calloutCreation.arrowTip.x}
            y2={calloutCreation.arrowTip.y}
            stroke="#1e293b"
            strokeWidth={2}
            strokeDasharray="5,5"
            strokeLinecap="round"
          />
          {/* Dashed arrowhead triangle at arrowTip */}
          <polygon
            points={`${calloutCreation.arrowTip.x},${calloutCreation.arrowTip.y} ${calloutCreation.arrowTip.x - 8},${calloutCreation.arrowTip.y - 4} ${calloutCreation.arrowTip.x - 8},${calloutCreation.arrowTip.y + 4}`}
            fill="#1e293b"
          />
        </g>
      )}
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
        const editIsCounter = obj.data?.type === 'counter';
        const isBeingEditedNow = editingAnnotationIndex != null && selectedIndex === editingAnnotationIndex;
        // UX 2026-04-14: counters in edit mode show the floating mini-toolbar
        // ONLY — no rotation handle, no bbox, no resize chrome. Any handle in
        // edit mode is visual noise (the toolbar already provides every action).
        // Guard is broader than `isBeingEditedNow` to catch state-desync edge
        // cases where editingAnnotationIndex is set but selectedIndex briefly
        // doesn't match (e.g. mid-double-click frame).
        if (editIsCounter && editingAnnotationIndex != null) return null;
        if (isBeingEditedNow && editIsBorderFlush) return null;

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
          // Phase 15 LINE-01 / ARROW-01 — midpoint curvature handle.
          // Position: saved data.midpoint if curved (the bezier passes through
          // it at t=0.5 by construction), geometric midpoint if straight.
          // Offset by the same visual-drag transform (dx, dy) as the endpoints
          // so all three handles move together during a 'move' drag.
          const dataMidpoint = obj.data?.midpoint;
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
