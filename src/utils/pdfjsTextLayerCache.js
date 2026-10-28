// src/utils/pdfjsTextLayerCache.js
//
// 2026-10-28 (Spaces speed): turning a space off on a 30-page drawing froze
// the page for ~1 s (4 s at 4x CPU slowdown). Every page that came back built
// its text layer again (components/PdfjsTextLayer.jsx), and pdf.js measures
// every glyph run of a page (canvas measureText) in one task. Two changes:
//
//   - A page's built layer is kept when the page leaves (a space hides it, it
//     scrolls out, the tool changes) and put back when the same page comes
//     back at the same scale and rotation: no page read, no measuring.
//   - A layer that does have to be built is fed to pdf.js a slice at a time,
//     each slice in a task of its own, so building never holds the page.
//
// Kept layers are per document (a WeakMap on the pdf.js document, so they go
// with it) and capped, oldest out first.

const TEXT_LAYER_CACHE_MAX_LAYERS = 48;
// Glyph runs across all kept layers of one document (each is one <span>).
const TEXT_LAYER_CACHE_MAX_ITEMS = 60_000;

// Each slice is about this long, at the speed the last one went.
const SLICE_TARGET_MS = 8;
const SLICE_FIRST_ITEMS = 64;
const SLICE_MIN_ITEMS = 1;
const SLICE_MAX_ITEMS = 4_000;

const keptByPdf = new WeakMap();

export function textLayerKey(pageNumber, scale, rotation) {
  return `${pageNumber}|${scale}|${rotation || 0}`;
}

function keptFor(pdf, create) {
  if (!pdf || (typeof pdf !== 'object' && typeof pdf !== 'function')) return null;
  let kept = keptByPdf.get(pdf);
  if (!kept && create) {
    kept = new Map();
    keptByPdf.set(pdf, kept);
  }
  return kept || null;
}

const itemCount = (textContent) => (Array.isArray(textContent?.items) ? textContent.items.length : 0);

/**
 * Keep the layer `container` holds (its children and the size pdf.js wrote on
 * it) for the next mount of this page at this scale and rotation. The
 * children are moved out, not copied.
 */
export function keepTextLayer(pdf, key, container, textContent) {
  const kept = keptFor(pdf, true);
  if (!kept || !container || typeof container.childNodes === 'undefined') return false;
  if (itemCount(textContent) > TEXT_LAYER_CACHE_MAX_ITEMS) return false;
  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return false;
  const nodes = doc.createDocumentFragment();
  nodes.append(...container.childNodes);
  kept.delete(key);
  kept.set(key, {
    nodes,
    style: container.getAttribute('style'),
    rotation: container.getAttribute('data-main-rotation'),
    textContent,
  });
  let items = 0;
  for (const entry of kept.values()) items += itemCount(entry.textContent);
  for (const [oldKey, entry] of kept) {
    if (kept.size <= TEXT_LAYER_CACHE_MAX_LAYERS && items <= TEXT_LAYER_CACHE_MAX_ITEMS) break;
    kept.delete(oldKey);
    items -= itemCount(entry.textContent);
  }
  return true;
}

/**
 * Put a kept layer back into `container`. Returns its text content, or null
 * when none was kept (the caller builds one). A kept layer is used once.
 */
export function restoreTextLayer(pdf, key, container) {
  const kept = keptFor(pdf, false);
  const entry = kept?.get(key);
  if (!entry || !container) return null;
  kept.delete(key);
  if (entry.style == null) container.removeAttribute('style');
  else container.setAttribute('style', entry.style);
  if (entry.rotation == null) container.removeAttribute('data-main-rotation');
  else container.setAttribute('data-main-rotation', entry.rotation);
  container.replaceChildren(entry.nodes);
  return entry.textContent;
}

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

// A task of its own: a MessageChannel message, not setTimeout, which
// browsers throttle in background tabs.
function nextTask() {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * `textContent` as a stream pdf.js's TextLayer reads a slice at a time. It
 * lays out each slice as it arrives, so every slice after the first waits for
 * a task of its own. Slice size follows how long the last one took.
 */
export function textContentInSlices(textContent) {
  const items = Array.isArray(textContent?.items) ? textContent.items : [];
  let index = 0;
  let size = SLICE_FIRST_ITEMS;
  let handedAt = 0;
  let stopped = false;
  return new ReadableStream({
    async pull(controller) {
      // pdf.js asks for the next slice right after it laid out the last one.
      if (handedAt) {
        const spent = Math.max(0.5, now() - handedAt);
        size = Math.max(SLICE_MIN_ITEMS, Math.min(SLICE_MAX_ITEMS, Math.round(size * (SLICE_TARGET_MS / spent))));
        await nextTask();
      }
      if (stopped) return;
      const first = index === 0;
      const slice = items.slice(index, index + size);
      index += slice.length;
      try {
        controller.enqueue({
          items: slice,
          styles: first ? (textContent?.styles || {}) : {},
          lang: textContent?.lang ?? null,
        });
        if (index >= items.length) controller.close();
      } catch {
        // Cancelled while waiting for the task.
        stopped = true;
        return;
      }
      handedAt = now();
    },
    cancel() { stopped = true; },
  }, { highWaterMark: 0 });
}
