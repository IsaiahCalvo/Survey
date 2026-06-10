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
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Icon from './Icons';
import { diff, union, intersection } from 'martinez-polygon-clipping';
import { REGION_OPERATIONS, polygonToRegionCoords, regionToPolygon, simplifyPolygon, subtractRegionFromRegion } from './utils/regionMath';
import { calculateViewportSafePosition } from './utils/menuPositioning';
import { HANDLE_FILL, HANDLE_RING, HANDLE_RADIUS } from './utils/handleStyle';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';
const MIN_REGION_SIZE = 5;
const REGION_HANDLE_BLUE = HANDLE_RING;
// Unified white-fill / blue-ring handle look (shared with every other handle).
const REGION_HANDLE_STROKE = HANDLE_RING;
const REGION_HANDLE_FILL = HANDLE_FILL;
const REGION_HISTORY_LIMIT = 100;
const regionEditHistoryStore = new Map();

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
  onRegionComplete,
  onCancel,
  currentSpaceId,
  currentPageId,
  scale = 1,
  pageWidth = 0,
  pageHeight = 0,
  onSetFullPage,
  canSetFullPage = false,
  initialRegions = [],
  activeTool = null // Active tool from parent (e.g., 'pan' when space is held)
}) => {
  const [toolType, setToolType] = useState('rectangular'); // 'rectangular' | 'freehand' | 'move'
  const [selectionMode, setSelectionMode] = useState(REGION_OPERATIONS.ADD); // 'add' | 'subtract'
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [regions, setRegions] = useState(() => []);
  const [selectedRegionIds, setSelectedRegionIds] = useState(() => new Set());
  const [interactionState, setInteractionState] = useState(null);
  const containerRef = useRef(null);
  const [targetElement, setTargetElement] = useState(null);
  const [isCursorOverCanvas, setIsCursorOverCanvas] = useState(false);
  const [canvasRect, setCanvasRect] = useState(null);
  const cursorPositionRef = useRef({ x: 0, y: 0 });
  const addIndicatorRef = useRef(null);
  const subtractIndicatorRef = useRef(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isOptionAltPressed, setIsOptionAltPressed] = useState(false);
  const [isCmdCtrlPressed, setIsCmdCtrlPressed] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [lastDrawingTool, setLastDrawingTool] = useState('rectangular');
  // KAL-301c: live rotation angle shown in the pill during a rotate drag.
  // Null when not rotating (pill hidden). Degrees [0, 360).
  const [liveRotationAngle, setLiveRotationAngle] = useState(null);
  const [isToolDropdownOpen, setIsToolDropdownOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, pageX, pageY, regionId, type, canMerge, canUnmerge }
  const canvasRectRef = useRef(null);
  const lastTargetDebugKeyRef = useRef(null);
  const lastCanvasRectDebugRef = useRef(null);
  const lastTargetQueryDebugRef = useRef(null);
  const regionsRef = useRef([]);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const documentDragFallbackRef = useRef(false);
  // Slice 1 (KAL-301a): tracks whether the current drag interaction actually
  // moved (i.e. coords changed). Undo snapshot is pushed at drag-END only when
  // this is true — one checkpoint per completed drag, not per pixel.
  const dragHasMovedRef = useRef(false);
  const historyKey = useMemo(
    () => getRegionEditHistoryKey(currentSpaceId, currentPageId),
    [currentSpaceId, currentPageId]
  );

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
      return targetElement.getBoundingClientRect();
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

  const clientPointToPage = useCallback((clientX, clientY, rectOverride = null) => {
    const rect = rectOverride || getTargetRect();
    if (!rect) {
      return null;
    }

    return {
      x: (clientX - rect.left) / displayScaleX,
      y: (clientY - rect.top) / displayScaleY
    };
  }, [displayScaleX, displayScaleY, getTargetRect]);


  // Calculate effective tool type (override with Cmd/Ctrl for quick select)
  const effectiveToolType = useMemo(() => {
    // If drawing, don't switch modes to avoid interrupting the drag
    if (isDrawing) return toolType;

    if (isCmdCtrlPressed && (toolType === 'rectangular' || toolType === 'freehand')) {
      return 'move';
    }
    return toolType;
  }, [toolType, isCmdCtrlPressed, isDrawing]);

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

  const persistHistoryStacks = useCallback(() => {
    regionEditHistoryStore.set(historyKey, {
      undo: undoStackRef.current.map(cloneHistorySnapshot),
      redo: redoStackRef.current.map(cloneHistorySnapshot)
    });
  }, [cloneHistorySnapshot, historyKey]);

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
        .filter((node) => node instanceof HTMLElement && node.isConnected);
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

  useEffect(() => {
    if (!active || !targetElement) {
      setCanvasRect(null);
      canvasRectRef.current = null;
      return;
    }

    let frameId = null;
    const rectsMatch = (left, right) => (
      !!left &&
      !!right &&
      Math.abs(left.left - right.left) < 0.25 &&
      Math.abs(left.top - right.top) < 0.25 &&
      Math.abs(left.width - right.width) < 0.25 &&
      Math.abs(left.height - right.height) < 0.25
    );

    const measureRect = () => {
      const rect = targetElement.getBoundingClientRect();
      const nextRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };

      if (!rectsMatch(canvasRectRef.current, nextRect)) {
        canvasRectRef.current = nextRect;
        setCanvasRect(nextRect);
        const debugKey = `${Math.round(nextRect.left)}:${Math.round(nextRect.top)}:${Math.round(nextRect.width)}:${Math.round(nextRect.height)}`;
        if (lastCanvasRectDebugRef.current !== debugKey) {
          lastCanvasRectDebugRef.current = debugKey;
          regionDebug(
            `[RegionSelectionTool p${currentPageId ?? 'unknown'}] canvasRect — ` +
            `left=${Math.round(nextRect.left)}, top=${Math.round(nextRect.top)}, ` +
            `width=${Math.round(nextRect.width)}, height=${Math.round(nextRect.height)}, ` +
            `scale=${Number.isFinite(scale) ? scale.toFixed(5) : scale}`
          );
        }
      }
    };

    const updateRect = () => {
      measureRect();
      frameId = window.requestAnimationFrame(updateRect);
    };

    updateRect();

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(measureRect);
      resizeObserver.observe(targetElement);
    }

    window.addEventListener('scroll', measureRect, { capture: true, passive: true });
    window.addEventListener('resize', measureRect, { passive: true });

    return () => {
      setCanvasRect(null);
      canvasRectRef.current = null;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('scroll', measureRect, true);
      window.removeEventListener('resize', measureRect);
    };
  }, [active, targetElement, currentPageId, scale]);

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
        setRegions(clonedRegions);
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
        setIsCursorOverCanvas(false);
      }
    } else {
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
      setIsCursorOverCanvas(false);
    }
  }, [active, initialRegions, historyKey, cloneHistorySnapshot, persistHistoryStacks]);

  useEffect(() => {
    setPolygonPoints([]);
    setCurrentRect(null);
    setIsDrawing(false);
    setInteractionState(null);
    setIsCursorOverCanvas(false);
    setIsToolDropdownOpen(false);
    if (toolType !== 'move') {
      setSelectedRegionIds(new Set());
    }
  }, [toolType]);

  useEffect(() => {
    if (regions.length === 0) {
      setSelectedRegionIds(new Set());
      setInteractionState(null);
    }
  }, [regions.length]);

  useEffect(() => {
    if (toolType !== 'move') {
      return;
    }

    // When switching to move mode, select the first region if none selected
    setSelectedRegionIds(prevIds => {
      if (prevIds.size > 0) {
        // Filter out IDs that no longer exist
        const validIds = new Set([...prevIds].filter(id => regions.some(r => r.regionId === id)));
        if (validIds.size > 0) return validIds;
      }

      // If no valid selection, select the first region
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

  const resizeHandles = useMemo(() => ([
    { key: 'nw', cursor: 'nwse-resize', offsetX: 0, offsetY: 0 },
    { key: 'n', cursor: 'ns-resize', offsetX: 0.5, offsetY: 0 },
    { key: 'ne', cursor: 'nesw-resize', offsetX: 1, offsetY: 0 },
    { key: 'e', cursor: 'ew-resize', offsetX: 1, offsetY: 0.5 },
    { key: 'se', cursor: 'nwse-resize', offsetX: 1, offsetY: 1 },
    { key: 's', cursor: 'ns-resize', offsetX: 0.5, offsetY: 1 },
    { key: 'sw', cursor: 'nesw-resize', offsetX: 0, offsetY: 1 },
    { key: 'w', cursor: 'ew-resize', offsetX: 0, offsetY: 0.5 }
  ]), []);

  const buildRegionPath = useCallback((region) => {
    if (!region || !Array.isArray(region.coordinates)) {
      return null;
    }

    const points = [];
    for (let i = 0; i < region.coordinates.length; i += 2) {
      const x = region.coordinates[i];
      const y = region.coordinates[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      points.push({
        x: pageToScreenX(x),
        y: pageToScreenY(y)
      });
    }

    if (points.length < 2) {
      return null;
    }

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    if (points.length > 2) {
      path += ' Z';
    }

    return path;
  }, [pageToScreenX, pageToScreenY]);

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

      return currentUnion.length === 1;
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
          regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
              regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
    if (activeTool === 'pan') {
      regionDebug(
        `[RegionSelectionTool p${currentPageId ?? 'unknown'}] mouseDown passed through for pan — ` +
        `client=${Math.round(event.clientX)},${Math.round(event.clientY)}`
      );
      // Don't handle the event - let it bubble to container's pan handler
      // Don't call preventDefault or stopPropagation
      return;
    }

    const rect = targetElement.getBoundingClientRect();
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
      
      // Check if click is inside any selected region's bounds
      let clickedInsideBoundary = false;
      for (const regionId of selectedRegionIds) {
        const region = regions.find(r => r.regionId === regionId);
        if (region) {
          const bounds = getRegionBounds(region);
          if (bounds && 
              x >= bounds.minX && x <= bounds.maxX &&
              y >= bounds.minY && y <= bounds.maxY) {
            clickedInsideBoundary = true;
            break;
          }
        }
      }
      
      // If clicked outside all boundary boxes, deselect
      if (!clickedInsideBoundary && selectedRegionIds.size > 0) {
        setSelectedRegionIds(new Set());
        setInteractionState(null);
      }
      return;
    }

    const pointer = clientPointToPage(event.clientX, event.clientY, rect);
    if (!pointer) return;
    const { x, y } = pointer;

    if (effectiveToolType === 'rectangular') {
      setIsDrawing(true);
      setStartPoint({ x, y });
      setCurrentRect({ x, y, width: 0, height: 0 });
    } else if (effectiveToolType === 'freehand') {
      setIsDrawing(true);
      setPolygonPoints([{ x, y }]);
    }
  }, [active, targetElement, effectiveToolType, clientPointToPage, selectedRegionIds, regions, getRegionBounds, activeTool, isPointWithinTargetRect]);

  const handleMouseMove = useCallback((event) => {
    if (!active || !targetElement) return;

    // Allow pan to work: if pan tool is active and not drawing/interacting, don't handle the event
    if (activeTool === 'pan' && !isDrawing && !interactionState) {
      return; // Let the event pass through for pan
    }

    const rect = targetElement.getBoundingClientRect();
    const isWithinCanvas =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    setIsCursorOverCanvas(isWithinCanvas);

    // Update cursor position for subtractive mode indicator
    if (isWithinCanvas && (effectiveToolType === 'rectangular' || effectiveToolType === 'freehand')) {
      cursorPositionRef.current = { x: event.clientX, y: event.clientY };
      if (addIndicatorRef.current) {
        addIndicatorRef.current.style.left = (event.clientX + 8) + 'px';
        addIndicatorRef.current.style.top = (event.clientY - 20) + 'px';
      }
      if (subtractIndicatorRef.current) {
        subtractIndicatorRef.current.style.left = (event.clientX + 8) + 'px';
        subtractIndicatorRef.current.style.top = (event.clientY - 20) + 'px';
      }
    }

    if (!isWithinCanvas && !isDrawing && !interactionState) {
      return;
    }

    const pointer = clientPointToPage(event.clientX, event.clientY, rect);
    if (!pointer) return;
    const { x, y } = pointer;

    if (interactionState) {
      if (interactionState.type === 'move') {
        // Use raw client coordinates for delta to avoid scale/offset mismatch issues
        // interactionState.startPoint is in client coordinates (from handleRegionPointerDown)
        const dx = (event.clientX - interactionState.startPoint.x) / displayScaleX;
        const dy = (event.clientY - interactionState.startPoint.y) / displayScaleY;

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

        if (isShiftPressed) {
          // KAL-301b: Shift+drag corner handle = uniform aspect-preserving scale.
          // isShiftPressed is read live each mousemove, so holding/releasing Shift
          // mid-drag switches behavior immediately (live, not locked at drag-start).
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
        const { vertexIndex, regionId } = interactionState;

        // KAL-301a: mark that vertex drag moved
        dragHasMovedRef.current = true;

        setRegions(prev => prev.map(region => {
          if (region.regionId !== regionId) {
            return region;
          }

          const newCoords = [...region.coordinates];
          newCoords[vertexIndex * 2] = x;
          newCoords[vertexIndex * 2 + 1] = y;

          return {
            ...region,
            shapeType: 'polygon',
            coordinates: newCoords
          };
        }));
      } else if (interactionState.type === 'rotate') {
        // KAL-301c: rotation drag. Compute angle from region centroid to current
        // pointer in screen space, snap to 15°, transform all coords relative to
        // the angle delta since last frame (stored as interactionState.lastAngleDeg).
        const { regionId, centerPage, lastAngleDeg, initialCoords } = interactionState;
        if (!centerPage) return;

        // Angle from centroid to pointer in page coords (atan2 gives radians).
        // 0° = right, 90° = down — we normalise to [0, 360).
        const rawAngleDeg = (Math.atan2(y - centerPage.cy, x - centerPage.cx) * 180) / Math.PI;
        const snappedAngle = Math.round(rawAngleDeg / 15) * 15;
        const normAngle = ((snappedAngle % 360) + 360) % 360;

        const delta = normAngle - lastAngleDeg;
        if (Math.abs(delta) < 0.001) return; // no meaningful movement

        // KAL-301a: mark that rotation moved
        dragHasMovedRef.current = true;

        // Rotate all coords of the region around the centroid by delta degrees.
        const rad = (delta * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const { cx, cy } = centerPage;

        setRegions(prev => prev.map(region => {
          if (region.regionId !== regionId) return region;
          const coords = region.coordinates;
          const rotated = [];
          for (let i = 0; i < coords.length; i += 2) {
            const dx = coords[i] - cx;
            const dy = coords[i + 1] - cy;
            rotated.push(cx + dx * cosA - dy * sinA);
            rotated.push(cy + dx * sinA + dy * cosA);
          }
          return { ...region, coordinates: rotated };
        }));

        // Update lastAngleDeg in interactionState so next frame delta is correct.
        setInteractionState(prev => prev ? { ...prev, lastAngleDeg: normAngle } : prev);
        setLiveRotationAngle(normAngle);
      }
      return;
    }

    if (!isDrawing) return;

    if (!isDrawing) return;

    if (effectiveToolType === 'rectangular' && startPoint) {
      setCurrentRect({
        x: Math.min(startPoint.x, x),
        y: Math.min(startPoint.y, y),
        width: Math.abs(x - startPoint.x),
        height: Math.abs(y - startPoint.y)
      });
    } else if (effectiveToolType === 'freehand') {
      setPolygonPoints(prev => [...prev, { x, y }]);
    }
  }, [active, targetElement, clientPointToPage, displayScaleX, displayScaleY, interactionState, ensureBoundsMinSize, isDrawing, effectiveToolType, startPoint, regions, activeTool, isShiftPressed, setLiveRotationAngle]);

  const handleMouseUp = useCallback(() => {
    if (!active) return;

    setIsCursorOverCanvas(false);

    if (interactionState) {
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
      dragHasMovedRef.current = false;
      // KAL-301c: clear the live rotation angle pill when drag ends.
      if (interactionState.type === 'rotate') {
        setLiveRotationAngle(null);
      }
      setInteractionState(null);
      return;
    }

    if (!isDrawing) return;

    if (effectiveToolType === 'rectangular' && currentRect && currentRect.width > MIN_REGION_SIZE && currentRect.height > MIN_REGION_SIZE) {
      pushUndoSnapshot();
      regionDebug(
        `[RegionSelectionTool p${currentPageId ?? 'unknown'}] mouseUp commit rectangular — ` +
        `x=${currentRect.x.toFixed(2)}, y=${currentRect.y.toFixed(2)}, ` +
        `w=${currentRect.width.toFixed(2)}, h=${currentRect.height.toFixed(2)}, mode=${effectiveSelectionMode}`
      );
      const newRegion = {
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
        ]
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
            // subtractRegionFromRegion returns array of regions (or empty if fully subtracted)
            const result = subtractRegionFromRegion(existingRegion, newRegion);
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
      const newRegion = {
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        pageId: currentPageId,
        shapeType: 'polygon',
        operation: effectiveSelectionMode,
        coordinates: polygonPoints.flatMap(point => [point.x, point.y])
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
            // subtractRegionFromRegion returns array of regions (or empty if fully subtracted)
            const result = subtractRegionFromRegion(existingRegion, newRegion);
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
  }, [active, interactionState, isDrawing, effectiveToolType, currentRect, polygonPoints, currentPageId, effectiveSelectionMode, mergeRegionWithOverlapping, subtractRegionFromRegions, pushUndoSnapshot, persistHistoryStacks, setLiveRotationAngle]);

  const handleCanvasMouseLeave = useCallback(() => {
    setIsCursorOverCanvas(false);
    handleMouseUp();
  }, [handleMouseUp]);

  const handleConfirm = useCallback(() => {
    if (!onRegionComplete) {
      return;
    }

    const currentRegions = Array.isArray(regionsRef.current) ? regionsRef.current : [];

    // Preserve exactly what the user created. Touching regions should not merge
    // unless the user explicitly chooses Merge from the Region Editor menu.
    const payload = currentRegions.map(region => ({
      ...region,
      coordinates: Array.isArray(region.coordinates) ? [...region.coordinates] : [],
      // Deep copy sourceRegions array to ensure it's preserved
      sourceRegions: Array.isArray(region.sourceRegions) 
        ? region.sourceRegions.map(sourceRegion => ({
            ...sourceRegion,
            coordinates: Array.isArray(sourceRegion.coordinates) ? [...sourceRegion.coordinates] : []
          }))
        : undefined,
      // Preserve originCenter if it exists
      originCenter: region.originCenter ? { ...region.originCenter } : undefined
    }));
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
  }, [onCancel]);

  const handleSetFullPage = useCallback(() => {
    if (!onSetFullPage) return;

    // Warn user if they have existing selections that will be cleared
    if (regions.length > 0) {
      if (!window.confirm(`You have ${regions.length} area${regions.length !== 1 ? 's' : ''} defined within this region. Setting the region to Full Page will remove all existing areas. Are you sure you want to continue?`)) {
        return;
      }
    }

    onSetFullPage();
    handleCancel();
  }, [onSetFullPage, handleCancel, regions.length]);

  const handleRegionPointerDown = useCallback((region, event) => {
    if (!active || effectiveToolType !== 'move' || !targetElement) {
      return;
    }
    if (event.button === 2) {
      if (!selectedRegionIds.has(region.regionId)) {
        setSelectedRegionIds(new Set([region.regionId]));
      }
      return;
    }
    event.stopPropagation();

    // If not in move mode, ignore
    if (effectiveToolType !== 'move') return;

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
          initialRegions: regions.filter(r => selectedRegionIds.has(r.regionId)),
          preSnapshot
        });
      }
    }
  }, [active, effectiveToolType, targetElement, regions, selectedRegionIds, toolType, createHistorySnapshot]);

  const handleVertexPointerDown = useCallback((region, vertexIndex, event) => {
    if (!active || effectiveToolType !== 'move' || !targetElement) return;
    if (event.button === 2) {
      if (!selectedRegionIds.has(region.regionId)) {
        setSelectedRegionIds(new Set([region.regionId]));
      }
      return;
    }
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
      preSnapshot
    });
  }, [active, effectiveToolType, targetElement, selectedRegionIds, createHistorySnapshot]);

  const handleResizePointerDown = useCallback((region, handle, event) => {
    if (!active || effectiveToolType !== 'move' || !targetElement) return;
    if (event.button === 2) {
      if (!selectedRegionIds.has(region.regionId)) {
        setSelectedRegionIds(new Set([region.regionId]));
      }
      return;
    }
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
  }, [active, effectiveToolType, targetElement, getRegionBounds, selectedRegionIds, createHistorySnapshot]);

  // KAL-301c: rotation handle pointer-down. Captures the centroid in page space
  // and the initial angle from centroid to pointer, so handleMouseMove can compute
  // angle deltas frame-by-frame and snap to 15° increments.
  const handleRotatePointerDown = useCallback((region, event) => {
    if (!active || effectiveToolType !== 'move' || !targetElement) return;
    if (event.button === 2) return;
    event.stopPropagation();
    event.preventDefault();

    const rect = targetElement.getBoundingClientRect();
    const pointer = clientPointToPage(event.clientX, event.clientY, rect);
    if (!pointer) return;

    // Compute centroid in page coords (arithmetic mean of all vertices).
    const coords = region.coordinates;
    let sumX = 0;
    let sumY = 0;
    const n = coords.length / 2;
    for (let i = 0; i < coords.length; i += 2) {
      sumX += coords[i];
      sumY += coords[i + 1];
    }
    const cx = sumX / n;
    const cy = sumY / n;

    // Starting angle from centroid to pointer.
    const startRawDeg = (Math.atan2(pointer.y - cy, pointer.x - cx) * 180) / Math.PI;
    const startAngleDeg = ((Math.round(startRawDeg / 15) * 15) % 360 + 360) % 360;

    setSelectedRegionIds(new Set([region.regionId]));
    // KAL-301a: pre-drag snapshot for undo
    const preSnapshot = createHistorySnapshot();
    dragHasMovedRef.current = false;
    setLiveRotationAngle(startAngleDeg);
    setInteractionState({
      type: 'rotate',
      regionId: region.regionId,
      centerPage: { cx, cy },
      lastAngleDeg: startAngleDeg,
      preSnapshot
    });
  }, [active, effectiveToolType, targetElement, clientPointToPage, createHistorySnapshot]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedRegionIds.size === 0) return;
    pushUndoSnapshot();
    setRegions(prev => prev.filter(r => !selectedRegionIds.has(r.regionId)));
    setSelectedRegionIds(new Set());
    setInteractionState(null);
  }, [selectedRegionIds, pushUndoSnapshot]);

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

  const handleCopy = useCallback(async () => {
    if (selectedRegionIds.size === 0) return;
    const regionsToCopy = regions.filter(r => selectedRegionIds.has(r.regionId));

    try {
      await navigator.clipboard.writeText(JSON.stringify(regionsToCopy));
      setContextMenu(null);
    } catch (err) {
      console.error('Failed to copy regions:', err);
    }
  }, [selectedRegionIds, regions]);

  const handleCut = useCallback(async () => {
    await handleCopy();
    handleDeleteSelected();
    setContextMenu(null);
  }, [handleCopy, handleDeleteSelected]);

  const handlePaste = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const text = await navigator.clipboard.readText();
      const pastedRegions = JSON.parse(text);

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
          regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`,
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
        mergedCoords = simplifyPolygon(mergedCoords, 1.0);

        // Calculate center of the new merged region (for restoration offset)
        const bounds = getRegionBounds({ coordinates: mergedCoords });
        const originCenter = {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2
        };

        const newRegion = {
          regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          pageId: currentPageId,
          shapeType: 'polygon',
          operation: REGION_OPERATIONS.ADD,
          coordinates: mergedCoords,
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
  }, [contextMenu, selectedRegionIds, regions, currentPageId, getRegionBounds, canMergeRegions, cloneRegionForHistory, pushUndoSnapshot]);

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
        regionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 5)}`
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

  // Track keyboard modifiers (Shift, Option/Alt, Space) for mode override
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event) => {
      const key = event.key?.toLowerCase?.();
      const isUndoShortcut = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key?.toLowerCase?.() === 'z';
      const isRedoShortcut = (
        ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key?.toLowerCase?.() === 'z') ||
        ((event.ctrlKey && !event.metaKey) && event.key?.toLowerCase?.() === 'y')
      );
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
        key === 'v' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableKeyboardTarget()
      ) {
        stopRegionKeyboardShortcut(event);
        setToolType('move');
        setIsToolDropdownOpen(false);
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
      if (event.key === ' ' || event.code === 'Space') {
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
      setIsSpacePressed(false);
    };
  }, [active, undoLastRegionEdit, redoLastRegionEdit]);

  useEffect(() => {
    if (!active || !targetElement) return;

    const handleDocumentMouseDown = (event) => {
      if (targetElement.contains(event.target)) {
        return;
      }
      if (containerRef.current && containerRef.current.contains(event.target)) {
        return;
      }
      if (event.target.closest('[data-region-selection-ui="true"]')) {
        return;
      }
      handleCancel();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, [active, targetElement, handleCancel]);

  useEffect(() => {
    if (!active || !targetElement) return;

    const handleDocumentMouseDownCapture = (event) => {
      if (activeTool === 'pan') return;
      if (documentDragFallbackRef.current) return;
      if (containerRef.current && containerRef.current.contains(event.target)) return;
      if (event.target?.closest?.('[data-region-selection-ui="true"]')) return;
      if (!isPointWithinTargetRect(event.clientX, event.clientY)) return;

      documentDragFallbackRef.current = true;
      handleMouseDown(event);
    };

    const handleDocumentMouseMoveCapture = (event) => {
      if (!documentDragFallbackRef.current) return;
      handleMouseMove(event);
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDocumentMouseUpCapture = (event) => {
      if (!documentDragFallbackRef.current) return;
      documentDragFallbackRef.current = false;
      handleMouseUp(event);
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('mousedown', handleDocumentMouseDownCapture, true);
    document.addEventListener('mousemove', handleDocumentMouseMoveCapture, true);
    document.addEventListener('mouseup', handleDocumentMouseUpCapture, true);

    return () => {
      documentDragFallbackRef.current = false;
      document.removeEventListener('mousedown', handleDocumentMouseDownCapture, true);
      document.removeEventListener('mousemove', handleDocumentMouseMoveCapture, true);
      document.removeEventListener('mouseup', handleDocumentMouseUpCapture, true);
    };
  }, [active, targetElement, activeTool, handleMouseDown, handleMouseMove, handleMouseUp, isPointWithinTargetRect]);

  if (!active) return null;

  return (
    <>
      {/* Toolbar */}
      <div
        data-region-selection-ui="true"
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#2b2b2b',
          border: '1px solid #555',
          borderRadius: '8px',
          padding: '8px',
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          maxWidth: 'calc(100vw - 32px)',
          zIndex: 100001,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          fontFamily: FONT_FAMILY
        }}
      >
        <div style={{ fontSize: '13px', color: '#fff', marginRight: '6px' }}>
          Region Selection
        </div>

        {/* Select Button - Separate button for selecting/transforming regions */}
        <button
          onClick={() => {
            if (toolType === 'move') {
              // If already in move mode, switch to rectangular drawing tool
              setToolType('rectangular');
            } else {
              // Otherwise, switch to move mode
              setToolType('move');
            }
          }}
          className={`btn btn-sm ${toolType === 'move' ? 'btn-active' : 'btn-default'}`}
          style={{
            padding: '4px 8px',
            background: toolType === 'move' ? '#4a90e2' : '#3a3a3a',
            color: '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: FONT_FAMILY,
            marginRight: '6px',
            fontWeight: toolType === 'move' ? '500' : '400'
          }}
        >
          <Icon name="pan" size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          Select
        </button>

        {/* Tool Type Selection - Custom Dropdown */}
        <div
          style={{
            position: 'relative',
            marginRight: '6px'
          }}
        >
          <button
            onClick={(e) => {
              // Check if clicking on the arrow (right side of button)
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const buttonWidth = rect.width;

              // If click is in the right 30px (arrow area), toggle dropdown
              if (clickX > buttonWidth - 30) {
                e.stopPropagation();
                setIsToolDropdownOpen(!isToolDropdownOpen);
              } else {
                // Click on button body - exit selection mode if in move mode
                if (toolType === 'move') {
                  setToolType('rectangular');
                }
                setIsToolDropdownOpen(false);
              }
            }}
            style={{
              padding: '4px 8px',
              paddingRight: '28px',
              background: (toolType === 'rectangular' || toolType === 'freehand') ? '#4a90e2' : '#555',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: FONT_FAMILY,
              minWidth: '110px',
              fontWeight: '500',
              textAlign: 'center',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {toolType === 'move' ? 'Rectangular' : (toolType === 'rectangular' ? 'Rectangular' : 'Freehand')}
            <span
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '14px',
                height: '14px'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '14px', height: '14px' }}>
                <path d="M6 9L12 15L18 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          {/* Dropdown Menu */}
          {isToolDropdownOpen && (
            <>
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 100000
                }}
                onClick={() => setIsToolDropdownOpen(false)}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: '4px',
                  background: '#3a3a3a',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  minWidth: '110px',
                  zIndex: 100001,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  overflow: 'hidden'
                }}
              >
                <button
                  onClick={() => {
                    setToolType('rectangular');
                    setIsToolDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: toolType === 'rectangular' ? '#4a90e2' : 'transparent',
                    color: '#fff',
                    border: 'none',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY,
                    textAlign: 'left',
                    fontWeight: toolType === 'rectangular' ? '500' : '400'
                  }}
                  onMouseEnter={(e) => {
                    if (toolType !== 'rectangular') {
                      e.currentTarget.style.background = '#4a4a4a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (toolType !== 'rectangular') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  Rectangular
                </button>
                <button
                  onClick={() => {
                    setToolType('freehand');
                    setIsToolDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '6px 12px',
                    background: toolType === 'freehand' ? '#4a90e2' : 'transparent',
                    color: '#fff',
                    border: 'none',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY,
                    textAlign: 'left',
                    borderTop: '1px solid #555',
                    fontWeight: toolType === 'freehand' ? '500' : '400'
                  }}
                  onMouseEnter={(e) => {
                    if (toolType !== 'freehand') {
                      e.currentTarget.style.background = '#4a4a4a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (toolType !== 'freehand') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  Freehand
                </button>
              </div>
            </>
          )}
        </div>

        {/* Selection Mode Dropdown (always visible, disabled in selection mode) */}
        <select
          value={selectionMode}
          onChange={(e) => setSelectionMode(e.target.value)}
          disabled={toolType === 'move'}
          style={{
            padding: '4px 8px',
            background: toolType === 'move' ? '#2a2a2a' : '#3a3a3a',
            color: toolType === 'move' ? '#666' : '#fff',
            border: '1px solid #555',
            borderRadius: '4px',
            fontSize: '12px',
            cursor: toolType === 'move' ? 'not-allowed' : 'pointer',
            fontFamily: FONT_FAMILY,
            marginRight: '8px',
            minWidth: '110px',
            textAlign: 'center',
            opacity: toolType === 'move' ? 0.5 : 1,
            transition: 'opacity 0.2s ease, background-color 0.2s ease, color 0.2s ease'
          }}
        >
          <option value={REGION_OPERATIONS.ADD}>Additive</option>
          <option value={REGION_OPERATIONS.SUBTRACT}>Subtractive</option>
        </select>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {effectiveToolType === 'move' && selectedRegionIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="btn btn-default btn-sm"
              style={{
                padding: '6px 12px',
                background: '#611',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: FONT_FAMILY
              }}
            >
              Delete
            </button>
          )}
          {canSetFullPage && (
            <button
              onClick={handleSetFullPage}
              className="btn btn-default btn-sm"
              style={{
                padding: '6px 12px',
                background: '#555',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: FONT_FAMILY
              }}
            >
              Full Page
            </button>
          )}
          <button
            onClick={handleConfirm}
            className="btn btn-primary btn-sm"
            style={{ padding: '6px 12px' }}
          >
            Confirm
          </button>
          <button
            onClick={handleCancel}
            className="btn btn-default btn-sm"
            style={{ padding: '6px 12px' }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Canvas Interaction Layer */}
      {canvasRect && (
          <div
            ref={containerRef}
            data-region-selection-ui="true"
            onContextMenu={handleContextMenu}
            style={{
              position: 'fixed',
              left: `${canvasRect.left}px`,
              top: `${canvasRect.top}px`,
              width: `${canvasRect.width}px`,
              height: `${canvasRect.height}px`,
              zIndex: 100000,
              cursor: effectiveToolType === 'move' ? 'default' : (isCursorOverCanvas ? 'crosshair' : 'default'),
              pointerEvents: activeTool === 'pan' ? 'none' : 'auto' // Allow events to pass through when pan is active
            }}
            {...(activeTool === 'pan' ? {} : {
              onMouseDown: handleMouseDown,
              onMouseMove: handleMouseMove,
              onMouseUp: handleMouseUp,
              onMouseLeave: handleCanvasMouseLeave
            })}
          >
          <svg
            width={canvasRect.width}
            height={canvasRect.height}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              pointerEvents: 'none'
            }}
          >
            {toolType === 'rectangular' && currentRect && (
              <rect
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

            {/* Render unified path for all regions to show them as merged */}
            {(() => {
              // Calculate union of all regions for visual display
              // This ensures overlapping regions look like a single shape
              try {
                const additiveRegions = regions.filter(r => !r.operation || r.operation === REGION_OPERATIONS.ADD);
                const subtractiveRegions = regions.filter(r => r.operation === REGION_OPERATIONS.SUBTRACT);

                let mergedPolygons = [];

                // Union all additive regions
                for (const region of additiveRegions) {
                  const poly = regionToPolygon(region);
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
                      d={unifiedPath}
                      fill="rgba(74, 144, 226, 0.22)"
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
                return (
                  <path
                    key={region.regionId}
                    d={path}
                    fill="rgba(245, 166, 35, 0.18)"
                    stroke="#F5A623"
                    strokeWidth={2.5}
                    style={{
                      pointerEvents: effectiveToolType === 'move' ? 'visiblePainted' : 'none',
                      cursor: effectiveToolType === 'move' ? 'move' : 'default'
                    }}
                    onMouseDown={effectiveToolType === 'move' ? (event) => handleRegionPointerDown(region, event) : undefined}
                  />
                );
              } else {
                return (
                  <path
                    key={region.regionId}
                    d={path}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={10} // Wider stroke for easier selection
                    style={{
                      pointerEvents: effectiveToolType === 'move' ? 'all' : 'none',
                      cursor: effectiveToolType === 'move' ? 'move' : 'default'
                    }}
                    onMouseDown={effectiveToolType === 'move' ? (event) => handleRegionPointerDown(region, event) : undefined}
                  />
                );
              }
            })}
          </svg>

          {/* Context Menu */}
          {contextMenu && (
            <div
              data-region-selection-ui="true"
              style={{
                position: 'fixed',
                top: contextMenu.y,
                left: contextMenu.x,
                background: 'white',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                zIndex: 100004,
                padding: '4px 0',
                minWidth: '120px',
                pointerEvents: 'auto' // Ensure context menu is always interactive
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '8px 12px',
                  cursor: selectedRegionIds.size > 0 ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  color: '#333',
                  fontFamily: FONT_FAMILY,
                  opacity: selectedRegionIds.size > 0 ? 1 : 0.45
                }}
                onClick={selectedRegionIds.size > 0 ? handleCopy : undefined}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                Copy
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  cursor: selectedRegionIds.size > 0 ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  color: '#333',
                  fontFamily: FONT_FAMILY,
                  opacity: selectedRegionIds.size > 0 ? 1 : 0.45
                }}
                onClick={selectedRegionIds.size > 0 ? handleCut : undefined}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                Cut
              </div>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#333', fontFamily: FONT_FAMILY }}
                onClick={handlePaste}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                Paste
              </div>
              <div style={{ height: '1px', background: '#e0e0e0', margin: '4px 0' }} />
              <div
                style={{
                  padding: '8px 12px',
                  cursor: contextMenu.canMerge ? 'pointer' : 'not-allowed',
                  opacity: contextMenu.canMerge ? 1 : 0.45,
                  color: '#333',
                  fontSize: '13px',
                  fontFamily: FONT_FAMILY,
                  background: 'transparent'
                }}
                onClick={contextMenu.canMerge ? handleMergeSelected : undefined}
                onMouseEnter={(e) => {
                  if (contextMenu.canMerge) e.currentTarget.style.background = '#f0f0f0';
                }}
                onMouseLeave={(e) => {
                  if (contextMenu.canMerge) e.currentTarget.style.background = 'transparent';
                }}
              >
                Merge
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  cursor: contextMenu.canUnmerge ? 'pointer' : 'not-allowed',
                  opacity: contextMenu.canUnmerge ? 1 : 0.45,
                  color: '#333',
                  fontSize: '13px',
                  fontFamily: FONT_FAMILY
                }}
                onClick={contextMenu.canUnmerge ? handleSeparateRegion : undefined}
                onMouseEnter={(e) => {
                  if (contextMenu.canUnmerge) e.currentTarget.style.background = '#f0f0f0';
                }}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                Unmerge
              </div>
            </div>
          )}

          {/* Resize handles for the selected region (ONLY if single selection) */}
          {effectiveToolType === 'move' && selectedRegionIds.size === 1 && (() => {
            const selectedRegion = regions.find(r => r.regionId === Array.from(selectedRegionIds)[0]);
            if (!selectedRegion) return null;

            const vertexCount = selectedRegion.coordinates.length / 2;
            const useVertexHandles = vertexCount <= 32;

            if (useVertexHandles) {
              // Render handles for each vertex
              const bounds = getRegionBounds(selectedRegion);
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
                    onMouseDown={(event) => {
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
                      pointerEvents: 'auto',
                      zIndex: 100002,
                      boxSizing: 'border-box',
                      cursor: 'move'
                    }}
                  />
                );
              }
              
              for (let i = 0; i < vertexCount; i++) {
                const x = pageToScreenX(selectedRegion.coordinates[i * 2]);
                const y = pageToScreenY(selectedRegion.coordinates[i * 2 + 1]);

                handles.push(
                  <div
                    key={`v-${i}`}
                    onMouseDown={(event) => handleVertexPointerDown(selectedRegion, i, event)}
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
                      cursor: 'crosshair',
                      pointerEvents: 'auto',
                      zIndex: 100003
                    }}
                  />
                );
              }
              return <>{boundaryBox}{handles}</>;
            } else {
              // Render bounding box handles for complex shapes
              const bounds = getRegionBounds(selectedRegion);
              if (!bounds) return null;
              const left = pageToScreenX(bounds.minX);
              const top = pageToScreenY(bounds.minY);
              const width = (bounds.maxX - bounds.minX) * displayScaleX;
              const height = (bounds.maxY - bounds.minY) * displayScaleY;

              return (
                <>
                  {/* Selection boundary box - Drawboard style */}
                  <div
                    onMouseDown={(event) => {
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
                      pointerEvents: 'auto',
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
                    return (
                      <div
                        key={handle.key}
                        onMouseDown={(event) => handleResizePointerDown(selectedRegion, handle.key, event)}
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
                          cursor: handle.cursor,
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

          {/* KAL-301c: Rotation handle — circle above bounding box centre.
              Matches the standard annotation mtr handle: sits along the
              vertical ray from the shape centroid, 32px above the top edge
              (screen pixels). Drag rotates all coords around the centroid,
              snapping to 15° increments. Undoable via Slice 1 mechanism. */}
          {effectiveToolType === 'move' && selectedRegionIds.size === 1 && (() => {
            const selectedRegion = regions.find(r => r.regionId === Array.from(selectedRegionIds)[0]);
            if (!selectedRegion) return null;
            const bounds = getRegionBounds(selectedRegion);
            if (!bounds) return null;

            const centerScreenX = pageToScreenX((bounds.minX + bounds.maxX) / 2);
            const topScreenY = pageToScreenY(bounds.minY);
            // 32px above the top edge of the bounding box — matches standard annotation mtr gap.
            const ROTATION_HANDLE_OFFSET = 32;
            const handleScreenX = centerScreenX;
            const handleScreenY = topScreenY - ROTATION_HANDLE_OFFSET;
            const ROTATION_HANDLE_RADIUS = 7; // px

            return (
              <>
                {/* Stem line from bounding box top-centre to rotation handle */}
                <svg
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 100002,
                    overflow: 'visible'
                  }}
                >
                  <line
                    x1={centerScreenX}
                    y1={topScreenY}
                    x2={handleScreenX}
                    y2={handleScreenY + ROTATION_HANDLE_RADIUS}
                    stroke={REGION_HANDLE_STROKE}
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                </svg>
                {/* Rotation handle circle */}
                <div
                  data-region-selection-ui="true"
                  onMouseDown={(event) => handleRotatePointerDown(selectedRegion, event)}
                  title="Drag to rotate (snaps to 15°)"
                  style={{
                    position: 'absolute',
                    left: `${handleScreenX}px`,
                    top: `${handleScreenY}px`,
                    transform: 'translate(-50%, -50%)',
                    width: `${ROTATION_HANDLE_RADIUS * 2}px`,
                    height: `${ROTATION_HANDLE_RADIUS * 2}px`,
                    borderRadius: '50%',
                    background: REGION_HANDLE_FILL,
                    border: `1.5px solid ${REGION_HANDLE_STROKE}`,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                    cursor: 'grab',
                    pointerEvents: 'auto',
                    zIndex: 100004,
                    // Subtle rotation icon hint — ↺ symbol centred
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '9px',
                    color: REGION_HANDLE_STROKE,
                    userSelect: 'none'
                  }}
                >
                  ↺
                </div>
              </>
            );
          })()}

          </div>
      )}

      {/* KAL-301c: Live rotation angle pill — shown during rotate drag only.
          Styled to match RotationInputField (dark pill, white text).
          Position: fixed near the rotation handle to avoid obstructing the shape. */}
      {liveRotationAngle !== null && interactionState?.type === 'rotate' && (
        <div
          data-region-selection-ui="true"
          style={{
            position: 'fixed',
            // Position pill to the right of the rotation handle if possible.
            // We use a simple fixed offset from the interaction centroid converted
            // to screen via canvasRect. Falls back to top-left corner of viewport.
            left: canvasRect
              ? `${canvasRect.left + pageToScreenX(
                  // centroid x from interactionState
                  (() => {
                    const region = regions.find(r => interactionState && r.regionId === interactionState.regionId);
                    if (!region) return 0;
                    const b = getRegionBounds(region);
                    return b ? (b.minX + b.maxX) / 2 : 0;
                  })()
                ) + 20}px`
              : '20px',
            top: canvasRect
              ? `${canvasRect.top + pageToScreenY(
                  (() => {
                    const region = regions.find(r => interactionState && r.regionId === interactionState.regionId);
                    if (!region) return 0;
                    const b = getRegionBounds(region);
                    return b ? b.minY : 0;
                  })()
                ) - 50}px`
              : '20px',
            background: '#2D2D2D',
            border: '1px solid #3A3A3A',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            padding: '4px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            pointerEvents: 'none',
            zIndex: 100005,
            fontFamily: FONT_FAMILY,
            minWidth: 60
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: '#ddd', letterSpacing: '-0.2px' }}>
            {Math.round(liveRotationAngle)}
          </span>
          <span style={{ fontSize: 12, fontWeight: 400, color: '#999' }}>°</span>
        </div>
      )}

      {/* Floating Plus Sign Indicator for Additive Mode */}
      {effectiveSelectionMode === REGION_OPERATIONS.ADD && isCursorOverCanvas && (toolType === 'rectangular' || toolType === 'freehand') && (
        <div
          ref={addIndicatorRef}
          style={{
            position: 'fixed',
            left: `${cursorPositionRef.current.x + 8}px`,
            top: `${cursorPositionRef.current.y - 20}px`,
            pointerEvents: 'none',
            zIndex: 100002
          }}
        >
          <span
            style={{
              color: '#000',
              fontSize: '16px',
              fontWeight: 'bold',
              lineHeight: '1',
              fontFamily: FONT_FAMILY,
              textShadow: '0 0 3px rgba(255, 255, 255, 0.8), 0 0 6px rgba(255, 255, 255, 0.6)'
            }}
          >
            +
          </span>
        </div>
      )}

      {/* Floating Minus Sign Indicator for Subtractive Mode */}
      {effectiveSelectionMode === REGION_OPERATIONS.SUBTRACT && isCursorOverCanvas && (toolType === 'rectangular' || toolType === 'freehand') && (
        <div
          ref={subtractIndicatorRef}
          style={{
            position: 'fixed',
            left: `${cursorPositionRef.current.x + 8}px`,
            top: `${cursorPositionRef.current.y - 20}px`,
            pointerEvents: 'none',
            zIndex: 100002
          }}
        >
          <span
            style={{
              color: '#000',
              fontSize: '16px',
              fontWeight: 'bold',
              lineHeight: '1',
              fontFamily: FONT_FAMILY,
              textShadow: '0 0 3px rgba(255, 255, 255, 0.8), 0 0 6px rgba(255, 255, 255, 0.6)'
            }}
          >
            −
          </span>
        </div>
      )}
    </>
  );
};

export default RegionSelectionTool;
