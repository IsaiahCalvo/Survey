/*
 * Lazy pdf.js loader + one-time worker configuration.
 *
 * pdfjs-dist (the main library, ~hundreds of KB) used to be imported eagerly by
 * viewerShared.js purely to run `GlobalWorkerOptions.workerSrc = ...` at module
 * load. Because viewerShared, Dashboard and PdfPageThumb are all reachable from
 * the first-paint shell, that dragged pdf.js into the entry chunk even though it
 * is only needed once a user actually opens / uploads a PDF.
 *
 * Call loadPdfjs() right before the first getDocument on each path instead. The
 * dynamic import() lets the bundler split pdf.js into its own chunk, and the
 * promise is memoised so the worker is configured exactly once per session.
 *
 * The live pdf.js viewer engine (PdfjsViewerContainer.jsx) and the PdfjsArm
 * prototype still set workerSrc themselves at module load; the `if (!workerSrc)`
 * guard makes any double-configure a harmless no-op.
 */
let pdfjsPromise;

// Vite emits app modules under assets/; the build plugin emits these owned
// directories alongside them. Dev serves the same directories explicitly.
// Leave useWorkerFetch to PDF.js: its DOM factory uses XHR for native file://,
// whereas HTTP(S) workers can fetch these same-origin resources themselves.
export function getPdfjsDocumentOptions(resourceRoot) {
  const version = typeof __SURVEY_PDFJS_RESOURCE_VERSION__ === 'string' ? __SURVEY_PDFJS_RESOURCE_VERSION__ : 'dev';
  const directory = `${import.meta.env?.DEV ? '/assets/pdfjs/' : './pdfjs/'}${version}/`;
  const root = resourceRoot || new URL(directory, import.meta.url).href;
  return {
    cMapUrl: new URL('cmaps/', root).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', root).href,
    wasmUrl: new URL('wasm/', root).href,
    iccUrl: new URL('iccs/', root).href,
  };
}

export const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { default: pdfWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
      }
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
};
