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
  deleteAnnotations
} from '../services/annotationCloudSync.js';
import { migrateLocalAnnotationsToCloud, hasMigrationRun } from '../services/cloudSyncMigration.js';
import {
  enqueueSync,
  drainQueue,
  getQueueSize
} from '../services/cloudSyncQueue.js';
import { getAuthSnapshot } from '../supabaseClient.js';

const DEFAULT_DEBOUNCE_MS = 800; // mid-drag pushes are coalesced into one upsert
// 2026-04-26 — How long to wait before re-asking the cloud when the first read
// came back empty but the device still shows annotations. Long enough for a
// transient auth/replica race to finish; short enough that it does not feel
// like a stall when the device legitimately has nothing.
const EMPTY_CLOUD_VERIFY_DELAY_MS = 1000;

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

  const lastByPageRef = useRef(null);
  const lastCalloutsRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const hydratedRef = useRef(false);

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

    (async () => {
      setStatus({ stage: 'hydrating' });
      console.log('[CloudSync][hook] stage=hydrating');
      // 2026-04-26 — capture local counts at fire time so the verify helper
      // can decide whether an empty cloud read should be trusted on its own
      // or re-asked once. annotationsByPage / callouts here are the closure
      // values React handed us when the effect committed.
      const localFabricAtHydrate = countFabricObjects(annotationsByPage);
      const localCalloutAtHydrate = calloutCountSafe(callouts);
      const cloud = await loadCloudWithEmptyVerify(documentId, {
        localFabricCount: localFabricAtHydrate,
        localCalloutCount: localCalloutAtHydrate,
        contextLabel: 'initial-hydrate'
      });
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
    })();

    return () => {
      cancelled = true;
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

    debounceTimerRef.current = setTimeout(async () => {
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
      if (deletedIds.length > 0) {
        console.log('[CloudSync][hook] eraser/delete detected — removing rows from cloud ' + JSON.stringify({
          count: deletedIds.length,
          firstFew: deletedIds.slice(0, 5)
        }));
        try {
          const delResult = await deleteAnnotations(documentId, deletedIds);
          if (!delResult.success) {
            console.warn('[CloudSync][hook] cloud delete failed ' + JSON.stringify({
              error: delResult.error?.message || String(delResult.error)
            }));
          }
        } catch (err) {
          console.warn('[CloudSync][hook] cloud delete threw ' + (err?.message || String(err)));
        }
      }

      const result = await upsertAnnotationsByPage(annotationsByPage, { documentId, userId, clientSessionId });
      if (result.error) {
        console.warn('[CloudSync][hook] fabric push failed → queued ' + JSON.stringify({
          error: result.error?.message || String(result.error)
        }));
        enqueueSync(documentId, {
          kind: 'fabric-bulk',
          payload: annotationsByPage,
          opts: { documentId, userId, clientSessionId }
        });
        setQueueSize(getQueueSize(documentId));
        setStatus({ stage: 'queued', error: result.error });
      } else {
        console.log('[CloudSync][hook] fabric push synced ' + JSON.stringify({
          count: result.data?.length || 0
        }));
        setStatus({ stage: 'synced', count: result.data?.length || 0 });
      }
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
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
    const handle = setTimeout(async () => {
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
          }
        } catch (err) {
          console.warn('[CloudSync][hook] callout cloud delete threw ' + (err?.message || String(err)));
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
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [enabled, documentId, userId, callouts, debounceMs]);

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
          (async () => {
            try {
              // 2026-04-26 — verify empty cloud reads against local snapshot
              // so a transient read race during the subscribe handshake does
              // not wipe what the user is looking at.
              const fresh = await loadCloudWithEmptyVerify(documentId, {
                localFabricCount: countFabricObjects(lastByPageRef.current),
                localCalloutCount: calloutCountSafe(lastCalloutsRef.current),
                contextLabel: 'post-subscribe-catchup'
              });
              if (fresh.error) return;
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
            } catch (err) {
              console.warn('[CloudSync][hook] post-subscribe rehydrate failed: ' + (err?.message || String(err)));
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
      (async () => {
        try {
          // 2026-04-26 — same verify guard as the initial hydrate. If the
          // window comes back into focus and the cloud query returns empty
          // while we are still showing annotations, re-ask once before
          // wiping. Cheap insurance against a transient read race.
          const fresh = await loadCloudWithEmptyVerify(documentId, {
            localFabricCount: countFabricObjects(lastByPageRef.current),
            localCalloutCount: calloutCountSafe(lastCalloutsRef.current),
            contextLabel: 'focus-rehydrate'
          });
          if (fresh.error) return;
          // Cloud-authoritative on focus too — picks up deletions made
          // while this window was backgrounded. 2026-04-25 — gate
          // empty-cloud replacement on migration-done so first-boot local
          // data isn't wiped before it gets pushed up.
          const focusMigrationDone = hasMigrationRun(userId, documentId);
          const focusFresh = fresh.annotationsByPage || {};
          const focusFreshCallouts = Array.isArray(fresh.callouts) ? fresh.callouts : [];
          if (focusMigrationDone || Object.keys(focusFresh).length > 0) {
            setAnnotationsByPage(() => {
              lastByPageRef.current = focusFresh;
              return focusFresh;
            });
          }
          if (focusMigrationDone || focusFreshCallouts.length > 0) {
            setCallouts(() => {
              lastCalloutsRef.current = focusFreshCallouts;
              return focusFreshCallouts;
            });
          }
        } catch (err) {
          console.warn('[CloudSync][hook] focus rehydrate failed: ' + (err?.message || String(err)));
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
        const r = await upsertAnnotationsByPage(payload, opts);
        return { success: !r.error };
      }
      if (kind === 'callout-bulk') {
        const r = await upsertCallouts(payload, opts);
        return { success: !r.error };
      }
      if (kind === 'delete') {
        const r = await deleteAnnotation(opts.documentId, opts.highlightId);
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

  const forceFlush = async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!documentId || !userId) return;
    if (lastByPageRef.current) {
      await upsertAnnotationsByPage(lastByPageRef.current, { documentId, userId, clientSessionId });
    }
    if (lastCalloutsRef.current) {
      await upsertCallouts(lastCalloutsRef.current, { documentId, userId, clientSessionId });
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
