// src/electron/msalAuthMain.js
//
// Main-process Microsoft sign-in via @azure/msal-node (PLAN.md Amendment
// 2026-06-08(b) #5). Sign-in opens the SYSTEM browser (shell.openExternal)
// with a loopback http://localhost redirect, so Microsoft renders its full
// passwordless surface — passkeys/FIDO2, Windows Hello, phone sign-in — which
// it refuses to show inside an embedded Electron window.
//
// Token custody: the MSAL cache (including refresh tokens) lives ONLY here in
// the main process, persisted via msalCacheStore (safeStorage-encrypted). The
// renderer gets a narrow IPC surface — sign in / get access token / status /
// sign out — and NEVER sees a refresh token.
//
// Azure app-registration prerequisite (one-time, portal-side): the app
// (client id below) needs a "Mobile and desktop applications" platform with
// redirect URI http://localhost AND "Allow public client flows" enabled —
// without it, new sign-ins fail with a redirect-URI mismatch.

const path = require('path');
const fs = require('fs');
const { createMsalCacheStore } = require('./msalCacheStore.cjs');

// Same app + scopes as the renderer's legacy flow (scopes unchanged by design).
const AZURE_CLIENT_ID = '0da81a9e-2b05-46ee-b826-5efc5114c765';
const AUTHORITY = 'https://login.microsoftonline.com/common';
const GRAPH_SCOPES = ['User.Read', 'Files.ReadWrite.All', 'Sites.ReadWrite.All', 'openid', 'profile', 'offline_access'];
const CACHE_FILE_NAME = 'ms-auth-cache.bin';

const SUCCESS_TEMPLATE =
  '<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:18vh;background:var(--surface-1);color:var(--text-1)">' +
  '<h2>Signed in</h2><p>You can close this tab and return to the Survey app.</p></body></html>';
const ERROR_TEMPLATE =
  '<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:18vh;background:var(--surface-1);color:var(--text-1)">' +
  '<h2>Sign-in did not complete</h2><p>Close this tab and try again from the Survey app.</p></body></html>';

// Map an MSAL AuthenticationResult to the narrow shape the renderer may see.
// No id/refresh tokens cross IPC — account info + access token + expiry only.
const toRendererAuthResult = (result) => ({
  success: true,
  accessToken: result.accessToken,
  expiresAt: result.expiresOn ? Math.floor(result.expiresOn.getTime() / 1000) : null,
  account: {
    homeAccountId: result.account?.homeAccountId || null,
    tenantId: result.account?.tenantId || result.idTokenClaims?.tid || null,
    username: result.account?.username || result.idTokenClaims?.preferred_username || null,
    name: result.account?.name || result.idTokenClaims?.name || null
  }
});

const createMicrosoftAuthMain = ({ app, shell, safeStorage, logger = console }) => {
  let pcaPromise = null;
  let cacheStore = null;
  let interactiveInFlight = null;

  const getCacheStore = () => {
    if (!cacheStore) {
      // Lazy by design: userData/safeStorage must not be touched before app-ready.
      // IPC handlers only fire after a window exists, but assert anyway.
      if (typeof app.isReady === 'function' && !app.isReady()) {
        throw new Error('[msauth] cache store requested before app ready');
      }
      cacheStore = createMsalCacheStore({
        filePath: path.join(app.getPath('userData'), CACHE_FILE_NAME),
        fs,
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (blob) => safeStorage.decryptString(blob),
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        log: (msg) => logger.warn?.(`[msauth] ${msg}`)
      });
    }
    return cacheStore;
  };

  const getPca = () => {
    if (!pcaPromise) {
      pcaPromise = (async () => {
        const { PublicClientApplication } = require('@azure/msal-node');
        return new PublicClientApplication({
          auth: { clientId: AZURE_CLIENT_ID, authority: AUTHORITY },
          cache: { cachePlugin: getCacheStore().cachePlugin }
        });
      })();
    }
    return pcaPromise;
  };

  const getFirstAccount = async () => {
    const pca = await getPca();
    const accounts = await pca.getTokenCache().getAllAccounts();
    // Known limitation: a single-account app. If two Microsoft accounts ever land
    // in the cache, the first wins; sign-out clears all. Revisit if multi-account
    // becomes a real scenario (would need a persisted preferred-account id).
    return accounts[0] || null;
  };

  const signIn = async () => {
    // One interactive flow at a time — a second click reuses the pending one
    // instead of opening a second browser tab + loopback listener.
    if (interactiveInFlight) return interactiveInFlight;
    interactiveInFlight = (async () => {
      try {
        const pca = await getPca();
        const result = await pca.acquireTokenInteractive({
          scopes: GRAPH_SCOPES,
          openBrowser: async (url) => { await shell.openExternal(url); },
          successTemplate: SUCCESS_TEMPLATE,
          errorTemplate: ERROR_TEMPLATE,
          prompt: 'select_account'
        });
        return toRendererAuthResult(result);
      } catch (err) {
        const message = err?.errorMessage || err?.message || 'Microsoft sign-in failed';
        const cancelled = /user_cancelled|access_denied/i.test(`${err?.errorCode || ''} ${message}`);
        logger.warn?.(`[msauth] interactive sign-in failed: ${err?.errorCode || ''} ${message}`);
        return { success: false, cancelled, error: message };
      } finally {
        interactiveInFlight = null;
      }
    })();
    return interactiveInFlight;
  };

  const getAccessToken = async ({ forceRefresh = false } = {}) => {
    try {
      const account = await getFirstAccount();
      if (!account) return { success: false, needsInteraction: true, error: 'No Microsoft account signed in' };
      const pca = await getPca();
      const result = await pca.acquireTokenSilent({
        account,
        scopes: GRAPH_SCOPES,
        forceRefresh: Boolean(forceRefresh)
      });
      return toRendererAuthResult(result);
    } catch (err) {
      const { InteractionRequiredAuthError } = require('@azure/msal-node');
      const needsInteraction = err instanceof InteractionRequiredAuthError;
      if (!needsInteraction) logger.warn?.(`[msauth] silent token acquisition failed: ${err?.errorCode || ''} ${err?.message || err}`);
      return { success: false, needsInteraction, error: err?.errorMessage || err?.message || 'Token acquisition failed' };
    }
  };

  const getStatus = async () => {
    try {
      const account = await getFirstAccount();
      if (!account) return { signedIn: false };
      return {
        signedIn: true,
        account: {
          homeAccountId: account.homeAccountId || null,
          tenantId: account.tenantId || null,
          username: account.username || null,
          name: account.name || null
        }
      };
    } catch (err) {
      logger.warn?.(`[msauth] status check failed: ${err?.message || err}`);
      return { signedIn: false };
    }
  };

  const signOut = async () => {
    try {
      const pca = await getPca();
      const cache = pca.getTokenCache();
      const accounts = await cache.getAllAccounts();
      for (const account of accounts) {
        await cache.removeAccount(account);
      }
      getCacheStore().removePersistedCache();
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || 'Sign-out failed' };
    }
  };

  return { signIn, getAccessToken, getStatus, signOut };
};

// Wire the narrow IPC surface. Call once from electron-main after app modules load.
const registerMicrosoftAuthIpc = ({ ipcMain, app, shell, safeStorage, logger = console }) => {
  const service = createMicrosoftAuthMain({ app, shell, safeStorage, logger });
  ipcMain.handle('msauth:signIn', () => service.signIn());
  ipcMain.handle('msauth:getAccessToken', (_event, options) => service.getAccessToken(options || {}));
  ipcMain.handle('msauth:status', () => service.getStatus());
  ipcMain.handle('msauth:signOut', () => service.signOut());
  return service;
};

module.exports = { createMicrosoftAuthMain, registerMicrosoftAuthIpc, toRendererAuthResult, GRAPH_SCOPES };
