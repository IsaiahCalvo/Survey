// src/utils/versionCompare.js
//
// Old-over-new overlay compare (Drawboard Projects audit item 2, Nightly
// behind 'document-versions'). Each version's page is drawn on white, then
// "lightened" with one ink: black lines turn that ink and white stays white.
// The new page is drawn first and the old one MULTIPLIED over it, so a line
// both versions share comes out black, a line only the old one has stays
// red and a line only the new one has stays blue.

export const COMPARE_OLD_INK = 'rgb(255, 0, 0)';
export const COMPARE_NEW_INK = 'rgb(0, 87, 255)';
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
