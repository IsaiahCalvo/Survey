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
 *   - the file carries a page-presentation (mirror) tag, found by a small
 *     ranged read of its trailer and catalog before the first paint, so a
 *     mirrored file never shows unmirrored (see probePdfPresentationTag);
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

const PRESENTATION_TAG = '/SurveyPagePresentation';
const PROBE_TAIL_BYTES = 8 * 1024;
const PROBE_OBJECT_BYTES = 8 * 1024;
const PROBE_MAX_OBJECT_BYTES = 128 * 1024;
const PROBE_MAX_XREF_SECTIONS = 32;

const latin1 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};

async function fetchRange(fetchImpl, url, start, endInclusive) {
  const header = start == null ? `bytes=-${endInclusive}` : `bytes=${start}-${endInclusive}`;
  const response = await fetchImpl(url, { headers: { Range: header }, cache: 'no-store' });
  // 200 would mean the whole file: no cheap answer, so the caller downloads.
  if (response.status !== 206) throw new Error(`range ${response.status}`);
  const total = Number(/\/(\d+)\s*$/.exec(response.headers.get('content-range') || '')?.[1]);
  return { text: latin1(new Uint8Array(await response.arrayBuffer())), total };
}

/**
 * Before the first paint: does this cloud PDF carry the page-presentation
 * (mirror) tag in its catalog? Reads only the trailer, the xref entry of the
 * catalog and the catalog itself with HTTP range requests.
 * Resolves 'tagged' | 'untagged' | 'unknown' and never rejects; 'unknown'
 * opens by download, so a mirrored file never shows unmirrored.
 *
 * Survey writes tagged files without object streams (classic xref table),
 * and the open path only honours a tag visible in the raw bytes
 * (pdfBytesHavePresentationTag), so a file whose xref is a stream has no tag
 * the download would apply either: it is 'untagged' unless its tail shows one.
 */
export async function probePdfPresentationTag(url, { fetchImpl = globalThis.fetch } = {}) {
  try {
    if (typeof fetchImpl !== 'function' || !url) return 'unknown';
    const tail = await fetchRange(fetchImpl, url, null, PROBE_TAIL_BYTES);
    const total = tail.total;
    if (!Number.isFinite(total) || total <= 0) return 'unknown';
    const tailStart = total - tail.text.length;
    if (tail.text.includes(PRESENTATION_TAG)) return 'tagged';
    const startxrefAt = tail.text.lastIndexOf('startxref');
    if (startxrefAt < 0) return 'unknown';
    let xrefOffset = Number(/startxref\s+(\d+)/.exec(tail.text.slice(startxrefAt))?.[1]);
    const readAt = async (offset, length) => {
      if (offset >= tailStart && offset < total) return tail.text.slice(offset - tailStart);
      return (await fetchRange(fetchImpl, url, offset, Math.min(total, offset + length) - 1)).text;
    };
    let root = null;
    for (let section = 0; section < PROBE_MAX_XREF_SECTIONS && Number.isFinite(xrefOffset); section += 1) {
      if (xrefOffset < 0 || xrefOffset >= total) return 'unknown';
      let text = await readAt(xrefOffset, PROBE_TAIL_BYTES);
      if (!/^\s*xref\b/.test(text)) {
        // An xref stream: see the doc comment above.
        return /^\s*\d+\s+\d+\s+obj\b/.test(text) ? 'untagged' : 'unknown';
      }
      let trailerAt = text.indexOf('trailer');
      if (trailerAt < 0) {
        // A long xref table: read up to its trailer (20 bytes per entry).
        text = (await fetchRange(fetchImpl, url, xrefOffset, Math.min(total, xrefOffset + 4 * 1024 * 1024) - 1)).text;
        trailerAt = text.indexOf('trailer');
        if (trailerAt < 0) return 'unknown';
      }
      const trailer = text.slice(trailerAt, text.indexOf('>>', trailerAt) + 2 || undefined);
      if (root == null) {
        const match = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(trailer);
        if (!match) return 'unknown';
        root = Number(match[1]);
      }
      // Subsections: "first count" then count 20-byte entries.
      const body = text.slice(text.indexOf('xref') + 4, trailerAt);
      const header = /(\d+)\s+(\d+)\s*\r?\n?/g;
      let cursor = 0;
      let catalogOffset = null;
      while (cursor < body.length) {
        header.lastIndex = cursor;
        const sub = header.exec(body);
        if (!sub || body.slice(cursor, sub.index).trim()) break;
        const first = Number(sub[1]);
        const count = Number(sub[2]);
        const entriesAt = header.lastIndex;
        const entries = body.slice(entriesAt).match(/\d{10}\s\d{5}\s[nf]/g) || [];
        if (root >= first && root < first + count) {
          const entry = entries[root - first];
          if (!entry) return 'unknown';
          const [offset, , kind] = entry.split(/\s/);
          if (kind !== 'n') return 'unknown';
          catalogOffset = Number(offset);
          break;
        }
        // Skip this subsection's entries (each one exactly 20 bytes).
        cursor = entriesAt + count * 20;
      }
      if (catalogOffset != null) {
        for (let length = PROBE_OBJECT_BYTES; length <= PROBE_MAX_OBJECT_BYTES; length *= 4) {
          const object = await readAt(catalogOffset, length);
          if (!new RegExp(`^\\s*${root}\\s+\\d+\\s+obj\\b`).test(object)) return 'unknown';
          const end = object.indexOf('endobj');
          const scope = end >= 0 ? object.slice(0, end) : object;
          if (scope.includes(PRESENTATION_TAG)) return 'tagged';
          if (end >= 0) return 'untagged';
          if (catalogOffset + object.length >= total) return 'unknown';
        }
        return 'unknown';
      }
      xrefOffset = Number(/\/Prev\s+(\d+)/.exec(trailer)?.[1]);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
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
  onBytesFailed = () => {},
  probeTag = (url) => probePdfPresentationTag(url),
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
    // A mirrored file must never paint unmirrored: learn whether it carries
    // the tag alongside the pdf.js open, and hand back no pdf until it is known.
    const tagPromise = Promise.resolve().then(() => probeTag(opened.url)).catch(() => 'unknown');
    loadingTask = pdfjs.getDocument(streamGetDocumentOptions(opened.url, pdfjs.VerbosityLevel?.ERRORS));
    // A timeout leaves this promise behind; it must not become unhandled.
    loadingTask.promise?.catch?.(() => {});
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('stream open timed out')), timeoutMs);
    });
    const [pdf, tag] = await Promise.race([Promise.all([loadingTask.promise, tagPromise]), timeout]);
    if (tag !== 'untagged') throw new Error(tag === 'tagged' ? 'presentation-tag' : 'presentation-tag-unknown');
    if (typeof pdf?.getData === 'function') {
      // The rest of the file keeps streaming in (disableAutoFetch: false);
      // once it is all here, hand the bytes on (device cache, mirror check).
      pdf.getData().then((bytes) => {
        try { opened.onBytes?.(bytes); } finally { onAllBytes(bytes); }
      }).catch((error) => onBytesFailed(error));
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

/**
 * After a streamed open succeeded, a later failure (a range request for page 1
 * or page sizing) reloads once through the full download rather than showing
 * a load error. Once per path: the retry is a download, so it cannot loop.
 */
export function shouldRetryStreamedOpenWithDownload({ openedByStream, filePath, forced, stillCurrent = true }) {
  // stillCurrent: a page view may have replaced this file; never reload it.
  return Boolean(openedByStream && stillCurrent && filePath && !forced?.has?.(filePath));
}
