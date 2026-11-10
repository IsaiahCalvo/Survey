// Draws page previews (small thumbnails) off the main thread.
//
// Why (2026-11-09): on heavy drawing sets a page preview cost as much as the
// full page draw (most of a draw is parsing and stroking every line, not
// filling pixels: se011 sheet 8 took ~2.2 s at 256 px and at 2400 px alike),
// and the viewer drew previews one at a time on the main thread, in the same
// line as the pages on screen. Right after opening a 99-sheet set, pages
// scrolled into view stayed white for ~3 s. Here pdf.js parses and paints on
// this worker's own thread (its "fake worker" runs the parser in-thread), into
// an OffscreenCanvas, so previews come in beside the page draws.
//
// Messages in:
//   { type: 'open', bytes, workerSrc, options }   options: getDocument assets
//   { type: 'thumb', id, pageNumber, scale, rotation }
//   { type: 'close' }
// Messages out:
//   { type: 'opened', numPages } | { type: 'open-failed', message }
//   { type: 'thumb', id, bitmap, blob } | { type: 'thumb-failed', id, message }
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdf.js's own factories create DOM canvases and SVG filters, which a worker
// does not have.
class OffscreenCanvasFactory {
  constructor() { /* pdf.js passes { enableHWA }; nothing to keep */ }

  create(width, height) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }

  reset(entry, width, height) {
    if (!entry?.canvas) throw new Error('Canvas is not specified');
    entry.canvas.width = width;
    entry.canvas.height = height;
  }

  destroy(entry) {
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    if (entry) {
      entry.canvas = null;
      entry.context = null;
    }
  }
}

// Transfer-function filters (rare in drawings) are skipped in a preview.
class NoFilterFactory {
  addFilter() { return 'none'; }
  addHCMFilter() { return 'none'; }
  addAlphaFilter() { return 'none'; }
  addLuminosityFilter() { return 'none'; }
  addKnockoutFilter() { return 'none'; }
  addHighlightHCMFilter() { return 'none'; }
  addSelectionHCMFilter() { return 'none'; }
  addSelectionFilter() { return 'none'; }
  createSelectionStyle() { return null; }
  destroy() { /* nothing kept */ }
}

let task = null;
let doc = null;

async function close() {
  const closing = task;
  task = null;
  doc = null;
  try { await closing?.destroy?.(); } catch { /* already gone */ }
}

async function encode(canvas) {
  // WebP where the browser can write it (PNG otherwise): kept on the device.
  try {
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  } catch {
    return null;
  }
}

self.onmessage = async ({ data }) => {
  const message = data || {};
  if (message.type === 'open') {
    try {
      await close();
      pdfjsLib.GlobalWorkerOptions.workerSrc = message.workerSrc;
      task = pdfjsLib.getDocument({
        ...(message.options || {}),
        data: message.bytes,
        isEvalSupported: false,
        // Glyphs are drawn as paths: a worker has no document.fonts.
        disableFontFace: true,
        // Fonts, CMaps and image decoders are fetched by the parser itself
        // (from the absolute asset URLs): the page-side fetch reads
        // document.baseURI, which a worker does not have.
        useWorkerFetch: true,
        CanvasFactory: OffscreenCanvasFactory,
        FilterFactory: NoFilterFactory,
        verbosity: pdfjsLib.VerbosityLevel?.ERRORS,
      });
      doc = await task.promise;
      self.postMessage({ type: 'opened', numPages: doc.numPages });
    } catch (error) {
      await close();
      self.postMessage({ type: 'open-failed', message: String(error?.message || error) });
    }
    return;
  }
  if (message.type === 'thumb') {
    const { id } = message;
    try {
      if (!doc) throw new Error('No document');
      const page = await doc.getPage(message.pageNumber);
      const rotation = (((page.rotate || 0) + (Number(message.rotation) || 0)) % 360 + 360) % 360;
      const viewport = page.getViewport({ scale: message.scale, rotation });
      const canvas = new OffscreenCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
      await page.render({
        canvasContext: canvas.getContext('2d', { alpha: false }),
        canvas,
        viewport,
        annotationMode: pdfjsLib.AnnotationMode.DISABLE,
      }).promise;
      page.cleanup?.();
      const blob = await encode(canvas);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ type: 'thumb', id, bitmap, blob }, [bitmap]);
    } catch (error) {
      self.postMessage({ type: 'thumb-failed', id, message: String(error?.message || error) });
    }
    return;
  }
  if (message.type === 'close') {
    await close();
  }
};
