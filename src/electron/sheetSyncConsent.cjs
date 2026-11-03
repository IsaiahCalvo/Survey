// src/electron/sheetSyncConsent.cjs
//
// Live sheet sign-in on the desktop app, with nothing to type.
//
// Connect Google / Connect Microsoft opens the consent page with window.open;
// electron-main.js lets accounts.google.com and login.microsoftonline.com open
// as the app's own child window. After "yes", the sheet-sync function sends
// that window to google-connected.html with a one-time code in the #fragment
// (supabase/functions/_shared/sheetSync/service.js, claimFragment). The
// server links the sign-in only when the Survey account that pressed Connect
// sends that code back.
//
// This reads the code off the child window's last page and hands it to the
// app window, which claims it (src/services/sheetSyncClaim.js). It is safe for
// the same reason typing it was: the window is the app's own, so the person
// who said yes is the person at this app. A consent link sent to someone else
// opens in their browser, never in this window.
//
// Only the finish page on Survey's own sites counts (exact origin + path).

const FINISH_ORIGINS = Object.freeze([
  'https://surveytool.app',
  'https://www.surveytool.app',
  'https://surveytool-nightly.vercel.app',
  'http://localhost:5173',
  'http://localhost:5199',
]);
const FINISH_PATH = '/google-connected.html';
const CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Is this URL Survey's sign-in finish page? */
function isFinishPage(url) {
  try {
    const parsed = new URL(url);
    return FINISH_ORIGINS.indexOf(parsed.origin) !== -1 && parsed.pathname === FINISH_PATH;
  } catch (_e) {
    return false;
  }
}

/**
 * { provider, result, code } from the finish page's URL, or null when the URL
 * is not that page. `code` is null unless result is 'finish' with a valid code.
 */
function sheetSyncFinishFromUrl(url) {
  if (!isFinishPage(url)) return null;
  const parsed = new URL(url);
  const provider = parsed.searchParams.get('provider') === 'msgraph' ? 'msgraph' : 'google';
  const result = parsed.searchParams.get('result') || 'connected';
  const raw = new URLSearchParams(parsed.hash.replace(/^#/, '')).get('code') || '';
  const code = result === 'finish' && CODE.test(raw) ? raw : null;
  return { provider, result, code };
}

// Read back what the page saved, for a navigation event that lost the
// fragment. The page itself writes { provider, code, at } here.
const READ_SAVED_CLAIM = "(() => { try { return localStorage.getItem('survey-sheet-sync-claim'); } catch (e) { return null; } })()";

/**
 * Watch one child window. When it reaches the finish page, send
 * 'sheetSync:consent' { provider, result, code } to the app window and close
 * the child once there is nothing left for the person to read there.
 */
function watchSheetSyncConsent(child, appContents, { closeDelayMs = 900 } = {}) {
  if (!child || !child.webContents || !appContents) return;
  let done = false;
  const deliver = (finish) => {
    if (done || !finish) return;
    if (finish.result === 'finish' && !finish.code) return; // wait for the code
    done = true;
    try {
      if (!appContents.isDestroyed()) appContents.send('sheetSync:consent', finish);
    } catch (_e) { /* app window gone */ }
    // A finished sign-in has nothing more to show; a refusal or error stays up
    // so the person can read why.
    if (finish.result === 'finish' || finish.result === 'connected') {
      setTimeout(() => { try { if (!child.isDestroyed()) child.close(); } catch (_e) { /* closed */ } }, closeDelayMs);
    }
  };
  const onUrl = (_event, url) => deliver(sheetSyncFinishFromUrl(url));
  child.webContents.on('will-redirect', onUrl);
  child.webContents.on('did-navigate', onUrl);
  child.webContents.on('did-finish-load', () => {
    if (done) return;
    const url = child.webContents.getURL();
    const finish = sheetSyncFinishFromUrl(url);
    if (!finish) return;
    if (finish.result !== 'finish' || finish.code) { deliver(finish); return; }
    child.webContents.executeJavaScript(READ_SAVED_CLAIM, true).then((saved) => {
      try {
        const claim = JSON.parse(saved || 'null');
        if (claim && CODE.test(String(claim.code || ''))) deliver({ provider: finish.provider, result: 'finish', code: claim.code });
      } catch (_e) { /* nothing saved */ }
    }).catch(() => { /* page gone */ });
  });
}

module.exports = { FINISH_ORIGINS, isFinishPage, sheetSyncFinishFromUrl, watchSheetSyncConsent };
