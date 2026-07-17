import * as Fabric from 'fabric';

function isPointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i]?.x);
    const yi = Number(polygon[i]?.y);
    const xj = Number(polygon[j]?.x);
    const yj = Number(polygon[j]?.y);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function clearFabricFontCache(fontFamily) {
  try {
    if (fontFamily) {
      Fabric.cache?.charWidthsCache?.delete?.(String(fontFamily).toLowerCase());
    } else {
      Fabric.cache?.charWidthsCache?.clear?.();
    }
  } catch {
    // Best-effort cache reset for cross-version compatibility.
  }
}

const enlivenObjects = (objects, callbackOrOptions, maybeOptions) => {
  if (typeof callbackOrOptions === 'function') {
    const promise = Fabric.util.enlivenObjects(objects, maybeOptions);
    promise.then(callbackOrOptions);
    return promise;
  }
  return Fabric.util.enlivenObjects(objects, callbackOrOptions);
};

// Fabric v6+ removed StaticCanvas#setWidth / #setHeight (v5 sugar around
// setDimensions). The canvas sizing paths (FabricDrawingCanvas, FabricEraserCanvas,
// FabricEditCanvas, PageAnnotationLayer) still call them, and under fabric 7.x the
// missing methods crashed the whole viewer the moment a drawing tool mounted
// ("canvas.setWidth is not a function" → ErrorBoundary). Restore them as thin
// aliases with v5 semantics. Canvas extends StaticCanvas, so patching the base
// prototype covers both.
const StaticCanvasClass = Fabric.StaticCanvas;
if (StaticCanvasClass?.prototype && typeof StaticCanvasClass.prototype.setWidth !== 'function') {
  StaticCanvasClass.prototype.setWidth = function setWidth(value, options) {
    return this.setDimensions({ width: value }, options);
  };
}
if (StaticCanvasClass?.prototype && typeof StaticCanvasClass.prototype.setHeight !== 'function') {
  StaticCanvasClass.prototype.setHeight = function setHeight(value, options) {
    return this.setDimensions({ height: value }, options);
  };
}
// Fabric v6+ also renamed Canvas#getPointer: getPointer(e) → getScenePoint(e),
// getPointer(e, true) → getViewportPoint(e). The shape/eraser/edit pointer paths
// (25 call sites) still use the v5 name; without this alias every shape tool and
// Survey Marker drag crashed with "canvas.getPointer is not a function".
const CanvasClass = Fabric.Canvas;
if (CanvasClass?.prototype
  && typeof CanvasClass.prototype.getPointer !== 'function'
  && typeof CanvasClass.prototype.getScenePoint === 'function') {
  CanvasClass.prototype.getPointer = function getPointer(e, ignoreZoom = false) {
    return ignoreZoom ? this.getViewportPoint(e) : this.getScenePoint(e);
  };
}
// Fix Fabric.js cursor overlap bug: cursor was centered on character boundary
// with `- cursorWidth / 2`, causing leftward drift at fractional zoom.
// Patch: place cursor at the right edge of the boundary instead of centering.
// Ref: fabric.js GitHub issues #5008, #6168, #4479
// fabric 7 SWAPPED the parameter order to renderCursor(ctx, boundaries)
// (fabric 5 was (boundaries, ctx)). Keeping the old order made `ctx` receive
// the boundaries object and threw "ctx.fillRect is not a function" on every
// caret paint after the 7.4.0 upgrade.
// Relocated here (2026-07-17) from the retired FabricEditCanvas.jsx so the
// legacy PageAnnotationLayer arm (?renderer=canvas / Ctrl+Shift+V), which
// edits text via fabric IText/Textbox, keeps the fix — this module is
// imported by every fabric consumer, so the patch applies at first import.
if (Fabric.IText?.prototype) {
  Fabric.IText.prototype.renderCursor = function (ctx, boundaries) {
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
    if (this.inCompositionMode) { this.renderSelection(ctx, boundaries); } // fabric 7 order
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
}
// Fabric v6+ removed StaticCanvas#setBackgroundColor(color, cb) — background is
// now a plain property (PageAnnotationLayer still calls the v5 method once).
if (StaticCanvasClass?.prototype && typeof StaticCanvasClass.prototype.setBackgroundColor !== 'function') {
  StaticCanvasClass.prototype.setBackgroundColor = function setBackgroundColor(color, callback) {
    this.backgroundColor = color;
    if (typeof callback === 'function') callback();
    return this;
  };
}

export const fabric = {
  ...Fabric,
  Object: Fabric.Object || Fabric.FabricObject,
  FabricObject: Fabric.FabricObject || Fabric.Object,
  Text: Fabric.Text || Fabric.FabricText,
  FabricText: Fabric.FabricText || Fabric.Text,
  Image: Fabric.Image || Fabric.FabricImage,
  FabricImage: Fabric.FabricImage || Fabric.Image,
  util: {
    ...Fabric.util,
    enlivenObjects,
    isPointInPolygon,
    clearFabricFontCache,
  },
};

export default fabric;
