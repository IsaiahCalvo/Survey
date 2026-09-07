// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// KAL-411: Electron can deliver one Cmd/Ctrl+Shift+L action through both the
// renderer key handler and the native menu accelerator. Keep the dedupe at the
// shared bridge so every current and future Save Log trigger gets the same
// protection without weakening the crash-resilient keyboard path.
const SAVE_LOG_SNAPSHOT_DEDUPE_MS = 1000;
let saveLogSnapshotInFlight = null;
let lastSaveLogSnapshotResult = null;
let lastSaveLogSnapshotCompletedAt = 0;

function saveLogSnapshotOnce(payload) {
  if (saveLogSnapshotInFlight) return saveLogSnapshotInFlight;

  if (
    lastSaveLogSnapshotCompletedAt > 0
    && Date.now() - lastSaveLogSnapshotCompletedAt < SAVE_LOG_SNAPSHOT_DEDUPE_MS
  ) {
    return Promise.resolve(lastSaveLogSnapshotResult);
  }

  let request;
  try {
    request = Promise.resolve(ipcRenderer.invoke('logs:saveSnapshot', payload));
  } catch (error) {
    request = Promise.reject(error);
  }

  const trackedRequest = request
    .then((result) => {
      lastSaveLogSnapshotResult = result;
      lastSaveLogSnapshotCompletedAt = Date.now();
      return result;
    })
    .finally(() => {
      if (saveLogSnapshotInFlight === trackedRequest) {
        saveLogSnapshotInFlight = null;
      }
    });

  saveLogSnapshotInFlight = trackedRequest;
  return trackedRequest;
}

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, data) => ipcRenderer.invoke('fs:writeFile', { path, data }),
  writeFileAtomic: (path, data) => ipcRenderer.invoke('fs:writeFileAtomic', { path, data }),
  appendFile: (path, data) => ipcRenderer.invoke('fs:appendFile', { path, data }),
  clearDir: (path) => ipcRenderer.invoke('fs:clearDir', path),
  capturePage: () => ipcRenderer.invoke('screenshot:capturePage'),
  fileExists: (path) => ipcRenderer.invoke('fs:fileExists', path),
  getFileStats: (path) => ipcRenderer.invoke('fs:getFileStats', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getHomeDir: () => ipcRenderer.invoke('os:getHomeDir'),
  listDir: (path) => ipcRenderer.invoke('fs:listDir', path),
  trackSurveyAnalytics: (payload) => ipcRenderer.invoke('analytics:track', payload),

  // File watcher APIs
  startFileWatcher: (filePath, watchId) => ipcRenderer.invoke('fileWatcher:start', { filePath, watchId }),
  stopFileWatcher: (watchId) => ipcRenderer.invoke('fileWatcher:stop', watchId),
  onFileChanged: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('fileWatcher:changed', subscription);
    return () => ipcRenderer.removeListener('fileWatcher:changed', subscription);
  },
  onFileWatcherError: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('fileWatcher:error', subscription);
    return () => ipcRenderer.removeListener('fileWatcher:error', subscription);
  },

  // App lifecycle APIs
  onBeforeQuit: (callback) => {
    const subscription = (_event, request) => callback(request);
    ipcRenderer.on('app:beforeQuit', subscription);
    return () => ipcRenderer.removeListener('app:beforeQuit', subscription);
  },
  notifySaveComplete: (result) => ipcRenderer.send('app:saveComplete', result),

  // Menu actions
  onReimportPdfBookmarks: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('menu:reimport-pdf-bookmarks', subscription);
    return () => ipcRenderer.removeListener('menu:reimport-pdf-bookmarks', subscription);
  },
  onPrintPdf: (callback) => {
    const subscription = () => {
      console.log('[preload] menu:print-pdf received, forwarding to renderer');
      callback();
    };
    ipcRenderer.on('menu:print-pdf', subscription);
    return () => ipcRenderer.removeListener('menu:print-pdf', subscription);
  },
  onPrintPdfMarkup: (callback) => {
    const subscription = () => {
      console.log('[preload] menu:print-pdf-markup received, forwarding regular annotation print request to renderer');
      callback();
    };
    ipcRenderer.on('menu:print-pdf-markup', subscription);
    return () => ipcRenderer.removeListener('menu:print-pdf-markup', subscription);
  },
  onSaveLogMenu: (callback) => {
    const subscription = () => {
      console.log('[preload] menu:save-log received, forwarding to renderer');
      callback();
    };
    ipcRenderer.on('menu:save-log', subscription);
    return () => ipcRenderer.removeListener('menu:save-log', subscription);
  },
  onOpenPdfMenu: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('menu:open-pdf', subscription);
    return () => ipcRenderer.removeListener('menu:open-pdf', subscription);
  },
  onExportAnnotatedPdfMenu: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('menu:export-annotated-pdf', subscription);
    return () => ipcRenderer.removeListener('menu:export-annotated-pdf', subscription);
  },

  // UX 2026-04-22: Save Log GitHub push. Returns { ok, url, filename, error }.
  // SECURITY 2026-06-17: the renderer now passes fallbackToken = null — no
  // GitHub write-token is embedded in the client bundle. The main-process
  // handler pushes via the `gh` CLI and returns a graceful error if `gh`
  // isn't installed (it no longer has a token for the REST fallback).
  pushLogToGithub: (content, fallbackToken) =>
    ipcRenderer.invoke('logs:pushToGithub', { content, fallbackToken }),

  // 2026-04-29 — Local snapshot save. Each Cmd+Shift+L additionally writes a
  // dated subfolder under <project>/Logs/ containing console.log, network.json,
  // and summary.json. Caller hands over the captured payload; main does the
  // path math + prune-to-20 cleanup. Returns { ok, dir, error }.
  saveLogSnapshot: saveLogSnapshotOnce,

  // 2026-06-04 — Read the continuous main-process renderer-console log. Main
  // captures every renderer console message from launch through every reload, so
  // this is the robust source of truth for Cmd+Shift+L when the fragile in-page
  // buffer has been reset by a navigation. Returns { ok, text, error? }.
  readContinuousLog: () => ipcRenderer.invoke('logs:readContinuous'),

  // UX 2026-04-23: Custom Print Panel — list installed printers and fire a
  // real print job with the panel's settings. `printJob` forwards the
  // renderer's webContents.print() options (deviceName, copies, duplex, etc.)
  // to the main process, which owns the BrowserWindow handle.
  listPrinters: () => ipcRenderer.invoke('print:list-printers'),
  printJob: (options) => ipcRenderer.invoke('print:job', options),
  // UX 2026-04-24: silent print directly from composed HTML — skips the
  // OS print dialog entirely. Renderer hands over the print HTML and
  // device options; main spins up a hidden window, loads it, prints, and
  // closes. Returns { ok, error }.
  printHtmlSilent: (payload) => ipcRenderer.invoke('print:html-silent', payload),
  printHtmlToPdf: (payload) => ipcRenderer.invoke('print:html-to-pdf', payload),

  // UX 2026-04-22: Auto-updater bridges — lets renderer trigger checks +
  // downloads + installs, and subscribe to progress/state events. No-ops in
  // development (handler returns { ok:false, error:'dev-mode' }).
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdateNow: () => ipcRenderer.invoke('updater:installNow'),
  onUpdaterStatus: (callback) => {
    const subscription = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', subscription);
    return () => ipcRenderer.removeListener('updater:status', subscription);
  },
  onCheckForUpdatesMenu: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('menu:check-for-updates', subscription);
    return () => ipcRenderer.removeListener('menu:check-for-updates', subscription);
  },

  // OAuth APIs - opens a separate window for authentication (LEGACY embedded flow;
  // kept as the fallback while the system-browser flow below rolls out)
  openOAuthWindow: (authUrl, redirectUri) => ipcRenderer.invoke('oauth:openWindow', { authUrl, redirectUri }),

  // Microsoft sign-in via the SYSTEM browser with main-process token custody
  // (msal-node). The renderer only ever receives an access token + account info;
  // refresh tokens never cross this bridge.
  microsoftSignIn: () => ipcRenderer.invoke('msauth:signIn'),
  microsoftGetAccessToken: (options) => ipcRenderer.invoke('msauth:getAccessToken', options || {}),
  microsoftAuthStatus: () => ipcRenderer.invoke('msauth:status'),
  microsoftSignOut: () => ipcRenderer.invoke('msauth:signOut'),

  // 2026-04-26 — Renderer flips the developer-mode gate on/off based on
  // the signed-in user's tier. When ON, the View menu shows Reload +
  // Toggle DevTools and the Cmd+R / Cmd+Shift+I / F12 shortcuts work.
  // When OFF (default for shipped builds), all of those are blocked so
  // the app feels like a clean native install.
  setDeveloperMode: (enabled) => ipcRenderer.invoke('developer-mode:set', enabled),
});
