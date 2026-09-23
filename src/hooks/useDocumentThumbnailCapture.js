/**
 * Keeps an open document's list thumbnail current: page 1 WITH its markup.
 *
 * UX (owner 2026-09-23): "The thumbnail should always be updated, but it needs
 * to be lightweight." The viewer is the one place that already has everything
 * a correct thumbnail needs — the PDF loaded and the markup hydrated — so it
 * is the one that refreshes it. Nothing is downloaded for this.
 *
 * When it runs:
 *   - once, ~2.5s after a document finishes opening (fixes documents whose
 *     cached thumbnail is missing, bare, or from before an edit elsewhere);
 *   - ~3s after page-1 markup stops changing (debounced — one capture per
 *     burst of edits, never per stroke);
 *   - never while a pointer is down, within ~1.2s of any input, or while the
 *     window is hidden; it waits and retries instead;
 *   - on leaving the document (close / tab switch / page hide) if an edit is
 *     still waiting, using the already-rendered page so it is instant.
 * What it costs: the bare page is rendered once per open (720px, pdf.js
 * 'display' intent so it yields to input); each later capture only paints
 * the markup over that cached page and encodes a WebP (~10-30ms).
 * Skips entirely when nothing changed: the staleness signature
 * (services/thumbnailSignature.js) is compared with the cached one first.
 */
import { useCallback, useEffect, useRef } from 'react';
import { thumbnailStore, thumbCacheKey } from '../services/thumbnailStore';
import { computeThumbnailSignature, isThumbnailCurrent } from '../services/thumbnailSignature';
import { publishThumbnailUpdate } from '../services/thumbnailEvents';
import { isUserBusy } from '../services/userActivity';
import {
  composeThumbnail,
  encodeThumbnail,
  releaseCanvas,
  renderPageToCanvas,
  selectPageOneMarkup,
} from '../services/thumbnailRender';

export const THUMB_OPEN_DELAY_MS = 2500;
export const THUMB_SETTLE_MS = 3000;
const BUSY_RETRY_MS = 1500;

/** The list's cache key for the document open in the viewer. */
export function thumbKeyForOpenFile(pdfFile) {
  if (!pdfFile?.id) return null;
  const filePath = pdfFile.supabaseFilePath || pdfFile.filePath || null;
  // Content-addressed uploads are stored at `<user>/<sha256>.pdf`, so a file
  // opened by a path that did not carry the row's content_sha256 still maps
  // to the key the list uses.
  const shaFromPath = typeof filePath === 'string'
    ? (filePath.match(/\/([0-9a-f]{64})\.pdf$/i) || [])[1] || null
    : null;
  return thumbCacheKey({
    id: pdfFile.id,
    // Stamped (even as null) by the open path = the row's own value; only a
    // file that never carried it falls back to the path's hash.
    content_sha256: pdfFile.contentSha256 !== undefined
      ? pdfFile.contentSha256
      : (pdfFile.content_sha256 ?? shaFromPath),
    file_path: filePath,
  });
}

export function useDocumentThumbnailCapture({
  pdfFile,
  pdfDoc,
  pageOneAnnotations,
  callouts,
  hydrationReady,
  enabled = true,
}) {
  const key = enabled && hydrationReady ? thumbKeyForOpenFile(pdfFile) : null;
  const latest = useRef({});
  latest.current = { key, pdfDoc, pdfFile, pageOneAnnotations, callouts };
  const timerRef = useRef(null);
  const baseRef = useRef(null);
  const runningRef = useRef(false);
  const dirtyRef = useRef(false);
  const pendingRef = useRef(false);
  const lastSignatureRef = useRef(null);

  const signatureFor = useCallback((snapshot, geometry) => {
    const markup = selectPageOneMarkup(snapshot.pageOneAnnotations, snapshot.callouts);
    const signature = computeThumbnailSignature({
      fileStamp: snapshot.key,
      pdf: { ...geometry, byteLength: Number(snapshot.pdfFile?.size) || 0 },
      objects: markup.objects,
      callouts: markup.callouts,
    });
    return { markup, signature };
  }, []);

  const write = useCallback((snapshot, base, markup, signature) => {
    const canvas = composeThumbnail(base, markup);
    let url;
    try { url = encodeThumbnail(canvas); } finally { releaseCanvas(canvas); }
    lastSignatureRef.current = signature;
    const docId = snapshot.pdfFile?.id;
    return thumbnailStore()
      .put(snapshot.key, { url, aspect: base.aspect, signature, source: 'markup' })
      .then((ok) => { if (ok) publishThumbnailUpdate({ docId, key: snapshot.key, source: 'markup' }); return ok; });
  }, []);

  /* Page geometry (cheap) and, when `withCanvas`, the bare page render
     (once per open / per page edit). */
  const ensureBase = useCallback(async ({ withCanvas }) => {
    const snapshot = latest.current;
    let base = baseRef.current;
    if (base && (base.pdfDoc !== snapshot.pdfDoc || base.key !== snapshot.key)) {
      if (base.canvas) releaseCanvas(base.canvas);
      base = null;
      baseRef.current = null;
    }
    if (base && (base.canvas || !withCanvas)) return base;
    // The viewer's own page proxy: never cleanup() it here — the viewer
    // still renders from it.
    const page = await snapshot.pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const geometry = base?.geometry || {
      numPages: snapshot.pdfDoc.numPages || 0,
      width: viewport.width,
      height: viewport.height,
      rotate: page.rotate || 0,
    };
    let next = { pdfDoc: snapshot.pdfDoc, key: snapshot.key, geometry, canvas: null };
    if (withCanvas) {
      const rendered = await renderPageToCanvas(page);
      if (latest.current.pdfDoc !== snapshot.pdfDoc || latest.current.key !== snapshot.key) {
        releaseCanvas(rendered.canvas);
        return null;
      }
      next = { ...rendered, ...next, canvas: rendered.canvas };
    }
    baseRef.current = next;
    return next;
  }, []);

  const capture = useCallback(async () => {
    const snapshot = latest.current;
    if (!snapshot.key || !snapshot.pdfDoc) return;
    const cheap = await ensureBase({ withCanvas: false });
    if (!cheap) return;
    const { signature } = signatureFor(latest.current, cheap.geometry);
    if (signature === lastSignatureRef.current) return;
    if (!cheap.canvas) {
      const existing = await thumbnailStore().get(snapshot.key);
      if (isThumbnailCurrent(existing, signature)) { lastSignatureRef.current = signature; return; }
    }
    const base = await ensureBase({ withCanvas: true });
    if (!base) return;
    const current = latest.current;
    if (current.key !== snapshot.key || current.pdfDoc !== snapshot.pdfDoc) return;
    const painted = signatureFor(current, base.geometry);
    if (painted.signature === lastSignatureRef.current) return;
    if (isUserBusy({ quietMs: 1200 })) { dirtyRef.current = true; return; }
    await write(current, base, painted.markup, painted.signature);
  }, [ensureBase, signatureFor, write]);

  const schedule = useCallback((delayMs) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = true;
    timerRef.current = setTimeout(async function run() {
      timerRef.current = null;
      if (!latest.current.key || !latest.current.pdfDoc) { pendingRef.current = false; return; }
      if (isUserBusy({ quietMs: 1200 })) {
        timerRef.current = setTimeout(run, BUSY_RETRY_MS);
        return;
      }
      if (runningRef.current) { dirtyRef.current = true; return; }
      runningRef.current = true;
      pendingRef.current = false;
      try {
        await capture();
      } catch (error) {
        console.warn('[ThumbnailCapture] failed:', error?.message || error);
      } finally {
        runningRef.current = false;
        if (dirtyRef.current) { dirtyRef.current = false; schedule(BUSY_RETRY_MS); }
      }
    }, delayMs);
  }, [capture]);

  // Leaving with an edit still waiting: paint it now from the cached page.
  const flush = useCallback(() => {
    if (!pendingRef.current && !dirtyRef.current) return;
    const snapshot = latest.current;
    const base = baseRef.current;
    if (!snapshot.key || !base?.canvas || base.key !== snapshot.key) return;
    const { markup, signature } = signatureFor(snapshot, base.geometry);
    pendingRef.current = false;
    dirtyRef.current = false;
    if (signature === lastSignatureRef.current) return;
    void write(snapshot, base, markup, signature).catch(() => {});
  }, [signatureFor, write]);

  // A document (or its bytes, after a page edit) finished opening.
  useEffect(() => {
    if (!key || !pdfDoc) return undefined;
    lastSignatureRef.current = null;
    schedule(THUMB_OPEN_DELAY_MS);
    return undefined;
  }, [key, pdfDoc, schedule]);

  // Page-1 markup changed: capture once it settles. Meanwhile make sure the
  // bare page is rendered, so leaving right after an edit can still flush it.
  const firstMarkupRun = useRef(true);
  useEffect(() => {
    if (firstMarkupRun.current) { firstMarkupRun.current = false; return undefined; }
    if (!latest.current.key || !latest.current.pdfDoc) return undefined;
    schedule(THUMB_SETTLE_MS);
    if (baseRef.current?.canvas) return undefined;
    let cancelled = false;
    const prepare = () => {
      if (cancelled || runningRef.current) return;
      if (isUserBusy({ quietMs: 600 })) { prepareTimer = setTimeout(prepare, 600); return; }
      void ensureBase({ withCanvas: true }).catch(() => {});
    };
    let prepareTimer = setTimeout(prepare, 600);
    return () => { cancelled = true; clearTimeout(prepareTimer); };
  }, [pageOneAnnotations, callouts, schedule, ensureBase]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);

  useEffect(() => () => {
    flush();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (baseRef.current?.canvas) releaseCanvas(baseRef.current.canvas);
    baseRef.current = null;
  }, [flush]);
}
