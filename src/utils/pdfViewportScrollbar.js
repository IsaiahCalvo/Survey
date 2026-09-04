const DEFAULT_EDGE_INSET = 6;
const DEFAULT_MIN_THUMB_SIZE = 36;

const finiteOr = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function getViewportScrollbarAxis({
  viewportSize,
  contentSize,
  scrollOffset,
  trackSize,
  edgeInset = DEFAULT_EDGE_INSET,
  minimumThumbSize = DEFAULT_MIN_THUMB_SIZE,
} = {}) {
  const viewport = Math.max(0, finiteOr(viewportSize));
  const content = Math.max(viewport, finiteOr(contentSize, viewport));
  const track = Math.max(0, finiteOr(trackSize));
  const inset = Math.max(0, Math.min(track / 2, finiteOr(edgeInset, DEFAULT_EDGE_INSET)));
  const usableTrack = Math.max(0, track - (inset * 2));
  const maxScroll = Math.max(0, content - viewport);
  const visibleRatio = content > 0 ? Math.min(1, viewport / content) : 1;
  const minimum = Math.min(usableTrack, Math.max(0, finiteOr(minimumThumbSize, DEFAULT_MIN_THUMB_SIZE)));
  const size = maxScroll === 0
    ? usableTrack
    : Math.max(minimum, usableTrack * visibleRatio);
  const travel = Math.max(0, usableTrack - size);
  const clampedScroll = Math.max(0, Math.min(maxScroll, finiteOr(scrollOffset)));
  const start = inset + (maxScroll > 0 ? (clampedScroll / maxScroll) * travel : 0);

  return { start, size, travel, maxScroll };
}
