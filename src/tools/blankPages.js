// Remove blank pages: decide from a small picture of each page whether it
// has anything on it. Pure, so Node tests can feed it pixels.

// darkness: how far from white (0-255) a pixel must be to count as marked.
// share: how much of the page may be marked and still count as blank.
// edge: the outer part of the page to ignore, where scanners leave shadows.
export const LEVELS = {
  strict: { darkness: 24, share: 0, edge: 0 },
  normal: { darkness: 48, share: 0.0006, edge: 0.03 },
  loose: { darkness: 80, share: 0.004, edge: 0.05 },
};

// Share of the page (inside the ignored edge) with marks on it, from RGBA
// pixels. A colour counts by its strongest channel, so yellow highlighter
// is a mark even though it is light.
export function inkShare(rgba, width, height, { darkness, edge = 0 }) {
  const mx = Math.floor(width * edge);
  const my = Math.floor(height * edge);
  const cut = 255 - darkness;
  let marked = 0;
  let total = 0;
  for (let y = my; y < height - my; y += 1) {
    for (let x = mx, i = (y * width + mx) * 4; x < width - mx; x += 1, i += 4) {
      total += 1;
      if (Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < cut) marked += 1;
    }
  }
  return total ? marked / total : 0;
}

export function isBlank(rgba, width, height, level = 'normal') {
  const l = LEVELS[level] || LEVELS.normal;
  return inkShare(rgba, width, height, l) <= l.share;
}

// Page indexes (0-based) that count as blank, from per-page results of
// measure(): { [level]: boolean } so changing the level needs no new render.
export function blankIndexes(results, level) {
  return results.flatMap((r, i) => (r?.[level] ? [i] : []));
}

export function measure(rgba, width, height) {
  return Object.fromEntries(Object.keys(LEVELS).map((k) => [k, isBlank(rgba, width, height, k)]));
}
