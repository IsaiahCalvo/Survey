// Word (.docx) to PDF in the browser. mammoth (BSD-2) reads the document into
// simple HTML; we parse that into blocks and lay them out with pdf-lib. This
// suits letters, reports and specs; text boxes, columns, shapes and headers
// don't carry over, so `inspectDocx` lists them for the page to warn about.
// Pure JS, no DOM, so it runs in Node tests too.
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import { ToolError } from './errors.js';

const CREATOR = 'Survey free PDF tools (surveytool.app/tools)';

// ---------------------------------------------------------------- reading

export function isDocx(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

// What in this document won't look the same in the PDF, in plain words.
export async function inspectDocx(bytes) {
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return [];
  }
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) return [];
  const notes = [];
  if (doc.includes('<w:txbxContent')) notes.push('text boxes');
  if (/<w:cols\b[^>]*w:num="([2-9]|\d\d)"/.test(doc)) notes.push('columns');
  if (doc.includes('<wp:anchor')) notes.push('pictures or shapes placed around the text');
  if (/<c:chart\b|<a:graphicData[^>]*\/chart"/.test(doc)) notes.push('charts');
  if (doc.includes('<m:oMath')) notes.push('equations');
  if (Object.keys(zip.files).some((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) notes.push('headers or footers');
  if (/[֐-ࣿ]/.test(doc)) notes.push('right-to-left text');
  return notes;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e] ?? m;
});

// mammoth's HTML is small and well formed, so a tag scanner is enough.
// Returns blocks: { kind: 'para', style, runs, list } | { kind: 'image', src }
// | { kind: 'table', rows: [[{ span, blocks }]] }. A run is { text, b, i, u,
// s, sup, sub, href } or { br: true }.
export function htmlToBlocks(html) {
  const tokens = [];
  const re = /<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] != null) tokens.push({ text: decode(m[5]) });
    else tokens.push({ close: !!m[1], tag: m[2].toLowerCase(), attrs: m[3], self: !!m[4] });
  }
  const attr = (a, name) => decode((new RegExp(`${name}="([^"]*)"`, 'i').exec(a || '') || [])[1] || '');

  let pos = 0;
  function parseBlocks(endTag, list) {
    const out = [];
    const marks = { b: 0, i: 0, u: 0, s: 0, sup: 0, sub: 0, href: null };
    let para = null;
    const flush = () => { if (para) { out.push(para); para = null; } };
    const ensure = () => (para ||= { kind: 'para', style: 'p', runs: [], list });
    while (pos < tokens.length) {
      const t = tokens[pos++];
      if (t.text != null) {
        if (!para && !t.text.trim()) continue;
        ensure().runs.push({ text: t.text, b: marks.b > 0, i: marks.i > 0, u: marks.u > 0, s: marks.s > 0, sup: marks.sup > 0, sub: marks.sub > 0, href: marks.href });
        continue;
      }
      const { tag, close } = t;
      if (close && tag === endTag) break;
      if (/^(p|h[1-6])$/.test(tag)) {
        if (close) { flush(); continue; }
        flush();
        para = { kind: 'para', style: tag, runs: [], list };
        continue;
      }
      if (tag === 'strong' || tag === 'b') { marks.b += close ? -1 : 1; continue; }
      if (tag === 'em' || tag === 'i') { marks.i += close ? -1 : 1; continue; }
      if (tag === 'u') { marks.u += close ? -1 : 1; continue; }
      if (tag === 's' || tag === 'del') { marks.s += close ? -1 : 1; continue; }
      if (tag === 'sup') { marks.sup += close ? -1 : 1; continue; }
      if (tag === 'sub') { marks.sub += close ? -1 : 1; continue; }
      if (tag === 'a') { marks.href = close ? null : (attr(t.attrs, 'href') || null); continue; }
      if (tag === 'br') { ensure().runs.push({ br: true }); continue; }
      if (tag === 'img') {
        const src = attr(t.attrs, 'src');
        flush();
        if (src) out.push({ kind: 'image', src });
        continue;
      }
      if ((tag === 'ul' || tag === 'ol') && !close) {
        flush();
        const depth = list ? list.depth + 1 : 0;
        let n = 0;
        while (pos < tokens.length) {
          const u = tokens[pos];
          if (u.tag === tag && u.close) { pos += 1; break; }
          pos += 1;
          if (u.tag === 'li' && !u.close) {
            n += 1;
            const items = parseBlocks('li', { depth, ordered: tag === 'ol', n, first: true });
            items.forEach((b, k) => { if (b.kind === 'para' && b.list?.depth === depth && k > 0) b.list = { ...b.list, first: false }; });
            out.push(...items);
          }
        }
        continue;
      }
      if (tag === 'table' && !close) {
        flush();
        const rows = [];
        while (pos < tokens.length) {
          const u = tokens[pos++];
          if (u.tag === 'table' && u.close) break;
          if (u.tag === 'tr' && !u.close) rows.push([]);
          if ((u.tag === 'td' || u.tag === 'th') && !u.close) {
            const span = Math.max(1, Number(attr(u.attrs, 'colspan')) || 1);
            const blocks = parseBlocks(u.tag, null);
            if (u.tag === 'th') blocks.forEach((b) => b.runs?.forEach((r) => { r.b = true; }));
            (rows[rows.length - 1] || rows[rows.push([]) - 1]).push({ span, blocks });
          }
        }
        if (rows.length) out.push({ kind: 'table', rows });
        continue;
      }
    }
    flush();
    // A paragraph that only holds an image already became an image block.
    return out.filter((b) => b.kind !== 'para' || b.runs.some((r) => r.br || r.text.trim()));
  }
  return parseBlocks(null, null);
}

export async function readDocx(bytes) {
  if (!isDocx(bytes)) {
    throw new ToolError('This isn\'t a .docx file. Older .doc files need to be saved as .docx in Word first.');
  }
  let result;
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // The browser build reads `arrayBuffer`, the Node build (tests) `buffer`.
    result = await mammoth.convertToHtml({ arrayBuffer: buf, buffer: buf }, { styleMap: ['u => u'], includeDefaultStyleMap: true });
  } catch {
    throw new ToolError('This Word file could not be read. It may be damaged, or locked with a password.');
  }
  const blocks = htmlToBlocks(result.value);
  if (!blocks.length) throw new ToolError('This document looks empty.');
  return blocks;
}

// ---------------------------------------------------------------- layout

const PAGE = { letter: [612, 792], a4: [595.28, 841.89] };
const STYLE = {
  p: { size: 11, before: 0, after: 8, bold: false },
  h1: { size: 20, before: 14, after: 8, bold: true },
  h2: { size: 16, before: 12, after: 6, bold: true },
  h3: { size: 13.5, before: 10, after: 6, bold: true },
  h4: { size: 12, before: 8, after: 4, bold: true },
  h5: { size: 11, before: 8, after: 4, bold: true },
  h6: { size: 11, before: 8, after: 4, bold: true },
};
const LINK = rgb(0.07, 0.3, 0.75);
const INK = rgb(0.1, 0.1, 0.1);
const RULE = rgb(0.6, 0.6, 0.6);
const LATIN1 = /^[\x09\x0a\x0d\x20-\x7e -ÿ•–—‘’“”…€]*$/;
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;

// Fonts: the PDF standard fonts cover Western text. Anything else uses
// `loadFont(kind)` ('unicode' or 'cjk'), which returns TTF bytes, embedded
// with fontkit. One face does duty for bold and italic there.
async function makeFonts(doc, blocks, family, loadFont, loadFontkit) {
  const std = family === 'serif'
    ? [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic]
    : [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique];
  const [r, b, i, bi] = await Promise.all(std.map((f) => doc.embedFont(f)));
  const text = [];
  const walk = (list) => list.forEach((x) => {
    if (x.kind === 'para') x.runs.forEach((run) => run.text && text.push(run.text));
    if (x.kind === 'table') x.rows.forEach((row) => row.forEach((c) => walk(c.blocks)));
  });
  walk(blocks);
  const all = text.join('');
  let uni = null;
  let cjk = null;
  if (!LATIN1.test(all)) {
    if (!loadFont || !loadFontkit) throw new ToolError('This document uses letters this tool can\'t draw yet.');
    doc.registerFontkit(await loadFontkit());
    uni = await doc.embedFont(await loadFont('unicode'), { subset: true });
    if (CJK.test(all)) cjk = await doc.embedFont(await loadFont('cjk'), { subset: true });
  }
  const pick = (run, ch) => {
    if (LATIN1.test(ch)) return run.b ? (run.i ? bi : b) : (run.i ? i : r);
    if (cjk && CJK.test(ch)) return cjk;
    return uni || r;
  };
  return { pick, regular: r, bold: b };
}

// Split runs into pieces that each use one font, then into words.
function words(runs, fonts, baseSize, bold) {
  const out = [];
  for (const run of runs) {
    if (run.br) { out.push({ br: true }); continue; }
    const style = { ...run, b: run.b || bold };
    const size = run.sup || run.sub ? baseSize * 0.7 : baseSize;
    // Words keep their trailing space; CJK characters break anywhere.
    const parts = run.text.replace(/\s+/g, ' ').match(/[⺀-鿿가-힯豈-﫿＀-￯]|[^ ⺀-鿿가-힯豈-﫿＀-￯]+ ?| /g) || [];
    for (const part of parts) {
      const pieces = [];
      for (const ch of part) {
        const font = fonts.pick(style, ch);
        const last = pieces[pieces.length - 1];
        if (last && last.font === font) last.text += ch;
        else pieces.push({ text: ch, font });
      }
      const width = pieces.reduce((w, p) => w + safeWidth(p.font, p.text, size), 0);
      out.push({ pieces, width, size, style, space: part.endsWith(' ') ? safeWidth(pieces[pieces.length - 1].font, ' ', size) : 0 });
    }
  }
  return out;
}

function safeWidth(font, text, size) {
  try { return font.widthOfTextAtSize(text, size); } catch { return size * 0.5 * text.length; }
}

// Break words into lines no wider than `width`. Over-long words are cut.
function lines(ws, width) {
  const out = [];
  let line = [];
  let w = 0;
  const push = () => { out.push(line); line = []; w = 0; };
  for (const word of ws) {
    if (word.br) { push(); continue; }
    if (w && w + word.width - word.space > width) {
      // Drop the trailing space of the last word on the line.
      push();
      if (word.pieces.length === 1 && word.pieces[0].text === ' ') continue;
    }
    if (word.width - word.space > width) {
      // A single word wider than the line: cut it by characters.
      for (const p of word.pieces) {
        for (const ch of p.text) {
          const cw = safeWidth(p.font, ch, word.size);
          if (w + cw > width && w) push();
          line.push({ pieces: [{ text: ch, font: p.font }], width: cw, size: word.size, style: word.style, space: 0 });
          w += cw;
        }
      }
      continue;
    }
    line.push(word);
    w += word.width;
  }
  if (line.length || !out.length) push();
  return out;
}

// `loadFont(kind)` and `loadFontkit()` are only called for documents with
// letters outside the standard PDF fonts, so most files never fetch them.
export async function docxBlocksToPdf(blocks, { pageSize = 'letter', font = 'sans', margin = 72, loadFont, loadFontkit, images = true } = {}) {
  const doc = await PDFDocument.create();
  doc.setCreator(CREATOR);
  doc.setProducer(CREATOR);
  const fonts = await makeFonts(doc, blocks, font, loadFont, loadFontkit);
  const [PW, PH] = PAGE[pageSize] || PAGE.letter;
  const left = margin;
  const contentW = PW - margin * 2;
  let page = null;
  let y = 0;
  const newPage = () => { page = doc.addPage([PW, PH]); y = PH - margin; };
  const room = (h) => { if (!page || y - h < margin) newPage(); };
  newPage();
  const links = new Map();
  let skipped = 0;

  const drawLine = (line, x0, top, lh, gather) => {
    const base = top - lh * 0.78;
    let x = x0;
    line.forEach((word, k) => {
      const last = k === line.length - 1;
      const st = word.style;
      const dy = st.sup ? word.size * 0.55 : st.sub ? -word.size * 0.2 : 0;
      const color = st.href ? LINK : INK;
      let wx = x;
      for (const p of word.pieces) {
        const t = last ? p.text.replace(/ $/, '') : p.text;
        if (!t) continue;
        try {
          page.drawText(t, { x: wx, y: base + dy, size: word.size, font: p.font, color });
        } catch { /* a glyph the font lacks; skip it rather than fail the file */ }
        wx += safeWidth(p.font, p.text, word.size);
      }
      const w = word.width - (last ? word.space : 0);
      if (st.u || st.href) page.drawLine({ start: { x, y: base - 1.2 }, end: { x: x + w, y: base - 1.2 }, thickness: 0.6, color });
      if (st.s) page.drawLine({ start: { x, y: base + word.size * 0.3 }, end: { x: x + w, y: base + word.size * 0.3 }, thickness: 0.6, color });
      if (st.href && gather) gather(st.href, [x, base - 2, x + w, base + word.size * 0.8]);
      x += word.width;
    });
  };

  const addLink = (href, rect) => {
    if (!/^(https?:|mailto:)/i.test(href)) return;
    const list = links.get(page) || [];
    list.push(doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) },
    })));
    links.set(page, list);
  };

  // Lay out one paragraph at x within width; `draw` false only measures.
  const paraLines = (block, width) => {
    const st = STYLE[block.style] || STYLE.p;
    return lines(words(block.runs, fonts, st.size, st.bold), width);
  };
  const listIndent = (block) => (block.list ? 18 * (block.list.depth + 1) : 0);

  async function picture(src, maxW) {
    const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src);
    if (!m || !images) { skipped += 1; return null; }
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    let img;
    try {
      img = m[1].toLowerCase() === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch { skipped += 1; return null; }
    const maxH = PH - margin * 2;
    const k = Math.min(1, maxW / (img.width * 0.75), maxH / (img.height * 0.75));
    return { img, w: img.width * 0.75 * k, h: img.height * 0.75 * k };
  }

  async function image(src, maxW, x) {
    const pic = await picture(src, maxW);
    if (!pic) return;
    // A portrait photo scales to the full content height; don't ask for extra
    // leading that would fail the room check at the top of a page.
    room(Math.min(pic.h + 6, PH - margin * 2));
    page.drawImage(pic.img, { x, y: y - pic.h, width: pic.w, height: pic.h });
    y -= pic.h + 8;
  }

  async function table(block) {
    const cols = Math.max(...block.rows.map((r) => r.reduce((n, c) => n + c.span, 0)));
    const colW = contentW / cols;
    const pad = 4;
    for (const row of block.rows) {
      // Measure every cell, then draw the row as one unit.
      let col = 0;
      const cells = [];
      for (const c of row) {
        const w = colW * c.span - pad * 2;
        const parts = [];
        for (const b of c.blocks) {
          if (b.kind === 'para') {
            const st = STYLE[b.style] || STYLE.p;
            parts.push({ ls: paraLines(b, w - listIndent(b)), lh: st.size * 1.3, indent: listIndent(b), block: b });
          } else if (b.kind === 'image') {
            const pic = await picture(b.src, w);
            if (pic) parts.push(pic);
          }
        }
        const h = parts.reduce((s, p) => s + (p.img ? p.h + 3 : p.ls.length * p.lh + 3), 0) + pad * 2;
        cells.push({ x: left + col * colW, w: colW * c.span, parts, h });
        col += c.span;
      }
      const rowH = Math.max(14, ...cells.map((c) => c.h));
      room(Math.min(rowH, PH - margin * 2));
      const top = y;
      for (const c of cells) {
        let cy = top - pad;
        for (const p of c.parts) {
          if (p.img) {
            if (cy - p.h < margin) break;
            page.drawImage(p.img, { x: c.x + pad, y: cy - p.h, width: p.w, height: p.h });
            cy -= p.h + 3;
            continue;
          }
          for (const l of p.ls) {
            if (cy - p.lh < margin) break;
            drawLine(l, c.x + pad + p.indent, cy, p.lh, addLink);
            cy -= p.lh;
          }
          cy -= 3;
        }
        page.drawRectangle({ x: c.x, y: top - rowH, width: c.w, height: rowH, borderColor: RULE, borderWidth: 0.5 });
      }
      y = top - rowH;
    }
    y -= 10;
  }

  for (const block of blocks) {
    if (block.kind === 'image') { await image(block.src, contentW, left); continue; }
    if (block.kind === 'table') { y -= 4; await table(block); continue; }
    const st = STYLE[block.style] || STYLE.p;
    const indent = listIndent(block);
    const ls = paraLines(block, contentW - indent);
    const lh = st.size * 1.35;
    if (st.before && y < PH - margin) y -= st.before;
    // Keep a heading with the first line of what follows it.
    room(block.style !== 'p' ? lh * 3 : lh);
    if (block.list?.first) {
      const marker = block.list.ordered ? `${block.list.n}.` : ['•', '–', '•'][block.list.depth % 3];
      page.drawText(marker, { x: left + indent - 14, y: y - lh * 0.78, size: st.size, font: fonts.regular, color: INK });
    }
    for (const l of ls) {
      room(lh);
      drawLine(l, left + indent, y, lh, addLink);
      y -= lh;
    }
    y -= block.list ? 3 : st.after;
  }

  for (const [pg, list] of links) pg.node.set(PDFName.of('Annots'), doc.context.obj(list));
  return { bytes: await doc.save({ useObjectStreams: true }), skippedImages: skipped };
}
