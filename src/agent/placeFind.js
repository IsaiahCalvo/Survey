// Finding a device by where it is, not by its number: "the camera by the
// stairs", "smoke detector in room 214 on the second floor". Plain rules,
// never a best guess (suite rule):
//   1. The place words must be printed on a sheet, word for word (STAIR 2,
//      ROOM 214, LOBBY), plural or not.
//   2. The device is the item (or, on a bare PDF, the printed tag) of that
//      kind nearest a place label, and only when it is clearly the nearest:
//      close to the label, and the next one at least half as far again.
//   3. Anything else comes back as candidates, so the agent asks.
import { spokenForm, takeFloor, takeKind } from './spokenTag.js';

// Longest first, so "next to" wins over "to".
const PLACE_WORDS = ['across from', 'in front of', 'outside of', 'next to', 'close to', 'beside', 'behind', 'outside', 'inside', 'above', 'below', 'under', 'over', 'near', 'by', 'at', 'in'];
const ARTICLES = new Set(['the', 'a', 'an', 'that', 'this']);
// Nearest must be within this share of the sheet's diagonal...
const NEAR_SHARE = 0.25;
// ...and the next nearest at least this many times as far.
const CLEAR_RATIO = 1.5;

const fold = (w) => (/[^s]s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w);

/**
 * { kind, kindWord, codes, place: [words], floor } from "the camera by the
 * stairs on the second floor", or null without both a kind and a place.
 * `leftover` is never set: every word after the place word is the place.
 */
export function parsePlaceTarget(text, { kinds = [] } = {}) {
  const took = takeFloor(` ${spokenForm(text)} `);
  const said = takeKind(took.s, kinds);
  if (!said.kind) return null;
  const after = took.s.slice(said.end).trim();
  const before = took.s.slice(0, said.at).trim().split(/\s+/).filter(Boolean);
  // Nothing but "the" may stand before the kind.
  if (before.some((w) => !ARTICLES.has(w))) return null;
  const prep = PLACE_WORDS.find((p) => after === p || after.startsWith(`${p} `));
  if (!prep) return null;
  const place = after.slice(prep.length).trim().split(/\s+/).filter((w) => w && !ARTICLES.has(w));
  if (!place.length || place.length > 4) return null;
  return { kind: said.kind, kindWord: said.kindWord, codes: said.codes, place, floor: took.floor };
}

// The words of a page as single lower-case tokens, each with its word's box.
function tokensOf(words) {
  const out = [];
  for (const w of words || []) {
    for (const t of String(w?.text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) out.push({ t: fold(t), box: w.box });
  }
  return out;
}

const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const distance = (a, b) => Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y);
const unionBox = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};

/** Every place on a page whose printed words are the place said, in order. */
export function placeLabels(words, place) {
  const want = place.map(fold);
  const tokens = tokensOf(words);
  const found = [];
  for (let i = 0; i + want.length <= tokens.length; i += 1) {
    if (want.every((w, k) => tokens[i + k].t === w)) {
      const boxes = tokens.slice(i, i + want.length).map((t) => t.box).filter(Boolean);
      if (boxes.length) found.push({ box: unionBox(boxes), text: place.join(' ') });
    }
  }
  return found;
}

const sheetSize = (words, pageSize) => {
  if (pageSize?.width && pageSize?.height) return pageSize;
  const boxes = (words || []).map((w) => w.box).filter(Boolean);
  if (!boxes.length) return null;
  return { width: Math.max(...boxes.map((b) => b.x + b.width)), height: Math.max(...boxes.map((b) => b.y + b.height)) };
};

/**
 * Candidates of one kind near the place, nearest first, and the one that
 * is clearly nearest (or null).
 * things: [{ key, page, box, ... }] (items or printed tags of the kind).
 * pages: [{ page, words }]; pageSize(page) -> { width, height } or null.
 */
export function nearestToPlace(target, things, pages, { pageSize = () => null } = {}) {
  const byPage = new Map((pages || []).map((p) => [p.page, p.words || []]));
  const best = new Map();
  for (const thing of things || []) {
    const words = byPage.get(thing.page);
    if (!words || !thing.box) continue;
    const size = sheetSize(words, pageSize(thing.page));
    const near = size ? Math.hypot(size.width, size.height) * NEAR_SHARE : Infinity;
    for (const label of placeLabels(words, target.place)) {
      const d = distance(thing.box, label.box);
      if (d > near) continue;
      const seen = best.get(thing.key);
      if (!seen || d < seen.distance) best.set(thing.key, { ...thing, distance: Math.round(d), place: label.text, near });
    }
  }
  const list = [...best.values()].sort((a, b) => a.distance - b.distance);
  const [first, second] = list;
  const clear = first && (!second || second.distance >= Math.max(first.distance * CLEAR_RATIO, first.distance + 12)) ? first : null;
  return { list, clear };
}
