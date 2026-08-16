/** Normalize an annotation size at every persisted/display boundary. */
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
