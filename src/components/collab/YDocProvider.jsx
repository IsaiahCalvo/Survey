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

import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { getOrCreateYDoc, releaseYDoc } from '../../lib/collab/ydocRegistry.js';
import { attachLifecycle } from '../../lib/collab/ydocLifecycle.js';
import { isCRDTEnabled } from '../../lib/collab/crdtFeatureFlag.js';
import StorageFailureBanner from './StorageFailureBanner.jsx';
import ReSignInModal from './ReSignInModal.jsx';
import ReadOnlyGate from './ReadOnlyGate.jsx';

// Phase 28 — locked transport provider per 28-BENCHMARK.md (custom Supabase
// Realtime adapter wins; Hocuspocus path remains as dormant v2.5+ fallback).
// Importing the alias `createTransportProvider` keeps the call site transport-
// agnostic — if v2.5+ ever flips to Hocuspocus, the change is one line here.
import { createSupabaseYjsProvider as createTransportProvider } from '../../lib/collab/SupabaseYjsProvider.js';
import { attachAuthSessionBridge } from '../../lib/collab/authSessionBridge.js';
import { buildOrigin } from '../../lib/collab/originBuilder.js';
import { getDeviceId } from '../../lib/collab/deviceId.js';
import { supabase } from '../../supabaseClient.js';

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
  transportState: null,
  loginExpired: false,
  reSignInModalOpen: false,
  setReSignInModalOpen: () => {},
  setLoginExpired: () => {},
  closeDocument: () => {},
  getOriginContext: () => Object.freeze({ source: 'local' }),
});

export const YDocContext = createContext(null);

export function YDocProvider({ docId, children, closeDocument }) {
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
    <YDocProviderInner key={docId} docId={docId} closeDocument={closeDocument}>
      {children}
    </YDocProviderInner>
  );
}

function YDocProviderInner({ docId, children, closeDocument }) {
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
  const [storageState, setStorageState] = useState(null);
  const [role, setRole] = useState('unknown');
  const [isHydrating, setIsHydrating] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Phase 28 state additions — accessRevoked drives ReadOnlyGate; transportState
  // is exposed for any future status surfaces (sync chip in Phase 33);
  // loginExpired tracks the failed-refresh signal from authSessionBridge;
  // reSignInModalOpen + setter control the inline re-sign-in form mount.
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [transportState, setTransportState] = useState(null);
  const [loginExpired, setLoginExpired] = useState(false);
  const [reSignInModalOpen, setReSignInModalOpen] = useState(false);

  // Ref-mirror of storageState so the transport provider's async callbacks can
  // read the latest code without stale-closure bugs. Updated via the effect below.
  const storageStateRef = useRef(null);
  useEffect(() => { storageStateRef.current = storageState; }, [storageState]);

  useEffect(() => {
    // Fresh mount → reset banner-dismiss state. Subsequent storage failures
    // re-show the banner; user can dismiss again per session.
    setBannerDismissed(false);
    setIsHydrating(true);

    const handle = attachLifecycle(ydoc, docId, {
      onStorageState: (state) => {
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
    let providerHandle = null;
    let cancelled = false;
    Promise.resolve(
      createTransportProvider({
        documentId: docId,
        ydoc,
        supabase,
        onTransportState: (state) => {
          // UX: setTransportState is the always-on side; the banner gate fires
          // only on 'offline' so steady-state 'online' is invisible to the user.
          setTransportState(state);
          if (state === 'offline') {
            // UX: live sync broke — surface honestly per CONTEXT.md
            // anti-silent-fallback principle. Banner copy in
            // StorageFailureBanner.jsx tells the user what's at risk.
            setStorageState({ code: 'transport_offline', role: 'unknown' });
          } else if (state === 'online') {
            // UX: only clear if the current state is the transport-side banner.
            // Don't stomp on persistence-side codes (quota / blocked / etc.) —
            // those are independent failure modes.
            if (storageStateRef.current?.code === 'transport_offline') {
              setStorageState({ code: 'ok', role: 'unknown' });
            }
          }
        },
        onUpdateRejected: (reason) => {
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
      })
    ).then((p) => {
      if (cancelled) {
        // The unmount cleanup ran before the factory resolved (rare on the
        // sync Supabase path; possible on the async Hocuspocus path). Tear
        // down what we just built so we don't leak a live channel.
        try { p?.disconnect?.(); } catch { /* swallow */ }
        return;
      }
      providerHandle = p;
      providerRef.current = p;
    }).catch((err) => {
      // Provider construction failed (network down at boot, missing env, etc.).
      // Surface via the storage state channel as transport_offline so the user
      // sees the offline banner rather than a silent freeze.
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.warn('[YDocProvider] transport provider failed to construct', err?.message);
      setStorageState({ code: 'transport_offline', role: 'unknown' });
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
      clearInterval(roleInterval);
      clearTimeout(hydrationFallback);
      try { handle.detach(); } catch { /* swallow — handle may already be torn down */ }
      try { providerHandle?.disconnect?.(); } catch { /* swallow */ }
      try { providerRef.current?.disconnect?.(); } catch { /* swallow */ }
      try { bridge?.detach?.(); } catch { /* swallow */ }
      try { bridgeRef.current?.detach?.(); } catch { /* swallow */ }
      providerRef.current = null;
      bridgeRef.current = null;
      releaseYDoc(docId);
      lifecycleRef.current = null;
    };
  }, [ydoc, docId]);

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
    transportState,
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
    getOriginContext: () => buildOrigin({
      userId: supabase?.auth?.session?.()?.data?.session?.user?.id
        ?? supabase?.auth?.user?.()?.id,
      deviceId: getDeviceId(),
      sessionId,
      clientID: ydoc?.clientID,
    }),
  }), [
    ydoc,
    isHydrating,
    storageState,
    role,
    accessRevoked,
    transportState,
    loginExpired,
    reSignInModalOpen,
    closeDocument,
    sessionId,
  ]);

  // Banner gates: must have a non-ok storage state AND user has not dismissed yet
  // for this session. CONTEXT.md forbids silent fallback — every non-ok code that
  // hasn't been acknowledged surfaces the banner. NB: the banner component itself
  // gates dismiss-button render for permission_revoked, so that code stays visible
  // even after a stale dismiss attempt.
  const showBanner = storageState && storageState.code !== 'ok' && !bannerDismissed;

  return (
    <YDocContext.Provider value={value}>
      {showBanner && (
        <StorageFailureBanner
          code={storageState.code}
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
              // UX: Retry now — disconnect + reconnect. Easiest reliable path is
              // a full page reload (the existing useEffect re-runs and rebuilds
              // the provider). Plan 32 may add a softer reconnect() method on
              // the provider; for now the reload preserves the user's state via
              // Phase 27 IndexedDB persistence so nothing is lost.
              try { providerRef.current?.disconnect?.(); } catch { /* swallow */ }
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
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
      {/* ReadOnlyGate is the Phase 28 read-only mode dispatcher — renders null
          but sets body[data-readonly] + a window-capture-phase keydown listener
          when accessRevoked is true. Mounted as a sibling here so App.jsx
          stays untouched (Plan 28-06 Blocker 1 fix). */}
      <ReadOnlyGate />
      {children}
    </YDocContext.Provider>
  );
}

export default YDocProvider;
