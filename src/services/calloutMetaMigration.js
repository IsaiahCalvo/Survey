// src/services/calloutMetaMigration.js
//
// Callout-unification Slice 6 (2026-07-17) — one-time migration of the legacy
// coarse `calloutsList` META blob into per-annotation entries in the flat
// `annotations` Y.Map.
//
// History: callouts were the odd-one-out — every other annotation type persisted
// per-id in the `annotations` Y.Map (annotationDocStore.syncByPageToDoc), while
// callouts rode a whole-list document-level META value ('calloutsList'). Slice 6
// removes that fork: projected callout groups (data.type==='callout', carrying
// their verbatim data.legacyCallout payload) now sync per-id like everything
// else. This module is the bridge for EXISTING docs authored under the old
// contract.
//
// Contract (idempotent — safe to run on every writable open):
//   1. Meta missing / null / empty [] / non-array → ZERO Y.Doc ops. Old builds
//      wrote `calloutsList: []` on virtually every doc, so tombstoning stale
//      empties would turn every legacy open into a write (viewer-tier clients
//      would spam RLS-rejected annotation_updates INSERTs). A stale [] is
//      harmless: nothing live reads the key outside this module.
//   2. Meta is a non-empty array → in ONE atomic transaction:
//        a. write a per-id `annotations`-map entry for every meta callout whose
//           id is ABSENT from the map (ids already present are authoritative —
//           the map may carry NEWER edits than the stale blob; this also covers
//           the crash-prefix case where a previous migration wrote some pages
//           and died before the tombstone);
//        b. VERIFY from the map itself that every meta entry now has a matching
//           callout entry, and only then tombstone the meta to null. Entries
//           that cannot be verified (no id, id collides with a non-callout
//           object, unusable pageNumber, projection threw) BLOCK the tombstone:
//           the meta stays intact as the recovery copy and the failure is
//           logged loudly. Never trade the durable copy for a hope.
//
// Tombstone = meta['calloutsList'] = null: a null meta reads as "migrated"
// (Array.isArray(null) is false for any legacy reader), and setMetaValue's
// JSON-compare bail makes every subsequent open a true no-op.
//
// Atomicity: map writes + verification + tombstone all run inside ONE
// doc.transact(origin), so the whole migration is a single Yjs update — a crash
// can never land the tombstone without the map entries. (setMetaValue's inner
// doc.transact nests fine: Yjs runs a nested transact inline inside the open
// transaction and keeps the OUTER origin, which is the same 'local' here.)
//
// Write capability: this function WRITES. The caller (useAnnotationDoc) must
// only invoke it when the client can actually persist ops — annotation_updates
// INSERT is RLS-gated to editors, so a viewer-tier run would put the sync layer
// into a permanent error state. Viewer-tier clients use the read-only
// getUnmigratedMetaCallouts() below instead (zero ops, local render fallback).
//
// Accepted residuals (reviewed 2026-07-17):
//   * Mixed-version fleets: an old build that still WRITES the meta blob can
//     re-create 'calloutsList' after a new build tombstoned it, and the two
//     builds will fight over it. Accepted: the app is unpublished and ships as
//     a single dist to all four runtimes, so no mixed fleet exists in practice.
//   * Locked-document eager-snapshot write hole: when a durable op append fails
//     (e.g. a doc locked/denied server-side), annotationDocSync's BL-24 path
//     eagerly force-writes a full snapshot (enqueueAppend → writeSnapshot).
//     That hole is PRE-EXISTING sync-layer behavior, not introduced here — the
//     migration merely became one more op source that can exercise it. The
//     viewer-role gate above removes the biggest trigger (read-only opens).
//
// Pure Node-safe module: imports only the pure store + the pure callout bridge,
// so the whole migration is provable in node --test without a DOM.

import {
  getAnnotationsMap,
  getMetaValue,
  setMetaValue,
  writeAnnotationMark,
} from './annotationDocStore.js';
import { decodeAnnotationEntry } from './annotationMarkStore.js';
import { calloutToAnnotationObject } from '../utils/calloutAnnotationBridge.js';

export const CALLOUTS_META_KEY = 'calloutsList';

// Mirrors projectCalloutsIntoByPage's unmeasured-page fallback: pixel geometry
// is a projection detail — data.legacyCallout keeps the exact normalized
// fractions and the viewer re-projects the children the moment real dims land.
const FALLBACK_PAGE_SIZE = { width: 612, height: 792 };

// Same id normalization as annotationDocStore.extractAnnotationId (which is
// what keys the map when the capture path persists a projected callout group):
// non-empty string, or a number stringified. Anything else is "no usable id".
function metaEntryId(entry) {
  const id = entry && typeof entry === 'object' ? entry.id : undefined;
  return (typeof id === 'string' && id) || (typeof id === 'number' ? String(id) : null);
}

// Store v2 marks are nested maps; decodeAnnotationEntry reads either layout.
function isCalloutMapEntry(entry) {
  const decoded = decodeAnnotationEntry(entry);
  return !!(decoded?.o?.data && decoded.o.data.type === 'callout');
}

function countCalloutMapEntries(map) {
  let n = 0;
  map.forEach((entry) => { if (isCalloutMapEntry(entry)) n += 1; });
  return n;
}

/**
 * READ-ONLY companion for clients that must not write (viewer role, or role not
 * yet resolved): returns the legacy meta callouts that are NOT yet represented
 * in the annotations map, so the caller can project them into the local render
 * state. Performs ZERO Y.Doc operations.
 *
 * @param {import('yjs').Doc} doc
 * @returns {{ callouts: Array<object>, ids: string[] }} `ids` are the map-key-
 *   normalized ids of the returned entries (id-less entries appear in
 *   `callouts` — they render — but have no entry in `ids`).
 */
export function getUnmigratedMetaCallouts(doc) {
  if (!doc) return { callouts: [], ids: [] };
  const meta = getMetaValue(doc, CALLOUTS_META_KEY);
  if (!Array.isArray(meta) || meta.length === 0) return { callouts: [], ids: [] };
  const map = getAnnotationsMap(doc);
  const mapCalloutIds = new Set();
  map.forEach((entry, key) => { if (isCalloutMapEntry(entry)) mapCalloutIds.add(key); });

  const callouts = [];
  const ids = [];
  const seen = new Set();
  for (const entry of meta) {
    if (!entry || typeof entry !== 'object') continue;
    const id = metaEntryId(entry);
    if (id != null) {
      if (seen.has(id) || mapCalloutIds.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    // Normalize pageNumber to the coerced number (same as the migration write
    // path below) so a fallback projection and a later durable migration
    // produce byte-identical payloads — otherwise the first post-migration
    // capture would emit a churn op for every string-page callout.
    const page = Number(entry.pageNumber);
    callouts.push(
      typeof entry.pageNumber === 'number' || !Number.isFinite(page)
        ? entry
        : { ...entry, pageNumber: page },
    );
  }
  return { callouts, ids };
}

/**
 * Run the one-time calloutsList→annotations-map migration on an open Y.Doc.
 * WRITE path — see the module header for the caller's write-capability duty.
 *
 * @param {import('yjs').Doc} doc — the durable annotation Y.Doc (already hydrated)
 * @param {object} [options]
 * @param {object} [options.pageSizes] — { [page]: { width, height } } unscaled
 *   PDF pixel dims (unmeasured pages fall back to US-Letter — harmless, see
 *   FALLBACK_PAGE_SIZE above).
 * @param {string} [options.origin='local'] — Yjs transaction origin. 'local'
 *   (the default) makes annotationDocSync's update observer persist the
 *   migration durably, exactly like a user edit.
 * @returns {{
 *   migrated: boolean,        // true when at least one map entry was written
 *   tombstoned: boolean,      // true when the meta was verified-complete and nulled
 *   calloutCount: number,     // meta entries verifiably present in the map afterwards
 *   migratedCount: number,    // entries THIS run wrote AND verified in the map
 *   droppedCount: number,     // meta entries that could not be verified (block the tombstone)
 *   source: 'annotations-map'|'meta'|'none',
 * }}
 */
export function migrateCalloutsMetaToAnnotationsMap(doc, { pageSizes = {}, origin = 'local' } = {}) {
  if (!doc) throw new Error('migrateCalloutsMetaToAnnotationsMap: a Y.Doc is required');

  const meta = getMetaValue(doc, CALLOUTS_META_KEY);
  const map = getAnnotationsMap(doc);

  // Nothing real to migrate → ZERO ops (contract point 1). Includes null (the
  // tombstone itself), undefined (never written), [], and foreign non-arrays.
  if (!Array.isArray(meta) || meta.length === 0) {
    const mapCallouts = countCalloutMapEntries(map);
    return {
      migrated: false,
      tombstoned: false,
      calloutCount: mapCallouts,
      migratedCount: 0,
      droppedCount: 0,
      source: mapCallouts > 0 ? 'annotations-map' : 'none',
    };
  }

  // --- Build the write plan (pure — the doc is untouched until the transact) ---
  const mapCalloutIds = new Set();
  const mapForeignIds = new Set();
  map.forEach((entry, key) => {
    if (isCalloutMapEntry(entry)) mapCalloutIds.add(key);
    else mapForeignIds.add(key);
  });

  const plan = [];           // [id, { p, o }] for meta entries absent from the map
  const planned = new Set();
  const dropped = [];        // human-readable reasons — any entry here blocks the tombstone
  for (const entry of meta) {
    const id = metaEntryId(entry);
    if (!id) { dropped.push('entry without a usable id'); continue; }
    if (planned.has(id) || mapCalloutIds.has(id)) continue; // duplicate row / already in map
    if (mapForeignIds.has(id)) { dropped.push(`id '${id}' collides with a non-callout map entry`); continue; }
    // Coerce like the live render + projector do (PDFViewer.jsx ~1953): a
    // string pageNumber is renderable and must not be dropped.
    const page = Number(entry.pageNumber);
    if (!Number.isFinite(page)) { dropped.push(`id '${id}' has unusable pageNumber ${JSON.stringify(entry.pageNumber)}`); continue; }
    const rawSize = (pageSizes || {})[page];
    const size = rawSize && Number.isFinite(rawSize.width) && Number.isFinite(rawSize.height)
      ? rawSize
      : FALLBACK_PAGE_SIZE;
    // Normalize pageNumber to the coerced number INSIDE the persisted payload so
    // the derive→re-project round trip is byte-identical (a string pageNumber in
    // data.legacyCallout would make the first re-projection emit a churn op).
    const normalizedEntry = typeof entry.pageNumber === 'number' ? entry : { ...entry, pageNumber: page };
    let obj;
    try {
      obj = calloutToAnnotationObject(normalizedEntry, size);
    } catch (err) {
      dropped.push(`id '${id}' failed projection: ${err?.message}`);
      continue;
    }
    planned.add(id);
    plan.push([id, { p: page, o: obj }]);
  }

  // --- Apply: map writes + verification + tombstone in ONE atomic transaction ---
  let migratedCount = 0;
  let matched = 0;
  let tombstoned = false;
  const applyAndVerify = () => {
    for (const [id, entry] of plan) writeAnnotationMark(doc, id, entry.p, entry.o);
    // Verify from the map itself: every meta entry must now be represented by a
    // callout entry under its normalized id. (In-transaction reads see the
    // writes above.) migratedCount reflects what actually LANDED, not the plan.
    for (const [id] of plan) { if (isCalloutMapEntry(map.get(id))) migratedCount += 1; }
    for (const entry of meta) {
      const id = metaEntryId(entry);
      if (id && isCalloutMapEntry(map.get(id))) matched += 1;
    }
    if (matched === meta.length && dropped.length === 0) {
      tombstoned = setMetaValue(doc, CALLOUTS_META_KEY, null, origin);
    }
  };
  if (plan.length > 0) {
    doc.transact(applyAndVerify, origin);
  } else {
    // No map writes needed. Run the same verification; a parity-complete stale
    // meta (crash-recovery branch) tombstones — one bounded op — while an
    // unverifiable meta stays put with zero ops.
    applyAndVerify();
  }

  if (matched !== meta.length || dropped.length > 0) {
    // LOUD by design: the meta is the only durable copy of the unverified
    // entries — it stays intact as the recovery copy and every open will retry.
    console.error(
      '[calloutMetaMigration] calloutsList meta NOT tombstoned — '
      + `${matched}/${meta.length} entries verified in the annotations map; leaving the meta intact as the recovery copy`,
      { dropped },
    );
  }

  return {
    migrated: migratedCount > 0,
    tombstoned,
    calloutCount: matched,
    migratedCount,
    droppedCount: dropped.length,
    source: plan.length > 0 ? 'meta' : (mapCalloutIds.size > 0 ? 'annotations-map' : 'none'),
  };
}
