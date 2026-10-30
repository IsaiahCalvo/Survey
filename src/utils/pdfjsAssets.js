// pdf.js 5+ decodes JPEG 2000 and JBIG2 images (scanned drawings) with
// WebAssembly it fetches from `wasmUrl`, and draws the 14 standard fonts a PDF
// does not embed from `standardFontDataUrl`. With neither set, those images
// are simply left out of the page and unembedded text can vanish where the
// device lacks the font (Android). launch audit 2026-10-30.
//
// The files are emitted next to the pdf.js worker by
// scripts/vite-pdfjs-assets.mjs as assets/pdfjs-<version>/{wasm,standard_fonts,
// cmaps,iccs}/ (the version in the path keeps the year-long asset cache honest
// across pdf.js upgrades). The dev server serves them straight from the package.
// Resolving against the worker URL works for the web, Electron (file://) and
// the Capacitor apps alike.

/**
 * getDocument options that point pdf.js at its own asset folders. Spread into
 * every getDocument call. Empty when the worker URL is not known yet.
 * @param {{ GlobalWorkerOptions?: { workerSrc?: string }, version?: string }} pdfjsLib
 */
export function pdfjsAssetOptions(pdfjsLib, baseHref = globalThis.location?.href) {
  const workerSrc = pdfjsLib?.GlobalWorkerOptions?.workerSrc;
  if (!workerSrc || typeof workerSrc !== 'string') return {};
  let worker;
  try {
    worker = new URL(workerSrc, baseHref);
  } catch {
    return {};
  }
  const root = /\/node_modules\/pdfjs-dist\//.test(worker.pathname)
    ? new URL('../../', worker)
    : new URL(`pdfjs-${pdfjsLib.version || 'dist'}/`, worker);
  const at = (dir) => new URL(`${dir}/`, root).href;
  return {
    wasmUrl: at('wasm'),
    standardFontDataUrl: at('standard_fonts'),
    cMapUrl: at('cmaps'),
    cMapPacked: true,
    iccUrl: at('iccs'),
  };
}
