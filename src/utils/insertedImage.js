// Nightly 'insert-image' (Drawboard parity, t2-tools-deep.md gap 4): a picture
// from a file or the clipboard placed on the page as a mark. It is a stamp
// mark with an image (the same shape as a PDF's own image stamp), so it draws,
// prints, exports as a PDF Stamp annotation and syncs like the others; unlike
// an imported stamp it moves, resizes and rotates like a shape.
import { isPdfStampProxy } from './pdfStampProxy.js';

// The picture is shrunk to at most this many pixels on its longer side and
// this many bytes as a data URL, so a phone photo does not swell the document.
export const INSERTED_IMAGE_MAX_PX = 1600;
export const INSERTED_IMAGE_MAX_BYTES = 700 * 1024;
// It lands at its own size (96 px to the inch) but no bigger than this, in pt.
export const INSERTED_IMAGE_MAX_PT = 240;
export const INSERTED_IMAGE_ID_PREFIX = 'inserted-image:';

export const isInsertedImage = (obj) => isPdfStampProxy(obj) && obj?.data?.insertedImage === true;

/** Pixel size to draw a w x h picture at, inside maxPx on its longer side. */
export function fitPixels(w, h, maxPx = INSERTED_IMAGE_MAX_PX) {
  const W = Math.max(1, Math.round(Number(w) || 1));
  const H = Math.max(1, Math.round(Number(h) || 1));
  const k = Math.min(1, maxPx / Math.max(W, H));
  return { width: Math.max(1, Math.round(W * k)), height: Math.max(1, Math.round(H * k)) };
}

/** Page size (pt) a w x h pixel picture lands at. */
export function landingSize(w, h, maxPt = INSERTED_IMAGE_MAX_PT) {
  const ptW = (Number(w) || 1) * 0.75;
  const ptH = (Number(h) || 1) * 0.75;
  const k = Math.min(1, maxPt / Math.max(ptW, ptH));
  return { width: Math.round(ptW * k * 100) / 100, height: Math.round(ptH * k * 100) / 100 };
}

const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/**
 * The picture as a library-like item ({ id, name, payload }) so the library's
 * placement drops it: one save, one Undo step, and it becomes the selection.
 */
export function insertedImageItem({ src, pixelWidth, pixelHeight, name = 'Image', id = newId() }) {
  if (typeof src !== 'string' || !/^data:image\/(png|jpeg);base64,/i.test(src)) return null;
  const { width, height } = landingSize(pixelWidth, pixelHeight);
  const object = {
    id,
    type: 'image',
    src,
    pdfAnnotationType: 'Stamp',
    left: 0,
    top: 0,
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    selectable: true,
    evented: true,
    data: { id, insertedImage: true },
  };
  return {
    id: `${INSERTED_IMAGE_ID_PREFIX}${id}`,
    name,
    kinds: ['image'],
    tags: [],
    builtIn: true,
    payload: {
      version: 1,
      pageWidth: 612,
      pageHeight: 792,
      extent: { left: 0, top: 0, width, height },
      items: [{ kind: 'mark', object }],
    },
  };
}

/** Image bytes from a JPEG data URL (PNG ones go through pngDataUrlToBytes). */
export const jpegDataUrlToBytes = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const binary = typeof atob === 'function'
    ? atob(match[1].replace(/\s/g, ''))
    : Buffer.from(match[1], 'base64').toString('binary');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
