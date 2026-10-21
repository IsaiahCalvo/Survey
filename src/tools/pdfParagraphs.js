// PDF to Word and PDF to Markdown: read each page's text with pdf.js, rebuild
// lines and paragraphs from where the words sit, then write a .docx or .md.
// Only the words come across: layout, tables and drawings don't. No DOM, so
// it runs in Node tests too.
//
// The grouping step stands alone: pageParagraphs(items, viewportTransform,
// fonts) turns one page's pdf.js text items into paragraphs, with no writer
// involved. readPdfText runs it on every page; toDocx and toMarkdown only
// write what it found.
import { makeZip } from './zip.js';
import { ToolError } from './errors.js';

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MD_TYPE = 'text/markdown;charset=utf-8';
export const NO_TEXT = 'No text was found. This PDF may be a scan, which is a picture of the page. Run OCR PDF on it first.';

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

const BOLD_NAME = /bold|black|heavy|semibold|demi/i;
const ITALIC_NAME = /italic|oblique/i;

// pdf.js text items -> words placed on the page as seen (y grows downward),
// turned so their own baseline is level: { str, u, v, w, size, angle, bold, italic }.
// `vt` is the page viewport transform; `fonts` maps fontName -> { bold, italic }.
export function placeItems(items, vt = [1, 0, 0, 1, 0, 0], fonts = {}) {
  const out = [];
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const m = mul(vt, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!(size > 0.5)) continue;
    const angle = Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI);
    const r = (angle * Math.PI) / 180;
    const f = fonts[it.fontName] || {};
    out.push({
      str: it.str,
      u: m[4] * Math.cos(r) + m[5] * Math.sin(r),
      v: -m[4] * Math.sin(r) + m[5] * Math.cos(r),
      w: it.width || 0,
      size,
      angle: ((angle % 360) + 360) % 360,
      bold: !!f.bold,
      italic: !!f.italic,
    });
  }
  return out;
}

const sizeKey = (s) => Math.round(s * 2) / 2;
const sameStyle = (a, b) => a.bold === b.bold && a.italic === b.italic && sizeKey(a.size) === sizeKey(b.size);

// Words on one baseline become a line of runs { text, bold, italic, size }.
// A wide gap (a column or table cell) becomes a tab.
function buildLine(words) {
  words.sort((a, b) => a.u - b.u);
  const runs = [];
  let prev = null;
  for (const wd of words) {
    // Some PDFs draw text twice, a hair apart, to fake bold.
    if (prev && wd.str === prev.str && Math.abs(wd.u - prev.u) < wd.size * 0.2) continue;
    let sep = '';
    if (prev) {
      const gap = wd.u - (prev.u + prev.w);
      if (gap > Math.max(wd.size, prev.size) * 3) sep = '\t';
      else if (gap > Math.min(wd.size, prev.size) * 0.18 && !/\s$/.test(prev.str) && !/^\s/.test(wd.str)) sep = ' ';
    }
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, wd)) last.text += sep + wd.str;
    else {
      if (last && sep) last.text += sep;
      runs.push({ text: wd.str, bold: wd.bold, italic: wd.italic, size: wd.size });
    }
    prev = wd;
  }
  for (const r of runs) r.text = r.text.replace(/ {2,}/g, ' ');
  runs[0].text = runs[0].text.replace(/^\s+/, '');
  runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
  const chars = (r) => r.text.length;
  const total = runs.reduce((n, r) => n + chars(r), 0) || 1;
  // The line's size is the one most of its letters use.
  const bySize = new Map();
  for (const r of runs) bySize.set(sizeKey(r.size), (bySize.get(sizeKey(r.size)) || 0) + chars(r));
  const size = [...bySize].sort((a, b) => b[1] - a[1])[0][0];
  const boldChars = runs.filter((r) => r.bold).reduce((n, r) => n + chars(r), 0);
  return {
    v: words.reduce((n, wd) => n + wd.v, 0) / words.length,
    u0: words[0].u,
    u1: Math.max(...words.map((wd) => wd.u + wd.w)),
    size,
    bold: boldChars / total > 0.9,
    runs: runs.filter((r) => r.text),
    text: runs.map((r) => r.text).join(''),
  };
}

// Words -> lines, top to bottom, one group per text direction.
export function linesFromItems(words) {
  const byAngle = new Map();
  for (const wd of words) {
    if (!byAngle.has(wd.angle)) byAngle.set(wd.angle, []);
    byAngle.get(wd.angle).push(wd);
  }
  // The direction most of the text runs in reads first.
  const chars = (a) => byAngle.get(a).reduce((n, wd) => n + wd.str.length, 0);
  const angles = [...byAngle.keys()].sort((a, b) => chars(b) - chars(a) || a - b);
  const groups = [];
  for (const angle of angles) {
    const list = byAngle.get(angle).sort((a, b) => a.v - b.v || a.u - b.u);
    const lines = [];
    let cur = [];
    let curV = 0;
    for (const wd of list) {
      if (cur.length && Math.abs(wd.v - curV) <= Math.min(wd.size, cur[0].size) * 0.45) {
        cur.push(wd);
      } else {
        if (cur.length) lines.push(cur);
        cur = [wd];
        curV = wd.v;
      }
    }
    if (cur.length) lines.push(cur);
    groups.push(lines.map(buildLine).filter((l) => l.text));
  }
  return groups;
}

const BULLET = /^([•◦▪▫‣●○■□►▸➢➤✓✔·*\-–—])\s+/;
const NUMBER = /^(\d{1,3})[.)]\s+/;

export function listMarker(text) {
  let m = BULLET.exec(text);
  if (m) return { kind: 'bullet', len: m[0].length };
  m = NUMBER.exec(text);
  if (m) return { kind: 'number', n: Number(m[1]), len: m[0].length };
  return null;
}

const quarter = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 4)];
};

// Lines of one angle -> paragraphs { runs, size, bold, list }. A new paragraph
// starts at a bigger gap than usual, a change of size or weight, a list
// marker, an indented first line, or a line with tabs (a table row).
export function paragraphsFromLines(lines) {
  // Line spacing as a share of the text size. The low end of what we see is
  // the spacing inside a paragraph; gaps between paragraphs sit above it.
  const ratios = [];
  for (let i = 1; i < lines.length; i += 1) {
    const r = (lines[i].v - lines[i - 1].v) / lines[i].size;
    if (r > 0.8 && r < 3 && lines[i].size === lines[i - 1].size) ratios.push(r);
  }
  const usual = Math.min(Math.max(quarter(ratios), 1.15), 1.7);
  const paras = [];
  let para = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = lines[i - 1];
    const list = listMarker(line.text);
    let fresh = !para || !!list || line.text.includes('\t') || prev.text.includes('\t');
    if (!fresh) {
      const pitch = line.v - prev.v;
      const limit = 1.3 * usual * prev.size;
      fresh = pitch > limit || pitch < 0
        || Math.abs(line.size - prev.size) > prev.size * 0.12
        || line.bold !== prev.bold
        || (!para.list && line.u0 > prev.u0 + line.size * 1.5)
        // List text that runs on sits right of the marker.
        || (!!para.list && line.u0 < para.u0 + line.size * 0.5);
    }
    if (fresh) {
      para = { runs: line.runs.map((r) => ({ ...r })), size: line.size, bold: line.bold, u0: line.u0, list };
      paras.push(para);
      continue;
    }
    // Join to the paragraph: a word broken with a hyphen keeps the hyphen but
    // loses the space.
    const last = para.runs[para.runs.length - 1];
    const glue = /\p{L}-$/u.test(last.text) ? '' : ' ';
    const add = line.runs.map((r) => ({ ...r }));
    if (sameStyle(last, add[0])) {
      last.text += glue + add[0].text;
      add.shift();
    } else last.text += glue;
    para.runs.push(...add);
  }
  for (const p of paras) delete p.u0;
  return paras;
}

// One page's pdf.js text content -> paragraphs.
export function pageParagraphs(items, vt, fonts) {
  return linesFromItems(placeItems(items, vt, fonts)).flatMap(paragraphsFromLines);
}

async function fontsOf(page, items) {
  const names = [...new Set(items.map((it) => it.fontName).filter(Boolean))];
  const fonts = {};
  if (!names.length) return fonts;
  try {
    // Font details reach the main thread only once the page's drawing
    // commands have been read.
    await page.getOperatorList();
    for (const n of names) {
      if (!page.commonObjs.has(n)) continue;
      const f = page.commonObjs.get(n);
      const name = f.name || f.loadedName || '';
      fonts[n] = { bold: !!(f.bold || f.black) || BOLD_NAME.test(name), italic: !!f.italic || ITALIC_NAME.test(name) };
    }
  } catch { /* plain text is still worth having */ }
  return fonts;
}

// Every page of a pdf.js document -> [{ width, height, paras }].
export async function readPdfText(pdf, onPage = () => {}) {
  const pages = [];
  for (let i = 0; i < pdf.numPages; i += 1) {
    onPage(i, pdf.numPages);
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    let paras = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      const { items } = await page.getTextContent();
      // eslint-disable-next-line no-await-in-loop
      const fonts = await fontsOf(page, items);
      paras = pageParagraphs(items, vp.transform, fonts);
    } catch { /* a page whose text can't be read counts as having none */ }
    pages.push({ width: vp.width, height: vp.height, paras });
    page.cleanup();
  }
  if (!pages.some((p) => p.paras.length)) throw new ToolError(NO_TEXT);
  return pages;
}

const textOf = (p) => p.runs.map((r) => r.text).join('');

// Mark headings: paragraphs set clearly bigger than the body text, biggest
// first as level 1. Short ones only, so a big-print notice stays a paragraph.
export function markHeadings(pages) {
  const count = new Map();
  for (const pg of pages) for (const p of pg.paras) for (const r of p.runs) count.set(sizeKey(r.size), (count.get(sizeKey(r.size)) || 0) + r.text.length);
  const body = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const isHead = (p) => !p.list && p.size >= body * 1.18 && textOf(p).length <= 150 && !textOf(p).includes('\t');
  const sizes = [...new Set(pages.flatMap((pg) => pg.paras.filter(isHead).map((p) => Math.round(p.size))))].sort((a, b) => b - a);
  for (const pg of pages) {
    for (const p of pg.paras) p.level = isHead(p) ? Math.min(sizes.indexOf(Math.round(p.size)) + 1, 3) : 0;
  }
  return { pages, body };
}

// ---------------------------------------------------------------- markdown

const escMd = (s) => s.replace(/([\\`*_[\]])/g, '\\$1');
const escStart = (s) => s.replace(/^(#{1,6}\s|>|[-+=]\s|\d+[.)]\s)/, '\\$1');

function mdInline(runs, allBold) {
  const segs = [];
  for (const r of runs) {
    const last = segs[segs.length - 1];
    if (last && last.bold === r.bold) last.text += r.text;
    else segs.push({ bold: r.bold, text: r.text });
  }
  return segs.map((s) => {
    const t = escMd(s.text.replace(/\t/g, '  '));
    if (!s.bold || allBold || !t.trim()) return t;
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
    return `${lead}**${core}**${trail}`;
  }).join('');
}

export function toMarkdown(pages) {
  markHeadings(pages);
  const out = [];
  pages.forEach((pg, i) => {
    if (pages.length > 1) {
      if (i) out.push('---');
      out.push(`<!-- Page ${i + 1} -->`);
    }
    let prevList = false;
    for (const p of pg.paras) {
      const text = textOf(p);
      let block;
      if (p.level) {
        block = `${'#'.repeat(p.level)} ${escMd(text.replace(/\t/g, ' '))}`;
      } else if (p.list) {
        const rest = mdInline(trimStart(p.runs, p.list.len), false);
        block = p.list.kind === 'number' ? `${p.list.n}. ${rest}` : `- ${rest}`;
      } else {
        const inline = mdInline(p.runs, p.bold);
        block = escStart(p.bold && inline.trim() ? `**${inline.trim()}**` : inline);
      }
      // List items sit together; everything else gets a blank line between.
      if (p.list && prevList) out[out.length - 1] += `\n${block}`;
      else out.push(block);
      prevList = !!p.list;
    }
  });
  return `${out.join('\n\n').trim()}\n`;
}

// Drop the first n characters (a list marker) from a run list.
function trimStart(runs, n) {
  const out = runs.map((r) => ({ ...r }));
  while (n > 0 && out.length) {
    if (out[0].text.length <= n) { n -= out[0].text.length; out.shift(); } else { out[0].text = out[0].text.slice(n); n = 0; }
  }
  return out;
}

// ---------------------------------------------------------------- docx

const escXml = (s) => s
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const halfPoints = (size) => Math.max(8, Math.min(144, Math.round(size * 2)));

function docxRun(r, { bold } = {}) {
  const props = [];
  if (r.bold || bold) props.push('<w:b/>');
  if (r.italic) props.push('<w:i/>');
  const hp = halfPoints(r.size);
  props.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`);
  const body = r.text.split('\t').map((t) => (t ? `<w:t xml:space="preserve">${escXml(t)}</w:t>` : '')).join('<w:tab/>');
  return `<w:r><w:rPr>${props.join('')}</w:rPr>${body}</w:r>`;
}

function docxPara(p, { pageBreak }) {
  const ppr = [];
  if (p.level) ppr.push(`<w:pStyle w:val="Heading${p.level}"/>`);
  if (pageBreak) ppr.push('<w:pageBreakBefore/>');
  let runs = p.runs;
  if (p.list) {
    ppr.push('<w:ind w:left="360" w:hanging="360"/>');
    const marker = p.list.kind === 'number' ? `${p.list.n}.` : '•';
    runs = [{ ...p.runs[0], text: `${marker}\t`, bold: false }, ...trimStart(p.runs, p.list.len)];
  }
  return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs.map((r) => docxRun(r)).join('')}</w:p>`;
}

// Word's page: the PDF's first page when it is a paper size, else Letter.
function pageSizeTwips(pages) {
  const { width = 612, height = 792 } = pages[0] || {};
  const ok = Math.min(width, height) >= 288 && Math.max(width, height) <= 1224;
  const [w, h] = ok ? [width, height] : (width > height ? [792, 612] : [612, 792]);
  return { w: Math.round(w * 20), h: Math.round(h * 20), landscape: w > h };
}

const STYLES = (bodyHalfPoints) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="${bodyHalfPoints}"/><w:szCs w:val="${bodyHalfPoints}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${360 - n * 60}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`).join('\n')}
</w:styles>`;

export function toDocx(pages, now = new Date()) {
  const { body } = markHeadings(pages);
  const paras = [];
  pages.forEach((pg, i) => {
    const list = pg.paras.length ? pg.paras : [{ runs: [], level: 0 }];
    list.forEach((p, k) => paras.push(docxPara(p, { pageBreak: i > 0 && k === 0 })));
  });
  const { w, h, landscape } = pageSizeTwips(pages);
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/document.xml': doc,
    'word/styles.xml': STYLES(halfPoints(body)),
  };
  const enc = new TextEncoder();
  return makeZip(Object.entries(files).map(([name, text]) => ({ name, bytes: enc.encode(text) })), now);
}
