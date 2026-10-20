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

/**
 * Ink mask that also catches faint lines and works on scanned pages (ported
 * from the playground's adaptiveMask, local-raster.ts): a pixel is ink when it
 * is darker than its neighbourhood (31 px box mean) by more than 6 levels.
 * On white paper the plain threshold is added too, so solid fills still count;
 * on grey scanned paper (median luma < 235) only the local test is used, so
 * the paper itself never reads as ink.
 */
export function adaptiveInkMaskFromRgba(data, width, height) {
  const n = width * height;
  const gray = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let p = 0, i = 0; p < n; p += 1, i += 4) {
    const a = data[i + 3] / 255;
    const g = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
    gray[p] = g;
    hist[Math.max(0, Math.min(255, Math.round(g)))] += 1;
  }
  let median = 255;
  for (let v = 0, seen = 0; v < 256; v += 1) { seen += hist[v]; if (seen >= n / 2) { median = v; break; } }
  const whitePaper = median >= 235;
  // Integral image for O(1) box means.
  const W = width + 1;
  const sum = new Float64Array(W * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += gray[y * width + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const R = 15;
  const mask = new Uint8Array(n);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - R);
    const y1 = Math.min(height, y + R + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(width, x + R + 1);
      const mean = (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
      const g = gray[y * width + x];
      if (g <= mean - 6 || (whitePaper && g < SMART_FILL_INK_LUMA)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Grow ink by `r` px (square), closing gaps up to 2r px in broken lines. */
export function dilateMask(mask, width, height, r) {
  if (r <= 0) return mask;
  let cur = mask;
  for (let k = 0; k < r; k += 1) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (cur[y * width + x]) continue;
        if ((x > 0 && cur[y * width + x - 1]) || (x < width - 1 && cur[y * width + x + 1])
          || (y > 0 && cur[(y - 1) * width + x]) || (y < height - 1 && cur[(y + 1) * width + x])
          || (x > 0 && y > 0 && cur[(y - 1) * width + x - 1]) || (x < width - 1 && y < height - 1 && cur[(y + 1) * width + x + 1])
          || (x > 0 && y < height - 1 && cur[(y + 1) * width + x - 1]) || (x < width - 1 && y > 0 && cur[(y - 1) * width + x + 1])) {
          next[y * width + x] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function erodeRegion(region, width, height, r) {
  let cur = region;
  for (let k = 0; k < r; k += 1) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (!cur[p]) continue;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1
          || !cur[p - 1] || !cur[p + 1] || !cur[p - width] || !cur[p + width]) next[p] = 0;
      }
    }
    cur = next;
  }
  return cur;
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
export function findTagOutline(mask, width, height, seedX, seedY, { shrink = 0 } = {}) {
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
    last = outlineFromSeed(mask, width, height, seed, tried, shrink);
    if (last.ok) return last;
  }
  return last;
}

function outlineFromSeed(mask, width, height, seed, tried, shrink) {
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

  // 4. Its outer edge (pulled back in by any gap-closing growth).
  const ring = traceOuterLoop(shrink > 0 ? erodeRegion(region, width, height, shrink) : region, width, height);
  if (!ring) return { ok: false, reason: 'too-small' };
  return { ok: true, ring, area };
}

/**
 * findTagOutline that forgives small breaks in the outline (scanned drawings,
 * dashed or faint borders): if the plain pass finds no closed outline, retry
 * with the ink grown by 1 then 2 px, and shrink the answer back by the same.
 * The first closed answer wins; `closedGaps` says how much growth it took.
 */
export function findTagOutlineTolerant(mask, width, height, seedX, seedY) {
  let first = null;
  for (const r of [0, 1, 2]) {
    const grown = dilateMask(mask, width, height, r);
    const found = findTagOutline(grown, width, height, seedX, seedY, { shrink: r });
    if (found.ok) return { ...found, closedGaps: r };
    if (!first) first = found;
    // Only an open outline can be helped by closing gaps.
    if (found.reason !== 'open' && found.reason !== 'on-blank') return found;
  }
  return first;
}

// --- Reusing a sample tag (owner 2026-10-20) ---------------------------------
// After the user applies one outline, Smart fill can find the tags on the page
// that look the same. A tag "looks the same" when its outline is within 15% of
// the sample's size and its filled shape overlaps the sample's (both scaled to
// a 24 x 24 grid) by at least 85% (a circle in its square is ~79%). Every match is still shown for review.

const SIGNATURE_GRID = 24;
export const MATCH_SIZE_TOLERANCE = 0.15;
export const MATCH_MIN_OVERLAP = 0.85;

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shape signature of an outline ring (any units): size + a 24x24 fill grid. */
export function outlineSignature(ring) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const grid = new Array(SIGNATURE_GRID * SIGNATURE_GRID).fill(0);
  if (!(width > 0 && height > 0)) return { width: 0, height: 0, grid };
  for (let gy = 0; gy < SIGNATURE_GRID; gy += 1) {
    for (let gx = 0; gx < SIGNATURE_GRID; gx += 1) {
      const x = minX + ((gx + 0.5) / SIGNATURE_GRID) * width;
      const y = minY + ((gy + 0.5) / SIGNATURE_GRID) * height;
      grid[gy * SIGNATURE_GRID + gx] = pointInRing(x, y, ring) ? 1 : 0;
    }
  }
  return { width, height, grid };
}

/** True when two signatures (same units) describe the same kind of tag. */
export function signaturesMatch(a, b) {
  if (!a || !b || !(a.width > 0) || !(b.width > 0)) return false;
  const close = (p, q) => Math.abs(p - q) <= MATCH_SIZE_TOLERANCE * Math.max(p, q);
  if (!close(a.width, b.width) || !close(a.height, b.height)) return false;
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.grid.length; i += 1) {
    if (a.grid[i] && b.grid[i]) both += 1;
    if (a.grid[i] || b.grid[i]) either += 1;
  }
  return either > 0 && both / either >= MATCH_MIN_OVERLAP;
}

function candidateCells(mask, width, height, sample) {
  const label = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  const cells = [];
  let id = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || label[start] !== -1) continue;
    id += 1;
    let head = 0; let tail = 0; let touches = false;
    let minX = width; let minY = height; let maxX = 0; let maxY = 0;
    label[start] = id; queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width; const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q < 0 || q >= mask.length || mask[q] || label[q] !== -1) continue;
        label[q] = id; queue[tail++] = q;
      }
    }
    if (touches) continue;
    const w = maxX - minX + 1; const h = maxY - minY + 1;
    // A cell inside the tag is at most the tag's size, and not tiny next to it
    // (a tag split by a divider has cells about half its size).
    if (w > sample.width * 1.2 || h > sample.height * 1.2) continue;
    if (w < sample.width * 0.2 && h < sample.height * 0.2) continue;
    cells.push({ seed: start });
  }
  return cells;
}

/**
 * Find every tag on a whole-page ink mask that matches `sample` (a signature
 * in mask pixels). Each closed paper cell about the right size is a candidate;
 * the normal tap engine runs on a crop around it and the answer is compared to
 * the sample. Returns rings in mask pixels, de-duplicated. Bounded: at most
 * `maxCandidates` crops are tried.
 */
export function findSimilarTags(mask, width, height, sample, { maxCandidates = 400 } = {}) {
  if (!sample?.width) return [];
  // Cells come from the plain mask and from the gap-closed masks too, so a tag
  // whose border has a small break (which a tap closes, closedGaps 1-2) is
  // still a candidate. Paper in a grown mask is paper in the plain one, so the
  // seed is valid for the normal engine below, which re-verifies every cell.
  const cells = [];
  for (const r of [0, 1, 2]) {
    cells.push(...candidateCells(r ? dilateMask(mask, width, height, r) : mask, width, height, sample));
  }
  const found = [];
  const pad = Math.ceil(Math.max(sample.width, sample.height) * 1.5) + 8;
  for (const cell of cells.slice(0, maxCandidates)) {
    const sx = cell.seed % width; const sy = (cell.seed - sx) / width;
    if (found.some((f) => sx >= f.minX && sx <= f.maxX && sy >= f.minY && sy <= f.maxY)) continue;
    const x0 = Math.max(0, sx - pad); const y0 = Math.max(0, sy - pad);
    const x1 = Math.min(width, sx + pad); const y1 = Math.min(height, sy + pad);
    const cw = x1 - x0; const ch = y1 - y0;
    const crop = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y += 1) crop.set(mask.subarray((y0 + y) * width + x0, (y0 + y) * width + x1), y * cw);
    const res = findTagOutlineTolerant(crop, cw, ch, sx - x0, sy - y0);
    if (!res?.ok) continue;
    const ring = res.ring.map(([x, y]) => [x + x0, y + y0]);
    if (!signaturesMatch(outlineSignature(ring), sample)) continue;
    const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
    found.push({ ring, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
  }
  return found.map((f) => f.ring);
}
