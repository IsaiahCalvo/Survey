import { normalizeCalloutsForSync } from '../utils/calloutSyncPayload.js';

const localIdPattern = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prefixes = ['annotationsByPage_', 'pdfData_', 'surveyMarkers_', 'callouts_', 'pdfSidebar_', 'regionOverlayStates_'];

export function isManagedLocalDocument(file) {
  return !file?.id && file?.storageMode === 'local'
    && typeof file.localId === 'string' && localIdPattern.test(file.localId)
    && file._surveyPdfId === file.localId;
}

// Store exactly the formats existing loaders consume. The durable IndexedDB
// snapshot, not this localStorage mirror, owns a managed document's saved state.
export function buildLocalDocumentState({ pdfId, annotationsByPage, items, annotations,
  surveyMarkers, callouts, pageNames, bookmarks, spaces, activeSpaceId, pageTransformations,
  regionOverlayDisabled }) {
  if (!localIdPattern.test(pdfId || '')) throw new Error('Invalid local document identity');
  const values = [annotationsByPage || {}, { items: items || {}, annotations: annotations || {} },
    surveyMarkers || {}, normalizeCalloutsForSync(callouts || []),
    { pageNames: pageNames || {}, bookmarks: bookmarks || [], spaces: spaces || [],
      activeSpaceId: activeSpaceId ?? null, pageTransformations: pageTransformations || {} },
    regionOverlayDisabled instanceof Map ? Object.fromEntries(regionOverlayDisabled) : (regionOverlayDisabled || {})];
  const entries = Object.fromEntries(prefixes.map((prefix, i) => [prefix + pdfId, JSON.stringify(values[i])]));
  return { version: 1, pdfId, entries };
}

export function restoreLocalDocumentState(file, storage = globalThis.localStorage) {
  if (!isManagedLocalDocument(file)) throw new Error('Invalid managed local document');
  const state = file._localDocumentState;
  if (state == null) return;
  const keys = prefixes.map(prefix => prefix + file.localId);
  if (state.version !== 1 || state.pdfId !== file.localId || !state.entries
    || Object.keys(state.entries).length !== keys.length
    || keys.some(key => typeof state.entries[key] !== 'string')) {
    throw new Error('The saved local document state is invalid. Its copy was kept.');
  }
  for (const key of keys) JSON.parse(state.entries[key]);
  const before = keys.map(key => storage.getItem(key));
  try {
    keys.forEach(key => storage.setItem(key, state.entries[key]));
    if (keys.some(key => storage.getItem(key) !== state.entries[key])) throw new Error('Local state readback failed');
  } catch (error) {
    keys.forEach((key, i) => {
      try { if (before[i] === null) storage.removeItem(key); else storage.setItem(key, before[i]); } catch { /* Canonical snapshot remains intact. */ }
    });
    throw new Error('Could not load the saved local state. Free device storage and retry; the saved copy was kept.', { cause: error });
  }
}
