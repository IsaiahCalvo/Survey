// electron-main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

// Suppress security warnings in development
if (process.env.NODE_ENV === 'development') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// IPC Handlers
const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');

ipcMain.handle('dialog:saveFile', async (event, { title, defaultPath, filters, data }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title,
    defaultPath,
    filters
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  try {
    // data is expected to be a Buffer or Uint8Array sent from renderer
    fs.writeFileSync(filePath, Buffer.from(data));
    return { canceled: false, filePath };
  } catch (error) {
    console.error('Failed to save file:', error);
    throw error;
  }
});

ipcMain.handle('shell:openPath', async (event, path) => {
  return await shell.openPath(path);
});

ipcMain.handle('fs:readFile', async (event, path) => {
  try {
    const data = fs.readFileSync(path);
    return data; // Returns Buffer
  } catch (error) {
    console.error('Failed to read file:', error);
    throw error;
  }
});

ipcMain.handle('fs:writeFile', async (event, { path, data }) => {
  try {
    fs.writeFileSync(path, Buffer.from(data));
    return { success: true };
  } catch (error) {
    console.error('Failed to write file:', error);
    throw error;
  }
});

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});