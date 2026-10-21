// The Compare PDFs report: a summary page, then one wide sheet per page pair
// with the old page on the left and the new page on the right. Removed words
// are marked red on the old page, added words green on the new page, and
// areas that look different get an orange box.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { ToolError } from './errors.js';
import {
  rowLabel, rowSummary, snippetLine, rowChanged, scanNote, shownSize, toShown,
} from './compare.js';

export const RED = rgb(0.86, 0.15, 0.15);
export const GREEN = rgb(0.08, 0.6, 0.25);
export const ORANGE = rgb(0.95, 0.55, 0.05);
const INK = rgb(0.13, 0.13, 0.15);
const GREY = rgb(0.45, 0.45, 0.5);

export { shownSize, toShown };

// drawPage options that put a page, turned as it is seen, with its lower left
// corner at (ox, oy) and scaled by s.
export function pagePlacement(view, rotate, ox, oy, s) {
  const w = (view[2] - view[0]) * s;
  const h = (view[3] - view[1]) * s;
  const at = { 0: [ox, oy], 90: [ox, oy + w], 180: [ox + w, oy + h], 270: [ox + h, oy] }[rotate] || [ox, oy];
  return { x: at[0], y: at[1], xScale: s, yScale: s, rotate: degrees(-rotate) };
}

// Word boxes (page units) -> rectangles on the sheet, with words next to each
// other on a line joined into one mark.
export function wordRects(page, indices, ox, oy, s) {
  const rects = [...indices].sort((p, q) => p - q).map((i) => {
    const [x0, y0, x1, y1] = page.words[i].box;
    const p = toShown(page.view, page.rotate, x0, y0);
    const q = toShown(page.view, page.rotate, x1, y1);
    return [ox + Math.min(p[0], q[0]) * s, oy + Math.min(p[1], q[1]) * s, ox + Math.max(p[0], q[0]) * s, oy + Math.max(p[1], q[1]) * s];
  });
  const out = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    const h = r[3] - r[1];
    const overlap = last ? Math.min(last[3], r[3]) - Math.max(last[1], r[1]) : 0;
    if (last && overlap > 0.5 * Math.min(h, last[3] - last[1]) && r[0] - last[2] < h * 1.5 && r[0] >= last[0]) {
      last[1] = Math.min(last[1], r[1]); last[2] = Math.max(last[2], r[2]); last[3] = Math.max(last[3], r[3]);
    } else out.push(r);
  }
  return out;
}

// The standard PDF fonts only know Western letters; anything else shows as "?".
function safeText(font, text) {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrap(font, text, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

async function openSource(bytes, which) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    throw new ToolError(`The ${which} file could not be read to make the report. It may be damaged.`);
  }
}

// result: from compareDocs(), with each row's optional `looks` (changed areas
// as 0..1 boxes from changedAreas()). opts.show: 'changed' | 'all'.
// rasterize(side, index) -> { bytes, type: 'jpg' | 'png' } is used for a page
// pdf-lib can't copy.
export async function buildReport({
  oldBytes, newBytes, oldName, newName, oldPages, newPages, result, show = 'changed', looked = false, rasterize, progress = () => {},
}) {
  const out = await PDFDocument.create();
  out.setTitle(`Compare: ${oldName} and ${newName}`);
  out.setCreator('Survey free PDF tools');
  out.setProducer('Survey');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const srcOld = await openSource(oldBytes, 'old');
  const srcNew = await openSource(newBytes, 'new');
  const rows = show === 'all' ? result.rows : result.rows.filter(rowChanged);

  addSummary(out, { font, bold }, {
    oldName, newName, oldPages, newPages, result, looked, shownCount: rows.length, show,
  });

  for (let n = 0; n < rows.length; n += 1) {
    progress(`Making the report: page ${n + 1} of ${rows.length}`);
    const row = rows[n];
    const sides = [
      row.a === null ? null : { page: oldPages[row.a], src: srcOld, index: row.a, side: 'old' },
      row.b === null ? null : { page: newPages[row.b], src: srcNew, index: row.b, side: 'new' },
    ];
    // eslint-disable-next-line no-await-in-loop
    await addSheet(out, { font, bold }, row, sides, rasterize);
  }
  return out.save();
}

function addSummary(out, fonts, info) {
  const { font, bold } = fonts;
  const W = 612;
  const H = 792;
  const M = 54;
  let page = out.addPage([W, H]);
  let y = H - M;
  const line = (text, { size = 11, f = font, color = INK, gap = 4, indent = 0 } = {}) => {
    for (const part of wrap(f, safeText(f, text), size, W - 2 * M - indent)) {
      if (y - size < M) {
        page = out.addPage([W, H]);
        y = H - M;
      }
      page.drawText(part, { x: M + indent, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };
  const key = (color, text, outline) => {
    if (y - 14 < M) { page = out.addPage([W, H]); y = H - M; }
    page.drawRectangle(outline
      ? { x: M, y: y - 12, width: 22, height: 12, borderColor: color, borderWidth: 1.5, borderDashArray: [3, 2] }
      : { x: M, y: y - 12, width: 22, height: 12, color, opacity: 0.35, borderColor: color, borderWidth: 1 });
    page.drawText(safeText(font, text), { x: M + 30, y: y - 10.5, size: 10.5, font, color: INK });
    y -= 18;
  };
  const { result } = info;
  line('What changed', { size: 22, f: bold, gap: 10 });
  line(`Old file: ${info.oldName} (${info.oldPages.length} ${info.oldPages.length === 1 ? 'page' : 'pages'})`, { color: GREY });
  line(`New file: ${info.newName} (${info.newPages.length} ${info.newPages.length === 1 ? 'page' : 'pages'})`, { color: GREY, gap: 14 });

  const lines = result.rows.map((row) => ({ row, text: rowSummary(row) })).filter((l) => l.text);
  const textChanged = result.removed + result.added > 0;
  if (!lines.length) {
    line(info.looked ? 'No changes found. The words match and the pages look the same.' : 'No changes found in the text.', { size: 14, f: bold, gap: 10 });
  } else {
    const pagesWord = lines.length === 1 ? 'page' : 'pages';
    line(`Changes on ${lines.length} ${pagesWord}${textChanged ? `: ${result.removed} ${result.removed === 1 ? 'word' : 'words'} removed, ${result.added} added` : ''}.`, { size: 14, f: bold, gap: 10 });
  }
  key(RED, 'Red: words taken out of the old file');
  key(GREEN, 'Green: words added in the new file');
  if (info.looked) key(ORANGE, 'Orange box: an area that looks different', true);
  y -= 8;
  const scans = scanNote(info.oldPages, info.newPages);
  if (scans) {
    line(scans, { color: GREY, gap: 12 });
  }
  if (lines.length) {
    line('Changes by page', { size: 14, f: bold, gap: 8 });
    for (const { row, text } of lines) {
      line(text, { size: 11, f: bold, gap: 3 });
      for (const s of row.snippets) line(snippetLine(s), { size: 10, color: GREY, indent: 14, gap: 3 });
      y -= 5;
    }
  }
  y -= 6;
  line(info.show === 'all'
    ? 'The next pages show every page side by side: old on the left, new on the right.'
    : info.shownCount
      ? 'The next pages show each changed page side by side: old on the left, new on the right.'
      : 'There are no changed pages to show.', { color: GREY, size: 10 });
}

async function addSheet(out, fonts, row, sides, rasterize) {
  const { font, bold } = fonts;
  const sizes = sides.map((s) => (s ? shownSize(s.page.view, s.page.rotate) : null));
  const present = sizes.filter(Boolean);
  // PDF pages can't be wider than 200 inches, so shrink huge sheets to fit.
  const fit = Math.min(1, 6400 / Math.max(...present.flat()));
  const slotW = Math.max(...present.map((d) => d[0])) * fit;
  const slotH = Math.max(...present.map((d) => d[1])) * fit;
  const unit = Math.max(1, Math.max(slotW, slotH) / 800);
  const M = 24 * unit;
  const G = 24 * unit;
  const head = 34 * unit;
  const textSize = 12 * unit;
  const sheetW = M * 2 + G + slotW * 2;
  const sheetH = M * 2 + head + slotH;
  const sheet = out.addPage([sheetW, sheetH]);
  sheet.drawLine({ start: { x: M + slotW + G / 2, y: M }, end: { x: M + slotW + G / 2, y: sheetH - M }, thickness: unit, color: rgb(0.8, 0.8, 0.84) });

  for (let k = 0; k < 2; k += 1) {
    const s = sides[k];
    const slotX = M + k * (slotW + G);
    const labelY = sheetH - M - textSize;
    const color = k ? GREEN : RED;
    if (!s) {
      sheet.drawRectangle({ x: slotX, y: M, width: slotW, height: slotH, color: rgb(0.95, 0.95, 0.96), borderColor: rgb(0.85, 0.85, 0.88), borderWidth: unit });
      const msg = k ? 'Not in the new file' : 'Not in the old file';
      const w = font.widthOfTextAtSize(msg, textSize * 1.2);
      sheet.drawText(msg, { x: slotX + (slotW - w) / 2, y: M + slotH / 2, size: textSize * 1.2, font, color: GREY });
      sheet.drawText(k ? 'New' : 'Old', { x: slotX, y: labelY, size: textSize, font: bold, color: GREY });
      continue;
    }
    const [dw, dh] = sizes[k];
    const sc = Math.min(slotW / dw, slotH / dh);
    const ox = slotX + (slotW - dw * sc) / 2;
    const oy = M + slotH - dh * sc;
    // eslint-disable-next-line no-await-in-loop
    await drawSource(out, sheet, s, ox, oy, sc, rasterize, dw, dh);
    sheet.drawRectangle({ x: ox, y: oy, width: dw * sc, height: dh * sc, borderColor: rgb(0.8, 0.8, 0.84), borderWidth: unit * 0.75 });

    const marks = k ? row.added : row.removed;
    const pad = 1.5 * unit;
    for (const r of wordRects(s.page, marks, ox, oy, sc)) {
      sheet.drawRectangle({
        x: r[0] - pad, y: r[1] - pad, width: r[2] - r[0] + 2 * pad, height: r[3] - r[1] + 2 * pad,
        color, opacity: 0.3, borderColor: color, borderWidth: Math.max(0.75, unit), borderOpacity: 0.9,
      });
    }
    for (const b of row.looks || []) {
      sheet.drawRectangle({
        x: ox + b[0] * dw * sc - 2 * unit, y: oy + (1 - b[3]) * dh * sc - 2 * unit,
        width: (b[2] - b[0]) * dw * sc + 4 * unit, height: (b[3] - b[1]) * dh * sc + 4 * unit,
        borderColor: ORANGE, borderWidth: 1.5 * unit, borderDashArray: [4 * unit, 3 * unit],
      });
    }
    const n = marks.length;
    const what = k ? `${n} ${n === 1 ? 'word' : 'words'} added` : `${n} ${n === 1 ? 'word' : 'words'} removed`;
    const label = `${k ? 'New' : 'Old'}: page ${s.index + 1}`;
    sheet.drawText(label, { x: slotX, y: labelY, size: textSize, font: bold, color: INK });
    sheet.drawText(n ? what : (row.looks?.length ? 'same words, looks different' : 'no word changes'), {
      x: slotX + bold.widthOfTextAtSize(label, textSize) + textSize, y: labelY, size: textSize, font, color: n ? color : GREY,
    });
  }
  const title = safeText(font, rowLabel(row));
  sheet.drawText(title, { x: sheetW - M - font.widthOfTextAtSize(title, textSize * 0.85), y: sheetH - M - textSize, size: textSize * 0.85, font, color: GREY });
}

async function drawSource(out, sheet, s, ox, oy, sc, rasterize, dw, dh) {
  const { view, rotate } = s.page;
  try {
    const src = s.src.getPage(s.index);
    const [emb] = await out.embedPages([src], [{ left: view[0], bottom: view[1], right: view[2], top: view[3] }]);
    sheet.drawPage(emb, pagePlacement(view, rotate, ox, oy, sc));
    return;
  } catch (err) {
    if (!rasterize) throw new ToolError(`Page ${s.index + 1} of the ${s.side} file could not be copied into the report.`);
  }
  const img = await rasterize(s.side, s.index);
  const embedded = img.type === 'png' ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes);
  sheet.drawImage(embedded, { x: ox, y: oy, width: dw * sc, height: dh * sc });
}
