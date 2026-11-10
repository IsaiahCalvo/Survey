// Nightly 'insert-image' (Drawboard parity): the Text group's Image button
// picks a picture file, and a picture pasted from the clipboard (Ctrl/Cmd+V
// with no text field focused) lands where the pointer is over a page, else in
// the middle of the page in view. See utils/insertedImage.js for the mark.
import { useEffect } from 'react';
import { placeLibraryItem } from '../markLibrary/markLibraryPlacement.js';
import { isTypingTarget } from '../utils/typingTarget.js';
import {
  INSERTED_IMAGE_MAX_BYTES,
  INSERTED_IMAGE_MAX_PX,
  fitPixels,
  insertedImageItem,
} from '../utils/insertedImage.js';

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The picture as a PNG (kept for PNGs, which may be see-through) or JPEG data URL within the size caps. */
export async function imageFileToDataUrl(file, { maxPx = INSERTED_IMAGE_MAX_PX, maxBytes = INSERTED_IMAGE_MAX_BYTES } = {}) {
  const bitmap = await decode(file);
  const natural = { width: bitmap.width || bitmap.naturalWidth, height: bitmap.height || bitmap.naturalHeight };
  let size = fitPixels(natural.width, natural.height, maxPx);
  const canvas = document.createElement('canvas');
  const draw = (fill) => {
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (fill) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size.width, size.height); }
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  };
  try {
    if (/png|gif|webp/i.test(file.type || '')) {
      draw(false);
      const png = canvas.toDataURL('image/png');
      if (png.length <= maxBytes) return { src: png, ...natural };
    }
    for (let tries = 0; tries < 6; tries += 1) {
      draw(true);
      for (const quality of [0.85, 0.72, 0.6]) {
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        if (jpeg.length <= maxBytes) return { src: jpeg, ...natural };
      }
      size = { width: Math.max(1, Math.round(size.width * 0.75)), height: Math.max(1, Math.round(size.height * 0.75)) };
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}

/** Place a picture file on the page; `where` as placeLibraryItem takes it. */
export async function insertImageFile(file, where = { center: true }) {
  if (!file || !/^image\//i.test(file.type || '')) return false;
  let picture = null;
  try { picture = await imageFileToDataUrl(file); } catch (error) { console.warn('[insert-image] could not read the picture', error); }
  if (!picture) return false;
  const item = insertedImageItem({
    src: picture.src,
    pixelWidth: picture.width,
    pixelHeight: picture.height,
    name: String(file.name || 'Image').replace(/\.[^.]+$/, '') || 'Image',
  });
  return Boolean(item) && placeLibraryItem(item, where);
}

/** Open the file picker and place the picture chosen. */
export function pickImageToInsert() {
  if (typeof document === 'undefined') return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.setAttribute('data-insert-image-input', 'true');
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) insertImageFile(file);
  }, { once: true });
  document.body.appendChild(input);
  input.click();
}

/** Mount once per open document: a pasted picture becomes an image mark. */
export default function InsertImagePasteHost({ enabled = false }) {
  useEffect(() => {
    if (!enabled) return undefined;
    let pointer = null;
    const onMove = (e) => { pointer = { clientX: e.clientX, clientY: e.clientY }; };
    const onPaste = (e) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      if (document.body.getAttribute('data-readonly') === 'true') return;
      const file = [...(e.clipboardData?.files || [])].find((f) => /^image\//i.test(f.type || ''));
      if (!file) return;
      e.preventDefault();
      insertImageFile(file, pointer || { center: true }).then((done) => {
        // Not over a page: drop it in the middle of the page in view instead.
        if (!done && pointer) insertImageFile(file, { center: true });
      });
    };
    window.addEventListener('pointermove', onMove, true);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('paste', onPaste);
    };
  }, [enabled]);
  return null;
}
