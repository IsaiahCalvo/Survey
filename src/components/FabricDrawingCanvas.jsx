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
import { fabric } from 'fabric';
import { useFabricCanvas } from '../hooks/useFabricCanvas';

// Custom properties to include in path serialization (matches PAL pattern)
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsBIC',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType',
];

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
  selectedModuleId,
  activeRegionId,
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

  // Refs to avoid stale closures in event handlers
  const activeToolRef = useRef(activeTool);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const activeRegionIdRef = useRef(activeRegionId);
  const onStrokeCommitRef = useRef(onStrokeCommit);
  const initialZoomGenRef = useRef(zoomGeneration);

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
  const { fabricRef } = useFabricCanvas({
    canvasElRef,
    onBeforeDisposeRef,
    options: {
      backgroundColor: 'transparent',
      isDrawingMode: true,
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

    // Container-aware sizing (CLAUDE.md rule)
    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth > 0 && pageWidth > 0) {
      const effectiveScale = containerWidth / pageWidth;
      canvas.setZoom(effectiveScale);
      canvas.setWidth(Math.floor(pageWidth * effectiveScale));
      canvas.setHeight(Math.floor(pageHeight * effectiveScale));
    }

    // Set up PencilBrush
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.defaultCursor = 'crosshair';
    canvas.freeDrawingCursor = 'crosshair';

    // Configure initial brush settings
    const brush = canvas.freeDrawingBrush;
    if (activeToolRef.current === 'highlighter') {
      brush.color = highlightColor;
      brush.width = Math.max(strokeWidth, 8);
    } else {
      brush.color = strokeColor;
      brush.width = strokeWidth;
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
      if (activeRegionIdRef.current) {
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

      // Commit per-stroke
      onStrokeCommitRef.current(updated);
    });

    // Pre-unmount flush is handled by onBeforeDisposeRef (runs before canvas.off()).
    // No cleanup needed here.
  }, []); // Mount only

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
    activeRegionIdRef.current = activeRegionId;
  }, [activeRegionId]);

  useEffect(() => {
    onStrokeCommitRef.current = onStrokeCommit;
  }, [onStrokeCommit]);

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
