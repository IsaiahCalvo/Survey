// Photo or camera to PDF (Drawboard gap, Nightly flag 'photo-upload'): a photo
// picked or taken from Upload, or dropped on the list, becomes a one-page PDF
// and then takes the normal PDF upload path. Each photo is redrawn through a
// canvas first, so a phone photo's EXIF turn is applied (pdf-lib would place it
// sideways), HEIC/WebP/GIF become JPEG, and a huge photo is cut down to a size
// that stays sharp on screen without a 40 MB upload.

export const PHOTO_ACCEPT = 'application/pdf,image/*';
const MAX_SIDE_PX = 4000;
// The page's long side, in points: 11 in, the long side of a Letter sheet.
const PAGE_LONG_SIDE_PT = 792;
const PHOTO_EXT = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;
// Names a camera gives every shot; a dated name is easier to find later.
const GENERIC_NAME = /^(image|photo|capture|camera)$/i;

/** True for an image file (by type, or by name when the type is missing). */
export function isPhotoFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return !type && PHOTO_EXT.test(String(file.name || ''));
}

const pad2 = (n) => String(n).padStart(2, '0');

/** "IMG_2041.jpg" -> "IMG_2041.pdf"; a bare camera name gets the date and time. */
export function photoPdfName(name, now = new Date()) {
  const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[\\/]/g, '-').replace(/[\u0000-\u001f]/g, '').trim();
  if (!base || GENERIC_NAME.test(base)) {
    const day = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    return `Photo ${day} ${pad2(now.getHours())}.${pad2(now.getMinutes())}.pdf`;
  }
  return `${base.slice(0, 196)}.pdf`;
}

/** Pixel size to draw at: never above MAX_SIDE_PX on the long side. */
export function fitPhotoSize(width, height, max = MAX_SIDE_PX) {
  const long = Math.max(width, height);
  if (!(long > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / long);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The DPI that makes the page's long side 11 inches. */
export function photoDpi(width, height) {
  return Math.max(width, height) / (PAGE_LONG_SIDE_PT / 72);
}

// Browser only: decode (EXIF turn applied), shrink, re-encode as JPEG.
async function redrawAsJpeg(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`Survey can't read ${file.name ? `“${file.name}”` : 'that photo'}. Try a JPG or PNG.`);
  }
  try {
    const { width, height } = fitPhotoSize(bitmap.width, bitmap.height);
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d');
    // A see-through PNG would turn black as JPEG; paper is white.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
      : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Survey could not turn that photo into a PDF.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close?.();
  }
}

/**
 * One photo -> a one-page PDF File named after it. `redraw` is swappable for
 * tests (it returns { bytes, width, height } of a JPEG).
 */
export async function photoToPdfFile(file, { now = new Date(), redraw = redrawAsJpeg } = {}) {
  const { bytes, width, height } = await redraw(file);
  const { imagesToPdf } = await import('../tools/ops.js');
  const pdf = await imagesToPdf([{ bytes, type: 'jpg', dpi: photoDpi(width, height) }], { pageSize: 'fit' });
  return new File([pdf], photoPdfName(file.name, now), { type: 'application/pdf' });
}

/**
 * Swaps every photo in `files` for its PDF. Photos that can't be read come
 * back in `failed` with a plain message; everything else passes through.
 */
export async function photosAsPdfs(files, options) {
  const out = [];
  const failed = [];
  for (const file of Array.from(files || [])) {
    if (!isPhotoFile(file)) { out.push(file); continue; }
    try {
      out.push(await photoToPdfFile(file, options));
    } catch (err) {
      failed.push(err?.message || 'Survey could not turn that photo into a PDF.');
    }
  }
  return { files: out, failed };
}
