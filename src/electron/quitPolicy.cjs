// Electron quit / single-instance policy. CJS so electron-main can require it
// and Node tests can import via createRequire.

function shouldPreventFirstQuit(isQuitting) {
  return !isQuitting;
}

function shouldQuitWhenLastWindowCloses(platform) {
  return platform !== 'darwin';
}

function focusExistingMainWindow(win) {
  if (!win) return false;
  if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return false;
  if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
  if (typeof win.show === 'function') win.show();
  if (typeof win.focus === 'function') win.focus();
  return true;
}

module.exports = {
  shouldPreventFirstQuit,
  shouldQuitWhenLastWindowCloses,
  focusExistingMainWindow,
};
