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
