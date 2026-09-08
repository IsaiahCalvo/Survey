// Keep startup recovery independent of the viewer. A missing guard is safe only
// before the first shell mounts, never after a workspace/error-boundary teardown.
export function createPreloadRecovery({ now = Date.now } = {}) {
  const guards = new Set();
  let shellSeen = false;
  const registerGuard = (canReload, onBlocked) => {
    shellSeen = true;
    const guard = { canReload, onBlocked }; guards.add(guard);
    return () => guards.delete(guard);
  };
  const blocked = reason => {
    for (const guard of guards) {
      try { guard.onBlocked?.(reason); } catch { /* A notice cannot authorize reload. */ }
    }
  };
  const install = window => {
    const handler = event => {
      try {
        if (window.navigator?.onLine !== true) { blocked('offline'); return; }
        if (shellSeen && guards.size === 0) return;
        for (const guard of guards) {
          let safe = false;
          try { safe = guard.canReload() === true; } catch { /* Unknown work is unsafe. */ }
          if (!safe) { blocked('open-documents'); return; }
        }
        const time = now();
        if (!Number.isFinite(time)) return;
        const key = '__vite_preload_reloaded_at';
        const raw = window.sessionStorage.getItem(key);
        const last = Number(raw);
        if (raw !== null && Number.isFinite(last) && time - last <= 20_000) return;
        // A failed storage write means we cannot enforce the reload-loop guard.
        window.sessionStorage.setItem(key, String(time));
        event?.preventDefault?.();
        window.location.reload();
      } catch { /* Never turn failed recovery into another boot error. */ }
    };
    window.addEventListener('vite:preloadError', handler);
    return () => window.removeEventListener('vite:preloadError', handler);
  };
  return { registerGuard, install };
}

const recovery = createPreloadRecovery();
export const registerPreloadRecoveryGuard = recovery.registerGuard;
export const installPreloadRecovery = recovery.install;
