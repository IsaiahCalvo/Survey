// src/components/collab/YDocProvider.jsx
// Phase 27 — React context provider for the per-document Y.Doc.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md Pattern 1 + Pattern 2 + Pattern 4
//
// Lifecycle (UX: invisible to the user — Y.Doc is borrowed from a module-scoped
// registry so HMR / parent re-renders don't churn the live doc):
//   mount   -> getOrCreateYDoc(docId) + attachLifecycle(ydoc, docId, {onStorageState})
//   unmount -> lifecycle.detach() + releaseYDoc(docId)  (does NOT destroy — Pitfall 21)
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
});

export const YDocContext = createContext(null);

export function YDocProvider({ docId, children }) {
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
  return <YDocProviderInner key={docId} docId={docId}>{children}</YDocProviderInner>;
}

function YDocProviderInner({ docId, children }) {
  // Borrow the Y.Doc from the module-scoped registry. Stable across re-renders for
  // a given docId; HMR-safe because the registry survives module reloads.
  const ydoc = useMemo(() => getOrCreateYDoc(docId), [docId]);

  const lifecycleRef = useRef(null);
  const [storageState, setStorageState] = useState(null);
  const [role, setRole] = useState('unknown');
  const [isHydrating, setIsHydrating] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);

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
      clearInterval(roleInterval);
      clearTimeout(hydrationFallback);
      try { handle.detach(); } catch { /* swallow — handle may already be torn down */ }
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
  }), [ydoc, isHydrating, storageState, role]);

  // Banner gates: must have a non-ok storage state AND user has not dismissed yet
  // for this session. CONTEXT.md forbids silent fallback — every non-ok code that
  // hasn't been acknowledged surfaces the banner.
  const showBanner = storageState && storageState.code !== 'ok' && !bannerDismissed;

  return (
    <YDocContext.Provider value={value}>
      {showBanner && (
        <StorageFailureBanner
          code={storageState.code}
          onDismiss={() => setBannerDismissed(true)}
          onAction={() => {
            // Action-link behavior per 27-UI-SPEC.md Surface 2:
            //   quota_exceeded   → open help docs (browser storage management)
            //   invalid_state    → open help docs (enable storage / exit private browsing)
            //   version_mismatch → reload the app so it can re-pick the migration path
            //   blocked          → reload to retry the lock acquisition
            // UX: Phase 33+ will swap these placeholders for project-owned help URLs.
            if (storageState.code === 'version_mismatch' || storageState.code === 'blocked') {
              window.location.reload();
            } else {
              window.open(
                'https://support.google.com/chrome/answer/2392709',
                '_blank',
                'noopener,noreferrer'
              );
            }
          }}
        />
      )}
      {children}
    </YDocContext.Provider>
  );
}

export default YDocProvider;
