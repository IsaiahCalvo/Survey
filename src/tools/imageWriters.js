// Small image file writers for the free tools: PNG, TIFF (one or many pages),
// BMP and greyscale JPEG. Pure JS, no DOM, so Node tests can check them.
// Deflate comes from CompressionStream, which browsers and Node both have.
import { crc32 } from './zip.js';

async function pump(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
// zlib format, which is what both PNG and TIFF "Adobe Deflate" expect.
export const deflate = (bytes) => pump(bytes, new CompressionStream('deflate'));

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

// RGBA (as a canvas gives it) -> one byte per pixel of luminance.
export function rgbaToGray(rgba, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i += 1, j += 4) {
    out[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
  }
  return out;
}

export function rgbaToRgb(rgba, width, height) {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    out[i] = rgba[j]; out[i + 1] = rgba[j + 1]; out[i + 2] = rgba[j + 2];
  }
  return out;
}

// One bit per pixel, rows padded to whole bytes, 1 = black (dark below `cut`).
export function grayToBits(gray, width, height, cut = 150) {
  const row = Math.ceil(width / 8);
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (gray[y * width + x] < cut) out[y * row + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

// ---------------------------------------------------------------- PNG

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Each row gets the PNG filter that leaves the smallest numbers, which is
// what makes deflate do well on photos and flat drawings alike.
function filterRows(data, rowLen, rows, bpp) {
  const out = new Uint8Array((rowLen + 1) * rows);
  const cand = Array.from({ length: 5 }, () => new Uint8Array(rowLen));
  const zero = new Uint8Array(rowLen);
  for (let y = 0; y < rows; y += 1) {
    const cur = data.subarray(y * rowLen, (y + 1) * rowLen);
    const up = y ? data.subarray((y - 1) * rowLen, y * rowLen) : zero;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f += 1) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < rowLen; i += 1) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = up[i];
        const d = i >= bpp ? up[i - bpp] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, d);
        const v = (cur[i] - pred) & 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    out[y * (rowLen + 1)] = best;
    out.set(cand[best], y * (rowLen + 1) + 1);
  }
  return out;
}

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };

// channels: 1 gray, 2 gray + alpha, 3 RGB, 4 RGBA; 8 bits each. bits: 1 packs
// a gray image to black and white (data must then be 0 or 255 per pixel).
export async function encodePng({ width, height, channels, data, bits = 8 }, zip = deflate) {
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  head[8] = bits;
  head[9] = COLOR_TYPE[channels];
  let rows;
  if (bits === 1) {
    const packed = grayToBits(data, width, height, 128);
    const rowLen = Math.ceil(width / 8);
    rows = new Uint8Array((rowLen + 1) * height);
    // PNG's 1-bit gray has 1 = white, the opposite of grayToBits.
    for (let y = 0; y < height; y += 1) {
      for (let i = 0; i < rowLen; i += 1) rows[y * (rowLen + 1) + 1 + i] = ~packed[y * rowLen + i] & 0xff;
    }
  } else {
    rows = filterRows(data, width * channels, height, channels);
  }
  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  return concat([sig, chunk('IHDR', head), chunk('IDAT', await zip(rows)), chunk('IEND', new Uint8Array(0))]);
}

// ---------------------------------------------------------------- TIFF

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const TYPE_SIZE = { [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8 };

// A page ready to write: its strips are already compressed.
// { width, height, bitsPerSample: [..], photometric, compression, strips, rowsPerStrip, dpi, t4 }
const KINDS = {
  rgb: { spp: 3, bits: 8, photometric: 2 },
  gray: { spp: 1, bits: 8, photometric: 1 },
  bw: { spp: 1, bits: 1, photometric: 0 }, // 1 = black
};

// Turn pixels into a deflated TIFF page. kind: 'rgb' (3 bytes a pixel),
// 'gray' (1 byte) or 'bw' (packed bits from grayToBits).
export async function tiffPage({ width, height, kind, data, dpi = 72 }, zip = deflate) {
  const k = KINDS[kind];
  const rowBytes = Math.ceil((width * k.spp * k.bits) / 8);
  // Strips of about 256 KB, the size most readers handle well.
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(262144 / rowBytes)));
  const strips = [];
  for (let y = 0; y < height; y += rowsPerStrip) {
    strips.push(await zip(data.subarray(y * rowBytes, Math.min(height, y + rowsPerStrip) * rowBytes)));
  }
  return {
    width, height, bitsPerSample: Array(k.spp).fill(k.bits), photometric: k.photometric, compression: 8, strips, rowsPerStrip, dpi,
  };
}

// A rendered page (canvas RGBA) as a TIFF page. color: 'color' | 'gray' | 'bw'.
export function rgbaToTiffPage(rgba, width, height, { color = 'color', dpi = 150 } = {}, zip = deflate) {
  if (color === 'color') return tiffPage({ width, height, kind: 'rgb', data: rgbaToRgb(rgba, width, height), dpi }, zip);
  const gray = rgbaToGray(rgba, width, height);
  if (color === 'gray') return tiffPage({ width, height, kind: 'gray', data: gray, dpi }, zip);
  return tiffPage({ width, height, kind: 'bw', data: grayToBits(gray, width, height), dpi }, zip);
}

function ifd(page, index, total, at) {
  const offsets = [];
  let pos = at;
  for (const s of page.strips) {
    offsets.push(pos);
    pos += s.length + (s.length & 1);
  }
  const entries = [
    [254, LONG, [0]],
    [256, LONG, [page.width]],
    [257, LONG, [page.height]],
    [258, SHORT, page.bitsPerSample],
    [259, SHORT, [page.compression]],
    [262, SHORT, [page.photometric]],
    [273, LONG, offsets],
    [277, SHORT, [page.bitsPerSample.length]],
    [278, LONG, [page.rowsPerStrip]],
    [279, LONG, page.strips.map((s) => s.length)],
    [282, RATIONAL, [[Math.round(page.dpi), 1]]],
    [283, RATIONAL, [[Math.round(page.dpi), 1]]],
    [284, SHORT, [1]],
    page.t4 != null && [page.compression === 4 ? 293 : 292, LONG, [page.t4]],
    [296, SHORT, [2]],
    [297, SHORT, [index, total]],
  ].filter(Boolean);
  const size = 2 + entries.length * 12 + 4;
  const extra = entries.reduce((n, [, t, vals]) => {
    const len = TYPE_SIZE[t] * vals.length;
    return n + (len > 4 ? len + (len & 1) : 0);
  }, 0);
  const buf = new Uint8Array(size + extra);
  const v = new DataView(buf.buffer);
  const ifdAt = pos;
  v.setUint16(0, entries.length, true);
  let spill = size;
  entries.forEach(([tag, type, vals], i) => {
    const e = 2 + i * 12;
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, vals.length, true);
    const len = TYPE_SIZE[type] * vals.length;
    let w = e + 8;
    if (len > 4) {
      v.setUint32(e + 8, ifdAt + spill, true);
      w = spill;
      spill += len + (len & 1);
    }
    for (const val of vals) {
      if (type === SHORT) { v.setUint16(w, val, true); w += 2; }
      else if (type === LONG) { v.setUint32(w, val, true); w += 4; }
      else { v.setUint32(w, val[0], true); v.setUint32(w + 4, val[1], true); w += 8; }
    }
  });
  return { buf, ifdAt, next: size - 4, end: ifdAt + buf.length };
}

// pages from tiffPage (or hand-made, like a fax strip) -> one TIFF file.
export function writeTiff(pages) {
  const head = Uint8Array.of(0x49, 0x49, 42, 0, 0, 0, 0, 0);
  const parts = [head];
  let pos = 8;
  let prev = null;
  pages.forEach((page, i) => {
    const d = ifd(page, i, pages.length, pos);
    for (const s of page.strips) {
      parts.push(s);
      if (s.length & 1) parts.push(new Uint8Array(1));
    }
    parts.push(d.buf);
    if (prev) new DataView(prev.buf.buffer).setUint32(prev.next, d.ifdAt, true);
    else new DataView(head.buffer).setUint32(4, d.ifdAt, true);
    prev = d;
    pos = d.end;
  });
  return concat(parts);
}

// ---------------------------------------------------------------- BMP

// 24-bit BMP from RGBA, rows stored bottom-up and padded to 4 bytes.
export function encodeBmp({ width, height, data, dpi = 72 }) {
  const row = (width * 3 + 3) & ~3;
  const size = 54 + row * height;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * height, true);
  const ppm = Math.round(dpi / 0.0254);
  v.setInt32(38, ppm, true);
  v.setInt32(42, ppm, true);
  for (let y = 0; y < height; y += 1) {
    let o = 54 + (height - 1 - y) * row;
    for (let x = 0, j = y * width * 4; x < width; x += 1, j += 4) {
      out[o] = data[j + 2]; out[o + 1] = data[j + 1]; out[o + 2] = data[j];
      o += 3;
    }
  }
  return out;
}

// ---------------------------------------------------------------- JPEG

// A baseline greyscale JPEG encoder. Canvases can only write colour JPEGs, and
// a "black and white" PDF should hold one-channel pictures.
const LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

// ZIGZAG[k] is the natural (row-major) index of the k-th coefficient sent.
const ZIGZAG = (() => {
  const out = [];
  for (let s = 0; s < 15; s += 1) {
    const cells = [];
    for (let y = 0; y < 8; y += 1) { const x = s - y; if (x >= 0 && x < 8) cells.push(y * 8 + x); }
    if (s % 2 === 0) cells.reverse();
    out.push(...cells);
  }
  return out;
})();

const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

// symbol -> [code, length] from a DHT-style (bits, values) table.
function huffman(bits, vals) {
  const table = [];
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    for (let i = 0; i < bits[len - 1]; i += 1) table[vals[k++]] = [code++, len];
    code <<= 1;
  }
  return table;
}
const DC_TABLE = huffman(DC_BITS, DC_VALS);
const AC_TABLE = huffman(AC_BITS, AC_VALS);

// COS[u * 8 + x] = C(u)/2 * cos((2x + 1)uπ/16); two passes give the 1/4 scale.
const COS = new Float64Array(64);
for (let u = 0; u < 8; u += 1) {
  for (let x = 0; x < 8; x += 1) COS[u * 8 + x] = (u ? 0.5 : 0.5 / Math.SQRT2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
}

class BitWriter {
  constructor(size) { this.buf = new Uint8Array(size); this.len = 0; this.acc = 0; this.n = 0; }
  byte(b) {
    if (this.len + 2 > this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
  }
  bits(code, len) {
    for (let i = len - 1; i >= 0; i -= 1) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      this.n += 1;
      if (this.n === 8) {
        this.byte(this.acc);
        if (this.acc === 0xff) this.byte(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flush() { if (this.n) this.bits((1 << (8 - this.n)) - 1, 8 - this.n); }
}

const category = (v) => { let a = Math.abs(v); let n = 0; while (a) { n += 1; a >>= 1; } return n; };
const extraBits = (v, n) => (v < 0 ? v + (1 << n) - 1 : v);

function segment(marker, body) {
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff; out[1] = marker;
  out[2] = (body.length + 2) >> 8; out[3] = (body.length + 2) & 0xff;
  out.set(body, 4);
  return out;
}

// gray: one byte per pixel. quality 1-100 as in most image apps.
export function encodeGrayJpeg(gray, width, height, quality = 85) {
  if (width > 65535 || height > 65535) throw new Error('JPEG too large');
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  const qt = LUMA_Q.map((t) => Math.min(255, Math.max(1, Math.floor((t * scale + 50) / 100))));
  const out = new BitWriter(Math.max(1024, width * height >> 2));
  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  let lastDc = 0;
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y += 1) {
        const row = Math.min(height - 1, by + y) * width;
        for (let x = 0; x < 8; x += 1) block[y * 8 + x] = gray[row + Math.min(width - 1, bx + x)] - 128;
      }
      for (let y = 0; y < 8; y += 1) {
        for (let u = 0; u < 8; u += 1) {
          let s = 0;
          for (let x = 0; x < 8; x += 1) s += COS[u * 8 + x] * block[y * 8 + x];
          tmp[y * 8 + u] = s;
        }
      }
      for (let u = 0; u < 8; u += 1) {
        for (let v = 0; v < 8; v += 1) {
          let s = 0;
          for (let y = 0; y < 8; y += 1) s += COS[v * 8 + y] * tmp[y * 8 + u];
          block[v * 8 + u] = s;
        }
      }
      const dc = Math.round(block[0] / qt[0]);
      const diff = dc - lastDc;
      lastDc = dc;
      const dn = category(diff);
      out.bits(...DC_TABLE[dn]);
      if (dn) out.bits(extraBits(diff, dn), dn);
      let run = 0;
      for (let k = 1; k < 64; k += 1) {
        const z = ZIGZAG[k];
        const c = Math.round(block[z] / qt[z]);
        if (!c) { run += 1; continue; }
        while (run > 15) { out.bits(...AC_TABLE[0xf0]); run -= 16; }
        const n = category(c);
        out.bits(...AC_TABLE[(run << 4) | n]);
        out.bits(extraBits(c, n), n);
        run = 0;
      }
      if (run) out.bits(...AC_TABLE[0]);
    }
  }
  out.flush();
  const dqt = Uint8Array.of(0, ...ZIGZAG.map((z) => qt[z]));
  const sof = Uint8Array.of(8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0);
  const dht = Uint8Array.of(0x00, ...DC_BITS, ...DC_VALS, 0x10, ...AC_BITS, ...AC_VALS);
  const sos = Uint8Array.of(1, 1, 0x00, 0, 63, 0);
  return concat([
    Uint8Array.of(0xff, 0xd8),
    segment(0xe0, Uint8Array.of(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0)),
    segment(0xdb, dqt), segment(0xc0, sof), segment(0xc4, dht), segment(0xda, sos),
    out.buf.subarray(0, out.len), Uint8Array.of(0xff, 0xd9),
  ]);
}
