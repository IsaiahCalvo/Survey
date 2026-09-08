import { getPdfjsDocumentOptions } from '../utils/pdfWorkerConfig.js';

// Hashing already requires one full read. Own those bytes before awaiting the
// hash so uploads, page counts and the viewer cannot reread a changed disk File.
export async function preparePdfUpload(file, { readBlobAsArrayBuffer, computeContentSha256 }) {
  const name = file.name; const type = file.type; const lastModified = file.lastModified; const userId = file.user_id;
  // Keep the existing FileReader/Response compatibility path, but give it a
  // native Blob without caller-supplied File read/slice overrides.
  const source = Blob.prototype.slice.call(file, 0, undefined, type);
  const bytes = await readBlobAsArrayBuffer(source);
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== source.size) throw new Error('File reader returned mismatched PDF bytes');
  const ownedFile = new File([bytes], name, { type, lastModified });
  if (userId !== undefined) ownedFile.user_id = userId;
  const contentSha = await computeContentSha256(new Uint8Array(bytes));
  return { file: ownedFile, contentSha };
}

const probeError = (code, message) => Object.assign(new Error(message), { code });
function waitForProbe(action, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', aborted); callback(value);
    };
    const aborted = () => finish(reject, signal.reason);
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return action();
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
async function releaseProbeTask(task, timeoutMs) {
  if (!task) return true;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => task.destroy()).then(() => true, () => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

// Optional metadata must not hold upload locks forever. One deadline covers
// reading, loading and both parse attempts; cleanup has a short separate bound.
// A probe owns its worker, never a viewer/shared worker or global worker port.
export async function readPdfPageCount(file, { readBlobAsArrayBuffer, loadPdfjs,
  signal, timeoutMs = 15_000, cleanupTimeoutMs = 1_000 }) {
  for (const value of [timeoutMs, cleanupTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 300_000) throw new RangeError('Invalid PDF page-count deadline');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(probeError('PDF_PAGE_COUNT_ABORTED', 'PDF page-count probe was canceled.'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(probeError('PDF_PAGE_COUNT_TIMEOUT', 'PDF page-count probe timed out.')), timeoutMs);
  const current = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  const wait = action => waitForProbe(action, controller.signal);
  try {
    const arrayBuffer = await wait(() => readBlobAsArrayBuffer(file));
    const pdfjsLib = await wait(loadPdfjs);
    for (let attempt = 0; attempt < 2; attempt++) {
      current();
      let task, worker, nativeWorker, workerUrl, count, failure, released = true;
      const workerFailed = () => controller.abort(probeError('PDF_PAGE_COUNT_WORKER_FAILED', 'PDF page-count worker failed.'));
      try {
        if (typeof pdfjsLib.PDFWorker === 'function') {
          if (typeof globalThis.Worker === 'function') {
            let source = pdfjsLib.GlobalWorkerOptions.workerSrc;
            // Match PDF.js's module wrapper for file:// and cross-origin URLs,
            // but own both the URL and native worker from the instant of creation.
            const base = new URL(globalThis.location.href);
            const resolved = new URL(source, base);
            if (base.origin === 'null' || resolved.origin !== base.origin) {
              workerUrl = URL.createObjectURL(new Blob([`await import(${JSON.stringify(resolved.href)});`], { type: 'text/javascript' }));
              source = workerUrl;
            }
            nativeWorker = new globalThis.Worker(source, { type: 'module', name: 'survey-page-count' });
            nativeWorker.addEventListener('error', workerFailed);
            nativeWorker.addEventListener('messageerror', workerFailed);
          } else if (typeof window !== 'undefined') {
            // Page count is optional. Do not run an unbounded parser on the UI
            // thread when this browser cannot provide an owned worker.
            throw probeError('PDF_PAGE_COUNT_WORKER_UNAVAILABLE', 'PDF page-count worker is unavailable.');
          }
          worker = new pdfjsLib.PDFWorker({ name: 'survey-page-count', verbosity: pdfjsLib.VerbosityLevel.ERRORS,
            ...(nativeWorker ? { port: nativeWorker } : {}) });
          // Initialization can reject after cancellation or a synchronous
          // getDocument failure. Keep that late rejection observed.
          worker.promise?.catch(() => {});
        }
        task = pdfjsLib.getDocument({
          ...getPdfjsDocumentOptions(),
          isEvalSupported: false,
          // A failed parse may have transferred/detached its input already.
          data: arrayBuffer.slice(0),
          verbosity: pdfjsLib.VerbosityLevel.ERRORS,
          ...(worker ? { worker } : {}),
          ...(attempt ? { stopAtErrors: false, disableAutoFetch: true, disableStream: true } : {}),
        });
        const document = await wait(() => task.promise);
        count = document.numPages;
      } catch (error) { failure = error; }
      finally {
        released = await releaseProbeTask(task, cleanupTimeoutMs);
        // LoadingTask.destroy can stall before teardown; PDFWorker.destroy
        // cannot terminate a caller-owned port (or its own stalled handshake).
        try { worker?.destroy(); } catch { /* Never substitute a viewer worker. */ }
        nativeWorker?.removeEventListener('error', workerFailed);
        nativeWorker?.removeEventListener('messageerror', workerFailed);
        try { nativeWorker?.terminate(); } catch { /* Keep the original parse result. */ }
        if (workerUrl) URL.revokeObjectURL(workerUrl);
      }
      current();
      if (!failure) return count;
      if (!released || attempt === 1) throw failure;
    }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

// Results follow Promise.allSettled order while only three file jobs run.
export async function mapUploadsBounded(entries, worker) {
  const results = new Array(entries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
    while (next < entries.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(entries[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }));
  return results;
}
