/**
 * FabricEditCanvas
 *
 * Unified edit Canvas component for text, shape, and callout annotations.
 * Mounts a Fabric.js Canvas overlay for interactive editing when the user
 * double-clicks an annotation in the SVG layer (or clicks to place new text).
 *
 * Three modes controlled by `editType` prop:
 * - 'text': bbox Canvas with IText editing (enter/exit/commit/cancel)
 * - 'shape': bbox Canvas with interactive handles + mini-toolbar (fill/stroke/width)
 * - 'callout': full-page Canvas with all annotations loaded, target selectable
 *
 * Key behaviors:
 * - Container-aware sizing via effectiveScale = container.offsetWidth / pageWidth (CLAUDE.md)
 * - CSS transform zoom bridge (ZOOM-02): visual stability during zoom transition
 * - 200ms ResizeObserver settle debounce (ZOOM-03): Canvas resize after zoom settles
 * - Click-outside commits edit, Escape cancels
 * - flushSync during dispose for synchronous SVG re-render before Canvas DOM removal
 * - Text cursor position restored after zoom settle (ZOOM-04)
 *
 * Phase 11 Plan 01: Final user-facing feature of v2.0 SVG migration.
 */
import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { fabric } from 'fabric';
import { useFabricCanvas } from '../hooks/useFabricCanvas';

// Custom properties to include in object serialization (matches FabricDrawingCanvas/FabricEraserCanvas)
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsBIC',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType',
];

const BBOX_PADDING = 20;

const DEFAULT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

// ---------------------------------------------------------------------------
// MiniToolbar -- floating toolbar for shape editing (fill/stroke/width)
// ---------------------------------------------------------------------------
const MiniToolbar = memo(({ fabricRef, containerRef, editCanvasStyle, onPropertyChange }) => {
  const [fill, setFill] = useState('transparent');
  const [stroke, setStroke] = useState('#000000');
  const [strokeW, setStrokeW] = useState(3);
  const [showFillPicker, setShowFillPicker] = useState(false);
  const [showStrokePicker, setShowStrokePicker] = useState(false);
  const toolbarRef = useRef(null);

  // Sync from active object
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    setFill(obj.fill || 'transparent');
    setStroke(obj.stroke || '#000000');
    setStrokeW(obj.strokeWidth || 3);
  }, [fabricRef]);

  const updateProperty = useCallback((prop, value) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    obj.set(prop, value);
    canvas.renderAll();
    if (onPropertyChange) onPropertyChange();
  }, [fabricRef, onPropertyChange]);

  const handleStrokeWidthChange = useCallback((delta) => {
    const newW = Math.max(1, Math.min(20, strokeW + delta));
    setStrokeW(newW);
    updateProperty('strokeWidth', newW);
  }, [strokeW, updateProperty]);

  // Position: 8px above the edit Canvas container
  const positionStyle = {
    position: 'absolute',
    left: editCanvasStyle?.left ?? 0,
    top: (editCanvasStyle?.top ?? 0) - 44,
    zIndex: 102,
  };

  // If not enough space above, position below
  if (positionStyle.top < 0) {
    positionStyle.top = (editCanvasStyle?.top ?? 0) + (editCanvasStyle?.height ?? 0) + 8;
  }

  const PRESET_COLORS = [
    '#FF0000', '#FF8000', '#FFFF00', '#00FF00',
    '#00FFFF', '#0000FF', '#8000FF', '#FF00FF',
    '#FFFFFF', '#C0C0C0', '#808080', '#000000',
  ];

  const renderColorGrid = (currentColor, onSelect, onClose) => (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 4,
        background: '#2D2D2D',
        border: '1px solid #3A3A3A',
        borderRadius: 6,
        padding: 8,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 4,
        zIndex: 103,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {PRESET_COLORS.map((c) => (
        <div
          key={c}
          onClick={() => { onSelect(c); onClose(); }}
          style={{
            width: 20,
            height: 20,
            backgroundColor: c,
            borderRadius: 2,
            border: c === currentColor ? '2px solid #4A90E2' : '1px solid #555',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );

  return (
    <div
      ref={toolbarRef}
      style={{
        ...positionStyle,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#2D2D2D',
        border: '1px solid #3A3A3A',
        borderRadius: 6,
        padding: '8px 12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        minWidth: 240,
        maxWidth: 360,
        height: 36,
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Fill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>Fill:</span>
        <div
          onClick={() => { setShowFillPicker(!showFillPicker); setShowStrokePicker(false); }}
          style={{
            width: 16, height: 16,
            backgroundColor: fill === 'transparent' ? 'transparent' : fill,
            borderRadius: 2,
            border: '1px solid #555',
            cursor: 'pointer',
            backgroundImage: fill === 'transparent' ? 'linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%), linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%)' : undefined,
            backgroundSize: fill === 'transparent' ? '8px 8px' : undefined,
            backgroundPosition: fill === 'transparent' ? '0 0, 4px 4px' : undefined,
          }}
        />
        {showFillPicker && renderColorGrid(fill, (c) => {
          setFill(c);
          updateProperty('fill', c);
        }, () => setShowFillPicker(false))}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 20, backgroundColor: '#3A3A3A' }} />

      {/* Stroke */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>Stroke:</span>
        <div
          onClick={() => { setShowStrokePicker(!showStrokePicker); setShowFillPicker(false); }}
          style={{
            width: 16, height: 16,
            backgroundColor: stroke,
            borderRadius: 2,
            border: '1px solid #555',
            cursor: 'pointer',
          }}
        />
        {showStrokePicker && renderColorGrid(stroke, (c) => {
          setStroke(c);
          updateProperty('stroke', c);
        }, () => setShowStrokePicker(false))}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 20, backgroundColor: '#3A3A3A' }} />

      {/* Stroke Width */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>Width:</span>
        <button
          onClick={() => handleStrokeWidthChange(-1)}
          style={{
            width: 20, height: 20,
            background: '#444', border: '1px solid #555', borderRadius: 2,
            color: '#FFF', fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, lineHeight: 1,
          }}
        >-</button>
        <span style={{ fontSize: 12, fontWeight: 400, color: '#FFFFFF', minWidth: 24, textAlign: 'center' }}>
          {strokeW}px
        </span>
        <button
          onClick={() => handleStrokeWidthChange(1)}
          style={{
            width: 20, height: 20,
            background: '#444', border: '1px solid #555', borderRadius: 2,
            color: '#FFF', fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, lineHeight: 1,
          }}
        >+</button>
      </div>
    </div>
  );
});

MiniToolbar.displayName = 'MiniToolbar';

// ---------------------------------------------------------------------------
// FabricEditCanvas
// ---------------------------------------------------------------------------
const FabricEditCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  editType,            // 'text' | 'shape' | 'callout'
  annotationData,      // Fabric.js JSON object for the annotation being edited (null for new text)
  annotationIndex,     // index in annotations.objects array (-1 for new text)
  annotations,         // full page annotations JSON
  onEditCommit,        // (updatedAnnotationsJSON) => void
  onEditCancel,        // () => void
  strokeColor,         // current stroke color (for new text creation)
  zoomGeneration,      // zoom signal from App.jsx
  viewerScale,         // syncfusionViewerScale
  isNewText,           // true when text tool click-to-place creates new annotation
  clickPosition,       // { x, y } in page coordinates for new text placement
}) => {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [isLoading, setIsLoading] = useState(true);
  const [zoomTransformStyle, setZoomTransformStyle] = useState(null);
  const [containerStyle, setContainerStyle] = useState({});

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  const canvasElRef = useRef(null);
  const containerRef = useRef(null);
  const mountedRef = useRef(true);

  // Closure-safe refs
  const annotationsRef = useRef(annotations);
  const editTypeRef = useRef(editType);
  const onEditCommitRef = useRef(onEditCommit);
  const onEditCancelRef = useRef(onEditCancel);
  const cursorPositionRef = useRef(null);
  const originalAnnotationRef = useRef(null);
  const bboxOriginRef = useRef(null);
  const lastContainerSizeRef = useRef({ width: 0, height: 0 });
  const initialZoomGenRef = useRef(zoomGeneration);
  const settleTimerRef = useRef(null);
  const committedRef = useRef(false);
  const annotationDataRef = useRef(annotationData);

  // -------------------------------------------------------------------------
  // Commit logic
  // -------------------------------------------------------------------------
  const commitAndClose = useCallback((canvas, opts = {}) => {
    if (committedRef.current) return;
    committedRef.current = true;

    if (!canvas) canvas = fabricRef.current;
    if (!canvas) {
      committedRef.current = false;
      return;
    }

    const activeObj = canvas.getActiveObject();

    // For text: exit editing mode cleanly
    if (editTypeRef.current === 'text' && activeObj && activeObj.isEditing) {
      activeObj.exitEditing();
    }

    // For new text: discard if empty
    if (isNewText && activeObj) {
      const textContent = activeObj.text || '';
      if (textContent.trim() === '') {
        if (onEditCancelRef.current) onEditCancelRef.current();
        return;
      }
    }

    if (!activeObj) {
      committedRef.current = false;
      if (onEditCancelRef.current) onEditCancelRef.current();
      return;
    }

    // Serialize with custom properties
    const json = activeObj.toJSON(CUSTOM_PROPS);

    // For bbox mode (text/shape): reverse coordinate offset
    if (editTypeRef.current !== 'callout' && bboxOriginRef.current) {
      json.left = bboxOriginRef.current.left + (json.left - BBOX_PADDING);
      json.top = bboxOriginRef.current.top + (json.top - BBOX_PADDING);
    }

    // For paths: normalize left/top to 0 for SVG renderer compatibility
    if (json.type === 'path') {
      json.left = 0;
      json.top = 0;
    }

    // Build updated annotations
    const currentAnnotations = annotationsRef.current;
    const updated = JSON.parse(JSON.stringify(currentAnnotations || { objects: [] }));

    if (isNewText) {
      // Append new text annotation
      updated.objects.push(json);
    } else {
      // Replace existing annotation at index
      updated.objects[annotationIndex] = json;
    }

    if (opts.flush) {
      flushSync(() => onEditCommitRef.current(updated));
    } else {
      onEditCommitRef.current(updated);
    }
  }, [annotationIndex, isNewText]);

  const cancelAndClose = useCallback((canvas) => {
    if (committedRef.current) return;
    committedRef.current = true;

    if (!canvas) canvas = fabricRef.current;
    if (canvas) {
      const activeObj = canvas.getActiveObject();
      if (activeObj && activeObj.isEditing) {
        activeObj.exitEditing();
      }
    }

    if (onEditCancelRef.current) onEditCancelRef.current();
  }, []);

  // -------------------------------------------------------------------------
  // Pre-dispose callback: auto-commit on unmount
  // -------------------------------------------------------------------------
  const onBeforeDisposeRef = useRef((canvas) => {
    if (!committedRef.current) {
      commitAndClose(canvas, { flush: true });
    }
    mountedRef.current = false;
  });

  // Keep the onBeforeDispose closure fresh
  useEffect(() => {
    onBeforeDisposeRef.current = (canvas) => {
      if (!committedRef.current) {
        commitAndClose(canvas, { flush: true });
      }
      mountedRef.current = false;
    };
  }, [commitAndClose]);

  // -------------------------------------------------------------------------
  // Canvas lifecycle (useFabricCanvas hook)
  // -------------------------------------------------------------------------
  const { fabricRef } = useFabricCanvas({
    canvasElRef,
    onBeforeDisposeRef,
    options: {
      backgroundColor: 'transparent',
      isDrawingMode: false,
      selection: editType !== 'text',
      enableRetinaScaling: true,
      stopContextMenu: true,
      renderOnAddRemove: false,
    },
  });

  // -------------------------------------------------------------------------
  // Compute container style for bbox vs full-page mode
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Find the portal host (parent element sized by Syncfusion)
    const parentEl = container.parentElement;
    if (!parentEl || parentEl.offsetWidth <= 0 || pageWidth <= 0) return;

    const effectiveScale = parentEl.offsetWidth / pageWidth;

    let style;
    if (editType === 'callout') {
      // Full-page mode
      style = {
        position: 'absolute',
        left: 0,
        top: 0,
        width: parentEl.offsetWidth,
        height: parentEl.offsetHeight,
        zIndex: 101,
        pointerEvents: 'auto',
      };
    } else {
      // Bbox mode (text or shape)
      let annLeft, annTop, annWidth, annHeight;

      if (isNewText && clickPosition) {
        annLeft = clickPosition.x;
        annTop = clickPosition.y;
        annWidth = 200; // default width for new text
        annHeight = 40;  // default height for new text
      } else if (annotationData) {
        annLeft = annotationData.left || 0;
        annTop = annotationData.top || 0;
        annWidth = (annotationData.width || 100) * (annotationData.scaleX || 1);
        annHeight = (annotationData.height || 30) * (annotationData.scaleY || 1);
      } else {
        annLeft = 0;
        annTop = 0;
        annWidth = 200;
        annHeight = 40;
      }

      style = {
        position: 'absolute',
        left: (annLeft - BBOX_PADDING) * effectiveScale,
        top: (annTop - BBOX_PADDING) * effectiveScale,
        width: (annWidth + BBOX_PADDING * 2) * effectiveScale,
        height: (annHeight + BBOX_PADDING * 2) * effectiveScale,
        zIndex: 101,
        pointerEvents: 'auto',
      };
    }

    setContainerStyle(style);
  }, [editType, annotationData, isNewText, clickPosition, pageWidth, pageHeight]);

  // -------------------------------------------------------------------------
  // Canvas initialization: sizing, annotation loading
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !containerRef.current) return;

    const parentEl = containerRef.current.parentElement;
    if (!parentEl || parentEl.offsetWidth <= 0 || pageWidth <= 0) return;

    const effectiveScale = parentEl.offsetWidth / pageWidth;

    // Calculate canvas dimensions
    let canvasWidth, canvasHeight;
    if (editTypeRef.current === 'callout') {
      canvasWidth = parentEl.offsetWidth;
      canvasHeight = parentEl.offsetHeight;
    } else {
      let annWidth, annHeight;
      if (isNewText && clickPosition) {
        annWidth = 200;
        annHeight = 40;
      } else if (annotationDataRef.current) {
        annWidth = (annotationDataRef.current.width || 100) * (annotationDataRef.current.scaleX || 1);
        annHeight = (annotationDataRef.current.height || 30) * (annotationDataRef.current.scaleY || 1);
      } else {
        annWidth = 200;
        annHeight = 40;
      }
      canvasWidth = Math.floor((annWidth + BBOX_PADDING * 2) * effectiveScale);
      canvasHeight = Math.floor((annHeight + BBOX_PADDING * 2) * effectiveScale);
    }

    // Container-aware sizing (CLAUDE.md rule)
    canvas.setZoom(effectiveScale);
    canvas.setDimensions({ width: canvasWidth, height: canvasHeight });

    lastContainerSizeRef.current = { width: canvasWidth, height: canvasHeight };

    // Branch by editType
    if (editTypeRef.current === 'text') {
      loadTextAnnotation(canvas, effectiveScale);
    } else if (editTypeRef.current === 'shape') {
      loadShapeAnnotation(canvas);
    } else if (editTypeRef.current === 'callout') {
      loadCalloutAnnotation(canvas);
    }
  }, []); // Mount only

  // -------------------------------------------------------------------------
  // Text loading
  // -------------------------------------------------------------------------
  const loadTextAnnotation = useCallback((canvas, effectiveScale) => {
    if (isNewText) {
      // New text creation: empty IText at click position
      const textObj = new fabric.IText('', {
        left: BBOX_PADDING,
        top: BBOX_PADDING,
        fontSize: 16,
        fill: strokeColor || '#000000',
        fontFamily: DEFAULT_FONT_FAMILY,
        editable: true,
        selectable: true,
        evented: true,
      });

      bboxOriginRef.current = {
        left: clickPosition?.x ?? 0,
        top: clickPosition?.y ?? 0,
      };
      originalAnnotationRef.current = null;

      // Hide outer selection border — only the IText editing cursor box should be visible
      textObj.hasBorders = false;
      textObj.hasControls = false;

      canvas.add(textObj);
      canvas.setActiveObject(textObj);
      canvas.renderAll();

      // Enter editing mode
      textObj.enterEditing();
      setIsLoading(false);
    } else if (annotationDataRef.current) {
      // Editing existing text annotation
      const annData = annotationDataRef.current;
      bboxOriginRef.current = { left: annData.left || 0, top: annData.top || 0 };
      originalAnnotationRef.current = JSON.parse(JSON.stringify(annData));

      fabric.util.enlivenObjects([annData], (objects) => {
        if (!mountedRef.current || objects.length === 0) return;
        const textObj = objects[0];

        // Sanitize styles — Fabric.js 5.x enlivenObjects can leave undefined line entries
        // in the styles object, which causes "Cannot read properties of undefined" errors
        // in removeStyleFromTo (delete) and stylesToArray (serialize).
        if (textObj.styles) {
          const lineCount = (textObj.text || '').split('\n').length;
          for (let i = 0; i < lineCount; i++) {
            if (!textObj.styles[i]) textObj.styles[i] = {};
          }
        } else {
          textObj.styles = {};
        }

        textObj.set({
          left: BBOX_PADDING,
          top: BBOX_PADDING,
          editable: true,
          selectable: true,
          evented: true,
          // Hide outer selection border — only the IText editing cursor box should be visible
          hasBorders: false,
          hasControls: false,
        });

        canvas.add(textObj);
        canvas.setActiveObject(textObj);
        canvas.renderAll();

        // Enter editing mode
        textObj.enterEditing();
        textObj.selectAll();
        setIsLoading(false);
      });
    }
  }, [isNewText, strokeColor, clickPosition]);

  // -------------------------------------------------------------------------
  // Shape loading
  // -------------------------------------------------------------------------
  const loadShapeAnnotation = useCallback((canvas) => {
    if (!annotationDataRef.current) return;

    const annData = annotationDataRef.current;
    bboxOriginRef.current = { left: annData.left || 0, top: annData.top || 0 };
    originalAnnotationRef.current = JSON.parse(JSON.stringify(annData));

    fabric.util.enlivenObjects([annData], (objects) => {
      if (!mountedRef.current || objects.length === 0) return;
      const obj = objects[0];

      obj.set({
        left: BBOX_PADDING,
        top: BBOX_PADDING,
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
      });

      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.renderAll();
      setIsLoading(false);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Callout loading -- full-page Canvas with all annotations
  // -------------------------------------------------------------------------
  const loadCalloutAnnotation = useCallback((canvas) => {
    const objectsArray = annotationsRef.current?.objects || [];
    if (objectsArray.length === 0) {
      setIsLoading(false);
      return;
    }

    originalAnnotationRef.current = JSON.parse(JSON.stringify(
      objectsArray[annotationIndex] || null
    ));

    fabric.util.enlivenObjects(objectsArray, (enlivenedObjects) => {
      if (!mountedRef.current) return;

      enlivenedObjects.forEach((obj, index) => {
        const objData = objectsArray[index];

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
        if (obj.highlightId || obj.needsBIC) {
          obj.set({ globalCompositeOperation: 'multiply' });
        }

        // Only the target annotation is interactive
        if (index === annotationIndex) {
          obj.set({
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
          });
        } else {
          obj.set({
            selectable: false,
            evented: false,
          });
        }

        canvas.add(obj);

        // Fix coordinate space for path objects (same as FabricEraserCanvas)
        if (obj.type === 'path' && obj.pathOffset) {
          const pos = new fabric.Point(obj.pathOffset.x, obj.pathOffset.y);
          obj.setPositionByOrigin(pos, 'center', 'center');
          obj.setCoords();
        }
      });

      // Select the target annotation
      const targetObj = enlivenedObjects[annotationIndex];
      if (targetObj) {
        canvas.setActiveObject(targetObj);
      }

      canvas.renderAll();
      setIsLoading(false);
    });
  }, [annotationIndex]);

  // -------------------------------------------------------------------------
  // Sync refs to avoid stale closures
  // -------------------------------------------------------------------------
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { onEditCommitRef.current = onEditCommit; }, [onEditCommit]);
  useEffect(() => { onEditCancelRef.current = onEditCancel; }, [onEditCancel]);
  useEffect(() => { editTypeRef.current = editType; }, [editType]);
  useEffect(() => { annotationDataRef.current = annotationData; }, [annotationData]);

  // -------------------------------------------------------------------------
  // Text editing exited event -- commit on blur
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || editType !== 'text') return;

    const handleEditingExited = () => {
      // Small delay to let click-outside detection fire first
      // (prevents double-commit when clicking outside)
      setTimeout(() => {
        if (!committedRef.current && mountedRef.current) {
          commitAndClose(canvas);
        }
      }, 50);
    };

    canvas.on('text:editing:exited', handleEditingExited);
    return () => {
      canvas.off('text:editing:exited', handleEditingExited);
    };
  }, [editType, commitAndClose]);

  // -------------------------------------------------------------------------
  // Click-outside detection
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (committedRef.current) return;

      const container = containerRef.current;
      if (!container) return;

      // Check if click is inside the Canvas container or mini-toolbar
      if (container.contains(e.target)) return;

      // Check if click is inside the mini-toolbar
      const toolbar = document.querySelector('[data-mini-toolbar]');
      if (toolbar && toolbar.contains(e.target)) return;

      // Click is outside -- commit and close.
      commitAndClose();
    };

    // Use setTimeout to avoid triggering on the initial double-click that opened edit mode
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown, true);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [commitAndClose]);

  // -------------------------------------------------------------------------
  // Escape key handler
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelAndClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [cancelAndClose]);

  // -------------------------------------------------------------------------
  // Zoom handling -- CSS transform bridge (ZOOM-02) + zoomGeneration detection
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (zoomGeneration === initialZoomGenRef.current) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    // For text: store cursor position for restoration after settle
    if (editTypeRef.current === 'text') {
      const activeObj = canvas.getActiveObject();
      if (activeObj?.isEditing) {
        cursorPositionRef.current = activeObj.selectionStart;
      }
    }
  }, [zoomGeneration]);

  // -------------------------------------------------------------------------
  // ResizeObserver with 200ms debounce for settle detection (ZOOM-03)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Observe the parent element (portal host that Syncfusion resizes)
    const parentEl = container.parentElement;
    if (!parentEl) return;

    const observer = new ResizeObserver(() => {
      const newParentWidth = parentEl.offsetWidth;
      if (newParentWidth <= 0 || pageWidth <= 0) return;

      const lastSize = lastContainerSizeRef.current;
      if (lastSize.width > 0) {
        // During zoom: apply CSS transform as visual bridge (ZOOM-02)
        const oldEffectiveScale = editTypeRef.current === 'callout'
          ? lastSize.width / pageWidth
          : (lastSize.width > 0 ? lastSize.width / ((annotationDataRef.current?.width * (annotationDataRef.current?.scaleX || 1) + BBOX_PADDING * 2) || pageWidth) : 1);
        const newEffectiveScale = newParentWidth / pageWidth;
        const transformRatio = newEffectiveScale / oldEffectiveScale;

        if (Math.abs(transformRatio - 1) > 0.001) {
          setZoomTransformStyle({
            transform: `scale(${transformRatio})`,
            transformOrigin: 'top left',
          });
        }
      }

      // Debounce: wait 200ms after last resize event before actual Canvas resize
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        const canvas = fabricRef.current;
        if (!canvas || !mountedRef.current) return;

        const effectiveScale = parentEl.offsetWidth / pageWidth;

        // Recalculate container dimensions
        let newWidth, newHeight;
        if (editTypeRef.current === 'callout') {
          newWidth = parentEl.offsetWidth;
          newHeight = parentEl.offsetHeight;
        } else {
          let annWidth, annHeight;
          if (annotationDataRef.current) {
            annWidth = (annotationDataRef.current.width || 100) * (annotationDataRef.current.scaleX || 1);
            annHeight = (annotationDataRef.current.height || 30) * (annotationDataRef.current.scaleY || 1);
          } else {
            annWidth = 200;
            annHeight = 40;
          }
          const bboxW = annWidth + BBOX_PADDING * 2;
          const bboxH = annHeight + BBOX_PADDING * 2;
          newWidth = Math.floor(bboxW * effectiveScale);
          newHeight = Math.floor(bboxH * effectiveScale);
        }

        canvas.setZoom(effectiveScale);
        canvas.setWidth(newWidth);
        canvas.setHeight(newHeight);
        canvas.renderAll();

        lastContainerSizeRef.current = { width: newWidth, height: newHeight };

        // Clear CSS transform -- Canvas is now properly sized
        setZoomTransformStyle(null);

        // Update container style for repositioning
        if (editTypeRef.current === 'callout') {
          setContainerStyle((prev) => ({
            ...prev,
            width: newWidth,
            height: newHeight,
          }));
        } else {
          const annData = annotationDataRef.current;
          if (annData) {
            const annLeft = annData.left || 0;
            const annTop = annData.top || 0;
            const annWidth = (annData.width || 100) * (annData.scaleX || 1);
            const annHeight = (annData.height || 30) * (annData.scaleY || 1);
            setContainerStyle({
              position: 'absolute',
              left: (annLeft - BBOX_PADDING) * effectiveScale,
              top: (annTop - BBOX_PADDING) * effectiveScale,
              width: (annWidth + BBOX_PADDING * 2) * effectiveScale,
              height: (annHeight + BBOX_PADDING * 2) * effectiveScale,
              zIndex: 101,
              pointerEvents: 'auto',
            });
          }
        }

        // For text: restore cursor position
        if (editTypeRef.current === 'text') {
          const activeObj = canvas.getActiveObject();
          if (activeObj && cursorPositionRef.current != null) {
            if (!activeObj.isEditing) activeObj.enterEditing();
            activeObj.selectionStart = cursorPositionRef.current;
            activeObj.selectionEnd = cursorPositionRef.current;
            canvas.renderAll();
          }
        }
      }, 200); // 200ms settle debounce per ZOOM-03
    });

    observer.observe(parentEl);
    return () => {
      observer.disconnect();
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [pageWidth, pageHeight]);

  // -------------------------------------------------------------------------
  // Text auto-expand: grow Canvas if text exceeds bounds
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || editType !== 'text') return;

    const handleModified = () => {
      const obj = canvas.getActiveObject();
      if (!obj) return;

      const parentEl = containerRef.current?.parentElement;
      if (!parentEl || pageWidth <= 0) return;
      const effectiveScale = parentEl.offsetWidth / pageWidth;

      const neededWidth = (obj.width * (obj.scaleX || 1) + BBOX_PADDING * 2) * effectiveScale;
      const neededHeight = (obj.height * (obj.scaleY || 1) + BBOX_PADDING * 2) * effectiveScale;
      const maxWidth = parentEl.offsetWidth;
      const maxHeight = parentEl.offsetHeight;

      const currentW = canvas.getWidth();
      const currentH = canvas.getHeight();

      if (neededWidth > currentW || neededHeight > currentH) {
        const newW = Math.min(Math.max(neededWidth, currentW), maxWidth);
        const newH = Math.min(Math.max(neededHeight, currentH), maxHeight);
        canvas.setWidth(newW);
        canvas.setHeight(newH);

        setContainerStyle((prev) => ({
          ...prev,
          width: newW,
          height: newH,
        }));

        lastContainerSizeRef.current = { width: newW, height: newH };
        canvas.renderAll();
      }
    };

    canvas.on('object:modified', handleModified);
    // Also listen to text changes for auto-expand during typing
    canvas.on('text:changed', handleModified);
    return () => {
      canvas.off('object:modified', handleModified);
      canvas.off('text:changed', handleModified);
    };
  }, [editType, pageWidth]);

  // -------------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {editType === 'shape' && !isLoading && (
        <MiniToolbar
          data-mini-toolbar
          fabricRef={fabricRef}
          containerRef={containerRef}
          editCanvasStyle={containerStyle}
          onPropertyChange={() => {}}
        />
      )}
      <div
        ref={containerRef}
        style={{ ...containerStyle, ...zoomTransformStyle }}
      >
        <canvas ref={canvasElRef} />
      </div>
    </>
  );
});

FabricEditCanvas.displayName = 'FabricEditCanvas';

export default FabricEditCanvas;
