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
//   Idempotency key is client_anno_id (== legacy annotation_id == fabricObject.data.id).
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

import { applyFabricCreate } from './crdtAnnotationBridge.js';
import { buildOrigin } from './originBuilder.js';
import { resolveDocumentMetadata, invalidateDocumentMetadata } from '../../services/documentMetadataResolver.js';

const crdtBackfillDebug = (...args) => {
  if (typeof window === 'undefined' || window.__CRDT_BACKFILL_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

// Mirrors annotationCloudSync.js NON_HIGHLIGHT_TYPES (line 26). Backfill
// excludes survey-marker rows entirely (both 'highlight' legacy and 'survey-marker'
// new value) - Excel-sync carve-out, folded into v2.5.
// CONTEXT.md `<decisions>` "SurveyMarkers skipped" (architectural - locked by roadmap).
export const NON_HIGHLIGHT_TYPES_FOR_BACKFILL = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser',
];

// Phase 31 hotfix (2026-05-03) — Supabase / PostgREST default cap.
// supabase/config.toml sets `max_rows = 1000`, matching the standard PostgREST
// default. A bare `.select('*')` is silently truncated to the first 1000 rows
// at the server. The legacy reader (annotationCloudSync.loadPagedAnnotationRows)
// works around this by paginating with `.range(from, to)`. Pre-hotfix the
// backfill SELECT below did NOT paginate, so docs with >1000 non-surveyMarker
// rows imported only the first page and the verified-count gate
// (`yMapSize >= imported`) sealed the doc on a truncated baseline.
const BACKFILL_PAGE_SIZE = 1000;

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

class BackfillCancelled extends Error {}

function assertBackfillCurrent(args) {
  let current = !args?.signal?.aborted;
  if (current && typeof args?.isCurrent === 'function') {
    try { current = !!args.isCurrent(); } catch { current = false; }
  }
  if (!current) throw new BackfillCancelled('The backfill document or account retired.');
}

function rethrowBackfillCancellation(error, args) {
  if (error instanceof BackfillCancelled) throw error;
  assertBackfillCurrent(args);
}

function withBackfillSignal(query, args) {
  return args?.signal && typeof query?.abortSignal === 'function'
    ? query.abortSignal(args.signal)
    : query;
}

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
 * Always returns `{ fabricObject, pageNumber, annotationId }` matching the
 * deserializer contract. The bridge needs `fabricObject.data.id` to be set;
 * we inject it from row.annotation_id when missing.
 */
function deserializeRowDefensive(row) {
  if (!row) throw new Error('row required');
  if (!row.annotation_id) throw new Error('row.annotation_id required');

  let raw = row.annotation_data;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); }
    catch (parseErr) {
      throw new Error(`row ${row.annotation_id}: annotation_data is malformed JSON`);
    }
  }
  raw = raw || {};

  // Production shape has the Fabric JSON nested under `.fabricObject`. Test/
  // legacy shape has the Fabric props at the top level.
  const fabricObject = raw.fabricObject ? { ...raw.fabricObject } : { ...raw };
  const pageNumber = raw.pageNumber ?? row.page_number ?? 1;
  const annotationId = row.annotation_id;

  // Inject stable annoId. Phase 29 bridge reads fabricObject.data.id (line 183
  // of crdtAnnotationBridge.js). Legacy data already has it via
  // serializeFabricObjectToRow (line 178: annotation_id: id) but defense:
  if (!fabricObject.data) fabricObject.data = {};
  if (!fabricObject.data.id) fabricObject.data.id = annotationId;
  // Type is also surfaced at the top level for the bridge's CREATE branch
  // (annoYMap.set('type', fabricJson.type) at line 234).
  if (!fabricObject.type && row.annotation_type) fabricObject.type = row.annotation_type;

  return { fabricObject, pageNumber, annotationId };
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
 * @param {function} [args.isCurrent] - optional synchronous document/account scope predicate
 * @param {AbortSignal} [args.signal] - aborts a queued Web Lock and supported query transports
 * @param {Array<object>} [args.existingHydrateRows] - DB-sync audit #6. Raw legacy
 *   rows already read by the YDocProvider hydrate (annotationCloudSync
 *   loadAllNonSurveyMarkerAnnotations.rawRows). When present, the independent
 *   backfill SELECT loop is skipped and these rows (re-filtered to
 *   NON_HIGHLIGHT_TYPES_FOR_BACKFILL) are imported instead — eliminating the
 *   second full cold-open read of the same row set.
 * @returns {Promise<{ranAs: string, count?: number, imported?: number, skipped?: number, error?: any}>}
 */
export async function runBackfill(args) {
  try {
    assertBackfillCurrent(args);
    const result = await runBackfillCurrent(args);
    assertBackfillCurrent(args);
    return result;
  } catch (error) {
    // Lock rejection is also an await boundary, including predicate-only
    // callers whose transport does not accept AbortSignal.
    try { assertBackfillCurrent(args); } catch (retired) { error = retired; }
    if (error instanceof BackfillCancelled) {
      // Previously committed batches or a cloud request already sent are not
      // undone. A retired caller must never mistake their completion for a seal.
      return { ranAs: 'cancelled', cancelled: true, cutoverCompleted: false };
    }
    throw error;
  }
}

async function runBackfillCurrent(args) {
  const {
    ydoc,
    supabase,
    documentId,
    userId,
  } = args || {};

  // Phase 31 UAT (2026-05-03) — entrance log so the recovery walkthrough can
  // tell whether YDocProvider's backfill effect actually called us. Stripped
  // at Phase 31 close.
  crdtBackfillDebug('[Phase31 UAT] backfill:start ' + JSON.stringify({
    hasYdoc: !!ydoc,
    hasSupabase: !!supabase,
    documentId: documentId || null,
    userId: userId || null,
    markCutoverComplete: !!args?.markCutoverComplete,
  }));

  // Defensive guards - silent no-op if any required input is missing. The
  // caller (Plan 30-06 YDocProvider mount) gates on isCRDTEnabled() before
  // even calling us, but defense-in-depth: never throw inside the provider.
  if (!ydoc || !supabase || !documentId || !userId) {
    return { ranAs: 'noop_missing_inputs' };
  }

  // Phase 31 Plan 04 — cutover short-circuit. If the doc is already sealed
  // (documents.cutover_completed_at is NOT NULL), skip the entire legacy
  // SELECT + import loop entirely. The runtime cost of this read is one row
  // by primary key; the saved cost is potentially thousands of legacy row
  // reads + per-property Y.Map writes per document open.
  //
  // Runs BEFORE the Web Lock acquire so both tabs can cheap-out without
  // contending for the lock. Both tabs will read the same `cutover_completed_at`
  // value from Supabase and both will return early — no double-write risk.
  //
  // Silent fall-through on any read error: if the documents row read fails
  // (network blip, transient auth race, table missing in test fixture), we
  // proceed to the standard backfill flow. Worst case is one redundant import
  // loop on an already-sealed doc; the per-user Y.Doc meta marker
  // (`backfill_done:${userId}`) catches that on the next gate inside
  // runBackfillUnlocked. UX comment: keep the catch silent — auth/network
  // races during boot are normal and should not surface a console error.
  if (args.markCutoverComplete) {
    try {
      const meta = await resolveDocumentMetadata(documentId, { supabase });
      assertBackfillCurrent(args);
      const docRow = meta.cutoverCompletedAt ? { cutover_completed_at: meta.cutoverCompletedAt } : null;
      if (docRow?.cutover_completed_at) {
        // Phase 31 hotfix (2026-05-03 second iteration) — Y.Map degeneracy
        // probe before the cheap-out short-circuit. If local IndexedDB lost
        // its Y.Doc cache (cleared by browser quota, dev-server restart with
        // wipe, switching machines, etc.) the Y.Map can have far fewer
        // entries than the legacy table even though the doc is sealed. Without
        // this probe we'd silently render only what's left in Y.Map and the
        // user sees missing annotations on every open with no recourse.
        //
        // Cheap HEAD count query against legacy. Compare with Y.Map.size; if
        // Y.Map is suspiciously small (less than 95% of legacy or absolute
        // diff >100), DON'T short-circuit — fall through to the paginated
        // import loop. Bridge idempotency makes re-runs on already-imported
        // rows EDIT-branch no-ops (shallowEqual produces zero Y.Map writes),
        // so the cost is one paginated SELECT plus the cheap probe. The seal
        // timestamp stays as-is (we don't unseal); the loop tops up Y.Map.
        const yMapForProbe = args.yMapAnnotations || ydoc.getMap('annotations');
        // 2026-05-04 — IndexedDB-load race guard. The backfill kickoff fires
        // synchronously after the Y.Doc constructor, racing the
        // IndexeddbPersistence load. Pre-guard: if the doc is sealed AND the
        // Y.Map looks empty AND IndexedDB hasn't finished syncing yet, wait
        // up to ~1.5s for IndexedDB to load its cached state. Otherwise the
        // probe sees Y.Map=0, the recovery loop fires, and re-imports
        // duplicate-laden legacy rows on top of (eventual) IndexedDB cache —
        // the dupes-after-dedupe regression.
        let probedSize = (yMapForProbe && typeof yMapForProbe.size === 'number') ? yMapForProbe.size : 0;
        if (probedSize === 0) {
          for (let waitedMs = 0; waitedMs < 1500 && probedSize === 0; waitedMs += 100) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 100));
            assertBackfillCurrent(args);
            probedSize = (yMapForProbe && typeof yMapForProbe.size === 'number') ? yMapForProbe.size : 0;
          }
        }
        const yMapSize = probedSize;
        // 2026-06-03 — Defer the exact-count probe behind the cheap,
        // zero-network health signals. The HEAD count below is a full
        // count(*) over document_annotations and measured ~7.4s on large
        // sealed docs; paying it on every open of an already-deduped,
        // repeatedly-opened doc is pure waste because the dedupe-anchor
        // early-return discards `legacyCount` (returns null) anyway. So we
        // evaluate the dedupe marker, last-good-size anchor, and the hard
        // floor FIRST — all read from the in-memory Y.Doc meta map with no
        // network — and only fire the count for the genuinely ambiguous
        // paths that still need the exact legacy magnitude. The wipe-recovery
        // guards are preserved: every short-circuit below proves health from
        // a signal at least as strong as before, and the hard-floor wipe
        // forces recovery WITHOUT the count.
        const __ymapMeta = ydoc.getMap('meta');
        const dedupeRan = !!__ymapMeta.get('dedupe_pdf_imports_v1_done');
        const lastGoodSize = __ymapMeta.get('dedupe_pdf_imports_v1_last_good_size') || 0;
        const dedupeAnchorOk = lastGoodSize > 0
          ? yMapSize >= Math.floor(lastGoodSize * 0.7)
          : yMapSize > 0;
        // 2026-05-05 — Once PDF-import dedupe has recorded a healthy Y.Doc
        // size, do not compare the sealed Y.Doc to legacy rows again. The
        // legacy table intentionally still contains duplicate Drawboard/PDF
        // imports; re-reading it can repaint jagged duplicate shapes over the
        // smoothed Y.Doc state and makes startup crawl through 20k+ rows.
        // 2026-06-03 — Hoisted ABOVE the count probe. This gate fires for the
        // ~70% common case (sealed + deduped + healthy anchor + non-trivial
        // Y.Map) and used to discard the count result anyway (legacyCount:
        // null). Running it first lets us skip the ~7.4s count entirely.
        if (dedupeRan && dedupeAnchorOk && yMapSize >= 50) {
          crdtBackfillDebug('[Phase31 UAT] backfill:cutover-dedupe-anchor-skip ' + JSON.stringify({
            documentId, userId, yMapSize, lastGoodSize,
          }));
          return {
            ranAs: 'cutover_already_complete_dedupe_anchor',
            cutoverCompleted: true,
            cutoverAt: docRow.cutover_completed_at,
            yMapSize,
            legacyCount: null,
          };
        }
        // 2026-06-03 — Zero-network hard-floor wipe gate. The hard floor
        // (below, lines now ~360) forces recovery whenever the doc is known
        // to have held real-scale data AND the Y.Map is now catastrophically
        // small (<50). When that "known large data" fact comes from the
        // dedupe last-good-size anchor (lastGoodSize >= 50) rather than the
        // legacy count, we already have everything we need to declare a wipe
        // — no count required. Fall through to the recovery loop WITHOUT the
        // probe. This preserves the hard floor exactly for the lastGoodSize
        // limb while letting the count be skipped. (The legacyCount limb of
        // hadLargeKnownData is still honored by the probe path below for docs
        // that have no dedupe anchor.)
        if (lastGoodSize >= 50 && yMapSize < 50) {
          crdtBackfillDebug('[Phase31 UAT] backfill:cutover-hardfloor-wipe-no-probe ' + JSON.stringify({
            documentId, userId, yMapSize, lastGoodSize,
          }));
          // eslint-disable-next-line no-console
          console.warn('[crdtBackfill] cutover sealed but Y.Map < hard floor vs last-good anchor — re-running import loop to recover ' +
            JSON.stringify({ yMapSize, lastGoodSize }));
          // Intentional fall-through to the lock/import path below.
        } else {
        let legacyCount = null;
        let probeOk = false;
        try {
          assertBackfillCurrent(args);
          const { count, error: countErr } = await withBackfillSignal(supabase
            .from('document_annotations')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', documentId)
            .in('annotation_type', NON_HIGHLIGHT_TYPES_FOR_BACKFILL), args);
          assertBackfillCurrent(args);
          if (!countErr && typeof count === 'number') {
            legacyCount = count;
            probeOk = true;
          }
        } catch (_e) {
          rethrowBackfillCancellation(_e, args);
          // Probe failed — be conservative: fall through to the loop so we
          // don't trust a potentially-empty Y.Map.
        }
        const tolerance = probeOk ? Math.max(100, Math.ceil((legacyCount || 0) * 0.05)) : 0;
        // 2026-05-04 — Dedupe-aware health check. After dedupePdfImports
        // trims duplicate-import legacy rows from the Y.Map, yMapSize is
        // legitimately smaller than legacyCount (legacy still holds the
        // duplicate rows). The dedupe marker on yMapMeta is the contract
        // saying "Y.Map has been intentionally trimmed; don't compare to
        // legacy count." When the marker is set we trust Y.Map outright,
        // skipping the recovery loop that would otherwise re-import the
        // duplicates and undo the dedupe on every doc open.
        // 2026-05-04 — Tighter dedupe-aware health check. After dedupe, we
        // know roughly how many entries should be in Y.Map (lastGoodSize).
        // Recovery should re-run if Y.Map has dropped well below that
        // anchor — that's an accidental wipe, not a legitimate state. We
        // tolerate a 30% drop from the last known good (room for user-
        // intentional deletes) but anything smaller triggers recovery.
        // 2026-05-04 — Sanity floor. A previous session wiped Y.Map to 3
        // entries before the lastGoodSize anchor was being written, so
        // dedupeAnchorOk falls back to "yMapSize > 0" and the recovery
        // never fires. If legacy still holds substantial data and Y.Map
        // is suspiciously tiny (<100 against thousands in legacy), force
        // recovery regardless of dedupe marker — that's an orphan-wipe
        // scenario, not legitimate state.
        // 2026-05-04 — Hard floor for sealed docs: a sealed doc that wrote
        // cutover_completed_at had real data at seal time. If Y.Map now
        // holds fewer than 50 entries, that's a wipe regardless of what
        // the dedupe anchor or legacy probe say. The previous anchor-only
        // check was poisoned when an earlier dedupe ran on a wiped Y.Map
        // and recorded 3 as "last known good." This hard floor unblocks
        // recovery without trusting the corrupted anchor.
        const hadLargeKnownData = legacyCount >= 50 || lastGoodSize >= 50;
        const hardFloorBreached = hadLargeKnownData && yMapSize < 50;
        const sanityFloorBreached = hardFloorBreached || (probeOk
          && legacyCount > 1000
          && yMapSize < 100);
        const yMapLooksHealthy =
          sanityFloorBreached
            ? false
            : dedupeRan
              ? dedupeAnchorOk
              : (probeOk && (yMapSize >= (legacyCount || 0) - tolerance));
        crdtBackfillDebug('[Phase31 UAT] backfill:degeneracy-probe ' + JSON.stringify({
          documentId, userId, yMapSize, legacyCount, probeOk, tolerance, yMapLooksHealthy, dedupeRan, lastGoodSize, hardFloorBreached,
        }));
        if (yMapLooksHealthy) {
          return {
            ranAs: 'cutover_already_complete',
            cutoverCompleted: true,
            cutoverAt: docRow.cutover_completed_at,
            yMapSize,
            legacyCount,
          };
        }
        // Y.Map is degenerate vs legacy — keep the seal but force a re-import
        // so the user's annotations come back without manual intervention.
        // eslint-disable-next-line no-console
        console.warn('[crdtBackfill] cutover sealed but Y.Map < legacy count — re-running import loop to recover ' +
          JSON.stringify({ yMapSize, legacyCount }));
        } // end else (count-probe path)
      }
    } catch (err) {
      rethrowBackfillCancellation(err, args);
      // Silent fall-through. eslint-disable to allow the diagnostic warn.
      // eslint-disable-next-line no-console
      console.warn('[crdtBackfill] cutover_completed_at lookup failed', err?.message);
    }
  }

  assertBackfillCurrent(args);
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
  return navigator.locks.request(lockName, {
    mode: 'exclusive', ...(args.signal ? { signal: args.signal } : {}),
  }, async () => {
    assertBackfillCurrent(args);
    return runBackfillUnlocked(args);
  });
}

async function runBackfillUnlocked(args) {
  assertBackfillCurrent(args);
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
  //
  // Phase 31 hotfix (2026-05-03) — when the caller is requesting
  // `markCutoverComplete`, we ALWAYS fall through to the paginated SELECT +
  // import loop, regardless of whether doneKey is set. Reasons:
  //
  //   1. Recovery from the pre-2026-05-03 truncated-import bug. If a previous
  //      session sealed an incomplete Y.Map (because the bare SELECT capped
  //      at 1000 rows), the doneKey marker was set on a truncated baseline.
  //      An admin unseal of cutover_completed_at on the documents row
  //      requires a re-run of the import loop to actually fill in the missing
  //      rows; without falling through here the next open would just re-seal
  //      the same incomplete Y.Map with `ranAs: already_done`.
  //
  //   2. Defense-in-depth against any future bug that lands a partial Y.Map
  //      with the doneKey marker still set. Bridge idempotency (the
  //      meta.authorId existence sentinel inside applyFabricCreate) means
  //      re-running the loop on already-imported rows is a cheap no-op —
  //      shallowEqual produces zero Y.Map writes per already-present row.
  //      Cost is one paginated SELECT plus per-row sentinel checks; benefit
  //      is the gate seals on a verified-against-legacy count.
  //
  //   3. The non-markCutoverComplete pre-Phase-31 caller path (Phase 30
  //      open-doc backfill, no seal request) keeps the original
  //      doneKey-set short-circuit so existing performance characteristics
  //      are preserved on every routine open.
  const doneKey = `${BACKFILL_DONE_PREFIX}${userId}`;
  if (yMapMeta.get(doneKey) && !args.markCutoverComplete) {
    return { ranAs: 'already_done', count: 0 };
  }

  // DB-sync audit #6 — reuse the hydrate keyset rows. On a cold open the
  // YDocProvider hydrate read (annotationCloudSync.loadAllNonSurveyMarkerAnnotations)
  // already keyset-paginated the SAME owned row set with the lean
  // ANNOTATION_READ_COLUMNS projection. When the caller threads those rows in
  // as args.existingHydrateRows we skip the independent backfill SELECT loop
  // entirely — killing the second full cold-open read of a multi-thousand-row
  // document.
  //
  // Completeness invariant: the hydrate raw rows are filtered by
  // isAllTypesOwnedRow (which also admits 'form-field' + legacy surveyMarker
  // rows that carry a fabricObject). Backfill only ever imports
  // NON_HIGHLIGHT_TYPES_FOR_BACKFILL, so we re-apply that exact type filter
  // here. The resulting row set is identical to what the SELECT loop's
  // `.in('annotation_type', NON_HIGHLIGHT_TYPES_FOR_BACKFILL)` would have
  // produced — same idempotency keys, same imported set.
  //
  // When the caller does NOT thread rows in (tests, any non-YDocProvider
  // caller) we fall through to the SELECT loop below, byte-identical to the
  // prior behavior. The loop is kept on OFFSET `.range()` pagination so the
  // existing Phase 31 pagination assertions (crdtBackfill.test.mjs #6) stay
  // green; production now standardizes on the hydrate's keyset rows instead.
  let rows = [];
  let queryError = null;
  let pagesFetched = 0;

  const existingHydrateRows = Array.isArray(args.existingHydrateRows)
    ? args.existingHydrateRows
    : null;

  if (existingHydrateRows) {
    rows = existingHydrateRows.filter(
      (r) => r && NON_HIGHLIGHT_TYPES_FOR_BACKFILL.includes(r.annotation_type)
    );
    crdtBackfillDebug('[Phase31 UAT] backfill:reused-hydrate-rows ' + JSON.stringify({
      documentId, userId,
      hydrateRowsIn: existingHydrateRows.length,
      backfillRowsAfterTypeFilter: rows.length,
    }));
  } else {
  // Read legacy rows. PAGINATED with `.range()` so the PostgREST max_rows cap
  // (1000) does not silently truncate large docs. Pre-2026-05-03 hotfix this
  // was a bare `.select('*')` and any doc with >1000 non-surveyMarker rows sealed
  // on a truncated baseline.
  //
  // Ordering: `page_number ASC` mirrors the production legacy reader
  // (annotationCloudSync.loadPagedAnnotationRows). Captured 2026-05-03 16:42:
  // ordering by `created_at` triggers a full sort over the document's full
  // 22,630-row span on every page request and times out at 10s with PostgREST
  // statement_timeout = 10000ms (Postgres error 57014). The legacy reader
  // doesn't time out under the same data because (document_id, page_number)
  // is the natural index ordering. Backfill creation-order preservation was a
  // soft preference for the Phase 33 activity log; bridge idempotency makes
  // any stable ordering correctness-preserving across re-runs.
  // KAL-282 — DELIBERATELY STILL ON OFFSET `.range()`. Do not migrate this loop
  // to keyset; it is not the same case as getDocumentAnnotations. In production
  // this loop no longer runs at all (YDocProvider threads `existingHydrateRows`
  // in from the hydrate's keyset read), so it is a test/non-provider fallback,
  // and Phase 31's pagination assertions (crdtBackfill.test.mjs #6) pin this
  // exact `.range()` shape.
  crdtBackfillDebug('[Phase31 UAT] backfill:select-loop start ' + JSON.stringify({
    documentId, userId, pageSize: BACKFILL_PAGE_SIZE,
  }));
  try {
    for (let from = 0; ; from += BACKFILL_PAGE_SIZE) {
      assertBackfillCurrent(args);
      const to = from + BACKFILL_PAGE_SIZE - 1;
      const pageStartedAt = Date.now();
      const result = await withBackfillSignal(supabase
        .from('document_annotations')
        .select('*')
        .eq('document_id', documentId)
        .in('annotation_type', NON_HIGHLIGHT_TYPES_FOR_BACKFILL)
        .order('page_number', { ascending: true })
        .range(from, to), args);
      assertBackfillCurrent(args);
      const pageElapsedMs = Date.now() - pageStartedAt;
      if (result?.error) {
        queryError = result.error;
        console.warn('[Phase31 UAT] backfill:select-loop page ERROR ' + JSON.stringify({
          documentId, page: pagesFetched, range: [from, to], pageElapsedMs,
          errorCode: result.error?.code || null,
          errorMessage: result.error?.message || String(result.error),
        }));
        break;
      }
      const pageRows = result?.data || [];
      rows.push(...pageRows);
      pagesFetched++;
      crdtBackfillDebug('[Phase31 UAT] backfill:select-loop page ok ' + JSON.stringify({
        documentId, page: pagesFetched - 1, range: [from, to],
        pageRows: pageRows.length, totalSoFar: rows.length, pageElapsedMs,
      }));
      if (pageRows.length < BACKFILL_PAGE_SIZE) break;
    }
  } catch (err) {
    rethrowBackfillCancellation(err, args);
    queryError = err;
    console.warn('[Phase31 UAT] backfill:select-loop THREW ' + JSON.stringify({
      documentId, pagesFetched, message: err?.message || String(err),
    }));
  }
  }

  if (queryError) {
    console.warn('[Phase31 UAT] backfill:done (failed at SELECT) ' + JSON.stringify({
      ranAs: 'failed',
      documentId, userId, pagesFetched, rowsFetched: rows.length,
      errorCode: queryError?.code || null,
      errorMessage: queryError?.message || String(queryError),
    }));
    // Don't mark done. Next first-open silently retries. CONTEXT.md
    // "Silent retry on partial failure".
    return { ranAs: 'failed', error: queryError };
  }

  let imported = 0;
  let skipped = 0;
  // 2026-05-03 — Targeted diag for "native in-app annotations not showing"
  // regression. Counts each row's annotation_type at the import / skip
  // decision so the closing log line can answer "did all 42 squares + 4
  // freetext + N counters get into Y.Map, or did some kinds silently fail?"
  // Keyed by legacy row.annotation_type (matches the legacy rowsByType log
  // shape) for direct comparison.
  const importedByType = {};
  const skippedByType = {};

  // 2026-05-03 — Batched-transact migration. Pre-batch the loop wrapped each
  // row in two separate ydoc.transact calls (one inside applyFabricCreate,
  // one for the createdAt override). On a 22,630-row migration that fired
  // ~45,000 transactions, each paying observer-fan-out and y-indexeddb
  // commit overhead. Wrapping a window of rows in one outer transact
  // coalesces all inner transacts into a single transaction at the
  // observer level (Yjs nested-transact contract). Phase 33 activity log
  // contract preserved: the outer batchOrigin still carries source =
  // 'crdt-backfill' so the log renders one "Document migrated" row.
  // Per-row meta.authorId attribution still flows through ctx.userId on
  // the bridge call (separate from the transaction-tag origin).
  const BACKFILL_BATCH_SIZE = 100;
  assertBackfillCurrent(args);
  const batchOrigin = buildBackfillOrigin({
    originPayloadFactory,
    userId,
    deviceId: LEGACY_DEVICE_ID,
    sessionId,
    clientID,
  });
  for (let batchStart = 0; batchStart < rows.length; batchStart += BACKFILL_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BACKFILL_BATCH_SIZE, rows.length);
    assertBackfillCurrent(args);
    ydoc.transact(() => {
      for (let i = batchStart; i < batchEnd; i++) {
        assertBackfillCurrent(args);
        const row = rows[i];
        const __rowType = row?.annotation_type || 'unknown';
        try {
          const { fabricObject, pageNumber, annotationId } = deserializeRowDefensive(row);
          fabricObject.pageNumber = pageNumber;

          // Per-row origin still built — used as the inner originPayload arg
          // for applyFabricCreate so the bridge's nested transact carries
          // matching source attribution. The outer batch transact's origin
          // wins at the observer level; this preserves the contract for
          // any code path that inspects originPayload directly.
          const originPayload = buildBackfillOrigin({
            originPayloadFactory,
            userId: row.user_id,
            deviceId: LEGACY_DEVICE_ID,
            sessionId,
            clientID,
          });

          const ctx = {
            userId: row.user_id,                    // sets meta.authorId (Pitfall 30-2 fix)
            deviceId: LEGACY_DEVICE_ID,             // sets meta.deviceId
            sessionId,
            clientID,
          };

          assertBackfillCurrent(args);
          applyFabricCreate(ydoc, yMapAnnotations, fabricObject, originPayload, ctx);

          // Inline createdAt override (no inner transact — coalesced into
          // the outer batch transact). Pitfall 30-1 fix preserved.
          const legacyCreatedAtMs = row.created_at ? new Date(row.created_at).getTime() : Date.now();
          const annoId = fabricObject.data.id || annotationId;
          const annoYMap = yMapAnnotations.get(annoId);
          if (annoYMap) {
            const metaYMap = annoYMap.get('meta');
            if (metaYMap) {
              assertBackfillCurrent(args);
              metaYMap.set('createdAt', legacyCreatedAtMs);
            }
          }

          imported++;
          importedByType[__rowType] = (importedByType[__rowType] || 0) + 1;
        } catch (err) {
          rethrowBackfillCancellation(err, args);
          // eslint-disable-next-line no-console
          console.warn('[crdtBackfill] skipping row', row?.annotation_id, err?.message);
          skipped++;
          skippedByType[__rowType] = (skippedByType[__rowType] || 0) + 1;
        }
      }
    }, batchOrigin);
  }

  // Mark done. Stored INSIDE Y.Doc so it propagates via CRDT sync. A second
  // device opening after the first finished sees the marker and short-circuits.
  // Wrapped in a transact tagged with the backfill origin so Phase 33 sees a
  // clean closing event (single attribution surface for the whole migration).
  assertBackfillCurrent(args);
  const closingOrigin = buildBackfillOrigin({
    originPayloadFactory,
    userId,
    deviceId: LEGACY_DEVICE_ID,
    sessionId,
    clientID,
  });
  assertBackfillCurrent(args);
  ydoc.transact(() => {
    assertBackfillCurrent(args);
    yMapMeta.set(doneKey, Date.now());
  }, closingOrigin);

  // Phase 31 Plan 04 — cutover-completion gate. Only fires when:
  //   1. Caller passed markCutoverComplete: true (YDocProvider's mount effect).
  //   2. Verified count match: yMapAnnotations.size >= imported. The Y.Map
  //      may have MORE entries than `imported` (mid-flight collaborator writes
  //      from other tabs / devices add their own entries during the loop) —
  //      we tolerate that. The match condition we MUST satisfy is "no
  //      imported row is MISSING from the Y.Map." If yMapSize < imported, an
  //      import dropped silently and we conservatively do NOT seal; the next
  //      open will retry the loop and the timestamp stays NULL until success.
  //
  // CONTEXT.md "Risk and Rollback" mitigation: the cutover timestamp is only
  // set after a verified count match. If the backfill fails partway, the doc
  // stays uncutover-flagged and the next open retries.
  //
  // Skipped rows (malformed legacy data we couldn't round-trip) DO NOT block
  // sealing — they were unrenderable in v2.3 and would never be renderable in
  // v2.4 either. Sealing without them is correct.
  let cutoverCompleted = false;
  assertBackfillCurrent(args);
  if (args.markCutoverComplete) {
    // Verified-count match: yMapSize >= imported gates the cutover_completed_at
    // write. CONTEXT.md AC bullet 1 + Risk-and-Rollback mitigation #1.
    const yMapSize = yMapAnnotations.size;
    const expectedMinSize = imported;
    if (yMapSize >= expectedMinSize) {
      try {
        // Count match passed (yMapSize >= imported); seal cutover_completed_at.
        const nowIso = new Date().toISOString();
        assertBackfillCurrent(args);
        const { error: updateError } = await withBackfillSignal(supabase
          .from('documents')
          .update({ cutover_completed_at: nowIso })
          .eq('id', documentId), args);
        assertBackfillCurrent(args);
        if (updateError) {
          // eslint-disable-next-line no-console
          console.warn('[crdtBackfill] cutover_completed_at write failed', updateError?.message);
        } else {
          cutoverCompleted = true;
          // The seal just advanced cutover_completed_at; drop the cached
          // documents-row metadata so a same-open read sees the sealed value.
          invalidateDocumentMetadata(documentId);
        }
      } catch (err) {
        rethrowBackfillCancellation(err, args);
        // eslint-disable-next-line no-console
        console.warn('[crdtBackfill] cutover_completed_at write threw', err?.message);
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('[crdtBackfill] cutover gate skipped — count mismatch', JSON.stringify({
        yMapSize, imported, skipped, expectedMinSize,
      }));
    }
  }

  // Phase 31 UAT (2026-05-03) — single closing log so the recovery walk-
  // through can confirm the loop finished and how the gate resolved without
  // needing to spelunk through individual save events. Stripped at Phase 31
  // close like the other UAT logs.
  crdtBackfillDebug('[Phase31 UAT] backfill:done ' + JSON.stringify({
    ranAs: 'leader',
    documentId,
    userId,
    rowsFetched: rows.length,
    imported,
    skipped,
    yMapSizeAfter: yMapAnnotations.size,
    cutoverRequested: !!args.markCutoverComplete,
    cutoverCompleted,
    importedByType,
    skippedByType,
  }));
  return { ranAs: 'leader', imported, skipped, cutoverCompleted };
}
