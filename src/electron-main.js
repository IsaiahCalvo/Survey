// electron-main.js
// electron-main.js
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');

const DEV_PORT = process.env.DEV_PORT || '5173';

// 2026-06-04 — Continuous main-process renderer console capture.
// The in-page console buffer (window.__consoleLogBuffer in src/main.jsx) lives in
// a single renderer JS realm and is re-created empty on every full page reload
// (engine toggle, sign-out, YDoc banner, ErrorBoundary, chunk re-eval during a
// heavy PDF open). Its sessionStorage rehydrate is debounced and frequently
// loses the just-seen lines when a renderer-initiated location.reload() tears the
// realm down before the persist commits — so Cmd+Shift+L saves an empty log even
// though DevTools (Chromium's own sink) still shows the lines. The Electron main
// process is the ONLY process that sees EVERY renderer console message from
// launch through every reload/realm with no debounce. We append every message to
// one continuous file on disk; main.jsx reads it at capture time and prefers it
// over the fragile in-page buffer. Everything here is fire-and-forget + try/catch
// so logging can never crash main.
const CONTINUOUS_LOG_PATH = path.join(app.getAppPath(), 'Logs', 'renderer-console.continuous.log');
const CONTINUOUS_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB cap
const CONTINUOUS_LOG_KEEP_BYTES = 2 * 1024 * 1024; // truncate down to last ~2MB
let _continuousLogDirReady = false;
function continuousLevelName(level) {
  // Electron numeric levels: 0 verbose, 1 info, 2 warning, 3 error.
  switch (level) {
    case 0: return 'verbose';
    case 1: return 'info';
    case 2: return 'warning';
    case 3: return 'error';
    default: return (typeof level === 'string' && level) ? level : 'info';
  }
}
function appendContinuous(level, message, lineNo, sourceId) {
  try {
    if (!_continuousLogDirReady) {
      try { fs.mkdirSync(path.dirname(CONTINUOUS_LOG_PATH), { recursive: true }); } catch (_e) { /* swallow */ }
      _continuousLogDirReady = true;
    }
    // Opportunistic size cap so the file can't grow unbounded across long sessions.
    try {
      const st = fs.statSync(CONTINUOUS_LOG_PATH);
      if (st && st.size > CONTINUOUS_LOG_MAX_BYTES) {
        const buf = fs.readFileSync(CONTINUOUS_LOG_PATH);
        const sliced = buf.slice(buf.length - CONTINUOUS_LOG_KEEP_BYTES);
        fs.writeFileSync(CONTINUOUS_LOG_PATH, sliced);
      }
    } catch (_e) { /* file may not exist yet, or stat failed — ignore */ }
    const levelName = continuousLevelName(level);
    const src = `${sourceId == null ? '' : sourceId}:${lineNo == null ? '' : lineNo}`;
    const line = `[${new Date().toISOString()}] [${levelName}] ${src} ${message == null ? '' : String(message)}\n`;
    fs.appendFile(CONTINUOUS_LOG_PATH, line, (_err) => { /* fire-and-forget */ });
  } catch (_e) { /* logging must never crash main */ }
}

// Suppress security warnings in development
if (process.env.NODE_ENV === 'development') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

// 2026-04-26 — Developer-mode gate. Default OFF for shipped builds so the
// View menu doesn't expose Reload / Toggle DevTools and the keyboard
// shortcuts (Cmd+R, Cmd+Shift+I, F12) are blocked. The renderer flips this
// ON via IPC after auth detects a developer-tier account, and the menu
// rebuilds. Dev mode (NODE_ENV=development) auto-enables it so local
// development still has full tooling.
let developerMode = process.env.NODE_ENV === 'development';

// UX 2026-04-22: Auto-updater. Checks the Survey repo's GitHub Releases on
// startup; if a newer version is published the user sees an "Update available"
// prompt. Only runs in packaged builds — dev mode skips silently because
// electron-updater can't patch an unbuilt source tree. Uses the publish
// config in package.json, which points at this repo.
let autoUpdater = null;
let updaterManualCheckWindow = null; // tracks window that requested a manual check
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false; // wait for user consent before downloading
  autoUpdater.autoInstallOnAppQuit = true;
} catch (err) {
  console.warn('[updater] electron-updater not available:', err.message);
}

function setupAutoUpdater(win) {
  if (!autoUpdater) return;
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    console.log('[updater] dev/unpackaged build — auto-update skipped');
    return;
  }

  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for updates…');
    send('updater:status', { state: 'checking' });
  });
  autoUpdater.on('update-available', async (info) => {
    console.log('[updater] update available:', info.version);
    send('updater:status', { state: 'available', version: info.version, notes: info.releaseNotes || null });
    // UX 2026-04-22: show a native prompt so the user sees the offer even if
    // no renderer listener is wired up yet. "Install" downloads then installs;
    // "Later" dismisses until next launch / manual check.
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Available',
        message: `A new version (${info.version}) is available.`,
        detail: 'Download and install it now? The app will restart automatically when done.'
      });
      if (response === 0) {
        autoUpdater.downloadUpdate().catch((err) => {
          console.warn('[updater] download failed:', err?.message || err);
        });
      }
    } catch (dErr) {
      console.warn('[updater] dialog failed:', dErr?.message || dErr);
    }
  });
  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] up to date:', info.version);
    send('updater:status', { state: 'up-to-date', version: info.version });
    // Only show a "you're up to date" dialog if the user manually triggered
    // the check (from the menu). Startup auto-checks stay silent.
    if (updaterManualCheckWindow) {
      const manual = updaterManualCheckWindow;
      updaterManualCheckWindow = null;
      try {
        dialog.showMessageBox(manual, {
          type: 'info',
          buttons: ['OK'],
          title: 'Up to Date',
          message: `You're running the latest version (${info.version}).`
        });
      } catch {}
    }
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err?.message || err);
    send('updater:status', { state: 'error', error: err?.message || String(err) });
  });
  autoUpdater.on('download-progress', (p) => {
    send('updater:status', { state: 'downloading', percent: Math.round(p.percent || 0) });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    console.log('[updater] downloaded:', info.version);
    send('updater:status', { state: 'downloaded', version: info.version });
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: `Version ${info.version} is ready to install.`,
        detail: 'Restart the app now to finish installing, or close the app later to apply on next launch.'
      });
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    } catch (dErr) {
      console.warn('[updater] dialog failed:', dErr?.message || dErr);
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[updater] startup check failed:', err?.message || err);
  });
}

ipcMain.handle('updater:check', async () => {
  if (!autoUpdater) return { ok: false, error: 'updater-unavailable' };
  if (!app.isPackaged) return { ok: false, error: 'dev-mode' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r?.updateInfo?.version || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('updater:download', async () => {
  if (!autoUpdater) return { ok: false, error: 'updater-unavailable' };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('updater:installNow', async () => {
  if (!autoUpdater) return { ok: false, error: 'updater-unavailable' };
  try {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// 2026-04-26 — Renderer flips developer mode on/off here based on the
// signed-in user's tier. Developer-tier accounts get Reload, Toggle
// DevTools, and the keyboard shortcuts back; everyone else sees a clean
// shipped-app menu. Local NODE_ENV=development always boots in developer
// mode so day-to-day development stays unaffected.
ipcMain.handle('developer-mode:set', async (_event, enabled) => {
  const next = process.env.NODE_ENV === 'development' ? true : !!enabled;
  if (next === developerMode) return { ok: true, developerMode };
  developerMode = next;
  try { createAppMenu(); } catch (err) {
    console.warn('[developer-mode] menu rebuild failed:', err?.message || err);
  }
  return { ok: true, developerMode };
});

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
      zoomFactor: 1.0,
    },
  });

  // 2026-06-04 — Continuous renderer console capture (the robust logging floor).
  // Fires for the top frame on every renderer console.* call regardless of in-page
  // realm resets, so it survives every reload (engine toggle, sign-out, PDF open
  // chunk re-eval). did-finish-load writes a navigation boundary marker so reloads
  // are visible in the one continuous file rather than silently truncating it.
  try {
    appendContinuous('info', '=== APP LAUNCH ===', 0, 'main');
    win.webContents.on('console-message', (_event, level, message, lineNo, sourceId) => {
      appendContinuous(level, message, lineNo, sourceId);
    });
    win.webContents.on('did-finish-load', () => {
      try {
        appendContinuous('info', `=== did-finish-load (navigation) ${win.webContents.getURL()} ===`, 0, 'main');
      } catch (_e) { /* swallow */ }
    });
  } catch (_e) { /* never let logging wiring block window creation */ }

  // Intercept Ctrl/Cmd+Plus/Minus/0 — prevent Electron UI zoom, forward to in-app PDF zoom
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && (input.key === '+' || input.key === '-' || input.key === '=' || input.key === '0')) {
      event.preventDefault();
      // Forward zoom intent to renderer via custom DOM event
      const direction = (input.key === '+' || input.key === '=') ? 'in' : (input.key === '-' ? 'out' : 'reset');
      win.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('pdf-zoom', { detail: { direction: '${direction}' } }))`
      ).catch(() => {});
    }
    // 2026-04-26 — Block developer keyboard shortcuts unless developer
    // mode is on. Cmd/Ctrl+R reloads the app, Cmd/Ctrl+Shift+R force
    // reloads, Cmd+Alt+I or Ctrl+Shift+I opens DevTools, F12 toggles
    // DevTools. These are appropriate for developer-tier accounts and
    // local dev mode but should NOT be available to free / Pro /
    // Enterprise users — the app should feel like a shipped native app.
    if (!developerMode) {
      const key = (input.key || '').toLowerCase();
      const mod = input.control || input.meta;
      const isReload = mod && key === 'r';
      const isInspect = mod && input.shift && (key === 'i' || key === 'j' || key === 'c');
      const isMacInspect = input.meta && input.alt && key === 'i';
      const isF12 = key === 'f12';
      if (isReload || isInspect || isMacInspect || isF12) {
        event.preventDefault();
      }
    }
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
          win.loadURL(`http://localhost:${DEV_PORT}` + parsedUrl.hash);
        } else {
          const distPath = path.join(app.getAppPath(), 'dist', 'index.html');
          win.loadFile(distPath).then(() => {
            // Wait for the page to load, then inject the hash
            win.webContents.once('did-finish-load', () => {
              win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(parsedUrl.hash)};`).catch(err => {
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
    win.loadURL(`http://localhost:${DEV_PORT}`);
  } else {
    // In production, __dirname is app.asar/src, so we need to go up one level to app.asar
    // then into dist. Use app.getAppPath() which gives us the app.asar directory
    const distPath = path.join(app.getAppPath(), 'dist', 'index.html');
    win.loadFile(distPath);
  }

  // UX 2026-04-22: wire auto-updater now that the window exists, so the
  // "update available" toast can reach the renderer. No-op in dev mode.
  setupAutoUpdater(win);
}

function createAppMenu() {
  const isMac = process.platform === 'darwin';

  const getTargetWindow = () => {
    return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  };

  // UX 2026-04-22: Shared handlers so Mac's app-name menu AND the Help menu
  // (which exists on both Mac and Windows) stay in sync. Users asked for a
  // single Help menu so Windows can reach Check for Updates / About — Mac
  // still exposes the same items in its native Help submenu too.
  const triggerCheckForUpdates = async () => {
    const win = getTargetWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('menu:check-for-updates');
    }
    if (!autoUpdater) return;
    if (!app.isPackaged) {
      if (win && !win.isDestroyed()) {
        dialog.showMessageBox(win, {
          type: 'info',
          buttons: ['OK'],
          title: 'Developer Build',
          message: 'Auto-update only works in installed builds.',
          detail: 'You\'re running the app in development mode, which cannot be updated.'
        });
      }
      return;
    }
    updaterManualCheckWindow = win;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      updaterManualCheckWindow = null;
      if (win && !win.isDestroyed()) {
        dialog.showMessageBox(win, {
          type: 'error',
          buttons: ['OK'],
          title: 'Update Check Failed',
          message: 'Could not check for updates.',
          detail: err?.message || String(err)
        });
      }
    }
  };

  const showAboutDialog = () => {
    const win = getTargetWindow();
    if (!win || win.isDestroyed()) return;
    const platformLabel = process.platform === 'darwin'
      ? `macOS (${process.arch})`
      : process.platform === 'win32'
        ? `Windows (${process.arch})`
        : `${process.platform} (${process.arch})`;
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['OK'],
      title: `About ${app.getName()}`,
      message: `${app.getName()} ${app.getVersion()}`,
      detail:
        `Platform: ${platformLabel}\n` +
        `Electron: ${process.versions.electron}\n` +
        `Node: ${process.versions.node}\n` +
        `Chromium: ${process.versions.chrome}`
    });
  };

  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = getTargetWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:open-pdf');
            }
          }
        },
        {
          label: 'Export Annotated PDF…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            const win = getTargetWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:export-annotated-pdf');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Re-import PDF Bookmarks',
          click: () => {
            const win = getTargetWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:reimport-pdf-bookmarks');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Print PDF…',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            const win = getTargetWindow();
            console.log('[electron-main] Print PDF menu clicked, targetWindow alive:', !!(win && !win.isDestroyed()));
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:print-pdf');
            }
          }
        },
        {
          label: 'Print PDF with Annotations…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            const win = getTargetWindow();
            console.log('[electron-main] Print PDF with Annotations menu clicked, targetWindow alive:', !!(win && !win.isDestroyed()));
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:print-pdf-markup');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save Log',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            const win = getTargetWindow();
            console.log('[electron-main] Save Log menu clicked, targetWindow alive:', !!(win && !win.isDestroyed()));
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:save-log');
            }
          }
        },
        { type: 'separator' },
        { role: isMac ? 'close' : 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        // 2026-04-26 — Reload + force-reload + DevTools are developer-only.
        // Hidden in shipped builds so free/Pro/Enterprise see a clean
        // native-feeling app. Re-shown when the renderer flips developer
        // mode on for a developer-tier account.
        ...(developerMode
          ? [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' }
          ]
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
            { type: 'separator' },
            { role: 'front' }
          ]
          : [{ role: 'close' }])
      ]
    },
    {
      role: 'help',
      label: 'Help',
      submenu: [
        {
          label: `About ${app.getName()}`,
          click: showAboutDialog
        },
        {
          label: 'Check for Updates…',
          click: triggerCheckForUpdates
        },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: () => {
            shell.openExternal('https://github.com/IsaiahCalvo/Survey');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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
  return await shell.openPath(filePath);
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  // Validate URL against allowlist of safe protocols before opening
  const allowedProtocols = ['http:', 'https:', 'mailto:'];
  try {
    const parsedUrl = new URL(url);
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      console.warn(`Rejected URL with invalid protocol: ${url}`);
      return '';
    }
  } catch (e) {
    // URL parsing failed; reject silently
    console.warn(`Invalid URL format: ${url}`);
    return '';
  }
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

ipcMain.handle('fs:writeFile', async (event, { path: filePath, data }) => {
  try {
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, Buffer.from(data));
    return { success: true };
  } catch (error) {
    console.error('Failed to write file:', error);
    throw error;
  }
});

ipcMain.handle('fs:appendFile', async (event, { path: filePath, data }) => {
  try {
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, Buffer.from(data));
    return { success: true };
  } catch (error) {
    console.error('Failed to append file:', error);
    throw error;
  }
});

// Diagnostics: clear a folder's contents (files + subfolders), recreating the folder.
// Guarded to paths containing "Testing Logs" so we can't accidentally nuke anything else.
ipcMain.handle('fs:clearDir', async (event, dirPath) => {
  try {
    if (!dirPath || typeof dirPath !== 'string' || !dirPath.includes('TestLogs')) {
      throw new Error(`fs:clearDir refused path (must contain "TestLogs"): ${dirPath}`);
    }
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
    fs.mkdirSync(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    console.error('Failed to clear directory:', error);
    throw error;
  }
});

// Diagnostics: full-window screenshot via Electron's native webContents.capturePage().
// Returns a Node Buffer (PNG bytes) — IPC deserializes it as Uint8Array on the renderer side.
ipcMain.handle('screenshot:capturePage', async (event) => {
  try {
    const image = await event.sender.capturePage();
    return image.toPNG();
  } catch (error) {
    console.error('Failed to capture page:', error);
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

ipcMain.handle('fs:getFileStats', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      mtime: stats.mtime.toISOString(),
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  } catch (error) {
    return null;
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

// UX 2026-04-23: Custom Print Panel — enumerate installed printers for the
// panel's destination picker. Prefers the modern async API and falls back to
// the deprecated sync one if the Electron version lacks it.
ipcMain.handle('print:list-printers', async (event) => {
  try {
    const webContents = event?.sender;
    if (!webContents) return [];
    if (typeof webContents.getPrintersAsync === 'function') {
      const printers = await webContents.getPrintersAsync();
      return Array.isArray(printers) ? printers : [];
    }
    if (typeof webContents.getPrinters === 'function') {
      return webContents.getPrinters();
    }
    return [];
  } catch (error) {
    console.warn('[print:list-printers] failed:', error?.message || error);
    return [];
  }
});

// UX 2026-04-23: Fire the real print job from the renderer's webContents with
// the Print Panel's options. Runs non-silent by default so the OS print
// confirmation shows (copies, duplex, pageSize, deviceName all flow through).
ipcMain.handle('print:job', async (event, options = {}) => {
  try {
    const webContents = event?.sender;
    if (!webContents) return { ok: false, error: 'no webContents' };
    const printOptions = {
      silent: options.silent === true,
      printBackground: options.printBackground !== false,
      color: options.color !== false,
      landscape: options.landscape === true,
      copies: Math.max(1, parseInt(options.copies, 10) || 1),
      collate: options.collate !== false,
      pageRanges: Array.isArray(options.pageRanges) ? options.pageRanges : undefined,
    };
    if (options.deviceName) printOptions.deviceName = options.deviceName;
    if (options.duplexMode) printOptions.duplexMode = options.duplexMode;
    if (options.pageSize) printOptions.pageSize = options.pageSize;
    if (options.margins) printOptions.margins = options.margins;
    return await new Promise((resolve) => {
      webContents.print(printOptions, (success, failureReason) => {
        if (success) resolve({ ok: true });
        else resolve({ ok: false, error: failureReason || 'print canceled or failed' });
      });
    });
  } catch (error) {
    console.error('[print:job] error:', error);
    return { ok: false, error: error?.message || String(error) };
  }
});

// UX 2026-04-24: Silent-print pipeline — receives the composed print HTML
// from the renderer, loads it into a hidden BrowserWindow, fires a silent
// webContents.print() with the chosen device + options, then closes the
// hidden window. Skips the OS print dialog entirely so the custom Print
// Panel acts as the single source of truth for every option.
ipcMain.handle('print:html-silent', async (event, payload = {}) => {
  const { html, options = {} } = payload || {};
  if (!html || typeof html !== 'string') return { ok: false, error: 'no html' };
  let hidden = null;
  try {
    hidden = new BrowserWindow({
      show: false,
      width: 800,
      height: 1000,
      webPreferences: {
        offscreen: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    await hidden.loadURL(dataUrl);
    await new Promise((r) => setTimeout(r, 50));
    const printOptions = {
      silent: true,
      printBackground: options.printBackground !== false,
      color: options.color !== false,
      landscape: options.landscape === true,
      copies: Math.max(1, parseInt(options.copies, 10) || 1),
      collate: options.collate !== false,
    };
    if (options.deviceName) printOptions.deviceName = options.deviceName;
    if (options.duplexMode) printOptions.duplexMode = options.duplexMode;
    if (options.pageSize) printOptions.pageSize = options.pageSize;
    if (options.margins) printOptions.margins = options.margins;
    if (options.pageRanges) printOptions.pageRanges = options.pageRanges;
    console.log('[print:html-silent] dispatch with options:', printOptions);
    const result = await new Promise((resolve) => {
      hidden.webContents.print(printOptions, (success, failureReason) => {
        if (success) resolve({ ok: true });
        else resolve({ ok: false, error: failureReason || 'print canceled or failed' });
      });
    });
    return result;
  } catch (error) {
    console.error('[print:html-silent] error:', error);
    return { ok: false, error: error?.message || String(error) };
  } finally {
    try { if (hidden && !hidden.isDestroyed()) hidden.close(); } catch {}
  }
});

// UX 2026-04-24: companion to silent print — when the user picks
// "Save as PDF" as the destination, render the composed HTML to a real
// PDF on disk via webContents.printToPDF and prompt the user for a
// save location. Honors the same per-page @page CSS so mixed paper
// sizes survive the round-trip.
ipcMain.handle('print:html-to-pdf', async (event, payload = {}) => {
  const { html, suggestedName = 'Print.pdf', options = {} } = payload || {};
  if (!html || typeof html !== 'string') return { ok: false, error: 'no html' };
  let hidden = null;
  try {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || null;
    const saveResult = await dialog.showSaveDialog(parentWindow, {
      title: 'Save print output as PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, error: 'canceled' };
    }
    hidden = new BrowserWindow({
      show: false,
      width: 800,
      height: 1000,
      webPreferences: {
        offscreen: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    await hidden.loadURL(dataUrl);
    await new Promise((r) => setTimeout(r, 100));
    const pdfBuffer = await hidden.webContents.printToPDF({
      printBackground: options.printBackground !== false,
      preferCSSPageSize: true,
      landscape: options.landscape === true,
    });
    fs.writeFileSync(saveResult.filePath, pdfBuffer);
    console.log('[print:html-to-pdf] wrote', saveResult.filePath, pdfBuffer.length, 'bytes');
    return { ok: true, filePath: saveResult.filePath };
  } catch (error) {
    console.error('[print:html-to-pdf] error:', error);
    return { ok: false, error: error?.message || String(error) };
  } finally {
    try { if (hidden && !hidden.isDestroyed()) hidden.close(); } catch {}
  }
});

// UX 2026-04-22: Push the current Save Log dump to the Survey repo's "logs"
// branch on GitHub, using whatever `gh` CLI auth the user already has. Each
// save lands as its own timestamped file tagged with the device (platform +
// hostname) so Mac / Windows / other-device logs never overwrite each other.
// Returns { ok, url, error }. Never throws — worst case returns ok:false.
ipcMain.handle('logs:pushToGithub', async (event, payload = {}) => {
  const { content, fallbackToken } = payload;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const platformTag = process.platform === 'darwin'
      ? 'mac'
      : process.platform === 'win32'
        ? 'windows'
        : process.platform === 'linux' ? 'linux' : process.platform;
    const hostname = (os.hostname() || 'unknown')
      .replace(/\.local$/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .toLowerCase();
    const baseFilename = `${platformTag}-${hostname}-${timestamp}.log`;
    const b64 = Buffer.from(String(content ?? ''), 'utf-8').toString('base64');
    const makeFilename = (attempt) => {
      if (attempt <= 0) return baseFilename;
      const suffix = `${process.pid}-${Date.now().toString(36)}-${attempt}`;
      return baseFilename.replace(/\.log$/i, `-${suffix}.log`);
    };

    console.log(`[logs:pushToGithub] uploading ${baseFilename} (${b64.length} base64 chars)`);

    // UX 2026-04-22: send the JSON body (incl. base64 log content) via stdin,
    // not as CLI args. Passing a ~100KB base64 blob as `-f content=...` blows
    // Windows' command-line length cap and surfaces to the user as ENAMETOOLONG.
    // Stdin has no such limit on any OS (mac/win/linux), so this is the portable fix.
    const uploadViaGh = (filename, attempt) => new Promise((resolve) => {
      const commitMessage = `save-log from ${platformTag} (${hostname}) @ ${timestamp}`;
      const ghBody = JSON.stringify({
        message: attempt > 0 ? `${commitMessage} retry ${attempt}` : commitMessage,
        content: b64,
        branch: 'logs',
      });
      const child = spawn('gh', [
        'api',
        '--method', 'PUT',
        '/repos/IsaiahCalvo/Survey/contents/' + filename,
        '--input', '-'
      ], { shell: false });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('error', (e) => resolve({ ok: false, error: `gh spawn failed: ${e.message}` }));
      child.on('close', (code) => {
        if (code === 0) {
          let url = null;
          try { url = JSON.parse(out)?.content?.html_url || null; } catch {}
          resolve({ ok: true, url, filename });
        } else {
          resolve({ ok: false, error: `gh exited ${code}: ${err.trim() || out.trim()}`, filename });
        }
      });
      try {
        child.stdin.write(ghBody);
        child.stdin.end();
      } catch (stdinErr) {
        resolve({ ok: false, error: `gh stdin write failed: ${stdinErr?.message || stdinErr}`, filename });
      }
    });

    let ghResult = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const filename = makeFilename(attempt);
      ghResult = await uploadViaGh(filename, attempt);
      if (ghResult.ok) break;
      if (!/HTTP 409|Conflict|is at .* expected/i.test(String(ghResult.error || ''))) break;
      console.warn(`[logs:pushToGithub] gh conflict retry ${attempt + 1}/2 — ${ghResult.error}`);
      await new Promise((r) => setTimeout(r, 300 + attempt * 400));
    }

    if (ghResult.ok) {
      console.log(`[logs:pushToGithub] pushed via gh — ${ghResult.url || ghResult.filename}`);
      return ghResult;
    }
    console.warn(`[logs:pushToGithub] gh path failed — ${ghResult.error}`);

    // UX 2026-04-25: Fallback path for end-user Windows installs that don't
    // have the `gh` CLI on PATH. We use Electron's built-in Node fetch with
    // a token baked into the renderer bundle at build time and forwarded
    // through the IPC payload. Same auto-triage workflow fires on the
    // logs branch as the gh path.
    if (!fallbackToken) {
      const reason = `gh failed and no fallback token was provided (${ghResult.error})`;
      console.warn(`[logs:pushToGithub] ${reason}`);
      return { ok: false, error: reason, filename: ghResult.filename || baseFilename };
    }

    try {
      let lastReason = 'not attempted';
      let lastFilename = baseFilename;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const filename = makeFilename(attempt + 3);
        lastFilename = filename;
        const commitMessage = `save-log from ${platformTag} (${hostname}) @ ${timestamp}`;
        const res = await fetch(
          `https://api.github.com/repos/IsaiahCalvo/Survey/contents/${filename}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `token ${fallbackToken}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
              'User-Agent': 'survey-electron-savelog'
            },
            body: JSON.stringify({
              message: attempt > 0 ? `${commitMessage} retry ${attempt}` : commitMessage,
              content: b64,
              branch: 'logs'
            })
          }
        );
        if (res.ok) {
          let url = null;
          try {
            const data = await res.json();
            url = data?.content?.html_url || null;
          } catch {}
          console.log(`[logs:pushToGithub] pushed via fetch fallback — ${url || filename}`);
          return { ok: true, url, filename };
        }
        let reason = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody?.message) reason += `: ${errBody.message.slice(0, 120)}`;
        } catch {}
        lastReason = reason;
        if (res.status !== 409) break;
        console.warn(`[logs:pushToGithub] fetch fallback conflict retry ${attempt + 1}/2 — ${reason}`);
        await new Promise((r) => setTimeout(r, 300 + attempt * 400));
      }
      console.warn(`[logs:pushToGithub] fetch fallback failed — ${lastReason}`);
      return { ok: false, error: `gh failed (${ghResult.error}); fetch fallback ${lastReason}`, filename: lastFilename };
    } catch (fetchErr) {
      const msg = fetchErr?.message || String(fetchErr);
      console.warn(`[logs:pushToGithub] fetch fallback threw — ${msg}`);
      return { ok: false, error: `gh failed (${ghResult.error}); fetch fallback threw: ${msg}`, filename: ghResult.filename || baseFilename };
    }
  } catch (error) {
    console.error('[logs:pushToGithub] unexpected error:', error);
    return { ok: false, error: error?.message || String(error) };
  }
});

// 2026-04-29 — Local snapshot save fired alongside the GitHub push. Each invocation
// creates a dated subfolder under <project-root>/Logs/ containing console.log,
// network.json, and summary.json. After writing, prunes the Logs folder to the
// 20 most-recent snapshots — older folders get fully removed (recursive rmSync).
// 2026-06-04 — Renderer pulls the continuous main-process console log at
// Cmd+Shift+L time. This is the robust source of truth: it spans launch through
// every reload/realm, unlike the in-page buffer which resets on navigation.
ipcMain.handle('logs:readContinuous', async () => {
  try {
    const txt = await fs.promises.readFile(CONTINUOUS_LOG_PATH, 'utf8');
    return { ok: true, text: txt };
  } catch (e) {
    return { ok: false, text: '', error: e?.message || String(e) };
  }
});

ipcMain.handle('logs:saveSnapshot', async (event, payload = {}) => {
  const MAX_SNAPSHOTS = 20;
  try {
    const startedAt = Date.now();
    const { consoleText = '', network = [], summary = {}, extraFiles = [] } = payload;
    // app.getAppPath() returns the project root in dev (where electron-main.js lives)
    // and the asar root in packaged builds. We anchor Logs to the project root so
    // dev sessions write where the user expects; packaged builds will write inside
    // the resources path which is fine for capture purposes.
    const projectRoot = app.getAppPath();
    const logsRoot = path.join(projectRoot, 'Logs');
    await fs.promises.mkdir(logsRoot, { recursive: true });

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const snapshotDir = path.join(logsRoot, stamp);
    await fs.promises.mkdir(snapshotDir, { recursive: true });

    const extraFileWrites = Array.isArray(extraFiles)
      ? extraFiles
        .filter((file) => file && typeof file.name === 'string' && /^[a-zA-Z0-9._-]+$/.test(file.name))
        .slice(0, 20)
        .map((file) => fs.promises.writeFile(
          path.join(snapshotDir, file.name),
          typeof file.content === 'string' ? file.content : JSON.stringify(file.content ?? null, null, 2),
          'utf8'
        ))
      : [];

    await Promise.all([
      fs.promises.writeFile(path.join(snapshotDir, 'console.log'), String(consoleText), 'utf8'),
      fs.promises.writeFile(
        path.join(snapshotDir, 'network.json'),
        JSON.stringify(Array.isArray(network) ? network : [], null, 2),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(snapshotDir, 'summary.json'),
        JSON.stringify({ ...summary, savedAtIso: now.toISOString(), snapshotName: stamp }, null, 2),
        'utf8'
      ),
      ...extraFileWrites
    ]);

    // Prune to MAX_SNAPSHOTS most-recent dated subfolders. Anything that isn't a
    // dated stamp is left alone so the existing top-level "1.log" file the user
    // already has is untouched.
    const STAMP_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
    const entries = (await fs.promises.readdir(logsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && STAMP_RE.test(d.name))
      .map((d) => d.name)
      .sort(); // ISO-like stamp sorts oldest-first lexicographically.
    const removed = [];
    while (entries.length > MAX_SNAPSHOTS) {
      const oldest = entries.shift();
      try {
        await fs.promises.rm(path.join(logsRoot, oldest), { recursive: true, force: true });
        removed.push(oldest);
      } catch (rmErr) {
        console.warn('[logs:saveSnapshot] failed to remove old snapshot', oldest, rmErr?.message);
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[logs:saveSnapshot] wrote ${snapshotDir} (pruned ${removed.length} old, ${durationMs}ms async)`);
    return { ok: true, dir: snapshotDir, pruned: removed, durationMs };
  } catch (error) {
    console.error('[logs:saveSnapshot] unexpected error:', error);
    return { ok: false, error: error?.message || String(error) };
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
  createAppMenu();
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
        setTimeout(() => {
          // Clean up file watchers
          fileWatchers.forEach((watcher) => {
            watcher.close();
          });
          fileWatchers.clear();

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
