/**
 * Drawing and encoding document thumbnails (page 1, optionally with markup).
 *
 * Size: the longest side is 720px. That is 2x the Documents preview pane
 * (360px tall), so the one cached image stays crisp there AND in the 30px
 * list rows (CSS scales it down). WebP at q0.8 lands around 15-60KB for a
 * typical sheet — versus 100-250KB for the old 1000px JPEG q0.9.
 *
 * Off-screen canvases only; nothing here touches the DOM tree.
 */
import { paintAnnotationCanvas } from '../utils/annotationCanvasPainter.js';
import { isAnnotationVisibleInContext } from '../utils/annotationVisibilityRules.js';
import { projectPaperInkForPresentation } from '../utils/paperInkPresentation.js';

export const THUMB_TARGET_PX = 720;
const RENDER_TIMEOUT_MS = 20_000;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Free a canvas's backing store now instead of at GC (iOS WebView budget). */
export function releaseCanvas(canvas) {
  if (canvas) { canvas.width = 1; canvas.height = 1; }
}

/**
 * Render a pdf.js page onto a white canvas whose longest side is `target`.
 * Uses the 'display' intent so a big sheet yields to input between chunks
 * instead of freezing the app; a timeout guards the hidden-window case where
 * 'display' stops receiving animation frames.
 */
export async function renderPageToCanvas(page, { target = THUMB_TARGET_PX, timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  const base = page.getViewport({ scale: 1 });
  const scale = target / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = makeCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Page annotations stay off: the app draws its own copies of imported marks
  // (the viewer renders pages the same way — PdfjsViewerContainer DISABLE).
  const task = page.render({ canvasContext: context, viewport, annotationMode: 0 });
  let timer = null;
  try {
    await Promise.race([
      task.promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { task.cancel(); } catch { /* already settled */ }
          reject(new Error('thumbnail page render timed out'));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    canvas,
    aspect: base.width / base.height,
    pageWidth: base.width,
    pageHeight: base.height,
    rotate: page.rotate || 0,
  };
}

/**
 * Page-1 markup exactly as the viewer's default view paints it: no survey
 * module open, no space selected — the "regular markup" view. Mirrors the
 * LightweightAnnotationOverlay filter (legacy survey-marker rects carry an
 * annotationId and are skipped; ink goes through the same presentation
 * projection).
 */
export function selectPageOneMarkup(pageAnnotations, callouts = []) {
  const context = { pageNumber: 1 };
  const objects = (Array.isArray(pageAnnotations?.objects) ? pageAnnotations.objects : [])
    .filter((object) => object && !object.annotationId
      && isAnnotationVisibleInContext({ annotation: object, ...context }))
    .map(projectPaperInkForPresentation);
  const pageCallouts = (Array.isArray(callouts) ? callouts : [])
    .filter((callout) => callout
      && (callout.pageNumber == null || Number(callout.pageNumber) === 1)
      && isAnnotationVisibleInContext({ annotation: callout, ...context }));
  return { objects, callouts: pageCallouts };
}

/** Base page image + markup painted on top, as a new canvas. */
export function composeThumbnail(base, { objects = [], callouts = [] } = {}) {
  const canvas = makeCanvas(base.canvas.width, base.canvas.height);
  const context = canvas.getContext('2d');
  context.drawImage(base.canvas, 0, 0);
  if (objects.length || callouts.length) {
    // paintAnnotationCanvas clears its target first, so it paints onto its
    // own transparent layer which is then laid over the page.
    const overlay = makeCanvas(canvas.width, canvas.height);
    const drawScale = canvas.width / base.pageWidth;
    const drawScaleY = canvas.height / base.pageHeight;
    paintAnnotationCanvas(overlay.getContext('2d'), {
      canvasWidth: overlay.width,
      canvasHeight: overlay.height,
      drawScale,
      drawScaleY,
      displayScale: drawScale,
      pageWidth: base.pageWidth,
      pageHeight: base.pageHeight,
      objects,
      callouts,
    });
    context.drawImage(overlay, 0, 0);
    releaseCanvas(overlay);
  }
  return canvas;
}

/**
 * Encode as WebP; WebKit builds that cannot ENCODE WebP (they hand back a
 * PNG) get JPEG instead so the cache never stores a heavy PNG.
 */
export function encodeThumbnail(canvas) {
  let url = '';
  try { url = canvas.toDataURL('image/webp', 0.8); } catch { url = ''; }
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.82);
  return url;
}

/**
 * Open a PDF over HTTP range requests so a thumbnail of a 25MB drawing costs
 * only the bytes page 1 needs, not the whole file.
 *
 * Supabase Storage honours `Range` on signed URLs (206) but does not expose
 * Content-Range to scripts, so pdf.js cannot discover range support by itself
 * and would download everything. We drive pdf.js's own PDFDataRangeTransport
 * instead: the length comes from a HEAD (Content-Length is always readable),
 * and each chunk pdf.js asks for is one ranged GET. `maxBytes` caps the total;
 * past it the load is destroyed and `stats.tooLarge` is set.
 */
export async function openRangedPdf({ pdfjsLib, url, maxBytes, fetchImpl = fetch, rangeChunkSize = 256 * 1024 }) {
  const head = await fetchImpl(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`thumbnail HEAD failed (${head.status})`);
  const length = Number(head.headers.get('content-length')) || 0;
  if (!length) throw new Error('thumbnail source has no length');
  const stats = { bytes: 0, requestedBytes: 0, requests: 1, length, tooLarge: false };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let loadingTask = null;
  /* pdf.js does not reliably settle a pending getPage()/render() when its
     range transport gives up, so callers race their work against this. */
  let fail;
  const aborted = new Promise((_, reject) => { fail = reject; });
  aborted.catch(() => {});
  const giveUp = (error) => {
    fail(error);
    controller?.abort();
    void loadingTask?.destroy().catch(() => {});
  };

  class RangedTransport extends pdfjsLib.PDFDataRangeTransport {
    requestDataRange(begin, end) {
      // Budget against bytes ASKED for, so parallel in-flight chunks count.
      if (stats.requestedBytes + (end - begin) > maxBytes) {
        stats.tooLarge = true;
        const error = new Error('page 1 needs more bytes than the thumbnail budget');
        error.code = 'THUMB_TOO_LARGE';
        giveUp(error);
        return;
      }
      stats.requests += 1;
      stats.requestedBytes += end - begin;
      fetchImpl(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal: controller?.signal })
        .then((response) => {
          if (response.status !== 206 && response.status !== 200) throw new Error(`range ${response.status}`);
          return response.arrayBuffer().then((buffer) => {
            // A server that ignores Range sends the whole file (200). Slice so
            // pdf.js still gets exactly what it asked for.
            const chunk = response.status === 200 ? buffer.slice(begin, end) : buffer;
            stats.bytes += buffer.byteLength;
            this.onDataRange(begin, new Uint8Array(chunk));
          });
        })
        .catch((error) => giveUp(error instanceof Error ? error : new Error(String(error))));
    }
    abort() { controller?.abort(); }
  }

  const transport = new RangedTransport(length, null);
  loadingTask = pdfjsLib.getDocument({
    range: transport,
    length,
    rangeChunkSize,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  return { loadingTask, stats, aborted };
}
