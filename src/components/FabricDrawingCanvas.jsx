/**
 * FabricDrawingCanvas
 *
 * Pen + highlighter drawing Canvas component. Mounts a transparent Fabric.js
 * Canvas overlay over the SVG layer for real-time stroke capture. Each completed
 * stroke is serialized to Fabric.js JSON and committed via onStrokeCommit.
 *
 * Key behaviors:
 * - Container-aware sizing via setZoom(effectiveScale) so paths are in unscaled
 *   page coordinates (SVG viewBox space)
 * - Pen <-> highlighter switching reconfigures brush without remount
 * - path:created handler serializes each stroke with custom properties
 * - Undo sync: when annotations prop shrinks, last session path is removed from Canvas
 * - zoomGeneration prop change flushes in-progress stroke (EDIT-09)
 * - Pre-unmount commit flushes in-progress stroke if user is mid-draw
 *
 * Phase 10 Plan 01: Core drawing Canvas mount/unmount mechanism.
 */
import { memo, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { fabric } from '../utils/fabricCompat';
import { useFabricCanvas } from '../hooks/useFabricCanvas';
import {
  computeDrawnBoundaryShapePreviewGeometry,
  normalizeDrawnBoundaryShapeCommitGeometry,
  tagDrawnCenteredStrokeGeometry,
} from '../utils/shapeCommitGeometry';
import {
  beginAnnotationGesture,
  markAnnotationPointerRelease,
  markAnnotationPreviewFrame,
  recordAnnotationCommit,
  updateAnnotationGesture,
} from '../utils/annotationPreviewDiag';
import { shouldStampActiveRegionId } from '../utils/annotationVisibilityRules';

// Custom properties to include in path serialization (matches PAL pattern)
const CUSTOM_PROPS = [
  'id', 'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'annotationId', 'needsEntity',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType', 'pdfInkRenderMode',
  'tool',
];

const SHAPE_TOOLS = ['rect', 'ellipse', 'line', 'arrow', 'survey-marker'];

export function configureCanvasForDrawingTool(canvas, activeTool) {
  if (!canvas) return false;
  const isShape = SHAPE_TOOLS.includes(activeTool);
  canvas.isDrawingMode = !isShape;
  return isShape;
}

function ensureFreeDrawingBrush(canvas) {
  if (!canvas) return null;
  if (!canvas.freeDrawingBrush) {
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
  }
  return canvas.freeDrawingBrush;
}

function createAnnotationId(prefix = 'anno') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureAnnotationId(fabricObject, prefix) {
  if (!fabricObject) return null;
  const existing = fabricObject?.data?.id || fabricObject?.data?.annoId || fabricObject?.id || fabricObject?.annotationId;
  if (existing) {
    fabricObject.id = existing;
    if (!fabricObject.data || typeof fabricObject.data !== 'object') {
      fabricObject.set?.({ data: { id: existing } });
    } else if (!fabricObject.data.id) {
      fabricObject.data.id = existing;
    }
    return existing;
  }
  const id = createAnnotationId(prefix);
  const nextData = { ...(fabricObject.data || {}), id };
  fabricObject.id = id;
  if (typeof fabricObject.set === 'function') {
    fabricObject.set({ id, data: nextData });
  } else {
    fabricObject.data = nextData;
  }
  return id;
}

const roundedPoint = (point) => point && {
  x: Number(point.x?.toFixed?.(3) ?? point.x),
  y: Number(point.y?.toFixed?.(3) ?? point.y),
};

const roundedBox = (box) => box && {
  left: Number(box.left?.toFixed?.(3) ?? box.left),
  top: Number(box.top?.toFixed?.(3) ?? box.top),
  width: Number(box.width?.toFixed?.(3) ?? box.width),
  height: Number(box.height?.toFixed?.(3) ?? box.height),
};

const geometryFromSerializedShape = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  const type = String(obj.type || '').toLowerCase();
  if (type === 'rect') {
    return {
      left: Number(obj.left) || 0,
      top: Number(obj.top) || 0,
      width: Math.abs((Number(obj.width) || 0) * (Number(obj.scaleX) || 1)),
      height: Math.abs((Number(obj.height) || 0) * (Number(obj.scaleY) || 1)),
    };
  }
  if (type === 'ellipse' || type === 'circle' || obj.radius != null) {
    const rx = type === 'circle' || obj.radius != null
      ? (Number(obj.radius) || 0) * Math.abs(Number(obj.scaleX) || 1)
      : (Number(obj.rx) || 0) * Math.abs(Number(obj.scaleX) || 1);
    const ry = type === 'circle' || obj.radius != null
      ? (Number(obj.radius) || 0) * Math.abs(Number(obj.scaleY) || 1)
      : (Number(obj.ry) || 0) * Math.abs(Number(obj.scaleY) || 1);
    return {
      left: (Number(obj.left) || 0),
      top: (Number(obj.top) || 0),
      width: rx * 2,
      height: ry * 2,
    };
  }
  return null;
};

const boxDelta = (from, to) => {
  if (!from || !to) return null;
  return {
    left: Number((to.left - from.left).toFixed(3)),
    top: Number((to.top - from.top).toFixed(3)),
    width: Number((to.width - from.width).toFixed(3)),
    height: Number((to.height - from.height).toFixed(3)),
  };
};

const scheduleShapeCommitSvgProbe = (detail) => {
  if (typeof window === 'undefined' || !detail?.annotationId) return;
  const runProbe = () => {
    try {
      const selector = `[data-shape-id="${CSS.escape(detail.annotationId)}"]`;
      const el = document.querySelector(selector);
      const svg = el?.ownerSVGElement;
      if (!el || !svg) {
        console.log('[ShapeCommitDiag] svg probe pending', {
          annotationId: detail.annotationId,
          tool: detail.tool,
          reason: 'shape element not found yet',
        });
        return;
      }
      const svgRect = svg.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const viewBox = svg.viewBox?.baseVal;
      const scaleX = svgRect.width ? (viewBox?.width || detail.pageSize?.width || 0) / svgRect.width : 0;
      const scaleY = svgRect.height ? (viewBox?.height || detail.pageSize?.height || 0) / svgRect.height : 0;
      const renderedPageBox = {
        left: (elRect.left - svgRect.left) * scaleX,
        top: (elRect.top - svgRect.top) * scaleY,
        width: elRect.width * scaleX,
        height: elRect.height * scaleY,
      };
      console.log('[ShapeCommitDiag] svg rendered bbox after commit', {
        annotationId: detail.annotationId,
        pageNumber: detail.pageNumber,
        tool: detail.tool,
        pointerDown: roundedPoint(detail.pointerDown),
        lastMouseMove: roundedPoint(detail.lastMouseMove),
        mouseUp: roundedPoint(detail.mouseUp),
        previewOuterBounds: roundedBox(detail.previewOuterBounds),
        serializedOuterBounds: roundedBox(detail.serializedOuterBounds),
        svgRenderedBBox: roundedBox(renderedPageBox),
        deltaPreviewToSaved: boxDelta(detail.previewOuterBounds, detail.serializedOuterBounds),
        deltaSavedToSvg: boxDelta(detail.serializedOuterBounds, renderedPageBox),
        deltaPreviewToSvg: boxDelta(detail.previewOuterBounds, renderedPageBox),
      });
    } catch (error) {
      console.warn('[ShapeCommitDiag] svg probe failed', {
        annotationId: detail.annotationId,
        tool: detail.tool,
        message: error?.message || String(error),
      });
    }
  };
  window.requestAnimationFrame(() => window.setTimeout(runProbe, 80));
};

const FabricDrawingCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  activeTool,
  strokeColor,
  strokeOpacity,
  fillColor,
  fillOpacity,
  highlightColor,
  strokeWidth,
  arrowheadStyle,
  lineBorderStyle,
  cloudIntensity,
  annotations,
  onStrokeCommit,
  onSurveyMarkerCreated,
  selectedModuleId,
  selectedSpaceId,
  activeRegionId,
  spaces,
  isRegionOverlayEnabled,
  zoomGeneration,
}) => {
  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const sessionPathsRef = useRef([]);
  const annotationsRef = useRef(annotations);
  const previousObjectCountRef = useRef(annotations?.objects?.length ?? 0);
  const shapeDrawingRef = useRef({ isDrawing: false, startX: 0, startY: 0, shape: null });

  // Refs to avoid stale closures in event handlers
  const activeToolRef = useRef(activeTool);
  const arrowheadStyleRef = useRef(arrowheadStyle);
  const lineBorderStyleRef = useRef(lineBorderStyle);
  const strokeOpacityRef = useRef(strokeOpacity);
  const fillColorRef = useRef(fillColor);
  const fillOpacityRef = useRef(fillOpacity);
  const cloudIntensityRef = useRef(cloudIntensity);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeRegionIdRef = useRef(activeRegionId);
  const spacesRef = useRef(spaces);
  const isRegionOverlayEnabledRef = useRef(isRegionOverlayEnabled);
  const onStrokeCommitRef = useRef(onStrokeCommit);
  const onSurveyMarkerCreatedRef = useRef(onSurveyMarkerCreated);
  const initialZoomGenRef = useRef(zoomGeneration);
  const drawDiagGestureRef = useRef(null);

  // Decision 11 companion: the region-stamp rule now lives in
  // annotationVisibilityRules.shouldStampActiveRegionId so callout creation
  // (SVGAnnotationLayer) stamps from the exact same source of truth.
  const shouldAssignRegionId = () => shouldStampActiveRegionId({
    regionId: activeRegionIdRef.current,
    spaceId: selectedSpaceIdRef.current,
    pageNumber,
    spaces: spacesRef.current,
    isRegionOverlayEnabled: isRegionOverlayEnabledRef.current,
  });

  const composeColor = (hex, opacityPct) => {
    if (!hex || hex === 'transparent') return 'transparent';
    const alpha = Math.max(0, Math.min(1, (opacityPct ?? 100) / 100));
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return hex;
  };

  // Pre-dispose callback: flush in-progress stroke before canvas.off()/dispose()
  // so that the path:created handler is still bound when the flush fires it.
  const onBeforeDisposeRef = useRef((canvas) => {
    if (canvas._isCurrentlyDrawing && canvas.freeDrawingBrush) {
      try {
        canvas.freeDrawingBrush.onMouseUp({ e: new MouseEvent('mouseup') });
      } catch (err) {
        console.error('Pre-unmount stroke flush error:', err);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Canvas lifecycle (useFabricCanvas hook)
  // -------------------------------------------------------------------------
  const isShapeTool = SHAPE_TOOLS.includes(activeTool);
  const { fabricRef } = useFabricCanvas({
    canvasElRef,
    onBeforeDisposeRef,
    options: {
      backgroundColor: 'transparent',
      isDrawingMode: !isShapeTool,
      selection: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
    },
  });

  // -------------------------------------------------------------------------
  // Canvas initialization: container-aware sizing, PencilBrush, path:created
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !containerRef.current) return;
    console.log(`[DrawCanvas p${pageNumber}] MOUNT — tool=${activeTool}, isShape=${SHAPE_TOOLS.includes(activeTool)}, isDrawingMode=${canvas.isDrawingMode}`);

    // Container-aware sizing (CLAUDE.md rule)
    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth > 0 && pageWidth > 0) {
      const effectiveScale = containerWidth / pageWidth;
      canvas.setZoom(effectiveScale);
      canvas.setWidth(Math.floor(pageWidth * effectiveScale));
      canvas.setHeight(Math.floor(pageHeight * effectiveScale));
    }

    canvas.defaultCursor = 'crosshair';
    canvas.freeDrawingCursor = 'crosshair';

    // Set up PencilBrush for pen/highlighter (shape tools use mouse handlers instead)
    if (!SHAPE_TOOLS.includes(activeToolRef.current)) {
      const brush = ensureFreeDrawingBrush(canvas);
      if (activeToolRef.current === 'highlighter') {
        brush.color = highlightColor;
        brush.width = Math.max(strokeWidth, 8);
      } else {
        brush.color = strokeColor;
        brush.width = strokeWidth;
      }
    }

    // path:created handler -- per-stroke commit
    canvas.on('path:created', (e) => {
      if (!e.path) return;
      if (SHAPE_TOOLS.includes(activeToolRef.current)) {
        canvas.remove(e.path);
        canvas.renderAll();
        console.warn('[DrawCanvas] ignored free-draw path while shape tool active', {
          pageNumber,
          activeTool: activeToolRef.current,
        });
        return;
      }

      e.path.set({
        // strokeUniform deliberately NOT set for pen/highlighter paths.
        // In SVG, strokeUniform triggers non-scaling-stroke which keeps
        // stroke width constant in screen pixels — wrong for ink strokes
        // that should scale with the page like real ink on paper.
        perPixelTargetFind: true,
        uniformScaling: false,
        centeredRotation: true,
      });

      // Highlighter strokes get multiply blend mode
      if (activeToolRef.current === 'highlighter') {
        e.path.set({ globalCompositeOperation: 'multiply' });
      }

      // Assign metadata
      ensureAnnotationId(e.path, activeToolRef.current === 'highlighter' ? 'highlighter' : 'path');
      updateAnnotationGesture(drawDiagGestureRef.current, {
        annotationId: e.path.id || e.path.annotationId || e.path.data?.id,
      });
      if (selectedModuleIdRef.current) {
        e.path.set({ moduleId: selectedModuleIdRef.current });
      }
      if (shouldAssignRegionId()) {
        e.path.set({ regionId: activeRegionIdRef.current });
      }

      // Serialize path with custom properties, then normalize for SVG rendering.
      // Fabric.js setZoom makes path data absolute page-space coordinates.
      // SVG renderPath does translate(left, top) + path data, so left/top must
      // be 0 to avoid double-counting the position already in the path data.
      // pathOffset is NOT serialized by toJSON(), so it defaults to 0 in the
      // SVG renderer — this means the path data's absolute coords render directly.
      // fabric 7: toJSON() takes NO arguments (JSON.stringify protocol) and
      // silently DROPS propertiesToInclude — toObject(CUSTOM_PROPS) is the
      // correct call and is what fabric 5's toJSON delegated to. Using toJSON
      // here lost id/moduleId/regionId on every pen stroke after the 7.4.0
      // upgrade (survey/region scoping broke).
      const pathJSON = e.path.toObject(CUSTOM_PROPS);
      pathJSON.left = 0;
      pathJSON.top = 0;
      pathJSON.tool = activeToolRef.current;

      // Track session path for undo sync (count-based, object not needed on Canvas)
      sessionPathsRef.current.push(e.path);

      // Build updated annotations by appending new path
      const currentAnnotations = annotationsRef.current;
      const updated = {
        ...currentAnnotations,
        objects: [...(currentAnnotations?.objects || []), pathJSON],
      };

      markAnnotationPointerRelease(drawDiagGestureRef.current, {
        action: activeToolRef.current === 'highlighter' ? 'highlight-stroke' : 'pen-stroke',
      });

      // Update React before removing Fabric's live preview path. If the path is
      // removed first, the user sees a blank frame before SVG takes over.
      flushSync(() => onStrokeCommitRef.current(updated));
      canvas.remove(e.path);
      canvas.renderAll();
    });

    const onFreeDrawMouseDown = () => {
      if (SHAPE_TOOLS.includes(activeToolRef.current)) return;
      drawDiagGestureRef.current = beginAnnotationGesture({
        surface: 'FabricDrawingCanvas',
        tool: activeToolRef.current,
        type: activeToolRef.current === 'highlighter' ? 'highlighter' : 'path',
        action: activeToolRef.current === 'highlighter' ? 'highlight-stroke' : 'pen-stroke',
        pointerDown: true,
        pageNumber,
      });
    };
    const onFreeDrawMouseMove = () => {
      if (SHAPE_TOOLS.includes(activeToolRef.current)) return;
      markAnnotationPreviewFrame(drawDiagGestureRef.current, {
        action: activeToolRef.current === 'highlighter' ? 'highlight-stroke' : 'pen-stroke',
      });
    };
    const onFreeDrawMouseUp = () => {
      if (SHAPE_TOOLS.includes(activeToolRef.current)) return;
      markAnnotationPointerRelease(drawDiagGestureRef.current, {
        action: activeToolRef.current === 'highlighter' ? 'highlight-stroke' : 'pen-stroke',
      });
    };
    canvas.on('mouse:down', onFreeDrawMouseDown);
    canvas.on('mouse:move', onFreeDrawMouseMove);
    canvas.on('mouse:up', onFreeDrawMouseUp);

    // Pre-unmount flush is handled by onBeforeDisposeRef (runs before canvas.off()).
    return () => {
      canvas.off('mouse:down', onFreeDrawMouseDown);
      canvas.off('mouse:move', onFreeDrawMouseMove);
      canvas.off('mouse:up', onFreeDrawMouseUp);
    };
  }, []); // Mount only

  // -------------------------------------------------------------------------
  // Shape drawing: mouse handlers for rect/ellipse/line/arrow
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    activeToolRef.current = activeTool;
    const isShape = configureCanvasForDrawingTool(canvas, activeTool);
    console.log(`[DrawCanvas p${pageNumber}] shape effect — tool=${activeTool}, isShape=${isShape}, isDrawingMode=${canvas.isDrawingMode}`);
    if (!isShape) {
      ensureFreeDrawingBrush(canvas);
      return;
    }

    const getPointer = (e) => canvas.getPointer(e.e);

    const updateBoundaryShapeFromPointer = (shape, pointer, tool) => {
      if (!shape || !pointer) return;
      const geometry = computeDrawnBoundaryShapePreviewGeometry({
        tool,
        startX: shapeDrawingRef.current.startX,
        startY: shapeDrawingRef.current.startY,
        pointerX: pointer.x,
        pointerY: pointer.y,
        strokeWidth: shape.strokeWidth,
      });
      shape._drawOuterBounds = geometry.outerBounds;
      shapeDrawingRef.current.lastPreviewGeometry = geometry;
      shape.set(geometry.fabricProps);
    };

    const commitShape = (shape, commitDiag = null) => {
      const annotationId = ensureAnnotationId(shape, activeToolRef.current || 'shape');
      updateAnnotationGesture(drawDiagGestureRef.current, {
        annotationId,
      });
      // fabric 7: toObject(CUSTOM_PROPS), not toJSON — see path:created note.
      let shapeJSON = shape.toObject(CUSTOM_PROPS);
      const tool = activeToolRef.current;
      if (tool === 'rect' || tool === 'ellipse') {
        shapeJSON = tagDrawnCenteredStrokeGeometry(shapeJSON);
      } else {
        shapeJSON = normalizeDrawnBoundaryShapeCommitGeometry(shapeJSON, shape._drawOuterBounds);
      }
      if (selectedModuleIdRef.current) shapeJSON.moduleId = selectedModuleIdRef.current;
      if (shouldAssignRegionId()) shapeJSON.regionId = activeRegionIdRef.current;

      // Tag line/arrow with tool so SVG renderer can differentiate
      if (tool === 'line' || tool === 'arrow') {
        shapeJSON.tool = tool;
        const headStyle = arrowheadStyleRef.current;
        if (headStyle) {
          shapeJSON.data = { ...(shapeJSON.data || {}), arrowheadStyle: headStyle };
        }
      }

      if (tool === 'arrow' || tool === 'line' || tool === 'rect' || tool === 'ellipse') {
        const borderStyle = lineBorderStyleRef.current;
        if (borderStyle === 'cloud' && tool === 'rect') {
          shapeJSON.strokeDashArray = null;
          shapeJSON.data = {
            ...(shapeJSON.data || {}),
            pdfCloudIntensity: Math.max(1, Number(cloudIntensityRef.current) || 2),
          };
        } else if (borderStyle === 'dashed') {
          shapeJSON.strokeDashArray = [6, 4];
        } else if (borderStyle === 'dotted') {
          shapeJSON.strokeDashArray = [2, 4];
        } else {
          shapeJSON.strokeDashArray = null;
        }
      }

      const serializedOuterBounds = geometryFromSerializedShape(shapeJSON);
      if (commitDiag && (tool === 'rect' || tool === 'ellipse')) {
        console.log('[ShapeCommitDiag] commit geometry', {
          annotationId,
          pageNumber,
          tool,
          pointerDown: roundedPoint(commitDiag.pointerDown),
          lastMouseMove: roundedPoint(commitDiag.lastMouseMove),
          mouseUp: roundedPoint(commitDiag.mouseUp),
          previewOuterBounds: roundedBox(commitDiag.previewOuterBounds),
          fabricPreviewBeforeCommit: {
            type: shape.type,
            left: Number((shape.left || 0).toFixed(3)),
            top: Number((shape.top || 0).toFixed(3)),
            width: Number((shape.width || 0).toFixed(3)),
            height: Number((shape.height || 0).toFixed(3)),
            rx: Number((shape.rx || 0).toFixed(3)),
            ry: Number((shape.ry || 0).toFixed(3)),
            strokeWidth: shape.strokeWidth,
          },
          serializedAnnotation: {
            type: shapeJSON.type,
            left: shapeJSON.left,
            top: shapeJSON.top,
            width: shapeJSON.width,
            height: shapeJSON.height,
            rx: shapeJSON.rx,
            ry: shapeJSON.ry,
            radius: shapeJSON.radius,
            strokeWidth: shapeJSON.strokeWidth,
            strokeRenderContract: shapeJSON.data?.strokeRenderContract,
          },
          serializedOuterBounds: roundedBox(serializedOuterBounds),
          deltaPreviewToSaved: boxDelta(commitDiag.previewOuterBounds, serializedOuterBounds),
        });
      }

      sessionPathsRef.current.push(shape);
      canvas.remove(shape);

      const currentAnnotations = annotationsRef.current;
      const updated = {
        ...currentAnnotations,
        objects: [...(currentAnnotations?.objects || []), shapeJSON],
      };
      onStrokeCommitRef.current(updated);
      if (commitDiag && (tool === 'rect' || tool === 'ellipse')) {
        scheduleShapeCommitSvgProbe({
          ...commitDiag,
          annotationId,
          pageNumber,
          tool,
          pageSize: { width: pageWidth, height: pageHeight },
          serializedOuterBounds,
        });
      }
    };

    const onMouseDown = (opt) => {
      const pointer = getPointer(opt);
      console.log(`[DrawCanvas p${pageNumber}] shape mousedown at (${pointer.x.toFixed(1)}, ${pointer.y.toFixed(1)}), tool=${activeToolRef.current}`);
      drawDiagGestureRef.current = beginAnnotationGesture({
        surface: 'FabricDrawingCanvas',
        tool: activeToolRef.current,
        type: activeToolRef.current === 'survey-marker' ? 'survey-marker' : activeToolRef.current,
        action: activeToolRef.current === 'survey-marker' ? 'survey-marker-draw' : `${activeToolRef.current}-draw`,
        pointerDown: true,
        pageNumber,
      });
      const state = shapeDrawingRef.current;
      state.isDrawing = true;
      state.startX = pointer.x;
      state.startY = pointer.y;
      state.pointerDown = { x: pointer.x, y: pointer.y };
      state.lastMovePointer = null;
      state.mouseUpPointer = null;
      state.lastPreviewGeometry = null;

      const tool = activeToolRef.current;
      const color = composeColor(strokeColor, strokeOpacityRef.current);
      const fill = composeColor(fillColorRef.current, fillOpacityRef.current);
      const sw = strokeWidth;

      if (tool === 'rect') {
        state.shape = new fabric.Rect({
          left: pointer.x, top: pointer.y, width: 0, height: 0,
          fill, stroke: color, strokeWidth: sw, strokeUniform: true,
        });
      } else if (tool === 'survey-marker') {
        state.shape = new fabric.Rect({
          left: pointer.x, top: pointer.y, width: 0, height: 0,
          fill: 'transparent',
          stroke: '#4A90E2',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          globalCompositeOperation: 'source-over',
          opacity: 1,
          strokeUniform: true,
        });
      } else if (tool === 'ellipse') {
        state.shape = new fabric.Ellipse({
          left: pointer.x, top: pointer.y, rx: 0, ry: 0,
          fill, stroke: color, strokeWidth: sw, strokeUniform: true,
        });
      } else if (tool === 'line' || tool === 'arrow') {
        state.shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: color, strokeWidth: sw, strokeUniform: true,
          // UX: CREATE-01 — dashed preview during click-drag signals "click-drag
          // to create" and visually distinguishes the in-progress stroke from
          // committed annotations. Matches combined-tools creation feedback.
          // See CREATE-01 in REQUIREMENTS.md and 14-UI-SPEC.md Interaction
          // Contract 3. Reset to strokeDashArray:null + opacity:1 BEFORE
          // commitShape() so the preview styling never persists into saved JSON.
          strokeDashArray: [5, 5],
          // UX: 0.6 opacity matches CREATE-01 acceptance bullet — preview is
          // deliberately translucent so the underlying page context stays
          // readable while the user decides where the line ends.
          opacity: 0.6,
        });
        console.log(`[DrawCanvas p${pageNumber}] ${tool} created — start=(${pointer.x.toFixed(1)}, ${pointer.y.toFixed(1)}), color=${color}, sw=${sw}`);
      }

      if (state.shape) {
        canvas.add(state.shape);
        canvas.renderAll();
      }
    };

    const onMouseMove = (opt) => {
      const state = shapeDrawingRef.current;
      if (!state.isDrawing || !state.shape) return;
      markAnnotationPreviewFrame(drawDiagGestureRef.current, {
        action: activeToolRef.current === 'survey-marker' ? 'survey-marker-draw' : `${activeToolRef.current}-draw`,
      });
      const pointer = getPointer(opt);
      state.lastMovePointer = { x: pointer.x, y: pointer.y };
      const tool = activeToolRef.current;

      if (tool === 'rect' || tool === 'survey-marker') {
        if (tool === 'rect') {
          updateBoundaryShapeFromPointer(state.shape, pointer, tool);
        } else {
          const left = Math.min(state.startX, pointer.x);
          const top = Math.min(state.startY, pointer.y);
          const width = Math.abs(pointer.x - state.startX);
          const height = Math.abs(pointer.y - state.startY);
          state.shape.set({
            left, top,
            width,
            height,
          });
        }
      } else if (tool === 'ellipse') {
        updateBoundaryShapeFromPointer(state.shape, pointer, tool);
      } else if (tool === 'line' || tool === 'arrow') {
        state.shape.set({ x2: pointer.x, y2: pointer.y });
      }

      canvas.renderAll();
    };

    const onMouseUp = (opt) => {
      const state = shapeDrawingRef.current;
      if (!state.isDrawing || !state.shape) return;
      const finalPointer = opt?.e ? getPointer(opt) : null;
      const finalTool = activeToolRef.current;
      if (finalPointer) {
        state.mouseUpPointer = { x: finalPointer.x, y: finalPointer.y };
      }
      if (finalPointer && (finalTool === 'rect' || finalTool === 'ellipse') && !state.lastPreviewGeometry) {
        updateBoundaryShapeFromPointer(state.shape, finalPointer, finalTool);
      }
      state.isDrawing = false;
      markAnnotationPointerRelease(drawDiagGestureRef.current, {
        action: activeToolRef.current === 'survey-marker' ? 'survey-marker-draw' : `${activeToolRef.current}-draw`,
      });

      // Only commit if shape has meaningful size
      const s = state.shape;
      const tool = activeToolRef.current;
      let hasSize = false;
      if (tool === 'rect') {
        const b = s._drawOuterBounds;
        hasSize = (b?.width ?? s.width) > 2 && (b?.height ?? s.height) > 2;
      } else if (tool === 'survey-marker') hasSize = s.width > 2 && s.height > 2;
      else if (tool === 'ellipse') {
        const b = s._drawOuterBounds;
        hasSize = (b?.width ?? s.rx * 2) > 2 && (b?.height ?? s.ry * 2) > 2;
      }
      else if (tool === 'line' || tool === 'arrow') {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
        hasSize = Math.sqrt(dx * dx + dy * dy) > 3;
      }

      if (tool === 'line' || tool === 'arrow') {
        console.log(`[DrawCanvas p${pageNumber}] ${tool} mouseup — hasSize=${hasSize}`, {
          fabricObj: { type: s.type, left: s.left?.toFixed(1), top: s.top?.toFixed(1), x1: s.x1?.toFixed(1), y1: s.y1?.toFixed(1), x2: s.x2?.toFixed(1), y2: s.y2?.toFixed(1), width: s.width?.toFixed(1), height: s.height?.toFixed(1) },
        });
      } else {
        console.log(`[DrawCanvas p${pageNumber}] shape mouseup — tool=${tool}, hasSize=${hasSize}`, s ? { left: s.left, top: s.top, w: s.width, h: s.height } : null);
      }
      if (hasSize) {
        // UX: CREATE-01 — reset dashed preview style BEFORE commitShape() so
        // the preview dashing does NOT persist into saved JSON. commitShape()
        // calls shape.toObject(CUSTOM_PROPS) which serializes whatever is
        // currently on the object. Line/arrow only — rect/ellipse never
        // applied the preview style in the first place. See 14-RESEARCH.md
        // Pitfall 1 (commitShape serialization timing) and 14-UI-SPEC.md
        // Interaction Contract 3.
        if (tool === 'line' || tool === 'arrow') {
          s.set({ strokeDashArray: null, opacity: 1 });
        }
        if (tool === 'survey-marker') {
          // Survey markers route through handleSurveyMarkerCreated so the
          // surveyMarkers state + Supabase sync path used by PAL
          // stays authoritative. The fabric preview gets removed here (no
          // commitShape → no entry in pageAnnotations.objects); SVG paints
          // the persisted surveyMarker next render.
          canvas.remove(s);
          recordAnnotationCommit({
            surface: 'FabricDrawingCanvas',
            source: 'survey-marker:create',
            action: 'survey-marker-draw',
            pageNumber,
          });
          if (onSurveyMarkerCreatedRef.current) {
            onSurveyMarkerCreatedRef.current({
              x: s.left,
              y: s.top,
              width: s.width,
              height: s.height,
            });
          }
        } else {
          const previewOuterBounds = s._drawOuterBounds
            || state.lastPreviewGeometry?.outerBounds
            || null;
          const commitDiag = (tool === 'rect' || tool === 'ellipse') ? {
            pointerDown: state.pointerDown,
            lastMouseMove: state.lastMovePointer,
            mouseUp: state.mouseUpPointer,
            previewOuterBounds,
          } : null;
          commitShape(s, commitDiag);
        }
      } else {
        canvas.remove(s);
        console.log(`[DrawCanvas p${pageNumber}] shape too small, discarded`);
      }
      state.shape = null;
      state.pointerDown = null;
      state.lastMovePointer = null;
      state.mouseUpPointer = null;
      state.lastPreviewGeometry = null;
      canvas.renderAll();
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    return () => {
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:move', onMouseMove);
      canvas.off('mouse:up', onMouseUp);
    };
  }, [activeTool, strokeColor, strokeWidth]);

  // -------------------------------------------------------------------------
  // Sync refs to avoid stale closures
  // -------------------------------------------------------------------------
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => { arrowheadStyleRef.current = arrowheadStyle; }, [arrowheadStyle]);
  useEffect(() => { lineBorderStyleRef.current = lineBorderStyle; }, [lineBorderStyle]);
  useEffect(() => { strokeOpacityRef.current = strokeOpacity; }, [strokeOpacity]);
  useEffect(() => { fillColorRef.current = fillColor; }, [fillColor]);
  useEffect(() => { fillOpacityRef.current = fillOpacity; }, [fillOpacity]);
  useEffect(() => { cloudIntensityRef.current = cloudIntensity; }, [cloudIntensity]);

  useEffect(() => {
    selectedModuleIdRef.current = selectedModuleId;
  }, [selectedModuleId]);

  useEffect(() => {
    selectedSpaceIdRef.current = selectedSpaceId;
  }, [selectedSpaceId]);

  useEffect(() => {
    activeRegionIdRef.current = activeRegionId;
  }, [activeRegionId]);

  useEffect(() => {
    spacesRef.current = spaces;
  }, [spaces]);

  useEffect(() => {
    isRegionOverlayEnabledRef.current = isRegionOverlayEnabled;
  }, [isRegionOverlayEnabled]);

  useEffect(() => {
    onStrokeCommitRef.current = onStrokeCommit;
  }, [onStrokeCommit]);

  useEffect(() => {
    onSurveyMarkerCreatedRef.current = onSurveyMarkerCreated;
  }, [onSurveyMarkerCreated]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  // -------------------------------------------------------------------------
  // Container-aware resize: keep Canvas sized to container after zoom changes.
  // Without this, strokes drawn after zoom are captured at the old scale.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = fabricRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const containerWidth = container.offsetWidth;
      if (containerWidth > 0 && pageWidth > 0) {
        // Flush in-progress stroke BEFORE resizing to prevent erratic points.
        // During zoom, mouse:move events between resize and flush would capture
        // coordinates with the wrong viewport transform, creating stray lines.
        if (canvas._isCurrentlyDrawing && canvas.freeDrawingBrush) {
          try {
            canvas.freeDrawingBrush.onMouseUp({ e: new MouseEvent('mouseup') });
          } catch (err) {
            console.error('Resize-triggered stroke flush error:', err);
          }
        }
        const effectiveScale = containerWidth / pageWidth;
        canvas.setZoom(effectiveScale);
        canvas.setWidth(Math.floor(pageWidth * effectiveScale));
        canvas.setHeight(Math.floor(pageHeight * effectiveScale));
        canvas.renderAll();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [pageWidth, pageHeight]);

  // -------------------------------------------------------------------------
  // Brush configuration (reconfigure on tool/color/width change, no remount)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvas.freeDrawingBrush) return;

    const brush = canvas.freeDrawingBrush;
    if (activeTool === 'highlighter') {
      brush.color = highlightColor;
      brush.width = Math.max(strokeWidth, 8);
    } else {
      brush.color = strokeColor;
      brush.width = strokeWidth;
    }
    // Live-preview parity: committed highlighter strokes render in SVG with
    // mix-blend-mode: multiply, but the live brush paints source-over on the
    // upper canvas — the stroke visibly lightens/thins at release. Blend the
    // live brush layer the same way the committed SVG does.
    if (canvas.upperCanvasEl) {
      canvas.upperCanvasEl.style.mixBlendMode = activeTool === 'highlighter' ? 'multiply' : '';
    }
  }, [activeTool, strokeColor, highlightColor, strokeWidth]);

  // -------------------------------------------------------------------------
  // Undo sync: detect annotation count decrease and remove last session path
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const currentCount = annotations?.objects?.length ?? 0;
    const expectedCount = sessionPathsRef.current.length + previousObjectCountRef.current;

    // If objects decreased (undo happened) and we have session paths to remove
    if (currentCount < expectedCount && sessionPathsRef.current.length > 0) {
      const poppedPath = sessionPathsRef.current.pop();
      if (poppedPath) {
        canvas.remove(poppedPath);
        canvas.renderAll();
      }
    }
  }, [annotations]);

  // -------------------------------------------------------------------------
  // Zoom-triggered flush: force-complete in-progress stroke on zoom start
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Skip on first render
    if (zoomGeneration === initialZoomGenRef.current) return;

    const canvas = fabricRef.current;
    if (canvas && canvas._isCurrentlyDrawing && canvas.freeDrawingBrush) {
      try {
        canvas.freeDrawingBrush.onMouseUp({ e: new MouseEvent('mouseup') });
      } catch (err) {
        console.error('Zoom-triggered stroke flush error:', err);
      }
    }
  }, [zoomGeneration]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        zIndex: 101,
        cursor: 'crosshair',
      }}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
});

FabricDrawingCanvas.displayName = 'FabricDrawingCanvas';

export default FabricDrawingCanvas;
