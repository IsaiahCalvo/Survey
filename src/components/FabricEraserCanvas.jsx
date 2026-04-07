/**
 * FabricEraserCanvas
 *
 * Eraser Canvas component that loads ALL page annotations via enlivenObjects,
 * allows eraser strokes with boolean path subtraction via geometryEraser.js,
 * and commits erased results to SVG data per-gesture via onEraseCommit.
 *
 * Key behaviors:
 * - Container-aware sizing via setZoom(effectiveScale) so coordinates match SVG viewBox space
 * - Loading state: cursor 'wait' during enlivenObjects, then 'none' (App.jsx eraser circle overlay provides visual cursor)
 * - isLoadingRef mirrors isLoading state to avoid stale closure in mouse:down handler
 * - Each completed erase gesture serializes entire Canvas and commits via onEraseCommit
 * - Fully erased objects are removed from Canvas
 * - zoomGeneration prop change flushes in-progress erase gesture (EDIT-09)
 * - Pre-unmount commit flushes in-progress erase gesture on tool switch
 * - SVG layer is visibility:hidden while this component is mounted (handled by App.jsx)
 *
 * Phase 10 Plan 02: Eraser Canvas mount/unmount mechanism.
 */
import React, { memo, useState, useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useFabricCanvas } from '../hooks/useFabricCanvas';
import { splitPathDataByEraser, booleanErasePath } from '../utils/geometryEraser';

// Custom properties to include in object serialization (matches PAL / FabricDrawingCanvas pattern)
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsBIC',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType',
];

const FabricEraserCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  annotations,
  onEraseCommit,
  eraserSize = 20,
  viewerScale,
  selectedSpaceId,
  activeSpaceId,
  spaces,
  zoomGeneration,
}) => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [isLoading, setIsLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const mountedRef = useRef(true);

  // CRITICAL: Ref mirror of isLoading for use in mouse:down handler.
  // The mouse:down handler is bound in useEffect([]) and would capture the
  // initial isLoading=true state value forever due to stale closure.
  // The ref is always current.
  const isLoadingRef = useRef(true);

  const eraserPathRef = useRef([]);
  const isErasingRef = useRef(false);

  // Closure-safe refs for props
  const annotationsRef = useRef(annotations);
  const onEraseCommitRef = useRef(onEraseCommit);
  const eraserSizeRef = useRef(eraserSize);
  const viewerScaleRef = useRef(viewerScale);
  const effectiveScaleRef = useRef(1);
  const selectedSpaceIdRef = useRef(selectedSpaceId);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const spacesRef = useRef(spaces);
  const initialZoomGenRef = useRef(zoomGeneration);

  const getSpaceIdForRegion = (regionId) => {
    if (!regionId) return null;
    const currentSpaces = Array.isArray(spacesRef.current) ? spacesRef.current : [];
    for (const space of currentSpaces) {
      const assignedPages = Array.isArray(space?.assignedPages) ? space.assignedPages : [];
      for (const page of assignedPages) {
        const regions = Array.isArray(page?.regions) ? page.regions : [];
        for (const region of regions) {
          if (region?.regionId === regionId) {
            return space.id;
          }
        }
      }
    }
    return null;
  };

  // Pre-dispose callback: flush in-progress erase gesture before canvas.off()/dispose()
  const onBeforeDisposeRef = useRef((canvas) => {
    if (isErasingRef.current) {
      isErasingRef.current = false;
      try {
        applyEraserAndCommit(canvas);
      } catch (err) {
        console.error('Pre-unmount eraser flush error:', err);
      }
      eraserPathRef.current = [];
    }
    mountedRef.current = false;
  });

  // ---------------------------------------------------------------------------
  // Canvas lifecycle (useFabricCanvas hook)
  // ---------------------------------------------------------------------------
  const { fabricRef } = useFabricCanvas({
    canvasElRef,
    onBeforeDisposeRef,
    options: {
      backgroundColor: 'transparent',
      isDrawingMode: false,
      selection: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
      skipTargetFind: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Helper: apply eraser path to canvas objects and commit
  // ---------------------------------------------------------------------------
  const applyEraserAndCommit = useRef((canvas) => {
    const eraserPathData = eraserPathRef.current;
    if (!eraserPathData || eraserPathData.length === 0) return;

    // Single-click (only M, no L): duplicate the point so geometry eraser
    // treats it as a zero-length segment (eraser radius still applies)
    if (eraserPathData.length === 1 && (eraserPathData[0][0] === 'M')) {
      eraserPathData.push(['L', eraserPathData[0][1], eraserPathData[0][2]]);
    }

    // Adjust eraser radius to match the visual cursor overlay.
    // Cursor overlay uses: eraserSize * viewerScale (screen px).
    // Canvas operates at effectiveScale (container-aware), so page-space radius
    // maps to eraserSize * effectiveScale on screen. Compensate for the difference.
    const vs = viewerScaleRef.current || 1;
    const es = effectiveScaleRef.current || 1;
    const currentEraserSize = eraserSizeRef.current * (vs / es);

    // Build eraser path object compatible with geometryEraser.js
    // Both splitPathDataByEraser and booleanErasePath expect:
    //   eraserPath: { points: [{x, y}, ...] }
    //   eraserRadius: number
    const eraserPoints = [];
    for (const cmd of eraserPathData) {
      if (cmd[0] === 'M' || cmd[0] === 'L') {
        eraserPoints.push({ x: cmd[1], y: cmd[2] });
      }
    }
    const eraserPath = { points: eraserPoints };

    const objects = [...canvas.getObjects()];
    let changed = false;

    for (const obj of objects) {
      const objSpaceId = obj.spaceId || null;
      const objRegionId = obj.regionId || null;
      let shouldSkip = false;

      if (activeSpaceIdRef.current !== null) {
        if (objRegionId !== null) {
          const derivedSpaceId = getSpaceIdForRegion(objRegionId);
          if (derivedSpaceId !== null && derivedSpaceId !== activeSpaceIdRef.current) {
            shouldSkip = true;
          }
        } else if (objSpaceId !== null) {
          shouldSkip = objSpaceId !== activeSpaceIdRef.current;
        } else {
          shouldSkip = true;
        }
      } else if (selectedSpaceIdRef.current !== null && objSpaceId !== null) {
        shouldSkip = objSpaceId !== selectedSpaceIdRef.current;
      }

      if (shouldSkip) {
        continue;
      }

      // Only erase path-type objects (same approach as PAL -- non-path objects
      // like rect, ellipse, textbox are removed if touched, path objects get
      // boolean subtraction)
      if (obj.type === 'path' && obj.path) {
        // Use booleanErasePath for cookie-cutter boolean subtraction
        const result = booleanErasePath(obj, eraserPath, currentEraserSize);

        if (result) {
          let newPathData = null;
          let isConverted = false;

          if (Array.isArray(result)) {
            // Fully erased (empty array) or direct array return
            if (result.length === 0) {
              canvas.remove(obj);
              changed = true;
              continue;
            }
            newPathData = result;
          } else {
            newPathData = result.pathData;
            isConverted = result.isConvertedToOutline;
          }

          if (newPathData && newPathData.length > 0) {
            // Update the path data
            obj.path = newPathData;

            // If converted to outline, swap stroke and fill (same as PAL erasePathSegment)
            if (isConverted && obj.strokeWidth > 0) {
              const originalStroke = obj.stroke;
              obj.set({
                stroke: 'transparent',
                strokeWidth: 0,
                fill: originalStroke || obj.fill,
              });
            }

            // Recalculate dimensions and offsets for the new path
            if (obj._calcDimensions) {
              const dims = obj._calcDimensions();
              const newPathOffsetX = dims.left + dims.width / 2;
              const newPathOffsetY = dims.top + dims.height / 2;
              obj.set({
                width: dims.width,
                height: dims.height,
                pathOffset: { x: newPathOffsetX, y: newPathOffsetY },
              });
              // Use setPositionByOrigin to correctly position the erased path,
              // accounting for strokeWidth and scale (same as PencilBrush internals).
              const newPos = new fabric.Point(newPathOffsetX, newPathOffsetY);
              obj.setPositionByOrigin(newPos, 'center', 'center');
            }

            obj.setCoords();
            obj.dirty = true;
            changed = true;
          }
        }
      } else {
        // Non-path objects: remove if eraser touched them (same as PAL partial eraser fallback)
        const bounds = obj.getBoundingRect ? obj.getBoundingRect(true) : null;
        if (bounds) {
          const isTouching = eraserPoints.some(point => {
            return (
              point.x >= bounds.left - currentEraserSize &&
              point.x <= bounds.left + bounds.width + currentEraserSize &&
              point.y >= bounds.top - currentEraserSize &&
              point.y <= bounds.top + bounds.height + currentEraserSize
            );
          });
          if (isTouching) {
            canvas.remove(obj);
            changed = true;
          }
        }
      }
    }

    if (changed) {
      canvas.renderAll();
    }

    // Serialize the entire canvas and commit.
    // Normalize path left/top back to 0 for SVG renderer compatibility.
    // Canvas uses left=pathOffset for display, but SVG expects left=0 with
    // absolute path data (translate(0,0) is a no-op, path coords render directly).
    const canvasObjects = canvas.getObjects();
    const serializedObjects = canvasObjects.map((obj) => {
      const json = obj.toJSON(CUSTOM_PROPS);
      if (json.type === 'path') {
        json.left = 0;
        json.top = 0;
      }
      return json;
    });
    const updatedJSON = { objects: serializedObjects };
    onEraseCommitRef.current(updatedJSON);
  }).current;

  // ---------------------------------------------------------------------------
  // Canvas initialization: sizing, cursors, annotation loading, eraser events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !containerRef.current) return;

    // Container-aware sizing (CLAUDE.md rule)
    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth > 0 && pageWidth > 0) {
      const effectiveScale = containerWidth / pageWidth;
      effectiveScaleRef.current = effectiveScale;
      canvas.setZoom(effectiveScale);
      canvas.setWidth(Math.floor(pageWidth * effectiveScale));
      canvas.setHeight(Math.floor(pageHeight * effectiveScale));
    }

    // Cursors: 'none' so the existing App.jsx eraser circle overlay provides the visual cursor
    canvas.defaultCursor = 'none';
    canvas.hoverCursor = 'none';
    canvas.moveCursor = 'none';

    // -----------------------------------------------------------------------
    // Load annotations via enlivenObjects
    // -----------------------------------------------------------------------
    const annotationsToLoad = annotationsRef.current;
    const objectsArray = annotationsToLoad?.objects || [];

    if (objectsArray.length > 0) {
      fabric.util.enlivenObjects(objectsArray, (enlivenedObjects) => {
        // Guard: component may have unmounted during async load
        if (!mountedRef.current) return;

        enlivenedObjects.forEach((obj, index) => {
          const objData = objectsArray[index];

          obj.set({
            strokeUniform: true,
            selectable: false,
            evented: false,
          });

          // Copy metadata
          if (objData.spaceId) obj.spaceId = objData.spaceId;
          if (objData.moduleId) obj.moduleId = objData.moduleId;
          if (objData.regionId) obj.regionId = objData.regionId;
          if (objData.layer) obj.layer = objData.layer;
          if (objData.highlightId) obj.highlightId = objData.highlightId;
          if (objData.needsBIC) obj.needsBIC = objData.needsBIC;
          if (objData.data) obj.data = objData.data;
          if (objData.name) obj.name = objData.name;
          if (objData.isPdfImported) obj.isPdfImported = objData.isPdfImported;
          if (objData.pdfAnnotationId) obj.pdfAnnotationId = objData.pdfAnnotationId;
          if (objData.pdfAnnotationType) obj.pdfAnnotationType = objData.pdfAnnotationType;
          if (objData.globalCompositeOperation) {
            obj.set({ globalCompositeOperation: objData.globalCompositeOperation });
          }

          // Enforce multiply blend mode for highlights
          if (obj.highlightId || obj.needsBIC) {
            obj.set({ globalCompositeOperation: 'multiply' });
          }

          canvas.add(obj);

          // Fix coordinate space for Canvas rendering.
          // Annotations are stored with left=0, top=0 (absolute page-space path data).
          // Use Fabric's setPositionByOrigin (same method PencilBrush uses internally)
          // which accounts for strokeWidth, scale, and skew in the offset calculation.
          if (obj.type === 'path' && obj.pathOffset) {
            const pos = new fabric.Point(obj.pathOffset.x, obj.pathOffset.y);
            obj.setPositionByOrigin(pos, 'center', 'center');
            obj.setCoords();
          }
        });

        canvas.renderAll();

        // CRITICAL: update both state and ref simultaneously so the mouse:down
        // handler (bound in this useEffect) reads the current value via the ref.
        setIsLoading(false);
        isLoadingRef.current = false;
      });
    } else {
      // No annotations to load -- immediately ready
      canvas.renderAll();
      setIsLoading(false);
      isLoadingRef.current = false;
    }

    // -----------------------------------------------------------------------
    // Eraser gesture handling: mouse:down, mouse:move, mouse:up
    // -----------------------------------------------------------------------

    // mouse:down
    canvas.on('mouse:down', (opt) => {
      // MUST check the ref, NOT the state variable, because this handler is
      // bound in useEffect([]) and the state value would be stale (always true).
      if (isLoadingRef.current) return;

      isErasingRef.current = true;
      const pointer = canvas.getPointer(opt.e);
      eraserPathRef.current = [['M', pointer.x, pointer.y]];
    });

    // mouse:move
    canvas.on('mouse:move', (opt) => {
      if (!isErasingRef.current) return;
      const pointer = canvas.getPointer(opt.e);
      eraserPathRef.current.push(['L', pointer.x, pointer.y]);
    });

    // mouse:up
    canvas.on('mouse:up', () => {
      if (!isErasingRef.current) return;
      isErasingRef.current = false;

      applyEraserAndCommit(canvas);
      eraserPathRef.current = [];
    });

    // Pre-unmount flush is handled by onBeforeDisposeRef (runs before canvas.off()).
    // No cleanup needed here.
  }, []); // Mount only

  // ---------------------------------------------------------------------------
  // Sync refs to avoid stale closures
  // ---------------------------------------------------------------------------
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    onEraseCommitRef.current = onEraseCommit;
  }, [onEraseCommit]);

  useEffect(() => {
    eraserSizeRef.current = eraserSize;
  }, [eraserSize]);

  useEffect(() => {
    viewerScaleRef.current = viewerScale;
  }, [viewerScale]);

  useEffect(() => {
    selectedSpaceIdRef.current = selectedSpaceId;
  }, [selectedSpaceId]);

  useEffect(() => {
    activeSpaceIdRef.current = activeSpaceId;
  }, [activeSpaceId]);

  useEffect(() => {
    spacesRef.current = spaces;
  }, [spaces]);

  // ---------------------------------------------------------------------------
  // Container-aware resize: keep Canvas sized to container after zoom changes.
  // Without this, the Canvas stays at its initial dimensions when zooming,
  // causing annotations to shift relative to the SVG/page (same pattern as
  // FabricDrawingCanvas).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = fabricRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const containerWidth = container.offsetWidth;
      if (containerWidth > 0 && pageWidth > 0) {
        const effectiveScale = containerWidth / pageWidth;
        effectiveScaleRef.current = effectiveScale;
        canvas.setZoom(effectiveScale);
        canvas.setWidth(Math.floor(pageWidth * effectiveScale));
        canvas.setHeight(Math.floor(pageHeight * effectiveScale));
        canvas.renderAll();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [pageWidth, pageHeight]);

  // ---------------------------------------------------------------------------
  // Zoom-triggered flush: force-complete in-progress erase gesture on zoom start
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Skip on first render
    if (zoomGeneration === initialZoomGenRef.current) return;

    const canvas = fabricRef.current;
    if (canvas && isErasingRef.current) {
      isErasingRef.current = false;
      try {
        applyEraserAndCommit(canvas);
      } catch (err) {
        console.error('Zoom-triggered eraser flush error:', err);
      }
      eraserPathRef.current = [];
    }
  }, [zoomGeneration]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
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
        cursor: isLoading ? 'wait' : 'none',
      }}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
});

FabricEraserCanvas.displayName = 'FabricEraserCanvas';

export default FabricEraserCanvas;
