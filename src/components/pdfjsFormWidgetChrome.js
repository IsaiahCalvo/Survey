/**
 * pdfjsFormWidgetChrome — page-unit geometry for a pdf.js form widget's
 * outlines and its checkbox tick.
 *
 * WHY THIS EXISTS (zoom lock, round 2 — 2026-09-15)
 * -------------------------------------------------
 * Round 1 re-expressed every widget outline as
 * `calc(<page units> * var(--total-scale-factor) * 1px)`. That is the right
 * NUMBER carried by the wrong MECHANISM: Chromium quantises a used CSS
 * `border-width` to whole DEVICE pixels before it paints it. Measured live on
 * the zoom ladder at dpr 2, a 1-page-unit widget outline painted 0.5 CSS px
 * from 48% all the way through 94% and then jumped in steps — a 1.9x spread in
 * painted-width-per-page-unit across 24%–447%, while every SVG annotation
 * stroke on the same page held its page ratio to 1e-6. The checkbox tick
 * inherited the same error twice over: it was a background image sized at 82%
 * of a padding box that those quantised borders were eating into, so its extent
 * swung 13–31% relative to the page.
 *
 * `quantiseCssBorderPx` below IS that defect, kept executable so the zoom-lock
 * tests can show the old mechanism could not have held at any number, and so a
 * future reader can re-derive the measurement without a browser.
 *
 * THE RULE NOW
 * ------------
 * A widget's outlines and its tick are SVG geometry in PAGE UNITS, inside an
 * `<svg viewBox="0 0 pageW pageH">` that fills the widget's own <section>.
 * Nothing about the painted width is computed from the zoom: the viewBox maps
 * page units onto whatever size the section currently is, which is exactly the
 * mechanism (and the exact 1e-6 result) SVGAnnotationLayer already gives every
 * other annotation kind. `pageWidth`/`pageHeight` come from the percentage
 * pdf.js itself wrote on the section, so the box is the widget's true page box
 * at every zoom and never a measured (and therefore rounded) one.
 */

// The tick is the same check mark the old `background-image` data-URI drew, in
// the same 16-unit design space, so the glyph is the one the app has always
// shown — only its sizing changed.
export const TICK_DESIGN_BOX = 16;
export const TICK_DESIGN_POINTS = [[3, 8.3], [6.3, 12], [13, 4]];
export const TICK_DESIGN_STROKE = 2.2;
// `background-size: 82% 82%` of the control's padding box, preserved verbatim.
export const TICK_EXTENT_RATIO = 0.82;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * One stroked rectangle, drawn INSIDE the widget box the way a CSS border is:
 * a stroke of width `sw` centred on `offset + sw / 2` occupies exactly
 * [offset, offset + sw] of the box.
 */
const insetRect = (pageWidth, pageHeight, offset, strokeWidth) => {
  const half = strokeWidth / 2;
  return {
    x: offset + half,
    y: offset + half,
    width: Math.max(0, pageWidth - 2 * offset - strokeWidth),
    height: Math.max(0, pageHeight - 2 * offset - strokeWidth),
    strokeWidth,
  };
};

/**
 * Plan a widget's chrome in page units.
 *
 * @param {object} widget
 * @param {number} widget.pageWidth         widget box width, page units
 * @param {number} widget.pageHeight        widget box height, page units
 * @param {number} [widget.containerBorder] pdf.js's /BS outline on the <section>, page units
 * @param {number} [widget.controlBorder]   the control's own outline (our field chrome, or a checkbox /MK border), page units
 * @param {boolean} [widget.tick]           also plan the checkbox check mark
 * @returns {{viewBox: string, outlines: Array, inset: number, tick: object|null}|null}
 */
export function planWidgetChrome({
  pageWidth,
  pageHeight,
  containerBorder = 0,
  controlBorder = 0,
  tick = false,
} = {}) {
  const w = num(pageWidth);
  const h = num(pageHeight);
  if (!(w > 0) || !(h > 0)) return null;

  const container = Math.max(0, num(containerBorder));
  const control = Math.max(0, num(controlBorder));
  const outlines = [];
  if (container > 0) outlines.push({ kind: 'container', ...insetRect(w, h, 0, container) });
  if (control > 0) outlines.push({ kind: 'control', ...insetRect(w, h, container, control) });

  // Everything the control paints itself (its value, its tick) lives inside
  // both outlines — the same place a border-box CSS border used to put it,
  // except the inset is now an exact page-unit number instead of a rounded one.
  const inset = container + control;
  const innerWidth = Math.max(0, w - 2 * inset);
  const innerHeight = Math.max(0, h - 2 * inset);

  return {
    viewBox: `0 0 ${w} ${h}`,
    pageWidth: w,
    pageHeight: h,
    outlines,
    inset,
    innerWidth,
    innerHeight,
    tick: tick ? planTick(inset, inset, innerWidth, innerHeight) : null,
  };
}

/**
 * The check mark, centred in the control's inner box at 82% of its smaller
 * side — page units in, page units out, so its painted extent per page unit is
 * a constant the zoom never enters.
 */
export function planTick(innerX, innerY, innerWidth, innerHeight) {
  const extent = TICK_EXTENT_RATIO * Math.min(num(innerWidth), num(innerHeight));
  if (!(extent > 0)) return null;
  const k = extent / TICK_DESIGN_BOX;
  const cx = num(innerX) + num(innerWidth) / 2;
  const cy = num(innerY) + num(innerHeight) / 2;
  const points = TICK_DESIGN_POINTS.map(([x, y]) => [
    cx + (x - TICK_DESIGN_BOX / 2) * k,
    cy + (y - TICK_DESIGN_BOX / 2) * k,
  ]);
  return {
    points,
    pointsAttr: points.map(([x, y]) => `${x},${y}`).join(' '),
    strokeWidth: TICK_DESIGN_STROKE * k,
    // The designed extent of the glyph box, so a test can state the invariant
    // ("tick extent per 1000 page units") without re-deriving it from points.
    extent,
  };
}

/**
 * THE DEFECT, as a function. Chromium paints a CSS border at whole device
 * pixels: the used width is floored to a device pixel and clamped to at least
 * one, so a sub-pixel border can only ever be 1 device pixel wide however thin
 * it asked to be, and it steps rather than scales on the way up.
 *
 * Derived from and confirmed against the live ladder at dpr 2, where a
 * 1-page-unit border painted 0.5 CSS px at 48%, 60%, 75% and 94% (floor(0.96),
 * floor(1.20), floor(1.50), floor(1.88) all land on 1 device px) and 1.0 CSS px
 * at 117%. Kept here, unused by the app, purely as the thing the tests measure
 * the new mechanism against.
 */
export function quantiseCssBorderPx(cssPx, devicePixelRatio = 1) {
  const px = num(cssPx);
  const dpr = num(devicePixelRatio, 1) || 1;
  if (!(px > 0)) return 0;
  return Math.max(1, Math.floor(px * dpr)) / dpr;
}

/**
 * The new mechanism, as a function: an SVG stroke inside a page-unit viewBox
 * paints `pageUnits * scale` CSS px at any device pixel ratio, because the
 * browser rasterises the stroke as geometry instead of snapping a box edge.
 * Trivial by construction — which is the point.
 */
export function paintedStrokePx(pageUnits, scale) {
  return num(pageUnits) * num(scale);
}
