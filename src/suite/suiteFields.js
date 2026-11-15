// Kal Voe suite fields on a Survey Marker (KAL-588; spec KAL-584).
//
// A tracked device keeps one shared id across Walkthru, Plot and Survey, plus
// its library links and where it is:
//   suiteId            the device's shared id
//   libraryEntryId     its Category's library entry (KAL-585)
//   libraryTypeEntryId its Category Type's library entry, when it has one
//   building, wing, floor, location
// They ride on the live-editing marker record (one Yjs field each, so two
// screens editing different fields merge) and in the row copy's
// annotation_data.suite. Excel never writes them back (importFieldWhitelist.js
// and surveyMarkerDocSync.js refuse a suite id from a workbook).
//
// A marker made in Survey takes its own id as its suite id, so the record
// only stores `suiteId` when it differs (a copy, or a device that came from
// another app). readSuiteId() is the one way to ask. Pure: no React, no Yjs.

export const SUITE_PLACE_FIELDS = Object.freeze(['building', 'wing', 'floor', 'location']);
export const SUITE_LINK_FIELDS = Object.freeze(['libraryEntryId', 'libraryTypeEntryId']);
export const SUITE_MARKER_FIELDS = Object.freeze(['suiteId', ...SUITE_LINK_FIELDS, ...SUITE_PLACE_FIELDS]);

export const SUITE_PLACE_LABELS = Object.freeze({
  building: 'Building',
  wing: 'Wing',
  floor: 'Floor',
  location: 'Location',
});

export const SUITE_FIELD_MAX = 120;

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim().slice(0, SUITE_FIELD_MAX);
  return text || undefined;
}

/** The marker's suite id: its stored one, else its own id. */
export function readSuiteId(marker, annotationId = null) {
  const stored = cleanText(marker?.suiteId);
  if (stored) return stored;
  const own = annotationId ?? marker?.annotationId ?? marker?.id ?? null;
  return own == null ? null : String(own);
}

/** { building, wing, floor, location }, each a string or ''. */
export function readSuitePlaces(marker) {
  const out = {};
  for (const field of SUITE_PLACE_FIELDS) out[field] = cleanText(marker?.[field]) || '';
  return out;
}

/**
 * The marker after a place edit. Returns the same object when nothing
 * changed; an emptied field is removed, not stored as ''.
 */
export function nextSuitePlaces(marker, patch) {
  if (!marker || !patch || typeof patch !== 'object') return marker;
  let next = marker;
  for (const field of SUITE_PLACE_FIELDS) {
    if (!(field in patch)) continue;
    const value = cleanText(patch[field]);
    if ((cleanText(marker[field]) || undefined) === value) continue;
    if (next === marker) next = { ...marker };
    if (value === undefined) delete next[field];
    else next[field] = value;
  }
  return next;
}

/**
 * The suite fields a copy carries: the source's suite id (its own id when it
 * stored none, so the copy still points at the same device), its library
 * links and its places.
 */
export function suiteFieldsForCopy(record, sourceId = null) {
  const out = {};
  const suiteId = readSuiteId(record, sourceId);
  if (suiteId) out.suiteId = suiteId;
  for (const field of [...SUITE_LINK_FIELDS, ...SUITE_PLACE_FIELDS]) {
    const value = cleanText(record?.[field]);
    if (value) out[field] = value;
  }
  return out;
}

/** Only the suite fields the marker stores (for the row copy and copies). */
export function pickStoredSuiteFields(marker) {
  const out = {};
  for (const field of SUITE_MARKER_FIELDS) {
    const value = cleanText(marker?.[field]);
    if (value) out[field] = value;
  }
  return out;
}

/**
 * The row copy's annotation_data.suite: always names the suite id (own id
 * when the marker stored none), so the server side never has to guess.
 * Undefined when there is no id to name.
 */
export function suiteRowData(marker, annotationId) {
  const suiteId = readSuiteId(marker, annotationId);
  if (!suiteId) return undefined;
  return { ...pickStoredSuiteFields(marker), suiteId };
}

/**
 * Local marker fields from a row's annotation_data.suite. The suite id is
 * only kept when it differs from the marker's own id (see above).
 */
export function suiteFieldsFromRow(suite, annotationId) {
  if (!suite || typeof suite !== 'object') return {};
  const out = pickStoredSuiteFields(suite);
  if (out.suiteId && annotationId != null && out.suiteId === String(annotationId)) delete out.suiteId;
  return out;
}
