// Placing whole PDF pages onto new sheets: resize to a paper size, several
// pages per sheet (N-up) and booklets. Pages are embedded as vector drawings
// (pdf-lib embedPages / drawPage), never turned into pictures. Pure pdf-lib,
// no DOM, so Node tests run it.
import { PDFDocument, PDFName, degrees, rgb } from 'pdf-lib';
import { loadPdf, flattenPdf } from './ops.js';
import { ToolError } from './errors.js';

const CREATOR = 'Survey free PDF tools (surveytool.app/tools)';
const INCH = 72;

// Portrait [width, height] in points.
export const SHEETS = {
  letter: [8.5 * INCH, 11 * INCH],
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  legal: [8.5 * INCH, 14 * INCH],
  tabloid: [11 * INCH, 17 * INCH],
  archd: [24 * INCH, 36 * INCH],
};

export async function freshDoc() {
  const doc = await PDFDocument.create();
  doc.setCreator(CREATOR);
  doc.setProducer(CREATOR);
  return doc;
}

export const saveDoc = (doc) => doc.save({ useObjectStreams: true });

// The page as people see it: crop box size with its /Rotate applied.
export function visualSize(page) {
  const box = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = r === 90 || r === 270;
  return { width: sideways ? box.height : box.width, height: sideways ? box.width : box.height, rotation: r, box };
}

// Largest scale that fits a w x h page inside a W x H box, centred.
export function fitInside(w, h, W, H) {
  const scale = Math.max(0, Math.min(W / w, H / h));
  return { scale, x: (W - w * scale) / 2, y: (H - h * scale) / 2, width: w * scale, height: h * scale };
}

export function orient([w, h], orientation, landscapeWanted) {
  const landscape = orientation === 'landscape' || (orientation === 'auto' && landscapeWanted);
  return landscape ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

// Where to put the origin and how much to turn an embedded page (drawn in its
// own unrotated crop-box space) so it shows the right way up in a target box
// of the visual size at (x, y). PDF /Rotate turns clockwise; drawPage turns
// counter-clockwise, so turn by -rotation and shift back into the box.
export function placement(rotation, w, h, scale, x, y) {
  const sw = w * scale;
  const sh = h * scale;
  if (rotation === 90) return { x, y: y + sw, rotate: -90 };
  if (rotation === 180) return { x: x + sw, y: y + sh, rotate: -180 };
  if (rotation === 270) return { x: x + sh, y, rotate: -270 };
  return { x, y, rotate: 0 };
}

// Opens the PDF and embeds every page once (shared fonts and images are
// copied once, not per page). Markups live outside the page's drawing, so
// embedding drops them; `keepMarkups` draws them into the page first.
async function embedAll(out, bytes, keepMarkups) {
  let source = bytes;
  if (keepMarkups) {
    try {
      source = await flattenPdf(bytes);
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
    }
  }
  const src = await loadPdf(source);
  const pages = src.getPages();
  if (!pages.length) throw new ToolError('This PDF has no pages.');
  for (const page of pages) {
    // A page with nothing drawn on it has no content stream, which embedding needs.
    if (!page.node.Contents()) page.node.set(PDFName.of('Contents'), src.context.register(src.context.stream('')));
  }
  const sizes = pages.map(visualSize);
  const boxes = sizes.map(({ box }) => ({ left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height }));
  const embedded = await out.embedPages(pages, boxes);
  return embedded.map((e, i) => ({ embedded: e, ...sizes[i] }));
}

// Draws one embedded page fitted inside the box (bx, by, bw, bh) on `sheet`.
function drawFitted(sheet, item, bx, by, bw, bh) {
  const fit = fitInside(item.width, item.height, bw, bh);
  const p = placement(item.rotation, item.box.width, item.box.height, fit.scale, bx + fit.x, by + fit.y);
  sheet.drawPage(item.embedded, { x: p.x, y: p.y, xScale: fit.scale, yScale: fit.scale, rotate: degrees(p.rotate) });
  return { x: bx + fit.x, y: by + fit.y, width: fit.width, height: fit.height };
}

// Every page scaled to fit `size` (a key of SHEETS) inside `margin` points.
// orientation 'auto' turns each sheet to match its page.
export async function resizePdf(bytes, { size = 'letter', orientation = 'auto', margin = 0, keepMarkups = true } = {}, onProgress) {
  const paper = SHEETS[size];
  if (!paper) throw new ToolError('Pick a page size.');
  const out = await freshDoc();
  const items = await embedAll(out, bytes, keepMarkups);
  items.forEach((item, i) => {
    onProgress?.(i, items.length);
    const [W, H] = orient(paper, orientation, item.width > item.height);
    const sheet = out.addPage([W, H]);
    drawFitted(sheet, item, margin, margin, W - margin * 2, H - margin * 2);
  });
  return saveDoc(out);
}

// Grids allowed for each count, as [cols, rows].
const GRIDS = { 2: [[2, 1], [1, 2]], 4: [[2, 2]], 6: [[3, 2], [2, 3]], 9: [[3, 3]] };

// The grid and sheet turn that show a w x h page biggest on a paper of
// [pw, ph] (either way round), after the outer margin and gaps between cells.
export function nUpLayout(per, [pw, ph], [w, h], { margin = 18, gap = 9 } = {}) {
  const grids = GRIDS[per];
  if (!grids) throw new ToolError('Pick 2, 4, 6 or 9 pages per sheet.');
  let best = null;
  for (const [cols, rows] of grids) {
    for (const [W, H] of [[pw, ph], [ph, pw]]) {
      const cw = (W - margin * 2 - gap * (cols - 1)) / cols;
      const ch = (H - margin * 2 - gap * (rows - 1)) / rows;
      const { scale } = fitInside(w, h, cw, ch);
      if (!best || scale > best.scale + 1e-9) best = { cols, rows, width: W, height: H, cellWidth: cw, cellHeight: ch, scale };
    }
  }
  if (best.cellWidth <= 0 || best.cellHeight <= 0) throw new ToolError('This page size is too small for that many pages.');
  return best;
}

// Cell k's bottom-left corner, filling across and then down from the top-left.
export function cellOrigin(layout, k, { margin = 18, gap = 9 } = {}) {
  const col = k % layout.cols;
  const row = Math.floor(k / layout.cols);
  return {
    x: margin + col * (layout.cellWidth + gap),
    y: layout.height - margin - (row + 1) * layout.cellHeight - row * gap,
  };
}

// sheet: a key of SHEETS, or 'first' to use the first page's own size.
export async function nUpPdf(bytes, { per = 4, sheet = 'letter', border = false, keepMarkups = true } = {}, onProgress) {
  const out = await freshDoc();
  const items = await embedAll(out, bytes, keepMarkups);
  const paper = sheet === 'first' ? [items[0].width, items[0].height] : SHEETS[sheet];
  if (!paper) throw new ToolError('Pick a sheet size.');
  const layout = nUpLayout(per, paper, [items[0].width, items[0].height]);
  let page;
  items.forEach((item, i) => {
    const k = i % per;
    if (k === 0) {
      onProgress?.(i / per, Math.ceil(items.length / per));
      page = out.addPage([layout.width, layout.height]);
    }
    const c = cellOrigin(layout, k);
    const r = drawFitted(page, item, c.x, c.y, layout.cellWidth, layout.cellHeight);
    if (border) page.drawRectangle({ ...r, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
  });
  return saveDoc(out);
}

// Page order for a folded, stapled booklet of `count` pages: padded with
// blanks (null) to a multiple of 4, as [left, right] pairs in print order:
// sheet 1 front, sheet 1 back, sheet 2 front, ...
export function bookletOrder(count) {
  if (count < 1) return [];
  const total = Math.ceil(count / 4) * 4;
  const at = (i) => (i < count ? i : null);
  const sides = [];
  for (let s = 0; s < total / 4; s += 1) {
    sides.push([at(total - 1 - 2 * s), at(2 * s)]);
    sides.push([at(2 * s + 1), at(total - 2 - 2 * s)]);
  }
  return sides;
}

// paper: a key of SHEETS (laid sideways, two pages per side), or 'double' for
// a sheet twice the first page's width.
export async function bookletPdf(bytes, { paper = 'letter', keepMarkups = true } = {}, onProgress) {
  const out = await freshDoc();
  const items = await embedAll(out, bytes, keepMarkups);
  if (paper !== 'double' && !SHEETS[paper]) throw new ToolError('Pick a paper size.');
  const first = items[0];
  const [W, H] = paper === 'double' ? [first.width * 2, first.height] : orient(SHEETS[paper], 'landscape');
  const margin = paper === 'double' ? 0 : 18;
  const half = W / 2;
  const sides = bookletOrder(items.length);
  sides.forEach((pair, s) => {
    onProgress?.(s, sides.length);
    const sheet = out.addPage([W, H]);
    pair.forEach((index, k) => {
      if (index === null) return;
      // Each page hugs the fold, so the two halves read as one spread.
      const item = items[index];
      const bw = half - margin;
      const bh = H - margin * 2;
      const fit = fitInside(item.width, item.height, bw, bh);
      const x = k === 0 ? half - fit.width : half;
      const p = placement(item.rotation, item.box.width, item.box.height, fit.scale, x, margin + fit.y);
      sheet.drawPage(item.embedded, { x: p.x, y: p.y, xScale: fit.scale, yScale: fit.scale, rotate: degrees(p.rotate) });
    });
  });
  return saveDoc(out);
}
