// electron-main.js
// electron-main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');
const https = require('https');

// ============================================
// EXCEL ADD-IN SERVER MANAGEMENT
// ============================================
let addinServerProcess = null;
let addinServerStatus = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'

// Get the add-in directory path
function getAddinPath() {
  // In development, it's a sibling directory
  // In production, it should be bundled with the app
  const devPath = path.join(__dirname, '..', 'survey-excel-addin');
  const prodPath = path.join(app.getAppPath(), 'survey-excel-addin');

  if (fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(prodPath)) return prodPath;
  return null;
}

// Get Excel's wef folder for sideloading (Mac)
function getExcelWefPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Containers', 'com.microsoft.Excel', 'Data', 'Documents', 'wef');
  } else if (process.platform === 'win32') {
    // Windows uses a different mechanism (registry or network share)
    // For now, return null - would need more complex setup
    return null;
  }
  return null;
}

// Sideload the add-in manifest to Excel
async function sideloadAddinManifest() {
  const addinPath = getAddinPath();
  if (!addinPath) {
    console.error('[AddinServer] Add-in directory not found');
    return { success: false, error: 'Add-in directory not found' };
  }

  const manifestSource = path.join(addinPath, 'manifest.xml');
  if (!fs.existsSync(manifestSource)) {
    console.error('[AddinServer] manifest.xml not found');
    return { success: false, error: 'manifest.xml not found' };
  }

  const wefPath = getExcelWefPath();
  if (!wefPath) {
    console.error('[AddinServer] Excel wef path not supported on this platform');
    return { success: false, error: 'Sideloading not supported on this platform' };
  }

  try {
    // Create wef directory if it doesn't exist
    if (!fs.existsSync(wefPath)) {
      fs.mkdirSync(wefPath, { recursive: true });
    }

    // Copy manifest to wef folder
    const manifestDest = path.join(wefPath, 'survey-sync-manifest.xml');
    fs.copyFileSync(manifestSource, manifestDest);
    console.log('[AddinServer] Manifest sideloaded to:', manifestDest);

    return { success: true, manifestPath: manifestDest };
  } catch (error) {
    console.error('[AddinServer] Failed to sideload manifest:', error);
    return { success: false, error: error.message };
  }
}

// Remove sideloaded manifest
async function removeSideloadedManifest() {
  const wefPath = getExcelWefPath();
  if (!wefPath) return { success: true };

  const manifestPath = path.join(wefPath, 'survey-sync-manifest.xml');
  try {
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
      console.log('[AddinServer] Removed sideloaded manifest');
    }
    return { success: true };
  } catch (error) {
    console.error('[AddinServer] Failed to remove manifest:', error);
    return { success: false, error: error.message };
  }
}

// Start the add-in webpack dev server
async function startAddinServer() {
  if (addinServerProcess) {
    console.log('[AddinServer] Server already running');
    return { success: true, status: 'already_running' };
  }

  const addinPath = getAddinPath();
  if (!addinPath) {
    addinServerStatus = 'error';
    return { success: false, error: 'Add-in directory not found' };
  }

  // Check if node_modules exists
  const nodeModulesPath = path.join(addinPath, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('[AddinServer] Installing add-in dependencies...');
    addinServerStatus = 'starting';

    try {
      await new Promise((resolve, reject) => {
        exec('npm install', { cwd: addinPath }, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
    } catch (error) {
      console.error('[AddinServer] Failed to install dependencies:', error);
      addinServerStatus = 'error';
      return { success: false, error: 'Failed to install add-in dependencies' };
    }
  }

  addinServerStatus = 'starting';
  console.log('[AddinServer] Starting webpack dev server...');

  return new Promise((resolve) => {
    // Use npm run dev to start the server
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';

    addinServerProcess = spawn(npmCmd, ['run', 'dev'], {
      cwd: addinPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows
    });

    let startupOutput = '';
    let resolved = false;
    let processExited = false;
    let exitCode = null;

    const checkStarted = (data) => {
      const chunk = data.toString();
      startupOutput += chunk;
      console.log('[AddinServer] Output:', chunk.trim());

      // Check if webpack dev server is ready - multiple patterns
      if (startupOutput.includes('compiled successfully') ||
          startupOutput.includes('webpack compiled') ||
          startupOutput.includes('Loopback:') ||
          startupOutput.includes('localhost:3000')) {
        if (!resolved) {
          resolved = true;
          addinServerStatus = 'running';
          console.log('[AddinServer] Server started successfully');
          resolve({ success: true, status: 'started' });
        }
      }

      // Check for errors
      if (startupOutput.includes('EADDRINUSE') || startupOutput.includes('address already in use')) {
        if (!resolved) {
          resolved = true;
          addinServerStatus = 'error';
          console.error('[AddinServer] Port 3000 is already in use');
          resolve({ success: false, error: 'Port 3000 is already in use. Close any other servers using this port.' });
        }
      }
    };

    addinServerProcess.stdout.on('data', checkStarted);
    addinServerProcess.stderr.on('data', checkStarted);

    addinServerProcess.on('error', (error) => {
      console.error('[AddinServer] Process error:', error);
      addinServerStatus = 'error';
      addinServerProcess = null;
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: error.message });
      }
    });

    addinServerProcess.on('exit', (code) => {
      console.log('[AddinServer] Process exited with code:', code);
      processExited = true;
      exitCode = code;
      if (code !== 0 && !resolved) {
        addinServerStatus = 'error';
        addinServerProcess = null;
        resolved = true;
        resolve({ success: false, error: `Server process exited with code ${code}. Output: ${startupOutput.slice(-500)}` });
      } else if (!resolved) {
        addinServerStatus = 'stopped';
        addinServerProcess = null;
      }
    });

    // Timeout after 45 seconds, but check if server is actually running
    setTimeout(async () => {
      if (!resolved) {
        // Try to check if server is actually responding
        if (addinServerProcess && !processExited) {
          try {
            const checkServer = () => new Promise((resolveCheck) => {
              const req = https.get('https://localhost:3000/taskpane.html', { rejectUnauthorized: false }, (res) => {
                resolveCheck(res.statusCode === 200);
              });
              req.on('error', () => resolveCheck(false));
              req.setTimeout(5000, () => { req.destroy(); resolveCheck(false); });
            });

            const isRunning = await checkServer();
            if (isRunning) {
              resolved = true;
              addinServerStatus = 'running';
              console.log('[AddinServer] Server confirmed running via HTTP check');
              resolve({ success: true, status: 'started', warning: 'Started (confirmed via HTTP)' });
              return;
            }
          } catch (e) {
            console.error('[AddinServer] HTTP check failed:', e);
          }
        }

        resolved = true;
        if (processExited) {
          addinServerStatus = 'error';
          resolve({ success: false, error: `Server exited with code ${exitCode}` });
        } else {
          addinServerStatus = 'error';
          resolve({ success: false, error: 'Server startup timed out. Check if port 3000 is available.' });
        }
      }
    }, 45000);
  });
}

// Stop the add-in server
async function stopAddinServer() {
  if (!addinServerProcess) {
    console.log('[AddinServer] Server not running');
    return { success: true, status: 'not_running' };
  }

  return new Promise((resolve) => {
    console.log('[AddinServer] Stopping server...');

    addinServerProcess.on('exit', () => {
      addinServerProcess = null;
      addinServerStatus = 'stopped';
      console.log('[AddinServer] Server stopped');
      resolve({ success: true, status: 'stopped' });
    });

    // Kill the process
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${addinServerProcess.pid} /T /F`);
    } else {
      addinServerProcess.kill('SIGTERM');
    }

    // Force kill after 5 seconds
    setTimeout(() => {
      if (addinServerProcess) {
        addinServerProcess.kill('SIGKILL');
      }
    }, 5000);
  });
}

// Get add-in server status
function getAddinServerStatus() {
  return {
    status: addinServerStatus,
    isRunning: addinServerProcess !== null,
    addinPath: getAddinPath(),
    wefPath: getExcelWefPath()
  };
}


// Suppress security warnings in development
if (process.env.NODE_ENV === 'development') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

function createWindow() {
  // Set icon path based on platform and environment
  // Use app.getAppPath() to get the actual app directory, which works in both dev and production
  const appPath = app.getAppPath();
  let iconPath;
  
  if (process.platform === 'darwin') {
    // macOS - use .icns if available, otherwise fall back to .png
    const icnsPath = path.join(appPath, 'build', 'icon.icns');
    const pngPath = path.join(appPath, 'build', 'icon.png');
    if (fs.existsSync(icnsPath)) {
      iconPath = icnsPath;
    } else if (fs.existsSync(pngPath)) {
      iconPath = pngPath;
    }
  } else if (process.platform === 'win32') {
    // Windows - use .ico if available, otherwise .png
    const icoPath = path.join(appPath, 'build', 'icon.ico');
    const pngPath = path.join(appPath, 'build', 'icon.png');
    if (fs.existsSync(icoPath)) {
      iconPath = icoPath;
    } else if (fs.existsSync(pngPath)) {
      iconPath = pngPath;
    }
  } else {
    // Linux - use .png
    iconPath = path.join(appPath, 'build', 'icon.png');
  }

  if (!iconPath || !fs.existsSync(iconPath)) {
  }

  // Preload path - in production, __dirname is app.asar/src, so preload.js is in the same directory
  // In development, __dirname is the src directory
  const preloadPath = path.join(__dirname, 'preload.js');
  
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      webSecurity: true, // Keep web security enabled for OAuth
    },
  });

  // Handle OAuth redirects - Supabase redirects back to the app
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      
      // Check if this is an OAuth callback (contains hash with access_token or code)
      if (parsedUrl.hash && (parsedUrl.hash.includes('access_token') || parsedUrl.hash.includes('code') || parsedUrl.hash.includes('error'))) {
        event.preventDefault();
        
        // Reload the app to process the OAuth token
        if (process.env.NODE_ENV === 'development') {
          win.loadURL('http://localhost:5173' + parsedUrl.hash);
        } else {
          const distPath = path.join(app.getAppPath(), 'dist', 'index.html');
          win.loadFile(distPath).then(() => {
            // Wait for the page to load, then inject the hash
            win.webContents.once('did-finish-load', () => {
              const hash = parsedUrl.hash.replace(/"/g, '\\"'); // Escape quotes
              win.webContents.executeJavaScript(`window.location.hash = "${hash}";`).catch(err => {
                console.error('Error setting OAuth hash:', err);
              });
            });
          }).catch(err => {
            console.error('Error loading OAuth callback:', err);
          });
        }
      }
    } catch (err) {
      // If URL parsing fails, allow navigation (might be a relative path)
      console.warn('Navigation URL parse error:', err);
    }
  });

  // Handle navigation errors to prevent blank screens
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Navigation failed:', errorCode, errorDescription, validatedURL);
    // If it's a network error and we're in production, reload the app
    if (errorCode === -106 && process.env.NODE_ENV !== 'development') {
      const distPath = path.join(app.getAppPath(), 'dist', 'index.html');
      win.loadFile(distPath).catch(err => {
        console.error('Failed to reload app after navigation error:', err);
      });
    }
  });

  // Also handle external links (like OAuth providers)
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Allow OAuth URLs and blank windows (MSAL opens about:blank first, then navigates)
    if (url === 'about:blank' ||
        url.includes('oauth') ||
        url.includes('google') ||
        url.includes('supabase') ||
        url.includes('microsoft') ||
        url.includes('login.microsoftonline.com') ||
        url.includes('login.live.com')) {
      return { action: 'allow' };
    }
    // Open other external links in the default browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.NODE_ENV === 'development') {
    // Try port 5173 first, then 5174 if that fails
    const tryLoadDev = async () => {
      try {
        await win.loadURL('http://localhost:5173');
      } catch (err) {
        try {
          await win.loadURL('http://localhost:5174');
        } catch (err2) {
          console.error('Could not connect to dev server on either port');
          win.loadURL('http://localhost:5173'); // Fallback
        }
      }
    };
    tryLoadDev();
  } else {
    // In production, __dirname is app.asar/src, so we need to go up one level to app.asar
    // then into dist. Use app.getAppPath() which gives us the app.asar directory
    const distPath = path.join(app.getAppPath(), 'dist', 'index.html');
    win.loadFile(distPath);
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


ipcMain.handle('dialog:openFile', async (event, options = {}) => {
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

ipcMain.handle('shell:openPath', async (event, filePath) => {
  // On macOS, use the native 'open' command which works more reliably than shell.openPath
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      // Use 'open' command which is what Finder uses when you double-click
      // The -a flag specifies the application, -W waits for the app to open
      const escapedPath = filePath.replace(/"/g, '\\"');
      exec(`open "${escapedPath}"`, (error, stdout, stderr) => {
        if (error) {
          console.error('Failed to open file with open command:', error);
          resolve(error.message);
        } else {
          resolve('');
        }
      });
    });
  }

  // On other platforms, use the standard shell.openPath
  return await shell.openPath(filePath);
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  return await shell.openExternal(url);
});

// ============================================
// EXCEL ADD-IN IPC HANDLERS
// ============================================

ipcMain.handle('addin:startServer', async () => {
  return await startAddinServer();
});

ipcMain.handle('addin:stopServer', async () => {
  return await stopAddinServer();
});

ipcMain.handle('addin:getStatus', () => {
  return getAddinServerStatus();
});

ipcMain.handle('addin:sideload', async () => {
  return await sideloadAddinManifest();
});

ipcMain.handle('addin:removeSideload', async () => {
  return await removeSideloadedManifest();
});

// Install SSL certificates for Office.js add-in (requires npx office-addin-dev-certs)
async function installAddinCertificates() {
  const addinPath = getAddinPath();
  if (!addinPath) {
    return { success: false, error: 'Add-in directory not found' };
  }

  return new Promise((resolve) => {
    console.log('[AddinServer] Installing SSL certificates...');

    // Use npx to run office-addin-dev-certs install
    exec('npx office-addin-dev-certs install --days 365', { cwd: addinPath }, (error, stdout, stderr) => {
      if (error) {
        // Check if certs are already installed
        if (stderr.includes('already') || stdout.includes('already')) {
          console.log('[AddinServer] SSL certificates already installed');
          resolve({ success: true, alreadyInstalled: true });
        } else {
          console.error('[AddinServer] Failed to install certificates:', error);
          resolve({ success: false, error: error.message });
        }
      } else {
        console.log('[AddinServer] SSL certificates installed successfully');
        resolve({ success: true });
      }
    });
  });
}

// Check if SSL certificates are installed
ipcMain.handle('addin:checkCerts', async () => {
  const addinPath = getAddinPath();
  if (!addinPath) {
    return { installed: false, error: 'Add-in directory not found' };
  }

  return new Promise((resolve) => {
    exec('npx office-addin-dev-certs verify', { cwd: addinPath }, (error, stdout, stderr) => {
      const installed = !error && !stderr.includes('not installed');
      resolve({ installed, output: stdout || stderr });
    });
  });
});

// Install SSL certificates
ipcMain.handle('addin:installCerts', async () => {
  return await installAddinCertificates();
});

// Start add-in server and sideload manifest (combined operation)
ipcMain.handle('addin:enable', async () => {
  console.log('[AddinServer] Enabling add-in...');

  // First, check/install SSL certificates
  const certResult = await installAddinCertificates();
  if (!certResult.success && !certResult.alreadyInstalled) {
    console.warn('[AddinServer] Certificate installation warning:', certResult.error);
    // Continue anyway - certs might work
  }

  // Second, sideload the manifest
  const sideloadResult = await sideloadAddinManifest();
  if (!sideloadResult.success) {
    return { success: false, error: 'Failed to sideload: ' + sideloadResult.error };
  }

  // Then start the server
  const serverResult = await startAddinServer();
  if (!serverResult.success) {
    return { success: false, error: 'Failed to start server: ' + serverResult.error };
  }

  return {
    success: true,
    message: 'Add-in enabled. Restart Excel to see the Survey Sync button in the Home ribbon.',
    manifestPath: sideloadResult.manifestPath,
    certStatus: certResult.success ? 'installed' : 'warning'
  };
});

// Stop add-in server and remove manifest (combined operation)
ipcMain.handle('addin:disable', async () => {
  console.log('[AddinServer] Disabling add-in...');

  await stopAddinServer();
  await removeSideloadedManifest();

  return { success: true, message: 'Add-in disabled' };
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

ipcMain.handle('os:getHomeDir', async () => {
  const os = require('os');
  return os.homedir();
});

ipcMain.handle('fs:listDir', async (event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    return fs.readdirSync(dirPath);
  } catch (error) {
    console.error('Failed to list directory:', error);
    return [];
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

// OAuth window handler for Microsoft authentication
// Opens a separate window for OAuth flow, captures the redirect, and returns the result
ipcMain.handle('oauth:openWindow', async (event, { authUrl, redirectUri }) => {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      // Make it a child of the main window
      parent: BrowserWindow.fromWebContents(event.sender),
      modal: false,
      title: 'Sign in to Microsoft',
    });

    // Remove menu bar from auth window
    authWindow.setMenuBarVisibility(false);

    // Track if we've already resolved (to prevent double resolution)
    let resolved = false;

    // Listen for navigation to the redirect URI
    const handleNavigation = (url) => {
      if (resolved) return;

      // Check if this is the redirect URL
      if (url.startsWith(redirectUri)) {
        resolved = true;

        // Extract the hash or query parameters
        const urlObj = new URL(url);
        const hash = urlObj.hash;
        const search = urlObj.search;

        // Close the auth window
        authWindow.close();

        // Return the full redirect URL so MSAL can parse it
        resolve({ success: true, url: url });
      }
    };

    // Listen for URL changes
    authWindow.webContents.on('will-navigate', (e, url) => {
      handleNavigation(url);
    });

    authWindow.webContents.on('will-redirect', (e, url) => {
      handleNavigation(url);
    });

    // Also check after page loads (for hash-based redirects)
    authWindow.webContents.on('did-navigate', (e, url) => {
      handleNavigation(url);
    });

    authWindow.webContents.on('did-navigate-in-page', (e, url) => {
      handleNavigation(url);
    });

    // Handle window close (user cancelled)
    authWindow.on('closed', () => {
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: 'User cancelled authentication' });
      }
    });

    // Handle load errors
    authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      // Ignore aborted loads (happens during redirects)
      if (errorCode === -3) return;

      if (!resolved) {
        resolved = true;
        authWindow.close();
        resolve({ success: false, error: `Failed to load: ${errorDescription}` });
      }
    });

    // Load the auth URL
    authWindow.loadURL(authUrl);
  });
});

// Track if we're in the process of quitting
let isQuitting = false;

app.whenReady().then(() => {
  createWindow();
});

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;

    // Notify all windows to save their work
    const windows = BrowserWindow.getAllWindows();

    if (windows.length === 0) {
      app.quit();
      return;
    }

    // Send save request to all windows
    let windowsResponded = 0;
    const checkAndQuit = () => {
      windowsResponded++;
      if (windowsResponded >= windows.length) {
        // All windows have responded, now quit
        setTimeout(async () => {
          // Clean up file watchers
          fileWatchers.forEach((watcher) => {
            watcher.close();
          });
          fileWatchers.clear();

          // Stop add-in server if running
          if (addinServerProcess) {
            console.log('[AddinServer] Stopping server on quit...');
            await stopAddinServer();
          }

          app.quit();
        }, 100);
      }
    };

    windows.forEach((win) => {
      if (win.isDestroyed()) {
        checkAndQuit();
        return;
      }

      // Send message to renderer to save
      win.webContents.send('app:beforeQuit');

      // Give each window 5 seconds to save, then continue
      setTimeout(checkAndQuit, 5000);
    });
  }
});

// Handle save completion from renderer
ipcMain.on('app:saveComplete', () => {
  // This is just for logging, actual quit happens via timeout
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});