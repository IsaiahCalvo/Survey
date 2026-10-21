// RTF to the blocks docx.js lays out (see htmlToBlocks there for the shape).
// RTF is plain text with {groups} and \control words, so a small reader is
// enough: bold, italic, underline, strike, super/subscript, headings (by
// outline level or a "heading N" style), lists, tables, links and PNG/JPEG
// pictures. rtf.js, the usual library, has no table support and weighs 2 MB.
// Pure JS, no DOM, so it runs in Node tests too.
import { ToolError } from './errors.js';

// \fcharsetN to Windows code page.
const CHARSET_CP = {
  0: 1252, 77: 10000, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254,
  163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250,
};
// Groups whose text isn't part of the body.
const SKIP = new Set([
  'colortbl', 'info', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl',
  'footerr', 'footerf', 'footnote', 'annotation', 'object', 'nonshppict', 'listtable', 'listoverridetable',
  'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl',
  'rsidtbl', 'generator', 'pgdsctbl', 'revtbl', 'filetbl', 'mmathPr', 'xe', 'tc', 'bkmkstart', 'bkmkend', 'template',
]);
const SYMBOLS = { emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ' };

const decoders = new Map();
function decodeBytes(bytes, cp) {
  if (!decoders.has(cp)) {
    let d;
    try { d = new TextDecoder(cp === 10000 ? 'macintosh' : `windows-${cp}`); } catch { d = null; }
    if (!d) try { d = new TextDecoder(cp === 932 ? 'shift_jis' : cp === 936 ? 'gbk' : cp === 949 ? 'euc-kr' : cp === 950 ? 'big5' : 'windows-1252'); } catch { d = new TextDecoder('latin1'); }
    decoders.set(cp, d);
  }
  return decoders.get(cp).decode(Uint8Array.from(bytes));
}

export function isRtf(bytes) {
  return bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '{\\rtf';
}

// Things in this file that won't carry over, in plain words.
export function inspectRtf(bytes) {
  const head = latin(bytes);
  const notes = [];
  if (/\\(header|footer)[lrf]?[\s\\{]/.test(head)) notes.push('headers or footers');
  if (/\\cols([2-9]|\d\d)/.test(head)) notes.push('columns');
  if (/\\shptxt|\\shpinst/.test(head)) notes.push('text boxes or shapes');
  if (/\\object[\s\\{]/.test(head)) notes.push('embedded objects');
  return notes;
}

function latin(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

export function readRtf(bytes) {
  if (!isRtf(bytes)) throw new ToolError('This isn\'t an RTF file. Choose a file that ends in .rtf.');
  const src = latin(bytes);
  const fonts = {};
  const styles = {};
  let cp = 1252;

  const blocks = [];
  let rows = null; // the table being read
  let cells = []; // cells of the row being read
  let cellBlocks = []; // paragraphs of the cell being read
  let para = null;
  let marker = null; // the list number or bullet written before this paragraph
  let skipped = 0;
  const counters = [];

  const newPard = () => ({ style: 0, list: null, intbl: false, outline: -1 });
  // Character and paragraph state; each { copies it and } restores it.
  let st = {
    b: false, i: false, u: false, s: false, sup: false, sub: false, hidden: false, font: null,
    skip: false, ignorable: false, uc: 1, dest: null, href: null, pard: newPard(),
  };
  const stack = [];

  const ensure = () => (para ||= { kind: 'para', style: 'p', runs: [], list: null });
  const push = (text) => {
    if (st.hidden) return;
    const p = ensure();
    const last = p.runs[p.runs.length - 1];
    const run = { text, b: st.b, i: st.i, u: st.u, s: st.s, sup: st.sup, sub: st.sub, href: st.href };
    if (last && !last.br && ['b', 'i', 'u', 's', 'sup', 'sub', 'href'].every((k) => last[k] === run[k])) last.text += text;
    else p.runs.push(run);
  };

  // A font or style entry ends at its semicolon.
  const emit = (text) => {
    if (st.skip || !text) return;
    if (st.dest === 'fonttbl') {
      if (st.fontNum == null) return;
      st.fontText += text;
      if (text.includes(';')) {
        fonts[st.fontNum] = { cp: CHARSET_CP[st.fontCharset], symbol: st.fontCharset === 2 || /symbol|wingdings/i.test(st.fontText) };
        st.fontNum = null;
      }
      return;
    }
    if (st.dest === 'stylesheet') {
      if (st.styleNum == null) return;
      st.styleText += text;
      if (text.includes(';')) {
        const h = /^\s*heading\s*([1-6])\b/i.exec(st.styleText);
        if (h) styles[st.styleNum] = Number(h[1]);
        st.styleNum = null;
      }
      return;
    }
    if (st.dest === 'pict') { st.pict.hex += text; return; }
    if (st.dest === 'fldinst') { st.fld.inst += text; return; }
    if (st.dest === 'listtext') { st.marker += text; return; }
    push(text);
  };

  // \'hh bytes are decoded together, so two-byte code pages work.
  let pending = [];
  const flushBytes = () => {
    if (!pending.length) return;
    const font = fonts[st.font];
    const text = font?.symbol
      ? pending.map((b) => (b === 0xb7 ? '•' : String.fromCharCode(b))).join('')
      : decodeBytes(pending, font?.cp || cp);
    pending = [];
    emit(text);
  };

  const endTable = () => {
    if (!rows) return;
    blocks.push({ kind: 'table', rows });
    rows = null;
  };
  const place = (block) => {
    if (st.pard.intbl) cellBlocks.push(block);
    else { endTable(); blocks.push(block); }
  };
  const endPara = () => {
    flushBytes();
    const p = para;
    const mark = marker;
    para = null;
    marker = null;
    if (!p) return;
    const { pard } = st;
    const level = pard.outline >= 0 ? pard.outline + 1 : styles[pard.style];
    if (level && level <= 6 && !pard.intbl) p.style = `h${level}`;
    if ((pard.list || mark != null) && !pard.intbl) {
      const depth = pard.list?.depth || 0;
      const num = /^\s*(\d{1,4})[.)]/.exec(mark || '');
      const ordered = mark != null ? /^\s*[\dA-Za-z]{1,5}[.)]/.test(mark) : !!pard.list?.ordered;
      counters.length = depth + 1;
      counters[depth] = num ? Number(num[1]) : (counters[depth] || 0) + 1;
      p.list = { depth, ordered, n: counters[depth], first: true };
    } else if (!pard.intbl) counters.length = 0;
    if (!p.runs.some((r) => r.br || r.text.trim())) return;
    place(p);
  };
  const endCell = () => {
    endPara();
    cells.push({ span: 1, blocks: cellBlocks });
    cellBlocks = [];
  };
  const endRow = () => {
    if (para || cellBlocks.length) endCell();
    if (cells.length) (rows ||= []).push(cells);
    cells = [];
  };

  const pict = (p) => {
    const hex = p.hex.replace(/[^0-9a-f]/gi, '');
    const kind = p.png ? 'png' : p.jpeg ? 'jpeg' : null;
    if (!kind || hex.length < 8) { skipped += 1; return; }
    let bin = '';
    for (let i = 0; i + 1 < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    endPara();
    place({ kind: 'image', src: `data:image/${kind};base64,${btoa(bin)}` });
  };

  let skipChars = 0; // after \uN, the stand-in characters to drop
  const re = /\\([a-z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([\r\n]+)|([^\\{}\r\n]+)/gi;
  let m;
  while ((m = re.exec(src))) {
    const [, word, numStr, hex, sym, brace, newline, text] = m;
    if (hex != null) {
      if (skipChars > 0) skipChars -= 1;
      else pending.push(parseInt(hex, 16));
      continue;
    }
    if (newline) continue; // bare line breaks mean nothing in RTF
    flushBytes();
    if (text != null) {
      const k = Math.min(skipChars, text.length);
      skipChars -= k;
      emit(text.slice(k));
      continue;
    }
    skipChars = 0;
    if (brace === '{') {
      stack.push(st);
      st = { ...st, ignorable: false };
      continue;
    }
    if (brace === '}') {
      const done = st;
      st = stack.pop() || st;
      if (done.dest === 'pict' && st.dest !== 'pict' && !st.skip) pict(done.pict);
      if (done.dest === 'listtext' && st.dest !== 'listtext' && !st.skip) marker = done.marker;
      continue;
    }
    if (sym != null) {
      if (sym === '*') st.ignorable = true;
      else if (sym === '\\' || sym === '{' || sym === '}') emit(sym);
      else if (sym === '~') emit(' ');
      else if (sym === '_') emit('-');
      else if (sym === '\n' || sym === '\r') endPara();
      continue;
    }
    const n = numStr == null ? null : Number(numStr);
    // \* only marks the control word right after it.
    const ign = st.ignorable;
    st.ignorable = false;
    if (word === 'bin' && n > 0) {
      if (st.dest === 'pict' && !st.skip) {
        for (let i = re.lastIndex; i < re.lastIndex + n && i < src.length; i += 1) st.pict.hex += src.charCodeAt(i).toString(16).padStart(2, '0');
      }
      re.lastIndex += n;
      continue;
    }
    if (st.skip) continue;
    if (st.dest === 'pict') {
      if (word === 'pngblip') st.pict.png = true;
      else if (word === 'jpegblip') st.pict.jpeg = true;
      else if (ign) st.skip = true;
      continue;
    }
    switch (word) {
      case 'ansicpg': cp = n || 1252; break;
      case 'deff': st.font = n; break;
      case 'fonttbl': case 'stylesheet': st.dest = word; break;
      case 'f':
        if (st.dest === 'fonttbl') Object.assign(st, { fontNum: n, fontText: '', fontCharset: 0 });
        else st.font = n;
        break;
      case 'fcharset': st.fontCharset = n; break;
      case 's':
        if (st.dest === 'stylesheet') Object.assign(st, { styleNum: n, styleText: '' });
        else st.pard.style = n;
        break;
      case 'pard': st.pard = newPard(); break;
      case 'intbl': st.pard.intbl = true; break;
      case 'outlinelevel': st.pard.outline = n ?? -1; break;
      case 'ls': st.pard.list = { depth: st.pard.list?.depth || 0, ordered: false }; break;
      case 'ilvl': st.pard.list = { ...st.pard.list, depth: Math.min(n || 0, 8) }; break;
      case 'par': endPara(); break;
      case 'line': ensure().runs.push({ br: true }); break;
      case 'tab': emit(' '); break;
      case 'cell': endCell(); break;
      case 'nestcell': endPara(); break;
      case 'row': endRow(); break;
      case 'plain': Object.assign(st, { b: false, i: false, u: false, s: false, sup: false, sub: false, hidden: false }); break;
      case 'b': st.b = n !== 0; break;
      case 'i': st.i = n !== 0; break;
      case 'ul': case 'uld': case 'uldash': case 'uldb': case 'ulth': case 'ulw': case 'ulwave': st.u = n !== 0; break;
      case 'ulnone': st.u = false; break;
      case 'strike': case 'striked': st.s = n !== 0; break;
      case 'super': st.sup = n !== 0; st.sub = false; break;
      case 'sub': st.sub = n !== 0; st.sup = false; break;
      case 'nosupersub': st.sup = false; st.sub = false; break;
      case 'v': st.hidden = n !== 0; break;
      case 'uc': st.uc = n ?? 1; break;
      case 'u': emit(String.fromCharCode(n < 0 ? n + 65536 : n)); skipChars = st.uc; break;
      case 'pict': st.dest = 'pict'; st.pict = { hex: '', png: false, jpeg: false }; break;
      case 'shppict': break; // the picture itself, inside a {\* } group
      case 'listtext': case 'pntext': st.dest = 'listtext'; st.marker = ''; break;
      case 'field': st.fld = { inst: '' }; break;
      case 'fldinst': st.dest = 'fldinst'; break;
      case 'fldrslt': {
        const link = /HYPERLINK\s+"([^"]+)"/i.exec(st.fld?.inst || '');
        if (link) st.href = link[1];
        break;
      }
      default:
        if (SYMBOLS[word]) emit(SYMBOLS[word]);
        else if (word === 'page' || word === 'sect') endPara();
        else if (ign || SKIP.has(word)) st.skip = true;
    }
  }
  flushBytes();
  endPara();
  if (cells.length || cellBlocks.length || para) endRow();
  endTable();
  if (!blocks.length) throw new ToolError('This document looks empty.');
  return { blocks, skippedImages: skipped };
}

