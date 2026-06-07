/**
 * calloutSyncPayload.js — normalizes callouts into a deterministic shape for sync
 * fingerprinting, stripping transient UI fields and rounding numbers.
 *
 * Exports normalizeCalloutForSync / normalizeCalloutsForSync (deep key-sort, drop
 * transient/__-prefixed keys, round numbers, sort callouts by id) and
 * getCalloutSyncFingerprint (stable JSON string for change detection). Used to
 * decide whether callout state actually changed before pushing a sync update.
 * Part of the separate callout pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
const TRANSIENT_KEYS = new Set([
  'isSelected',
  'selected',
  'hovered',
  'isHovered',
  'editing',
  'isEditing',
  'active',
  'dirty',
  'cursor',
  'selectionStart',
  'selectionEnd',
  'selectionDirection',
  '__preview',
  '__transient',
]);

const CALLOUT_NUMBER_PRECISION = 1_000_000;

function sortPlainObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortPlainObject);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const rounded = Math.round(value * CALLOUT_NUMBER_PRECISION) / CALLOUT_NUMBER_PRECISION;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    if (TRANSIENT_KEYS.has(key)) continue;
    if (key.startsWith('__')) continue;
    sorted[key] = sortPlainObject(value[key]);
  }
  return sorted;
}

function normalizeCalloutForSync(callout) {
  if (!callout || typeof callout !== 'object') return callout;
  return sortPlainObject(callout);
}

export function normalizeCalloutsForSync(callouts) {
  if (!Array.isArray(callouts)) return [];
  return callouts
    .map(normalizeCalloutForSync)
    .sort((a, b) => String(a?.id || a?.annotationId || '').localeCompare(String(b?.id || b?.annotationId || '')));
}

export function getCalloutSyncFingerprint(callouts) {
  return JSON.stringify(normalizeCalloutsForSync(callouts));
}
