/**
 * shapeFillKnockout.js — where a shape's FILL stops when its border is
 * see-through (owner Test 15, 2026-10-02).
 *
 * A border is stroked CENTRED on the shape's edge, so its inner half lies on
 * top of the fill. While the border is opaque that overlap is invisible; the
 * moment it is translucent (the colour picker's opacity slider) the fill shows
 * through the inner half of the border as a darker band. Every renderer
 * therefore stops the fill at the stroke's INNER edge for such a shape: the
 * fill is the shape minus the stroke band, so a wider border means a smaller
 * fill and the two never overlap. The border itself does not move (its outer
 * edge stays where it was), and saved data is untouched — this is render-time
 * geometry only.
 *
 * The rule applies only while the border would actually show the fill through
 * it (shouldKnockOutShapeFill). An opaque border paints exactly as before, so
 * every existing document looks the same at full opacity (no anti-aliasing
 * seam, no change to how a dashed border's gaps show the fill).
 *
 * Clouds already did this (cloudSvgPaint.js / annotationCanvasPainter drawCloud
 * / pdfAnnotationsPdfLib buildCloudAppearance); this module carries the same
 * idea to rectangles, ellipses, polygons and text-box backgrounds:
 *   * SVG   — rect / text box: the fill is a rect inset by half the stroke
 *             width (exact for any join: joins only change a convex corner's
 *             OUTSIDE). Ellipse / polygon: the fill carries a mask = the shape
 *             white with its outline stroked black at the ink width (the
 *             cloud's mask), exact for any curve or join.
 *   * Canvas — the fill is painted on the painter's scratch layer, the stroke
 *             band is erased from it (destination-out), and the layer is
 *             composited back (the cloud's scratch-layer path).
 *   * PDF   — rect / text box: the inset rect. Ellipse / polygon: the fill is
 *             clipped to the complement of the stroke band, one round-capped
 *             capsule per outline segment (clip paths intersect, so clipping
 *             to each capsule's complement in turn is the complement of their
 *             union - no polygon boolean needed). See strokeBandCapsuleRings.
 */

const num = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * The alpha a CSS / fabric paint string puts on the page: 0 for none,
 * transparent or an empty value; the alpha of rgba()/hsla()/#rgba/#rrggbbaa;
 * 1 for any other colour.
 */
export function paintAlpha(value) {
  if (value == null) return 0;
  const text = String(value).trim().toLowerCase();
  if (text === '' || text === 'none' || text === 'transparent') return 0;
  const fn = text.match(/^(?:rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const raw = parts[3];
    const alpha = raw.endsWith('%') ? num(raw.slice(0, -1), 100) / 100 : num(raw, 1);
    return clamp01(alpha);
  }
  const hex = text.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/);
  if (hex) {
    const digits = hex[1].length === 4 ? hex[1].slice(3, 4).repeat(2) : hex[1].slice(6, 8);
    return parseInt(digits, 16) / 255;
  }
  return 1;
}

/**
 * Whether the fill must stop at the stroke's inner edge: there is a visible
 * fill AND a visible border, and that border is see-through (its own alpha
 * times the object's opacity is below 1). `opacity` is the object's opacity;
 * renderers that composite the object as a group (SVG `opacity` on the
 * element) may pass 1, the knockout is harmless either way.
 */
export function shouldKnockOutShapeFill({ fill, stroke, strokeWidth, opacity = 1 } = {}) {
  if (!(num(strokeWidth) > 0)) return false;
  const fillAlpha = paintAlpha(fill);
  const strokeAlpha = paintAlpha(stroke);
  if (!(fillAlpha > 0) || !(strokeAlpha > 0)) return false;
  const objectOpacity = clamp01(num(opacity, 1));
  return strokeAlpha * objectOpacity < 0.999;
}

/**
 * The fill box of a rectangle whose border is stroked centred on
 * (x, y, width, height): the same box pulled in by half the stroke width on
 * every side (never negative).
 */
export function insetRectForFill({ x = 0, y = 0, width = 0, height = 0 } = {}, strokeWidth = 0) {
  const half = Math.max(0, num(strokeWidth)) / 2;
  const w = Math.max(0, num(width) - 2 * half);
  const h = Math.max(0, num(height) - 2 * half);
  return {
    x: num(x) + Math.min(half, num(width) / 2),
    y: num(y) + Math.min(half, num(height) / 2),
    width: w,
    height: h,
  };
}

/**
 * Points along an ellipse (centre cx, cy; radii rx, ry), counter-clockwise in
 * a y-down frame, for outline work that needs a polyline (the PDF clip). Fine
 * enough that the chord-to-arc gap stays far below a device pixel.
 */
export function sampleEllipsePoints({ cx = 0, cy = 0, rx = 0, ry = 0 } = {}, segments = 0) {
  const r = Math.max(Math.abs(num(rx)), Math.abs(num(ry)));
  const count = segments > 0
    ? Math.round(segments)
    : Math.max(48, Math.min(256, Math.ceil(Math.PI * Math.sqrt(Math.max(1, r)) * 4)));
  return Array.from({ length: count }, (_, index) => {
    const theta = (index * Math.PI * 2) / count;
    return { x: num(cx) + Math.cos(theta) * num(rx), y: num(cy) + Math.sin(theta) * num(ry) };
  });
}

/**
 * The stroke band of an outline as round-capped capsules, one per segment
 * (a closed outline also gets the closing segment). Inside the shape, the
 * union of the capsules is exactly the region a centred stroke of that width
 * covers, whatever the join: round caps reproduce a round join's inner arc
 * at a reflex corner, and at a convex corner the two segment bands already
 * cover the inside.
 *
 * @param {{x:number,y:number}[]} points outline vertices
 * @param {{ closed?: boolean, halfWidth: number, capSteps?: number }} options
 * @returns {{x:number,y:number}[][]} one closed ring (no repeated end point)
 *   per capsule; empty when there is nothing to knock out
 */
export function strokeBandCapsuleRings(points, { closed = true, halfWidth = 0, capSteps = 6 } = {}) {
  const half = num(halfWidth);
  if (!Array.isArray(points) || points.length < 2 || !(half > 0)) return [];
  const steps = Math.max(2, Math.round(num(capSteps, 6)));
  const rings = [];
  const count = points.length;
  const last = closed ? count : count - 1;
  for (let index = 0; index < last; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % count];
    const dx = num(b?.x) - num(a?.x);
    const dy = num(b?.y) - num(a?.y);
    if (!(Math.hypot(dx, dy) > 1e-9)) continue;
    const angle = Math.atan2(dy, dx);
    const ring = [];
    for (let step = 0; step <= steps; step += 1) {
      const theta = angle + Math.PI / 2 - (Math.PI * step) / steps;
      ring.push({ x: num(b.x) + half * Math.cos(theta), y: num(b.y) + half * Math.sin(theta) });
    }
    for (let step = 0; step <= steps; step += 1) {
      const theta = angle - Math.PI / 2 - (Math.PI * step) / steps;
      ring.push({ x: num(a.x) + half * Math.cos(theta), y: num(a.y) + half * Math.sin(theta) });
    }
    rings.push(ring);
  }
  return rings;
}
