// src/lib/collab/crdtBackfill.js
//
// Phase 30 - Migration Phase A - Dual-Write Era
//
// Per-(user, document) idempotent backfill from legacy `document_annotations`
// rows into the Y.Doc. Runs once per (user, document) on first v2.4 open.
//
// CONTEXT.md `<decisions>` "First-open import feel":
//   Silent migration. No banner, no spinner, no completion toast. The
//   annotations just appear like normal. Pattern reference: Linear, Figma,
//   Notion silent migration.
//
// CONTEXT.md `<decisions>` "Backfill idempotency contract":
//   Idempotency key is client_anno_id (== legacy highlight_id == fabricObject.data.id).
//   Same key + deep-equal value = skip silently. Same key + different value =
//   bridge through per-property LWW.
//
// MIGRATE-01 contract - preserved metadata per imported annotation:
//   - meta.authorId = legacy row's user_id (NOT importing user)
//   - meta.deviceId = literal 'before-v2.4'
//   - meta.createdAt = legacy row's created_at (NOT Date.now())
//
// applyUpdate-only invariant: writes via Y.Map.set inside ydoc.transact(fn, origin)
// - never wholesale state replacement. Phase 27 invariant test passes by construction.
//
// Phase 30 narrow waiver: this module is NEW. The 3 dual-write surface files
// (annotationCloudSync.js, crdtBackfill.js, crdtDualWriteQueue.js) are scanned
// by the architectural invariant gate; reconcile-by-row-removal is forbidden.
//
// NO_DIFF_DELETE_OK: this module never removes rows from any store. The 3-file
// CI grep gate scans this file. The only architecturally-sanctioned
// remediation for a missing-side write is retry, never reconcile-by-removal
// (Pitfall 5 defense). // NO_DIFF_DELETE_OK

import * as Y from 'yjs';
import { applyFabricCreate } from './crdtAnnotationBridge.js';
import { buildOrigin } from './originBuilder.js';

// Mirrors annotationCloudSync.js NON_HIGHLIGHT_TYPES (line 26). Backfill
// excludes 'highlight' rows entirely - Excel-sync carve-out, folded into v2.5.
// CONTEXT.md `<decisions>` "Highlights skipped" (architectural - locked by roadmap).
export const NON_HIGHLIGHT_TYPES_FOR_BACKFILL = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser',
];

// Per-user marker key in ydoc.getMap('meta'). Stored INSIDE the Y.Doc so it
// propagates to other devices via normal CRDT sync - a second device opening
// after the first finished sees the marker and short-circuits. Per-user keying
// so collaborator A's marker does not suppress collaborator B's first-open.
const BACKFILL_DONE_PREFIX = 'backfill_done:';

// Literal device tag for every imported annotation. CONTEXT.md `<decisions>`
// "Old-author tag wording" - "Before v2.4" is the user-visible string in
// tooltips / properties / activity log; meta.deviceId is the data backing it.
const LEGACY_DEVICE_ID = 'before-v2.4';

// Origin source tag for every backfill transaction. Phase 33 activity log
// filters by origin.source === 'crdt-backfill' to render the single
// "Document migrated to collaborative version" row per migrated document.
const BACKFILL_ORIGIN_SOURCE = 'crdt-backfill';

/**
 * Defensive deserialization of a legacy annotation row into the Fabric JSON
 * the bridge expects. Two row shapes are supported:
 *
 *   1. Production shape (Phase 21+): row.annotation_data is an OBJECT with
 *      `{ fabricObject, pageNumber, schemaVersion }`. This is what
 *      annotationTypeSerializers.deserializeRowToFabricObject produces and what
 *      annotationCloudSync.js writes today.
 *
 *   2. Test/legacy shape: row.annotation_data is a JSON STRING containing the
 *      raw Fabric properties directly (e.g. `'{"left":10,"top":20}'`). Plan
 *      30-01 test scaffolds use this shape for fixture brevity.
 *
 * Always returns `{ fabricObject, pageNumber, highlightId }` matching the
 * deserializer contract. The bridge needs `fabricObject.data.id` to be set;
 * we inject it from row.highlight_id when missing.
 */
function deserializeRowDefensive(row) {
  if (!row) throw new Error('row required');
  if (!row.highlight_id) throw new Error('row.highlight_id required');

  let raw = row.annotation_data;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); }
    catch (parseErr) {
      throw new Error(`row ${row.highlight_id}: annotation_data is malformed JSON`);
    }
  }
  raw = raw || {};

  // Production shape has the Fabric JSON nested under `.fabricObject`. Test/
  // legacy shape has the Fabric props at the top level.
  const fabricObject = raw.fabricObject ? { ...raw.fabricObject } : { ...raw };
  const pageNumber = raw.pageNumber ?? row.page_number ?? 1;
  const highlightId = row.highlight_id;

  // Inject stable annoId. Phase 29 bridge reads fabricObject.data.id (line 183
  // of crdtAnnotationBridge.js). Legacy data already has it via
  // serializeFabricObjectToRow (line 178: highlight_id: id) but defense:
  if (!fabricObject.data) fabricObject.data = {};
  if (!fabricObject.data.id) fabricObject.data.id = highlightId;
  // Type is also surfaced at the top level for the bridge's CREATE branch
  // (annoYMap.set('type', fabricJson.type) at line 234).
  if (!fabricObject.type && row.annotation_type) fabricObject.type = row.annotation_type;

  return { fabricObject, pageNumber, highlightId };
}

/**
 * Build an origin payload for a single backfilled row.
 *
 * Two strategies:
 *   1. Caller-provided originPayloadFactory({ source, userId, deviceId, sessionId, clientID })
 *      - Plan 30-06 YDocProvider mount uses this so the caller controls the
 *        exact frozen-object shape (matters for Y.UndoManager.trackedOrigins
 *        reference equality if the caller wants to thread backfill writes into
 *        a per-user undo manager later).
 *   2. Default - delegates to originBuilder.buildOrigin(...) and patches
 *      .source = 'crdt-backfill'. Used by tests (which do not pass a factory)
 *      and by any caller that does not need custom origin shaping.
 */
function buildBackfillOrigin({ originPayloadFactory, userId, deviceId, sessionId, clientID }) {
  if (typeof originPayloadFactory === 'function') {
    return originPayloadFactory({
      source: BACKFILL_ORIGIN_SOURCE,
      userId,
      deviceId,
      sessionId,
      clientID,
    });
  }
  // buildOrigin returns Object.freeze({ source: 'local', userId, deviceId, sessionId, clientID }).
  // Spread-then-freeze to flip source to 'crdt-backfill' while preserving the
  // shape the rest of the v2.4 stack reads.
  const base = buildOrigin({ userId, deviceId, sessionId, clientID });
  return Object.freeze({ ...base, source: BACKFILL_ORIGIN_SOURCE });
}

/**
 * Run the legacy -> CRDT backfill once per (user, document).
 *
 * Web-Locks-arbitrated against same-user same-doc tab races. The leader runs
 * the loop and releases; loser tabs short-circuit via the backfill_done marker
 * stored in ydoc.getMap('meta').
 *
 * Per-row write goes through crdtAnnotationBridge.applyFabricCreate. The
 * bridge's CREATE-branch idempotency check (meta.authorId existence sentinel,
 * line 226 of crdtAnnotationBridge.js) is the per-annotation dedup contract:
 * second-time imports of the same annoId become EDIT-branch no-ops (the
 * shallowEqual loop at line 250-256 produces zero Yjs updates because every
 * property's prev value matches the new value).
 *
 * Pitfall 30-1 (createdAt clobber) - fix: after applyFabricCreate, perform a
 * second metaYMap.set('createdAt', legacyCreatedAtMs) inside its own
 * ydoc.transact(fn, originPayload) block. Yjs Y.Map per-key LWW means the
 * second write wins for read; both transactions carry the 'crdt-backfill'
 * origin so Phase 33 activity log attributes both correctly.
 *
 * Pitfall 30-2 (author clobber) - fix: ctx.userId = row.user_id (NOT the
 * importing user). Tested in crdtBackfill.test.mjs case 1.
 *
 * @param {object} args
 * @param {Y.Doc} args.ydoc - per-document Y.Doc instance from <YDocProvider>
 * @param {Y.Map} [args.yMapAnnotations] - optional; defaults to ydoc.getMap('annotations')
 * @param {object} args.supabase - Supabase client
 * @param {string} args.documentId - document UUID
 * @param {string} args.userId - importing user's UUID (NOT used for meta.authorId - that's per-row from legacy data)
 * @param {string} [args.sessionId] - per-mount session UUID
 * @param {number} [args.clientID] - per-mount Yjs clientID
 * @param {function} [args.originPayloadFactory] - optional; takes ({source, userId, deviceId, sessionId, clientID}), returns frozen origin object
 * @returns {Promise<{ranAs: string, count?: number, imported?: number, skipped?: number, error?: any}>}
 */
export async function runBackfill(args) {
  const {
    ydoc,
    supabase,
    documentId,
    userId,
  } = args || {};

  // Defensive guards - silent no-op if any required input is missing. The
  // caller (Plan 30-06 YDocProvider mount) gates on isCRDTEnabled() before
  // even calling us, but defense-in-depth: never throw inside the provider.
  if (!ydoc || !supabase || !documentId || !userId) {
    return { ranAs: 'noop_missing_inputs' };
  }

  if (typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.request !== 'function') {
    // SSR / Node-test fallback: run inline without lock. Tests inject a fake
    // navigator.locks; production browsers always have it. Without this branch
    // the unit test suite (which runs in Node) would have no way to execute
    // the body.
    return runBackfillUnlocked(args);
  }

  // Lock name format MUST be `y-doc-backfill-${userId}-${documentId}` -
  // Plan 30-01 weblocks test asserts this name. Per-(user, document) so
  // different documents do not queue against each other; same-user-same-doc
  // races (two tabs) serialize cleanly.
  const lockName = `y-doc-backfill-${userId}-${documentId}`;

  // mode: 'exclusive' - two simultaneous backfills of the same (user,
  // document) emit duplicate Yjs updates with no benefit (idempotency catches
  // them, but it's wasted work).
  return navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
    return runBackfillUnlocked(args);
  });
}

async function runBackfillUnlocked(args) {
  const {
    ydoc,
    supabase,
    documentId,
    userId,
    sessionId,
    clientID,
    originPayloadFactory,
  } = args;

  // Caller may pass yMapAnnotations explicitly (test scaffolds do this so they
  // can hold onto a single reference for assertions); otherwise derive from
  // the ydoc the standard way every other v2.4 module does.
  const yMapAnnotations = args.yMapAnnotations || ydoc.getMap('annotations');
  const yMapMeta = ydoc.getMap('meta');

  // Already-done short-circuit. Per-user keying so collaborator A's marker
  // does not suppress collaborator B's first-open (each user's first-open of
  // the same doc is independently idempotent, and the bridge's per-row dedup
  // catches duplicates anyway).
  const doneKey = `${BACKFILL_DONE_PREFIX}${userId}`;
  if (yMapMeta.get(doneKey)) {
    return { ranAs: 'already_done', count: 0 };
  }

  // Read legacy rows. Same query shape as
  // annotationCloudSync.loadAllNonHighlightAnnotations (line 173-200).
  // .order('created_at', ascending) is intentional - backfill writes preserve
  // the legacy creation order, which matters for activity log readback.
  let rows = [];
  let queryError = null;
  try {
    const result = await supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .in('annotation_type', NON_HIGHLIGHT_TYPES_FOR_BACKFILL)
      .order('created_at', { ascending: true });
    rows = result?.data || [];
    queryError = result?.error || null;
  } catch (err) {
    queryError = err;
  }

  if (queryError) {
    // Don't mark done. Next first-open silently retries. CONTEXT.md
    // "Silent retry on partial failure".
    return { ranAs: 'failed', error: queryError };
  }

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const { fabricObject, pageNumber, highlightId } = deserializeRowDefensive(row);
      fabricObject.pageNumber = pageNumber;

      // ORIGIN: source = 'crdt-backfill' so Phase 33 activity log can render
      // a single "Document migrated" row per migrated document.
      // userId in the origin = LEGACY ROW's user_id (original creator), NOT
      // the importing user - preserves MIGRATE-01 author attribution at the
      // transaction-tag level (Phase 33 reads origins to attribute log rows).
      const originPayload = buildBackfillOrigin({
        originPayloadFactory,
        userId: row.user_id,                    // ORIGINAL CREATOR
        deviceId: LEGACY_DEVICE_ID,             // CONTEXT.md literal decision: 'before-v2.4'
        sessionId,
        clientID,
      });

      // CTX: bridge consumes ctx.userId / ctx.deviceId for meta.authorId /
      // meta.deviceId (line 242-243 of crdtAnnotationBridge.js).
      const ctx = {
        userId: row.user_id,                    // sets meta.authorId (Pitfall 30-2 fix)
        deviceId: LEGACY_DEVICE_ID,             // sets meta.deviceId
        sessionId,
        clientID,
      };

      // Pass 1: bridge CREATE branch seeds meta.authorId / meta.deviceId /
      // meta.createdAt = Date.now(). The bridge's idempotency catches re-runs
      // because metaYMap.get('authorId') will be non-null on second pass.
      applyFabricCreate(ydoc, yMapAnnotations, fabricObject, originPayload, ctx);

      // Pass 2: override meta.createdAt with the legacy row's timestamp.
      // Pitfall 30-1 fix per RESEARCH.md Open Question 1 recommendation b.
      // Wrapped in its own ydoc.transact so the override carries the same
      // 'crdt-backfill' origin tag - Phase 33 activity log filters by origin.
      const legacyCreatedAtMs = row.created_at ? new Date(row.created_at).getTime() : Date.now();
      const annoId = fabricObject.data.id || highlightId;
      ydoc.transact(() => {
        const annoYMap = yMapAnnotations.get(annoId);
        if (!annoYMap) return;
        const metaYMap = annoYMap.get('meta');
        if (!metaYMap) return;
        // Only override if the bridge actually wrote createdAt = Date.now()
        // on this pass (i.e. CREATE branch fired). On re-run, bridge skips
        // CREATE and the existing legacy createdAt is already in place; setting
        // again is a no-op per Y.Map same-key-same-value semantics.
        metaYMap.set('createdAt', legacyCreatedAtMs);
      }, originPayload);

      imported++;
    } catch (err) {
      // Skip this row, log to console, keep going. One bad row never blocks
      // the rest. Next first-open retries via the missing-doneKey path.
      // eslint-disable-next-line no-console
      console.warn('[crdtBackfill] skipping row', row?.highlight_id, err?.message);
      skipped++;
    }
  }

  // Mark done. Stored INSIDE Y.Doc so it propagates via CRDT sync. A second
  // device opening after the first finished sees the marker and short-circuits.
  // Wrapped in a transact tagged with the backfill origin so Phase 33 sees a
  // clean closing event (single attribution surface for the whole migration).
  const closingOrigin = buildBackfillOrigin({
    originPayloadFactory,
    userId,
    deviceId: LEGACY_DEVICE_ID,
    sessionId,
    clientID,
  });
  ydoc.transact(() => {
    yMapMeta.set(doneKey, Date.now());
  }, closingOrigin);

  return { ranAs: 'leader', imported, skipped };
}

export default runBackfill;
