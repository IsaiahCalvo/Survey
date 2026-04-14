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

// UX: BBOX_PADDING is the page-unit buffer added on every side of a shape
// when sizing the edit canvas. It determines how much PIXEL SPACE Fabric has
// to render corner/edge handles OUTSIDE the shape's geometric bounds without
// running out of canvas drawing surface — canvas 2D drawing is physically
// clipped to the element's pixel buffer, so any part of a handle that falls
// outside `setDimensions(w, h)` simply doesn't exist and looks "cut off".
//
// Screen buffer per side = BBOX_PADDING * effectiveScale. Fabric handles are
// ~13px cornerSize, so we want at least ~16px buffer per side to render the
// full handle plus a safety margin. 32 page-units gives:
//   - es=1.33 (Electron normal)  → 42px per side
//   - es=1.00 (browser normal)   → 32px per side
//   - es=0.50                    → 16px per side (tight but handles fit)
//   - es=0.10 (new zoom floor)   → ~3px (clipped, but shape itself is tiny)
// Previously 20, which clipped handles on small shapes / small zoom levels.
// Do not lower without auditing all BBOX_PADDING call sites and verifying
// handle visibility across the full zoom range.
const BBOX_PADDING = 32;

/**
 * Compute Fabric edit-mode shape handle sizing so edit handles match SVGSelectionOverlay
 * display handles EXACTLY in both screen diameter and position. This function mirrors
 * SVGSelectionOverlay / SVGAnnotationLayer math directly — do not "improve" without
 * re-reading those files first.
 *
 * Position: `getAnnotationBBox` returns the stroke-agnostic geometric rect
 * (svgBoundingBox.js getRectBBox/getCircleBBox). SVGAnnotationLayer passes
 * `padding=0` for rect (border-flush) and `padding=2 page units` for circle/
 * ellipse/triangle (line 708). That puts display handles at the stroke CENTER
 * for rect, and 2 page units outside the geometric rect for circle/ellipse.
 * With Fabric `strokeWidth: 0` (forced on load), Fabric's bounding rect == the
 * geometric rect — same bbox SVG uses. So we just mirror SVG's padding in
 * Fabric units.
 *
 * Fabric padding (verified in fabric.js line 17140 `calcLineCoords`) is applied
 * to the line coords AFTER the viewport transform (`transformPoint(aCoords, vpt)`),
 * which means in normal mode (canvas.setZoom(es)), padding is in VIEWPORT SCREEN
 * PIXELS — not canvas-coords. To replicate SVG's `svgOverlayPadding` page units,
 * we set `padding = svgOverlayPadding * es` screen px.
 *
 * Size: SVGSelectionOverlay draws handles at `r = 7 * sqrt(inverseScale)` in
 * page units, which after the viewBox scales by es becomes `14 * sqrt(es)`
 * viewport screen px. Fabric's control rendering does
 * `ctx.setTransform(retinaScaling, 0, 0, retinaScaling, 0, 0)` (fabric.js line
 * 18048), so `cornerSize` is directly canvas-local screen px — no zoom applied.
 * So `cornerSize = 14 * sqrt(es)` directly.
 *
 * pageSpaceMode (rotated shapes): canvas is at `setZoom(1)` and the container
 * DOM has `transform: scale(es)`. Canvas-local pixels are CSS-scaled by es to
 * viewport px, which inverts both formulas:
 *   - `cornerSize * es = 14 * sqrt(es)`  →  `cornerSize = 14 / sqrt(es)`
 *   - `padding * es = svgOverlayPadding * es`  →  `padding = svgOverlayPadding`
 */
function computeShapeHandleSizing(obj, effectiveScale, isPageSpaceMode) {
  const objType = String(obj.type || '').toLowerCase();
  const svgOverlayPadding = (objType === 'rect') ? 0 : 2;
  const es = effectiveScale > 0 ? effectiveScale : 1;
  if (isPageSpaceMode) {
    return {
      cornerSize: 14 / Math.sqrt(es),
      padding: svgOverlayPadding,
    };
  }
  return {
    cornerSize: 14 * Math.sqrt(es),
    padding: svgOverlayPadding * es,
  };
}

/**
 * Returns the canvas-local → viewport scale factor for a given effectiveScale
 * and mode. Normal mode: canvas is 1:1 viewport, so visualScale = sqrt(es) to
 * get SVG's sqrt(es) CSS-px dimensions. pageSpaceMode: canvas-local × es =
 * viewport, so visualScale = 1/sqrt(es) to get the same sqrt(es) viewport size.
 */
function getHandleVisualScale(fabricObject) {
  const es = fabricObject._svgEffectiveScale > 0 ? fabricObject._svgEffectiveScale : 1;
  const isPage = fabricObject._svgIsPageSpaceMode === true;
  return isPage ? (1 / Math.sqrt(es)) : Math.sqrt(es);
}

/**
 * Custom Fabric control renderer that mirrors SVGSelectionOverlay's visual stroke
 * curve. Fabric's default `renderCircleControl` hardcodes `ctx.lineWidth = 1`
 * (fabric.js:7602), so at any zoom ≠ 1 the edit-mode handle ring is a constant
 * 1 CSS px while SVG display uses `strokeWidth={1 * sqrt(inverseScale)}` in page
 * units → `sqrt(es)` CSS px after the viewBox scales.
 */
function renderDampedCircleControl(ctx, left, top, styleOverride, fabricObject) {
  const size = fabricObject.cornerSize;
  const strokeWidth = getHandleVisualScale(fabricObject);
  ctx.save();
  ctx.fillStyle = (styleOverride && styleOverride.cornerColor) || fabricObject.cornerColor || '#ffffff';
  ctx.strokeStyle = (styleOverride && styleOverride.cornerStrokeColor) || fabricObject.cornerStrokeColor || '#d1d1d1';
  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  ctx.arc(left, top, size / 2, 0, 2 * Math.PI, false);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Rounded rect (pill) renderer that matches SVGSelectionOverlay's middle handles.
 * SVG pills are 36*sqrt(es) × 10*sqrt(es) CSS px (horizontal: mt/mb) or
 * 10*sqrt(es) × 36*sqrt(es) (vertical: ml/mr), with rx = 5*sqrt(es) and
 * strokeWidth = sqrt(es). Fabric's default middle-control renderer is
 * `renderSquareControl` using cornerSize — completely wrong shape.
 *
 * Returned function is assigned to `obj.controls[mt/mb/ml/mr].render`.
 */
function makeDampedPillControl(orientation) {
  return function renderDampedPillControl(ctx, left, top, styleOverride, fabricObject) {
    const vs = getHandleVisualScale(fabricObject);
    const pillLong = 36 * vs;
    const pillShort = 10 * vs;
    const w = orientation === 'horizontal' ? pillLong : pillShort;
    const h = orientation === 'horizontal' ? pillShort : pillLong;
    const rx = Math.min(5 * vs, w / 2, h / 2);
    ctx.save();
    ctx.fillStyle = (styleOverride && styleOverride.cornerColor) || fabricObject.cornerColor || '#ffffff';
    ctx.strokeStyle = (styleOverride && styleOverride.cornerStrokeColor) || fabricObject.cornerStrokeColor || '#d1d1d1';
    ctx.lineWidth = vs;
    const x = left - w / 2;
    const y = top - h / 2;
    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + w - rx, y);
    ctx.arcTo(x + w, y, x + w, y + rx, rx);
    ctx.lineTo(x + w, y + h - rx);
    ctx.arcTo(x + w, y + h, x + w - rx, y + h, rx);
    ctx.lineTo(x + rx, y + h);
    ctx.arcTo(x, y + h, x, y + h - rx, rx);
    ctx.lineTo(x, y + rx);
    ctx.arcTo(x, y, x + rx, y, rx);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
}

const renderDampedHPill = makeDampedPillControl('horizontal');
const renderDampedVPill = makeDampedPillControl('vertical');

/**
 * Install the damped corner + pill renderers on a shape object, and wire the
 * per-control sizeX/sizeY hit areas to match each handle's visual extent.
 * Called at load and at every zoom-settle so hit areas stay accurate.
 */
function installShapeHandleRenderers(obj) {
  if (!obj || !obj.controls) return;
  const vs = getHandleVisualScale(obj);
  const pillLong = 36 * vs;
  const pillShort = 10 * vs;
  const corners = ['tl', 'tr', 'bl', 'br'];
  corners.forEach((key) => {
    if (obj.controls[key]) {
      obj.controls[key].render = renderDampedCircleControl;
      obj.controls[key].sizeX = obj.cornerSize;
      obj.controls[key].sizeY = obj.cornerSize;
    }
  });
  // Horizontal pills (mt/mb): wide × short
  ['mt', 'mb'].forEach((key) => {
    if (obj.controls[key]) {
      obj.controls[key].render = renderDampedHPill;
      obj.controls[key].sizeX = pillLong;
      obj.controls[key].sizeY = pillShort;
    }
  });
  // Vertical pills (ml/mr): short × tall
  ['ml', 'mr'].forEach((key) => {
    if (obj.controls[key]) {
      obj.controls[key].render = renderDampedVPill;
      obj.controls[key].sizeX = pillShort;
      obj.controls[key].sizeY = pillLong;
    }
  });
}

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

function getAnnotationDims(annData) {
  if (!annData) return { width: 200, height: 40 };
  const t = String(annData.type || '').toLowerCase();
  if (t === 'circle') {
    const d = (annData.radius || 0) * 2;
    return { width: d * Math.abs(annData.scaleX || 1), height: d * Math.abs(annData.scaleY || 1) };
  }
  if (t === 'ellipse') {
    return { width: (annData.rx || 0) * 2 * Math.abs(annData.scaleX || 1), height: (annData.ry || 0) * 2 * Math.abs(annData.scaleY || 1) };
  }
  return { width: (annData.width || 200) * (annData.scaleX || 1), height: (annData.height || 30) * (annData.scaleY || 1) };
}

const DEFAULT_FONT_FAMILY = 'Helvetica';

// ---------------------------------------------------------------------------
// MiniToolbar -- floating toolbar for shape editing (fill/stroke/width)
// ---------------------------------------------------------------------------
const MiniToolbar = memo(({ fabricRef, containerRef, editCanvasStyle, onPropertyChange }) => {
  const [fill, setFill] = useState('transparent');
  const [stroke, setStroke] = useState('#000000');
  const [strokeW, setStrokeW] = useState(3);
  const [showFillPicker, setShowFillPicker] = useState(false);
  const [showStrokePicker, setShowStrokePicker] = useState(false);
  const [toolbarPos, setToolbarPos] = useState(null);
  const toolbarRef = useRef(null);

  // Sync from active object
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    setFill(obj.fill || 'transparent');
    setStroke(obj.stroke || '#000000');
    setStrokeW(obj._realStrokeWidth ?? obj.strokeWidth ?? 3);
  }, [fabricRef]);

  // UX: mini-bar floats just above the shape in screen space and must follow
  // the shape's CURRENT visible edges in real time while the user scales,
  // moves, or pans. Tracking the container's bounding rect alone is NOT
  // sufficient on EITHER axis:
  //
  // - Vertical (Bug #6): during top-handle drags Fabric anchors the bottom
  //   edge and `obj.top` drifts inside the canvas. A container-only tracker
  //   leaves the mini-bar stranded 44px above the container while the shape
  //   moves down toward the middle of the canvas.
  // - Horizontal (Bug #9): during left/right handle drags Fabric anchors the
  //   opposite side and `obj.left` drifts inside the canvas. The centering
  //   formula `toolbarPos.left + (toolbarPos.width - toolbarWidth)/2` stays
  //   centered on the CONTAINER, which is off-center over the drifted SHAPE.
  //
  // Fix: on every frame, read the active object's `obj.left` and `obj.top`
  // (multiplied by `canvas.getZoom()` to get screen px) and add them as
  // signed offsets to the container's screen-space origin. The offsets are
  // zero at rest (`obj.left == obj.top == BBOX_PADDING`) and become non-zero
  // only during an in-flight scale drag, which is exactly when we need the
  // mini-bar to follow. Both offsets are SIGNED — they must be allowed to
  // go negative when the user grows past BBOX_PADDING, otherwise the mini-
  // bar hits a wall and stops following mid-drag.
  useEffect(() => {
    let rafId;
    const track = () => {
      const el = containerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        // Shape top/left offsets inside container (in screen px). Reads the
        // active object live — during object:scaling, obj.top/obj.left drift
        // and these offsets become non-zero, causing the mini-bar to track
        // the shape. Fall back to 0 (mini-bar sits at container origin) when
        // there is no active object or the canvas isn't ready yet.
        const canvas = fabricRef.current;
        let shapeTopOffsetPx = 0;
        let shapeLeftOffsetPx = 0;
        if (canvas) {
          const obj = canvas.getActiveObject();
          if (obj && typeof obj.top === 'number' && typeof obj.left === 'number') {
            const zoom = canvas.getZoom() || 1;
            // Offsets are SIGNED: positive when the shape has drifted DOWN
            // or RIGHT inside the canvas (user dragged a top/left handle
            // toward the opposite edge), negative when it has drifted UP or
            // LEFT (user grew the shape past BBOX_PADDING and Fabric moved
            // the origin outside the canvas).
            //
            // DO NOT clamp at zero: clamping creates a "wall" where the
            // mini-bar stops tracking the moment `obj.top`/`obj.left` crosses
            // BBOX_PADDING, locking the bar to the container origin. Letting
            // the offsets go negative lets the mini-bar continue moving with
            // the shape as long as the user keeps dragging.
            shapeTopOffsetPx = (obj.top - BBOX_PADDING) * zoom;
            shapeLeftOffsetPx = (obj.left - BBOX_PADDING) * zoom;
          }
        }
        const effectiveTop = r.top + shapeTopOffsetPx;
        const effectiveLeft = r.left + shapeLeftOffsetPx;
        setToolbarPos(prev => {
          if (prev && Math.abs(prev.left - effectiveLeft) < 0.5 && Math.abs(prev.top - effectiveTop) < 0.5 &&
              Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5) return prev;
          return { left: effectiveLeft, top: effectiveTop, width: r.width, height: r.height };
        });
      }
      rafId = requestAnimationFrame(track);
    };
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [containerRef]);

  const updateProperty = useCallback((prop, value) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (prop === 'strokeWidth') {
      obj._realStrokeWidth = value;
    } else {
      obj.set(prop, value);
      canvas.renderAll();
    }
    if (onPropertyChange) onPropertyChange(prop, value);
  }, [fabricRef, onPropertyChange]);

  const handleStrokeWidthChange = useCallback((delta) => {
    const newW = Math.max(1, Math.min(20, strokeW + delta));
    setStrokeW(newW);
    updateProperty('strokeWidth', newW);
  }, [strokeW, updateProperty]);

  // Position: 8px above the edit Canvas container, using rAF-tracked screen coords.
  // Portaled to document.body to escape Syncfusion stacking contexts.
  const toolbarWidth = 240;
  // UX: the mini-bar floats 44px above the edit container. When the user
  // drags the shape's TOP handle upward in edit mode, the shape grows past
  // the container's top edge (we set `wrapperEl.overflow: visible` to allow
  // this) and visually enters the mini-bar's screen region. If the root div
  // had `pointer-events: auto` (the default), the mini-bar would intercept
  // those clicks and the top handles would feel "dead" or weird.
  //
  // Fix: make the mini-bar ROOT non-interactive (pointerEvents: 'none') so
  // clicks over the bar's background fall through to the canvas below where
  // the handles live. Interactive children (color swatches, stroke buttons,
  // color grid) explicitly opt back in with `pointerEvents: 'auto'` on their
  // own style, so Fill/Stroke/Width controls still work. Event bubbling is
  // not blocked by pointer-events — the root's onMouseDown stopPropagation
  // still fires for bubbled button clicks, keeping the shape from deselecting
  // when user touches a toolbar control.
  const positionStyle = {
    position: 'fixed',
    left: toolbarPos ? toolbarPos.left + (toolbarPos.width - toolbarWidth) / 2 : -9999,
    top: toolbarPos ? toolbarPos.top - 44 : -9999,
    zIndex: 999999,
    pointerEvents: 'none',
  };

  if (positionStyle.top < 0 && toolbarPos) {
    positionStyle.top = toolbarPos.top + toolbarPos.height + 8;
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
        pointerEvents: 'auto',
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
            pointerEvents: 'auto',
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
            pointerEvents: 'auto',
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
            pointerEvents: 'auto',
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
            pointerEvents: 'auto',
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
  onLivePreview,       // (updatedAnnotationsJSON) => void -- live SVG update during shape edit
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
  const lastParentWidthRef = useRef(0); // Tracks parent width to detect spurious ResizeObserver fires (see Bug A in Phase 11 .continue-here.md)
  const initialZoomGenRef = useRef(zoomGeneration);
  const settleTimerRef = useRef(null);
  const committedRef = useRef(false);
  const newTextScaleRef = useRef(null); // effectiveScale when new text uses zoom=1 pixel coords
  const pageSpaceModeRef = useRef(false); // true when using page-space CSS transform for rotated annotations
  const annotationDataRef = useRef(annotationData);
  // Captured once per scale drag (on first object:scaling tick, cleared on
  // object:modified). Holds the page-coord bbox top-left at drag start so
  // Fabric's cumulative corner-anchored left/top offset can be translated
  // into an absolute page-coord position each tick. Without this snapshot
  // the SVG live preview and Fabric handles desync on any handle that moves
  // obj.left or obj.top (tl/tr/bl/mt/ml/mb).
  const scaleStartRef = useRef(null);

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
    // Shape edit uses opacity:0 on the Fabric object to hide its raster while keeping
    // handles interactive — restore the original opacity before persisting so SVG
    // display is unaffected.
    if (editTypeRef.current === 'shape') {
      json.opacity = originalAnnotationRef.current?.opacity ?? 1;
      if (activeObj._realStrokeWidth !== undefined) json.strokeWidth = activeObj._realStrokeWidth;
    }
    console.log(`[EditCanvas] COMMIT pre-convert — text="${(json.text||'').slice(0,20)}" fontSize=${json.fontSize} width=${json.width} height=${json.height} scaleX=${json.scaleX} scaleY=${json.scaleY} left=${json.left} top=${json.top} isNewText=${isNewText}`);

    // Task 3 — Tight-width fit on commit (NEW TEXT ONLY). Fabric Textbox.width
    // stores the WRAP TARGET (default 160), not the visible text width. Without
    // this, a short label like "aaaaa" would save as a 160-wide box with the
    // characters hugging the left edge. Replace with the max rendered line
    // width so the saved annotation rect hugs the actual characters.
    //
    // Re-edit path intentionally does NOT re-tighten: once the user has chosen
    // a size (either by accepting the auto-fit or by manually resizing), that
    // size is locked. Re-entering edit mode and typing more must not shrink or
    // re-fit the box. A future per-annotation "Auto-fit on commit" setting will
    // make this configurable (see FEATURE-BACKLOG.md Stage 3).
    if (isNewText && activeObj.type === 'textbox') {
      let maxLineWidth = 0;
      if (activeObj.textLines && typeof activeObj._getLineWidth === 'function') {
        for (let i = 0; i < activeObj.textLines.length; i++) {
          const w = activeObj._getLineWidth(i) || 0;
          if (w > maxLineWidth) maxLineWidth = w;
        }
      }
      // Fallback if per-line measurement unavailable
      if (maxLineWidth === 0 && typeof activeObj.calcTextWidth === 'function') {
        maxLineWidth = activeObj.calcTextWidth();
      }
      if (maxLineWidth > 0) {
        // 2px breathing room so stroke edge doesn't clip last glyph
        json.width = Math.ceil(maxLineWidth + 2);
      }
    }

    // Re-edit path: preserve the user's chosen size, but allow the textbox to
    // GROW when typed content needs more room. Rule: max(fabricNatural, stored).
    // Never shrink below the user's chosen width/height; always grow to fit
    // overflow so text can't spill past the visible bbox.
    // Future "Preferences → Annotations → Auto-fit textbox on commit" setting
    // will toggle this behavior (see FEATURE-BACKLOG.md Stage 3).
    if (!isNewText && activeObj.type === 'textbox' && originalAnnotationRef.current) {
      const naturalH = activeObj.calcTextHeight
        ? activeObj.calcTextHeight()
        : (activeObj.height || 0);
      const origH = originalAnnotationRef.current.height || 0;
      const origW = originalAnnotationRef.current.width || 0;
      json.width = Math.max(activeObj.width || 0, origW);
      json.height = Math.max(naturalH, origH);
    }

    // For new text in page-space: offset from bbox origin (same as existing text)
    if (isNewText) {
      json.left = json.left - BBOX_PADDING;
      json.top = json.top - BBOX_PADDING;
      json.scaleX = 1;
      json.scaleY = 1;
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

    console.log(`[EditCanvas] COMMIT post-convert — text="${(json.text||'').slice(0,20)}" fontSize=${json.fontSize} width=${json.width} height=${json.height} scaleX=${json.scaleX} scaleY=${json.scaleY} left=${json.left} top=${json.top}`);

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
      // UX: corner-handle scaling is FREE (width and height move independently)
      // by default, and Shift LOCKS the aspect ratio. This matches SVG select
      // mode exactly (see useSVGInteraction.js:360-362 — the SVG path is "free
      // by default, Shift averages scaleX/scaleY to lock"). Fabric 5.x defaults
      // `uniformScaling: true`, which is the OPPOSITE feel; leaving the default
      // means double-clicking a shape to enter edit mode silently flips its
      // transform behavior — user cannot free-stretch without holding a key.
      // Fabric's built-in `uniScaleKey` defaults to 'shiftKey', so setting
      // `uniformScaling: false` here gives us: free drag → Shift locks. Done.
      uniformScaling: false,
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
        // Must match loadTextAnnotation's Textbox width (default 160) to avoid
        // container starting larger than canvas — which causes a visible "big box
        // shrinks to small box" flicker on click-to-create.
        annWidth = textBoxWidth || 160;
        annHeight = 30;  // initial height — auto-resizes as user types
      } else if (annotationData) {
        annLeft = annotationData.left || 0;
        annTop = annotationData.top || 0;
        const dims = getAnnotationDims(annotationData);
        annWidth = dims.width;
        annHeight = dims.height;
        if (editType === 'text' && annWidth < 30) {
          annWidth = 30;
        }
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
          overflow: editType === 'shape' ? 'visible' : undefined,
          transformOrigin: '0 0',
          transform: buildBboxTransform(sx, sy, annLeft, annTop, annWidth, annHeight, annAngle),
          visibility: 'hidden', // stay hidden until canvas loading reveals
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
          overflow: editType === 'shape' ? 'visible' : undefined,
          visibility: 'hidden', // stay hidden until canvas loading reveals
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
      // ALL modes start hidden. Container only becomes visible in canvasInit after the
      // canvas is fully initialized with correct dimensions + outline. This eliminates
      // multi-frame transition flicker (empty container → resized container with outline).
      // Cursor continuity during the hidden period is maintained by injected CSS in App.jsx
      // (useLayoutEffect sets .e-pv-page-div { cursor: text } for text editing).
      if (editType === 'callout') {
        container.style.visibility = 'visible';
      } else {
        container.style.visibility = 'hidden';
      }
    }
    // Text outline deferred to canvas init — prevents wrong-size outline flash.
    // Outline is added in loadTextAnnotation after text dimensions are measured.
    if (editType === 'text') {
      // intentionally no outline here — see canvas init
    }

    setContainerStyle(style);
  }, [editType, annotationData, isNewText, clickPosition, textBoxWidth, pageWidth, pageHeight]);

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
        // Must match loadTextAnnotation's Textbox width (default 160)
        annWidth = textBoxWidth || 160;
        annHeight = 30;
      } else if (annotationDataRef.current) {
        // Use getAnnotationDims so circle/ellipse read radius/rx/ry instead of
        // hitting the 200/30 fallback — that fallback undersized the canvas for
        // shapes without width/height on first edit, clipping the bottom half
        // of handles. Second entry worked only because the first commit path
        // wrote width/height back to the annotation JSON.
        const dims = getAnnotationDims(annotationDataRef.current);
        annWidth = dims.width;
        annHeight = dims.height;
      } else {
        annWidth = 200;
        annHeight = 40;
      }
      if (pageSpaceModeRef.current) {
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

    // DO NOT seed lastContainerSizeRef here. The ResizeObserver callback at
    // ~line 1330 compares lastSize.width against parentEl.offsetWidth (parent-space),
    // but canvasWidth/canvasHeight are canvas-space. For new text creation
    // (annotationDataRef.current === null), the comparison falls back to pageWidth
    // and produces a bogus ~6x ratio on the immediate first fire of the observer,
    // causing a one-frame flicker where the container is scaled up before the
    // 200ms settle timer clears it. Leaving lastContainerSizeRef at its default
    // {0,0} makes the `if (lastSize.width > 0)` guard skip the first fire, and
    // the settle timer populates it correctly afterwards. See Bug 2 investigation
    // in .planning/phases/11-text-shape-editing-zoom-cleanup/.continue-here.md.

    // Branch by editType
    if (editTypeRef.current === 'text') {
      loadTextAnnotation(canvas, effectiveScale);
    } else if (editTypeRef.current === 'shape') {
      loadShapeAnnotation(canvas, effectiveScale);
    } else if (editTypeRef.current === 'callout') {
      loadCalloutAnnotation(canvas);
    }
  }, []); // Mount only

  // -------------------------------------------------------------------------
  // Text loading
  // -------------------------------------------------------------------------
  const loadTextAnnotation = useCallback((canvas, effectiveScale) => {
    const _lt0 = performance.now();
    if (isNewText) {
      // New text creation — mirrors existing text edit path exactly (same zoom, cache clearing,
      // render-before-edit order, sync reveal) to avoid cursor drift
      const es = effectiveScale;

      const textObj = new fabric.Textbox('', {
        type: 'textbox',
        left: BBOX_PADDING,
        top: BBOX_PADDING,
        angle: 0,
        width: textBoxWidth || 160,
        fontSize: 16,
        fill: strokeColor || '#007AFF',
        fontFamily: DEFAULT_FONT_FAMILY,
        splitByGrapheme: true,
        fontWeight: 'normal',
        styles: {},
        charSpacing: 0,
        editable: true,
        selectable: true,
        evented: true,
        cursorColor: '#007AFF',
        editingBorderColor: 'transparent',
        borderColor: 'transparent',
        backgroundColor: '',
        textBackgroundColor: '',
        hasBorders: false,
        hasControls: false,
      });

      bboxOriginRef.current = {
        left: clickPosition?.x ?? 0,
        top: clickPosition?.y ?? 0,
      };
      originalAnnotationRef.current = null;
      newTextScaleRef.current = null;

      // Clear font cache + init dimensions (same as existing text path)
      fabric.util.clearFabricFontCache();
      textObj.initDimensions();
      textObj._clearCache();

      // Add to canvas WITHOUT rendering yet
      canvas.add(textObj);
      canvas.setActiveObject(textObj);

      // Resize canvas to fit (same as existing text path)
      const actualW = textObj.width * (textObj.scaleX || 1);
      const actualH = textObj.calcTextHeight ? textObj.calcTextHeight() : textObj.height * (textObj.scaleY || 1);
      const neededW = Math.ceil((actualW + BBOX_PADDING * 2) * es);
      const neededH = Math.ceil((actualH + BBOX_PADDING * 2) * es);

      canvas.setDimensions({ width: neededW, height: neededH });

      // Render FIRST, then enter editing (same order as existing text path)
      canvas.renderAll();
      textObj.enterEditing();

      // Suppress native caret on Fabric's hidden textarea (Electron can flash it)
      if (textObj.hiddenTextarea) {
        textObj.hiddenTextarea.style.caretColor = 'transparent';
      }

      // Reveal via rAF: wait one frame for the browser to finish compositing the
      // Fabric.js canvas layers (wrapper div, lower-canvas, upper-canvas) before
      // making the container visible. Direct DOM avoids a React re-render cycle
      // that can cause an intermediate frame with partially-applied styles.
      // State updates are also deferred to prevent a React re-render from
      // overwriting direct DOM styles before the rAF fires.
      requestAnimationFrame(() => {
        if (!mountedRef.current || !containerRef.current) return;
        const c = containerRef.current;
        c.style.width = neededW + 'px';
        c.style.height = neededH + 'px';
        c.style.visibility = 'visible';
        c.style.outline = '1px solid #000';
        // Inset the outline by BBOX_PADDING*es on each side so it matches the tight
        // SVG rect position (which draws at textW x textH without any padding).
        // Wrapper size is (textW+40)*es, outline inset by 20*es = visible outline at
        // textW*es x textH*es, positioned at (padding*es, padding*es) inside wrapper,
        // which in viewer coords aligns with (annLeft*es, annTop*es) — same as SVG.
        c.style.outlineOffset = `-${BBOX_PADDING * es}px`;
        c.style.backgroundColor = 'transparent';
        // Sync React state so future re-renders don't revert visibility
        setContainerStyle(prev => ({
          ...prev,
          width: neededW,
          height: neededH,
          visibility: 'visible',
          outline: '1px solid #000',
          outlineOffset: `-${BBOX_PADDING * es}px`,
          backgroundColor: 'transparent',
        }));
        setIsLoading(false);
      });

      // Auto-resize height as text wraps (same as existing text path)
      textObj.on('changed', () => {
        if (!mountedRef.current || !containerRef.current) return;
        const h = (textObj.calcTextHeight() + BBOX_PADDING * 2) * es + 8;
        const newH = Math.max(Math.round(30 * es), Math.ceil(h));
        canvas.setDimensions({ height: newH });
        containerRef.current.style.height = newH + 'px';
      });
    } else if (annotationDataRef.current) {
      // Editing existing text annotation
      const annData = annotationDataRef.current;
      const es = canvas.getZoom();
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
            width: json.width || 160,
            splitByGrapheme: true,
            fontWeight: json.fontWeight || 'normal',
            styles: {},
            editable: true,
            selectable: true,
            evented: true,
            charSpacing: 0, // Must be 0 to match CSS letter-spacing: normal in SVG foreignObject
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

        // Resize canvas to fit actual text BEFORE first render — prevents flash.
        // Height uses max(natural, stored) so a previously-resized-larger textbox
        // does not snap to tight-natural height the instant we re-enter edit mode.
        const actualW = textObj.width * (textObj.scaleX || 1);
        const naturalH = textObj.calcTextHeight
          ? textObj.calcTextHeight()
          : textObj.height * (textObj.scaleY || 1);
        const storedH = originalAnnotationRef.current?.height || 0;
        const actualH = Math.max(naturalH, storedH);
        const es = canvas.getZoom();
        // Add to canvas WITHOUT rendering yet (renderOnAddRemove: false)
        canvas.add(textObj);
        canvas.setActiveObject(textObj);
        const neededW = Math.ceil((actualW + BBOX_PADDING * 2) * es);
        const neededH = Math.ceil((actualH + BBOX_PADDING * 2) * es);

        canvas.setDimensions({ width: neededW, height: neededH });

        // NOW render and enter editing — canvas is correctly sized
        canvas.renderAll();
        textObj.enterEditing();
        textObj.selectAll();

        // Suppress native caret on Fabric's hidden textarea (Electron can flash it)
        if (textObj.hiddenTextarea) {
          textObj.hiddenTextarea.style.caretColor = 'transparent';
        }

        // Reveal via rAF: wait one frame for browser to finish compositing Fabric canvas layers
        requestAnimationFrame(() => {
          if (!mountedRef.current || !containerRef.current) return;
          const c = containerRef.current;
          c.style.width = neededW + 'px';
          c.style.height = neededH + 'px';
          c.style.visibility = 'visible';
          c.style.outline = '1px solid #000';
          // Inset outline by padding*es to match the tight SVG rect position.
          // See new-text reveal path for full explanation.
          c.style.outlineOffset = `-${BBOX_PADDING * es}px`;
          c.style.backgroundColor = 'transparent';
          setContainerStyle(prev => ({
            ...prev,
            width: neededW,
            height: neededH,
            visibility: 'visible',
            outline: '1px solid #000',
            outlineOffset: `-${BBOX_PADDING * es}px`,
            backgroundColor: 'transparent',
          }));
          setIsLoading(false);
        });

        // Auto-resize height as text wraps — width stays fixed for wrapping.
        // Per-keystroke: use max(natural, stored) so typing less than the stored
        // height does not shrink the visual box below what the user chose.
        textObj.on('changed', () => {
          if (!mountedRef.current || !containerRef.current) return;
          const naturalH = textObj.calcTextHeight();
          const storedH2 = originalAnnotationRef.current?.height || 0;
          const effectiveH = Math.max(naturalH, storedH2);
          const h = (effectiveH + BBOX_PADDING * 2) * es + 8;
          const newH = Math.max(Math.round(30 * es), Math.ceil(h));
          canvas.setDimensions({ height: newH });
          containerRef.current.style.height = newH + 'px';
        });
      });
    }
  }, [isNewText, strokeColor, clickPosition]);

  // -------------------------------------------------------------------------
  // Shape loading
  // -------------------------------------------------------------------------
  const loadShapeAnnotation = useCallback((canvas, effectiveScale) => {
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

      // Shape edit: no dashed border, handles visually match SVGSelectionOverlay
      // in both screen-diameter and position via computeShapeHandleSizing (see
      // function docs above for full derivation).
      //
      // opacity:0 hides the Fabric shape render while keeping the hit zone +
      // handles interactive. SVGAnnotationLayer keeps the SVG shape visible
      // during edit, making SVG the single visual truth (sidesteps Canvas 2D
      // vs SVG rasterizer stroke difference — see CLAUDE.md 2026-04-10).
      //
      // Store the real stroke width for the commit path (line ~454) and the
      // stroke picker (line ~187 — writes to _realStrokeWidth only, never to
      // obj.strokeWidth). Force strokeWidth: 0 so Fabric's bounding rect ===
      // the stroke-agnostic geometric rect used by getAnnotationBBox — which
      // is the bbox SVGSelectionOverlay is drawn against. That makes the
      // Fabric bbox and SVG bbox literally identical, so the padding math in
      // computeShapeHandleSizing can mirror SVGAnnotationLayer's padding 1:1.
      obj._realStrokeWidth = obj.strokeWidth || 0;
      obj._svgEffectiveScale = effectiveScale;
      obj._svgIsPageSpaceMode = pageSpaceModeRef.current === true;
      // Counters (Shottr-style numbered badges) are fixed-size — no resize
      // handles, locked scale, locked rotation. Move + recolor + delete still
      // work via the standard shape edit flow.
      const isCounter = obj.data && obj.data.type === 'counter';
      const sizing = computeShapeHandleSizing(obj, effectiveScale, pageSpaceModeRef.current);
      obj.set({
        left: BBOX_PADDING,
        top: BBOX_PADDING,
        angle: 0,
        strokeWidth: isCounter ? (obj._realStrokeWidth || 1.5) : 0,
        selectable: true,
        evented: true,
        hasControls: !isCounter,
        hasBorders: false,
        padding: sizing.padding,
        cornerStyle: 'circle',
        cornerSize: sizing.cornerSize,
        cornerColor: '#ffffff',
        cornerStrokeColor: '#d1d1d1',
        transparentCorners: false,
        lockScalingX: isCounter ? true : obj.lockScalingX,
        lockScalingY: isCounter ? true : obj.lockScalingY,
        lockRotation: isCounter ? true : obj.lockRotation,
        opacity: 0,
      });

      // Install damped corner circles + pill-shaped middle handles matching
      // SVGSelectionOverlay exactly. See installShapeHandleRenderers for details.
      installShapeHandleRenderers(obj);

      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.renderAll();

      canvas.on('object:moving', (e) => {
        const o = e.target;
        const dx = o.left - BBOX_PADDING;
        const dy = o.top - BBOX_PADDING;
        if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return;

        o.set({ left: BBOX_PADDING, top: BBOX_PADDING });

        bboxOriginRef.current.left += dx;
        bboxOriginRef.current.top += dy;

        const containerEl = containerRef.current;
        const parentEl = containerEl?.parentElement;
        if (containerEl && parentEl && pageWidth > 0) {
          const effectiveScale = parentEl.offsetWidth / pageWidth;
          containerEl.style.left = ((bboxOriginRef.current.left - BBOX_PADDING) * effectiveScale) + 'px';
          containerEl.style.top = ((bboxOriginRef.current.top - BBOX_PADDING) * effectiveScale) + 'px';
        }

        if (annotationDataRef.current) {
          annotationDataRef.current = { ...annotationDataRef.current, left: bboxOriginRef.current.left, top: bboxOriginRef.current.top };
        }

        if (onLivePreview && annotationIndex >= 0) {
          const updated = JSON.parse(JSON.stringify(annotationsRef.current || { objects: [] }));
          if (updated.objects[annotationIndex]) {
            updated.objects[annotationIndex].left = bboxOriginRef.current.left;
            updated.objects[annotationIndex].top = bboxOriginRef.current.top;
            onLivePreview(updated);
          }
        }
      });

      canvas.on('object:scaling', (e) => {
        const o = e.target;
        const containerEl = containerRef.current;
        const parentEl = containerEl?.parentElement;
        if (!containerEl || !parentEl || pageWidth <= 0) return;

        const effectiveScale = parentEl.offsetWidth / pageWidth;
        const annData = annotationDataRef.current;
        if (!annData) return;

        // Capture the page-coord bbox origin at drag start. Fabric reports
        // obj.left/obj.top as CUMULATIVE offsets from its stored transform
        // origin each tick, so we must anchor to a snapshot — otherwise we
        // double-absorb across ticks.
        if (!scaleStartRef.current) {
          scaleStartRef.current = {
            bboxOriginLeft: bboxOriginRef.current.left,
            bboxOriginTop: bboxOriginRef.current.top,
          };
        }

        // Fabric shifts obj.left/obj.top during corner/edge scaling to pin
        // the opposite anchor (tl drag pins br, etc). Translate that canvas-
        // space shift into page-coord left/top so the SVG live preview can
        // render the shape at its new position — without this push, SVG
        // grows from its stale tl while Fabric handles grow from the pinned
        // anchor, and the two visibly desync. obj.left/obj.top are left
        // untouched so Fabric handles remain aligned with the SVG shape
        // (container CSS is also left anchored to its start position); the
        // reset + container re-anchor happens in object:modified.
        const fabricLeftOffset = (o.left ?? BBOX_PADDING) - BBOX_PADDING;
        const fabricTopOffset = (o.top ?? BBOX_PADDING) - BBOX_PADDING;
        const pageLeft = scaleStartRef.current.bboxOriginLeft + fabricLeftOffset;
        const pageTop = scaleStartRef.current.bboxOriginTop + fabricTopOffset;

        const newScaleX = o.scaleX;
        const newScaleY = o.scaleY;
        const t = String(annData.type || '').toLowerCase();
        let newW, newH;
        if (t === 'circle') {
          const d = (annData.radius || 0) * 2;
          newW = d * Math.abs(newScaleX);
          newH = d * Math.abs(newScaleY);
        } else if (t === 'ellipse') {
          newW = (annData.rx || 0) * 2 * Math.abs(newScaleX);
          newH = (annData.ry || 0) * 2 * Math.abs(newScaleY);
        } else {
          newW = (annData.width || 200) * Math.abs(newScaleX);
          newH = (annData.height || 30) * Math.abs(newScaleY);
        }

        // UX: During corner/edge scaling, Fabric pins the OPPOSITE anchor and
        // shifts `o.left/o.top` inside the canvas — e.g. dragging the top-
        // middle handle downward shrinks the shape by moving `o.top` DOWN
        // (toward the middle of the canvas) while the bottom edge stays put.
        // If we size the canvas to `(newW + BBOX_PADDING*2) * es` (shape size
        // plus symmetric padding), it works great when `o.top` stays at
        // BBOX_PADDING — but during a drift, the shape's far edge
        // (o.top + newH) can end up BEYOND the canvas pixel buffer and the
        // handles on that edge get clipped ("top handles appear cut off when
        // shrinking downward"). Fix: size the canvas to fit the shape at its
        // CURRENT drifted position — `effLeft/effTop + newW/newH + BBOX_PADDING`
        // — so whichever direction Fabric has pushed the shape, the far side
        // still has a full `BBOX_PADDING * es` of screen-pixel buffer for
        // handle rendering. Matches SVG select mode behavior where handles
        // are always fully visible regardless of drag direction.
        const effLeft = Math.max(BBOX_PADDING, o.left ?? BBOX_PADDING);
        const effTop = Math.max(BBOX_PADDING, o.top ?? BBOX_PADDING);
        const cw = Math.ceil((effLeft + newW + BBOX_PADDING) * effectiveScale);
        const ch = Math.ceil((effTop + newH + BBOX_PADDING) * effectiveScale);
        containerEl.style.width = cw + 'px';
        containerEl.style.height = ch + 'px';
        canvas.setDimensions({ width: cw, height: ch });

        annotationDataRef.current = {
          ...annData,
          scaleX: newScaleX,
          scaleY: newScaleY,
          left: pageLeft,
          top: pageTop,
        };

        if (onLivePreview && annotationIndex >= 0) {
          const updated = JSON.parse(JSON.stringify(annotationsRef.current || { objects: [] }));
          if (updated.objects[annotationIndex]) {
            updated.objects[annotationIndex].scaleX = newScaleX;
            updated.objects[annotationIndex].scaleY = newScaleY;
            updated.objects[annotationIndex].left = pageLeft;
            updated.objects[annotationIndex].top = pageTop;
            onLivePreview(updated);
          }
        }
      });

      canvas.on('object:modified', () => {
        // Finalize an in-flight scale (if any): obj.left/top were left at the
        // Fabric-computed offset during the drag so handles stayed aligned
        // with the SVG shape. Now atomically:
        //   1. Promote annotationDataRef.left/top (page-coord) into bboxOrigin
        //   2. Snap obj.left/top back to BBOX_PADDING so subsequent moves
        //      start from a clean origin
        //   3. Re-anchor container CSS so the canvas re-centers on the
        //      shape's new page-coord top-left
        // The reset + re-anchor happen in the same synchronous block, so
        // there's no visible jump.
        if (scaleStartRef.current && annotationDataRef.current) {
          bboxOriginRef.current = {
            ...bboxOriginRef.current,
            left: annotationDataRef.current.left ?? bboxOriginRef.current.left,
            top: annotationDataRef.current.top ?? bboxOriginRef.current.top,
          };
          const activeObj = canvas.getActiveObject();
          if (activeObj) {
            activeObj.set({ left: BBOX_PADDING, top: BBOX_PADDING });
            activeObj.setCoords();
          }
          scaleStartRef.current = null;
        }

        const containerEl = containerRef.current;
        const parentEl = containerEl?.parentElement;
        if (containerEl && parentEl && pageWidth > 0) {
          const effectiveScale = parentEl.offsetWidth / pageWidth;
          const newLeft = (bboxOriginRef.current.left - BBOX_PADDING) * effectiveScale;
          const newTop = (bboxOriginRef.current.top - BBOX_PADDING) * effectiveScale;
          containerEl.style.left = newLeft + 'px';
          containerEl.style.top = newTop + 'px';
          setContainerStyle(prev => ({
            ...prev,
            left: newLeft,
            top: newTop,
          }));
          canvas.renderAll();
        }
      });

      // Allow handles to extend past the canvas during scaling
      const wrapperEl = canvas.wrapperEl;
      if (wrapperEl) wrapperEl.style.overflow = 'visible';

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

      // Zoom clicks intentionally dismiss edit mode (commit + close). Re-entering is
      // just a double-click, and keeping edit alive through zoom adds container reposition,
      // canvas re-zoom, and toolbar tracking complexity with many edge cases. (2026-04-12)

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
  // Zoom handling -- edit mode is intentionally dismissed on zoom (click-outside
  // commits before zoom fires). This effect only handles the text cursor edge case
  // where zoom somehow starts while text editing is active.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (zoomGeneration === initialZoomGenRef.current) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

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

      if (lastParentWidthRef.current === 0) {
        lastParentWidthRef.current = newParentWidth;
        const c = fabricRef.current;
        if (c) {
          lastContainerSizeRef.current = { width: c.getWidth(), height: c.getHeight() };
        }
        return;
      }

      if (newParentWidth === lastParentWidthRef.current) return;
      lastParentWidthRef.current = newParentWidth;

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
          : lastSize.width / ((getAnnotationDims(annotationDataRef.current).width + BBOX_PADDING * 2) || pageWidth);
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
          const settleDims = getAnnotationDims(annotationDataRef.current);
          const bboxW = settleDims.width + BBOX_PADDING * 2;
          const bboxH = settleDims.height + BBOX_PADDING * 2;
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
              const settleDims2 = getAnnotationDims(annData);
              const annWidth2 = settleDims2.width;
              const annHeight2 = settleDims2.height;
              containerEl.style.left = ((annLeft - BBOX_PADDING) * effectiveScale) + 'px';
              containerEl.style.top = ((annTop - BBOX_PADDING) * effectiveScale) + 'px';
              containerEl.style.width = ((annWidth2 + BBOX_PADDING * 2) * effectiveScale) + 'px';
              containerEl.style.height = ((annHeight2 + BBOX_PADDING * 2) * effectiveScale) + 'px';
              // Keep the inset outline aligned with SVG rect position when zoom changes
              if (editTypeRef.current === 'text') {
                containerEl.style.outlineOffset = `-${BBOX_PADDING * effectiveScale}px`;
              }
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
            const syncDims = getAnnotationDims(annData);
            const isText = editTypeRef.current === 'text';
            setContainerStyle({
              position: 'absolute',
              left: (annLeft - BBOX_PADDING) * effectiveScale,
              top: (annTop - BBOX_PADDING) * effectiveScale,
              width: (syncDims.width + BBOX_PADDING * 2) * effectiveScale,
              height: (syncDims.height + BBOX_PADDING * 2) * effectiveScale,
              zIndex: 101,
              pointerEvents: 'auto',
              // Preserve tight outline-offset for text during zoom settle re-sync
              ...(isText ? {
                outline: '1px solid #000',
                outlineOffset: `-${BBOX_PADDING * effectiveScale}px`,
                backgroundColor: 'transparent',
                visibility: 'visible',
              } : {}),
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

        // For shape: recompute dynamic cornerSize/padding against the new
        // effectiveScale so edit handles keep matching SVG display handles
        // across zoom changes. Also refresh the damped stroke scale so the
        // custom control renderer picks up the new value.
        if (editTypeRef.current === 'shape') {
          const activeObj = canvas.getActiveObject();
          if (activeObj) {
            activeObj._svgEffectiveScale = effectiveScale;
            activeObj._svgIsPageSpaceMode = pageSpaceModeRef.current === true;
            const sizing = computeShapeHandleSizing(activeObj, effectiveScale, pageSpaceModeRef.current);
            activeObj.set({ cornerSize: sizing.cornerSize, padding: sizing.padding });
            // Refresh per-control sizeX/sizeY so pill hit areas and corner hit
            // boxes track the new zoom.
            installShapeHandleRenderers(activeObj);
            activeObj.setCoords();
            canvas.requestRenderAll();
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
          onPropertyChange={(prop, value) => {
            if (!onLivePreview || annotationIndex < 0) return;
            const current = annotationsRef.current;
            const updated = JSON.parse(JSON.stringify(current || { objects: [] }));
            if (updated.objects[annotationIndex]) {
              updated.objects[annotationIndex][prop] = value;
              onLivePreview(updated);
            }
          }}
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
