/**
 * handleHitPad.js — one rule for how big a selection grabber's INVISIBLE
 * catch area is, everywhere in the app.
 *
 * Intended UX (2026-09-16): a selection handle should be easy to grab without
 * being big enough to cover the mark. Drawboard PDF is the reference — measured
 * 2026-09-16, every one of its eight handles carries a 34 x 34 CSS-px invisible
 * hit rect while the dot you can see is only 11 x 11. Survey's handles used to
 * BE their hit area: the corner dot was grabbable to +-5.5 px and the edge pill
 * was 8 px thick, so a mouse that missed by 6 px hit the page instead and
 * started a new mark.
 *
 * So: the drawn dot keeps exactly the size it has today, and a transparent pad
 * sits behind it.
 *   - fine pointer (mouse / trackpad): 32 x 32 CSS px — Drawboard's 34, minus a
 *     little so two handles on a small mark still resolve to the nearer one.
 *   - coarse pointer (finger / stylus): 44 x 44 CSS px — Apple's minimum touch
 *     target, and the size the polygon vertex grabbers already used.
 *
 * The pad is SCREEN-CONSTANT: it is expressed in CSS px and converted to page
 * units at the call site by multiplying by the (clamped) inverse scale, so it
 * is the same size on screen at 50 % zoom and at 400 %. It never scales with
 * the page — only the mark does (project zoom-scaling convention: handles and
 * hit targets stay screen-constant, annotation visuals scale in page units).
 *
 * Crowding: two pads that overlap would let the wrong handle win wherever they
 * cross. `resolveHandleHitPadSize` shrinks the pad to the spacing between
 * neighbouring handles so the pads tile edge-to-edge instead of stacking, and
 * never shrinks it below the grabber you can actually see.
 */

// Invisible catch area for one handle, CSS px, mouse / trackpad.
// Drawboard PDF measures 34 x 34; 32 keeps a hair of separation on small marks.
export const HANDLE_HIT_PAD_FINE_PX = 32;

// Invisible catch area for one handle, CSS px, finger / stylus.
// Apple HIG minimum (44 pt) — also what the polygon vertex grabbers already used.
export const HANDLE_HIT_PAD_COARSE_PX = 44;

// Transparent stroke painted along a mark so it can be selected by clicking
// near its outline rather than exactly on it. 12 is what every mark ships with
// today (+-6 px either side of the line); a finger gets double that.
export const MARK_HIT_STROKE_FINE_PX = 12;
export const MARK_HIT_STROKE_COARSE_PX = 24;

/**
 * Base pad for the current pointer kind, in CSS px.
 * @param {boolean} isCoarsePointer true when the primary pointer is a finger.
 */
export function getHandleHitPadPx(isCoarsePointer) {
  return isCoarsePointer ? HANDLE_HIT_PAD_COARSE_PX : HANDLE_HIT_PAD_FINE_PX;
}

/**
 * Transparent hit stroke for a mark's outline, in CSS px.
 * @param {boolean} isCoarsePointer true when the primary pointer is a finger.
 */
export function getMarkHitStrokePx(isCoarsePointer) {
  return isCoarsePointer ? MARK_HIT_STROKE_COARSE_PX : MARK_HIT_STROKE_FINE_PX;
}

/**
 * Shrink a pad so neighbouring pads tile instead of overlapping.
 *
 * `neighbourSpacingPx` is the centre-to-centre distance (screen px) from this
 * handle to the nearest OTHER handle. A pad of exactly that size reaches half
 * the distance to its neighbour on each side, so the two pads meet and never
 * cross — a click always resolves to the closer handle. A pad is never taken
 * below `minPadPx`, which callers set to the visible grabber's own size so the
 * dot you can see is always clickable.
 *
 * @param {object} opts
 * @param {number} opts.basePadPx        pad we would like (32 or 44)
 * @param {number} [opts.neighbourSpacingPx] distance to the closest other handle
 * @param {number} [opts.minPadPx]       never go below this (visible grabber size)
 * @returns {number} pad side length in CSS px
 */
export function resolveHandleHitPadSize({
  basePadPx,
  neighbourSpacingPx,
  minPadPx = 0,
}) {
  const base = Number(basePadPx);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const floor = Number.isFinite(Number(minPadPx)) ? Math.max(0, Number(minPadPx)) : 0;
  const spacing = Number(neighbourSpacingPx);
  if (!Number.isFinite(spacing) || spacing <= 0) return Math.max(base, floor);
  return Math.max(floor, Math.min(base, spacing));
}

/**
 * The same pad, already converted to PAGE units so an SVG element drawn in the
 * page coordinate system covers the requested number of screen pixels.
 *
 * `inverseScale` is the layer's page-units-per-screen-px factor (callers pass
 * the clamped value so the pad stops growing on extreme zoom-out, exactly like
 * the visible handles). Spacing and floor are given in page units too, so the
 * crowding rule is asked in screen px and answered in page units.
 *
 * @param {object} opts
 * @param {boolean} opts.isCoarsePointer
 * @param {number} opts.inverseScale             clamped inverse scale
 * @param {number} [opts.neighbourSpacingPageUnits] spacing in PAGE units
 * @param {number} [opts.minPadPageUnits]        floor in PAGE units
 * @returns {number} pad side length in page units
 */
export function resolveHandleHitPadPageSize({
  isCoarsePointer,
  inverseScale,
  neighbourSpacingPageUnits,
  minPadPageUnits = 0,
}) {
  const inv = Number(inverseScale);
  const safeInv = Number.isFinite(inv) && inv > 0 ? inv : 1;
  const spacing = Number(neighbourSpacingPageUnits);
  const floor = Number(minPadPageUnits);
  const padPx = resolveHandleHitPadSize({
    basePadPx: getHandleHitPadPx(isCoarsePointer),
    neighbourSpacingPx: Number.isFinite(spacing) ? spacing / safeInv : undefined,
    minPadPx: Number.isFinite(floor) ? floor / safeInv : 0,
  });
  return padPx * safeInv;
}
