const ABSOLUTE_MIN_SCALE = 0.01;
const ABSOLUTE_MAX_SCALE = 40;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_NOTCH_PX = 100;
const WHEEL_FINE_DELTA_PX = 8;
const WHEEL_NOTCH_EXPONENT = Math.log(1.1) / WHEEL_NOTCH_PX;
// Measured against Drawboard's live viewer with repeated 8px Ctrl-wheel ticks:
// 74% -> 97% over 12 ticks, with the reverse path returning to 73% after
// display rounding. This keeps real trackpad movement at the same pace while
// retaining the existing symmetric exponential zoom and per-event safety cap.
const WHEEL_EXPONENT = 0.0029;

const getWheelZoomExponent = (delta) => {
  const magnitude = Math.abs(delta);
  if (magnitude <= WHEEL_FINE_DELTA_PX) return magnitude * WHEEL_EXPONENT;
  const fineExponent = WHEEL_FINE_DELTA_PX * WHEEL_EXPONENT;
  const notchExponent = WHEEL_NOTCH_PX * WHEEL_NOTCH_EXPONENT;
  const progress = (magnitude - WHEEL_FINE_DELTA_PX) / (WHEEL_NOTCH_PX - WHEEL_FINE_DELTA_PX);
  return fineExponent + (notchExponent - fineExponent) * progress;
};

export function getClampedZoomTranslation({
  zoomFactor,
  anchor,
  contentStart,
  contentEnd,
  viewportStart,
  viewportSize,
} = {}) {
  const factor = Number.isFinite(Number(zoomFactor)) ? Number(zoomFactor) : 1;
  const start = Number(contentStart) || 0;
  const end = Number(contentEnd) || start;
  const viewStart = Number(viewportStart) || 0;
  const viewSize = Math.max(0, Number(viewportSize) || 0);
  const cursorTranslation = (1 - factor) * (Number(anchor) || 0);
  const projectedSize = Math.max(0, end - start) * factor;

  if (projectedSize <= viewSize) {
    return viewStart + (viewSize / 2) - (factor * ((start + end) / 2));
  }

  const minimumTranslation = viewStart + viewSize - (factor * end);
  const maximumTranslation = viewStart - (factor * start);
  return Math.max(minimumTranslation, Math.min(maximumTranslation, cursorTranslation));
}

export function getDocumentMinimumScale({
  viewportHeight,
  pageHeights,
  pageGap,
  viewportWidth,
  pageWidths,
  fixedTopInset = 0,
  fixedBottomInset = 0,
  absoluteMinimumScale = ABSOLUTE_MIN_SCALE,
  maximumScale = ABSOLUTE_MAX_SCALE,
} = {}) {
  const heights = Array.isArray(pageHeights)
    ? pageHeights.map(Number).filter((height) => Number.isFinite(height) && height > 0)
    : [];
  if (heights.length === 0) return absoluteMinimumScale;

  const availableHeight = Math.max(
    0,
    (Number(viewportHeight) || 0) - (Number(fixedTopInset) || 0) - (Number(fixedBottomInset) || 0),
  );
  const safeGap = Math.max(0, Number(pageGap) || 0);
  const heightScale = availableHeight / (
    heights.reduce((sum, height) => sum + height, 0)
    + ((heights.length + 1) * safeGap)
  );
  const widths = Array.isArray(pageWidths)
    ? pageWidths.map(Number).filter((width) => Number.isFinite(width) && width > 0)
    : [];
  const availableWidth = Number(viewportWidth);
  const widthScale = widths.length > 0 && Number.isFinite(availableWidth) && availableWidth > 0
    ? availableWidth / Math.max(...widths)
    : Number.POSITIVE_INFINITY;
  const scale = Math.min(heightScale, widthScale);
  return Math.max(absoluteMinimumScale, Math.min(maximumScale, scale));
}

export function normalizeWheelDelta(deltaY, deltaMode = 0, viewportHeight = 800) {
  const rawDelta = Number(deltaY) || 0;
  if (deltaMode === 1) return rawDelta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === 2) return rawDelta * Math.max(1, Number(viewportHeight) || 800);
  return rawDelta;
}

export function getWheelZoomScale(currentScale, {
  deltaY = 0,
  deltaMode = 0,
  viewportHeight = 800,
  minimumScale = ABSOLUTE_MIN_SCALE,
  maximumScale = ABSOLUTE_MAX_SCALE,
} = {}) {
  const safeCurrent = Number.isFinite(Number(currentScale)) && Number(currentScale) > 0
    ? Number(currentScale)
    : 1;
  const normalizedDelta = normalizeWheelDelta(deltaY, deltaMode, viewportHeight);
  const cappedDelta = Math.max(-WHEEL_NOTCH_PX, Math.min(WHEEL_NOTCH_PX, normalizedDelta));
  const direction = Math.sign(cappedDelta);
  const nextScale = safeCurrent * Math.exp(-direction * getWheelZoomExponent(cappedDelta));
  return Math.max(minimumScale, Math.min(maximumScale, nextScale));
}
