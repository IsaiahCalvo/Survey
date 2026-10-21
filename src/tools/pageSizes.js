// Page sizes and document facts for the PDF info tool. Pure functions, no
// DOM and no PDF engine, so Node tests cover them.

const MM_PER_IN = 25.4;
const PT_PER_IN = 72;

// Named sheet sizes, short side by long side, in inches. Where two names are
// the same sheet (Letter is ANSI A), both are in one name.
const IN = (w, h) => [w, h];
const MM = (w, h) => [w / MM_PER_IN, h / MM_PER_IN];
export const NAMED_SIZES = [
  ['Letter (ANSI A)', IN(8.5, 11)],
  ['Legal', IN(8.5, 14)],
  ['Tabloid 11x17 (ANSI B)', IN(11, 17)],
  ['ANSI C', IN(17, 22)],
  ['ANSI D', IN(22, 34)],
  ['ANSI E', IN(34, 44)],
  ['ARCH A', IN(9, 12)],
  ['ARCH B', IN(12, 18)],
  ['ARCH C', IN(18, 24)],
  ['ARCH D', IN(24, 36)],
  ['ARCH E1', IN(30, 42)],
  ['ARCH E', IN(36, 48)],
  ['A5', MM(148, 210)],
  ['A4', MM(210, 297)],
  ['A3', MM(297, 420)],
  ['A2', MM(420, 594)],
  ['A1', MM(594, 841)],
  ['A0', MM(841, 1189)],
];

// How far off a side may be and still count, in inches (about 2.5 mm).
// Scans and exports often come out a point or two off the exact size.
export const TOLERANCE_IN = 0.1;

// widthPt and heightPt as the page shows (rotation applied).
export function nameSize(widthPt, heightPt) {
  const w = widthPt / PT_PER_IN;
  const h = heightPt / PT_PER_IN;
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  let name = 'Custom';
  let best = Infinity;
  for (const [n, [a, b]] of NAMED_SIZES) {
    const off = Math.max(Math.abs(short - a), Math.abs(long - b));
    if (off <= TOLERANCE_IN && off < best) {
      best = off;
      name = n;
    }
  }
  let orientation = 'square';
  if (Math.abs(w - h) > 0.01) orientation = w > h ? 'landscape' : 'portrait';
  return { name, orientation };
}

const trim = (n, places) => String(Number(n.toFixed(places)));
export const inches = (pt) => trim(pt / PT_PER_IN, 2);
export const mm = (pt) => trim((pt / PT_PER_IN) * MM_PER_IN, 0);

// One row per page. view is [x1, y1, x2, y2] (the visible box) and rotate the
// page's /Rotate, as pdf.js gives them.
// userUnit: the page's /UserUnit (points per unit), 1 for nearly every PDF.
export function pageRow(index, view, rotate, hasText, userUnit = 1) {
  const boxW = Math.abs(view[2] - view[0]) * userUnit;
  const boxH = Math.abs(view[3] - view[1]) * userUnit;
  const sideways = ((rotate % 180) + 180) % 180 === 90;
  const width = sideways ? boxH : boxW;
  const height = sideways ? boxW : boxH;
  return {
    page: index + 1, width, height, ...nameSize(width, height), rotate: ((rotate % 360) + 360) % 360, hasText,
  };
}

const sizeLabel = (r) => (r.name === 'Custom' ? 'Custom size' : r.name);
export const describeRow = (r) => (r.orientation === 'square' ? sizeLabel(r) : `${sizeLabel(r)}, ${r.orientation}`);

// "All 24 pages are ARCH D, landscape." or a count of each size.
export function summarize(rows) {
  if (!rows.length) return 'This PDF has no pages.';
  const counts = new Map();
  for (const r of rows) {
    const key = r.name === 'Custom' ? `Custom size ${inches(r.width)} x ${inches(r.height)} in` : describeRow(r);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 1) {
    const [key] = counts.keys();
    return rows.length === 1 ? `The page is ${key}.` : `All ${rows.length} pages are ${key}.`;
  }
  const list = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n} page${n === 1 ? '' : 's'}`);
  return `${counts.size} page sizes. ${list.join('. ')}.`;
}

// pdf.js metadata -> the facts shown above the table, as [label, value].
export function docFacts({
  pages, fileSize, info = {}, encrypted = false, fields = 0, scanned = 0,
}) {
  const yesNo = (b) => (b ? 'Yes' : 'No');
  return [
    ['Pages', String(pages)],
    ['File size', formatBytes(fileSize)],
    ['Title', info.Title || 'None'],
    ['Author', info.Author || 'None'],
    ['Made with', [info.Creator, info.Producer].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'Not given'],
    ['PDF version', info.PDFFormatVersion || 'Not given'],
    ['Password or limits', yesNo(encrypted)],
    ['Form fields', fields ? `Yes, ${fields}` : 'No'],
    ['Pages with no text', scanned ? `${scanned} (may be scans)` : 'None'],
  ];
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The CSV saved by the tool: the facts, a blank line, then a row per page.
export function toCsv(facts, rows) {
  const lines = facts.map(([k, v]) => [k, v].map(cell).join(','));
  lines.push('');
  lines.push(['Page', 'Size', 'Orientation', 'Width (in)', 'Height (in)', 'Width (mm)', 'Height (mm)', 'Rotation', 'Has text'].join(','));
  for (const r of rows) {
    lines.push([r.page, r.name, r.orientation, inches(r.width), inches(r.height), mm(r.width), mm(r.height), r.rotate, r.hasText ? 'Yes' : 'No'].map(cell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
