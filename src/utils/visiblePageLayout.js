/** Keep physical page indices while removing hidden Spaces pages from layout. */
export function buildVisiblePageStack({ pageSizes, visiblePageNumbers = null, rotation = 0, scale = 1, padTop = 0, gap = 0 }) {
  const visible = Array.isArray(visiblePageNumbers) ? new Set(visiblePageNumbers.map(Number)) : null;
  const sideways = rotation === 90 || rotation === 270;
  const dims = pageSizes.map((size, index) => {
    if (visible && !visible.has(index + 1)) return { w: 0, h: 0, hidden: true };
    return sideways ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
  });
  let height = padTop + gap * scale;
  let widestPt = 0;
  const tops = dims.map((dim) => {
    const top = height;
    if (!dim.hidden) {
      height += dim.h * scale + gap * scale;
      widestPt = Math.max(widestPt, dim.w);
    }
    return top;
  });
  return { dims, tops, height, widestPt };
}
