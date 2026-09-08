import { normalizeCalloutsForSync } from '../utils/calloutSyncPayload.js';

const localIdPattern = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prefixes = ['annotationsByPage_', 'pdfData_', 'surveyMarkers_', 'callouts_', 'pdfSidebar_', 'regionOverlayStates_'];

export function isManagedLocalDocument(file) {
  return !file?.id && file?.storageMode === 'local'
    && typeof file.localId === 'string' && localIdPattern.test(file.localId)
    && file._surveyPdfId === file.localId;
}

// Store exactly the formats existing loaders consume. The durable IndexedDB
// snapshot owns a managed document's saved state; old shared keys are recovery
// data with unknown provenance, not a managed file's hydration transport.
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

export function createLocalDocumentStateReader(file) {
  if (!isManagedLocalDocument(file)) throw new Error('Invalid managed local document');
  const state = file._localDocumentState;
  const keys = prefixes.map(prefix => prefix + file.localId);
  const entries = Object.create(null);
  if (state != null) {
    if (state.version !== 1 || state.pdfId !== file.localId || !state.entries
    || Object.keys(state.entries).length !== keys.length
    || keys.some(key => typeof state.entries[key] !== 'string')) {
      throw new Error('The saved local document state is invalid. Its copy was kept.');
    }
    for (const key of keys) {
      const raw = state.entries[key];
      const parsed = JSON.parse(raw);
      const isCallouts = key === `callouts_${file.localId}`;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== isCallouts) {
        throw new Error('The saved local document state has an invalid entry. Its copy was kept.');
      }
      entries[key] = raw;
    }
  }
  Object.freeze(entries);
  return Object.freeze({
    pdfId: file.localId,
    getItem: key => Object.hasOwn(entries, key) ? entries[key] : null,
  });
}

// Compatibility for callers of the old restore helper: return a private reader
// and never overwrite shared legacy keys, even if a storage argument is passed.
export const restoreLocalDocumentState = file => createLocalDocumentStateReader(file);
