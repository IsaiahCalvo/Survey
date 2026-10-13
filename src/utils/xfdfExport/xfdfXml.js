// XFDF text helpers (KAL-393). Pure functions, no pdf-lib: escaping, number
// and colour formatting, and the PDF /F flag names XFDF uses. Kept apart from
// the PDF reader so the format rules are easy to test on their own.

export const XFDF_NAMESPACE = 'http://ns.adobe.com/xfdf/';

// XML 1.0 forbids most C0 control characters even when escaped. A text box
// can hold a stray one (pasted text), so drop them instead of writing a file
// no XML parser will open.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(value) {
  return String(value ?? '')
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Four decimals is well under 1/1000 pt, finer than any reader draws, and
// keeps the file readable. "-0" prints as "0".
export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10000) / 10000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function formatNumberList(values, separator = ',') {
  return (values || []).map(formatNumber).join(separator);
}

// "x,y;x,y" — the point list form XFDF uses for gestures and vertices.
export function formatPointList(flat) {
  const points = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    points.push(`${formatNumber(flat[i])},${formatNumber(flat[i + 1])}`);
  }
  return points.join(';');
}

const toHexByte = (unit) => {
  const clamped = Math.max(0, Math.min(1, Number(unit) || 0));
  return Math.round(clamped * 255).toString(16).padStart(2, '0').toUpperCase();
};

// PDF colour arrays: [] transparent, [g] gray, [r g b], [c m y k].
export function pdfColorToHex(components) {
  if (!Array.isArray(components) || components.length === 0) return null;
  let rgb;
  if (components.length === 1) {
    rgb = [components[0], components[0], components[0]];
  } else if (components.length === 3) {
    rgb = components;
  } else if (components.length === 4) {
    const [c, m, y, k] = components.map((v) => Number(v) || 0);
    rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  } else {
    return null;
  }
  return `#${rgb.map(toHexByte).join('')}`;
}

// PDF 32000-1 Table 165, bit 1 first. XFDF writes the set bits as a
// comma-separated list of these names.
const FLAG_NAMES = [
  'invisible', 'hidden', 'print', 'nozoom', 'norotate',
  'noview', 'readonly', 'locked', 'togglenoview', 'lockedcontents',
];

export function pdfFlagsToXfdf(flags) {
  const n = Number(flags);
  if (!Number.isInteger(n) || n <= 0) return null;
  const names = FLAG_NAMES.filter((_, bit) => (n & (1 << bit)) !== 0);
  return names.length ? names.join(',') : null;
}

// /BS /S border style names to XFDF style attribute values.
const BORDER_STYLES = { S: 'solid', D: 'dash', B: 'bevelled', I: 'inset', U: 'underline' };
export function pdfBorderStyleToXfdf(name) {
  return BORDER_STYLES[String(name || '')] || null;
}

// Build one element. `attrs` skips null/undefined/'' values so optional
// attributes simply do not appear; `children` is an array of pre-built XML
// strings (already escaped).
export function xmlElement(name, attrs = {}, children = [], indent = '') {
  const attrText = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
  const kids = (children || []).filter(Boolean);
  if (!kids.length) return `${indent}<${name}${attrText}/>`;
  return `${indent}<${name}${attrText}>\n${kids.join('\n')}\n${indent}</${name}>`;
}

export function xmlTextElement(name, text, indent = '') {
  return `${indent}<${name}>${escapeXml(text)}</${name}>`;
}

// Same basename as the PDF, so the sidecar sits next to it and a reader that
// looks for "<name>.xfdf" finds it.
export function xfdfFileNameForPdf(pdfName) {
  const base = String(pdfName || 'document').replace(/\.pdf$/i, '') || 'document';
  return `${base}.xfdf`;
}
