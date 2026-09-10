import { normalizeCalloutsForSync } from '../utils/calloutSyncPayload.js';
import { validateManagedLocalEntityCatalog } from './documentEntityCatalog.js';
import { validateManagedLocalSurveyDefinition } from './documentSurveyDefinition.js';

const localIdPattern = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const legacyPrefixes = ['annotationsByPage_', 'pdfData_', 'surveyMarkers_', 'callouts_', 'pdfSidebar_', 'regionOverlayStates_'];
const optionalPrefixes = ['entityCatalog_', 'surveyDefinition_'];
const prefixes = [...legacyPrefixes, ...optionalPrefixes];

function invalidNativeDeletion() {
  throw new Error('The saved local document state has invalid native deletion data. Its copy was kept.');
}

// Only the new deletion field is strict JSON. In particular, stringify must not
// silently drop native identity metadata or invoke a custom toJSON/accessor.
function copyDeletionJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalidNativeDeletion();
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalidNativeDeletion();
  }
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) invalidNativeDeletion();
  ancestors.add(value);
  const copy = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) invalidNativeDeletion();
    Object.defineProperty(copy, key, { value: copyDeletionJson(descriptor.value, ancestors),
      enumerable: true, configurable: true, writable: true });
  }
  ancestors.delete(value);
  return copy;
}

function copyDeletedPdfAnnotations(value) {
  const entries = copyDeletionJson(value);
  if (!Array.isArray(entries)) invalidNativeDeletion();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !Number.isSafeInteger(entry.pageNumber) || entry.pageNumber <= 0
      || typeof entry.pdfAnnotationId !== 'string' || !entry.pdfAnnotationId.trim()
      || (entry.pdfAnnotationType != null && typeof entry.pdfAnnotationType !== 'string')
      || (entry.pdfNativeAnnotationIdentity != null && (typeof entry.pdfNativeAnnotationIdentity !== 'object'
        || Array.isArray(entry.pdfNativeAnnotationIdentity)))) invalidNativeDeletion();
  }
  // Keep the complete native fingerprint and any JSON metadata verbatim. This
  // storage boundary checks shape, not whether the PDF exporter can match it.
  return entries;
}

export function isManagedLocalDocument(file) {
  return !file?.id && file?.storageMode === 'local'
    && typeof file.localId === 'string' && localIdPattern.test(file.localId)
    && file._surveyPdfId === file.localId;
}

// Store exactly the formats existing loaders consume. The durable IndexedDB
// snapshot owns a managed document's saved state; old shared keys are recovery
// data with unknown provenance, not a managed file's hydration transport.
export function buildLocalDocumentState({ pdfId, annotationsByPage, items, annotations, deletedPdfAnnotations,
  surveyMarkers, callouts, pageNames, bookmarks, spaces, activeSpaceId, pageTransformations,
  regionOverlayDisabled, entityCatalog = null, surveyDefinition = null }) {
  if (!localIdPattern.test(pdfId || '')) throw new Error('Invalid local document identity');
  const values = [annotationsByPage || {}, { items: items || {}, annotations: annotations || {},
    ...(deletedPdfAnnotations === undefined ? {} : { deletedPdfAnnotations: copyDeletedPdfAnnotations(deletedPdfAnnotations) }) },
    surveyMarkers || {}, normalizeCalloutsForSync(callouts || []),
    { pageNames: pageNames || {}, bookmarks: bookmarks || [], spaces: spaces || [],
      activeSpaceId: activeSpaceId ?? null, pageTransformations: pageTransformations || {} },
    regionOverlayDisabled instanceof Map ? Object.fromEntries(regionOverlayDisabled) : (regionOverlayDisabled || {})];
  const entries = Object.fromEntries(legacyPrefixes.map((prefix, i) => [prefix + pdfId, JSON.stringify(values[i])]));
  if (entityCatalog != null) {
    entries[`entityCatalog_${pdfId}`] = JSON.stringify(validateManagedLocalEntityCatalog(entityCatalog, pdfId));
  }
  if (surveyDefinition != null) {
    entries[`surveyDefinition_${pdfId}`] = JSON.stringify(validateManagedLocalSurveyDefinition(surveyDefinition, pdfId));
  }
  return { version: 1, pdfId, entries };
}

export function rebindManagedLocalEntityCatalog(value, sourceId, targetId) {
  if (!localIdPattern.test(sourceId || '') || !localIdPattern.test(targetId || '')) {
    throw new Error('Valid source and target local document identities are required');
  }
  const source = validateManagedLocalEntityCatalog(value, sourceId);
  return validateManagedLocalEntityCatalog({ ...source, documentId: targetId }, targetId);
}

export function rebindManagedLocalSurveyDefinition(value, sourceId, targetId) {
  if (!localIdPattern.test(sourceId || '') || !localIdPattern.test(targetId || '')) {
    throw new Error('Valid source and target local document identities are required');
  }
  const source = validateManagedLocalSurveyDefinition(value, sourceId);
  return validateManagedLocalSurveyDefinition({ ...source, documentId: targetId }, targetId);
}

export function createLocalDocumentStateReader(file) {
  if (!isManagedLocalDocument(file)) throw new Error('Invalid managed local document');
  const state = file._localDocumentState;
  const keys = prefixes.map(prefix => prefix + file.localId);
  const legacyKeys = legacyPrefixes.map(prefix => prefix + file.localId);
  const allowedKeys = new Set(keys);
  const entries = Object.create(null);
  if (state != null) {
    const stateEntriesArePlain = state.entries !== null && typeof state.entries === 'object'
      && !Array.isArray(state.entries)
      && [Object.prototype, null].includes(Object.getPrototypeOf(state.entries));
    const entryKeys = stateEntriesArePlain
      ? Object.keys(state.entries) : [];
    if (state.version !== 1 || state.pdfId !== file.localId || !state.entries
    || !stateEntriesArePlain
    || entryKeys.some(key => !allowedKeys.has(key))
    || legacyKeys.some(key => !Object.hasOwn(state.entries, key)
      || typeof state.entries[key] !== 'string')
    || optionalPrefixes.some(prefix => {
      const key = prefix + file.localId;
      return Object.hasOwn(state.entries, key) && typeof state.entries[key] !== 'string';
    })) {
      throw new Error('The saved local document state is invalid. Its copy was kept.');
    }
    for (const key of keys) {
      if (!Object.hasOwn(state.entries, key)) continue;
      const raw = state.entries[key];
      const parsed = JSON.parse(raw);
      const isCallouts = key === `callouts_${file.localId}`;
      const isCatalog = key === `entityCatalog_${file.localId}`;
      const isSurveyDefinition = key === `surveyDefinition_${file.localId}`;
      if ((!isCatalog && !isSurveyDefinition
          && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== isCallouts))
        || (isCatalog && !validateManagedLocalEntityCatalog(parsed, file.localId))
        || (isSurveyDefinition && !validateManagedLocalSurveyDefinition(parsed, file.localId))) {
        throw new Error('The saved local document state has an invalid entry. Its copy was kept.');
      }
      if (key === `pdfData_${file.localId}` && Object.hasOwn(parsed, 'deletedPdfAnnotations')) {
        copyDeletedPdfAnnotations(parsed.deletedPdfAnnotations);
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
