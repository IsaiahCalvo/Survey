// src/services/annotationStackOrder.js
//
// w52 (2026-09-28) — one stacking order per page for EVERY mark type.
//
// UX: "Bring to front / forward, Send backward / to back" (right-click menu
// and Cmd+] / Cmd+[ / Cmd+Shift+] / Cmd+Shift+[) must stick: after a reload,
// on every other open screen, in the export, the print and the thumbnail —
// for pen, shapes, text boxes, counters, stamps, imported PDF marks AND
// callouts alike (owner, 2026-09-28: "annotations are annotations"). Matches
// Figma / Illustrator / Bluebeam, where an object's place in the stack is part
// of the document.
//
// Before w52 the order lived only in the screen's page array: the shared
// store kept marks in its map's arrival order, so a reorder was undone by the
// next change from another screen and by every reload.
//
// Model: each stored mark may carry a number `z` (annotationMarkStore
// MARK_Z_KEY). A page reads bottom -> top as:
//   1. marks WITHOUT a z (every mark written before w52), in the map's own
//      order — exactly how the page read before, so an untouched document
//      is unchanged;
//   2. then marks WITH a z, lowest first (ties: storage key, so every screen
//      agrees).
// Every mark created from w52 on gets z = (highest z on its page) + 1 in the
// same write that creates it, so a new mark lands on top and every screen and
// every reload agree on it (the map's own order can differ between screens).
// A change of order writes z only for the marks that moved; marks on that
// page that still have none are given one once (below the others, in their
// current order). A whole page is renumbered 1..n only when the gaps between
// neighbours run out.
//
// Pure module (no Yjs, no React): runs in Node tests.

/**
 * Compare two stack entries { key, z, arrival } for sorting bottom → top.
 * z: number | null. arrival: the entry's position in the map's own order.
 */
export function compareStackEntries(a, b) {
  const az = a.z;
  const bz = b.z;
  const aHas = typeof az === 'number';
  const bHas = typeof bz === 'number';
  if (aHas && bHas) {
    if (az !== bz) return az - bz;
    const ak = String(a.key);
    const bk = String(b.key);
    if (ak !== bk) return ak < bk ? -1 : 1;
    return a.arrival - b.arrival;
  }
  if (aHas) return 1;
  if (bHas) return -1;
  return a.arrival - b.arrival;
}

/** True when `entries` (already in bottom → top order) needs no sort. */
function isSorted(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareStackEntries(entries[index - 1], entries[index]) > 0) return false;
  }
  return true;
}

/**
 * Sort one page's entries bottom → top (stable, in place when needed).
 * Returns the same array.
 */
export function sortStackEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) return entries;
  if (!entries.some((entry) => typeof entry.z === 'number')) return entries;
  if (isSorted(entries)) return entries;
  return entries.sort(compareStackEntries);
}

// Indexes of a longest strictly increasing run of `values` (numbers).
function longestIncreasingIndexes(values) {
  const n = values.length;
  const tails = []; // tails[len-1] = index of the smallest tail of a run of that length
  const previous = new Array(n).fill(-1);
  for (let index = 0; index < n; index += 1) {
    const value = values[index];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[index] = tails[lo - 1];
    tails[lo] = index;
  }
  const out = new Set();
  let cursor = tails.length ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    out.add(cursor);
    cursor = previous[cursor];
  }
  return out;
}

const MIN_GAP = 1e-9;

function numberWholePage(desired) {
  const writes = new Map();
  desired.forEach((entry, index) => {
    const z = index + 1;
    if (entry.z !== z) writes.set(entry.key, z);
  });
  return writes;
}

/**
 * Plan the z writes that make `desired` (bottom → top, every entry
 * { key, z, arrival } — a mark stored on this page) read back in exactly that
 * order. Returns Map<key, z> (empty when the stored order already matches).
 */
export function planStackOrderWrites(desired) {
  const list = Array.isArray(desired) ? desired : [];
  if (list.length < 2) return new Map();
  if (isSorted(list)) return new Map();
  // Marks with no z yet read below every mark that has one, in the map's own
  // order. Give each one a stand-in value in that same place (just below the
  // lowest z) — it is written, since a mark left without z would drop back
  // below everything once a neighbour moves past it.
  const zless = list
    .map((entry, position) => ({ entry, position }))
    .filter(({ entry }) => typeof entry.z !== 'number')
    .sort((a, b) => a.entry.arrival - b.entry.arrival);
  const standIn = new Map();
  if (zless.length > 0) {
    const zs = list.filter((entry) => typeof entry.z === 'number').map((entry) => entry.z);
    const floor = zs.length ? Math.min(...zs) : zless.length + 1;
    zless.forEach(({ position }, rank) => { standIn.set(position, floor - zless.length + rank); });
  }
  const values = list.map((entry, position) => (standIn.has(position) ? standIn.get(position) : entry.z));
  const keep = longestIncreasingIndexes(values);
  const assigned = values.slice();
  let index = 0;
  while (index < list.length) {
    if (keep.has(index)) { index += 1; continue; }
    let end = index;
    while (end < list.length && !keep.has(end)) end += 1;
    const lo = index > 0 ? assigned[index - 1] : null;
    const hi = end < list.length ? assigned[end] : null;
    const count = end - index;
    for (let offset = 0; offset < count; offset += 1) {
      let z;
      if (lo == null && hi == null) z = offset + 1;
      else if (lo == null) z = hi - (count - offset);
      else if (hi == null) z = lo + offset + 1;
      else z = lo + ((hi - lo) * (offset + 1)) / (count + 1);
      assigned[index + offset] = z;
    }
    if (lo != null && hi != null && (hi - lo) / (count + 1) < MIN_GAP * Math.max(1, Math.abs(lo), Math.abs(hi))) {
      return numberWholePage(list);
    }
    index = end;
  }
  const writes = new Map();
  list.forEach((entry, position) => {
    if (assigned[position] !== entry.z || standIn.has(position)) writes.set(entry.key, assigned[position]);
  });
  // Ties between equal stored values resolve by key; a planned value equal to
  // a kept neighbour cannot happen (strictly increasing), but guard anyway.
  const check = list.map((entry, position) => ({ ...entry, z: assigned[position] }));
  return isSorted(check) ? writes : numberWholePage(list);
}

/**
 * Did the viewer itself change this page's order? `next` is the page's keys in
 * the viewer's new array; `baselines` are key arrays the viewer held before
 * (its previous capture, pages the store handed it since); `createdKeys` are
 * the marks this capture itself created. The order counts as unchanged when,
 * for one baseline, the keys it shares with `next` keep their relative order
 * AND every mark created by this capture sits above all of those shared keys
 * (a new mark added on top). A mark the viewer did not hold before but that
 * already existed (another screen's) is placed wherever the viewer shows it
 * and never counts. No baseline at all = unchanged.
 */
export function viewerChangedStackOrder(next, baselines, createdKeys = null) {
  const usable = (baselines || []).filter(Array.isArray);
  if (usable.length === 0) return false;
  return !usable.some((baseline) => sameRelativeOrder(next, baseline, createdKeys));
}

function sameRelativeOrder(next, baseline, createdKeys) {
  const inBaseline = new Set(baseline);
  const shared = next.filter((key) => inBaseline.has(key));
  const inNext = new Set(shared);
  const baselineShared = baseline.filter((key) => inNext.has(key));
  if (shared.length !== baselineShared.length) return false;
  for (let index = 0; index < shared.length; index += 1) {
    if (shared[index] !== baselineShared[index]) return false;
  }
  if (!createdKeys || createdKeys.size === 0) return true;
  // A mark this capture created must be above every shared key.
  let seenCreated = false;
  for (const key of next) {
    if (!inBaseline.has(key) && createdKeys.has(key)) seenCreated = true;
    else if (seenCreated && inBaseline.has(key)) return false;
  }
  return true;
}
