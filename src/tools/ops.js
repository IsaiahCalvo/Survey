// The PDF work behind the free tools. Pure pdf-lib, no DOM, so it runs (and is
// tested) in Node as well as the browser. Every function takes and returns
// bytes; nothing is uploaded anywhere.
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, StandardFonts, concatTransformationMatrix, degrees, drawObject,
  popGraphicsState, pushGraphicsState, rgb,
} from 'pdf-lib';

import { ToolError } from './errors.js';
import { parsePageSet } from './ranges.js';

export { ToolError };

const CREATOR = 'Survey free PDF tools (surveytool.app/tools)';

export async function loadPdf(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(String(err?.message))) {
      throw new ToolError('This PDF is locked with a password. Unlock it first, then try again.');
    }
    throw new ToolError('This file could not be read as a PDF. It may be damaged.');
  }
  return doc;
}

function fresh() {
  return PDFDocument.create().then((doc) => {
    doc.setCreator(CREATOR);
    doc.setProducer(CREATOR);
    return doc;
  });
}

const save = (doc) => doc.save({ useObjectStreams: true });

// The standard PDF fonts only cover Latin-1; anything else would throw.
const latin1 = (text) => String(text).replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?');

export async function pageCount(bytes) {
  return (await loadPdf(bytes)).getPageCount();
}

export async function mergePdfs(list) {
  const out = await fresh();
  for (const bytes of list) {
    const src = await loadPdf(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return save(out);
}

// A new PDF holding `indexes` (0-based) of `src`, in that order.
async function copyOut(src, indexes) {
  const out = await fresh();
  const pages = await out.copyPages(src, indexes);
  pages.forEach((p) => out.addPage(p));
  return save(out);
}

export async function pickPages(bytes, indexes) {
  if (!indexes.length) throw new ToolError('Pick at least one page.');
  return copyOut(await loadPdf(bytes), indexes);
}

export async function deletePages(bytes, indexes) {
  const src = await loadPdf(bytes);
  const drop = new Set(indexes);
  const keep = src.getPageIndices().filter((i) => !drop.has(i));
  if (!drop.size) throw new ToolError('Pick at least one page to delete.');
  if (!keep.length) throw new ToolError('You can\'t delete every page. Leave at least one.');
  return copyOut(src, keep);
}

// groups: arrays of 0-based indexes, one output file per group.
export async function splitPdf(bytes, groups, onProgress) {
  const src = await loadPdf(bytes);
  const out = [];
  for (let g = 0; g < groups.length; g += 1) {
    onProgress?.(g, groups.length);
    out.push(await copyOut(src, groups[g]));
  }
  return out;
}

// turns: { [pageIndex]: quarter turns clockwise (any integer) }.
export async function rotatePages(bytes, turns) {
  const doc = await loadPdf(bytes);
  doc.getPages().forEach((page, i) => {
    const q = turns[i] || 0;
    if (q % 4 === 0) return;
    const next = (((page.getRotation().angle + q * 90) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  });
  return save(doc);
}

// Where a point in the page as people see it (rotation applied, origin at the
// bottom-left of the crop box) sits in the page's own unrotated space, and how
// much to turn text so it reads level on screen.
export function visualFrame(page) {
  const box = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = r === 90 || r === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  const toPage = (vx, vy) => {
    if (r === 90) return { x: box.x + box.width - vy, y: box.y + vx };
    if (r === 180) return { x: box.x + box.width - vx, y: box.y + box.height - vy };
    if (r === 270) return { x: box.x + vy, y: box.y + box.height - vx };
    return { x: box.x + vx, y: box.y + vy };
  };
  return { width, height, rotation: r, toPage };
}

// Where to put a w x h box, turned `angle` degrees about its centre, so its
// centre lands on visual point (cx, cy): pdf-lib turns text and images about
// their bottom-left corner, in the page's own unrotated space.
function boxOrigin(f, { w, h, cx, cy, angle = 0 }) {
  const a = (angle * Math.PI) / 180;
  const vx = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
  const vy = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
  return { ...f.toPage(vx, vy), rotate: degrees(angle + f.rotation) };
}

// Draw `text` centred on visual point (cx, cy), turned `angle` degrees.
function drawCentered(page, text, { font, size, cx, cy, angle = 0, color, opacity = 1 }) {
  const f = visualFrame(page);
  const w = font.widthOfTextAtSize(text, size);
  const h = font.heightAtSize(size, { descender: false });
  const { x, y, rotate } = boxOrigin(f, { w, h, cx, cy, angle });
  page.drawText(text, { x, y, size, font, color, opacity, rotate });
}

const FONT_FAMILIES = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};
const embedStandard = (doc, family, bold) => doc.embedFont((FONT_FAMILIES[family] || FONT_FAMILIES.helvetica)[bold ? 1 : 0]);

// '#rrggbb' (or 'rrggbb') to a pdf-lib colour.
export function hexColor(hex, fallback = rgb(0, 0, 0)) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

// The pages (0-based) a stamp goes on: every page for an empty range or "all",
// otherwise the typed pages, like "2-10, 15".
export function stampPages(range, count, { skipFirst = false } = {}) {
  const text = String(range ?? '').trim();
  const picked = !text || /^all$/i.test(text) ? [...Array(count).keys()] : parsePageSet(text, count);
  const out = skipFirst ? picked.filter((i) => i !== 0) : picked;
  if (!out.length) throw new ToolError('There are no pages left to add it to. Check the pages you picked.');
  return out;
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function roman(n) {
  let s = '';
  let left = n;
  for (const [v, r] of ROMAN) while (left >= v) { s += r; left -= v; }
  return s;
}
// a, b ... z, aa, ab ... like spreadsheet columns.
function letters(n) {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
  return s;
}

// One page number in a number style: '1', 'i', 'I', 'a', 'A', or 'bates'
// (zero-padded to six digits between a prefix and a suffix).
export function numberText(n, { style = '1', prefix = '', suffix = '' } = {}) {
  if (style === 'bates') return `${prefix}${String(Math.max(0, n)).padStart(6, '0')}${suffix}`;
  if (n < 1 || !['i', 'I', 'a', 'A'].includes(style)) return String(n);
  if (style === 'i') return roman(n);
  if (style === 'I') return roman(n).toUpperCase();
  return style === 'a' ? letters(n) : letters(n).toUpperCase();
}

// {n} is the page's number and {p} the last number.
export const NUMBER_FORMATS = {
  n: '{n}', page: 'Page {n}', of: 'Page {n} of {p}', nof: '{n} of {p}', slash: '{n} / {p}', dash: '- {n} -',
};

// Edge distance for 'auto': a little more on big sheets.
const autoMargin = (f) => Math.max(18, Math.min(f.width, f.height) * 0.04);

// Draw one line in a top or bottom corner or middle, `y` points from the top
// or bottom edge and `x` from the side, as people see the page. Margins too
// big for a small page are cut down to a fifth of it.
function drawAtEdge(page, text, { font, size, top, align, x, y, color }) {
  const f = visualFrame(page);
  const w = font.widthOfTextAtSize(text, size);
  const th = font.heightAtSize(size, { descender: false });
  const side = Math.min(x, f.width * 0.2);
  const edge = Math.min(y, f.height * 0.2);
  const cx = align === 'left' ? side + w / 2 : align === 'right' ? f.width - side - w / 2 : f.width / 2;
  drawCentered(page, text, { font, size, cx, cy: top ? f.height - edge - th / 2 : edge + th / 2, color });
}

// position: '<top|bottom>-<left|center|right>'. format: a key of
// NUMBER_FORMATS, or 'custom' with `custom` text holding {n} and {p}.
// `pages` is a typed range ('' for all); numbering counts from `start` over
// the pages picked. margin: points from the edge, or 'auto'.
export async function addPageNumbers(bytes, {
  position = 'bottom-center', format = 'n', custom = '', style = '1', prefix = '', suffix = '', start = 1, skipFirst = false, pages = '',
  margin = 'auto', font: family = 'helvetica', bold = false, size = 11, color = '#1a1a1a',
} = {}) {
  const template = format === 'custom' ? String(custom) : NUMBER_FORMATS[format] || NUMBER_FORMATS.n;
  if (!template.trim()) throw new ToolError('Type the words to put on each page, with {n} where the number goes.');
  const doc = await loadPdf(bytes);
  const font = await embedStandard(doc, family, bold);
  const all = doc.getPages();
  const picked = stampPages(pages, all.length, { skipFirst });
  const total = picked.length + start - 1;
  const [v, align] = position.split('-');
  const ink = hexColor(color, rgb(0.1, 0.1, 0.1));
  const fmt = (n) => numberText(n, { style, prefix, suffix });
  picked.forEach((index, k) => {
    const page = all[index];
    const text = latin1(template.replace(/\{n\}/g, fmt(start + k)).replace(/\{p\}/g, fmt(total)));
    const m = margin === 'auto' ? autoMargin(visualFrame(page)) : Number(margin) || 0;
    drawAtEdge(page, text, { font, size, top: v === 'top', align, x: m, y: m, color: ink });
  });
  return save(doc);
}

export const WATERMARK_COLORS = {
  red: rgb(0.78, 0.22, 0.17),
  gray: rgb(0.45, 0.45, 0.45),
  blue: rgb(0.12, 0.31, 0.64),
  black: rgb(0, 0, 0),
};

// Move what pdf-lib just drew on this page to the start of its content, so
// the page's own drawing paints over it. pdf-lib adds its drawing as the last
// content stream, after wrapping the page's own streams in q ... Q.
function sendBehind(page) {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray) || contents.size() < 2) return;
  const last = contents.get(contents.size() - 1);
  contents.remove(contents.size() - 1);
  contents.insert(0, last);
}

// Where the centre of a box goes for a spot on the 3 x 3 grid. ex and ey are
// half the box's width and height once turned; a box too big for its spot is
// centred instead.
function gridSpot(f, spot, ex, ey) {
  const m = autoMargin(f);
  let [row, col] = ['middle', 'center'];
  if (spot.includes('-')) [row, col] = spot.split('-');
  else if (spot === 'top' || spot === 'bottom') row = spot;
  else if (spot === 'left' || spot === 'right') col = spot;
  const fitX = ex * 2 <= f.width - 2 * m;
  const fitY = ey * 2 <= f.height - 2 * m;
  const cx = !fitX || col === 'center' ? f.width / 2 : col === 'left' ? m + ex : f.width - m - ex;
  const cy = !fitY || row === 'middle' ? f.height / 2 : row === 'bottom' ? m + ey : f.height - m - ey;
  return [cx, cy];
}

// Watermark words, or an image (`image`: { bytes, type: 'png' | 'jpg' }).
// size: how much of the page it spans, 0.2 - 1 (each tile is smaller).
// angle: degrees, or 'diag' for corner to corner (the older `diagonal` flag
// still works). position: 'center', 'top-left' ... 'bottom-right', 'top',
// 'left' and so on. behind: under the page's own drawing. tile: repeat it
// across the page. pages: a typed range ('' for all).
export async function addWatermark(bytes, {
  text = 'DRAFT', image = null, size = 0.6, opacity = 0.25, color = 'red', diagonal = true, angle, position = 'center',
  font: family = 'helvetica', bold = true, behind = false, tile = false, pages = '',
} = {}) {
  const words = latin1(String(text).trim());
  if (!image && !words) throw new ToolError('Type the words for the watermark.');
  const doc = await loadPdf(bytes);
  let draw;
  let unitW;
  let unitH;
  if (image) {
    const embedded = image.type === 'png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
    [unitW, unitH] = [embedded.width, embedded.height];
    draw = (page, { w, h, ...at }) => page.drawImage(embedded, { ...at, width: w, height: h, opacity });
  } else {
    const font = await embedStandard(doc, family, bold);
    const ink = WATERMARK_COLORS[color] || hexColor(color, WATERMARK_COLORS.red);
    [unitW, unitH] = [font.widthOfTextAtSize(words, 1), font.heightAtSize(1, { descender: false })];
    draw = (page, { w, h, ...at }) => page.drawText(words, { ...at, size: w / unitW, font, color: ink, opacity });
  }
  const all = doc.getPages();
  for (const index of stampPages(pages, all.length)) {
    const page = all[index];
    const f = visualFrame(page);
    const deg = angle === 'diag' || (angle == null && diagonal) ? (Math.atan2(f.height, f.width) * 180) / Math.PI : Number(angle) || 0;
    const a = (deg * Math.PI) / 180;
    const [cos, sin] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))];
    let w;
    if (image) {
      w = unitW * Math.min((f.width * size) / unitW, (f.height * size) / unitH) * (tile ? 0.3 : 1);
    } else {
      // The longest line through the middle of the page at this angle.
      const reach = Math.min(cos > 1e-6 ? f.width / cos : Infinity, sin > 1e-6 ? f.height / sin : Infinity);
      w = unitW * Math.max(6, Math.min((reach * 0.85 * size) / unitW, f.height * 0.5) * (tile ? 0.3 : 1));
    }
    let h = (w / unitW) * unitH;
    if (!tile) {
      // Once turned, it must still fit inside the page's margins.
      const m = autoMargin(f);
      const k = Math.min(1, (f.width - 2 * m) / (w * cos + h * sin), (f.height - 2 * m) / (w * sin + h * cos));
      w *= k;
      h *= k;
    }
    const place = (cx, cy) => draw(page, { w, h, ...boxOrigin(f, { w, h, cx, cy, angle: deg }) });
    if (tile) {
      // Rows along the angle, every other row shifted half a step, out past
      // the corners so the page is covered whatever the angle.
      const stepU = w * 1.5;
      const stepV = h * 4;
      const pad = Math.max(w, h);
      const reachAll = Math.hypot(f.width, f.height) / 2 + pad;
      const nu = Math.ceil(reachAll / stepU) + 1;
      const nv = Math.ceil(reachAll / stepV) + 1;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      for (let j = -nv; j <= nv; j += 1) {
        for (let i = -nu; i <= nu; i += 1) {
          const u = (i + (j % 2 ? 0.5 : 0)) * stepU;
          const v = j * stepV;
          const cx = f.width / 2 + u * c - v * s;
          const cy = f.height / 2 + u * s + v * c;
          if (cx > -pad && cy > -pad && cx < f.width + pad && cy < f.height + pad) place(cx, cy);
        }
      }
    } else {
      place(...gridSpot(f, position, (w * cos + h * sin) / 2, (w * sin + h * cos) / 2));
    }
    if (behind) sendBehind(page);
  }
  return save(doc);
}

export const PAGE_SIZES = { letter: [612, 792], a4: [595.28, 841.89] };

// images: [{ bytes, type: 'jpg' | 'png', dpi? }]. pageSize 'fit' makes each page
// the image's size (at its own DPI when known, like a scan, else 96 DPI so a
// phone photo isn't a metre wide); otherwise the
// image is scaled to fit inside the page and its margins.
export async function imagesToPdf(images, { pageSize = 'fit', orientation = 'auto', margin = 0 } = {}) {
  if (!images.length) throw new ToolError('Add at least one image.');
  const doc = await fresh();
  for (const img of images) {
    const embedded = img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const k = 72 / (img.dpi > 0 ? img.dpi : 96);
    const iw = embedded.width * k;
    const ih = embedded.height * k;
    let pw;
    let ph;
    if (pageSize === 'fit') {
      pw = iw + margin * 2;
      ph = ih + margin * 2;
    } else {
      [pw, ph] = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
      const landscape = orientation === 'landscape' || (orientation === 'auto' && iw > ih);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const scale = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih, pageSize === 'fit' ? 1 : Infinity);
    const w = iw * scale;
    const h = ih * scale;
    const page = doc.addPage([pw, ph]);
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return save(doc);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
// 'mdy' 10/21/2026, 'dmy' 21/10/2026, 'ymd' 2026-10-21, 'long' Oct 21, 2026.
export function formatDate(d, format = 'long') {
  const [y, m, day] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  if (format === 'mdy') return `${pad2(m)}/${pad2(day)}/${y}`;
  if (format === 'dmy') return `${pad2(day)}/${pad2(m)}/${y}`;
  if (format === 'ymd') return `${y}-${pad2(m)}-${pad2(day)}`;
  return `${MONTHS[m - 1]} ${pad2(day)}, ${y}`;
}

const BOXES = { tl: [true, 'left'], tc: [true, 'center'], tr: [true, 'right'], bl: [false, 'left'], bc: [false, 'center'], br: [false, 'right'] };

// Header and footer text in up to six boxes (tl, tc, tr, bl, bc, br: top or
// bottom, then left, centre or right). {page}, {total}, {date} and {file} are
// filled in. The older one-line form (header, footer, align) still works.
// marginY is from the top and bottom edges, marginX from the sides, in points.
export async function addHeaderFooter(bytes, {
  boxes, header = '', footer = '', align = 'center', size = 12, skipFirst = false, pages = '', fileName = '', date = new Date(),
  dateFormat = 'long', font: family = 'helvetica', bold = false, color = '#1a1a1a', marginY = 36, marginX = 72,
} = {}) {
  const side = { left: 'l', center: 'c', right: 'r' }[align] || 'c';
  const texts = boxes || { [`t${side}`]: header, [`b${side}`]: footer };
  const used = Object.entries(texts).filter(([k, t]) => BOXES[k] && String(t ?? '').trim());
  if (!used.length) throw new ToolError('Type a header, a footer, or both.');
  const doc = await loadPdf(bytes);
  const font = await embedStandard(doc, family, bold);
  const all = doc.getPages();
  const day = formatDate(date, dateFormat);
  const ink = hexColor(color, rgb(0.1, 0.1, 0.1));
  for (const i of stampPages(pages, all.length, { skipFirst })) {
    for (const [key, template] of used) {
      const text = latin1(String(template).replace(/\{page\}/g, i + 1).replace(/\{total\}/g, all.length).replace(/\{date\}/g, day).replace(/\{file\}/g, fileName));
      const [top, align2] = BOXES[key];
      drawAtEdge(all[i], text, { font, size, top, align: align2, x: marginX, y: marginY, color: ink });
    }
  }
  return save(doc);
}

// New order of pages: [{ index, turns }]. The same index may appear twice.
export async function organizePages(bytes, order) {
  if (!order.length) throw new ToolError('Keep at least one page.');
  const src = await loadPdf(bytes);
  const out = await fresh();
  const pages = await out.copyPages(src, order.map((o) => o.index));
  pages.forEach((p, k) => {
    const q = order[k].turns || 0;
    if (q % 4) p.setRotation(degrees((((p.getRotation().angle + q * 90) % 360) + 360) % 360));
    out.addPage(p);
  });
  return save(out);
}

const N = (n) => PDFName.of(n);
const num = (v) => (v instanceof PDFNumber ? v.asNumber() : 0);

function appearanceOf(annot, context) {
  const ap = annot.lookup(N('AP'));
  if (!(ap instanceof PDFDict)) return null;
  let normal = ap.get(N('N'));
  let resolved = context.lookup(normal);
  if (resolved instanceof PDFDict && !(resolved instanceof PDFStream)) {
    const state = annot.get(N('AS'));
    normal = state ? resolved.get(state) : undefined;
    resolved = context.lookup(normal);
  }
  return resolved instanceof PDFStream ? normal : null;
}

// Where an appearance stream lands on the page: its BBox, run through its own
// Matrix, is scaled onto the annotation's Rect (PDF 32000 12.5.5).
function appearanceMatrix(stream, rect) {
  const bbox = stream.dict.lookup(N('BBox'), PDFArray)?.asArray().map(num) || [0, 0, 1, 1];
  const m = stream.dict.lookup(N('Matrix'))?.asArray?.().map(num) || [1, 0, 0, 1, 0, 0];
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
    .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [bx0, by0, bx1, by1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [rx0, ry0, rx1, ry1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const sx = bx1 - bx0 ? (rx1 - rx0) / (bx1 - bx0) : 1;
  const sy = by1 - by0 ? (ry1 - ry0) / (by1 - by0) : 1;
  return [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy];
}

// Flatten: form fields and markups become part of the page, so they print and
// show everywhere and can no longer be edited. Links keep working.
export async function flattenPdf(bytes) {
  const doc = await loadPdf(bytes);
  const { context } = doc;
  let changed = 0;
  try {
    const form = doc.getForm();
    if (form.getFields().length) {
      form.flatten({ updateFieldAppearances: true });
      changed += 1;
    }
  } catch {
    // A broken form still has its markups flattened below.
  }
  doc.getPages().forEach((page, p) => {
    const annots = page.node.Annots();
    if (!annots) return;
    const keep = [];
    annots.asArray().forEach((ref, k) => {
      const annot = context.lookup(ref);
      if (!(annot instanceof PDFDict)) return;
      if (annot.get(N('Subtype')) === N('Link')) { keep.push(ref); return; }
      changed += 1;
      const flags = num(annot.lookup(N('F')));
      const hidden = flags & 2 || flags & 32;
      const apRef = !hidden && appearanceOf(annot, context);
      const rect = annot.lookup(N('Rect'), PDFArray)?.asArray().map(num);
      if (!apRef || !rect) return;
      const stream = context.lookup(apRef);
      if (!stream.dict.get(N('Subtype'))) stream.dict.set(N('Subtype'), N('Form'));
      if (!stream.dict.get(N('Type'))) stream.dict.set(N('Type'), N('XObject'));
      const name = page.node.newXObject(`Flat${p}_${k}`, apRef);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...appearanceMatrix(stream, rect)), drawObject(name), popGraphicsState());
    });
    if (keep.length) page.node.set(N('Annots'), context.obj(keep));
    else page.node.delete(N('Annots'));
  });
  if (!changed) throw new ToolError('This PDF has no form fields or markups to flatten.');
  doc.catalog.delete(N('AcroForm'));
  return save(doc);
}

// Trim the same amount (in points) off every edge of every page.
export async function cropPdf(bytes, { trim = 36 } = {}) {
  const doc = await loadPdf(bytes);
  for (const page of doc.getPages()) {
    const box = page.getCropBox();
    const t = Math.min(trim, box.width / 2 - 36, box.height / 2 - 36);
    if (t <= 0) throw new ToolError('These pages are too small to trim that much.');
    page.setCropBox(box.x + t, box.y + t, box.width - 2 * t, box.height - 2 * t);
  }
  return save(doc);
}

export async function readDetails(bytes) {
  const doc = await loadPdf(bytes);
  return {
    title: doc.getTitle() || '', author: doc.getAuthor() || '', subject: doc.getSubject() || '', keywords: doc.getKeywords() || '',
  };
}

export async function editDetails(bytes, { title = '', author = '', subject = '', keywords = '' } = {}) {
  const doc = await loadPdf(bytes);
  doc.setTitle(title.trim(), { showInWindowTitleBar: !!title.trim() });
  doc.setAuthor(author.trim());
  doc.setSubject(subject.trim());
  doc.setKeywords(keywords.split(',').map((k) => k.trim()).filter(Boolean));
  doc.setModificationDate(new Date());
  return save(doc);
}

// Remove comments and markups. Form fields stay; links stay unless asked.
export async function removeAnnotations(bytes, { keepLinks = true } = {}) {
  const doc = await loadPdf(bytes);
  let removed = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep = annots.asArray().filter((ref) => {
      const sub = doc.context.lookup(ref)?.get?.(N('Subtype'));
      const stay = sub === N('Widget') || (keepLinks && sub === N('Link'));
      if (!stay) removed += 1;
      return stay;
    });
    if (keep.length) page.node.set(N('Annots'), doc.context.obj(keep));
    else page.node.delete(N('Annots'));
  }
  if (!removed) throw new ToolError('This PDF has no markups or comments to remove.');
  return save(doc);
}

const TEXT_FONTS = { sans: StandardFonts.Helvetica, serif: StandardFonts.TimesRoman, mono: StandardFonts.Courier };

// Plain text to PDF: wraps long lines, starts new pages as needed, keeps
// blank lines and form feeds (a form feed starts a new page).
export async function textToPdf(text, { pageSize = 'letter', font = 'sans', size = 11, margin = 54 } = {}) {
  const body = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  if (!body.trim()) throw new ToolError('This text file is empty.');
  const doc = await fresh();
  const f = await doc.embedFont(TEXT_FONTS[font] || TEXT_FONTS.sans);
  const [pw, ph] = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
  const lineH = size * 1.35;
  const maxW = pw - margin * 2;
  let page = null;
  let y = 0;
  const newPage = () => { page = doc.addPage([pw, ph]); y = ph - margin - size; };
  const wrap = (line) => {
    if (f.widthOfTextAtSize(line, size) <= maxW) return [line];
    const out = [];
    let cur = '';
    for (const word of line.split(/(\s+)/)) {
      if (f.widthOfTextAtSize(cur + word, size) <= maxW) { cur += word; continue; }
      if (cur.trim()) out.push(cur.trimEnd());
      cur = word.trimStart();
      while (f.widthOfTextAtSize(cur, size) > maxW) {
        let n = cur.length;
        while (n > 1 && f.widthOfTextAtSize(cur.slice(0, n), size) > maxW) n -= 1;
        out.push(cur.slice(0, n));
        cur = cur.slice(n);
      }
    }
    out.push(cur);
    return out;
  };
  newPage();
  for (const block of body.split('\f')) {
    if (y < ph - margin - size) newPage();
    for (const raw of block.split('\n')) {
      for (const line of wrap(latin1(raw))) {
        if (y < margin) newPage();
        if (line) page.drawText(line, { x: margin, y, size, font: f, color: rgb(0.08, 0.08, 0.08) });
        y -= lineH;
      }
    }
  }
  return save(doc);
}

// Put a signature image (PNG) on one page. `box` is where it goes on the page
// as people see it: fractions of the width and height from the top-left.
// `date`, when given, is written just under the signature (or above it, when
// the signature sits on the bottom edge).
export async function signPdf(bytes, { page: index = 0, image, box, date = '' }) {
  if (!image) throw new ToolError('Draw or type your signature first.');
  const doc = await loadPdf(bytes);
  const page = doc.getPage(Math.min(Math.max(0, index), doc.getPageCount() - 1));
  const f = visualFrame(page);
  const png = await doc.embedPng(image);
  const w = box.w * f.width;
  const h = box.h * f.height;
  const vx = box.x * f.width;
  const vy = f.height - (box.y + box.h) * f.height;
  const at = f.toPage(vx, vy);
  page.drawImage(png, { x: at.x, y: at.y, width: w, height: h, rotate: degrees(f.rotation) });
  if (date) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = Math.min(14, Math.max(7, h * 0.22));
    const text = latin1(date);
    const below = vy - size * 1.3;
    const ty = below >= 2 ? below : vy + h + size * 0.4;
    const p = f.toPage(vx, ty);
    page.drawText(text, { x: p.x, y: p.y, size, font, color: rgb(0.1, 0.1, 0.1), rotate: degrees(f.rotation) });
  }
  return save(doc);
}
