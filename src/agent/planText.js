// Finding an item's tag (for example "D-117") on the plan sheets, for the
// Survey agent's find_on_plan tool. Words come from the pdf.js text layer or,
// on a scanned sheet, from a text recognition result the person already ran.
// Boxes are in page points with the origin at the top left, like marker bounds.

const compact = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const MAX_MATCHES = 10;
// Longest run of neighbouring words joined into one tag ("D", "-", "117").
const MAX_JOIN = 3;

const boxOfPoints = (pts) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/**
 * pdf.js text items (page.getTextContent().items) to words with boxes. A
 * viewport (page.getViewport({ scale: 1 })) maps PDF space to the page as
 * shown, rotation included. An item holding several words is split by
 * character count along the text's own direction, before rotating, so text
 * on a turned page or set at an angle splits the right way.
 */
export function textItemsToWords(items, viewport) {
  const toPage = viewport?.convertToViewportPoint
    ? (x, y) => viewport.convertToViewportPoint(x, y)
    : (x, y) => [x, y];
  const words = [];
  for (const item of items || []) {
    const str = String(item?.str || '');
    if (!str.trim() || !Array.isArray(item.transform)) continue;
    const [a, b, c, d, e, f] = item.transform;
    const height = Math.hypot(c, d) || Number(item.height) || 0;
    const width = Number(item.width) || 0;
    const run = Math.hypot(a, b);
    if (!(height > 0) || !(width > 0) || !(run > 0)) continue;
    const dir = [a / run, b / run];
    const up = [-dir[1], dir[0]];
    const perChar = width / str.length;
    for (const m of str.matchAll(/\S+/g)) {
      const from = m.index * perChar;
      const to = from + m[0].length * perChar;
      const at = (along, across) => toPage(e + dir[0] * along + up[0] * across, f + dir[1] * along + up[1] * across);
      words.push({ text: m[0], box: boxOfPoints([at(from, 0), at(to, 0), at(from, height), at(to, height)]) });
    }
  }
  return words;
}

/** Text recognition words ({ text, quad: [{x, y} x4] }, page points) to words with boxes. */
export function ocrWordsToWords(ocrWords) {
  const words = [];
  for (const w of ocrWords || []) {
    const pts = Array.isArray(w?.quad) ? w.quad.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
    if (!String(w?.text || '').trim() || pts.length < 2) continue;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    words.push({
      text: String(w.text).trim(),
      box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
    });
  }
  return words;
}

const union = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};

// Words read in order next to each other on one line: the next one starts
// close after this one ends and sits at about the same height. On a turned
// page a line runs down (90) or up (270) instead of across.
function nextOnLine(a, b, [pos, cross, len, thick], step) {
  const h = Math.max(a[thick], b[thick], 1);
  const gap = step > 0 ? b[pos] - (a[pos] + a[len]) : a[pos] - (b[pos] + b[len]);
  const sameLine = Math.abs((a[cross] + a[thick] / 2) - (b[cross] + b[thick] / 2)) < h * 0.6;
  return sameLine && gap > -h * 0.5 && gap < h * 1.2;
}

const ACROSS = ['x', 'y', 'width', 'height'];
const DOWN = ['y', 'x', 'height', 'width'];
const upright = (box) => box.height > box.width;

function adjacent(a, b) {
  if (nextOnLine(a, b, ACROSS, 1)) return true;
  if (!upright(a) || !upright(b)) return false;
  return nextOnLine(a, b, DOWN, 1) || nextOnLine(a, b, DOWN, -1);
}

/**
 * Places on the sheets where `query` appears as a whole tag. "D-117" matches
 * "D-117", "D117" and "D - 117" (split across words), never "D-1170". Each
 * match: { page, text, box, source }.
 */
export function findTagOnPages(query, pages) {
  const want = compact(query);
  if (want.length < 2) return [];
  const matches = [];
  for (const { page, words = [], source = 'text' } of pages || []) {
    for (let i = 0; i < words.length; i += 1) {
      let joined = '';
      const run = [];
      for (let j = i; j < words.length && j < i + MAX_JOIN; j += 1) {
        if (run.length && !adjacent(run[run.length - 1].box, words[j].box)) break;
        run.push(words[j]);
        joined += compact(words[j].text);
        if (joined === want) {
          matches.push({ page, text: run.map((w) => w.text).join(' '), box: union(run.map((w) => w.box)), source });
          break;
        }
        if (!want.startsWith(joined)) break;
      }
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }
  return matches;
}

/** A marker box around a tag: the tag plus a margin, at least `min` points, kept inside the page. */
export function markerBoxAroundTag(box, pageSize, { min = 24 } = {}) {
  const pad = Math.max(box.height * 0.6, 4);
  let width = Math.max(box.width + pad * 2, min);
  let height = Math.max(box.height + pad * 2, min);
  if (pageSize) {
    width = Math.min(width, pageSize.width);
    height = Math.min(height, pageSize.height);
  }
  let x = box.x + box.width / 2 - width / 2;
  let y = box.y + box.height / 2 - height / 2;
  if (pageSize) {
    x = Math.min(Math.max(0, x), pageSize.width - width);
    y = Math.min(Math.max(0, y), pageSize.height - height);
  }
  const r = (n) => Math.round(n * 100) / 100;
  return { x: r(x), y: r(y), width: r(width), height: r(height) };
}

/** Whether a marker's bounds cover the middle of a box on the same page. */
export function boundsCover(bounds, box) {
  if (!bounds || !box) return false;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= bounds.x && cx <= bounds.x + bounds.width && cy >= bounds.y && cy <= bounds.y + bounds.height;
}

const MAX_PAGES = 300;
const wordsCache = new WeakMap();

/**
 * Searches every page of an open document handle (PDFViewer's agent handle:
 * getPageCount, getPageWords) for a tag. Returns { matches, unreadPages }:
 * unreadPages have no text layer and no text recognition yet.
 */
export async function findTagInDocument(doc, query) {
  if (!doc?.getPageWords || !doc?.getPageCount) return { matches: [], unreadPages: [] };
  let cache = wordsCache.get(doc);
  if (!cache) { cache = new Map(); wordsCache.set(doc, cache); }
  const count = Math.min(doc.getPageCount() || 0, MAX_PAGES);
  const pages = [];
  const unreadPages = [];
  for (let page = 1; page <= count; page += 1) {
    let entry = cache.get(page);
    if (!entry || entry.source === 'none') {
      try {
        entry = await doc.getPageWords(page);
      } catch {
        entry = { words: [], source: 'none' };
      }
      cache.set(page, entry);
    }
    if (entry.source === 'none') unreadPages.push(page);
    else pages.push({ page, words: entry.words, source: entry.source });
  }
  return { matches: findTagOnPages(query, pages), unreadPages };
}
