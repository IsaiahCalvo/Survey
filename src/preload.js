// preload.js
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // safe stubs for future IPC calls (signing, file save dialogs, etc.)
});