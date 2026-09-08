// src/services/excelSyncClient.js
//
// KAL-309 client transport + idempotent materialize reducer (PLAN-KAL309 §D.1–D.4).
//
// This is the CLIENT half of the server-authoritative Excel sync. It is a PURE,
// dependency-injected module — no direct import of the Supabase singleton, no
// React, no Y.Doc. Every external is passed in (supabaseClient, getMarkers,
// writeMarker, getMeta, setMeta), so the whole thing is unit-testable with mocks
// and the same code runs in the browser app and the Node test runner.
//
// Trust boundary (F6): the server (Edge + apply RPC) owns the EXCEL-side merge —
// actor role, registration/token, lock, Excel-vs-Excel TOCTOU drift. THIS module
// owns the app-vs-Excel field merge: it reads the live marker (Yjs, which the
// server cannot see), overlays ONLY the op's changedFieldKeys, and writes that
// single marker. A genuine app-vs-Excel both-changed conflict is NOT overwritten —
// it is routed to client_conflict_review and surfaced for the user.
//
// ONE cursor (R2#2): a single per-mirror `excelSyncFrontier:${templateId}` meta
// holds the highest CONTIGUOUSLY-handled excel_revision. It advances only over
// fully-handled contiguous ops and HALTS at the first client_conflict_review op
// (recorded durably in `excelSyncReview:${templateId}`), so a reopen re-fetches
// from the frontier and never skips a conflicted revision.

import { computeRowFingerprints } from './rowFingerprint.js';

const EDGE_FUNCTION = 'excel-apply-changeset';

// Meta keys for the single contiguous frontier cursor + the durable review set,
// both scoped per mirror (templateId) and stored in the annotationDocSync Y.Doc
// META map via the injected getMeta/setMeta.
const FRONTIER_KEY = (templateId) => `excelSyncFrontier:${templateId}`;
const REVIEW_KEY = (templateId) => `excelSyncReview:${templateId}`;

// The minimal-diff origin the Y.Doc store honors for survey markers: additive
// (never deletes omitted keys, F10) but still persists durably. Matches
// annotationDocStore.syncSurveyMarkersToDoc's `origin !== 'excel-import'` deletion gate.
const IMPORT_ORIGIN = 'excel-import';

// ---------------------------------------------------------------------------
// crypto
// ---------------------------------------------------------------------------

/** crypto.randomUUID with a deterministic-shaped fallback (Node/browser both have it). */
function randomUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (should never run in supported runtimes): a v4-shaped id.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ===========================================================================
// (D.1) Transport — submitChangeSet / fetchSince / ack / resolve / seed / set-id
// ===========================================================================

/**
 * Submit a change-set to the Edge function. The server is the authority; the
 * matcher runs server-side over the raw inputs. Returns the Edge response.
 *
 * `clientChangeSetId` is generated once per submission and must be PERSISTED by
 * the caller for retry — a retry that reuses the SAME id replays (F7) and returns
 * the stored outcomes verbatim (never spawns duplicate markers).
 *
 * @returns {Promise<{ excelRevision:number, outcomes:Array, writebackJobs:Array,
 *   replayed:boolean, error?:string, tokenWritebackIncomplete?:boolean }>}
 */
export async function submitChangeSet({
  supabaseClient,
  documentId,
  templateId,
  workbookId,
  syncToken,
  rows = [],
  worksheetDataList = [],
  surveyMarkers = {},
  appValuesByMarkerId = null,
  templateConfig = null,
  ingestSeq = null,
  capabilityTier = 'unknown',
  deviceHint = null,
  clientChangeSetId = randomUUID(),
}) {
  if (!supabaseClient || typeof supabaseClient.functions?.invoke !== 'function') {
    throw new Error('submitChangeSet: supabaseClient with functions.invoke is required');
  }
  if (!documentId || !templateId || !workbookId || !syncToken) {
    throw new Error('submitChangeSet: documentId, templateId, workbookId, syncToken are required');
  }

  const body = {
    documentId,
    templateId,
    workbookId,
    syncToken,
    // The Edge expects the change-set as an object with the idempotency id + the
    // (advisory) client-declared rows. The authoritative classification happens
    // server-side from worksheetDataList/surveyMarkers.
    changeSet: { clientChangeSetId, rows },
    worksheetDataList,
    surveyMarkers,
    appValuesByMarkerId,
    templateConfig,
    ingestSeq,
    capabilityTier,
    deviceHint,
  };

  const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION, { body });

  if (error) {
    // The functions client surfaces a non-2xx as `error`; the structured body
    // (when present) carries the server's reason + any per-row outcomes.
    return await normalizeEdgeError(error, data, clientChangeSetId);
  }

  const result = data || {};
  return {
    clientChangeSetId,
    excelRevision: Number(result.excelRevision) || 0,
    outcomes: Array.isArray(result.outcomes) ? result.outcomes : [],
    writebackJobs: Array.isArray(result.writebackJobs) ? result.writebackJobs : [],
    replayed: Boolean(result.replayed),
    tokenWritebackIncomplete: Boolean(result.tokenWritebackIncomplete),
    error: result.error || null,
  };
}

// Normalize a FunctionsHttpError (or a thrown transport error) into the same
// shape submitChangeSet returns on success, so callers branch on `.error`.
async function normalizeEdgeError(error, data, clientChangeSetId) {
  let serverReason = null;
  let serverDetail = null;
  let outcomes = [];
  // supabase-js exposes the parsed body via `data` in some versions, but on a
  // FunctionsHttpError (non-2xx) `data` is usually null and the real body lives on
  // `error.context` (the fetch Response). Read it so callers see the server's actual
  // reason (e.g. 'legacy_unsigned' + 're-export required') instead of the opaque
  // "Edge Function returned a non-2xx status code".
  let bodyish = (data && typeof data === 'object') ? data : null;
  if (!bodyish && error && error.context && typeof error.context.json === 'function') {
    try { bodyish = await error.context.json(); } catch { /* body not JSON / already consumed */ }
  }
  if (bodyish && typeof bodyish === 'object') {
    serverReason = bodyish.error || null;
    serverDetail = bodyish.detail || null;
    if (Array.isArray(bodyish.outcomes)) outcomes = bodyish.outcomes;
  }
  return {
    clientChangeSetId,
    excelRevision: 0,
    outcomes,
    writebackJobs: [],
    replayed: false,
    tokenWritebackIncomplete: false,
    error: serverReason || error?.message || 'edge_invoke_failed',
    detail: serverDetail || null,
  };
}

/**
 * Fetch committed ops for a mirror with excel_revision > sinceRevision, ascending.
 * Wraps kal309_fetch_since (TOKEN-REDACTED — patch_payload carries NO secrets).
 *
 * @returns {Promise<{ ops:Array, error?:string }>} ops are the redacted rows:
 *   { op_uuid, op_id, excel_revision, marker_annotation_id, op_type, patch_payload, op_status }
 */
export async function fetchSince({ supabaseClient, documentId, templateId, sinceRevision = 0 }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
    throw new Error('fetchSince: supabaseClient with rpc is required');
  }
  const { data, error } = await supabaseClient.rpc('kal309_fetch_since', {
    p_document_id: documentId,
    p_template_id: templateId,
    p_since_revision: Number(sinceRevision) || 0,
  });
  if (error) return { ops: [], error: error.message || 'fetch_since_failed' };
  return { ops: Array.isArray(data) ? data : [], error: null };
}

/**
 * Acknowledge a materialization outcome for one op. Wraps kal309_ack_materialization.
 * Guarded server-side: accepted → { materialized | client_conflict_review } only;
 * a late ack cannot un-stick a conflict (F13).
 *
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
export async function ackMaterialization({ supabaseClient, documentId, templateId, opUuid, status }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
    throw new Error('ackMaterialization: supabaseClient with rpc is required');
  }
  const { data, error } = await supabaseClient.rpc('kal309_ack_materialization', {
    p_document_id: documentId,
    p_template_id: templateId,
    p_op_uuid: opUuid,
    p_status: status,
  });
  if (error) return { ok: false, error: error.message || 'ack_failed' };
  return { ok: data === true, error: null };
}

/**
 * Resolve a client_conflict_review op. Wraps kal309_resolve_materialization_conflict.
 * resolution ∈ 'keep-app' | 'take-excel' | 'merged' (R2#4). take-excel sets the op
 * back to 'accepted' server-side so a subsequent fetchSince + reducer re-materializes it.
 *
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
export async function resolveMaterializationConflict({
  supabaseClient,
  documentId,
  templateId,
  opUuid,
  resolution,
  resolvedFingerprints = null,
}) {
  if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
    throw new Error('resolveMaterializationConflict: supabaseClient with rpc is required');
  }
  const { data, error } = await supabaseClient.rpc('kal309_resolve_materialization_conflict', {
    p_document_id: documentId,
    p_template_id: templateId,
    p_op_uuid: opUuid,
    p_resolution: resolution,
    p_resolved_fingerprints: resolvedFingerprints,
  });
  if (error) return { ok: false, error: error.message || 'resolve_failed' };
  return { ok: data === true, error: null };
}

/**
 * Seed the server-side Excel baseline at export time (F18 / D.6). Wraps
 * kal309_seed_sync_state. `markers` is an array of
 * { markerAnnotationId, scopeId, identityRecord, assignedToken }.
 *
 * @returns {Promise<{ count:number, error?:string }>}
 */
export async function seedSyncState({ supabaseClient, documentId, templateId, workbookId, markers = [] }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
    throw new Error('seedSyncState: supabaseClient with rpc is required');
  }
  const { data, error } = await supabaseClient.rpc('kal309_seed_sync_state', {
    p_document_id: documentId,
    p_template_id: templateId,
    p_workbook_id: workbookId,
    p_markers: markers,
  });
  if (error) return { count: 0, error: error.message || 'seed_failed' };
  return { count: Number(data) || 0, error: null };
}

/**
 * Freeze the canonical signing-doc id on the active registration (D.6). Wraps
 * kal309_set_registration_signing_id (derives the registration row from workbookId).
 *
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
export async function setRegistrationSigningId({ supabaseClient, documentId, templateId, workbookId, signingDocId }) {
  if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
    throw new Error('setRegistrationSigningId: supabaseClient with rpc is required');
  }
  const { data, error } = await supabaseClient.rpc('kal309_set_registration_signing_id', {
    p_document_id: documentId,
    p_template_id: templateId,
    p_workbook_id: workbookId,
    p_signing_doc_id: signingDocId,
  });
  if (error) return { ok: false, error: error.message || 'set_signing_id_failed' };
  return { ok: data === true, error: null };
}

// ===========================================================================
// (D.3) Frontier helpers — single contiguous cursor + durable review set
// ===========================================================================

/** Read the single contiguous frontier revision for a mirror (0 if unset). */
export function readFrontier({ getMeta, templateId }) {
  const v = getMeta(FRONTIER_KEY(templateId));
  const rev = v && typeof v === 'object' ? Number(v.revision) : Number(v);
  return Number.isFinite(rev) && rev > 0 ? rev : 0;
}

/** Advance the single contiguous frontier to `revision` (only over handled contiguous ops). */
export function writeFrontier({ setMeta, templateId, revision }) {
  setMeta(FRONTIER_KEY(templateId), { revision: Number(revision) || 0, at: Date.now() }, IMPORT_ORIGIN);
}

/** Read the durable review set (keyed by op_uuid) for a mirror. */
export function readReviewSet({ getMeta, templateId }) {
  const v = getMeta(REVIEW_KEY(templateId));
  return v && typeof v === 'object' ? { ...v } : {};
}

/** Persist the durable review set for a mirror. */
export function writeReviewSet({ setMeta, templateId, reviewSet }) {
  setMeta(REVIEW_KEY(templateId), reviewSet || {}, IMPORT_ORIGIN);
}

// ===========================================================================
// (D.3) Materialize reducer — per-marker READ-MERGE-WRITE, idempotent, halts on conflict
// ===========================================================================

// Scalar field keys the matcher reports in changedFieldKeys (besides answer:<id>).
const SCALAR_FIELD_KEYS = ['changedBy', 'changedDate', 'item', 'entity', 'notes'];

/**
 * Materialize accepted/create ops into survey markers via per-marker READ-MERGE-WRITE.
 *
 * Contract (F9 / D.3):
 *   - Process ops in STRICT ascending excel_revision. Only ops with revision >
 *     frontier are considered. The reducer stops at the first op it cannot fully
 *     HANDLE so the contiguous frontier below never skips a revision.
 *   - IDEMPOTENT skip: an op already past the frontier OR already recorded handled
 *     in the review set is skipped (no double-apply).
 *   - PER-MARKER merge: READ the current marker, overlay ONLY the op's
 *     changedFieldKeys onto a CLONE, WRITE that single marker (never a full map,
 *     never another marker). A per-marker in-process advisory lock + re-read guard
 *     protects against an interleaving local edit on the SAME marker (best-effort,
 *     V1 residual race accepted — see PLAN F9).
 *   - app-vs-Excel CONFLICT: if a changed field's LIVE marker value differs from
 *     BOTH the op's baseFingerprints AND the op's incoming Excel value, it is a
 *     genuine both-changed conflict → record client_conflict_review (durable),
 *     ack it, and HALT (BREAK) — the frontier stays at the prior revision.
 *   - FRONTIER advances only when an op is fully materialized AND contiguous.
 *
 * All side effects are injected:
 *   getMarkers() -> { [markerAnnotationId]: marker }   (live Yjs snapshot)
 *   writeMarker(markerAnnotationId, nextMarker)         (single-marker durable write)
 *   getMeta(key) / setMeta(key,value,origin)            (Y.Doc META map)
 *   ack({ opUuid, status })                             (kal309_ack_materialization wrapper)
 *
 * @returns {Promise<{ materialized:string[], conflicts:string[], skipped:string[],
 *   frontier:number, halted:boolean }>}
 */
export async function materializeAcceptedOps({
  ops = [],
  templateId,
  getMarkers,
  writeMarker,
  getMeta,
  setMeta,
  ack = null,
}) {
  if (typeof getMarkers !== 'function' || typeof writeMarker !== 'function') {
    throw new Error('materializeAcceptedOps: getMarkers and writeMarker are required');
  }
  if (typeof getMeta !== 'function' || typeof setMeta !== 'function') {
    throw new Error('materializeAcceptedOps: getMeta and setMeta are required');
  }

  let frontier = readFrontier({ getMeta, templateId });
  const reviewSet = readReviewSet({ getMeta, templateId });

  const materialized = [];
  const conflicts = [];
  const skipped = [];
  let halted = false;
  let gap = false;

  // STRICT ascending excel_revision; only ops strictly above the frontier matter.
  const ordered = [...ops]
    .map(normalizeOp)
    .filter((op) => op && op.excelRevision > frontier)
    .sort((a, b) => a.excelRevision - b.excelRevision);

  for (const op of ordered) {
    // CONTIGUITY GATE (F8/F11): the frontier may only advance one revision at a time.
    // If this op is NOT the next revision, there is a hole in what we fetched — stop
    // and signal a gap so the caller re-fetchSince (capped retry) rather than writing
    // the frontier past a missing revision (which would silently drop ops).
    if (op.excelRevision !== frontier + 1) {
      gap = true;
      break;
    }

    // op_status drives the action (Codex finding #2). A late local review record also
    // pins the op even if the server still reports 'accepted'.
    const prior = reviewSet[op.opUuid];
    const status = op.opStatus;

    // 1) CONFLICT-REVIEW (server- or client-recorded) → HALT. Never materialize; pin
    //    the frontier at the prior revision so later ops are not applied on top.
    if (status === 'client_conflict_review'
        || (prior && prior.status === 'client_conflict_review')) {
      halted = true;
      break;
    }

    // 2) RESOLVED (keep-app / merged) → already settled server-side; do NOT re-overlay
    //    app fields. Just advance the contiguous frontier past it.
    if (status === 'resolved') {
      reviewSet[op.opUuid] = {
        revision: op.excelRevision, markerAnnotationId: op.markerAnnotationId, status: 'resolved',
      };
      writeReviewSet({ setMeta, templateId, reviewSet });
      skipped.push(op.opUuid);
      frontier = op.excelRevision;
      writeFrontier({ setMeta, templateId, revision: frontier });
      continue;
    }

    // 3) ALREADY MATERIALIZED (server status OR our durable record) → idempotent skip;
    //    advance the contiguous frontier over it.
    if (status === 'materialized' || (prior && prior.status === 'materialized')) {
      skipped.push(op.opUuid);
      frontier = op.excelRevision;
      writeFrontier({ setMeta, templateId, revision: frontier });
      continue;
    }

    // 4) ACCEPTED (or null status for a fresh fetch) → READ-MERGE-WRITE the marker.
    const merge = await mergeOneMarker({ op, getMarkers, writeMarker });

    if (merge.conflict) {
      reviewSet[op.opUuid] = {
        revision: op.excelRevision,
        markerAnnotationId: op.markerAnnotationId,
        status: 'client_conflict_review',
      };
      writeReviewSet({ setMeta, templateId, reviewSet });
      if (ack) {
        try { await ack({ opUuid: op.opUuid, status: 'client_conflict_review' }); } catch { /* best-effort */ }
      }
      conflicts.push(op.opUuid);
      // HALT: this op is "handled but unresolved" — it pins the frontier at the
      // prior revision so later ops (incl. same-marker) are not applied on top.
      halted = true;
      break;
    }

    // Fully materialized. Record durably so a re-fetch is idempotent.
    reviewSet[op.opUuid] = {
      revision: op.excelRevision,
      markerAnnotationId: op.markerAnnotationId,
      status: 'materialized',
    };
    writeReviewSet({ setMeta, templateId, reviewSet });
    if (ack) {
      try { await ack({ opUuid: op.opUuid, status: 'materialized' }); } catch { /* best-effort */ }
    }
    materialized.push(op.opUuid);

    // Advance the SINGLE frontier ONLY because this op is fully handled AND contiguous.
    frontier = op.excelRevision;
    writeFrontier({ setMeta, templateId, revision: frontier });
  }

  return { materialized, conflicts, skipped, frontier, halted, gap };
}

// Normalize a fetch_since row OR an Edge outcome+payload into a uniform op shape
// the reducer consumes. Both carry the same essentials: a globally-unique op_uuid,
// an excel_revision, a markerAnnotationId, an op_type, and the patch payload that
// carries changedFieldKeys / fields / baseFingerprints.
function normalizeOp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw.patch_payload && typeof raw.patch_payload === 'object' ? raw.patch_payload : raw;
  const opUuid = raw.op_uuid ?? raw.opUuid ?? payload.op_uuid ?? payload.opUuid;
  const excelRevision = Number(raw.excel_revision ?? raw.excelRevision ?? payload.excelRevision);
  const markerAnnotationId =
    raw.marker_annotation_id ?? raw.markerAnnotationId ?? payload.markerAnnotationId ?? null;
  const opType = raw.op_type ?? raw.opType ?? payload.opType ?? null;
  // op_status is the server's per-op lifecycle (excel_sync_ops.op_status), returned
  // by kal309_fetch_since: 'accepted' (overlay), 'client_conflict_review' (HALT —
  // never materialize), 'resolved' (keep-app/merged — already settled server-side,
  // advance the frontier WITHOUT re-overlaying), 'materialized' (already applied).
  const opStatus = raw.op_status ?? raw.opStatus ?? payload.op_status ?? payload.opStatus ?? null;
  if (!opUuid || !Number.isFinite(excelRevision) || !markerAnnotationId) return null;
  // We only materialize apply/create ops; review/stale/etc. carry no write.
  if (opType !== 'apply' && opType !== 'create') return null;
  return {
    opUuid,
    excelRevision,
    markerAnnotationId,
    opType,
    opStatus,
    scopeId: payload.scopeId ?? raw.scopeId ?? null,
    moduleId: payload.moduleId ?? raw.moduleId ?? null,
    categoryId: payload.categoryId ?? raw.categoryId ?? null,
    // Token-FREE identity block (the Edge's `identity`; the token-bearing
    // identityRecord is stripped by kal309_sanitize_payload and never reaches the
    // client). Used to seed a created marker's excelSync memory.
    identity: payload.identity && typeof payload.identity === 'object' ? payload.identity : null,
    changedFieldKeys: Array.isArray(payload.changedFieldKeys) ? payload.changedFieldKeys : [],
    fields: payload.fields && typeof payload.fields === 'object' ? payload.fields : null,
    baseFingerprints: payload.baseFingerprints && typeof payload.baseFingerprints === 'object'
      ? payload.baseFingerprints
      : null,
  };
}

// Per-marker READ-MERGE-WRITE with an in-process advisory lock + re-read retry guard.
// Returns { merged:true } on a clean write, or { conflict:true } on a genuine
// app-vs-Excel both-changed conflict (no write performed).
const markerLocks = new Map(); // markerAnnotationId -> Promise chain (advisory, in-process)

async function mergeOneMarker({ op, getMarkers, writeMarker }) {
  const markerId = op.markerAnnotationId;
  // Serialize merges for the SAME marker (advisory; the Yjs write itself is
  // lock-free, so a concurrent local edit inside the write can still clobber —
  // accepted V1 residual race, F9). Chain off any in-flight merge for this marker;
  // the tail is stored so a later waiter queues behind us, and self-cleans when the
  // chain it owns is the current tail (bounded memory).
  const prevTail = markerLocks.get(markerId) || Promise.resolve();
  const run = prevTail.then(() => mergeOneMarkerLocked({ op, getMarkers, writeMarker }));
  // Store a settle-swallowing tail so a rejection never poisons the next waiter.
  const tail = run.then(() => {}, () => {});
  markerLocks.set(markerId, tail);
  try {
    return await run;
  } finally {
    if (markerLocks.get(markerId) === tail) markerLocks.delete(markerId);
  }
}

async function mergeOneMarkerLocked({ op, getMarkers, writeMarker }, attempt = 0) {
  const markerId = op.markerAnnotationId;
  const before = getMarkers() || {};
  const current = before[markerId] ?? null;

  // For an apply op, detect a genuine app-vs-Excel both-changed conflict BEFORE
  // writing. A create op has no prior marker → never a conflict.
  if (op.opType === 'apply' && current) {
    if (await detectAppVsExcelConflict(current, op)) {
      return { conflict: true };
    }
  }

  // Overlay ONLY the op's changedFieldKeys onto a CLONE of the current marker
  // (or a new marker for create). Never touch any other field or marker.
  const base = current ? structuredCloneSafe(current) : newMarkerSkeleton(markerId, op);
  const next = overlayChangedFields(base, op);

  // Re-read just before write; if the marker changed since we read it, retry once
  // under the lock (F9 retry guard). Capped to avoid a livelock.
  const after = getMarkers() || {};
  const stillSame = stableStringify(after[markerId] ?? null) === stableStringify(current);
  if (!stillSame) {
    if (attempt < 2) return mergeOneMarkerLocked({ op, getMarkers, writeMarker }, attempt + 1);
    // The retry cap bounds work; it is never permission to overwrite a newer
    // local edit with a stale clone. Keep the frontier pinned for review.
    return { conflict: true };
  }

  writeMarker(markerId, next);
  return { merged: true };
}

// A genuine app-vs-Excel conflict: for any changed field key, the LIVE marker
// value differs from BOTH the op's stored Excel baseline AND the op's incoming
// Excel value. (If the live value already equals either, there is no contested
// edit to lose — apply is safe.)
async function detectAppVsExcelConflict(marker, op) {
  const base = op.baseFingerprints || {};
  const fields = op.fields || {};

  // Fingerprint the LIVE marker's visible field values with the SAME function the
  // matcher used to produce the stored baseline (no drift), so a per-field equality
  // against the base fingerprint is meaningful — including answer fields, whose
  // fingerprints nest under fieldFingerprints.answers[id] (Codex finding #1; raw
  // equality vs an opaque hash never matched, and the answer keys were mis-read).
  let liveFps = null;
  try {
    const computed = await computeRowFingerprints(markerToRowRecord(marker));
    liveFps = computed?.fieldFingerprints || null;
  } catch {
    liveFps = null; // hashing unavailable → fall back to conservative raw checks below.
  }

  for (const key of op.changedFieldKeys) {
    const liveVal = readMarkerField(marker, key);
    const excelVal = readExcelField(fields, key);
    // If the live value already equals the incoming Excel value there is nothing to
    // lose — the apply is a no-op for this field. (This also covers the blank↔blank
    // case where both sides are empty.)
    if (valuesEqual(liveVal, excelVal)) continue;
    // A conflict requires a TRUSTED baseline to diff against; with NO baseline we
    // cannot prove an app-vs-Excel divergence (that would block every first apply) —
    // defer to the server's Excel-side TOCTOU wall and apply.
    const baseFp = readBaseFingerprint(base, key);
    if (baseFp == null) continue;
    // Compare the LIVE field fingerprint to the stored baseline fingerprint.
    //   * live fp == base fp  → the field is UNCHANGED app-side since the baseline;
    //     only Excel moved → safe to apply (no app edit to lose). This is the correct
    //     "blank field" skip (Codex round-2 finding #1): a blank live field is safe
    //     ONLY when it was ALSO blank at baseline (its fingerprint matches).
    //   * live fp != base fp  → the app changed this field (incl. CLEARING a field
    //     that had a baseline value) independently of Excel → genuine both-changed
    //     conflict → route to review. NEVER silently overwrite an app-side clear.
    // When live hashing is unavailable, conservatively treat a base-present
    // divergence as a conflict (route to review rather than risk a clobber).
    if (liveFps == null) return true;
    const liveFp = readLiveFingerprint(liveFps, key);
    if (liveFp !== baseFp) {
      return true;
    }
  }
  return false;
}

// Map a survey marker into the row-record shape computeRowFingerprints expects
// ({ changedBy, changedDate, item, entity, notes, answers:{[id]:value} }).
function markerToRowRecord(marker) {
  const answers = {};
  const responses = (marker && marker.checklistResponses) || {};
  for (const [id, resp] of Object.entries(responses)) {
    answers[id] = resp ? resp.selection : undefined;
  }
  const note = marker && marker.note;
  return {
    changedBy: marker?.changedBy ?? '',
    changedDate: marker?.changedDate ?? '',
    item: marker?.name ?? '',
    entity: marker?.entityName ?? '',
    notes: (note && typeof note === 'object') ? note.text : note,
    answers,
  };
}

// Read a per-field fingerprint out of a computed fieldFingerprints set, honoring the
// nested answer layout (answers:{[id]:fp}) for `answer:<id>` keys.
function readLiveFingerprint(fps, key) {
  if (!fps || typeof fps !== 'object') return null;
  if (key.startsWith('answer:')) {
    const id = key.slice('answer:'.length);
    return (fps.answers && fps.answers[id]) ?? null;
  }
  return fps[key] ?? null;
}

// Read a marker's value for a changedFieldKey, in the marker's own shape.
function readMarkerField(marker, key) {
  if (!marker || typeof marker !== 'object') return undefined;
  if (key.startsWith('answer:')) {
    const id = key.slice('answer:'.length);
    const resp = marker.checklistResponses && marker.checklistResponses[id];
    return resp ? resp.selection : undefined;
  }
  switch (key) {
    case 'entity': return marker.entityName ?? null;
    case 'notes': return (marker.note && typeof marker.note === 'object') ? marker.note.text : marker.note;
    case 'item': return marker.name ?? null;
    case 'changedBy': return marker.changedBy ?? null;
    case 'changedDate': return marker.changedDate ?? null;
    default: return undefined;
  }
}

// Read the op's incoming Excel value for a changedFieldKey from the payload fields.
function readExcelField(fields, key) {
  if (!fields || typeof fields !== 'object') return undefined;
  if (key.startsWith('answer:')) {
    const id = key.slice('answer:'.length);
    return fields.answers ? fields.answers[id] : undefined;
  }
  if (SCALAR_FIELD_KEYS.includes(key)) return fields[key];
  return undefined;
}

// The op's per-field stored baseline fingerprint, when present. The baseline is the
// matcher's fieldFingerprints shape: scalar keys are flat, but answer fingerprints
// nest under `fields.answers[id]` — so `answer:<id>` keys must read the nested map
// (Codex finding #1: the flat `fields["answer:id"]` lookup always missed).
function readBaseFingerprint(base, key) {
  if (!base || typeof base !== 'object') return null;
  const fields = base.fields || null;
  if (!fields || typeof fields !== 'object') return null;
  if (key.startsWith('answer:')) {
    const id = key.slice('answer:'.length);
    return (fields.answers && fields.answers[id]) ?? null;
  }
  return key in fields ? fields[key] : null;
}

// Overlay ONLY the op's changedFieldKeys onto a CLONE of the marker.
function overlayChangedFields(marker, op) {
  const fields = op.fields || {};
  const next = marker; // already a clone from the caller
  for (const key of op.changedFieldKeys) {
    if (key.startsWith('answer:')) {
      const id = key.slice('answer:'.length);
      const value = fields.answers ? fields.answers[id] : undefined;
      if (!next.checklistResponses || typeof next.checklistResponses !== 'object') {
        next.checklistResponses = {};
      }
      next.checklistResponses = {
        ...next.checklistResponses,
        [id]: { ...(next.checklistResponses[id] || {}), selection: value },
      };
      continue;
    }
    switch (key) {
      case 'entity': {
        // Only the entity NAME travels in the row payload; id/color stay as-is unless
        // the app later resolves them. Write the name so the field stops diverging.
        next.entityName = fields.entity ?? null;
        break;
      }
      case 'notes': {
        const text = fields.notes;
        if (next.note && typeof next.note === 'object') next.note = { ...next.note, text };
        else next.note = { text };
        break;
      }
      case 'item': next.name = fields.item ?? next.name; break;
      case 'changedBy': next.changedBy = fields.changedBy ?? next.changedBy; break;
      case 'changedDate': next.changedDate = fields.changedDate ?? next.changedDate; break;
      default: break;
    }
  }
  // Stamp the marker's excel-sync provenance. For a create, seed it from the op's
  // token-free identity block (the fingerprints the next sync recognizes the row by)
  // so a re-import doesn't create a twin; always overlay the server op identity.
  // (The assignedToken arrives separately via the writeback-job channel — never here.)
  const priorSync = (next.excelSync && typeof next.excelSync === 'object') ? next.excelSync : {};
  const opIdentity = (op.identity && typeof op.identity === 'object') ? op.identity : {};
  const seedSync = (op.opType === 'create') ? opIdentity : {};
  next.excelSync = {
    ...seedSync,
    ...priorSync,
    // Refresh the baseline fingerprints to the JUST-APPLIED row (the op identity the matcher built
    // from the incoming Excel values) so the NEXT edit diffs against the new agreed point. Without
    // this the stored baseline lags the last export, and the next same-field Excel edit reads as a
    // both-sides conflict (Amendment #6 / F9) — the "applies once, then conflicts" symptom. Mirrors
    // the legacy import + export per-marker identity stamp.
    ...(opIdentity.fieldFingerprints ? {
      fieldFingerprints: opIdentity.fieldFingerprints,
      identityVectorFingerprint: opIdentity.identityVectorFingerprint ?? priorSync.identityVectorFingerprint,
      fullRowFingerprint: opIdentity.fullRowFingerprint ?? priorSync.fullRowFingerprint,
    } : {}),
    lastAppliedOpUuid: op.opUuid,
    lastAppliedExcelRevision: op.excelRevision,
    scopeId: op.scopeId ?? priorSync.scopeId ?? null,
  };
  return next;
}

// A minimal new-marker skeleton for a create op (no prior marker). The server
// minted the markerAnnotationId; the app fills geometry later (unplaced import).
// moduleId/categoryId are stamped so the Survey panel + export filters (which key
// markers by module/category) see this row; they come from the op's plan-derived
// identity (Edge payload), falling back to splitting scopeId `${moduleId}:${categoryId}`.
function newMarkerSkeleton(markerId, op) {
  const fields = op.fields || {};
  const { moduleId, categoryId } = resolveScopeIdentity(op);
  return {
    id: markerId,
    name: fields.item ?? '',
    scopeId: op.scopeId ?? null,
    moduleId,
    categoryId,
    checklistResponses: {},
    entityName: null,
    note: {},
    changedBy: fields.changedBy ?? '',
    changedDate: fields.changedDate ?? new Date().toISOString(),
    pageNumber: null,
    bounds: null,
  };
}

// Resolve { moduleId, categoryId } for a create op: prefer the explicit fields on the
// op (Edge stamps them from the plan value), else split scopeId `${moduleId}:${categoryId}`.
function resolveScopeIdentity(op) {
  let moduleId = op.moduleId ?? op.identity?.moduleId ?? null;
  let categoryId = op.categoryId ?? op.identity?.categoryId ?? null;
  if ((moduleId == null || categoryId == null) && typeof op.scopeId === 'string') {
    const idx = op.scopeId.indexOf(':');
    if (idx > 0) {
      if (moduleId == null) moduleId = op.scopeId.slice(0, idx);
      if (categoryId == null) categoryId = op.scopeId.slice(idx + 1);
    }
  }
  return { moduleId, categoryId };
}

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value));
}

function valuesEqual(a, b) {
  if (a === b) return true;
  // Treat null/undefined/'' as equivalent "empty" so a blank Excel cell vs a
  // never-set marker field is not a spurious conflict.
  const emptyA = a == null || a === '';
  const emptyB = b == null || b === '';
  if (emptyA && emptyB) return true;
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export const __test = {
  normalizeOp,
  detectAppVsExcelConflict,
  overlayChangedFields,
  readMarkerField,
  readExcelField,
  valuesEqual,
  FRONTIER_KEY,
  REVIEW_KEY,
};
