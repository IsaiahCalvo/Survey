// Page ranges typed by people: "1-3, 5, 8-" (1-based, "8-" runs to the end).
import { ToolError } from './errors.js';

function parsePart(part, pageCount) {
  const m = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(part);
  if (!m || (m[1] === '' && m[2] === undefined)) throw new ToolError(`"${part}" is not a page or a range.`);
  const isRange = m[2] !== undefined;
  const from = m[1] === '' ? 1 : Number(m[1]);
  const to = isRange ? (m[2] === '' ? pageCount : Number(m[2])) : from;
  if (from < 1 || to < 1) throw new ToolError('Pages start at 1.');
  if (from > pageCount || to > pageCount) throw new ToolError(`This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
  if (to < from) throw new ToolError(`"${part}" goes backwards.`);
  const out = [];
  for (let p = from; p <= to; p += 1) out.push(p - 1);
  return out;
}

// One group of 0-based page indexes per comma-separated part, in typed order.
export function parseRangeGroups(text, pageCount) {
  const parts = String(text).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new ToolError('Type at least one page.');
  return parts.map((p) => parsePart(p, pageCount));
}

// The set of 0-based pages named anywhere in the text, sorted.
export function parsePageSet(text, pageCount) {
  return [...new Set(parseRangeGroups(text, pageCount).flat())].sort((a, b) => a - b);
}

// Back from 0-based indexes to the shortest text: [0,1,2,4] -> "1-3, 5".
export function formatPageSet(indexes) {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j > i ? `${sorted[i] + 1}-${sorted[j] + 1}` : `${sorted[i] + 1}`);
    i = j;
  }
  return parts.join(', ');
}

export function everyN(pageCount, n) {
  const groups = [];
  for (let s = 0; s < pageCount; s += n) {
    groups.push(Array.from({ length: Math.min(n, pageCount - s) }, (_, k) => s + k));
  }
  return groups;
}
