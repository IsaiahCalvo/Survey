/**
 * smartFillEngine.js — the beta Smart fill outline finder (pure, no DOM).
 *
 * Owner 2026-10-20: ship Smart fill as a beta. The user taps inside a tag on a
 * drawing; we fill that tag's whole outer outline as one region (its border,
 * any divider lines and its text included), like the playground app
 * (IsaiahCalvo/smart-fill-pdf-playground). That app's engine is far larger
 * and built on its own pdf.js, so this beta reads the page as the user sees it
 * (the rendered page canvas) instead:
 *
 *   1. ink = dark pixels; flood the paper from the tap, walls = ink.
 *   2. the ink touching that flood is the tag's outline (plus its dividers).
 *   3. fill everything that ink encloses — every compartment and the text.
 *   4. trace the outer edge of that region into one polygon.
 *
 * It refuses rather than guesses (returns { ok:false, reason }) when the tap
 * is not inside a closed outline, or the outline is huge / tiny — the caller
 * shows "No outline found" and nothing is created. Every result is still
 * shown to the user before it becomes a Survey Marker (preview, then Apply).
 *
 * Units: everything here is in mask pixels; the provider converts to page
 * units. Bounded work: the caller crops a window around the tap.
 */

// Thin lines at low zoom anti-alias to light grey, so anything clearly off-white is ink.
export const SMART_FILL_INK_LUMA = 232;
const MIN_REGION_PX = 30;
// A closed area this big is a room or the sheet border, not a tag.
const MAX_REGION_FRACTION = 0.35;

/** Luma mask from RGBA pixels: 1 = ink (dark, opaque enough), 0 = paper. */
export function inkMaskFromRgba(data, width, height, threshold = SMART_FILL_INK_LUMA) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < mask.length; p += 1, i += 4) {
    const a = data[i + 3];
    if (a < 64) continue; // transparent = paper
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (luma < threshold) mask[p] = 1;
  }
  return mask;
}

/** 4-connected flood over cells where `pass(index)` is true. Returns the visited mask. */
function flood(width, height, seeds, pass) {
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const s of seeds) {
    if (s >= 0 && !seen[s] && pass(s)) { seen[s] = 1; queue[tail++] = s; }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const n = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
    for (const q of n) {
      if (q < 0 || q >= seen.length || seen[q] || !pass(q)) continue;
      seen[q] = 1;
      queue[tail++] = q;
    }
  }
  return seen;
}

function borderSeeds(width, height) {
  const seeds = [];
  for (let x = 0; x < width; x += 1) seeds.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y += 1) seeds.push(y * width, y * width + width - 1);
  return seeds;
}

/** Paper pixels near (x, y), nearest first (the tap itself when it's paper). */
function nearbyPaper(mask, width, height, x, y, radius = 4) {
  const found = [];
  for (let r = 0; r <= radius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        if (!mask[py * width + px]) found.push(py * width + px);
      }
    }
    if (r === 0 && found.length) return found;
  }
  return found;
}

/**
 * Trace the outer edge of a filled region along pixel edges. Returns the
 * largest closed loop as [[x, y], ...] in pixel-corner coordinates.
 */
export function traceOuterLoop(region, width, height) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && region[y * width + x] === 1;
  const W = width + 1;
  const out = new Map(); // vertex -> [next vertex, ...]
  const add = (ax, ay, bx, by) => {
    const a = ay * W + ax;
    const list = out.get(a);
    if (list) list.push(by * W + bx); else out.set(a, [by * W + bx]);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      // Clockwise around the filled pixel (y down): top, right, bottom, left.
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  let best = null;
  let bestArea = 0;
  for (const start of [...out.keys()]) {
    while (out.get(start)?.length) {
      const loop = [];
      let v = start;
      for (let guard = 0; guard < 4 * width * height + 8; guard += 1) {
        loop.push([v % W, Math.floor(v / W)]);
        const list = out.get(v);
        if (!list || list.length === 0) break;
        const next = list.pop();
        if (list.length === 0) out.delete(v);
        v = next;
        if (v === start) break;
      }
      let area = 0;
      for (let i = 0; i < loop.length; i += 1) {
        const [x1, y1] = loop[i];
        const [x2, y2] = loop[(i + 1) % loop.length];
        area += x1 * y2 - x2 * y1;
      }
      area = Math.abs(area) / 2;
      if (area > bestArea) { bestArea = area; best = loop; }
    }
  }
  if (!best) return null;
  // Drop points in the middle of straight runs.
  const slim = best.filter((p, i) => {
    const a = best[(i - 1 + best.length) % best.length];
    const b = best[(i + 1) % best.length];
    return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
  });
  return slim.length >= 3 ? slim : null;
}

/**
 * Find the filled outline of the tag around (seedX, seedY) in an ink mask.
 * Returns { ok:true, ring, area } (ring in pixel-corner coords) or
 * { ok:false, reason } with reason 'on-blank' | 'open' | 'too-small' | 'too-large'.
 */
export function findTagOutline(mask, width, height, seedX, seedY) {
  const sx = Math.round(seedX);
  const sy = Math.round(seedY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return { ok: false, reason: 'open' };
  const seeds = nearbyPaper(mask, width, height, sx, sy);
  if (seeds.length === 0) return { ok: false, reason: 'on-blank' };
  // A tap on the line itself: try the paper on each side; the closed one wins.
  let last = { ok: false, reason: 'open' };
  const tried = new Uint8Array(width * height);
  for (const seed of seeds.slice(0, 24)) {
    if (tried[seed]) continue;
    last = outlineFromSeed(mask, width, height, seed, tried);
    if (last.ok) return last;
  }
  return last;
}

function outlineFromSeed(mask, width, height, seed, tried) {
  // 1. The paper reachable from the tap.
  const paper = flood(width, height, [seed], (p) => mask[p] === 0);
  for (let p = 0; p < paper.length; p += 1) if (paper[p]) tried[p] = 1;
  for (let x = 0; x < width; x += 1) {
    if (paper[x] || paper[(height - 1) * width + x]) return { ok: false, reason: 'open' };
  }
  for (let y = 0; y < height; y += 1) {
    if (paper[y * width] || paper[y * width + width - 1]) return { ok: false, reason: 'open' };
  }

  // 2. The ink that walls it in, and everything that ink is joined to.
  const wallSeeds = [];
  for (let p = 0; p < paper.length; p += 1) {
    if (!paper[p]) continue;
    const x = p % width;
    for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (q >= 0 && q < mask.length && mask[q]) wallSeeds.push(q);
    }
  }
  const wall = flood(width, height, wallSeeds, (p) => mask[p] === 1);

  // 3. Fill what that ink encloses: everything the window border can't reach
  //    without crossing it.
  const outside = flood(width, height, borderSeeds(width, height), (p) => wall[p] === 0);
  const region = new Uint8Array(width * height);
  let area = 0;
  for (let p = 0; p < region.length; p += 1) {
    if (!outside[p]) { region[p] = 1; area += 1; }
  }
  if (area < MIN_REGION_PX) return { ok: false, reason: 'too-small' };
  // Running off the window means the outline is bigger than we looked at.
  for (let x = 0; x < width; x += 1) {
    if (region[x] || region[(height - 1) * width + x]) return { ok: false, reason: 'too-large' };
  }
  for (let y = 0; y < height; y += 1) {
    if (region[y * width] || region[y * width + width - 1]) return { ok: false, reason: 'too-large' };
  }
  if (area > MAX_REGION_FRACTION * width * height) return { ok: false, reason: 'too-large' };

  // 4. Its outer edge.
  const ring = traceOuterLoop(region, width, height);
  if (!ring) return { ok: false, reason: 'too-small' };
  return { ok: true, ring, area };
}
