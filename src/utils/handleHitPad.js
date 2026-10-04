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
 *   - fine pointer (mouse / trackpad): the grabber you can see plus 4 CSS px
 *     all round, and never less than 20 x 20 (w63, 2026-09-28). The first cut
 *     was Drawboard's 34 (we shipped 32): it reached 16 px out from a corner,
 *     so a box-select started just outside a selected mark grabbed a corner
 *     and RESIZED the mark instead. Figma and Acrobat keep the mouse grab area
 *     a few px round the handle; pressing on the page beyond that starts a
 *     box-select.
 *   - coarse pointer (finger / stylus): 44 x 44 CSS px — Apple's minimum touch
 *     target, and the size the polygon vertex grabbers already used. A finger
 *     has no hover and hides what it touches, so it keeps the big pad.
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

// Invisible catch area for one handle, CSS px, mouse / trackpad: the smallest
// pad a mouse gets. w63: 20 = the 11 px corner dot plus ~4.5 px each side.
export const HANDLE_HIT_PAD_FINE_PX = 20;

// Mouse pads also reach this far past the edge of the grabber you can see, so
// a bigger grabber (the 20 px rotate dot) still gets a few px of slack.
export const HANDLE_HIT_PAD_FINE_MARGIN_PX = 4;

// Invisible catch area for one handle, CSS px, finger / stylus.
// Apple HIG minimum (44 pt) — also what the polygon vertex grabbers already used.
export const HANDLE_HIT_PAD_COARSE_PX = 44;

// How far past a mark's real ink a pointer still counts as "on" it, in CSS px
// each side, whatever the zoom and however much the mark was enlarged.
// Owner 2026-10-04 ("I get the blue ring way earlier than when my cursor
// touches it"): the old band was a 12-unit stroke in the MARK's own units, so
// zoom and an enlarged mark's scale both widened it (a pen stroke scaled 4x
// caught the pointer ~24 page units off its ink). A finger keeps a wider band
// (it cannot hover, and it is not a fine pointer).
export const MARK_HIT_TOLERANCE_FINE_PX = 4;
export const MARK_HIT_TOLERANCE_COARSE_PX = 12;

/**
 * Base pad for the current pointer kind, in CSS px.
 * @param {boolean} isCoarsePointer true when the primary pointer is a finger.
 */
export function getHandleHitPadPx(isCoarsePointer) {
  return isCoarsePointer ? HANDLE_HIT_PAD_COARSE_PX : HANDLE_HIT_PAD_FINE_PX;
}

/**
 * Hit tolerance past the ink, in CSS px, for the current pointer kind.
 * @param {boolean} isCoarsePointer true when the primary pointer is a finger.
 */
export function getMarkHitTolerancePx(isCoarsePointer) {
  return isCoarsePointer ? MARK_HIT_TOLERANCE_COARSE_PX : MARK_HIT_TOLERANCE_FINE_PX;
}

/**
 * Width of a mark's invisible hit stroke, in the units that stroke is drawn
 * in: the ink's own drawn width plus a fixed screen tolerance each side.
 * Hover (halo), click-select and the Pan / tool hit test all read this one
 * band, so they always agree.
 *
 * @param {object} opts
 * @param {number} opts.inkWidth    the visible stroke width, same units
 * @param {number} opts.unitsPerPx  the stroke's units per CSS px: the layer's
 *   inverseScale for page units, inverseScale / scale under a scaling
 *   transform, 1 for a non-scaling-stroke
 * @param {boolean} [opts.isCoarsePointer]
 */
export function getMarkHitBandWidth({ inkWidth = 0, unitsPerPx = 1, isCoarsePointer = false } = {}) {
  const ink = Math.max(0, Number(inkWidth) || 0);
  const perPx = Number(unitsPerPx);
  const safePerPx = Number.isFinite(perPx) && perPx > 0 ? perPx : 1;
  return ink + 2 * getMarkHitTolerancePx(isCoarsePointer) * safePerPx;
}

/**
 * The largest axis scale of an SVG `matrix(a b c d e f)` transform — how much
 * one unit inside it grows on the page along its most-stretched axis (an
 * enlarged mark is often stretched more one way than the other). Dividing the
 * screen tolerance by this keeps the band within the tolerance in every
 * direction. 1 for anything that is not a matrix.
 */
export function getSvgMatrixMaxScale(transform) {
  const match = /matrix\(\s*([^)]*)\)/.exec(String(transform || ''));
  if (!match) return 1;
  const [a, b, c, d] = match[1].split(/[\s,]+/).map(Number);
  const scale = Math.max(Math.hypot(a, b), Math.hypot(c, d));
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
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
 * @param {number} opts.basePadPx        pad we would like (mouse: grabber + 8, min 20; finger: 44)
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
  const floorPx = Number.isFinite(floor) ? floor / safeInv : 0;
  // A mouse pad is the visible grabber plus a small margin, never below the
  // fine base; a finger always gets its full 44.
  const basePadPx = isCoarsePointer
    ? getHandleHitPadPx(true)
    : Math.max(getHandleHitPadPx(false), floorPx + HANDLE_HIT_PAD_FINE_MARGIN_PX * 2);
  const padPx = resolveHandleHitPadSize({
    basePadPx,
    neighbourSpacingPx: Number.isFinite(spacing) ? spacing / safeInv : undefined,
    minPadPx: floorPx,
  });
  return padPx * safeInv;
}
