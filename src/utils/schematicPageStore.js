/**
 * Schematic Mode page store (KAL-402 / F12).
 *
 * Holds, per open pdf.js document, which pages are drawings. A page is only
 * read when something on screen asks about it (its overlay mounts), one page
 * at a time and when the browser is idle, so opening a 300-sheet set does not
 * queue 300 page reads in the pdf.js worker.
 *
 * The person can turn Schematic Mode off on a page the detector got wrong.
 * That choice is kept per document (by pdf.js fingerprint) in localStorage,
 * so it survives a reload. Storage failures are ignored.
 */
import { detectSchematicPage } from './schematicPageDetection.js';

const resultsByDoc = new WeakMap();
const listeners = new Set();
const queue = [];
let running = false;
let detectOptions = null;
let version = 0;

const OFF_KEY_PREFIX = 'survey:schematic-off:';

const notify = () => {
  version += 1;
  listeners.forEach((listener) => { try { listener(); } catch { /* listener errors stay local */ } });
};

const docResults = (pdfDoc) => {
  let map = resultsByDoc.get(pdfDoc);
  if (!map) { map = new Map(); resultsByDoc.set(pdfDoc, map); }
  return map;
};

/** pdf.js options for detectSchematicPage ({ ops, readTextContent }). Set once by the viewer. */
export function configureSchematicDetection(options) {
  detectOptions = options || null;
}

export function subscribeSchematicPages(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A number that changes whenever any page result or override changes. */
export const getSchematicStoreVersion = () => version;

/** The detection result for a page: undefined (not read yet), 'pending', or the result object. */
export function getSchematicResult(pdfDoc, pageNumber) {
  if (!pdfDoc) return undefined;
  return resultsByDoc.get(pdfDoc)?.get(pageNumber);
}

const idle = (fn) => {
  const ric = globalThis.requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 1500 });
  else setTimeout(fn, 0);
};

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const { pdfDoc, pageNumber } = queue.shift();
      const map = docResults(pdfDoc);
      if (map.get(pageNumber) !== 'pending') continue;
      await new Promise((resolve) => idle(resolve));
      let result;
      try {
        const page = await pdfDoc.getPage(pageNumber);
        result = await detectSchematicPage(page, detectOptions || {});
      } catch {
        // A closed document or an unreadable page is simply not a schematic.
        result = { schematic: false, kind: null, reason: 'error' };
      }
      map.set(pageNumber, result);
      notify();
    }
  } finally {
    running = false;
  }
}

/** Ask for a page to be read. Cheap to call on every render. */
export function requestSchematicDetection(pdfDoc, pageNumber) {
  if (!pdfDoc || typeof pdfDoc.getPage !== 'function' || !(pageNumber >= 1)) return;
  const map = docResults(pdfDoc);
  if (map.has(pageNumber)) return;
  map.set(pageNumber, 'pending');
  queue.push({ pdfDoc, pageNumber });
  drain();
}

/** Resolves once nothing is queued (tests). */
export async function waitForSchematicQueue() {
  while (running || queue.length) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ---- per-page "turn off" choice -------------------------------------------

const offCache = new Map();

// Page views rewrite pdf.js fingerprints to `base~pv{n}` so raster caches
// treat the view as a new document. The turn-off choice is a reload-surviving
// preference, so drop that version suffix and keep the durable base key.
const stableFingerprint = (fingerprint) => String(fingerprint || '').replace(/~pv\d+$/, '');

const readOffPages = (fingerprint) => {
  const cacheKey = stableFingerprint(fingerprint);
  if (offCache.has(cacheKey)) return offCache.get(cacheKey);
  let pages = new Set();
  if (cacheKey) try {
    const raw = globalThis.localStorage?.getItem(OFF_KEY_PREFIX + cacheKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) pages = new Set(parsed.map(Number).filter((n) => n >= 1));
  } catch { /* unreadable storage: nothing turned off */ }
  offCache.set(cacheKey, pages);
  return pages;
};

export function isSchematicTurnedOff(fingerprint, pageNumber) {
  return readOffPages(fingerprint).has(pageNumber);
}

export function setSchematicTurnedOff(fingerprint, pageNumber, off) {
  const cacheKey = stableFingerprint(fingerprint);
  const pages = new Set(readOffPages(cacheKey));
  if (off) pages.add(pageNumber); else pages.delete(pageNumber);
  offCache.set(cacheKey, pages);
  if (cacheKey) try {
    const key = OFF_KEY_PREFIX + cacheKey;
    if (pages.size) globalThis.localStorage?.setItem(key, JSON.stringify([...pages].sort((a, b) => a - b)));
    else globalThis.localStorage?.removeItem(key);
  } catch { /* storage full or blocked: the choice lasts this session */ }
  notify();
}

/** Tests only: forget cached choices so storage is read again. */
export function resetSchematicStoreForTests() {
  offCache.clear();
  queue.length = 0;
  notify();
}
