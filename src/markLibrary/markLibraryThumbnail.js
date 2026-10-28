/**
 * markLibraryThumbnail.js — a picture of a library item for its card, drawn
 * with the same canvas painter as page thumbnails (annotationCanvasPainter),
 * so it looks like the marks on the page. Nothing is stored: pictures are
 * drawn on demand and kept per item version in memory.
 */
import { paintAnnotationCanvas } from '../utils/annotationCanvasPainter.js';
import { annotationImagesReady, preloadAnnotationImages } from '../utils/annotationImageCache.js';

const cache = new Map();
const CACHE_MAX = 400;

/** Page-unit box to draw: the item's box plus room for strokes, arrow heads and labels. */
export function thumbnailFrame(payload) {
  const extent = payload?.extent || { left: 0, top: 0, width: 0, height: 0 };
  const size = Math.max(extent.width, extent.height, 1);
  const pad = Math.max(4, size * 0.08);
  return {
    left: extent.left - pad,
    top: extent.top - pad,
    width: extent.width + pad * 2,
    height: extent.height + pad * 2,
  };
}

function drawMarkers(context, payload, scale, frame) {
  for (const item of payload.items || []) {
    if (item.kind !== 'marker') continue;
    const b = item.entry?.bounds;
    if (!b) continue;
    const color = item.entry.entityColor || item.entry.color || '#4A90E2';
    const x = (Number(b.x) - frame.left) * scale;
    const y = (Number(b.y) - frame.top) * scale;
    const w = Math.max(2, Number(b.width) * scale);
    const h = Math.max(2, Number(b.height) * scale);
    context.save();
    const angle = Number(b.angle) || 0;
    if (angle) {
      context.translate(x + w / 2, y + h / 2);
      context.rotate((angle * Math.PI) / 180);
      context.translate(-(x + w / 2), -(y + h / 2));
    }
    context.globalAlpha = Number.isFinite(Number(item.entry.opacity)) ? Math.max(0.2, Number(item.entry.opacity)) : 0.35;
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
    context.globalAlpha = 1;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, scale);
    context.strokeRect(x, y, w, h);
    context.restore();
  }
}

/**
 * The item's picture as a data URL (PNG), `px` pixels on its longer side.
 * Resolves after any images in the marks have loaded.
 */
export async function libraryThumbnail(item, { px = 160, dpr = (globalThis.devicePixelRatio || 1) } = {}) {
  if (!item?.payload || typeof document === 'undefined') return null;
  const key = `${item.id}:${item.updatedAt || ''}:${px}:${dpr}`;
  if (cache.has(key)) return cache.get(key);
  const payload = item.payload;
  const objects = payload.items.filter((it) => it.kind === 'mark').map((it) => it.object);
  const callouts = payload.items.filter((it) => it.kind === 'callout').map((it) => it.callout);
  if (!annotationImagesReady(objects)) {
    try { await preloadAnnotationImages(objects); } catch { /* draw what loaded */ }
  }
  const frame = thumbnailFrame(payload);
  const longer = Math.max(frame.width, frame.height);
  const backing = Math.round(px * Math.min(2, Math.max(1, dpr)));
  const scale = backing / longer;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    paintAnnotationCanvas(context, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      drawScale: scale,
      displayScale: scale,
      pageWidth: payload.pageWidth,
      pageHeight: payload.pageHeight,
      offsetX: frame.left,
      offsetY: frame.top,
      objects,
      callouts,
    });
    drawMarkers(context, payload, scale, frame);
  } catch (error) {
    console.warn('[markLibrary] thumbnail failed', error?.message || error);
  }
  let url = null;
  try { url = canvas.toDataURL('image/png'); } catch { url = null; }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, url);
  return url;
}
