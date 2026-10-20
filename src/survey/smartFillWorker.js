/**
 * smartFillWorker.js — runs the Smart fill engine off the main thread so a
 * tap never freezes scrolling or drawing (owner 2026-10-20, beta).
 * In:  { id, rgba: ArrayBuffer, width, height, seedX, seedY }  (one tap)
 *  or  { id, kind: 'scan', rgba, width, height, sample }       (whole page)
 * Out: { id, result } — the engine's { ok, ring, ... } or { ok:false, reason }.
 */
import { adaptiveInkMaskFromRgba, findSimilarTags, findTagOutlineTolerant } from './smartFillEngine.js';

self.onmessage = (event) => {
  const { id, kind, rgba, width, height, seedX, seedY, sample } = event.data || {};
  let result;
  try {
    const mask = adaptiveInkMaskFromRgba(new Uint8ClampedArray(rgba), width, height);
    result = kind === 'scan'
      ? { ok: true, rings: findSimilarTags(mask, width, height, sample) }
      : findTagOutlineTolerant(mask, width, height, seedX, seedY);
  } catch (error) {
    result = { ok: false, reason: 'error', message: String(error?.message || error) };
  }
  self.postMessage({ id, result });
};
