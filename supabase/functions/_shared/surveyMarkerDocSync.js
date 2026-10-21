// Survey-marker storage in an annotation Y.Doc, shared by the app
// (src/services/annotationDocStore.js re-exports it) and edge functions.
// Plain JS with NO imports — it only calls methods on the Y.Doc it is handed —
// so Deno, Vite and node tests all load the same file. Mirrors
// surveyAgentSpec.js / annotationAgentSpec.js.
//
// Survey markers are NOT Fabric objects and do NOT live in annotationsByPage —
// they are flat bounding-box + metadata records held in a document-level dict
// { [annotationId]: marker }. They could be numerous (hundreds+), so they get
// their OWN keyed Y.Map (minimal per-marker diff) rather than a coarse whole-
// dict meta blob — a single placement becomes one small bounded op, never a
// giant re-serialization of every marker.

export const SURVEY_MARKERS_MAP = 'surveyMarkers';

export function getSurveyMarkersMap(doc) {
  return doc.getMap(SURVEY_MARKERS_MAP);
}

/** Materialize the survey-marker dict { [annotationId]: marker } from the Y.Doc. */
export function docToSurveyMarkers(doc) {
  const map = getSurveyMarkersMap(doc);
  const out = {};
  map.forEach((value, key) => { if (value && typeof value === 'object') out[key] = value; });
  return out;
}

/**
 * Reconcile the survey-marker Y.Map to a desired dict. Minimal diff: only
 * changed/new markers are set, only removed ids are deleted, and re-applying
 * identical state produces ZERO Yjs updates. Adds/updates are applied in bounded
 * batches (one transaction per batch) so a bulk seed of N markers becomes
 * several resilient ops, never one giant all-or-nothing write.
 *
 * Stage 0 safety contract:
 *   * `origin: 'excel-import'` makes the reconcile ADDITIVE/patch-only — it may
 *     add or update markers but NEVER deletes a key the imported dict omits. A
 *     flat Excel sheet can't tell "deleted" from "filtered/sorted", and an
 *     un-exported app marker is simply absent from the sheet; deleting it here is
 *     the durable-store corruption bug. Excel-side removals flow through the
 *     explicit (app-origin) tombstone path instead, not this reconcile.
 *   * `protectedIds` (iterable) are never deleted regardless of origin — used to
 *     shield app-created-not-yet-exported markers even on a local reconcile.
 */
export function syncSurveyMarkersToDoc(doc, markers, { origin = 'local', batchSize = 250, protectedIds = null } = {}) {
  const map = getSurveyMarkersMap(doc);
  const desired = markers || {};
  const ids = Object.keys(desired);
  const desiredSet = new Set(ids);
  const protectedSet = protectedIds ? new Set(protectedIds) : null;
  // Excel imports are additive: never delete keys the sheet omits.
  const allowDeletes = origin !== 'excel-import';
  // Clamp batch size so a 0/negative/NaN value can never stall the update loop.
  const step = Math.max(1, Math.floor(batchSize) || 1);

  let added = 0;
  let updated = 0;
  let removed = 0;

  const toDelete = [];
  if (allowDeletes) {
    map.forEach((_value, key) => {
      if (desiredSet.has(key)) return;
      if (protectedSet && protectedSet.has(key)) return;
      toDelete.push(key);
    });
  }
  if (toDelete.length) {
    doc.transact(() => { for (const k of toDelete) { map.delete(k); removed += 1; } }, origin);
  }

  const changed = [];
  for (const id of ids) {
    const next = desired[id];
    const cur = map.get(id);
    if (cur === undefined) changed.push([id, next, true]);
    else if (stableStringify(cur) !== stableStringify(next)) changed.push([id, next, false]);
  }
  for (let i = 0; i < changed.length; i += step) {
    const batch = changed.slice(i, i + step);
    doc.transact(() => {
      for (const [id, next, isAdd] of batch) { map.set(id, next); if (isAdd) added += 1; else updated += 1; }
    }, origin);
  }

  return { added, updated, removed };
}

// Key-order-independent JSON, so a marker read back from Yjs (whose key order
// may differ) compares equal to the same marker built fresh.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
