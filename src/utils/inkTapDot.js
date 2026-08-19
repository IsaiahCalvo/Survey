/**
 * KAL-405 — single-tap ink dots.
 *
 * A pen TAP in Acrobat / Drawboard / Bluebeam / iPad markup exports as an Ink
 * annotation with no travel: /InkList holds a single point, two identical
 * points, or a handful of samples whose bounding box collapses to nothing.
 * A move-to with no line-to paints zero pixels, so those marks used to vanish
 * silently on screen AND from every export. Reference PDF viewers instead
 * render the tap the way a real pen does: the round line cap on its own, i.e.
 * a filled circle whose DIAMETER is the pen width, centred on the tapped
 * point. This module detects that degenerate geometry and builds that circle.
 *
 * Shared by the PDF importer (substitutes the dot at import) and the pdf-lib
 * exporter (mirrors it so a dot that renders also lands in the exported PDF),
 * so the "what counts as a tap" rule has exactly one definition.
 */

// Circle-from-cubics constant: 4/3 * tan(pi/8). Four cubic segments with this
// control-point offset approximate a circle to within ~0.02% of the radius.
const INK_DOT_BEZIER_KAPPA = 0.5522847498307936;

/**
 * A tap is "no travel". A subpath counts as degenerate when BOTH bounding-box
 * dimensions are at most a quarter of the pen width, because at that distance
 * the pen's own round cap already covers the entire path — the mark is
 * visually a dot however it was drawn.
 *
 * The test is relative to the pen width (not an absolute pixel count and not
 * a point count) because the same tap arrives as 1, 2 or 8 samples depending
 * on the authoring tool, and because a 0.5pt pen and a 20pt pen disagree
 * about what "tiny" means. The 1/4 factor leaves a wide margin against real
 * marks: the shortest deliberate flick a person can see — a tick, a comma, an
 * accent — travels at least a full pen width, i.e. 4x the threshold, so it is
 * never converted.
 */
export const INK_DOT_COLLAPSE_FRACTION = 0.25;

/** Absolute floor so a hairline pen (width 0) cannot turn every stroke into a dot. */
export const INK_DOT_COLLAPSE_FLOOR = 0.01;

export function inkDotCollapseThreshold(diameter) {
  const numeric = Number(diameter);
  const safe = Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  return Math.max(INK_DOT_COLLAPSE_FLOOR, safe * INK_DOT_COLLAPSE_FRACTION);
}

function splitInkPathIntoSubpaths(pathData) {
  const subpaths = [];
  let current = null;
  for (const seg of pathData) {
    if (!Array.isArray(seg) || seg.length === 0) continue;
    if (seg[0] === 'M' || !current) {
      current = [];
      subpaths.push(current);
    }
    current.push(seg);
  }
  return subpaths;
}

function inkSubpathExtent(subpath) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of subpath) {
    for (let index = 1; index + 1 < seg.length; index += 2) {
      const x = seg[index];
      const y = seg[index + 1];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Centre of every tap when EVERY subpath in `pathData` is degenerate,
 * otherwise null.
 *
 * The all-or-nothing rule is deliberate: a path carries one paint, so a path
 * that mixes a real stroke with a tap cannot be filled (dot) and stroked
 * (line) at once without doubling the dot's size. Mixed paths therefore keep
 * today's behaviour — the real stroke still renders exactly as before.
 */
export function degenerateInkTapCenters(pathData, collapseThreshold) {
  if (!Array.isArray(pathData) || pathData.length === 0) return null;
  if (!Number.isFinite(collapseThreshold) || collapseThreshold <= 0) return null;
  const subpaths = splitInkPathIntoSubpaths(pathData);
  if (subpaths.length === 0) return null;
  const centers = [];
  for (const subpath of subpaths) {
    const extent = inkSubpathExtent(subpath);
    if (!extent) return null;
    if (extent.width > collapseThreshold || extent.height > collapseThreshold) return null;
    centers.push({
      x: (extent.minX + extent.maxX) / 2,
      y: (extent.minY + extent.maxY) / 2,
    });
  }
  return centers.length > 0 ? centers : null;
}

/** Closed circle as four cubic segments, in the same command form as ink paths. */
export function buildInkDotPathCommands(cx, cy, radius) {
  const k = radius * INK_DOT_BEZIER_KAPPA;
  return [
    ['M', cx + radius, cy],
    ['C', cx + radius, cy + k, cx + k, cy + radius, cx, cy + radius],
    ['C', cx - k, cy + radius, cx - radius, cy + k, cx - radius, cy],
    ['C', cx - radius, cy - k, cx - k, cy - radius, cx, cy - radius],
    ['C', cx + k, cy - radius, cx + radius, cy - k, cx + radius, cy],
    ['Z'],
  ];
}
