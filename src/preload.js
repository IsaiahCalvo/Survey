// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, data) => ipcRenderer.invoke('fs:writeFile', { path, data }),
  fileExists: (path) => ipcRenderer.invoke('fs:fileExists', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

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
  }
});