/* Survey Hub — real PDF first-page thumbnail.

   Renders the actual first page of a PDF to an <img>. Byte resolution mirrors
   the app's own PDFThumbnail (App.jsx): a local File, an inline data URL, or a
   Supabase storage path (authenticated download for selected previews only).

   One HIGH-resolution render is done per document and cached by id, then
   reused everywhere — the big preview pane and the small file-row thumbnails
   share the same image. CSS `object-fit: contain` handles the fit, so the one
   crisp image looks right at any display size.

   variant="preview" — fills its container's width at a fixed height; the page
                       is contained (letterboxed) and centred inside. The
                       viewport never changes size between documents.
   variant="row"     — fixed height, width set from the page's TRUE aspect
                       ratio, so the small thumbnail has the real page shape.

   When a document has no usable source (or rendering fails) the `fallback`
   node is rendered instead — the existing stylised placeholder. */
import { useState, useEffect, useRef } from 'react';
import { loadPdfjs } from '../utils/pdfWorkerConfig';
import { readBlobAsArrayBuffer } from '../utils/blobArrayBuffer';
import { thumbnailStore, thumbCacheKey } from '../services/thumbnailStore';
import { canResolveThumbnailBytes, createThumbnailRequestPool } from './thumbnailRequestPolicy';

/* Two tiers of cache.

   In-memory (this bounded LRU): keyed by document id, lives for the page.
   Stops a re-render on every search keystroke or re-selection without
   exhausting an iOS WebView on accounts with many documents.

   Durable (services/thumbnailStore, IndexedDB): survives reloads, so the
   download + rasterize is paid ONCE per document rather than once per visit.
   Before it existed, every reload re-downloaded the whole PDF for every
   visible row — 6.3s of transfer for a single 25MB drawing. The memory tier
   is checked synchronously first; the durable tier is checked before any
   network work happens. Value: { url, aspect } or the in-memory 'FAILED'
   sentinel. */
const thumbCache = new Map();
const thumbnailRequests = createThumbnailRequestPool();
const MAX_CACHE_ENTRIES = 24;
const readCachedThumb = (docId) => {
  if (!docId || !thumbCache.has(docId)) return null;
  const value = thumbCache.get(docId);
  thumbCache.delete(docId);
  thumbCache.set(docId, value);
  return value;
};
const cacheThumb = (docId, value) => {
  if (!docId) return;
  thumbCache.delete(docId);
  thumbCache.set(docId, value);
  while (thumbCache.size > MAX_CACHE_ENTRIES) {
    thumbCache.delete(thumbCache.keys().next().value);
  }
};

/* Cap concurrent renders so a long document list does not spawn many pdf.js
   workers at once.

   The queue is shared by every thumbnail in the app, so a screen the user has
   already left can leave dozens of waiters in it — a Documents ledger of 17
   files queues ~26. A `priority` waiter (the big preview pane: the one image
   the user is actually looking at, on a screen where it is the ONLY image)
   goes to the FRONT, so it waits for one in-flight render instead of the whole
   backlog and its box does not sit empty while off-screen rows render. */
let activeRenders = 0;
const renderWaiters = [];
const MAX_CONCURRENT = 3;
const acquireSlot = (priority = false) => {
  if (activeRenders < MAX_CONCURRENT) { activeRenders += 1; return Promise.resolve(); }
  return new Promise((resolve) => {
    if (priority) renderWaiters.unshift(resolve);
    else renderWaiters.push(resolve);
  });
};
const releaseSlot = () => {
  const next = renderWaiters.shift();
  if (next) next();
  else activeRenders = Math.max(0, activeRenders - 1);
};

/* Resolve a document object to PDF bytes — faithful to App.jsx's PDFThumbnail.
   Returns an ArrayBuffer, or null when there is no usable source. */
const resolvePdfBytes = async (doc, downloadDocument) => {
  if (!doc) return null;

  // 1. A local File object (present right after an upload).
  if (doc.file) {
    return readBlobAsArrayBuffer(doc.file);
  }

  // 2. An inline data URL.
  if (doc.dataUrl) {
    const res = await fetch(doc.dataUrl);
    if (!res.ok) throw new Error(`thumbnail fetch failed (${res.status})`);
    return res.arrayBuffer();
  }

  // 3. A Supabase storage path via the authenticated download only. The bucket
  // is private, so a getPublicUrl() fetch can never succeed — no public fallback.
  const filePath = doc.file_path || doc.filePath;
  if (filePath) {
    const looksLocal = filePath.includes('/Users/') || filePath.includes('\\')
      || filePath.startsWith('/') || filePath.includes(':');
    if (!looksLocal && downloadDocument) {
      const blob = await downloadDocument(filePath);
      return await readBlobAsArrayBuffer(blob);
    }
  }

  return null;
};

/* Render page 1 to a high-resolution JPEG data URL. The page's longest side is
   rendered at TARGET px so the image stays crisp when CSS scales it down to
   any thumbnail size. Returns { url, aspect } (aspect = width / height).
   Recovery-mode fallback matches App.jsx for slightly corrupt PDFs. */
const TARGET = 1000;
const renderFirstPage = async (arrayBuffer) => {
  const pdfjsLib = await loadPdfjs();
  let loadingTask;
  let pdf;
  let page;
  let canvas;
  try {
    // Clone the buffer — pdf.js detaches it when transferring to the worker.
    loadingTask = pdfjsLib.getDocument({ isEvalSupported: false,
      data: arrayBuffer.slice(0),
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    pdf = await loadingTask.promise;
  } catch {
    await loadingTask?.destroy().catch(() => {});
    loadingTask = pdfjsLib.getDocument({ isEvalSupported: false,
      data: arrayBuffer.slice(0),
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
      stopAtErrors: false,
      disableAutoFetch: true,
      disableStream: true,
    });
    try {
      pdf = await loadingTask.promise;
    } catch (error) {
      await loadingTask.destroy().catch(() => {});
      throw error;
    }
  }

  try {
    page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const aspect = base.width / base.height;
    const scale = TARGET / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });

    canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    // White paper backdrop so pages with transparent regions are not black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: context, viewport }).promise;
    return { url: canvas.toDataURL('image/jpeg', 0.9), aspect };
  } finally {
    page?.cleanup();
    pdf?.cleanup();
    await loadingTask?.destroy().catch(() => {});
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
};

const loadThumb = (docId, doc, downloadDocument, priority = false, isCancelled = () => false) =>
  thumbnailRequests.run(docId && `${docId}:${priority ? 'preview' : 'local'}`, isCancelled, (hasActiveConsumer) => {
  const promise = (async () => {
    const persistKey = thumbCacheKey(doc);
    if (persistKey) {
      const stored = await thumbnailStore().get(persistKey);
      if (stored) return stored;
    }

    // A missing cached row image is not a corrupt PDF. Leave a placeholder
    // without poisoning the cache: a selected preview can still render it.
    if (!hasActiveConsumer() || !canResolveThumbnailBytes(doc, priority)) return 'DEFERRED';
    await acquireSlot(priority);
    try {
      // Limit downloads as well as renders. Do not start a queued transfer
      // after every consumer has left this screen.
      if (!hasActiveConsumer()) return 'DEFERRED';
      const arrayBuffer = await resolvePdfBytes(doc, downloadDocument);
      if (!hasActiveConsumer()) return 'DEFERRED';
      if (!arrayBuffer) return 'FAILED';
      const result = await renderFirstPage(arrayBuffer);
      if (persistKey) void thumbnailStore().put(persistKey, result);
      return result;
    } finally {
      releaseSlot();
    }
  })();
  return promise;
});

/* US Letter portrait — the loading-state default aspect before the real
   page aspect is known (most documents are portrait letter). */
const DEFAULT_ASPECT = 612 / 792;

export default function PdfPageThumb({
  doc,
  downloadDocument,
  variant = 'preview',
  height = variant === 'row' ? 30 : 460,
  fill = false,
  fallback = null,
  // Set only on a selected preview: permits a cloud download on cache miss
  // and moves the request to the front of the shared queue.
  priority = false,
}) {
  const docId = doc?.id;
  const hostRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: '320px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [docId]);

  useEffect(() => {
    if (!nearViewport) {
      setData(null);
      setFailed(false);
      return undefined;
    }
    let cancelled = false;

    const existing = readCachedThumb(docId);
    if (existing === 'FAILED') { setData(null); setFailed(true); return undefined; }
    if (existing) { setData(existing); setFailed(false); return undefined; }

    setData(null);
    setFailed(false);

    (async () => {
      try {
        /* loadThumb checks IndexedDB before downloading or entering the
           shared render queue, then persists newly rendered thumbnails. */
        const result = await loadThumb(docId, doc, downloadDocument, priority, () => cancelled);
        if (cancelled) return;
        if (result === 'DEFERRED') { setFailed(true); return; }
        cacheThumb(docId, result);
        if (result === 'FAILED') { setFailed(true); return; }
        setData(result);
      } catch (error) {
        // Corrupt PDF, missing storage file, etc. — show the placeholder and
        // do not retry this document.
        console.warn('[PdfPageThumb] thumbnail render failed:', error?.message || error);
        if (!cancelled) {
          cacheThumb(docId, 'FAILED');
          setFailed(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [nearViewport, docId, doc?.file, doc?.file_path, doc?.filePath, doc?.dataUrl, downloadDocument, priority]);

  const isRow = variant === 'row';
  const aspect = data?.aspect || DEFAULT_ASPECT;
  // Row: fixed height, width follows the page's true aspect ratio.
  // Preview: fills the pane's width; `fill` lets it also fill the available
  // height (flexing inside a column) so the pane needs no scroll.
  const box = isRow
    ? { width: Math.round(height * aspect), height, borderRadius: 2, flex: 'none' }
    : { width: '100%', height: fill ? '100%' : height, borderRadius: 6 };

  if (failed) {
    // Keep the observed element mounted in every state. Replacing it with
    // the fallback would report "offscreen" and strand later preview loads.
    return (
      <div ref={hostRef} style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {fallback}
      </div>
    );
  }

  if (!data) {
    // Loading — same box dimensions as the final state, so no reflow.
    return (
      <div
        ref={hostRef}
        style={{
        ...box,
        /* The loading box is a well on the card, so it takes the well surface
           (--ink-700 is the hub's alias of --surface-2) rather than the
           retired warm cream at 5% alpha. */
        background: 'var(--ink-700)',
        border: '1px solid var(--ink-500)',
        boxSizing: 'border-box',
        }}
      />
    );
  }

  return (
    <div ref={hostRef} style={{
      ...box,
      // Dark slate backdrop — the page (white paper) is letterboxed against
      // it; the surrounding margin reads as part of the app's dark aesthetic,
      // not a white block.
      background: 'var(--ink-800)',
      border: '1px solid var(--ink-500)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: isRow ? 'none' : '0 2px 12px rgba(0,0,0,0.35)',
    }}>
      <img
        src={data.url}
        alt=""
        style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', objectFit: 'contain' }}
      />
    </div>
  );
}
