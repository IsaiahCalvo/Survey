// Extract images: every picture stored in a PDF, saved as its own file.
// JPEGs and JPEG 2000s are copied out byte for byte; fax scans go into a TIFF
// as they are; everything else is decoded and saved as a PNG.
import { PDFBool, PDFDict, PDFRawStream, PDFRef } from 'pdf-lib';
import { ToolError } from './errors.js';
import { loadPdf } from './ops.js';
import {
  N, look, nameOf, numOf, streamData, decodePixels, decodeAlpha, Unsupported,
} from './pdfImages.js';
import { encodePng, writeTiff, deflate } from './imageWriters.js';

// The page's resources, looking up the page tree when the page has none.
export function pageResources(node) {
  for (let n = node, i = 0; n instanceof PDFDict && i < 64; n = n.lookup(N('Parent')), i += 1) {
    const r = n.lookup(N('Resources'));
    if (r instanceof PDFDict) return r;
  }
  return null;
}

// Image streams on one page, in the order they are listed, including those
// inside forms (groups of drawing). `seen` spans the whole file so a logo on
// every page comes out once.
function collect(ctx, resources, seen, out, depth = 0) {
  if (!(resources instanceof PDFDict) || depth > 20) return;
  const xobjects = look(ctx, resources.get(N('XObject')));
  if (!(xobjects instanceof PDFDict)) return;
  for (const [, value] of xobjects.entries()) {
    const key = value instanceof PDFRef ? value.toString() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    const stream = look(ctx, value);
    if (!(stream instanceof PDFRawStream)) continue;
    const type = nameOf(look(ctx, stream.dict.get(N('Subtype'))));
    if (type === 'Image') out.push(stream);
    else if (type === 'Form') collect(ctx, look(ctx, stream.dict.get(N('Resources'))) || resources, seen, out, depth + 1);
  }
}

// A fax-coded picture (CCITT group 4) wrapped in a TIFF without decoding it.
function faxToTiff(ctx, dict, data, parms) {
  const p = parms instanceof PDFDict ? parms : null;
  const k = p ? numOf(ctx, p.get(N('K')), 0) : 0;
  if (k >= 0 || (p && look(ctx, p.get(N('EncodedByteAlign'))) === PDFBool.True)) throw new Unsupported('fax group 3');
  const width = numOf(ctx, dict.get(N('Width')), 0) || numOf(ctx, p?.get(N('Columns')), 1728);
  const height = numOf(ctx, dict.get(N('Height')), 0) || numOf(ctx, p?.get(N('Rows')), 0);
  const blackIs1 = p && look(ctx, p.get(N('BlackIs1'))) === PDFBool.True;
  const decode = look(ctx, dict.get(N('Decode')));
  const flipped = decode && numOf(ctx, decode.get?.(0), 0) === 1;
  return writeTiff([{
    width, height, bitsPerSample: [1], photometric: blackIs1 === !!flipped ? 0 : 1, compression: 4, strips: [data], rowsPerStrip: height, dpi: 200, t4: 0,
  }]);
}

// One image stream -> { ext, bytes, type } or throws Unsupported.
async function saveImage(ctx, stream, zip) {
  const { dict } = stream;
  const { data, codec, parms } = streamData(ctx, stream);
  if (codec === 'DCTDecode') return { ext: 'jpg', bytes: data, type: 'image/jpeg' };
  if (codec === 'JPXDecode') return { ext: 'jp2', bytes: data, type: 'image/jp2' };
  if (codec === 'CCITTFaxDecode') return { ext: 'tif', bytes: faxToTiff(ctx, dict, data, parms), type: 'image/tiff' };
  if (codec) throw new Unsupported(codec);
  const isMask = look(ctx, dict.get(N('ImageMask'))) === PDFBool.True;
  const px = decodePixels(ctx, dict, data);
  const { width, height } = px;
  if (isMask) {
    // A stencil: the shape is drawn in whatever colour is set, so save it as
    // black on see-through.
    const out = new Uint8Array(width * height * 2);
    for (let i = 0; i < width * height; i += 1) out[i * 2 + 1] = px.data[i * 3] < 128 ? 255 : 0;
    return { ext: 'png', bytes: await encodePng({ width, height, channels: 2, data: out }, zip), type: 'image/png' };
  }
  let alpha = null;
  try {
    alpha = decodeAlpha(ctx, dict, data, width, height);
  } catch { /* keep the picture without its see-through parts */ }
  const grey = isGrey(px.data);
  const channels = (grey ? 1 : 3) + (alpha ? 1 : 0);
  const out = new Uint8Array(width * height * channels);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * channels;
    if (grey) out[o] = px.data[i * 3];
    else { out[o] = px.data[i * 3]; out[o + 1] = px.data[i * 3 + 1]; out[o + 2] = px.data[i * 3 + 2]; }
    if (alpha) out[o + channels - 1] = alpha[i];
  }
  const bits = !alpha && grey && numOf(ctx, dict.get(N('BitsPerComponent')), 8) === 1 ? 1 : 8;
  return { ext: 'png', bytes: await encodePng({ width, height, channels, data: out, bits }, zip), type: 'image/png' };
}

function isGrey(rgb) {
  for (let i = 0; i < rgb.length; i += 3) if (rgb[i] !== rgb[i + 1] || rgb[i] !== rgb[i + 2]) return false;
  return true;
}

// -> { files: [{ name, bytes, type }], small, failed }
export async function extractImages(bytes, { prefix = 'image', skipSmall = true, minSide = 32, onPage, zip = deflate } = {}) {
  const doc = await loadPdf(bytes);
  const ctx = doc.context;
  const pages = doc.getPages();
  const seen = new Set();
  const files = [];
  let small = 0;
  let failed = 0;
  for (let p = 0; p < pages.length; p += 1) {
    onPage?.(p, pages.length);
    const list = [];
    collect(ctx, pageResources(pages[p].node), seen, list);
    let k = 0;
    for (const stream of list) {
      const w = numOf(ctx, stream.dict.get(N('Width')), 0);
      const h = numOf(ctx, stream.dict.get(N('Height')), 0);
      if (skipSmall && (w < minSide || h < minSide)) { small += 1; continue; }
      try {
        const img = await saveImage(ctx, stream, zip);
        k += 1;
        files.push({ name: `${prefix}-page-${p + 1}-${k}.${img.ext}`, bytes: img.bytes, type: img.type });
      } catch (err) {
        if (!(err instanceof Unsupported)) console.warn('extract-images:', err);
        failed += 1;
      }
    }
  }
  if (!files.length) {
    if (small) throw new ToolError(`Only small pictures, like icons, were found. Turn off "Skip small images like icons" to save ${small === 1 ? 'it' : 'them'}.`);
    if (failed) throw new ToolError('This PDF has pictures, but they use a kind this tool can\'t save yet.');
    throw new ToolError('No pictures were found in this PDF. If it is a scan, try PDF to JPG instead.');
  }
  return { files, small, failed };
}
