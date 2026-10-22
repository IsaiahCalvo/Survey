/** Normalize an annotation size at every persisted/display boundary. */
export const COUNTER_SIZE_MIN = 4;
export const COUNTER_SIZE_MAX = 76;

// UX 2026-09-09: the line Width field keeps ONE decimal place. The Cloud
// border style's approved default is a 2.5-unit line (the revision-cloud
// studio's), and a whole-number field showed it as "3" and, on the next
// commit, drew and remembered 3. Counter Size and Eraser Size stay whole
// numbers (decimals = 0, the default).
export const ANNOTATION_WIDTH_DECIMALS = 1;

const decimalsOf = (decimals) => Math.max(0, Math.min(3, Math.round(Number(decimals) || 0)));

export const normalizeAnnotationSize = (value, min = 1, max = 100, decimals = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  const factor = 10 ** decimalsOf(decimals);
  const rounded = Math.round(parsed * factor) / factor;
  return Math.min(max, Math.max(min, rounded));
};

/**
 * Preserve an empty typing draft, accept at most three digits (plus, when the
 * field allows decimals, a decimal point and that many decimal digits), and
 * reject all sign/exponent characters instead of silently changing their
 * value.
 */
export const sanitizeAnnotationSizeDraft = (value, decimals = 0) => {
  const raw = String(value ?? '');
  const places = decimalsOf(decimals);
  const pattern = places > 0
    ? new RegExp(`^\\d{0,3}(\\.\\d{0,${places}})?$`)
    : /^\d{0,3}$/;
  return pattern.test(raw) ? raw : null;
};

/**
 * Scale a real annotation size into a compact preview without flattening large
 * presets into the same thickness. Square-root scaling preserves visible
 * differences while keeping the largest preview inside a menu row.
 */
export const getAnnotationSizePreviewThickness = (
  value,
  min = 1,
  max = 100,
  minPixels = 1,
  maxPixels = 22,
) => {
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 1;
  const safeMax = Math.max(safeMin, Number.isFinite(Number(max)) ? Number(max) : safeMin);
  const parsed = Number.isFinite(Number(value)) ? Number(value) : safeMin;
  const clamped = Math.min(safeMax, Math.max(safeMin, parsed));
  const lowerPixels = Math.max(1, Number(minPixels) || 1);
  const upperPixels = Math.max(lowerPixels, Number(maxPixels) || lowerPixels);

  if (safeMax === safeMin) return lowerPixels;

  const ratio = (Math.sqrt(clamped) - Math.sqrt(safeMin))
    / (Math.sqrt(safeMax) - Math.sqrt(safeMin));
  return Number((lowerPixels + ratio * (upperPixels - lowerPixels)).toFixed(2));
};

/**
 * The "settings before a pick" snapshot may only capture the bar while it
 * holds the armed tool's own remembered settings. A tool switch made while a
 * mark is still picked leaves the previous tool's values in the bar (the
 * per-tool load waits for the pick to end); snapshotting then would restore
 * them onto the new tool — a Counter armed right after drawing an arrow took
 * the arrow's 2 px width, clamped to a 4 px dot.
 */
export const canSnapshotToolSettings = (loadedTool, activeTool) => (
  loadedTool != null && loadedTool === activeTool
);

/**
 * The size card's slider (AnnotationSizeControl) runs on a square-root scale,
 * so the thin end - where most pens live - gets most of the track instead of
 * 1 to 5 pt sharing its first tenth. Positions run 0..1000.
 */
export const SIZE_SLIDER_STEPS = 1000;

export const sizeToSliderPosition = (value, min = 1, max = 100) => {
  const lo = Math.sqrt(Math.max(0, Number(min) || 0));
  const hi = Math.sqrt(Math.max(Number(min) || 0, Number(max) || 0));
  if (hi <= lo) return 0;
  const v = Math.min(Number(max), Math.max(Number(min), Number(value)));
  if (!Number.isFinite(v)) return 0;
  return Math.round(((Math.sqrt(v) - lo) / (hi - lo)) * SIZE_SLIDER_STEPS);
};

/** A slider position back to a size: halves below 10 when decimals are kept, whole numbers above. */
export const sliderPositionToSize = (position, min = 1, max = 100, decimals = 0) => {
  const lo = Math.sqrt(Math.max(0, Number(min) || 0));
  const hi = Math.sqrt(Math.max(Number(min) || 0, Number(max) || 0));
  const t = Math.min(1, Math.max(0, Number(position) / SIZE_SLIDER_STEPS || 0));
  const raw = (lo + t * (hi - lo)) ** 2;
  const step = decimals > 0 && raw < 10 ? 0.5 : 1;
  return normalizeAnnotationSize(Math.round(raw / step) * step, min, max, decimals);
};
