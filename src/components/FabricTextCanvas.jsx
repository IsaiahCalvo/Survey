/**
 * FabricTextCanvas
 *
 * Text creation Canvas component. Mounts a transparent full-page Fabric.js Canvas
 * when the Text tool is active. Click anywhere to place a new Textbox and start
 * typing — cursor works natively because canvas zoom matches the viewport scale.
 *
 * Key behaviors:
 * - Container-aware sizing via setZoom(effectiveScale) — coordinates are in
 *   unscaled page space (SVG viewBox space), cursor drift eliminated
 * - mouse:down on empty area creates new Textbox at click position
 * - Click outside active text commits it, then creates new text at click position
 * - Escape cancels active text without saving
 * - Pre-unmount commit flushes active text on tool switch
 * - zoomGeneration signal auto-commits text during zoom
 * - ResizeObserver keeps canvas sized to container after zoom
 *
 * Replaces the FabricEditCanvas zoom=1 hack for new text creation.
 * FabricEditCanvas still handles editing of existing text (double-click flow).
 */
import { memo, useEffect, useRef } from 'react';

import { fabric } from 'fabric';
import { useFabricCanvas } from '../hooks/useFabricCanvas';

// Custom properties to include in text serialization (matches PAL/Drawing pattern)
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'annotationId', 'needsEntity',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType', 'pdfInkRenderMode',
];

const DEFAULT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

const FabricTextCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  strokeColor,
  annotations,
  onTextCommit,
  selectedModuleId,
  activeRegionId,
  zoomGeneration,
}) => {
  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const annotationsRef = useRef(annotations);
  const onTextCommitRef = useRef(onTextCommit);
  const strokeColorRef = useRef(strokeColor);
  const selectedModuleIdRef = useRef(selectedModuleId);
  const activeRegionIdRef = useRef(activeRegionId);
  const initialZoomGenRef = useRef(zoomGeneration);


  // -------------------------------------------------------------------------
  // Commit helper: serialize Textbox, append to annotations, call onTextCommit
  // -------------------------------------------------------------------------
  const commitTextRef = useRef((canvas, textObj) => {
    const text = textObj.text?.trim();
    if (!text) {
      canvas.remove(textObj);
      return;
    }

    textObj.exitEditing?.();
    const textJSON = textObj.toJSON(CUSTOM_PROPS);

    // Assign metadata
    if (selectedModuleIdRef.current) textJSON.moduleId = selectedModuleIdRef.current;
    if (activeRegionIdRef.current) textJSON.regionId = activeRegionIdRef.current;

    // Remove from canvas — SVG layer is the display source
    canvas.remove(textObj);

    // Build updated annotations by appending new text
    const current = annotationsRef.current;
    const updated = {
      ...current,
      objects: [...(current?.objects || []), textJSON],
    };

    // Always use normal callback — flushSync during useEffect cleanup (dispose)
    // can fail silently in React 18, causing text to be lost on tool switch.
    onTextCommitRef.current(updated);
  });

  // -------------------------------------------------------------------------
  // Pre-dispose: commit active text before canvas cleanup
  // -------------------------------------------------------------------------
  const onBeforeDisposeRef = useRef((canvas) => {
    const active = canvas.getActiveObject();
    if (active && (active.type === 'textbox' || active.type === 'i-text')) {
      commitTextRef.current(canvas, active);
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
      isDrawingMode: false,
      selection: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
    },
  });

  // -------------------------------------------------------------------------
  // Canvas initialization: container-aware sizing, mouse:down text creation
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

    canvas.defaultCursor = 'text';
    canvas.hoverCursor = 'text';

    // mouse:down: commit active text and/or create new Textbox
    canvas.on('mouse:down', (opt) => {
      if (opt.target) return; // clicked on existing text object — let Fabric handle

      // Commit any active text first
      const active = canvas.getActiveObject();
      if (active && (active.type === 'textbox' || active.type === 'i-text')) {
        commitTextRef.current(canvas, active);
      }

      // Create new Textbox at click position (page-space coords via canvas zoom)
      const pointer = canvas.getPointer(opt.e);
      const textObj = new fabric.Textbox('', {
        left: pointer.x,
        top: pointer.y,
        width: 160,
        fontSize: 16,
        fill: strokeColorRef.current || '#000000',
        fontFamily: DEFAULT_FONT_FAMILY,
        // Default 1px black border on new user-created textboxes so they
        // read as a distinct "text box" out of the box. Mini-toolbar (future
        // phase) will let users toggle border / fill / font / alignment.
        stroke: '#000000',
        strokeWidth: 1,
        strokeUniform: true,
        editable: true,
        selectable: true,
        evented: true,
      });

      canvas.add(textObj);
      canvas.setActiveObject(textObj);
      canvas.renderAll();
      textObj.enterEditing();
    });

    // Escape: cancel active text without saving
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        const c = fabricRef.current;
        if (!c) return;
        const active = c.getActiveObject();
        if (active && (active.type === 'textbox' || active.type === 'i-text')) {
          active.exitEditing();
          c.remove(active);
          c.discardActiveObject();
          c.renderAll();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // Mount only

  // -------------------------------------------------------------------------
  // Sync refs to avoid stale closures
  // -------------------------------------------------------------------------
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { onTextCommitRef.current = onTextCommit; }, [onTextCommit]);
  useEffect(() => { strokeColorRef.current = strokeColor; }, [strokeColor]);
  useEffect(() => { selectedModuleIdRef.current = selectedModuleId; }, [selectedModuleId]);
  useEffect(() => { activeRegionIdRef.current = activeRegionId; }, [activeRegionId]);

  // -------------------------------------------------------------------------
  // Container-aware resize: keep Canvas sized to container after zoom changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = fabricRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const containerWidth = container.offsetWidth;
      if (containerWidth > 0 && pageWidth > 0) {
        // Commit active text before resize to avoid coordinate mismatch
        const active = canvas.getActiveObject();
        if (active && (active.type === 'textbox' || active.type === 'i-text') && active.isEditing) {
          commitTextRef.current(canvas, active);
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
  // Zoom-triggered commit: save active text on zoom start
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (zoomGeneration === initialZoomGenRef.current) return;
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && (active.type === 'textbox' || active.type === 'i-text')) {
      commitTextRef.current(canvas, active);
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
        cursor: 'text',
      }}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
});

FabricTextCanvas.displayName = 'FabricTextCanvas';

export default FabricTextCanvas;
