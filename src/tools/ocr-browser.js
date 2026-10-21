// OCR PDF, the browser side: draw a page (from its JPEG when it is a plain
// scan, else with pdf.js) and read it with Tesseract. A few Tesseract workers
// read the pages; call close() at the end.
import { renderPage, renderScan, releaseCanvas } from './browser.js';
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
  // The desktop app loads from file://, where "/ocr" is the disk's root; there
  // the data sits next to the app's index.html. The iOS and Android apps serve
  // from capacitor://localhost and https://localhost, so "/ocr" works offline.
  const root = globalThis.location.protocol === 'file:' ? new URL('.', here) : new URL('/', here);
  return {
    workerPath: new URL(workerAsset, here).href,
    corePath: new URL(coreAsset, here).href,
    langPath: new URL('ocr', root).href,
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

// How many pages to read at once. Each reader holds a page picture and
// Tesseract's own memory (a few hundred MB on a big sheet), so phones and
// browsers that don't say how much memory they have read one page at a time.
export function readerCount() {
  const cores = globalThis.navigator?.hardwareConcurrency || 1;
  const memory = globalThis.navigator?.deviceMemory || 0;
  if (memory >= 8) return Math.max(1, Math.min(3, Math.floor(cores / 2)));
  if (memory >= 4) return Math.max(1, Math.min(2, Math.floor(cores / 2)));
  return 1;
}

// A drawn page as a grey PGM file, which Tesseract reads as it is: much
// quicker than the PNG it makes of a canvas, and a quarter of the bytes.
function canvasToPgm(canvas) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const head = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(head.length + width * height);
  out.set(head);
  for (let i = 0, j = 0, o = head.length; i < width * height; i += 1, j += 4) {
    out[o + i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
  }
  return out;
}

// Returns { readPage(index), close() } for one pdf.js document (or a function
// that opens it). `scans` (see scanPages.js) lets plain scanned pages skip
// pdf.js: they are drawn from their JPEGs and have no text to check for.
// Up to `readers` pages are read at once, each by its own Tesseract worker.
export function makePageReader(pdf, { skipText = true, progress = () => {}, scans = [], readers = 1 } = {}) {
  const doc = () => (typeof pdf === 'function' ? pdf() : pdf);
  const idle = [];
  const all = [];
  const waiting = [];
  let made = 0;
  let closed = false;
  const take = async () => {
    if (idle.length) return idle.pop();
    if (made < readers) {
      made += 1;
      if (made === 1) progress('Loading the text reader');
      const w = await startWorker();
      if (closed) { w.terminate().catch(() => {}); throw new ToolError('Stopped.'); }
      all.push(w);
      return w;
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const give = (w) => {
    const next = waiting.shift();
    if (next) next(w); else idle.push(w);
  };
  return {
    async readPage(index) {
      const scan = scans[index];
      if (skipText && !scan) {
        const page = await (await doc()).getPage(index + 1);
        const text = await page.getTextContent().catch(() => null);
        page.cleanup();
        if (hasRealText(text)) return null;
      }
      const w = await take();
      let canvas;
      try {
        if (scan) canvas = await renderScan(scan, { scale: ocrScale(scan.box.width, scan.box.height) });
        if (!canvas) {
          const pdfDoc = await doc();
          const page = await pdfDoc.getPage(index + 1);
          const vp = page.getViewport({ scale: 1, rotation: page.rotate });
          canvas = await renderPage(pdfDoc, index, { scale: ocrScale(vp.width, vp.height) });
        }
        const image = { width: canvas.width, height: canvas.height };
        const pgm = canvasToPgm(canvas);
        releaseCanvas(canvas);
        canvas = null;
        const { data } = await w.recognize(pgm, {}, { blocks: true, text: false });
        return { image, lines: tesseractLines(data) };
      } finally {
        if (canvas) releaseCanvas(canvas);
        give(w);
      }
    },
    async close() {
      closed = true;
      const list = all.splice(0);
      idle.length = 0;
      await Promise.all(list.map((w) => w.terminate().catch(() => {})));
    },
  };
}
