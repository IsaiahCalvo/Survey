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
import React, { memo, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { fabric } from 'fabric';
import { useFabricCanvas } from '../hooks/useFabricCanvas';

// Custom properties to include in path serialization (matches PAL pattern)
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsBIC',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType',
  'tool',
];

const SHAPE_TOOLS = ['rect', 'ellipse', 'line', 'arrow', 'highlight'];

const FabricDrawingCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  activeTool,
  strokeColor,
  highlightColor,
  strokeWidth,
  annotations,
  onStrokeCommit,
  onHighlightCreated,
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
  const selectedModuleIdRef = useRef(selectedModuleId);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeRegionIdRef = useRef(activeRegionId);
  const spacesRef = useRef(spaces);
  const isRegionOverlayEnabledRef = useRef(isRegionOverlayEnabled);
  const onStrokeCommitRef = useRef(onStrokeCommit);
  const onHighlightCreatedRef = useRef(onHighlightCreated);
  const initialZoomGenRef = useRef(zoomGeneration);
  const isDisposingRef = useRef(false);

  const shouldAssignRegionId = () => {
    const regionId = activeRegionIdRef.current;
    const spaceId = selectedSpaceIdRef.current;
    if (!regionId || !spaceId) return false;

    const currentSpaces = Array.isArray(spacesRef.current) ? spacesRef.current : [];
    const space = currentSpaces.find((entry) => entry?.id === spaceId);
    if (!space) return false;

    const assignedPage = space.assignedPages?.find((page) => page?.pageId === pageNumber);
    if (!assignedPage) return false;

    const pageRegions = Array.isArray(assignedPage.regions) ? assignedPage.regions : [];
    if (!pageRegions.some((region) => region?.regionId === regionId)) {
      return false;
    }

    const overlayToggle = isRegionOverlayEnabledRef.current;
    if (typeof overlayToggle === 'function') {
      return overlayToggle(spaceId, pageNumber, assignedPage) !== false;
    }

    return true;
  };

  // Pre-dispose callback: flush in-progress stroke before canvas.off()/dispose()
  // so that the path:created handler is still bound when the flush fires it.
  // isDisposingRef flag tells path:created to keep the path on canvas (visual bridge
  // until React removes the DOM) instead of removing it.
  const onBeforeDisposeRef = useRef((canvas) => {
    if (canvas._isCurrentlyDrawing && canvas.freeDrawingBrush) {
      isDisposingRef.current = true;
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
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      const brush = canvas.freeDrawingBrush;
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
      const pathJSON = e.path.toJSON(CUSTOM_PROPS);
      pathJSON.left = 0;
      pathJSON.top = 0;

      // Track session path for undo sync (count-based, object not needed on Canvas)
      sessionPathsRef.current.push(e.path);

      // Remove committed path from Canvas — SVG layer is the display source.
      // Without this, the Canvas path and SVG path overlap at initial zoom but
      // diverge after zoom (Canvas doesn't resize, SVG viewBox auto-scales),
      // causing visible stroke duplication.
      canvas.remove(e.path);

      // Build updated annotations by appending new path
      const currentAnnotations = annotationsRef.current;
      const updated = {
        ...currentAnnotations,
        objects: [...(currentAnnotations?.objects || []), pathJSON],
      };

      // During dispose: flushSync forces synchronous SVG re-render so the
      // stroke is visible before Canvas DOM is removed (prevents 1-frame flicker).
      // Dev-mode React warns about flushSync in lifecycle — harmless, no-op in prod.
      if (isDisposingRef.current) {
        flushSync(() => onStrokeCommitRef.current(updated));
      } else {
        onStrokeCommitRef.current(updated);
      }
    });

    // Pre-unmount flush is handled by onBeforeDisposeRef (runs before canvas.off()).
    // No cleanup needed here.
  }, []); // Mount only

  // -------------------------------------------------------------------------
  // Shape drawing: mouse handlers for rect/ellipse/line/arrow
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const isShape = SHAPE_TOOLS.includes(activeToolRef.current);
    canvas.isDrawingMode = !isShape;
    console.log(`[DrawCanvas p${pageNumber}] shape effect — tool=${activeToolRef.current}, isShape=${isShape}, isDrawingMode=${canvas.isDrawingMode}`);
    if (!isShape) return;

    const getPointer = (e) => canvas.getPointer(e.e);

    const commitShape = (shape) => {
      const shapeJSON = shape.toJSON(CUSTOM_PROPS);
      if (selectedModuleIdRef.current) shapeJSON.moduleId = selectedModuleIdRef.current;
      if (shouldAssignRegionId()) shapeJSON.regionId = activeRegionIdRef.current;

      const tool = activeToolRef.current;
      // Tag line/arrow with tool so SVG renderer can differentiate
      if (tool === 'line' || tool === 'arrow') {
        shapeJSON.tool = tool;
      }

      sessionPathsRef.current.push(shape);
      canvas.remove(shape);

      const currentAnnotations = annotationsRef.current;
      const updated = {
        ...currentAnnotations,
        objects: [...(currentAnnotations?.objects || []), shapeJSON],
      };
      onStrokeCommitRef.current(updated);
    };

    const onMouseDown = (opt) => {
      const pointer = getPointer(opt);
      console.log(`[DrawCanvas p${pageNumber}] shape mousedown at (${pointer.x.toFixed(1)}, ${pointer.y.toFixed(1)}), tool=${activeToolRef.current}`);
      const state = shapeDrawingRef.current;
      state.isDrawing = true;
      state.startX = pointer.x;
      state.startY = pointer.y;

      const tool = activeToolRef.current;
      const color = strokeColor;
      const sw = strokeWidth;

      if (tool === 'rect') {
        state.shape = new fabric.Rect({
          left: pointer.x, top: pointer.y, width: 0, height: 0,
          fill: 'transparent', stroke: color, strokeWidth: sw, strokeUniform: true,
        });
      } else if (tool === 'highlight') {
        state.shape = new fabric.Rect({
          left: pointer.x, top: pointer.y, width: 0, height: 0,
          fill: highlightColor,
          stroke: 'transparent', strokeWidth: 0,
          globalCompositeOperation: 'multiply',
          opacity: 1,
          strokeUniform: true,
        });
      } else if (tool === 'ellipse') {
        state.shape = new fabric.Ellipse({
          left: pointer.x, top: pointer.y, rx: 0, ry: 0,
          fill: 'transparent', stroke: color, strokeWidth: sw, strokeUniform: true,
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
      const pointer = getPointer(opt);
      const tool = activeToolRef.current;

      if (tool === 'rect' || tool === 'highlight') {
        const left = Math.min(state.startX, pointer.x);
        const top = Math.min(state.startY, pointer.y);
        state.shape.set({
          left, top,
          width: Math.abs(pointer.x - state.startX),
          height: Math.abs(pointer.y - state.startY),
        });
      } else if (tool === 'ellipse') {
        const left = Math.min(state.startX, pointer.x);
        const top = Math.min(state.startY, pointer.y);
        state.shape.set({
          left, top,
          rx: Math.abs(pointer.x - state.startX) / 2,
          ry: Math.abs(pointer.y - state.startY) / 2,
        });
      } else if (tool === 'line' || tool === 'arrow') {
        state.shape.set({ x2: pointer.x, y2: pointer.y });
      }

      canvas.renderAll();
    };

    const onMouseUp = () => {
      const state = shapeDrawingRef.current;
      if (!state.isDrawing || !state.shape) return;
      state.isDrawing = false;

      // Only commit if shape has meaningful size
      const s = state.shape;
      const tool = activeToolRef.current;
      let hasSize = false;
      if (tool === 'rect' || tool === 'highlight') hasSize = s.width > 2 && s.height > 2;
      else if (tool === 'ellipse') hasSize = s.rx > 1 && s.ry > 1;
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
        // calls shape.toJSON(CUSTOM_PROPS) which serializes whatever is
        // currently on the object. Line/arrow only — rect/ellipse never
        // applied the preview style in the first place. See 14-RESEARCH.md
        // Pitfall 1 (commitShape serialization timing) and 14-UI-SPEC.md
        // Interaction Contract 3.
        if (tool === 'line' || tool === 'arrow') {
          s.set({ strokeDashArray: null, opacity: 1 });
        }
        if (tool === 'highlight') {
          // Survey highlights route through handleHighlightCreated so the
          // highlightAnnotations state + Supabase sync path used by PAL
          // stays authoritative. The fabric preview gets removed here (no
          // commitShape → no entry in pageAnnotations.objects); SVG paints
          // the persisted highlight next render.
          canvas.remove(s);
          if (onHighlightCreatedRef.current) {
            onHighlightCreatedRef.current({
              x: s.left,
              y: s.top,
              width: s.width,
              height: s.height,
            });
          }
        } else {
          commitShape(s);
        }
      } else {
        canvas.remove(s);
        console.log(`[DrawCanvas p${pageNumber}] shape too small, discarded`);
      }
      state.shape = null;
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
    onHighlightCreatedRef.current = onHighlightCreated;
  }, [onHighlightCreated]);

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
