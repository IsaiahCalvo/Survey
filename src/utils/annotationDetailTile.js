const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizedRect = (rect) => {
  if (!rect) return null;
  const left = finiteNumber(rect.left);
  const top = finiteNumber(rect.top);
  const width = Math.max(0, finiteNumber(rect.width, finiteNumber(rect.right) - left));
  const height = Math.max(0, finiteNumber(rect.height, finiteNumber(rect.bottom) - top));
  return {
    left,
    top,
    right: Number.isFinite(Number(rect.right)) ? Number(rect.right) : left + width,
    bottom: Number.isFinite(Number(rect.bottom)) ? Number(rect.bottom) : top + height,
    width,
    height,
  };
};

const nearlyEqual = (a, b) => Math.abs(a - b) <= 0.001;

export function calculateAnnotationDetailTile({
  pageWidth,
  pageHeight,
  pageRect,
  viewportRect,
  devicePixelRatio = 1,
  previousTile = null,
  force = false,
  marginRatio = 0.65,
  edgeGuard = 2,
}) {
  const normalizedPageRect = normalizedRect(pageRect);
  const normalizedViewportRect = normalizedRect(viewportRect);
  const modelWidth = Math.max(1, finiteNumber(pageWidth, 1));
  const modelHeight = Math.max(1, finiteNumber(pageHeight, 1));
  if (
    !normalizedPageRect?.width
    || !normalizedPageRect?.height
    || !normalizedViewportRect?.width
    || !normalizedViewportRect?.height
  ) return null;

  const visibleLeft = Math.max(0, normalizedViewportRect.left - normalizedPageRect.left);
  const visibleTop = Math.max(0, normalizedViewportRect.top - normalizedPageRect.top);
  const visibleRight = Math.min(
    normalizedPageRect.width,
    normalizedViewportRect.right - normalizedPageRect.left,
  );
  const visibleBottom = Math.min(
    normalizedPageRect.height,
    normalizedViewportRect.bottom - normalizedPageRect.top,
  );
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

  const pageScale = normalizedPageRect.width / modelWidth;
  const pageScaleY = normalizedPageRect.height / modelHeight;
  const dpr = Math.max(1, Math.min(2, finiteNumber(devicePixelRatio, 1)));
  if (
    !force
    && previousTile
    && nearlyEqual(previousTile.pageScale, pageScale)
    && nearlyEqual(previousTile.pageScaleY, pageScaleY)
    && nearlyEqual(previousTile.dpr, dpr)
    && visibleLeft >= previousTile.left + edgeGuard
    && visibleRight <= previousTile.left + previousTile.width - edgeGuard
    && visibleTop >= previousTile.top + edgeGuard
    && visibleBottom <= previousTile.top + previousTile.height - edgeGuard
  ) return previousTile;

  const marginX = Math.min(
    normalizedViewportRect.width * Math.max(0, marginRatio),
    normalizedPageRect.width,
  );
  const marginY = Math.min(
    normalizedViewportRect.height * Math.max(0, marginRatio),
    normalizedPageRect.height,
  );
  // Integer CSS box (floor/ceil only ever widens coverage): a fractional tile
  // box hits the same compositor snap-stretch as the base canvas — the bitmap
  // rescales by ~1/width when the box maps to fractional device pixels. Page
  // edges floor too so the box stays integer at the far edge; the <1px page
  // sliver left uncovered there is below one device pixel of content.
  const left = Math.floor(Math.max(0, visibleLeft - marginX));
  const top = Math.floor(Math.max(0, visibleTop - marginY));
  const right = Math.min(Math.floor(normalizedPageRect.width), Math.ceil(visibleRight + marginX));
  const bottom = Math.min(Math.floor(normalizedPageRect.height), Math.ceil(visibleBottom + marginY));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  const backingWidth = Math.max(1, Math.ceil(width * dpr));
  const backingHeight = Math.max(1, Math.ceil(height * dpr));

  return {
    left,
    top,
    width,
    height,
    pageOffsetX: left / pageScale,
    pageOffsetY: top / pageScaleY,
    backingWidth,
    backingHeight,
    // Scales re-derived from the integer backing dims (per axis) so the
    // painted extent fills the backing store EXACTLY — pageScale * dpr misses
    // it by the ceil() fraction and the CSS stretch back to tile.width/height
    // drifts all geometry linearly from the tile origin (same parity bug as
    // calculateAnnotationCanvasBackingStore).
    drawScale: (backingWidth * pageScale) / width,
    drawScaleY: (backingHeight * pageScaleY) / height,
    pageScale,
    pageScaleY,
    dpr,
  };
}
