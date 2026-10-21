// Scanned pages: a page that is nothing but one JPEG laid over the whole page.
// Such a page can be shown, saved or read straight from its JPEG, which on a
// set of big scans is many times quicker than having pdf.js draw it. Anything
// less plain (more drawing, a turned or flipped picture, masks, markups) is
// left to pdf.js. Pure pdf-lib, no DOM, so Node tests cover it.
import { PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  N, look, nameOf, numOf, listOf, filtersOf, describeSpace,
} from './pdfImages.js';
import { jpegInfo } from './jpeg.js';

// Cheap first look, before reading the file with pdf-lib: are there about as
// many JPEGs as pages? Stops as soon as there are enough.
const NEEDLE = [0x2f, 0x44, 0x43, 0x54, 0x44, 0x65, 0x63, 0x6f, 0x64, 0x65]; // "/DCTDecode"
export function mightBeScans(bytes, pages) {
  const want = Math.max(1, Math.ceil(pages / 2));
  const n = bytes.length - NEEDLE.length;
  let found = 0;
  for (let i = bytes.indexOf(0x2f); i !== -1 && i <= n; i = bytes.indexOf(0x2f, i + 1)) {
    let k = 1;
    while (k < NEEDLE.length && bytes[i + k] === NEEDLE[k]) k += 1;
    if (k === NEEDLE.length && (found += 1) >= want) return true;
  }
  return false;
}

const isWs = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
// Operators that set state but draw nothing; anything else means the page has
// more on it than the picture.
const QUIET = new Set(['w', 'J', 'j', 'M', 'ri', 'i']);

// The one picture a content stream draws and the matrix it is drawn with, or
// null when the stream does anything else.
function onlyPicture(b) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const nums = [];
  let name = null;
  let drawn = null;
  for (let p = 0; p < b.length;) {
    const c = b[p];
    if (isWs(c)) { p += 1; continue; }
    if (c === 37) { while (p < b.length && b[p] !== 10 && b[p] !== 13) p += 1; continue; }
    if (c === 47) {
      const s = p + 1;
      p += 1;
      while (p < b.length && !isWs(b[p]) && !isDelim(b[p])) p += 1;
      name = String.fromCharCode(...b.subarray(s, p));
      continue;
    }
    if (isDelim(c)) return null; // strings, arrays, dictionaries
    const s = p;
    while (p < b.length && !isWs(b[p]) && !isDelim(b[p])) p += 1;
    const word = String.fromCharCode(...b.subarray(s, p));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { nums.push(Number(word)); continue; }
    if (word === 'q') stack.push(ctm);
    else if (word === 'Q') ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (word === 'cm') {
      if (nums.length !== 6) return null;
      const [a, bb, cc, d, e, f] = nums;
      const [A, B, C, D, E, F] = ctm;
      ctm = [a * A + bb * C, a * B + bb * D, cc * A + d * C, cc * B + d * D, e * A + f * C + E, e * B + f * D + F];
    } else if (word === 'Do') {
      if (drawn || !name) return null;
      drawn = { name, ctm };
    } else if (!QUIET.has(word)) return null;
    nums.length = 0;
    name = null;
  }
  return drawn;
}

// The page's resources, looking up the page tree when the page has none.
function resourcesOf(node) {
  for (let n = node, i = 0; n instanceof PDFDict && i < 64; n = n.lookup(N('Parent')), i += 1) {
    const r = n.lookup(N('Resources'));
    if (r instanceof PDFDict) return r;
  }
  return null;
}

// { jpeg, width, height, gray, box: { width, height } (points), rotate } for a
// page that is one plain JPEG over the whole page, else null.
export function findScan(doc, page) {
  const ctx = doc.context;
  const node = page.node;
  // Markups are drawn by pdf.js on top of the page; links draw nothing.
  for (const a of listOf(ctx, node.get(N('Annots')))) {
    if (!(a instanceof PDFDict) || nameOf(look(ctx, a.get(N('Subtype')))) !== 'Link') return null;
  }
  const chunks = [];
  for (const s of listOf(ctx, node.get(N('Contents')))) {
    // A scan's drawing instructions are a line or two.
    if (!(s instanceof PDFRawStream) || s.contents.length > 4096) return null;
    try { chunks.push(s.dict.get(N('Filter')) ? decodePDFRawStream(s).decode() : s.contents); } catch { return null; }
    chunks.push(Uint8Array.of(10));
  }
  const content = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  chunks.reduce((at, c) => { content.set(c, at); return at + c.length; }, 0);
  if (content.length > 4096) return null;
  const drawn = onlyPicture(content);
  if (!drawn) return null;

  const xobjects = look(ctx, resourcesOf(node)?.get(N('XObject')));
  const img = xobjects instanceof PDFDict ? look(ctx, xobjects.get(N(drawn.name))) : null;
  if (!(img instanceof PDFRawStream)) return null;
  const { dict } = img;
  if (nameOf(look(ctx, dict.get(N('Subtype')))) !== 'Image') return null;
  for (const key of ['ImageMask', 'Mask', 'SMask', 'Decode', 'SMaskInData']) if (dict.get(N(key))) return null;
  const filters = filtersOf(ctx, dict);
  if (filters.length !== 1 || filters[0].name !== 'DCTDecode' || filters[0].parms) return null;
  if (numOf(ctx, dict.get(N('BitsPerComponent')), 8) !== 8) return null;
  // Device colours, or an ICC profile standing for them. Calibrated and Lab
  // colours need converting, which pdf.js does and a plain decode doesn't.
  const cs = look(ctx, dict.get(N('ColorSpace')));
  const space = describeSpace(ctx, cs);
  const device = ['DeviceRGB', 'DeviceGray'].includes(nameOf(cs)) || space.icc;
  if (!device || !['gray', 'rgb'].includes(space.kind)) return null;
  const jpeg = img.contents;
  const info = jpegInfo(jpeg);
  const width = numOf(ctx, dict.get(N('Width')), 0);
  const height = numOf(ctx, dict.get(N('Height')), 0);
  if (!info || info.width !== width || info.height !== height || info.precision !== 8 || info.orientation !== 1) return null;
  if (![0xc0, 0xc1, 0xc2].includes(info.sof) || info.components !== space.n) return null;

  // The picture must stand upright and fill the visible page.
  const [a, b, c, d, e, f] = drawn.ctm;
  if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || a <= 0 || d <= 0) return null;
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const x0 = Math.max(crop.x, media.x);
  const y0 = Math.max(crop.y, media.y);
  const x1 = Math.min(crop.x + crop.width, media.x + media.width);
  const y1 = Math.min(crop.y + crop.height, media.y + media.height);
  if (!(x1 > x0 && y1 > y0)) return null;
  const tx = Math.max(1, (x1 - x0) * 0.005);
  const ty = Math.max(1, (y1 - y0) * 0.005);
  if (Math.abs(e - x0) > tx || Math.abs(e + a - x1) > tx || Math.abs(f - y0) > ty || Math.abs(f + d - y1) > ty) return null;
  const rotate = ((page.getRotation().angle % 360) + 360) % 360;
  if (rotate % 90) return null;
  return {
    jpeg, width, height, gray: info.components === 1, box: { width: x1 - x0, height: y1 - y0 }, rotate,
  };
}

// findScan for every page; pages that aren't plain scans are null.
export function findScans(doc) {
  return doc.getPages().map((page) => {
    try {
      return findScan(doc, page);
    } catch {
      return null;
    }
  });
}

// Pixels per inch the scan has across the page.
export const scanDpi = (scan) => (scan.width / scan.box.width) * 72;
