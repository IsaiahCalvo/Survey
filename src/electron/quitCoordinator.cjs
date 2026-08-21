// Coordinates Electron before-quit with renderer saveComplete.
// Quit as soon as every window reports saveComplete; keep a generous
// fallback so a crashed renderer cannot hang forever (P2-11).

const DEFAULT_FALLBACK_MS = 120000;

function createQuitCoordinator(options = {}) {
  const fallbackMs = Number.isFinite(options.fallbackMs) ? options.fallbackMs : DEFAULT_FALLBACK_MS;
  const schedule = options.schedule || setTimeout;
  const clearSchedule = options.clearSchedule || clearTimeout;
  const onQuit = typeof options.onQuit === 'function' ? options.onQuit : () => {};

  let started = false;
  let committed = false;
  let expected = 0;
  let responded = 0;
  let fallbackTimer = null;

  function commitQuit() {
    if (committed) return { quit: false, alreadyCommitted: true };
    committed = true;
    if (fallbackTimer != null) {
      clearSchedule(fallbackTimer);
      fallbackTimer = null;
    }
    onQuit();
    return { quit: true };
  }

  function beginQuit({ windows = [] } = {}) {
    if (committed) return { preventDefault: false, started: true, committed: true, pending: 0 };
    if (started) return { preventDefault: true, started: true, committed: false, pending: Math.max(0, expected - responded) };

    started = true;
    const live = (windows || []).filter((win) => win && !win.isDestroyed?.());
    expected = live.length;
    responded = 0;

    if (expected === 0) {
      commitQuit();
      return { preventDefault: true, started: true, committed: true, pending: 0 };
    }

    fallbackTimer = schedule(() => {
      fallbackTimer = null;
      commitQuit();
    }, fallbackMs);

    return { preventDefault: true, started: true, committed: false, pending: expected };
  }

  function markSaveComplete() {
    if (!started || committed) return { quit: false, pending: Math.max(0, expected - responded) };
    responded += 1;
    if (responded >= expected) return { ...commitQuit(), pending: 0 };
    return { quit: false, pending: expected - responded };
  }

  function getState() {
    return {
      started,
      committed,
      expected,
      responded,
      pending: Math.max(0, expected - responded),
      fallbackMs,
    };
  }

  return { beginQuit, markSaveComplete, getState, DEFAULT_FALLBACK_MS: fallbackMs };
}

module.exports = { createQuitCoordinator, DEFAULT_FALLBACK_MS };
