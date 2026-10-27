// Close a pdf.js document and give back its worker.
//
// pdf.js 6 has no PDFDocumentProxy#destroy(): the loading task owns the
// document's worker. A `pdf.destroy()` call throws a TypeError, and every
// such call sat in a try/catch, so a closed document silently kept its own
// worker thread (one per getDocument, no shared workerPort) and everything
// that worker had parsed.
//
// A page view (utils/pageViewDocument.js) never owns the worker document,
// and its `loadingTask` is the base document's, so it is left alone.
// Never rejects; destroying twice is harmless.
import { isPageViewDocument } from './pageViewDocument.js';

export function destroyPdfDocument(doc) {
  if (!doc || isPageViewDocument(doc)) return Promise.resolve();
  try {
    const task = doc.loadingTask;
    if (!task || typeof task.destroy !== 'function') return Promise.resolve();
    return Promise.resolve(task.destroy()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}
