/** Normalize an annotation size at every persisted/display boundary. */
export const COUNTER_SIZE_MIN = 4;
export const COUNTER_SIZE_MAX = 76;

export const normalizeAnnotationSize = (value, min = 1, max = 100) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

/**
 * Preserve an empty typing draft, accept at most three digits, and reject all
 * decimal/sign/exponent characters instead of silently changing their value.
 */
export const sanitizeAnnotationSizeDraft = (value) => {
  const raw = String(value ?? '');
  return /^\d{0,3}$/.test(raw) ? raw : null;
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
