// src/components/collab/YDocProvider.jsx
// Phase 27 — React context provider for the per-document Y.Doc.
// Phase 28 — extended with the locked transport provider mount, the
// authSessionBridge mount (Pitfall 1 defense), and the read-only mode +
// re-sign-in modal mounts. App.jsx remains UNTOUCHED in Phase 28 — every
// new mount lives here so the 28-CONTEXT.md narrow waiver is NOT exercised.
//
// Source:
//   - .planning/phases/27-crdt-foundation/27-RESEARCH.md Pattern 1 + 2 + 4
//   - .planning/phases/28-transport-spike-auth-validator/28-BENCHMARK.md (locked
//     transport = SupabaseYjsProvider per tiebreaker rule #1)
//   - .planning/phases/28-transport-spike-auth-validator/28-UI-SPEC.md
//     Component Inventory + Interaction States
//   - .planning/phases/28-transport-spike-auth-validator/28-06-PLAN.md (Blocker 1
//     fix — bridge + readonly gate moved out of App.jsx)
//
// Lifecycle (UX: invisible to the user — Y.Doc is borrowed from a module-scoped
// registry so HMR / parent re-renders don't churn the live doc):
//   mount   -> getOrCreateYDoc(docId) + attachLifecycle(ydoc, docId, {onStorageState})
//                                    + connect transport provider (Phase 28)
//                                    + attachAuthSessionBridge (Phase 28)
//   unmount -> lifecycle.detach() + provider.disconnect() + bridge.detach()
//                                + releaseYDoc(docId)  (does NOT destroy — Pitfall 21)
//
// Kill switch (UX: developers / ops can disable the CRDT layer without rebuilding):
// when isCRDTEnabled() returns false the provider yields a null-shaped context so
// downstream useYDoc() consumers render gracefully without binding to Y.Doc events.
//
// IMPORTANT: This file MUST NOT construct a Y.Doc directly. The applyUpdate-only
// invariant (Pitfall 5) is grep-asserted by tests/phase27/applyUpdateOnlyInvariant.test.mjs
// — the only allowed Y.Doc constructor site is src/lib/collab/ydocRegistry.js.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YDocContext } from './YDocContext.js';
import { getOrCreateYDoc, releaseYDoc } from '../../lib/collab/ydocRegistry.js';
import { resolveDocumentMetadata } from '../../services/documentMetadataResolver.js';
import { attachLifecycle } from '../../lib/collab/ydocLifecycle.js';
import { isCRDTEnabled } from '../../lib/collab/crdtFeatureFlag.js';
import StorageFailureBanner from './StorageFailureBanner.jsx';
import ReSignInModal from './ReSignInModal.jsx';
import ReadOnlyGate from './ReadOnlyGate.jsx';

const ydocProviderDebug = (...args) => {
  if (typeof window === 'undefined' || window.__CRDT_BACKFILL_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

// Phase 28 — locked transport provider per 28-BENCHMARK.md (custom Supabase
// Realtime adapter wins; Hocuspocus path remains as dormant v2.5+ fallback).
// Importing the alias `createTransportProvider` keeps the call site transport-
// agnostic — if v2.5+ ever flips to Hocuspocus, the change is one line here.
import { createSupabaseYjsProvider as createTransportProvider } from '../../lib/collab/SupabaseYjsProvider.js';
import {
  createTransportProviderCoordinator,
  hasRemoteDocumentCollaborator,
  isTransportChannelJoined,
} from '../../lib/collab/transportStatus.js';
import { attachAuthSessionBridge } from '../../lib/collab/authSessionBridge.js';
import { buildOrigin } from '../../lib/collab/originBuilder.js';
import { getDeviceId } from '../../lib/collab/deviceId.js';
import { getSupabaseSession, supabase } from '../../supabaseClient.js';
// Phase 29 — per-user Y.UndoManager mount. createUndoManager memoizes the origin
// reference (Pitfall 7 mitigation) so the bridge and the undo manager use the same
// frozen object — trackedOrigins.has() identity check holds across both call sites.
//
// Plan 29-06 adds getLocalFabricOrigin to this import line — used by handleRestore
// inside the toast queue effect (Warning 4 resolution: TOP-LEVEL synchronous import
// instead of a dynamic-load form inside the callback). Same memoized origin is
// what crdtAnnotationBridge passes to ydoc.transact, so reference-equality at
// Y.UndoManager.trackedOrigins continues to hold across the restore call site.
import { createUndoManager, getLocalFabricOrigin } from '../../lib/collab/crdtUndoManager.js';
// Phase 29 — Plan 29-06 render layer: per-collaborator outline overlay + the
// awareness state hook that feeds it. Mounted at YDocProvider scope so the
// overlay is available to any descendant rendering inside the YDocContext.
// Receives empty editors initially because per-page bbox positioning depends
// on PAL / SVGAnnotationLayer integration (Always-Protected files); follow-up
// Phase 32 hardening can wire the bbox feed without touching protected files.
import { CollaboratorOutlineOverlay } from './CollaboratorOutlineOverlay.jsx';
import { useRemoteEditors } from '../../hooks/useRemoteEditors.js';

// Phase 30 imports — backfill + dual-write retry queue + UI surfaces.
// Mounted inside YDocProviderInner so the per-document Y.Doc + sessionId
// + clientID are in scope. Per-(user, document) idempotency is enforced by
// runBackfill itself via the Y.Map meta marker — Plan 30-02.
//
// Surgical Plan 30-06 wiring: 3 additions (backfill mount effect + drainQueue
// 1Hz tick + useDualWriteQueue subscription) plus 2 render-tree additions
// (sync_queue_stuck banner gate + QuarantineMarkerOverlay sibling). Existing
// Phase 27/28/29 code is byte-identical.
import { runBackfill } from '../../lib/collab/crdtBackfill.js';
import { dedupePdfImports } from '../../lib/collab/crdtDedupePdfImports.js';
import { drainQueue, STORAGE_FAILURE_EVENT } from '../../lib/collab/crdtDualWriteQueue.js';
import { createQueueRetryHandlers } from '../../lib/collab/crdtQueueRetryHandlers.js';
import { useDualWriteQueue } from '../../hooks/useDualWriteQueue.js';
import { QuarantineMarkerOverlay } from './QuarantineMarkerOverlay.jsx';
import {
  upsertFabricAnnotation,
  loadAllNonSurveyMarkerAnnotations,
  deleteAnnotations,
  deleteAnnotation,
} from '../../services/annotationCloudSync.js';

// Phase 35 Plan 05 — cleanup banner audit + Review surface.
// auditResidue runs on document open and detects annotations the 2026-04-27
// diff-detection delete-suppression block left in the cloud before per-user
// authority shipped. isOwner gates the audit so collaborators never see the
// banner. CleanupResidueReviewPanel is the inline modal-adjacent Review
// surface (per checker W5: ship an actual surface, not paper-over).
import { auditResidue } from '../../lib/collab/cleanupResidueAudit.js';
import { isOwner } from '../../lib/collab/permissionScope.js';
import { fetchMyDocumentRole } from '../../lib/collab/documentRole.js';
import { CleanupResidueReviewPanel } from './CleanupResidueReviewPanel.jsx';

// Phase 35 Plan 05 — sticky-per-document dismissal persistence. Stored as a
// JSON array of documentIds in localStorage; the audit short-circuits on
// dismissedDocIds.has(documentId). UX: once an owner dismisses the cleanup
// banner for a document, it never reappears for that document — the residue
// audit is a one-shot affordance, not a recurring nag.
const PHASE35_DISMISSED_KEY = 'phase35.dismissedCleanupBanners';
const TRANSPORT_OFFLINE_BANNER_GRACE_MS = 1500;
const TRANSPORT_RETRY_RESULT_TIMEOUT_MS = 5000;
const TRANSPORT_RETRY_ERROR =
  'Live sync did not reconnect. Check your internet connection and try again.';

const ydocTransportDebug = (...args) => {
  if (typeof window === 'undefined' || window.__YDOC_TRANSPORT_DEBUG !== true) return;
  try { console.debug(...args); } catch { /* ignore debug logging failures */ }
};

function readDismissedDocIds() {
  // UX: defensive read — corrupt JSON or missing key both yield an empty
  // Set so the banner renders for first-time owners. Wrap in try/catch
  // because localStorage access can throw in private-browse mode.
  if (typeof window === 'undefined' || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(PHASE35_DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function writeDismissedDocIds(set) {
  // UX: best-effort write — quota errors are non-fatal here (the audit will
  // re-fire next session, banner will re-show, owner can dismiss again).
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const payload = JSON.stringify([...set]);
    window.localStorage.setItem(PHASE35_DISMISSED_KEY, payload);
  } catch {
    /* swallow — non-fatal */
  }
}

// Frozen null-shape value reused when CRDT is disabled or docId is unknown.
// UX: useYDoc() consumers can call hooks unconditionally — the null shape lets them
// render gracefully (no banner, no fade-in) without branching on "is the provider mounted".
const NULL_CTX_DISABLED = Object.freeze({
  ydoc: null,
  isHydrating: false,
  storageState: null,
  role: 'unknown',
  isCRDTEnabled: false,
  dismissBanner: () => {},
  // Phase 28 additions — kept on the null-shape too so callers can safely
  // destructure even when CRDT is off.
  accessRevoked: false,
  // 2026-07-01 — effective document role ('owner'|'editor'|'viewer'|null).
  // null on the disabled shape = fail open (read-write presentation).
  docRole: null,
  transportState: null,
  loginExpired: false,
  reSignInModalOpen: false,
  setReSignInModalOpen: () => {},
  setLoginExpired: () => {},
  closeDocument: () => {},
  getOriginContext: () => Object.freeze({ source: 'local' }),
  // Phase 29 additions — null shape for kill-switch path so consumers can safely
  // destructure undoManager / undoCtx from useYDoc() without branching.
  undoManager: null,
  undoCtx: null,
  // KAL-274 — typed awareness accessor (null when CRDT is off).
  getAwareness: () => null,
});

export function YDocProvider({ docId, children, closeDocument, isActive = true }) {
  const enabled = isCRDTEnabled();

  // Null/empty docId or kill-switch active → provide a null context.
  // UX: the document still opens normally; the CRDT layer is simply off for this mount.
  // Hooks rule: keep this branch above the inner component so we don't call useEffect
  // conditionally — the inner component owns all the stateful hooks.
  if (!docId || !enabled) {
    return (
      <YDocContext.Provider value={NULL_CTX_DISABLED}>
        {children}
      </YDocContext.Provider>
    );
  }

  // Keying on docId guarantees that switching PDFs gives us a fresh hooks tree
  // (state resets cleanly — no stale isHydrating / storageState bleeding across docs).
  return (
    <YDocProviderInner key={docId} docId={docId} closeDocument={closeDocument} isActive={isActive}>
      {children}
    </YDocProviderInner>
  );
}

function YDocProviderInner({ docId, children, closeDocument, isActive }) {
  // Borrow the Y.Doc from the module-scoped registry. Stable across re-renders for
  // a given docId; HMR-safe because the registry survives module reloads.
  const ydoc = useMemo(() => getOrCreateYDoc(docId), [docId]);

  // Phase 28 — sessionId is per-Y.Doc-mount and resets on document re-open
  // (fresh useMemo when docId changes). Used by getOriginContext below to
  // produce the origin payload Phase 29's Fabric ↔ Y.Map binding will pass
  // to ydoc.transact(fn, origin). Phase 33 activity-log writes consume the
  // same shape verbatim.
  const sessionId = useMemo(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `session-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }, [docId]);

  const lifecycleRef = useRef(null);
  const providerRef = useRef(null);
  const bridgeRef = useRef(null);
  const retryDualWriteQueueRef = useRef(null);
  const [storageState, setStorageState] = useState(null);
  const [role, setRole] = useState('unknown');
  const [isHydrating, setIsHydrating] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Whether THIS document is actually shared (has active collaborators). The live-sync-offline
  // banner only makes sense for a shared document — resolved once per open in the effect below.
  const [isDocShared, setIsDocShared] = useState(null);
  // 2026-04-29 — when SyncStatusChip's manual retry exhausts (4 failed attempts),
  // it dispatches a window event so the banner surfaces immediately rather than
  // waiting the 30s stuck-queue threshold. Reset on document mount.
  const [manualRetryExhausted, setManualRetryExhausted] = useState(false);

  // 2026-04-30 — deletion-warning gate. Flips true when the cloud-sync hook
  // suppresses or fails a delete (wipe-style safety brake OR the legacy bulk
  // delete returns an error). Drives the sync_deletions_pending banner so the
  // user is told that deletions may reappear on close. Reset on document mount,
  // banner dismiss, or full queue clear.
  const [deletionsPending, setDeletionsPending] = useState(false);

  // Phase 35 Plan 05 — cleanup banner state. cleanupResidueIds is null until
  // the audit completes; an empty array means audit ran and found nothing
  // (banner stays hidden). reviewPanelOpen drives the inline Review surface.
  // UX: null vs [] distinction matters — the banner gate checks
  // `cleanupResidueIds && cleanupResidueIds.length > 0` so an in-flight audit
  // doesn't briefly render the banner with stale state.
  const [cleanupResidueIds, setCleanupResidueIds] = useState(null);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);

  // Phase 28 state additions — accessRevoked drives ReadOnlyGate; transportState
  // is exposed for any future status surfaces (sync chip in Phase 33);
  // loginExpired tracks the failed-refresh signal from authSessionBridge;
  // reSignInModalOpen + setter control the inline re-sign-in form mount.
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [transportState, setTransportState] = useState(null);
  const [loginExpired, setLoginExpired] = useState(false);
  const [reSignInModalOpen, setReSignInModalOpen] = useState(false);

  // 2026-07-01 — effective document role for THIS user, resolved once per
  // document open via the get_my_document_role RPC (creator > direct
  // document_collaborators > project_collaborators > project creator).
  // null = unknown / no answer — fail open to the read-write presentation
  // (the server still rejects viewer writes; this gate is honest UI, not the
  // security boundary). 'viewer' drives ReadOnlyGate's view-only presentation
  // plus the viewer_access banner below. A viewer promoted mid-session picks
  // up edit access on reload (deliberate — the Phase 28 accessRevoked path
  // stays the only live mid-session flip and takes precedence).
  const [docRole, setDocRole] = useState(null);
  const [viewerBannerDismissed, setViewerBannerDismissed] = useState(false);

  // Phase 29 — per-user Y.UndoManager mount.
  //
  // Constructed once per (ydoc, userId) tuple; disposed on Y.Doc unmount or userId
  // change. CONTEXT.md decision: history fresh per Y.Doc mount (no cross-session
  // persistence), capped at 100 actions matching Figma defaults.
  //
  // sessionId reuses the per-mount sessionId useMemo above — the same identity
  // already feeds getOriginContext, so the bridge's transact origin and the
  // undo manager's trackedOrigins entry share the exact memoized origin object.
  // Reference equality at trackedOrigins is the entire Pitfall 7 mitigation.
  //
  // Supabase session lookup goes through getSupabaseSession so corrupted local
  // refresh-token state can be cleared instead of poisoning boot/reconnect.
  const [undoState, setUndoState] = useState(null);
  const [transportRetryError, setTransportRetryError] = useState(null);

  // Ref-mirror of storageState so the transport provider's async callbacks can
  // read the latest code without stale-closure bugs. Updated via the effect below.
  const storageStateRef = useRef(null);
  useEffect(() => { storageStateRef.current = storageState; }, [storageState]);
  const transportOfflineBannerTimerRef = useRef(null);
  const transportRetryResultTimerRef = useRef(null);
  const transportOfflineGenerationRef = useRef(0);
  const transportRetryGenerationRef = useRef(0);
  const transportRetryInFlightRef = useRef(null);
  const restartTransportProviderRef = useRef(null);

  const clearTransportOfflineBannerTimer = useCallback(() => {
    if (!transportOfflineBannerTimerRef.current) return;
    clearTimeout(transportOfflineBannerTimerRef.current);
    transportOfflineBannerTimerRef.current = null;
  }, []);

  const clearTransportRetryResultTimer = useCallback(() => {
    if (!transportRetryResultTimerRef.current) return;
    clearTimeout(transportRetryResultTimerRef.current);
    transportRetryResultTimerRef.current = null;
  }, []);

  const markTransportOnline = useCallback(() => {
    transportRetryGenerationRef.current += 1;
    transportRetryInFlightRef.current = null;
    clearTransportRetryResultTimer();
    setTransportRetryError(null);
    setTransportState('online');
    const okState = { code: 'ok', role: 'unknown' };
    if (storageStateRef.current?.code === 'transport_offline') {
      storageStateRef.current = okState;
    }
    // The ref is updated by persistence and transport callbacks before React
    // commits their queued state. Reconcile against the committed state too,
    // or an out-of-order callback can leave the banner rendered while the ref
    // already says "ok".
    setStorageState((current) => (
      current?.code === 'transport_offline' ? okState : current
    ));
  }, [clearTransportRetryResultTimer]);

  const scheduleTransportOfflineBanner = useCallback(() => {
    const generation = transportOfflineGenerationRef.current + 1;
    transportOfflineGenerationRef.current = generation;
    clearTransportOfflineBannerTimer();
    transportOfflineBannerTimerRef.current = setTimeout(() => {
      transportOfflineBannerTimerRef.current = null;
      if (transportOfflineGenerationRef.current !== generation) return;
      // Supabase can deliver a late CLOSED/TIMED_OUT callback after the channel
      // has already rejoined. Trust the live channel state before surfacing a
      // failure; otherwise a stale callback leaves an offline banner over a
      // healthy, still-syncing document.
      if (isTransportChannelJoined(providerRef.current)) {
        ydocTransportDebug('[YDocProvider] ignored stale offline status; channel is joined');
        markTransportOnline();
        return;
      }
      const currentCode = storageStateRef.current?.code || 'ok';
      if (currentCode !== 'ok' && currentCode !== 'transport_offline') {
        ydocTransportDebug('[YDocProvider] transport offline persisted but another banner is active', currentCode);
        return;
      }
      ydocTransportDebug('[YDocProvider] transport offline persisted; showing banner');
      const offlineState = { code: 'transport_offline', role: 'unknown' };
      storageStateRef.current = offlineState;
      setStorageState(offlineState);
    }, TRANSPORT_OFFLINE_BANNER_GRACE_MS);
  }, [clearTransportOfflineBannerTimer, markTransportOnline]);

  const handleTransportRetry = useCallback(() => {
    if (transportRetryInFlightRef.current) {
      return transportRetryInFlightRef.current;
    }

    const generation = transportRetryGenerationRef.current + 1;
    transportRetryGenerationRef.current = generation;
    transportOfflineGenerationRef.current += 1;
    clearTransportOfflineBannerTimer();
    clearTransportRetryResultTimer();
    setTransportRetryError(null);
    setTransportState('connecting');

    const restartProvider = restartTransportProviderRef.current;
    if (typeof restartProvider !== 'function') {
      setTransportState('offline');
      setTransportRetryError(TRANSPORT_RETRY_ERROR);
      return;
    }

    transportRetryResultTimerRef.current = setTimeout(() => {
      transportRetryResultTimerRef.current = null;
      if (transportRetryGenerationRef.current !== generation) return;
      if (isTransportChannelJoined(providerRef.current)) {
        markTransportOnline();
        return;
      }
      transportRetryInFlightRef.current = null;
      setTransportState('offline');
      setTransportRetryError(TRANSPORT_RETRY_ERROR);
    }, TRANSPORT_RETRY_RESULT_TIMEOUT_MS);

    const retryPromise = (async () => {
      try {
        const provider = await restartProvider();
        if (transportRetryGenerationRef.current !== generation) return provider;
        if (isTransportChannelJoined(provider)) {
          markTransportOnline();
        }
        return provider;
      } catch (err) {
        if (transportRetryGenerationRef.current !== generation) return null;
        clearTransportRetryResultTimer();
        transportRetryInFlightRef.current = null;
        ydocTransportDebug('[YDocProvider] manual transport retry failed', err?.message || String(err));
        setTransportState('offline');
        setTransportRetryError(TRANSPORT_RETRY_ERROR);
        return null;
      }
    })();
    transportRetryInFlightRef.current = retryPromise;
    return retryPromise;
  }, [
    clearTransportOfflineBannerTimer,
    clearTransportRetryResultTimer,
    markTransportOnline,
  ]);

  useEffect(() => {
    // Fresh mount → reset banner-dismiss state. Subsequent storage failures
    // re-show the banner; user can dismiss again per session.
    setBannerDismissed(false);
    setManualRetryExhausted(false);
    setDeletionsPending(false);
    setIsHydrating(true);

    const handle = attachLifecycle(ydoc, docId, {
      onStorageState: (state) => {
        storageStateRef.current = state;
        setStorageState(state);
        // UX: 'ok' code fires when IndexeddbPersistence emits 'synced'. That's
        // the moment hydration is complete — flip the fade-in class to 'hydrated'.
        if (state.code === 'ok') {
          setIsHydrating(false);
        }
      },
    });
    lifecycleRef.current = handle;

    // Phase 28 — mount the locked transport provider against the borrowed Y.Doc.
    // The provider operates on the SAME ydoc that ydocLifecycle just attached to;
    // remote updates land via Y.applyUpdate (the applyUpdate-only invariant —
    // Pitfall 5 — never replace the doc wholesale).
    //
    // The factory is sync on the Supabase path (returns a handle directly); the
    // Hocuspocus fallback wrapper would return a Promise. Wrap in Promise.resolve
    // so the wiring works regardless of which path 28-BENCHMARK.md locks.
    let cancelled = false;
    const transportCoordinator = createTransportProviderCoordinator({
      getCurrentProvider: () => providerRef.current,
      setCurrentProvider: (provider) => {
        providerRef.current = provider;
      },
      createProvider: ({ isCurrent }) => Promise.resolve(createTransportProvider({
        documentId: docId,
        ydoc,
        supabase,
        onTransportState: (state) => {
          if (!isCurrent()) return;
          // UX: setTransportState is the always-on side; the banner gate fires
          // only on 'offline' so steady-state 'online' is invisible to the user.
          setTransportState(state);
          if (state === 'offline') {
            // UX: brief realtime reconnect blips are common and recoverable.
            // Keep the status state accurate immediately, but only show the
            // user-facing banner if the offline state persists past the grace
            // window. This prevents the red banner from flashing while the
            // bottom-left cloud-save chip remains healthy.
            ydocTransportDebug('[YDocProvider] transport offline; delaying banner');
            scheduleTransportOfflineBanner();
          } else if (state === 'online') {
            transportOfflineGenerationRef.current += 1;
            clearTransportOfflineBannerTimer();
            // UX: only clear if the current state is the transport-side banner.
            // Don't stomp on persistence-side codes (quota / blocked / etc.) —
            // those are independent failure modes.
            ydocTransportDebug('[YDocProvider] transport online; reconciling banner');
            markTransportOnline();
          }
        },
        onUpdateRejected: (reason) => {
          if (!isCurrent()) return;
          // UX per CONTEXT.md: in-flight edit dropped with explicit reason;
          // document stays open in read-only mode (NOT auto-bounced to dashboard).
          // The 'authentication_failed*' reasons cover Plan 28-05's RLS-violation
          // path (Postgres 42501); 'permission_revoked' covers the proactive
          // postgres_changes DELETE on document_collaborators.
          if (
            reason === 'permission_revoked' ||
            /^authentication_failed/.test(reason || '')
          ) {
            setAccessRevoked(true);
            setStorageState({ code: 'permission_revoked', role: 'unknown' });
          }
        },
      })),
    });
    const installTransportProvider = () => transportCoordinator.restart();
    restartTransportProviderRef.current = installTransportProvider;
    installTransportProvider().catch((err) => {
      // Provider construction failed (network down at boot, missing env, etc.).
      // Surface via the storage state channel as transport_offline so the user
      // sees the offline banner rather than a silent freeze.
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.warn('[YDocProvider] transport provider failed to construct', err?.message);
      const offlineState = { code: 'transport_offline', role: 'unknown' };
      storageStateRef.current = offlineState;
      setStorageState(offlineState);
    });

    // Phase 28 — mount the auth session bridge inside this useEffect (Pitfall 1
    // defense). On TOKEN_REFRESHED → forward the new JWT to realtime.setAuth so
    // the live channel survives JWT expiry (silent refresh). On SIGNED_OUT →
    // set loginExpired=true and surface the login_expiry_failure banner so the
    // user gets the inline re-sign-in modal entry point.
    //
    // Mounting here (rather than App.jsx) keeps the 28-CONTEXT.md narrow waiver
    // unexercised — App.jsx ends Phase 28 with only the existing Plan 27-05
    // <YDocProvider> mount line.
    let bridge = null;
    try {
      bridge = attachAuthSessionBridge({
        supabase,
        onSignedOut: () => {
          // UX: silent refresh failed (password changed, account locked, refresh
          // token revoked). The user sees the login_expiry_failure banner; clicking
          // its action opens the inline ReSignInModal. Per CONTEXT.md "don't make
          // them lose their place" — the user stays on this document page.
          setLoginExpired(true);
          setStorageState({ code: 'login_expiry_failure', role: 'unknown' });
        },
      });
      bridgeRef.current = bridge;
    } catch (err) {
      // Auth client unavailable (SSR, test env, supabase client not configured).
      // The CRDT-layer kill-switch in src/lib/collab/crdtFeatureFlag.js typically
      // catches this earlier; the try/catch here is a defensive belt for any
      // edge case where isCRDTEnabled() returns true but the bridge setup throws.
      // eslint-disable-next-line no-console
      console.warn('[YDocProvider] authSessionBridge unavailable', err?.message);
    }

    // Web Locks election resolves async. Poll the role for the first few seconds
    // so consumers can render leader/loser-aware UI without re-attaching listeners.
    // UX: 100ms tick is fast enough that "leader" usually appears within 1-2 frames
    // on a fresh mount; clears as soon as a definitive role is known.
    const roleInterval = setInterval(() => {
      const currentRole = handle.role();
      setRole(currentRole);
      if (currentRole !== 'unknown') {
        clearInterval(roleInterval);
      }
    }, 100);

    // Hydration timeout fallback per 27-UI-SPEC.md — annotations must reach
    // opacity:1 within 500ms even if IndexeddbPersistence 'synced' never fires
    // (e.g. fresh doc with no cached state). Caps the perceived wait.
    const hydrationFallback = setTimeout(() => setIsHydrating(false), 500);

    return () => {
      cancelled = true;
      if (restartTransportProviderRef.current === installTransportProvider) {
        restartTransportProviderRef.current = null;
      }
      clearInterval(roleInterval);
      clearTimeout(hydrationFallback);
      transportOfflineGenerationRef.current += 1;
      transportRetryGenerationRef.current += 1;
      transportRetryInFlightRef.current = null;
      clearTransportOfflineBannerTimer();
      clearTransportRetryResultTimer();
      try { handle.detach(); } catch { /* swallow — handle may already be torn down */ }
      transportCoordinator.dispose();
      try { bridge?.detach?.(); } catch { /* swallow */ }
      try { bridgeRef.current?.detach?.(); } catch { /* swallow */ }
      providerRef.current = null;
      bridgeRef.current = null;
      releaseYDoc(docId);
      lifecycleRef.current = null;
    };
  }, [
    clearTransportOfflineBannerTimer,
    clearTransportRetryResultTimer,
    docId,
    markTransportOnline,
    scheduleTransportOfflineBanner,
    ydoc,
  ]);

  // Sleep/wake revive — when the display sleeps, the OS suspends the realtime
  // websocket and its sockets go stale; on a naive wake the channel can stay
  // dead, so remote updates (and the sync_request handshake that re-pulls
  // missed state) never resume. On wake (regained visibility, focus, or
  // network online) nudge the Supabase realtime client to reconnect. This is
  // idempotent: if the socket is already healthy, connect() is a no-op; if it
  // was suspended, it re-opens and the channel re-subscribes, which re-fires
  // onTransportState('online') → the provider's sync_request handshake →
  // reviving the Y.Doc connection rather than leaving it dead.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reviveTransport = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        // supabase.realtime.connect() reconnects the underlying socket if it
        // dropped; channels auto-rejoin on reconnect.
        supabase?.realtime?.connect?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        ydocTransportDebug('[YDocProvider] wake revive connect failed: ' + (err?.message || String(err)));
      }
    };
    window.addEventListener('focus', reviveTransport);
    window.addEventListener('online', reviveTransport);
    document.addEventListener('visibilitychange', reviveTransport);
    return () => {
      window.removeEventListener('focus', reviveTransport);
      window.removeEventListener('online', reviveTransport);
      document.removeEventListener('visibilitychange', reviveTransport);
    };
  }, []);

  // Phase 29 — Per-user UndoManager mount effect (additive — Plan 29-04 narrow waiver).
  //
  // Reads userId via the existing supabase import (line 49). Builds the manager via
  // createUndoManager which memoizes the frozen origin object per userId. The same
  // memoized reference is what crdtAnnotationBridge passes to ydoc.transact, so
  // Y.UndoManager.trackedOrigins.has(origin) holds across both call sites — Pitfall 7
  // mitigation locked. dispose() detaches the stack-item-added cap listener and calls
  // Y.UndoManager.destroy(); idempotent so the cancellation path is safe.
  useEffect(() => {
    if (!ydoc) {
      setUndoState(null);
      return undefined;
    }
    let cancelled = false;
    let dispose = null;

    (async () => {
      let userId = null;
      try {
        const session = await getSupabaseSession('YDocProvider.undoManager');
        userId = session?.user?.id ?? null;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[YDocProvider] Phase 29 undoManager: failed to read auth session', err?.message);
      }
      if (cancelled) return;
      if (!userId) {
        setUndoState(null);
        return;
      }

      const deviceId = getDeviceId();
      const clientID = ydoc.clientID;
      const ctx = { userId, deviceId, sessionId, clientID };

      const result = createUndoManager({
        ydoc,
        userId,
        deviceId,
        sessionId,
        clientID,
        captureTimeout: 500,
        historyCap: 100,
      });
      dispose = result.dispose;

      if (cancelled) {
        try { dispose(); } catch { /* swallow */ }
        return;
      }
      setUndoState({ undoManager: result.undoManager, origin: result.origin, undoCtx: ctx });
    })();

    return () => {
      cancelled = true;
      try { if (dispose) dispose(); } catch { /* swallow */ }
    };
  }, [ydoc, sessionId]);

  // Phase 29 — Plan 29-06: Remote-delete toast queue.
  //
  // Surfaces the "Removed by [name] — Restore?" toast ONLY when the local user is
  // actively interacting with the deleted annotation. Plan 29-05 publishes the
  // local interaction binding via window.__phase29InteractionState (selectedId,
  // draggingId, scalingId, editCanvasId, contextMenuId) on FabricEditCanvas mount
  // and the existing context-menu component. We read from there to gate whether
  // a remote delete fires the toast or applies silently.
  //
  // Sticky (no auto-dismiss) per UI-SPEC §1: a delete-by-collaborator is a
  // high-stakes moment — auto-dismiss would lose the chance to recover work the
  // user was actively touching. The toast stays until the user clicks Restore,
  // Dismiss, or the toast is superseded by a 4-or-more overflow merge.
  //
  // Multiple toasts: state shape is an array; render layer (Task 4) caps visible
  // at 3 and merges overflow into a single "and N more removed" banner.
  const [toasts, setToasts] = useState([]);

  // Y.Map.observe (NOT observeDeep) on the top-level annotations Map — we only
  // care about add/delete events at the entry level here. observeDeep would fire
  // on every property write inside every annotation, far more noise than we need.
  //
  // The handler walks event.changes.keys (Map<key, {action, oldValue}>) and
  // enqueues a toast for each remote DELETE the local user is bound to. Local
  // writes are filtered by transaction.origin.source — 'local-fabric' (Fabric
  // mutation), 'local-undo' (Cmd+Z wrap), 'local-redo' (Cmd+Shift+Z wrap) all
  // skip. Remote-transport writes (whatever source Phase 28 SupabaseYjsProvider
  // tags or absent / null origin) fall through and are evaluated against the
  // local interaction binding.
  useEffect(() => {
    if (!ydoc) return undefined;
    const yMap = ydoc.getMap('annotations');

    const handler = (event, transaction) => {
      // Skip our own writes — local-fabric / local-undo / local-redo all originate
      // from this client and the user already saw the deletion happen on screen.
      const src = transaction?.origin?.source;
      if (src === 'local-fabric' || src === 'local-undo' || src === 'local-redo') {
        return;
      }

      // UX: read the interaction binding lazily inside the handler so it picks
      // up the latest state at the moment of delete. window may be missing in
      // SSR / test environments; guard defensively.
      const interactionState = (typeof window !== 'undefined' && window.__phase29InteractionState) || {};

      // event.changes.keys is a Map<key, { action: 'add' | 'update' | 'delete', oldValue }>.
      // Walk every key change in this transaction; only deletes that the local
      // user is interacting with become toasts.
      event.changes?.keys?.forEach((change, annoId) => {
        if (change.action !== 'delete') return;

        // CONTEXT.md "Deletion-during-interaction" — the toast surfaces only when
        // ANY of the five interaction bindings is set to this annoId. Outside
        // those bindings, the deletion applies silently (user did not have the
        // shape engaged; no recovery affordance is needed).
        const interacting = (
          interactionState.selectedId === annoId
          || interactionState.draggingId === annoId
          || interactionState.scalingId === annoId
          || interactionState.editCanvasId === annoId
          || interactionState.contextMenuId === annoId
        );
        if (!interacting) return;

        // Recover oldValue snapshot for the Restore handler. Y.Map.observe gives
        // us oldValue as the prior Y.Map; toJSON() flattens it into a plain
        // object the restore handler can re-write into the Y.Doc.
        const snapshotJSON = change.oldValue?.toJSON?.();
        if (!snapshotJSON) return;

        // collaboratorName: pulled from the transaction origin if Phase 28 tagged
        // it. Falls back to null → "another collaborator" in the banner heading.
        const collaboratorName = transaction?.origin?.userName ?? null;

        setToasts((prev) => [
          ...prev,
          {
            id: `toast-${annoId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
            code: 'annotation_remote_deleted',
            collaboratorName,
            annoId,
            snapshotJSON,
          },
        ]);
      });
    };

    yMap.observe(handler);
    return () => {
      yMap.unobserve(handler);
    };
  }, [ydoc]);

  // Phase 29 — Plan 29-06: Restore handler.
  //
  // Wired to each toast's Restore button. Performs a direct ydoc.transact that
  // re-creates the deleted annotation while PRESERVING the original meta block
  // (authorId, deviceId, createdAt) per UNDO-03 contract. This is intentionally
  // NOT routed through crdtAnnotationBridge.applyFabricCommit — that helper's
  // CREATE branch overwrites meta.authorId/deviceId/createdAt with the current
  // ctx (the restoring user), which would erase the original attribution.
  //
  // Warning 4 resolution: getLocalFabricOrigin is imported synchronously at the
  // top of this file. The pre-revision draft of this plan used a dynamic-load
  // form inside this callback; the synchronous form is simpler, type-safe, and
  // avoids a microtask hop on every Restore click.
  const handleRestore = useCallback((toast) => {
    if (!ydoc || !undoState?.undoCtx || !toast?.snapshotJSON) return;
    const yMap = ydoc.getMap('annotations');
    const ctx = undoState.undoCtx;
    const originPayload = getLocalFabricOrigin(ctx);

    ydoc.transact(() => {
      // Race guard: collaborator may have already restored the annotation
      // (re-creation by some other client). If the entry exists, do nothing —
      // overwriting would clobber whatever the other client wrote.
      if (yMap.get(toast.annoId)) {
        return;
      }

      const annoYMap = new Y.Map();
      const fabricYMap = new Y.Map();
      const metaYMap = new Y.Map();
      yMap.set(toast.annoId, annoYMap);
      annoYMap.set('id', toast.annoId);
      annoYMap.set('type', toast.snapshotJSON.type);
      annoYMap.set('pageNumber', toast.snapshotJSON.pageNumber);
      annoYMap.set('fabric', fabricYMap);
      annoYMap.set('meta', metaYMap);

      // UNDO-03 contract: original CREATE-meta survives the restore. We write
      // the snapshot's meta block as-is rather than going through the bridge's
      // CREATE branch — the bridge would substitute ctx.userId / ctx.deviceId /
      // Date.now() into authorId / deviceId / createdAt and erase the original
      // attribution.
      const oldMeta = toast.snapshotJSON.meta ?? {};
      metaYMap.set('authorId', oldMeta.authorId);
      metaYMap.set('deviceId', oldMeta.deviceId);
      metaYMap.set('createdAt', oldMeta.createdAt);

      // Update timestamps reflect the restore operation — the activity log
      // (Phase 33) reads these fields to attribute "user X restored Y at time T".
      metaYMap.set('updatedAt', Date.now());
      metaYMap.set('lastEditorId', ctx.userId);
      metaYMap.set('restoredBy', ctx.userId);

      // Restore Fabric properties from the snapshot. Each property is written
      // as a separate Y.Map.set call so the per-property LWW semantics
      // (COLLAB-03) hold cleanly if a collaborator's parallel edit lands first.
      const fabricSnapshot = toast.snapshotJSON.fabric ?? {};
      Object.keys(fabricSnapshot).forEach((k) => {
        fabricYMap.set(k, fabricSnapshot[k]);
      });
    }, originPayload);

    // Remove this toast from the queue. Other queued toasts (different annoIds)
    // remain so the user can decide on each independently.
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
  }, [ydoc, undoState]);

  // Phase 29 — Plan 29-06: Dismiss handler. Filters the toast out of the queue
  // without altering the Y.Doc. The deletion stays applied; the user has chosen
  // not to recover.
  const handleDismissToast = useCallback((toastId) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  // Phase 29 — Plan 29-06 Task 4: awareness state for the collaborator outline
  // overlay. Returns Map<annoId, { userId, colorSlot, name }>. When awareness is
  // unwired (no Phase 28 awareness publisher attached), the hook returns an
  // empty Map and the overlay renders nothing — graceful degradation.
  //
  // The hook call itself is what wires the awareness subscription into this
  // React tree. The returned Map is currently unused because per-page bbox
  // joining lives in PAL / SVGAnnotationLayer (Always-Protected); a follow-up
  // hook will join `remoteEditors` (keyed on annoId) with bbox data from
  // useAnnotationsCRDT to produce the per-page editors array the overlay
  // consumes. Until then the live subscription is still useful: it primes the
  // awareness data path so DevTools shows real values when verifying.
  const remoteEditors = useRemoteEditors();
  // Reference so the linter does not flag the awareness subscription as dead.
  // UX: future-facing — see comment block above for the join plan.
  void remoteEditors;

  // Phase 30 — backfill mount.
  //
  // CONTEXT.md `<decisions>` "First-open import feel": silent migration,
  // deferred kick-off so the PDF page paints first (Pitfall 30-7). The user
  // never sees a banner / spinner / completion toast — annotations just
  // appear like normal once the Y.Doc populates.
  //
  // Per-(user, document) idempotency lives inside runBackfill via the Y.Doc
  // meta marker — running this effect on every re-render is harmless beyond
  // the first run (the marker check short-circuits inside runBackfill).
  //
  // Effect deps: ydoc + docId + undoCtx?.userId. Re-runs on document switch
  // (key={docId}) and on user identity change. The backfillRanRef gate
  // prevents duplicate kickoffs within a single mount lifecycle (StrictMode
  // double-mount safety + React effect cleanup edge cases).
  const backfillRanRef = useRef(null);
  useEffect(() => {
    const userId = undoState?.undoCtx?.userId;
    ydocProviderDebug('[Phase31 UAT] backfill:effect ' + JSON.stringify({
      hasYdoc: !!ydoc,
      docId: docId || null,
      userId: userId || null,
      alreadyRanFor: backfillRanRef.current,
      willRun: !!(ydoc && docId && userId && backfillRanRef.current !== `${docId}::${userId}`),
    }));
    if (!ydoc || !docId || !userId) return undefined;
    // Per-mount run-once gate. Track the (docId, userId) pair so a user-switch
    // (rare in this app but possible via re-auth) re-runs the backfill check.
    const runKey = `${docId}::${userId}`;
    if (backfillRanRef.current === runKey) return undefined;
    backfillRanRef.current = runKey;

    // Test seam: e2e specs poll on window.__crdtBackfillDone to wait for
    // backfill completion. Initial state false; set true when runBackfill
    // resolves (Plan 30-01 phase30-backfill-roundtrip.spec.mjs reads this).
    if (typeof window !== 'undefined') {
      window.__crdtBackfillDone = false;
    }

    // Test seam: e2e race-window spec injects a delay so it can draw an
    // annotation while backfill is in flight. Default 0 in production.
    const delayMs =
      (typeof window !== 'undefined' && Number.isFinite(window.__crdtBackfillDelayMs))
        ? window.__crdtBackfillDelayMs
        : 0;

    // Origin factory — backfill writes carry the crdt-backfill source tag so
    // Phase 33 activity log can render a single "Document migrated" row per
    // migrated document. The factory shape mirrors buildOrigin but the source
    // value itself is supplied by runBackfill at call time (this factory just
    // freezes the shape and forwards whatever the source argument is).
    const originPayloadFactory = ({ source, userId: rowUserId, deviceId, sessionId: sid, clientID: cid }) => Object.freeze({
      source,
      userId: rowUserId,
      deviceId,
      sessionId: sid,
      clientID: cid,
    });

    // Pitfall 30-7 fix — defer via Promise.resolve so the PDF paint completes
    // first. The user sees the legacy annotations render via React state
    // (the existing useAnnotationsCRDT layer falls back to the legacy slice
    // until the Y.Doc has data — the read path is "render whichever side
    // has data; flip atomically when the Y.Doc populates").
    let cancelled = false;
    const kickoff = async () => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      if (cancelled) return;
      try {
        // DB-sync audit #6 — reuse the hydrate keyset rows for backfill.
        // The hydrate read is single-flighted per documentId (inFlightHydrateReads
        // in annotationCloudSync.js), so this shares the SAME in-flight keyset
        // sweep the Phase 35 cleanup audit / state hydrate already fires on a
        // cold open instead of issuing a second independent full SELECT inside
        // runBackfill. We pass the resolved rawRows straight through; runBackfill
        // re-applies the NON_HIGHLIGHT_TYPES_FOR_BACKFILL type filter so the
        // imported set stays byte-identical to the prior SELECT-loop behavior.
        // On read failure rawRows is absent → runBackfill falls back to its own
        // SELECT loop, preserving the silent-retry path.
        let existingHydrateRows = null;
        // Only prefetch the hydrate rows when runBackfill will actually consume
        // them. On an already-sealed (cutover_completed_at NOT NULL) doc,
        // runBackfill short-circuits via the dedupe-anchor / health gates and
        // never reaches the import loop — so prefetching rows there would add a
        // NEW full read on every repeated open of a sealed doc (the exact waste
        // commit #2 removed). resolveDocumentMetadata is cached + shared with
        // runBackfill's own cutover check, so this gate is not an extra trip.
        let sealedSkip = false;
        try {
          const meta = await resolveDocumentMetadata(docId, { supabase });
          sealedSkip = !!meta?.cutoverCompletedAt;
        } catch {
          // Metadata read failed — be conservative and prefetch (matches
          // runBackfill's own silent fall-through to the full flow).
          sealedSkip = false;
        }
        if (cancelled) return;
        if (!sealedSkip) {
          try {
            const hydrate = await loadAllNonSurveyMarkerAnnotations(docId);
            if (!cancelled && hydrate && !hydrate.error && Array.isArray(hydrate.rawRows)) {
              existingHydrateRows = hydrate.rawRows;
            }
          } catch (hydrateErr) {
            // Silent — runBackfill falls back to its own SELECT loop.
            // eslint-disable-next-line no-console
            console.warn('[YDocProvider] backfill hydrate-row reuse read failed', hydrateErr?.message);
          }
        }
        if (cancelled) return;
        await runBackfill({
          ydoc,
          supabase,
          documentId: docId,
          userId,
          sessionId,
          clientID: ydoc.clientID,
          originPayloadFactory,
          existingHydrateRows,
          // Phase 31 Plan 04 — request the cutover seal. After the legacy
          // SELECT + import loop completes, crdtBackfill writes
          // documents.cutover_completed_at = NOW() ONLY if the imported count
          // matches Y.Map size (verified-count gate). NULL stays in place on
          // mismatch — next open retries naturally.
          //
          // The pre-loop short-circuit (cutover_already_complete) inside
          // crdtBackfill saves redundant work on every subsequent open of an
          // already-sealed document — one row read by primary key vs the full
          // legacy SELECT + per-property Y.Map writes for thousands of rows.
          //
          // UX comment: still silent. No banner / spinner / toast. Annotations
          // just appear like normal once the Y.Doc populates (CONTEXT.md
          // "First-open import feel" decision preserved verbatim).
          markCutoverComplete: true,
        });
        // 2026-05-03 — Auto-dedupe pass for PDF-imported annotations.
        // UX: pre-Phase-31 the same PDF could be imported into a document
        // multiple times, leaving 2-4 visually-identical strokes stacked on
        // top of each other. Always-run (idempotent) so re-imported
        // duplicates from a recovery loop also get trimmed.
        if (!cancelled) {
          try {
            dedupePdfImports(ydoc);
            // 2026-07-17 (dead-code pass 2): the 'crdt:dedupe-resync' window
            // event dispatch that used to fire here was removed — its only
            // listener lived in the retired useAnnotationCloudSync hook
            // (deleted pass 1; zero listeners remain, agent-cli included).
            // Y.Doc observers now propagate the trimmed state directly.
          } catch (dedupeErr) {
            // eslint-disable-next-line no-console
            console.warn('[YDocProvider] dedupe pass failed', dedupeErr?.message);
          }
        }
      } catch (err) {
        // Silent retry on partial failure per CONTEXT.md. Next first-open
        // tries again.
        // eslint-disable-next-line no-console
        console.warn('[YDocProvider] backfill kickoff failed', err?.message);
      } finally {
        if (!cancelled && typeof window !== 'undefined') {
          window.__crdtBackfillDone = true;
        }
      }
    };
    Promise.resolve().then(kickoff);

    return () => {
      cancelled = true;
    };
  }, [ydoc, docId, undoState?.undoCtx?.userId, sessionId]);

  // Phase 30 — drainQueue tick (1Hz).
  //
  // Retries half-failed dual-write entries silently. CONTEXT.md "Half-failed
  // save (one of the two writes lands, the other doesn't)" — the queue retries
  // until success OR quarantine. Pitfall 30-6 (kill-switch flip) is handled
  // inside drainQueue itself (first-line `if (!isCRDTEnabled()) return`).
  //
  // Test seams (window.__crdtForceLegacyFail / window.__crdtForceFailAnnoId)
  // let e2e specs inject failures without touching production code paths.
  useEffect(() => {
    const userId = undoState?.undoCtx?.userId;
    if (!ydoc || !userId) return undefined;
    let cancelled = false;
    const handlers = createQueueRetryHandlers({
      documentId: docId, userId, ydoc,
      upsertAnnotation: upsertFabricAnnotation,
      deleteAnnotation,
      beforeRetry: (_payload, side, annoId) => {
        if (cancelled) throw new Error('Sync queue document was closed');
        if (side === 'legacy' && typeof window !== 'undefined' && window.__crdtForceLegacyFail) {
          throw new Error('test-seam: __crdtForceLegacyFail');
        }
        if (typeof window !== 'undefined' && window.__crdtForceFailAnnoId === annoId) {
          throw new Error('test-seam: __crdtForceFailAnnoId');
        }
      },
    });
    const onStorageFailure = (event) => {
      if (cancelled || event.detail?.userId !== userId) return;
      const state = { code: event.detail.code, error: event.detail.error };
      storageStateRef.current = state;
      setStorageState(state);
      setBannerDismissed(false);
    };
    window.addEventListener(STORAGE_FAILURE_EVENT, onStorageFailure);
    const retry = () => drainQueue({
      userId, documentId: docId, ...handlers, shouldContinue: () => !cancelled,
    }).catch(() => { /* storage failure event shows the banner; pending work stays queued */ });
    retryDualWriteQueueRef.current = retry;
    const handle = setInterval(retry, 1_000);

    return () => {
      cancelled = true;
      clearInterval(handle);
      window.removeEventListener(STORAGE_FAILURE_EVENT, onStorageFailure);
      if (retryDualWriteQueueRef.current === retry) retryDualWriteQueueRef.current = null;
    };
  }, [ydoc, docId, undoState?.undoCtx?.userId]);

  // Phase 30 — UI hook for banner gate + overlay.
  // Polls localStorage queue state on a 1s tick (Plan 30-05 hook).
  const dualWriteQueueState = useDualWriteQueue(undoState?.undoCtx?.userId);

  // 2026-04-29 — listen for the SyncStatusChip "all retries failed" event so the
  // banner can pop immediately on manual-retry exhaustion. Resets when the user
  // dismisses the banner (so they aren't trapped on a banner they just hid).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => setManualRetryExhausted(true);
    window.addEventListener('crdt:manual-retry-failed', handler);
    return () => window.removeEventListener('crdt:manual-retry-failed', handler);
  }, []);

  // 2026-07-17 (dead-code pass 2): the 'crdt:deletions-pending' /
  // 'crdt:deletions-resolved' listener effects were removed — their only
  // producer was the retired useAnnotationCloudSync hook (deleted pass 1;
  // zero dispatchers remain anywhere, agent-cli included). deletionsPending
  // stays as state: it still gates the sync_deletions_pending banner branch
  // and is reset by the dismiss handler; with no producer it simply never
  // turns true until a future deletion-failure signal is reintroduced.

  // Phase 35 Plan 05 — cleanup-banner audit effect. Runs once per document
  // open. Flow:
  //   1. Resolve viewerId from the recoverable Supabase session helper.
  //   2. Resolve documentOwnerId + cutover seal from the documents table by docId.
  //   3. Short-circuit when viewer is not the owner (collaborators never see
  //      the banner per CONTEXT.md decision).
  //   4. Short-circuit when documentId is in the sticky-dismissed set.
  //   5. Skip sealed CRDT/Y.Doc docs; legacy rows are rollback residue there,
  //      not the display source of truth.
  //   6. Load the cloud snapshot via loadAllNonSurveyMarkerAnnotations and pass
  //      the rawRows (mapped to the audit's expected shape) to auditResidue.
  //   6. Persist the resulting residueIds in state — banner gate reads it.
  //
  // Concrete cloud-fetch surface: loadAllNonSurveyMarkerAnnotations (verified at
  // src/services/annotationCloudSync.js:318). No direct supabase.from() reads
  // outside that helper.
  //
  // Test seam: window.__phase35SeedResidue (production-stripped). When set in
  // dev/test, seeds residueIds directly so a Plan 35-06 e2e spec can assert
  // banner + Review + Cleanup flow without manufacturing a brake-suppression
  // race.
  //
  // Audit signature note: auditResidue takes isViewerOwner (boolean) and
  // localUserDeletedSet ({id, deletedAt}[]). With the brake retired, there's
  // no in-memory userDeletedFabricIdsRef anymore — localUserDeletedSet is
  // empty in production and the audit gracefully returns no residue. The
  // infrastructure remains as a safety net if a future session restores any
  // form of deferred-delete tracking.
  useEffect(() => {
    if (!ydoc || !docId) return undefined;
    let cancelled = false;
    (async () => {
      // Resolve viewer identity. Audit silently skips when no session.
      let viewerId = null;
      try {
        const session = await getSupabaseSession('YDocProvider.cleanupAudit');
        viewerId = session?.user?.id ?? null;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[Phase35][cleanup] auth session lookup failed', err?.message);
      }
      if (cancelled) return;
      if (!viewerId) {
        setCleanupResidueIds([]);
        return;
      }

      // Resolve document owner id from the documents table. UX: this is a
      // single-row query keyed on docId, runs once per document open. If it
      // fails (network blip, RLS denial), the audit bails — no banner, no
      // false alarm.
      let documentOwnerId = null;
      let cutoverCompletedAt = null;
      try {
        const meta = await resolveDocumentMetadata(docId, { supabase });
        documentOwnerId = meta.userId;
        cutoverCompletedAt = meta.cutoverCompletedAt;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[Phase35][cleanup] documents owner lookup threw', err?.message);
      }
      if (cancelled) return;

      // Per CONTEXT.md: collaborators never see the banner.
      if (!isOwner(viewerId, documentOwnerId)) {
        setCleanupResidueIds([]);
        return;
      }

      // Sticky-per-document dismissal short-circuit.
      const dismissedDocIds = readDismissedDocIds();
      if (dismissedDocIds.has(docId)) {
        setCleanupResidueIds([]);
        return;
      }

      if (cutoverCompletedAt) {
        // 2026-05-05 — Cutover-sealed documents render from Y.Doc. The legacy
        // annotation table can still hold duplicate pre-dedupe Drawboard/PDF
        // rows, so scanning it here slows startup and can confuse debugging
        // without changing what the user should see.
        setCleanupResidueIds([]);
        return;
      }

      // Test seam — production-stripped via import.meta.env.MODE check.
      // Plan 35-06 e2e flips can write window.__phase35SeedResidue =
      // ['id1', 'id2', ...] OR true (auto-seed first 3 owner-authored rows).
      let seededIds = null;
      let seedAutoPick = false;
      if (import.meta.env.MODE !== 'production' && typeof window !== 'undefined') {
        const seed = window.__phase35SeedResidue;
        if (Array.isArray(seed)) {
          seededIds = seed.filter((id) => typeof id === 'string');
        } else if (seed === true) {
          seedAutoPick = true;
        }
      }

      if (seededIds && seededIds.length > 0) {
        // UX: seam path (explicit ids) — bypass the audit and surface the
        // seeded ids directly so e2e specs can verify the banner + Review +
        // Cleanup chain without engineering a real brake-suppression race.
        setCleanupResidueIds(seededIds);
        return;
      }

      // Concrete cloud-snapshot read via the verified annotationCloudSync
      // helper. rawRows is the supabase row shape: { id, annotation_id,
      // user_id, annotation_type, annotation_data, ... }. Map to the
      // auditResidue contract shape (id, authorId, lastEditedAt) before
      // passing in — the helper resolves authorId via getAnnotationAuthorId
      // chain which expects authorId at meta./top-level/data., NOT user_id.
      let result;
      try {
        result = await loadAllNonSurveyMarkerAnnotations(docId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[Phase35][cleanup] loadAllNonSurveyMarkerAnnotations threw', err?.message);
        setCleanupResidueIds([]);
        return;
      }
      if (cancelled) return;
      if (result.error) {
        // eslint-disable-next-line no-console
        console.warn('[Phase35][cleanup] loadAllNonSurveyMarkerAnnotations failed', result.error?.message);
        setCleanupResidueIds([]);
        return;
      }
      const rawRows = result.rawRows || [];
      // UX: map raw supabase rows to the audit shape. id = annotation_id (the
      // client-side stable id the delete API takes); authorId = user_id;
      // lastEditedAt = updated_at parsed to epoch ms (audit uses strict
      // less-than comparison against the local-deleted cutoff).
      const cloudAnnotations = rawRows.map((row) => ({
        id: row.annotation_id,
        authorId: row.user_id,
        lastEditedAt: row.updated_at ? Date.parse(row.updated_at) : null,
      })).filter((a) => typeof a.id === 'string');

      if (seedAutoPick) {
        // UX: seam path (auto-pick) — per Plan 35-01 locked contract, the
        // seed === true variant auto-picks the first 3 viewer-authored cloud
        // annotations as the residue set. Lets e2e specs verify the banner
        // + Review + Cleanup chain against real cloud data without locking
        // specific ids. Production-stripped via the env check above. If
        // there are fewer than 3 viewer-authored rows, surface whatever
        // exists (the spec's runtime-skip handles the empty case).
        const viewerOwn = cloudAnnotations
          .filter((a) => a.authorId === viewerId)
          .slice(0, 3)
          .map((a) => a.id);
        setCleanupResidueIds(viewerOwn);
        return;
      }

      // localUserDeletedSet is empty in production post-brake-retirement
      // (the in-memory ref was removed in Task 1). The audit returns empty
      // for empty set — no false positives. This wiring stands ready for a
      // future feature that persists local-delete intents across sessions.
      const localUserDeletedSet = [];

      const auditResult = auditResidue({
        cloudAnnotations,
        viewerId,
        isViewerOwner: true,
        dismissedDocIds,
        documentId: docId,
        localUserDeletedSet,
      });
      if (cancelled) return;
      setCleanupResidueIds(auditResult.residueIds);
    })();
    return () => { cancelled = true; };
  }, [ydoc, docId]);

  // Phase 35 Plan 05 — banner action handlers.

  const handleCleanupBannerAction = useCallback(async () => {
    // UX: 'Clean up now' (or 'Clean up all N' from the Review panel).
    // Fires deleteAnnotations on the audited residueIds. On success, mark
    // the document as dismissed (so the banner doesn't re-fire on next
    // open if a new audit somehow finds the same ids), clear local state,
    // close any open Review panel.
    if (!cleanupResidueIds || cleanupResidueIds.length === 0) return;
    try {
      const result = await deleteAnnotations(docId, cleanupResidueIds);
      if (result?.success) {
        const dismissed = readDismissedDocIds();
        dismissed.add(docId);
        writeDismissedDocIds(dismissed);
        setCleanupResidueIds([]);
        setReviewPanelOpen(false);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[Phase35][cleanup] deleteAnnotations failed', result?.error?.message);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Phase35][cleanup] deleteAnnotations threw', err?.message || String(err));
    }
  }, [cleanupResidueIds, docId]);

  const handleCleanupBannerReview = useCallback(() => {
    // UX per checker W5: open the actual Review surface
    // (CleanupResidueReviewPanel — count + first 5 ids + Clean up all + Close).
    setReviewPanelOpen(true);
  }, []);

  const handleCleanupBannerDismiss = useCallback(() => {
    // UX: sticky-per-document dismissal — never resurfaces for this doc id.
    const dismissed = readDismissedDocIds();
    dismissed.add(docId);
    writeDismissedDocIds(dismissed);
    setCleanupResidueIds([]);
    setReviewPanelOpen(false);
  }, [docId]);

  // Phase 30 — test seam for e2e specs that need to assert Y.Doc annotation
  // count post-backfill. Updates whenever yMapAnnotations.observe fires.
  useEffect(() => {
    if (!ydoc) return undefined;
    const yMap = ydoc.getMap('annotations');
    const updateCount = () => {
      if (typeof window !== 'undefined') {
        window.__ydocAnnotationCount = yMap.size;
      }
    };
    updateCount();
    yMap.observe(updateCount);
    return () => yMap.unobserve(updateCount);
  }, [ydoc]);

  const value = useMemo(() => ({
    ydoc,
    isHydrating,
    storageState,
    role,
    isCRDTEnabled: true,
    dismissBanner: () => setBannerDismissed(true),
    // Phase 28 additions — exposed via the same context surface so consumers
    // (ReadOnlyGate, future sync-chip in Phase 33, etc.) can read without
    // additional providers.
    accessRevoked,
    // 2026-07-01 — effective document role ('owner'|'editor'|'viewer'|null).
    // ReadOnlyGate reads this to engage the view-only presentation for
    // role === 'viewer'; null fails open to read-write.
    docRole,
    transportState,
    isDocShared,
    loginExpired,
    reSignInModalOpen,
    setReSignInModalOpen,
    setLoginExpired,
    // UX: closeDocument is caller-provided so the consumer (App.jsx-level
    // wrapper) decides what "close this document" means in its own routing
    // context. Default falls back to history.back() — the closest thing to
    // "go back where I came from" without coupling to a specific routing lib.
    closeDocument: closeDocument || (() => {
      if (typeof window !== 'undefined') {
        try { window.history.back(); } catch { /* swallow */ }
      }
    }),
    // Phase 28 — getOriginContext is the canonical factory Phase 29's
    // Fabric ↔ Y.Map binding will call inside ydoc.transact(fn, origin).
    // Returns a frozen origin payload with userId from the current Supabase
    // auth session, deviceId from the 4-tier resolution chain, sessionId
    // per-mount, and clientID from the Y.Doc itself. serverTs is intentionally
    // absent — Postgres column server_ts DEFAULT NOW() owns it (AUTH-03).
    //
    // Exposed here so consumers can pull the same factory regardless of
    // which transport is locked in 28-BENCHMARK.md.
    // 2026-05-07 — Origin context now returns the memoized per-user
    // local-fabric origin so the undo manager's trackedOrigins Set has
    // a reference-equal match when the bridge runs ydoc.transact. The
    // previous buildOrigin call returned a fresh frozen object on every
    // invocation with source='local' instead of 'local-fabric', so the
    // undo manager never recorded any local edits and Cmd+Z had nothing
    // to pop. Falls back to buildOrigin only when userId is missing
    // (boot before auth resolved); that path is non-undoable but
    // preserves the previous defensive shape.
    getOriginContext: () => {
      const userIdResolved = undoState?.undoCtx?.userId
        ?? supabase?.auth?.session?.()?.data?.session?.user?.id
        ?? supabase?.auth?.user?.()?.id
        ?? null;
      const deviceIdResolved = undoState?.undoCtx?.deviceId ?? getDeviceId();
      const clientIDResolved = undoState?.undoCtx?.clientID ?? ydoc?.clientID;
      if (userIdResolved) {
        return getLocalFabricOrigin({
          userId: userIdResolved,
          deviceId: deviceIdResolved,
          sessionId,
          clientID: clientIDResolved,
        });
      }
      return buildOrigin({
        userId: userIdResolved,
        deviceId: deviceIdResolved,
        sessionId,
        clientID: clientIDResolved,
      });
    },
    // Phase 29 additions — per-user Y.UndoManager + the ctx object the bridge
    // and the App.jsx Cmd+Z handler both need. undoCtx carries the same identity
    // payload (userId/deviceId/sessionId/clientID) that getOriginContext seeds,
    // so Plan 29-04's userUndo / userRedo wrappers can attribute the undo
    // transaction in the Phase 33 activity log without re-deriving identity.
    undoManager: undoState?.undoManager ?? null,
    undoCtx: undoState?.undoCtx ?? null,
    // KAL-274 — typed awareness accessor, replacing the old untyped
    // globalThis.__crdtAwareness probe (which had no writer anywhere).
    // Reads the CURRENT transport handle's y-protocols Awareness instance via
    // ref, so the accessor stays identity-stable across provider restarts.
    // Returns null until a transport that carries awareness is mounted
    // (Phase 33 wires the instance through createTransportProvider's
    // `awareness` option); consumers degrade to "no remote editors".
    getAwareness: () => providerRef.current?.awareness ?? null,
  }), [
    ydoc,
    isHydrating,
    storageState,
    role,
    accessRevoked,
    docRole,
    transportState,
    isDocShared,
    loginExpired,
    reSignInModalOpen,
    closeDocument,
    sessionId,
    undoState,
  ]);

  // The "live sync is offline" banner (transport_offline) only makes sense for a SHARED document —
  // one that actually has collaborators to sync WITH. If the document was never shared, there is no
  // live sync to be offline, so the banner would be noise that wrongly competes with the bottom-left
  // save indicator (the user's work still saves via the cloud-save path). Resolve "is this document
  // shared" from document_collaborators — a DB fact, independent of the Y.Doc
  // transport. Unknown stays in the neutral checking state until the query
  // resolves; it must not create a false red failure for a private document.
  // Realtime row changes and a bounded poll keep this current when a
  // private document is shared or unshared while it remains open.
  useEffect(() => {
    if (!docId) { setIsDocShared(false); return undefined; }
    let cancelled = false;
    const refreshSharedState = async (options) => {
      // w34 (2026-09-25): the 30 s fallback poll (called with no options)
      // skips while the tab is hidden (background tab, minimised window): it
      // costs two reads (document_collaborators + my role), ~240 requests an
      // hour per open document, and a hidden tab shows no sync banner. The
      // first check, realtime collaborator changes and becoming visible again
      // always run ({ force: true }), so nothing a change sends is dropped.
      if (!options?.force && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        // "Shared" = an explicit active row for another user, or my own
        // collaborator row when I am not the owner. The latter matters because
        // document owners are not guaranteed to have a collaborator row.
        // If identity/role cannot be resolved, retain unknown rather than
        // presenting a false healthy state.
        let myId = null;
        try {
          const session = await getSupabaseSession('YDocProvider.isDocShared');
          myId = session?.user?.id ?? null;
        } catch { myId = null; }
        if (!myId) { if (!cancelled) setIsDocShared(null); return; }
        const { data, error } = await supabase
          .from('document_collaborators')
          .select('user_id')
          .eq('document_id', docId)
          .eq('status', 'active');
        if (error) {
          if (!cancelled) setIsDocShared(null);
          return;
        }
        const activeCollaboratorUserIds = (data || [])
          .map((row) => row?.user_id)
          .filter(Boolean);
        const hasExplicitRemote = hasRemoteDocumentCollaborator({
          activeCollaboratorUserIds,
          currentUserId: myId,
          currentRole: null,
        });
        if (hasExplicitRemote) {
          if (!cancelled) setIsDocShared(true);
          return;
        }
        // Owners are not guaranteed to have a document_collaborators row. If
        // my row is the only row, an editor/viewer still has the row-less owner
        // to sync with; an owner with only their own row does not.
        const currentRole = await fetchMyDocumentRole(supabase, docId);
        if (!cancelled) {
          setIsDocShared(hasRemoteDocumentCollaborator({
            activeCollaboratorUserIds,
            currentUserId: myId,
            currentRole,
          }));
        }
      } catch { if (!cancelled) setIsDocShared(null); }
    };
    void refreshSharedState({ force: true });

    const channelSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const collaboratorChannel = supabase
      .channel(`ydoc-shared-state:${docId}:${channelSuffix}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'document_collaborators',
        filter: `document_id=eq.${docId}`,
      }, () => {
        void refreshSharedState({ force: true });
      })
      .subscribe();
    const refreshTimer = setInterval(refreshSharedState, 30_000);
    const refreshWhenShown = () => {
      if (document.visibilityState !== 'hidden') void refreshSharedState({ force: true });
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', refreshWhenShown);

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', refreshWhenShown);
      try { supabase.removeChannel(collaboratorChannel); } catch { /* best effort */ }
    };
  }, [docId]);

  // 2026-07-01 — resolve the caller's effective role once per document open.
  // Fail-open: any error → null → the read-write presentation stands (the
  // server keeps rejecting viewer writes either way). fetchMyDocumentRole
  // swallows RPC/network errors internally, so no try/catch needed here.
  useEffect(() => {
    if (!docId) { setDocRole(null); return undefined; }
    let cancelled = false;
    (async () => {
      const resolved = await fetchMyDocumentRole(supabase, docId);
      if (!cancelled) setDocRole(resolved);
    })();
    return () => { cancelled = true; };
  }, [docId]);

  // Banner gates: must have a non-ok storage state AND the user has not dismissed it this session.
  // CONTEXT.md forbids silent fallback — every non-ok code surfaces, NB: the banner component itself
  // gates the dismiss button for permission_revoked, so that code stays visible after a stale dismiss.
  // EXCEPTION: 'transport_offline' (live realtime/collaboration down) only surfaces when the document
  // is actually shared (isDocShared) — otherwise there is nothing to live-sync and it would be noise.
  const showBanner = storageState && storageState.code !== 'ok' && !bannerDismissed
    && (storageState.code !== 'transport_offline' || isDocShared === true);

  return (
    <YDocContext.Provider value={value}>
      {showBanner && (
        <StorageFailureBanner
          code={storageState.code}
          statusDetail={
            storageState.code === 'transport_offline' ? transportRetryError : null
          }
          onDismiss={() => {
            // The banner component refuses to render the dismiss button when
            // code === 'permission_revoked', so this handler only fires for
            // dismissable codes. Belt-and-suspenders: if the code is somehow
            // permission_revoked, do not flip the dismissed flag.
            if (storageState.code !== 'permission_revoked') {
              setBannerDismissed(true);
            }
          }}
          onAction={() => {
            // Per-code action wiring per 28-UI-SPEC.md Interaction States table.
            if (storageState.code === 'transport_offline') {
              // Retry the existing transport in place. This is bounded and
              // preserves the open document instead of forcing a full reload.
              handleTransportRetry();
            } else if (storageState.code === 'permission_revoked') {
              // UX: Close document — caller-provided callback. User leaves on
              // their own terms, document stayed open in read-only the whole
              // time per CONTEXT.md decision.
              value.closeDocument();
            } else if (storageState.code === 'login_expiry_failure') {
              // UX: open inline ReSignInModal. The user stays on this document
              // page; after successful sign-in the modal closes and queued
              // edits flush via Phase 27 IndexedDB persistence.
              setReSignInModalOpen(true);
            } else if (
              storageState.code === 'version_mismatch' ||
              storageState.code === 'blocked'
            ) {
              // Phase 27 codes — reload to retry the migration / lock acquisition.
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            } else {
              // Phase 27 quota_exceeded / invalid_state — open the help docs.
              if (typeof window !== 'undefined') {
                window.open(
                  'https://support.google.com/chrome/answer/2392709',
                  '_blank',
                  'noopener,noreferrer'
                );
              }
            }
          }}
        />
      )}
      {/* 2026-07-01 — view-only notice for collaborators whose effective role
          is 'viewer'. Distinct copy from permission_revoked (they were never
          editors — nothing was taken away). Dismissable: ReadOnlyGate keeps
          the toolbar dimmed and mutation keystrokes suppressed either way, so
          the banner is informative, not load-bearing. Hidden while any
          storage-failure banner shows (no stacking) and when accessRevoked
          takes over (the revoked copy wins). */}
      {docRole === 'viewer' && !accessRevoked && !viewerBannerDismissed &&
       (!storageState || storageState.code === 'ok') && (
        <StorageFailureBanner
          code="viewer_access"
          onDismiss={() => setViewerBannerDismissed(true)}
        />
      )}
      {/* Phase 30 — sync-queue-stuck banner gate.
          Mount only when no other storage banner is showing (avoids stacking).
          2026-04-29 fix: also keep the banner up while there are quarantined
          entries (entries that hit 10 retry failures and stopped trying). The
          previous gate ONLY watched stuckCount, which drops to zero the moment
          an entry quarantines — the banner would silently disappear even
          though the user's data was still unsaved. The banner now persists
          until the user dismisses it or every entry actually reaches the
          cloud. */}
      {(deletionsPending || dualWriteQueueState.stuckCount > 0 || dualWriteQueueState.quarantinedAnnoIds.length > 0 || (manualRetryExhausted && dualWriteQueueState.hasPending)) &&
       (!storageState || storageState.code === 'ok') &&
       !bannerDismissed && (
        <StorageFailureBanner
          // 2026-04-30 — deletion-warning copy takes priority when a delete is
          // unsaved. Otherwise the existing sync_queue_stuck copy stands.
          code={deletionsPending ? 'sync_deletions_pending' : 'sync_queue_stuck'}
          onDismiss={() => { setBannerDismissed(true); setManualRetryExhausted(false); setDeletionsPending(false); }}
          onAction={() => {
            // UX: "Retry now" — eager flush. Run drainQueue once outside the
            // 1Hz interval, then let the regular tick continue. If the flush
            // succeeds (queue drains), the gate above stops rendering the
            // banner naturally (stuckCount reads zero on next poll).
            retryDualWriteQueueRef.current?.();
          }}
        />
      )}
      {/* Phase 35 Plan 05 — sync_residue_cleanup banner gate.
          Mount only when no higher-priority storage banner is showing AND
          when the audit found residue. UX: this is a one-shot owner-only
          affordance — the audit + sticky-dismiss in localStorage guarantee
          it surfaces at most once per document for the document owner.
          Collaborators never see it (auditResidue returns empty when
          isViewerOwner is false). */}
      {cleanupResidueIds && cleanupResidueIds.length > 0 &&
       (!storageState || storageState.code === 'ok') &&
       !(deletionsPending || dualWriteQueueState.stuckCount > 0 || dualWriteQueueState.quarantinedAnnoIds.length > 0 || (manualRetryExhausted && dualWriteQueueState.hasPending)) && (
        <StorageFailureBanner
          code="sync_residue_cleanup"
          onAction={handleCleanupBannerAction}
          onReview={handleCleanupBannerReview}
          onDismiss={handleCleanupBannerDismiss}
        />
      )}
      {/* Phase 35 Plan 05 — Review surface mounted as a sibling so it can
          overlay the banner when the owner clicks Review. Not gated on
          cleanupResidueIds.length > 0 here — the panel itself returns null
          when isOpen is false, and the residueIds array stays in scope until
          the user dismisses or completes cleanup. */}
      <CleanupResidueReviewPanel
        isOpen={reviewPanelOpen}
        residueIds={cleanupResidueIds || []}
        onClose={() => setReviewPanelOpen(false)}
        onCleanupAll={handleCleanupBannerAction}
      />
      {reSignInModalOpen && (
        <ReSignInModal
          isOpen={reSignInModalOpen}
          // Phase 33 will pass auth.user.email here; for Phase 28 we leave it
          // null and the user types their email. Easy upgrade later.
          prefillEmail={null}
          onSignedIn={() => {
            // UX: successful re-sign-in. Close modal, clear loginExpired flag,
            // clear the login_expiry_failure banner so the user lands back on
            // the document with no banners showing. Queued edits flush
            // automatically via the existing Phase 27 IndexedDB persistence.
            setReSignInModalOpen(false);
            setLoginExpired(false);
            if (storageStateRef.current?.code === 'login_expiry_failure') {
              setStorageState({ code: 'ok', role: 'unknown' });
            }
          }}
          onCloseDocument={() => value.closeDocument()}
        />
      )}
      {/* Phase 29 — Plan 29-06 Task 4 render layer: remote-delete toast stack.
          UX (UI-SPEC §"Multiple-toast handling"): up to 3 toasts visible at
          once stacked vertically with 8px gap (the .storage-banner sticky
          position + their natural flow handles the layout); the 4th and beyond
          merge into a single "and N more" banner so the user is never buried
          under a wall of red. Equal weight for both Restore and Dismiss in
          each toast — neither choice is the "right" one in the abstract. */}
      {toasts.slice(0, 3).map((toast) => (
        <StorageFailureBanner
          key={toast.id}
          code={toast.code}
          collaboratorName={toast.collaboratorName}
          onRestore={() => handleRestore(toast)}
          onDismiss={() => handleDismissToast(toast.id)}
        />
      ))}
      {toasts.length > 3 && (
        <StorageFailureBanner
          key="merged"
          code="annotation_remote_deleted"
          // UX: collaboratorName here is repurposed as the overflow indicator.
          // Reads as "Removed by and N more removed" — slightly off-grammar but
          // unambiguous; user's mental model: "more deletes than I can review
          // individually". Restore-all bulk-restores; Dismiss-all clears all.
          collaboratorName={`and ${toasts.length - 3} more removed`}
          onRestore={() => {
            // Bulk restore the overflow set. Each restore runs in its own
            // ydoc.transact so per-annotation race guards apply individually.
            toasts.slice(3).forEach(handleRestore);
          }}
          onDismiss={() => {
            // Drop the overflow but keep the first three toasts visible. User
            // still sees the toasts they had time to engage with.
            setToasts((prev) => prev.slice(0, 3));
          }}
        />
      )}

      {/* Phase 29 — Plan 29-06 Task 4 render layer: collaborator outline overlay.
          Mounted at YDocProvider scope so the overlay component lives inside
          the React tree even before per-page bbox integration is wired.
          editors=[] today because joining the awareness Map (remoteEditors,
          keyed on annoId) with per-page bbox + pageSize requires reaching
          into PAL / SVGAnnotationLayer (Always-Protected). The overlay
          gracefully renders nothing on empty editors. Phase 32 hardening can
          add the bbox feed via either:
            - extending useAnnotationsCRDT to include bbox per anno, or
            - a sibling hook joining useRemoteEditors with useAnnotationsCRDT.
          remoteEditors is computed inside this component so the awareness
          subscription is live; the data is just not yet plumbed to a per-page
          mount point. Documented as a follow-up in 29-06-SUMMARY.md. */}
      <CollaboratorOutlineOverlay editors={[]} />

      {/* Phase 30 — Plan 30-06 render layer: quarantine marker overlay.
          Mounted at YDocProvider scope so the overlay component lives inside
          the React tree even before per-page bbox integration is wired.
          quarantinedAnnotations=[] today because joining quarantinedAnnoIds
          (from useDualWriteQueue) with per-page bbox + pageSize requires
          reaching into PAL / SVGAnnotationLayer (Always-Protected). The
          overlay gracefully renders nothing on empty input. Phase 32 hardening
          owns the bbox feed (same lane as Phase 29's CollaboratorOutlineOverlay
          pickup); for now we mount with stub bboxes so the wire-up is in place
          and the markers float at origin (0,0) on every page until the bbox
          feed lands. The visible signal user-side until Phase 32 lands is the
          banner + the TabBar dot — the per-annotation marker requires the
          per-page bbox plumbing.

          Documented as a follow-up in 30-06-SUMMARY.md / 30-deferred-items.md. */}
      <QuarantineMarkerOverlay
        quarantinedAnnotations={dualWriteQueueState.quarantinedAnnoIds.map((id) => ({
          id,
          pageNumber: 0,  // Phase 32 hardening will plug in the real per-anno page
          bbox: { x: 0, y: 0, w: 0, h: 0 },
        }))}
        pageNumber={0}
      />

      {/* ReadOnlyGate is the Phase 28 read-only mode dispatcher — renders null
          but sets body[data-readonly] + a window-capture-phase keydown listener
          when accessRevoked is true. Mounted as a sibling here so App.jsx
          stays untouched (Plan 28-06 Blocker 1 fix). */}
      <ReadOnlyGate isActive={isActive} />
      {children}
    </YDocContext.Provider>
  );
}

export default YDocProvider;
