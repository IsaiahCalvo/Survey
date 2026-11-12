/**
 * segmentCaptions.js — Drawboard's per-segment captions on a Polylength
 * (Nightly 'measure-plus'; live check deep/measure-extras.md §6): each
 * segment shows its own length on the segment, the text turned along it
 * and kept upright, while the total stays in the mark's own caption.
 */
import { getMeasureKind, formatMeasureLength, measurePolygonWorldPoints } from './measureScale.js';
import { DIMENSION_CAPTION_PT } from './dimensionLine.js';

/** Captions for each segment of a polylength mark, or [] for anything else. */
export function polylengthSegmentCaptions(obj, scale) {
  if (getMeasureKind(obj) !== 'polylength') return [];
  const points = measurePolygonWorldPoints(obj);
  const out = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-6)) continue;
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    // Never upside down; a straight-up-or-down segment reads bottom to top.
    if (angle >= 90) angle -= 180;
    else if (angle < -90) angle += 180;
    // Inline, as Drawboard's default: on the segment, the line broken round
    // the words (a white halo stands in for the break).
    out.push({
      index: i - 1,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      angle,
      text: formatMeasureLength(len, scale),
      fontPt: DIMENSION_CAPTION_PT,
    });
  }
  return out;
}

/**
 * Where a Polylength's total goes once its segments carry their own captions:
 * above the last segment's middle (Drawboard), level, clear of that segment's
 * caption. Feeds layoutMeasureLabel's `above`. Null for anything else.
 */
export function polylengthTotalPlace(obj, scale) {
  const caps = polylengthSegmentCaptions(obj, scale);
  const last = caps[caps.length - 1];
  if (!last) return null;
  return { x: last.x, y: last.y, above: { angle: last.angle, extra: last.fontPt / 2 } };
}
