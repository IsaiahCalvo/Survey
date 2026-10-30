// Browser-only helpers for the free tools: canvas image codec, pdf.js page
// rendering, image preparation and saving files.
import { loadPdfjs } from '../utils/pdfWorkerConfig.js';
import { pdfjsAssetOptions } from '../utils/pdfjsAssets.js';
import { ToolError } from './errors.js';
import { qpdfRunner } from './qpdf.js';
import { jpegInfo } from './jpeg.js';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function canvasToBytes(canvas, type, quality) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type, quality })
    : await new Promise((res) => canvas.toBlob(res, type, quality));
  if (!blob) throw new ToolError('This device ran out of memory making the image.');
  return new Uint8Array(await blob.arrayBuffer());
}

function releaseCanvas(c) {
  c.width = 0;
  c.height = 0;
}

// A JPEG of `width` x `height` decoded at no less than `want` pixels wide:
// the browser's ImageDecoder can decode at 1/8, 2/8 ... of full size and skips
// most of the work for a small one. (It rounds a size it is asked for down to
// one of those, so ask for the one at or above what is needed.) Resolves to a
// VideoFrame to draw and close, or null when this browser has no ImageDecoder
// or can't read the JPEG.
async function decodeJpegNear(bytes, width, height, want) {
  if (typeof ImageDecoder === 'undefined') return null;
  const eighths = Math.ceil((8 * want) / width);
  const size = eighths < 8 ? { desiredWidth: Math.ceil((width * eighths) / 8), desiredHeight: Math.ceil((height * eighths) / 8) } : {};
  let decoder;
  try {
    // pdf.js ignores colour profiles inside a JPEG, so this does too.
    decoder = new ImageDecoder({ data: bytes, type: 'image/jpeg', colorSpaceConversion: 'none', ...size });
    return (await decoder.decode()).image;
  } catch {
    return null;
  } finally {
    decoder?.close();
  }
}

export const canvasCodec = {
  async reencode(input, { width, height, quality, maxSide }) {
    let source;
    if (input.kind === 'jpeg') {
      // A JPEG whose own size doesn't match the PDF's is left alone.
      const info = jpegInfo(input.bytes);
      if (!info || info.width !== width || info.height !== height || info.orientation !== 1) return null;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      // Decoded at twice the new size or more, so the final shrink keeps the
      // crispness a full-size decode gave (a 1/8-style decode alone is softer).
      source = await decodeJpegNear(input.bytes, width, height, Math.round(width * scale * 2))
        || await createImageBitmap(new Blob([input.bytes], { type: 'image/jpeg' }), { imageOrientation: 'none' });
    } else {
      const rgba = new Uint8ClampedArray(width * height * 4);
      const px = input.pixels;
      for (let i = 0, j = 0; i < width * height; i += 1, j += input.components) {
        const o = i * 4;
        if (input.components === 3) {
          rgba[o] = px[j]; rgba[o + 1] = px[j + 1]; rgba[o + 2] = px[j + 2];
        } else {
          rgba[o] = rgba[o + 1] = rgba[o + 2] = px[j];
        }
        rgba[o + 3] = 255;
      }
      source = await createImageBitmap(new ImageData(rgba, width, height));
    }
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    source.close();
    const bytes = await canvasToBytes(c, 'image/jpeg', quality);
    releaseCanvas(c);
    return { bytes, width: w, height: h };
  },
};

export async function openPdfjs(bytes) {
  const pdfjs = await loadPdfjs();
  // pdf.js takes ownership of the buffer it is given, so it would need a copy
  // of the whole file. Hand it only the parts it asks for instead: a 100 MB
  // scan set then sits in memory once, and pdf.js reads just the pages it draws.
  const range = new pdfjs.PDFDataRangeTransport(bytes.length, null);
  range.requestDataRange = (begin, end) => {
    Promise.resolve().then(() => range.onDataRange(begin, bytes.slice(begin, end)));
  };
  return pdfjs.getDocument({
    range, length: bytes.length, disableAutoFetch: true, disableStream: true, isEvalSupported: false,
    ...pdfjsAssetOptions(pdfjs),
  }).promise;
}

// Let go of a pdf.js document and what its worker holds. pdf.js 6 moved
// destroy() from the document to its loading task.
export function closePdfjs(doc) {
  return doc?.then((d) => (d.loadingTask || d).destroy?.()).catch(() => {});
}

// Safari stops drawing canvases past ~16.7M pixels, so cap every render there.
export const MAX_PIXELS = 16_000_000;

export async function renderPage(pdf, index, { width, scale, extraRotation = 0 } = {}) {
  const page = await pdf.getPage(index + 1);
  const rotation = (page.rotate + extraRotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  let s = scale || width / base.width;
  if (base.width * base.height * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (base.width * base.height));
  const vp = page.getViewport({ scale: s, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, background: 'white' }).promise;
  page.cleanup();
  return canvas;
}

export { releaseCanvas };

// A scanned page (see scanPages.js) drawn straight from its JPEG, at the size
// and turn renderPage would give it; a small picture of a big scan costs a
// fraction of a full decode. Null when this browser has no ImageDecoder; then
// the page is drawn with pdf.js as usual.
export async function renderScan(scan, { width, scale } = {}) {
  if (typeof ImageDecoder === 'undefined') return null;
  const sideways = scan.rotate % 180 !== 0;
  const bw = sideways ? scan.box.height : scan.box.width;
  const bh = sideways ? scan.box.width : scan.box.height;
  let s = scale || width / bw;
  if (bw * bh * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (bw * bh));
  // Same geometry as pdf.js: the canvas is the page size rounded down, and
  // the picture is drawn at the page's exact size.
  const vw = bw * s;
  const vh = bh * s;
  const cw = Math.max(1, Math.floor(vw));
  const ch = Math.max(1, Math.floor(vh));
  const frame = await decodeJpegNear(scan.jpeg, scan.width, scan.height, Math.ceil(scan.box.width * s));
  if (!frame) return null;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingQuality = 'high';
  if (scan.rotate === 90) { ctx.translate(vw, 0); ctx.rotate(Math.PI / 2); }
  else if (scan.rotate === 180) { ctx.translate(vw, vh); ctx.rotate(Math.PI); }
  else if (scan.rotate === 270) { ctx.translate(0, vh); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(frame, 0, 0, scan.box.width * s, scan.box.height * s);
  frame.close();
  return canvas;
}

// What an image file really is, from its first bytes.
export function sniffImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)) return 'tiff';
  return 'other';
}

// EXIF orientation of a JPEG (1 = upright), or 1 when it has none.
export function jpegOrientation(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 4 < v.byteLength) {
    if (v.getUint8(p) !== 0xff) return 1;
    const marker = v.getUint8(p + 1);
    const len = v.getUint16(p + 2);
    if (marker === 0xe1 && v.getUint32(p + 4) === 0x45786966) {
      const t = p + 10;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const count = v.getUint16(ifd, le);
      for (let i = 0; i < count; i += 1) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > v.byteLength) return 1;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    p += 2 + len;
  }
  return 1;
}

// Each page of a TIFF as a PNG pdf-lib can embed, keeping the scan's DPI. The
// decoder loads only when a TIFF turns up.
export async function tiffToImages(bytes, onPage) {
  const { decodeTiff } = await import('./tiff.js');
  const out = [];
  for (const p of decodeTiff(bytes, onPage)) {
    const c = makeCanvas(p.width, p.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.rgba.buffer, p.rgba.byteOffset, p.rgba.byteLength), p.width, p.height), 0, 0);
    p.rgba = null;
    out.push({ bytes: await canvasToBytes(c, 'image/png'), type: 'png', dpi: p.dpi });
    releaseCanvas(c);
  }
  return out;
}

// Every frame of a moving GIF as a PNG. The decoder loads only when needed.
export async function gifToImages(bytes, onFrame) {
  const { decodeGifFrames } = await import('./gif.js');
  const out = [];
  for (const f of decodeGifFrames(bytes, onFrame)) {
    const c = makeCanvas(f.width, f.height);
    c.getContext('2d').putImageData(new ImageData(f.rgba, f.width, f.height), 0, 0);
    out.push({ bytes: await canvasToBytes(c, 'image/png'), type: 'png' });
    releaseCanvas(c);
  }
  return out;
}

// Make any image something pdf-lib can embed: JPEG or PNG, upright. Returns a
// list, since one TIFF can hold many pages.
export async function prepareImage(bytes, mime) {
  if (sniffImage(bytes) === 'tiff') return tiffToImages(bytes);
  return [await prepareOne(bytes, mime)];
}

async function prepareOne(bytes, mime) {
  const kind = sniffImage(bytes);
  if (kind === 'png') return { bytes, type: 'png' };
  if (kind === 'jpg' && jpegOrientation(bytes) === 1) return { bytes, type: 'jpg' };
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime || 'image/*' })).catch(() => null);
  if (!bitmap) throw new ToolError('This image type can\'t be opened in this browser.');
  const c = makeCanvas(bitmap.width, bitmap.height);
  c.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  const out = kind === 'jpg'
    ? { bytes: await canvasToBytes(c, 'image/jpeg', 0.92), type: 'jpg' }
    : { bytes: await canvasToBytes(c, 'image/png'), type: 'png' };
  releaseCanvas(c);
  return out;
}

// data: bytes or a Blob.
export function saveFile(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// qpdf for the password tools; the wasm file is fetched on first use only.
export const runQpdf = qpdfRunner(async () => {
  const [{ default: create }, { default: wasmUrl }] = await Promise.all([
    import('@neslinesli93/qpdf-wasm'),
    import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'),
  ]);
  try {
    return await create({ locateFile: () => wasmUrl, noInitialRun: true });
  } catch {
    throw new ToolError('The password tool couldn\'t load. Check your connection and try again.');
  }
});

// Fonts for Word to PDF when a document has letters the standard PDF fonts
// lack: Noto Sans for most scripts, Droid Sans Fallback for Chinese, Japanese
// and Korean. Both already ship with the app.
export async function loadDocFont(kind) {
  const { default: url } = kind === 'cjk'
    ? await import('../assets/fonts/DroidSansFallback.ttf?url')
    : await import('../assets/fonts/NotoSans-Regular.ttf?url');
  const res = await fetch(url);
  if (!res.ok) throw new ToolError('A font for this document couldn\'t load. Check your connection and try again.');
  return new Uint8Array(await res.arrayBuffer());
}
