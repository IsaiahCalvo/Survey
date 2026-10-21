// Reading JPEG headers, and turning a colour JPEG grey without decoding it to
// pixels. A colour JPEG already stores brightness (Y) apart from colour, and Y
// is exactly the grey a page should become, so keeping only the Y blocks gives
// a grey JPEG with no second round of loss, in a fraction of the time a decode
// and re-encode takes. Pure, no DOM, so Node tests cover it.

const SOF_BASELINE = 0xc0;
const SOF_EXTENDED = 0xc1;
const SOFS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

// The markers of a JPEG up to its first scan: [{ marker, start, body }] where
// body is the bytes after the length. Stops at SOS (included) or at the end.
function segments(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out = [];
  let p = 2;
  while (p + 3 < b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1];
    if (marker === 0xff) { p += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    if (marker === 0xd9) break;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2 || p + 2 + len > b.length) return null;
    out.push({ marker, start: p, body: b.subarray(p + 4, p + 2 + len) });
    p += 2 + len;
    if (marker === 0xda) break;
  }
  return out;
}

// EXIF orientation (1 = upright) from an APP1 body.
function exifOrientation(body) {
  if (body.length < 14 || body[0] !== 0x45 || body[1] !== 0x78 || body[2] !== 0x69 || body[3] !== 0x66) return 1;
  const v = new DataView(body.buffer, body.byteOffset + 6, body.length - 6);
  try {
    const le = v.getUint16(0) === 0x4949;
    const ifd = v.getUint32(4, le);
    const count = v.getUint16(ifd, le);
    for (let i = 0; i < count; i += 1) {
      const e = ifd + 2 + i * 12;
      if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
    }
  } catch { /* a short or odd EXIF block counts as none */ }
  return 1;
}

// What a JPEG is: { width, height, components, sof, precision, orientation,
// adobe (the Adobe colour transform, or null), ids, sampling } or null when
// the header can't be read.
export function jpegInfo(bytes) {
  const segs = segments(bytes);
  if (!segs) return null;
  const info = { orientation: 1, adobe: null };
  for (const { marker, body } of segs) {
    if (marker === 0xe1) info.orientation = exifOrientation(body);
    else if (marker === 0xee && body.length >= 12 && String.fromCharCode(...body.subarray(0, 5)) === 'Adobe') info.adobe = body[11];
    else if (SOFS.has(marker) && !info.sof && body.length >= 6) {
      info.sof = marker;
      info.precision = body[0];
      info.height = (body[1] << 8) | body[2];
      info.width = (body[3] << 8) | body[4];
      info.components = body[5];
      info.ids = [];
      info.sampling = [];
      for (let i = 0; i < info.components && 6 + i * 3 + 2 < body.length; i += 1) {
        info.ids.push(body[6 + i * 3]);
        info.sampling.push({ h: body[7 + i * 3] >> 4, v: body[7 + i * 3] & 15, tq: body[8 + i * 3] });
      }
    }
  }
  return info.sof ? info : null;
}

// True for a three-part JPEG that stores brightness and colour (YCbCr), not
// red, green and blue.
export function isYcc(info) {
  if (info.components !== 3) return false;
  if (info.adobe != null) return info.adobe === 1;
  return !(info.ids[0] === 0x52 && info.ids[1] === 0x47 && info.ids[2] === 0x42);
}

// ---------------------------------------------------------------- Huffman

function huffmanTable(counts, symbols) {
  const look = new Uint16Array(512);
  const maxcode = new Int32Array(17).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  const codes = new Uint16Array(256);
  const lengths = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    valptr[len] = k;
    mincode[len] = code;
    for (let i = 0; i < counts[len - 1]; i += 1, k += 1, code += 1) {
      const sym = symbols[k];
      codes[sym] = code;
      lengths[sym] = len;
      if (len <= 9) {
        const shift = 9 - len;
        for (let j = 0; j < 1 << shift; j += 1) look[(code << shift) + j] = (len << 8) | sym;
      }
    }
    if (counts[len - 1]) maxcode[len] = code - 1;
    code <<= 1;
  }
  return { look, maxcode, valptr, mincode, symbols, codes, lengths };
}

class BitReader {
  constructor(data, pos) {
    this.d = data; this.p = pos; this.acc = 0; this.n = 0; this.marker = false;
  }

  fill() {
    while (this.n <= 24) {
      let b = 0;
      if (!this.marker && this.p < this.d.length) {
        b = this.d[this.p];
        if (b === 0xff) {
          if (this.d[this.p + 1] === 0) this.p += 2;
          else { this.marker = true; b = 0; }
        } else this.p += 1;
      }
      this.acc = ((this.acc << 8) | b) >>> 0;
      this.n += 8;
    }
  }

  bits(k) {
    if (this.n < k) this.fill();
    this.n -= k;
    const v = (this.acc >>> this.n) & ((1 << k) - 1);
    this.acc &= this.n === 32 ? 0xffffffff : (1 << this.n) - 1;
    return v;
  }

  decode(t) {
    if (this.n < 16) this.fill();
    const e = t.look[(this.acc >>> (this.n - 9)) & 511];
    if (e) {
      this.n -= e >> 8;
      this.acc &= (1 << this.n) - 1;
      return e & 255;
    }
    let code = this.bits(9);
    for (let len = 10; len <= 16; len += 1) {
      code = (code << 1) | this.bits(1);
      if (code <= t.maxcode[len]) return t.symbols[t.valptr[len] + code - t.mincode[len]];
    }
    throw new Error('bad Huffman code');
  }

  // After a restart interval: drop the rest of the byte, then the RSTn marker.
  restart() {
    this.acc = 0;
    this.n = 0;
    if (this.d[this.p] === 0xff && this.d[this.p + 1] >= 0xd0 && this.d[this.p + 1] <= 0xd7) this.p += 2;
    this.marker = false;
  }
}

const receive = (r, s) => {
  if (!s) return 0;
  const v = r.bits(s);
  return v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
};

class BitWriter {
  constructor(size) { this.buf = new Uint8Array(size); this.len = 0; this.acc = 0; this.n = 0; }

  byte(b) {
    if (this.len + 2 > this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
    if (b === 0xff) this.buf[this.len++] = 0;
  }

  bits(code, len) {
    this.acc = (this.acc << len) | code;
    this.n += len;
    while (this.n >= 8) {
      this.n -= 8;
      this.byte((this.acc >>> this.n) & 255);
    }
    this.acc &= (1 << this.n) - 1;
  }

  flush() { if (this.n) this.bits((1 << (8 - this.n)) - 1, 8 - this.n); }
}

const category = (v) => {
  let a = v < 0 ? -v : v;
  let n = 0;
  while (a) { n += 1; a >>= 1; }
  return n;
};

// The usual DC table (JPEG spec, Annex K): it covers every difference an
// 8-bit JPEG can have, which the source's own table may not after the blocks
// are put in a new order.
const DC_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_SYMBOLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_TABLE = huffmanTable(DC_COUNTS, DC_SYMBOLS);

class MissingCode extends Error {}

function encodeBlock(w, blk, pred, ac) {
  const diff = blk[0] - pred;
  const s = category(diff);
  w.bits(DC_TABLE.codes[s], DC_TABLE.lengths[s]);
  if (s) w.bits(diff < 0 ? diff + (1 << s) - 1 : diff, s);
  let run = 0;
  for (let k = 1; k < 64; k += 1) {
    const v = blk[k];
    if (!v) { run += 1; continue; }
    while (run > 15) {
      if (!ac.lengths[0xf0]) throw new MissingCode();
      w.bits(ac.codes[0xf0], ac.lengths[0xf0]);
      run -= 16;
    }
    const c = category(v);
    const sym = (run << 4) | c;
    if (!ac.lengths[sym]) throw new MissingCode();
    w.bits(ac.codes[sym], ac.lengths[sym]);
    w.bits(v < 0 ? v + (1 << c) - 1 : v, c);
    run = 0;
  }
  if (run) {
    if (!ac.lengths[0]) throw new MissingCode();
    w.bits(ac.codes[0], ac.lengths[0]);
  }
  return blk[0];
}

function segment(marker, body) {
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff; out[1] = marker;
  out[2] = (body.length + 2) >> 8; out[3] = (body.length + 2) & 0xff;
  out.set(body, 4);
  return out;
}

// A colour (YCbCr) baseline JPEG as a one-part grey JPEG holding its exact
// brightness blocks, or null when this JPEG is a kind it doesn't take
// (progressive, 12-bit, arithmetic-coded, RGB-coded, odd sampling...).
export function jpegToGray(bytes) {
  const info = jpegInfo(bytes);
  if (!info || (info.sof !== SOF_BASELINE && info.sof !== SOF_EXTENDED) || info.precision !== 8) return null;
  if (!isYcc(info) || !info.width || !info.height) return null;
  const hmax = Math.max(...info.sampling.map((s) => s.h));
  const vmax = Math.max(...info.sampling.map((s) => s.v));
  const y = info.sampling[0];
  // Y must be the most finely sampled part, as it is in every normal JPEG.
  if (y.h !== hmax || y.v !== vmax) return null;

  const segs = segments(bytes);
  const dqt = new Map();
  const dc = new Map();
  const ac = new Map();
  let restartInterval = 0;
  let sos = null;
  for (const s of segs) {
    const b = s.body;
    if (s.marker === 0xdb) {
      for (let p = 0; p < b.length;) {
        const size = b[p] >> 4 ? 128 : 64;
        dqt.set(b[p] & 15, b.subarray(p, p + 1 + size));
        p += 1 + size;
      }
    } else if (s.marker === 0xc4) {
      for (let p = 0; p + 17 <= b.length;) {
        const counts = b.subarray(p + 1, p + 17);
        const n = counts.reduce((x, c) => x + c, 0);
        const table = huffmanTable(counts, b.subarray(p + 17, p + 17 + n));
        (b[p] >> 4 ? ac : dc).set(b[p] & 15, { table, raw: b.subarray(p, p + 17 + n) });
        p += 17 + n;
      }
    } else if (s.marker === 0xdd) {
      restartInterval = (b[0] << 8) | b[1];
    } else if (s.marker === 0xda) {
      sos = s;
    }
  }
  // Only a single scan holding all three parts (the usual baseline layout).
  if (!sos || sos.body[0] !== 3) return null;
  const order = [];
  for (let i = 0; i < 3; i += 1) {
    const ci = info.ids.indexOf(sos.body[1 + i * 2]);
    const t = sos.body[2 + i * 2];
    const dcT = dc.get(t >> 4);
    const acT = ac.get(t & 15);
    if (ci < 0 || !dcT || !acT) return null;
    order.push({ ci, ...info.sampling[ci], dc: dcT.table, ac: acT.table, pred: 0 });
  }
  if (order[0].ci !== 0) return null;
  const quant = dqt.get(y.tq);
  if (!quant) return null;

  const { width, height } = info;
  const mcusX = Math.ceil(width / (8 * hmax));
  const mcusY = Math.ceil(height / (8 * vmax));
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  const dataStart = sos.start + 2 + ((bytes[sos.start + 2] << 8) | bytes[sos.start + 3]);
  const r = new BitReader(bytes, dataStart);
  const yac = ac.get(sos.body[2] & 15);

  const encode = (acTable) => {
    const w = new BitWriter(Math.max(4096, bytes.length));
    const rowBlocks = new Int16Array(mcusX * y.h * y.v * 64);
    const blk = new Int16Array(64);
    let yPred = 0;
    let mcu = 0;
    for (let my = 0; my < mcusY; my += 1) {
      for (let mx = 0; mx < mcusX; mx += 1) {
        if (restartInterval && mcu && mcu % restartInterval === 0) {
          r.restart();
          for (const c of order) c.pred = 0;
        }
        mcu += 1;
        for (const c of order) {
          for (let v = 0; v < c.v; v += 1) {
            for (let h = 0; h < c.h; h += 1) {
              // Colour blocks are read only to get past them.
              const at = ((v * mcusX + mx) * c.h + h) * 64;
              const out = c.ci === 0 ? rowBlocks.subarray(at, at + 64) : blk;
              out.fill(0);
              const t = r.decode(c.dc);
              c.pred += receive(r, t);
              out[0] = c.pred;
              for (let k = 1; k < 64;) {
                const rs = r.decode(c.ac);
                const s = rs & 15;
                const run = rs >> 4;
                if (!s) {
                  if (run !== 15) break;
                  k += 16;
                  continue;
                }
                k += run;
                if (k > 63) break;
                out[k] = receive(r, s);
                k += 1;
              }
            }
          }
        }
      }
      // This row of MCUs holds y.v rows of Y blocks; write them left to right.
      for (let v = 0; v < y.v; v += 1) {
        const by = my * y.v + v;
        if (by >= blocksY) break;
        for (let bx = 0; bx < blocksX; bx += 1) {
          const mx = Math.floor(bx / y.h);
          const h = bx % y.h;
          const at = ((v * mcusX + mx) * y.h + h) * 64;
          yPred = encodeBlock(w, rowBlocks.subarray(at, at + 64), yPred, acTable);
        }
      }
    }
    w.flush();
    return w.buf.subarray(0, w.len);
  };

  let data;
  try {
    data = encode(yac.table);
  } catch {
    // A damaged scan, or (in theory) a code the source's table lacks.
    return null;
  }
  const sof = new Uint8Array([8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  const dqtBody = quant.slice();
  dqtBody[0] &= 0xf0;
  const dcBody = new Uint8Array([0x00, ...DC_COUNTS, ...DC_SYMBOLS]);
  const acBody = yac.raw.slice();
  acBody[0] = 0x10;
  const parts = [
    new Uint8Array([0xff, 0xd8]),
    segment(0xdb, dqtBody),
    // 16-bit quantizers are only allowed in the extended kind of JPEG.
    segment(quant[0] >> 4 ? SOF_EXTENDED : SOF_BASELINE, sof),
    segment(0xc4, dcBody),
    segment(0xc4, acBody),
    segment(0xda, new Uint8Array([1, 1, 0x00, 0, 63, 0])),
    data,
    new Uint8Array([0xff, 0xd9]),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}
