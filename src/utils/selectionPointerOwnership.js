export const isClientPointNearRect = (clientX, clientY, rect, padding = 0) => {
  if (!rect) return false;
  const x = Number(clientX);
  const y = Number(clientY);
  const inset = Math.max(0, Number(padding) || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= rect.left - inset
    && x <= rect.right + inset
    && y >= rect.top - inset
    && y <= rect.bottom + inset;
};
