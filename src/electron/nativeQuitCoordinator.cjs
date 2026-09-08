// Owns only the exit handshake. Electron windows and UI stay in electron-main.
function createNativeQuitCoordinator({ send, onReady, onFailure,
  setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 15000 }) {
  let nextAttempt = 0;
  let active = null;
  let completed = null;
  const message = (attempt, window, phase) => ({
    quitAttemptId: attempt.id, generation: window.generation, phase,
  });
  function cancel(reason) {
    if (!active) return;
    const attempt = active;
    active = null;
    clearTimer(attempt.timer);
    for (const window of attempt.windows.values()) {
      try { send(window.id, { ...message(attempt, window, 'cancel'), reason }); } catch { /* renderer may have closed */ }
    }
    onFailure(reason);
  }
  function sendPhase(attempt) {
    for (const window of attempt.windows.values()) {
      if (active !== attempt) return;
      try { send(window.id, message(attempt, window, attempt.phase)); }
      catch { cancel('A document window could not be reached. The app was kept open.'); }
    }
  }
  function finish(attempt) {
    active = null;
    completed = attempt;
    clearTimer(attempt.timer);
    try { onReady(attempt.action); }
    catch {
      completed = null;
      const reason = 'The app could not close safely. It was kept open. Try again.';
      for (const window of attempt.windows.values()) {
        try { send(window.id, { ...message(attempt, window, 'cancel'), reason }); } catch { /* window may be gone */ }
      }
      onFailure(reason);
    }
  }
  return {
    request(participants, action) {
      if (active) return false;
      completed = null;
      const windows = new Map(participants.map((window) => [window.id, { ...window, done: false, heard: false }]));
      const attempt = { id: ++nextAttempt, action, windows, phase: 'prepare', timer: null };
      if (!windows.size) { finish(attempt); return true; }
      active = attempt;
      attempt.timer = setTimer(() => {
        if (active !== attempt) return;
        cancel([...windows.values()].some((window) => !window.heard)
          ? 'A document window did not answer the save check. The app was kept open. Try Save, then close again.'
          : 'Local saves did not finish in time. The app was kept open. Wait for saving to finish, then close again.');
      }, timeoutMs);
      sendPhase(attempt);
      return true;
    },
    report(senderId, result) {
      const attempt = active;
      if (!attempt || result?.quitAttemptId !== attempt.id) return false;
      const window = attempt.windows.get(senderId);
      if (!window || result.generation !== window.generation) return false;
      if (result.phase === 'pending' && attempt.phase === 'prepare') {
        window.heard = true;
        return true;
      }
      if (result.phase !== attempt.phase || window.done) return false;
      window.heard = true;
      if (result.saved !== true) {
        cancel(typeof result.reason === 'string' && result.reason.length <= 500
          ? result.reason : 'A local save could not be confirmed. The app was kept open. Try Save, then close again.');
        return false;
      }
      if (!Array.isArray(result.tabIds) || result.tabIds.length > 10000
        || result.tabIds.some((id) => typeof id !== 'string' || !id)
        || new Set(result.tabIds).size !== result.tabIds.length) {
        cancel('The document save check was incomplete. The app was kept open.');
        return false;
      }
      const tabIds = JSON.stringify(result.tabIds);
      if (attempt.phase === 'confirm' && window.tabIds !== tabIds) {
        cancel('The open documents changed during the save check. The app was kept open.');
        return false;
      }
      window.tabIds = tabIds;
      window.done = true;
      if (![...attempt.windows.values()].every((entry) => entry.done)) return true;
      if (attempt.phase === 'prepare') {
        attempt.phase = 'confirm';
        for (const entry of attempt.windows.values()) entry.done = false;
        sendPhase(attempt);
      } else {
        finish(attempt);
      }
      return true;
    },
    invalidate(senderId) {
      if (active?.windows.has(senderId)) cancel('A document window changed during the save check. The app was kept open.');
    },
    failConfirmedUpdate() {
      if (!completed || completed.action?.kind !== 'update') return false;
      const attempt = completed;
      completed = null;
      const reason = 'The update could not finish. Your local saves were checked and the app was kept open. Try the update again later.';
      for (const window of attempt.windows.values()) {
        try { send(window.id, { ...message(attempt, window, 'cancel'), reason }); } catch { /* window may be gone */ }
      }
      onFailure(reason);
      return true;
    },
    get pending() { return active !== null; },
  };
}
module.exports = { createNativeQuitCoordinator };
