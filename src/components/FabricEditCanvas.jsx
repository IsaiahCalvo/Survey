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
import {
  beginAnnotationGesture,
  isAnnotationPreviewDiagEnabled,
  markAnnotationPointerRelease,
  markAnnotationPreviewFrame,
} from '../utils/annotationPreviewDiag';
// Plan 15-04 Issue 4 (2026-04-17): TEXT_PADDING is the gutter between the
// Fabric Textbox wrap boundary and the visible SVG border. Fabric.width =
// visible - 2*TEXT_PADDING so wrap parity with CSS `word-break: break-all`
// inside the foreignObject is preserved. Canonicalized in
// src/utils/svgAnnotationRenderers.jsx so both sides cannot drift.
import { TEXT_PADDING } from '../utils/svgAnnotationRenderers';
// measureTextBounds removed — edit canvas uses Textbox wrapping width, not tight text bounds

// Phase 29 Plan 29-05 — Bridge wiring imports (narrow waiver per 29-CONTEXT.md).
// FabricEditCanvas commits via crdtAnnotationBridge (Y.Doc as source of truth)
// instead of routing through onEditCommit (legacy React state path) when the
// CRDT layer is enabled. Echo-loop belt + memoized origin + kill-switch fallback
// are all covered below.
//
// Phase 29 — Eraser-swipe transact bracketing DEFERRED to Phase 33+ follow-up.
// Pre-flight grep at plan revision iteration 1 (2026-04-28) confirmed
// FabricEraserCanvas.jsx (DO NOT CHANGE per CLAUDE.md "Always Protected") owns
// eraser exclusively. FabricEditCanvas has ZERO eraser surface — only two
// documentation comments referencing FabricEraserCanvas. To bracket an eraser
// swipe as one logical undo step we would need either to modify
// FabricEraserCanvas to fire eraser:session:start / eraser:delete /
// eraser:session:end events that a sibling could subscribe to, OR to wrap the
// eraser tool's session model in a higher-order component that exposes the
// bracket — both require waivering FabricEraserCanvas. Both are out of scope
// for v2.4. tests/phase29-e2e/eraser-swipe-undo.spec.mjs STAYS test.fixme'd
// and the Phase 29 reconciliation acknowledges the gap.
import {
  applyFabricCommit,
  applyFabricDelete,
  applyYUpdateToFabric,
  isApplyingRemote,
} from '../lib/collab/crdtAnnotationBridge.js';
import { getLocalFabricOrigin } from '../lib/collab/crdtUndoManager.js';
import { isCRDTEnabled as readCRDTEnabledFlag } from '../lib/collab/crdtFeatureFlag.js';
import { useYDoc } from '../hooks/useYDoc.js';
import CompactColorPicker from './CompactColorPicker';

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
  'data', 'name', 'annotationId', 'needsEntity',
  'globalCompositeOperation', 'layer',
  'isPdfImported', 'pdfAnnotationId', 'pdfAnnotationType', 'pdfInkRenderMode',
];

function createAnnotationId(prefix = 'anno') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureJsonAnnotationId(json, prefix) {
  if (!json || typeof json !== 'object') return;
  const existing = json?.data?.id || json?.data?.annoId || json?.id || json?.annotationId;
  if (!json.data || typeof json.data !== 'object') {
    json.data = {};
  }
  if (!json.data.id) {
    json.data.id = existing || createAnnotationId(prefix);
  }
}

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
const MiniToolbar = memo(({ fabricRef, containerRef, editCanvasStyle, onPropertyChange, onCounterResize, onGroupUpdate, counterGroupSize, annotationData }) => {
  const [fill, setFill] = useState('transparent');
  const [stroke, setStroke] = useState('#000000');
  const [strokeW, setStrokeW] = useState(3);
  // Counter-specific state: badge radius (page-space px) takes the slot normally
  // occupied by strokeWidth so the +/- buttons can resize the badge directly.
  const [isCounter, setIsCounter] = useState(false);
  const [counterRadius, setCounterRadius] = useState(14);
  // Counter Step 7: font color (data.numberColor on the pin), group-wide.
  // Defaults to white to match the legacy renderCounter hardcoded text fill.
  const [numberColor, setNumberColor] = useState('#FFFFFF');
  // Counter Step 7: digit-only input value for setting the displayed number on
  // a SOLO-pin group. Editable only when the series has exactly one pin (the
  // editing rule keeps multi-pin renumbering simple — change the value once at
  // creation, never again). Local state so typing feels instant; commits to
  // data.seriesStart on Enter or blur via onGroupUpdate.
  const [numberInputValue, setNumberInputValue] = useState('');
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
    // Counter-specific: detect via data.type so the mini-bar swaps Stroke/Width
    // controls for a single Color + Size pair (Shottr UX).
    const counter = !!(obj.data && obj.data.type === 'counter');
    setIsCounter(counter);
    if (counter) setCounterRadius(obj.radius || 14);
  }, [fabricRef]);

  // Counter Step 7: re-sync number input + font-color swatch from the latest
  // annotationData snapshot. Runs whenever the editing target changes (e.g.
  // user dismisses one pin and double-clicks another), since the existing
  // [fabricRef]-only sync above only fires once per mount.
  useEffect(() => {
    if (annotationData?.data?.type !== 'counter') return;
    setNumberColor(annotationData.data.numberColor || '#FFFFFF');
    setNumberInputValue(String(annotationData.data.displayNumber ?? 1));
  }, [annotationData]);

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

  const updateProperty = useCallback((prop, value, extras) => {
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
    if (onPropertyChange) onPropertyChange(prop, value, extras);
  }, [fabricRef, onPropertyChange]);

  const handleStrokeWidthChange = useCallback((delta) => {
    if (isCounter) {
      // Counter: clamp radius to a reasonable visible range. Floor 4 keeps the
      // badge clickable; ceiling 60 keeps it from swallowing the page. Routes
      // through onCounterResize (defined in FabricEditCanvas parent) which owns
      // the bboxOriginRef + container CSS + commit-path bookkeeping needed to
      // keep the visual center fixed across edit/commit cycles. Doing the
      // recenter inside MiniToolbar would only touch canvas-local coords
      // (BBOX_PADDING) — that produced the snap-to-top-left bug because the
      // commit path reads bboxOriginRef.left/top, NOT obj.left/top.
      const newR = Math.max(4, Math.min(60, counterRadius + delta));
      setCounterRadius(newR);
      if (onCounterResize) onCounterResize(newR);
      return;
    }
    const newW = Math.max(1, Math.min(20, strokeW + delta));
    setStrokeW(newW);
    updateProperty('strokeWidth', newW);
  }, [isCounter, counterRadius, strokeW, updateProperty, onCounterResize]);

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

  // Counter-pin / shape colour popup — uses the app's one shared colour picker
  // (CompactColorPicker). Opacity is hidden: these colours have no per-colour
  // transparency here (counter pins carry a group-wide opacity elsewhere).
  const renderColorGrid = (currentColor, onSelect, onClose) => (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 4,
        zIndex: 103,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <CompactColorPicker
        color={currentColor}
        showOpacity={false}
        onChange={(hex) => onSelect(hex)}
        onClose={onClose}
      />
    </div>
  );

  // Counter Step 7 — early branch. When the editing target is a counter pin,
  // render a counter-specific mini-toolbar variant. Layout matches the rect/
  // circle bar visually (same chrome, same spacing) so muscle memory carries
  // over, but the controls have different semantics:
  //   - Fill   → bubble color, GROUP-WIDE (writes obj.fill on every pin in
  //              the same seriesId across every page). Local Fabric obj is
  //              also updated for instant in-edit visual feedback.
  //   - Stroke → number text color (data.numberColor), GROUP-WIDE. There is
  //              no actual outline on a counter pin; the swatch is labelled
  //              "Stroke" only to stay consistent with the rect/circle bar.
  //              renderCounter reads data.numberColor || '#ffffff' as the
  //              SVG <text fill> so the change shows up on the next save.
  //   - Size   → per-pin radius via existing +/- handler (unchanged from
  //              the legacy counter handling — onCounterResize routes through
  //              FabricEditCanvas's bbox/recenter machinery).
  //   - #      → digit-only number input. Editable ONLY when the series has
  //              exactly one pin (counterGroupSize === 1). Disabled +
  //              greyed out when ≥ 2 pins, because group renumbering on a
  //              non-first pin gets ambiguous fast (negative numbers, gaps,
  //              etc) — the rule "set the start once at creation, never
  //              again" sidesteps that entirely. Commits on Enter/blur via
  //              onGroupUpdate(seriesId, { seriesStart }) which writes
  //              data.seriesStart on the single pin; renumberCounters then
  //              recomputes data.displayNumber on next save.
  // The existing rect/circle/text return path below is BYTE-IDENTICAL — this
  // branch returns BEFORE it, so non-counter shapes are unaffected.
  if (isCounter) {
    const seriesId = annotationData?.data?.seriesId;
    const groupSize = counterGroupSize || 0;
    // UX: number input is editable only on a 1-pin (solo) group. The "set the
    // start once at creation" rule prevents the renumber math from getting
    // weird when the user picks pin #15 of a 20-pin group. This keeps the
    // input present (so the pin's current number is always visible) but
    // visually communicates it's locked once the group has been extended.
    const numberInputDisabled = groupSize !== 1;
    return createPortal(
      <div
        ref={toolbarRef}
        data-mini-toolbar
        data-counter-mini-toolbar
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
          minWidth: 280,
          maxWidth: 420,
          height: 36,
          boxSizing: 'border-box',
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Fill — group-wide */}
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
            }}
          />
          {showFillPicker && renderColorGrid(fill, (c) => {
            setFill(c);
            // Local Fabric mutation for instant in-edit feedback on the
            // selected pin. The group propagation below also updates this
            // pin via the JSON, so the writes converge on the same value.
            updateProperty('fill', c);
            // Group-wide propagation across all pages.
            if (onGroupUpdate && seriesId) {
              onGroupUpdate(seriesId, { fill: c });
            }
          }, () => setShowFillPicker(false))}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, backgroundColor: '#3A3A3A' }} />

        {/* Stroke = number text color — group-wide */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>Stroke:</span>
          <div
            onClick={() => { setShowStrokePicker(!showStrokePicker); setShowFillPicker(false); }}
            style={{
              width: 16, height: 16,
              backgroundColor: numberColor,
              borderRadius: 2,
              border: '1px solid #555',
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          />
          {showStrokePicker && renderColorGrid(numberColor, (c) => {
            setNumberColor(c);
            // Route the change through the SAME path Fill uses — updateProperty
            // calls obj.set('data', newData) on the active Fabric obj AND fires
            // onPropertyChange → onLivePreview, which writes the new data to
            // annotationsByPage via handleSaveAnnotations. This is why Fill
            // worked and an earlier "just mutate obj.data" attempt didn't:
            // mutating obj.data directly didn't sync the page JSON until
            // onEditCommit fired, and onEditCommit's stale annotationsRef
            // would then overwrite the cross-page propagation. Going through
            // updateProperty('data', newData) makes the live-save path the
            // single source of truth for the selected pin.
            const canvas = fabricRef.current;
            const obj = canvas?.getActiveObject?.();
            if (obj && obj.data) {
              const newData = { ...obj.data, numberColor: c };
              updateProperty('data', newData);
              console.log(`[CSeries mini stroke] write data.numberColor=${c} obj.data after=${JSON.stringify(obj.data)}`);
            }
            // Group-wide propagation to OTHER pins in the series across all pages.
            if (onGroupUpdate && seriesId) {
              onGroupUpdate(seriesId, { numberColor: c });
            }
          }, () => setShowStrokePicker(false))}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, backgroundColor: '#3A3A3A' }} />

        {/* Size +/- — per-pin (existing handler, untouched) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>Size:</span>
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
            {counterRadius}px
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

        {/* Separator */}
        <div style={{ width: 1, height: 20, backgroundColor: '#3A3A3A' }} />

        {/* Number input — per-pin, single-pin-groups only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>#:</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={numberInputValue}
            disabled={numberInputDisabled}
            onChange={(e) => {
              // Strip non-digits so the input only ever holds a numeric string.
              const v = e.target.value.replace(/[^0-9]/g, '');
              setNumberInputValue(v);
            }}
            onKeyDown={(e) => {
              // Enter commits and removes focus, which fires onBlur → propagate.
              if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
              }
            }}
            onBlur={() => {
              if (numberInputDisabled) return;
              const parsed = parseInt(numberInputValue, 10);
              // Guard: ignore empty / NaN / non-positive. Counters start at 1
              // by default; allowing 0 or negatives makes the displayed text
              // ambiguous and breaks user expectations.
              if (Number.isFinite(parsed) && parsed >= 1 && onGroupUpdate && seriesId) {
                // Route through updateProperty('data', newData) so the
                // onPropertyChange → onLivePreview pipeline writes the new
                // data.seriesStart into the page JSON. Same reasoning as the
                // stroke handler — the live-save path is the single source
                // of truth for the selected pin's data field.
                const canvas = fabricRef.current;
                const obj = canvas?.getActiveObject?.();
                if (obj && obj.data) {
                  const newData = { ...obj.data, seriesStart: parsed };
                  updateProperty('data', newData);
                  console.log(`[CSeries mini number] write data.seriesStart=${parsed} obj.data after=${JSON.stringify(obj.data)}`);
                }
                onGroupUpdate(seriesId, { seriesStart: parsed });
              }
            }}
            style={{
              width: 44,
              height: 22,
              background: numberInputDisabled ? '#222' : '#444',
              border: '1px solid #555',
              borderRadius: 3,
              color: numberInputDisabled ? '#888' : '#FFFFFF',
              fontSize: 12,
              textAlign: 'center',
              padding: '0 4px',
              pointerEvents: 'auto',
              cursor: numberInputDisabled ? 'not-allowed' : 'text',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            title={numberInputDisabled
              ? 'The pin number can only be set when the count group has a single pin. Add more pins → number is locked.'
              : 'Set this pin\'s starting number — the group will renumber from here.'}
          />
        </div>
      </div>,
      document.body
    );
  }

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

      {/* Stroke — hidden for counter (Shottr counters have a fixed white outline) */}
      {!isCounter && (
        <>
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
        </>
      )}

      {/* Width / Size — for counter this is the badge RADIUS, for everything else
          it is the line stroke width. Both share +/- buttons and the same handler. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>{isCounter ? 'Size:' : 'Width:'}</span>
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
          {isCounter ? counterRadius : strokeW}px
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
// UX diag 2026-04-19: exhaustive cursor-parity dump helper. Produces one
// comprehensive snapshot of a Fabric text object + its matching SVG element
// + all relevant parent wrappers + canvas/viewport state. Both the text-edit
// path and the callout-edit path call this at edit entry and on every
// keystroke so the saved console log contains apples-to-apples records that
// can be diffed field-by-field to isolate the cursor drift source.
// ---------------------------------------------------------------------------
const dumpCursorParity = (phase, source, id, fabricObj, svgEl, canvas, containerEl) => {
  if (!isAnnotationPreviewDiagEnabled()) return;
  try {
    const pickComputed = (el) => {
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      const fields = [
        'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'fontVariant',
        'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing',
        'wordBreak', 'wordWrap', 'whiteSpace', 'overflowWrap',
        'fontKerning', 'textRendering', 'fontVariantLigatures',
        'fontFeatureSettings', 'fontSynthesis', 'fontOpticalSizing',
        'textAlign', 'textIndent', 'textTransform', 'direction',
        'writingMode', 'unicodeBidi',
        'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'border', 'boxSizing', 'display', 'position',
        'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
        'overflow', 'overflowX', 'overflowY',
        'opacity', 'visibility', 'color',
        'webkitFontSmoothing', 'MozOsxFontSmoothing',
        'transform', 'transformOrigin',
      ];
      const out = {};
      for (const f of fields) {
        try { out[f] = cs[f]; } catch (_) {}
      }
      const r = el.getBoundingClientRect();
      out.rect = { x: r.x, y: r.y, w: r.width, h: r.height };
      return out;
    };
    const fabricJson = fabricObj && typeof fabricObj.toJSON === 'function'
      ? (() => { try { return fabricObj.toJSON(); } catch (_) { return null; } })()
      : null;
    const fabricExtras = fabricObj ? {
      cursorOffsetCache: fabricObj.cursorOffsetCache,
      __charBounds_firstLineLen: Array.isArray(fabricObj.__charBounds)
        ? (Array.isArray(fabricObj.__charBounds[0]) ? fabricObj.__charBounds[0].length : null)
        : null,
      _textLines_count: Array.isArray(fabricObj._textLines) ? fabricObj._textLines.length : null,
      _textLines_first: Array.isArray(fabricObj._textLines) && fabricObj._textLines[0]
        ? (Array.isArray(fabricObj._textLines[0]) ? fabricObj._textLines[0].join('') : String(fabricObj._textLines[0]))
        : null,
      _unwrappedTextLines_count: Array.isArray(fabricObj._unwrappedTextLines) ? fabricObj._unwrappedTextLines.length : null,
      textWidth: (typeof fabricObj.calcTextWidth === 'function') ? fabricObj.calcTextWidth() : null,
      textHeight: (typeof fabricObj.calcTextHeight === 'function') ? fabricObj.calcTextHeight() : null,
      isEditing: !!fabricObj.isEditing,
      selectionStart: fabricObj.selectionStart,
      selectionEnd: fabricObj.selectionEnd,
      text: fabricObj.text,
    } : null;
    const svgDump = pickComputed(svgEl);
    const svgForeignObject = svgEl && svgEl.parentElement && svgEl.parentElement.tagName.toLowerCase() === 'foreignobject'
      ? svgEl.parentElement
      : null;
    const svgForeignDump = svgForeignObject ? {
      rect: (() => { const r = svgForeignObject.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
      x: svgForeignObject.getAttribute('x'),
      y: svgForeignObject.getAttribute('y'),
      width: svgForeignObject.getAttribute('width'),
      height: svgForeignObject.getAttribute('height'),
      overflow: svgForeignObject.getAttribute('overflow'),
    } : null;
    // UX diag 2026-04-19 — overflow check. Compares the actual rendered
    // text content height/width against the visible foreignObject box so
    // the console log surfaces when resize-clipping kicks in. Mirrors the
    // behavior a user sees in Drawboard PDF: shrink the box past the
    // wrapped content, letters start disappearing behind the border.
    const overflowDump = svgEl ? {
      scrollHeight: svgEl.scrollHeight,
      clientHeight: svgEl.clientHeight,
      scrollWidth: svgEl.scrollWidth,
      clientWidth: svgEl.clientWidth,
      verticalClip: svgEl.scrollHeight > svgEl.clientHeight + 0.5,
      horizontalClip: svgEl.scrollWidth > svgEl.clientWidth + 0.5,
      // UX diag 2026-04-20: surface the live SVG text content so the saved
      // log shows whether new characters are reaching the DOM. Divergence
      // between fabric.text and this value means the live-bounds broadcast
      // stalled; match means the bug is visual (z-order / opacity / clip).
      svgTextContent: (typeof svgEl.textContent === 'string') ? svgEl.textContent : null,
      svgTextContentLen: (typeof svgEl.textContent === 'string') ? svgEl.textContent.length : null,
      // UX diag 2026-04-20: stacking-order probe. Sample the DOM at several
      // vertical points inside the text rect (25%, 50%, 75%, 95%). For each
      // point report the topmost 3 elements — if any of them is not the SVG
      // text layer, that's the thing visually hiding the letters.
      stackAtPoints: (() => {
        const r = svgEl.getBoundingClientRect();
        if (!r || r.width === 0 || r.height === 0) return null;
        const cx = r.left + r.width / 2;
        const samples = {};
        for (const frac of [0.05, 0.25, 0.5, 0.75, 0.95]) {
          const y = r.top + r.height * frac;
          const els = (typeof document.elementsFromPoint === 'function')
            ? document.elementsFromPoint(cx, y).slice(0, 4)
            : [];
          samples[`f${Math.round(frac * 100)}`] = els.map((e) => ({
            tag: e.tagName,
            cls: (e.className && typeof e.className === 'string') ? e.className.slice(0, 40) : '',
            id: e.id || '',
            dataPart: e.getAttribute?.('data-callout-part') || e.getAttribute?.('data-annotation-text-bounds') || '',
          }));
        }
        return samples;
      })(),
    } : null;
    const containerDump = containerEl ? {
      rect: (() => { const r = containerEl.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
      styleWidth: containerEl.style.width,
      styleHeight: containerEl.style.height,
      styleLeft: containerEl.style.left,
      styleTop: containerEl.style.top,
      styleTransform: containerEl.style.transform,
      styleVisibility: containerEl.style.visibility,
    } : null;
    const canvasDump = canvas ? {
      zoom: canvas.getZoom ? canvas.getZoom() : null,
      viewportTransform: canvas.viewportTransform ? canvas.viewportTransform.slice() : null,
      width: canvas.getWidth ? canvas.getWidth() : null,
      height: canvas.getHeight ? canvas.getHeight() : null,
    } : null;
    // UX diag 2026-04-20: direct screen-position measurement. Computes the
    // Fabric cursor's absolute screen Y + the first-line SVG glyph's absolute
    // screen Y and logs the delta. A non-zero delta is the exact pixel gap
    // the user sees between the blinking cursor and the letters.
    let cursorVsGlyph = null;
    try {
      if (fabricObj && canvas && svgEl && typeof fabricObj.getAbsoluteCoords !== 'function') {
        const z = canvas.getZoom ? canvas.getZoom() : 1;
        const canvasEl = canvas.getElement ? canvas.getElement() : null;
        const canvasRect = canvasEl ? canvasEl.getBoundingClientRect() : null;
        const lineIndex = fabricObj.get2DCursorLocation ? fabricObj.get2DCursorLocation().lineIndex : 0;
        const perLine = (fabricObj.getHeightOfLine && Number.isFinite(fabricObj.getHeightOfLine(0)))
          ? fabricObj.getHeightOfLine(0) : 0;
        const topOffsetInside = lineIndex * perLine;
        const cursorScreenY = canvasRect
          ? canvasRect.top + (fabricObj.top - fabricObj.height / 2) * z
            + (topOffsetInside + fabricObj.height / 2) * z
          : null;
        const svgLineBoxTopY = svgEl.getBoundingClientRect
          ? svgEl.getBoundingClientRect().top + lineIndex * perLine * z
          : null;
        cursorVsGlyph = {
          lineIndex,
          perLine,
          cursorScreenY,
          svgLineBoxTopY,
          deltaPx: (cursorScreenY != null && svgLineBoxTopY != null)
            ? Math.round((cursorScreenY - svgLineBoxTopY) * 100) / 100
            : null,
        };
      }
    } catch (_e) {}
    console.log('[TextCursorParity]', {
      phase,
      source,
      id,
      fabric: { ...(fabricJson || {}), __extras: fabricExtras },
      svg: svgDump,
      svgForeignObject: svgForeignDump,
      overflow: overflowDump,
      container: containerDump,
      canvas: canvasDump,
      cursorVsGlyph,
    });
  } catch (_e) {}
};

// ---------------------------------------------------------------------------
// FabricEditCanvas
// ---------------------------------------------------------------------------
const FabricEditCanvas = memo(({
  pageNumber,
  pageWidth,
  pageHeight,
  editType,            // 'text' | 'shape' | 'callout'
  reactCalloutId,      // sentinel that the edit is actually a callout text edit (routed through the 'text' branch)
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
  // Counter Step 7 — group-wide propagation hook. Called from the counter
  // mini-toolbar's Fill / Stroke / Number-input handlers. App.jsx walks
  // annotationsByPageRef across all pages, finds every pin matching seriesId,
  // applies the patch (fill / numberColor / seriesStart), and commits with
  // a single undo checkpoint. Optional — non-counter shapes never call it.
  onGroupUpdate,       // (seriesId, patch) => void
  // Counter Step 7 — count of pins in the editing pin's series. Drives the
  // number-input enabled/disabled state (only editable when groupSize === 1).
  // 0 / undefined for non-counter shapes.
  counterGroupSize,
  // Phase 15 UAT-2 — parameterize the edit-mode container outline color so
  // callout edits can match the callout's own border color (view/edit parity).
  // Defaults to '#000' to preserve the existing text-edit visual. Applied at
  // all 5 hardcoded outline sites: new-text reveal (direct DOM + React state),
  // existing-text reveal (direct DOM + React state), and zoom-settle resync.
  outlineColor = '#000',
  // Phase 15 UAT-2 — live text-bounds broadcast during callout edit. Fires
  // on every Fabric Textbox 'changed' event with page-space bounds
  // { left, top, width, height }. App.jsx feeds this back into SVGAnnotationLayer
  // so line1 retracts to the live textbox edge as the box auto-grows, instead
  // of attaching to the stale edge computed at edit-mode entry. Only wired for
  // callout edits (App.jsx checks editingAnnotation.reactCalloutId before
  // passing this prop). Optional — safe no-op for plain text edits.
  onLiveTextGrow,
  onRichTextEditorChange,
  onCalloutTextStyleChange,
}) => {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [isLoading, setIsLoading] = useState(true);
  const [containerStyle, setContainerStyle] = useState({ visibility: 'hidden' });

  // -------------------------------------------------------------------------
  // Phase 29 Plan 29-05 — Bridge wiring context read (narrow waiver).
  // useYDoc returns NULL_VALUE when called outside <YDocProvider> (Phase 27
  // contract) — every field destructured below is null-safe in test harnesses
  // and when CRDT is killed via the localStorage / env kill switch. undoManager
  // and undoCtx come from Plan 29-04 once that plan lands; until then they are
  // null and the per-word stopCapturing / mid-drag handlers gracefully no-op
  // their stopCapturing call. The bridge write itself does NOT depend on those
  // fields — applyFabricCommit only needs ydoc + a memoized origin payload.
  // -------------------------------------------------------------------------
  const { ydoc, undoManager, undoCtx } = useYDoc();
  const crdtEnabled = readCRDTEnabledFlag();

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
  // UX 2026-04-19 — tracks the vertical shift applied to the callout
  // textbox so its cursor lines up with the SVG callout's flex-centered
  // text. Applied on load, unwound on commit so the stored top stays
  // pure.
  const calloutCenterShiftYRef = useRef(0);
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
  const editDiagGestureRef = useRef(null);

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

    // UX 2026-04-25 — Fall back to the only object on the canvas if Fabric
    // already deselected by the time commitAndClose runs. Click-outside
    // and the text:editing:exited setTimeout can both fire after Fabric
    // has cleared the active object, returning getActiveObject() === null.
    // Without the fallback, commit takes the cancel branch and the user's
    // typed text is lost — visible as a callout that stays blank after
    // the user types and clicks away.
    let activeObj = canvas.getActiveObject();
    if (!activeObj) {
      const objs = typeof canvas.getObjects === 'function' ? canvas.getObjects() : [];
      if (objs.length > 0) activeObj = objs[0];
    }

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
    // Plan 15-04 Step 2 — Text/callout edit sets fill+stroke to transparent so the
    // SVG renders as the visible truth during typing. Restore from the pre-edit
    // snapshot before persisting so the saved annotation carries its real colors.
    if ((editTypeRef.current === 'text' || editTypeRef.current === 'callout')
        && originalAnnotationRef.current) {
      const orig = originalAnnotationRef.current;
      if (orig.fill !== undefined) json.fill = orig.fill;
      if (orig.stroke !== undefined) json.stroke = orig.stroke;
      // UX 2026-04-20: edit-time strokeWidth is pinned to 0 so the Fabric
      // cursor layout isn't nudged by a fake half-stroke offset. Restore
      // the stored strokeWidth on commit so the visible border comes back
      // after the user finishes typing. Without this, committing a plain
      // text box leaves it borderless even if the import had a border.
      if (orig.strokeWidth !== undefined) json.strokeWidth = orig.strokeWidth;
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
    // Plan 15-04 Issue 4 — convert Fabric's INNER width/height back to the
    // OUTER stored dims by adding 2*pad. Applied uniformly (imports included)
    // per user UAT feedback — view + edit share one contract.
    const commitPad = TEXT_PADDING;
    if (isNewText && activeObj.type === 'textbox') {
      // Tight-fit only applies when the user's text is a single line that
      // fits inside the textbox wrap target (e.g. "aaaaa" in a 400-px drag).
      // When Fabric has already wrapped into multiple lines, the content is
      // already using the full wrap width — tightening to maxLineWidth+2
      // produces a SVG width 1-3 px wider than Fabric's wrap target, which
      // causes CSS `word-break: break-all` to fit 1 extra char per line
      // post-commit. The re-wrap visibly shifts line breaks upward ("text
      // snaps to smaller area" UAT, Plan 15-04 Issue 3, 2026-04-17).
      const wrappedLineCount = Array.isArray(activeObj._textLines) ? activeObj._textLines.length : 1;
      if (wrappedLineCount <= 1) {
        let maxLineWidth = 0;
        if (activeObj.textLines && typeof activeObj._getLineWidth === 'function') {
          for (let i = 0; i < activeObj.textLines.length; i++) {
            const w = activeObj._getLineWidth(i) || 0;
            if (w > maxLineWidth) maxLineWidth = w;
          }
        }
        if (maxLineWidth === 0 && typeof activeObj.calcTextWidth === 'function') {
          maxLineWidth = activeObj.calcTextWidth();
        }
        if (maxLineWidth > 0) {
          // 2px breathing room so stroke edge doesn't clip last glyph;
          // +2*commitPad converts inner tight-fit → outer stored width.
          json.width = Math.ceil(maxLineWidth + 2) + 2 * commitPad;
        }
      } else {
        // Multi-line: keep Fabric's wrap width so committed SVG wraps to the
        // same lines the user saw live, and add 2*commitPad so json.width is
        // OUTER (renderText consumes outer; border rect lives there).
        json.width = (activeObj.width || 0) + 2 * commitPad;
      }
      // Height for new text: activeObj.height from toJSON() is INNER
      // (calcTextHeight-derived). Store OUTER so renderText's border rect
      // encloses the inner padded content.
      const naturalH = activeObj.calcTextHeight
        ? activeObj.calcTextHeight()
        : (activeObj.height || 0);
      json.height = naturalH + 2 * commitPad;
    }

    // Re-edit path: preserve the user's chosen size, but allow the textbox to
    // GROW when typed content needs more room. Rule: max(fabricNatural, stored).
    // Never shrink below the user's chosen width/height; always grow to fit
    // overflow so text can't spill past the visible bbox.
    // Future "Preferences → Annotations → Auto-fit textbox on commit" setting
    // will toggle this behavior (see FEATURE-BACKLOG.md Stage 3).
    if (!isNewText && activeObj.type === 'textbox' && originalAnnotationRef.current) {
      // Plan 15-04 Issue 4 — activeObj.width/calcTextHeight are INNER; origW/H
      // are OUTER (stored). Convert inner→outer via +2*commitPad before the
      // max() so growth + stored compare in the same coordinate space.
      // 2026-04-19: callouts use padY=0 (no vertical gutter), so height
      // commit skips the +2*pad addition to keep Fabric's natural height
      // equal to stored height on round-trip.
      const commitPadY = reactCalloutId ? 0 : commitPad;
      const naturalH = activeObj.calcTextHeight
        ? activeObj.calcTextHeight()
        : (activeObj.height || 0);
      const origH = originalAnnotationRef.current.height || 0;
      const origW = originalAnnotationRef.current.width || 0;
      json.width = Math.max((activeObj.width || 0) + 2 * commitPad, origW);
      json.height = Math.max(naturalH + 2 * commitPadY, origH);
    }

    // For new text in page-space: offset from bbox origin (same as existing text)
    if (isNewText) {
      // Plan 15-04 Issue 4 — the Textbox was shifted by TEXT_PADDING inside
      // the canvas so the caret lands at the first inner column. The stored
      // left/top must be the OUTER (border) corner, so subtract commitPad in
      // addition to BBOX_PADDING before re-anchoring to the page origin.
      json.left = json.left - BBOX_PADDING - commitPad;
      json.top = json.top - BBOX_PADDING - commitPad;
      json.scaleX = 1;
      json.scaleY = 1;
      if (bboxOriginRef.current) {
        json.left += bboxOriginRef.current.left;
        json.top += bboxOriginRef.current.top;
      }
    } else if (editTypeRef.current !== 'callout' && bboxOriginRef.current) {
      // For bbox mode (text/shape): reverse coordinate offset. Plan 15-04
      // Issue 4 — textboxes additionally carry a TEXT_PADDING shift inside
      // the canvas (so caret sits at the first inner column), so we subtract
      // commitPad only for textboxes. Shapes stay unaffected (padForCommit=0).
      // 2026-04-19: split into X/Y to match the load path — callouts use
      // padY=0 so commit unwind must agree (otherwise top drifts up on save).
      // Callouts also carry calloutCenterShiftYRef.current (vertical center
      // offset applied on load so the cursor matches the SVG's flex-centered
      // glyphs). Subtract it so the stored top stays pure.
      const isTextbox = activeObj.type === 'textbox';
      const padForCommitX = isTextbox ? commitPad : 0;
      const padForCommitY = isTextbox ? (reactCalloutId ? 0 : commitPad) : 0;
      const calloutCenterUnwind = (isTextbox && reactCalloutId)
        ? calloutCenterShiftYRef.current
        : 0;
      json.left = bboxOriginRef.current.left + (json.left - BBOX_PADDING - padForCommitX);
      json.top = bboxOriginRef.current.top + (json.top - BBOX_PADDING - padForCommitY - calloutCenterUnwind);
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
    ensureJsonAnnotationId(json, json.type || 'anno');

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

  const onRichTextEditorChangeRef = useRef(onRichTextEditorChange);
  useEffect(() => { onRichTextEditorChangeRef.current = onRichTextEditorChange; }, [onRichTextEditorChange]);
  const onCalloutTextStyleChangeRef = useRef(onCalloutTextStyleChange);
  useEffect(() => { onCalloutTextStyleChangeRef.current = onCalloutTextStyleChange; }, [onCalloutTextStyleChange]);
  const reactCalloutIdRef = useRef(reactCalloutId);
  useEffect(() => { reactCalloutIdRef.current = reactCalloutId; }, [reactCalloutId]);
  const editingTextboxRef = useRef(null);
  const lastSelectionRangeRef = useRef(null);

  const calloutStylePatchFromFabricKey = (key, val) => {
    switch (key) {
      case 'fontWeight': return { bold: val === 'bold' };
      case 'fontStyle': return { italic: val === 'italic' };
      case 'underline': return { underline: !!val };
      case 'linethrough': return { strikethrough: !!val };
      case 'textAlign': return { textAlign: val };
      case 'verticalAlign': return { verticalAlign: val };
      case 'fontFamily': return { fontFamily: val };
      case 'fontSize': return { fontSize: Number(val) || 12 };
      default: return null;
    }
  };

  const readRichTextState = useCallback((obj) => {
    if (!obj || obj.type !== 'textbox') {
      return { bold: false, italic: false, underline: false, strike: false, fontSize: 16 };
    }
    const intendedFontColor = (originalAnnotationRef.current && typeof originalAnnotationRef.current.fill === 'string')
      ? originalAnnotationRef.current.fill
      : (typeof obj.fill === 'string' && obj.fill !== 'rgba(0,0,0,0)' ? obj.fill : '#1e293b');
    return {
      bold: obj.fontWeight === 'bold',
      italic: obj.fontStyle === 'italic',
      underline: !!obj.underline,
      strike: !!obj.linethrough,
      fontSize: Math.round(Number(obj.fontSize) || 16),
      textAlign: obj.textAlign || 'left',
      verticalAlign: obj.verticalAlign || 'top',
      fontFamily: obj.fontFamily || 'Arial',
      fontColor: intendedFontColor,
    };
  }, []);

  const richTextApiRef = useRef(null);
  const publishRichTextEditor = useCallback(() => {
    const cb = onRichTextEditorChangeRef.current;
    if (typeof cb !== 'function') return;
    const obj = fabricRef.current?.getActiveObject() || editingTextboxRef.current;
    if (!obj || obj.type !== 'textbox') {
      cb(null);
      return;
    }
    editingTextboxRef.current = obj;
    if (obj.selectionStart != null && obj.selectionEnd != null) {
      lastSelectionRangeRef.current = { start: obj.selectionStart, end: obj.selectionEnd };
    }
    if (!richTextApiRef.current) {
      const applyTextStyle = (key, val) => {
        const canvas = fabricRef.current;
        const target = editingTextboxRef.current || canvas?.getActiveObject();
        if (!target || target.type !== 'textbox') return;
        target.styles = {};
        target.set(key, val);
        if (typeof target.initDimensions === 'function') target.initDimensions();
        if (canvas && target.canvas === canvas) canvas.setActiveObject(target);
        if (typeof target.enterEditing === 'function' && !target.isEditing) target.enterEditing();
        const stashed = lastSelectionRangeRef.current;
        if (stashed && stashed.start !== stashed.end && typeof target.setSelectionStart === 'function') {
          target.setSelectionStart(stashed.start);
          target.setSelectionEnd(stashed.end);
        }
        const cid = reactCalloutIdRef.current;
        const styleCb = onCalloutTextStyleChangeRef.current;
        if (cid && typeof styleCb === 'function') {
          const patch = calloutStylePatchFromFabricKey(key, val);
          if (patch) styleCb(cid, patch);
        }
        if (typeof target.fire === 'function') target.fire('changed');
        canvas?.requestRenderAll();
        publishRichTextEditor();
      };
      const readLive = () => readRichTextState(editingTextboxRef.current);
      richTextApiRef.current = {
        toggleBold: () => applyTextStyle('fontWeight', readLive().bold ? 'normal' : 'bold'),
        toggleItalic: () => applyTextStyle('fontStyle', readLive().italic ? 'normal' : 'italic'),
        toggleUnderline: () => applyTextStyle('underline', !readLive().underline),
        toggleStrike: () => applyTextStyle('linethrough', !readLive().strike),
        setFontSize: (n) => applyTextStyle('fontSize', Math.max(6, Math.min(200, Math.round(Number(n) || 16)))),
        setTextAlign: (a) => applyTextStyle('textAlign', ['left', 'center', 'right', 'justify'].includes(a) ? a : 'left'),
        setVerticalAlign: (v) => applyTextStyle('verticalAlign', ['top', 'middle', 'bottom'].includes(v) ? v : 'top'),
        setFontFamily: (f) => applyTextStyle('fontFamily', typeof f === 'string' && f.length > 0 && !f.includes(',') ? f : 'Arial'),
        setFontColor: (c) => {
          const hex = typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#000000';
          if (originalAnnotationRef.current) originalAnnotationRef.current.fill = hex;
          else originalAnnotationRef.current = { fill: hex };
          const cid = reactCalloutIdRef.current;
          const styleCb = onCalloutTextStyleChangeRef.current;
          if (cid && typeof styleCb === 'function') styleCb(cid, { fontColor: hex });
          if (typeof editingTextboxRef.current?.fire === 'function') editingTextboxRef.current.fire('changed');
          publishRichTextEditor();
        },
      };
    }
    cb({ api: richTextApiRef.current, state: readRichTextState(obj) });
  }, [fabricRef, readRichTextState]);

  useEffect(() => () => {
    const cb = onRichTextEditorChangeRef.current;
    if (typeof cb === 'function') cb(null);
  }, []);

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
    // Non-uniform stretch for any edit so the container matches the
    // preview layer's preserveAspectRatio="none" behavior. Only kicks
    // in when the container aspect drifts from the page aspect; in the
    // usual uniform case, hScale === effectiveScale and nothing changes.
    const effectiveScaleYInit = pageHeight > 0 ? parentEl.offsetHeight / pageHeight : effectiveScale;
    const useNonUniformInit = Number.isFinite(effectiveScaleYInit)
      && Math.abs(effectiveScaleYInit - effectiveScale) > 0.0005;
    const hScale = useNonUniformInit ? effectiveScaleYInit : effectiveScale;

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
          top: (annTop - BBOX_PADDING) * hScale,
          width: (annWidth + BBOX_PADDING * 2) * effectiveScale,
          height: (annHeight + BBOX_PADDING * 2) * hScale,
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
    // UX: 2026-04-19 — the SVG preview layer stretches content with
    // preserveAspectRatio="none", so horizontal and vertical scale can
    // differ when the container's aspect ratio drifts from the PDF
    // page's. Apply the same per-axis stretch to the edit canvas so
    // the edit box matches the preview exactly for callouts AND plain
    // text annotations AND shapes. The guard below only engages when
    // there's an actual aspect mismatch, so the uniform case is a
    // no-op and falls through to setZoom unchanged.
    const effectiveScaleY = pageHeight > 0 ? parentEl.offsetHeight / pageHeight : effectiveScale;
    const isCalloutTextEdit = !!reactCalloutId;
    const useNonUniform = Number.isFinite(effectiveScaleY)
      && Math.abs(effectiveScaleY - effectiveScale) > 0.0005
      && !pageSpaceModeRef.current;

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
        // For callout text edits under non-uniform aspect, use the
        // vertical scale so the canvas height matches the preview.
        const hScale = useNonUniform ? effectiveScaleY : effectiveScale;
        canvasHeight = Math.floor((annHeight + BBOX_PADDING * 2) * hScale);
      }
    }

    // Container-aware sizing (CLAUDE.md rule)
    if (useNonUniform) {
      canvas.setViewportTransform([effectiveScale, 0, 0, effectiveScaleY, 0, 0]);
    } else {
      canvas.setZoom(pageSpaceModeRef.current ? 1 : effectiveScale);
    }
    canvas.setDimensions({ width: canvasWidth, height: canvasHeight });

    // UX diag (2026-04-19): log what we actually set so we can see
    // whether the non-uniform branch engaged and what the resulting
    // canvas dimensions + viewport transform ended up as. Paired with
    // the CalloutEditEntryDiag note from App.jsx — together they tell
    // us whether view and edit end up at the same screen size.
    if (isCalloutTextEdit) {
      try {
        const vpt = canvas.viewportTransform;
        console.log('[CalloutEditCanvasDiag]', {
          effectiveScale,
          effectiveScaleY,
          useNonUniform,
          canvasWidth,
          canvasHeight,
          parentOffset: { w: parentEl.offsetWidth, h: parentEl.offsetHeight },
          pageSize: { w: pageWidth, h: pageHeight },
          vpt: vpt ? vpt.slice() : null,
          zoom: canvas.getZoom(),
        });
      } catch (_e) {}
    }

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

      // Plan 15-04 Issue 2 — new-text creation mirrors existing-text edit:
      // Fabric glyphs + border paint transparent; the SVG creation preview
      // (driven from onLiveTextGrow bounds) is the visible truth. Prevents
      // the jarring Fabric→SVG swap on commit that made freshly-created text
      // visibly "pop" into SVG form. Intended final colors stash in
      // originalAnnotationRef so commitAndClose (lines 978-983) restores them
      // onto the persisted annotation.
      const intendedFill = strokeColor || '#007AFF';
      const intendedStroke = '#000000';

      // Plan 15-04 Issue 4 — visibleOuterW is what the user draws by drag.
      // Fabric's textObj.width stores the WRAP target (inner content width).
      // Shrink by 2*PAD so CSS + Fabric wrap at the same pixel boundary, and
      // shift the textbox inward by PAD so Fabric's caret lands at the first
      // inner column (which is where SVG renderText paints the glyph).
      const visibleOuterW = textBoxWidth || 160;
      const textObj = new fabric.Textbox('', {
        type: 'textbox',
        left: BBOX_PADDING + TEXT_PADDING,
        top: BBOX_PADDING + TEXT_PADDING,
        angle: 0,
        width: Math.max(8, visibleOuterW - 2 * TEXT_PADDING),
        fontSize: 16,
        fill: 'rgba(0,0,0,0)',
        fontFamily: DEFAULT_FONT_FAMILY,
        splitByGrapheme: true,
        fontWeight: 'normal',
        styles: {},
        charSpacing: 0,
        // Default 1px black border on brand-new textboxes created via edit
        // mode so they read as a distinct "text box" out of the box. Mirrors
        // FabricTextCanvas.jsx default. Future mini-toolbar will let users
        // toggle border / fill / font / alignment per textbox.
        // Plan 15-04 Issue 2 — stroke painted transparent during edit; the
        // SVG preview paints the real intendedStroke. Commit restores it.
        stroke: 'rgba(0,0,0,0)',
        strokeWidth: 1,
        strokeUniform: true,
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
      // Plan 15-04 Issue 2 — stash intended final colors for commitAndClose
      // fill/stroke restoration (lines 978-983). Existing-text path points
      // this at the pre-edit annotation; new-text has no pre-edit annotation
      // so we seed it with the intended final look instead.
      originalAnnotationRef.current = { fill: intendedFill, stroke: intendedStroke };
      newTextScaleRef.current = null;

      // Clear font cache + init dimensions (same as existing text path)
      fabric.util.clearFabricFontCache();
      textObj.initDimensions();
      textObj._clearCache();

      // Add to canvas WITHOUT rendering yet
      canvas.add(textObj);
      canvas.setActiveObject(textObj);

      // Resize canvas to fit (same as existing text path). actualW/H are the
      // inner Fabric dims; visible outer = inner + 2*TEXT_PADDING (Plan 15-04
      // Issue 4). Canvas must hold BBOX_PADDING + PAD + innerContent + PAD +
      // BBOX_PADDING, i.e. outer + 2*BBOX_PADDING.
      const actualW = textObj.width * (textObj.scaleX || 1);
      const actualH = textObj.calcTextHeight ? textObj.calcTextHeight() : textObj.height * (textObj.scaleY || 1);
      const outerW = actualW + 2 * TEXT_PADDING;
      const outerH = actualH + 2 * TEXT_PADDING;
      const neededW = Math.ceil((outerW + BBOX_PADDING * 2) * es);
      const neededH = Math.ceil((outerH + BBOX_PADDING * 2) * es);

      canvas.setDimensions({ width: neededW, height: neededH });

      // Render FIRST, then enter editing (same order as existing text path)
      canvas.renderAll();
      textObj.enterEditing();
      editingTextboxRef.current = textObj;
      publishRichTextEditor();

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
        // Plan 15-04 Issue 2 — new-text creation: the SVG creation preview
        // already paints the intended border (from intendedStroke), so the
        // CSS container outline is redundant and renders as a ghost second
        // box at slightly different dimensions due to CSS-px vs SVG-unit
        // rounding. Leave the container fully transparent and let SVG own
        // the border visual.
        c.style.outline = 'none';
        c.style.outlineOffset = '0';
        c.style.backgroundColor = 'transparent';
        // UX 2026-04-20: mix-blend-mode multiply forces the Fabric canvas to
        // composite per-pixel with whatever SVG is behind it. Without this,
        // Chromium treats a resized canvas element as an opaque backdrop in
        // some GPU paths, covering SVG lines that grew past the canvas's
        // original height. Multiply keeps transparent pixels transparent and
        // lets the blue cursor still show through (cursor × white = cursor).
        c.style.mixBlendMode = 'multiply';
        // Sync React state so future re-renders don't revert visibility
        setContainerStyle(prev => ({
          ...prev,
          width: neededW,
          height: neededH,
          visibility: 'visible',
          outline: 'none',
          outlineOffset: '0',
          backgroundColor: 'transparent',
          mixBlendMode: 'multiply',
        }));
        setIsLoading(false);
      });

      // Plan 15-04 Issue 2 — broadcast an initial bounds snapshot so the SVG
      // creation preview is visible immediately, before the first keystroke.
      // Mirrors the existing-text broadcast at ~line 1617 but runs pre-typing
      // so the empty outlined box shows the moment drag-to-create lands.
      if (onLiveTextGrow && bboxOriginRef.current) {
        // Plan 15-04 Issue 4 — broadcast OUTER visible dims (inner Fabric dims
        // + 2*TEXT_PADDING). Renderer treats liveBounds.width/height as the
        // border rect size; foreignObject re-insets by PAD inside that rect.
        const innerW = (textObj.width || 0) * (textObj.scaleX || 1);
        const innerH = textObj.calcTextHeight
          ? textObj.calcTextHeight()
          : textObj.height * (textObj.scaleY || 1);
        const outerW = innerW + 2 * TEXT_PADDING;
        const outerH = innerH + 2 * TEXT_PADDING;
        onLiveTextGrow({
          left: bboxOriginRef.current.left || 0,
          top: bboxOriginRef.current.top || 0,
          width: outerW,
          height: outerH,
          text: '',
          textLines: [],
          fontSize: textObj.fontSize,
          lineHeight: textObj.lineHeight,
          fontFamily: DEFAULT_FONT_FAMILY,
          fill: intendedFill,
          stroke: intendedStroke,
          strokeWidth: textObj.strokeWidth || 1,
          isCreating: true,
        });
      }

      // Auto-resize height as text wraps (same as existing text path)
      textObj.on('changed', () => {
        if (!mountedRef.current || !containerRef.current) return;
        editingTextboxRef.current = textObj;
        publishRichTextEditor();
        const h = (textObj.calcTextHeight() + BBOX_PADDING * 2) * es + 8;
        const newH = Math.max(Math.round(30 * es), Math.ceil(h));
        canvas.setDimensions({ height: newH });
        containerRef.current.style.height = newH + 'px';

        // Plan 15-04 Issue 2 — per-keystroke bounds broadcast so SVG creation
        // preview repaints live, same contract as existing-text (line 1617).
        // isCreating:true tells SVGAnnotationLayer to synthesize a preview
        // annotation from these bounds (no backing annotation exists yet).
        if (onLiveTextGrow && bboxOriginRef.current) {
          // Plan 15-04 Issue 4 — OUTER visible dims, see comment at initial
          // broadcast above.
          const innerW = (textObj.width || 0) * (textObj.scaleX || 1);
          const innerH = textObj.calcTextHeight
            ? textObj.calcTextHeight()
            : textObj.height * (textObj.scaleY || 1);
          const outerW = innerW + 2 * TEXT_PADDING;
          const outerH = innerH + 2 * TEXT_PADDING;
          const lines = Array.isArray(textObj._textLines)
            ? textObj._textLines.map(l => Array.isArray(l) ? l.join('') : String(l))
            : null;
          onLiveTextGrow({
            left: bboxOriginRef.current.left || 0,
            top: bboxOriginRef.current.top || 0,
            width: outerW,
            height: outerH,
            text: textObj.text || '',
            textLines: lines,
            fontSize: textObj.fontSize,
            lineHeight: textObj.lineHeight,
            fontFamily: DEFAULT_FONT_FAMILY,
            fill: intendedFill,
            stroke: intendedStroke,
            strokeWidth: textObj.strokeWidth || 1,
            isCreating: true,
          });
        }
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
          // Plan 15-04 Issue 4 — both plain text and callouts carry a
          // TEXT_PADDING gutter on the LEFT/RIGHT so view + edit share one
          // contract. 2026-04-19: callouts don't use a vertical gutter (the
          // SVG callout's foreignObject starts flush at the top of the
          // textbox and grows downward for descenders). Splitting the pad
          // into X/Y lets Fabric and SVG align pixel-for-pixel on both axes
          // (horizontal gutter matches; vertical anchor matches during edit).
          const padX = TEXT_PADDING;
          const padY = reactCalloutId ? 0 : TEXT_PADDING;
          const outerW = json.width || 160;
          const { styles: _s, left: _l, top: _t, angle: _a, ...rest } = json;
          textObj = new fabric.Textbox(json.text || '', {
            ...rest,
            type: 'textbox',
            left: BBOX_PADDING + padX,
            top: BBOX_PADDING + padY,
            angle: 0,
            width: Math.max(8, outerW - 2 * padX),
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
            // UX 2026-04-20 (revised): Fabric's glyphs paint transparent
            // during edit so the SVG renderer below is the single visible
            // source of truth in BOTH view and edit states. Canvas 2D and
            // DOM text rasterize differently on macOS (Canvas is slightly
            // bolder and tighter than CSS-smoothed DOM text), so when
            // Fabric's glyphs were visible during edit the user saw a
            // weight/spacing jump on edit entry/exit. SVG paints every
            // frame via the liveBounds broadcast below, so letters stay
            // visible under the caret without the paint mismatch. The
            // prior invisible-lines-past-imported-height problem that
            // forced this back to visible-Fabric was caused by a
            // percentage-height bug on the SVG foreignObject container —
            // fixed separately this session (the inner div now tracks the
            // live-growing bounds in explicit pixels).
            fill: 'rgba(0,0,0,0)',
            stroke: 'rgba(0,0,0,0)',
            strokeWidth: 0,
          });
        }

        // Clear font cache to ensure fresh character measurements
        fabric.util.clearFabricFontCache();
        textObj.initDimensions();
        textObj._clearCache();

        // Resize canvas to fit actual text BEFORE first render — prevents flash.
        // Height uses max(natural, stored) so a previously-resized-larger textbox
        // does not snap to tight-natural height the instant we re-enter edit mode.
        //
        // Plan 15-04 Issue 4 — actualW/H are Fabric's INNER dims. storedH is
        // OUTER; for compare we convert inner-natural to outer by +2*pad. Then
        // outer max() covers both the stored size and content growth, and
        // canvas = outer + 2*BBOX_PADDING.
        // 2026-04-19: callouts use padY=0 (no vertical gutter); plain text
        // uses padY=TEXT_PADDING. padX is TEXT_PADDING for both.
        const padX = TEXT_PADDING;
        const padY = reactCalloutId ? 0 : TEXT_PADDING;
        const actualW = textObj.width * (textObj.scaleX || 1);
        const naturalInnerH = textObj.calcTextHeight
          ? textObj.calcTextHeight()
          : textObj.height * (textObj.scaleY || 1);
        const storedOuterH = originalAnnotationRef.current?.height || 0;
        const outerW = actualW + 2 * padX;
        const outerH = Math.max(naturalInnerH + 2 * padY, storedOuterH);
        const es = canvas.getZoom();

        // UX 2026-04-19 — for callouts, vertically center the Fabric textbox
        // so the blinking cursor lines up with the SVG callout's
        // flex-centered text. Visible SVG box height = stored height +
        // descenderBuffer (fontSize * 0.35). The center offset is half the
        // spare room between the visible box and the current natural text
        // height. Plain text keeps Fabric at BBOX_PADDING + padY.
        let centerShiftY = 0;
        if (reactCalloutId) {
          const descenderBuffer = (textObj.fontSize || 12) * 0.35;
          const visibleBoxH = storedOuterH + descenderBuffer;
          centerShiftY = Math.max(0, (visibleBoxH - naturalInnerH) / 2);
          if (centerShiftY > 0) {
            textObj.set({ top: BBOX_PADDING + padY + centerShiftY });
          }
        }
        calloutCenterShiftYRef.current = centerShiftY;

        // Add to canvas WITHOUT rendering yet (renderOnAddRemove: false)
        canvas.add(textObj);
        canvas.setActiveObject(textObj);
        const neededW = Math.ceil((outerW + BBOX_PADDING * 2) * es);
        const neededH = Math.ceil((outerH + BBOX_PADDING * 2) * es);

        canvas.setDimensions({ width: neededW, height: neededH });

        // NOW render and enter editing — canvas is correctly sized
        canvas.renderAll();
        textObj.enterEditing();
        textObj.selectAll();
        editingTextboxRef.current = textObj;
        publishRichTextEditor();

        // Suppress native caret on Fabric's hidden textarea (Electron can flash it)
        if (textObj.hiddenTextarea) {
          textObj.hiddenTextarea.style.caretColor = 'transparent';
        }

        // UX diag 2026-04-19: comprehensive cursor-parity dump (see
        // dumpCursorParity at module scope). One entry at edit entry; more on
        // every keystroke via the 'changed' listener below.
        //
        // 2026-04-19 follow-up: the first pass returned svg=null because
        // callouts route through this branch (text-edit path) and the
        // annotation's id field often isn't in the serialized textbox. Prefer
        // the reactCalloutId prop first (callout edit), then the annotation id,
        // then fall back to page+index lookup against the page wrapper so
        // the visible element is found in every scenario.
        {
          const annData = annotationDataRef.current;
          const source = reactCalloutId ? 'callout' : 'text';
          const resolvedId = reactCalloutId || annData?.id || null;
          const findSvgDiv = () => {
            if (reactCalloutId) {
              const el = document.querySelector(
                `[data-callout-id="${reactCalloutId}"] [data-callout-part="text"] > div`
              );
              if (el) return el;
            }
            if (annData?.id) {
              const el = document.querySelector(
                `[data-annotation-id="${annData.id}"] foreignObject > div`
              );
              if (el) return el;
            }
            const pageWrapper = document.querySelector(
              `[data-syncfusion-page-number="${pageNumber}"]`
            ) || document;
            const byIndex = pageWrapper.querySelector(
              `[data-annotation-index="${annotationIndex}"] foreignObject > div`
            );
            return byIndex || null;
          };
          dumpCursorParity('enter', source, resolvedId, textObj, findSvgDiv(), canvas, containerRef.current);
          textObj.on('changed', () => {
            if (!mountedRef.current) return;
            editingTextboxRef.current = textObj;
            publishRichTextEditor();
            dumpCursorParity('keystroke', source, resolvedId, textObj, findSvgDiv(), canvas, containerRef.current);
          });
          textObj.on('selection:changed', () => {
            if (!mountedRef.current) return;
            editingTextboxRef.current = textObj;
            publishRichTextEditor();
            dumpCursorParity('selection', source, resolvedId, textObj, findSvgDiv(), canvas, containerRef.current);
          });
        }

        // Reveal via rAF: wait one frame for browser to finish compositing Fabric canvas layers
        requestAnimationFrame(() => {
          if (!mountedRef.current || !containerRef.current) return;
          const c = containerRef.current;
          c.style.width = neededW + 'px';
          c.style.height = neededH + 'px';
          c.style.visibility = 'visible';
          // Plan 15-04 Step 2 — No container outline during existing-text edit.
          // The SVG text box renders its own border underneath (if strokeWidth>0)
          // and is the visual truth. A Fabric-drawn outline here would paint at
          // a slightly offset position and produce the "two borders" effect.
          c.style.outline = 'none';
          c.style.outlineOffset = '0';
          c.style.backgroundColor = 'transparent';
          // UX 2026-04-20: Fabric canvas sits on top of the live SVG text
          // during edit. Even with a transparent Fabric fill/stroke the
          // canvas element is opaque to color-mixing on some GPU paths,
          // so the area beyond the imported height occluded the SVG
          // letters that the renderer had already grown into place.
          // Collapsing the canvas backdrop with mix-blend-mode 'multiply'
          // lets anything pure white (what the bare canvas is) dissolve
          // into the layer beneath, so the SVG text shows through
          // everywhere while the cursor (painted with a solid color via
          // renderCursor) still lands on the page.
          c.style.mixBlendMode = 'multiply';
          setContainerStyle(prev => ({
            ...prev,
            width: neededW,
            height: neededH,
            visibility: 'visible',
            outline: 'none',
            outlineOffset: '0',
            backgroundColor: 'transparent',
            mixBlendMode: 'multiply',
          }));
          setIsLoading(false);
        });

        // Auto-resize height as text wraps — width stays fixed for wrapping.
        // Per-keystroke: use max(natural, stored) so typing less than the stored
        // height does not shrink the visual box below what the user chose.
        textObj.on('changed', () => {
          if (!mountedRef.current || !containerRef.current) return;
          // Plan 15-04 Issue 4 — naturalH is INNER; storedOuterH is OUTER.
          // effectiveOuterH = max(innerGrowth + 2*padY, storedOuter). Canvas
          // height = effectiveOuterH + 2*BBOX_PADDING. Broadcast OUTER.
          // 2026-04-19: callouts use padY=0 so the vertical gutter doesn't
          // fight the SVG callout's flush top anchor during edit.
          const naturalInnerH = textObj.calcTextHeight();
          const storedOuterH2 = originalAnnotationRef.current?.height || 0;
          const effectiveOuterH = Math.max(naturalInnerH + 2 * padY, storedOuterH2);
          // UX: edit box must stay the same size on first keystroke as on
          // edit-enter — the sibling formula above (line ~1534) has no +8 buffer,
          // so adding one here made the box visibly jump on the first letter and
          // left the connector line anchored inside the (now-taller) outline.
          const h = (effectiveOuterH + BBOX_PADDING * 2) * es;
          const newH = Math.max(Math.round(30 * es), Math.ceil(h));
          canvas.setDimensions({ height: newH });
          containerRef.current.style.height = newH + 'px';
          // UX 2026-04-20: recompute the callout vertical-center shift on
          // every keystroke. The edit-entry pass set centerShiftY once
          // against the imported height, but as the user types past that
          // the stored-based visibleBoxH became smaller than natural
          // inner content, leaving Fabric's textbox pinned at a stale
          // center offset while the SVG view's flex-centered text reflowed
          // higher. The cursor, which follows Fabric, ended up ~1-2 px
          // below the letters per line and compounded on wrap. Recomputing
          // per keystroke keeps Fabric's top in lockstep with the SVG
          // centering math so the caret and glyphs stay fused.
          if (reactCalloutId) {
            const descenderBuffer = (textObj.fontSize || 12) * 0.35;
            const visibleBoxH = Math.max(storedOuterH2, naturalInnerH) + descenderBuffer;
            const nextShiftY = Math.max(0, (visibleBoxH - naturalInnerH) / 2);
            if (Math.abs((textObj.top || 0) - (BBOX_PADDING + padY + nextShiftY)) > 0.01) {
              textObj.set({ top: BBOX_PADDING + padY + nextShiftY });
              textObj.setCoords && textObj.setCoords();
            }
            calloutCenterShiftYRef.current = nextShiftY;
          }
          // UX: Phase 15 UAT-2 — broadcast live page-space bounds to App.jsx
          // so callout line1 retracts to the live textbox edge while typing.
          // bboxOriginRef.current holds the page-space origin the textbox was
          // loaded from; the textbox width is fixed for wrapping; height grows
          // via the same max(natural, stored) rule above.
          //
          // Plan 15-04 Step 3 — extend payload to carry the live text content
          // and Fabric's pre-wrapped line array (`_textLines`). The SVG renderer
          // consumes these to repaint per keystroke, so the user sees the typed
          // text grow inside the SVG box in real time (previously SVG showed
          // stale pre-edit text during edit because Fabric's text lived only in
          // Canvas 2D until commit).
          if (onLiveTextGrow && bboxOriginRef.current) {
            // Plan 15-04 Issue 4 — broadcast OUTER visible dims. Inner Fabric
            // width + 2*padX = outer border width seen by renderText.
            const innerW = (textObj.width || 0) * (textObj.scaleX || 1);
            const outerW = innerW + 2 * padX;
            const lines = Array.isArray(textObj._textLines)
              ? textObj._textLines.map(l => Array.isArray(l) ? l.join('') : String(l))
              : null;
            const bounds = {
              left: bboxOriginRef.current.left || 0,
              top: bboxOriginRef.current.top || 0,
              width: outerW,
              height: effectiveOuterH,
              text: textObj.text || '',
              textLines: lines,
              fontSize: textObj.fontSize,
              lineHeight: textObj.lineHeight,
              fontWeight: textObj.fontWeight,
              fontStyle: textObj.fontStyle,
              underline: !!textObj.underline,
              linethrough: !!textObj.linethrough,
              textAlign: textObj.textAlign,
              verticalAlign: textObj.verticalAlign || 'top',
              fontFamily: textObj.fontFamily,
              fill: (originalAnnotationRef.current && typeof originalAnnotationRef.current.fill === 'string'
                && originalAnnotationRef.current.fill !== 'rgba(0,0,0,0)')
                ? originalAnnotationRef.current.fill
                : '#1e293b',
            };
            onLiveTextGrow(bounds);
          }
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
      // work via the standard shape edit flow. Rotation in edit mode happens
      // via a SINGLE Fabric custom control at the nub tip (installed below),
      // mirroring the SVG selection-mode rotation handle.
      // [COUNTER WIP — DO NOT TOUCH] Counter edit-mode logic is mid-debug as
      // of 2026-04-14. Another session: leave the isCounter branch (including
      // the counterRotate custom Fabric control and the Fabric empty-click
      // useEffect above) alone. Coordinate via the user before touching.
      const isCounter = obj.data && obj.data.type === 'counter';
      const sizing = computeShapeHandleSizing(obj, effectiveScale, pageSpaceModeRef.current);
      obj.set({
        left: BBOX_PADDING,
        top: BBOX_PADDING,
        angle: 0,
        strokeWidth: isCounter ? (obj._realStrokeWidth || 1.5) : 0,
        selectable: true,
        evented: true,
        // Phase 13 EDIT-14: no transform handles in edit mode for ANY shape.
        // Edit mode is for content editing only (fill/stroke/text). To resize
        // or rotate, exit edit mode back to select mode. Figma-style separation.
        hasControls: false,
        hasBorders: false,
        padding: sizing.padding,
        cornerStyle: 'circle',
        cornerSize: sizing.cornerSize,
        cornerColor: '#ffffff',
        cornerStrokeColor: '#d1d1d1',
        transparentCorners: false,
        lockScalingX: isCounter ? true : obj.lockScalingX,
        lockScalingY: isCounter ? true : obj.lockScalingY,
        // lockRotation only blocks Fabric's built-in rotation action — our
        // custom counterRotate control has its own actionHandler and is
        // unaffected, so leaving lockRotation:true on counter is correct.
        lockRotation: isCounter ? true : obj.lockRotation,
        opacity: 0,
      });

      if (isCounter) {
        // UX (counter edit-mode rotate): install ONE custom Fabric control
        // at the nub tip — nothing else. Matches the SVG selection-mode
        // rotation handle (SVGAnnotationLayer.jsx ~654-748) so rect/circle
        // edit-mode parity holds: "handles in edit mode match handles in
        // select mode." The Fabric counter obj has opacity:0, so we dispatch
        // the new angle to the SVG layer via onLivePreview on every drag
        // tick to keep the visible rendering in sync.
        //
        // Positioning uses the same tipExtension formula as renderCounter
        // (svgAnnotationRenderers.jsx:540) and the SVG select-mode handle
        // (SVGAnnotationLayer.jsx:670) so the handle sits ON the visible
        // nubbin tip at all angles and radii.
        obj.controls = {
          counterRotate: new fabric.Control({
            cursorStyle: 'grab',
            actionName: 'counterRotate',
            positionHandler: (dim, finalMatrix, fabricObject) => {
              const r = fabricObject.radius || 14;
              const angleDeg = fabricObject.data?.pointerAngle ?? 225;
              const angleRad = (angleDeg * Math.PI) / 180;
              const tipExt = Math.max(5, r * 0.5);
              // UX: handle sits ON the visible nub tip. We bypass Fabric's
              // `finalMatrix` because it translates to the PADDED-bbox center
              // (left + (width+strokeWidth)/2 + controlsPadding), not the
              // geometric circle center. Diagnostic capture 2026-04-13 for a
              // counter at left/top=(32,32), r=10 showed Fabric calling
              // positionHandler twice per setCoords — first with translate
              // (42.75, 42.75) (off by strokeWidth/2), then (50.085, 50.085)
              // (off by strokeWidth/2 + padding≈7.335). Fabric uses the SECOND
              // value in oCoords, which put the handle ~3.5 px inside the
              // circle body. Computing from left+r directly sidesteps that
              // entire class of internal offset drift — the result is the
              // same regardless of which call path Fabric takes.
              const cx = (fabricObject.left || 0) + r;
              const cy = (fabricObject.top || 0) + r;
              const tipCanvasX = cx + Math.cos(angleRad) * (r + tipExt);
              const tipCanvasY = cy + Math.sin(angleRad) * (r + tipExt);
              const vpt = fabricObject.canvas?.viewportTransform;
              return fabric.util.transformPoint(
                new fabric.Point(tipCanvasX, tipCanvasY),
                vpt || [1, 0, 0, 1, 0, 0],
              );
            },
            actionHandler: (eventData, transformData) => {
              const target = transformData?.target;
              const canvasEl = target?.canvas;
              if (!target || !canvasEl) return false;
              // getPointer returns canvas-internal coords matching target.left/top
              const pointer = canvasEl.getPointer(eventData);
              const r = target.radius || 14;
              const cx = target.left + r;
              const cy = target.top + r;
              const newAngleDeg =
                (Math.atan2(pointer.y - cy, pointer.x - cx) * 180) / Math.PI;
              target.data = {
                ...(target.data || {}),
                pointerAngle: newAngleDeg,
              };
              target.setCoords();
              canvasEl.requestRenderAll();
              // Push the new angle to the SVG layer — the visible counter
              // lives there (this Fabric obj has opacity:0).
              if (onLivePreview && annotationIndex >= 0) {
                const updated = JSON.parse(
                  JSON.stringify(annotationsRef.current || { objects: [] }),
                );
                if (updated.objects[annotationIndex]) {
                  updated.objects[annotationIndex].data = {
                    ...(updated.objects[annotationIndex].data || {}),
                    pointerAngle: newAngleDeg,
                  };
                  onLivePreview(updated);
                }
              }
              return true;
            },
            render: (ctx, left, top) => {
              // UX: white-fill / #4a90e2-outline dot, fixed 7px screen radius
              // and a subtle drop-shadow. Matches the SVG selection-mode
              // rotation handle exactly (SVGAnnotationLayer.jsx:678-694).
              ctx.save();
              ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
              ctx.shadowBlur = 3;
              ctx.shadowOffsetY = 1;
              ctx.beginPath();
              ctx.arc(left, top, 7, 0, 2 * Math.PI);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
              ctx.shadowColor = 'transparent';
              ctx.shadowBlur = 0;
              ctx.shadowOffsetY = 0;
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = '#4a90e2';
              ctx.stroke();
              ctx.restore();
            },
          }),
        };
        obj.setCoords();
      }

      // Install damped corner circles + pill-shaped middle handles matching
      // SVGSelectionOverlay exactly. See installShapeHandleRenderers for details.
      // No-op for counter: its controls map only contains `counterRotate`, and
      // installShapeHandleRenderers iterates over tl/tr/bl/br/mt/mb/ml/mr only.
      installShapeHandleRenderers(obj);

      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.renderAll();

      canvas.on('object:moving', (e) => {
        if (!editDiagGestureRef.current) {
          const annData = annotationDataRef.current;
          editDiagGestureRef.current = beginAnnotationGesture({
            surface: 'FabricEditCanvas',
            tool: editTypeRef.current,
            type: annData?.data?.type || annData?.type || editTypeRef.current,
            action: 'bbox-move',
            annotationId: reactCalloutId || annData?.id || annData?.data?.id || annotationIndex,
            pointerDown: true,
          });
        }
        markAnnotationPreviewFrame(editDiagGestureRef.current, {
          action: 'bbox-move',
        });
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
        if (!editDiagGestureRef.current) {
          const annData = annotationDataRef.current;
          editDiagGestureRef.current = beginAnnotationGesture({
            surface: 'FabricEditCanvas',
            tool: editTypeRef.current,
            type: annData?.data?.type || annData?.type || editTypeRef.current,
            action: 'bbox-resize',
            annotationId: reactCalloutId || annData?.id || annData?.data?.id || annotationIndex,
            pointerDown: true,
          });
        }
        markAnnotationPreviewFrame(editDiagGestureRef.current, {
          action: 'bbox-resize',
        });
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

      canvas.on('object:modified', (e) => {
        markAnnotationPointerRelease(editDiagGestureRef.current, {
          action: scaleStartRef.current ? 'bbox-resize' : 'bbox-move',
        });
        editDiagGestureRef.current = null;
        // Phase 29 — Echo-loop belt (Pitfall 8 from 29-RESEARCH.md).
        // Bridge sets applyingRemote=true synchronously before applying remote
        // Y.Doc updates. If we are mid-apply, this object:modified was triggered
        // by Fabric.js's internal handling of obj.set() (Fabric 5.5.2 occasionally
        // fires object:modified during programmatic .set() on shapes with the
        // CLAUDE.md uniform-stroke invariant set). Short-circuit here so we do
        // not echo the remote update back to Y.
        if (isApplyingRemote()) return;

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

        // Phase 29 — Bridge write path. CRDT layer is the source of truth when
        // enabled. When disabled (kill switch via localStorage CRDT_LAYER_DISABLED
        // or VITE_CRDT_LAYER_DISABLED) the rest of the existing edit-canvas
        // commit path (commitAndClose / onEditCommit) remains unchanged — the
        // legacy React-state pipeline carries on as it did pre-Phase-29.
        //
        // UX rationale: this handler only runs on shape edits (move / scale /
        // rotate / property change). Final commit on edit-mode exit happens
        // through commitAndClose() which still calls onEditCommitRef.current.
        // The bridge call here streams interim shape updates into Y.Doc so
        // remote clients see live changes during editing.
        const target = e?.target;
        if (crdtEnabled && ydoc && target && target.__dragCancelled !== true) {
          const annoIdForCommit = target?.data?.id ?? target?.data?.annoId;
          if (annoIdForCommit && undoCtx) {
            const originPayload = getLocalFabricOrigin(undoCtx);
            applyFabricCommit(
              ydoc,
              ydoc.getMap('annotations'),
              target,
              originPayload,
              undoCtx,
            );
          }
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
        if (objData.annotationId) obj.annotationId = objData.annotationId;
        if (objData.needsEntity) obj.needsEntity = objData.needsEntity;
        if (objData.data) obj.data = objData.data;
        if (objData.name) obj.name = objData.name;
        if (objData.isPdfImported) obj.isPdfImported = objData.isPdfImported;
        if (objData.pdfAnnotationId) obj.pdfAnnotationId = objData.pdfAnnotationId;
        if (objData.pdfAnnotationType) obj.pdfAnnotationType = objData.pdfAnnotationType;
        if (objData.globalCompositeOperation) {
          obj.set({ globalCompositeOperation: objData.globalCompositeOperation });
        }
        if (obj.annotationId || obj.needsEntity) {
          obj.set({ globalCompositeOperation: 'multiply' });
        }

        // Only the target annotation is interactive
        if (index === annotationIndex) {
          obj.set({
            selectable: true,
            evented: true,
            // Phase 13 EDIT-14: no transform handles in edit mode (full-page
            // callout path). Matches the shape-edit path above — edit mode is
            // content editing only, transforms happen in select mode.
            hasControls: false,
            hasBorders: false,
          });
          // Plan 15-04 Step 2 — Callout's textbox child uses the same transparent
          // glyph/stroke trick as plain text edit. The SVG callout renders
          // underneath as the visible truth. Caret still paints via the
          // renderCursor override. Original fill/stroke are restored in
          // commitAndClose before persisting.
          const objTypeLc = String(obj.type || '').toLowerCase();
          if (objTypeLc === 'textbox' || objTypeLc === 'i-text' || objTypeLc === 'text') {
            // UX 2026-04-20 (revised): Fabric's letters paint transparent
            // during callout edit so the SVG callout renderer is the
            // single visible source of truth in both view and edit. Canvas
            // 2D and SVG foreignObject DOM text rasterize differently on
            // macOS, so showing Fabric's glyphs made the user see a
            // weight/spacing jump on edit entry/exit. SVG paints live via
            // liveCalloutEditBounds so letters stay visible as the user
            // types. The invisible-lines-past-imported-height issue that
            // forced this back to visible-Fabric was caused by a
            // percentage-height bug on the foreignObject container; that
            // bug was fixed separately this session.
            obj.set({
              fill: 'rgba(0,0,0,0)',
              stroke: 'rgba(0,0,0,0)',
              strokeWidth: 0,
            });
          }
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

      // UX diag 2026-04-19: comprehensive cursor-parity dump — callout side.
      // Paired with the text-side dumpCursorParity entries so the two sources
      // can be diffed field-by-field in the saved console log.
      {
        const textChild =
          (enlivenedObjects || []).find((o) => {
            const t = String(o?.type || '').toLowerCase();
            return t === 'textbox' || t === 'i-text' || t === 'text';
          }) || null;
        const findSvg = () => reactCalloutId
          ? document.querySelector(`[data-callout-id="${reactCalloutId}"] [data-callout-part="text"] > div`)
          : null;
        dumpCursorParity('enter', 'callout', reactCalloutId || null, textChild, findSvg(), canvas, containerRef.current);
        if (textChild) {
          // UX 2026-04-20 (revised): broadcast live textbox bounds on every
          // keystroke so the SVG callout renderer (which is now the single
          // visible source of truth during edit) can grow the box and
          // repaint the typed text in real time. Payload matches
          // renderCallout's liveBounds contract (page-space left/top/width/
          // height/text). Without this, the SVG callout would freeze on the
          // pre-edit text while Fabric's cursor blinks over transparent
          // glyphs.
          const broadcastCalloutBounds = () => {
            if (!onLiveTextGrow) return;
            const innerW = (textChild.width || 0) * (textChild.scaleX || 1);
            const innerH = textChild.calcTextHeight
              ? textChild.calcTextHeight()
              : (textChild.height || 0) * (textChild.scaleY || 1);
            onLiveTextGrow({
              left: textChild.left || 0,
              top: textChild.top || 0,
              width: innerW,
              height: innerH,
              text: textChild.text || '',
              textLines: Array.isArray(textChild._textLines)
                ? textChild._textLines.map(l => Array.isArray(l) ? l.join('') : String(l))
                : null,
              fontSize: textChild.fontSize,
              lineHeight: textChild.lineHeight,
            });
          };
          broadcastCalloutBounds();
          editingTextboxRef.current = textChild;
          publishRichTextEditor();
          textChild.on('changed', () => {
            if (!mountedRef.current) return;
            editingTextboxRef.current = textChild;
            publishRichTextEditor();
            dumpCursorParity('keystroke', 'callout', reactCalloutId || null, textChild, findSvg(), canvas, containerRef.current);
            broadcastCalloutBounds();
          });
          textChild.on('selection:changed', () => {
            if (!mountedRef.current) return;
            editingTextboxRef.current = textChild;
            publishRichTextEditor();
            dumpCursorParity('selection', 'callout', reactCalloutId || null, textChild, findSvg(), canvas, containerRef.current);
          });
        }
      }

      setIsLoading(false);
    });
  }, [annotationIndex, reactCalloutId]);

  // -------------------------------------------------------------------------
  // Sync refs to avoid stale closures
  // -------------------------------------------------------------------------
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { onEditCommitRef.current = onEditCommit; }, [onEditCommit]);
  useEffect(() => { onEditCancelRef.current = onEditCancel; }, [onEditCancel]);
  useEffect(() => { editTypeRef.current = editType; }, [editType]);
  useEffect(() => { annotationDataRef.current = annotationData; }, [annotationData]);

  // =========================================================================
  // Phase 29 Plan 29-05 — UI-SPEC contract handlers (narrow waiver, additive).
  // Section purpose: implement per-word undo boundary, mid-drag Cmd+Z cancel,
  // identity-contract registry lifecycle, awareness publish, interaction-state
  // publish. Eraser-swipe transact bracketing is DEFERRED (FabricEraserCanvas
  // owns eraser exclusively per pre-flight grep at plan revision iteration 1).
  // =========================================================================

  // -------------------------------------------------------------------------
  // Phase 29 — Per-word undo boundary (UI-SPEC §"Cmd+Z in text annotation").
  // Yjs default captureTimeout=500ms collapses all keystrokes within 500ms
  // into a single undo step. CONTEXT.md decision: one Cmd+Z = back to last
  // whitespace, matching Word / Google Docs / Notion convention.
  //
  // Detection: text:changed fires after every keystroke during text edit. We
  // inspect the most recent character; if whitespace, call
  // undoManager.stopCapturing() to force the next captured op to start a fresh
  // stack-item. Graceful no-op when undoManager is null (Plan 29-04 hasn't
  // landed yet, or kill switch is active).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const onTextChanged = (e) => {
      const text = e?.target?.text;
      if (typeof text !== 'string' || text.length === 0) return;
      const lastChar = text[text.length - 1];
      // UX: tab and newline are also word boundaries — typing into a multi-line
      // text annotation should reset the capture window when the user moves to
      // the next line, same as a space.
      if (lastChar === ' ' || lastChar === '\t' || lastChar === '\n') {
        if (undoManager) {
          try { undoManager.stopCapturing(); } catch (_) { /* graceful */ }
        }
      }
    };
    canvas.on('text:changed', onTextChanged);
    return () => {
      canvas.off('text:changed', onTextChanged);
    };
  }, [undoManager, isLoading]);

  // -------------------------------------------------------------------------
  // Phase 29 — Mid-drag Cmd+Z cancellation (UI-SPEC §"Cmd+Z mid-drag").
  // CONTEXT.md decision: drag cancels, shape snaps back to drag-start, Cmd+Z
  // otherwise ignored (does NOT propagate to App.jsx's handleUndoRedoKey).
  // Contract: bridge.applyFabricCommit no-ops when fabricObject.__dragCancelled
  // is true (Plan 29-02 verified by midDragCancel.test.mjs); the object:modified
  // handler above also short-circuits on the same flag for redundancy.
  // -------------------------------------------------------------------------
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef(null);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const onMouseDown = () => {
      const obj = canvas.getActiveObject();
      if (!obj) return;
      isDraggingRef.current = true;
      // Snapshot drag-start position so the keydown handler can snap back.
      dragStartPosRef.current = { obj, left: obj.left, top: obj.top };
      // Reset cancel flag — a fresh drag starts a fresh commit window.
      obj.__dragCancelled = false;
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      dragStartPosRef.current = null;
    };
    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:up', onMouseUp);
    return () => {
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:up', onMouseUp);
    };
  }, [isLoading]);

  useEffect(() => {
    const onKey = (e) => {
      // UX: Cmd+Z (Mac) or Ctrl+Z (Win/Linux) without Shift = undo target.
      // Cmd+Shift+Z is redo; we deliberately leave that alone — redoing a
      // mid-drag would be a noop anyway because the drag never produced a
      // committed Y.Doc op.
      const isUndoKey = (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
      if (!isUndoKey) return;
      if (!isDraggingRef.current) return;
      // Mid-drag: cancel + swallow.
      const snapshot = dragStartPosRef.current;
      if (snapshot?.obj) {
        // Set the cancel flag BEFORE moving so any object:modified that fires
        // during the snap-back set() short-circuits in the bridge.
        snapshot.obj.__dragCancelled = true;
        snapshot.obj.set({ left: snapshot.left, top: snapshot.top });
        if (typeof snapshot.obj.setCoords === 'function') {
          snapshot.obj.setCoords();
        }
        if (snapshot.obj.canvas && typeof snapshot.obj.canvas.requestRenderAll === 'function') {
          snapshot.obj.canvas.requestRenderAll();
        }
      }
      // Use capture phase + stopPropagation/preventDefault so App.jsx's
      // handleUndoRedoKey listener (registered at the same window event but
      // in non-capture phase or otherwise after this) does NOT also fire its
      // handleUndo for this keystroke.
      e.stopPropagation();
      e.preventDefault();
    };
    // capture=true: run BEFORE App.jsx's keydown listener.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // -------------------------------------------------------------------------
  // Phase 29 — Identity-contract registry (Pitfall 6 mitigation; Warning 3
  // resolution from plan revision iteration 1).
  //
  // CONTEXT.md line 96: "Per-mount registry: Map<annoId, FabricObject> populated
  // when the edit canvas mounts, cleared when it unmounts."
  //
  // Why FEC owns this: the edit canvas mount/unmount IS the natural binding for
  // this resource. Downstream consumers (bridge.applyYUpdateToFabric per
  // Plan 29-02) accept a registry parameter; FEC passes its own
  // registryRef.current via wiring landed by Plan 29-04 / 29-06.
  //
  // Why useRef (not useState): Map mutation should not trigger re-render. The
  // Map IS the side-effecting state; readers consume it imperatively.
  // -------------------------------------------------------------------------
  const registryRef = useRef(new Map());

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onObjectAdded = (e) => {
      const obj = e?.target ?? e;
      const annoId = obj?.data?.id ?? obj?.data?.annoId;
      if (!annoId) return;
      registryRef.current.set(annoId, obj);
    };

    const onObjectRemoved = (e) => {
      const obj = e?.target ?? e;
      const annoId = obj?.data?.id ?? obj?.data?.annoId;
      if (!annoId) return;
      registryRef.current.delete(annoId);
    };

    // Pre-populate from any objects already on the canvas at mount — covers
    // the case where load*Annotation has already enlivened objects before the
    // first run of this effect.
    canvas.getObjects().forEach((obj) => {
      const annoId = obj?.data?.id ?? obj?.data?.annoId;
      if (annoId) registryRef.current.set(annoId, obj);
    });

    canvas.on('object:added', onObjectAdded);
    canvas.on('object:removed', onObjectRemoved);

    return () => {
      canvas.off('object:added', onObjectAdded);
      canvas.off('object:removed', onObjectRemoved);
      // CRITICAL — clear ALL entries on unmount (CONTEXT.md line 96).
      // The Map instance survives unmount because the ref persists, but its
      // entries MUST be dropped so the next FEC mount starts clean.
      registryRef.current.clear();
    };
  }, [isLoading]);

  // -------------------------------------------------------------------------
  // Phase 29 — Awareness publish (Info 3 resolution).
  // Plan 29-06's CollaboratorOutlineOverlay reads remote users'
  // editingAnnotationId via useRemoteEditors. The local user must publish their
  // own editingAnnotationId for OTHER clients' overlays to render.
  //
  // Awareness reference: prefer ydoc.awareness (transport provider attaches it)
  // or globalThis.__crdtAwareness (fallback path documented in 29-06's
  // useRemoteEditors). Graceful no-op when awareness is unavailable.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const editAnnoId = annotationData?.data?.id ?? annotationData?.data?.annoId ?? null;
    const awareness = (ydoc && ydoc.awareness)
      || (typeof globalThis !== 'undefined' ? globalThis.__crdtAwareness : null)
      || null;
    if (!awareness || typeof awareness.setLocalStateField !== 'function') return;
    if (editAnnoId) {
      try { awareness.setLocalStateField('editingAnnotationId', editAnnoId); } catch (_) { /* graceful */ }
    }
    return () => {
      try { awareness.setLocalStateField('editingAnnotationId', null); } catch (_) { /* graceful */ }
    };
  }, [ydoc, annotationData]);

  // -------------------------------------------------------------------------
  // Phase 29 — Interaction-state publish (Info 3 resolution).
  // Plan 29-06's YDocProvider Y.Map.observe handler reads
  // window.__phase29InteractionState to decide whether to enqueue a
  // remote-delete toast for the local user.
  //
  // We update the global on Fabric event lifecycle: selection / drag / scale /
  // edit-canvas mount. contextMenuId is NOT updated here because the right-click
  // context menu lives at the App.jsx / ContextMenu component layer (out of FEC
  // scope). Plan 29-06 owns the context-menu publisher.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (typeof window === 'undefined') return;

    // Initialize if absent — first FEC mount in this tab seeds the shape.
    if (!window.__phase29InteractionState) {
      window.__phase29InteractionState = {
        selectedId: null,
        draggingId: null,
        scalingId: null,
        editCanvasId: null,
        contextMenuId: null,
      };
    }

    const state = window.__phase29InteractionState;

    const readAnnoId = (obj) => obj?.data?.id ?? obj?.data?.annoId ?? null;

    const onSelectionCreated = (e) => {
      const obj = (Array.isArray(e?.selected) ? e.selected[0] : null) ?? e?.target ?? null;
      state.selectedId = readAnnoId(obj);
    };
    const onSelectionUpdated = onSelectionCreated;
    const onSelectionCleared = () => { state.selectedId = null; };

    const onMouseDownInteract = (e) => {
      const obj = e?.target;
      const annoId = readAnnoId(obj);
      const action = e?.transform?.action;
      if (action === 'scale' || action === 'scaleX' || action === 'scaleY') {
        state.scalingId = annoId;
      } else {
        state.draggingId = annoId;
      }
    };
    const onMouseUpInteract = () => {
      state.draggingId = null;
      state.scalingId = null;
    };

    canvas.on('selection:created', onSelectionCreated);
    canvas.on('selection:updated', onSelectionUpdated);
    canvas.on('selection:cleared', onSelectionCleared);
    canvas.on('mouse:down', onMouseDownInteract);
    canvas.on('mouse:up', onMouseUpInteract);

    // Mark editCanvasId for the duration FEC is mounted with a target.
    state.editCanvasId = annotationData?.data?.id ?? annotationData?.data?.annoId ?? null;

    return () => {
      canvas.off('selection:created', onSelectionCreated);
      canvas.off('selection:updated', onSelectionUpdated);
      canvas.off('selection:cleared', onSelectionCleared);
      canvas.off('mouse:down', onMouseDownInteract);
      canvas.off('mouse:up', onMouseUpInteract);
      // Clear FEC-owned interaction state on unmount. Direct global write keeps
      // the public surface explicit for any debugger snapshot at unmount time.
      if (window.__phase29InteractionState) {
        window.__phase29InteractionState.editCanvasId = null;
        window.__phase29InteractionState.selectedId = null;
        window.__phase29InteractionState.draggingId = null;
        window.__phase29InteractionState.scalingId = null;
      }
    };
  }, [annotationData, isLoading]);

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

      const richTextToolbar = document.querySelector('[data-rich-text-toolbar]');
      if (richTextToolbar
        && (richTextToolbar.contains(e.target)
          || isPointInRect(e.clientX, e.clientY, richTextToolbar))) {
        return;
      }

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
  // Fabric empty-area click → commit + close   [COUNTER WIP — DO NOT TOUCH]
  //
  // UX: the FabricEditCanvas container has BBOX_PADDING=32 px of empty space
  // around the shape. A click that lands in that ring is INSIDE the container
  // rect (so the document-level click-outside handler above ignores it), but
  // Fabric's own default behavior discards the active object — so the user
  // sees the handle vanish but the mini-toolbar stays, requiring a second
  // click to fully dismiss. This matters most for tiny shapes like the
  // counter (~20 px diameter inside an 84 px container) where the dead zone
  // is proportionally huge.
  //
  // Fix: when Fabric reports `mouse:down` with no target (click on empty
  // canvas area, i.e. the padding ring), treat it as a dismissal the same
  // way a click outside the container would. One click, one dismissal.
  //
  // Text-edit is excluded because it has its own flow: `text:editing:exited`
  // handles commit after a 50 ms debounce.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (editType === 'text') return;

    const handleFabricEmptyClick = (opt) => {
      if (committedRef.current) return;
      if (opt?.target) return; // clicked on an object or a handle — let Fabric handle it
      commitAndClose();
    };

    const timer = setTimeout(() => {
      canvas.on('mouse:down', handleFabricEmptyClick);
    }, 100);

    return () => {
      clearTimeout(timer);
      canvas.off('mouse:down', handleFabricEmptyClick);
    };
  }, [commitAndClose, editType]);

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
        const effectiveScaleY = pageHeight > 0 ? parentEl.offsetHeight / pageHeight : effectiveScale;
        const isCalloutTextEditSettle = !!reactCalloutId;
        const useNonUniformSettle = Number.isFinite(effectiveScaleY)
          && Math.abs(effectiveScaleY - effectiveScale) > 0.0005
          && !pageSpaceModeRef.current;

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
          const hScaleSettle = useNonUniformSettle ? effectiveScaleY : effectiveScale;
          newHeight = Math.floor(bboxH * hScaleSettle);
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
              const hScaleSettle2 = useNonUniformSettle ? effectiveScaleY : effectiveScale;
              containerEl.style.left = ((annLeft - BBOX_PADDING) * effectiveScale) + 'px';
              containerEl.style.top = ((annTop - BBOX_PADDING) * hScaleSettle2) + 'px';
              containerEl.style.width = ((annWidth2 + BBOX_PADDING * 2) * effectiveScale) + 'px';
              containerEl.style.height = ((annHeight2 + BBOX_PADDING * 2) * hScaleSettle2) + 'px';
              // Keep the inset outline aligned with SVG rect position when zoom changes
              if (editTypeRef.current === 'text') {
                containerEl.style.outlineOffset = `-${BBOX_PADDING * effectiveScale}px`;
              }
            }
          }
        }

        if (useNonUniformSettle) {
          canvas.setViewportTransform([effectiveScale, 0, 0, effectiveScaleY, 0, 0]);
        } else {
          canvas.setZoom(effectiveScale);
        }
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
                outline: `1px solid ${outlineColor}`,
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
  // Counter resize — called from MiniToolbar when the user clicks +/- on a
  // counter in edit mode. Must keep the visual center fixed in PAGE space and
  // update bboxOriginRef so the eventual commit (which reads bboxOriginRef) writes
  // the recentered position to the JSON. Doing the recenter inside MiniToolbar
  // would only touch canvas-local coords (BBOX_PADDING) and break the commit path.
  // -------------------------------------------------------------------------
  const handleCounterResize = useCallback((newRadius) => {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj || !obj.data || obj.data.type !== 'counter') return;
    if (!bboxOriginRef.current) return;
    const oldRadius = obj.radius || 14;
    const radiusDelta = newRadius - oldRadius;
    if (radiusDelta === 0) return;

    // Shift bboxOriginRef so the visual center stays put: top-left moves up-left
    // by exactly the radius delta in page-space.
    bboxOriginRef.current.left -= radiusDelta;
    bboxOriginRef.current.top -= radiusDelta;

    // Update Fabric obj radius — left/top stay at BBOX_PADDING in canvas-local
    // coords; the commit path computes the page-space position from bboxOriginRef.
    obj.set('radius', newRadius);
    canvas.renderAll();

    // Mirror new radius + position into annotationDataRef so any read path that
    // sources from the original annotation (e.g. cancel-and-restore) sees fresh
    // values.
    if (annotationDataRef.current) {
      annotationDataRef.current = {
        ...annotationDataRef.current,
        radius: newRadius,
        left: bboxOriginRef.current.left,
        top: bboxOriginRef.current.top,
      };
    }

    // Move the edit container CSS so the (invisible) Fabric canvas tracks the new
    // page-space top-left. Otherwise the next move/scale read would compute deltas
    // from the OLD container position and the counter would jump.
    const containerEl = containerRef.current;
    const parentEl = containerEl?.parentElement;
    if (containerEl && parentEl && pageWidth > 0) {
      const effectiveScale = parentEl.offsetWidth / pageWidth;
      containerEl.style.left = ((bboxOriginRef.current.left - BBOX_PADDING) * effectiveScale) + 'px';
      containerEl.style.top = ((bboxOriginRef.current.top - BBOX_PADDING) * effectiveScale) + 'px';
    }

    // Push a live preview to the SVG layer with the recentered radius + position.
    if (onLivePreview && annotationIndex >= 0) {
      const updated = JSON.parse(JSON.stringify(annotationsRef.current || { objects: [] }));
      if (updated.objects[annotationIndex]) {
        updated.objects[annotationIndex].radius = newRadius;
        updated.objects[annotationIndex].left = bboxOriginRef.current.left;
        updated.objects[annotationIndex].top = bboxOriginRef.current.top;
        onLivePreview(updated);
      }
    }
  }, [onLivePreview, annotationIndex, pageWidth]);

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
          onCounterResize={handleCounterResize}
          onGroupUpdate={onGroupUpdate}
          counterGroupSize={counterGroupSize}
          annotationData={annotationData}
          onPropertyChange={(prop, value, extras) => {
            if (!onLivePreview || annotationIndex < 0) return;
            const current = annotationsRef.current;
            const updated = JSON.parse(JSON.stringify(current || { objects: [] }));
            if (updated.objects[annotationIndex]) {
              updated.objects[annotationIndex][prop] = value;
              // `extras` lets MiniToolbar push multiple linked fields atomically
              // (e.g. counter radius + recentred left/top) so the SVG live-preview
              // sees one consistent write per click instead of three races.
              if (extras && typeof extras === 'object') {
                Object.assign(updated.objects[annotationIndex], extras);
              }
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
