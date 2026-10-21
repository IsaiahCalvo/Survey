// OCR PDF, the browser side: render a page with pdf.js and read it with
// Tesseract. One Tesseract worker reads every page; call close() at the end.
import { renderPage, releaseCanvas } from './browser.js';
import { ToolError } from './errors.js';
import { hasRealText, ocrScale, tesseractLines } from './ocr.js';

// Tesseract's worker, its wasm core and the English data all come from our
// own site. The language path must be absolute: on /tools/ocr-pdf a relative
// "ocr" would point at /tools/ocr, which the server answers with a web page.
async function ocrAssets() {
  const [{ default: workerAsset }, { default: coreAsset }] = await Promise.all([
    import('tesseract.js/dist/worker.min.js?url'),
    import('tesseract.js-core/tesseract-core-lstm.wasm.js?url'),
  ]);
  const here = globalThis.location.href;
  return {
    workerPath: new URL(workerAsset, here).href,
    corePath: new URL(coreAsset, here).href,
    langPath: new URL('/ocr', here).href,
  };
}

async function startWorker() {
  try {
    const [mod, assets] = await Promise.all([import('tesseract.js'), ocrAssets()]);
    const api = mod.createWorker ? mod : mod.default;
    return await api.createWorker('eng', api.OEM?.LSTM_ONLY ?? 1, {
      ...assets,
      // Tesseract also rejects the promise; this stops it throwing twice.
      errorHandler: () => {},
    });
  } catch {
    throw new ToolError('The text reader couldn\'t load. Check your connection and try again.');
  }
}

// Returns { readPage(index), close() } for one pdf.js document.
export function makePageReader(pdf, { skipText = true, progress = () => {} } = {}) {
  let worker = null;
  const ensureWorker = async (index) => {
    if (!worker) {
      progress('Loading the text reader');
      worker = await startWorker();
      progress(`Page ${index + 1} of ${pdf.numPages}`);
    }
    return worker;
  };
  return {
    async readPage(index) {
      if (skipText) {
        const page = await pdf.getPage(index + 1);
        const text = await page.getTextContent().catch(() => null);
        page.cleanup();
        if (hasRealText(text)) return null;
      }
      const w = await ensureWorker(index);
      const page = await pdf.getPage(index + 1);
      const vp = page.getViewport({ scale: 1, rotation: page.rotate });
      const canvas = await renderPage(pdf, index, { scale: ocrScale(vp.width, vp.height) });
      try {
        const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
        return { image: { width: canvas.width, height: canvas.height }, lines: tesseractLines(data) };
      } finally {
        releaseCanvas(canvas);
      }
    },
    async close() {
      const w = worker;
      worker = null;
      if (w) await w.terminate().catch(() => {});
    },
  };
}
