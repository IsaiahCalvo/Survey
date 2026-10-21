// A small RTF writer: paragraphs of plain text, with size and bold, and a page
// break between PDF pages. RTF is 7-bit text, so every other letter is written
// as \uN (N a signed 16-bit number; letters past U+FFFF as two of them) with
// \'3f, a question mark, for readers that don't know \u. Word writes it the
// same way; a bare "?" after \uN trips some readers into dropping a letter.

export function rtfEscape(text) {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (ch === '\t') out += '\\tab ';
    else if (ch === '\n') out += '\\line ';
    else if (c < 0x20) continue;
    else if (c < 0x80) out += ch;
    else {
      for (let i = 0; i < ch.length; i += 1) {
        const u = ch.charCodeAt(i);
        out += `\\u${u > 0x7fff ? u - 0x10000 : u}\\'3f`;
      }
    }
  }
  return out;
}

// RTF sizes are in half points.
const halfPoints = (pt) => Math.round(Math.min(48, Math.max(8, pt)) * 2);

// pages: [[{ text, size, bold, heading }]]; one inner list per PDF page.
export function writeRtf(pages, { title = '', pageBreaks = true } = {}) {
  const parts = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1',
    '{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}',
  ];
  if (title) parts.push(`{\\info{\\title ${rtfEscape(title)}}}`);
  parts.push('\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440\\f0\\fs22');
  pages.forEach((paras, n) => {
    if (n && pageBreaks) parts.push('\\page');
    for (const p of paras) {
      const size = p.heading === 1 ? Math.max(p.size, 18) : p.heading === 2 ? Math.max(p.size, 14) : p.size;
      const bold = p.bold || p.heading ? '\\b ' : '';
      parts.push(`\\pard\\sa160\\sl276\\slmult1\\fs${halfPoints(size)} ${bold}${rtfEscape(p.text)}${bold ? '\\b0' : ''}\\par`);
    }
  });
  parts.push('}');
  return new TextEncoder().encode(parts.join('\n'));
}
