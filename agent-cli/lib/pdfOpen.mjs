// agent-cli/lib/pdfOpen.mjs — headless reproduction of the document-OPEN cost.
//
// Mirrors the binary side of src/PDFViewer.jsx loadPDF (~line 17457):
//   1. download the PDF binary from the `documents` storage bucket
//   2. blob -> arrayBuffer
//   3. pdfjsLib.getDocument({ data: full bytes }) and await .promise
//   4. loop EVERY page: getPage + getViewport({ scale: 1 }) (the page-size pass)
//   5. importAnnotationsFromPdf diagnostics: loop EVERY page calling
//      getAnnotations, plus a pdf-lib PDFDocument.load of the raw bytes (the
//      raw-metadata-by-id pass the importer does up front).
//
// This is the OPEN cost, NOT the annotation-list DB read (that is `open`,
// already fast). The point is to learn which open stage dominates on the
// heaviest real document.
//
// Env note: pdf.js v3.11 ships a Node-runnable LEGACY build, but it is a
// CommonJS/UMD bundle — `import()` returns an empty namespace, so we load it
// with createRequire. The worker is pointed at the legacy worker file (pdf.js
// will fall back to a fake worker in Node either way; both stages still run).

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let pdfjsLib = null;
function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  // Legacy build is the Node-compatible one (no DOM/Worker hard dependency).
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
      'pdfjs-dist/legacy/build/pdf.worker.js',
    );
  } catch {
    // If the worker file can't be resolved, pdf.js uses a fake (in-process)
    // worker in Node. Parsing still works; only marginally slower.
  }
  return pdfjsLib;
}

const round = (n) => Math.round(n);

// One full open pass. Returns per-stage timings in ms plus shape counts.
export async function measureOpen(supabase, filePath, { verbose = false } = {}) {
  const pdfjs = loadPdfjs();
  const { PDFDocument } = await import('pdf-lib');

  // --- stage 1: download the PDF binary from storage ---
  const dl0 = performance.now();
  const { data: blob, error } = await supabase.storage.from('documents').download(filePath);
  if (error) {
    const e = new Error(`storage download failed for "${filePath}": ${error.message}`);
    e.code = 'STORAGE_MISS';
    throw e;
  }
  const downloadMs = performance.now() - dl0;

  // --- stage 2: blob -> arrayBuffer ---
  const ab0 = performance.now();
  const arrayBuffer = await blob.arrayBuffer();
  const blobToArrayBufferMs = performance.now() - ab0;
  const byteLength = arrayBuffer.byteLength;

  // --- stage 3: pdfjsLib.getDocument(full data) ---
  const gd0 = performance.now();
  const loadingTask = pdfjs.getDocument({
    isEvalSupported: false,
    data: arrayBuffer.slice(0),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const pdf = await loadingTask.promise;
  const getDocumentMs = performance.now() - gd0;
  const numPages = pdf.numPages;

  // --- stage 4: all-pages getPage + getViewport({ scale: 1 }) (page sizes) ---
  // The app batches this with a small worker pool; serial here so the number is
  // the raw work, not the concurrency. We report it as the page-size pass cost.
  const ps0 = performance.now();
  for (let i = 1; i <= numPages; i += 1) {
    const page = await pdf.getPage(i);
    page.getViewport({ scale: 1 });
  }
  const pageSizesMs = performance.now() - ps0;

  // --- stage 5a: importAnnotationsFromPdf — all-pages getAnnotations ---
  const ga0 = performance.now();
  let nativeAnnotationCount = 0;
  for (let i = 1; i <= numPages; i += 1) {
    const page = await pdf.getPage(i);
    const annots = await page.getAnnotations();
    nativeAnnotationCount += annots.length;
  }
  const getAnnotationsMs = performance.now() - ga0;

  // --- stage 5b: importAnnotationsFromPdf — pdf-lib raw-bytes parse ---
  // Mirrors buildRawAnnotationMetadataById/readAppLayerStateFromPdf which both
  // do PDFDocument.load(rawPdfBytes, { updateMetadata: false }).
  const pl0 = performance.now();
  const pdfLibDoc = await PDFDocument.load(arrayBuffer.slice(0), { updateMetadata: false });
  const pdfLibPageCount = pdfLibDoc.getPageCount();
  const pdfLibParseMs = performance.now() - pl0;

  try { await pdf.cleanup(); } catch { /* ignore */ }
  try { await loadingTask.destroy(); } catch { /* ignore */ }

  return {
    byteLength,
    numPages,
    pdfLibPageCount,
    nativeAnnotationCount,
    stages: {
      downloadMs: round(downloadMs),
      blobToArrayBufferMs: round(blobToArrayBufferMs),
      getDocumentMs: round(getDocumentMs),
      pageSizesMs: round(pageSizesMs),
      getAnnotationsMs: round(getAnnotationsMs),
      pdfLibParseMs: round(pdfLibParseMs),
    },
    verbose,
  };
}
