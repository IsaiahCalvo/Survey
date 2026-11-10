// A file's search text kept on the device (2026-11-10). Reading every page's
// text through pdf.js is CPU bound (99-sheet set: ~6-10 s), so a search right
// after opening a big set waited for it on every open. The text only changes
// with the file's bytes, so it is kept per file next to the page previews
// (services/pageThumbStore.js: same budget, pruning and sign-out clear) under
// the file's SHA-256 (utils/pdfFileStamp.js), and a reopened file searches at
// once.
//
// One packed row per file: a small JSON header (strings, fonts, page
// viewports, styles) and every text run's transform, width and height as
// float64 (exact). ~0.4 MB of text plus ~5 MB of numbers on a 99-sheet set
// (the same text as plain JSON is ~13 MB).
import { pageThumbStore } from '../services/pageThumbStore.js';
import { getPageViewBase, pageViewKey } from './pageViewDocument.js';
import { pdfFileStamp } from './pdfFileStamp.js';

export const SEARCH_TEXT_KEEP_VERSION = 1;
const NUMBERS_PER_RUN = 8; // transform[6], width, height

export function searchTextRowStamp(stamp) {
  return stamp ? `${stamp}:search-text` : null;
}

function isRun(item) {
  return typeof item?.str === 'string' && Array.isArray(item.transform) && item.transform.length === 6;
}

/**
 * pages: [{ key, textContent: { items, styles, lang }, viewport: { viewBox,
 * userUnit, rotation } }] -> ArrayBuffer.
 */
export function packSearchText(pages) {
  const fonts = [];
  const fontIndex = new Map();
  const strs = [];
  const fontOf = [];
  let dirs = '';
  let eol = '';
  const others = {}; // items that are not text runs, kept as they are
  const meta = [];
  let runs = 0;
  for (const page of pages) {
    const items = page?.textContent?.items || [];
    for (const item of items) if (isRun(item)) runs += 1;
  }
  const numbers = new Float64Array(runs * NUMBERS_PER_RUN);
  let at = 0;
  let itemNo = 0;
  for (const page of pages) {
    const items = page?.textContent?.items || [];
    meta.push({
      key: String(page.key),
      count: items.length,
      styles: page?.textContent?.styles || {},
      lang: page?.textContent?.lang ?? null,
      viewBox: Array.from(page?.viewport?.viewBox || []),
      userUnit: Number(page?.viewport?.userUnit) || 1,
      rotation: Number(page?.viewport?.rotation) || 0,
    });
    for (const item of items) {
      if (!isRun(item)) {
        others[itemNo] = item;
        strs.push(null);
        fontOf.push(-1);
        dirs += '-';
        eol += '0';
        itemNo += 1;
        continue;
      }
      const font = String(item.fontName ?? '');
      let f = fontIndex.get(font);
      if (f === undefined) { f = fonts.length; fonts.push(font); fontIndex.set(font, f); }
      strs.push(item.str);
      fontOf.push(f);
      dirs += item.dir === 'rtl' ? 'r' : item.dir === 'ttb' ? 't' : 'l';
      eol += item.hasEOL ? '1' : '0';
      const base = at * NUMBERS_PER_RUN;
      for (let k = 0; k < 6; k += 1) numbers[base + k] = Number(item.transform[k]);
      numbers[base + 6] = Number(item.width);
      numbers[base + 7] = Number(item.height);
      at += 1;
      itemNo += 1;
    }
  }
  const header = new TextEncoder().encode(JSON.stringify({
    v: SEARCH_TEXT_KEEP_VERSION, pages: meta, fonts, strs, fontOf, dirs, eol, others,
  }));
  const offset = Math.ceil((4 + header.length) / 8) * 8;
  const buffer = new ArrayBuffer(offset + numbers.byteLength);
  new DataView(buffer).setUint32(0, header.length, true);
  new Uint8Array(buffer, 4, header.length).set(header);
  new Uint8Array(buffer, offset).set(new Uint8Array(numbers.buffer));
  return buffer;
}

/** ArrayBuffer -> Map(key -> { textContent, viewport }), or null when unreadable. */
export function unpackSearchText(buffer) {
  try {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) return null;
    const length = new DataView(buffer).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
    if (header?.v !== SEARCH_TEXT_KEEP_VERSION) return null;
    const offset = Math.ceil((4 + length) / 8) * 8;
    const numbers = new Float64Array(buffer.slice(offset));
    const out = new Map();
    let itemNo = 0;
    let at = 0;
    for (const page of header.pages) {
      const items = new Array(page.count);
      for (let i = 0; i < page.count; i += 1) {
        const str = header.strs[itemNo];
        if (str === null) {
          items[i] = header.others[itemNo];
        } else {
          const base = at * NUMBERS_PER_RUN;
          const d = header.dirs[itemNo];
          items[i] = {
            str,
            dir: d === 'r' ? 'rtl' : d === 't' ? 'ttb' : 'ltr',
            width: numbers[base + 6],
            height: numbers[base + 7],
            transform: [numbers[base], numbers[base + 1], numbers[base + 2], numbers[base + 3], numbers[base + 4], numbers[base + 5]],
            fontName: header.fonts[header.fontOf[itemNo]],
            hasEOL: header.eol[itemNo] === '1',
          };
          at += 1;
        }
        itemNo += 1;
      }
      out.set(page.key, {
        textContent: { items, styles: page.styles, lang: page.lang },
        viewport: { viewBox: page.viewBox, userUnit: page.userUnit, rotation: page.rotation },
      });
    }
    return out;
  } catch {
    return null;
  }
}

function keyOf(pdfDoc, pageNumber) {
  return pageViewKey(pdfDoc, pageNumber - 1);
}

/**
 * The kept text of the open file, as Map(pageNumber -> { textContent,
 * viewport }) with a real pdf.js viewport, or null (none kept, no stamp
 * within `waitMs`, store off). `build(textContent, viewport)` makes a page's
 * search data.
 */
export async function loadKeptSearchText(pdfDoc, numPages, {
  waitMs = 2500,
  store = pageThumbStore(),
  stampOf = pdfFileStamp,
} = {}) {
  if (!pdfDoc || typeof pdfDoc.getPage !== 'function' || !(numPages > 0) || store?.isDisabled) return null;
  const stamp = await stampOf(getPageViewBase(pdfDoc), { waitMs });
  if (!stamp) return null;
  const rows = await store.loadDoc(searchTextRowStamp(stamp));
  const row = rows?.find?.((r) => r?.pageKey === `v${SEARCH_TEXT_KEEP_VERSION}`);
  const pages = row?.data ? unpackSearchText(row.data) : null;
  if (!pages?.size) return null;
  // pdf.js does not export its viewport class; any page's viewport has it.
  const first = await pdfDoc.getPage(1);
  const Viewport = first?.getViewport?.({ scale: 1 })?.constructor;
  if (typeof Viewport !== 'function') return null;
  const out = new Map();
  for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
    const kept = pages.get(keyOf(pdfDoc, pageNumber));
    if (!kept || kept.viewport.viewBox.length !== 4) continue;
    const viewport = new Viewport({ ...kept.viewport, scale: 1 });
    out.set(pageNumber, { textContent: kept.textContent, viewport });
  }
  return out.size ? out : null;
}

/** Keeps the text read for this open file (Map(pageNumber -> search data)). */
export async function keepSearchText(pdfDoc, donePages, {
  store = pageThumbStore(),
  stampOf = pdfFileStamp,
} = {}) {
  if (!pdfDoc || !donePages?.size || store?.isDisabled) return false;
  const stamp = await stampOf(getPageViewBase(pdfDoc), { waitMs: 60_000 });
  if (!stamp) return false;
  const pages = [];
  for (const [pageNumber, data] of [...donePages].sort((a, b) => a[0] - b[0])) {
    if (!data?.textContent || !data?.viewport) continue;
    pages.push({ key: keyOf(pdfDoc, pageNumber), textContent: data.textContent, viewport: data.viewport });
  }
  if (!pages.length) return false;
  return store.putPages(searchTextRowStamp(stamp), [{
    pageKey: `v${SEARCH_TEXT_KEEP_VERSION}`,
    scale: 0,
    type: 'application/octet-stream',
    data: packSearchText(pages),
  }]);
}
