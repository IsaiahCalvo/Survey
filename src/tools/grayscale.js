// Grayscale PDF. The default way rewrites the colours inside the PDF itself:
// colour commands in the drawing instructions become grey ones, colour
// pictures are re-saved in grey, and gradients, spot colours and palettes get
// grey versions. Text and lines stay sharp and text stays selectable. The
// other way (pagesToGrayPdf) turns each drawn page into a grey picture.
// Pure pdf-lib, no DOM; the browser passes in a JPEG decoder.
import {
  PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFObjectParser, PDFRawStream, PDFRef, PDFString, PDFBool, PDFDocument,
  decodePDFRawStream,
} from 'pdf-lib';
import { loadPdf } from './ops.js';
import {
  N, look, nameOf, numOf, listOf, describeSpace, toGray, streamData, decodePixels, decodeAlpha, Unsupported,
} from './pdfImages.js';
import { encodeGrayJpeg, rgbaToGray } from './imageWriters.js';
import { jpegInfo, jpegToGray } from './jpeg.js';
import { pageResources } from './extractImages.js';

const COLOR_KINDS = new Set(['rgb', 'cmyk', 'lab']);
const N_OF = { gray: 1, rgb: 3, cmyk: 4, lab: 3 };

const fmt = (v) => String(Math.round(v * 10000) / 10000);
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

// ---------------------------------------------------------------- content

const isWs = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// Where the inline picture that starts at `p` (just after "ID") ends: the
// "EI" with white space before and after it.
function inlineEnd(b, p) {
  for (let i = p; i < b.length - 1; i += 1) {
    if (b[i] === 0x45 && b[i + 1] === 0x49 && isWs(b[i - 1]) && (i + 2 >= b.length || isWs(b[i + 2]) || isDelim(b[i + 2]))) return i;
  }
  return b.length;
}

// Walk the tokens of a content stream and call onOp(op, operands, start, end)
// for each operator. Arrays and dictionaries come as one operand. For inline
// pictures onOp gets 'ID' with the dictionary and data spans.
export function scanContent(b, onOp) {
  const ops = [];
  let depth = 0;
  let compStart = 0;
  let p = 0;
  let biStart = -1;
  while (p < b.length) {
    const c = b[p];
    if (isWs(c)) { p += 1; continue; }
    const s = p;
    if (c === 37) { // % comment
      while (p < b.length && b[p] !== 10 && b[p] !== 13) p += 1;
      continue;
    }
    let kind;
    let text = '';
    if (c === 40) { // ( string )
      let nest = 0;
      for (; p < b.length; p += 1) {
        if (b[p] === 92) { p += 1; continue; }
        if (b[p] === 40) nest += 1;
        else if (b[p] === 41 && (nest -= 1) === 0) { p += 1; break; }
      }
      kind = 'str';
    } else if (c === 60 && b[p + 1] === 60) { p += 2; kind = 'open'; }
    else if (c === 62 && b[p + 1] === 62) { p += 2; kind = 'close'; }
    else if (c === 60) { while (p < b.length && b[p] !== 62) p += 1; p += 1; kind = 'str'; }
    else if (c === 91 || c === 123) { p += 1; kind = 'open'; }
    else if (c === 93 || c === 125) { p += 1; kind = 'close'; }
    else if (c === 47) {
      p += 1;
      while (p < b.length && !isWs(b[p]) && !isDelim(b[p])) p += 1;
      kind = 'name';
      text = latin1(b.subarray(s + 1, p));
    } else if (c === 41 || c === 62) { p += 1; continue; } // stray closer
    else {
      while (p < b.length && !isWs(b[p]) && !isDelim(b[p])) p += 1;
      text = latin1(b.subarray(s, p));
      kind = NUMBER.test(text) ? 'num' : 'op';
    }
    if (kind === 'open') { if (depth++ === 0) compStart = s; continue; }
    if (kind === 'close') {
      if (depth > 0 && --depth === 0) ops.push({ kind: 'comp', s: compStart, e: p });
      continue;
    }
    if (depth > 0) continue;
    if (kind !== 'op' || text === 'true' || text === 'false' || text === 'null') {
      ops.push({ kind, s, e: p, value: kind === 'num' ? Number(text) : text });
      continue;
    }
    if (text === 'BI') { biStart = s; ops.length = 0; continue; }
    if (text === 'ID') {
      const dataStart = p + 1;
      const end = inlineEnd(b, dataStart);
      onOp('ID', ops, biStart, end + 2, { dictStart: biStart + 2, dictEnd: s, dataStart, dataEnd: end });
      p = end + 2;
      ops.length = 0;
      continue;
    }
    onOp(text, ops, ops.length ? ops[0].s : s, p);
    ops.length = 0;
  }
}

const INLINE_KEYS = { W: 'Width', H: 'Height', BPC: 'BitsPerComponent', CS: 'ColorSpace', D: 'Decode', DP: 'DecodeParms', F: 'Filter', IM: 'ImageMask', I: 'Interpolate' };

// Rewrite one content stream. `space(name)` says what a /Name colour space
// is (from the resources). Returns the new bytes, or null if nothing changed.
export function grayContent(bytes, { space = () => ({ kind: 'keep' }), ctx = null, kept = { inline: 0 } } = {}) {
  const edits = [];
  let fill = 'auto';
  let stroke = 'auto';
  const saved = [];
  const nums = (ops) => (ops.every((o) => o.kind === 'num') ? ops.map((o) => o.value) : null);
  const conv = (kind, values) => fmt(toGray[kind](values));
  const replace = (s, e, text) => edits.push({ s, e, text });

  scanContent(bytes, (op, ops, s, e, inline) => {
    switch (op) {
      case 'q': saved.push([fill, stroke]); break;
      case 'Q': if (saved.length) [fill, stroke] = saved.pop(); break;
      case 'g': fill = 'gray'; break;
      case 'G': stroke = 'gray'; break;
      case 'rg': case 'RG': case 'k': case 'K': {
        const v = nums(ops);
        const kind = op.toLowerCase() === 'rg' ? 'rgb' : 'cmyk';
        if (v && v.length === N_OF[kind]) replace(s, e, `${conv(kind, v)} ${op === op.toLowerCase() ? 'g' : 'G'}`);
        if (op === op.toLowerCase()) fill = 'gray'; else stroke = 'gray';
        break;
      }
      case 'cs': case 'CS': {
        const name = ops[ops.length - 1]?.kind === 'name' ? ops[ops.length - 1].value : null;
        const d = name ? space(name) : { kind: 'keep' };
        let kind = d.kind;
        if (COLOR_KINDS.has(kind)) replace(s, e, `/DeviceGray ${op}`);
        else if (kind === 'pattern' && d.base && COLOR_KINDS.has(d.base.kind)) kind = `pattern:${d.base.kind}`;
        else if (kind !== 'gray') kind = 'keep';
        if (op === 'cs') fill = kind; else stroke = kind;
        break;
      }
      case 'sc': case 'scn': case 'SC': case 'SCN': {
        let kind = op === op.toLowerCase() ? fill : stroke;
        const hasName = ops[ops.length - 1]?.kind === 'name';
        const numOps = hasName ? ops.slice(0, -1) : ops;
        const v = nums(numOps);
        if (!v) break;
        if (kind === 'auto') kind = v.length === 3 ? 'rgb' : v.length === 4 ? 'cmyk' : 'gray';
        const base = kind.startsWith('pattern:') ? kind.slice(8) : kind;
        if (!COLOR_KINDS.has(base) || v.length !== N_OF[base] || (kind === base && hasName)) break;
        const last = ops[ops.length - 1];
        const tail = hasName ? ` ${latin1(bytes.subarray(last.s, last.e))}` : '';
        replace(numOps[0].s, e, `${conv(base, v)}${tail} ${op}`);
        break;
      }
      case 'ID': {
        const out = ctx && grayInline(ctx, bytes, inline, space, kept);
        if (out) replace(s, e, out);
        break;
      }
      default:
    }
  });
  if (!edits.length) return null;
  const parts = [];
  let at = 0;
  for (const ed of edits) {
    parts.push(bytes.subarray(at, ed.s), ascii(ed.text));
    at = ed.e;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

// An inline picture in colour, redone as a grey one. Returns the new
// "BI ... EI" text or null to leave it.
function grayInline(ctx, bytes, at, space, kept) {
  let dict;
  try {
    const raw = PDFObjectParser.forBytes(Uint8Array.from([60, 60, ...bytes.subarray(at.dictStart, at.dictEnd), 62, 62]), ctx).parseObject();
    dict = ctx.obj({});
    for (const [k, v] of raw.entries()) dict.set(N(INLINE_KEYS[k.decodeText()] || k.decodeText()), v);
  } catch {
    kept.inline += 1;
    return null;
  }
  if (look(ctx, dict.get(N('ImageMask'))) === PDFBool.True) return null;
  // A named colour space comes from the resources; swap in the real one.
  const csName = nameOf(dict.get(N('ColorSpace')));
  if (csName && !['G', 'DeviceGray', 'RGB', 'DeviceRGB', 'CMYK', 'DeviceCMYK', 'I', 'Indexed'].includes(csName)) {
    const real = space(csName)?.object;
    if (!real) { kept.inline += 1; return null; }
    dict.set(N('ColorSpace'), real);
  }
  const d = describeSpace(ctx, dict.get(N('ColorSpace')));
  if (d.kind === 'gray') return null;
  try {
    const { data, codec } = streamData(ctx, PDFRawStream.of(dict, bytes.slice(at.dataStart, at.dataEnd)));
    if (codec) throw new Unsupported(codec);
    const px = decodePixels(ctx, dict, data, { gray: true });
    // Hex-coded so the picture's bytes can never look like the "EI" end mark.
    const packed = ctx.flateStream(px.data).contents;
    let hex = '';
    for (const x of packed) hex += x.toString(16).padStart(2, '0');
    const interp = look(ctx, dict.get(N('Interpolate'))) === PDFBool.True ? ' /I true' : '';
    return `BI /W ${px.width} /H ${px.height} /BPC 8 /CS /G /F [/AHx /Fl]${interp} ID\n${hex}> EI`;
  } catch {
    kept.inline += 1;
    return null;
  }
}

// ---------------------------------------------------------------- functions

const POSTSCRIPT_GRAY = {
  rgb: '0.114 mul exch 0.587 mul add exch 0.299 mul add',
  cmyk: 'exch 0.11 mul add exch 0.59 mul add exch 0.3 mul add 1 exch sub 0 max',
  lab: 'pop pop 100 div',
};

function readBits(data, bits) {
  let pos = 0;
  return () => {
    let v = 0;
    for (let i = 0; i < bits; i += 1, pos += 1) v = v * 2 + ((data[pos >> 3] >> (7 - (pos & 7))) & 1);
    return v;
  };
}

// ---------------------------------------------------------------- the walk

class Grayer {
  constructor(doc, { decodeJpeg, quality }) {
    this.doc = doc;
    this.ctx = doc.context;
    this.decodeJpeg = decodeJpeg;
    this.quality = quality;
    this.done = new Set();
    this.spaces = new Map();
    this.fns = new Map();
    this.origin = new Map();
    this.kept = { pictures: 0, shades: 0, inline: 0, other: 0 };
  }

  key(v) { return v instanceof PDFRef ? v.toString() : v; }

  // First visit to v? Marks it as seen.
  first(v) {
    const k = this.key(v);
    if (this.done.has(k)) return false;
    this.done.add(k);
    return true;
  }

  register(obj) { return this.ctx.register(obj); }

  // A new stream with `bytes` deflated and old's other entries kept.
  restream(old, bytes, set = {}) {
    const s = this.ctx.flateStream(bytes);
    for (const [k, v] of old.dict.entries()) {
      if (!['Filter', 'DecodeParms', 'Length', 'DL'].includes(k.decodeText())) s.dict.set(k, v);
    }
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined) s.dict.delete(N(k));
      else s.dict.set(N(k), this.ctx.obj(v));
    }
    return s;
  }

  put(holder, key, value, obj) {
    if (value instanceof PDFRef) this.ctx.assign(value, obj);
    else holder.set(key, obj);
  }

  // What a /Name used in content means, using the colour space as it was
  // before this tool replaced any of them.
  spaceFor(resources) {
    const dict = look(this.ctx, resources?.get(N('ColorSpace')));
    return (name) => {
      if (['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern'].includes(name)) return describeSpace(this.ctx, N(name));
      const v = dict instanceof PDFDict ? dict.get(N(name)) : undefined;
      if (v === undefined) return { kind: 'keep' };
      const real = this.origin.get(look(this.ctx, v)) ?? v;
      return { ...describeSpace(this.ctx, real), object: real };
    };
  }

  rewrite(bytes, resources) {
    return grayContent(bytes, { space: this.spaceFor(resources), ctx: this.ctx, kept: this.kept });
  }

  // A form, tiling pattern or glyph: its own drawing plus its resources.
  async stream(holder, key, value, parentRes) {
    if (!this.first(value)) return;
    const s = look(this.ctx, value);
    if (!(s instanceof PDFRawStream)) return;
    const res = look(this.ctx, s.dict.get(N('Resources'))) || parentRes;
    let bytes;
    try { bytes = decodePDFRawStream(s).decode(); } catch { this.kept.other += 1; return; }
    const next = this.rewrite(bytes, res);
    if (next) {
      const fresh = this.restream(s, next);
      this.put(holder, key, value, fresh);
      this.done.add(fresh);
    }
    await this.resources(res);
  }

  async resources(res) {
    if (!(res instanceof PDFDict) || !this.first(res)) return;
    const ctx = this.ctx;
    const each = (k) => {
      const d = look(ctx, res.get(N(k)));
      return d instanceof PDFDict ? d.entries().map(([name, v]) => [d, name, v]) : [];
    };
    for (const [d, name, v] of each('XObject')) {
      const x = look(ctx, v);
      const type = x instanceof PDFRawStream && nameOf(x.dict.get(N('Subtype')));
      if (type === 'Image') await this.image(d, name, v);
      else if (type === 'Form') await this.stream(d, name, v, res);
    }
    for (const [d, name, v] of each('Pattern')) {
      const pat = look(ctx, v);
      if (pat instanceof PDFRawStream) await this.stream(d, name, v, res);
      else if (pat instanceof PDFDict && this.first(v)) this.shading(pat, N('Shading'), pat.get(N('Shading')));
    }
    for (const [d, name, v] of each('Shading')) this.shading(d, name, v);
    for (const [, , v] of each('ExtGState')) {
      const gs = look(ctx, v);
      const sm = gs instanceof PDFDict && look(ctx, gs.get(N('SMask')));
      if (sm instanceof PDFDict && sm.get(N('G'))) await this.stream(sm, N('G'), sm.get(N('G')), res);
    }
    for (const [, , v] of each('Font')) {
      const font = look(ctx, v);
      if (!(font instanceof PDFDict) || nameOf(font.get(N('Subtype'))) !== 'Type3') continue;
      const procs = look(ctx, font.get(N('CharProcs')));
      const fres = look(ctx, font.get(N('Resources'))) || res;
      if (procs instanceof PDFDict) for (const [g, p] of procs.entries()) await this.stream(procs, g, p, fres);
    }
    // Last, so the drawing above was read against the original spaces.
    for (const [d, name, v] of each('ColorSpace')) {
      const next = this.space(v);
      if (next) d.set(name, next);
    }
  }

  // A grey stand-in for an indexed, spot, multi-ink or pattern colour space,
  // or null when it needs none (or can't be made).
  space(v) {
    const k = this.key(v);
    if (this.spaces.has(k)) return this.spaces.get(k);
    const ctx = this.ctx;
    const d = describeSpace(ctx, v);
    let out = null;
    if (d.kind === 'indexed' && d.base.kind !== 'gray') {
      if (COLOR_KINDS.has(d.base.kind)) {
        const n = d.base.n;
        let hex = '';
        for (let i = 0; i <= d.hival; i += 1) {
          const c = [];
          for (let j = 0; j < n; j += 1) {
            const raw = (d.lookup[i * n + j] ?? 0) / 255;
            const r = d.base.range;
            c.push(d.base.kind !== 'lab' ? raw : j === 0 ? raw * 100 : r[(j - 1) * 2] + raw * (r[(j - 1) * 2 + 1] - r[(j - 1) * 2]));
          }
          hex += Math.round(toGray[d.base.kind](c) * 255).toString(16).padStart(2, '0');
        }
        out = ctx.obj([N('Indexed'), N('DeviceGray'), d.hival, PDFHexString.of(hex)]);
      } else this.kept.other += 1;
    } else if ((d.kind === 'separation' || d.kind === 'devicen') && d.alt.kind !== 'gray') {
      const fn = COLOR_KINDS.has(d.alt.kind) ? this.fn(d.fn, d.alt.kind) : null;
      if (fn) {
        const arr = look(ctx, v).asArray().slice();
        arr[2] = N('DeviceGray');
        arr[3] = fn;
        out = ctx.obj(arr);
      } else this.kept.other += 1;
    } else if (d.kind === 'pattern' && d.base && COLOR_KINDS.has(d.base.kind)) {
      out = ctx.obj([N('Pattern'), N('DeviceGray')]);
    }
    if (out) this.origin.set(out, look(ctx, v));
    this.spaces.set(k, out);
    return out;
  }

  // A function giving colour in `kind` (rgb, cmyk, lab) -> one giving grey.
  fn(v, kind) {
    const k = this.key(v);
    const cacheKey = typeof k === 'string' ? `${k}:${kind}` : null;
    if (cacheKey && this.fns.has(cacheKey)) return this.fns.get(cacheKey);
    let out = null;
    try { out = this.makeFn(v, kind); } catch { out = null; }
    if (cacheKey) this.fns.set(cacheKey, out);
    return out;
  }

  makeFn(v, kind) {
    const ctx = this.ctx;
    const f = look(ctx, v);
    const dict = f instanceof PDFRawStream ? f.dict : f;
    if (!(dict instanceof PDFDict)) return null;
    const type = numOf(ctx, dict.get(N('FunctionType')), -1);
    const n = N_OF[kind];
    const toG = (c) => toGray[kind](c);
    if (type === 2) {
      const c0 = listOf(ctx, dict.get(N('C0'))).map((x) => x.asNumber());
      const c1 = listOf(ctx, dict.get(N('C1'))).map((x) => x.asNumber());
      if (c0.length !== n || c1.length !== n) return null;
      const out = dict.clone(ctx);
      out.set(N('C0'), ctx.obj([toG(c0)]));
      out.set(N('C1'), ctx.obj([toG(c1)]));
      out.delete(N('Range'));
      return this.register(out);
    }
    if (type === 3) {
      const list = look(ctx, dict.get(N('Functions')));
      const parts = list instanceof PDFArray ? list.asArray().map((x) => this.fn(x, kind)) : [];
      if (!parts.length || parts.some((x) => !x)) return null;
      const out = dict.clone(ctx);
      out.set(N('Functions'), ctx.obj(parts));
      out.delete(N('Range'));
      return this.register(out);
    }
    if (!(f instanceof PDFRawStream)) return null;
    const body = decodePDFRawStream(f).decode();
    if (type === 4) {
      const code = latin1(body);
      const a = code.indexOf('{');
      const b = code.lastIndexOf('}');
      if (a < 0 || b <= a) return null;
      return this.register(this.restream(f, ascii(`{ ${code.slice(a + 1, b)} ${POSTSCRIPT_GRAY[kind]} }`), { Range: [0, 1] }));
    }
    if (type === 0) {
      const size = listOf(ctx, dict.get(N('Size'))).map((x) => x.asNumber());
      const bits = numOf(ctx, dict.get(N('BitsPerSample')), 8);
      const range = listOf(ctx, dict.get(N('Range'))).map((x) => x.asNumber());
      let dec = listOf(ctx, dict.get(N('Decode'))).map((x) => x.asNumber());
      if (dec.length !== n * 2) dec = range;
      if (range.length !== n * 2) return null;
      const count = size.reduce((a, x) => a * x, 1);
      const read = readBits(body, bits);
      const max = 2 ** bits - 1;
      const out = new Uint8Array(count);
      const c = new Array(n);
      for (let i = 0; i < count; i += 1) {
        for (let j = 0; j < n; j += 1) c[j] = dec[j * 2] + (read() * (dec[j * 2 + 1] - dec[j * 2])) / max;
        out[i] = Math.round(toG(c) * 255);
      }
      return this.register(this.restream(f, out, { BitsPerSample: 8, Range: [0, 1], Decode: [0, 1] }));
    }
    return null;
  }

  shading(holder, key, v) {
    if (!v || !this.first(v)) return;
    const ctx = this.ctx;
    const sh = look(ctx, v);
    const dict = sh instanceof PDFRawStream ? sh.dict : sh;
    if (!(dict instanceof PDFDict)) return;
    const csv = dict.get(N('ColorSpace'));
    const d = describeSpace(ctx, csv);
    if (d.kind === 'gray') return;
    if (['indexed', 'separation', 'devicen'].includes(d.kind)) {
      const next = this.space(csv);
      if (next) dict.set(N('ColorSpace'), next);
      else this.kept.shades += 1;
      return;
    }
    const fv = dict.get(N('Function'));
    if (!COLOR_KINDS.has(d.kind) || !fv) { this.kept.shades += 1; return; }
    let fn = null;
    const fl = look(ctx, fv);
    if (fl instanceof PDFArray) fn = this.joinFns(fl, d.kind);
    else fn = this.fn(fv, d.kind);
    if (!fn) { this.kept.shades += 1; return; }
    dict.set(N('Function'), fn);
    dict.set(N('ColorSpace'), N('DeviceGray'));
    const bg = listOf(ctx, dict.get(N('Background'))).map((x) => x.asNumber?.() ?? 0);
    if (bg.length === N_OF[d.kind]) dict.set(N('Background'), ctx.obj([toGray[d.kind](bg)]));
    else dict.delete(N('Background'));
  }

  // A gradient given as one simple function per ink, joined into one.
  joinFns(list, kind) {
    const ctx = this.ctx;
    const fs = list.asArray().map((x) => look(ctx, x));
    if (fs.length !== N_OF[kind] || !fs.every((f) => f instanceof PDFDict && numOf(ctx, f.get(N('FunctionType')), -1) === 2)) return null;
    const ends = (k, def) => fs.map((f) => listOf(ctx, f.get(N(k))).map((x) => x.asNumber())[0] ?? def);
    const out = fs[0].clone(ctx);
    out.set(N('C0'), ctx.obj([toGray[kind](ends('C0', 0))]));
    out.set(N('C1'), ctx.obj([toGray[kind](ends('C1', 1))]));
    out.delete(N('Range'));
    return this.register(out);
  }

  async image(holder, key, v) {
    if (!this.first(v)) return;
    const ctx = this.ctx;
    const img = look(ctx, v);
    if (!(img instanceof PDFRawStream)) return;
    const { dict } = img;
    if (look(ctx, dict.get(N('ImageMask'))) === PDFBool.True) return;
    const csv = dict.get(N('ColorSpace'));
    if (!csv) {
      // JPEG 2000 can carry its own colours, which can't be changed here.
      if (dict.get(N('Filter'))) this.kept.pictures += 1;
      return;
    }
    const d = describeSpace(ctx, csv);
    if (d.kind === 'gray') return;
    if (['indexed', 'separation', 'devicen'].includes(d.kind)) {
      const next = this.space(csv);
      if (next) dict.set(N('ColorSpace'), next);
      else this.kept.pictures += 1;
      return;
    }
    if (!COLOR_KINDS.has(d.kind)) { this.kept.pictures += 1; return; }
    try {
      const fresh = await this.grayImage(img);
      if (!fresh) { this.kept.pictures += 1; return; }
      this.put(holder, key, v, fresh);
      this.done.add(fresh);
    } catch (err) {
      if (!(err instanceof Unsupported)) console.warn('grayscale-pdf:', err);
      this.kept.pictures += 1;
    }
  }

  async grayImage(img) {
    const ctx = this.ctx;
    const { dict } = img;
    const { data, codec, parms } = streamData(ctx, img);
    const width = numOf(ctx, dict.get(N('Width')), 0);
    const height = numOf(ctx, dict.get(N('Height')), 0);
    if (codec === 'DCTDecode') {
      if (dict.get(N('Decode'))) return null;
      // Most colour JPEGs can keep their own brightness blocks as they are:
      // exact, and far quicker than decoding and saving again.
      // (/ColorTransform 0 says the three parts are red, green and blue.)
      let jpeg = parms && numOf(ctx, parms.get(N('ColorTransform')), 1) === 0 ? null : jpegToGray(data);
      if (jpeg) {
        const info = jpegInfo(jpeg);
        if (info.width !== width || info.height !== height) jpeg = null;
      }
      if (!jpeg) {
        if (!this.decodeJpeg) return null;
        const px = await this.decodeJpeg(data);
        if (!px || px.width !== width || px.height !== height) return null;
        jpeg = encodeGrayJpeg(rgbaToGray(px.data, width, height), width, height, this.quality);
      }
      const out = PDFRawStream.of(dict.clone(ctx), jpeg);
      for (const k of ['DecodeParms', 'Length', 'DL']) out.dict.delete(N(k));
      out.dict.set(N('Filter'), N('DCTDecode'));
      out.dict.set(N('ColorSpace'), N('DeviceGray'));
      out.dict.set(N('BitsPerComponent'), ctx.obj(8));
      return out;
    }
    if (codec) return null;
    const px = decodePixels(ctx, dict, data, { gray: true });
    const set = { ColorSpace: N('DeviceGray'), BitsPerComponent: 8, Decode: undefined };
    // A colour-key mask names colours that are no longer there, so turn it
    // into a soft mask while the original samples are at hand.
    if (look(ctx, dict.get(N('Mask'))) instanceof PDFArray && !dict.get(N('SMask'))) {
      const alpha = decodeAlpha(ctx, dict, data, width, height);
      set.Mask = undefined;
      if (alpha) {
        set.SMask = this.register(this.ctx.flateStream(alpha, {
          Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
        }));
      }
    }
    return this.restream(img, px.data, set);
  }

  colorArray(dict, key) {
    const a = look(this.ctx, dict.get(N(key)));
    if (!(a instanceof PDFArray)) return;
    const c = a.asArray().map((x) => numOf(this.ctx, x, 0));
    const kind = c.length === 3 ? 'rgb' : c.length === 4 ? 'cmyk' : null;
    if (kind) dict.set(N(key), this.ctx.obj([toGray[kind](c)]));
  }

  // Form-field text colours ("0 0 1 rg /Helv 12 Tf").
  da(dict) {
    const v = look(this.ctx, dict.get(N('DA')));
    if (!(v instanceof PDFString || v instanceof PDFHexString)) return;
    const next = grayContent(v.asBytes());
    if (next) dict.set(N('DA'), PDFString.of(latin1(next).replace(/[\\()]/g, (c) => `\\${c}`)));
  }

  async annotations(page, res) {
    const ctx = this.ctx;
    for (const a of listOf(ctx, page.node.get(N('Annots')))) {
      if (!(a instanceof PDFDict)) continue;
      this.colorArray(a, 'C');
      this.colorArray(a, 'IC');
      const mk = look(ctx, a.get(N('MK')));
      if (mk instanceof PDFDict) { this.colorArray(mk, 'BG'); this.colorArray(mk, 'BC'); }
      this.da(a);
      const ap = look(ctx, a.get(N('AP')));
      if (!(ap instanceof PDFDict)) continue;
      for (const [k, v] of ap.entries()) {
        const x = look(ctx, v);
        if (x instanceof PDFRawStream) await this.stream(ap, k, v, res);
        else if (x instanceof PDFDict) for (const [s, sv] of x.entries()) await this.stream(x, s, sv, res);
      }
    }
  }

  async page(page) {
    const ctx = this.ctx;
    const res = pageResources(page.node);
    const parts = listOf(ctx, page.node.get(N('Contents')));
    const chunks = [];
    for (const s of parts) {
      if (!(s instanceof PDFRawStream)) continue;
      try { chunks.push(decodePDFRawStream(s).decode(), ascii('\n')); } catch { this.kept.other += 1; return; }
    }
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let p = 0;
    for (const c of chunks) { bytes.set(c, p); p += c.length; }
    const next = this.rewrite(bytes, res);
    if (next) page.node.set(N('Contents'), this.register(ctx.flateStream(next)));
    await this.resources(res);
    await this.annotations(page, res);
  }

  form() {
    const acro = look(this.ctx, this.doc.catalog.get(N('AcroForm')));
    if (!(acro instanceof PDFDict)) return;
    this.da(acro);
    const walk = (fields, depth) => {
      for (const f of listOf(this.ctx, fields)) {
        if (!(f instanceof PDFDict) || depth > 30) continue;
        this.da(f);
        walk(f.get(N('Kids')), depth + 1);
      }
    };
    walk(acro.get(N('Fields')), 0);
  }
}

// -> { bytes, kept: { pictures, shades, inline, other } } where kept counts
// the parts left in colour because they use a kind this can't change.
// decodeJpeg(bytes) -> { width, height, data: RGBA } is needed for JPEG
// photos; without it they are counted as kept.
export async function grayscalePdf(bytes, { decodeJpeg = null, quality = 85, onPage } = {}) {
  const doc = await loadPdf(bytes);
  const g = new Grayer(doc, { decodeJpeg, quality });
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    onPage?.(i, pages.length);
    await g.page(pages[i]);
  }
  g.form();
  return { bytes: await doc.save({ useObjectStreams: true }), kept: g.kept };
}

// The picture way: pages already drawn and made grey, as
// [{ jpeg (greyscale JPEG bytes), width, height (in points) }].
export async function pagesToGrayPdf(pages) {
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const img = await doc.embedJpg(p.jpeg);
    doc.addPage([p.width, p.height]).drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
  }
  return doc.save({ useObjectStreams: true });
}
