// Compress PDF: re-save photos and scans inside the PDF as smaller JPEGs, pack
// loose streams, and write the file with object streams. Lines and text are
// left alone, so drawings stay sharp. The image codec is passed in (the
// browser one uses a canvas) so this file also runs under Node tests.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFBool } from 'pdf-lib';
import { loadPdf } from './ops.js';

export const LEVELS = {
  light: { quality: 0.82, maxSide: 3000 },
  medium: { quality: 0.68, maxSide: 2000 },
  strong: { quality: 0.5, maxSide: 1400 },
};

const N = (n) => PDFName.of(n);

function single(dict, key) {
  const v = dict.get(N(key));
  if (v instanceof PDFArray) return v.size() === 1 ? v.get(0) : undefined;
  return v;
}

// 3 for RGB, 1 for gray, 0 for anything we won't touch (CMYK, indexed, Lab...).
function components(context, cs) {
  const v = cs instanceof PDFRef ? context.lookup(cs) : cs;
  if (v === N('DeviceRGB')) return 3;
  if (v === N('DeviceGray')) return 1;
  if (v instanceof PDFArray && v.get(0) === N('ICCBased')) {
    const icc = context.lookup(v.get(1));
    const n = icc?.dict?.get(N('N'));
    if (n instanceof PDFNumber && (n.asNumber() === 3 || n.asNumber() === 1)) return n.asNumber();
  }
  return 0;
}

async function pump(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export const deflate = (bytes) => pump(bytes, new CompressionStream('deflate'));
export const inflate = (bytes) => pump(bytes, new DecompressionStream('deflate'));

// codec.reencode({ kind: 'jpeg', bytes } | { kind: 'raw', pixels, components }, { width, height, quality, maxSide })
//   -> Promise<{ bytes, width, height } | null>
export async function compressPdf(bytes, level, codec, onProgress) {
  const opts = LEVELS[level] || LEVELS.medium;
  const doc = await loadPdf(bytes);
  const { context } = doc;

  // Soft masks and stencil masks are greyscale alpha; leave them as they are.
  const masks = new Set();
  const objects = context.enumerateIndirectObjects();
  for (const [, obj] of objects) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!dict) continue;
    for (const key of ['SMask', 'Mask']) {
      const m = dict.get(N(key));
      if (m instanceof PDFRef) masks.add(m.toString());
    }
  }

  let done = 0;
  for (const [ref, obj] of objects) {
    done += 1;
    if (!(obj instanceof PDFRawStream)) continue;
    const { dict } = obj;
    const filter = dict.get(N('Filter'));
    if (dict.get(N('Subtype')) === N('Image')) {
      onProgress?.(done, objects.length);
      const next = await shrinkImage(context, ref, obj, opts, codec, masks);
      if (next) context.assign(ref, next);
      continue;
    }
    // Content streams and fonts some apps write without compression.
    if (!filter && obj.contents.length > 512) {
      const packed = await deflate(obj.contents);
      if (packed.length < obj.contents.length * 0.9) {
        const d = dict.clone(context);
        d.set(N('Filter'), N('FlateDecode'));
        d.delete(N('DecodeParms'));
        context.assign(ref, PDFRawStream.of(d, packed));
      }
    }
  }

  const out = await doc.save({ useObjectStreams: true });
  return out.length < bytes.length ? out : bytes;
}

async function shrinkImage(context, ref, stream, opts, codec, masks) {
  const { dict } = stream;
  if (masks.has(ref.toString())) return null;
  if (dict.get(N('ImageMask')) === PDFBool.True || dict.get(N('Decode')) || dict.get(N('Mask'))) return null;
  const bpc = dict.get(N('BitsPerComponent'));
  if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) return null;
  const comps = components(context, dict.get(N('ColorSpace')));
  if (!comps) return null;
  const width = dict.get(N('Width'))?.asNumber?.();
  const height = dict.get(N('Height'))?.asNumber?.();
  if (!width || !height || width * height < 64 * 64) return null;
  const filter = single(dict, 'Filter');
  const params = single(dict, 'DecodeParms');

  let input;
  if (filter === N('DCTDecode')) {
    const ct = params instanceof PDFDict ? params.get(N('ColorTransform')) : undefined;
    if (ct instanceof PDFNumber && ct.asNumber() === 0 && comps === 3) return null;
    input = { kind: 'jpeg', bytes: stream.contents };
  } else if (filter === N('FlateDecode') && !(params instanceof PDFDict && params.get(N('Predictor')))) {
    let pixels;
    try { pixels = await inflate(stream.contents); } catch { return null; }
    if (pixels.length < width * height * comps) return null;
    input = { kind: 'raw', pixels, components: comps };
  } else {
    return null;
  }

  let result;
  try {
    result = await codec.reencode(input, { width, height, quality: opts.quality, maxSide: opts.maxSide });
  } catch {
    return null;
  }
  if (!result || result.bytes.length >= stream.contents.length * 0.9) return null;

  const d = dict.clone(context);
  d.set(N('Filter'), N('DCTDecode'));
  d.delete(N('DecodeParms'));
  d.set(N('Width'), PDFNumber.of(result.width));
  d.set(N('Height'), PDFNumber.of(result.height));
  d.set(N('ColorSpace'), N(result.gray ? 'DeviceGray' : 'DeviceRGB'));
  d.set(N('BitsPerComponent'), PDFNumber.of(8));
  return PDFRawStream.of(d, result.bytes);
}
