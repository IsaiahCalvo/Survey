/**
 * RegionSelectionTool.jsx — interactive overlay for drawing/editing space regions on a PDF page.
 *
 * Default-export component that lets the user draw rectangular or freehand
 * regions and switch to a move/resize/vertex-edit mode, with add/subtract
 * boolean ops via martinez-polygon-clipping and a per-(space,page) undo/redo
 * history. Locates its target page via `[data-region-selection-target]` and
 * maps client coords to page space using container-measured display scale.
 * Drives the Spaces region-editing flow; commits via `onRegionComplete`.
 */
import { isInTabBehind } from './utils/tabBehind.js';
import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { pagePresentationFrame, clientPointInPageFrame } from './utils/pagePresentation.js';
import { diff, union, intersection } from './vendor/martinezPolygonClipping.js';
import { areaDrawCursor } from './utils/areaDrawCursor';
import { REGION_OPERATIONS, polygonToRegionCoords, regionToPolygon, simplifyPolygon, subtractRegionFromRegion, rotateCoordsAroundPoint, getRegionRotation, normalizeRegionRotation, deriveRegionChromeGeometry } from './utils/regionMath';
import { buildRegionOutlinePathD, buildSmoothVertexLookup, getRegionSmoothFlags, thinBooleanResultRing, thinFreehandStroke, withRegionOutlineCoordinates } from './utils/regionOutline';
import { isUndoKeyEvent, isRedoKeyEvent } from './utils/undoRedoHotkeys';
import { calculateViewportSafePosition } from './utils/menuPositioning';
import { HANDLE_FILL, HANDLE_RING, HANDLE_RADIUS } from './utils/handleStyle';
// KAL-301 REDO: rotation chrome copies the day-one standard implementation.
// - normalizeAngle / snapAngleToNearest45: same drag math + soft Shift-snap
//   convention as useSVGInteraction.js's rotate branch (Phase 9/EDIT-11).
// - selectionHandleVisibility metrics: same mtr circle size / icon size /
//   rotation offset as SVGSelectionOverlay.jsx.
// - RotationInputField: the app's standard angle pill (EDIT-12), reused as-is.
import { normalizeAngle, snapAngleToNearest45 } from './utils/svgTransformMath';
import { getSelectionHandleVisualMetrics, getAdaptiveSelectionHandleSpec } from './utils/selectionHandleVisibility.js';
import RotationInputField from './components/RotationInputField';
import { createStableActions } from './utils/stableActionProxy.js';
import rotateIconSvg from './assets/rotate-icon.svg';
import { GRAB_HANDLE_CURSOR, ROTATE_HANDLE_CURSOR, resizeHandleCursor } from './utils/handleCursors.js';
import { keyboardControlProps } from './utils/keyboardActivation.js';
import { showToast, dismissToast } from './utils/toast.js';

// One "Area changes dropped" toast at a time; a new area session takes it
// down so its Undo can never write old areas over newer ones.
const AREA_DROPPED_TOAST_ID = 'region-area-changes-dropped';
import Icon from './Icons';
import { useTooltip } from './components/Tooltip';
import './styles/annotationContextMenu.css';
import { REGION_POLYGON_MIN_CORNERS, insertRegionSidePoint, isLevelRectangle, isRegionSideStraight, regionPolygonHitRadii, regionPolygonPressAction, resolveRegionPolygonPoint } from './utils/regionPolygonEdit.js';
import { POLY_FINISH_CONTROL_FILL, POLY_FINISH_CONTROL_SCREEN_RADIUS } from './utils/polyDraft.js';
import { REGION_MARQUEE_MIN_DRAG_PX, regionMarqueeDirection, regionMarqueeRect, resolveRegionMarqueeHits } from './utils/regionMarquee.js';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const MIN_REGION_SIZE = 5;
// Owner 2026-10-22: Polygon area, drawn a corner per click like Bluebeam's
// Add Space and Photoshop's Polygonal Lasso. Since 2026-10-28 it draws like
// the Polygon markup tool: check marks on the first and latest corner close
// or finish it, and Shift locks each new side to 15° (regionPolygonEdit.js).
const DRAW_TOOL_TYPES = new Set(['rectangular', 'polygon', 'freehand']);
// Owner 2026-10-26: Erase takes a whole area away where it is pressed or
// dragged over (the phone's Delete key; Subtract cuts part of an area).
const ERASE_TOOL_TYPE = 'erase';
// A mouse press that lifts within this many screen px is a click, not a drag.
const MOUSE_CLICK_SLOP_PX = 4;
// A pasted or duplicated area lands this many page units down-right.
const AREA_PASTE_STEP = 12;
const REGION_HANDLE_BLUE = HANDLE_RING;
// Unified white-fill / blue-ring handle look (shared with every other handle).
const REGION_HANDLE_STROKE = HANDLE_RING;
const REGION_HANDLE_FILL = HANDLE_FILL;
const REGION_HISTORY_LIMIT = 100;
// Phone (owner 2026-10-01: "Spaces don't work: draw, select, move"). A finger
// needs a 44px target, not the 11px dot a mouse can hit. The dot stays the
// same size; an invisible pad around it takes the touch.
const TOUCH_HANDLE_HIT_PX = 44;
// A finger that lands and lifts within this many screen px is a tap, not a drag.
const TOUCH_TAP_SLOP_PX = 10;
// PdfjsViewerContainer fires this on window when two fingers start a pinch.
const PDFJS_PINCH_START_EVENT = 'survey-pdfjs-pinch-start';
// Owner 2026-10-01: thin a finished freehand stroke / an add-subtract result
// to the fewest points that keep the outline within this many screen px of
// the drawn line (at the zoom it was drawn at).
const OUTLINE_THIN_TOLERANCE_PX = 1.5;
// Two taps on the same area within this long (and this close) = double-tap.
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP_PX = 30;
// Chrome that keeps working while areas are edited (zoom / fit / page nav).
// A press on it must not end the edit session.
const REGION_EDIT_PASS_THROUGH_CHROME = [
  '[data-rail-footer-row="true"]',
  'button[aria-label="Zoom in"]',
  'button[aria-label="Zoom out"]',
  '[aria-label="Zoom percentage"]',
  '[aria-label="Zoom and fit options"]',
  '[aria-label="Zoom level"]',
  '[aria-label="Zoom and fit mode"]',
  'button[aria-label="Previous page"]',
  'button[aria-label="Next page"]',
].join(', ');

// What is saved: exactly what the user made. Touching areas do not merge
// unless the user picks Merge from the area menu.
const buildRegionPayload = (list) => (Array.isArray(list) ? list : []).map((region) => ({
  ...region,
  coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : [],
  // Deep copy sourceRegions (unmerge needs them).
  sourceRegions: Array.isArray(region.sourceRegions)
    ? region.sourceRegions.map((sourceRegion) => ({
        ...sourceRegion,
        coordinates: Array.isArray(sourceRegion.coordinates) ? [...sourceRegion.coordinates] : []
      }))
    : undefined,
  originCenter: region.originCenter ? { ...region.originCenter } : undefined
}));

// The parts of the areas that leaving the tool would save.
const regionsSignature = (list) => JSON.stringify((Array.isArray(list) ? list : []).map((region) => [
  region.regionId,
  region.operation || null,
  region.shapeType || null,
  region.rotation || 0,
  region.coordinates,
  region.smoothVertices || null,
]));

// Even-odd point-in-polygon on a flat [x0, y0, x1, y1, ...] list (page units).
const isPointInFlatPolygon = (x, y, coords) => {
  if (!Array.isArray(coords) || coords.length < 6) return false;
  let inside = false;
  const n = coords.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = coords[i * 2];
    const yi = coords[i * 2 + 1];
    const xj = coords[j * 2];
    const yj = coords[j * 2 + 1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) {
      inside = !inside;
    }
  }
  return inside;
};
// Copied areas as read back from the clipboard: a list of outlines.
const isAreaList = (list) => Array.isArray(list) && list.length > 0 && list.every((region) => (
  region && Array.isArray(region.coordinates) && region.coordinates.length >= 6 &&
  region.coordinates.length % 2 === 0 && region.coordinates.every(Number.isFinite)
));
const regionEditHistoryStore = new Map();

// KAL-301 REDO: standard rotation-pill visibility timings, copied from the
// SVGAnnotationLayer state machine (EDIT-12): 150ms hover-intent before the
// pill appears, 500ms grace after the cursor leaves before it hides.
const ROT_PILL_HOVER_INTENT_MS = 150;
const ROT_PILL_GRACE_MS = 500;

// KAL-301 follow-up: rotation bake math + chrome-geometry derivation moved to
// utils/regionMath.js (rotateCoordsAroundPoint, deriveRegionChromeGeometry)
// so the node test suite exercises the real implementation.

const regionDebug = (...args) => {
  if (typeof window === 'undefined' || window.__REGION_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

const getRegionEditHistoryKey = (spaceId, pageId) => `${spaceId ?? 'unknown-space'}:${pageId ?? 'unknown-page'}`;

const stopRegionKeyboardShortcut = (event) => {
  event.preventDefault();
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  } else {
    event.stopPropagation();
  }
};

const isEditableKeyboardTarget = () => {
  const activeElement = document.activeElement;
  return Boolean(
    activeElement &&
    (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable ||
      activeElement.contentEditable === 'true'
    )
  );
};

// Region Selection Tool Component
// Provides UI for selecting, transforming, and managing regions on PDF pages
// Users can draw rectangular or freehand regions and switch to move mode to adjust existing selections

const RegionSelectionTool = ({
  active,
  // False while this tab is behind the front one: its keys are the front
  // tab's (docs/TAB-SWITCHING.md S6).
  tabActive = true,
  mobileMode = false,
  onMobileToolbarApiChange = null,
  // Owner 2026-10-01 (Spaces toolbar): the app's Pan tool stays usable while
  // editing areas. Picking an area tool (Select, Rectangle, Freehand) while
  // Pan is armed asks the viewer to hand the pointer back to this tool.
  onRequestRegionTool = null,
  onRegionComplete,
  onCancel,
  currentSpaceId,
  currentPageId,
  scale = 1,
  pageWidth = 0,
  pageHeight = 0,
  // Owner 2026-10-26: Esc drops the edits; the toast's Undo saves them for
  // this space and page after all (the session has ended by then).
  onRestoreRegions = null,
  initialRegions = [],
  activeTool = null, // Active tool from parent (e.g., 'pan' when space is held)
  // KAL-301 follow-up: bridge the region-edit history into the app's top
  // toolbar. Called with { canUndo, canRedo, undo, redo } whenever the
  // region undo/redo stacks change, and with null on deactivate, so the
  // toolbar buttons can light up and drive region undo/redo while editing.
  onHistoryStateChange = null,
  // KAL-313: stamped on new regions at creation time so the region ownership
  // chain is available for delete-audit and the step-11 permission gate.
  userId = null,
  // KAL-313 (2026-06-11): onRegionsDeleted prop REMOVED — region trash
  // journaling now happens at commit time in PDFViewer.handleRegionComplete
  // (removedRegionIds diff), so Cancel can never produce phantom journal rows.
}) => {
  const tip = useTooltip();
  const [toolType, setToolType] = useState('rectangular'); // 'rectangular' | 'polygon' | 'freehand' (Lasso) | 'erase' | 'move'
  const [selectionMode, setSelectionMode] = useState(REGION_OPERATIONS.ADD); // 'add' | 'subtract'
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [polygonPoints, setPolygonPoints] = useState([]);
  // Polygon tool: the corners placed so far and the pointer (the rubber band).
  const [polyCorners, setPolyCorners] = useState([]);
  const [polyHover, setPolyHover] = useState(null);
  // The pointer is over a check mark (pointer cursor instead of crosshair).
  const [polyOnCheck, setPolyOnCheck] = useState(false);
  const polyCornersRef = useRef([]);
  polyCornersRef.current = polyCorners;
  // Add or Subtract is fixed by the first corner, so Shift (15° lock) or Alt
  // pressed while drawing does not flip what the closed shape does.
  const polyModeRef = useRef(null);
  const [regions, setRegions] = useState(() => []);
  const [selectedRegionIds, setSelectedRegionIds] = useState(() => new Set());
  const [interactionState, setInteractionState] = useState(null);
  const containerRef = useRef(null);
  const [targetElement, setTargetElement] = useState(null);
  const [isCursorOverCanvas, setIsCursorOverCanvas] = useState(false);
  const [canvasRect, setCanvasRect] = useState(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isOptionAltPressed, setIsOptionAltPressed] = useState(false);
  const [isCmdCtrlPressed, setIsCmdCtrlPressed] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [lastDrawingTool, setLastDrawingTool] = useState('rectangular');
  // KAL-301 REDO: live rotation angle during a rotate drag. Null when not
  // rotating. Degrees [0, 360), Fabric convention (0 = up) — the same value
  // the standard useSVGInteraction rotate branch produces. While set, the
  // selected region + its entire selection chrome render with a
  // rotate(angle, cx, cy) transform; coords are baked ONCE at mouse-up.
  const [liveRotationAngle, setLiveRotationAngle] = useState(null);
  // KAL-301 follow-up: rotation now PERSISTS on the region object as a
  // `rotation` field (degrees [0,360), Fabric convention 0 = up) — the same
  // model standard annotations use for their `angle`. Coords are still baked
  // at release (hit-testing, boolean ops, overlays and export keep consuming
  // plain polygons), but the chrome re-renders tilted from region.rotation,
  // so release / deselect / re-select all keep the tilted box. The pill's
  // absolute angle is read straight from the selected region's rotation.
  // KAL-301 REDO: hover-driven visibility for the standard RotationInputField
  // pill (150ms hover intent / 500ms grace — same machine as EDIT-12).
  const [rotPillVisible, setRotPillVisible] = useState(false);
  const rotPillHoverTimerRef = useRef(null);
  const rotPillGraceTimerRef = useRef(null);
  // Ref to the overlay's inline <svg> — RotationInputField self-positions by
  // querying [data-rotation-handle="mtr"] inside this svg.
  const overlaySvgRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, pageX, pageY, regionId, type, canMerge, canUnmerge }
  const canvasRectRef = useRef(null);
  const lastTargetDebugKeyRef = useRef(null);
  const lastCanvasRectDebugRef = useRef(null);
  const lastTargetQueryDebugRef = useRef(null);
  const regionsRef = useRef([]);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const documentDragFallbackRef = useRef(false);
  const activePointerIdRef = useRef(null);
  const pointerCaptureTargetRef = useRef(null);
  // Slice 1 (KAL-301a): tracks whether the current drag interaction actually
  // moved (i.e. coords changed). Undo snapshot is pushed at drag-END only when
  // this is true — one checkpoint per completed drag, not per pixel.
  const dragHasMovedRef = useRef(false);
  // Phone: where the current draw gesture started (client px) and how far the
  // finger has travelled, so a tap on an area can select it instead of drawing.
  const drawGestureRef = useRef(null);
  // Select tool: the drag box over empty page (page units + where it began
  // on screen, which sets window vs crossing).
  const [marquee, setMarquee] = useState(null);
  const marqueeRef = useRef(null);
  // Erase: the regions before the press (one undo step per stroke) and the
  // areas taken away so far.
  const eraseGestureRef = useRef(null);
  // What the session opened with, to tell whether leaving changes anything.
  const sessionStartSignatureRef = useRef('');
  // handleRegionPointerDown is declared below handleMouseDown; the phone
  // hit-test in handleMouseDown reaches it through this ref.
  const regionPointerDownRef = useRef(null);
  // Owner 2026-10-01: double-tap (phone) / double-click (desktop) an area to
  // put a bounding box with 8 handles around it that scales the whole area;
  // again (or tapping off it) goes back to the per-point handles.
  const [boxEditRegionId, setBoxEditRegionId] = useState(null);
  const lastRegionTapRef = useRef(null);
  // Space held = the viewer's hand-pan; read in the pointer handlers.
  const isSpacePressedRef = useRef(false);
  const historyKey = useMemo(
    () => getRegionEditHistoryKey(currentSpaceId, currentPageId),
    [currentSpaceId, currentPageId]
  );

  const captureInteractionPointer = useCallback((event) => {
    if (!Number.isFinite(event?.pointerId)) return true;
    if (
      activePointerIdRef.current !== null &&
      activePointerIdRef.current !== event.pointerId
    ) return false;

    activePointerIdRef.current = event.pointerId;
    const captureTarget = typeof event.currentTarget?.setPointerCapture === 'function'
      ? event.currentTarget
      : containerRef.current;
    pointerCaptureTargetRef.current = captureTarget || null;
    try { captureTarget?.setPointerCapture?.(event.pointerId); } catch { /* capture is best-effort */ }
    return true;
  }, []);

  const releaseInteractionPointer = useCallback((event) => {
    const activePointerId = activePointerIdRef.current;
    if (
      activePointerId !== null &&
      Number.isFinite(event?.pointerId) &&
      event.pointerId !== activePointerId
    ) return false;

    if (activePointerId !== null) {
      try { pointerCaptureTargetRef.current?.releasePointerCapture?.(activePointerId); } catch { /* already released */ }
    }
    activePointerIdRef.current = null;
    pointerCaptureTargetRef.current = null;
    return true;
  }, []);

  const resolvedPageWidth = useMemo(() => {
    if (Number.isFinite(pageWidth) && pageWidth > 0) {
      return pageWidth;
    }
    if (canvasRectRef.current?.width && Number.isFinite(scale) && scale > 0) {
      return canvasRectRef.current.width / scale;
    }
    return 1;
  }, [pageWidth, scale, canvasRect]);

  const resolvedPageHeight = useMemo(() => {
    if (Number.isFinite(pageHeight) && pageHeight > 0) {
      return pageHeight;
    }
    if (canvasRectRef.current?.height && Number.isFinite(scale) && scale > 0) {
      return canvasRectRef.current.height / scale;
    }
    return 1;
  }, [pageHeight, scale, canvasRect]);

  const displayScaleX = useMemo(() => {
    if (canvasRect?.width && resolvedPageWidth > 0) {
      return canvasRect.width / resolvedPageWidth;
    }
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }, [canvasRect, resolvedPageWidth, scale]);

  const displayScaleY = useMemo(() => {
    if (canvasRect?.height && resolvedPageHeight > 0) {
      return canvasRect.height / resolvedPageHeight;
    }
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }, [canvasRect, resolvedPageHeight, scale]);

  const pageToScreenX = useCallback((value) => value * displayScaleX, [displayScaleX]);
  const pageToScreenY = useCallback((value) => value * displayScaleY, [displayScaleY]);

  const getTargetRect = useCallback(() => {
    if (targetElement?.getBoundingClientRect) {
      return pagePresentationFrame(targetElement);
    }
    if (canvasRectRef.current) {
      const { left, top, width, height } = canvasRectRef.current;
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height
      };
    }
    return null;
  }, [targetElement]);

  const isPointWithinTargetRect = useCallback((clientX, clientY, rectOverride = null) => {
    const rect = rectOverride || getTargetRect();
    if (!rect) {
      return false;
    }

    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }, [getTargetRect]);

  // Screen px per page unit as the page is SEEN right now. The overlay lives
  // inside the page, so mid-pinch (a CSS scale on the page) the seen size and
  // the laid-out size differ; pointer maths must use the seen one.
  const getVisualScale = useCallback((rectOverride = null) => {
    const rect = rectOverride || getTargetRect();
    const sx = rect?.width > 0 && resolvedPageWidth > 0 ? rect.width / resolvedPageWidth : displayScaleX;
    const sy = rect?.height > 0 && resolvedPageHeight > 0 ? rect.height / resolvedPageHeight : displayScaleY;
    return { sx, sy };
  }, [getTargetRect, resolvedPageWidth, resolvedPageHeight, displayScaleX, displayScaleY]);

  const clientPointToPage = useCallback((clientX, clientY, rectOverride = null) => {
    const rect = rectOverride || getTargetRect();
    if (!rect) {
      return null;
    }
    return clientPointInPageFrame({ clientX, clientY }, rect, { width: resolvedPageWidth, height: resolvedPageHeight });
  }, [getTargetRect, resolvedPageWidth, resolvedPageHeight]);


  // Calculate effective tool type (override with Cmd/Ctrl for quick select)
  const effectiveToolType = useMemo(() => {
    // If drawing, don't switch modes to avoid interrupting the drag
    if (isDrawing) return toolType;

    if (polyCorners.length > 0) return toolType;
    if (isCmdCtrlPressed && DRAW_TOOL_TYPES.has(toolType)) {
      return 'move';
    }
    return toolType;
  }, [toolType, isCmdCtrlPressed, isDrawing, polyCorners.length]);

  // Owner 2026-10-26: with a shape tool armed a click still picks an area,
  // and the picked area keeps its grabbers (and moves when dragged), so it
  // can be changed without switching to Select first.
  const editsPicked = effectiveToolType === 'move' ||
    (DRAW_TOOL_TYPES.has(effectiveToolType) && !isDrawing && polyCorners.length === 0);

  // Calculate effective selection mode (override with modifier keys)
  const effectiveSelectionMode = useMemo(() => {
    // Shift forces additive mode
    if (isShiftPressed) {
      return REGION_OPERATIONS.ADD;
    }
    // Option/Alt forces subtractive mode
    if (isOptionAltPressed) {
      return REGION_OPERATIONS.SUBTRACT;
    }
    // Otherwise use dropdown selection
    return selectionMode;
  }, [isShiftPressed, isOptionAltPressed, selectionMode]);

  // What the shape being drawn will do: a polygon keeps the mode its first
  // corner took.
  const drawMode = (polyCorners.length > 0 && polyModeRef.current) || effectiveSelectionMode;

  useEffect(() => {
    regionsRef.current = Array.isArray(regions) ? regions : [];
  }, [regions]);

  const cloneRegionsForUndo = useCallback((sourceRegions) => (
    (Array.isArray(sourceRegions) ? sourceRegions : []).map(region => ({
      ...region,
      coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : [],
      sourceRegions: Array.isArray(region.sourceRegions)
        ? region.sourceRegions.map(sourceRegion => ({
            ...sourceRegion,
            coordinates: Array.isArray(sourceRegion.coordinates) ? [...sourceRegion.coordinates] : [],
            sourceRegions: Array.isArray(sourceRegion.sourceRegions)
              ? sourceRegion.sourceRegions.map(nestedSourceRegion => ({
                  ...nestedSourceRegion,
                  coordinates: Array.isArray(nestedSourceRegion.coordinates) ? [...nestedSourceRegion.coordinates] : []
                }))
              : undefined,
            originCenter: sourceRegion.originCenter ? { ...sourceRegion.originCenter } : undefined
          }))
        : undefined,
      originCenter: region.originCenter ? { ...region.originCenter } : undefined
    }))
  ), []);

  const createHistorySnapshot = useCallback(() => ({
    regions: cloneRegionsForUndo(regionsRef.current)
  }), [cloneRegionsForUndo]);

  const cloneHistorySnapshot = useCallback((snapshot) => ({
    regions: cloneRegionsForUndo(snapshot?.regions)
  }), [cloneRegionsForUndo]);

  // KAL-301 follow-up: history bridge to the app's top toolbar.
  // - onHistoryStateChangeRef: latest callback without re-subscribing effects.
  // - latestUndoRedoRef: latest undo/redo implementations (their useCallback
  //   identity changes with historyKey), read at click time by two STABLE
  //   wrappers so the published API object only changes when the canUndo /
  //   canRedo booleans actually flip — respecting the chrome-publish
  //   identity-churn rule (CLAUDE.md 2026-05-13 gotcha).
  const onHistoryStateChangeRef = useRef(onHistoryStateChange);
  onHistoryStateChangeRef.current = onHistoryStateChange;
  const latestUndoRedoRef = useRef({ undo: null, redo: null });
  const stableBridgeUndo = useCallback(() => latestUndoRedoRef.current.undo?.(), []);
  const stableBridgeRedo = useCallback(() => latestUndoRedoRef.current.redo?.(), []);
  const notifyHistoryState = useCallback(() => {
    onHistoryStateChangeRef.current?.({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
      undo: stableBridgeUndo,
      redo: stableBridgeRedo
    });
  }, [stableBridgeUndo, stableBridgeRedo]);

  const persistHistoryStacks = useCallback(() => {
    regionEditHistoryStore.set(historyKey, {
      undo: undoStackRef.current.map(cloneHistorySnapshot),
      redo: redoStackRef.current.map(cloneHistorySnapshot)
    });
    // Every stack mutation funnels through here (push, undo, redo, drag-end
    // direct push, session restore) — the single choke point for the bridge.
    notifyHistoryState();
  }, [cloneHistorySnapshot, historyKey, notifyHistoryState]);

  const pushUndoSnapshot = useCallback(() => {
    undoStackRef.current.push(createHistorySnapshot());
    redoStackRef.current = [];
    if (undoStackRef.current.length > REGION_HISTORY_LIMIT) {
      undoStackRef.current.shift();
    }
    persistHistoryStacks();
  }, [createHistorySnapshot, persistHistoryStacks]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) return false;
    setRegions(cloneRegionsForUndo(snapshot.regions));
    setSelectedRegionIds(new Set());
    setInteractionState(null);
    setIsDrawing(false);
    setCurrentRect(null);
    setPolygonPoints([]);
    setContextMenu(null);
    return true;
  }, [cloneRegionsForUndo]);

  const undoLastRegionEdit = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) return false;
    redoStackRef.current.push(createHistorySnapshot());
    if (redoStackRef.current.length > REGION_HISTORY_LIMIT) {
      redoStackRef.current.shift();
    }
    persistHistoryStacks();
    return restoreHistorySnapshot(snapshot);
  }, [createHistorySnapshot, persistHistoryStacks, restoreHistorySnapshot]);

  const redoLastRegionEdit = useCallback(() => {
    const snapshot = redoStackRef.current.pop();
    if (!snapshot) return false;
    undoStackRef.current.push(createHistorySnapshot());
    if (undoStackRef.current.length > REGION_HISTORY_LIMIT) {
      undoStackRef.current.shift();
    }
    persistHistoryStacks();
    return restoreHistorySnapshot(snapshot);
  }, [createHistorySnapshot, persistHistoryStacks, restoreHistorySnapshot]);

  // KAL-301 follow-up: keep the bridge's click targets pointing at the latest
  // undo/redo implementations, and clear the published API on deactivate /
  // unmount so the toolbar falls back to the main annotation history.
  useEffect(() => {
    latestUndoRedoRef.current = { undo: undoLastRegionEdit, redo: redoLastRegionEdit };
  }, [undoLastRegionEdit, redoLastRegionEdit]);
  useEffect(() => {
    if (!active) {
      onHistoryStateChangeRef.current?.(null);
      return undefined;
    }
    return () => { onHistoryStateChangeRef.current?.(null); };
  }, [active]);

  useEffect(() => {
    if (!active) {
      setTargetElement(null);
      return;
    }

    let frameId = null;

    const updateTarget = () => {
      const selector = currentPageId
        ? `[data-region-selection-target="${String(currentPageId)}"]`
        : '[data-region-selection-target]';
      const candidates = Array.from(document.querySelectorAll(selector))
        .filter((node) => node instanceof HTMLElement && node.isConnected && !isInTabBehind(node));
      const nextTarget = candidates.reduce((best, node) => {
        const r = node.getBoundingClientRect();
        const area = r.width * r.height;
        if (!best || area > best.area) return { node, area };
        return best;
      }, null)?.node || document.getElementById('region-selection-target');
      if (!nextTarget) {
        const queryDebugKey = `${selector}:0:${activeTool ?? 'none'}`;
        if (lastTargetQueryDebugRef.current !== queryDebugKey) {
          lastTargetQueryDebugRef.current = queryDebugKey;
          regionDebug(
            `[RegionSelectionTool p${currentPageId ?? 'unknown'}] target query miss — ` +
            `selector=${selector}, candidates=0, tool=${activeTool ?? 'none'}`
          );
        }
      } else {
        const renderer = nextTarget.dataset?.regionSelectionRenderer || 'unspecified';
        const queryDebugKey = `${selector}:${renderer}`;
        if (lastTargetQueryDebugRef.current !== queryDebugKey) {
          lastTargetQueryDebugRef.current = queryDebugKey;
          regionDebug(
            `[RegionSelectionTool p${currentPageId ?? 'unknown'}] target query hit — ` +
            `selector=${selector}, renderer=${renderer}`
          );
        }
      }
      setTargetElement((prevTarget) => (prevTarget === nextTarget ? prevTarget : nextTarget));
      frameId = window.requestAnimationFrame(updateTarget);
    };

    updateTarget();

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [active, currentPageId, activeTool]);

  useEffect(() => {
    if (!active) {
      lastTargetDebugKeyRef.current = null;
      return;
    }

    const targetRect = targetElement?.getBoundingClientRect?.() || null;
    const nextKey = targetRect
      ? `${Math.round(targetRect.left)}:${Math.round(targetRect.top)}:${Math.round(targetRect.width)}:${Math.round(targetRect.height)}`
      : 'missing';

    if (lastTargetDebugKeyRef.current === nextKey) {
      return;
    }

    lastTargetDebugKeyRef.current = nextKey;
    regionDebug(
      `[RegionSelectionTool p${currentPageId ?? 'unknown'}] target ${targetRect ? 'mounted' : 'missing'} — ` +
      `space=${currentSpaceId ?? 'none'}, tool=${activeTool ?? 'none'}, ` +
      `rect=${targetRect ? `${Math.round(targetRect.left)},${Math.round(targetRect.top)},${Math.round(targetRect.width)}x${Math.round(targetRect.height)}` : 'none'}`
    );
  }, [active, targetElement, currentPageId, currentSpaceId, activeTool]);

  // Layout effect: the first measurement of a (new) page lands before paint.
  useLayoutEffect(() => {
    if (!active || !targetElement) {
      setCanvasRect(null);
      canvasRectRef.current = null;
      return;
    }

    // Owner 2026-10-01: "the region doesn't lock on the page, it lags behind
    // the pan". The overlay used to be a fixed layer outside the page, moved
    // to the page's screen position from a scroll listener / animation frame
    // AFTER the browser had already drawn the page in its new place, so it
    // trailed every scroll, pan and pinch by a frame or more. It now lives
    // INSIDE the page (createPortal into the target, below), so the browser
    // moves and scales it with the page in the same frame. Only the page's
    // laid-out size is measured here (container-aware sizing: offsetWidth,
    // which a mid-pinch CSS scale does not change).
    const rectsMatch = (left, right) => (
      !!left &&
      !!right &&
      Math.abs(left.width - right.width) < 0.25 &&
      Math.abs(left.height - right.height) < 0.25
    );

    const measureRect = (sync = false) => {
      let width = targetElement.offsetWidth;
      let height = targetElement.offsetHeight;
      if (!(width > 0 && height > 0)) {
        const rect = pagePresentationFrame(targetElement);
        width = rect.width;
        height = rect.height;
      }
      const nextRect = { left: 0, top: 0, width, height };

      if (!rectsMatch(canvasRectRef.current, nextRect)) {
        canvasRectRef.current = nextRect;
        // From the ResizeObserver (after layout, before paint): redraw the
        // areas at the page's new size in THIS frame, so a zoom step never
        // shows one frame of areas at the old size.
        if (sync === true) flushSync(() => setCanvasRect(nextRect));
        else setCanvasRect(nextRect);
        const debugKey = `${Math.round(nextRect.width)}:${Math.round(nextRect.height)}`;
        if (lastCanvasRectDebugRef.current !== debugKey) {
          lastCanvasRectDebugRef.current = debugKey;
          regionDebug(
            `[RegionSelectionTool p${currentPageId ?? 'unknown'}] canvasRect — ` +
            `width=${Math.round(nextRect.width)}, height=${Math.round(nextRect.height)}, ` +
            `scale=${Number.isFinite(scale) ? scale.toFixed(5) : scale}`
          );
        }
      }
    };

    measureRect();

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => measureRect(true));
      resizeObserver.observe(targetElement);
    }
    const onWindowResize = () => measureRect();
    window.addEventListener('resize', onWindowResize, { passive: true });

    return () => {
      // The size is kept: a re-measure (or the branch above, when editing
      // ends) replaces it, so the areas never blink out for a frame.
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', onWindowResize);
    };
  }, [active, targetElement, currentPageId]);

  // No wheel listener needed - allow all wheel events to pass through to underlying canvas
  // The App.jsx document-level listener will handle zoom/scroll

  // Track if we've initialized regions from initialRegions to avoid overwriting user-drawn regions
  const hasInitializedRegionsRef = useRef(false);
  const activeHistoryKeyRef = useRef(historyKey);

  useEffect(() => {
    if (!active) return undefined;
    window.__regionSelectionActive = true;
    return () => {
      window.__regionSelectionActive = false;
    };
  }, [active]);

  useEffect(() => {
    if (activeHistoryKeyRef.current !== historyKey) {
      hasInitializedRegionsRef.current = false;
      activeHistoryKeyRef.current = historyKey;
    }

    if (active) {
      // Only initialize from initialRegions on first activation, not on every initialRegions change
      // This prevents overwriting user-drawn regions when activeTool changes
      if (!hasInitializedRegionsRef.current) {
        // Deep clone regions preserving all metadata including sourceRegions and originCenter
        const clonedRegions = (initialRegions || []).map(region => ({
          ...region,
          coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : [],
          // Preserve sourceRegions for unmerge capability
          sourceRegions: Array.isArray(region.sourceRegions)
            ? region.sourceRegions.map(sourceRegion => ({
                ...sourceRegion,
                coordinates: Array.isArray(sourceRegion.coordinates) ? [...sourceRegion.coordinates] : []
              }))
            : undefined,
          // Preserve originCenter for unmerge offset calculation
          originCenter: region.originCenter ? { ...region.originCenter } : undefined
        }));
        dismissToast(AREA_DROPPED_TOAST_ID);
        setRegions(clonedRegions);
        sessionStartSignatureRef.current = regionsSignature(clonedRegions);
        const storedHistory = regionEditHistoryStore.get(historyKey);
        undoStackRef.current = Array.isArray(storedHistory?.undo)
          ? storedHistory.undo.map(cloneHistorySnapshot)
          : [];
        redoStackRef.current = Array.isArray(storedHistory?.redo)
          ? storedHistory.redo.map(cloneHistorySnapshot)
          : [];
        hasInitializedRegionsRef.current = true;
        // Clear selection and interaction state on session start / page switch.
        // Do NOT clear here on mid-session re-runs (when hasInitializedRegionsRef was already
        // true) — that would silently deselect regions during background Yjs syncs (KAL-300).
        setSelectedRegionIds(new Set());
        setInteractionState(null);
        setIsDrawing(false);
        setCurrentRect(null);
        setPolygonPoints([]);
        setPolyCorners([]);
        setPolyHover(null);
        setIsCursorOverCanvas(false);
      }
    } else {
      releaseInteractionPointer();
      persistHistoryStacks();
      setRegions([]);
      hasInitializedRegionsRef.current = false;
      // Clear selection and interaction state when the region-edit session ends
      // (cancel or deactivate). This is the only correct moment to wipe selection
      // — NOT during mid-session re-renders caused by background spaces updates.
      setSelectedRegionIds(new Set());
      setInteractionState(null);
      setIsDrawing(false);
      setCurrentRect(null);
      setPolygonPoints([]);
      setPolyCorners([]);
      setPolyHover(null);
      setIsCursorOverCanvas(false);
    }
  }, [active, initialRegions, historyKey, cloneHistorySnapshot, persistHistoryStacks, releaseInteractionPointer]);

  useEffect(() => {
    setPolygonPoints([]);
    setCurrentRect(null);
    setIsDrawing(false);
    setInteractionState(null);
    setIsCursorOverCanvas(false);
    if (toolType !== 'move') {
      setSelectedRegionIds(new Set());
      setBoxEditRegionId(null);
    }
  }, [toolType]);

  // The bounding box belongs to one selected area: selecting something else,
  // tapping off, or the area going away puts the point handles back.
  useEffect(() => {
    if (boxEditRegionId && !selectedRegionIds.has(boxEditRegionId)) {
      setBoxEditRegionId(null);
    }
  }, [boxEditRegionId, selectedRegionIds]);

  // Double-tap / double-click bookkeeping: a tap (no drag) on an area.
  // Returns true when this tap completed a double-tap and toggled the box.
  const registerRegionTap = useCallback((regionId, clientX, clientY) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = lastRegionTapRef.current;
    if (
      last &&
      last.regionId === regionId &&
      now - last.time <= DOUBLE_TAP_MS &&
      Math.hypot(clientX - last.x, clientY - last.y) <= DOUBLE_TAP_SLOP_PX
    ) {
      lastRegionTapRef.current = null;
      setBoxEditRegionId((prev) => (prev === regionId ? null : regionId));
      return true;
    }
    lastRegionTapRef.current = { regionId, time: now, x: clientX, y: clientY };
    return false;
  }, []);

  useEffect(() => {
    if (regions.length === 0) {
      setSelectedRegionIds(new Set());
      setInteractionState(null);
    }
  }, [regions.length]);

  // Owner 2026-10-22: the first area is picked only on the switch INTO
  // Select. After a Delete nothing is picked again by itself, so a second
  // Delete press never removes an area the user did not pick.
  const prevToolTypeRef = useRef(toolType);
  useEffect(() => {
    const enteredMove = prevToolTypeRef.current !== 'move' && toolType === 'move';
    prevToolTypeRef.current = toolType;
    if (toolType !== 'move') {
      return;
    }

    setSelectedRegionIds(prevIds => {
      const validIds = new Set([...prevIds].filter(id => regions.some(r => r.regionId === id)));
      if (validIds.size > 0) return validIds.size === prevIds.size ? prevIds : validIds;
      if (!enteredMove) return prevIds.size === 0 ? prevIds : new Set();
      // Switching to Select with nothing picked: pick the first area.
      return regions.length > 0 ? new Set([regions[0].regionId]) : new Set();
    });
  }, [toolType, regions]);



  const getRegionBounds = useCallback((region) => {
    if (!region || !Array.isArray(region.coordinates) || region.coordinates.length < 4) {
      return null;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < region.coordinates.length; i += 2) {
      const x = region.coordinates[i];
      const y = region.coordinates[i + 1];
      if (typeof x !== 'number' || typeof y !== 'number') {
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }, []);

  // Phone: the area under a finger (page units). A selected area answers for
  // its whole box (the dashed box is what the user sees as "the selection");
  // any other area answers inside its outline, topmost first.
  const findRegionAtPagePoint = useCallback((x, y, selectedIds = null) => {
    const list = regionsRef.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const region = list[i];
      if (!selectedIds?.has(region.regionId)) continue;
      const b = getRegionBounds(region);
      if (b && x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return region;
    }
    // A smoothed Lasso area answers inside its drawn curve, not the straight
    // lines between its control points.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (isPointInFlatPolygon(x, y, withRegionOutlineCoordinates(list[i]).coordinates)) return list[i];
    }
    return null;
  }, [getRegionBounds]);

  // Erase: take away every area the stroke passes over, from the last point
  // to this one in small steps so a quick sweep cannot jump a thin area.
  const eraseAreaAt = useCallback((x, y) => {
    const gesture = eraseGestureRef.current;
    if (!gesture) return;
    const from = gesture.last || { x, y };
    gesture.last = { x, y };
    const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / 4));
    // Test each area's drawn outline (smoothed Lasso curves flattened), worked
    // out once per area for the whole stroke.
    const outlines = gesture.outlines || (gesture.outlines = new Map());
    const hits = [];
    for (let step = 1; step <= steps; step += 1) {
      const px = from.x + ((x - from.x) * step) / steps;
      const py = from.y + ((y - from.y) * step) / steps;
      for (const region of regionsRef.current) {
        if (gesture.erased.has(region.regionId)) continue;
        let outline = outlines.get(region);
        if (!outline) {
          outline = withRegionOutlineCoordinates(region).coordinates;
          outlines.set(region, outline);
        }
        if (!isPointInFlatPolygon(px, py, outline)) continue;
        gesture.erased.add(region.regionId);
        hits.push(region.regionId);
      }
    }
    if (!hits.length) return;
    setRegions((prev) => prev.filter((region) => !gesture.erased.has(region.regionId)));
    setSelectedRegionIds((prev) => (hits.some((id) => prev.has(id))
      ? new Set([...prev].filter((id) => !gesture.erased.has(id)))
      : prev));
  }, []);
  const eraseAreaAtRef = useRef(null);
  eraseAreaAtRef.current = eraseAreaAt;

  const ensureBoundsMinSize = useCallback((bounds) => {
    if (!bounds) return null;
    const width = bounds.maxX - bounds.minX;
    if (width < MIN_REGION_SIZE) {
      const midX = (bounds.maxX + bounds.minX) / 2;
      bounds.minX = midX - MIN_REGION_SIZE / 2;
      bounds.maxX = midX + MIN_REGION_SIZE / 2;
    }
    const height = bounds.maxY - bounds.minY;
    if (height < MIN_REGION_SIZE) {
      const midY = (bounds.maxY + bounds.minY) / 2;
      bounds.minY = midY - MIN_REGION_SIZE / 2;
      bounds.maxY = midY + MIN_REGION_SIZE / 2;
    }
    return bounds;
  }, []);

  // ---------------------------------------------------------------------
  // KAL-301 REDO: standard rotation-pill visibility machine + rotation bake.
  // Copied behaviorally from SVGAnnotationLayer's EDIT-12 machine: 150ms
  // hover-intent on the mtr handle shows the pill, 500ms grace after leaving
  // hides it (unless the input holds focus), an active rotate drag forces it
  // visible ("drag wins").
  // ---------------------------------------------------------------------
  const clearRotPillTimers = useCallback(() => {
    if (rotPillHoverTimerRef.current) {
      clearTimeout(rotPillHoverTimerRef.current);
      rotPillHoverTimerRef.current = null;
    }
    if (rotPillGraceTimerRef.current) {
      clearTimeout(rotPillGraceTimerRef.current);
      rotPillGraceTimerRef.current = null;
    }
  }, []);

  const handleRotHandleHoverEnter = useCallback(() => {
    if (rotPillGraceTimerRef.current) {
      clearTimeout(rotPillGraceTimerRef.current);
      rotPillGraceTimerRef.current = null;
    }
    if (rotPillHoverTimerRef.current) return;
    rotPillHoverTimerRef.current = setTimeout(() => {
      rotPillHoverTimerRef.current = null;
      setRotPillVisible(true);
    }, ROT_PILL_HOVER_INTENT_MS);
  }, []);

  const handleRotHandleHoverLeave = useCallback(() => {
    if (rotPillHoverTimerRef.current) {
      clearTimeout(rotPillHoverTimerRef.current);
      rotPillHoverTimerRef.current = null;
    }
    if (rotPillGraceTimerRef.current) clearTimeout(rotPillGraceTimerRef.current);
    rotPillGraceTimerRef.current = setTimeout(() => {
      rotPillGraceTimerRef.current = null;
      // Standard rule: never hide while the pill input holds focus.
      const ae = document.activeElement;
      const focusedInPill = !!(ae && ae.closest && ae.closest('[data-rotation-input-field]'));
      if (!focusedInPill) setRotPillVisible(false);
    }, ROT_PILL_GRACE_MS);
  }, []);

  // RotationInputField reports hover on the pill itself through onHoverChange
  // so the user can travel from the handle into the input without it closing.
  const handleRotationPillHover = useCallback((hovered) => {
    if (hovered) {
      if (rotPillGraceTimerRef.current) {
        clearTimeout(rotPillGraceTimerRef.current);
        rotPillGraceTimerRef.current = null;
      }
      setRotPillVisible(true);
    } else {
      handleRotHandleHoverLeave();
    }
  }, [handleRotHandleHoverLeave]);

  const handleRotationPillCancel = useCallback(() => {
    handleRotHandleHoverLeave();
  }, [handleRotHandleHoverLeave]);

  // Bake a rotation delta (degrees) into a region's coordinates around its
  // bbox center, with an undo checkpoint. Coords are baked so hit-testing,
  // boolean ops, overlays and export keep consuming plain polygons — and the
  // accumulated display angle PERSISTS on region.rotation (KAL-301 follow-up)
  // so the selection chrome stays tilted after release, exactly like a
  // standard annotation persisting obj.angle.
  const bakeRegionRotation = useCallback((regionId, deltaDeg) => {
    const norm = normalizeRegionRotation(deltaDeg);
    if (norm === 0) return false;
    const region = regionsRef.current.find(r => r.regionId === regionId);
    if (!region) return false;
    const bounds = getRegionBounds(region);
    if (!bounds) return false;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    pushUndoSnapshot();
    const rotated = rotateCoordsAroundPoint(region.coordinates, cx, cy, norm);
    const newRotation = normalizeRegionRotation(getRegionRotation(region) + norm);
    setRegions(prev => prev.map(r => (
      r.regionId === regionId
        ? {
            ...r,
            // A rectangle rotated off-axis is no longer axis-aligned; the
            // resize path rebuilds 'rectangular' coords from bounds, which
            // would silently un-rotate it. 90° multiples stay rectangular.
            shapeType: newRotation % 90 === 0 ? r.shapeType : 'polygon',
            rotation: newRotation,
            coordinates: rotated
          }
        : r
    )));
    return true;
  }, [getRegionBounds, pushUndoSnapshot]);

  // Standard pill commit semantics (absolute angle): the typed value is the
  // region's absolute persisted angle; apply the delta from region.rotation.
  const handleRotationPillCommit = useCallback((regionId, newAngle) => {
    const region = regionsRef.current.find(r => r.regionId === regionId);
    if (!region) return;
    const target = normalizeRegionRotation(Number(newAngle));
    bakeRegionRotation(regionId, target - getRegionRotation(region));
  }, [bakeRegionRotation]);

  // Selection change closes the pill (the angle itself now lives on the
  // region object, so there is no per-selection session state to reset).
  useEffect(() => {
    clearRotPillTimers();
    setRotPillVisible(false);
  }, [selectedRegionIds, clearRotPillTimers]);

  // Cleanup timers on unmount / deactivate.
  useEffect(() => () => clearRotPillTimers(), [clearRotPillTimers]);

  const resizeHandles = useMemo(() => ([
    { key: 'nw', offsetX: 0, offsetY: 0 },
    { key: 'n', offsetX: 0.5, offsetY: 0 },
    { key: 'ne', offsetX: 1, offsetY: 0 },
    { key: 'e', offsetX: 1, offsetY: 0.5 },
    { key: 'se', offsetX: 1, offsetY: 1 },
    { key: 's', offsetX: 0.5, offsetY: 1 },
    { key: 'sw', offsetX: 0, offsetY: 1 },
    { key: 'w', offsetX: 0, offsetY: 0.5 }
  ]), []);

  // Outline path in overlay px. Curved (freehand) points draw as a smooth
  // curve through the kept points; regions saved before smooth flags existed
  // draw straight, exactly as before.
  const buildRegionPath = useCallback((region) => {
    if (!region || !Array.isArray(region.coordinates)) {
      return null;
    }
    return buildRegionOutlinePathD(region.coordinates, getRegionSmoothFlags(region), displayScaleX, displayScaleY);
  }, [displayScaleX, displayScaleY]);

  // Page units per OUTLINE_THIN_TOLERANCE_PX at the current zoom.
  const getThinTolerance = useCallback(() => {
    const { sx, sy } = getVisualScale();
    const s = Math.max(Math.min(sx, sy), 1e-6);
    return OUTLINE_THIN_TOLERANCE_PX / s;
  }, [getVisualScale]);

  // A boolean result ring (flat coords) from inputs that may carry smooth
  // points -> thinned coords + flags. Straight-only inputs: coords unchanged
  // apart from the old collinear clean-up.
  const thinBooleanCoords = useCallback((coords, inputs) => {
    const lookup = buildSmoothVertexLookup(inputs);
    const hasSmooth = [...lookup.values()].some(Boolean);
    if (!hasSmooth) return { coordinates: simplifyPolygon(coords, 1.0), smoothVertices: undefined };
    return thinBooleanResultRing(coords, lookup, getThinTolerance());
  }, [getThinTolerance]);

  const polygonPreviewPath = useMemo(() => {
    if (toolType !== 'freehand' || polygonPoints.length < 2) {
      return null;
    }

    const scaledPoints = polygonPoints.map(point => ({
      x: pageToScreenX(point.x),
      y: pageToScreenY(point.y)
    }));

    let path = `M ${scaledPoints[0].x} ${scaledPoints[0].y}`;
    for (let i = 1; i < scaledPoints.length; i += 1) {
      path += ` L ${scaledPoints[i].x} ${scaledPoints[i].y}`;
    }

    if (scaledPoints.length > 2) {
      path += ' Z';
    }

    return path;
  }, [pageToScreenX, pageToScreenY, polygonPoints, toolType]);



  // Helper to convert polygon back to path string
  const polygonToPath = useCallback((polygon) => {
    if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return '';

    const rings = polygon;
    let path = '';

    rings.forEach(ring => {
      if (!Array.isArray(ring) || ring.length < 2) return;

      path += `M ${pageToScreenX(ring[0][0])} ${pageToScreenY(ring[0][1])}`;
      for (let i = 1; i < ring.length; i++) {
        path += ` L ${pageToScreenX(ring[i][0])} ${pageToScreenY(ring[i][1])}`;
      }
      path += ' Z ';
    });

    return path;
  }, [pageToScreenX, pageToScreenY]);

  const checkRegionsOverlap = useCallback((region1, region2) => {
    if (!region1 || !region2 || !Array.isArray(region1.coordinates) || !Array.isArray(region2.coordinates)) {
      return false;
    }

    const bounds1 = getRegionBounds(region1);
    const bounds2 = getRegionBounds(region2);

    if (!bounds1 || !bounds2) {
      return false;
    }

    // Quick bounding box check first
    const bboxOverlap = !(bounds1.maxX < bounds2.minX || bounds2.maxX < bounds1.minX ||
      bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);

    if (!bboxOverlap) {
      return false;
    }

    // If bounding boxes overlap, perform precise polygon intersection check
    const poly1 = regionToPolygon(region1);
    const poly2 = regionToPolygon(region2);

    if (!poly1 || !poly2) {
      // Fallback to bbox overlap if polygon conversion fails
      return true;
    }

    try {
      const intersectionResult = intersection(poly1, poly2);
      return intersectionResult && intersectionResult.length > 0;
    } catch (error) {
      console.error('Error checking intersection:', error);
      // Fallback to bbox overlap on error
      return true;
    }
  }, [getRegionBounds]);

  const cloneRegionForHistory = useCallback((region) => ({
    ...region,
    coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : [],
    sourceRegions: Array.isArray(region.sourceRegions)
      ? region.sourceRegions.map(sourceRegion => ({
          ...sourceRegion,
          coordinates: Array.isArray(sourceRegion.coordinates) ? [...sourceRegion.coordinates] : []
        }))
      : undefined,
    originCenter: region.originCenter ? { ...region.originCenter } : undefined
  }), []);

  const canMergeRegions = useCallback((regionsToMerge) => {
    if (!Array.isArray(regionsToMerge) || regionsToMerge.length < 2) {
      return false;
    }

    try {
      let currentUnion = regionToPolygon(regionsToMerge[0]);
      if (!currentUnion) return false;

      for (let i = 1; i < regionsToMerge.length; i += 1) {
        const nextPoly = regionToPolygon(regionsToMerge[i]);
        if (!nextPoly) return false;

        const result = union(currentUnion, nextPoly);
        if (!result || result.length === 0 || result.length > 1) {
          return false;
        }
        currentUnion = result;
      }

      // A union that closes round a hole cannot be one area (an area has no
      // holes), so pieces split round a Subtract hole stay apart.
      return currentUnion.length === 1 && currentUnion[0].length === 1;
    } catch (error) {
      console.error('Error checking merge capability', error);
      return false;
    }
  }, []);

  const getConnectedMergeCandidates = useCallback((seedRegion) => {
    if (!seedRegion) return [];

    const candidates = [seedRegion];
    const candidateIds = new Set([seedRegion.regionId]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const region of regions) {
        if (!region || candidateIds.has(region.regionId)) continue;
        if (canMergeRegions([...candidates, region])) {
          candidates.push(region);
          candidateIds.add(region.regionId);
          changed = true;
        }
      }
    }

    return candidates;
  }, [regions, canMergeRegions]);

  // Merge overlapping additive regions with a new region
  const mergeRegionWithOverlapping = useCallback((newRegion, existingRegions) => {
    if (!newRegion || !Array.isArray(existingRegions) || existingRegions.length === 0) {
      return [newRegion];
    }

    const newPoly = regionToPolygon(newRegion);
    if (!newPoly) {
      return [...existingRegions, newRegion];
    }

    // Find all overlapping regions
    const overlappingRegions = [];
    const nonOverlappingRegions = [];

    for (const region of existingRegions) {
      if (checkRegionsOverlap(newRegion, region)) {
        overlappingRegions.push(region);
      } else {
        nonOverlappingRegions.push(region);
      }
    }

    // If no overlaps, just add the new region
    if (overlappingRegions.length === 0) {
      return [...existingRegions, newRegion];
    }

    // Collect all polygons to merge (new region + all overlapping regions)
    const polygonsToMerge = [newPoly];
    for (const region of overlappingRegions) {
      const regionPoly = regionToPolygon(region);
      if (regionPoly) {
        polygonsToMerge.push(regionPoly);
      }
    }

    // Merge all polygons together iteratively
    try {
      let mergedPoly = polygonsToMerge[0];

      for (let i = 1; i < polygonsToMerge.length; i++) {
        const unionResult = union(mergedPoly, polygonsToMerge[i]);

        if (unionResult && unionResult.length > 0) {
          // If the result contains more than one polygon, it means they didn't merge into a single shape
          // (e.g. they are disjoint or just touching at a point/line).
          // In this case, we should NOT merge them.
          if (unionResult.length > 1) {
            // Treat as non-overlapping: keep original regions and add new one separately
            // Since we are iterating, this is tricky. The best approach if ANY merge fails 
            // is to assume the new region is disjoint from the group it was trying to merge with.
            // However, we already identified them as "overlapping" via checkRegionsOverlap.
            // If precise intersection says they overlap, union SHOULD return 1 polygon.
            // If union returns > 1, it implies they might be touching or disjoint in a way that
            // martinez considers separate.

            // For the L-polygon case: if we draw in the notch, checkRegionsOverlap (precise) should return FALSE.
            // So we shouldn't even be here for the notch case!
            // But if we ARE here, and union returns > 1, let's be safe and abort the merge for this specific pair.
            // But wait, we are accumulating `mergedPoly`.

            // If we get here, it means checkRegionsOverlap said YES.
            // If union says > 1, it's an edge case.
            // Let's fallback to "don't merge this specific polygon" or abort the whole merge?
            // Aborting the whole merge is safer to prevent data loss.
            return [...existingRegions, newRegion];
          }

          // Take the first (largest) polygon from the result
          mergedPoly = unionResult[0];
        } else {
          // If union fails, break and use what we have
          break;
        }
      }

      // Convert merged polygon back to region coordinates
      let mergedCoords = polygonToRegionCoords(mergedPoly);

      if (mergedCoords && mergedCoords.length >= 6) {
        // Simplify the polygon to remove redundant vertices (e.g. collinear points from merging rectangles)
        // This ensures simple shapes (like L-polygons) stay under the vertex threshold for handles.
        // Use a small tolerance (1.0) to clean up without distorting.
        mergedCoords = simplifyPolygon(mergedCoords, 1.0);

        const mergedRegion = {
          ...newRegion,
          regionId: crypto.randomUUID(),
          shapeType: 'polygon', // Union result is typically a polygon
          coordinates: mergedCoords
        };

        // Return merged region plus non-overlapping regions
        return [...nonOverlappingRegions, mergedRegion];
      }
    } catch (error) {
      console.error('Error merging regions:', error);
    }

    // If merge fails, just add the new region (fallback)
    return [...existingRegions, newRegion];
  }, [regionToPolygon, polygonToRegionCoords, checkRegionsOverlap]);

  // Subtract a region from all existing regions
  const subtractRegionFromRegions = useCallback((subtractRegion, existingRegions) => {
    if (!subtractRegion || !Array.isArray(existingRegions) || existingRegions.length === 0) {
      return existingRegions;
    }

    const subtractPoly = regionToPolygon(subtractRegion);
    if (!subtractPoly) {
      return existingRegions;
    }

    const resultRegions = [];

    for (const region of existingRegions) {
      const subjectPoly = regionToPolygon(region);
      if (!subjectPoly) {
        resultRegions.push(region);
        continue;
      }

      try {
        // Perform difference operation (subject - subtract)
        const diffResult = diff(subjectPoly, subtractPoly);

        if (!diffResult || diffResult.length === 0) {
          // Region was completely subtracted, skip it
          continue;
        }

        // Convert each resulting polygon back to a region
        for (const polygon of diffResult) {
          const coords = polygonToRegionCoords(polygon);
          if (coords && coords.length >= 6) {
            const isRectangular = region.shapeType === 'rectangular' && polygon.length === 5;
            resultRegions.push({
              ...region,
              regionId: crypto.randomUUID(),
              shapeType: isRectangular ? 'rectangular' : 'polygon',
              coordinates: simplifyPolygon(coords, 1.0)
            });
          }
        }
      } catch (error) {
        console.error('Error subtracting region:', error);
        // If subtraction fails, keep the original region
        resultRegions.push(region);
      }
    }

    return resultRegions;
  }, []);

  // Close the polygon into an area: Add or Subtract exactly as a Lasso does.
  const commitPolygonRef = useRef(null);
  const dropPolygon = useCallback(() => {
    polyModeRef.current = null;
    setPolyCorners([]);
    setPolyHover(null);
    setPolyOnCheck(false);
  }, []);
  commitPolygonRef.current = (corners) => {
    const mode = polyModeRef.current || effectiveSelectionMode;
    dropPolygon();
    if (!Array.isArray(corners) || corners.length < REGION_POLYGON_MIN_CORNERS) return;
    pushUndoSnapshot();
    const thinTolerance = getThinTolerance();
    const newRegion = {
      regionId: crypto.randomUUID(),
      pageId: currentPageId,
      shapeType: 'polygon',
      operation: mode,
      coordinates: corners.flatMap((point) => [point.x, point.y]),
      ...(userId ? { createdBy: userId } : {}),
    };
    if (mode === REGION_OPERATIONS.ADD) {
      setRegions((prev) => [...prev, newRegion]);
    } else {
      setRegions((prev) => prev.flatMap((existingRegion) => subtractRegionFromRegion(existingRegion, newRegion, { thinTolerance }) || []));
    }
  };

  const handleMouseDown = useCallback((event) => {
    if (!active || !targetElement) {
      regionDebug(
        `[RegionSelectionTool p${currentPageId ?? 'unknown'}] mouseDown ignored — ` +
        `active=${active}, target=${!!targetElement}, tool=${activeTool ?? 'none'}`
      );
      return;
    }

    if (event.button === 2) {
      return;
    }

    // Allow pan to work: if pan tool is active (space is held), don't handle the event
    // This allows the event to bubble to the container's pan handler
    if (activeTool === 'pan' || isSpacePressedRef.current) {
      regionDebug(
        `[RegionSelectionTool p${currentPageId ?? 'unknown'}] mouseDown passed through for pan — ` +
        `client=${Math.round(event.clientX)},${Math.round(event.clientY)}`
      );
      // Don't handle the event - let it bubble to container's pan handler
      // Don't call preventDefault or stopPropagation
      return;
    }

    if (event.isPrimary === false || !captureInteractionPointer(event)) return;

    const rect = pagePresentationFrame(targetElement);
    const isWithinCanvas = isPointWithinTargetRect(event.clientX, event.clientY, rect);

    regionDebug(
      `[RegionSelectionTool p${currentPageId ?? 'unknown'}] mouseDown — ` +
      `tool=${effectiveToolType}, activeTool=${activeTool ?? 'none'}, within=${isWithinCanvas}, ` +
      `client=${Math.round(event.clientX)},${Math.round(event.clientY)}, ` +
      `rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}`
    );

    if (!isWithinCanvas) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setIsCursorOverCanvas(true);

    if (effectiveToolType === 'move') {
      // In move mode, check if click is inside any selected region's boundary box
      const pointer = clientPointToPage(event.clientX, event.clientY, rect);
      if (!pointer) return;
      const { x, y } = pointer;

      // Phone: the layer lets touches through to the page (so two fingers
      // still pinch and pan the PDF), so areas are hit-tested here instead of
      // by their own SVG paths: touching an area selects it and drags it.
      if (mobileMode) {
        const hitRegion = findRegionAtPagePoint(x, y, selectedRegionIds);
        if (hitRegion) {
          regionPointerDownRef.current?.(hitRegion, event);
          return;
        }
      }

      // A press inside a picked area's box moves every picked area (the box
      // is what the user sees as "the selection"), as with marks.
      let pickedHit = selectedRegionIds.size > 0 ? findRegionAtPagePoint(x, y, selectedRegionIds) : null;
      if (!pickedHit && selectedRegionIds.size > 1) {
        const picked = regions.filter((r) => selectedRegionIds.has(r.regionId));
        const boxes = picked.map(getRegionBounds).filter(Boolean);
        const inGroupBox = boxes.length > 0 &&
          x >= Math.min(...boxes.map((b) => b.minX)) && x <= Math.max(...boxes.map((b) => b.maxX)) &&
          y >= Math.min(...boxes.map((b) => b.minY)) && y <= Math.max(...boxes.map((b) => b.maxY));
        if (inGroupBox) pickedHit = picked[0];
      }
      if (pickedHit && selectedRegionIds.has(pickedHit.regionId) && !event.shiftKey) {
        regionPointerDownRef.current?.(pickedHit, event);
        return;
      }
      // Owner 2026-10-27: a press on empty page starts a drag box, like the
      // box over marks. Shift keeps what is picked and adds to it; without
      // Shift the press lets go of the picked areas at once. (Phone: one
      // finger on empty page pans, so no box there.)
      if (!event.shiftKey && selectedRegionIds.size > 0) {
        setSelectedRegionIds(new Set());
        setInteractionState(null);
      }
      if (!mobileMode) {
        const next = { startClientX: event.clientX, startClientY: event.clientY, start: { x, y }, end: { x, y }, additive: event.shiftKey, shown: false };
        marqueeRef.current = next;
        setMarquee(next);
      } else {
        releaseInteractionPointer(event);
      }
      return;
    }

    const pointer = clientPointToPage(event.clientX, event.clientY, rect);
    if (!pointer) return;
    const { x, y } = pointer;

    if (effectiveToolType === ERASE_TOOL_TYPE) {
      eraseGestureRef.current = { preSnapshot: createHistorySnapshot(), erased: new Set() };
      eraseAreaAtRef.current?.(x, y);
      return;
    }

    // Owner 2026-10-26: a shape tool still picks areas. In Add mode (Shift
    // not held) a press on the picked area moves it, and a polygon's first
    // click on an area picks it rather than dropping a corner there. A drag
    // anywhere else draws; a click that never travels picks what is under it
    // (handled on release). Subtract keeps every press for drawing, since a
    // cut starts on top of an area.
    const picksAreas = effectiveSelectionMode === REGION_OPERATIONS.ADD && !event.shiftKey;
    if (picksAreas && (effectiveToolType !== 'polygon' || polyCornersRef.current.length === 0)) {
      const picked = selectedRegionIds.size > 0 ? findRegionAtPagePoint(x, y, selectedRegionIds) : null;
      if (picked && selectedRegionIds.has(picked.regionId)) {
        regionPointerDownRef.current?.(picked, event);
        return;
      }
      if (effectiveToolType === 'polygon') {
        const hit = findRegionAtPagePoint(x, y);
        if (hit) {
          setSelectedRegionIds(new Set([hit.regionId]));
          registerRegionTap(hit.regionId, event.clientX, event.clientY);
          releaseInteractionPointer(event);
          return;
        }
      }
    }

    if (effectiveToolType === 'polygon') {
      // A corner per click; the press is not a drag, so nothing waits for up.
      if (polyCornersRef.current.length === 0 && selectedRegionIds.size > 0) setSelectedRegionIds(new Set());
      const corners = polyCornersRef.current;
      const toScreen = (p) => ({ x: pageToScreenX(p.x), y: pageToScreenY(p.y) });
      const radii = regionPolygonHitRadii({ coarse: mobileMode || event.pointerType === 'touch' || event.pointerType === 'pen' });
      const action = regionPolygonPressAction(corners, { x, y }, { toScreen, checkHitPx: radii.checkHitPx });
      if (action === 'close' || action === 'finish') {
        commitPolygonRef.current?.(corners);
        return;
      }
      if (action === 'ignore') return;
      if (corners.length === 0) polyModeRef.current = effectiveSelectionMode;
      const { point } = resolveRegionPolygonPoint(corners, { x, y }, { shiftKey: event.shiftKey, toScreen });
      setPolyCorners([...corners, point]);
      setPolyHover(point);
      return;
    }

    drawGestureRef.current = { startX: event.clientX, startY: event.clientY, page: { x, y }, travelled: 0 };

    if (effectiveToolType === 'rectangular') {
      setIsDrawing(true);
      setStartPoint({ x, y });
      setCurrentRect({ x, y, width: 0, height: 0 });
    } else if (effectiveToolType === 'freehand') {
      setIsDrawing(true);
      setPolygonPoints([{ x, y }]);
    }
  }, [active, targetElement, effectiveToolType, effectiveSelectionMode, clientPointToPage, selectedRegionIds, regions, getRegionBounds, activeTool, isPointWithinTargetRect, captureInteractionPointer, releaseInteractionPointer, mobileMode, findRegionAtPagePoint, pageToScreenX, pageToScreenY, createHistorySnapshot, registerRegionTap]);

  const handleMouseMove = useCallback((event) => {
    if (!active || !targetElement) return;
    if (
      activePointerIdRef.current !== null &&
      Number.isFinite(event.pointerId) &&
      event.pointerId !== activePointerIdRef.current
    ) return;

    // Allow pan to work: if pan tool is active and not drawing/interacting, don't handle the event
    if (activeTool === 'pan' && !isDrawing && !interactionState) {
      return; // Let the event pass through for pan
    }

    const rect = pagePresentationFrame(targetElement);

    const box = marqueeRef.current;
    if (box) {
      const pointer = clientPointToPage(event.clientX, event.clientY, rect);
      if (!pointer) return;
      const shown = box.shown || Math.hypot(event.clientX - box.startClientX, event.clientY - box.startClientY) >= REGION_MARQUEE_MIN_DRAG_PX;
      const next = {
        ...box,
        shown,
        direction: regionMarqueeDirection(box.startClientX, event.clientX),
        end: {
          x: Math.max(0, Math.min(resolvedPageWidth || pointer.x, pointer.x)),
          y: Math.max(0, Math.min(resolvedPageHeight || pointer.y, pointer.y)),
        },
      };
      marqueeRef.current = next;
      setMarquee(next);
      return;
    }
    const isWithinCanvas =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    setIsCursorOverCanvas(isWithinCanvas);

    // Owner 2026-10-02: the Add / Subtract sign is part of the cursor image
    // now (areaDrawCursor), drawn by the system with the pointer - nothing to
    // move here, so it can never trail a fast sweep.

    if (!isWithinCanvas && !isDrawing && !interactionState) {
      return;
    }

    const pointer = clientPointToPage(event.clientX, event.clientY, rect);
    if (!pointer) return;
    const { x, y } = pointer;

    if (eraseGestureRef.current) {
      eraseAreaAt(x, y);
      return;
    }

    if (effectiveToolType === 'polygon' && polyCornersRef.current.length > 0) {
      const radii = regionPolygonHitRadii({ coarse: mobileMode || event.pointerType === 'touch' || event.pointerType === 'pen' });
      const { point } = resolveRegionPolygonPoint(polyCornersRef.current, { x, y }, {
        shiftKey: event.shiftKey,
        toScreen: (p) => ({ x: pageToScreenX(p.x), y: pageToScreenY(p.y) }),
        closePullPx: radii.closePullPx,
      });
      setPolyHover(point);
      const onCheck = regionPolygonPressAction(polyCornersRef.current, { x, y }, {
        toScreen: (p) => ({ x: pageToScreenX(p.x), y: pageToScreenY(p.y) }),
        checkHitPx: radii.checkHitPx,
      });
      setPolyOnCheck(onCheck === 'close' || onCheck === 'finish');
      return;
    }

    if (interactionState) {
      // Phone: a finger that wobbles inside the tap slop is a tap (select /
      // double-tap), not a 2px nudge of the area, point or box.
      if (
        mobileMode &&
        !dragHasMovedRef.current &&
        interactionState.startPoint &&
        Math.hypot(
          event.clientX - interactionState.startPoint.x,
          event.clientY - interactionState.startPoint.y
        ) <= TOUCH_TAP_SLOP_PX
      ) return;
      if (interactionState.type === 'move') {
        // Use raw client coordinates for delta to avoid scale/offset mismatch issues
        // interactionState.startPoint is in client coordinates (from handleRegionPointerDown)
        const { sx: moveScaleX, sy: moveScaleY } = getVisualScale(rect);
        const dx = (event.clientX - interactionState.startPoint.x) / moveScaleX * (rect.mirrorH ? -1 : 1);
        const dy = (event.clientY - interactionState.startPoint.y) / moveScaleY * (rect.mirrorV ? -1 : 1);

        if (dx !== 0 || dy !== 0) {
          // KAL-301a: mark that the drag actually moved coords
          dragHasMovedRef.current = true;
        }

        // Move all selected regions
        const updatedRegions = regions.map(r => {
          // Check if this region is being moved (is in the initial set of moved regions)
          const initialRegion = interactionState.initialRegions.find(ir => ir.regionId === r.regionId);
          if (initialRegion) {
            return {
              ...r,
              coordinates: initialRegion.coordinates.map((coord, index) => {
                return index % 2 === 0 ? coord + dx : coord + dy;
              })
            };
          }
          return r;
        });

        setRegions(updatedRegions);
      } else if (interactionState.type === 'resize') {
        const { handle, initialBounds, initialCoords, regionId } = interactionState;
        if (!initialBounds) return;

        const bounds = { ...initialBounds };
        // Phone bounding box (double-tap): there is no Shift key, so a corner
        // of a curved / free-form area scales it in proportion; a rectangle's
        // corner still resizes it freely (it stays a rectangle either way).
        const isCornerHandle = handle.length === 2;
        const phoneKeepsAspect = mobileMode && isCornerHandle &&
          regionsRef.current.find(r => r.regionId === regionId)?.shapeType !== 'rectangular';

        if (event.shiftKey || phoneKeepsAspect) {
          // KAL-301b/REDO: Shift+drag handle = uniform aspect-preserving scale.
          // Shift is read directly off the mousemove event (modifier flags ride
          // on every mouse event) instead of the isShiftPressed state, so no
          // keydown-listener race or stale closure can break detection.
          // Edge handles (n/s/e/w) also preserve aspect, driving from the moved axis.
          const initW = Math.max(initialBounds.maxX - initialBounds.minX, 1);
          const initH = Math.max(initialBounds.maxY - initialBounds.minY, 1);
          const aspect = initW / initH; // width / height ratio to preserve

          switch (handle) {
            case 'se': {
              // Anchor: nw corner (minX, minY). Width drives.
              const newW = Math.max(x - initialBounds.minX, MIN_REGION_SIZE);
              const newH = newW / aspect;
              bounds.maxX = initialBounds.minX + newW;
              bounds.maxY = initialBounds.minY + newH;
              break;
            }
            case 'sw': {
              // Anchor: ne corner (maxX, minY). Width drives.
              const newW = Math.max(initialBounds.maxX - x, MIN_REGION_SIZE);
              const newH = newW / aspect;
              bounds.minX = initialBounds.maxX - newW;
              bounds.maxY = initialBounds.minY + newH;
              break;
            }
            case 'ne': {
              // Anchor: sw corner (minX, maxY). Width drives.
              const newW = Math.max(x - initialBounds.minX, MIN_REGION_SIZE);
              const newH = newW / aspect;
              bounds.maxX = initialBounds.minX + newW;
              bounds.minY = initialBounds.maxY - newH;
              break;
            }
            case 'nw': {
              // Anchor: se corner (maxX, maxY). Width drives.
              const newW = Math.max(initialBounds.maxX - x, MIN_REGION_SIZE);
              const newH = newW / aspect;
              bounds.minX = initialBounds.maxX - newW;
              bounds.minY = initialBounds.maxY - newH;
              break;
            }
            case 'e': {
              // Width drives; height follows; centred vertically.
              const newW = Math.max(x - initialBounds.minX, MIN_REGION_SIZE);
              const newH = newW / aspect;
              const midY = (initialBounds.minY + initialBounds.maxY) / 2;
              bounds.maxX = initialBounds.minX + newW;
              bounds.minY = midY - newH / 2;
              bounds.maxY = midY + newH / 2;
              break;
            }
            case 'w': {
              const newW = Math.max(initialBounds.maxX - x, MIN_REGION_SIZE);
              const newH = newW / aspect;
              const midY = (initialBounds.minY + initialBounds.maxY) / 2;
              bounds.minX = initialBounds.maxX - newW;
              bounds.minY = midY - newH / 2;
              bounds.maxY = midY + newH / 2;
              break;
            }
            case 's': {
              // Height drives; width follows; centred horizontally.
              const newH = Math.max(y - initialBounds.minY, MIN_REGION_SIZE);
              const newW = newH * aspect;
              const midX = (initialBounds.minX + initialBounds.maxX) / 2;
              bounds.maxY = initialBounds.minY + newH;
              bounds.minX = midX - newW / 2;
              bounds.maxX = midX + newW / 2;
              break;
            }
            case 'n': {
              const newH = Math.max(initialBounds.maxY - y, MIN_REGION_SIZE);
              const newW = newH * aspect;
              const midX = (initialBounds.minX + initialBounds.maxX) / 2;
              bounds.minY = initialBounds.maxY - newH;
              bounds.minX = midX - newW / 2;
              bounds.maxX = midX + newW / 2;
              break;
            }
            default:
              break;
          }
        } else {
          // Plain drag: existing free resize (each handle moves independently).
          switch (handle) {
            case 'nw':
              bounds.minX = Math.min(x, initialBounds.maxX - MIN_REGION_SIZE);
              bounds.minY = Math.min(y, initialBounds.maxY - MIN_REGION_SIZE);
              break;
            case 'n':
              bounds.minY = Math.min(y, initialBounds.maxY - MIN_REGION_SIZE);
              break;
            case 'ne':
              bounds.maxX = Math.max(x, initialBounds.minX + MIN_REGION_SIZE);
              bounds.minY = Math.min(y, initialBounds.maxY - MIN_REGION_SIZE);
              break;
            case 'e':
              bounds.maxX = Math.max(x, initialBounds.minX + MIN_REGION_SIZE);
              break;
            case 'se':
              bounds.maxX = Math.max(x, initialBounds.minX + MIN_REGION_SIZE);
              bounds.maxY = Math.max(y, initialBounds.minY + MIN_REGION_SIZE);
              break;
            case 's':
              bounds.maxY = Math.max(y, initialBounds.minY + MIN_REGION_SIZE);
              break;
            case 'sw':
              bounds.minX = Math.min(x, initialBounds.maxX - MIN_REGION_SIZE);
              bounds.maxY = Math.max(y, initialBounds.minY + MIN_REGION_SIZE);
              break;
            case 'w':
              bounds.minX = Math.min(x, initialBounds.maxX - MIN_REGION_SIZE);
              break;
            default:
              break;
          }
        }

        ensureBoundsMinSize(bounds);

        // KAL-301a: mark that the resize drag actually moved coords
        dragHasMovedRef.current = true;

        setRegions(prev => prev.map(region => {
          if (region.regionId !== regionId) {
            return region;
          }

          if (region.shapeType === 'rectangular') {
            return {
              ...region,
              coordinates: [
                bounds.minX,
                bounds.minY,
                bounds.maxX,
                bounds.minY,
                bounds.maxX,
                bounds.maxY,
                bounds.minX,
                bounds.maxY
              ]
            };
          }

          const initialWidth = Math.max(initialBounds.maxX - initialBounds.minX, 1);
          const initialHeight = Math.max(initialBounds.maxY - initialBounds.minY, 1);
          const newWidth = bounds.maxX - bounds.minX;
          const newHeight = bounds.maxY - bounds.minY;
          const scaleXFactor = newWidth / initialWidth;
          const scaleYFactor = newHeight / initialHeight;

          const updatedCoordinates = initialCoords.reduce((acc, value, index) => {
            if (index % 2 === 0) {
              const relativeX = value - initialBounds.minX;
              acc.push(bounds.minX + relativeX * scaleXFactor);
            } else {
              const relativeY = value - initialBounds.minY;
              acc.push(bounds.minY + relativeY * scaleYFactor);
            }
            return acc;
          }, []);

          return {
            ...region,
            coordinates: updatedCoordinates
          };
        }));
      } else if (interactionState.type === 'vertex') {
        const { vertexIndex, regionId, initialBounds, initialCoords } = interactionState;

        // KAL-301a: mark that vertex drag moved
        dragHasMovedRef.current = true;

        // KAL-301 REDO: Shift+drag a vertex handle = uniform aspect-preserving
        // scale of the WHOLE region, anchored at the opposite bbox corner.
        // The first attempt put this only in the 'resize' branch — but regions
        // with <=32 vertices (i.e. every rectangle) render VERTEX handles, so
        // the owner's "Shift+drag corner" never reached that code. Shift is
        // read live off the mousemove event (the modifier flags ride on every
        // mouse event), so holding/releasing Shift mid-drag toggles behavior
        // immediately and no keydown-listener race can break it.
        if (event.shiftKey && initialBounds && Array.isArray(initialCoords)) {
          const vx0 = initialCoords[vertexIndex * 2];
          const vy0 = initialCoords[vertexIndex * 2 + 1];
          // Anchor: the bbox corner diagonally opposite the dragged vertex.
          const anchorX = (vx0 - initialBounds.minX) < (initialBounds.maxX - vx0)
            ? initialBounds.maxX : initialBounds.minX;
          const anchorY = (vy0 - initialBounds.minY) < (initialBounds.maxY - vy0)
            ? initialBounds.maxY : initialBounds.minY;
          const d0 = Math.hypot(vx0 - anchorX, vy0 - anchorY);
          const d1 = Math.hypot(x - anchorX, y - anchorY);
          const initW = Math.max(initialBounds.maxX - initialBounds.minX, 1);
          const initH = Math.max(initialBounds.maxY - initialBounds.minY, 1);
          const minScale = MIN_REGION_SIZE / Math.max(Math.min(initW, initH), 1);
          const s = Math.max(d0 > 0 ? d1 / d0 : 1, minScale);

          setRegions(prev => prev.map(region => {
            if (region.regionId !== regionId) return region;
            const scaled = initialCoords.map((value, index) => (
              index % 2 === 0
                ? anchorX + (value - anchorX) * s
                : anchorY + (value - anchorY) * s
            ));
            // Uniform scale preserves the shape — keep shapeType as-is.
            return { ...region, coordinates: scaled };
          }));
        } else {
          // Free vertex move, desktop AND phone (owner 2026-10-01: dragging a
          // point moves just that point; the bounding box - double-tap /
          // double-click - is how the whole area is resized). Built from the
          // drag-start coords (not the accumulated ones) so toggling Shift
          // mid-drag is lossless.
          setRegions(prev => prev.map(region => {
            if (region.regionId !== regionId) {
              return region;
            }

            const newCoords = Array.isArray(initialCoords)
              ? [...initialCoords]
              : [...region.coordinates];
            newCoords[vertexIndex * 2] = x;
            newCoords[vertexIndex * 2 + 1] = y;

            return {
              ...region,
              shapeType: 'polygon',
              coordinates: newCoords
            };
          }));
        }
      } else if (interactionState.type === 'rotate') {
        // KAL-301 REDO: rotation drag, copied from the standard rotate branch
        // in useSVGInteraction.js. The angle is the ABSOLUTE pointer direction
        // from the shape's bbox center, converted to Fabric-style degrees
        // (0 = up) via normalizeAngle. There is NO always-on snap — the app's
        // day-one convention is free rotation with a soft Shift-snap to the
        // nearest 45° within a 3° threshold (EDIT-11 locked decision).
        //
        // Coords are NOT touched here. The selected region and its entire
        // selection chrome (box + grabbers + mtr handle) render with a
        // rotate(angle, cx, cy) transform while liveRotationAngle is set, so
        // the box rotates WITH the shape exactly like a standard rectangle
        // annotation. The final angle is baked into coords once at mouse-up.
        const { center } = interactionState;
        if (!center) return;

        const radians = Math.atan2(y - center.cy, x - center.cx);
        let newAngle = normalizeAngle(radians);
        if (event.shiftKey) {
          newAngle = snapAngleToNearest45(newAngle, 3);
        }

        dragHasMovedRef.current = true;
        setLiveRotationAngle(prev => (prev === newAngle ? prev : newAngle));
      }
      return;
    }

    if (!isDrawing) return;

    const gesture = drawGestureRef.current;
    if (gesture) {
      gesture.travelled = Math.max(
        gesture.travelled,
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
      );
    }

    // The live shape stops at the page edge, where the saved area is cut.
    const edgeX = Math.max(0, Math.min(resolvedPageWidth || x, x));
    const edgeY = Math.max(0, Math.min(resolvedPageHeight || y, y));
    if (effectiveToolType === 'rectangular' && startPoint) {
      setCurrentRect({
        x: Math.min(startPoint.x, edgeX),
        y: Math.min(startPoint.y, edgeY),
        width: Math.abs(edgeX - startPoint.x),
        height: Math.abs(edgeY - startPoint.y)
      });
    } else if (effectiveToolType === 'freehand') {
      setPolygonPoints(prev => [...prev, { x: edgeX, y: edgeY }]);
    }
  }, [active, targetElement, clientPointToPage, getVisualScale, interactionState, ensureBoundsMinSize, isDrawing, effectiveToolType, startPoint, regions, activeTool, mobileMode, eraseAreaAt, resolvedPageWidth, resolvedPageHeight, pageToScreenX, pageToScreenY]);

  const handleMouseUp = useCallback((event) => {
    if (!active) return;
    if (!releaseInteractionPointer(event)) return;

    const box = marqueeRef.current;
    if (box) {
      marqueeRef.current = null;
      setMarquee(null);
      if (!box.shown) return;
      const rect = regionMarqueeRect(box.start, box.end);
      const outlines = regionsRef.current.map((region) => ({
        id: region.regionId,
        coordinates: withRegionOutlineCoordinates(region).coordinates,
      }));
      const hits = resolveRegionMarqueeHits(outlines, rect, box.direction);
      setSelectedRegionIds((prev) => {
        const next = new Set(box.additive ? prev : []);
        hits.forEach((id) => next.add(id));
        return next;
      });
      return;
    }

    const eraseGesture = eraseGestureRef.current;
    if (eraseGesture) {
      eraseGestureRef.current = null;
      if (eraseGesture.erased.size > 0) {
        undoStackRef.current.push(eraseGesture.preSnapshot);
        redoStackRef.current = [];
        if (undoStackRef.current.length > REGION_HISTORY_LIMIT) undoStackRef.current.shift();
        persistHistoryStacks();
      }
      return;
    }

    if (effectiveToolType === 'polygon' && !interactionState) return;

    setIsCursorOverCanvas(false);

    if (interactionState) {
      // KAL-301 REDO: rotation bakes ONCE here at drag end. During the drag
      // the shape + chrome only carried a rotate() transform; now the final
      // angle is written into the coords (the polygon-region equivalent of a
      // standard annotation persisting obj.angle).
      if (interactionState.type === 'rotate') {
        const finalAngle = normalizeRegionRotation(liveRotationAngle ?? 0);
        const { regionId, center, initialCoords, baseRotation = 0 } = interactionState;
        // KAL-301 follow-up: only the DELTA from the persisted base rotation
        // gets baked into coords (they already contain the base); the new
        // absolute angle persists on region.rotation so the chrome keeps the
        // tilted box after release / deselect / re-select.
        const deltaAngle = normalizeRegionRotation(finalAngle - baseRotation);
        if (dragHasMovedRef.current && deltaAngle !== 0 && center && Array.isArray(initialCoords)) {
          const rotated = rotateCoordsAroundPoint(initialCoords, center.cx, center.cy, deltaAngle);
          setRegions(prev => prev.map(r => (
            r.regionId === regionId
              ? {
                  ...r,
                  // Off-axis rotation breaks the 'rectangular' invariant (the
                  // resize path rebuilds rect coords from bounds, silently
                  // un-rotating). 90° multiples stay rectangular.
                  shapeType: finalAngle % 90 === 0 ? r.shapeType : 'polygon',
                  rotation: finalAngle,
                  coordinates: rotated
                }
              : r
          )));
        } else {
          // Grab-and-release without an effective rotation — no undo entry.
          dragHasMovedRef.current = false;
        }
        setLiveRotationAngle(null);
      }
      // KAL-301a: push the pre-drag snapshot onto the undo stack only when the
      // drag actually changed coords (one checkpoint per completed drag, not per
      // pixel, and not for click-without-drag). The pre-drag snapshot was
      // captured at pointer-down and stored in interactionState.preSnapshot.
      if (dragHasMovedRef.current && interactionState.preSnapshot) {
        undoStackRef.current.push(interactionState.preSnapshot);
        redoStackRef.current = [];
        if (undoStackRef.current.length > REGION_HISTORY_LIMIT) {
          undoStackRef.current.shift();
        }
        persistHistoryStacks();
      }
      // Phone: a tap (no drag) on an area; two in a row = double-tap, which
      // toggles the bounding box. (Desktop uses the native double-click.)
      if (
        mobileMode &&
        interactionState.type === 'move' &&
        !dragHasMovedRef.current &&
        interactionState.tapRegionId
      ) {
        registerRegionTap(interactionState.tapRegionId, event.clientX, event.clientY);
      }
      dragHasMovedRef.current = false;
      setInteractionState(null);
      return;
    }

    if (!isDrawing) return;

    // A click or tap (no drag) while a shape tool is armed picks the area
    // under it, or lets go of the picked one on empty page. The shape tool
    // stays armed (owner 2026-10-26: "I shouldn't have to switch to the
    // selection tool"); the picked area shows its grabbers and Delete takes
    // it away.
    const gesture = drawGestureRef.current;
    drawGestureRef.current = null;
    if (gesture && gesture.travelled <= (mobileMode ? TOUCH_TAP_SLOP_PX : MOUSE_CLICK_SLOP_PX)) {
      const tapped = findRegionAtPagePoint(gesture.page.x, gesture.page.y);
      setIsDrawing(false);
      setStartPoint(null);
      setCurrentRect(null);
      setPolygonPoints([]);
      if (tapped) {
        setSelectedRegionIds(new Set([tapped.regionId]));
        registerRegionTap(tapped.regionId, event.clientX, event.clientY);
      } else {
        setSelectedRegionIds((prev) => (prev.size ? new Set() : prev));
      }
      return;
    }
    // A new shape lets go of the picked area.
    setSelectedRegionIds((prev) => (prev.size ? new Set() : prev));

    const thinTolerance = getThinTolerance();
    if (effectiveToolType === 'rectangular' && currentRect && currentRect.width > MIN_REGION_SIZE && currentRect.height > MIN_REGION_SIZE) {
      pushUndoSnapshot();
      regionDebug(
        `[RegionSelectionTool p${currentPageId ?? 'unknown'}] mouseUp commit rectangular — ` +
        `x=${currentRect.x.toFixed(2)}, y=${currentRect.y.toFixed(2)}, ` +
        `w=${currentRect.width.toFixed(2)}, h=${currentRect.height.toFixed(2)}, mode=${effectiveSelectionMode}`
      );
      const newRegion = {
        regionId: crypto.randomUUID(),
        pageId: currentPageId,
        shapeType: 'rectangular',
        operation: effectiveSelectionMode,
        coordinates: [
          currentRect.x,
          currentRect.y,
          currentRect.x + currentRect.width,
          currentRect.y,
          currentRect.x + currentRect.width,
          currentRect.y + currentRect.height,
          currentRect.x,
          currentRect.y + currentRect.height
        ],
        // KAL-313 prerequisite: ownership stamp for delete-audit + step-11 gate.
        ...(userId ? { createdBy: userId } : {}),
      };

      if (effectiveSelectionMode === REGION_OPERATIONS.ADD) {
        // Additive mode: just add to list (merge happens on confirm)
        setRegions(prev => [...prev, newRegion]);
      } else {
        // Subtractive mode: immediately apply subtraction to existing regions
        setRegions(prev => {
          let updatedRegions = [];
          // If there are no existing regions, nothing to subtract from
          if (prev.length === 0) return [];

          for (const existingRegion of prev) {
            // subtractRegionFromRegion returns array of regions (or empty if fully subtracted).
            // Curved parts of the result are thinned at the current zoom.
            const result = subtractRegionFromRegion(existingRegion, newRegion, { thinTolerance });
            if (result && result.length > 0) {
              updatedRegions.push(...result);
            }
          }
          return updatedRegions;
        });
      }
    } else if (effectiveToolType === 'freehand' && polygonPoints.length > 2) {
      pushUndoSnapshot();
      regionDebug(
        `[RegionSelectionTool p${currentPageId ?? 'unknown'}] mouseUp commit freehand — ` +
        `points=${polygonPoints.length}, mode=${effectiveSelectionMode}`
      );
      // Owner 2026-10-01: keep the fewest points that hold the drawn line to
      // within OUTLINE_THIN_TOLERANCE_PX; the outline is drawn as a smooth
      // curve through them.
      const thinned = thinFreehandStroke(polygonPoints.flatMap(point => [point.x, point.y]), thinTolerance);
      regionDebug(
        `[RegionSelectionTool p${currentPageId ?? 'unknown'}] freehand thinned — ` +
        `${polygonPoints.length} -> ${thinned.coordinates.length / 2} points`
      );
      const newRegion = {
        regionId: crypto.randomUUID(),
        pageId: currentPageId,
        shapeType: 'polygon',
        operation: effectiveSelectionMode,
        coordinates: thinned.coordinates,
        ...(thinned.smoothVertices ? { smoothVertices: thinned.smoothVertices } : {}),
        // KAL-313 prerequisite: ownership stamp for delete-audit + step-11 gate.
        ...(userId ? { createdBy: userId } : {}),
      };

      if (effectiveSelectionMode === REGION_OPERATIONS.ADD) {
        // Additive mode: just add to list (merge happens on confirm)
        setRegions(prev => [...prev, newRegion]);
      } else {
        // Subtractive mode: immediately apply subtraction to existing regions
        setRegions(prev => {
          let updatedRegions = [];
          // If there are no existing regions, nothing to subtract from
          if (prev.length === 0) return [];

          for (const existingRegion of prev) {
            // subtractRegionFromRegion returns array of regions (or empty if fully subtracted).
            // Curved parts of the result are thinned at the current zoom.
            const result = subtractRegionFromRegion(existingRegion, newRegion, { thinTolerance });
            if (result && result.length > 0) {
              updatedRegions.push(...result);
            }
          }
          return updatedRegions;
        });
      }
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRect(null);
    setPolygonPoints([]);
  }, [active, interactionState, liveRotationAngle, isDrawing, effectiveToolType, currentRect, polygonPoints, currentPageId, effectiveSelectionMode, mergeRegionWithOverlapping, subtractRegionFromRegions, pushUndoSnapshot, persistHistoryStacks, userId, releaseInteractionPointer, mobileMode, findRegionAtPagePoint, registerRegionTap, getThinTolerance]);

  const handleCanvasMouseLeave = useCallback(() => {
    setIsCursorOverCanvas(false);
  }, []);

  // A stroke the browser or a second finger takes away puts back what it erased.
  const dropEraseGesture = useCallback(() => {
    const gesture = eraseGestureRef.current;
    eraseGestureRef.current = null;
    if (gesture?.erased.size) setRegions(cloneRegionsForUndo(gesture.preSnapshot.regions));
  }, [cloneRegionsForUndo]);

  const handlePointerCancel = useCallback((event) => {
    if (!releaseInteractionPointer(event)) return;
    marqueeRef.current = null;
    setMarquee(null);
    dropEraseGesture();
    dragHasMovedRef.current = false;
    setIsCursorOverCanvas(false);
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRect(null);
    setPolygonPoints([]);
    setInteractionState(null);
    setLiveRotationAngle(null);
  }, [releaseInteractionPointer, dropEraseGesture]);

  // Phone: a second finger means "zoom / pan the page", never "keep drawing".
  // Drop the half-drawn shape, put a half-dragged area back where it was, and
  // let the viewer take the pinch.
  const interactionStateRef = useRef(null);
  interactionStateRef.current = interactionState;
  const abandonTouchInteraction = useCallback(() => {
    const current = interactionStateRef.current;
    if (current?.preSnapshot && dragHasMovedRef.current) {
      setRegions(cloneRegionsForUndo(current.preSnapshot.regions));
    }
    documentDragFallbackRef.current = false;
    drawGestureRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    dropEraseGesture();
    releaseInteractionPointer();
    dragHasMovedRef.current = false;
    setIsCursorOverCanvas(false);
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRect(null);
    setPolygonPoints([]);
    setInteractionState(null);
    setLiveRotationAngle(null);
  }, [cloneRegionsForUndo, releaseInteractionPointer, dropEraseGesture]);

  useEffect(() => {
    if (!active || !mobileMode) return undefined;
    window.addEventListener(PDFJS_PINCH_START_EVENT, abandonTouchInteraction);
    return () => window.removeEventListener(PDFJS_PINCH_START_EVENT, abandonTouchInteraction);
  }, [active, mobileMode, abandonTouchInteraction]);

  const handleConfirm = useCallback(() => {
    if (!onRegionComplete) {
      return;
    }

    const currentRegions = Array.isArray(regionsRef.current) ? regionsRef.current : [];
    const payload = buildRegionPayload(currentRegions);
    regionDebug(
      `[RegionSelectionTool p${currentPageId ?? 'unknown'}] confirm — ` +
      `input=${currentRegions.length}, payload=${payload.length}, ` +
      `valid=${payload.filter(region => Array.isArray(region.coordinates) && region.coordinates.length >= 6).length}`
    );
    onRegionComplete(payload);
    setRegions([]);
    setCurrentRect(null);
    setPolygonPoints([]);
    setSelectedRegionIds(new Set());
    setInteractionState(null);
  }, [currentPageId, onRegionComplete]);

  const handleCancel = useCallback(() => {
    releaseInteractionPointer();
    if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    setRegions([]);
    setCurrentRect(null);
    setPolygonPoints([]);
    setSelectedRegionIds(new Set());
    setInteractionState(null);
    setIsDrawing(false);
    setIsCursorOverCanvas(false);
    if (onCancel) {
      onCancel();
    }
  }, [onCancel, releaseInteractionPointer]);

  // Owner 2026-10-26: no Cancel or Done. Leaving the tool (Enter, a click
  // off the page, another tool, the phone's Done) keeps what was drawn, like
  // every other tool; Undo takes it back. With nothing changed nothing is
  // saved, so the page is not rewritten and no undo step is made.
  const handleLeave = useCallback(() => {
    if (regionsSignature(regionsRef.current) === sessionStartSignatureRef.current) handleCancel();
    else handleConfirm();
  }, [handleCancel, handleConfirm]);

  // Esc with nothing in hand leaves without saving. When that throws edits
  // away, the toast's Undo saves them after all (act first, offer Undo).
  const handleDiscard = useCallback(() => {
    const changed = regionsSignature(regionsRef.current) !== sessionStartSignatureRef.current;
    const dropped = changed ? buildRegionPayload(regionsRef.current) : null;
    const spaceId = currentSpaceId;
    const pageId = currentPageId;
    handleCancel();
    if (dropped && typeof onRestoreRegions === 'function') {
      showToast('Area changes dropped', 'info', {
        id: AREA_DROPPED_TOAST_ID,
        duration: 6000,
        action: { label: 'Undo', onClick: () => onRestoreRegions(spaceId, pageId, dropped) },
      });
    }
  }, [currentSpaceId, currentPageId, handleCancel, onRestoreRegions]);

  useEffect(() => () => {
    if (typeof onMobileToolbarApiChange === 'function') onMobileToolbarApiChange(null);
  }, [onMobileToolbarApiChange]);

  const handleRegionPointerDown = useCallback((region, event) => {
    if (!active || !editsPicked || !targetElement) {
      return;
    }
    if (event.button === 2) {
      if (!selectedRegionIds.has(region.regionId)) {
        setSelectedRegionIds(new Set([region.regionId]));
      }
      return;
    }
    if (event.isPrimary === false || !captureInteractionPointer(event)) return;
    event.stopPropagation();

    // Shift always toggles.
    // Cmd/Ctrl only toggles if we are in the persistent Move tool.
    // If using Quick Select (Cmd/Ctrl in Draw mode), it should NOT toggle (allows dragging).
    const isMultiSelect = event.shiftKey || ((event.metaKey || event.ctrlKey) && toolType === 'move');
    const isSelected = selectedRegionIds.has(region.regionId);

    if (isMultiSelect) {
      // Toggle selection
      const newSelection = new Set(selectedRegionIds);
      if (isSelected) {
        newSelection.delete(region.regionId);
      } else {
        newSelection.add(region.regionId);
      }
      setSelectedRegionIds(newSelection);

      // If we just added it, start moving it (and others)
      if (!isSelected) {
        // KAL-301a: capture pre-drag snapshot; push to undo stack at drag-END
        // (in handleMouseUp) only if coords actually changed.
        const preSnapshot = createHistorySnapshot();
        dragHasMovedRef.current = false;
        setInteractionState({
          type: 'move',
          startPoint: { x: event.clientX, y: event.clientY },
          tapRegionId: region.regionId,
          initialRegions: regions.filter(r => newSelection.has(r.regionId)),
          preSnapshot
        });
      }
    } else {
      // Single select behavior
      if (!isSelected) {
        // If clicking a new region, select ONLY it
        setSelectedRegionIds(new Set([region.regionId]));
        // KAL-301a: capture pre-drag snapshot
        const preSnapshot = createHistorySnapshot();
        dragHasMovedRef.current = false;
        setInteractionState({
          type: 'move',
          startPoint: { x: event.clientX, y: event.clientY },
          tapRegionId: region.regionId,
          initialRegions: [region],
          preSnapshot
        });
      } else {
        // If clicking an already selected region, keep selection (allow bulk move)
        // But if we just click and release without moving, we might want to deselect others?
        // Standard behavior: MouseDown doesn't clear others if clicking selected,
        // but MouseUp might if no drag occurred. For now, keep simple: don't clear.
        // KAL-301a: capture pre-drag snapshot
        const preSnapshot = createHistorySnapshot();
        dragHasMovedRef.current = false;
        setInteractionState({
          type: 'move',
          startPoint: { x: event.clientX, y: event.clientY },
          tapRegionId: region.regionId,
          initialRegions: regions.filter(r => selectedRegionIds.has(r.regionId)),
          preSnapshot
        });
      }
    }
  }, [active, editsPicked, targetElement, regions, selectedRegionIds, toolType, createHistorySnapshot, captureInteractionPointer]);
  regionPointerDownRef.current = handleRegionPointerDown;

  const handleVertexPointerDown = useCallback((region, vertexIndex, event) => {
    if (!active || !editsPicked || !targetElement) return;
    if (event.button === 2) {
      if (!selectedRegionIds.has(region.regionId)) {
        setSelectedRegionIds(new Set([region.regionId]));
      }
      return;
    }
    if (event.isPrimary === false || !captureInteractionPointer(event)) return;
    event.stopPropagation();
    event.preventDefault();

    setSelectedRegionIds(new Set([region.regionId])); // Select only this region for vertex editing
    // KAL-301a: capture pre-drag snapshot; push to undo stack at drag-END only if moved
    const preSnapshot = createHistorySnapshot();
    dragHasMovedRef.current = false;
    setInteractionState({
      type: 'vertex',
      regionId: region.regionId,
      vertexIndex,
      startPoint: { x: event.clientX, y: event.clientY },
      // KAL-301 REDO: drag-start geometry so the mousemove branch can do
      // Shift = uniform aspect-preserving scale (and lossless Shift toggling).
      initialBounds: getRegionBounds(region),
      initialCoords: [...region.coordinates],
      preSnapshot
    });
  }, [active, editsPicked, targetElement, selectedRegionIds, createHistorySnapshot, getRegionBounds, captureInteractionPointer]);

  // The "+" halfway along a side of a picked free-form area (the Polygon
  // markup tool's add-point grabber): adds a point there and drags it. One
  // undo step, taken even when the press lets go without moving.
  const handleAddPointPointerDown = useCallback((region, sideIndex, event) => {
    if (!active || !editsPicked || !targetElement) return;
    if (event.button === 2) return;
    const inserted = insertRegionSidePoint(region, sideIndex);
    if (!inserted) return;
    if (event.isPrimary === false || !captureInteractionPointer(event)) return;
    event.stopPropagation();
    event.preventDefault();

    const preSnapshot = createHistorySnapshot();
    setRegions(prev => prev.map(r => (r.regionId === region.regionId ? inserted.region : r)));
    setSelectedRegionIds(new Set([region.regionId]));
    dragHasMovedRef.current = true;
    setInteractionState({
      type: 'vertex',
      regionId: region.regionId,
      vertexIndex: inserted.vertexIndex,
      startPoint: { x: event.clientX, y: event.clientY },
      initialBounds: getRegionBounds(inserted.region),
      initialCoords: [...inserted.region.coordinates],
      preSnapshot
    });
  }, [active, editsPicked, targetElement, createHistorySnapshot, getRegionBounds, captureInteractionPointer]);

  const handleResizePointerDown = useCallback((region, handle, event) => {
    if (!active || !editsPicked || !targetElement) return;
    if (event.button === 2) {
      if (!selectedRegionIds.has(region.regionId)) {
        setSelectedRegionIds(new Set([region.regionId]));
      }
      return;
    }
    if (event.isPrimary === false || !captureInteractionPointer(event)) return;
    event.stopPropagation();
    event.preventDefault();

    const bounds = getRegionBounds(region);
    if (!bounds) return;

    setSelectedRegionIds(new Set([region.regionId])); // Select only this region for resizing
    // KAL-301a: capture pre-drag snapshot; push to undo stack at drag-END only if moved
    const preSnapshot = createHistorySnapshot();
    dragHasMovedRef.current = false;
    setInteractionState({
      type: 'resize',
      regionId: region.regionId,
      handle,
      startPoint: { x: event.clientX, y: event.clientY },
      initialBounds: bounds,
      initialCoords: [...region.coordinates],
      preSnapshot
    });
  }, [active, editsPicked, targetElement, getRegionBounds, selectedRegionIds, createHistorySnapshot, captureInteractionPointer]);

  // KAL-301 REDO: rotation handle pointer-down, matching the standard mtr
  // pointer-down in useSVGInteraction.js: the rotation pivot is the bbox
  // CENTER (the universal pivot for every shape type — "bbox center is the
  // universal rotation pivot", useSVGInteraction.js ~L3981), drag-start
  // geometry is captured once, and the live angle starts at 0 so there is no
  // jump on the first pointermove.
  const handleRotatePointerDown = useCallback((region, event) => {
    if (!active || !editsPicked || !targetElement) return;
    if (event.button === 2) return;
    if (event.isPrimary === false || !captureInteractionPointer(event)) return;
    event.stopPropagation();
    event.preventDefault();

    const bounds = getRegionBounds(region);
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    setSelectedRegionIds(new Set([region.regionId]));
    // KAL-301a: pre-drag snapshot for undo (pushed at drag-END only if moved)
    const preSnapshot = createHistorySnapshot();
    dragHasMovedRef.current = false;
    // KAL-301 follow-up: the live angle starts at the region's PERSISTED
    // rotation. The mtr handle of a tilted chrome sits at that angle from
    // the pivot, so the first pointermove's absolute angle is continuous —
    // no jump, same behavior as grabbing a rotated annotation's mtr.
    const baseRotation = getRegionRotation(region);
    setLiveRotationAngle(baseRotation);
    setInteractionState({
      type: 'rotate',
      regionId: region.regionId,
      center: { cx, cy },
      initialCoords: [...region.coordinates],
      baseRotation,
      preSnapshot
    });
  }, [active, editsPicked, targetElement, getRegionBounds, createHistorySnapshot, captureInteractionPointer]);

  // Desktop: double-click an area = select it and toggle the bounding box
  // (phone does the same with a double-tap, see registerRegionTap).
  const handleLayerDoubleClick = useCallback((event) => {
    if (!active || mobileMode || activeTool === 'pan' || isSpacePressedRef.current) return;
    if (toolType === 'polygon') {
      event.preventDefault();
      if (polyCornersRef.current.length >= 3) commitPolygonRef.current?.(polyCornersRef.current);
      return;
    }
    if (event.target?.closest?.('[data-region-vertex-handle], [data-region-resize-handle], [data-region-add-vertex], [data-rotation-handle]')) return;
    const pointer = clientPointToPage(event.clientX, event.clientY);
    if (!pointer) return;
    const region = findRegionAtPagePoint(pointer.x, pointer.y, selectedRegionIds);
    if (!region) return;
    event.preventDefault();
    if (toolType !== 'move') setToolType('move');
    setSelectedRegionIds(new Set([region.regionId]));
    setBoxEditRegionId((prev) => (prev === region.regionId ? null : region.regionId));
  }, [active, mobileMode, activeTool, clientPointToPage, findRegionAtPagePoint, selectedRegionIds, toolType]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedRegionIds.size === 0) return;
    pushUndoSnapshot();

    // KAL-313: journaling moved to PDFViewer handleRegionComplete (commit time).
    // Firing here (delete-key press) was pre-commit — cancel would produce phantom
    // trash rows for regions that were never actually removed from state.

    setRegions(prev => prev.filter(r => !selectedRegionIds.has(r.regionId)));
    setSelectedRegionIds(new Set());
    setInteractionState(null);
  }, [selectedRegionIds, pushUndoSnapshot]);

  // Owner 2026-10-01 (Spaces toolbar): one Select, and the area tools in the
  // app's own tool chrome. Choosing a tool from the chrome or the keyboard
  // goes through these two, so a tool picked while the app's Pan tool is armed
  // also puts Pan down, and Add / Subtract picked while selecting goes back to
  // the last shape tool (the mode only means something while drawing).
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const chooseToolType = useCallback((nextToolType) => {
    if (nextToolType !== 'move' && nextToolType !== ERASE_TOOL_TYPE && !DRAW_TOOL_TYPES.has(nextToolType)) return;
    dropPolygon();
    setToolType(nextToolType);
    if (DRAW_TOOL_TYPES.has(nextToolType)) setLastDrawingTool(nextToolType);
    if (activeToolRef.current === 'pan' && typeof onRequestRegionTool === 'function') onRequestRegionTool();
  }, [onRequestRegionTool, dropPolygon]);
  const chooseSelectionMode = useCallback((nextMode) => {
    if (nextMode !== REGION_OPERATIONS.ADD && nextMode !== REGION_OPERATIONS.SUBTRACT) return;
    setSelectionMode(nextMode);
    if (!DRAW_TOOL_TYPES.has(toolType)) chooseToolType(lastDrawingTool);
    else if (activeToolRef.current === 'pan' && typeof onRequestRegionTool === 'function') onRequestRegionTool();
  }, [toolType, lastDrawingTool, chooseToolType, onRequestRegionTool]);

  // The tool's state and actions for the app chrome. Published on desktop as
  // well as the phone since 2026-10-01 (the desktop floating toolbar is gone):
  // AppShell draws the desktop Areas tools from it, MobilePdfViewerChrome the
  // phone rail and strip. (The prop keeps its old "mobile" name so the viewer
  // wiring did not have to change.)
  // Actions go up as stable wrappers over the latest handlers: publishing the
  // handlers themselves re-ran this effect on every identity change and looped
  // with the viewer's re-render (Maximum update depth exceeded).
  const regionToolbarActionsRef = useRef(null);
  regionToolbarActionsRef.current = {
    setToolType: chooseToolType,
    setSelectionMode: chooseSelectionMode,
    leave: handleLeave,
    deleteSelected: handleDeleteSelected,
  };
  const regionToolbarActions = useMemo(() => createStableActions(regionToolbarActionsRef, [
    'setToolType', 'setSelectionMode', 'leave', 'deleteSelected',
  ]), []);
  const canDeleteRegion = selectedRegionIds.size > 0;
  useEffect(() => {
    if (typeof onMobileToolbarApiChange !== 'function') return;
    if (!active) {
      onMobileToolbarApiChange(null);
      return;
    }
    onMobileToolbarApiChange({
      toolType,
      selectionMode,
      canDelete: canDeleteRegion,
      polygonCorners: polyCorners.length,
      ...regionToolbarActions,
    });
  }, [
    active,
    onMobileToolbarApiChange,
    toolType,
    selectionMode,
    canDeleteRegion,
    polyCorners.length,
    regionToolbarActions,
  ]);

  const handleContextMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    // Allow context menu in all modes (Draw or Move)
    const constraintRect = getTargetRect();

    // Check if we clicked on a region
    const pointer = clientPointToPage(event.clientX, event.clientY, constraintRect);
    if (!pointer) {
      return;
    }
    const { x, y } = pointer;

    const clickedRegion = [...regions].reverse().find(r => {
      const bounds = getRegionBounds(r);
      return bounds && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
    });

    const safePosition = calculateViewportSafePosition(event.clientX, event.clientY, {
      estimatedWidth: 200,
      estimatedHeight: 250,
      preferAbove: false,
      constraintRect
    });

    if (clickedRegion) {
      const nextSelectedIds = selectedRegionIds.has(clickedRegion.regionId)
        ? new Set(selectedRegionIds)
        : new Set([clickedRegion.regionId]);
      const selectedRegions = regions.filter(r => nextSelectedIds.has(r.regionId));
      const regionsToMerge = selectedRegions.length >= 2
        ? selectedRegions
        : getConnectedMergeCandidates(clickedRegion);
      const canMerge = canMergeRegions(regionsToMerge);
      const canUnmerge = selectedRegions.length === 1 &&
        Array.isArray(selectedRegions[0]?.sourceRegions) &&
        selectedRegions[0].sourceRegions.length > 0;

      setSelectedRegionIds(nextSelectedIds);
      setContextMenu({
        x: safePosition.x,
        y: safePosition.y,
        pageX: x,
        pageY: y,
        type: 'region',
        regionId: clickedRegion.regionId,
        mergeRegionIds: regionsToMerge.map(region => region.regionId),
        canMerge,
        canUnmerge
      });
      return;
    }

    setContextMenu({
      x: safePosition.x,
      y: safePosition.y,
      pageX: x,
      pageY: y,
      type: 'canvas',
      mergeRegionIds: [],
      canMerge: false,
      canUnmerge: false
    });
  }, [regions, selectedRegionIds, clientPointToPage, getRegionBounds, getTargetRect, canMergeRegions, getConnectedMergeCandidates]);

  // The last copied areas, kept here too: the system clipboard can refuse a
  // read (no permission), and Ctrl+V must still paste.
  const areaClipboardRef = useRef(null);
  const handleCopy = useCallback(async () => {
    if (selectedRegionIds.size === 0) return;
    const regionsToCopy = regions.filter(r => selectedRegionIds.has(r.regionId));
    areaClipboardRef.current = { regions: buildRegionPayload(regionsToCopy) };
    setContextMenu(null);

    try {
      await navigator.clipboard.writeText(JSON.stringify(regionsToCopy));
    } catch (err) {
      console.error('Failed to copy regions:', err);
    }
  }, [selectedRegionIds, regions]);

  const handleCut = useCallback(async () => {
    await handleCopy();
    handleDeleteSelected();
    setContextMenu(null);
  }, [handleCopy, handleDeleteSelected]);

  // Owner 2026-10-27: areas answer the keys marks do - Ctrl+A / C / X / V /
  // D and the arrows. With no point to paste at, a paste or duplicate lands a
  // step down-right of the original, one more step each time.
  const placeAreas = useCallback((sourceRegions, offset) => {
    if (!Array.isArray(sourceRegions) || sourceRegions.length === 0) return;
    const newRegions = sourceRegions.map((r) => ({
      ...r,
      regionId: crypto.randomUUID(),
      coordinates: r.coordinates.map((val) => val + offset),
      pageId: currentPageId,
      sourceRegions: undefined,
    }));
    pushUndoSnapshot();
    setRegions((prev) => [...prev, ...newRegions]);
    setSelectedRegionIds(new Set(newRegions.map((r) => r.regionId)));
  }, [currentPageId, pushUndoSnapshot]);
  // The system clipboard first (it outlives this editing session, so areas
  // copied on one page paste on another), the in-memory copy if it cannot be
  // read. On another page they land where they were; on their own page each
  // paste steps further down-right.
  const lastPasteRef = useRef({ key: null, count: 0 });
  const pasteAreasFromKeys = useCallback(async () => {
    let list = null;
    let key = null;
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      if (isAreaList(parsed)) { list = parsed; key = text; }
    } catch { /* no permission or not areas: use the in-memory copy */ }
    if (!list) {
      list = areaClipboardRef.current?.regions || null;
      key = areaClipboardRef.current;
    }
    if (!isAreaList(list)) return;
    const last = lastPasteRef.current;
    const count = last.key === key ? last.count + 1 : 1;
    lastPasteRef.current = { key, count };
    const samePage = list[0]?.pageId === currentPageId;
    placeAreas(list, samePage ? AREA_PASTE_STEP * count : AREA_PASTE_STEP * (count - 1));
  }, [placeAreas, currentPageId]);
  const duplicatePickedAreas = useCallback(() => {
    if (selectedRegionIds.size === 0) return;
    placeAreas(regions.filter((r) => selectedRegionIds.has(r.regionId)), AREA_PASTE_STEP);
  }, [placeAreas, regions, selectedRegionIds]);
  const nudgePickedAreas = useCallback((dx, dy) => {
    if (selectedRegionIds.size === 0) return;
    pushUndoSnapshot();
    setRegions((prev) => prev.map((r) => (selectedRegionIds.has(r.regionId)
      ? { ...r, coordinates: r.coordinates.map((val, idx) => val + (idx % 2 === 0 ? dx : dy)) }
      : r)));
  }, [selectedRegionIds, pushUndoSnapshot]);

  const handlePaste = useCallback(async () => {
    if (!contextMenu) return;

    try {
      let pastedRegions = null;
      try {
        pastedRegions = JSON.parse(await navigator.clipboard.readText());
      } catch {
        pastedRegions = areaClipboardRef.current?.regions || null;
      }

      if (!Array.isArray(pastedRegions) || pastedRegions.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      pastedRegions.forEach(r => {
        const bounds = getRegionBounds(r);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
          maxY = Math.max(maxY, bounds.maxY);
        }
      });

      if (minX === Infinity) return;

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const targetPoint = Number.isFinite(contextMenu.pageX) && Number.isFinite(contextMenu.pageY)
        ? { x: contextMenu.pageX, y: contextMenu.pageY }
        : clientPointToPage(contextMenu.x, contextMenu.y, getTargetRect());
      if (!targetPoint) return;
      const { x: targetX, y: targetY } = targetPoint;

      const dx = targetX - centerX;
      const dy = targetY - centerY;

      const newRegions = pastedRegions.map(r => {
        const newCoords = r.coordinates.map((val, idx) => {
          return idx % 2 === 0 ? val + dx : val + dy;
        });

        return {
          ...r,
          regionId: crypto.randomUUID(),
          coordinates: newCoords,
          pageId: currentPageId
        };
      });

      pushUndoSnapshot();
      setRegions(prev => {
        return [...prev, ...newRegions];
      });

      setSelectedRegionIds(new Set(newRegions.map(r => r.regionId)));
      setContextMenu(null);

    } catch (err) {
      console.error('Failed to paste regions:', err);
    }
  }, [contextMenu, clientPointToPage, currentPageId, getRegionBounds, getTargetRect, pushUndoSnapshot]);

  const handleMergeSelected = useCallback(() => {
    const mergeIds = Array.isArray(contextMenu?.mergeRegionIds) && contextMenu.mergeRegionIds.length >= 2
      ? new Set(contextMenu.mergeRegionIds)
      : selectedRegionIds;
    if (mergeIds.size < 2) return;

    const regionsToMerge = regions.filter(r => mergeIds.has(r.regionId));
    if (regionsToMerge.length < 2) return;
    if (!canMergeRegions(regionsToMerge)) return;

    // Calculate geometric union
    let mergedPoly = regionToPolygon(regionsToMerge[0]);
    if (!mergedPoly) return;

    try {
      // Start with the first one
      let currentUnion = mergedPoly;

      for (let i = 1; i < regionsToMerge.length; i++) {
        const nextPoly = regionToPolygon(regionsToMerge[i]);
        if (nextPoly) {
          const result = union(currentUnion, nextPoly);
          if (result && result.length > 0) {
            currentUnion = result;
          }
        }
      }

      // Convert back to coords
      let mergedCoords = polygonToRegionCoords(currentUnion);

      // Let's proceed with what we have.
      if (currentUnion.length > 0) {
        // If disjoint (MultiPolygon), abort merge to prevent data loss
        if (currentUnion.length > 1) {
          console.warn('Cannot merge disjoint regions');
          return;
        }
        // Use the first polygon from the result (usually the merged one)
        mergedCoords = polygonToRegionCoords(currentUnion[0]);
      }

      if (mergedCoords) {
        // Curved parts are thinned (corners kept exactly) and stay smooth.
        const thinned = thinBooleanCoords(mergedCoords, regionsToMerge);
        mergedCoords = thinned.coordinates;

        // Calculate center of the new merged region (for restoration offset)
        const bounds = getRegionBounds({ coordinates: mergedCoords });
        const originCenter = {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2
        };

        const newRegion = {
          regionId: crypto.randomUUID(),
          pageId: currentPageId,
          shapeType: 'polygon',
          operation: REGION_OPERATIONS.ADD,
          coordinates: mergedCoords,
          ...(thinned.smoothVertices ? { smoothVertices: thinned.smoothVertices } : {}),
          sourceRegions: regionsToMerge.map(cloneRegionForHistory),
          originCenter // Save origin center
        };

        // Remove original regions and add new one
        pushUndoSnapshot();
        setRegions(prev => {
          const remaining = prev.filter(r => !mergeIds.has(r.regionId));
          return [...remaining, newRegion];
        });

        // Select the new region
        setSelectedRegionIds(new Set([newRegion.regionId]));
        setContextMenu(null);
      }
    } catch (err) {
      console.error('Merge failed', err);
    }
  }, [contextMenu, selectedRegionIds, regions, currentPageId, getRegionBounds, canMergeRegions, cloneRegionForHistory, pushUndoSnapshot, thinBooleanCoords]);

  const handleSeparateRegion = useCallback(() => {
    const regionId = contextMenu?.regionId || (selectedRegionIds.size === 1 ? Array.from(selectedRegionIds)[0] : null);
    if (!regionId) return;
    const region = regions.find(r => r.regionId === regionId);

    if (!region || !region.sourceRegions || region.sourceRegions.length === 0) return;

    // Calculate current bounds and center
    const currentBounds = getRegionBounds(region);
    if (!currentBounds) return;
    
    const currentCenter = {
      x: (currentBounds.minX + currentBounds.maxX) / 2,
      y: (currentBounds.minY + currentBounds.maxY) / 2
    };

    // Calculate original bounds from sourceRegions (the bounds they had when merged)
    // We need to find the bounding box of all source regions at merge time
    let originMinX = Infinity, originMinY = Infinity, originMaxX = -Infinity, originMaxY = -Infinity;
    region.sourceRegions.forEach(sourceRegion => {
      const bounds = getRegionBounds(sourceRegion);
      if (bounds) {
        originMinX = Math.min(originMinX, bounds.minX);
        originMinY = Math.min(originMinY, bounds.minY);
        originMaxX = Math.max(originMaxX, bounds.maxX);
        originMaxY = Math.max(originMaxY, bounds.maxY);
      }
    });

    // If we have originCenter, use it to calculate the original center
    // Otherwise, calculate from the source regions' bounds
    const originCenter = region.originCenter || {
      x: (originMinX + originMaxX) / 2,
      y: (originMinY + originMaxY) / 2
    };

    // Calculate original bounds dimensions
    const originWidth = originMaxX - originMinX;
    const originHeight = originMaxY - originMinY;
    
    // Calculate current bounds dimensions
    const currentWidth = currentBounds.maxX - currentBounds.minX;
    const currentHeight = currentBounds.maxY - currentBounds.minY;

    // Calculate scale factors (avoid division by zero)
    const scaleX = originWidth > 0 ? currentWidth / originWidth : 1;
    const scaleY = originHeight > 0 ? currentHeight / originHeight : 1;

    // Calculate translation (center movement)
    const dx = currentCenter.x - originCenter.x;
    const dy = currentCenter.y - originCenter.y;

    // Restore source regions with full transformation (scale + translation)
    const restoredRegions = region.sourceRegions.map(sourceRegion => {
      // Apply transformation: scale around origin center, then translate
      const newCoords = sourceRegion.coordinates.map((val, idx) => {
        if (idx % 2 === 0) {
          // X coordinate
          const relativeX = val - originCenter.x;
          return originCenter.x + relativeX * scaleX + dx;
        } else {
          // Y coordinate
          const relativeY = val - originCenter.y;
          return originCenter.y + relativeY * scaleY + dy;
        }
      });

      return {
        ...sourceRegion,
        coordinates: newCoords,
        regionId: crypto.randomUUID()
      };
    });

    pushUndoSnapshot();
    setRegions(prev => {
      const remaining = prev.filter(r => r.regionId !== regionId);
      return [...remaining, ...restoredRegions];
    });

    setSelectedRegionIds(new Set(restoredRegions.map(r => r.regionId)));
    setContextMenu(null);
  }, [contextMenu, selectedRegionIds, regions, getRegionBounds, pushUndoSnapshot]);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Owner 2026-10-01 (Spaces toolbar): the app's keys while editing areas —
  // V = Select and E = Erase (as everywhere), Esc = drop the shape being
  // drawn (or put a half-dragged area back), else let go of the picked areas,
  // else leave without saving (with Undo on a toast), and Enter = leave,
  // keeping the areas (owner 2026-10-26: no Cancel or Done buttons). Read through a ref so the listener below never re-subscribes (its
  // cleanup clears the held Shift / Alt / Space state).
  const keyboardActionsRef = useRef({});
  keyboardActionsRef.current = {
    chooseToolType,
    leave: handleLeave,
    discard: handleDiscard,
    abandon: abandonTouchInteraction,
    busy: isDrawing || interactionState !== null || marquee !== null,
    hasSelection: selectedRegionIds.size > 0,
    contextMenuOpen: contextMenu !== null,
    closeContextMenu: () => setContextMenu(null),
    clearSelection: () => setSelectedRegionIds(new Set()),
    selectAll: () => setSelectedRegionIds(new Set(regionsRef.current.map((r) => r.regionId))),
    copy: handleCopy,
    cut: handleCut,
    paste: pasteAreasFromKeys,
    duplicate: duplicatePickedAreas,
    nudge: nudgePickedAreas,
    deleteSelected: handleDeleteSelected,
    polygonCorners: polyCorners.length,
    finishPolygon: () => commitPolygonRef.current?.(polyCornersRef.current),
    dropPolygon,
    undoPolygonCorner: () => setPolyCorners((prev) => {
      const next = prev.slice(0, -1);
      if (next.length === 0) setPolyHover(null);
      return next;
    }),
  };

  // Track keyboard modifiers (Shift, Option/Alt, Space) for mode override
  useEffect(() => {
    // Only the front tab answers keys (docs/TAB-SWITCHING.md S6): Ctrl+Z or
    // Escape in the front tab used to act on a region tool left open behind.
    if (!active || !tabActive) return;

    const handleKeyDown = (event) => {
      const key = event.key?.toLowerCase?.();
      // KAL-301 REDO: never hijack undo/redo while the user is typing in an
      // input (e.g. the rotation pill) — let the field's native undo work.
      const inEditableTarget = isEditableKeyboardTarget();
      // KAL-301 follow-up: app-wide hotkey standard (owner decision) —
      // UNDO = Cmd/Ctrl+Z; REDO = Cmd/Ctrl+Shift+Z OR Cmd/Ctrl+Y. Shared
      // predicates with PDFViewer's global handler (utils/undoRedoHotkeys.js)
      // so the two surfaces can't drift.
      const isUndoShortcut = !inEditableTarget && isUndoKeyEvent(event);
      const isRedoShortcut = !inEditableTarget && isRedoKeyEvent(event);
      if (isRedoShortcut) {
        stopRegionKeyboardShortcut(event);
        redoLastRegionEdit();
        return;
      }
      if (isUndoShortcut) {
        stopRegionKeyboardShortcut(event);
        undoLastRegionEdit();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey &&
        !inEditableTarget &&
        ['a', 'c', 'x', 'v', 'd'].includes(key) &&
        !document.activeElement?.closest?.('[role="dialog"], [role="menu"], [role="alertdialog"]')
      ) {
        const actions = keyboardActionsRef.current;
        if (actions.busy) return;
        stopRegionKeyboardShortcut(event);
        if (key === 'a') actions.selectAll();
        else if (key === 'c') actions.copy();
        else if (key === 'x') actions.cut();
        else if (key === 'v') actions.paste();
        else actions.duplicate();
        return;
      }
      if (
        event.key?.startsWith?.('Arrow') &&
        !event.metaKey && !event.ctrlKey && !event.altKey &&
        !inEditableTarget &&
        !document.activeElement?.closest?.('[role="dialog"], [role="menu"], [role="alertdialog"], [role="radiogroup"], [role="slider"]')
      ) {
        const actions = keyboardActionsRef.current;
        if (actions.hasSelection && !actions.busy && !actions.contextMenuOpen && actions.polygonCorners === 0) {
          stopRegionKeyboardShortcut(event);
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === 'ArrowLeft' ? -step : (event.key === 'ArrowRight' ? step : 0);
          const dy = event.key === 'ArrowUp' ? -step : (event.key === 'ArrowDown' ? step : 0);
          actions.nudge(dx, dy);
          return;
        }
      }
      if (
        key === 'v' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableKeyboardTarget()
      ) {
        stopRegionKeyboardShortcut(event);
        keyboardActionsRef.current.chooseToolType?.('move');
        return;
      }
      if (
        key === 'e' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableKeyboardTarget()
      ) {
        stopRegionKeyboardShortcut(event);
        keyboardActionsRef.current.chooseToolType?.(ERASE_TOOL_TYPE);
        return;
      }
      // Owner 2026-10-22: a polygon being drawn answers Enter (close it),
      // Escape (drop it) and Backspace / Delete (take back the last corner),
      // as Bluebeam's polygon and Photoshop's Polygonal Lasso do. With no
      // polygon going, Delete or Backspace deletes the picked areas
      // (Bluebeam: select the Space and press Delete).
      if (
        !event.metaKey && !event.ctrlKey && !event.altKey &&
        !event.isComposing &&
        !isEditableKeyboardTarget() &&
        ['Enter', 'Escape', 'Backspace', 'Delete'].includes(event.key)
      ) {
        const actions = keyboardActionsRef.current;
        // A focused dialog or menu keeps its own Enter while a polygon is
        // going.
        const focusOwnsEnter = event.key === 'Enter' &&
          !!document.activeElement?.closest?.('[data-area-actions], [data-mobile-tool-properties], [role="dialog"], [role="menu"], [role="alertdialog"]');
        if (actions.polygonCorners > 0 && !focusOwnsEnter) {
          stopRegionKeyboardShortcut(event);
          if (event.key === 'Enter') actions.finishPolygon();
          else if (event.key === 'Escape') actions.dropPolygon();
          else actions.undoPolygonCorner();
          return;
        }
        if (
          (event.key === 'Delete' || event.key === 'Backspace') &&
          actions.hasSelection && !actions.busy && !actions.contextMenuOpen &&
          !document.activeElement?.closest?.('[role="dialog"], [role="menu"], [role="alertdialog"]')
        ) {
          stopRegionKeyboardShortcut(event);
          actions.deleteSelected?.();
          return;
        }
      }
      if (
        event.key === 'Escape' &&
        !event.metaKey && !event.ctrlKey && !event.altKey &&
        !isEditableKeyboardTarget()
      ) {
        const actions = keyboardActionsRef.current;
        if (actions.contextMenuOpen) {
          stopRegionKeyboardShortcut(event);
          actions.closeContextMenu();
        } else if (actions.busy) {
          stopRegionKeyboardShortcut(event);
          actions.abandon();
        } else if (actions.hasSelection) {
          stopRegionKeyboardShortcut(event);
          actions.clearSelection();
        } else if (!document.activeElement?.closest?.('[role="dialog"], [role="menu"], [role="alertdialog"]')) {
          stopRegionKeyboardShortcut(event);
          actions.discard();
        }
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
        !event.isComposing &&
        !isEditableKeyboardTarget() &&
        // The phone's area strip, a dialog or a menu answer Enter
        // themselves. Any other button merely kept focus after a click (a
        // tool, or the Spaces panel's edit button, which would otherwise
        // toggle the session off), so Enter leaves, keeping the areas.
        !document.activeElement?.closest?.('[data-area-actions], [data-mobile-tool-properties], [role="dialog"], [role="menu"], [role="alertdialog"]')
      ) {
        const actions = keyboardActionsRef.current;
        if (actions.contextMenuOpen || actions.busy) return;
        stopRegionKeyboardShortcut(event);
        actions.leave();
        return;
      }
      // Shift forces additive mode
      if (event.shiftKey) {
        setIsShiftPressed(true);
      }
      // Option (Mac) or Alt (Windows/Linux) forces subtractive mode
      if (event.altKey) {
        setIsOptionAltPressed(true);
      }
      // Cmd (Mac) or Ctrl (Windows/Linux) for quick select
      if (event.metaKey || event.ctrlKey) {
        setIsCmdCtrlPressed(true);
      }
      // Space for pan - allow mouse events to pass through
      if ((event.key === ' ' || event.code === 'Space') && !isEditableKeyboardTarget()) {
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (event) => {
      // Release Shift
      if (!event.shiftKey) {
        setIsShiftPressed(false);
      }
      // Release Option/Alt
      if (!event.altKey) {
        setIsOptionAltPressed(false);
      }
      // Release Cmd/Ctrl
      if (!event.metaKey && !event.ctrlKey) {
        setIsCmdCtrlPressed(false);
      }
      // Release Space
      if (event.key === ' ' || event.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      setIsShiftPressed(false);
      setIsOptionAltPressed(false);
      setIsCmdCtrlPressed(false);
      isSpacePressedRef.current = false;
      setIsSpacePressed(false);
    };
  }, [active, tabActive, undoLastRegionEdit, redoLastRegionEdit]);

  useEffect(() => {
    if (!active || !targetElement) return;

    const handleDocumentPointerDown = (event) => {
      // Desktop: a click (mouse or pen) outside the page and the area chrome
      // leaves the tool, keeping the areas (owner 2026-10-26; it used to throw
      // them away). Touch users must be able to operate mobile chrome and
      // backdrops without ending the session before the tapped control
      // receives its click.
      if (mobileMode || event.pointerType === 'touch') return;
      if (targetElement.contains(event.target)) {
        return;
      }
      if (containerRef.current && containerRef.current.contains(event.target)) {
        return;
      }
      if (event.target.closest('[data-region-selection-ui="true"]')) {
        return;
      }
      // KAL-301 follow-up: the app chrome's Undo/Redo cluster drives the
      // REGION history while this tool is active — clicking those buttons
      // must not cancel the edit session.
      if (event.target.closest('[data-undo-redo-controls="true"]')) {
        return;
      }
      // Owner 2026-10-01: "I need to be able to scroll and pan and zoom when
      // I'm in spaces mode ... click around". The zoom / fit / page controls
      // and the page area itself (other pages, the gaps between them, the
      // scroll bars) no longer throw the unsaved areas away.
      if (event.target.closest(REGION_EDIT_PASS_THROUGH_CHROME)) {
        return;
      }
      // Owner 2026-10-01 (Spaces toolbar): the area tools and actions now live
      // in the app's tool bar and its row 2, and Pan and zoom stay usable, so
      // pressing those must not end the session either.
      if (event.target.closest('[data-tool-toolbar="true"], #chrome-sub-toolbar-host, #chrome-right-host [aria-label*="zoom" i]')) {
        return;
      }
      if (event.target.closest('.survey-pdfjs-viewer')) {
        return;
      }
      // The Spaces panel's edit button leaves (or switches page) on its own
      // click.
      if (event.target.closest('.spaces-region__edit')) {
        return;
      }
      handleLeave();
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    };
  }, [active, targetElement, handleLeave, mobileMode]);

  // Latest handlers for the document capture listeners below. The listeners
  // are bound once per session: re-binding them on every render (the handlers
  // change with each pointer move) used to reset the drag flag in the cleanup
  // mid-gesture, which on the phone - where every page touch takes this path -
  // dropped the rest of a drag.
  const documentFallbackHandlersRef = useRef(null);
  documentFallbackHandlersRef.current = {
    down: handleMouseDown,
    move: handleMouseMove,
    up: handleMouseUp,
    cancel: handlePointerCancel,
    within: isPointWithinTargetRect,
    abandon: abandonTouchInteraction,
  };

  useEffect(() => {
    if (!active || !targetElement) return;
    const handlers = () => documentFallbackHandlersRef.current;

    // Only a press on the page itself (inside the PDF scroller) may start a
    // region gesture. Without this, a tap on chrome that overlaps a zoomed
    // page (the dock, the header, the space chip) started a draw too.
    const pageScroller = targetElement.closest?.('.survey-pdfjs-viewer') || null;

    // Space held: the viewer's hand-pan owns the press (its scroller listener
    // pans; this tool must not start a draw or a drag underneath it).
    const spacePanArmed = () => (
      isSpacePressedRef.current ||
      pageScroller?.dataset?.spacePan === 'armed' ||
      pageScroller?.dataset?.spacePan === 'dragging'
    );

    const handleDocumentPointerDownCapture = (event) => {
      if (activeTool === 'pan') return;
      if (spacePanArmed()) return;
      if (
        mobileMode &&
        activePointerIdRef.current !== null &&
        Number.isFinite(event.pointerId) &&
        event.pointerId !== activePointerIdRef.current
      ) {
        // Second finger: hand the gesture to the viewer's pinch / two-finger
        // pan. Not stopped, so the viewer sees it.
        handlers().abandon();
        return;
      }
      if (documentDragFallbackRef.current) return;
      if (containerRef.current && containerRef.current.contains(event.target)) return;
      if (event.target?.closest?.('[data-region-selection-ui="true"]')) return;
      if (pageScroller && !pageScroller.contains(event.target)) return;
      if (!handlers().within(event.clientX, event.clientY)) return;

      documentDragFallbackRef.current = true;
      handlers().down(event);
    };

    const handleDocumentPointerMoveCapture = (event) => {
      if (!documentDragFallbackRef.current) return;
      handlers().move(event);
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDocumentPointerUpCapture = (event) => {
      if (!documentDragFallbackRef.current) return;
      documentDragFallbackRef.current = false;
      handlers().up(event);
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDocumentPointerCancelCapture = (event) => {
      if (!documentDragFallbackRef.current) return;
      documentDragFallbackRef.current = false;
      handlers().cancel(event);
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('pointerdown', handleDocumentPointerDownCapture, true);
    document.addEventListener('pointermove', handleDocumentPointerMoveCapture, true);
    document.addEventListener('pointerup', handleDocumentPointerUpCapture, true);
    document.addEventListener('pointercancel', handleDocumentPointerCancelCapture, true);

    return () => {
      documentDragFallbackRef.current = false;
      document.removeEventListener('pointerdown', handleDocumentPointerDownCapture, true);
      document.removeEventListener('pointermove', handleDocumentPointerMoveCapture, true);
      document.removeEventListener('pointerup', handleDocumentPointerUpCapture, true);
      document.removeEventListener('pointercancel', handleDocumentPointerCancelCapture, true);
    };
  }, [active, targetElement, activeTool, mobileMode]);

  // KAL-301 REDO: live rotation preview transform. While a rotate drag is in
  // flight the selected region AND its full selection chrome (boundary box,
  // every grabber, the mtr handle + stem) render inside a rotation — the
  // exact mechanism SVGSelectionOverlay uses (`<g transform="rotate(a,cx,cy)">`)
  // so a rotating region is indistinguishable from a rotating rectangle
  // annotation. Coords stay untouched until mouse-up.
  //
  // KAL-301 follow-up (persisted rotation): the SHAPE's coords already carry
  // the persisted base rotation baked in, so its live preview rotates only by
  // the DELTA (liveRotationAngle - baseRotation). The CHROME is derived from
  // the un-rotated geometry (deriveRegionChromeGeometry) and renders at the
  // full display angle — liveRotationAngle during a drag, region.rotation
  // when static — which is what keeps the box tilted after release.
  const isRotatingRegion = (
    interactionState?.type === 'rotate' &&
    liveRotationAngle !== null &&
    !!interactionState.center
  );
  const rotationCenterScreen = isRotatingRegion
    ? {
        x: pageToScreenX(interactionState.center.cx),
        y: pageToScreenY(interactionState.center.cy)
      }
    : null;
  const rotationPreviewSvgTransform = isRotatingRegion
    ? `rotate(${liveRotationAngle - (interactionState.baseRotation || 0)} ${rotationCenterScreen.x} ${rotationCenterScreen.y})`
    : undefined;
  const rotatingRegionId = isRotatingRegion ? interactionState.regionId : null;

  // Chrome display geometry for a (possibly rotated) region: tilted box +
  // handle positions in un-rotated space, rendered inside rotate(displayAngle).
  const getChromeDisplay = (region) => {
    const chrome = deriveRegionChromeGeometry(region.coordinates, getRegionRotation(region));
    if (!chrome) return null;
    const displayAngle = region.regionId === rotatingRegionId
      ? liveRotationAngle
      : chrome.rotation;
    return {
      ...chrome,
      displayAngle,
      centerScreen: {
        x: pageToScreenX(chrome.center.cx),
        y: pageToScreenY(chrome.center.cy)
      }
    };
  };

  // Phone handle: a 44px see-through pad centred on the corner, carrying the
  // usual small dot, so a fingertip that lands near the dot still grabs it.
  const touchHandlePadStyle = (cx, cy) => ({
    position: 'absolute',
    left: `${cx}px`,
    top: `${cy}px`,
    width: `${TOUCH_HANDLE_HIT_PX}px`,
    height: `${TOUCH_HANDLE_HIT_PX}px`,
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    pointerEvents: 'auto',
    touchAction: 'none',
    zIndex: 100003
  });
  const touchHandleDotStyle = ({ width, height, borderRadius }) => ({
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius,
    background: REGION_HANDLE_FILL,
    border: `1px solid ${REGION_HANDLE_STROKE}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
    pointerEvents: 'none'
  });

  if (!active) return null;

  return (
    <>
      {/* Canvas Interaction Layer. Rendered INSIDE the page (the region
          target) so the page and its areas move and scale together in the
          same frame on every scroll, pan and pinch, and so wheel scroll,
          trackpad pan and ctrl/cmd+wheel zoom over an area reach the PDF
          viewer like anywhere else on the page. */}
      {canvasRect && targetElement && createPortal((
          <div
            ref={containerRef}
            data-region-selection-ui="true"
            data-region-edit-layer="true"
            onContextMenu={handleContextMenu}
            onDoubleClick={handleLayerDoubleClick}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              zIndex: 100000,
              // Desktop drawing: the crosshair with its Add / Subtract badge as
              // one cursor image (owner 2026-10-02; utils/areaDrawCursor.js).
              cursor: effectiveToolType === 'move' || !isCursorOverCanvas
                ? 'default'
                : (effectiveToolType === 'polygon' && polyCorners.length > 0 && polyOnCheck)
                  ? 'pointer'
                : ((!mobileMode && DRAW_TOOL_TYPES.has(effectiveToolType))
                  ? areaDrawCursor(drawMode === REGION_OPERATIONS.SUBTRACT ? 'subtract' : 'add')
                  : (effectiveToolType === ERASE_TOOL_TYPE && !mobileMode ? areaDrawCursor('erase') : 'crosshair')),
              // Phone: the layer is see-through to touches. A finger on the page
              // lands in the PDF viewer, so two fingers pinch and pan it as
              // everywhere else in the app, and this tool picks the one-finger
              // press up in its document listener (handleDocumentPointerDownCapture).
              // Only the handles below take touches themselves.
              // Space held (hand-pan) also lets the press through to the viewer.
              pointerEvents: (activeTool === 'pan' || mobileMode || isSpacePressed) ? 'none' : 'auto', // Allow events to pass through when pan is active
              touchAction: 'none',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none'
            }}
            {...(activeTool === 'pan' ? {} : {
              onPointerDown: handleMouseDown,
              onPointerMove: handleMouseMove,
              onPointerUp: handleMouseUp,
              onPointerCancel: handlePointerCancel,
              onPointerLeave: handleCanvasMouseLeave
            })}
          >
          <svg
            ref={overlaySvgRef}
            width={canvasRect.width}
            height={canvasRect.height}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: 'none',
              // KAL-301 REDO: the mtr rotation handle sits above the bbox top
              // edge — keep it visible when the shape is near the canvas top.
              overflow: 'visible'
            }}
          >
            {toolType === 'rectangular' && currentRect && (
              <rect
                data-region-draft=""
                x={pageToScreenX(currentRect.x)}
                y={pageToScreenY(currentRect.y)}
                width={currentRect.width * displayScaleX}
                height={currentRect.height * displayScaleY}
                fill={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "rgba(226, 74, 74, 0.12)" : "rgba(74, 144, 226, 0.12)"}
                stroke={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "#E24A4A" : "#4A90E2"}
                strokeWidth="2"
                strokeDasharray="8 6"
              />
            )}

            {marquee?.shown && (() => {
              const box = regionMarqueeRect(marquee.start, marquee.end);
              const crossing = marquee.direction === 'crossing';
              return (
                <rect
                  data-region-marquee={crossing ? 'crossing' : 'window'}
                  x={pageToScreenX(box.left)}
                  y={pageToScreenY(box.top)}
                  width={(box.right - box.left) * displayScaleX}
                  height={(box.bottom - box.top) * displayScaleY}
                  fill={crossing ? 'rgba(0, 200, 100, 0.15)' : 'rgba(0, 100, 255, 0.15)'}
                  stroke={crossing ? 'rgba(0, 200, 100, 0.8)' : 'rgba(0, 100, 255, 0.8)'}
                  strokeWidth={1}
                  strokeDasharray={crossing ? '5,5' : undefined}
                />
              );
            })()}

            {polygonPreviewPath && (
              <path
                d={polygonPreviewPath}
                fill={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "rgba(226, 74, 74, 0.12)" : "rgba(74, 144, 226, 0.12)"}
                stroke={effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT ? "#E24A4A" : "#4A90E2"}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {toolType === 'polygon' && polyCorners.length > 0 && (() => {
              const subtract = drawMode === REGION_OPERATIONS.SUBTRACT;
              const ink = subtract ? '#E24A4A' : '#4A90E2';
              const pts = polyCorners.map((point) => ({ x: pageToScreenX(point.x), y: pageToScreenY(point.y) }));
              const hover = polyHover ? { x: pageToScreenX(polyHover.x), y: pageToScreenY(polyHover.y) } : null;
              const closing = Boolean(hover && pts.length >= REGION_POLYGON_MIN_CORNERS && hover.x === pts[0].x && hover.y === pts[0].y);
              const ring = [...pts, ...(hover && !closing ? [hover] : [])];
              const d = ring.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
              // The Polygon markup tool's check marks (SVGAnnotationLayer):
              // first corner closes, latest corner finishes; both from three
              // corners. Presses on them are read in handleMouseDown.
              const showChecks = pts.length >= REGION_POLYGON_MIN_CORNERS;
              const tickR = 4.6;
              const check = (point, action) => (
                <g key={action} data-region-polygon-check={action}>
                  <circle cx={point.x} cy={point.y} r={POLY_FINISH_CONTROL_SCREEN_RADIUS} fill={subtract ? ink : POLY_FINISH_CONTROL_FILL} stroke={HANDLE_FILL} strokeWidth={2} />
                  <path
                    d={`M ${point.x - tickR} ${point.y + tickR * 0.05} L ${point.x - tickR * 0.26} ${point.y + tickR * 0.72} L ${point.x + tickR * 1.05} ${point.y - tickR * 0.85}`}
                    fill="none"
                    stroke={HANDLE_FILL}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
              return (
                <g data-region-polygon-preview="true">
                  {ring.length > 2 && <path d={`${d} Z`} fill={subtract ? 'rgba(226, 74, 74, 0.12)' : 'rgba(74, 144, 226, 0.12)'} stroke="none" />}
                  <path d={d} fill="none" stroke={ink} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {ring.length > 2 && (
                    <path d={`M ${ring[ring.length - 1].x} ${ring[ring.length - 1].y} L ${pts[0].x} ${pts[0].y}`} fill="none" stroke={ink} strokeWidth="1.5" strokeDasharray="6 5" opacity="0.7" />
                  )}
                  {pts.map((point, index) => (
                    <circle key={index} cx={point.x} cy={point.y} r={3.5} fill="#fff" stroke={ink} strokeWidth="1.5" />
                  ))}
                  {showChecks && check(pts[0], 'close')}
                  {showChecks && check(pts[pts.length - 1], 'finish')}
                </g>
              );
            })()}

            {/* Render unified path for all regions to show them as merged */}
            {(() => {
              // Calculate union of all regions for visual display
              // This ensures overlapping regions look like a single shape
              try {
                // KAL-301 REDO: while a region is mid-rotation it renders with
                // a live rotate() transform — drop it from the static union so
                // an unrotated ghost copy doesn't linger underneath.
                const additiveRegions = regions.filter(r => (
                  (!r.operation || r.operation === REGION_OPERATIONS.ADD) &&
                  r.regionId !== rotatingRegionId
                ));
                const subtractiveRegions = regions.filter(r => r.operation === REGION_OPERATIONS.SUBTRACT);

                let mergedPolygons = [];

                // Union all additive regions
                for (const region of additiveRegions) {
                  // Curved areas: union the same smooth outline that is drawn.
                  const poly = regionToPolygon(withRegionOutlineCoordinates(region));
                  if (!poly) continue;

                  if (mergedPolygons.length === 0) {
                    mergedPolygons = [poly];
                  } else {
                    try {
                      // Ensure poly is treated as MultiPolygon (array of polygons)
                      // regionToPolygon returns [Polygon], so it is compatible
                      const result = union(mergedPolygons, poly);
                      if (result && result.length > 0) {
                        mergedPolygons = result;
                      } else {
                        mergedPolygons.push(poly[0]);
                      }
                    } catch (e) {
                      console.error('Error unioning regions for visual:', e);
                      mergedPolygons.push(poly[0]);
                    }
                  }
                }

                // Subtract subtractive regions
                // (Optional: if we want to show holes visually during selection)
                // For now, let's just show additive regions merged.

                // Generate path
                let unifiedPath = '';
                if (mergedPolygons.length > 0) {
                  mergedPolygons.forEach(polygon => {
                    unifiedPath += polygonToPath(polygon);
                  });
                }

                if (unifiedPath) {
                  return (
                    <path
                      data-region-area-outline="true"
                      d={unifiedPath}
                      fill="rgba(74, 144, 226, 0.22)"
                      fillRule="evenodd"
                      stroke="#4A90E2"
                      strokeWidth="2"
                      style={{ pointerEvents: 'none' }} // Visual only
                    />
                  );
                }
              } catch (e) {
                console.error('Error generating unified path:', e);
              }
              return null;
            })()}

            {regions.map(region => {
              const path = buildRegionPath(region);
              if (!path) return null;
              const isSelected = selectedRegionIds.has(region.regionId);

              // If selected, render with distinct style (on top)
              // If not selected, render transparently for hit testing (visual is handled by unified path)

              if (isSelected) {
                const selectedPath = (
                  <path
                    key={region.regionId}
                    data-region-id={region.regionId}
                    data-region-vertex-count={region.coordinates.length / 2}
                    d={path}
                    fill="rgba(245, 166, 35, 0.18)"
                    stroke="#F5A623"
                    strokeWidth={2.5}
                    style={{
                      pointerEvents: effectiveToolType === 'move' && !mobileMode ? 'visiblePainted' : 'none',
                      cursor: effectiveToolType === 'move' ? 'move' : 'default'
                    }}
                    onPointerDown={effectiveToolType === 'move' ? (event) => handleRegionPointerDown(region, event) : undefined}
                  />
                );
                // KAL-301 REDO: live rotation preview — shape rotates via
                // transform (coords untouched until mouse-up bake).
                if (region.regionId === rotatingRegionId) {
                  return (
                    <g key={region.regionId} transform={rotationPreviewSvgTransform}>
                      {selectedPath}
                    </g>
                  );
                }
                return selectedPath;
              } else {
                return (
                  <path
                    key={region.regionId}
                    data-region-id={region.regionId}
                    data-region-vertex-count={region.coordinates.length / 2}
                    d={path}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={10} // Wider stroke for easier selection
                    style={{
                      pointerEvents: effectiveToolType === 'move' && !mobileMode ? 'all' : 'none',
                      cursor: effectiveToolType === 'move' ? 'move' : 'default'
                    }}
                    onPointerDown={effectiveToolType === 'move' ? (event) => handleRegionPointerDown(region, event) : undefined}
                  />
                );
              }
            })}

            {/* Several areas picked: one dashed box round them all, like a
                pick of several marks. A press inside it moves them all. */}
            {editsPicked && selectedRegionIds.size > 1 && (() => {
              let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
              for (const region of regions) {
                if (!selectedRegionIds.has(region.regionId)) continue;
                const b = getRegionBounds(region);
                if (!b) continue;
                minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
                maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
              }
              if (!Number.isFinite(minX)) return null;
              return (
                <rect
                  data-region-group-box="true"
                  x={pageToScreenX(minX)}
                  y={pageToScreenY(minY)}
                  width={(maxX - minX) * displayScaleX}
                  height={(maxY - minY) * displayScaleY}
                  fill="none"
                  stroke={REGION_HANDLE_BLUE}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              );
            })()}

            {/* KAL-301 REDO: rotation handle (mtr) — a faithful copy of the
                day-one chrome in SVGSelectionOverlay.jsx (no connector line
                since 2026-10-02): white-fill/blue-ring
                circle (r = rotationR), rotate icon at 70% of the circle
                diameter, the turn grabber's cursor, drop shadow. data-rotation-handle
                ="mtr" is what RotationInputField anchors to. The whole group
                rotates with the shape during a rotate drag, exactly like the
                standard overlay's rotated <g>. */}
            {editsPicked && selectedRegionIds.size === 1 && (() => {
              const selectedRegion = regions.find(r => r.regionId === Array.from(selectedRegionIds)[0]);
              if (!selectedRegion) return null;
              // KAL-301 follow-up: tilted-chrome geometry — un-rotated box
              // rendered inside rotate(displayAngle, center), exactly like
              // SVGSelectionOverlay renders a previously-rotated annotation.
              const chrome = getChromeDisplay(selectedRegion);
              if (!chrome) return null;
              const { bounds, displayAngle, centerScreen } = chrome;

              const left = pageToScreenX(bounds.minX);
              const top = pageToScreenY(bounds.minY);
              const width = (bounds.maxX - bounds.minX) * displayScaleX;
              const height = (bounds.maxY - bounds.minY) * displayScaleY;

              // Region overlay coords are already screen pixels → inverseScale 1.
              const metrics = getSelectionHandleVisualMetrics(1);
              const spec = getAdaptiveSelectionHandleSpec({
                bboxWidth: width,
                bboxHeight: height,
                inverseScale: 1,
                padding: 0
              });

              const mtX = left + width / 2;
              const mtrY = top - spec.rotationOffset;

              return (
                <g transform={displayAngle ? `rotate(${displayAngle} ${centerScreen.x} ${centerScreen.y})` : undefined}>
                  <g
                    className="rotation-handle"
                    data-rotation-handle="mtr"
                    onPointerEnter={handleRotHandleHoverEnter}
                    onPointerLeave={handleRotHandleHoverLeave}
                  >
                    {/* UX 2026-10-02 (owner): no connector line to the box
                        (same as annotations); position and hit area unchanged. */}
                    {/* Phone: a 44px invisible hit circle around the small dot. */}
                    {mobileMode && (
                      <circle
                        cx={mtX}
                        cy={mtrY}
                        r={TOUCH_HANDLE_HIT_PX / 2}
                        fill="transparent"
                        data-handle-hit-pad="true"
                        style={{ pointerEvents: 'auto' }}
                        onPointerDown={(event) => handleRotatePointerDown(selectedRegion, event)}
                      />
                    )}
                    {/* Rotation circle */}
                    <circle
                      cx={mtX}
                      cy={mtrY}
                      r={metrics.rotationR}
                      fill={HANDLE_FILL}
                      stroke={HANDLE_RING}
                      strokeWidth={1}
                      style={{
                        filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.1))',
                        cursor: ROTATE_HANDLE_CURSOR,
                        pointerEvents: 'auto'
                      }}
                      onPointerDown={(event) => handleRotatePointerDown(selectedRegion, event)}
                    />
                    {/* Rotation icon image (70% of circle diameter) */}
                    <image
                      href={rotateIconSvg}
                      x={mtX - metrics.rotationIconSize / 2}
                      y={mtrY - metrics.rotationIconSize / 2}
                      width={metrics.rotationIconSize}
                      height={metrics.rotationIconSize}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                </g>
              );
            })()}
          </svg>

          {/* Resize handles for the selected region (ONLY if single selection) */}
          {editsPicked && selectedRegionIds.size === 1 && (() => {
            const selectedRegion = regions.find(r => r.regionId === Array.from(selectedRegionIds)[0]);
            if (!selectedRegion) return null;

            // KAL-301 follow-up: chrome geometry is derived from the
            // un-rotated coords and rendered inside a rotate(displayAngle)
            // wrapper — tilted while rotating AND after release/re-select,
            // same visual contract as SVGSelectionOverlay's rotated <g>.
            const chromeDisplay = getChromeDisplay(selectedRegion);
            if (!chromeDisplay) return null;
            const { displayAngle: chromeAngle, centerScreen: chromeCenterScreen } = chromeDisplay;

            const wrapChrome = (children) => (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  transform: chromeAngle ? `rotate(${chromeAngle}deg)` : undefined,
                  transformOrigin: chromeAngle
                    ? `${chromeCenterScreen.x}px ${chromeCenterScreen.y}px`
                    : undefined
                }}
              >
                {children}
              </div>
            );

            const vertexCount = selectedRegion.coordinates.length / 2;
            // Double-tap / double-click swaps the point handles for a
            // bounding box that scales the whole area.
            const useVertexHandles = vertexCount <= 32 && boxEditRegionId !== selectedRegion.regionId;

            if (useVertexHandles) {
              // Render handles for each vertex (positions in un-rotated
              // space — the rotated wrapper puts them back on the real
              // vertices).
              const bounds = chromeDisplay.bounds;
              const chromeCoords = chromeDisplay.unrotatedCoords;
              const handles = [];
              
              // Add boundary box for vertex handles case
              let boundaryBox = null;
              if (bounds) {
                const left = pageToScreenX(bounds.minX);
                const top = pageToScreenY(bounds.minY);
                const width = (bounds.maxX - bounds.minX) * displayScaleX;
                const height = (bounds.maxY - bounds.minY) * displayScaleY;
                
                boundaryBox = (
                  <div
                    key="boundary-box"
                    onPointerDown={(event) => {
                      // Keep selection when clicking inside boundary box
                      // Allow dragging by not stopping propagation if region is already selected
                      // The handleMouseDown will check if click is inside bounds and keep selection
                      if (selectedRegionIds.has(selectedRegion.regionId)) {
                        // If clicking on an already selected region's boundary box,
                        // trigger the same behavior as clicking on the region path
                        handleRegionPointerDown(selectedRegion, event);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: `${left}px`,
                      top: `${top}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                      background: 'transparent',
                      border: `2px dashed ${REGION_HANDLE_BLUE}`,
                      borderRadius: '0px',
                      // Phone: the box is drawn only; a touch inside it reaches
                      // the page and handleMouseDown drags the area from there.
                      pointerEvents: mobileMode ? 'none' : 'auto',
                      zIndex: 100002,
                      boxSizing: 'border-box',
                      cursor: 'move'
                    }}
                  />
                );
              }
              
              for (let i = 0; i < vertexCount; i++) {
                const x = pageToScreenX(chromeCoords[i * 2]);
                const y = pageToScreenY(chromeCoords[i * 2 + 1]);

                handles.push(mobileMode ? (
                  <div
                    key={`v-${i}`}
                    data-region-vertex-handle={i}
                    data-handle-hit-pad="true"
                    onPointerDown={(event) => handleVertexPointerDown(selectedRegion, i, event)}
                    style={touchHandlePadStyle(x, y)}
                  >
                    <div style={touchHandleDotStyle({ width: HANDLE_RADIUS * 2, height: HANDLE_RADIUS * 2, borderRadius: '50%' })} />
                  </div>
                ) : (
                  <div
                    key={`v-${i}`}
                    data-region-vertex-handle={i}
                    onPointerDown={(event) => handleVertexPointerDown(selectedRegion, i, event)}
                    style={{
                      position: 'absolute',
                      left: `${x}px`,
                      top: `${y}px`,
                      transform: 'translate(-50%, -50%)',
                      width: `${HANDLE_RADIUS * 2}px`,
                      height: `${HANDLE_RADIUS * 2}px`,
                      borderRadius: '50%',
                      background: REGION_HANDLE_FILL,
                      border: `1px solid ${REGION_HANDLE_STROKE}`,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                      cursor: GRAB_HANDLE_CURSOR,
                      pointerEvents: 'auto',
                      zIndex: 100003
                    }}
                  />
                ));
              }

              // Owner 2026-10-28: a plain level rectangle keeps the side
              // grabbers a rectangle markup has (they move that side); any
              // other shape gets the Polygon markup tool's "+" halfway along
              // each side to add a point. Merging a rectangle into another
              // shape turns its side grabbers into "+" grabbers. Sides too
              // short to fit one beside the corner dots get none.
              const plainRect = vertexCount === 4 && !chromeAngle && isLevelRectangle(selectedRegion.coordinates);
              const sideGrabbers = [];
              const sideBounds = plainRect ? getRegionBounds(selectedRegion) : null;
              for (let i = 0; i < vertexCount; i++) {
                const j = (i + 1) % vertexCount;
                const ax = pageToScreenX(chromeCoords[i * 2]);
                const ay = pageToScreenY(chromeCoords[i * 2 + 1]);
                const bx = pageToScreenX(chromeCoords[j * 2]);
                const by = pageToScreenY(chromeCoords[j * 2 + 1]);
                const sideLength = Math.hypot(bx - ax, by - ay);
                const mx = (ax + bx) / 2;
                const my = (ay + by) / 2;
                if (plainRect) {
                  if (sideLength < 44) continue;
                  const level = Math.abs(by - ay) < Math.abs(bx - ax);
                  const sideY = (chromeCoords[i * 2 + 1] + chromeCoords[j * 2 + 1]) / 2;
                  const sideX = (chromeCoords[i * 2] + chromeCoords[j * 2]) / 2;
                  const key = level
                    ? (sideBounds && Math.abs(sideY - sideBounds.minY) < Math.abs(sideY - sideBounds.maxY) ? 'n' : 's')
                    : (sideBounds && Math.abs(sideX - sideBounds.minX) < Math.abs(sideX - sideBounds.maxX) ? 'w' : 'e');
                  const pillWidth = level ? '28px' : '8px';
                  const pillHeight = level ? '8px' : '28px';
                  sideGrabbers.push(mobileMode ? (
                    <div
                      key={`side-${key}`}
                      data-region-resize-handle={key}
                      data-region-side-handle={key}
                      data-handle-hit-pad="true"
                      onPointerDown={(event) => handleResizePointerDown(selectedRegion, key, event)}
                      style={touchHandlePadStyle(mx, my)}
                    >
                      <div style={touchHandleDotStyle({ width: pillWidth, height: pillHeight, borderRadius: '4px' })} />
                    </div>
                  ) : (
                    <div
                      key={`side-${key}`}
                      data-region-resize-handle={key}
                      data-region-side-handle={key}
                      onPointerDown={(event) => handleResizePointerDown(selectedRegion, key, event)}
                      style={{
                        position: 'absolute',
                        left: `${mx}px`,
                        top: `${my}px`,
                        transform: 'translate(-50%, -50%)',
                        width: pillWidth,
                        height: pillHeight,
                        borderRadius: '4px',
                        background: REGION_HANDLE_FILL,
                        border: `1px solid ${REGION_HANDLE_STROKE}`,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                        cursor: resizeHandleCursor(key, 0),
                        pointerEvents: 'auto',
                        zIndex: 100003
                      }}
                    />
                  ));
                  continue;
                }
                // Curved sides get none: their chord midpoint is off the outline.
                if (sideLength < HANDLE_RADIUS * 6 || !isRegionSideStraight(selectedRegion, i)) continue;
                // A small white dot with a blue "+", like the markup tool's.
                const plusSize = Math.round(HANDLE_RADIUS * 1.5);
                const plusBar = Math.max(4, plusSize - 6);
                const plus = (
                  <div
                    aria-hidden="true"
                    style={{
                      ...touchHandleDotStyle({ width: plusSize, height: plusSize, borderRadius: '50%' }),
                      boxSizing: 'border-box',
                      backgroundImage: `linear-gradient(${REGION_HANDLE_STROKE}, ${REGION_HANDLE_STROKE}), linear-gradient(${REGION_HANDLE_STROKE}, ${REGION_HANDLE_STROKE})`,
                      backgroundSize: `${plusBar}px 1px, 1px ${plusBar}px`,
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat'
                    }}
                  />
                );
                sideGrabbers.push(
                  <div
                    key={`add-${i}`}
                    role="button"
                    aria-label="Add point"
                    data-region-add-vertex={i}
                    {...(mobileMode ? { 'data-handle-hit-pad': 'true' } : {})}
                    onPointerDown={(event) => handleAddPointPointerDown(selectedRegion, i, event)}
                    style={mobileMode ? touchHandlePadStyle(mx, my) : {
                      ...touchHandlePadStyle(mx, my),
                      width: `${HANDLE_RADIUS * 3}px`,
                      height: `${HANDLE_RADIUS * 3}px`,
                      cursor: 'crosshair'
                    }}
                  >
                    {plus}
                  </div>
                );
              }
              return wrapChrome(<>{boundaryBox}{sideGrabbers}{handles}</>);
            } else {
              // Render bounding box handles for complex shapes (un-rotated
              // bounds inside the rotated wrapper).
              const bounds = chromeDisplay.bounds;
              if (!bounds) return null;
              const left = pageToScreenX(bounds.minX);
              const top = pageToScreenY(bounds.minY);
              const width = (bounds.maxX - bounds.minX) * displayScaleX;
              const height = (bounds.maxY - bounds.minY) * displayScaleY;

              return wrapChrome(
                <>
                  {/* Selection boundary box - Drawboard style */}
                  <div
                    onPointerDown={(event) => {
                      // Keep selection when clicking inside boundary box
                      // Allow dragging by triggering the same behavior as clicking on the region path
                      if (selectedRegionIds.has(selectedRegion.regionId)) {
                        handleRegionPointerDown(selectedRegion, event);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: `${left}px`,
                      top: `${top}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                      background: 'transparent',
                      border: `2px dashed ${REGION_HANDLE_BLUE}`,
                      borderRadius: '0px',
                      // Phone: the box is drawn only; a touch inside it reaches
                      // the page and handleMouseDown drags the area from there.
                      pointerEvents: mobileMode ? 'none' : 'auto',
                      zIndex: 100002,
                      boxSizing: 'border-box',
                      cursor: 'move'
                    }}
                  />
                  {resizeHandles.map(handle => {
                    const isHorizontalPill = handle.key === 'n' || handle.key === 's';
                    const isVerticalPill = handle.key === 'e' || handle.key === 'w';
                    // Sizes match the SVG selection overlay: 28x8 pills and
                    // HANDLE_RADIUS-based corner dots, so region-edit handles
                    // are the same size as every other handle in the app.
                    const cornerSize = `${HANDLE_RADIUS * 2}px`;
                    const handleWidth = isHorizontalPill ? '28px' : (isVerticalPill ? '8px' : cornerSize);
                    const handleHeight = isHorizontalPill ? '8px' : (isVerticalPill ? '28px' : cornerSize);
                    const handleRadius = isHorizontalPill || isVerticalPill ? '4px' : '50%';
                    if (mobileMode) {
                      return (
                        <div
                          key={handle.key}
                          data-region-resize-handle={handle.key}
                          data-handle-hit-pad="true"
                          onPointerDown={(event) => handleResizePointerDown(selectedRegion, handle.key, event)}
                          style={touchHandlePadStyle(left + (handle.offsetX * width), top + (handle.offsetY * height))}
                        >
                          <div style={touchHandleDotStyle({ width: handleWidth, height: handleHeight, borderRadius: handleRadius })} />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={handle.key}
                        data-region-resize-handle={handle.key}
                        onPointerDown={(event) => handleResizePointerDown(selectedRegion, handle.key, event)}
                        style={{
                          position: 'absolute',
                          left: `${left + (handle.offsetX * width)}px`,
                          top: `${top + (handle.offsetY * height)}px`,
                          transform: 'translate(-50%, -50%)',
                          width: handleWidth,
                          height: handleHeight,
                          borderRadius: handleRadius,
                          background: REGION_HANDLE_FILL,
                          border: `1px solid ${REGION_HANDLE_STROKE}`,
                          boxShadow: isHorizontalPill || isVerticalPill
                            ? '0 2px 4px rgba(0,0,0,0.15)'
                            : '0 1px 3px rgba(0,0,0,0.15)',
                          // Drawboard: the arrow turns with the area.
                          cursor: resizeHandleCursor(handle.key, chromeAngle || 0),
                          pointerEvents: 'auto',
                          zIndex: 100003
                        }}
                      />
                    );
                  })}
                </>
              );
            }
          })()}


          </div>
      ), targetElement)}

      {/* Context menu (outside the page: it is placed in screen px). Owner
          2026-10-27: the mark menu's look (src/styles/annotationContextMenu.css)
          - an icon row for Cut, Copy, Paste and Delete, then Merge and
          Unmerge - not a hand-made list whose greyed items looked live. */}
      {contextMenu && (() => {
        const picked = selectedRegionIds.size > 0;
        const quick = [
          { key: 'cut', label: 'Cut', icon: 'scissors', disabled: !picked, onClick: handleCut },
          { key: 'copy', label: 'Copy', icon: 'copy', disabled: !picked, onClick: handleCopy },
          { key: 'paste', label: 'Paste', icon: 'paste', disabled: false, onClick: handlePaste },
          { key: 'delete', label: 'Delete', icon: 'trash', disabled: !picked, onClick: () => { handleDeleteSelected(); setContextMenu(null); } },
        ];
        const rows = [
          { key: 'merge', label: 'Merge', disabled: !contextMenu.canMerge, onClick: handleMergeSelected },
          { key: 'unmerge', label: 'Unmerge', disabled: !contextMenu.canUnmerge, onClick: handleSeparateRegion },
        ];
        return (
          <div
            data-region-selection-ui="true"
            role="menu"
            aria-label="Area actions"
            className="annotation-context-menu"
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-popover)',
              zIndex: 100004,
              minWidth: 160,
              padding: 4,
              fontSize: 12.5,
              color: 'var(--text-2)',
              fontFamily: 'var(--font-ui)',
              pointerEvents: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div role="group" aria-label="Edit" className="annotation-menu-quick">
              {quick.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  aria-label={item.label}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  className={`annotation-menu-icon${item.key === 'delete' ? ' annotation-menu-icon--danger' : ''}`}
                  onClick={item.disabled ? undefined : item.onClick}
                  {...tip(item.label, 'above')}
                >
                  <Icon name={item.icon} size={16} color="currentColor" />
                </button>
              ))}
            </div>
            <div role="separator" className="annotation-menu-separator" />
            {rows.map((item) => (
              <div
                key={item.key}
                role="menuitem"
                aria-disabled={item.disabled ? 'true' : undefined}
                className="annotation-menu-row"
                onClick={item.disabled ? undefined : item.onClick}
                {...keyboardControlProps(item.disabled ? null : item.onClick, { role: 'menuitem', disabled: item.disabled })}
              >
                {item.label}
              </div>
            ))}
          </div>
        );
      })()}


      {/* KAL-301 REDO: the app's STANDARD rotation pill (RotationInputField,
          EDIT-12) — the same component every other annotation uses, reused
          as-is. It portals into the overlay container, self-positions off the
          mtr handle's rect, live-updates during a rotate drag ("drag wins"),
          and supports typed-angle commits (Enter/blur), arrow-key nudges and
          Escape-cancel. Visibility follows the standard machine: 150ms hover
          intent on the handle, 500ms grace, forced visible while rotating. */}
      {canvasRect && containerRef.current && editsPicked && selectedRegionIds.size === 1 && (() => {
        const selectedRegion = regions.find(r => r.regionId === Array.from(selectedRegionIds)[0]);
        if (!selectedRegion) return null;
        const bounds = getRegionBounds(selectedRegion);
        if (!bounds) return null;

        // KAL-301 follow-up: the pill shows the ABSOLUTE persisted angle
        // (region.rotation), live-following the drag — identical semantics
        // to the standard annotation pill reading obj.angle.
        const liveAngle = isRotatingRegion
          ? normalizeRegionRotation(liveRotationAngle)
          : getRegionRotation(selectedRegion);
        // The overlay svg has no viewBox, so its user units ARE container-local
        // CSS pixels — pass the bbox center in those units.
        const centerLocal = {
          x: pageToScreenX((bounds.minX + bounds.maxX) / 2),
          y: pageToScreenY((bounds.minY + bounds.maxY) / 2)
        };

        return (
          <RotationInputField
            svgRef={overlaySvgRef}
            hostEl={containerRef.current}
            angle={liveAngle}
            annotationIndex={selectedRegion.regionId}
            isRotating={isRotatingRegion}
            isVisible={isRotatingRegion || rotPillVisible}
            shapeCenterViewBox={centerLocal}
            onCommit={handleRotationPillCommit}
            onCancel={handleRotationPillCancel}
            onHoverChange={handleRotationPillHover}
          />
        );
      })()}

    </>
  );
};

export default RegionSelectionTool;
