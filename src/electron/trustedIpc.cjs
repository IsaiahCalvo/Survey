// src/electron/trustedIpc.cjs
//
// Only the Survey app window may use the desktop's privileged IPC (KAL-369,
// "restrict privileged app requests to the real app window").
//
// The preload exposes file, shell, print, dialog, log and Microsoft sign-in
// calls to whatever page is loaded in the main window. If that window is ever
// navigated to another page (an OAuth provider, a link that slipped past
// will-navigate) or an iframe is injected, that page gets the same calls.
// analytics:track already refused such senders; this applies the same test to
// every handler.
//
// createTrustedIpcMain(ipcMain, isTrustedEvent) returns an object with the
// ipcMain methods electron-main.js uses (handle, on, removeHandler). Each
// listener first asks isTrustedEvent(event):
//   * handle(): an untrusted call is rejected with an EPERM error, so the
//     renderer's invoke() promise rejects and the handler never runs;
//   * on(): an untrusted message is dropped.
// isTrustedEvent errors count as "not trusted" (fail closed).

function untrustedSenderError(channel) {
  const error = new Error(`IPC "${channel}" refused: the sender is not the Survey app window`);
  error.code = 'EPERM';
  return error;
}

function senderIsTrusted(isTrustedEvent, event) {
  try {
    return isTrustedEvent(event) === true;
  } catch (_) {
    return false;
  }
}

function createTrustedIpcMain(ipcMain, isTrustedEvent, { logger = console } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('createTrustedIpcMain needs an ipcMain');
  }
  if (typeof isTrustedEvent !== 'function') {
    throw new TypeError('createTrustedIpcMain needs an isTrustedEvent function');
  }
  const warn = (channel, event) => {
    try {
      logger?.warn?.(`[ipc] refused ${channel} from ${String(event?.senderFrame?.url || 'unknown sender')}`);
    } catch (_) { /* logging never blocks the refusal */ }
  };

  return {
    handle(channel, handler) {
      return ipcMain.handle(channel, (event, ...args) => {
        if (!senderIsTrusted(isTrustedEvent, event)) {
          warn(channel, event);
          throw untrustedSenderError(channel);
        }
        return handler(event, ...args);
      });
    },
    on(channel, listener) {
      return ipcMain.on(channel, (event, ...args) => {
        if (!senderIsTrusted(isTrustedEvent, event)) {
          warn(channel, event);
          return undefined;
        }
        return listener(event, ...args);
      });
    },
    removeHandler(channel) {
      return ipcMain.removeHandler?.(channel);
    },
  };
}

module.exports = { createTrustedIpcMain, untrustedSenderError };
