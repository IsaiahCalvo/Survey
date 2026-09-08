// src/hooks/useAnnotationDoc.js
//
// Connects the viewer's React annotation state to the durable Yjs store
// (annotationDocSync). This is the rebuild's app-side seam: a thin capture +
// hydrate layer that sits AROUND the existing `annotationsByPage` state
// (which, post-R2.2-flip, carries callouts as projected data.type==='callout'
// groups), so everything that already produces that state — draw, erase, edit,
// callout create/move/delete, undo/redo, embedded import — becomes durable
// automatically, with no changes to any of that logic.
//
// How it stays loop-free without flags: pushing state into the store is a
// minimal diff (syncByPageToDoc / setMeta produce ZERO ops when nothing
// changed), so re-capturing store-originated state is a harmless no-op. Local
// edits do NOT echo back from the store (the sync layer only notifies on REMOTE
// ops), so the viewer's per-page render metadata is never clobbered.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient.js';
import { openAnnotationDoc, getClientId } from '../services/annotationDocSync.js';
import {
  preserveTransientPagePresentationState,
  setMetaValue as setMetaValueOnDoc,
} from '../services/annotationDocStore.js';
import {
  migrateCalloutsMetaToAnnotationsMap,
  getUnmigratedMetaCallouts,
} from '../services/calloutMetaMigration.js';
import {
  projectCalloutsIntoByPage as projectCalloutsIntoByPageShared,
  deriveCalloutsFromByPage,
} from '../utils/calloutAnnotationBridge.js';

const SPACES_KEY = 'spaces';

function pageCount(byPage) {
  let n = 0;
  for (const k of Object.keys(byPage || {})) n += (byPage[k]?.objects?.length || 0);
  return n;
}

// ---------------------------------------------------------------------------
// Callout-unification Slice 6 (2026-07-17) — callouts ride the annotations map.
//
// `useAnnotationDoc` is the LIVE cloud hydration seam (the legacy
// `useAnnotationCloudSync` hydrate effect is dead — invoked with
// hydrateEnabled=false). Callouts persist per-annotation in the flat Y.Doc
// `annotations` map like every other type: the projected callout group
// (data.type==='callout', with the verbatim normalized payload embedded as
// data.legacyCallout) IS the durable record. The coarse `calloutsList` META
// blob is retired — this hook no longer writes it, and legacy docs are
// converted on open by migrateCalloutsMetaToAnnotationsMap (one-time, then the
// meta is tombstoned to null).
//
// Read path: handle.getByPage() already returns the callout groups inside the
// normal byPage shape, so setAnnotationsByPage delivers them to the shared
// dispatch (PDFViewer derives callouts[] from annotationsByPage — R2.2 flip).
//
// Geometry/device-independence: group children are stored in UNSCALED PDF
// page-pixel units (intrinsic PDF dims — identical on every client), and the
// exact normalized fractions travel inside data.legacyCallout. On hydrate,
// when local page dims are already measured we normalize the callout layer
// through the shared projector (lossless, idempotent — a steady-state re-open
// re-produces byte-identical JSON, so the capture below emits ZERO ops). When
// dims are NOT yet measured we paint the stored geometry verbatim; PDFViewer's
// pageSizes-measure effect (the reactive re-projection keyed on [pageSizes])
// rebuilds the callout children from legacyCallout the moment real dims land —
// which is why the old BLOCKER-2 re-projection apparatus in this hook was
// removed in Slice 6 (pageSizes always transitions on a fresh open: it is
// reset + re-measured per document).
//
// Thin alias kept so the call-site shape matches the rest of the keystone code
// (the old calloutsInSharedStore() gate was permanently ON and has been inlined
// away; the bridge stays dependency-free so it is importable in Node --test).
function projectCalloutsIntoByPage(byPage, calloutsList, pageSizes, options) {
  return projectCalloutsIntoByPageShared(byPage, calloutsList, pageSizes, options);
}

// ---------------------------------------------------------------------------
// Slice 6 hardening (2026-07-17) — viewer-safe migration + read-only fallback.
//
// The meta→map migration WRITES (map entries + tombstone), and the durable log
// (annotation_updates INSERT) is RLS-gated to editors. Running it on a
// viewer-tier open put the sync layer into a permanent error state (every RLS
// rejection → BL-24 eager snapshot → also rejected) on nearly every legacy doc.
// So:
//   * the migration only runs when the resolved document role is confirmed
//     writable ('owner'/'editor' from get_my_document_role via YDocProvider);
//   * viewer / not-yet-resolved roles get a READ-ONLY fallback instead: the
//     unmigrated meta callouts are projected into the LOCAL byPage so they
//     still render, with zero Y.Doc ops, and their ids are stripped back out
//     of every capture (below) so the local projection can never become the
//     first diff the capture pushes;
//   * the next confirmed-writable open (or this session, the moment the role
//     resolves writable) performs the real migration.
// ---------------------------------------------------------------------------

function isWritableDocRole(role) {
  return role === 'owner' || role === 'editor';
}

// Remove the read-only-fallback callout projections (identified by id) from a
// byPage before it is pushed into the doc. There is NO role gate anywhere in
// the capture path — server-side RLS is the only write enforcement — so the
// hook's own local projection must stay capture-invisible. Pages without a
// fallback callout keep their bucket by reference (preserves the per-page
// fast diff in applyByPage).
function stripMetaFallbackCallouts(byPage, fallbackIds) {
  if (!fallbackIds || fallbackIds.size === 0) return byPage;
  const src = byPage || {};
  const isFallbackCallout = (o) =>
    o?.data?.type === 'callout' && o?.data?.id != null && fallbackIds.has(String(o.data.id));
  let changed = false;
  const out = {};
  for (const key of Object.keys(src)) {
    const page = src[key];
    const objects = Array.isArray(page?.objects) ? page.objects : null;
    if (objects && objects.some(isFallbackCallout)) {
      changed = true;
      out[key] = { ...page, objects: objects.filter((o) => !isFallbackCallout(o)) };
    } else {
      out[key] = page;
    }
  }
  return changed ? out : byPage;
}

// Shared by the open path (role already resolved) and the late-resolution
// effect (role resolves after hydrate). Returns true when the migration ran
// (including a verified-nothing-to-do run); false only when it threw.
function runDurableCalloutMigration(handle, pageSizes, documentId) {
  try {
    const migration = migrateCalloutsMetaToAnnotationsMap(handle.doc, {
      pageSizes: pageSizes || {},
    });
    if (migration.migrated || migration.tombstoned || migration.droppedCount > 0) {
      console.log('[useAnnotationDoc] calloutsList meta migration', {
        documentId,
        migrated: migration.migrated,
        tombstoned: migration.tombstoned,
        calloutCount: migration.calloutCount,
        migratedCount: migration.migratedCount,
        droppedCount: migration.droppedCount,
        source: migration.source,
      });
    }
    return true;
  } catch (err) {
    // Never let a migration failure block hydration — legacy meta callouts
    // simply stay in the meta (and render via the fallback) until a later
    // writable open retries.
    console.error('[useAnnotationDoc] calloutsList meta migration failed', err?.message);
    return false;
  }
}

function runDurableStackedInkRepair(handle, documentId, opts = {}) {
  try {
    const result = handle.repairStackedInkDuplicates?.(opts);
    if (result?.removed > 0) {
      console.warn('[useAnnotationDoc] removed stacked duplicate ink', {
        documentId,
        scanned: result.scanned,
        duplicateGroups: result.duplicateGroups,
        removed: result.removed,
      });
    }
    return result || {};
  } catch (err) {
    // Never block hydration. An exact repair can safely retry on the next
    // confirmed-writable open if local storage or persistence is unavailable.
    console.error('[useAnnotationDoc] stacked ink repair failed', err?.message);
    return null;
  }
}

function localReceiptError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Compute only for a save/close check, not on every render. Fresh serialization
// also catches nested mutations; reference equality cannot prove saved content.
function localViewSignature(scope) {
  return JSON.stringify([
    scope.documentId, scope.actorUserId,
    scope.view.annotationsByPage, scope.view.spaces, scope.view.surveyMarkers,
  ]);
}

export function useAnnotationDoc({
  documentId,
  userId,
  enabled,
  annotationsByPage,
  setAnnotationsByPage,
  spaces,
  setSpaces,
  surveyMarkers,
  setSurveyMarkers,
  // The unscaled per-page PDF pixel sizes ({ [page]: { width, height } }) the
  // SVG layer inverts callouts with. Passed as a ref so the hydrate-time callout
  // normalization and the meta migration read the latest measured sizes (sizes
  // may arrive after the doc opens; unmeasured pages are handled — see the
  // Slice 6 module comment above).
  pageSizesRef,
  // The resolved document role ('owner'|'editor'|'viewer'|null) from
  // YDocProvider's get_my_document_role fetch. Gates the meta→map migration:
  // only a confirmed-writable role may run it (see the Slice 6 hardening
  // comment above). Resolves async, so it is read through a ref at open time
  // and a dedicated effect re-checks when it lands late.
  docRole = null,
  eraseEffectConsumer = null,
  onHistoryQuarantine = null,
}) {
  const handleRef = useRef(null);
  const eraseEffectConsumerRef = useRef(eraseEffectConsumer);
  const eraseEffectConsumerProxyRef = useRef(null);
  const onHistoryQuarantineRef = useRef(onHistoryQuarantine);
  eraseEffectConsumerRef.current = eraseEffectConsumer;
  onHistoryQuarantineRef.current = onHistoryQuarantine;
  if (!eraseEffectConsumerProxyRef.current) {
    eraseEffectConsumerProxyRef.current = (...args) => {
      const consumer = eraseEffectConsumerRef.current;
      if (typeof consumer !== 'function') {
        throw new Error('erase effect consumer is not ready');
      }
      return consumer(...args);
    };
  }
  const readyRef = useRef(false);
  const byPageRef = useRef(annotationsByPage);
  const spacesRef = useRef(spaces);
  const surveyMarkersRef = useRef(surveyMarkers);
  const docRoleRef = useRef(docRole);
  // Ids of legacy meta callouts projected LOCALLY by the read-only fallback —
  // stripped out of every capture until the durable migration lands.
  const metaFallbackIdsRef = useRef(new Set());
  // documentId whose durable migration already ran this mount (idempotence is
  // the module's job; this just avoids re-running on unrelated re-renders).
  const migrationDoneRef = useRef(null);
  const inkRepairDoneRef = useRef(null);
  const [initialHydration, setInitialHydration] = useState({ ready: false, source: 'pending', count: 0, documentId: null });
  const [deletedPdfAnnotations, setDeletedPdfAnnotations] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ stage: 'idle', healthy: true, error: null });
  const [syncQueueSize, setSyncQueueSize] = useState(0);

  byPageRef.current = annotationsByPage;
  spacesRef.current = spaces;
  surveyMarkersRef.current = surveyMarkers;
  docRoleRef.current = docRole;

  const localReceiptScopeRef = useRef(null);
  const localScopeKey = JSON.stringify([documentId || null, userId || null]);
  if (localReceiptScopeRef.current?.key !== localScopeKey) {
    localReceiptScopeRef.current = {
      key: localScopeKey, documentId, actorUserId: userId,
      handle: null, ready: false, closeReceipt: null, mounted: false,
      receipts: new WeakMap(),
    };
  }
  const localScope = localReceiptScopeRef.current;
  localScope.enabled = enabled;
  localScope.renderedReady = localScope.ready;
  localScope.view = { annotationsByPage, spaces, surveyMarkers };
  localScope.fallbackIds = metaFallbackIdsRef.current;
  useEffect(() => {
    localScope.mounted = true;
    return () => { localScope.mounted = false; };
  }, [localScope]);

  const captureLocalReceiptState = (handle, scope) => {
    const pages = stripMetaFallbackCallouts(
      scope.view.annotationsByPage, scope.fallbackIds,
    );
    if (Object.values(pages || {}).some((page) => page?.eraserMutation?.id)) {
      throw localReceiptError('ANNOTATION_LOCAL_EDIT_PENDING', 'An erase operation is still being committed.');
    }
    const result = handle.applyByPage(pages);
    if (result?.identityChanged) {
      if (result.normalizedByPage) setAnnotationsByPage((previous) => (
        preserveTransientPagePresentationState(previous, result.normalizedByPage)
      ));
      throw localReceiptError('ANNOTATION_LOCAL_REVISION_CHANGED', 'Annotation identities are still being saved. Retry the local save check.');
    }
    // Match hydration's empty-state rule. Do not invent an empty metadata
    // update when a read-only document has never stored spaces.
    if (handle.getMeta(SPACES_KEY) !== undefined || scope.view.spaces?.length > 0) {
      handle.setMeta(SPACES_KEY, scope.view.spaces);
    }
    handle.applySurveyMarkers(scope.view.surveyMarkers);
  };

  const ensureLocalDurability = useCallback(async () => {
    const scope = localScope;
    const isCurrentScope = () => scope.mounted && localReceiptScopeRef.current === scope;
    if (!isCurrentScope() || !scope.documentId || !scope.actorUserId) {
      throw localReceiptError('ANNOTATION_LOCAL_SCOPE_CHANGED', 'The document or account changed during the local save check.');
    }
    const signature = localViewSignature(scope);
    const isCurrent = () => isCurrentScope() && localViewSignature(scope) === signature;
    let result;
    let receiptHandle;
    if (scope.enabled) {
      const handle = scope.handle;
      if (!scope.ready || !scope.renderedReady || !handle?.flushLocalDurability) {
        throw localReceiptError('ANNOTATION_LOCAL_NOT_READY', 'The local document is still loading.');
      }
      // Capture pending React state before asking the store for its own proof.
      // These are the same diff-only writes used by the regular capture effects.
      captureLocalReceiptState(handle, scope);
      const revision = handle.getLocalRevision?.();
      if (!Number.isSafeInteger(revision)) {
        throw localReceiptError('ANNOTATION_LOCAL_UNVERIFIED', 'The local document revision could not be verified.');
      }
      result = await handle.flushLocalDurability({
        expectedDocumentId: scope.documentId, expectedActorUserId: scope.actorUserId,
        isCurrent: () => isCurrent() && scope.handle === handle && scope.ready,
      });
      receiptHandle = handle;
      if (result?.revision !== revision || handle.getLocalRevision() !== revision
        || result.writerId !== handle.writerId) {
        throw localReceiptError('ANNOTATION_LOCAL_REVISION_CHANGED', 'The local document revision changed during the save check.');
      }
    } else {
      if (!scope.closeReceipt) {
        throw localReceiptError('ANNOTATION_LOCAL_NOT_READY', 'This tab has no confirmed local close record yet.');
      }
      const closed = await scope.closeReceipt;
      result = closed.proof;
      receiptHandle = closed.handle;
      if (closed.viewSignature !== signature) {
        throw localReceiptError('ANNOTATION_LOCAL_REVISION_CHANGED', 'The tab changed after its local save.');
      }
      if (!receiptHandle?.revalidateLocalReceipt) {
        throw localReceiptError('ANNOTATION_LOCAL_UNVERIFIED', 'The inactive tab needs a fresh local storage check.');
      }
      // Another browser context can purge shared IndexedDB after teardown.
      // Re-read persistent state before prepare; use the synchronous predicate
      // only for the short prepare-to-confirm interval.
      const refreshed = await receiptHandle.revalidateLocalReceipt(result);
      if (refreshed !== result) {
        throw localReceiptError('ANNOTATION_LOCAL_UNVERIFIED', 'The local storage check returned a different receipt.');
      }
    }
    if (!isCurrent()) {
      throw localReceiptError('ANNOTATION_LOCAL_REVISION_CHANGED', 'The document changed during its local save.');
    }
    if (result?.locallyDurable !== true || result.documentId !== scope.documentId
      || result.actorUserId !== scope.actorUserId
      || receiptHandle?.isLocalReceiptCurrent?.(result) !== true) {
      throw localReceiptError('ANNOTATION_LOCAL_UNVERIFIED', 'Local document storage could not be verified.');
    }
    const receipt = Object.freeze({ ...result, viewSignature: signature });
    // The service's proof is identity-bound. Keep its original object private
    // while exposing a view-bound wrapper to the native close check.
    scope.receipts.set(receipt, { proof: result, handle: receiptHandle, signature });
    return receipt;
  }, [localScope]);

  const isLocalDurabilityCurrent = useCallback((receipt) => {
    try {
      if (!localScope.mounted || localReceiptScopeRef.current !== localScope) return false;
      const issued = localScope.receipts.get(receipt);
      if (!issued || localViewSignature(localScope) !== issued.signature) return false;
      if (localScope.enabled && (!localScope.ready || localScope.handle !== issued.handle)) return false;
      return issued.handle.isLocalReceiptCurrent?.(issued.proof) === true;
    } catch { return false; }
  }, [localScope]);

  // Open the durable doc on documentId; hydrate from it (authoritative) or seed
  // it with whatever the viewer already has (covers marks drawn/imported before
  // the id resolved).
  useEffect(() => {
    if (!enabled || !documentId || !userId) {
      setSyncStatus({ stage: 'idle', healthy: true, error: null });
      setSyncQueueSize(0);
      setDeletedPdfAnnotations([]);
      return undefined;
    }
    let cancelled = false;
    let unsubscribeSync = null;
    let unsubscribeHistoryQuarantine = null;
    readyRef.current = false;
    localScope.ready = false;
    localScope.handle = null;
    localScope.closeReceipt = null;
    metaFallbackIdsRef.current = new Set();
    migrationDoneRef.current = null;
    inkRepairDoneRef.current = null;
    setInitialHydration({ ready: false, source: 'pending', count: 0, documentId });
    setDeletedPdfAnnotations([]);
    setSyncStatus({ stage: 'hydrating', healthy: true, error: null });
    setSyncQueueSize(0);

    (async () => {
      let handle;
      try {
        handle = await openAnnotationDoc({
          documentId,
          supabase,
          clientId: getClientId(),
          actorUserId: userId,
          eraseEffectConsumer: typeof eraseEffectConsumerRef.current === 'function'
            ? eraseEffectConsumerProxyRef.current
            : null,
        });
      } catch (err) {
        console.error('[useAnnotationDoc] open failed', err?.message);
        if (!cancelled) {
          setSyncStatus({ stage: 'error', healthy: false, error: err?.message || 'sync failed' });
          setSyncQueueSize(0);
        }
        return;
      }
      if (cancelled || localReceiptScopeRef.current !== localScope || !localScope.enabled) {
        try { await handle.destroy(); } catch { /* */ }
        return;
      }
      handleRef.current = handle;
      localScope.handle = handle;
      const updateSyncStatus = (next) => {
        if (cancelled || localReceiptScopeRef.current !== localScope || !next) return;
        setSyncStatus({
          stage: next.stage || (next.healthy === false ? 'error' : 'idle'),
          healthy: next.healthy !== false,
          error: next.error || null,
        });
        setSyncQueueSize(Math.max(0, Number(next.queueSize) || 0));
      };
      updateSyncStatus(handle.getSyncStatus?.());
      unsubscribeSync = handle.onSyncStatus?.(updateSyncStatus) || null;
      unsubscribeHistoryQuarantine = handle.onHistoryQuarantine?.((event) => {
        if (cancelled || localReceiptScopeRef.current !== localScope) return;
        onHistoryQuarantineRef.current?.(event);
      }) || null;

      // Remote ops (other devices) → reflect into React state.
      handle.onChange((byPage) => {
        if (cancelled || localReceiptScopeRef.current !== localScope) return;
        // Slice 6: callout groups ride INSIDE `byPage` (they live in the same
        // `annotations` Y.Map as every other object), carrying their verbatim
        // data.legacyCallout payloads. PDFViewer derives callouts[] from
        // annotationsByPage (R2.2 flip), so this single set delivers them —
        // no meta-list projection, no dual write.
        //
        // Read-only fallback upkeep: while unmigrated legacy meta callouts are
        // being rendered from a LOCAL projection, re-merge them here so a
        // remote op doesn't wipe them from view. When a remote editor's
        // migration lands (map entries + tombstone arrive as remote ops), the
        // recompute empties naturally and the fallback ends.
        let nextByPage = byPage;
        // A duplicate can land in the hydrate→realtime subscribe gap, after
        // the one-time first-paint repair. Re-run the exact-only repair on
        // every remote materialization while writable. Suppress its nested
        // notification and publish the cleaned materialization in this pass.
        if (isWritableDocRole(docRoleRef.current)) {
          const repair = runDurableStackedInkRepair(
            handle,
            documentId,
            { notify: false },
          );
          if (repair?.removed > 0) nextByPage = handle.getByPage();
        }
        if (metaFallbackIdsRef.current.size > 0) {
          const fallback = getUnmigratedMetaCallouts(handle.doc);
          metaFallbackIdsRef.current = new Set(fallback.ids);
          if (fallback.callouts.length > 0) {
            nextByPage = projectCalloutsIntoByPage(
              nextByPage,
              [...deriveCalloutsFromByPage(nextByPage), ...fallback.callouts],
              pageSizesRef?.current || {},
              { preserveUnmeasured: true },
            );
          }
        }
        setAnnotationsByPage((previousByPage) => (
          preserveTransientPagePresentationState(previousByPage, nextByPage)
        ));
        const s = handle.getMeta(SPACES_KEY);
        if (Array.isArray(s)) setSpaces(s);
        const sm = handle.getSurveyMarkers();
        if (sm && typeof sm === 'object') setSurveyMarkers(sm);
        setDeletedPdfAnnotations(handle.getDeletedPdfAnnotations?.() || []);
      });

      // Old import/sync races could save one path repeatedly under fresh ids.
      // After partial erase those copies become identical hairline fragments:
      // erasing one reveals the next and looks like regeneration. Repair the
      // authoritative flat Y.Doc after hydrate + listener wiring, but before
      // the first read/paint. It is a durable write, so viewers and unresolved
      // roles must stay read-only.
      if (isWritableDocRole(docRoleRef.current)) {
        if (runDurableStackedInkRepair(handle, documentId)) {
          inkRepairDoneRef.current = documentId;
        }
      }

      // Slice 6 — one-time migration for docs authored under the legacy
      // contract (callouts as a coarse `calloutsList` META blob). Converts the
      // meta list into per-id annotations-map groups, then tombstones the meta
      // (null). Idempotent + atomic (map writes + verification + tombstone in
      // one transaction; the tombstone only lands when every meta entry is
      // verified in the map). Runs BEFORE the getByPage() read below so the
      // migrated groups hydrate through the exact same path as natively-written
      // ones. The transaction origin is 'local', so annotationDocSync persists
      // the migration durably — which is exactly why it is WRITE-GATED: only a
      // confirmed-writable role runs it (viewer-tier RLS would reject every op
      // and wedge the sync status in error). Viewer / unresolved roles take the
      // zero-op read-only fallback below; if the role resolves writable later
      // this session, the late-resolution effect runs the migration then.
      if (isWritableDocRole(docRoleRef.current)) {
        if (runDurableCalloutMigration(handle, pageSizesRef?.current, documentId)) {
          migrationDoneRef.current = documentId;
        }
      }

      const storeByPage = handle.getByPage();
      setDeletedPdfAnnotations(handle.getDeletedPdfAnnotations?.() || []);
      const storeSpaces = handle.getMeta(SPACES_KEY);
      const storeSurvey = handle.getSurveyMarkers();
      const count = pageCount(storeByPage);
      const hasSpaces = Array.isArray(storeSpaces) && storeSpaces.length > 0;
      const hasSurvey = storeSurvey && Object.keys(storeSurvey).length > 0;

      // Read-only fallback (viewer role, or role not resolved yet): legacy meta
      // callouts that are NOT in the annotations map still render — projected
      // into the local byPage below — with ZERO Y.Doc ops. Their ids are
      // remembered so the capture effect strips them back out before every
      // applyByPage. After a writable-role migration above this is empty.
      const metaFallback = getUnmigratedMetaCallouts(handle.doc);
      metaFallbackIdsRef.current = new Set(metaFallback.ids);
      const hasMetaCallouts = metaFallback.callouts.length > 0;

      if (count > 0 || hasMetaCallouts || hasSpaces || hasSurvey) {
        // Durable store wins — paint from it. Callout groups arrive inside
        // storeByPage (and count toward `count`) like every other object.
        if (count > 0 || hasMetaCallouts) {
          // Slice 6 geometry normalization: rebuild the callout layer from each
          // group's verbatim data.legacyCallout at the locally measured dims
          // (lossless + idempotent — on a steady-state reopen this reproduces
          // byte-identical JSON, so the capture effect below emits ZERO Yjs
          // ops). preserveUnmeasured keeps STORED geometry verbatim on pages
          // whose dims have not landed yet (no US-Letter displacement flicker);
          // PDFViewer's [pageSizes]-keyed re-projection effect corrects those
          // the moment measurement lands (pageSizes is reset + re-measured on
          // every document open, so that effect always fires after this
          // hydrate). Unmigrated meta callouts ride the same projection.
          const sizesNow = pageSizesRef?.current || {};
          const storeCalloutList = deriveCalloutsFromByPage(storeByPage);
          const combinedCalloutList = hasMetaCallouts
            ? [...storeCalloutList, ...metaFallback.callouts]
            : storeCalloutList;
          const projectedByPage =
            combinedCalloutList.length > 0
              ? projectCalloutsIntoByPage(storeByPage, combinedCalloutList, sizesNow, { preserveUnmeasured: true })
              : storeByPage;
          if (count > 0 || projectedByPage !== storeByPage) {
            setAnnotationsByPage((previousByPage) => (
              preserveTransientPagePresentationState(previousByPage, projectedByPage)
            ));
          }
        }
        if (hasSpaces) setSpaces(storeSpaces);
        if (hasSurvey) setSurveyMarkers(storeSurvey);
        // Document-level kinds: if the store has SOME state but not this kind yet
        // (first open after each kind's migration shipped), seed it from the
        // per-device state the viewer already loaded so nothing is dropped.
        if (!hasSpaces) {
          const curSpaces = spacesRef.current;
          if (Array.isArray(curSpaces) && curSpaces.length > 0) handle.setMeta(SPACES_KEY, curSpaces);
        }
        if (!hasSurvey) {
          const curSurvey = surveyMarkersRef.current;
          if (curSurvey && Object.keys(curSurvey).length > 0) handle.applySurveyMarkers(curSurvey);
        }
      } else {
        // Empty store: seed it with whatever the viewer already holds so a mark
        // drawn (or imported) before this point is captured durably. Callout
        // groups already ride inside byPage (post-flip in-memory truth), so
        // applyByPage seeds them per-id too — no separate callout seed.
        const curByPage = byPageRef.current;
        if (curByPage && pageCount(curByPage) > 0) {
          const result = handle.applyByPage(curByPage);
          if (result?.identityChanged && result.normalizedByPage) {
            setAnnotationsByPage(result.normalizedByPage);
          }
        }
        const curSpaces = spacesRef.current;
        if (Array.isArray(curSpaces) && curSpaces.length > 0) handle.setMeta(SPACES_KEY, curSpaces);
        const curSurvey = surveyMarkersRef.current;
        if (curSurvey && Object.keys(curSurvey).length > 0) handle.applySurveyMarkers(curSurvey);
      }

      readyRef.current = true;
      localScope.ready = true;
      localScope.fallbackIds = metaFallbackIdsRef.current;
      // Drives the existing "import embedded marks when empty" effect: a
      // never-imported PDF hydrates empty (count 0) → that effect runs the
      // importer → its marks flow back through capture below → durable.
      setInitialHydration({ ready: true, source: 'annotation-doc', count, documentId });
    })();

    return () => {
      cancelled = true;
      const h = handleRef.current;
      handleRef.current = null;
      readyRef.current = false;
      unsubscribeSync?.();
      unsubscribeHistoryQuarantine?.();
      if (h && localScope.handle === h) {
        let signature;
        let revision;
        let captureError = null;
        try {
          if (!localScope.ready || !localScope.renderedReady) throw localReceiptError('ANNOTATION_LOCAL_NOT_READY', 'The local document did not finish loading.');
          captureLocalReceiptState(h, localScope);
          signature = localViewSignature(localScope);
          revision = h.getLocalRevision?.();
        } catch (error) { captureError = error; }
        localScope.handle = null;
        localScope.ready = false;
        // Seal the writer synchronously. Never keep it alive while waiting for
        // local storage: a new tab activation may already be opening its writer.
        h.destroy().catch(() => {});
        const receipt = h.getLocalCloseReceipt?.();
        localScope.closeReceipt = Promise.resolve(receipt).then((result) => {
          if (captureError) throw captureError;
          if (result?.locallyDurable !== true || !Number.isSafeInteger(revision)
            || result.revision !== revision || result.writerId !== h.writerId) {
            throw localReceiptError('ANNOTATION_LOCAL_UNVERIFIED', 'Local document storage could not be verified.');
          }
          return { proof: result, handle: h, viewSignature: signature };
        });
        localScope.closeReceipt.catch(() => {});
      } else if (h) { h.destroy().catch(() => {}); }
    };
  }, [enabled, documentId, userId, setAnnotationsByPage, setSpaces, setSurveyMarkers]);

  // The executor closes over document/template/user state and can legitimately
  // change after the durable handle opened. Reinstalling it also triggers an
  // immediate recovery attempt for work that was waiting on that context.
  useEffect(() => {
    const consumer = typeof eraseEffectConsumer === 'function'
      ? eraseEffectConsumerProxyRef.current
      : null;
    const cloudHandle = handleRef.current;
    if (cloudHandle?.setEraseEffectConsumer) {
      void cloudHandle.setEraseEffectConsumer(consumer);
    }
  }, [eraseEffectConsumer, initialHydration.ready]);

  // Capture annotation changes into the durable store (no-op when unchanged).
  // Slice 6: this single capture now carries callouts too — projected callout
  // groups sync per-id into the `annotations` Y.Map exactly like every other
  // object (the syncByPageToDoc callout skip and the coarse whole-list meta
  // capture are both retired). The read-only fallback's locally-projected
  // legacy callouts are STRIPPED first: there is no role gate in this capture
  // path (server RLS is the only write enforcement), so the local projection
  // must never become the first diff a viewer-tier client pushes.
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    const capturedByPage = stripMetaFallbackCallouts(
      annotationsByPage,
      metaFallbackIdsRef.current,
    );
    const hasEraserMutation = Object.values(capturedByPage || {}).some(
      (page) => page?.eraserMutation?.id,
    );
    const result = h.applyByPage(capturedByPage);
    setDeletedPdfAnnotations(h.getDeletedPdfAnnotations?.() || []);
    if (hasEraserMutation) {
      // eraserMutation is a one-render transport envelope, not page content.
      // Replace it immediately with the operation-materialized Y.Doc view so
      // localStorage/export never retain the raw gesture payload.
      const materialized = h.getByPage();
      setAnnotationsByPage((previousByPage) => (
        preserveTransientPagePresentationState(previousByPage, materialized)
      ));
    } else if (result?.identityChanged && result.normalizedByPage) {
      setAnnotationsByPage((previousByPage) => (
        preserveTransientPagePresentationState(previousByPage, result.normalizedByPage)
      ));
    }
  }, [annotationsByPage]);

  // Late role resolution: get_my_document_role is fetched async by YDocProvider
  // and often resolves AFTER the doc opened (docRole starts null = not yet
  // confirmed writable). The moment it resolves to a writable role, run the
  // durable migration the open path skipped, then end the read-only fallback
  // (the entries are now the doc's own, so the capture strip must stop hiding
  // them — future edits to those callouts persist normally). A role that stays
  // null (RPC failure — the documentRole fail-open contract covers UI only)
  // never migrates this session; the next confirmed-writable open does.
  useEffect(() => {
    if (!isWritableDocRole(docRole)) return;
    if (!initialHydration.ready || initialHydration.documentId !== documentId) return;
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    if (inkRepairDoneRef.current !== documentId) {
      if (runDurableStackedInkRepair(h, documentId)) {
        inkRepairDoneRef.current = documentId;
      }
    }
    if (migrationDoneRef.current === documentId) return;
    if (runDurableCalloutMigration(h, pageSizesRef?.current, documentId)) {
      migrationDoneRef.current = documentId;
      metaFallbackIdsRef.current = new Set();
    }
    // pageSizesRef is a ref (stable identity) — intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docRole, initialHydration, documentId]);

  // Capture space changes (document-level; coarse whole-array, no-op when
  // unchanged). Spaces + their region polygons now live durably in the Y.Doc
  // instead of the localStorage/Storage-sidecar pair.
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    h.setMeta(SPACES_KEY, spaces);
  }, [spaces]);

  // Capture survey-marker (highlight) changes into their keyed map (minimal
  // per-marker diff; no-op when unchanged). The Y.Doc is now the source of truth
  // for highlights — hydrate, realtime, and durability all flow through here.
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    h.applySurveyMarkers(surveyMarkers);
  }, [surveyMarkers]);

  // Cmd/Ctrl+S → drain pending appends + write a fresh snapshot.
  const forceFlush = useCallback(async () => {
    const h = handleRef.current;
    if (!h) return;
    setSyncStatus((prev) => ({ ...prev, stage: 'syncing' }));
    await h.drain();
    const saved = await h.flushSnapshot();
    const next = h.getSyncStatus?.() || {};
    setSyncStatus({
      stage: saved && next.healthy !== false ? 'idle' : 'error',
      healthy: saved && next.healthy !== false,
      error: saved ? null : (next.error || 'sync failed'),
    });
    setSyncQueueSize(Math.max(0, Number(next.queueSize) || 0));
  }, []);

  const commitEraserMutation = useCallback(({
    pageNumber,
    pageAnnotations,
    eraserMutation,
  } = {}) => {
    const h = handleRef.current;
    if (!h || !readyRef.current || !eraserMutation?.id) return null;
    const materializedPage = h.applyEraserMutation(
      pageNumber,
      pageAnnotations,
      eraserMutation,
    );
    if (!materializedPage) return null;
    return {
      ...materializedPage,
      eraserPresentationRevision: eraserMutation.id,
    };
  }, []);

  // KAL-309: expose the durable Y.Doc META map to the Excel-sync cutover so the
  // single `excelSyncFrontier:${templateId}` cursor + the durable review set live
  // in the same source-of-truth doc as the markers. `metaSet` takes an explicit
  // origin (the handle's setMeta hardcodes 'local'); 'excel-import' keeps these
  // writes additive + durable without tripping the survey-marker deletion gate.
  const metaGet = useCallback((key) => {
    const h = handleRef.current;
    return h ? h.getMeta(key) : undefined;
  }, []);
  const metaSet = useCallback((key, value, origin = 'excel-import') => {
    const h = handleRef.current;
    if (!h || !h.doc) return false;
    return setMetaValueOnDoc(h.doc, key, value, origin);
  }, []);

  const commitEraseIntent = useCallback(async (intent, options = {}) => {
    const cloudHandle = handleRef.current;
    if (!cloudHandle || !readyRef.current) {
      return {
        status: 'cancelled',
        reason: 'sync-not-ready',
        mutationId: intent?.mutationId || null,
      };
    }

    const ownerHandle = cloudHandle;

    const result = await ownerHandle.commitEraseIntent(intent, options);
    if (handleRef.current !== ownerHandle || !readyRef.current) {
      return {
        status: 'cancelled',
        reason: 'stale-handle',
        mutationId: intent?.mutationId || null,
      };
    }
    if (
      ['committed', 'noop'].includes(result.status)
      && result.historyQuarantineGeneration !== ownerHandle.getHistoryQuarantineGeneration?.()
    ) {
      return {
        status: 'cancelled',
        reason: 'authoritative-rollback',
        mutationId: intent?.mutationId || null,
        historyQuarantineGeneration: ownerHandle.getHistoryQuarantineGeneration?.() ?? null,
        byPage: ownerHandle.getByPage(),
        surveyMarkers: ownerHandle.getSurveyMarkers(),
      };
    }
    if (result.status !== 'committed' && result.status !== 'noop') {
      return {
        ...result,
        byPage: ownerHandle.getByPage(),
        surveyMarkers: ownerHandle.getSurveyMarkers(),
      };
    }

    let nextByPage = result.byPage || ownerHandle.getByPage();
    if (intent?.presentationRevision && intent?.pageNumber) {
      const pageKey = String(intent.pageNumber);
      nextByPage = {
        ...nextByPage,
        [pageKey]: {
          ...(nextByPage[pageKey] || { objects: [] }),
          eraserPresentationRevision: intent.presentationRevision,
        },
      };
    }
    nextByPage = preserveTransientPagePresentationState(byPageRef.current, nextByPage);
    const nextSurveyMarkers = result.surveyMarkers || ownerHandle.getSurveyMarkers();
    setDeletedPdfAnnotations(ownerHandle.getDeletedPdfAnnotations?.() || []);
    byPageRef.current = nextByPage;
    surveyMarkersRef.current = nextSurveyMarkers;
    setAnnotationsByPage(nextByPage);
    setSurveyMarkers(nextSurveyMarkers);
    return {
      ...result,
      byPage: nextByPage,
      surveyMarkers: nextSurveyMarkers,
    };
  }, [
    setAnnotationsByPage,
    setSurveyMarkers,
  ]);

  const applyEraseHistoryTransition = useCallback((transition, direction) => {
    const ownerHandle = handleRef.current;
    if (!ownerHandle || !readyRef.current) {
      return { status: 'conflict', reason: 'sync-not-ready' };
    }
    const result = ownerHandle.applyEraseHistoryTransition(transition, direction);
    if (result.status !== 'applied' && result.status !== 'noop') return result;
    const nextByPage = preserveTransientPagePresentationState(
      byPageRef.current,
      result.byPage || ownerHandle.getByPage(),
    );
    byPageRef.current = nextByPage;
    setDeletedPdfAnnotations(
      result.deletedPdfAnnotations
        || ownerHandle.getDeletedPdfAnnotations?.()
        || [],
    );
    setAnnotationsByPage(nextByPage);
    return { ...result, byPage: nextByPage };
  }, [setAnnotationsByPage]);

  const restoreEraseDeletion = useCallback((restoreActions, options = {}) => {
    const ownerHandle = handleRef.current;
    if (!ownerHandle || !readyRef.current) {
      return { status: 'conflict', reason: 'sync-not-ready' };
    }
    const result = ownerHandle.restoreEraseDeletion(restoreActions, options);
    if (result.status !== 'applied' && result.status !== 'noop') return result;
    const nextByPage = preserveTransientPagePresentationState(
      byPageRef.current,
      result.byPage || ownerHandle.getByPage(),
    );
    byPageRef.current = nextByPage;
    setDeletedPdfAnnotations(
      result.deletedPdfAnnotations
        || ownerHandle.getDeletedPdfAnnotations?.()
        || [],
    );
    setAnnotationsByPage(nextByPage);
    return { ...result, byPage: nextByPage };
  }, [setAnnotationsByPage]);

  const getHistoryQuarantineGeneration = useCallback(() => (
    handleRef.current?.getHistoryQuarantineGeneration?.() ?? null
  ), []);

  return {
    initialHydration,
    deletedPdfAnnotations,
    commitEraseIntent,
    applyEraseHistoryTransition,
    restoreEraseDeletion,
    getHistoryQuarantineGeneration,
    ensureLocalDurability,
    isLocalDurabilityCurrent,
    forceFlush,
    commitEraserMutation,
    metaGet,
    metaSet,
    status: syncStatus,
    queueSize: syncQueueSize,
  };
}
