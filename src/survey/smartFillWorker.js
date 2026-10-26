/**
 * smartFillWorker.js — runs the Smart fill engine off the main thread so a
 * tap never freezes scrolling or drawing (owner 2026-10-20, beta).
 * In:  { id, rgba: ArrayBuffer, width, height, seedX, seedY, templates, pxPerUnit }  (one tap)
 *  or  { id, kind: 'scan', rgba, width, height, samples, templates, pxPerUnit }     (whole page)
 * `templates` are the tag shapes the user taught (smartFillTemplates.js).
 * Out: { id, result } — the engine's { ok, ring, ... } or { ok:false, reason }.
 */
import { adaptiveInkMaskFromRgba, findSimilarTags } from './smartFillEngine.js';
import { findOutlineWithTemplates } from './smartFillTemplates.js';

self.onmessage = (event) => {
  const { id, kind, rgba, width, height, seedX, seedY, samples, sample, templates, pxPerUnit } = event.data || {};
  let result;
  try {
    const mask = adaptiveInkMaskFromRgba(new Uint8ClampedArray(rgba), width, height);
    result = kind === 'scan'
      ? { ok: true, rings: findSimilarTags(mask, width, height, samples || sample, { templates, pxPerUnit, outlineAt: findOutlineWithTemplates }) }
      : findOutlineWithTemplates(mask, width, height, seedX, seedY, templates, pxPerUnit);
  } catch (error) {
    result = { ok: false, reason: 'error', message: String(error?.message || error) };
  }
  self.postMessage({ id, result });
};
