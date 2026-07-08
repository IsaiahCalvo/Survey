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
