// Split PDF by bookmarks: read the outline (/Outlines) with pdf-lib's own
// objects and cut the file where each bookmark starts. No DOM, so Node tests
// run it.
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString,
} from 'pdf-lib';
import { ToolError } from './errors.js';
import { loadPdf } from './ops.js';

const N = PDFName.of;
const MAX_DEPTH = 10;
const MAX_ITEMS = 20000;

const isText = (v) => v instanceof PDFString || v instanceof PDFHexString;
const textOf = (v) => (isText(v) ? v.decodeText() : '').replace(/[\s\u0000]+/g, ' ').trim();
const keyOf = (v) => (v instanceof PDFName ? v.decodeText() : isText(v) ? v.decodeText() : null);

// Named destinations live in the catalog's /Dests dict (old style) or the
// /Names /Dests name tree. Built on first use.
function namedDests(doc) {
  const ctx = doc.context;
  const map = new Map();
  const old = ctx.lookup(doc.catalog.get(N('Dests')));
  if (old instanceof PDFDict) for (const [k, v] of old.entries()) map.set(k.decodeText(), v);
  const names = ctx.lookup(doc.catalog.get(N('Names')));
  const tree = names instanceof PDFDict ? ctx.lookup(names.get(N('Dests'))) : null;
  const seen = new Set();
  const walk = (node, depth) => {
    if (!(node instanceof PDFDict) || depth > 32 || seen.has(node)) return;
    seen.add(node);
    const pairs = ctx.lookup(node.get(N('Names')));
    if (pairs instanceof PDFArray) {
      for (let i = 0; i + 1 < pairs.size(); i += 2) {
        const k = keyOf(ctx.lookup(pairs.get(i)));
        if (k !== null && !map.has(k)) map.set(k, pairs.get(i + 1));
      }
    }
    const kids = ctx.lookup(node.get(N('Kids')));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i += 1) walk(ctx.lookup(kids.get(i)), depth + 1);
  };
  walk(tree, 0);
  return map;
}

// Reads the outline into [{ title, page (0-based or null), children }].
export function readOutline(doc) {
  const ctx = doc.context;
  const root = ctx.lookup(doc.catalog.get(N('Outlines')));
  if (!(root instanceof PDFDict)) return [];
  const pageOf = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const total = pageOf.size;
  let named;
  const destPage = (dest, hops = 0) => {
    const d = ctx.lookup(dest);
    if (hops > 4 || !d) return null;
    if (d instanceof PDFArray) {
      const target = d.size() ? d.get(0) : null;
      if (target instanceof PDFRef) return pageOf.get(target.toString()) ?? null;
      // Some files give a page number here instead of the page itself.
      if (target instanceof PDFNumber) return target.asNumber() >= 0 && target.asNumber() < total ? target.asNumber() : null;
      return null;
    }
    if (d instanceof PDFDict) return destPage(d.get(N('D')), hops + 1);
    const key = keyOf(d);
    if (key === null) return null;
    named ||= namedDests(doc);
    return named.has(key) ? destPage(named.get(key), hops + 1) : null;
  };
  const pageFor = (item) => {
    if (item.has(N('Dest'))) return destPage(item.get(N('Dest')));
    const action = ctx.lookup(item.get(N('A')));
    if (action instanceof PDFDict && action.get(N('S')) === N('GoTo')) return destPage(action.get(N('D')));
    return null;
  };
  // A broken file can loop its /Next or /First links; each item is read once.
  const seen = new Set();
  let count = 0;
  const walk = (first, depth) => {
    const items = [];
    for (let ref = first; ref && count < MAX_ITEMS;) {
      const node = ctx.lookup(ref);
      if (!(node instanceof PDFDict) || seen.has(node)) break;
      seen.add(node);
      count += 1;
      items.push({
        title: textOf(ctx.lookup(node.get(N('Title')))),
        page: pageFor(node),
        children: depth < MAX_DEPTH ? walk(node.get(N('First')), depth + 1) : [],
      });
      ref = node.get(N('Next'));
    }
    return items;
  };
  return walk(root.get(N('First')), 1);
}

// How many bookmarks sit at each level: [top, second, ...].
export function levelCounts(outline) {
  const counts = [];
  const walk = (items, d) => {
    if (!items.length) return;
    counts[d] = (counts[d] || 0) + items.length;
    for (const it of items) walk(it.children, d + 1);
  };
  walk(outline, 0);
  return counts;
}

// Where each part starts and ends, splitting at every bookmark down to
// `level` (1 = top level only). Bookmarks that start on the same page share
// one part, named after all of them. Pages before the first bookmark get a
// part of their own.
export function planSplit(outline, pageCount, level = 1) {
  const marks = [];
  const walk = (items, depth) => {
    for (const it of items) {
      if (it.page !== null && it.page < pageCount) marks.push({ title: it.title, page: it.page });
      if (depth < level) walk(it.children, depth + 1);
    }
  };
  walk(outline, 1);
  // Stable sort keeps the outline's order among bookmarks on the same page.
  marks.sort((a, b) => a.page - b.page);
  const parts = [];
  for (const m of marks) {
    const last = parts[parts.length - 1];
    if (last && last.start === m.page) {
      if (m.title && !last.titles.includes(m.title)) last.titles.push(m.title);
    } else {
      parts.push({ start: m.page, titles: m.title ? [m.title] : [] });
    }
  }
  if (parts.length && parts[0].start > 0) parts.unshift({ start: 0, titles: ['Before the first bookmark'] });
  return parts.map((p, i) => ({
    title: p.titles.join(' - '),
    start: p.start,
    end: (i + 1 < parts.length ? parts[i + 1].start : pageCount) - 1,
  }));
}

// A file name that works on Windows, macOS, Linux and phones.
export function safeFileName(title, fallback) {
  const clean = String(title)
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const cut = Array.from(clean).slice(0, 80).join('').trim();
  return cut || fallback;
}

export async function splitByBookmarks(bytes, { level = 1, doc } = {}, progress) {
  const src = doc || await loadPdf(bytes);
  const outline = readOutline(src);
  if (!outline.length) throw new ToolError('This PDF has no bookmarks. To split it by page numbers, use Split PDF instead.');
  const plan = planSplit(outline, src.getPageCount(), level);
  if (!plan.length) throw new ToolError('This PDF\'s bookmarks don\'t point to any of its pages, so it can\'t be split by them.');
  const width = String(plan.length).length;
  const parts = [];
  for (let i = 0; i < plan.length; i += 1) {
    const p = plan[i];
    progress?.(`File ${i + 1} of ${plan.length}`);
    const out = await PDFDocument.create();
    const idx = Array.from({ length: p.end - p.start + 1 }, (_, k) => p.start + k);
    (await out.copyPages(src, idx)).forEach((pg) => out.addPage(pg));
    const num = String(i + 1).padStart(width, '0');
    parts.push({ ...p, name: `${num} ${safeFileName(p.title, `Bookmark ${i + 1}`)}.pdf`, bytes: await out.save({ useObjectStreams: true }) });
  }
  return parts;
}

// One line about the bookmarks found, for the note above the options.
export function describeOutline(outline) {
  if (!outline.length) return 'This PDF has no bookmarks, so it can\'t be split by them. Split PDF can split it by page numbers instead.';
  const [top = 0, second = 0] = levelCounts(outline);
  const names = outline.map((it) => it.title || 'Untitled').slice(0, 4);
  const more = top - names.length;
  const list = more > 0 ? `${names.join(', ')} and ${more} more` : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  let line = `Found ${top} top-level bookmark${top === 1 ? '' : 's'}: ${list}.`;
  if (second) line += ` ${second} more sit${second === 1 ? 's' : ''} one level down.`;
  return line;
}
