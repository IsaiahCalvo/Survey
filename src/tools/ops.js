// The PDF work behind the free tools. Pure pdf-lib, no DOM, so it runs (and is
// tested) in Node as well as the browser. Every function takes and returns
// bytes; nothing is uploaded anywhere.
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, StandardFonts, concatTransformationMatrix, degrees, drawObject,
  popGraphicsState, pushGraphicsState, rgb,
} from 'pdf-lib';

import { ToolError } from './errors.js';

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

// Draw `text` centred on visual point (cx, cy), turned `angle` degrees.
function drawCentered(page, text, { font, size, cx, cy, angle = 0, color, opacity = 1 }) {
  const f = visualFrame(page);
  const w = font.widthOfTextAtSize(text, size);
  const h = font.heightAtSize(size, { descender: false });
  const a = (angle * Math.PI) / 180;
  const vx = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
  const vy = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
  const p = f.toPage(vx, vy);
  page.drawText(text, { x: p.x, y: p.y, size, font, color, opacity, rotate: degrees(angle + f.rotation) });
}

export const NUMBER_FORMATS = {
  n: (n) => `${n}`,
  page: (n) => `Page ${n}`,
  of: (n, total) => `Page ${n} of ${total}`,
  slash: (n, total) => `${n} / ${total}`,
};

// position: '<top|bottom>-<left|center|right>'.
export async function addPageNumbers(bytes, { position = 'bottom-center', format = 'n', start = 1, skipFirst = false, size = 11 } = {}) {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const numbered = skipFirst ? pages.slice(1) : pages;
  const total = numbered.length + start - 1;
  const [v, hpos] = position.split('-');
  const fmt = NUMBER_FORMATS[format] || NUMBER_FORMATS.n;
  numbered.forEach((page, i) => {
    const f = visualFrame(page);
    const text = fmt(start + i, total);
    const margin = Math.max(18, Math.min(f.width, f.height) * 0.04);
    const w = font.widthOfTextAtSize(text, size);
    const cx = hpos === 'left' ? margin + w / 2 : hpos === 'right' ? f.width - margin - w / 2 : f.width / 2;
    const cy = v === 'top' ? f.height - margin : margin;
    drawCentered(page, text, { font, size, cx, cy, color: rgb(0.1, 0.1, 0.1) });
  });
  return save(doc);
}

export const WATERMARK_COLORS = {
  red: rgb(0.78, 0.22, 0.17),
  gray: rgb(0.45, 0.45, 0.45),
  blue: rgb(0.12, 0.31, 0.64),
  black: rgb(0, 0, 0),
};

// size: how much of the page's width (or its diagonal) the words span, 0.2 - 1.
export async function addWatermark(bytes, { text = 'DRAFT', size = 0.6, opacity = 0.25, color = 'red', diagonal = true } = {}) {
  const words = String(text).trim();
  if (!words) throw new ToolError('Type the words for the watermark.');
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = latin1(words);
  const unit = font.widthOfTextAtSize(clean, 1);
  for (const page of doc.getPages()) {
    const f = visualFrame(page);
    const span = diagonal ? Math.hypot(f.width, f.height) * 0.8 : f.width * 0.9;
    const angle = diagonal ? (Math.atan2(f.height, f.width) * 180) / Math.PI : 0;
    const fontSize = Math.max(6, Math.min((span * size) / unit, f.height * 0.5));
    drawCentered(page, clean, { font, size: fontSize, cx: f.width / 2, cy: f.height / 2, angle, color: WATERMARK_COLORS[color] || WATERMARK_COLORS.red, opacity });
  }
  return save(doc);
}

export const PAGE_SIZES = { letter: [612, 792], a4: [595.28, 841.89] };

// images: [{ bytes, type: 'jpg' | 'png' }]. pageSize 'fit' makes each page the
// image's size (at 96 DPI, so a phone photo isn't a metre wide); otherwise the
// image is scaled to fit inside the page and its margins.
export async function imagesToPdf(images, { pageSize = 'fit', orientation = 'auto', margin = 0 } = {}) {
  if (!images.length) throw new ToolError('Add at least one image.');
  const doc = await fresh();
  for (const img of images) {
    const embedded = img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const iw = embedded.width * 0.75;
    const ih = embedded.height * 0.75;
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

// Header and footer text. {page}, {total}, {date} and {file} are filled in.
export async function addHeaderFooter(bytes, { header = '', footer = '', align = 'center', size = 10, skipFirst = false, fileName = '', date = new Date() } = {}) {
  if (!header.trim() && !footer.trim()) throw new ToolError('Type a header, a footer, or both.');
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const day = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  pages.forEach((page, i) => {
    if (skipFirst && i === 0) return;
    const f = visualFrame(page);
    const margin = Math.max(18, Math.min(f.width, f.height) * 0.04);
    for (const [template, top] of [[header, true], [footer, false]]) {
      if (!template.trim()) continue;
      const text = latin1(template.replace(/\{page\}/g, i + 1).replace(/\{total\}/g, pages.length).replace(/\{date\}/g, day).replace(/\{file\}/g, fileName));
      const w = font.widthOfTextAtSize(text, size);
      const cx = align === 'left' ? margin + w / 2 : align === 'right' ? f.width - margin - w / 2 : f.width / 2;
      drawCentered(page, text, { font, size, cx, cy: top ? f.height - margin : margin, color: rgb(0.1, 0.1, 0.1) });
    }
  });
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
const clamp01 = (n) => Math.max(0, Math.min(1, n));

// pdf.js hands each text run over as its own item. Spaces usually live in the
// gap between items, not inside `str`, so joining on '' glued words together.
export function joinPdfTextItems(items) {
  let text = '';
  for (const it of items || []) {
    const str = it.str ?? '';
    if (text && !/[\s]$/.test(text) && str && !/^\s/.test(str)) text += ' ';
    text += str;
    if (it.hasEOL) text += '\n';
  }
  return text.trim();
}

function appearanceOf(annot, context) {
  const ap = annot.lookup(N('AP'));
  if (!(ap instanceof PDFDict)) return null;
  let normal = ap.get(N('N'));
  let resolved = context.lookup(normal);
  if (resolved instanceof PDFDict && !(resolved instanceof PDFStream)) {
    // PDF 32000 12.5.5: with no AS, use the default appearance state.
    const as = annot.get(N('AS'));
    const keys = resolved.keys();
    const state = (as && resolved.has(as) && as)
      || keys.find((k) => k === N('N') || k === N('On') || k === N('Yes'))
      || keys.find((k) => k !== N('Off'))
      || keys[0];
    normal = state && resolved.get(state);
    resolved = context.lookup(normal);
  }
  return resolved instanceof PDFStream ? normal : null;
}

function asNums(value) {
  return value instanceof PDFArray ? value.asArray().map(num) : [];
}

function annotColor(annot) {
  const c = asNums(annot.lookup(N('C')));
  if (!c.length) return rgb(1, 0.84, 0);
  if (c.length === 1) return rgb(clamp01(c[0]), clamp01(c[0]), clamp01(c[0]));
  if (c.length === 3) return rgb(clamp01(c[0]), clamp01(c[1]), clamp01(c[2]));
  const [cc, m, y, k] = c;
  return rgb(clamp01((1 - cc) * (1 - k)), clamp01((1 - m) * (1 - k)), clamp01((1 - y) * (1 - k)));
}

// Preview and several CAD writers omit /AP and let the viewer paint from
// /Rect, /C, /QuadPoints or /InkList. Burn that geometry into the page so
// flatten cannot drop a visible markup.
function drawMarkupFallback(page, annot, context) {
  const subtype = annot.get(N('Subtype'));
  if (subtype === N('Popup')) return true;
  const color = annotColor(annot);
  const ca = annot.lookup(N('CA'));
  const opacity = ca instanceof PDFNumber ? clamp01(ca.asNumber()) : subtype === N('Highlight') ? 0.4 : 1;
  const line = subtype === N('Underline') || subtype === N('StrikeOut');
  const box = (x, y, w, h) => {
    if (line) {
      const mid = subtype === N('StrikeOut') ? y + h / 2 : y;
      page.drawLine({ start: { x, y: mid }, end: { x: x + w, y: mid }, thickness: 1, color, opacity });
      return;
    }
    page.drawRectangle({
      x, y, width: Math.max(w, 0.5), height: Math.max(h, 0.5),
      color, opacity, borderWidth: 0,
    });
  };
  const quads = asNums(annot.lookup(N('QuadPoints')));
  if (quads.length >= 8) {
    for (let i = 0; i + 7 < quads.length; i += 8) {
      const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]];
      const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
      box(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
    return true;
  }
  const ink = annot.lookup(N('InkList'));
  if (ink instanceof PDFArray) {
    let drew = false;
    for (const entry of ink.asArray()) {
      const pts = asNums(context.lookup(entry));
      for (let i = 0; i + 3 < pts.length; i += 2) {
        page.drawLine({ start: { x: pts[i], y: pts[i + 1] }, end: { x: pts[i + 2], y: pts[i + 3] }, thickness: 1.5, color, opacity });
        drew = true;
      }
    }
    if (drew) return true;
  }
  const rect = asNums(annot.lookup(N('Rect')));
  if (rect.length < 4) return false;
  box(Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.abs(rect[2] - rect[0]), Math.abs(rect[3] - rect[1]));
  return true;
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
      const flags = num(annot.lookup(N('F')));
      const hidden = flags & 2 || flags & 32;
      const rect = annot.lookup(N('Rect'), PDFArray)?.asArray().map(num);
      const apRef = !hidden && appearanceOf(annot, context);
      if (apRef && rect) {
        const stream = context.lookup(apRef);
        if (!stream.dict.get(N('Subtype'))) stream.dict.set(N('Subtype'), N('Form'));
        if (!stream.dict.get(N('Type'))) stream.dict.set(N('Type'), N('XObject'));
        const name = page.node.newXObject(`Flat${p}_${k}`, apRef);
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...appearanceMatrix(stream, rect)), drawObject(name), popGraphicsState());
        changed += 1;
        return;
      }
      if (hidden || drawMarkupFallback(page, annot, context)) { changed += 1; return; }
      keep.push(ref);
    });
    if (keep.length) page.node.set(N('Annots'), context.obj(keep));
    else page.node.delete(N('Annots'));
  });
  if (!changed) throw new ToolError('This PDF has no form fields or markups to flatten.');
  doc.catalog.delete(N('AcroForm'));
  return save(doc);
}
