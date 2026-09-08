// Test-owned profile validation and the real product main live in the shared
// entry. Install a network deny rule before its ready handler creates windows.
const { app, session } = require('electron');
// A script entry otherwise sets appPath to debug/, unlike the packaged app.
app.setAppPath(require('node:path').resolve(__dirname, '..'));
global.__managedLocalBlockedRequests = [];
// The real main can forward anonymous analytics via Node fetch, which does
// not pass through Chromium's session network hook. Deny that path too.
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  global.__managedLocalBlockedRequests.push({ origin: url.origin, method: options.method || input.method || 'GET', nativeFetch: true });
  throw new TypeError('Native fetch is offline in the managed-local QA fixture');
};
app.on('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    const url = new URL(details.url);
    if (process.env.SURVEY_MANAGED_LOCAL_QA_DEV === '1' && ['localhost', '127.0.0.1'].includes(url.hostname)) {
      callback({ cancel: false }); return;
    }
    global.__managedLocalBlockedRequests.push({ origin: url.origin, method: details.method });
    callback({ cancel: true });
  });
});
require('./data-architecture-electron-entry.cjs');
