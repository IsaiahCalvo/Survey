// HTML page to PDF. The file is parsed with DOMParser, which never runs its
// scripts or loads anything it points to, and walked into the small, tidy
// HTML that htmlToBlocks (docx.js) reads: headings, paragraphs, bold and
// italic, links, lists, tables and pictures. Text stays real text. Colors,
// columns and page styling don't carry over.

const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math',
  'canvas', 'video', 'audio', 'head', 'title', 'meta', 'link', 'base', 'input', 'select', 'textarea', 'button', 'option',
  'datalist', 'dialog', 'map', 'source', 'track', 'param',
]);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'blockquote', 'pre', 'figure',
  'figcaption', 'address', 'center', 'form', 'fieldset', 'legend', 'details', 'summary', 'hr', 'body', 'dl', 'dt', 'dd',
  'caption', 'label',
]);
const INLINE = {
  b: 'b', strong: 'b', i: 'i', em: 'i', cite: 'i', var: 'i', dfn: 'i', u: 'u', ins: 'u', s: 's', del: 's', strike: 's', sup: 'sup', sub: 'sub',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hidden = (el) => el.hasAttribute('hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '');

// Inline styles people use instead of <b> or <i>.
function styleMarks(el) {
  const css = el.getAttribute('style') || '';
  const marks = [];
  const weight = /font-weight\s*:\s*(\w+)/i.exec(css)?.[1];
  if (weight && (/bold/i.test(weight) || Number(weight) >= 600)) marks.push('b');
  if (/font-style\s*:\s*(italic|oblique)/i.test(css)) marks.push('i');
  if (/text-decoration[^;]*underline/i.test(css)) marks.push('u');
  if (/text-decoration[^;]*line-through/i.test(css)) marks.push('s');
  return marks;
}

// `doc` is a parsed Document (DOMParser in the browser, jsdom in tests).
// Returns { html, linkedImages }: pictures that point at other files can't be
// read from a single .html file, so they're counted for a note.
export function pageToSimpleHtml(doc) {
  const out = [];
  let linkedImages = 0;
  let inTable = 0;
  let space = true; // the last thing written ends a line or a space
  let lastText = -1;
  // A space just before a line ends would be drawn, so it's dropped.
  const line = (tag) => {
    if (lastText >= 0 && lastText === out.length - 1 && out[lastText].endsWith(' ')) out[lastText] = out[lastText].slice(0, -1);
    out.push(tag);
    space = true;
  };

  // `line` writes tags that start or end a line; inline tags use out.push.
  function walk(node, pre) {
    if (node.nodeType === 3) {
      if (pre) {
        node.data.split('\n').forEach((t, k) => { if (k) out.push('<br>'); out.push(esc(t)); });
        space = false;
        return;
      }
      // Spaces fold the way a browser folds them.
      let text = node.data.replace(/\s+/g, ' ');
      if (space) text = text.replace(/^ /, '');
      if (!text) return;
      out.push(esc(text));
      lastText = out.length - 1;
      space = text.endsWith(' ');
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (SKIP.has(tag) || hidden(node)) return;
    const kids = (el = node, p = pre) => el.childNodes.forEach((c) => walk(c, p));
    const wrap = (open, close, el = node, p = pre) => { line(open); kids(el, p); line(close); };

    if (/^h[1-6]$/.test(tag)) {
      if (inTable) wrap('<p><b>', '</b></p>');
      else wrap(`<${tag}>`, `</${tag}>`);
      return;
    }
    if (tag === 'br') { line('<br>'); return; }
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (/^data:image\//i.test(src)) line(`<img src="${esc(src.replace(/\s+/g, ''))}">`);
      else if (src) linkedImages += 1;
      return;
    }
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href)) { kids(); return; }
      out.push(`<a href="${esc(href)}">`);
      kids();
      out.push('</a>');
      return;
    }
    if (tag === 'ul' || tag === 'ol' || tag === 'menu') {
      if (inTable) { kids(); return; }
      const t = tag === 'ol' ? 'ol' : 'ul';
      line(`<${t}>`);
      for (const c of node.children) {
        if (c.localName === 'li' && !hidden(c)) wrap('<li>', '</li>', c);
        else walk(c, pre);
      }
      line(`</${t}>`);
      return;
    }
    if (tag === 'li') { wrap('<p>', '</p>'); return; }
    if (tag === 'table') {
      // A table inside a table cell is read as plain paragraphs.
      if (inTable) { rowsOf(node).forEach((tr) => cellsOf(tr).forEach((td) => wrap('<p>', '</p>', td))); return; }
      const caption = node.querySelector(':scope > caption');
      if (caption) wrap('<p><b>', '</b></p>', caption);
      const rows = rowsOf(node);
      if (!rows.length) return;
      inTable += 1;
      line('<table>');
      for (const tr of rows) {
        line('<tr>');
        for (const td of cellsOf(tr)) {
          const span = Math.max(1, Math.min(50, Number(td.getAttribute('colspan')) || 1));
          const t = td.localName;
          wrap(span > 1 ? `<${t} colspan="${span}">` : `<${t}>`, `</${t}>`, td);
        }
        line('</tr>');
      }
      line('</table>');
      inTable -= 1;
      return;
    }
    if (tag === 'caption') return;
    const marks = [...(INLINE[tag] ? [INLINE[tag]] : []), ...(tag === 'dt' ? ['b'] : []), ...styleMarks(node)];
    const open = marks.map((k) => `<${k}>`).join('');
    const close = marks.reverse().map((k) => `</${k}>`).join('');
    if (BLOCK.has(tag)) {
      line('<p>');
      out.push(open);
      kids(node, pre || tag === 'pre');
      out.push(close);
      line('</p>');
      return;
    }
    out.push(open);
    kids();
    out.push(close);
  }

  walk(doc.body || doc.documentElement, false);
  return { html: out.join(''), linkedImages };
}

const rowsOf = (table) => [...table.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')];
const cellsOf = (tr) => [...tr.children].filter((c) => c.localName === 'td' || c.localName === 'th');

// The page's own charset when it names one (old pages often say windows-1252).
export function decodeHtml(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const named = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(named || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
