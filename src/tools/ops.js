// The PDF work behind the free tools. Pure pdf-lib, no DOM, so it runs (and is
// tested) in Node as well as the browser. Every function takes and returns
// bytes; nothing is uploaded anywhere.
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

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
  // The standard fonts only cover Latin-1; anything else would throw.
  const clean = words.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?');
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
