// Text search reads each page's text through pdf.js (getTextContent on the
// worker). Speed (2026-11-09): that read was done only once the Search panel
// opened, per panel (the phone sheet unmounts it), and a page could be read
// twice when a search and the panel's own pre-read asked for it together. On
// a 99-sheet drawing set the first search after opening took ~14 s of reads.
//
// Now the text is kept per open document (a WeakMap on the pdf.js document,
// so it goes with the document), one read per page, and is read ahead in idle
// time a moment after the document opens, so a search finds it ready.
import { needsTextItemSeparator } from './searchMatchNavigation.js';
import { whenViewersStill } from './viewerMotion.js';
import { keepSearchText, loadKeptSearchText } from './searchTextKeep.js';

const pagesByDocument = new WeakMap();

/** Builds the search data for one page's text content (pure). */
export function buildSearchPageData(textContent, viewport) {
  let fullText = '';
  const ranges = [];
  let textDivIndex = 0;
  let previousItem = null;
  let pendingLineBreak = false;

  (textContent?.items || []).forEach((item, index) => {
    if (typeof item?.str !== 'string') return;
    const str = item.str || '';
    const currentTextDivIndex = textDivIndex;
    textDivIndex += 1;
    if (!str) {
      if (item.hasEOL) pendingLineBreak = true;
      return;
    }

    // Separate labels that pdf.js hands over as neighbouring items with no
    // space between them (common on drawings). The space sits OUTSIDE every
    // range, so match → rectangle mapping is unchanged.
    if (previousItem && (
      (pendingLineBreak && !/\s$/.test(fullText) && !/^\s/.test(str)) ||
      needsTextItemSeparator(previousItem, item)
    )) {
      fullText += ' ';
    }
    pendingLineBreak = Boolean(item.hasEOL);
    previousItem = item;

    const start = fullText.length;
    fullText += str;
    ranges.push({
      start,
      end: start + str.length,
      itemIndex: index,
      textDivIndex: currentTextDivIndex
    });
  });

  return {
    text: fullText,
    textContent,
    items: textContent?.items || [],
    styles: textContent?.styles || {},
    ranges,
    viewport,
    viewportTransform: viewport?.transform,
    textLayerMeasurement: null
  };
}

/** Pages already read for this document (resolved data only). */
export function readSearchPagesSoFar(pdfDoc) {
  return pagesByDocument.get(pdfDoc)?.done || new Map();
}

/**
 * One page's search data, read once per document. Resolves null when the
 * page cannot be read (a failed read is not kept, so a later call retries).
 */
export function loadSearchPageData(pdfDoc, pageNumber) {
  if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return Promise.resolve(null);
  const entry = entryFor(pdfDoc);
  if (entry.done.has(pageNumber)) return Promise.resolve(entry.done.get(pageNumber));
  if (entry.pending.has(pageNumber)) return entry.pending.get(pageNumber);
  const read = (async () => {
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const data = buildSearchPageData(textContent, page.getViewport({ scale: 1 }));
    entry.done.set(pageNumber, data);
    return data;
  })().catch((error) => {
    console.error(`Error loading page ${pageNumber} text data:`, error);
    return null;
  }).finally(() => {
    entry.pending.delete(pageNumber);
  });
  entry.pending.set(pageNumber, read);
  return read;
}

export const SEARCH_TEXT_READ_AHEAD_DELAY_MS = 1500;
export const SEARCH_TEXT_READ_AHEAD_MAX_PAGES = 400;
// The whole file must be here within this long for the side reader; else the
// read-ahead uses the viewer's own document.
export const SEARCH_TEXT_SIDE_READER_WAIT_MS = 30_000;

const idle = (timeout) => new Promise((resolve) => {
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(() => resolve(), { timeout });
  } else {
    setTimeout(resolve, 16);
  }
});

// Two side readers on a computer with cores to spare, else one (phones and
// tablets keep one: each reader holds its own copy of the file).
function defaultSideReaders() {
  const cores = Number(globalThis.navigator?.hardwareConcurrency) || 2;
  let touch = false;
  try { touch = Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches); } catch { touch = false; }
  return cores >= 4 && !touch ? 2 : 1;
}

// A side reader copies the whole file; past this size it reads on the
// viewer's document instead.
export const SEARCH_TEXT_SIDE_READER_MAX_BYTES = 200 * 1024 * 1024;

function entryFor(pdfDoc) {
  let entry = pagesByDocument.get(pdfDoc);
  if (!entry) {
    entry = { pending: new Map(), done: new Map(), kept: null, keptPages: 0 };
    pagesByDocument.set(pdfDoc, entry);
  }
  return entry;
}

// Once per document: the text this device kept for the file
// (utils/searchTextKeep.js) fills every page it has before any read.
function loadKeptText(pdfDoc, numPages, entry, loadKept) {
  if (!entry.kept) {
    entry.kept = Promise.resolve()
      .then(() => loadKept(pdfDoc, numPages))
      .then((kept) => {
        for (const [pageNumber, { textContent, viewport }] of kept || []) {
          if (entry.done.has(pageNumber)) continue;
          entry.done.set(pageNumber, buildSearchPageData(textContent, viewport));
          entry.keptPages += 1;
        }
      })
      .catch(() => {});
  }
  return entry.kept;
}

/**
 * Opens a second pdf.js document on its own worker from the viewer's bytes,
 * once the whole file is here. The viewer's worker also draws every page and
 * thumbnail, and a text read queued there waited behind them (99-sheet set:
 * ~20 s to read every page that way; on its own worker the reads run beside
 * the drawing). Resolves null when it cannot (no bytes in time, no worker).
 */
async function openSideReader(pdfDoc, { waitMs, isStopped }) {
  if (typeof pdfDoc?.getData !== 'function' || typeof Worker === 'undefined') return null;
  // getData() before the whole file is here would ask for every missing chunk
  // as one big range (see services/cloudPdfStream.js): wait for the download.
  if (typeof pdfDoc.getDownloadInfo === 'function') {
    const here = await Promise.race([
      pdfDoc.getDownloadInfo().then((info) => !(info?.length > SEARCH_TEXT_SIDE_READER_MAX_BYTES), () => false),
      new Promise((resolve) => setTimeout(() => resolve(false), waitMs)),
    ]);
    if (!here || isStopped()) return null;
  }
  const bytes = await pdfDoc.getData();
  if (isStopped()) return null;
  const [{ loadPdfjs }, { pdfjsAssetOptions }] = await Promise.all([
    import('./pdfWorkerConfig.js'),
    import('./pdfjsAssets.js'),
  ]);
  const lib = await loadPdfjs();
  if (isStopped()) return null;
  const task = lib.getDocument({
    data: bytes,
    isEvalSupported: false,
    verbosity: lib.VerbosityLevel?.ERRORS,
    ...pdfjsAssetOptions(lib),
  });
  try {
    const doc = await task.promise;
    return { doc, task };
  } catch {
    void task.destroy?.()?.catch?.(() => {});
    return null;
  }
}

/**
 * Reads every page's text ahead, starting `delayMs` after the call: on a side
 * reader (its own worker) when the whole file is here, else on the viewer's
 * document one page per idle moment. Pages a search already read (or is
 * reading) are skipped; a search waits for a page the read-ahead is reading.
 * Returns a stop function. Documents past `maxPages` read only their first
 * `maxPages` ahead; the rest is read when a search reaches it.
 */
export function readSearchTextAhead(pdfDoc, numPages, {
  delayMs = SEARCH_TEXT_READ_AHEAD_DELAY_MS,
  maxPages = SEARCH_TEXT_READ_AHEAD_MAX_PAGES,
  sideReaderWaitMs = SEARCH_TEXT_SIDE_READER_WAIT_MS,
  waitForIdle = idle,
  openReader = openSideReader,
  sideReaders = defaultSideReaders(),
  // Each page waits while the viewer moves: the reads took the CPU (side
  // readers) and the worker (viewer reads) from the pages scrolling into
  // view, which stayed white for seconds in the first ~20 s after opening a
  // 99-sheet set (2026-11-09).
  waitForStill = whenViewersStill,
  loadKept = loadKeptSearchText,
  keep = keepSearchText,
} = {}) {
  const entry = pdfDoc ? entryFor(pdfDoc) : null;
  // One read-ahead per document: a second caller (the Search panel opening
  // while the viewer's read-ahead runs) joins it.
  if (!entry || entry.readingAhead) return () => {};
  let stopped = false;
  let sides = [];
  const isStopped = () => stopped;
  const total = Math.min(Number(numPages) || 0, maxPages);
  entry.readingAhead = true;
  // At once, not after the delay: a search right after a reopen finds it.
  if (total) void loadKeptText(pdfDoc, Number(numPages) || 0, entry, loadKept);
  const run = async () => {
    if (!entry || !total) return;
    await entry.kept;
    if (stopped) return;
    if (entry.done.size >= total) {
      try { globalThis.performance?.mark?.('survey-search-text-read'); } catch { /* no marks */ }
      return;
    }
    const opened = await Promise.all(Array.from({ length: Math.max(1, sideReaders) }, () => (
      Promise.resolve().then(() => openReader(pdfDoc, { waitMs: sideReaderWaitMs, isStopped })).catch(() => null)
    )));
    sides = opened.filter(Boolean);
    let cursor = 1;
    const nextPage = () => {
      while (cursor <= total && (entry.done.has(cursor) || entry.pending.has(cursor))) cursor += 1;
      return cursor <= total ? cursor++ : null;
    };
    const readOnSide = async (sideDoc) => {
      for (let pageNumber = nextPage(); pageNumber != null && !stopped; pageNumber = nextPage()) {
        const still = waitForStill?.();
        if (still) {
          // Hand the page back while waiting: a search may want it sooner.
          cursor = Math.min(cursor, pageNumber);
          await still;
          if (stopped) return;
          continue;
        }
        const read = (async () => {
          const page = await sideDoc.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const data = buildSearchPageData(textContent, page.getViewport({ scale: 1 }));
          entry.done.set(pageNumber, data);
          return data;
        })().catch(() => null).finally(() => entry.pending.delete(pageNumber));
        entry.pending.set(pageNumber, read);
        // A failed side read leaves the page for the viewer's document.
        if (!(await read) && !stopped) await loadSearchPageData(pdfDoc, pageNumber);
      }
    };
    if (sides.length) {
      await Promise.all(sides.map((side) => readOnSide(side.doc)));
    }
    // Whatever is left (no side reader, or pages a search was reading) is read
    // on the viewer's document, one page per idle moment.
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      if (stopped) return;
      if (entry.done.has(pageNumber)) continue;
      if (entry.pending.has(pageNumber)) { await entry.pending.get(pageNumber); continue; }
      await waitForIdle(1000);
      const still = waitForStill?.();
      if (still) await still;
      if (stopped) return;
      if (entry.done.has(pageNumber)) continue;
      await loadSearchPageData(pdfDoc, pageNumber);
    }
    // For speed checks (scripts/perf/text-search-timing.mjs).
    try { globalThis.performance?.mark?.('survey-search-text-read'); } catch { /* no marks */ }
  };
  // Every page read: keep the text for the next open, unless it all came
  // from the device already.
  const keepIfComplete = async () => {
    if (stopped || !total || entry.keptPages >= total) return;
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) if (!entry.done.has(pageNumber)) return;
    await keep(pdfDoc, entry.done);
  };
  const timer = setTimeout(() => {
    run().then(keepIfComplete).catch(() => {}).finally(() => {
      for (const side of sides) void side?.task?.destroy?.()?.catch?.(() => {});
      sides = [];
      if (!stopped) entry.readingAhead = false;
    });
  }, delayMs);
  return () => {
    if (stopped) return;
    stopped = true;
    entry.readingAhead = false;
    clearTimeout(timer);
  };
}
