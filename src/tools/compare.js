// Compare two PDFs by their words: which words were taken out, which were
// added, and on which pages. No DOM here; the browser side (compare-browser.js)
// reads the words with pdf.js and hands them in.
//
// A page is { view: [x0, y0, x1, y1], rotate, words: [{ t, box: [x0, y0, x1, y1] }] }
// with boxes in PDF page units (the same space as pdf.js text items).
import { diffSeq } from './wordDiff.js';

// pdf.js text items -> words with boxes. Items split mid-word (some PDFs place
// every letter on its own) are joined back when they touch on the same line.
export function wordsFromItems(items) {
  const words = [];
  let last = null;
  let lastEnded = true;
  for (const item of items) {
    const str = item.str || '';
    const [a, b, c, d, e, f] = item.transform || [1, 0, 0, 1, 0, 0];
    const len = Math.hypot(a, b) || 1;
    const dx = a / len;
    const dy = b / len;
    const size = Math.hypot(c, d) || item.height || len;
    const width = item.width || 0;
    const re = /\S+/g;
    let m;
    let first = true;
    while ((m = re.exec(str))) {
      const s = str.length ? width * (m.index / str.length) : 0;
      const t = str.length ? width * ((m.index + m[0].length) / str.length) : 0;
      const frag = {
        t: m[0],
        start: [e + dx * s, f + dy * s],
        end: [e + dx * t, f + dy * t],
        dir: [dx, dy],
        size,
      };
      if (first && m.index === 0 && !lastEnded && last && touches(last, frag)) {
        last.t += frag.t;
        last.end = frag.end;
        last.box = unionBox(last.box, fragBox(frag));
      } else {
        last = { ...frag, box: fragBox(frag) };
        words.push(last);
      }
      first = false;
      lastEnded = m.index + m[0].length < str.length;
    }
    if (!str.length || /\s$/.test(str)) lastEnded = true;
    if (item.hasEOL) lastEnded = true;
  }
  return words.map((w) => ({ t: w.t, box: w.box }));
}

function touches(w, frag) {
  if (Math.abs(w.dir[0] - frag.dir[0]) > 0.01 || Math.abs(w.dir[1] - frag.dir[1]) > 0.01) return false;
  const gap = Math.hypot(frag.start[0] - w.end[0], frag.start[1] - w.end[1]);
  return gap < 0.2 * Math.max(w.size, frag.size);
}

// The box a run of text covers: from a little below the baseline to the top
// of the letters.
function fragBox({ start, end, dir, size }) {
  const up = [-dir[1] * size, dir[0] * size];
  const down = [dir[1] * size * 0.22, -dir[0] * size * 0.22];
  const pts = [start, end].flatMap((p) => [[p[0] + up[0] * 0.9, p[1] + up[1] * 0.9], [p[0] + down[0], p[1] + down[1]]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const unionBox = (p, q) => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])];

// Ligatures, odd spaces and soft hyphens should not count as changes.
export const normWord = (t) => t.normalize('NFKC').replace(/[\u00ad\u200b-\u200d\ufeff]/g, '');

// Each page ends with a marker no real word can equal, so when a word could
// match in two places, the diff prefers the match on the same page.
const PAGE_END = '\u0000';

function flatten(pages) {
  const words = [];
  const page = [];
  const index = [];
  pages.forEach((p, n) => {
    p.words.forEach((w, i) => {
      words.push(normWord(w.t));
      page.push(n);
      index.push(i);
    });
    words.push(PAGE_END);
    page.push(n);
    index.push(-1);
  });
  return { words, page, index };
}

// Compare two documents. Returns rows that pair an old page with a new page
// (either may be missing), with the words removed from the old page and added
// on the new one.
export function compareDocs(oldPages, newPages) {
  const A = flatten(oldPages);
  const B = flatten(newPages);
  const hunks = diffSeq(A.words, B.words);
  hunks.forEach((h, k) => slideToPageEnd(hunks, k, A.words, B.words));
  const shared = new Map();
  const removed = oldPages.map(() => []);
  const added = newPages.map(() => []);
  const changes = [];
  let nRemoved = 0;
  let nAdded = 0;
  for (const h of hunks) {
    if (h.type === 'equal') {
      for (let i = h.a0, j = h.b0; i < h.a1; i += 1, j += 1) {
        if (A.index[i] < 0) continue;
        const key = A.page[i] * newPages.length + B.page[j];
        shared.set(key, (shared.get(key) || 0) + 1);
      }
      continue;
    }
    const before = nRemoved + nAdded;
    for (let i = h.a0; i < h.a1; i += 1) if (A.index[i] >= 0) { removed[A.page[i]].push(A.index[i]); nRemoved += 1; }
    for (let j = h.b0; j < h.b1; j += 1) if (B.index[j] >= 0) { added[B.page[j]].push(B.index[j]); nAdded += 1; }
    if (nRemoved + nAdded > before) changes.push(h);
  }
  const rows = alignPages(oldPages.length, newPages.length, shared).map(([a, b]) => ({
    a, b,
    removed: a === null ? [] : removed[a],
    added: b === null ? [] : added[b],
    oldWords: a === null ? 0 : oldPages[a].words.length,
    newWords: b === null ? 0 : newPages[b].words.length,
    snippets: [],
  }));
  const rowOfOld = new Map();
  const rowOfNew = new Map();
  rows.forEach((r) => {
    if (r.a !== null) rowOfOld.set(r.a, r);
    if (r.b !== null) rowOfNew.set(r.b, r);
  });
  // A change can run across a page break; each page's part is its own snippet.
  for (const h of changes) {
    const parts = new Map();
    for (const [lo, hi, F, rowOf, pages, side] of [[h.a0, h.a1, A, rowOfOld, oldPages, 'from'], [h.b0, h.b1, B, rowOfNew, newPages, 'to']]) {
      for (let i = lo; i < hi;) {
        let j = i;
        while (j < hi && F.page[j] === F.page[i]) j += 1;
        const text = snippet(pages, F, i, j);
        if (text) {
          const row = rowOf.get(F.page[i]);
          if (!parts.has(row)) parts.set(row, { from: '', to: '' });
          parts.get(row)[side] = text;
        }
        i = j;
      }
    }
    for (const [row, s] of parts) if (row.snippets.length < 3) row.snippets.push(s);
  }
  return { rows, removed: nRemoved, added: nAdded };
}

// A block of added (or removed) words can often sit in several places with the
// same result: "page | Extra page" vs "| Extra page" after "Same page". Move
// it, where it can go, to end on a page break so whole pages stay together.
function slideToPageEnd(hunks, k, a, b) {
  const h = hunks[k];
  const prev = hunks[k - 1];
  const next = hunks[k + 1];
  if (h.type !== 'change' || (h.a0 < h.a1 && h.b0 < h.b1)) return;
  const ins = h.a0 === h.a1;
  const S = ins ? b : a;
  const s0 = ins ? h.b0 : h.a0;
  const s1 = ins ? h.b1 : h.a1;
  const room = (e) => (e ? e.a1 - e.a0 : 0);
  let lo = 0;
  while (lo < room(prev) && S[s0 - lo - 1] === S[s1 - lo - 1]) lo += 1;
  let hi = 0;
  while (hi < room(next) && S[s0 + hi] === S[s1 + hi]) hi += 1;
  let shift = 0;
  for (let d = -lo; d <= hi; d += 1) {
    if (S[s1 + d - 1] === PAGE_END) { shift = d; break; }
  }
  if (!shift) return;
  h.a0 += shift; h.a1 += shift; h.b0 += shift; h.b1 += shift;
  if (prev) { prev.a1 += shift; prev.b1 += shift; }
  if (next) { next.a0 += shift; next.b0 += shift; }
}

function snippet(pages, F, i0, i1) {
  const words = [];
  let more = false;
  for (let i = i0; i < i1; i += 1) {
    if (F.index[i] < 0) continue;
    if (words.length === 8) { more = true; break; }
    words.push(pages[F.page[i]].words[F.index[i]].t);
  }
  let s = words.join(' ');
  if (s.length > 48) s = `${s.slice(0, 46)}…`;
  else if (more) s += ' …';
  return s;
}

// Pair old pages with new pages in order, matching pages that share the most
// words. Every pairing also earns a little, so pages with no text (scans) still
// pair up side by side instead of being listed as removed and added.
export function alignPages(nA, nB, shared) {
  // Thousands of pages on both sides: the table would not fit in memory, so
  // pair by position.
  if ((nA + 1) * (nB + 1) > 4_000_000) {
    return Array.from({ length: Math.max(nA, nB) }, (_, i) => [i < nA ? i : null, i < nB ? i : null]);
  }
  const W = nB + 1;
  const score = new Float64Array((nA + 1) * W);
  const pick = new Uint8Array((nA + 1) * W);
  for (let i = nA - 1; i >= 0; i -= 1) {
    for (let j = nB - 1; j >= 0; j -= 1) {
      const both = score[(i + 1) * W + j + 1] + (shared.get(i * nB + j) || 0) + 0.5;
      const skipA = score[(i + 1) * W + j];
      const skipB = score[i * W + j + 1];
      let best = both;
      let how = 0;
      if (skipA > best) { best = skipA; how = 1; }
      if (skipB > best) { best = skipB; how = 2; }
      score[i * W + j] = best;
      pick[i * W + j] = how;
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < nA || j < nB) {
    if (i === nA) rows.push([null, j++]);
    else if (j === nB) rows.push([i++, null]);
    else {
      const how = pick[i * W + j];
      if (how === 0) rows.push([i++, j++]);
      else if (how === 1) rows.push([i++, null]);
      else rows.push([null, j++]);
    }
  }
  return rows;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function rowLabel({ a, b }) {
  if (a === null) return `New page ${b + 1}`;
  if (b === null) return `Old page ${a + 1}`;
  return a === b ? `Page ${a + 1}` : `Page ${a + 1} (new page ${b + 1})`;
}

// One plain line about a row for the summary page, or null when nothing changed.
export function rowSummary(row) {
  const label = rowLabel(row);
  const r = row.removed.length;
  const n = row.added.length;
  if (row.a === null) return `${label} was added${row.newWords ? ` (${plural(row.newWords, 'word')})` : ''}.`;
  if (row.b === null) return `${label} was taken out${row.oldWords ? ` (${plural(row.oldWords, 'word')})` : ''}.`;
  const looks = row.looks?.length ? ' The page also looks different.' : '';
  if (r && n) return `${label}: ${plural(r, 'word')} removed, ${n} added.${looks}`;
  if (r) return `${label}: ${plural(r, 'word')} removed.${looks}`;
  if (n) return `${label}: ${plural(n, 'word')} added.${looks}`;
  if (row.looks?.length) return `${label}: looks different, but the words are the same.`;
  return null;
}

export function snippetLine({ from, to }) {
  if (from && to) return `"${from}" became "${to}"`;
  if (from) return `Removed "${from}"`;
  return `Added "${to}"`;
}

export const rowChanged = (row) => row.a === null || row.b === null || row.removed.length > 0 || row.added.length > 0 || row.looks?.length > 0;

// Pages without any text are likely scans, which the word compare can't see into.
export function scanNote(oldPages, newPages) {
  const blankOld = oldPages.map((p, i) => (p.words.length ? -1 : i)).filter((i) => i >= 0);
  const blankNew = newPages.map((p, i) => (p.words.length ? -1 : i)).filter((i) => i >= 0);
  if (!blankOld.length && !blankNew.length) return null;
  const list = (ix) => formatList(ix.map((i) => i + 1));
  const parts = [];
  if (blankOld.length) parts.push(`old ${blankOld.length === 1 ? 'page' : 'pages'} ${list(blankOld)}`);
  if (blankNew.length) parts.push(`new ${blankNew.length === 1 ? 'page' : 'pages'} ${list(blankNew)}`);
  return `No text found on ${parts.join(' and ')}. They may be scans or drawings. The text compare can't see changes there.`;
}

// [1,2,3,5,7,8] -> "1-3, 5, 7-8"; long lists are cut short.
export function formatList(nums) {
  const parts = [];
  for (let i = 0; i < nums.length; i += 1) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    parts.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return parts.length > 12 ? `${parts.slice(0, 12).join(', ')} and more` : parts.join(', ');
}

// Size of a page as seen, after its /Rotate.
export function shownSize(view, rotate) {
  const w = view[2] - view[0];
  const h = view[3] - view[1];
  return rotate % 180 ? [h, w] : [w, h];
}

// Where a point in page units lands on the page as seen (origin bottom left).
export function toShown(view, rotate, x, y) {
  const fx = x - view[0];
  const fy = y - view[1];
  const w = view[2] - view[0];
  const h = view[3] - view[1];
  if (rotate === 90) return [fy, w - fx];
  if (rotate === 180) return [w - fx, h - fy];
  if (rotate === 270) return [h - fy, fx];
  return [fx, fy];
}

// A changed word's box in 0..1 of the page as seen, top left origin (the same
// space as changedAreas).
function shownBox(page, i) {
  const [x0, y0, x1, y1] = page.words[i].box;
  const [dw, dh] = shownSize(page.view, page.rotate);
  const p = toShown(page.view, page.rotate, x0, y0);
  const q = toShown(page.view, page.rotate, x1, y1);
  return [Math.min(p[0], q[0]) / dw, 1 - Math.max(p[1], q[1]) / dh, Math.max(p[0], q[0]) / dw, 1 - Math.min(p[1], q[1]) / dh];
}

// Changed words also look different, and so does the rest of their line once
// it shifts over. Drop the areas the red and green marks already explain and
// keep the ones that show something else changed.
export function dropTextAreas(looks, oldPage, removed, newPage, added) {
  const pad = 0.015;
  const line = (page) => (b) => (page.rotate % 180
    ? [b[0] - pad, 0, b[2] + pad, 1]
    : [0, b[1] - pad, 1, b[3] + pad]);
  const marks = [
    ...removed.map((i) => line(oldPage)(shownBox(oldPage, i))),
    ...added.map((i) => line(newPage)(shownBox(newPage, i))),
  ];
  if (!marks.length) return looks;
  return looks.filter((box) => {
    const hits = marks.filter((m) => m[0] < box[2] && box[0] < m[2] && m[1] < box[3] && box[1] < m[3]);
    if (!hits.length) return true;
    const cover = hits.reduce(unionBox);
    return !(cover[0] <= box[0] && cover[1] <= box[1] && cover[2] >= box[2] && cover[3] >= box[3]);
  });
}

// Areas where two same-size renders of a page differ, as boxes in 0..1 of the
// page (top left origin). a and b are RGBA pixels. Small differences in
// colour (anti-aliasing) are ignored, and nearby spots are joined.
export function changedAreas(a, b, width, height, { cell = 8, tolerance = 60, minPixels = 2 } = {}) {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hits = new Uint16Array(cols * rows);
  for (let y = 0; y < height; y += 1) {
    const rowOff = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const diff = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
      if (diff > tolerance) hits[rowOff + Math.floor(x / cell)] += 1;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const boxes = [];
  for (let start = 0; start < hits.length; start += 1) {
    if (seen[start] || hits[start] < minPixels) continue;
    // Flood fill, letting one quiet cell bridge two changed ones.
    let [x0, y0, x1, y1] = [start % cols, Math.floor(start / cols), start % cols, Math.floor(start / cols)];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (let ny = Math.max(0, cy - 2); ny <= Math.min(rows - 1, cy + 2); ny += 1) {
        for (let nx = Math.max(0, cx - 2); nx <= Math.min(cols - 1, cx + 2); nx += 1) {
          const k = ny * cols + nx;
          if (!seen[k] && hits[k] >= minPixels) { seen[k] = 1; stack.push(k); }
        }
      }
    }
    boxes.push([x0 * cell / width, y0 * cell / height, Math.min(1, (x1 + 1) * cell / width), Math.min(1, (y1 + 1) * cell / height)]);
  }
  return mergeBoxes(boxes);
}

function mergeBoxes(boxes) {
  const out = boxes.slice();
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const p = out[i];
        const q = out[j];
        if (p[0] <= q[2] && q[0] <= p[2] && p[1] <= q[3] && q[1] <= p[3]) {
          out[i] = unionBox(p, q);
          out.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  // Too many spots to read one by one: mark the whole changed area instead.
  if (out.length > 40) return [out.reduce(unionBox)];
  return out;
}
