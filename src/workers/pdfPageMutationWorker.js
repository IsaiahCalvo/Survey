// Rewrites PDF bytes for Pages-panel operations off the main thread, so the
// pdf-lib parse + deflate never competes with the UI right after a tap
// (owner 2026-10-01: page operations must feel instant on the phone).
import { mutatePdfPagesBatch } from '../utils/pdfPageMutation.js';

self.onmessage = async ({ data }) => {
  const { requestId, bytes, operations } = data || {};
  try {
    const result = await mutatePdfPagesBatch(bytes, operations);
    const out = result instanceof Uint8Array ? result : new Uint8Array(result);
    self.postMessage({ requestId, bytes: out }, [out.buffer]);
  } catch (error) {
    self.postMessage({ requestId, error: String(error?.message || error) });
  }
};
