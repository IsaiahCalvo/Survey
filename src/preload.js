// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, data) => ipcRenderer.invoke('fs:writeFile', { path, data }),
  writeFileAtomic: (path, data) => ipcRenderer.invoke('fs:writeFileAtomic', { path, data }),
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

  // OAuth APIs - opens a separate window for authentication
  openOAuthWindow: (authUrl, redirectUri) => ipcRenderer.invoke('oauth:openWindow', { authUrl, redirectUri }),
});
