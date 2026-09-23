/**
 * Starts the idle thumbnail backfill for the Documents list while it is shown.
 *
 * UX (owner 2026-09-23): every document in the list should show a real page
 * thumbnail, without the list "constantly fetching". So:
 *   - rows still never download (the #801 egress rule); this hook runs ONE
 *     background queue (services/thumbnailBackfill.js) that fills missing
 *     thumbnails one at a time, only while the list is on screen and the
 *     user is idle;
 *   - small PDFs (<= 1.5MB) are downloaded whole — one request;
 *   - larger ones are read with HTTP range requests, so a 25MB drawing costs
 *     only the bytes its first page needs; past 8MB for page 1 the document
 *     is skipped (and remembered) rather than dragging the whole file down;
 *   - each result is cached on this device and announced to the rows
 *     (services/thumbnailEvents.js), including sibling tabs.
 * A backfilled image is the bare first page. The open viewer replaces it with
 * the marked-up page once the document is opened (useDocumentThumbnailCapture).
 */
import { useEffect, useRef } from 'react';
import { supabase, isSupabaseAvailable } from '../supabaseClient';
import { loadPdfjs } from '../utils/pdfWorkerConfig';
import { readBlobAsArrayBuffer } from '../utils/blobArrayBuffer';
import { thumbnailStore, thumbCacheKey } from '../services/thumbnailStore';
import { createThumbnailBackfill } from '../services/thumbnailBackfill';
import { publishThumbnailUpdate } from '../services/thumbnailEvents';
import { isUserBusy } from '../services/userActivity';
import { encodeThumbnail, openRangedPdf, releaseCanvas, renderPageToCanvas } from '../services/thumbnailRender';
import { registerThumbnailBackfill } from '../home/thumbnailRequestPolicy';

export const FULL_DOWNLOAD_MAX_BYTES = 1.5 * 1024 * 1024;
export const RANGED_PAGE_BUDGET_BYTES = 8 * 1024 * 1024;
// Safety net: no single document may hold the queue longer than this.
export const GENERATE_TIMEOUT_MS = 60_000;

const looksLocalPath = (filePath) => filePath.includes('/Users/') || filePath.includes('\\')
  || filePath.startsWith('/') || filePath.includes(':');

function skipError(reason) {
  const error = new Error(reason);
  error.code = 'THUMB_SKIP';
  error.reason = reason;
  return error;
}

async function openSource(doc, { pdfjsLib, downloadDocument }) {
  if (doc.file) {
    const data = await readBlobAsArrayBuffer(doc.file);
    return { loadingTask: pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: pdfjsLib.VerbosityLevel.ERRORS }), stats: { bytes: 0, requests: 0 } };
  }
  const filePath = doc.file_path || doc.filePath;
  if (!filePath || looksLocalPath(filePath)) throw skipError('no-cloud-source');
  const size = Number(doc.file_size || doc.size) || 0;
  if (size && size <= FULL_DOWNLOAD_MAX_BYTES && downloadDocument) {
    const blob = await downloadDocument(filePath);
    const data = await readBlobAsArrayBuffer(blob);
    return {
      loadingTask: pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: pdfjsLib.VerbosityLevel.ERRORS }),
      stats: { bytes: data.byteLength, requests: 1 },
    };
  }
  if (!isSupabaseAvailable()) throw skipError('offline');
  const { data: signed, error } = await supabase.storage.from('documents').createSignedUrl(filePath, 120);
  if (error || !signed?.signedUrl) throw error || new Error('could not sign thumbnail source');
  return openRangedPdf({ pdfjsLib, url: signed.signedUrl, maxBytes: RANGED_PAGE_BUDGET_BYTES });
}

/* Two documents can share one stored file (same bytes uploaded twice). The
   page image is identical, so the second one reuses the first render instead
   of fetching the file again. Small and per-session. */
const recentByFile = new Map();
const MAX_RECENT_BY_FILE = 8;
const fileStampOf = (doc) => doc?.content_sha256 || doc?.contentSha256 || doc?.file_path || doc?.filePath || null;

/** Render + cache one document's bare first page. Exported for diagnostics. */
export async function generatePageThumbnail(doc, { downloadDocument, isCancelled = () => false } = {}) {
  const key = thumbCacheKey(doc);
  if (!key) throw skipError('no-key');
  const fileStamp = fileStampOf(doc);
  const reused = fileStamp ? recentByFile.get(fileStamp) : null;
  if (reused) {
    await thumbnailStore().put(key, { ...reused, source: 'page', signature: null });
    publishThumbnailUpdate({ docId: doc.id, key, source: 'page' });
    return { bytes: 0, requests: 0, imageBytes: reused.url.length, reused: true };
  }
  const pdfjsLib = await loadPdfjs();
  let source = null;
  let pdf = null;
  let page = null;
  let base = null;
  try {
    source = await openSource(doc, { pdfjsLib, downloadDocument });
    const guard = (promise) => (source.aborted ? Promise.race([promise, source.aborted]) : promise);
    try {
      pdf = await guard(source.loadingTask.promise);
    } catch (error) {
      if (source?.stats?.tooLarge) throw skipError('too-large');
      if (error?.name === 'InvalidPDFException') throw skipError('unreadable');
      throw error;
    }
    if (isCancelled()) return null;
    page = await guard(pdf.getPage(1));
    base = await guard(renderPageToCanvas(page));
    if (isCancelled()) return null;
    const url = encodeThumbnail(base.canvas);
    await thumbnailStore().put(key, { url, aspect: base.aspect, source: 'page', signature: null });
    if (fileStamp) {
      recentByFile.set(fileStamp, { url, aspect: base.aspect });
      while (recentByFile.size > MAX_RECENT_BY_FILE) recentByFile.delete(recentByFile.keys().next().value);
    }
    publishThumbnailUpdate({ docId: doc.id, key, source: 'page' });
    const result = { bytes: source.stats?.bytes || 0, requests: source.stats?.requests || 0, imageBytes: url.length };
    if (import.meta.env?.DEV && typeof window !== 'undefined') {
      (window.__thumbnailBackfillLog ||= []).push({ id: doc.id, name: doc.name, ...result });
    }
    return result;
  } catch (error) {
    if (error?.code === 'THUMB_SKIP' || source?.stats?.tooLarge) {
      await thumbnailStore().putSkip(key, error.reason || 'too-large');
      return null;
    }
    throw error;
  } finally {
    try { page?.cleanup(); } catch { /* already destroyed */ }
    await source?.loadingTask?.destroy().catch(() => {});
    if (base) releaseCanvas(base.canvas);
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('thumbnail took too long')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export async function documentNeedsThumbnail(doc) {
  const key = thumbCacheKey(doc);
  if (!key) return false;
  const store = thumbnailStore();
  if (store.isDisabled) return false;
  if (await store.get(key)) return false;
  if (await store.getSkip(key)) return false;
  return true;
}

/**
 * @param {Array} documents  the list's raw document rows
 * @param {object} options
 * @param {Function} options.downloadDocument  useStorage().downloadDocument
 * @param {{ current: HTMLElement|null }} options.hostRef  the list's root; the
 *        queue pauses whenever it is not rendered (another tab, viewer open)
 */
export function useThumbnailBackfill(documents, { downloadDocument, hostRef, enabled = true } = {}) {
  const backfillRef = useRef(null);
  const downloadRef = useRef(downloadDocument);
  downloadRef.current = downloadDocument;
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  useEffect(() => {
    if (!enabled) return undefined;
    const listVisible = () => {
      const host = hostRef?.current;
      return Boolean(host && host.isConnected && host.getClientRects().length > 0);
    };
    const backfill = createThumbnailBackfill({
      keyOf: thumbCacheKey,
      needsThumbnail: documentNeedsThumbnail,
      generate: (doc, { isCancelled }) => withTimeout(generatePageThumbnail(doc, {
        downloadDocument: downloadRef.current,
        isCancelled,
      }), GENERATE_TIMEOUT_MS),
      isBusy: () => !listVisible() || isUserBusy(),
      onError: (error, doc) => console.warn('[ThumbnailBackfill] failed:', doc?.name || doc?.id, error?.message || error),
    });
    backfillRef.current = backfill;
    if (import.meta.env?.DEV && typeof window !== 'undefined') window.__thumbnailBackfill = backfill;
    const unregister = registerThumbnailBackfill(backfill);
    backfill.setDocuments(Array.isArray(documentsRef.current) ? documentsRef.current : []);
    return () => {
      unregister();
      backfill.stop();
      if (backfillRef.current === backfill) backfillRef.current = null;
    };
  }, [enabled, hostRef]);

  useEffect(() => {
    backfillRef.current?.setDocuments(Array.isArray(documents) ? documents : []);
  }, [documents]);
}
