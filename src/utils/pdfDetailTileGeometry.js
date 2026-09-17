// Deep-zoom detail-tile geometry, in PAGE UNITS.
//
// UX intent: the crisp tile that floats over the soft base canvas must never
// blink out. The owner's report was "sharp -> blurry -> sharp" on every pinch
// and pan: the tile used to be stored in the page div's CSS space (screen px
// divided by the live zoom), which silently stops describing the same page
// region the moment `scale` commits. The old code compensated by HIDING the
// tile whenever the live zoom drifted more than ~22% from the zoom it was
// captured at -- and a commit snaps liveZoom back to 1, so the tile vanished at
// the end of every single gesture, exposing the deliberately soft base canvas
// (mobile caps it at MOBILE_BASE_MAX_SCALE = 1.25) until a replacement painted.
//
// Storing the box in page units instead makes it scale-independent, so the same
// bitmap stays geometrically correct across a live pinch AND across the commit
// that follows it. That removes the need for a staleness cutoff entirely:
//
//   tile sharpness on screen = DPR * tile.renderScale / (scale * liveZoom)
//   base sharpness on screen = DPR * baseScale        / (scale * liveZoom)
//
// and a tile only exists when its renderScale exceeded the base-canvas ceiling,
// so a held tile is ALWAYS at least as sharp as the base it covers. Keeping a
// stale tile visible is therefore strictly better than hiding it. Better still,
// at a commit `scale` becomes the old `scale * liveZoom`, which is exactly the
// renderScale the tile was rasterized at -- the held tile lands pixel-perfect.
//
// Nothing here participates in the zoom lifecycle: no scale is written, no
// zoomGeneration signal is touched, and the SVG viewBox still owns annotation
// zoom. This module only converts numbers.

// Guard every divisor: a zero/NaN scale during mount or teardown must yield a
// finite box rather than poisoning the tile with Infinity.
const safePositive = (value) => (Number.isFinite(value) && value > 0 ? value : 0.001);

/**
 * Convert a visible slice measured in on-screen CSS px (relative to the page
 * host's own client rect) into a page-unit box that survives scale commits.
 *
 * @param {object} input
 * @param {number} input.vx  slice left, screen px from the host's left edge
 * @param {number} input.vy  slice top, screen px from the host's top edge
 * @param {number} input.vw  slice width in screen px
 * @param {number} input.vh  slice height in screen px
 * @param {number} input.scale     the committed page scale the host is laid out at
 * @param {number} input.liveZoom  the uncommitted gesture zoom on the content node
 * @param {number} [input.rotation] page rotation the slice was measured under
 */
export function computeDetailTileBox({ vx, vy, vw, vh, scale, liveZoom, rotation = 0 }) {
  // The host rect is already multiplied by BOTH the committed scale and the
  // live gesture zoom, so that product is the screen-px-per-page-unit factor.
  const renderScale = safePositive(scale) * safePositive(liveZoom);
  return {
    left: vx / renderScale,
    top: vy / renderScale,
    w: vw / renderScale,
    h: vh / renderScale,
    // The scale the bitmap was rasterized at. Kept for diagnostics and for the
    // commit identity above; it is deliberately NOT used as a staleness gate.
    renderScale,
    rotation,
  };
}

/**
 * Place a page-unit tile box inside a host laid out at `scale`. The parent
 * content node's `transform: scale(liveZoom)` supplies the live gesture zoom,
 * so this must NOT multiply by liveZoom -- doing so would double-apply it.
 */
export function resolveDetailTileStyle(tile, scale, rotation = 0) {
  if (!tile) return { left: 0, top: 0, width: 0, height: 0, display: 'none' };
  // A rotation change re-maps the page's coordinate frame, so a tile captured
  // under a different rotation would land on the wrong region. That is the one
  // case where hiding beats holding.
  if (tile.rotation !== rotation) return { left: 0, top: 0, width: 0, height: 0, display: 'none' };
  const s = safePositive(scale);
  return {
    left: tile.left * s,
    top: tile.top * s,
    width: tile.w * s,
    height: tile.h * s,
    display: 'block',
  };
}
