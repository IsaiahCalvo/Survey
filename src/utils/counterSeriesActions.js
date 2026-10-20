import { canModify, getMarkLockedBy } from '../lib/collab/permissionScope.js';

// Whole-count edits must succeed for every pin before any page save/history.
export function checkCounterSeriesEdit(annotationsByPage, seriesId, authority) {
  const pins = Object.values(annotationsByPage || {}).flatMap(page => page?.objects || [])
    .filter(pin => pin?.data?.type === 'counter' && pin.data.seriesId === seriesId);
  if (!pins.length) return { ok: false, reason: 'not-found' };
  if (pins.some(pin => getMarkLockedBy(pin))) return { ok: false, reason: 'locked' };
  if (pins.some(annotation => !canModify({ annotation, ...authority }))) return { ok: false, reason: 'forbidden' };
  return { ok: true };
}
