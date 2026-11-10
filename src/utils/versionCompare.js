// src/utils/versionCompare.js
//
// Old-over-new overlay compare (Drawboard Projects audit item 2, Nightly
// behind 'document-versions'). Each version's page is drawn on white, then
// "lightened" with one ink: black lines turn that ink and white stays white.
// The newest page is drawn first and each older one MULTIPLIED over it, so a
// line they share comes out black and a line only one has keeps its ink.
//
// Trial audit 2026-11-09: like Drawboard, the new version is red and the old
// one blue by default, each layer can take its own ink, and an older layer
// can be moved, scaled and turned to line up a sheet plotted differently.
// Up to three older versions can be laid over the newest at once.

export const OVERLAY_INKS = Object.freeze([
  Object.freeze({ key: 'red', label: 'Red', rgb: 'rgb(255, 0, 0)' }),
  Object.freeze({ key: 'blue', label: 'Blue', rgb: 'rgb(0, 87, 255)' }),
  Object.freeze({ key: 'green', label: 'Green', rgb: 'rgb(0, 160, 60)' }),
  Object.freeze({ key: 'magenta', label: 'Magenta', rgb: 'rgb(214, 0, 214)' }),
  Object.freeze({ key: 'orange', label: 'Orange', rgb: 'rgb(255, 128, 0)' }),
]);
export const COMPARE_NEW_INK = OVERLAY_INKS[0].rgb;
export const COMPARE_OLD_INK = OVERLAY_INKS[1].rgb;
export const MAX_OVERLAYS = 3;
export const OVERLAY_MIN_SCALE = 0.1;
export const OVERLAY_MAX_SCALE = 10;

export function inkRgb(key) {
  return (OVERLAY_INKS.find((ink) => ink.key === key) || OVERLAY_INKS[0]).rgb;
}

/** The first ink none of the used layers has, for a newly added layer. */
export function nextFreeInk(usedKeys) {
  const used = new Set(usedKeys || []);
  return (OVERLAY_INKS.find((ink) => !used.has(ink.key)) || OVERLAY_INKS[1]).key;
}

/** A new older layer: no move, full size, not turned. */
export function makeOverlayLayer(version, usedKeys) {
  return { version, ink: nextFreeInk(usedKeys), visible: true, offset: { x: 0, y: 0 }, scale: 1, rotation: 0 };
}

/** A typed scale in percent, kept in range; junk falls back to 100%. */
export function clampOverlayScale(scale) {
  const s = Number(scale);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(OVERLAY_MAX_SCALE, Math.max(OVERLAY_MIN_SCALE, s));
}

/** Any angle in degrees, as -180 < a <= 180. */
export function normalizeRotation(degrees) {
  const d = Number(degrees);
  if (!Number.isFinite(d)) return 0;
  let a = d % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return Object.is(a, -0) ? 0 : a;
}

/**
 * Canvas transform [a, b, c, d, e, f] for an older layer, in canvas pixels:
 * scale and turn it about the page centre, then move it by its offset.
 */
export function layerMatrix({ offset, scale = 1, rotation = 0 } = {}, { pixelsPerPoint = 1, centerX = 0, centerY = 0 } = {}) {
  const s = clampOverlayScale(scale);
  const r = (normalizeRotation(rotation) * Math.PI) / 180;
  const cos = Math.cos(r) * s;
  const sin = Math.sin(r) * s;
  const tx = (offset?.x || 0) * pixelsPerPoint;
  const ty = (offset?.y || 0) * pixelsPerPoint;
  const round = (n) => (Math.abs(n) < 1e-9 ? 0 : n);
  return [
    round(cos), round(sin), round(-sin), round(cos),
    round(centerX - cos * centerX + sin * centerY + tx),
    round(centerY - sin * centerX - cos * centerY + ty),
  ];
}
export const COMPARE_NUDGE_PT = 1;
export const COMPARE_NUDGE_BIG_PT = 10;
export const COMPARE_MIN_ZOOM = 0.25;
export const COMPARE_MAX_ZOOM = 6;

/** Pages to step through: as many as the longer version has. */
export function comparePageCount(oldPages, newPages) {
  return Math.max(Number(oldPages) || 0, Number(newPages) || 0);
}

/** The zoom that fits a page box into the view, both in the same units. */
export function fitZoom(pageWidth, pageHeight, viewWidth, viewHeight) {
  if (!(pageWidth > 0 && pageHeight > 0 && viewWidth > 0 && viewHeight > 0)) return 1;
  return clampZoom(Math.min(viewWidth / pageWidth, viewHeight / pageHeight));
}

export function clampZoom(zoom) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return 1;
  return Math.min(COMPARE_MAX_ZOOM, Math.max(COMPARE_MIN_ZOOM, z));
}

/** The old layer's offset after an arrow key: Shift moves 10 points. */
export function nudgeOffset(offset, key, big = false) {
  const step = big ? COMPARE_NUDGE_BIG_PT : COMPARE_NUDGE_PT;
  const { x = 0, y = 0 } = offset || {};
  switch (key) {
    case 'ArrowLeft': return { x: x - step, y };
    case 'ArrowRight': return { x: x + step, y };
    case 'ArrowUp': return { x, y: y - step };
    case 'ArrowDown': return { x, y: y + step };
    default: return { x, y };
  }
}

/** Paint a rendered page (black on white) in one ink, in place. */
export function inkCanvas(ctx, width, height, ink) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighten';
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Draw the overlay: `newLayer` and `oldLayer` are inked canvases (or null when
 * that version has no such page or is hidden); `offset` is the old layer's
 * nudge in page points and `pixelsPerPoint` the canvases' scale.
 */
export function composeOverlay(ctx, { width, height, newLayer, oldLayer, offset, pixelsPerPoint }) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.fillRect(0, 0, width, height);
  if (newLayer) ctx.drawImage(newLayer, 0, 0);
  if (oldLayer) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(oldLayer, (offset?.x || 0) * pixelsPerPoint, (offset?.y || 0) * pixelsPerPoint);
  }
  ctx.restore();
}

/**
 * Several older layers over the newest: `layers` = [{ canvas, offset, scale,
 * rotation }], each drawn multiplied with its own move, size and turn about
 * the page centre.
 */
export function composeLayers(ctx, { width, height, base, layers, pixelsPerPoint }) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.fillRect(0, 0, width, height);
  if (base) ctx.drawImage(base, 0, 0);
  for (const layer of layers || []) {
    if (!layer?.canvas) continue;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.setTransform(...layerMatrix(layer, { pixelsPerPoint, centerX: width / 2, centerY: height / 2 }));
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
