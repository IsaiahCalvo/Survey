const ABSOLUTE_MIN_SCALE = 0.01;
const ABSOLUTE_MAX_SCALE = 40;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_NOTCH_PX = 100;
// Keep equal travel chunk-independent within each input regime.
// Drawboard measured 74% -> 97% over twelve 8px Ctrl-wheel ticks.
const TRACKPAD_EXPONENT = 0.0029;
// A wheel event counts as a discrete mouse-wheel NOTCH when it reports a
// line/page delta mode, or a pixel delta of at least this much. Anything
// smaller is a trackpad pinch / Ctrl-wheel stream and keeps the gentle
// per-delta TRACKPAD_EXPONENT rate, so a pinch never turns twitchy.
const TRACKPAD_THRESHOLD_PX = 50;
/**
 * UX (2026-09-16): one detent of a real mouse wheel zooms by this factor.
 *
 * Reference behaviour — Drawboard PDF on the web moves x1.343 for one 120px
 * Ctrl-wheel notch, so a single flick of the wheel visibly resizes the page.
 * Survey used to step x1.1 per 100px notch (x1.121 for the 120px notch Chrome
 * reports), which needed roughly three notches to cover one Drawboard notch and
 * made mouse zoom feel stuck. 1.3 per notch matches Drawboard's felt rate.
 *
 * This is the NOTCH rate ONLY. A trackpad pinch / Ctrl-wheel stream keeps
 * TRACKPAD_EXPONENT untouched — a pinch is a continuous gesture and must not
 * get faster. Callers pass a large `maximumDelta` (the live viewer passes
 * 1000 = ten notches) so one notch is never clipped; the small default cap is
 * only a guard for callers that do not say what device they are on.
 */
export const WHEEL_NOTCH_STEP_FACTOR = 1.3;
const WHEEL_NOTCH_EXPONENT = Math.log(WHEEL_NOTCH_STEP_FACTOR) / WHEEL_NOTCH_PX;


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
  maximumDelta = WHEEL_NOTCH_PX,
  regime,
} = {}) {
  const safeCurrent = Number.isFinite(Number(currentScale)) && Number(currentScale) > 0
    ? Number(currentScale)
    : 1;
  const normalizedDelta = normalizeWheelDelta(deltaY, deltaMode, viewportHeight);
  const cappedDelta = Math.max(-maximumDelta, Math.min(maximumDelta, normalizedDelta));
  const resolvedRegime = regime ?? (deltaMode === 0 && Math.abs(normalizedDelta) < TRACKPAD_THRESHOLD_PX
    ? 'trackpad'
    : 'notch');
  const exponent = resolvedRegime === 'trackpad' ? TRACKPAD_EXPONENT : WHEEL_NOTCH_EXPONENT;
  const nextScale = safeCurrent * Math.exp(-cappedDelta * exponent);
  return Math.max(minimumScale, Math.min(maximumScale, nextScale));
}
