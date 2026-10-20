/**
 * smartFillProvider.js — the beta Smart fill provider (owner 2026-10-20).
 *
 * Registers with markerShapeProviders.js when the beta flag is on
 * (smartFillFlag.js). Reads the page as rendered (its <canvas>) in a window
 * around the tap and hands the pixels to smartFillEngine.js. Returns
 * { polygons } in page units, or null with `reason` reported through
 * onNoMatch so the page can say "No outline found".
 */
import { registerMarkerShapeProvider } from './markerShapeProviders.js';
import { findTagOutline, inkMaskFromRgba } from './smartFillEngine.js';

// Window around the tap, page units (1 = 1 PDF point; a tag is ~10-80 pt).
const WINDOW_PAGE_UNITS = 360;
// Pixel cap per side so one tap stays quick on a big zoom.
const MAX_WINDOW_PX = 1200;

export function readSmartFillOutline({ point, pageSize, pageCanvas }) {
  if (!pageCanvas || !pageSize?.width || !pageCanvas.width) return { ok: false, reason: 'not-ready' };
  const pxPerUnit = pageCanvas.width / pageSize.width;
  const half = WINDOW_PAGE_UNITS / 2;
  const left = Math.max(0, point.x - half);
  const top = Math.max(0, point.y - half);
  const right = Math.min(pageSize.width, point.x + half);
  const bottom = Math.min(pageSize.height, point.y + half);
  const srcW = (right - left) * pxPerUnit;
  const srcH = (bottom - top) * pxPerUnit;
  const scale = Math.min(1, MAX_WINDOW_PX / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(pageCanvas, left * pxPerUnit, top * pxPerUnit, srcW, srcH, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = inkMaskFromRgba(data, w, h);
  const unitsPerPx = 1 / (pxPerUnit * scale);
  const found = findTagOutline(mask, w, h, (point.x - left) / unitsPerPx, (point.y - top) / unitsPerPx);
  if (!found.ok) return found;
  const ring = found.ring.map(([x, y]) => [left + x * unitsPerPx, top + y * unitsPerPx]);
  return { ok: true, polygons: { type: 'Polygon', coordinates: [ring] } };
}

export function registerSmartFillProvider({ onNoMatch } = {}) {
  return registerMarkerShapeProvider({
    id: 'smartFill',
    label: 'Smart fill (beta)',
    icon: 'smartFillDrop',
    onPagePointerDown: async (context) => {
      // Let the pending ring paint before the pixel work.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (context.signal?.aborted) return null;
      const result = readSmartFillOutline(context);
      if (result.ok) return { polygons: result.polygons };
      onNoMatch?.(result.reason);
      return null;
    },
  });
}
