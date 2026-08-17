// src/lib/collab/deviceId.js
// Phase 28 — Device id derivation. AUTH-02 data path.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md Pitfall 7
//
// UX rationale: device label appears in activity log + Tags context menu (Phase 33).
// Defaults to OS hostname so users recognize "Isaiahs-MacBook-Pro" without configuring.
// AUTH-06 (Phase 33) lets users rename device labels freely; this module owns the
// id (stable random string), not the display label.
//
// Tier 1 (Electron): window.electronAPI.osHostname() — IPC from main process
// Tier 2 (web, modern): localStorage['device_id'] — stable per-browser-install id
// Tier 3 (web, first visit): generate UUID v4, store in localStorage, return
// Tier 4 (SSR / Node test env): return 'unknown-device' (no throw)
//
// Cache-clear handling: clearing localStorage produces a new device id. Acknowledged
// degradation — AUTH-06 lets users rename device labels freely so ephemeral ids do not
// pollute the activity log permanently.
//
// Per-window cache: we use a WeakMap keyed off the window object so Plan 28-01 unit
// tests can swap globalThis.window between test cases without any explicit reset call.
// In production this still amounts to "memoize once per page load" because there is
// only ever one window. The SSR slot is a separate module-level slot because there is
// no window object to key off of.

// UX comment: 'unknown-device' is the literal SSR/Node fallback string. Activity log
// rows tagged 'unknown-device' indicate either a server-side write (Phase 33 trigger)
// or a non-browser context. Picked over throwing because the calling code path
// (boot-time imports) must not crash the whole client just because a SSR pre-render
// or a Node test happens to import this module.
const SSR_FALLBACK_ID = 'unknown-device';

// UX comment: 'device_id' is the localStorage key for the web fallback. Stable across
// page loads + browser restarts; cleared by manual privacy actions (private browsing,
// "Clear site data", localStorage purges). New id generates silently — Phase 33 lets
// users rename the label after the fact.
const LOCAL_STORAGE_KEY = 'device_id';

// Per-window memoization. WeakMap so test windows GC cleanly when withMockWindow
// drops the reference. In production there is only one window, so this is effectively
// a singleton; in tests, swapping globalThis.window resets the cache automatically.
const perWindowCache = new WeakMap();

// UX comment: SSR fallback memoized separately because there is no object key to use.
// The string 'unknown-device' is constant anyway, so the "memoization" is purely
// hygienic — it ensures the test "stable across calls" assertion holds for SSR too.
let ssrCache = null;

function generateUUIDv4() {
  // crypto.randomUUID() preferred (modern browsers + Node 19+).
  // The fallback below is RFC 4122 v4 in pure JS — covers ancient browsers and any
  // hardened test env where the global crypto is sandboxed off.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Resolve the device id for this client.
 *
 * Tier 1 → Tier 2 → Tier 3 → Tier 4 fallback chain. See module header.
 *
 * Stable within a single page load: subsequent calls return the same id without
 * re-running the resolution chain (per-window cache). Tests reset the cache by
 * swapping globalThis.window.
 *
 * @returns {string} the resolved device id
 */
export function getDeviceId() {
  // Tier 4 first: SSR / non-browser context. typeof window is the standard SSR check.
  if (typeof window === 'undefined') {
    if (ssrCache === null) ssrCache = SSR_FALLBACK_ID;
    return ssrCache;
  }

  // Per-window cache hit?
  const cached = perWindowCache.get(window);
  if (typeof cached === 'string') return cached;

  // Tier 1: Electron — main-process os.hostname() exposed via preload IPC.
  // window.electronAPI is the conventional preload bridge name in this project.
  const electronHostname = window.electronAPI?.osHostname?.();
  if (typeof electronHostname === 'string' && electronHostname.length > 0) {
    perWindowCache.set(window, electronHostname);
    return electronHostname;
  }

  // Tier 2 + 3: web — localStorage stable id, generate-and-persist on first visit.
  try {
    const ls = window.localStorage;
    if (ls && typeof ls.getItem === 'function') {
      const stored = ls.getItem(LOCAL_STORAGE_KEY);
      if (typeof stored === 'string' && stored.length > 0) {
        perWindowCache.set(window, stored);
        return stored;
      }
      // Tier 3: first visit — generate, persist, return.
      const fresh = generateUUIDv4();
      try {
        ls.setItem(LOCAL_STORAGE_KEY, fresh);
      } catch {
        // setItem may throw under quota / private-browsing constraints — keep the
        // generated id ephemeral for this session rather than crashing the boot path.
      }
      perWindowCache.set(window, fresh);
      return fresh;
    }
  } catch {
    // localStorage access itself may throw under strict privacy modes (e.g., Safari
    // ITP, sandboxed iframes). Fall through to an ephemeral id so the rest of the
    // app keeps working — no app should die for lack of a device label.
  }

  // Last resort: ephemeral id. Stable for this session via the per-window cache,
  // but not across reloads. AUTH-06 (Phase 33) lets users rename anyway.
  const ephemeral = `ephemeral-${generateUUIDv4()}`;
  perWindowCache.set(window, ephemeral);
  return ephemeral;
}

