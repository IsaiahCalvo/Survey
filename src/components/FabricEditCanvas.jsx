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
 * - Direct-DOM CSS transform zoom bridge (ZOOM-02): scale + reposition via DOM (not React state)
 * - 200ms ResizeObserver settle debounce (ZOOM-03): Canvas resize after zoom settles
 * - Click-outside commits edit, Escape cancels
 * - flushSync during dispose for synchronous SVG re-render before Canvas DOM removal
 * - Text cursor position restored after zoom settle (ZOOM-04)
 *
 * Phase 11 Plan 01: Final user-facing feature of v2.0 SVG migration.
 */
import React, { memo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { flushSync } from 'react-dom';
import { fabric } from 'fabric';
import { useFabricCanvas } from '../hooks/useFabricCanvas';
// measureTextBounds removed — edit canvas uses Textbox wrapping width, not tight text bounds

// Fix Fabric.js 5.x cursor overlap bug: cursor was centered on character boundary
// with `- cursorWidth / 2`, causing leftward drift at fractional zoom.
// Patch: place cursor at the right edge of the boundary instead of centering.
// Ref: fabric.js GitHub issues #5008, #6168, #4479
const _origRenderCursor = fabric.IText.prototype.renderCursor;
fabric.IText.prototype.renderCursor = function(boundaries, ctx) {
  const cursorLocation = this.get2DCursorLocation();
  const lineIndex = cursorLocation.lineIndex;
  const charIndex = cursorLocation.charIndex > 0 ? cursorLocation.charIndex - 1 : 0;
  const charHeight = this.getValueOfPropertyAt(lineIndex, charIndex, 'fontSize');
  const multiplier = this.scaleX * this.canvas.getZoom();
  const cursorWidth = this.cursorWidth / multiplier;
  let topOffset = boundaries.topOffset;
  const dy = this.getValueOfPropertyAt(lineIndex, charIndex, 'deltaY');
  topOffset += (1 - this._fontSizeFraction) * this.getHeightOfLine(lineIndex) / this.lineHeight
    - charHeight * (1 - this._fontSizeFraction);
  if (this.inCompositionMode) { this.renderSelection(boundaries, ctx); }
  ctx.fillStyle = this.cursorColor || this.getValueOfPropertyAt(lineIndex, charIndex, 'fill');
  ctx.globalAlpha = this.__isMousedown ? 1 : this._currentCursorOpacity;
  // FIX: place cursor at right edge of boundary (removed `- cursorWidth / 2`)
  ctx.fillRect(
    boundaries.left + boundaries.leftOffset,
    topOffset + boundaries.top + dy,
    cursorWidth,
    charHeight
  );
};

// Custom properties to include in object serialization (matches FabricDrawingCanvas/FabricEraserCanvas)
const CUSTOM_PROPS = [
  'strokeUniform', 'spaceId', 'moduleId', 'regionId',
  'data', 'name', 'highlightId', 'needsBIC',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType',
];

const BBOX_PADDING = 20;

/**
 * Build CSS transform chain that replicates SVG's transformation order for rotated annotations.
 * SVG applies: viewBox non-uniform scale × rotate(angle, center) — rotation in page-space
 * before screen scaling. CSS must match this order: scale(sx,sy) first, then translate+rotate.
 * When sx ≠ sy, scale × rotate ≠ rotate × scale, so the order matters.
 */
function buildBboxTransform(sx, sy, annLeft, annTop, annWidth, annHeight, annAngle) {
  const tx = annLeft - BBOX_PADDING;
  const ty = annTop - BBOX_PADDING;
  const cx = annWidth / 2 + BBOX_PADDING;
  const cy = annHeight / 2 + BBOX_PADDING;
  return `scale(${sx}, ${sy}) translate(${tx}px, ${ty}px) translate(${cx}px, ${cy}px) rotate(${annAngle}deg) translate(${-cx}px, ${-cy}px)`;
}

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

  // Position: 8px above the edit Canvas container, using screen coords via portal to document.body
  // This escapes all Syncfusion stacking contexts so clicks actually reach the toolbar.
  const container = containerRef.current;
  const containerRect = container ? container.getBoundingClientRect() : null;
  const positionStyle = {
    position: 'fixed',
    left: containerRect ? containerRect.left : 0,
    top: containerRect ? containerRect.top - 44 : 0,
    zIndex: 999999,
  };

  // If not enough space above, position below
  if (positionStyle.top < 0 && containerRect) {
    positionStyle.top = containerRect.bottom + 8;
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

  return createPortal(
    <div
      ref={toolbarRef}
      data-mini-toolbar
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
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
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
          onClick={() => { handleStrokeWidthChange(-1); }}
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
          onClick={() => { handleStrokeWidthChange(1); }}
          style={{
            width: 20, height: 20,
            background: '#444', border: '1px solid #555', borderRadius: 2,
            color: '#FFF', fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, lineHeight: 1,
          }}
        >+</button>
      </div>
    </div>,
    document.body
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
  textBoxWidth,        // optional page-space width from drag-to-create
}) => {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [isLoading, setIsLoading] = useState(true);
  const [containerStyle, setContainerStyle] = useState({ visibility: 'hidden' });

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
  const newTextScaleRef = useRef(null); // effectiveScale when new text uses zoom=1 pixel coords
  const pageSpaceModeRef = useRef(false); // true when using page-space CSS transform for rotated annotations
  const annotationDataRef = useRef(annotationData);

  // -------------------------------------------------------------------------
  // Commit logic
  // -------------------------------------------------------------------------
  const commitAndClose = useCallback((canvas, opts = {}) => {
    if (committedRef.current) return;
    committedRef.current = true;

    if (!canvas) canvas = fabricRef.current;
    if (!canvas) {
      console.warn(`[EditCanvas p${pageNumber}] COMMIT ABORTED — no canvas`);
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

    // For new text created at zoom=1 pixel coords: convert back to page-space
    if (isNewText && newTextScaleRef.current) {
      const es = newTextScaleRef.current;
      const pxPad = BBOX_PADDING * es;
      json.left = (json.left - pxPad) / es;
      json.top = (json.top - pxPad) / es;
      json.width = json.width / es;
      json.fontSize = Math.round(json.fontSize / es);
      json.scaleX = 1;
      json.scaleY = 1;
      // Add page-space origin offset
      if (bboxOriginRef.current) {
        json.left += bboxOriginRef.current.left;
        json.top += bboxOriginRef.current.top;
      }
    } else if (editTypeRef.current !== 'callout' && bboxOriginRef.current) {
      // For bbox mode (text/shape): reverse coordinate offset
      json.left = bboxOriginRef.current.left + (json.left - BBOX_PADDING);
      json.top = bboxOriginRef.current.top + (json.top - BBOX_PADDING);
      // Restore the original rotation angle (stripped during edit for easier interaction)
      if (bboxOriginRef.current.angle) {
        json.angle = bboxOriginRef.current.angle;

        // Compensate for dimension changes on rotated annotations (e.g. text wrapping).
        // SVG renders: rotate(angle, left+W/2, top+H/2). When height changes, the rotation
        // center shifts, causing the rotated visual position to jump.
        // Fix: adjust left/top to keep the ROTATED TOP-LEFT CORNER at its original position.
        // Math: TL_rotated = rotate_point((left,top), (left+W/2, top+H/2), angle)
        // Solving for new left/top that preserve TL_rotated when H changes by dH:
        //   left' = left - dH/2 * sin(angle)
        //   top'  = top  - dH/2 * (1 - cos(angle))
        // At angle=0 both deltas are 0 (no adjustment needed — text grows down naturally).
        if (originalAnnotationRef.current) {
          const orig = originalAnnotationRef.current;
          const origH = (orig.height || 0) * (orig.scaleY || 1);
          const newH = (json.height || 0) * (json.scaleY || 1);
          const dh = newH - origH;
          if (dh !== 0) {
            const rad = json.angle * Math.PI / 180;
            json.left -= dh / 2 * Math.sin(rad);
            json.top  -= dh / 2 * (1 - Math.cos(rad));
          }
        }
      }
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
  // useLayoutEffect ensures the container is positioned & visible BEFORE the
  // browser paints. This prevents a 1-frame gap where the SVG annotation is
  // already removed but the edit container isn't visible yet — which causes a
  // visible "jump" for rotated annotations.
  // -------------------------------------------------------------------------
  useLayoutEffect(() => {
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
        annWidth = 200; // default width for new text (matches Textbox width + padding)
        annHeight = 30;  // initial height — auto-resizes as user types
      } else if (annotationData) {
        annLeft = annotationData.left || 0;
        annTop = annotationData.top || 0;
        annWidth = (annotationData.width || 200) * (annotationData.scaleX || 1);
        annHeight = (annotationData.height || 30) * (annotationData.scaleY || 1);
      } else {
        annLeft = 0;
        annTop = 0;
        annWidth = 200;
        annHeight = 40;
      }

      const annAngle = (!isNewText && annotationData?.angle) || 0;

      if (annAngle) {
        // Page-space CSS transform: replicates SVG's transformation chain to
        // eliminate rotation mismatch. SVG does scale(sx,sy) × rotate in page-space;
        // the old CSS approach did rotate × scale (implicit in screen-space positioning).
        // When sx ≠ sy (preserveAspectRatio="none"), these don't commute.
        const sx = parentEl.offsetWidth / pageWidth;
        const sy = parentEl.offsetHeight / pageHeight;

        style = {
          position: 'absolute',
          left: 0,
          top: 0,
          width: annWidth + BBOX_PADDING * 2,
          height: annHeight + BBOX_PADDING * 2,
          zIndex: 101,
          pointerEvents: 'auto',
          transformOrigin: '0 0',
          transform: buildBboxTransform(sx, sy, annLeft, annTop, annWidth, annHeight, annAngle),
        };
        pageSpaceModeRef.current = true;
      } else {
        style = {
          position: 'absolute',
          left: (annLeft - BBOX_PADDING) * effectiveScale,
          top: (annTop - BBOX_PADDING) * effectiveScale,
          width: (annWidth + BBOX_PADDING * 2) * effectiveScale,
          height: (annHeight + BBOX_PADDING * 2) * effectiveScale,
          zIndex: 101,
          pointerEvents: 'auto',
        };
        pageSpaceModeRef.current = false;
      }
    }

    // Apply position/rotation directly to DOM SYNCHRONOUSLY so the container is
    // pre-positioned before paint. But keep visibility HIDDEN — the canvas loading
    // code will reveal it after determining actual text dimensions and correcting
    // transformOrigin. This prevents a jump when stored height differs from actual
    // text height (the resize with wrong rotation center is never visible).
    if (container) {
      container.style.position = style.position || '';
      container.style.left = (typeof style.left === 'number') ? style.left + 'px' : (style.left || '');
      container.style.top = (typeof style.top === 'number') ? style.top + 'px' : (style.top || '');
      container.style.width = (typeof style.width === 'number') ? style.width + 'px' : (style.width || '');
      container.style.height = (typeof style.height === 'number') ? style.height + 'px' : (style.height || '');
      container.style.zIndex = style.zIndex || '';
      container.style.pointerEvents = style.pointerEvents || '';
      container.style.transform = style.transform || '';
      container.style.transformOrigin = style.transformOrigin || '';
      // Callout mode: visible immediately (full-page, no rotation mismatch).
      // Text/shape bbox: stay hidden until canvas loading corrects size + transformOrigin.
      if (editType === 'callout') {
        container.style.visibility = 'visible';
      }
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
        annHeight = 30;
      } else if (annotationDataRef.current) {
        annWidth = (annotationDataRef.current.width || 200) * (annotationDataRef.current.scaleX || 1);
        annHeight = (annotationDataRef.current.height || 30) * (annotationDataRef.current.scaleY || 1);
      } else {
        annWidth = 200;
        annHeight = 40;
      }
      if (pageSpaceModeRef.current) {
        // Page-space mode: canvas at page-space resolution, CSS transform handles screen mapping
        canvasWidth = Math.ceil(annWidth + BBOX_PADDING * 2);
        canvasHeight = Math.ceil(annHeight + BBOX_PADDING * 2);
      } else {
        canvasWidth = Math.floor((annWidth + BBOX_PADDING * 2) * effectiveScale);
        canvasHeight = Math.floor((annHeight + BBOX_PADDING * 2) * effectiveScale);
      }
    }

    // Container-aware sizing (CLAUDE.md rule)
    canvas.setZoom(pageSpaceModeRef.current ? 1 : effectiveScale);
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
      // New text creation: Textbox at click position (wraps text, visible border)
      // Use canvas zoom=1 with pixel-space coordinates to avoid Fabric.js cursor drift bug at fractional zoom
      canvas.setZoom(1);
      const es = effectiveScale;
      const pxPad = BBOX_PADDING * es;
      const textObj = new fabric.Textbox('', {
        left: pxPad,
        top: pxPad,
        width: textBoxWidth ? textBoxWidth * es : 160 * es, // page-space width from drag, or default 160px
        fontSize: Math.round(16 * es),
        fill: strokeColor || '#007AFF',
        fontFamily: DEFAULT_FONT_FAMILY,
        charSpacing: 1, // Fabric.js #6168: prevents sub-pixel cursor drift
        editable: true,
        selectable: true,
        evented: true,
        cursorColor: '#007AFF',
        editingBorderColor: 'transparent',
        borderColor: 'transparent',
        backgroundColor: '',
        textBackgroundColor: '',
        padding: 0,
        hasBorders: false,
        hasControls: false,
      });

      bboxOriginRef.current = {
        left: clickPosition?.x ?? 0,
        top: clickPosition?.y ?? 0,
      };
      originalAnnotationRef.current = null;
      // Store effectiveScale so commit can convert back to page-space
      newTextScaleRef.current = es;

      canvas.add(textObj);
      canvas.setActiveObject(textObj);
      canvas.renderAll();

      // Container is ready — reveal it
      if (containerRef.current) containerRef.current.style.visibility = 'visible';
      setContainerStyle(prev => ({ ...prev, visibility: 'visible' }));

      // Enter editing mode
      textObj.enterEditing();

      // Auto-resize container to fit text height
      const autoResize = () => {
        if (!mountedRef.current || !containerRef.current) return;
        const h = textObj.calcTextHeight() + pxPad * 2 + 8;
        const newH = Math.max(Math.round(30 * es), Math.ceil(h));
        canvas.setDimensions({ height: newH });
        containerRef.current.style.height = newH + 'px';
      };
      textObj.on('changed', autoResize);
      autoResize();
      setIsLoading(false);
    } else if (annotationDataRef.current) {
      // Editing existing text annotation
      const annData = annotationDataRef.current;
      bboxOriginRef.current = { left: annData.left || 0, top: annData.top || 0, angle: annData.angle || 0 };
      originalAnnotationRef.current = JSON.parse(JSON.stringify(annData));

      fabric.util.enlivenObjects([annData], (objects) => {
        if (!mountedRef.current || objects.length === 0) return;
        let textObj = objects[0];

        // Sanitize styles FIRST — Fabric.js 5.x enlivenObjects can leave undefined
        // line entries that crash toJSON/stylesToArray.
        textObj.styles = {};

        // Convert to Textbox with character-level wrapping.
        // IMPORTANT: Set left/top/angle in the constructor to avoid a flash
        // where the object briefly renders at its original page-space coordinates
        // before being repositioned to BBOX_PADDING.
        {
          const json = textObj.toJSON(CUSTOM_PROPS);
          const { styles: _s, left: _l, top: _t, angle: _a, ...rest } = json;
          textObj = new fabric.Textbox(json.text || '', {
            ...rest,
            type: 'textbox',
            left: BBOX_PADDING,
            top: BBOX_PADDING,
            angle: 0,
            width: json.width || 200,
            splitByGrapheme: true,
            fontWeight: json.fontWeight || 'normal',
            styles: {},
            editable: true,
            selectable: true,
            evented: true,
            charSpacing: 1, // Fabric.js #6168: prevents sub-pixel cursor drift
            cursorColor: '#007AFF',
            editingBorderColor: 'transparent',
            borderColor: 'transparent',
            backgroundColor: '',
            textBackgroundColor: '',
            hasBorders: false,
            hasControls: false,
          });
        }

        // Clear font cache to ensure fresh character measurements
        fabric.util.clearFabricFontCache();
        textObj.initDimensions();
        textObj._clearCache();

        // Add to canvas WITHOUT rendering yet (renderOnAddRemove: false)
        canvas.add(textObj);
        canvas.setActiveObject(textObj);

        // Resize canvas to fit actual text BEFORE first render — prevents flash
        const actualW = textObj.width * (textObj.scaleX || 1);
        const actualH = textObj.calcTextHeight ? textObj.calcTextHeight() : textObj.height * (textObj.scaleY || 1);
        const es = canvas.getZoom();
        const neededW = Math.ceil((actualW + BBOX_PADDING * 2) * es);
        const neededH = Math.ceil((actualH + BBOX_PADDING * 2) * es);

        canvas.setDimensions({ width: neededW, height: neededH });
        if (containerRef.current) {
          containerRef.current.style.width = neededW + 'px';
          containerRef.current.style.height = neededH + 'px';
          containerRef.current.style.visibility = 'visible';

        }
        // Sync React state so setIsLoading(false) re-render doesn't revert
        // the container back to stale stored dimensions from useLayoutEffect.
        setContainerStyle(prev => ({
          ...prev,
          width: neededW,
          height: neededH,
          visibility: 'visible',
        }));

        // NOW render and enter editing — canvas is correctly sized
        canvas.renderAll();
        textObj.enterEditing();
        textObj.selectAll();

        // Auto-resize height as text wraps — width stays fixed for wrapping
        textObj.on('changed', () => {
          if (!mountedRef.current || !containerRef.current) return;
          const h = (textObj.calcTextHeight() + BBOX_PADDING * 2) * es + 8;
          const newH = Math.max(Math.round(30 * es), Math.ceil(h));
          canvas.setDimensions({ height: newH });
          containerRef.current.style.height = newH + 'px';
        });

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
    bboxOriginRef.current = { left: annData.left || 0, top: annData.top || 0, angle: annData.angle || 0 };
    originalAnnotationRef.current = JSON.parse(JSON.stringify(annData));

    fabric.util.enlivenObjects([annData], (objects) => {
      if (!mountedRef.current || objects.length === 0) {
        console.warn(`[EditCanvas p${pageNumber}] shape LOAD FAILED — mountedRef=${mountedRef.current}, objects=${objects.length}`);
        return;
      }
      const obj = objects[0];

      obj.set({
        left: BBOX_PADDING,
        top: BBOX_PADDING,
        // Strip rotation — CSS transform on the container handles visual rotation
        angle: 0,
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
      });

      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.renderAll();
      // Container is ready — reveal it
      if (containerRef.current) containerRef.current.style.visibility = 'visible';
      setContainerStyle(prev => ({ ...prev, visibility: 'visible' }));
      setIsLoading(false);
    });
  }, [pageNumber]);

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
    // Helper: check if click coordinates are inside an element's bounding rect.
    // This works even when Syncfusion layers intercept the event target.
    const isPointInRect = (x, y, el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const handleMouseDown = (e) => {
      if (committedRef.current) return;

      const container = containerRef.current;
      if (!container) return;

      // Check if click coordinates are inside the Canvas container
      if (isPointInRect(e.clientX, e.clientY, container)) return;

      // Check if click is inside the mini-toolbar or its descendants (e.g. color picker dropdown).
      // Two checks needed:
      // 1. DOM containment (toolbar.contains) — catches dropdown children that overflow the toolbar rect
      // 2. Rect-based (isPointInRect) — catches clicks when Syncfusion layers intercept event.target
      const toolbar = document.querySelector('[data-mini-toolbar]');
      if (toolbar) {
        const targetInToolbar = toolbar.contains(e.target);
        if (targetInToolbar || isPointInRect(e.clientX, e.clientY, toolbar)) {
          // If browser hit-testing resolved to a Syncfusion element underneath,
          // stop event and re-dispatch to the correct toolbar child.
          if (!targetInToolbar) {
            e.stopImmediatePropagation();
            e.preventDefault();
            const allChildren = toolbar.querySelectorAll('*');
            let deepest = toolbar;
            for (const child of allChildren) {
              const cr = child.getBoundingClientRect();
              if (e.clientX >= cr.left && e.clientX <= cr.right && e.clientY >= cr.top && e.clientY <= cr.bottom) {
                deepest = child;
              }
            }
            deepest.click();
          }
          return;
        }
      }

      // Click is outside both canvas and toolbar — commit and close
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
  // Zoom handling -- direct-DOM CSS transform bridge (ZOOM-02) + zoomGeneration detection
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

      // Page-space mode: canvas stays at page-space resolution, only update CSS transform
      if (pageSpaceModeRef.current) {
        const newSx = newParentWidth / pageWidth;
        const newSy = parentEl.offsetHeight / pageHeight;
        const annData = annotationDataRef.current;
        const annAngle = bboxOriginRef.current?.angle || 0;

        if (annData && annAngle) {
          const annLeft = annData.left || 0;
          const annTop = annData.top || 0;
          const annWidth = (annData.width || 100) * (annData.scaleX || 1);
          const annHeight = (annData.height || 30) * (annData.scaleY || 1);

          // Update CSS transform with new scale factors (instant visual feedback)
          setContainerStyle(prev => ({
            ...prev,
            transform: buildBboxTransform(newSx, newSy, annLeft, annTop, annWidth, annHeight, annAngle),
          }));
        }

        // Settle timer for cursor restoration only
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          if (editTypeRef.current === 'text') {
            const canvas = fabricRef.current;
            if (canvas) {
              const activeObj = canvas.getActiveObject();
              if (activeObj && cursorPositionRef.current != null) {
                if (!activeObj.isEditing) activeObj.enterEditing();
                activeObj.selectionStart = cursorPositionRef.current;
                activeObj.selectionEnd = cursorPositionRef.current;
                canvas.renderAll();
              }
            }
          }
        }, 200);

        return; // Skip screen-space logic
      }

      // During zoom: apply CSS transform + reposition via DIRECT DOM (not React state).
      // Both operations in same synchronous block = same paint frame = no jump.
      // Previous attempts failed because React state batching caused frame mismatches.
      const lastSize = lastContainerSizeRef.current;
      if (lastSize.width > 0) {
        const oldEffectiveScale = editTypeRef.current === 'callout'
          ? lastSize.width / pageWidth
          : lastSize.width / ((annotationDataRef.current?.width * (annotationDataRef.current?.scaleX || 1) + BBOX_PADDING * 2) || pageWidth);
        const newEffectiveScale = newParentWidth / pageWidth;
        const transformRatio = newEffectiveScale / oldEffectiveScale;

        // Skip tiny changes from initial mount ResizeObserver (prevents blurry flash)
        if (Math.abs(transformRatio - 1) > 0.01) {
          const containerEl = containerRef.current;
          if (containerEl) {
            // Scale canvas content via CSS (GPU-composited, no Fabric repaint)
            containerEl.style.transform = `scale(${transformRatio})`;
            containerEl.style.transformOrigin = 'top left';

            // Reposition container to match new zoom level — synchronous with scale
            if (editTypeRef.current !== 'callout') {
              const annData = annotationDataRef.current;
              if (annData) {
                containerEl.style.left = ((annData.left || 0) - BBOX_PADDING) * newEffectiveScale + 'px';
                containerEl.style.top = ((annData.top || 0) - BBOX_PADDING) * newEffectiveScale + 'px';
              }
            }
          }
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

        // Clear CSS transform bridge and reposition/resize via direct DOM
        // BEFORE canvas resize — all synchronous to avoid 1-frame glitch.
        const containerEl = containerRef.current;
        if (containerEl) {
          containerEl.style.transform = '';
          containerEl.style.transformOrigin = '';
          if (editTypeRef.current === 'callout') {
            containerEl.style.width = newWidth + 'px';
            containerEl.style.height = newHeight + 'px';
          } else {
            const annData = annotationDataRef.current;
            if (annData) {
              const annLeft = annData.left || 0;
              const annTop = annData.top || 0;
              const annWidth2 = (annData.width || 100) * (annData.scaleX || 1);
              const annHeight2 = (annData.height || 30) * (annData.scaleY || 1);
              containerEl.style.left = ((annLeft - BBOX_PADDING) * effectiveScale) + 'px';
              containerEl.style.top = ((annTop - BBOX_PADDING) * effectiveScale) + 'px';
              containerEl.style.width = ((annWidth2 + BBOX_PADDING * 2) * effectiveScale) + 'px';
              containerEl.style.height = ((annHeight2 + BBOX_PADDING * 2) * effectiveScale) + 'px';
            }
          }
        }

        canvas.setZoom(effectiveScale);
        canvas.setWidth(newWidth);
        canvas.setHeight(newHeight);
        canvas.renderAll();

        lastContainerSizeRef.current = { width: newWidth, height: newHeight };

        // Sync React state to match DOM (prevents React re-render from reverting DOM)
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
            const annWidth2 = (annData.width || 100) * (annData.scaleX || 1);
            const annHeight2 = (annData.height || 30) * (annData.scaleY || 1);
            setContainerStyle({
              position: 'absolute',
              left: (annLeft - BBOX_PADDING) * effectiveScale,
              top: (annTop - BBOX_PADDING) * effectiveScale,
              width: (annWidth2 + BBOX_PADDING * 2) * effectiveScale,
              height: (annHeight2 + BBOX_PADDING * 2) * effectiveScale,
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

      let neededWidth, neededHeight, maxWidth, maxHeight;
      if (pageSpaceModeRef.current) {
        // Page-space mode: dimensions in page-space, CSS transform handles screen mapping
        neededWidth = obj.width * (obj.scaleX || 1) + BBOX_PADDING * 2;
        neededHeight = obj.height * (obj.scaleY || 1) + BBOX_PADDING * 2;
        maxWidth = pageWidth;
        maxHeight = pageHeight;
      } else {
        const effectiveScale = parentEl.offsetWidth / pageWidth;
        neededWidth = (obj.width * (obj.scaleX || 1) + BBOX_PADDING * 2) * effectiveScale;
        neededHeight = (obj.height * (obj.scaleY || 1) + BBOX_PADDING * 2) * effectiveScale;
        maxWidth = parentEl.offsetWidth;
        maxHeight = parentEl.offsetHeight;
      }

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
        style={containerStyle}
      >
        <canvas ref={canvasElRef} />
      </div>
    </>
  );
});

FabricEditCanvas.displayName = 'FabricEditCanvas';

export default FabricEditCanvas;
