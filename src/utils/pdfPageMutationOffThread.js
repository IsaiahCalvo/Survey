// Runs mutatePdfPagesBatch in a Web Worker when one is available, falling back
// to the main thread (tests, very old WebViews, a worker that fails to start).
// The operation result is identical either way.

let worker = null;
let workerBroken = false;
let nextRequestId = 1;
const pending = new Map();

function getWorker() {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/pdfPageMutationWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data?.requestId);
      if (!entry) return;
      pending.delete(data.requestId);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.bytes);
    };
    worker.onerror = (event) => {
      // A worker that cannot load (CSP, old WebView) is retired; callers
      // retry on the main thread.
      workerBroken = true;
      try { worker.terminate(); } catch { /* noop */ }
      worker = null;
      const error = new Error(event?.message || 'PDF page worker failed');
      error.workerUnavailable = true;
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

async function onMainThread(bytes, operations) {
  const { mutatePdfPagesBatch } = await import('./pdfPageMutation.js');
  return mutatePdfPagesBatch(bytes, operations);
}

// `readBytes` is called for the bytes each attempt needs (the buffer handed
// to the worker is transferred, so a main-thread retry reads it again).
export async function mutatePdfPagesOffThread(readBytes, operations) {
  const target = getWorker();
  if (!target) return onMainThread(await readBytes(), operations);
  const input = await readBytes();
  const bytes = input instanceof ArrayBuffer ? input : input.buffer.slice(0);
  try {
    return await new Promise((resolve, reject) => {
      const requestId = nextRequestId;
      nextRequestId += 1;
      pending.set(requestId, { resolve, reject });
      target.postMessage({ requestId, bytes, operations }, [bytes]);
    });
  } catch (error) {
    if (!error?.workerUnavailable) throw error;
    return onMainThread(await readBytes(), operations);
  }
}
