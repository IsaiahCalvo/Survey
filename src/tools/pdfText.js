// A page's words as lines and paragraphs, from pdf.js getTextContent(). Pure
// functions over the text items, so the PDF to document tools (RTF, HTML text
// only, Word) can share one grouping step.
//   textLines(items)            -> [{ x, y, size, text, bold }]  top to bottom
//   textParagraphs(lines)       -> [{ text, size, bold, lines }]
//   markHeadings(paras, body?)  -> same paragraphs with heading: 0 | 1 | 2
//   bodySize(paras)             -> the size most letters are in
//   pageParagraphs(page)        -> textParagraphs(textLines(...)) for a pdf.js page

// Size of an item: the height of its text matrix, in PDF points.
const sizeOf = (it) => Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;
// Text that runs along the page, not up it or upside down.
const isLevel = (it) => Math.abs(it.transform[1]) < 1e-3 && Math.abs(it.transform[2]) < 1e-3 && it.transform[0] > 0;

// `bold` tells whether an item's font is bold; pdf.js only knows the real font
// name after the page is drawn, so by default nothing is bold.
export function textLines(items, { bold = () => false } = {}) {
  const words = [];
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const size = sizeOf(it);
    if (!size) continue;
    words.push({ it, x: it.transform[4], y: it.transform[5], size, level: isLevel(it) });
  }
  // Top of the page first, then left to right.
  words.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const w of words) {
    // Words share a line when their baselines are within a third of a letter.
    let line = w.level ? lines.find((l) => l.level && Math.abs(l.y - w.y) < Math.min(l.size, w.size) / 3) : null;
    if (!line) {
      line = { y: w.y, size: w.size, level: w.level, words: [] };
      lines.push(line);
    }
    line.words.push(w);
  }
  const out = [];
  for (const l of lines) {
    l.words.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    let size = 0;
    let chars = 0;
    let boldChars = 0;
    for (const w of l.words) {
      const s = w.it.str;
      // A gap wider than a quarter of a letter is a space the PDF didn't spell out.
      if (end != null && w.x - end > w.size * 0.25 && !/\s$/.test(text) && !/^\s/.test(s)) text += ' ';
      text += s;
      end = w.x + (w.it.width || 0);
      size += w.size * s.length;
      chars += s.length;
      if (bold(w.it)) boldChars += s.length;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ x: l.words[0].x, y: l.y, size: size / chars, text, bold: boldChars > chars / 2 });
  }
  out.sort((a, b) => b.y - a.y || a.x - b.x);
  return out;
}

// Lines join into a paragraph while they sit close under each other in the
// same size and weight.
export function textParagraphs(lines) {
  const paras = [];
  let cur = null;
  let prev = null;
  for (const line of lines) {
    const gap = prev ? prev.y - line.y : 0;
    const sameLook = prev && Math.abs(line.size - prev.size) <= Math.max(prev.size, line.size) * 0.15 && line.bold === prev.bold;
    const close = prev && gap > 0 && gap < Math.max(prev.size, line.size) * 1.7;
    const lined = prev && Math.abs(line.x - prev.x) < prev.size * 6;
    if (cur && sameLook && close && lined) {
      cur.lines.push(line);
      // A word broken over two lines with a hyphen joins back up.
      cur.text = /[a-z]-$/i.test(cur.text) && /^[a-z]/.test(line.text) ? cur.text + line.text : `${cur.text} ${line.text}`;
    } else {
      cur = { text: line.text, size: line.size, bold: line.bold, lines: [line] };
      paras.push(cur);
    }
    prev = line;
  }
  return paras;
}

export function bodySize(paras) {
  const count = new Map();
  for (const p of paras) {
    const k = Math.round(p.size * 2) / 2;
    count.set(k, (count.get(k) || 0) + p.text.length);
  }
  let best = 0;
  let most = -1;
  for (const [k, n] of count) if (n > most) { most = n; best = k; }
  return best;
}

// Short paragraphs in clearly bigger letters than the body are headings:
// 1 for the biggest, 2 for the rest.
export function markHeadings(paras, body = bodySize(paras)) {
  return paras.map((p) => {
    let heading = 0;
    if (body && p.text.length <= 200) {
      if (p.size >= body * 1.6) heading = 1;
      else if (p.size >= body * 1.2 || (p.bold && p.text.length <= 80 && p.lines.length <= 2)) heading = 2;
    }
    return { ...p, heading };
  });
}

export async function pageParagraphs(page, opts) {
  const { items } = await page.getTextContent();
  return textParagraphs(textLines(items, opts));
}
