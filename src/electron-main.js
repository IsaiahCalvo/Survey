// electron-main.js
// electron-main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

console.log('Starting Electron Main Process...');

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

// File watchers storage
const fileWatchers = new Map();
let chokidar = null;

// Dynamically import chokidar (ES module)
(async () => {
  try {
    chokidar = await import('chokidar');
    console.log('Chokidar loaded successfully');
  } catch (err) {
    console.error('Failed to load chokidar:', err);
  }
})();

console.log('Registering IPC handlers...');

ipcMain.handle('dialog:openFile', async (event, options = {}) => {
  console.log('IPC: dialog:openFile invoked', options);
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: options.title || 'Open File',
    defaultPath: options.defaultPath,
    filters: options.filters || [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile']
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = filePaths[0];

  try {
    // Read the file and return both the data and the path
    const data = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    return {
      canceled: false,
      filePath,
      fileName,
      fileSize: stats.size,
      data: Array.from(data) // Convert Buffer to array for IPC
    };
  } catch (error) {
    console.error('Failed to read file:', error);
    throw error;
  }
});

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

ipcMain.handle('shell:openExternal', async (event, url) => {
  return await shell.openExternal(url);
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

ipcMain.handle('fs:fileExists', async (event, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
});

// Atomic file write - ensures crash-safe saves by writing to temp file first
ipcMain.handle('fs:writeFileAtomic', async (event, { path: filePath, data }) => {
  const tempPath = filePath + '.tmp';
  const backupPath = filePath + '.bak';

  try {
    // 1. Write to temp file first
    fs.writeFileSync(tempPath, Buffer.from(data));

    // 2. Create backup of original (if exists)
    if (fs.existsSync(filePath)) {
      // Remove old backup if exists
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      fs.renameSync(filePath, backupPath);
    }

    // 3. Rename temp to final (atomic on most filesystems)
    fs.renameSync(tempPath, filePath);

    // 4. Remove backup on success
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    return { success: true };
  } catch (error) {
    console.error('Atomic write failed:', error);

    // Attempt recovery: if backup exists but final doesn't, restore backup
    if (fs.existsSync(backupPath) && !fs.existsSync(filePath)) {
      try {
        fs.renameSync(backupPath, filePath);
        console.log('Recovered from backup after failed write');
      } catch (recoveryError) {
        console.error('Recovery from backup also failed:', recoveryError);
      }
    }

    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
});

// File watcher handlers
ipcMain.handle('fileWatcher:start', async (event, { filePath, watchId }) => {
  try {
    if (!chokidar) {
      throw new Error('File watcher not initialized');
    }

    // Stop existing watcher if any
    if (fileWatchers.has(watchId)) {
      fileWatchers.get(watchId).close();
    }

    // Create new watcher with debouncing
    const watcher = chokidar.default.watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    // Handle file changes
    watcher.on('change', (path) => {
      event.sender.send('fileWatcher:changed', { watchId, filePath: path, event: 'change' });
    });

    // Handle file deletion
    watcher.on('unlink', (path) => {
      event.sender.send('fileWatcher:changed', { watchId, filePath: path, event: 'unlink' });
    });

    watcher.on('error', (error) => {
      console.error('File watcher error:', error);
      event.sender.send('fileWatcher:error', { watchId, error: error.message });
    });

    fileWatchers.set(watchId, watcher);
    return { success: true };
  } catch (error) {
    console.error('Failed to start file watcher:', error);
    throw error;
  }
});

ipcMain.handle('fileWatcher:stop', async (event, watchId) => {
  try {
    if (fileWatchers.has(watchId)) {
      await fileWatchers.get(watchId).close();
      fileWatchers.delete(watchId);
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to stop file watcher:', error);
    throw error;
  }
});

app.whenReady().then(() => {
  createWindow();
});

app.on('before-quit', () => {
  // Clean up all file watchers
  fileWatchers.forEach((watcher) => {
    watcher.close();
  });
  fileWatchers.clear();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});