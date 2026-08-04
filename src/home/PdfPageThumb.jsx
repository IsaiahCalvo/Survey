/* Survey Hub — real PDF first-page thumbnail.

   Renders the actual first page of a PDF to an <img>. Byte resolution mirrors
   the app's own PDFThumbnail (App.jsx): a local File, an inline data URL, or a
   Supabase storage path (download, with a public-URL fetch as a fallback).

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

/* Keep only a small LRU of rendered pages. An unbounded data-URL cache can
   exceed an iOS WebView's memory limit on accounts with many documents. */
const thumbCache = new Map();
const thumbInflight = new Map();
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
   workers at once. */
let activeRenders = 0;
const renderWaiters = [];
const MAX_CONCURRENT = 3;
const acquireSlot = () => {
  if (activeRenders < MAX_CONCURRENT) { activeRenders += 1; return Promise.resolve(); }
  return new Promise((resolve) => renderWaiters.push(resolve));
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

const loadThumb = (docId, doc, downloadDocument) => {
  if (docId && thumbInflight.has(docId)) return thumbInflight.get(docId);
  const promise = (async () => {
    const arrayBuffer = await resolvePdfBytes(doc, downloadDocument);
    if (!arrayBuffer) return 'FAILED';
    await acquireSlot();
    try {
      return await renderFirstPage(arrayBuffer);
    } finally {
      releaseSlot();
    }
  })();
  if (docId) {
    thumbInflight.set(docId, promise);
    void promise.then(
      () => thumbInflight.delete(docId),
      () => thumbInflight.delete(docId),
    );
  }
  return promise;
};

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
        const result = await loadThumb(docId, doc, downloadDocument);
        if (cancelled) return;
        cacheThumb(docId, result);
        if (result === 'FAILED') { setFailed(true); return; }
        setData(result);
      } catch (error) {
        // Corrupt PDF, missing storage file, etc. — show the placeholder and
        // do not retry this document.
        console.warn('[PdfPageThumb] thumbnail render failed:', error?.message || error);
        cacheThumb(docId, 'FAILED');
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; };
  }, [nearViewport, docId, doc?.file, doc?.file_path, doc?.filePath, doc?.dataUrl, downloadDocument]);

  if (failed) return fallback;

  const isRow = variant === 'row';
  const aspect = data?.aspect || DEFAULT_ASPECT;
  // Row: fixed height, width follows the page's true aspect ratio.
  // Preview: fills the pane's width; `fill` lets it also fill the available
  // height (flexing inside a column) so the pane needs no scroll.
  const box = isRow
    ? { width: Math.round(height * aspect), height, borderRadius: 2, flex: 'none' }
    : { width: '100%', height: fill ? '100%' : height, borderRadius: 6 };

  if (!data) {
    // Loading — same box dimensions as the final state, so no reflow.
    return (
      <div
        ref={hostRef}
        style={{
        ...box,
        background: 'rgba(244,241,234,0.05)',
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
