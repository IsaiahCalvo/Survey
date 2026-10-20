/**
 * Open speed: show page 1 of a cloud PDF before the whole file has arrived.
 *
 * pdf.js is handed a short-lived signed Storage URL and reads it with HTTP
 * range requests, so it can parse the xref and draw page 1 from the first few
 * hundred KB while the rest keeps streaming in the background (the full file
 * still downloads; it just no longer blocks the first page).
 *
 * The old full download stays the path whenever the bytes themselves are
 * needed or streaming cannot work:
 *   - the file is local (has arrayBuffer) - edited, saved or imported bytes;
 *   - Electron production (file:// origin) or no network;
 *   - this device already holds the bytes (the byte cache answers instantly);
 *   - a page-presentation (mirror) state must be applied to the bytes first;
 *   - this path was already found to carry such a state (see forceDownload);
 *   - the signed URL, a range request, CORS or the parse fails or times out.
 */

export const STREAM_RANGE_CHUNK_BYTES = 256 * 1024;
export const STREAM_OPEN_TIMEOUT_MS = 10_000;
export const STREAM_SIGNED_URL_SECONDS = 10 * 60;

/** Pure: should this cloud document be opened by streaming? */
export function chooseCloudPdfOpenPath({
  pdfFile,
  protocol = (typeof window !== 'undefined' ? window.location?.protocol : undefined),
  online = (typeof navigator !== 'undefined' ? navigator.onLine !== false : true),
  hasDurablePresentation = false,
  forceDownload = false,
  streamSupported = true,
} = {}) {
  if (!pdfFile) return { path: 'download', reason: 'no-file' };
  if (typeof pdfFile.arrayBuffer === 'function') return { path: 'local', reason: 'local-bytes' };
  if (!pdfFile.filePath) return { path: 'download', reason: 'no-cloud-path' };
  if (!streamSupported) return { path: 'download', reason: 'stream-unavailable' };
  if (protocol === 'file:') return { path: 'download', reason: 'file-protocol' };
  if (!online) return { path: 'download', reason: 'offline' };
  if (forceDownload) return { path: 'download', reason: 'needs-bytes' };
  if (hasDurablePresentation) return { path: 'download', reason: 'presentation-state' };
  return { path: 'stream', reason: 'cloud' };
}

/** pdf.js options for a ranged, progressively loaded open. */
export function streamGetDocumentOptions(url, verbosity) {
  return {
    url,
    isEvalSupported: false,
    rangeChunkSize: STREAM_RANGE_CHUNK_BYTES,
    disableAutoFetch: false,
    disableStream: false,
    disableRange: false,
    withCredentials: false,
    ...(verbosity != null ? { verbosity } : {}),
  };
}

/**
 * Try the stream. Resolves `{ pdf }` on success, `{ blob }` when the device
 * cache already has the bytes, or `null` to fall back to the full download.
 * Never rejects. `source` is useStorage().openDocumentStream.
 */
export async function tryOpenCloudPdfStream({
  pdfjsLib,
  pdfjsReady,
  filePath,
  source,
  timeoutMs = STREAM_OPEN_TIMEOUT_MS,
  isCancelled = () => false,
  onFallback = () => {},
  onAllBytes = () => {},
}) {
  let loadingTask = null;
  let timer = null;
  try {
    const opened = await source(filePath);
    if (!opened) { onFallback('no-stream-source'); return null; }
    if (opened.blob) return { blob: opened.blob };
    if (!opened.url) { onFallback('no-signed-url'); return null; }
    const lib = pdfjsReady ? await pdfjsReady : pdfjsLib;
    const pdfjs = lib?.getDocument ? lib : pdfjsLib;
    if (isCancelled()) return null;
    loadingTask = pdfjs.getDocument(streamGetDocumentOptions(opened.url, pdfjs.VerbosityLevel?.ERRORS));
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('stream open timed out')), timeoutMs);
    });
    const pdf = await Promise.race([loadingTask.promise, timeout]);
    if (typeof pdf?.getData === 'function') {
      // The rest of the file keeps streaming in (disableAutoFetch: false);
      // once it is all here, hand the bytes on (device cache, mirror check).
      pdf.getData().then((bytes) => {
        try { opened.onBytes?.(bytes); } finally { onAllBytes(bytes); }
      }).catch(() => {});
    }
    return { pdf };
  } catch (error) {
    onFallback(error?.message || String(error));
    try { await loadingTask?.destroy(); } catch { /* already gone */ }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
