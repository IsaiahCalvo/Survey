// Single-instance lock for the desktop app so two processes cannot race
// the shared Microsoft token cache (P2-36).

function claimSingleInstance({ requestLock, quit } = {}) {
  if (typeof requestLock !== 'function') {
    return { gotLock: false, quitCalled: false };
  }
  const gotLock = !!requestLock();
  if (!gotLock && typeof quit === 'function') {
    quit();
    return { gotLock: false, quitCalled: true };
  }
  return { gotLock, quitCalled: false };
}

function focusExistingWindow(win) {
  if (!win || win.isDestroyed?.()) return false;
  if (win.isMinimized?.()) win.restore();
  if (typeof win.show === 'function') win.show();
  if (typeof win.focus === 'function') win.focus();
  return true;
}

module.exports = { claimSingleInstance, focusExistingWindow };
