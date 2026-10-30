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

// A failed open keeps its worker too: a rejected loadingTask.promise does not
// end the task, and the worker (with the bytes it was sent) lives until
// destroy(). Await the document through this so a failure gives it back.
export function pdfOrDestroy(loadingTask) {
  return loadingTask.promise.catch((error) => {
    void Promise.resolve().then(() => loadingTask.destroy()).catch(() => {});
    throw error;
  });
}
