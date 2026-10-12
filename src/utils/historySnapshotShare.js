/**
 * historySnapshotShare.js — undo / redo snapshots that share unchanged pages.
 *
 * Crash hunt 2026-10-07 (owner: "the app keeps crashing"): every legacy
 * Undo / Redo press took a full snapshot of the document's marks
 * (PDFViewer getHistorySnapshot) by deep-cloning EVERY page. On a big drawing
 * set (Package 2: 36 sheets, ~3,000 imported ink marks, 22 MB as JSON) one
 * snapshot was ~75 MB of heap and ~0.6 s of main-thread work, and the two
 * history stacks keep up to 50 entries each — enough to make iOS kill the
 * page after a handful of presses.
 *
 * The viewer treats a page's state as a value: a change builds a new page
 * object (`next = deepClone(page)` then edit, or `{ ...page, objects }`), and
 * the per-page "fast" checkpoint already keeps untouched pages BY REFERENCE.
 * So a copy can be reused:
 *   - a live page object is copied once; later snapshots reuse that copy;
 *   - a page that IS such a copy (a restore made it live again) is kept as is;
 *   - a page that is a new object with the same content as the last copy
 *     made for that page (a re-projection that rebuilt every page object,
 *     e.g. after a page operation or a restore) reuses that copy too.
 * N snapshots of a document where one page changed now cost one copy of each
 * page plus one per change, instead of N full copies.
 */
import { jsonEqual } from './jsonEqual.js';

// live page object -> the copy made of it
const copyOfLivePage = new WeakMap();
// the copies themselves (never edited in place, like any page state)
const snapshotPages = new WeakSet();
// page key -> the last copy made for that key, per page map "family" (the
// viewer passes one document's map at a time; a WeakRef keeps this from
// holding a closed document's pages).
const lastCopyByKey = new Map();

const stats = { calls: 0, reused: 0, sameContent: 0, copied: 0 };
export function historySnapshotStats() { return { ...stats }; }

export function isSharedSnapshotPage(page) {
  return Boolean(page) && typeof page === 'object' && snapshotPages.has(page);
}

function lastCopy(key) {
  const ref = lastCopyByKey.get(key);
  const copy = ref && typeof ref.deref === 'function' ? ref.deref() : ref;
  if (!copy) lastCopyByKey.delete(key);
  return copy || null;
}

function rememberCopy(key, copy) {
  lastCopyByKey.set(key, typeof WeakRef === 'function' ? new WeakRef(copy) : copy);
}

/**
 * Snapshot an annotationsByPage map. `clone` is the deep clone to use for a
 * page not seen before (deepClone in the viewer).
 */
export function snapshotAnnotationPages(byPage, clone) {
  if (!byPage || typeof byPage !== 'object' || Array.isArray(byPage)) return clone(byPage);
  stats.calls += 1;
  const out = {};
  for (const key of Object.keys(byPage)) {
    const page = byPage[key];
    if (page === null || typeof page !== 'object') {
      out[key] = page;
      continue;
    }
    if (snapshotPages.has(page)) {
      stats.reused += 1;
      out[key] = page;
      continue;
    }
    let copy = copyOfLivePage.get(page);
    if (copy === undefined) {
      const previous = lastCopy(key);
      if (previous && jsonEqual(previous, page)) {
        stats.sameContent += 1;
        copy = previous;
      } else {
        stats.copied += 1;
        copy = clone(page);
        if (copy && typeof copy === 'object') {
          snapshotPages.add(copy);
          rememberCopy(key, copy);
        }
      }
      if (copy && typeof copy === 'object') copyOfLivePage.set(page, copy);
    } else {
      stats.reused += 1;
    }
    out[key] = copy;
  }
  return out;
}
