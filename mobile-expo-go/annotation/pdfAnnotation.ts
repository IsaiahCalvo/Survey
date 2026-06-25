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

let _idn = 0;
export const newStrokeId = () => `ink_${_idn++}`;

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
  return 'pdfAnnotation self-check OK';
}
