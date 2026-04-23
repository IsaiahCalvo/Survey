// preload.js
const { contextBridge, ipcRenderer } = require('electron');

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
    const subscription = () => callback();
    ipcRenderer.on('app:beforeQuit', subscription);
    return () => ipcRenderer.removeListener('app:beforeQuit', subscription);
  },
  notifySaveComplete: () => ipcRenderer.send('app:saveComplete'),

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
  pushLogToGithub: (content) => ipcRenderer.invoke('logs:pushToGithub', { content }),

  // UX 2026-04-23: Custom Print Panel — list installed printers and fire a
  // real print job with the panel's settings. `printJob` forwards the
  // renderer's webContents.print() options (deviceName, copies, duplex, etc.)
  // to the main process, which owns the BrowserWindow handle.
  listPrinters: () => ipcRenderer.invoke('print:list-printers'),
  printJob: (options) => ipcRenderer.invoke('print:job', options),

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

  // OAuth APIs - opens a separate window for authentication
  openOAuthWindow: (authUrl, redirectUri) => ipcRenderer.invoke('oauth:openWindow', { authUrl, redirectUri }),
});
