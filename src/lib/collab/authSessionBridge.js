// src/lib/collab/authSessionBridge.js
// Phase 28 — Critical auth invariant. THE Pitfall 1 defense.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md Pattern 4
//
// Failure mode this wiring defends against:
//   supabase-js auto-refreshes the JWT every ~55 minutes via auth.onAuthStateChange,
//   BUT Realtime channels created before the refresh continue using the stale token.
//   After expiry the channel disconnects silently and never reconnects with the new token.
//   (Issues: supabase/realtime-js#274, supabase/supabase-js#1732)
//
// The fix: hook the TOKEN_REFRESHED event and forward the new access_token to the
// Realtime client's auth-update method. That single forwarding line is the difference
// between "Linear / Notion / Figma silent refresh" (the user-locked target UX) and
// "channel silently freezes after 1h" (the explicitly-rejected anti-pattern from
// 28-CONTEXT.md).
//
// UX consequence: this wiring makes seamless background token refresh possible. The
// user keeps editing — no chip, no banner, no flicker — across the JWT-expiry boundary.
// Without it, every session crossing ~1h silently breaks the live channel.
//
// Pitfall 1 defense (also): DO NOT add app-level refresh timers. supabase-js owns
// auto-refresh via its own internal timer + onAuthStateChange events. App-level
// timer schedulers (interval / timeout) cause the documented TOKEN_REFRESHED loop bug
// (supabase/supabase-js#2126) where two timers fire near-simultaneously and cascade
// into double-refresh + revoked-grant churn. The Wave 0 scaffold pins this contract
// by replacing the global timer schedulers with counter stubs that must stay at zero.

/**
 * Wire Supabase auth events to the Realtime client.
 *
 * On TOKEN_REFRESHED: forward the new access_token to the Realtime client's
 * setAuth method so the existing channel keeps using a valid JWT.
 * On SIGNED_OUT: surface the event to the
 * caller (typically Plan 28-06's <ReSignInModal> / banner UX). All other auth events
 * (INITIAL_SESSION, SIGNED_IN, USER_UPDATED, PASSWORD_RECOVERY) are intentionally
 * ignored for token forwarding — the Realtime client picks up the initial token from the supabase client
 * on first channel.subscribe(), and the rest don't change the JWT.
 * When expectedUserId is supplied, every auth event checks actor identity first.
 *
 * @param {object} options
 * @param {object} options.supabase    - the Supabase client instance (must expose auth + realtime)
 * @param {() => void} [options.onSignedOut] - called when the session ends (refresh failed / revoked / signed out)
 * @param {string} [options.expectedUserId] - bind this bridge to one actor; a change retires it permanently
 * @param {Function} [options.onActorChanged] - called after pending work has been aborted
 * @param {Function} [options.onError] - receives token-forwarding or callback failures
 * @returns {{ detach: () => void, isCurrentActor: () => boolean, signal: AbortSignal }}
 */
export function attachAuthSessionBridge({ supabase, onSignedOut, expectedUserId, onActorChanged, onError } = {}) {
  if (!supabase?.auth?.onAuthStateChange) {
    throw new Error('[authSessionBridge] supabase.auth.onAuthStateChange unavailable');
  }
  if (!supabase?.realtime?.setAuth) {
    throw new Error('[authSessionBridge] realtime client setAuth method unavailable');
  }
  const actorBound = expectedUserId !== undefined;
  if (actorBound && (typeof expectedUserId !== 'string' || !expectedUserId.trim())) {
    throw new Error('[authSessionBridge] expectedUserId must be a non-empty string');
  }
  const controller = new AbortController();
  let detached = false;
  let retired = false;
  const reportError = (error) => {
    try {
      if (typeof onError === 'function') onError(error);
      else console.warn('[authSessionBridge] Auth bridge operation failed');
    } catch { /* a reporting callback must not break the shared auth client */ }
  };
  const notify = (callback, ...args) => {
    try { callback?.(...args); } catch (error) { reportError(error); }
  };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (detached || retired) return;
    const userId = session?.user?.id ?? null;
    if (actorBound && (event === 'SIGNED_OUT' || userId !== expectedUserId)) {
      // Seal this exact generation before callbacks can schedule more work. Never
      // disconnect the shared client here: another actor may already be using it.
      retired = true;
      controller.abort();
      notify(onActorChanged, { previousUserId: expectedUserId, userId, event });
      if (event === 'SIGNED_OUT') notify(onSignedOut);
      return;
    }
    if (event === 'TOKEN_REFRESHED' && session?.access_token) {
      // UX comment: this is THE Pitfall 1 defense line. Without it the Realtime
      // channel keeps the pre-refresh JWT and silently freezes at expiry. With it
      // the channel keeps flowing edits through the refresh boundary invisibly —
      // matching Linear / Notion / Figma silent-refresh behavior.
      try {
        Promise.resolve(supabase.realtime.setAuth(session.access_token)).catch((error) => {
          if (!detached && !retired) reportError(error);
        });
      } catch (error) { reportError(error); }
    } else if (event === 'SIGNED_OUT') {
      // UX comment: refresh failed or session was explicitly ended (password change
      // elsewhere, account locked, refresh token revoked, manual sign out). Surface
      // to caller — typically triggers the inline re-sign-in modal on the document
      // page (Plan 28-06) so the user stays on the same page after re-auth instead
      // of being bounced back to the login screen ("don't make them lose their place"
      // — user decision in 28-CONTEXT.md).
      notify(onSignedOut);
    }
    // INITIAL_SESSION + SIGNED_IN intentionally not handled here:
    // the Realtime client picks up the session.access_token from the supabase client
    // on first channel.subscribe(). Only mid-session refreshes need explicit setAuth.
  });

  return {
    isCurrentActor: () => !detached && !retired,
    signal: controller.signal,
    detach() {
      if (detached) return;
      detached = true;
      controller.abort();
      // unsubscribe is on data.subscription per supabase-js v2.x API
      try {
        data?.subscription?.unsubscribe?.();
      } catch {
        // swallow — detach is idempotent and best-effort
      }
    },
  };
}
