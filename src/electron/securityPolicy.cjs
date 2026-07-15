const path = require('path');
const { pathToFileURL } = require('url');

function isTrustedAppUrl(candidate, { isDevelopment, devPort, appPath }) {
  try {
    const parsed = new URL(candidate);
    if (isDevelopment) {
      return parsed.origin === `http://localhost:${devPort}`;
    }

    const expected = new URL(pathToFileURL(path.join(appPath, 'dist', 'index.html')).href);
    return parsed.protocol === 'file:'
      && parsed.hostname === expected.hostname
      && parsed.pathname === expected.pathname;
  } catch (_) {
    return false;
  }
}

function isSameRedirectTarget(candidate, expected) {
  try {
    const actualUrl = new URL(candidate);
    const expectedUrl = new URL(expected);
    return actualUrl.protocol === expectedUrl.protocol
      && actualUrl.hostname === expectedUrl.hostname
      && actualUrl.port === expectedUrl.port
      && actualUrl.pathname === expectedUrl.pathname
      && actualUrl.username === expectedUrl.username
      && actualUrl.password === expectedUrl.password;
  } catch (_) {
    return false;
  }
}

function isSafeDiagnosticFileName(candidate) {
  return typeof candidate === 'string'
    && candidate.length > 0
    && candidate.length <= 128
    && /^[a-zA-Z0-9._-]+$/.test(candidate)
    && candidate !== '.'
    && candidate !== '..';
}

function deny(reason) {
  const error = new Error(`Electron security policy denied access: ${reason}`);
  error.code = 'EPERM';
  return error;
}

function assertTrustedIpcSender(event, options) {
  const frame = event?.senderFrame;
  const mainFrame = event?.sender?.mainFrame;
  if (!frame || !mainFrame || frame !== mainFrame) {
    throw deny('IPC sender is not the main frame');
  }
  if (!isTrustedAppUrl(frame.url, options)) {
    throw deny('IPC sender URL is not the app');
  }
}

function createTrustedIpcMain(ipcMain, getOptions) {
  return {
    handle(channel, handler) {
      return ipcMain.handle(channel, async (event, ...args) => {
        assertTrustedIpcSender(event, getOptions());
        return handler(event, ...args);
      });
    },
    on(channel, handler) {
      return ipcMain.on(channel, (event, ...args) => {
        try {
          assertTrustedIpcSender(event, getOptions());
        } catch (_) {
          return;
        }
        return handler(event, ...args);
      });
    },
  };
}

function isAllowedFilesystemPath(candidate, { staticRoots = [], dialogFiles = [] } = {}) {
  if (!candidate || typeof candidate !== 'string') return false;
  const resolved = path.resolve(candidate);

  for (const dialogFile of dialogFiles) {
    if (typeof dialogFile === 'string' && resolved === path.resolve(dialogFile)) return true;
  }
  for (const staticRoot of staticRoots) {
    if (typeof staticRoot !== 'string') continue;
    const root = path.resolve(staticRoot);
    if (resolved === root || resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}

function allowedExcelOwnerNamesForDirectory(candidate, dialogFiles = []) {
  if (!candidate || typeof candidate !== 'string') return [];
  const resolvedDirectory = path.resolve(candidate);
  const names = new Set();
  for (const dialogFile of dialogFiles) {
    if (typeof dialogFile !== 'string' || !/\.(?:xlsx|xlsm|xlsb|xls)$/i.test(dialogFile)) continue;
    const resolvedFile = path.resolve(dialogFile);
    if (path.dirname(resolvedFile) === resolvedDirectory) {
      names.add(`~$${path.basename(resolvedFile)}`);
    }
  }
  return [...names];
}

function isAllowedExcelOwnerPath(candidate, dialogFiles = []) {
  if (!candidate || typeof candidate !== 'string') return false;
  const resolved = path.resolve(candidate);
  const allowedNames = allowedExcelOwnerNamesForDirectory(path.dirname(resolved), dialogFiles);
  return allowedNames.some((name) => name.toLowerCase() === path.basename(resolved).toLowerCase());
}

const DIALOG_GRANT_STORE_VERSION = 2;

function normalizeAbsoluteFiles(files) {
  if (!Array.isArray(files)) return [];
  const normalized = new Set();
  for (const file of files) {
    if (typeof file !== 'string' || file.includes('\0') || !path.isAbsolute(file)) continue;
    normalized.add(path.resolve(file));
  }
  return [...normalized];
}

function parseDialogGrantStore(serialized) {
  try {
    const store = JSON.parse(serialized);
    if (!store || store.version !== DIALOG_GRANT_STORE_VERSION || !Array.isArray(store.files)) {
      return [];
    }
    return normalizeAbsoluteFiles(store.files);
  } catch (_) {
    return [];
  }
}

function serializeDialogGrantStore(files) {
  return JSON.stringify({
    version: DIALOG_GRANT_STORE_VERSION,
    files: normalizeAbsoluteFiles(files),
  });
}

function assertClearableDirectory(candidate, { clearableDirectories = [] } = {}) {
  if (typeof candidate === 'string') {
    const resolved = path.resolve(candidate);
    for (const allowed of clearableDirectories) {
      if (typeof allowed === 'string' && resolved === path.resolve(allowed)) return;
    }
  }
  throw deny('directory is not approved for recursive clearing');
}

function assertAtomicWriteTarget(candidate, fsApi) {
  if (!candidate || typeof candidate !== 'string') throw deny('invalid atomic write target');
  try {
    if (fsApi.statSync(candidate).isDirectory()) {
      const error = new Error(`Atomic write target is a directory: ${candidate}`);
      error.code = 'EISDIR';
      throw error;
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

module.exports = {
  allowedExcelOwnerNamesForDirectory,
  assertAtomicWriteTarget,
  assertClearableDirectory,
  assertTrustedIpcSender,
  createTrustedIpcMain,
  isAllowedExcelOwnerPath,
  isAllowedFilesystemPath,
  isSameRedirectTarget,
  isSafeDiagnosticFileName,
  isTrustedAppUrl,
  parseDialogGrantStore,
  serializeDialogGrantStore,
};
