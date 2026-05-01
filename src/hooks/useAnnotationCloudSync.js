/**
 * useAnnotationCloudSync — Phase 21.
 *
 * React hook that wires the all-types cloud sync into App.jsx with a
 * minimal surface. Mount it once per open document and it handles:
 *   - Hydrating non-highlight annotations from the cloud on document open
 *   - Running the one-time local-to-cloud migration for stranded marks
 *   - Pushing per-page Fabric state diffs and callout state diffs to the
 *     cloud on change, debounced to avoid hammering Supabase mid-drag
 *   - Subscribing to realtime row changes and merging incoming
 *     inserts/updates/deletes into the local state slices
 *   - Falling back to localStorage when Supabase is unreachable and
 *     replaying queued upserts on reconnect
 *
 * Highlights are intentionally NOT touched — they keep their existing
 * sync path in documentAnnotationService.js.
 */

import { useEffect, useRef, useState } from 'react';
import {
  upsertAnnotationsByPage,
  upsertCallouts,
  loadAllNonHighlightAnnotations,
  subscribeToAllNonHighlightAnnotations,
  deleteAnnotation,
  deleteAnnotations,
  // Phase 30 — dual-write fan-out. Live v2.4 fabric saves write to BOTH the
  // legacy document_annotations row (preserved here for v2.3 reader compat
  // during the dual-write era) AND the CRDT path via the Phase 29 bridge.
  //
  // CONTEXT.md `<decisions>` "Highlights skipped" + Pitfall 30-4 two-layer
  // defense: highlight bypass at THIS call site AND inside the helper.
  //
  // CONTEXT.md AC-15 kill-switch fallback: when isCRDTEnabled() returns false,
  // this hook's behavior is byte-identical to pre-Phase-30 (legacy-only path).
  dualWriteFabricCommit,
  dualWriteFabricDelete,
  NON_HIGHLIGHT_TYPES
} from '../services/annotationCloudSync.js';
import { migrateLocalAnnotationsToCloud, hasMigrationRun } from '../services/cloudSyncMigration.js';
import {
  enqueueSync,
  drainQueue,
  getQueueSize
} from '../services/cloudSyncQueue.js';
import { getAuthSnapshot, supabase } from '../supabaseClient.js';
import { isCRDTEnabled } from '../lib/collab/crdtFeatureFlag.js';
// Phase 31 — legacy bulk-upsert kill switch (Plan 31-02 / 31-03).
// Default OFF means CRDT fan-out (dualWriteFabricCommit per-row) is the SOLE
// writer to the cloud. Default ON (localStorage opt-in `pdf_app_legacy_bulk_upsert`)
// preserves the pre-Phase-31 byte-identical dual-write behavior — emergency
// rollback without redeploy. Source: 31-CONTEXT.md AC bullet 5.
import { isLegacyBulkUpsertEnabled } from '../lib/collab/featureFlags.js';
import { enqueue as enqueueDualWrite, readQueue as readDualWriteQueue } from '../lib/collab/crdtDualWriteQueue.js';
import { useYDoc } from './useYDoc.js';

const DEFAULT_DEBOUNCE_MS = 800; // mid-drag pushes are coalesced into one upsert
// 2026-04-26 — How long to wait before re-asking the cloud when the first read
// came back empty but the device still shows annotations. Long enough for a
// transient auth/replica race to finish; short enough that it does not feel
// like a stall when the device legitimately has nothing.
const EMPTY_CLOUD_VERIFY_DELAY_MS = 1000;
const RECENT_CLOUD_REFRESH_SKIP_MS = 15000;

/**
 * @param {object} args
 * @param {string|null} args.documentId        - Supabase document ID (UUID)
 * @param {string|null} args.userId            - Supabase user ID (UUID)
 * @param {string|null} args.pdfId             - Local localStorage key suffix
 * @param {object} args.annotationsByPage      - { [pageNum]: { objects: [...] } }
 * @param {Array}  args.callouts               - [{ id, pageNumber, anchor, knee, label, ... }]
 * @param {Function} args.setAnnotationsByPage - React setter
 * @param {Function} args.setCallouts          - React setter
 * @param {boolean} [args.enabled=true]        - Master switch (e.g. user toggled cloud sync off)
 * @param {number}  [args.debounceMs=800]      - Push debounce window
 *
 * @returns {{ status: object, queueSize: number, forceFlush: () => Promise<void> }}
 */
export function useAnnotationCloudSync({
  documentId,
  userId,
  pdfId,
  annotationsByPage,
  callouts,
  setAnnotationsByPage,
  setCallouts,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS
} = {}) {
  const [status, setStatus] = useState({ stage: 'idle' });
  const [queueSize, setQueueSize] = useState(0);

  // Phase 30 — read the per-document Y.Doc + originBuilder factory + per-user
  // undo ctx from the YDocProvider context (Plan 27-05 mount point; rules-of-
  // hooks safe because useYDoc returns a frozen null-shape when CRDT is off,
  // so the hook is safe to call unconditionally per Phase 27/28/29 precedent).
  // When phase30Ydoc is null (kill switch off OR provider not mounted yet),
  // every fan-out site short-circuits before calling dualWriteFabricCommit —
  // the legacy upsertAnnotationsByPage / deleteAnnotations behavior is
  // byte-identical to pre-Phase-30 (CONTEXT.md AC-15 kill-switch fallback).
  const {
    ydoc: phase30Ydoc,
    getOriginContext: phase30OriginCtx,
    undoCtx: phase30UndoCtx
  } = useYDoc();

  const lastByPageRef = useRef(null);
  const lastCalloutsRef = useRef(null);
  const debounceTimerRef = useRef(null);
  // 2026-04-30 — Audit hardening (finding #10): annotations drawn in the
  // last 800ms before the user closes the tab were silently lost because the
  // debounce timer was cleared on unmount and the upsert never fired. These
  // refs hold the most recently scheduled debounced push as a "pending flush"
  // function so a beforeunload listener (and the effect cleanup) can fire it
  // immediately. Set when the timer is scheduled, cleared either when the
  // timer fires normally OR after the flush runs. Calling a null ref is a
  // no-op (idempotent).
  const pendingFabricFlushRef = useRef(null);
  const pendingCalloutFlushRef = useRef(null);
  const hydratedRef = useRef(false);
  const startupSyncInFlightRef = useRef(false);
  const lastCloudRefreshAtRef = useRef(0);
  // 2026-04-30 (Phase 35 Plan 05) — RETIRED: per-session "user just deleted
  // these IDs" sets (formerly fabric + callout). Their job was to stop the
  // focus-rehydrate from resurrecting annotations the user had just deleted
  // locally while the diff-detection delete suppression block held back the
  // cloud delete. With per-user delete authority shipped (Phase 35 Plans
  // 03/04) the suppression block itself is gone and deletes propagate to the
  // cloud unconditionally — there is no longer a "deleted locally, still in
  // the cloud" gap to paper over. See Phase 35 CONTEXT.md "Brake retirement"
  // decision.
  // 2026-04-27 — diagnostic refs for tracking annotations state changes
  // outside the cloud-sync hook's own setters. If something in App.jsx
  // shrinks the state without the cloud-sync hook knowing, the next push
  // would interpret the shrink as a delete and cascade it to the cloud.
  const prevAnnotationsByPageObsRef = useRef(undefined);
  const prevCalloutsObsRef = useRef(undefined);

  // (Removed 2026-04-25: skipNextFabricPushRef / skipNextCalloutPushRef
  // suppressed the first post-hydrate push to dodge a runaway-id bug.
  // That bug is fixed now and the suppression caused divergence —
  // localStorage rows never reached the cloud. Always push diffs.)

  // Per-tab / per-Electron-process session id used by the echo filter so
  // the same user's OTHER device (a different session) still receives live
  // updates. Generated once per hook lifetime; survives across documents.
  const sessionIdRef = useRef(null);
  if (sessionIdRef.current === null) {
    const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionIdRef.current = rnd;
    console.log('[CloudSync][hook] session id minted ' + JSON.stringify({ sessionId: rnd }));
  }
  const clientSessionId = sessionIdRef.current;

  // (Removed 2026-04-25: recentlyPushedRef set + markPushedIds + isRecentlyPushed.
  // The set was too aggressive — full-state bulk pushes added every id, blocking
  // legitimate cross-device edits to those ids. The service-side session-id
  // filter handles own-write echoes correctly on its own.)

  // ---- Phase 30 — CRDT-side fan-out helpers ------------------------------
  //
  // Per-annotation CRDT-side fan-out called AFTER each legacy bulk upsert /
  // delete lands. Runs only when the kill switch is on AND a Y.Doc is mounted
  // (CONTEXT.md AC-15 kill-switch fallback: when isCRDTEnabled() returns false
  // OR phase30Ydoc is null, the fan-out is a no-op and the hook's pre-Phase-30
  // legacy-only behavior is byte-identical).
  //
  // Each fabric object is dispatched through dualWriteFabricCommit with
  // skipLegacy: true so the legacy row is not double-written (the bulk
  // upsertAnnotationsByPage already fired before this fan-out runs).
  //
  // Pitfall 30-4 two-layer highlight defense:
  //   - Layer 1 (HERE): the call site filters out annotation_type === 'highlight'
  //     AND annotation_type === 'callout' AND non-NON_HIGHLIGHT_TYPES — never
  //     even invokes the dual-write helper for them.
  //   - Layer 2 (helper): annotationCloudSync.js dualWriteFabricCommit also
  //     internally checks isHighlight and returns { crdt: null }.
  //
  // Callouts: ride the legacy upsertCallouts path unchanged through Phase 30.
  // Callout migration is v2.5 scope; out of Phase 30 boundary.
  const fanOutCrdtForAnnotationsByPage = async (annotationsByPageArg, opts) => {
    // Phase 31 diag (2026-05-01): log gate state so a single Cmd+Shift+L
    // snapshot tells us exactly why the new CRDT writer is silent under the
    // post-cutover kill switch. Remove once root cause is identified.
    const __crdtOn = isCRDTEnabled();
    const __ydocPresent = !!phase30Ydoc;
    if (!__crdtOn || !__ydocPresent) {
      console.warn('[Phase31 diag] CRDT fan-out short-circuit ' + JSON.stringify({
        isCRDTEnabled: __crdtOn,
        phase30YdocTruthy: __ydocPresent,
        reason: !__crdtOn ? 'crdt-disabled' : 'ydoc-null',
        documentId: opts?.documentId,
        userId: opts?.userId
      }));
      return;
    }
    let yMapAnnotations;
    try {
      yMapAnnotations = phase30Ydoc.getMap('annotations');
    } catch (e) {
      console.warn('[Phase31 diag] CRDT fan-out getMap threw ' + JSON.stringify({
        error: e?.message || String(e),
        documentId: opts?.documentId
      }));
      return;
    }
    const originPayload = (typeof phase30OriginCtx === 'function') ? phase30OriginCtx() : null;
    const ctx = phase30UndoCtx || null;
    let __dispatched = 0;
    let __skippedType = 0;
    let __pages = 0;
    for (const page of Object.values(annotationsByPageArg || {})) {
      if (!page || !Array.isArray(page.objects)) continue;
      __pages += 1;
      for (const fabricObj of page.objects) {
        const annotation_type = fabricObj?.data?.annotationType || fabricObj?.type;
        // Layer 1 highlight bypass + callout bypass at the call site.
        if (annotation_type === 'highlight') { __skippedType += 1; continue; }
        if (annotation_type === 'callout') { __skippedType += 1; continue; }
        if (!NON_HIGHLIGHT_TYPES.includes(annotation_type)) { __skippedType += 1; continue; }
        try {
          await dualWriteFabricCommit(fabricObj, {
            ...(opts || {}),
            ydoc: phase30Ydoc,
            yMapAnnotations,
            originPayload,
            ctx,
            annotation_type,
            skipLegacy: true,  // legacy bulk upsert already fired before this fan-out
          });
          __dispatched += 1;
        } catch (_err) {
          // Helper enqueues failures internally — no further action needed here.
        }
      }
    }
    console.log('[Phase31 diag] CRDT fan-out completed ' + JSON.stringify({
      dispatched: __dispatched,
      skippedType: __skippedType,
      pagesScanned: __pages,
      documentId: opts?.documentId
    }));
  };

  const fanOutCrdtForDeletedIds = async (documentId, deletedIds, opts) => {
    if (!isCRDTEnabled() || !phase30Ydoc) return;
    if (!Array.isArray(deletedIds) || deletedIds.length === 0) return;
    let yMapAnnotations;
    try {
      yMapAnnotations = phase30Ydoc.getMap('annotations');
    } catch (_e) {
      return;
    }
    const originPayload = (typeof phase30OriginCtx === 'function') ? phase30OriginCtx() : null;
    for (const annoId of deletedIds) {
      try {
        await dualWriteFabricDelete(documentId, annoId, {
          ...(opts || {}),
          ydoc: phase30Ydoc,
          yMapAnnotations,
          originPayload,
          // Generic 'fabric' tag; helper does not filter by this on deletes
          // (highlight bypass on delete is opt-in via opts.annotation_type).
          // Callouts ride legacy and use deleteAnnotations directly, so this
          // helper is never called for them.
          annotation_type: 'fabric',
          skipLegacy: true,  // legacy bulk delete already fired before this fan-out
        });
      } catch (_err) {
        // Helper enqueues failures internally.
      }
    }
  };

  // ---- 2026-04-27 — state-mutation observer ------------------------------
  //
  // Logs EVERY change to annotationsByPage and callouts coming from outside
  // this hook (any setAnnotationsByPage call in App.jsx). When the state
  // count shrinks, also captures a stack trace so the next reproduction can
  // pinpoint exactly which call site caused the divergence. Independent of
  // the push-debouncer logging — runs even when state===lastByPageRef so
  // we still see "innocent" state churn for context.
  useEffect(() => {
    const prev = prevAnnotationsByPageObsRef.current;
    prevAnnotationsByPageObsRef.current = annotationsByPage;
    const prevCount = countFabricObjects(prev);
    const currentCount = countFabricObjects(annotationsByPage);
    if (prev === undefined) {
      console.log('[CloudSync][hook][state-obs] annotationsByPage initial ' + JSON.stringify({
        currentCount,
        pages: Object.keys(annotationsByPage || {}).length,
        hydrated: hydratedRef.current
      }));
      return;
    }
    if (prev === annotationsByPage) return;
    const delta = currentCount - prevCount;
    const sameRefAsLastByPage = annotationsByPage === lastByPageRef.current;
    const baseRecord = {
      prevCount,
      currentCount,
      delta,
      hydrated: hydratedRef.current,
      sameRefAsLastByPage
    };
    if (currentCount < prevCount) {
      const stack = (new Error()).stack?.split('\n').slice(2, 8).join(' | ') || 'no-stack';
      console.warn('[CloudSync][hook][state-obs] SHRINK ' + JSON.stringify({ ...baseRecord, stack }));
    } else {
      console.log('[CloudSync][hook][state-obs] change ' + JSON.stringify(baseRecord));
    }
  }, [annotationsByPage]);

  useEffect(() => {
    const prev = prevCalloutsObsRef.current;
    prevCalloutsObsRef.current = callouts;
    const prevCount = calloutCountSafe(prev);
    const currentCount = calloutCountSafe(callouts);
    if (prev === undefined) {
      console.log('[CloudSync][hook][state-obs] callouts initial ' + JSON.stringify({
        currentCount, hydrated: hydratedRef.current
      }));
      return;
    }
    if (prev === callouts) return;
    const sameRefAsLastCallouts = callouts === lastCalloutsRef.current;
    const baseRecord = {
      prevCount,
      currentCount,
      delta: currentCount - prevCount,
      hydrated: hydratedRef.current,
      sameRefAsLastCallouts
    };
    if (currentCount < prevCount) {
      const stack = (new Error()).stack?.split('\n').slice(2, 8).join(' | ') || 'no-stack';
      console.warn('[CloudSync][hook][state-obs] callout SHRINK ' + JSON.stringify({ ...baseRecord, stack }));
    } else {
      console.log('[CloudSync][hook][state-obs] callout change ' + JSON.stringify(baseRecord));
    }
  }, [callouts]);

  // ---- Hydrate + migrate on document open --------------------------------

  useEffect(() => {
    console.log('[CloudSync][hook] hydrate effect fired ' + JSON.stringify({
      enabled, documentId, userId, pdfId
    }));
    if (!enabled || !documentId || !userId || !pdfId) {
      console.log('[CloudSync][hook] hydrate skipped — missing prerequisite ' + JSON.stringify({
        enabled, hasDocumentId: !!documentId, hasUserId: !!userId, hasPdfId: !!pdfId
      }));
      return;
    }
    let cancelled = false;
    hydratedRef.current = false;
    startupSyncInFlightRef.current = true;
    // 2026-04-30 (Phase 35 Plan 05) — REMOVED: userDeleted*IdsRef resets here
    // (the refs themselves are gone — see brake-retirement comment over the
    // ref declarations above).

    (async () => {
      let cloud = null;
      try {
        setStatus({ stage: 'hydrating' });
        console.log('[CloudSync][hook] stage=hydrating');

        // Phase 31 Plan 04 — cutover-aware hydrate branch.
        //
        // If documents.cutover_completed_at is NOT NULL, the doc has been
        // sealed: every legacy row has been copied into the Y.Doc and the
        // legacy SELECT path is wasted work. Read state from the Y.Doc
        // snapshot instead and skip loadCloudWithEmptyVerify entirely.
        // CONTEXT.md AC bullet 1: 500+ row docs must render in under 3
        // seconds post-cutover; the Y.Doc is already in-memory after the
        // Phase 27 IndexeddbPersistence hydrate, so the round-trip is
        // essentially free vs the legacy SELECT cost.
        //
        // Cold-doc fallback (cutover_completed_at NULL): fall through to
        // the existing loadCloudWithEmptyVerify path verbatim. Plan 31-04's
        // backfill kicks off in YDocProvider's mount effect; first open
        // seeds the Y.Doc + writes the timestamp, second open hits this
        // branch.
        //
        // UX comment: silent fall-through on read error. If the Supabase
        // SELECT errors (transient network race, schema not yet migrated
        // in dev fixture), we proceed with the legacy hydrate. Worst case
        // is one redundant SELECT on a sealed doc.
        let cutoverTs = null;
        try {
          if (supabase) {
            const { data: docRow } = await supabase
              .from('documents')
              .select('cutover_completed_at')
              .eq('id', documentId)
              .maybeSingle();
            cutoverTs = docRow?.cutover_completed_at ?? null;
          }
        } catch (cutoverErr) {
          console.warn('[CloudSync][hook] cutover_completed_at lookup failed: ' +
            (cutoverErr?.message || String(cutoverErr)));
        }
        if (cancelled) return;
        // When cutover_completed_at is set we read state from phase30Ydoc.getMap('annotations');
        // when null we fall through to the legacy loadCloudWithEmptyVerify path.
        if (cutoverTs && phase30Ydoc) {
          // Sealed doc — populate annotationsByPage from the Y.Map snapshot.
          // Phase 29 bridge shape (crdtAnnotationBridge.applyFabricCommit):
          //   annoYMap.get('id')         -> string annoId (top-level)
          //   annoYMap.get('type')       -> string Fabric type (top-level)
          //   annoYMap.get('pageNumber') -> number 1-based page (top-level)
          //   annoYMap.get('fabric')     -> Y.Map of per-property fabric JSON
          //   annoYMap.get('meta')       -> Y.Map of attribution / timestamps
          //
          // Per-property writes (no clear-and-set) means we materialize the
          // Fabric JSON by iterating fabricYMap.entries() and assembling the
          // object. setAnnotationsByPage takes { [pageNum]: { version, objects } }
          // so we group per pageNumber.
          console.log('[CloudSync][hook] cutover-complete hydrate — reading from Y.Doc ' +
            JSON.stringify({ documentId, cutoverTs }));
          let yMap;
          try { yMap = phase30Ydoc.getMap('annotations'); } catch (_e) { yMap = null; }
          const byPage = {};
          if (yMap && typeof yMap.forEach === 'function') {
            yMap.forEach((annoYMap) => {
              if (!annoYMap || typeof annoYMap.get !== 'function') return;
              const pageNumber = annoYMap.get('pageNumber') ?? 1;
              // Materialize fabric props from the per-property Y.Map.
              const fabricYMap = annoYMap.get('fabric');
              let fabricObj = null;
              if (fabricYMap) {
                if (typeof fabricYMap.toJSON === 'function') {
                  try { fabricObj = fabricYMap.toJSON(); } catch (_e) { fabricObj = null; }
                }
                if (!fabricObj && typeof fabricYMap.forEach === 'function') {
                  fabricObj = {};
                  fabricYMap.forEach((v, k) => { fabricObj[k] = v; });
                }
              }
              if (!fabricObj) return;
              if (!byPage[pageNumber]) byPage[pageNumber] = { version: '5.3.0', objects: [] };
              byPage[pageNumber].objects.push(fabricObj);
            });
          }
          setAnnotationsByPage(() => {
            // Update lastByPageRef.current synchronously inside the setter so
            // the push useEffect's identity check (state === lastRef) returns
            // true and we don't echo the Y.Doc snapshot right back out as if
            // it were a local change.
            lastByPageRef.current = byPage;
            return byPage;
          });
          hydratedRef.current = true;
          startupSyncInFlightRef.current = false;
          setStatus({
            stage: 'synced',
            count: (yMap && typeof yMap.size === 'number') ? yMap.size : 0,
            source: 'ydoc-snapshot',
            cutoverTs,
          });
          return; // Skip the legacy SELECT path entirely.
        }
        // Cold-doc fallback (or kill-switch off / no Y.Doc mounted yet) —
        // flow into the existing legacy hydrate below verbatim.

        // 2026-04-26 — capture local counts at fire time so the verify helper
        // can decide whether an empty cloud read should be trusted on its own
        // or re-asked once. annotationsByPage / callouts here are the closure
        // values React handed us when the effect committed.
        const localFabricAtHydrate = countFabricObjects(annotationsByPage);
        const localCalloutAtHydrate = calloutCountSafe(callouts);
        cloud = await loadCloudWithEmptyVerify(documentId, {
          localFabricCount: localFabricAtHydrate,
          localCalloutCount: localCalloutAtHydrate,
          contextLabel: 'initial-hydrate'
        });
        lastCloudRefreshAtRef.current = Date.now();
        if (cancelled) {
          console.log('[CloudSync][hook] hydrate cancelled mid-flight');
          return;
        }
        if (cloud.error) {
          console.error('[CloudSync][hook] hydrate error ' + (cloud.error?.message || String(cloud.error)));
          setStatus({ stage: 'error', error: cloud.error, phase: 'hydrate' });
        } else {
          // 2026-04-26 — Cloud is the source of truth on hydrate. Previously
          // the merge was additive (only added cloud rows that weren't in
          // local), which meant deletions made on another device came back
          // when this device opened the doc — local cache still had the
          // deleted rows. Now we REPLACE local state with cloud's state on
          // hydrate. Local-only annotations that were never pushed are still
          // safe because the migration step below will push them up before
          // any subsequent state changes hit. Empty cloud falls through to
          // the existing migration helper which pushes localStorage to
          // cloud, so the "first time on this device" boot still works.
          // 2026-04-25 — Fully authoritative replacement only AFTER the
          // one-time local→cloud migration has run for this (user, doc).
          // Before migration runs, local may hold rows that have never
          // reached the cloud, so we must preserve them; the migration
          // step below will push them up. After migration, an empty cloud
          // snapshot means "the user truly has nothing here" and we
          // unconditionally replace local — this is what fixes the bug
          // where a callout deleted on another device kept reappearing on
          // a fresh boot because cloud was empty and the old guard
          // (`if (cloudHas…)`) skipped the replace.
          const migrationDone = hasMigrationRun(userId, documentId);
          const cloudFabricPages = cloud.annotationsByPage
            ? Object.keys(cloud.annotationsByPage).length : 0;
          const cloudCalloutCount = Array.isArray(cloud.callouts)
            ? cloud.callouts.length : 0;
          const replaceFabric = migrationDone || cloudFabricPages > 0;
          const replaceCallouts = migrationDone || cloudCalloutCount > 0;
          if (replaceFabric) {
            console.log('[CloudSync][hook] replacing local fabric state with cloud (cloud is authoritative) ' + JSON.stringify({
              pages: cloudFabricPages, migrationDone
            }));
            setAnnotationsByPage(() => {
              // Update lastByPageRef.current synchronously inside the setter
              // so the push useEffect's identity check (state === lastRef)
              // returns true and we don't echo the cloud snapshot right back
              // up as if it were a local change.
              const next = cloud.annotationsByPage || {};
              lastByPageRef.current = next;
              return next;
            });
          }
          if (replaceCallouts) {
            console.log('[CloudSync][hook] replacing local callouts with cloud (cloud is authoritative) ' + JSON.stringify({
              count: cloudCalloutCount, migrationDone
            }));
            setCallouts(() => {
              const next = Array.isArray(cloud.callouts) ? cloud.callouts : [];
              lastCalloutsRef.current = next;
              return next;
            });
          }
        }

        setStatus({ stage: 'migrating' });
        console.log('[CloudSync][hook] stage=migrating (one-time local→cloud push)');
        const migration = await migrateLocalAnnotationsToCloud({
          documentId,
          userId,
          pdfId,
          existingCloudResult: cloud,
          onStatus: (s) => {
            if (!cancelled) {
              console.log('[CloudSync][hook] migration progress ' + JSON.stringify(s));
              setStatus({ stage: 'migrating', ...s });
            }
          }
        });
        if (cancelled) return;
        if (migration.error) {
          console.error('[CloudSync][hook] migration error ' + (migration.error?.message || String(migration.error)));
          setStatus({ stage: 'error', error: migration.error, phase: 'migrate' });
        } else {
          hydratedRef.current = true;
          // 2026-04-25 (revised): we used to set skipNext*PushRef here to
          // avoid pushing the merged state back to cloud on first open,
          // which was a workaround for an old runaway-id bug. Now that the
          // serializer stamps stable ids, that push is safe and necessary
          // — without it, anything in localStorage that doesn't yet exist
          // in cloud never reaches the other devices. Let the normal
          // push effect fire so local catches up to cloud at open time.
          console.log('[CloudSync][hook] hydrate+migrate complete — push gate OPEN ' + JSON.stringify({
            migrationPushed: migration.pushed
          }));
          setStatus({ stage: 'idle', migrationPushed: migration.pushed });
        }

        setQueueSize(getQueueSize(documentId));
      } finally {
        if (!cancelled) startupSyncInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      startupSyncInFlightRef.current = false;
    };
  }, [enabled, documentId, userId, pdfId, setAnnotationsByPage, setCallouts]);

  // ---- Debounced push on state change ------------------------------------

  useEffect(() => {
    if (!enabled || !documentId || !userId) return;
    if (!hydratedRef.current) {
      console.log('[CloudSync][hook] fabric push skipped — not hydrated yet');
      return;
    }
    if (annotationsByPage === lastByPageRef.current) return;

    // Capture the prior baseline BEFORE we overwrite lastByPageRef with the
    // current state — otherwise priorByPage and the new state are the same
    // reference, the diff below short-circuits, and eraser deletions never
    // reach the cloud (logged as a 2026-04-25 root-cause for the eraser
    // sync flicker — erases would visually revert because the cloud row
    // persisted and the next remote echo painted it back).
    const priorByPage = lastByPageRef.current;
    lastByPageRef.current = annotationsByPage;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const pageCount = Object.keys(annotationsByPage || {}).length;
    const objectCount = Object.values(annotationsByPage || {}).reduce(
      (n, p) => n + (Array.isArray(p?.objects) ? p.objects.length : 0),
      0
    );
    // 2026-04-26 — extra trace so we can see EVERY scheduled push, including
    // the prior-vs-new object counts. If this ever logs "priorObjects:N
    // currentObjects:0 — DESTRUCTIVE WIPE PUSH", it means a path mutated
    // local state without updating lastByPageRef in lock-step (the protective
    // pattern used throughout this hook). That would be the destructive
    // empty-push that explains a peer device going blank.
    const priorObjectCount = countFabricObjects(priorByPage);
    const isWipePush = objectCount === 0 && priorObjectCount > 0;
    if (isWipePush) {
      console.warn('[CloudSync][hook][SUSPICIOUS] fabric push scheduled with WIPE diff ' + JSON.stringify({
        priorObjects: priorObjectCount,
        currentObjects: objectCount,
        priorPages: priorByPage ? Object.keys(priorByPage).length : 0,
        currentPages: pageCount,
        priorRef: priorByPage === null ? 'null' : 'object',
        currentRef: annotationsByPage === null ? 'null' : 'object'
      }));
    }
    console.log('[CloudSync][hook] fabric state changed — debounce push scheduled ' + JSON.stringify({
      pageCount,
      objectCount,
      priorObjectCount,
      isWipePush,
      debounceMs
    }));

    // 2026-04-30 — Audit hardening (finding #10): factor the debounced work
    // into a named runner so beforeunload / unmount can call it synchronously
    // (fire-and-forget) when the timer hasn't elapsed yet. After the runner
    // executes (either via timer or via flush), the pendingFabricFlushRef is
    // cleared so subsequent flush calls are no-ops (idempotent).
    const runFabricPush = async () => {
      // Mark as consumed up-front so a concurrent beforeunload + timer race
      // can't fire the same push twice. First caller wins; second caller sees
      // a null ref and bails.
      if (pendingFabricFlushRef.current !== runFabricPush) return;
      pendingFabricFlushRef.current = null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      console.log('[CloudSync][hook] fabric push debounce elapsed — pushing now');
      // 2026-04-25 — status pulse: flip to 'syncing' the moment the push
      // starts so the corner chip shows the orange spinner. The push only
      // takes ~150-300ms so this can be brief, but the user wanted clear
      // feedback that something is in flight.
      setStatus({ stage: 'syncing' });

      // Detect deletions: ids that were in the prior baseline but are no
      // longer in the current state (eraser tool, manual delete, etc.).
      // Without this step the cloud row would persist and the other device
      // would still see the erased annotation.
      const currentIds = new Set();
      for (const page of Object.values(annotationsByPage || {})) {
        if (!page || !Array.isArray(page.objects)) continue;
        for (const obj of page.objects) {
          const id = obj?.id || obj?.data?.id;
          if (id) currentIds.add(id);
        }
      }
      const deletedIds = [];
      if (priorByPage && priorByPage !== annotationsByPage) {
        for (const page of Object.values(priorByPage || {})) {
          if (!page || !Array.isArray(page.objects)) continue;
          for (const obj of page.objects) {
            const id = obj?.id || obj?.data?.id;
            if (id && !currentIds.has(id)) deletedIds.push(id);
          }
        }
      }
      // 2026-04-30 (Phase 35 Plan 05) — RETIRED: 2026-04-27 diff-detection
      // delete-suppression block. The block suppressed cloud deletes when
      // local state went from N>0 to 0 in a single tick. With per-user delete
      // authority shipped (Phase 35 Plans 03/04) a single user can no longer
      // remove other users' work — selection / eraser / marquee gestures are
      // scoped to the viewer's own annotations and bulk-delete-of-mixed-
      // authors goes through a confirmation modal. The original cross-device
      // race concern is resolved by permission scoping, not suppression.
      // Deletes now propagate unconditionally on diff detection.
      if (deletedIds.length > 0) {
        console.log('[CloudSync][hook] eraser/delete detected — removing rows from cloud ' + JSON.stringify({
          count: deletedIds.length,
          firstFew: deletedIds.slice(0, 5)
        }));
        try {
          // Phase 31 — kill switch mirror of Site A. Default off skips the
          // legacy bulk delete; the CRDT fan-out below is the sole writer.
          // The `delResult` shape preserved as `{ success: true }` so the
          // downstream success branch (which runs `fanOutCrdtForDeletedIds`
          // and dispatches `crdt:deletions-resolved`) executes verbatim.
          let delResult;
          if (isLegacyBulkUpsertEnabled()) {
            delResult = await deleteAnnotations(documentId, deletedIds);
          } else {
            delResult = { success: true };
          }
          if (!delResult.success) {
            console.warn('[CloudSync][hook] cloud delete failed ' + JSON.stringify({
              error: delResult.error?.message || String(delResult.error)
            }));
            // 2026-04-30 — surface unsaved deletion to the user via the banner.
            // YDocProvider listens and flips on the deletion-warning copy.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('crdt:deletions-pending'));
            }
          } else {
            // Phase 30 — CRDT-side delete fan-out per annoId. Runs only when
            // kill switch is on AND Y.Doc is mounted. skipLegacy: true (legacy
            // bulk delete just succeeded above).
            await fanOutCrdtForDeletedIds(documentId, deletedIds, { userId });
            // 2026-04-30 — clear any prior deletion-warning banner. A subsequent
            // delete made it through, so the user's earlier failure was transient.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('crdt:deletions-resolved'));
            }
          }
        } catch (err) {
          console.warn('[CloudSync][hook] cloud delete threw ' + (err?.message || String(err)));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('crdt:deletions-pending'));
          }
        }
      }

      // Phase 31 — kill switch (CONTEXT.md AC bullet 5). Default off skips
      // the legacy bulk-upsert entirely; the CRDT fan-out below is the sole
      // writer to the cloud. localStorage opt-in
      // (`pdf_app_legacy_bulk_upsert: 'true'`) re-engages the legacy path
      // for emergency rollback. When the gate is closed, `result` is a
      // success-shaped no-op so the downstream `else` branch (CRDT fan-out)
      // runs verbatim — byte-identical to the post-cutover contract.
      let result;
      if (isLegacyBulkUpsertEnabled()) {
        result = await upsertAnnotationsByPage(annotationsByPage, { documentId, userId, pdfId, clientSessionId });
      } else {
        result = { data: [], error: null };
      }
      if (result.error) {
        // Phase 30 fix (2026-04-29 v2): when the legacy bulk upsert fails,
        // surface it through the new dual-write queue too so sync_queue_stuck
        // can fire on real legacy failures. ONLY enqueue annotations that are
        // newly-added vs the prior baseline (priorByPage) — never the whole
        // document. A first-open bulk-fail with thousands of imported PDF rows
        // would otherwise flood the queue and pop the banner instantly on the
        // next session. By keying on the delta, a fresh app start with no new
        // user activity enqueues nothing.
        if (isCRDTEnabled()) {
          // Resolve the stable per-annotation id. Same precedence as the
          // canonical serializeFabricObjectToRow: highlightId beats Fabric's
          // own id, which beats the app metadata id. Without highlightId in
          // this list, freshly-drawn pen strokes (which carry only
          // fabricObj.highlightId until first push) fall through every check
          // and get silently dropped from the queue — verified in the
          // 2026-04-29 UAT log: skippedNoId: 1, enqueuedCount: 0.
          const idOf = (obj) => obj?.highlightId || obj?.id || obj?.data?.id || null;
          const priorIds = new Set();
          for (const page of Object.values(priorByPage || {})) {
            if (!page || !Array.isArray(page.objects)) continue;
            for (const obj of page.objects) {
              const id = idOf(obj);
              if (id) priorIds.add(id);
            }
          }
          let enqueuedCount = 0;
          let skippedExisting = 0;
          let skippedImportedOrFiltered = 0;
          let skippedNoId = 0;
          for (const page of Object.values(annotationsByPage || {})) {
            if (!page || !Array.isArray(page.objects)) continue;
            for (const fabricObj of page.objects) {
              const annoId = idOf(fabricObj);
              if (!annoId) { skippedNoId++; continue; }
              if (priorIds.has(annoId)) { skippedExisting++; continue; }
              const isImported = fabricObj?.type === 'path' && fabricObj.left == null && Array.isArray(fabricObj.path);
              if (isImported) { skippedImportedOrFiltered++; continue; }
              const annType = fabricObj?.data?.annotationType || fabricObj?.type;
              if (annType === 'highlight' || annType === 'callout') { skippedImportedOrFiltered++; continue; }
              enqueueDualWrite({
                userId,
                annoId,
                side: 'legacy',
                payload: { fabricObj, opts: { documentId, userId, pdfId, clientSessionId } }
              });
              enqueuedCount++;
            }
          }
          console.warn('[CloudSync][hook] legacy bulk push failed → delta-enqueued into CRDT dual-write queue ' + JSON.stringify({
            pdfId, documentId, userId,
            enqueuedCount, skippedExisting, skippedImportedOrFiltered, skippedNoId,
            priorBaselineSize: priorIds.size,
            error: result.error?.message || String(result.error)
          }));
        }
        console.warn('[CloudSync][hook] fabric push failed → queued ' + JSON.stringify({
          pdfId, documentId,
          error: result.error?.message || String(result.error)
        }));
        enqueueSync(documentId, {
          kind: 'fabric-bulk',
          payload: annotationsByPage,
          opts: { documentId, userId, pdfId, clientSessionId }
        });
        setQueueSize(getQueueSize(documentId));
        setStatus({ stage: 'queued', error: result.error });
      } else {
        // Phase 30 — CRDT-side fan-out per annotation. Runs only when kill
        // switch is on AND Y.Doc is mounted. Highlight bypass + callout bypass
        // happen at the call site (Pitfall 30-4 layer 1) and again inside the
        // helper (layer 2). skipLegacy: true (legacy bulk upsert just succeeded).
        await fanOutCrdtForAnnotationsByPage(annotationsByPage, { documentId, userId });
        console.log('[CloudSync][hook] fabric push synced ' + JSON.stringify({
          count: result.data?.length || 0
        }));
        setStatus({ stage: 'synced', count: result.data?.length || 0 });
      }
    };

    pendingFabricFlushRef.current = runFabricPush;
    debounceTimerRef.current = setTimeout(runFabricPush, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // 2026-04-30 — Audit hardening (finding #10): on unmount (tab close,
      // document switch) fire any still-pending debounced push fire-and-
      // forget so the last 800ms of edits aren't lost. Idempotent — runner
      // self-clears the ref so a duplicate call is a safe no-op.
      const pending = pendingFabricFlushRef.current;
      if (pending) {
        try {
          // Fire-and-forget — we deliberately do NOT await. The browser may
          // still complete the in-flight fetch during page close; that's the
          // best we can do without sendBeacon (which doesn't carry Supabase
          // auth headers).
          Promise.resolve(pending()).catch(() => { /* swallow — unmount path */ });
        } catch (_e) { /* defensive — never throw from cleanup */ }
      }
    };
  }, [enabled, documentId, userId, annotationsByPage, debounceMs]);

  useEffect(() => {
    if (!enabled || !documentId || !userId) return;
    if (!hydratedRef.current) {
      console.log('[CloudSync][hook] callout push skipped — not hydrated yet');
      return;
    }
    if (callouts === lastCalloutsRef.current) return;

    const priorCallouts = lastCalloutsRef.current;
    lastCalloutsRef.current = callouts;
    // 2026-04-26 — same wipe-push trace as fabric. Catches a callout-side
    // destructive push that would clear another device's callouts.
    const priorCalloutCount = calloutCountSafe(priorCallouts);
    const currentCalloutCount = calloutCountSafe(callouts);
    const isCalloutWipePush = currentCalloutCount === 0 && priorCalloutCount > 0;
    if (isCalloutWipePush) {
      console.warn('[CloudSync][hook][SUSPICIOUS] callout push scheduled with WIPE diff ' + JSON.stringify({
        priorCount: priorCalloutCount,
        currentCount: currentCalloutCount,
        priorRef: priorCallouts === null ? 'null' : 'array',
        currentRef: callouts === null ? 'null' : 'array'
      }));
    }
    console.log('[CloudSync][hook] callout state changed — debounce push scheduled ' + JSON.stringify({
      count: currentCalloutCount,
      priorCount: priorCalloutCount,
      isCalloutWipePush,
      debounceMs
    }));
    // 2026-04-30 — Audit hardening (finding #10): same flush-on-unload
    // pattern as the fabric push above. Factor the timer body into a named
    // runner that beforeunload / unmount can fire synchronously, and stash
    // it in pendingCalloutFlushRef. The runner self-clears the ref so a
    // double invocation is a no-op.
    let calloutTimerHandle = null;
    const runCalloutPush = async () => {
      if (pendingCalloutFlushRef.current !== runCalloutPush) return;
      pendingCalloutFlushRef.current = null;
      if (calloutTimerHandle) {
        clearTimeout(calloutTimerHandle);
        calloutTimerHandle = null;
      }
      console.log('[CloudSync][hook] callout push debounce elapsed — pushing now');
      setStatus({ stage: 'syncing' });
      const currentCalloutIds = new Set(
        (callouts || []).map((c) => c?.id || c?.highlightId).filter(Boolean)
      );

      // Detect deleted callouts the same way as fabric annotations.
      const deletedCalloutIds = [];
      if (priorCallouts && priorCallouts !== callouts) {
        for (const c of priorCallouts) {
          const id = c?.id || c?.highlightId;
          if (id && !currentCalloutIds.has(id)) deletedCalloutIds.push(id);
        }
      }
      // 2026-04-30 (Phase 35 Plan 05) — RETIRED: 2026-04-27 callout wipe
      // brake (mirror of the fabric brake removed above). Per-user delete
      // authority replaces the brake's purpose; cloud callout deletes now
      // propagate unconditionally on diff detection.
      if (deletedCalloutIds.length > 0) {
        console.log('[CloudSync][hook] callout delete detected — removing rows from cloud ' + JSON.stringify({
          count: deletedCalloutIds.length,
          firstFew: deletedCalloutIds.slice(0, 5)
        }));
        try {
          const delResult = await deleteAnnotations(documentId, deletedCalloutIds);
          if (!delResult.success) {
            console.warn('[CloudSync][hook] callout cloud delete failed ' + JSON.stringify({
              error: delResult.error?.message || String(delResult.error)
            }));
            // 2026-04-30 — same banner trigger as the fabric path above.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('crdt:deletions-pending'));
            }
          } else {
            // 2026-04-30 — callout delete made it through; clear any pending banner.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('crdt:deletions-resolved'));
            }
          }
        } catch (err) {
          console.warn('[CloudSync][hook] callout cloud delete threw ' + (err?.message || String(err)));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('crdt:deletions-pending'));
          }
        }
      }

      const result = await upsertCallouts(callouts || [], { documentId, userId, clientSessionId });
      if (result.error) {
        console.warn('[CloudSync][hook] callout push failed → queued ' + JSON.stringify({
          error: result.error?.message || String(result.error)
        }));
        enqueueSync(documentId, {
          kind: 'callout-bulk',
          payload: callouts || [],
          opts: { documentId, userId, clientSessionId }
        });
        setQueueSize(getQueueSize(documentId));
        setStatus({ stage: 'queued', error: result.error });
      } else {
        console.log('[CloudSync][hook] callout push synced ' + JSON.stringify({
          count: result.data?.length || 0
        }));
        setStatus({ stage: 'synced', count: result.data?.length || 0 });
      }
    };

    pendingCalloutFlushRef.current = runCalloutPush;
    calloutTimerHandle = setTimeout(runCalloutPush, debounceMs);

    return () => {
      if (calloutTimerHandle) {
        clearTimeout(calloutTimerHandle);
        calloutTimerHandle = null;
      }
      // 2026-04-30 — Audit hardening (finding #10): same unmount-flush as
      // the fabric branch above. Fire any still-pending callout push fire-
      // and-forget so trailing edits aren't dropped on tab close.
      const pending = pendingCalloutFlushRef.current;
      if (pending) {
        try {
          Promise.resolve(pending()).catch(() => { /* swallow — unmount path */ });
        } catch (_e) { /* defensive — never throw from cleanup */ }
      }
    };
  }, [enabled, documentId, userId, callouts, debounceMs]);

  // ---- beforeunload flush ------------------------------------------------
  //
  // 2026-04-30 — Audit hardening (finding #10): "Annotations drawn in the
  // last 800ms before close are lost." Without this listener, the user
  // could draw a stroke and close the tab inside the 800ms debounce window;
  // the unmount cleanup would clear the timer and the upsert would never
  // fire. We fire-and-forget the pending flushes (no await — beforeunload
  // is synchronous-ish, and Supabase REST upsert needs auth headers that
  // sendBeacon can't carry). The browser may still complete the in-flight
  // request during the close — that's the best we can do without a
  // server-side keepalive endpoint.
  //
  // The flush is idempotent: each runner self-clears its pending ref, so
  // the timer firing after this listener (or vice-versa) is a safe no-op.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onBeforeUnload = () => {
      const pendingFabric = pendingFabricFlushRef.current;
      const pendingCallout = pendingCalloutFlushRef.current;
      if (!pendingFabric && !pendingCallout) return;
      console.log('[CloudSync][hook] beforeunload — flushing pending pushes ' + JSON.stringify({
        hasFabric: !!pendingFabric,
        hasCallout: !!pendingCallout
      }));
      if (pendingFabric) {
        try {
          Promise.resolve(pendingFabric()).catch(() => { /* swallow */ });
        } catch (_e) { /* defensive */ }
      }
      if (pendingCallout) {
        try {
          Promise.resolve(pendingCallout()).catch(() => { /* swallow */ });
        } catch (_e) { /* defensive */ }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // ---- Realtime subscription ---------------------------------------------

  useEffect(() => {
    if (!enabled || !documentId) return;

    // 2026-04-25 (revised): the hook-side recently-pushed-id filter was
    // too aggressive — when both devices pushed full-state bulks, every
    // id ended up in BOTH devices' recently-pushed sets, so a real edit
    // from device B could not reach device A's local state because A
    // saw the id in its own set. The service-side echo filter (session
    // id match) is the authoritative source of truth; it correctly only
    // drops echoes that came from THIS session. Trust it.
    // 2026-04-25 — Suppress remote-echo push loop:
    // When a realtime event applies a remote change locally, we must update
    // lastByPageRef/lastCalloutsRef SYNCHRONOUSLY inside the setter so the
    // push useEffect's identity check (`state === lastRef`) returns true
    // and the change is NOT re-pushed back to cloud. Without this, every
    // remote update triggered a full-state re-push, both devices ping-ponged
    // forever, and any erase done on one device lost the race when the
    // other side's echo re-painted the missing row. (Logged 2026-04-25 as
    // the eraser-flicker root cause companion to the diff capture-order
    // bug above.)
    const unsub = subscribeToAllNonHighlightAnnotations(
      documentId,
      {
        onFabricInsert: (fabricObject, pageNumber, highlightId) => {
          setAnnotationsByPage((prev) => {
            const next = insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId);
            lastByPageRef.current = next; // suppress local push echo
            return next;
          });
        },
        onFabricUpdate: (fabricObject, pageNumber, highlightId) => {
          setAnnotationsByPage((prev) => {
            const next = insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId);
            lastByPageRef.current = next; // suppress local push echo
            return next;
          });
        },
        onFabricDelete: (highlightId) => {
          setAnnotationsByPage((prev) => {
            const next = removeFromAllPages(prev, highlightId);
            lastByPageRef.current = next; // suppress local push echo
            return next;
          });
        },
        onCalloutInsert: (callout) => {
          setCallouts((prev) => {
            const next = upsertCalloutInList(prev, callout);
            lastCalloutsRef.current = next; // suppress local push echo
            return next;
          });
        },
        onCalloutUpdate: (callout) => {
          setCallouts((prev) => {
            const next = upsertCalloutInList(prev, callout);
            lastCalloutsRef.current = next; // suppress local push echo
            return next;
          });
        },
        onCalloutDelete: (highlightId) => {
          setCallouts((prev) => {
            const next = (prev || []).filter((c) => (c.id ?? c.highlightId) !== highlightId);
            lastCalloutsRef.current = next; // suppress local push echo
            return next;
          });
        },
        // 2026-04-26 — Fallback when a realtime DELETE arrives with an
        // empty old payload (Supabase realtime sometimes serves empty
        // `payload.old` for a window after schema changes, even with
        // REPLICA IDENTITY FULL set). Refetch the full cloud snapshot
        // and replace local state — guarantees convergence whether or
        // not the per-row delete payload made it through.
        onDeleteFallback: () => {
          if (!documentId) return;
          (async () => {
            try {
              const fresh = await loadAllNonHighlightAnnotations(documentId);
              if (fresh.error) {
                console.warn('[CloudSync][hook] delete-fallback refetch failed: ' + (fresh.error?.message || fresh.error));
                return;
              }
              const nextByPage = fresh.annotationsByPage || {};
              const nextCallouts = Array.isArray(fresh.callouts) ? fresh.callouts : [];
              console.log('[CloudSync][hook] delete-fallback reconcile ' + JSON.stringify({
                pages: Object.keys(nextByPage).length,
                callouts: nextCallouts.length
              }));
              setAnnotationsByPage(() => {
                lastByPageRef.current = nextByPage;
                return nextByPage;
              });
              setCallouts(() => {
                lastCalloutsRef.current = nextCallouts;
                return nextCallouts;
              });
            } catch (err) {
              console.warn('[CloudSync][hook] delete-fallback threw: ' + (err?.message || err));
            }
          })();
        },
        onError: (err) => setStatus({ stage: 'error', error: err, phase: 'subscribe' }),
        // 2026-04-25 — Closes the open-document race window:
        // The initial hydrate fetch happens BEFORE the realtime
        // subscription is fully active (Postgres realtime only
        // forwards events that arrive AFTER subscribe). On Windows
        // we saw the user's Mac-pushed marks not appear until they
        // hit refresh several times — that gap is what was eating
        // them. The moment realtime confirms it's live we run a
        // catch-up fetch and merge any rows that landed in the gap
        // into local state (idempotent: rows already present are
        // overwritten with the same data).
        onSubscribed: () => {
          if (!documentId) return;
          if (startupSyncInFlightRef.current || !hydratedRef.current) {
            console.log('[CloudSync][hook] post-subscribe catch-up skipped — startup sync already in flight');
            return;
          }
          if (Date.now() - lastCloudRefreshAtRef.current < RECENT_CLOUD_REFRESH_SKIP_MS) {
            console.log('[CloudSync][hook] post-subscribe catch-up skipped — cloud snapshot is fresh');
            return;
          }
          (async () => {
            try {
              // 2026-04-26 — flip the corner chip to 'syncing' for the whole
              // catch-up window so the user sees something is in flight even
              // if the verify-pause kicks in. Without this pulse the chip
              // stayed silent for up to ~1.2s during the catch-up + verify,
              // which made the app look frozen during cross-device sync.
              setStatus({ stage: 'syncing' });
              // 2026-04-26 — verify empty cloud reads against local snapshot
              // so a transient read race during the subscribe handshake does
              // not wipe what the user is looking at.
              const fresh = await loadCloudWithEmptyVerify(documentId, {
                localFabricCount: countFabricObjects(lastByPageRef.current),
                localCalloutCount: calloutCountSafe(lastCalloutsRef.current),
                contextLabel: 'post-subscribe-catchup'
              });
              lastCloudRefreshAtRef.current = Date.now();
              if (fresh.error) {
                setStatus({ stage: 'error', error: fresh.error, phase: 'subscribe-catchup' });
                return;
              }
              // Cloud-authoritative refresh — replace local with whatever
              // the cloud has now. Catches both rows added by another
              // device during the hydrate-vs-subscribe gap AND remote
              // deletions that the additive merge would otherwise miss.
              // 2026-04-25 — only do empty-cloud replacement once the
              // one-time migration has run, otherwise we'd wipe local
              // data that hasn't been pushed up yet on this device.
              const subMigrationDone = hasMigrationRun(userId, documentId);
              const subFresh = fresh.annotationsByPage || {};
              const subFreshCallouts = Array.isArray(fresh.callouts) ? fresh.callouts : [];
              if (subMigrationDone || Object.keys(subFresh).length > 0) {
                setAnnotationsByPage(() => {
                  lastByPageRef.current = subFresh;
                  return subFresh;
                });
              }
              if (subMigrationDone || subFreshCallouts.length > 0) {
                setCallouts(() => {
                  lastCalloutsRef.current = subFreshCallouts;
                  return subFreshCallouts;
                });
              }
              console.log('[CloudSync][hook] post-subscribe catch-up rehydrate complete ' + JSON.stringify({
                pagesFromCloud: fresh.annotationsByPage ? Object.keys(fresh.annotationsByPage).length : 0,
                calloutsFromCloud: Array.isArray(fresh.callouts) ? fresh.callouts.length : 0
              }));
              // Catch-up done — flip the chip back to a calm "synced" state
              // so the user sees the activity resolved cleanly.
              setStatus({ stage: 'synced' });
            } catch (err) {
              console.warn('[CloudSync][hook] post-subscribe rehydrate failed: ' + (err?.message || String(err)));
              setStatus({ stage: 'error', error: err, phase: 'subscribe-catchup' });
            }
          })();
        }
      },
      // Echo filter — drop realtime events that originated from THIS
      // session (this tab / this Electron process). Same user on a
      // different device has a different session id and still receives
      // updates. Falls back to user-id matching for legacy rows that
      // pre-date the sessionId field.
      { currentUserId: userId, currentSessionId: clientSessionId }
    );

    // 2026-04-25 — Belt-and-suspenders rehydrate when the window comes
    // back into focus. Catches rows that landed while the user was on
    // another window or (for Electron) while the app was backgrounded.
    // Cheap: one query, idempotent merge.
    const onFocus = () => {
      if (!documentId) return;
      if (startupSyncInFlightRef.current || !hydratedRef.current) {
        console.log('[CloudSync][hook] focus rehydrate skipped — startup sync already in flight');
        return;
      }
      if (Date.now() - lastCloudRefreshAtRef.current < RECENT_CLOUD_REFRESH_SKIP_MS) {
        console.log('[CloudSync][hook] focus rehydrate skipped — cloud snapshot is fresh');
        return;
      }
      (async () => {
        try {
          // 2026-04-26 — pulse the corner chip to 'syncing' for the focus
          // rehydrate too. Without this the verify-pause runs silently and
          // the app looks frozen for up to ~1.2s after switching back into
          // the window from another app.
          setStatus({ stage: 'syncing' });
          // 2026-04-26 — same verify guard as the initial hydrate. If the
          // window comes back into focus and the cloud query returns empty
          // while we are still showing annotations, re-ask once before
          // wiping. Cheap insurance against a transient read race.
          const fresh = await loadCloudWithEmptyVerify(documentId, {
            localFabricCount: countFabricObjects(lastByPageRef.current),
            localCalloutCount: calloutCountSafe(lastCalloutsRef.current),
            contextLabel: 'focus-rehydrate'
          });
          lastCloudRefreshAtRef.current = Date.now();
          if (fresh.error) {
            setStatus({ stage: 'error', error: fresh.error, phase: 'focus-rehydrate' });
            return;
          }
          // Cloud-authoritative on focus too — picks up deletions made
          // while this window was backgrounded. 2026-04-25 — gate
          // empty-cloud replacement on migration-done so first-boot local
          // data isn't wiped before it gets pushed up.
          const focusMigrationDone = hasMigrationRun(userId, documentId);
          const focusFresh = fresh.annotationsByPage || {};
          const focusFreshCallouts = Array.isArray(fresh.callouts) ? fresh.callouts : [];

          // 2026-04-29 fix — skip the cloud-authoritative replace when there
          // are unpushed local edits sitting in either retry queue. The
          // previous behavior would overwrite the user's freshly-drawn stroke
          // because the cloud snapshot doesn't contain it yet (its save
          // failed and is still queued). Surfaced by UAT: paste forceLegacyFail,
          // draw stroke, switch focus, stroke disappears.
          const localFabricCount = countFabricObjects(lastByPageRef.current);
          const cloudFabricCount = countFabricObjects(focusFresh);
          const hasUnpushedLegacyQueue = (getQueueSize(documentId) || 0) > 0;
          let hasUnpushedDualWriteQueue = false;
          try {
            const dwQueue = readDualWriteQueue(userId) || {};
            // 2026-04-29 fix: count quarantined entries as "unpushed" too —
            // they are still data the user expects to keep visible. Earlier
            // version excluded quarantined and the focus-rehydrate replace
            // would wipe a quarantined stroke off the canvas.
            hasUnpushedDualWriteQueue = Object.keys(dwQueue).length > 0;
          } catch (_e) {
            // If readDualWriteQueue throws, fall back to queue-presence-unknown
            // and skip the replace defensively (better to keep local than wipe).
            hasUnpushedDualWriteQueue = false;
          }
          const localAhead = localFabricCount > cloudFabricCount;
          const skipReplace = hasUnpushedLegacyQueue || hasUnpushedDualWriteQueue || localAhead;

          if (skipReplace) {
            console.warn('[CloudSync][hook] focus-rehydrate REPLACE SKIPPED — unpushed local edits ' + JSON.stringify({
              pdfId, documentId,
              localFabricCount, cloudFabricCount,
              hasUnpushedLegacyQueue, hasUnpushedDualWriteQueue,
              localAhead
            }));
          } else if (focusMigrationDone || Object.keys(focusFresh).length > 0) {
            // 2026-04-30 (Phase 35 Plan 05) — RETIRED: per-session
            // user-deleted-id filter that stripped freshly-cloud-fetched
            // annotations against a local "deleted this session" set. With
            // per-user delete authority shipped, the cloud delete fires
            // unconditionally on the original gesture, so the cloud snapshot
            // already reflects the user's local deletes — there's nothing to
            // strip. Apply the cloud snapshot directly.
            setAnnotationsByPage(() => {
              lastByPageRef.current = focusFresh;
              return focusFresh;
            });
          }
          if (!skipReplace && (focusMigrationDone || focusFreshCallouts.length > 0)) {
            // 2026-04-30 (Phase 35 Plan 05) — same retirement as the fabric
            // branch directly above. Apply cloud callout snapshot directly.
            setCallouts(() => {
              lastCalloutsRef.current = focusFreshCallouts;
              return focusFreshCallouts;
            });
          }
          // Focus catch-up done — back to a calm "synced" state.
          setStatus({ stage: 'synced' });
        } catch (err) {
          console.warn('[CloudSync][hook] focus rehydrate failed: ' + (err?.message || String(err)));
          setStatus({ stage: 'error', error: err, phase: 'focus-rehydrate' });
        }
      })();
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('focus', onFocus);
    }

    return () => {
      try { unsub?.(); } catch { /* ignore */ }
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('focus', onFocus);
      }
    };
  }, [enabled, documentId, userId, clientSessionId, setAnnotationsByPage, setCallouts]);

  // ---- Drain offline queue on reconnect ----------------------------------

  useEffect(() => {
    if (!enabled || !documentId || !userId) return;

    let cancelled = false;
    const flush = async (entry) => {
      const { kind, payload, opts } = entry;
      if (kind === 'fabric-bulk') {
        // Phase 31 — kill switch (CONTEXT.md AC bullet 5). Default off skips
        // the legacy bulk replay entirely; the CRDT fan-out below stays as
        // the sole writer for the queued payload. localStorage opt-in
        // re-engages the legacy replay byte-identical to pre-Phase-31.
        let r;
        if (isLegacyBulkUpsertEnabled()) {
          r = await upsertAnnotationsByPage(payload, opts);
        } else {
          r = { data: [], error: null };
        }
        // Phase 30 — CRDT-side mirror after the queued legacy write lands.
        // Highlight + callout bypass at the call site; helper enqueues internal
        // failures to crdtDualWriteQueue (separate from this legacy queue).
        if (!r.error) {
          await fanOutCrdtForAnnotationsByPage(payload, opts);
        }
        return { success: !r.error };
      }
      if (kind === 'callout-bulk') {
        // UNCHANGED — callouts ride legacy through Phase 30. Callout migration
        // is v2.5 scope; out of Phase 30 boundary.
        const r = await upsertCallouts(payload, opts);
        return { success: !r.error };
      }
      if (kind === 'delete') {
        const r = await deleteAnnotation(opts.documentId, opts.highlightId);
        // Phase 30 — CRDT-side mirror after the queued legacy delete lands.
        if (r?.success) {
          await fanOutCrdtForDeletedIds(opts.documentId, [opts.highlightId], { userId: opts.userId });
        }
        return { success: !!r.success };
      }
      return { success: false };
    };

    const tryDrain = async () => {
      if (cancelled) return;
      const { remaining } = await drainQueue(documentId, flush);
      if (!cancelled) setQueueSize(remaining);
    };

    const onOnline = () => { tryDrain(); };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', onOnline);
    }
    tryDrain();

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('online', onOnline);
      }
    };
  }, [enabled, documentId, userId]);

  // 2026-04-29 — Throw on first detected failure so the manual-retry caller
  // (SyncStatusChip) can actually see the failure and run its retry loop.
  // Previously upsertAnnotationsByPage's `{ error }` return value was awaited
  // but never inspected, so the test seam (and real-world push errors) looked
  // like success to the chip's retry loop.
  // 2026-04-30 — Also drain the legacy offline queue. Without this, an earlier
  // bulk-push failure (e.g. a Postgres deadlock during initial migration) sat
  // queued and the chip's "Click to sync now" did nothing visible because the
  // current local state had already been overwritten to match the failed push.
  const forceFlush = async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!documentId || !userId) return;

    // Drain the legacy offline queue first — same flush dispatcher as the
    // online-event drainer effect. Each entry retries via its appropriate
    // backend call; failures stay in the queue. If anything is left after
    // the drain pass, throw so the chip's retry loop can re-attempt.
    const flush = async (entry) => {
      const { kind, payload, opts } = entry;
      if (kind === 'fabric-bulk') {
        // Phase 31 — kill switch (mirror of online-drain flush above).
        // Default off skips the legacy bulk replay; CRDT fan-out remains
        // sole writer for the queued payload. localStorage opt-in re-engages
        // the legacy path for emergency rollback.
        let r;
        if (isLegacyBulkUpsertEnabled()) {
          r = await upsertAnnotationsByPage(payload, opts);
        } else {
          r = { data: [], error: null };
        }
        if (!r?.error) {
          await fanOutCrdtForAnnotationsByPage(payload, opts);
        }
        return { success: !r?.error };
      }
      if (kind === 'callout-bulk') {
        const r = await upsertCallouts(payload, opts);
        return { success: !r?.error };
      }
      if (kind === 'delete') {
        const r = await deleteAnnotation(opts.documentId, opts.highlightId);
        if (r?.success) {
          await fanOutCrdtForDeletedIds(opts.documentId, [opts.highlightId], { userId: opts.userId });
        }
        return { success: !!r?.success };
      }
      return { success: false };
    };
    const { remaining: remainingAfterDrain } = await drainQueue(documentId, flush);
    setQueueSize(remainingAfterDrain);

    if (lastByPageRef.current) {
      // Phase 31 — kill switch. Default off skips the legacy direct push
      // entirely; the CRDT fan-out below is the sole writer for the
      // last-known good state. localStorage opt-in re-engages the legacy
      // path so the SyncStatusChip "Click to sync now" retry preserves the
      // pre-Phase-31 dual-write semantics.
      if (isLegacyBulkUpsertEnabled()) {
        const upRes = await upsertAnnotationsByPage(
          lastByPageRef.current,
          { documentId, userId, pdfId, clientSessionId }
        );
        if (upRes?.error) {
          const msg = upRes.error?.message || String(upRes.error);
          throw new Error(`forceFlush: legacy upsertAnnotationsByPage failed — ${msg}`);
        }
      }
      await fanOutCrdtForAnnotationsByPage(lastByPageRef.current, { documentId, userId });
    }
    if (lastCalloutsRef.current) {
      const calloutRes = await upsertCallouts(
        lastCalloutsRef.current,
        { documentId, userId, clientSessionId }
      );
      if (calloutRes?.error) {
        const msg = calloutRes.error?.message || String(calloutRes.error);
        throw new Error(`forceFlush: legacy upsertCallouts failed — ${msg}`);
      }
    }
    if (remainingAfterDrain > 0) {
      throw new Error(`forceFlush: ${remainingAfterDrain} entr${remainingAfterDrain === 1 ? 'y' : 'ies'} still queued after drain`);
    }
  };

  return { status, queueSize, forceFlush };
}

// ----------------------------------------------------------------------------
// Empty-cloud verification helper — added 2026-04-26
// ----------------------------------------------------------------------------
//
// Symptom this guards against: one device's first cloud read after a refresh
// returns zero rows even though the cloud actually has data. Hypothesised
// causes include an auth/RLS handshake race, a slow read replica, or a
// transient Supabase connection swap. Whatever the cause, the user-visible
// damage is the same — the device wipes its local cache to match a false-empty
// cloud and ends up showing a blank canvas while the other device renders
// fine.
//
// Strategy: when the cloud claims to be empty AND the device is showing
// annotations, do not trust the first read. Wait briefly, ask once more, and
// only commit to the wipe if both reads agree. Costs one extra round trip in
// the rare suspicious case; safe in every other case (empty cloud + empty
// device returns the first read immediately, non-empty cloud short-circuits).

function countFabricObjects(annotationsByPage) {
  if (!annotationsByPage || typeof annotationsByPage !== 'object') return 0;
  let n = 0;
  for (const page of Object.values(annotationsByPage)) {
    if (page && Array.isArray(page.objects)) n += page.objects.length;
  }
  return n;
}

function calloutCountSafe(callouts) {
  return Array.isArray(callouts) ? callouts.length : 0;
}

async function loadCloudWithEmptyVerify(documentId, opts = {}) {
  const {
    localFabricCount = 0,
    localCalloutCount = 0,
    contextLabel = 'unknown'
  } = opts;
  const t0 = Date.now();
  const first = await loadAllNonHighlightAnnotations(documentId);
  if (first.error) return first;

  const firstFabric = first.annotationsByPage ? Object.keys(first.annotationsByPage).length : 0;
  const firstFabricObjects = countFabricObjects(first.annotationsByPage);
  const firstCallouts = calloutCountSafe(first.callouts);
  const firstEmpty = firstFabric === 0 && firstCallouts === 0;
  const localHasData = localFabricCount > 0 || localCalloutCount > 0;

  console.log('[CloudSync][verify] first read summary ' + JSON.stringify({
    contextLabel,
    documentId,
    elapsedMs: Date.now() - t0,
    firstFabricPages: firstFabric,
    firstFabricObjects,
    firstCallouts,
    firstEmpty,
    localFabricCount,
    localCalloutCount,
    localHasData,
    willVerify: firstEmpty && localHasData
  }));

  if (!firstEmpty || !localHasData) return first;

  const auth = await getAuthSnapshot();
  console.warn('[CloudSync][verify] empty cloud + non-empty device — verifying ' + JSON.stringify({
    contextLabel,
    documentId,
    localFabricCount,
    localCalloutCount,
    auth,
    waitMs: EMPTY_CLOUD_VERIFY_DELAY_MS
  }));

  await new Promise((resolve) => setTimeout(resolve, EMPTY_CLOUD_VERIFY_DELAY_MS));

  const t1 = Date.now();
  const second = await loadAllNonHighlightAnnotations(documentId);
  if (second.error) {
    console.warn('[CloudSync][verify] verification query errored — keeping first (empty) result ' + JSON.stringify({
      contextLabel,
      err: second.error?.message || String(second.error)
    }));
    return first;
  }
  const secondFabric = second.annotationsByPage ? Object.keys(second.annotationsByPage).length : 0;
  const secondFabricObjects = countFabricObjects(second.annotationsByPage);
  const secondCallouts = calloutCountSafe(second.callouts);
  const secondEmpty = secondFabric === 0 && secondCallouts === 0;
  const authAfter = await getAuthSnapshot();

  console.warn('[CloudSync][verify] verification result ' + JSON.stringify({
    contextLabel,
    documentId,
    elapsedMs: Date.now() - t1,
    secondFabricPages: secondFabric,
    secondFabricObjects,
    secondCallouts,
    secondEmpty,
    authAfter,
    decision: secondEmpty
      ? 'CONFIRMED_EMPTY — wipe is safe to proceed'
      : 'REJECTED — using verification result with data instead'
  }));

  return secondEmpty ? first : second;
}

// ----------------------------------------------------------------------------
// Pure merge helpers
// ----------------------------------------------------------------------------

function mergeAnnotationsByPage(local, remote) {
  if (!remote) return local;
  const out = { ...(local || {}) };
  for (const [pageKey, page] of Object.entries(remote)) {
    if (!page || !Array.isArray(page.objects)) continue;
    const localPage = out[pageKey] || { objects: [] };
    const localIds = new Set(localPage.objects.map((o) => o.id || o.data?.id).filter(Boolean));
    const merged = [...localPage.objects];
    for (const obj of page.objects) {
      const id = obj.id || obj.data?.id;
      if (!id || !localIds.has(id)) merged.push(obj);
    }
    out[pageKey] = { ...localPage, objects: merged };
  }
  return out;
}

function mergeCallouts(local, remote) {
  if (!remote) return local;
  const out = [...(local || [])];
  const localIds = new Set(out.map((c) => c.id || c.highlightId).filter(Boolean));
  for (const c of remote) {
    const id = c.id || c.highlightId;
    if (!id || !localIds.has(id)) out.push(c);
  }
  return out;
}

function insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId) {
  const pageKey = String(pageNumber);
  const out = { ...(prev || {}) };
  const page = out[pageKey] || { objects: [] };
  const id = highlightId || fabricObject.id || fabricObject.data?.id;
  const idx = page.objects.findIndex((o) => (o.id || o.data?.id) === id);
  const nextObjects = idx >= 0
    ? page.objects.map((o, i) => (i === idx ? fabricObject : o))
    : [...page.objects, fabricObject];
  out[pageKey] = { ...page, objects: nextObjects };
  return out;
}

function removeFromAllPages(prev, highlightId) {
  if (!prev) return prev;
  const out = {};
  for (const [pageKey, page] of Object.entries(prev)) {
    if (!page || !Array.isArray(page.objects)) {
      out[pageKey] = page;
      continue;
    }
    const filtered = page.objects.filter((o) => (o.id || o.data?.id) !== highlightId);
    out[pageKey] = { ...page, objects: filtered };
  }
  return out;
}

function upsertCalloutInList(prev, callout) {
  const list = Array.isArray(prev) ? prev : [];
  const id = callout.id || callout.highlightId;
  const idx = list.findIndex((c) => (c.id || c.highlightId) === id);
  if (idx >= 0) {
    return list.map((c, i) => (i === idx ? callout : c));
  }
  return [...list, callout];
}
