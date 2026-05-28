// src/lib/collab/HocuspocusYjsProvider.js
// Phase 28 — Hocuspocus fallback-path Yjs provider. THE FALLBACK SPIKE PROTOTYPE.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md Pattern 2
//
// Mirrors SupabaseYjsProvider's public contract so Plan 28-04's benchmark harness
// can swap providers behind a single --transport=supabase|hocuspocus flag.
//
// CONDITIONAL DEPENDENCY: @hocuspocus/provider is NOT installed by default.
// Per 28-CONTEXT.md, package.json waiver is granted ONLY IF Hocuspocus wins
// the spike. This wrapper imports the package dynamically so:
//   - Missing dep produces a clear runtime error, NOT a build break
//   - The benchmark's --transport=supabase path stays green even with no Hocuspocus install
//
// Pitfall 1 defense (carried over from Pattern 4): the token thunk resolves the
// current Supabase session on every reconnect — Hocuspocus internally calls the
// thunk on each reconnect attempt, so a refreshed JWT is always carried fresh.
// (See SupabaseYjsProvider's authSessionBridge for the parallel TOKEN_REFRESHED →
// realtime.setAuth wiring on the default path. Hocuspocus's token-thunk pattern is
// the equivalent surface for the fallback path.)
//
// applyUpdate-only invariant: this file MUST NOT construct a Y.Doc directly.
// The Y.Doc is borrowed from ydocRegistry — passed in as a constructor argument.
// Hocuspocus internally applies remote updates via Y.applyUpdate (verified in
// Hocuspocus source). We never construct or replace the Y.Doc directly. The
// applyUpdateOnlyInvariant grep test gates this file — see
// tests/phase27/applyUpdateOnlyInvariant.test.mjs. The phrasing here deliberately
// avoids the regex-matchable form (matches ydocLifecycle.js's pattern).
//
// Server side (NOT in this repo): a separate Node service running @hocuspocus/server
// handles onAuthenticate (verifies Supabase JWT signature, runs user_can_access_document
// RPC) and onStoreDocument (persists snapshot to doc_yjs_state via service-role client).
// Deployment shape (Fly.io / Railway / etc.) decided in 28-BENCHMARK.md if Hocuspocus wins.
import { getSupabaseSession } from '../../supabaseClient.js';

/**
 * Create a Hocuspocus-backed Yjs provider for a single document.
 * Mirrors SupabaseYjsProvider's public contract.
 *
 * Public contract (interchangeable with SupabaseYjsProvider behind --transport flag):
 *   args.documentId        — string identifier; used as Hocuspocus document `name`
 *   args.ydoc              — borrowed Y.Doc (from ydocRegistry); never constructed here
 *   args.supabase          — Supabase client required by the shared provider contract
 *   args.url               — Hocuspocus WS URL; falls back to VITE_HOCUSPOCUS_URL env, then localhost
 *   args.awareness         — optional y-protocols Awareness (Phase 33 consumer)
 *   args.onUpdateRejected  — invoked on onAuthenticationFailed; surfaces as kick-UX banner
 *   args.onTransportState  — invoked on onStatus (connected→online, disconnected→offline)
 *
 * Returns: { disconnect: () => void } — same shape as SupabaseYjsProvider returns
 *
 * NOTE on async asymmetry: this factory is `async` because the @hocuspocus/provider
 * dynamic import is async (so a missing package produces a runtime error, not a build
 * break). SupabaseYjsProvider's factory is sync (Plan 28-02). Plan 28-04's benchmark
 * harness and Plan 28-06's wire-up must `await` whichever factory they pick. Documented
 * in 28-03-SUMMARY.md so downstream plans don't trip on this contract difference.
 *
 * @param {object} args
 * @param {string} args.documentId
 * @param {object} args.ydoc - borrowed from ydocRegistry; this provider must not construct it
 * @param {object} args.supabase - Supabase client required by the shared provider contract
 * @param {string} [args.url] - Hocuspocus WS URL; defaults to env VITE_HOCUSPOCUS_URL
 * @param {object} [args.awareness]
 * @param {(reason: string) => void} [args.onUpdateRejected]
 * @param {(state: 'online'|'offline') => void} [args.onTransportState]
 * @returns {Promise<{ disconnect: () => void }>}
 */
export async function createHocuspocusYjsProvider({
  documentId,
  ydoc,
  supabase,
  url,
  awareness,
  onUpdateRejected,
  onTransportState,
}) {
  if (!documentId) throw new Error('[HocuspocusYjsProvider] documentId required');
  if (!ydoc) throw new Error('[HocuspocusYjsProvider] ydoc required (borrow from ydocRegistry)');
  if (!supabase) throw new Error('[HocuspocusYjsProvider] supabase client required (for token thunk)');

  // Dynamic import so a missing @hocuspocus/provider package surfaces as a clear
  // runtime error rather than a build break. The default-path spike (Supabase)
  // never imports this file, so the package can stay uninstalled by default.
  // UX: operators reading this error get a single actionable instruction, not a stack trace.
  let HocuspocusProvider;
  try {
    const mod = await import('@hocuspocus/provider');
    HocuspocusProvider = mod.HocuspocusProvider;
  } catch {
    throw new Error(
      '@hocuspocus/provider not installed — Phase 28 conditional package.json waiver ' +
        'gated on spike outcome (Plan 28-04). Install via `npm install @hocuspocus/provider@^2.13.6` ' +
        'ONLY if Hocuspocus wins the spike.'
    );
  }

  // Resolve WS URL: explicit arg > Vite env var > localhost fallback.
  // UX: localhost fallback lets a developer run the spike with a locally-spawned
  // @hocuspocus/server during the bake-off without configuring env vars first.
  const wsUrl =
    url ||
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_HOCUSPOCUS_URL : null) ||
    'wss://localhost:1234';

  const provider = new HocuspocusProvider({
    url: wsUrl,
    name: documentId,
    // Hocuspocus binds the EXISTING Y.Doc; it never replaces it. This is the
    // applyUpdate-only invariant equivalent for the fallback path. We pass our
    // borrowed Y.Doc directly — Hocuspocus reads the state vector, syncs, and
    // applies remote updates internally via Y.applyUpdate.
    document: ydoc,
    // Optional awareness — Phase 33 wires this up; in the spike we leave it undefined
    // unless the caller passes one.
    awareness,
    // Token thunk — Hocuspocus calls this on every reconnect attempt.
    // UX: fresh JWT every reconnect → Pitfall 1 defense (no stale-token channel freeze).
    // The thunk is the contract the test harness verifies; we MUST NOT cache the token.
    token: async () => {
      try {
        const session = await getSupabaseSession('HocuspocusYjsProvider.token');
        return session?.access_token || null;
      } catch {
        // Returning null here lets Hocuspocus's onAuthenticationFailed surface the failure
        // through onUpdateRejected; the user gets a banner, not a silent freeze.
        return null;
      }
    },
    onStatus: ({ status }) => {
      // Status values per Hocuspocus: 'connected' | 'connecting' | 'disconnected'
      // UX: 'connected' surfaces as 'online' so Plan 28-06's banner host can hide the
      // transport-offline banner; 'disconnected' triggers the banner. 'connecting' is
      // intentionally silent — we don't flicker the UI during transient reconnects.
      if (status === 'connected') onTransportState?.('online');
      if (status === 'disconnected') onTransportState?.('offline');
    },
    onAuthenticationFailed: ({ reason }) => {
      // Server's onAuthenticate hook rejected — surface as update_rejected so
      // Plan 28-06's banner UX is consistent with the Supabase-path RLS-violation flow.
      // UX: the user sees a kicked-out banner with the explicit reason; mirrors the
      // Phase 27 storage-failure banner shape (sticky top, role=alert, dismiss button).
      onUpdateRejected?.(reason || 'authentication_failed');
    },
  });

  return {
    disconnect() {
      // Idempotent teardown — provider.destroy() unsubscribes the Hocuspocus internals,
      // closes the websocket, and detaches the Y.Doc observer. Swallow errors so a
      // double-disconnect (e.g. unmount race) never throws.
      try {
        provider.destroy();
      } catch {
        /* swallow */
      }
    },
  };
}
