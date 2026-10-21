// Reading pictures stored inside a PDF: undo the stream filters and PNG/TIFF
// predictors, then turn the samples of any common colour space into plain
// 8-bit grey or RGB pixels. Pure pdf-lib, no DOM, so Node tests cover it.
import {
  PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFRef, PDFString, decodePDFRawStream,
} from 'pdf-lib';

export const N = (n) => PDFName.of(n);
export const look = (ctx, v) => (v instanceof PDFRef ? ctx.lookup(v) : v);
export const nameOf = (v) => (v instanceof PDFName ? v.decodeText() : null);
export const numOf = (ctx, v, d) => {
  const x = look(ctx, v);
  return x instanceof PDFNumber ? x.asNumber() : d;
};
export const listOf = (ctx, v) => {
  const x = look(ctx, v);
  if (x instanceof PDFArray) return x.asArray().map((e) => look(ctx, e));
  return x == null ? [] : [x];
};
const numbers = (ctx, v) => listOf(ctx, v).map((x) => (x instanceof PDFNumber ? x.asNumber() : 0));

// Pictures past this many pixels are left alone rather than risk running a
// phone out of memory (a 10,000 x 10,000 scan is 100M).
export const MAX_IMAGE_PIXELS = 80_000_000;

export class Unsupported extends Error {}

const IMAGE_FILTERS = new Set(['DCTDecode', 'DCT', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode', 'CCF']);
const SHORT_FILTERS = { AHx: 'ASCIIHexDecode', A85: 'ASCII85Decode', LZW: 'LZWDecode', Fl: 'FlateDecode', RL: 'RunLengthDecode', DCT: 'DCTDecode', CCF: 'CCITTFaxDecode' };

export function filtersOf(ctx, dict) {
  const names = listOf(ctx, dict.get(N('Filter')) ?? dict.get(N('F'))).map(nameOf);
  const parms = listOf(ctx, dict.get(N('DecodeParms')) ?? dict.get(N('DP')));
  return names.map((name, i) => ({ name: SHORT_FILTERS[name] || name, parms: parms[i] instanceof PDFDict ? parms[i] : null }));
}

export function bytesOf(ctx, v) {
  const x = look(ctx, v);
  if (x instanceof PDFString || x instanceof PDFHexString) return x.asBytes();
  if (x instanceof PDFRawStream) return streamData(ctx, x).data;
  return null;
}

// Undo every filter except a final picture codec (JPEG, JPEG 2000, JBIG2,
// fax), which is returned as `codec` with its parameters for the caller.
export function streamData(ctx, stream) {
  const fs = filtersOf(ctx, stream.dict);
  const last = fs[fs.length - 1];
  const codec = last && IMAGE_FILTERS.has(last.name) ? last : null;
  const generic = codec ? fs.slice(0, -1) : fs;
  if (generic.some((f) => IMAGE_FILTERS.has(f.name))) throw new Unsupported('codec in the middle');
  let data = stream.contents;
  if (generic.length) {
    const dict = ctx.obj({});
    dict.set(N('Filter'), ctx.obj(generic.map((f) => N(f.name))));
    dict.set(N('DecodeParms'), ctx.obj(generic.map((f) => f.parms || PDFNull)));
    try {
      data = decodePDFRawStream(PDFRawStream.of(dict, data)).decode();
    } catch {
      throw new Unsupported('filter');
    }
    generic.forEach((f, i) => {
      const p = f.parms && numOf(ctx, f.parms.get(N('Predictor')), 1);
      if (!(p > 1)) return;
      if (i !== generic.length - 1) throw new Unsupported('predictor before another filter');
      data = unpredict(data, {
        predictor: p,
        colors: numOf(ctx, f.parms.get(N('Colors')), 1),
        bpc: numOf(ctx, f.parms.get(N('BitsPerComponent')), 8),
        columns: numOf(ctx, f.parms.get(N('Columns')), 1),
      });
    });
  }
  return { data, codec: codec?.name ?? null, parms: codec?.parms ?? null };
}

// PNG predictors (10-15, a filter byte per row) and TIFF predictor 2.
export function unpredict(data, { predictor, colors = 1, bpc = 8, columns = 1 }) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  if (predictor === 2) {
    if (bpc !== 8 && bpc !== 16) throw new Unsupported('TIFF predictor bits');
    const out = Uint8Array.from(data);
    const rows = Math.floor(out.length / rowLen);
    for (let r = 0; r < rows; r += 1) {
      const o = r * rowLen;
      if (bpc === 8) {
        for (let i = colors; i < rowLen; i += 1) out[o + i] = (out[o + i] + out[o + i - colors]) & 0xff;
      } else {
        for (let i = colors * 2; i + 1 < rowLen; i += 2) {
          const v = ((out[o + i] << 8) | out[o + i + 1]) + ((out[o + i - colors * 2] << 8) | out[o + i - colors * 2 + 1]);
          out[o + i] = (v >> 8) & 0xff;
          out[o + i + 1] = v & 0xff;
        }
      }
    }
    return out;
  }
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r += 1) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const o = r * rowLen;
    for (let i = 0; i < rowLen; i += 1) {
      const a = i >= bpp ? out[o + i - bpp] : 0;
      const b = r ? out[o - rowLen + i] : 0;
      const c = r && i >= bpp ? out[o - rowLen + i - bpp] : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[o + i] = (data[src + i] + pred) & 0xff;
    }
  }
  return out;
}

// ---------------------------------------------------------------- colour

// What a colour space is, in the terms this file and the grey tool need:
// { kind: 'gray'|'rgb'|'cmyk'|'lab'|'indexed'|'separation'|'devicen'|'pattern'|'unknown', n, ... }
export function describeSpace(ctx, cs) {
  const v = look(ctx, cs);
  const name = nameOf(v);
  if (name) {
    if (name === 'DeviceGray' || name === 'G' || name === 'CalGray') return { kind: 'gray', n: 1 };
    if (name === 'DeviceRGB' || name === 'RGB' || name === 'CalRGB') return { kind: 'rgb', n: 3 };
    if (name === 'DeviceCMYK' || name === 'CMYK') return { kind: 'cmyk', n: 4 };
    if (name === 'Pattern') return { kind: 'pattern', n: 0 };
    return { kind: 'unknown', n: 0 };
  }
  if (!(v instanceof PDFArray) || !v.size()) return { kind: 'unknown', n: 0 };
  const family = nameOf(look(ctx, v.get(0)));
  const arg = (i) => look(ctx, v.get(i));
  switch (family) {
    case 'CalGray': return { kind: 'gray', n: 1 };
    case 'CalRGB': return { kind: 'rgb', n: 3 };
    case 'Lab': {
      const d = arg(1);
      const wp = d instanceof PDFDict ? numbers(ctx, d.get(N('WhitePoint'))) : [];
      const range = d instanceof PDFDict ? numbers(ctx, d.get(N('Range'))) : [];
      return { kind: 'lab', n: 3, white: wp.length === 3 ? wp : [0.9505, 1, 1.089], range: range.length === 4 ? range : [-100, 100, -100, 100] };
    }
    case 'ICCBased': {
      const s = arg(1);
      const dict = s instanceof PDFRawStream ? s.dict : s instanceof PDFDict ? s : null;
      const n = dict ? numOf(ctx, dict.get(N('N')), 0) : 0;
      if (n === 1) return { kind: 'gray', n, icc: true };
      if (n === 3) return { kind: 'rgb', n, icc: true };
      if (n === 4) return { kind: 'cmyk', n, icc: true };
      const alt = dict?.get(N('Alternate'));
      return alt ? describeSpace(ctx, alt) : { kind: 'unknown', n: 0 };
    }
    case 'Indexed': case 'I': {
      const base = describeSpace(ctx, v.get(1));
      return { kind: 'indexed', n: 1, base, hival: numOf(ctx, v.get(2), 0), lookup: bytesOf(ctx, v.get(3)) || new Uint8Array(0) };
    }
    case 'Separation': return { kind: 'separation', n: 1, alt: describeSpace(ctx, v.get(2)), fn: v.get(3), colorant: nameOf(arg(1)) };
    case 'DeviceN': return { kind: 'devicen', n: listOf(ctx, v.get(1)).length, alt: describeSpace(ctx, v.get(2)), fn: v.get(3) };
    case 'Pattern': return { kind: 'pattern', n: 0, base: v.size() > 1 ? describeSpace(ctx, v.get(1)) : null };
    case 'DeviceGray': case 'DeviceRGB': case 'DeviceCMYK': return describeSpace(ctx, v.get(0));
    default: return { kind: 'unknown', n: 0 };
  }
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Components (0..1 or Lab units) -> grey 0..1. These are the formulas the
// grey tool writes into PDFs too, so pictures and drawn shapes match.
export const toGray = {
  gray: (c) => clamp01(c[0]),
  rgb: (c) => clamp01(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]),
  cmyk: (c) => clamp01(1 - Math.min(1, 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2] + c[3])),
  lab: (c) => clamp01(c[0] / 100),
};

const srgbGamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

// Components -> [r, g, b] 0..1.
function toRgbFn(space) {
  switch (space.kind) {
    case 'gray': return (c) => [c[0], c[0], c[0]];
    case 'rgb': return (c) => c;
    case 'cmyk': return (c) => [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
    case 'lab': {
      const [xw, yw, zw] = space.white;
      const f = (t) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
      return ([L, a, b]) => {
        const fy = (L + 16) / 116;
        const X = xw * f(fy + a / 500); const Y = yw * f(fy); const Z = zw * f(fy - b / 200);
        return [
          srgbGamma(3.2406 * X - 1.5372 * Y - 0.4986 * Z),
          srgbGamma(-0.9689 * X + 1.8758 * Y + 0.0415 * Z),
          srgbGamma(0.0557 * X - 0.204 * Y + 1.057 * Z),
        ].map(clamp01);
      };
    }
    // A spot colour with no way to work out its real look: show its strength.
    case 'separation': return (c) => [1 - c[0], 1 - c[0], 1 - c[0]];
    default: throw new Unsupported(`colour space ${space.kind}`);
  }
}

// Palette of an indexed space as RGB bytes, (hival + 1) * 3 long.
function paletteRgb(space) {
  const { base, hival, lookup } = space;
  const conv = toRgbFn(base);
  const out = new Uint8Array((hival + 1) * 3);
  for (let i = 0; i <= hival; i += 1) {
    const c = [];
    for (let k = 0; k < base.n; k += 1) {
      const raw = (lookup[i * base.n + k] ?? 0) / 255;
      if (base.kind === 'lab') c.push(k === 0 ? raw * 100 : base.range[(k - 1) * 2] + raw * (base.range[(k - 1) * 2 + 1] - base.range[(k - 1) * 2]));
      else c.push(raw);
    }
    const rgb = conv(c);
    for (let k = 0; k < 3; k += 1) out[i * 3 + k] = Math.round(clamp01(rgb[k]) * 255);
  }
  return out;
}

function defaultDecode(space, bpc) {
  if (space.kind === 'indexed') return [0, (1 << bpc) - 1];
  if (space.kind === 'lab') return [0, 100, ...space.range];
  return Array(space.n).fill(0).flatMap(() => [0, 1]);
}

// Read sample i of row y (bpc 1, 2, 4, 8 or 16) as an integer.
function sampler(data, rowBytes, bpc) {
  if (bpc === 8) return (y, i) => data[y * rowBytes + i] ?? 0;
  if (bpc === 16) return (y, i) => data[y * rowBytes + i * 2] ?? 0; // top byte is plenty
  const per = 8 / bpc;
  const mask = (1 << bpc) - 1;
  return (y, i) => ((data[y * rowBytes + Math.floor(i / per)] ?? 0) >> (8 - bpc * ((i % per) + 1))) & mask;
}

// An image XObject's pixels as { width, height, channels: 1|3, data } with
// 8 bits a channel. `gray: true` asks for one channel whatever the source.
// `data` is the stream after filters (streamData), so not JPEG and friends.
export function decodePixels(ctx, dict, data, { gray = false } = {}) {
  const width = numOf(ctx, dict.get(N('Width')) ?? dict.get(N('W')), 0);
  const height = numOf(ctx, dict.get(N('Height')) ?? dict.get(N('H')), 0);
  if (!(width > 0 && height > 0)) throw new Unsupported('no size');
  if (width * height > MAX_IMAGE_PIXELS) throw new Unsupported('too big');
  const isMask = look(ctx, dict.get(N('ImageMask')) ?? dict.get(N('IM'))) === PDFBool.True;
  const space = isMask ? { kind: 'gray', n: 1 } : describeSpace(ctx, dict.get(N('ColorSpace')) ?? dict.get(N('CS')));
  const bpc = isMask ? 1 : numOf(ctx, dict.get(N('BitsPerComponent')) ?? dict.get(N('BPC')), 8);
  if (![1, 2, 4, 8, 16].includes(bpc)) throw new Unsupported('bits');
  const n = space.kind === 'indexed' ? 1 : space.n;
  if (!n) throw new Unsupported(`colour space ${space.kind}`);
  const conv = space.kind === 'indexed' ? null : toRgbFn(space);
  const palette = space.kind === 'indexed' ? paletteRgb(space) : null;
  let decode = numbers(ctx, dict.get(N('Decode')) ?? dict.get(N('D')));
  if (decode.length !== n * 2) decode = defaultDecode(space, bpc);
  const max = bpc === 16 ? 255 : (1 << bpc) - 1;
  const rowBytes = Math.ceil((width * n * bpc) / 8);
  const read = sampler(data, rowBytes, bpc);
  const channels = gray ? 1 : 3;
  const out = new Uint8Array(width * height * channels);

  // Plain 8-bit grey or RGB with the usual Decode is most pictures: copy it.
  const plain = bpc === 8 && (space.kind === 'gray' || space.kind === 'rgb') && decode.every((d, i) => d === i % 2);
  if (plain && (n === channels || n === 1)) {
    if (n === channels) out.set(data.subarray(0, out.length));
    else for (let i = 0; i < width * height; i += 1) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = data[i] ?? 0;
    return { width, height, channels, data: out };
  }

  const c = new Array(n);
  // Remember the last colour: drawings repeat the same few over and over.
  let lastKey = -1;
  let last = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let rgb;
      if (palette) {
        const s = read(y, x);
        const idx = Math.max(0, Math.min(space.hival, Math.round(decode[0] + (s * (decode[1] - decode[0])) / max)));
        rgb = [palette[idx * 3] / 255, palette[idx * 3 + 1] / 255, palette[idx * 3 + 2] / 255];
      } else {
        let key = 0;
        for (let k = 0; k < n; k += 1) {
          const s = read(y, x * n + k);
          key = key * 257 + s;
          c[k] = decode[k * 2] + (s * (decode[k * 2 + 1] - decode[k * 2])) / max;
        }
        if (n > 3 || key !== lastKey) { last = conv(c); lastKey = n > 3 ? -1 : key; }
        rgb = last;
      }
      const o = (y * width + x) * channels;
      if (gray) out[o] = Math.round(toGray.rgb(rgb) * 255);
      else { out[o] = Math.round(clamp01(rgb[0]) * 255); out[o + 1] = Math.round(clamp01(rgb[1]) * 255); out[o + 2] = Math.round(clamp01(rgb[2]) * 255); }
    }
  }
  return { width, height, channels, data: out };
}

// Nearest-neighbour resize of one channel, for masks a different size from
// their picture.
function resize(src, sw, sh, w, h) {
  if (sw === w && sh === h) return src;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / h));
    for (let x = 0; x < w; x += 1) out[y * w + x] = src[sy * sw + Math.min(sw - 1, Math.floor((x * sw) / w))];
  }
  return out;
}

// See-through-ness of an image as one byte a pixel (255 = solid), from its
// SMask, stencil /Mask or colour-key /Mask. null when it is fully solid.
export function decodeAlpha(ctx, dict, data, width, height) {
  const smask = look(ctx, dict.get(N('SMask')));
  if (smask instanceof PDFRawStream) {
    const { data: md, codec } = streamData(ctx, smask);
    if (codec) throw new Unsupported('compressed soft mask');
    const m = decodePixels(ctx, smask.dict, md, { gray: true });
    return resize(m.data, m.width, m.height, width, height);
  }
  const mask = look(ctx, dict.get(N('Mask')));
  if (mask instanceof PDFRawStream) {
    const { data: md, codec } = streamData(ctx, mask);
    if (codec) throw new Unsupported('compressed mask');
    const m = decodePixels(ctx, mask.dict, md, { gray: true });
    // A stencil mask hides where its sample is 1, which decodes as white.
    const a = m.data.map((v) => (v > 127 ? 0 : 255));
    return resize(a, m.width, m.height, width, height);
  }
  if (mask instanceof PDFArray && data) {
    const ranges = numbers(ctx, mask);
    const space = describeSpace(ctx, dict.get(N('ColorSpace')));
    const n = space.kind === 'indexed' ? 1 : space.n;
    const bpc = numOf(ctx, dict.get(N('BitsPerComponent')), 8);
    if (ranges.length !== n * 2 || !n) return null;
    const read = sampler(data, Math.ceil((width * n * bpc) / 8), bpc);
    const out = new Uint8Array(width * height).fill(255);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let hit = true;
        for (let k = 0; k < n && hit; k += 1) {
          const s = read(y, x * n + k);
          hit = s >= ranges[k * 2] && s <= ranges[k * 2 + 1];
        }
        if (hit) out[y * width + x] = 0;
      }
    }
    return out;
  }
  return null;
}
