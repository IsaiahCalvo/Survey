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

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient.js';
import { openAnnotationDoc, getClientId } from '../services/annotationDocSync.js';
import {
  META_MAP,
  getAnnotationsMap,
  preserveTransientPagePresentationState,
  setMetaValue as setMetaValueOnDoc,
} from '../services/annotationDocStore.js';
import { applyReconcileSwaps } from '../utils/annotationReconcile.js';
import {
  ANNOTATION_HYDRATION_PREVIEW_SOURCE,
  ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE,
} from '../utils/annotationHydrationGate.js';
import { claimBodyReadOnly } from '../utils/readOnlyBodyReasons.js';
import { syncTrace, syncTraceEnabled } from '../services/syncTrace.js';
import {
  migrateCalloutsMetaToAnnotationsMap,
  getUnmigratedMetaCallouts,
} from '../services/calloutMetaMigration.js';
import {
  projectCalloutsIntoByPage as projectCalloutsIntoByPageShared,
  deriveCalloutsFromByPage,
} from '../utils/calloutAnnotationBridge.js';
import {
  legacyCarryOverWaitsForEmbeddedImport,
  legacyMarksCarryOverPending,
} from '../services/legacyMarksCarryOver.js';
import {
  EMBEDDED_IMPORT_INCOMPLETE_KEY,
  EMBEDDED_IMPORT_MARKER_KEY,
} from '../utils/embeddedImportGate.js';
import {
  annotationStoreCompactionPending,
  annotationStoreCompactionReady,
} from '../services/annotationStoreCompaction.js';

const SPACES_KEY = 'spaces';
function livePreviewPublicChannelInDev() {
  if (!import.meta.env?.DEV) return false;
  try { return globalThis.localStorage?.getItem('survey:livePreviewPublicChannel') === '1'; } catch { return false; }
}

// w30: add other screens' in-flight new marks (handle.getLivePreviewByPage)
// to a page list read from the document. A mark the document already holds
// wins; the page list is returned unchanged when there is nothing to add.
const EMPTY_LIVE_MARKER_OVERLAY = Object.freeze({ markers: new Map(), spaces: null });

function withLivePreviews(byPage, handle) {
  // w32: the handle also applies other screens' in-flight EDITS (a move,
  // restyle, erase or delete shows before its WAL row) — display only, the
  // handle's applyByPage takes them back out of every capture.
  if (typeof handle?.withLiveOverlays === 'function') return handle.withLiveOverlays(byPage);
  const overlay = handle?.getLivePreviewByPage?.();
  if (!overlay || Object.keys(overlay).length === 0) return byPage;
  const next = { ...(byPage || {}) };
  for (const [pageNumber, objects] of Object.entries(overlay)) {
    const page = next[pageNumber] || { objects: [] };
    const present = new Set((page.objects || []).map((object) => (
      object?.data?.id ?? object?.id ?? null
    )).filter((id) => id != null).map(String));
    const added = objects.filter((object) => {
      const id = object?.data?.id ?? object?.id ?? null;
      return id == null || !present.has(String(id));
    });
    if (added.length > 0) next[pageNumber] = { ...page, objects: [...(page.objects || []), ...added] };
  }
  return next;
}

// w28: how long a writable open waits for the PDF's own embedded import
// before carrying old marks anyway (see the carry-over effect below).
const LEGACY_CARRY_WAIT_MS = 60_000;
// ...and the random spread before carrying, so two screens that open at once
// rarely carry at once.
const LEGACY_CARRY_JITTER_MS = 1_500;
// w33: the one-time store compaction runs this long after realtime is ready
// (plus a random spread): after the carry-over and away from the open's own
// work (first paint, embedded import).
const STORE_COMPACTION_DELAY_MS = 6_000;
const STORE_COMPACTION_JITTER_MS = 3_000;
// Failed-open retry (w26): 2 s, 4 s, 8 s ... capped at 60 s, 8 tries per document.
const OPEN_RETRY_BASE_DELAY_MS = 2_000;
const OPEN_RETRY_MAX_DELAY_MS = 60_000;
const OPEN_RETRY_MAX_ATTEMPTS = 8;

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

// w28 (2026-09-24): marks drawn on older builds live in the old `annotations`
// map, which the per-field store does not read. The owner wants them shown,
// so the first writable open of each document copies them into `marks` once
// (legacyMarksCarryOver.js: old ids, never overwrites, marker last). Viewers
// and an unresolved role never write. Returns the result, or null on error
// (never blocks hydration; the next writable open retries).
function runLegacyMarksCarryOver(handle, documentId, { notify, reason }) {
  if (typeof handle?.carryOverLegacyMarks !== 'function') return null;
  try {
    const result = handle.carryOverLegacyMarks({ notify });
    if (result?.status === 'done') {
      console.log('[useAnnotationDoc] carried marks from older builds', {
        documentId,
        reason,
        carried: result.carried,
        alreadyPresent: result.alreadyPresent,
        alreadyCarried: result.alreadyCarried,
        editedPdfReplaced: result.editedPdfReplaced,
        editedPdfCreated: result.editedPdfCreated,
        editedPdfSkipped: result.editedPdfSkipped,
        editedPdfDeferred: result.editedPdfDeferred,
        markerWritten: result.markerWritten,
        eligible: result.eligible,
        skippedPdfImported: result.skippedPdf,
        skippedUnreadable: result.skippedInvalid,
        batches: result.batches,
      });
    }
    return result;
  } catch (err) {
    console.error('[useAnnotationDoc] carrying marks from older builds failed', err?.message);
    return null;
  }
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
  // Optional { current: { until } }: while Date.now() < until the capture
  // below skips writing. PDFViewer holds it during a colour-slider drag so
  // only the released value reaches the document (UX 2026-09-23, smooth
  // sliders); it always lifts on release or after 1.5s and then re-renders,
  // so the next capture writes the full current state.
  capturePauseRef = null,
  // w33: a locked document refuses every write (WAL lock gate); the one-time
  // store compaction below never runs while it is locked.
  documentLocked = false,
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
  // 2026-10-07 (first-open save): ids of the PDF's own marks being imported
  // (beginBulkImport). The capture hands them to the store as a bulk import:
  // saved as one checkpoint, never ahead of (or in the way of) the user's
  // own edits. Each id leaves the set once the store has it.
  const bulkImportKeysRef = useRef(new Set());
  // w29 preview: what the viewer held before the first early paint for this
  // document (byPage null = no preview shown since the last successful
  // hydrate). Kept across failed-open retries of the same document, so marks
  // painted by a failed attempt are never taken for the viewer's own. The
  // early paint is display-only: an empty store is never seeded from it.
  const prePreviewRef = useRef({ documentId: null, byPage: null });
  const [initialHydration, setInitialHydration] = useState({ ready: false, source: 'pending', count: 0, documentId: null });
  // A failed open (e.g. the WAL tail read timing out) is retried with backoff
  // instead of leaving the page covered forever (w26). Bumping the tick re-runs
  // the open effect; the failure count is per document.
  const [openRetryTick, setOpenRetryTick] = useState(0);
  const openFailuresRef = useRef({ documentId: null, count: 0 });
  const [deletedPdfAnnotations, setDeletedPdfAnnotations] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ stage: 'idle', healthy: true, error: null });
  // w53: other screens' in-flight Survey Marker / spaces changes, DRAWN only
  // (never written to surveyMarkers / spaces, so the capture never saves
  // them): { markers: Map<id, record|null>, spaces: Array|null }.
  const [liveMarkerOverlay, setLiveMarkerOverlay] = useState(EMPTY_LIVE_MARKER_OVERLAY);
  const [syncQueueSize, setSyncQueueSize] = useState(0);

  byPageRef.current = annotationsByPage;
  spacesRef.current = spaces;
  surveyMarkersRef.current = surveyMarkers;
  docRoleRef.current = docRole;

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
    let unsubscribeLivePreview = null;
    let retryTimer = null;
    readyRef.current = false;
    metaFallbackIdsRef.current = new Set();
    migrationDoneRef.current = null;
    inkRepairDoneRef.current = null;
    bulkImportKeysRef.current = new Set();
    if (prePreviewRef.current.documentId !== documentId) {
      prePreviewRef.current = { documentId, byPage: null };
    }
    if (openFailuresRef.current.documentId !== documentId) {
      openFailuresRef.current = { documentId, count: 0 };
    }
    // A retry keeps the 'unavailable' state: the PDF stays visible while the
    // marks are fetched again (see annotationHydrationGate.js).
    setInitialHydration((previous) => (
      previous?.source === ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE && previous.documentId === documentId
        ? previous
        : { ready: false, source: 'pending', count: 0, documentId }
    ));
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
          // UX (w30, 2026-09-24): a mark drawn on one screen shows on every
          // other screen with the document open in a few hundred ms, the way
          // Figma and Drawboard feel, instead of after its database round
          // trip (~1 s, several seconds on a big document). Each small edit
          // is also broadcast; the log still decides what is saved.
          livePreview: true,
          // Private channel (document members only). A dev build can use a
          // public topic for measuring before the channel policies exist:
          // localStorage 'survey:livePreviewPublicChannel' = '1'.
          livePreviewPrivate: !livePreviewPublicChannelInDev(),
          eraseEffectConsumer: typeof eraseEffectConsumerRef.current === 'function'
            ? eraseEffectConsumerProxyRef.current
            : null,
          // UX (w29, open speed): the document's marks paint as soon as this
          // device's saved copy (or the cloud snapshot) is read, instead of
          // after the whole open (seconds on a big document). Display only:
          // hydration stays not-ready, so nothing is written or imported and
          // the first page keeps blocking input (see annotationHydrationGate)
          // until the real hydrate below replaces this with the same marks.
          onPreview: (previewByPage) => {
            if (cancelled) return;
            if (prePreviewRef.current.byPage === null) {
              prePreviewRef.current = { documentId, byPage: byPageRef.current || {} };
            }
            const calloutList = deriveCalloutsFromByPage(previewByPage);
            const projected = calloutList.length > 0
              ? projectCalloutsIntoByPage(
                previewByPage,
                calloutList,
                pageSizesRef?.current || {},
                { preserveUnmeasured: true },
              )
              : previewByPage;
            setAnnotationsByPage((previousByPage) => (
              preserveTransientPagePresentationState(previousByPage, projected)
            ));
            setInitialHydration((previous) => (
              previous?.ready && previous.documentId === documentId
                ? previous
                : {
                  ready: false,
                  source: ANNOTATION_HYDRATION_PREVIEW_SOURCE,
                  count: pageCount(projected),
                  documentId,
                }
            ));
          },
        });
      } catch (err) {
        console.error('[useAnnotationDoc] open failed', err?.message);
        if (!cancelled) {
          setSyncStatus({ stage: 'error', healthy: false, error: err?.message || 'sync failed' });
          setSyncQueueSize(0);
          // UX (w26, 2026-09-24): a document whose marks cannot be read right
          // now (a database timeout, the network) still shows its PDF: the
          // hydration becomes 'unavailable' (not ready — nothing imports into
          // or writes to the store, the sync status shows the error) and the
          // first-page cover lifts. The open is retried with backoff and the
          // marks appear when it succeeds. Before, the page sat on loading
          // dots forever. A deleted document or a permission denial is final.
          const failures = openFailuresRef.current;
          failures.count += 1;
          setInitialHydration({
            ready: false,
            source: ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE,
            count: 0,
            documentId,
            error: err?.message || 'annotation store unavailable',
          });
          const code = String(err?.code || '');
          const permanent = code === 'ANNOTATION_DOCUMENT_DELETED'
            || code === '42501'
            || /permission denied|row.level security/i.test(err?.message || '');
          if (!permanent && failures.count <= OPEN_RETRY_MAX_ATTEMPTS) {
            const delayMs = Math.min(
              OPEN_RETRY_MAX_DELAY_MS,
              OPEN_RETRY_BASE_DELAY_MS * (2 ** (failures.count - 1)),
            );
            retryTimer = setTimeout(() => {
              retryTimer = null;
              if (!cancelled) setOpenRetryTick((tick) => tick + 1);
            }, delayMs);
          }
        }
        return;
      }
      openFailuresRef.current = { documentId, count: 0 };
      if (cancelled) { try { await handle.destroy(); } catch { /* */ } return; }
      handleRef.current = handle;
      const updateSyncStatus = (next) => {
        if (cancelled || !next) return;
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
        if (cancelled) return;
        onHistoryQuarantineRef.current?.(event);
      }) || null;

      // Remote ops (other devices) → reflect into React state.
      handle.onChange((byPage) => {
        if (cancelled) return;
        syncTrace('onchange');
        // Slice 6: callout groups ride INSIDE `byPage` (they live in the same
        // `annotations` Y.Map as every other object), carrying their verbatim
        // data.legacyCallout payloads. PDFViewer derives callouts[] from
        // annotationsByPage (R2.2 flip), so this single set delivers them —
        // no meta-list projection, no dual write.
        //
        // A duplicate can land in the hydrate→realtime subscribe gap, after
        // the one-time first-paint repair. Re-run the exact-only repair on
        // every remote materialization while writable. Suppress its nested
        // notification; the read below picks up the cleaned state.
        if (isWritableDocRole(docRoleRef.current)) {
          runDurableStackedInkRepair(handle, documentId, { notify: false });
        }
        // Read-only fallback upkeep: while unmigrated legacy meta callouts are
        // being rendered from a LOCAL projection, re-merge them so a remote op
        // doesn't wipe them from view. When a remote editor's migration lands
        // (map entries + tombstone arrive as remote ops), the recompute
        // empties naturally and the fallback ends.
        const fallback = metaFallbackIdsRef.current.size > 0
          ? getUnmigratedMetaCallouts(handle.doc)
          : null;
        if (fallback) metaFallbackIdsRef.current = new Set(fallback.ids);
        setAnnotationsByPage((previousByPage) => {
          if (cancelled) return previousByPage;
          // Per-field sync (2026-09-24): read the document when React applies
          // this update, not when the notification fired. A local edit
          // captured in between is then part of what the screen shows instead
          // of being painted over by an older copy.
          syncTrace('react-update-start');
          let nextByPage = byPage;
          try { nextByPage = handle.getByPage(); } catch { /* closed handle: keep the notified copy */ }
          syncTrace('react-update-read');
          nextByPage = withLivePreviews(nextByPage, handle);
          if (fallback && fallback.callouts.length > 0) {
            nextByPage = projectCalloutsIntoByPage(
              nextByPage,
              [...deriveCalloutsFromByPage(nextByPage), ...fallback.callouts],
              pageSizesRef?.current || {},
              { preserveUnmeasured: true },
            );
          }
          return preserveTransientPagePresentationState(previousByPage, nextByPage);
        });
        const s = handle.getMeta(SPACES_KEY);
        if (Array.isArray(s)) setSpaces(s);
        const sm = handle.getSurveyMarkers();
        if (sm && typeof sm === 'object') setSurveyMarkers(sm);
        setDeletedPdfAnnotations(handle.getDeletedPdfAnnotations?.() || []);
      });

      // w30: another screen's new mark, broadcast before its WAL row, shows
      // at once (display only; the handle drops it again from every capture)
      // and leaves when its row brings the real mark or it never comes.
      unsubscribeLivePreview = handle.onLivePreviewChange?.(() => {
        if (cancelled) return;
        const markerOverlay = handle.getLiveMarkerOverlay?.();
        setLiveMarkerOverlay((previous) => {
          const empty = !markerOverlay || (markerOverlay.markers.size === 0 && !markerOverlay.spaces);
          if (empty) return previous === EMPTY_LIVE_MARKER_OVERLAY ? previous : EMPTY_LIVE_MARKER_OVERLAY;
          return markerOverlay; // the handle returns the same object while unchanged
        });
        // Same read-only fallback upkeep as a remote change (above).
        const fallback = metaFallbackIdsRef.current.size > 0
          ? getUnmigratedMetaCallouts(handle.doc)
          : null;
        if (fallback) metaFallbackIdsRef.current = new Set(fallback.ids);
        setAnnotationsByPage((previousByPage) => {
          if (cancelled) return previousByPage;
          let nextByPage = previousByPage;
          try { nextByPage = withLivePreviews(handle.getByPage(), handle); } catch { return previousByPage; }
          if (fallback && fallback.callouts.length > 0) {
            nextByPage = projectCalloutsIntoByPage(
              nextByPage,
              [...deriveCalloutsFromByPage(nextByPage), ...fallback.callouts],
              pageSizesRef?.current || {},
              { preserveUnmeasured: true },
            );
          }
          return preserveTransientPagePresentationState(previousByPage, nextByPage);
        });
      }) || null;

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
        } else if (prePreviewRef.current.byPage !== null) {
          // w29: an early paint showed marks that are gone from the store now.
          setAnnotationsByPage(prePreviewRef.current.byPage);
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
        // w29: marks shown by an early paint came from the store itself and are
        // gone from it now (deleted meanwhile); take them off the screen and
        // seed only what the viewer held before that paint.
        const prePreview = prePreviewRef.current.byPage;
        if (prePreview !== null) setAnnotationsByPage(prePreview);
        const curByPage = prePreview !== null ? prePreview : byPageRef.current;
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
      prePreviewRef.current = { documentId, byPage: null };
      // Drives the existing "import embedded marks when empty" effect: a
      // never-imported PDF hydrates empty (count 0) → that effect runs the
      // importer → its marks flow back through capture below → durable.
      setInitialHydration({ ready: true, source: 'annotation-doc', count, documentId });
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      const h = handleRef.current;
      handleRef.current = null;
      readyRef.current = false;
      unsubscribeSync?.();
      unsubscribeHistoryQuarantine?.();
      unsubscribeLivePreview?.();
      setLiveMarkerOverlay(EMPTY_LIVE_MARKER_OVERLAY);
      if (h) { h.destroy().catch(() => {}); }
    };
  }, [enabled, documentId, userId, setAnnotationsByPage, setSpaces, setSurveyMarkers, openRetryTick]);

  // UX (w26 review, 2026-09-24): while the store is 'unavailable' the PDF
  // shows but nothing can be saved, and a later successful open would paint
  // the stored marks over anything drawn meanwhile. So the document is
  // read-only until the open succeeds — the same body[data-readonly] layer a
  // viewer or a locked document gets (toolbar dimmed, drawing keys and page
  // hit targets off). The sync status shows why.
  const storeUnavailable = initialHydration?.source === ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE
    && initialHydration?.documentId === documentId;
  useEffect(() => {
    if (!storeUnavailable) return undefined;
    return claimBodyReadOnly(`annotation-store-unavailable:${documentId}`);
  }, [storeUnavailable, documentId]);

  // UX (w29, open speed): while early-painted marks are showing and the store
  // is still opening, nothing drawn could be saved (the capture waits for
  // hydration, which then replaces the page). Same read-only layer as above,
  // on every page and for the keyboard too, for the second or two until the
  // open finishes; the marks are already visible meanwhile.
  const storePreviewing = initialHydration?.source === ANNOTATION_HYDRATION_PREVIEW_SOURCE
    && initialHydration?.ready !== true
    && initialHydration?.documentId === documentId;
  useEffect(() => {
    if (!storePreviewing) return undefined;
    return claimBodyReadOnly(`annotation-store-opening:${documentId}`);
  }, [storePreviewing, documentId]);

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
  // w30 latency trace (opt-in, see syncTrace.js): when React put a new page
  // list in the DOM, and the start of the frame that paints it.
  useLayoutEffect(() => {
    if (!syncTraceEnabled()) return;
    syncTrace('react-commit');
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => syncTrace('paint-frame'));
    }
  }, [annotationsByPage]);

  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    if (capturePauseRef?.current?.until && Date.now() < capturePauseRef.current.until) return;
    const capturedByPage = stripMetaFallbackCallouts(
      annotationsByPage,
      metaFallbackIdsRef.current,
    );
    const hasEraserMutation = Object.values(capturedByPage || {}).some(
      (page) => page?.eraserMutation?.id,
    );
    const bulkKeys = bulkImportKeysRef.current.size > 0 ? bulkImportKeysRef.current : null;
    const result = h.applyByPage(capturedByPage, bulkKeys ? { bulkKeys } : undefined);
    if (bulkKeys) for (const key of result?.bulkWritten || []) bulkKeys.delete(key);
    setDeletedPdfAnnotations(h.getDeletedPdfAnnotations?.() || []);
    if (hasEraserMutation) {
      // eraserMutation is a one-render transport envelope, not page content.
      // Replace it immediately with the operation-materialized Y.Doc view so
      // localStorage/export never retain the raw gesture payload.
      const materialized = withLivePreviews(h.getByPage(), h);
      setAnnotationsByPage((previousByPage) => (
        preserveTransientPagePresentationState(previousByPage, materialized)
      ));
    } else if ((result?.identityChanged && result.normalizedByPage) || result?.reconcile) {
      setAnnotationsByPage((previousByPage) => {
        let nextByPage = previousByPage;
        if (result.identityChanged && result.normalizedByPage) {
          nextByPage = preserveTransientPagePresentationState(
            previousByPage,
            withLivePreviews(result.normalizedByPage, h),
          );
        }
        // The screen was behind the document for some marks (see
        // applyReconcileSwaps): show the document's copy.
        return applyReconcileSwaps(nextByPage, result.reconcile);
      });
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

  // w28: carry marks drawn on older builds into the per-field store, once per
  // document (legacyMarksCarryOver.js), on a writable open that is ready.
  // UX: the old marks appear a moment after the document opens, looking
  // exactly as they did.
  // When (review A, w28): two screens that carry the same document at the
  // same moment each create the marks; Yjs keeps one copy, so an edit made on
  // the other copy in that short window is lost. To keep that window small:
  //   * wait until realtime has caught up after subscribing (so another
  //     screen's carry-over that already landed is seen first), plus a random
  //     0-1.5 s, then re-check;
  //   * if the PDF's own embedded import has not run yet, wait for THIS
  //     screen's import pass (its local marker or "incomplete" record): the
  //     import saves whole pages built from what the screen held a moment
  //     earlier and would paint over a carry-over published meanwhile. A
  //     marker written by another screen is not a trigger (that screen
  //     carries right after its own import; triggering here too would make
  //     every open screen carry at once). After LEGACY_CARRY_WAIT_MS without
  //     a local pass, carry if still needed.
  // The carried marks reach the screen through the normal change path.
  useEffect(() => {
    if (!isWritableDocRole(docRole)) return undefined;
    if (!initialHydration.ready || initialHydration.documentId !== documentId) return undefined;
    const h = handleRef.current;
    if (!h || !readyRef.current || typeof h.carryOverLegacyMarks !== 'function') return undefined;
    if (!legacyMarksCarryOverPending(h.doc)) return undefined;
    let finished = false;
    let observing = false;
    let unsubscribeStatus = null;
    const timers = new Set();
    const later = (fn, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
      timers.add(timer);
    };
    const meta = h.doc.getMap(META_MAP);
    const stop = () => {
      finished = true;
      if (observing) meta.unobserve(onMeta);
      observing = false;
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
    const run = (reason) => {
      if (finished) return;
      stop();
      if (handleRef.current !== h || !readyRef.current) return;
      if (!legacyMarksCarryOverPending(h.doc)) return;
      runLegacyMarksCarryOver(h, documentId, { notify: true, reason });
    };
    // Observers run inside Yjs's transaction cleanup: write from a fresh task.
    let importPassSeen = false;
    function onMeta(event) {
      if (finished || importPassSeen || !event.transaction.local) return;
      if (
        !event.keysChanged.has(EMBEDDED_IMPORT_MARKER_KEY)
        && !event.keysChanged.has(EMBEDDED_IMPORT_INCOMPLETE_KEY)
      ) return;
      importPassSeen = true;
      later(() => run('after-embedded-import'), Math.floor(Math.random() * LEGACY_CARRY_JITTER_MS));
    }
    let begun = false;
    const begin = () => {
      if (finished || begun) return;
      begun = true;
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      if (!legacyCarryOverWaitsForEmbeddedImport(h.doc)) {
        later(() => run('open'), Math.floor(Math.random() * LEGACY_CARRY_JITTER_MS));
        return;
      }
      meta.observe(onMeta);
      observing = true;
      later(() => run('wait-timeout'), LEGACY_CARRY_WAIT_MS);
    };
    if (typeof h.isRealtimeReady !== 'function' || h.isRealtimeReady()) {
      begin();
    } else {
      unsubscribeStatus = h.onSyncStatus?.(() => {
        if (h.isRealtimeReady()) later(begin, 0);
      }) || null;
    }
    return stop;
  }, [docRole, initialHydration.ready, initialHydration.documentId, documentId]);

  // w33 (2026-09-25): shrink what this document already stores, once
  // (annotationStoreCompaction.js): delete the old `annotations` map after the
  // w28 carry-over finished, and rewrite marks still holding the dropped
  // provenance field or derivable polygons. Writable, unlocked opens only,
  // after the embedded import and the carry-over (it re-checks both, and
  // waits on meta changes when either is not done yet). Idempotent: a second
  // screen doing the same converges; with nothing to shrink nothing is
  // written. The next checkpoint of the live doc is then small, so every
  // later open downloads less.
  const documentLockedRef = useRef(documentLocked);
  documentLockedRef.current = documentLocked;
  useEffect(() => {
    if (!isWritableDocRole(docRole) || documentLocked) return undefined;
    if (!initialHydration.ready || initialHydration.documentId !== documentId) return undefined;
    const h = handleRef.current;
    if (!h || !readyRef.current || typeof h.compactAnnotationStore !== 'function') return undefined;
    let finished = false;
    let timer = null;
    let unsubscribeStatus = null;
    // Only unobserve what begin() observed: stop() runs again on unmount after
    // run() already stopped (or before begin), and Yjs logs an error for an
    // unknown handler ("[yjs] Tried to remove event handler that doesn't exist").
    let observing = false;
    const meta = h.doc.getMap(META_MAP);
    const stop = () => {
      finished = true;
      if (observing) meta.unobserve(onMeta);
      observing = false;
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = (ms) => {
      if (finished || timer) return;
      timer = setTimeout(() => { timer = null; run(); }, ms);
    };
    function onMeta() {
      // Observers run inside Yjs's transaction cleanup: act from a fresh task.
      schedule(Math.floor(Math.random() * STORE_COMPACTION_JITTER_MS));
    }
    function run() {
      if (finished) return;
      if (handleRef.current !== h || !readyRef.current || documentLockedRef.current) { stop(); return; }
      // Not yet: the embedded import or the carry-over is still to come.
      // A meta change (their markers) brings us back here.
      if (!annotationStoreCompactionReady(h.doc) || legacyMarksCarryOverPending(h.doc)) return;
      let pending = false;
      try { pending = annotationStoreCompactionPending(h.doc); } catch { pending = false; }
      stop();
      if (!pending) return;
      try {
        const result = h.compactAnnotationStore({ notify: true });
        console.log('[useAnnotationDoc] compacted the stored annotations', { documentId, ...result });
      } catch (err) {
        console.error('[useAnnotationDoc] compacting the stored annotations failed', err?.message);
      }
    }
    let begun = false;
    const begin = () => {
      if (finished || begun) return;
      begun = true;
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      meta.observe(onMeta);
      observing = true;
      schedule(STORE_COMPACTION_DELAY_MS + Math.floor(Math.random() * STORE_COMPACTION_JITTER_MS));
    };
    if (typeof h.isRealtimeReady !== 'function' || h.isRealtimeReady()) {
      begin();
    } else {
      unsubscribeStatus = h.onSyncStatus?.(() => {
        if (h.isRealtimeReady()) setTimeout(begin, 0);
      }) || null;
    }
    return stop;
  }, [docRole, documentLocked, initialHydration.ready, initialHydration.documentId, documentId]);

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

  // 2026-10-07: the embedded import names its marks before saving them (see
  // bulkImportKeysRef), then waits for them to be stored in the cloud before
  // writing its once-only marker: true once they are, false if this screen
  // could not store them (the next open tries again; ids are stable).
  const beginBulkImport = useCallback((keys) => {
    for (const key of keys || []) if (key != null) bulkImportKeysRef.current.add(String(key));
  }, []);
  const whenBulkImportSaved = useCallback(async () => {
    const h = handleRef.current;
    if (!h || typeof h.whenBulkSaved !== 'function') return true;
    try {
      return await h.whenBulkSaved();
    } finally {
      if (handleRef.current === h) bulkImportKeysRef.current.clear();
    }
  }, []);

  // True when every key is stored in the durable mark map (the embedded
  // import writes its once-only marker only after its marks landed).
  const hasStoredMarks = useCallback((keys) => {
    const h = handleRef.current;
    if (!h || !h.doc) return false;
    const map = getAnnotationsMap(h.doc);
    return (keys || []).every((key) => map.has(String(key)));
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
    nextByPage = preserveTransientPagePresentationState(
      byPageRef.current,
      withLivePreviews(nextByPage, ownerHandle),
    );
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
      withLivePreviews(result.byPage || ownerHandle.getByPage(), ownerHandle),
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
      withLivePreviews(result.byPage || ownerHandle.getByPage(), ownerHandle),
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
    forceFlush,
    commitEraserMutation,
    metaGet,
    metaSet,
    hasStoredMarks,
    beginBulkImport,
    whenBulkImportSaved,
    status: syncStatus,
    queueSize: syncQueueSize,
    liveMarkerOverlay,
  };
}
