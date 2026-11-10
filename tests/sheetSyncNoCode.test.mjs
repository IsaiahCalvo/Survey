// Live sheet sign-in with nothing to type (owner 2026-11-03: "I shouldn't have
// to remember a code and then type it in"). The one-time code still guards
// against forwarded consent links; it now travels back to the app on its own:
// desktop reads it off its own consent window, phones get an "Open Survey"
// button that opens the app through its link scheme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { handleSheetSync } from '../supabase/functions/_shared/sheetSync/service.js';
import { rememberClaim, readClaim, forgetClaim, CLAIM_KEY } from '../src/services/sheetSyncClaim.js';

const require = createRequire(import.meta.url);
const { sheetSyncFinishFromUrl, watchSheetSyncConsent } = require('../src/electron/sheetSyncConsent.cjs');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('the finish page is read only on Survey\'s own sites, exact origin and path', () => {
  assert.deepEqual(
    sheetSyncFinishFromUrl('https://surveytool.app/google-connected.html?provider=msgraph&result=finish&app=desktop#code=ABCD-EFGH'),
    { provider: 'msgraph', result: 'finish', code: 'ABCD-EFGH' },
  );
  assert.deepEqual(
    sheetSyncFinishFromUrl('https://surveytool-nightly.vercel.app/google-connected.html?result=cancelled'),
    { provider: 'google', result: 'cancelled', code: null },
  );
  assert.equal(sheetSyncFinishFromUrl('https://surveytool.app.evil.com/google-connected.html?result=finish#code=ABCD-EFGH'), null);
  assert.equal(sheetSyncFinishFromUrl('https://evil.com/google-connected.html?result=finish#code=ABCD-EFGH'), null);
  assert.equal(sheetSyncFinishFromUrl('https://surveytool.app/other.html?result=finish#code=ABCD-EFGH'), null);
  assert.equal(sheetSyncFinishFromUrl('not a url'), null);
  // A bad code is no code.
  assert.equal(sheetSyncFinishFromUrl('https://surveytool.app/google-connected.html?result=finish#code=nope').code, null);
});

function fakeChild(url = '') {
  const webContents = new EventEmitter();
  webContents.getURL = () => url;
  webContents.executeJavaScript = async () => null;
  const child = { webContents, closed: false, isDestroyed: () => child.closed, close: () => { child.closed = true; } };
  return child;
}

test('desktop: the consent window\'s last page hands the code to the app window and closes', async () => {
  const sent = [];
  const app = { isDestroyed: () => false, send: (channel, payload) => sent.push([channel, payload]) };
  const child = fakeChild();
  watchSheetSyncConsent(child, app, { closeDelayMs: 0 });
  child.webContents.emit('will-redirect', {}, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1');
  assert.equal(sent.length, 0, 'the provider\'s own pages are not the finish page');
  child.webContents.emit('will-redirect', {}, 'https://surveytool.app/google-connected.html?provider=msgraph&result=finish&app=desktop#code=WXYZ-2345');
  child.webContents.emit('did-navigate', {}, 'https://surveytool.app/google-connected.html?provider=msgraph&result=finish&app=desktop#code=WXYZ-2345');
  assert.deepEqual(sent, [['sheetSync:consent', { provider: 'msgraph', result: 'finish', code: 'WXYZ-2345' }]], 'sent once');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(child.closed, true);
});

test('desktop: a lost fragment is read back from what the page saved', async () => {
  const sent = [];
  const app = { isDestroyed: () => false, send: (channel, payload) => sent.push([channel, payload]) };
  const child = fakeChild('https://surveytool.app/google-connected.html?result=finish&app=desktop');
  child.webContents.executeJavaScript = async () => JSON.stringify({ provider: 'google', code: 'QRST-6789', at: 1 });
  watchSheetSyncConsent(child, app, { closeDelayMs: 0 });
  child.webContents.emit('did-navigate', {}, 'https://surveytool.app/google-connected.html?result=finish&app=desktop');
  assert.equal(sent.length, 0, 'no code yet: wait');
  child.webContents.emit('did-finish-load');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sent, [['sheetSync:consent', { provider: 'google', result: 'finish', code: 'QRST-6789' }]]);
});

test('desktop: a refusal is passed on and the window stays up to read', async () => {
  const sent = [];
  const app = { isDestroyed: () => false, send: (channel, payload) => sent.push([channel, payload]) };
  const child = fakeChild();
  watchSheetSyncConsent(child, app, { closeDelayMs: 0 });
  child.webContents.emit('did-navigate', {}, 'https://surveytool.app/google-connected.html?provider=msgraph&result=cancelled&app=desktop');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sent, [['sheetSync:consent', { provider: 'msgraph', result: 'cancelled', code: null }]]);
  assert.equal(child.closed, false);
});

test('phone: the app scheme link carries a well-formed code and nothing else', async () => {
  const { sheetSyncClaimFromUrl } = await import('../src/mobile/nativeDeepLinks.js');
  assert.deepEqual(sheetSyncClaimFromUrl('com.kalvoe.survey://sheet-connected?provider=msgraph&code=ABCD-EFGH'), { provider: 'msgraph', code: 'ABCD-EFGH' });
  assert.deepEqual(sheetSyncClaimFromUrl('com.kalvoe.survey://sheet-connected?provider=google&code=abcd-efgh'), { provider: 'google', code: 'ABCD-EFGH' });
  assert.equal(sheetSyncClaimFromUrl('com.kalvoe.survey://sheet-connected?provider=dropbox&code=ABCD-EFGH'), null);
  assert.equal(sheetSyncClaimFromUrl('com.kalvoe.survey://elsewhere?provider=google&code=ABCD-EFGH'), null);
  assert.equal(sheetSyncClaimFromUrl('https://surveytool.app/sheet-connected?provider=google&code=ABCD-EFGH'), null);
  assert.equal(sheetSyncClaimFromUrl('com.kalvoe.survey://sheet-connected?provider=google&code=ABCD'), null);
});

test('the claim is kept where the connect loop looks, fresh and per provider', () => {
  const storage = memoryStorage();
  const since = Date.now();
  assert.equal(rememberClaim('msgraph', 'ABCD-EFGH', storage), true);
  assert.equal(readClaim('msgraph', since, storage), 'ABCD-EFGH');
  assert.equal(readClaim('google', since, storage), null);
  assert.equal(readClaim('msgraph', Date.now() + 60_000, storage), null, 'older than the connect press');
  assert.equal(rememberClaim('msgraph', '<script>', storage), false);
  forgetClaim(storage);
  assert.equal(storage.getItem(CLAIM_KEY), null);
});

test('the desktop preload saves the code under the same key and shape', () => {
  const preload = readFileSync(new URL('../src/preload.js', import.meta.url), 'utf8');
  assert.match(preload, /ipcRenderer\.on\('sheetSync:consent'/);
  assert.match(preload, new RegExp(`setItem\\('${CLAIM_KEY}'`));
  const main = readFileSync(new URL('../src/electron-main.js', import.meta.url), 'utf8');
  assert.match(main, /did-create-window[\s\S]{0,200}watchSheetSyncConsent/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('src/electron/sheetSyncConsent.cjs'), 'packaged with the desktop app');
});

test('the phone apps answer the app scheme', () => {
  const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>com\.kalvoe\.survey<\/string>/);
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /android:scheme="com\.kalvoe\.survey" android:host="sheet-connected"/);
});

// ---- the server tells the last page which app pressed Connect -----------------

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
async function signState(secret, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`sheet-sync-state:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))));
  return `${body}.${sig}`;
}

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  GOOGLE_SHEETS_CLIENT_ID: 'id',
  GOOGLE_SHEETS_CLIENT_SECRET: 'google-secret',
  MS_GRAPH_CLIENT_ID: 'ms-id',
  MS_GRAPH_CLIENT_SECRET: 'ms-secret',
};

async function landing(path, client) {
  const secret = path.includes('msgraph') ? ENV.MS_GRAPH_CLIENT_SECRET : ENV.GOOGLE_SHEETS_CLIENT_SECRET;
  const state = await signState(secret, { u: 'user-1', o: 'https://surveytool.app', c: client, e: Date.now() + 60_000, n: 'n' });
  const res = await handleSheetSync(new Request(`https://x.supabase.co/functions/v1/sheet-sync${path}?state=${encodeURIComponent(state)}&error=access_denied`), { env: ENV });
  return res.headers.get('location');
}

test('the last page learns which app pressed Connect (phone and desktop only)', async () => {
  assert.equal(await landing('/oauth/callback', 'phone'), 'https://surveytool.app/google-connected.html?result=cancelled&app=phone');
  assert.equal(await landing('/oauth/callback', 'desktop'), 'https://surveytool.app/google-connected.html?result=cancelled&app=desktop');
  assert.equal(await landing('/oauth/callback', 'web'), 'https://surveytool.app/google-connected.html?result=cancelled');
  assert.equal(await landing('/oauth/callback', undefined), 'https://surveytool.app/google-connected.html?result=cancelled');
  assert.equal(await landing('/oauth/callback', 'evil&x=1'), 'https://surveytool.app/google-connected.html?result=cancelled');
  const ms = await landing('/oauth/msgraph/callback', 'phone');
  // A cancel may be Microsoft's "Need admin approval": the page offers the admin link.
  assert.equal(ms, `https://surveytool.app/google-connected.html?provider=msgraph&result=cancelled&app=phone&admin=${encodeURIComponent('https://x.supabase.co/functions/v1/sheet-sync/oauth/msgraph/admin')}`);
});
