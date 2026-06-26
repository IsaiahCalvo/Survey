/**
 * pdfAnnotation — coordinate model for ink anchored to a PDF page.
 *
 * Strokes are stored in NORMALIZED page coordinates (x,y in 0..1 of the page),
 * so they are resolution- AND zoom-independent and round-trip cleanly with the
 * desktop owned-pdf.js renderer via @survey/shared. (PDF user-space is y-up from
 * bottom-left; the y-flip to true PDF points is a single final mapping applied at
 * save/load — see normToPdfUserSpace. On-screen we keep y-down/top-left.)
 *
 * Three spaces:
 *   screen  — device points (what a gesture reports)
 *   local   — the page container's own space at scale 1 (px), top-left origin
 *   norm    — local / pageSize  → 0..1, what we persist
 *
 * The page container is transformed by T = { scale, tx, ty } (translate then
 * scale about top-left), so:  screen = (tx,ty) + scale * local.
 * Because the PDF render layer and the ink layer both live INSIDE that container,
 * they share `local` space and stay aligned under any T — that is the whole point.
 */
export type Norm = { x: number; y: number };
export type Transform = { scale: number; tx: number; ty: number };
export type Stroke = { id: string; pts: Norm[]; color: string; width: number };

export const screenToLocal = (sx: number, sy: number, t: Transform) => ({
  x: (sx - t.tx) / t.scale,
  y: (sy - t.ty) / t.scale,
});
export const localToScreen = (lx: number, ly: number, t: Transform) => ({
  x: t.tx + lx * t.scale,
  y: t.ty + ly * t.scale,
});
export const localToNorm = (lx: number, ly: number, pageW: number, pageH: number): Norm => ({
  x: pageW ? lx / pageW : 0,
  y: pageH ? ly / pageH : 0,
});
export const normToLocal = (n: Norm, pageW: number, pageH: number) => ({ x: n.x * pageW, y: n.y * pageH });

/** Convert a stored stroke to an SVG path string in LOCAL px, for a Skia <Path>. */
export function strokeToLocalSvg(s: Stroke, pageW: number, pageH: number): string {
  if (!s.pts.length) return '';
  return (
    'M' +
    s.pts
      .map((n, i) => {
        const l = normToLocal(n, pageW, pageH);
        return `${i ? 'L' : ''}${l.x.toFixed(2)} ${l.y.toFixed(2)}`;
      })
      .join(' ')
  );
}

/** Clamp a normalized point into the page (so ink can't be stored off-page). */
export const clampNorm = (n: Norm): Norm => ({
  x: Math.max(0, Math.min(1, n.x)),
  y: Math.max(0, Math.min(1, n.y)),
});

/** norm (y-down, top-left) -> PDF user-space points (y-up, bottom-left). */
export const normToPdfUserSpace = (n: Norm, pageWidthPt: number, pageHeightPt: number) => ({
  x: n.x * pageWidthPt,
  y: (1 - n.y) * pageHeightPt,
});

/**
 * points->pixels raster scale to keep a fit-to-width page crisp at `displayScale`
 * zoom, CAPPED so neither side exceeds `safePx` device pixels — the Approach-C
 * deep-zoom crash guard. `devicePixels = pagePoints * returnedScale`. Below the cap
 * the result is exactly the crisp target (`baseW/ptsW * displayScale * dpr`, the
 * pdf.js outputScale=DPR invariant); above it the page upscales (soft) instead of
 * allocating an SkImage that blows the GPU texture limit.
 */
export function rasterScaleFor(
  displayScale: number, baseW: number, ptsW: number, ptsH: number, dpr: number, safePx: number,
): number {
  const wantPxPerPt = (baseW / ptsW) * displayScale * dpr;
  return Math.min(wantPxPerPt, safePx / ptsW, safePx / ptsH);
}

// ---- Tiling: the visible-region detail tile (the deep-zoom fix) ----

export type Rect = { x: number; y: number; w: number; h: number };
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
/** Apply a CoreGraphics-style affine (x' = a·x + c·y + e, y' = b·x + d·y + f). */
export const applyAffine = (m: Affine, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});

/**
 * Visible page rectangle in LOCAL (base) coords, expanded by an `overscan` fraction
 * (of the visible extent, to cover small pans) and clamped to the page. This is the
 * region we rasterize at screen resolution as the "detail tile" — its pixel size is
 * ~viewport-bounded at any zoom, which is what keeps tiling crisp AND cheap.
 */
export function visibleLocalRect(
  t: Transform, vw: number, vh: number, baseW: number, baseH: number, overscan: number,
): Rect {
  let left = (0 - t.tx) / t.scale;
  let top = (0 - t.ty) / t.scale;
  let right = (vw - t.tx) / t.scale;
  let bottom = (vh - t.ty) / t.scale;
  const mx = (right - left) * overscan;
  const my = (bottom - top) * overscan;
  left -= mx; right += mx; top -= my; bottom += my;
  left = Math.max(0, Math.min(baseW, left));
  right = Math.max(0, Math.min(baseW, right));
  top = Math.max(0, Math.min(baseH, top));
  bottom = Math.max(0, Math.min(baseH, bottom));
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/**
 * The CoreGraphics CTM that maps PDF user-space points (y-up, bottom-left) into the
 * bitmap pixels for a region [rx,ry,rw,rh] given in DISPLAY points (y-down, top-left).
 * Mirrors the Swift rasterizeRegion composition EXACTLY:
 *     translateBy(-rx·scale, pageHeightPt·scale - ry·scale); scaleBy(scale, -scale)
 * Net effect: a display point (dx,dy) lands at device pixel ((dx-rx)·scale, (dy-ry)·scale),
 * so the region's top-left maps to (0,0) and its bottom-right to (rw·scale, rh·scale).
 * Exists so the spike's self-check verifies the crop transform offline (the part most
 * likely to be wrong) before paying a native rebuild.
 */
export function regionDrawAffine(rx: number, ry: number, scale: number, pageHeightPt: number): Affine {
  return { a: scale, b: 0, c: 0, d: -scale, e: -rx * scale, f: pageHeightPt * scale - ry * scale };
}

let _idn = 0;
export const newStrokeId = () => `ink_${_idn++}`;

/** Shortest distance from point P to segment AB (all in the same space). */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Pick the nearest stroke to a SCREEN tap within thresholdPx, or null.
 * Strokes are stored in norm space; we project them to screen via the current
 * transform so the hit radius is a constant on-screen distance at any zoom.
 */
export function pickStroke(
  strokes: Stroke[], sx: number, sy: number, pageW: number, pageH: number, t: Transform, thresholdPx: number,
): string | null {
  let best: string | null = null;
  let bestD = thresholdPx;
  for (const s of strokes) {
    const scr = s.pts.map((n) => {
      const l = normToLocal(n, pageW, pageH);
      return localToScreen(l.x, l.y, t);
    });
    let d = Infinity;
    if (scr.length === 1) d = Math.hypot(sx - scr[0].x, sy - scr[0].y);
    for (let i = 0; i < scr.length - 1; i++) {
      d = Math.min(d, distToSegment(sx, sy, scr[i].x, scr[i].y, scr[i + 1].x, scr[i + 1].y));
    }
    if (d < bestD) { bestD = d; best = s.id; }
  }
  return best;
}

// ponytail: one runnable self-check on the load-bearing coordinate math.
// Run with:  node -r esbuild-register annotation/pdfAnnotation.ts   (or via the test runner)
export function demo() {
  const assert = (c: boolean, m: string) => {
    if (!c) throw new Error('pdfAnnotation self-check failed: ' + m);
  };
  const t: Transform = { scale: 2.5, tx: 40, ty: -120 };
  // screen<->local round-trips
  for (const [sx, sy] of [[0, 0], [375, 812], [123.4, 999.9]] as const) {
    const l = screenToLocal(sx, sy, t);
    const back = localToScreen(l.x, l.y, t);
    assert(Math.abs(back.x - sx) < 1e-6 && Math.abs(back.y - sy) < 1e-6, 'screen<->local');
  }
  // local<->norm round-trips
  const pageW = 612, pageH = 792;
  for (const [lx, ly] of [[0, 0], [306, 396], [612, 792]] as const) {
    const n = localToNorm(lx, ly, pageW, pageH);
    const back = normToLocal(n, pageW, pageH);
    assert(Math.abs(back.x - lx) < 1e-6 && Math.abs(back.y - ly) < 1e-6, 'local<->norm');
  }
  // a stroke drawn at one transform renders to the SAME page position at another transform
  const t2: Transform = { scale: 0.8, tx: 200, ty: 30 };
  const screenPt: [number, number] = [180, 240];
  const drawnNorm = clampNorm(localToNorm(
    screenToLocal(screenPt[0], screenPt[1], t).x,
    screenToLocal(screenPt[0], screenPt[1], t).y,
    pageW, pageH,
  ));
  // under a different transform t2 the same norm maps to a different SCREEN point
  const l2 = normToLocal(drawnNorm, pageW, pageH);
  const s2 = localToScreen(l2.x, l2.y, t2);
  // but converting that screen point back under t2 yields the original norm (alignment invariant)
  const reNorm = clampNorm(localToNorm(
    screenToLocal(s2.x, s2.y, t2).x,
    screenToLocal(s2.x, s2.y, t2).y,
    pageW, pageH,
  ));
  assert(Math.abs(reNorm.x - drawnNorm.x) < 1e-6 && Math.abs(reNorm.y - drawnNorm.y) < 1e-6, 'norm stable across transforms');
  // pdf user-space y-flip
  const top = normToPdfUserSpace({ x: 0, y: 0 }, pageW, pageH);
  const bottom = normToPdfUserSpace({ x: 0, y: 1 }, pageW, pageH);
  assert(top.y === pageH && bottom.y === 0, 'y-flip to PDF user-space');
  // hit-test: pick a stroke when the tap is near it, miss when far
  const hs: Stroke = { id: 'h', color: '#000', width: 3, pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }] };
  const t3: Transform = { scale: 1, tx: 0, ty: 0 };
  assert(pickStroke([hs], 200, 121, 400, 600, t3, 20) === 'h', 'pickStroke hits near (local y=120)');
  assert(pickStroke([hs], 200, 400, 400, 600, t3, 20) === null, 'pickStroke misses far');
  // hit radius is constant in SCREEN px regardless of zoom
  const tz: Transform = { scale: 3, tx: 0, ty: 0 };
  assert(pickStroke([hs], 600, 363, 400, 600, tz, 20) === 'h', 'pickStroke hits at 3x zoom (screen-space radius)');
  // raster cap (Approach-C crash guard): crisp target below the cap, clamped above it
  const ptsW2 = 612, ptsH2 = 792, baseW2 = 390, dpr2 = 3, safe2 = 4096;
  const lowZoom = rasterScaleFor(1, baseW2, ptsW2, ptsH2, dpr2, safe2);
  assert(Math.abs(lowZoom - (baseW2 / ptsW2) * 1 * dpr2) < 1e-9, 'raster scale uncapped at fit-to-width');
  const highZoom = rasterScaleFor(8, baseW2, ptsW2, ptsH2, dpr2, safe2);
  assert(highZoom * ptsW2 <= safe2 + 1e-6 && highZoom * ptsH2 <= safe2 + 1e-6, 'raster never exceeds SAFE px/side');
  assert(highZoom < (baseW2 / ptsW2) * 8 * dpr2, 'cap actually clamps the deep-zoom request');
  // region crop transform (the Swift rasterizeRegion mirror): region corners -> bitmap corners
  const H = 792, s = 2.5, rxr = 100, ryr = 150, rwr = 200, rhr = 120;
  const m = regionDrawAffine(rxr, ryr, s, H);
  const dev = (dx: number, dy: number) => applyAffine(m, dx, H - dy); // display(y-down) -> PDF(y-up)
  const tl = dev(rxr, ryr);                 // region top-left -> bitmap origin
  const br = dev(rxr + rwr, ryr + rhr);     // region bottom-right -> bitmap far corner
  assert(Math.abs(tl.x) < 1e-6 && Math.abs(tl.y) < 1e-6, 'region TL -> bitmap (0,0)');
  assert(Math.abs(br.x - rwr * s) < 1e-6 && Math.abs(br.y - rhr * s) < 1e-6, 'region BR -> (rw*s, rh*s)');
  const full = regionDrawAffine(0, 0, s, H); // region == full page reduces to the proven recipe
  assert(full.e === 0 && Math.abs(full.f - H * s) < 1e-6, 'full-page region == translate(0,H*s)·scale(s,-s)');
  // visibleLocalRect: clamps to the page, and at 2x shows viewport/2 of local space
  const vr = visibleLocalRect({ scale: 1, tx: 0, ty: 0 }, 400, 600, 400, 520, 0);
  assert(vr.x === 0 && vr.y === 0 && Math.abs(vr.w - 400) < 1e-6 && Math.abs(vr.h - 520) < 1e-6, 'visibleRect clamps to page');
  const vr2 = visibleLocalRect({ scale: 2, tx: 0, ty: 0 }, 400, 600, 1000, 1000, 0);
  assert(Math.abs(vr2.w - 200) < 1e-6 && Math.abs(vr2.h - 300) < 1e-6, 'visibleRect at 2x = viewport/2');
  return 'pdfAnnotation self-check OK';
}
