/**
 * segmentCaptions.js — Drawboard's segment captions (Nightly 'measure-plus';
 * live check deep/measure-extras.md §6): each side of a Polylength (on by
 * default) or Perimeter (off by default) shows its own length. Inline puts
 * it on the side, turned along it and kept upright; Upright puts it on the
 * side, level; Above turns it along the side and sets it beside it. The
 * total stays in the mark's own caption.
 */
import { formatMeasureLength, getMeasureKind, measurePolygonWorldPoints, segmentCaptionPlace } from './measureScale.js';
import { DIMENSION_CAPTION_PT } from './dimensionLine.js';

/** How far beside its side an Above caption sits, in caption heights. */
export const SEGMENT_CAPTION_ABOVE_LIFT = 0.8;

/** One caption per side, or [] when the mark shows none. */
export function measureSegmentCaptions(obj, scale) {
  const place = segmentCaptionPlace(obj);
  if (place === 'off') return [];
  const points = measurePolygonWorldPoints(obj);
  if (getMeasureKind(obj) === 'perimeter' && points.length >= 3) points.push(points[0]);
  const out = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-6)) continue;
    let along = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    // Never upside down; a straight-up-or-down side reads bottom to top.
    if (along >= 90) along -= 180;
    else if (along < -90) along += 180;
    let x = (a.x + b.x) / 2;
    let y = (a.y + b.y) / 2;
    if (place === 'above') {
      // Beside the side, on the text's own "up" side, so the line shows.
      const rad = (along * Math.PI) / 180;
      const lift = DIMENSION_CAPTION_PT * SEGMENT_CAPTION_ABOVE_LIFT;
      x += Math.sin(rad) * lift;
      y -= Math.cos(rad) * lift;
    }
    out.push({
      index: i - 1,
      x,
      y,
      angle: place === 'upright' ? 0 : along,
      along,
      place,
      text: formatMeasureLength(len, scale),
      fontPt: DIMENSION_CAPTION_PT,
    });
  }
  return out;
}

/**
 * Where a Polylength's total goes once its sides carry their own captions:
 * above the last side's middle (Drawboard), level, clear of that side's
 * caption. Feeds layoutMeasureLabel's `above`. Null for anything else (a
 * Perimeter's total stays in its middle).
 */
export function polylengthTotalPlace(obj, scale) {
  if (getMeasureKind(obj) !== 'polylength') return null;
  const caps = measureSegmentCaptions(obj, scale);
  const last = caps[caps.length - 1];
  if (!last) return null;
  const extra = last.place === 'above' ? last.fontPt * (SEGMENT_CAPTION_ABOVE_LIFT + 0.5) : last.fontPt / 2;
  const rad = (last.along * Math.PI) / 180;
  // Back on the side for Above (its lift is counted in `extra`).
  const back = last.place === 'above' ? last.fontPt * SEGMENT_CAPTION_ABOVE_LIFT : 0;
  return { x: last.x - Math.sin(rad) * back, y: last.y + Math.cos(rad) * back, above: { angle: last.along, extra } };
}
