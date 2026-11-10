// Break tests for connecting Microsoft (thread "Break Microsoft sign-in and
// SharePoint connect", 2026-11-10). Each test is a way the connection broke or
// cost a click, checked against real Microsoft where it could be (a guest in
// Survey's M365 trial tenant) and pinned here with fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

import {
  buildMsgraphAdminConsentUrl, buildMsgraphAuthorizeUrl, fetchMsgraphDriveKind, msgraphAuthConfigFromEnv,
  refreshMsgraphToken, workLoginHint,
} from '../supabase/functions/_shared/sheetSync/msgraphAuth.js';
import { cleanFolder, handleSheetSync } from '../supabase/functions/_shared/sheetSync/service.js';
import { createMsGraphProvider } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';
import { finishSignInNow } from '../src/mobile/nativeDeepLinks.js';
import { CLAIM_KEY } from '../src/services/sheetSyncClaim.js';

const require = createRequire(import.meta.url);
const { watchSheetSyncConsent } = require('../src/electron/sheetSyncConsent.cjs');

const env = (values) => (name) => values[name];
const CONFIG = msgraphAuthConfigFromEnv(env({ MS_GRAPH_CLIENT_SECRET: 'shh', MS_GRAPH_REDIRECT_URI: 'https://x.supabase.co/functions/v1/sheet-sync/oauth/msgraph/callback' }));
const tokenReply = (reply, status) => async () => ({ ok: status < 300, status, json: async () => reply });

// ---- one click fewer, and the right account first time ------------------------

test('no forced account picker; the picker only for "Use another account"', () => {
  const plain = new URL(buildMsgraphAuthorizeUrl(CONFIG, 'st', { loginHint: 'pm@contoso.com' }));
  assert.equal(plain.searchParams.get('prompt'), null, 'one work account goes straight through');
  assert.equal(plain.searchParams.get('login_hint'), 'pm@contoso.com');
  const pick = new URL(buildMsgraphAuthorizeUrl(CONFIG, 'st', { loginHint: 'pm@contoso.com', pickAccount: true }));
  assert.equal(pick.searchParams.get('prompt'), 'select_account');
  assert.equal(pick.searchParams.get('login_hint'), null, 'the picker is not steered back to the same account');
});

test('a home email is never hinted (it sent Microsoft to a personal account)', () => {
  for (const home of ['bob@gmail.com', 'Bob@Outlook.com', 'a@hotmail.co.uk', 'x@icloud.com', 'y@live.com', 'z@yahoo.com', 'q@proton.me']) {
    assert.equal(workLoginHint(home), '', home);
  }
  assert.equal(workLoginHint('pm@kalvoe.onmicrosoft.com'), 'pm@kalvoe.onmicrosoft.com');
  assert.equal(workLoginHint('tech@eastern-data.com'), 'tech@eastern-data.com');
  assert.equal(workLoginHint('not an email'), '');
  assert.equal(new URL(buildMsgraphAuthorizeUrl(CONFIG, 'st', { loginHint: 'bob@gmail.com' })).searchParams.get('login_hint'), null);
});

// ---- tenants with strict rules ----------------------------------------------

test('the admin link opens Microsoft\'s approve-for-everyone page for work accounts', () => {
  const url = new URL(buildMsgraphAdminConsentUrl(CONFIG, 'adm'));
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/organizations/v2.0/adminconsent');
  assert.equal(url.searchParams.get('client_id'), '0da81a9e-2b05-46ee-b826-5efc5114c765');
  assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri, 'back to the callback that is already registered');
  assert.equal(url.searchParams.get('scope'), 'https://graph.microsoft.com/User.Read https://graph.microsoft.com/Files.ReadWrite.All');
  assert.equal(url.searchParams.get('state'), 'adm');
});

test('a company rule asking for a fresh sign-in (MFA, sign-in frequency) says to reconnect', async () => {
  for (const error of ['interaction_required', 'consent_required', 'login_required', 'invalid_grant']) {
    await assert.rejects(
      refreshMsgraphToken(CONFIG, 'r1', { fetch: tokenReply({ error }, 400) }),
      (e) => e.status === 401 && e.code === 'reconnect' && e.reason === error,
      error,
    );
  }
  await assert.rejects(refreshMsgraphToken(CONFIG, 'r1', { fetch: tokenReply({ error: 'interaction_required' }, 400) }), /company asks you to sign in/);
});

test('Survey\'s own app secret failing never throws away anyone\'s sign-in', async () => {
  for (const error of ['invalid_client', 'unauthorized_client']) {
    await assert.rejects(
      refreshMsgraphToken(CONFIG, 'r1', { fetch: tokenReply({ error }, 401) }),
      (e) => e.code === 'app_setup' && e.status === 503 && e.code !== 'reconnect',
    );
  }
  await assert.rejects(refreshMsgraphToken(CONFIG, 'r1', { fetch: tokenReply({ error: 'temporarily_unavailable' }, 503) }), (e) => e.code === 'temporarily_unavailable');
});

// ---- work, home and no-OneDrive accounts ----------------------------------

test('drive kind: work, home, and an account with no OneDrive (real guest: 401 accessDenied)', async () => {
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  assert.equal(await fetchMsgraphDriveKind('t', { fetch: reply(200, { driveType: 'business' }) }), 'business');
  assert.equal(await fetchMsgraphDriveKind('t', { fetch: reply(200, { driveType: 'personal' }) }), 'personal');
  for (const s of [401, 403, 404]) assert.equal(await fetchMsgraphDriveKind('t', { fetch: reply(s, { error: { code: 'accessDenied' } }) }), 'none');
  await assert.rejects(fetchMsgraphDriveKind('t', { fetch: reply(503, {}) }));
});

// ---- the callback ------------------------------------------------------------

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
async function signState(secret, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`sheet-sync-state:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))}`;
}
const ENV = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SHEET_SYNC_TOKEN_KEY: 'k'.repeat(32),
  MS_GRAPH_CLIENT_SECRET: 'ms-secret',
};
// A Microsoft that answers the token, /me/drive and /me calls; and a database
// that records what was parked.
function world({ driveType = 'business', driveStatus = 200 } = {}) {
  const parked = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/oauth2/v2.0/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'Files.ReadWrite.All User.Read' }) };
    if (u.includes('/me/drive')) return { ok: driveStatus < 300, status: driveStatus, json: async () => ({ driveType }) };
    if (u.includes('/me?')) return { ok: true, status: 200, json: async () => ({ id: 'm1', displayName: 'PM', mail: 'pm@contoso.com' }) };
    throw new Error(`unexpected ${u}`);
  };
  const table = { delete: () => ({ lt: async () => ({}) }), upsert: async (row) => { parked.push(row); return {}; } };
  const createClient = () => ({ from: () => table });
  return { parked, deps: { env: ENV, fetchImpl, createClient } };
}
async function back(deps, query) {
  const res = await handleSheetSync(new Request(`https://x.supabase.co/functions/v1/sheet-sync/oauth/msgraph/callback?${query}`), deps);
  assert.equal(res.status, 302);
  return new URL(res.headers.get('location'));
}
const stateFor = (extra = {}) => signState(ENV.MS_GRAPH_CLIENT_SECRET, { u: 'user-1', o: 'https://surveytool.app', c: 'web', e: Date.now() + 60_000, n: 'n', ...extra });

test('a home Microsoft account is turned back at once, with a one-click "Use another account"', async () => {
  const { parked, deps } = world({ driveType: 'personal' });
  const state = await stateFor();
  const to = await back(deps, `code=c1&state=${encodeURIComponent(state)}`);
  assert.equal(to.searchParams.get('result'), 'personal');
  assert.equal(parked.length, 0, 'nothing parked for a sign-in that can never sync');
  const retry = new URL(to.searchParams.get('retry'));
  assert.equal(retry.hostname, 'login.microsoftonline.com');
  assert.equal(retry.searchParams.get('prompt'), 'select_account');
  assert.equal(retry.searchParams.get('state'), state, 'the same Connect press carries on');
});

test('a work account parks its sign-in; one with no OneDrive too (it can save in SharePoint)', async () => {
  const work = world();
  const to = await back(work.deps, `code=c1&state=${encodeURIComponent(await stateFor())}`);
  assert.equal(to.searchParams.get('result'), 'finish');
  assert.match(to.hash, /^#code=[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(work.parked.length, 1);
  assert.equal(work.parked[0].account_email, 'pm@contoso.com');
  const guest = world({ driveStatus: 401 });
  const g = await back(guest.deps, `code=c1&state=${encodeURIComponent(await stateFor())}`);
  assert.equal(g.searchParams.get('result'), 'finish');
  assert.equal(g.searchParams.get('drive'), 'none');
  assert.equal(guest.parked.length, 1);
});

test('"Need admin approval" (comes back as a plain cancel) shows the admin link', async () => {
  const { deps } = world();
  const to = await back(deps, `error=access_denied&error_subcode=cancel&state=${encodeURIComponent(await stateFor())}`);
  assert.equal(to.searchParams.get('result'), 'cancelled');
  assert.equal(to.searchParams.get('admin'), 'https://x.supabase.co/functions/v1/sheet-sync/oauth/msgraph/admin');
});

test('the admin link redirects to Microsoft, and the admin lands on "Survey is approved"', async () => {
  const { deps } = world();
  const res = await handleSheetSync(new Request('https://x.supabase.co/functions/v1/sheet-sync/oauth/msgraph/admin'), deps);
  assert.equal(res.status, 302);
  const ms = new URL(res.headers.get('location'));
  assert.equal(ms.pathname, '/organizations/v2.0/adminconsent');
  const state = ms.searchParams.get('state');
  const yes = await back(deps, `admin_consent=True&tenant=t1&state=${encodeURIComponent(state)}`);
  assert.equal(yes.searchParams.get('result'), 'admin_approved');
  const no = await back(deps, `error=access_denied&state=${encodeURIComponent(state)}`);
  assert.equal(no.searchParams.get('result'), 'admin_declined');
});

test('a slow first sign-in (setting up MFA) still has 25 minutes', async () => {
  const { deps } = world();
  const state = await signState(ENV.MS_GRAPH_CLIENT_SECRET, { u: 'user-1', o: 'https://surveytool.app', e: Date.now() + 25 * 60_000, n: 'n' });
  assert.equal((await back(deps, `code=c&state=${encodeURIComponent(state)}`)).searchParams.get('result'), 'finish');
  const src = readFileSync(new URL('../supabase/functions/_shared/sheetSync/service.js', import.meta.url), 'utf8');
  assert.match(src, /const STATE_TTL_MS = 30 \* 60 \* 1000;/);
});

// ---- the finish page never becomes a stranger's redirect ----------------------

test('the finish page only links to Microsoft\'s sign-in and Survey\'s own admin link', () => {
  const html = readFileSync(new URL('../public/google-connected.html', import.meta.url), 'utf8');
  const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  const run = (search) => {
    const els = {};
    const el = (id) => (els[id] ||= { id, hidden: true, textContent: '', href: '', className: '', addEventListener() {} });
    const document = { title: '', getElementById: el };
    const location = { search, hash: '', pathname: '/google-connected.html', origin: 'https://surveytool.app' };
    const fn = new Function('document', 'location', 'localStorage', 'history', 'window', 'navigator', 'URL', 'URLSearchParams', 'setTimeout', 'setInterval', 'clearInterval', script);
    fn(document, location, { setItem() {}, getItem() { return null; } }, { replaceState() {} }, { addEventListener() {} }, {}, URL, URLSearchParams, () => {}, () => 0, () => {});
    return new Proxy(els, { get: (_t, id) => el(id) });
  };
  const evil = run('?provider=msgraph&result=personal&retry=' + encodeURIComponent('https://evil.example/login'));
  assert.equal(evil.retry.hidden, true, 'a stranger\'s address gets no button');
  const good = run('?provider=msgraph&result=personal&retry=' + encodeURIComponent('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?prompt=select_account'));
  assert.equal(good.retry.hidden, false);
  assert.match(good.retry.href, /^https:\/\/login\.microsoftonline\.com\//);
  const admin = run('?provider=msgraph&result=cancelled&admin=' + encodeURIComponent('https://x.supabase.co/functions/v1/sheet-sync/oauth/msgraph/admin'));
  assert.equal(admin.adminBox.hidden, false);
  assert.equal(admin.adminLink.textContent, 'https://x.supabase.co/functions/v1/sheet-sync/oauth/msgraph/admin');
  const fake = run('?provider=msgraph&result=cancelled&admin=' + encodeURIComponent('https://evil.example/phish'));
  assert.equal(fake.adminBox.hidden, true);
  assert.equal(run('?provider=msgraph&result=admin_approved').title.textContent, 'Survey is approved');
});

// ---- folders ("Save in") -------------------------------------------------------

test('folder names keep # and % (OneDrive allows them), and deep folders keep their depth', () => {
  assert.equal(cleanFolder('Jobs/Job #42/50% done'), 'Jobs/Job #42/50% done');
  assert.equal(cleanFolder('a:b/c*d'), 'a-b/c-d', 'characters OneDrive refuses still become -');
  const deep = Array.from({ length: 20 }, (_, i) => `L${i}`).join('/');
  assert.equal(cleanFolder(deep), deep, '20 levels: was cut to 12, so the file went to the wrong folder');
  assert.equal(cleanFolder('../x/./y'), 'x/y');
});

function graphFake(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = decodeURI(String(url).replace('https://graph.microsoft.com/v1.0/', ''));
    calls.push(`${init.method || 'GET'} ${path}`);
    for (const [match, reply] of routes) {
      if (match.test(`${init.method || 'GET'} ${path}`)) {
        const [status, body] = typeof reply === 'function' ? reply(path) : reply;
        return { ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) };
      }
    }
    return { ok: false, status: 500, headers: { get: () => null }, text: async () => '{}' };
  };
  return { calls, provider: createMsGraphProvider({ getAccessToken: async () => 'tok', fetch }) };
}

test('Save in: an account with no OneDrive is told to paste a SharePoint link', async () => {
  const { provider } = graphFake([[/me\/drive\/root\/children/, [401, { error: { code: 'accessDenied' } }]]]);
  assert.deepEqual(await provider.listFolders(''), { folders: [], places: [], noDrive: true });
  const unlicensed = graphFake([[/me\/drive\/root\/children/, [403, { error: { code: 'notAllowed' } }]]]);
  assert.equal((await unlicensed.provider.listFolders('')).noDrive, true);
  const badToken = graphFake([[/me\/drive\/root\/children/, [401, { error: { code: 'InvalidAuthenticationToken' } }]]]);
  await assert.rejects(badToken.provider.listFolders(''), (e) => e.status === 401, 'a token problem is not "no OneDrive"');
});

test('Save in: a SharePoint folder deleted since it was picked says so; a new OneDrive path is fine', async () => {
  const { provider } = graphFake([[/items\/GONE/, [404, { error: { code: 'itemNotFound' } }]], [/root:\/Survey:/, [404, { error: { code: 'itemNotFound' } }]]]);
  assert.deepEqual(await provider.listFolders('~b!team~GONE'), { folders: [], places: [], gone: true });
  assert.deepEqual(await provider.listFolders('Survey'), { folders: [], places: [] }, 'the default Survey folder is made on save');
});

test('Save in: a library with more folders than one look lists says so', async () => {
  let page = 0;
  const { provider } = graphFake([[/children/, () => {
    page += 1;
    return [200, { value: Array.from({ length: 200 }, (_, i) => ({ name: `F${page}-${i}`, folder: {} })), '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=${page}` }];
  }]]);
  const res = await provider.listFolders('');
  assert.equal(res.folders.length, 2000);
  assert.equal(res.more, true);
});

test('Make workbook: no OneDrive and a gone SharePoint folder get plain words, not "something went wrong"', async () => {
  const layout = { scopes: [] };
  const none = graphFake([[/GET me\/drive\?/, [401, { error: { code: 'accessDenied' } }]]]);
  await assert.rejects(none.provider.createFile({ title: 'X', layout }), (e) => e.code === 'no_onedrive' && /no OneDrive/.test(e.message));
  const gone = graphFake([
    [/GET drives\/b!team\?/, [200, { driveType: 'business' }]],
    [/PUT drives\/b!team\/items\/GONE/, [404, { error: { code: 'itemNotFound' } }]],
  ]);
  await assert.rejects(gone.provider.createFile({ title: 'X', layout, folder: '~b!team~GONE/Jobs' }), (e) => e.code === 'folder_gone' && /moved or deleted/.test(e.message));
  const viewOnly = graphFake([
    [/GET drives\/b!team\?/, [200, { driveType: 'business' }]],
    [/PUT drives\/b!team\/items\/RO/, [403, { error: { code: 'accessDenied' } }]],
  ]);
  await assert.rejects(viewOnly.provider.createFile({ title: 'X', layout, folder: '~b!team~RO' }), (e) => e.code === 'folder_gone' && /view that folder/.test(e.message));
  const lost = graphFake([[/GET drives\/b!lost\?/, [403, { error: { code: 'accessDenied' } }]]]);
  await assert.rejects(lost.provider.createFile({ title: 'X', layout, folder: '~b!lost~F' }), (e) => e.code === 'folder_gone');
});

test('Make workbook: a folder named "Job #42" is saved into, not next to', async () => {
  const { provider, calls } = graphFake([
    [/GET me\/drive\?/, [200, { driveType: 'business' }]],
    [/PUT me\/drive\/root:/, [201, { id: 'NEW', name: 'S.xlsx', webUrl: 'https://x', parentReference: { driveId: 'd1' } }]],
  ]);
  await provider.createFile({ title: 'S', layout: { scopes: [] }, folder: cleanFolder('Jobs/Job #42') });
  const put = calls.find((c) => c.startsWith('PUT'));
  assert.ok(put.includes('Job %2342/S.xlsx'), put);
});

// ---- the phone app and the desktop app return ----------------------------------

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('phone app reopened from the consent page: the sign-in finishes at once, kept if offline', async () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  try {
    const keep = () => globalThis.localStorage.setItem(CLAIM_KEY, JSON.stringify({ provider: 'msgraph', code: 'ABCD-EFGH', at: Date.now() }));
    keep();
    let asked = null;
    await finishSignInNow({ provider: 'msgraph', code: 'ABCD-EFGH' }, async (action, body) => { asked = [action, body]; return { ok: true }; });
    assert.deepEqual(asked, ['claim', { provider: 'msgraph', code: 'ABCD-EFGH' }]);
    assert.equal(globalThis.localStorage.getItem(CLAIM_KEY), null, 'done: forgotten');
    keep();
    await finishSignInNow({ provider: 'msgraph', code: 'ABCD-EFGH' }, async () => ({ error: 'Could not reach the sheet sync. Check your connection.' }));
    assert.notEqual(globalThis.localStorage.getItem(CLAIM_KEY), null, 'offline: kept for the panel to finish later');
    await finishSignInNow({ provider: 'msgraph', code: 'ABCD-EFGH' }, async () => ({ error: 'ran out', code: 'claim_expired' }));
    assert.equal(globalThis.localStorage.getItem(CLAIM_KEY), null, 'refused for good: forgotten');
  } finally {
    globalThis.localStorage = saved;
  }
});

test('desktop: after "Use another account" the same window\'s finish still reaches the app', () => {
  const sent = [];
  const webContents = new EventEmitter();
  webContents.getURL = () => '';
  webContents.executeJavaScript = async () => null;
  const child = { webContents, closed: false, isDestroyed: () => child.closed, close: () => { child.closed = true; } };
  watchSheetSyncConsent(child, { isDestroyed: () => false, send: (c, p) => sent.push(p) }, { closeDelayMs: 0 });
  webContents.emit('did-navigate', {}, 'https://surveytool.app/google-connected.html?provider=msgraph&result=personal&app=desktop');
  webContents.emit('did-finish-load');
  webContents.emit('did-navigate', {}, 'https://surveytool.app/google-connected.html?provider=msgraph&result=finish&app=desktop#code=WXYZ-2345');
  assert.deepEqual(sent.map((p) => p.result), ['personal', 'finish']);
  assert.equal(sent[1].code, 'WXYZ-2345');
});

// ---- the web panel's connect loop (source checks for the browser-only parts) ----

test('web: the sign-in tab opens on the click, before any await (pop-up blockers)', () => {
  const src = readFileSync(new URL('../src/components/SheetSyncButton.jsx', import.meta.url), 'utf8');
  const connect = src.slice(src.indexOf('const connect = useCallback'), src.indexOf('// The code typed from the consent page'));
  const open = connect.indexOf("window.open('', '_blank')");
  const firstAwait = connect.indexOf('await ');
  assert.ok(open > 0 && open < firstAwait, 'window.open comes before the first await');
  assert.match(connect, /setConsentLink\(\{ provider, url: res\.url \}\)/, 'a blocked window gets a tap-to-open link');
});

test('web: a claim that fails offline keeps its code; a used code with the account connected is a success', () => {
  const src = readFileSync(new URL('../src/components/SheetSyncButton.jsx', import.meta.url), 'utf8');
  const claim = src.slice(src.indexOf('const claimNow = useCallback'), src.indexOf('// A sign-in finished while this survey was closed'));
  assert.match(claim, /if \(!res\.code\) return \{ retry: true/);
  assert.ok(claim.indexOf('forgetClaim()') > claim.indexOf("sheetSyncCall('claim'"), 'the code is only forgotten after the server answered');
  assert.match(claim, /connected\) \{ forgetClaim\(\); apply\(s\); return \{ ok: true \}; \}/);
  assert.match(src, /window\.addEventListener\('storage', onStorage\)/, 'a code left after the loop gave up is still claimed');
});

// ---- many tabs, one sign-in: one Microsoft token call, not one per round -------

test('rounds reuse the Microsoft token between requests (was ~0.4 s and a DB write every 3 s)', async () => {
  const { encryptToken } = await import('../supabase/functions/_shared/sheetSync/tokenCrypto.js');
  const enc = await encryptToken('refresh-1', ENV.SHEET_SYNC_TOKEN_KEY);
  const builder = (table) => {
    const b = {
      select: () => b, eq: () => b, is: () => b, lt: () => b, order: () => b, limit: () => b,
      update: () => b, delete: () => b,
      maybeSingle: async () => ({ data: table === 'sheet_sync_connections' ? { refresh_token_enc: enc, account_email: 'pm@contoso.com' } : null }),
      then: (ok) => ok({ data: null, error: null }),
    };
    return b;
  };
  const createClient = (_url, key) => ({
    from: (table) => builder(table),
    rpc: async (name) => ({ data: name === 'can_use_nightly' ? true : {} }),
    auth: { getUser: async () => ({ data: { user: { id: 'cache-user', email: 'pm@contoso.com', is_anonymous: false } } }) },
    _key: key,
  });
  let tokenCalls = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/oauth2/v2.0/token')) { tokenCalls += 1; return { ok: true, status: 200, json: async () => ({ access_token: 'a1', refresh_token: `r${tokenCalls + 1}`, expires_in: 3600, scope: 'Files.ReadWrite.All' }) }; }
    if (u.includes('/children')) return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ value: [{ name: 'Jobs', folder: {} }] }) };
    throw new Error(`unexpected ${u}`);
  };
  const deps = { env: { ...ENV, SUPABASE_ANON_KEY: 'anon' }, createClient, fetchImpl };
  const ask = () => handleSheetSync(new Request('https://x.supabase.co/functions/v1/sheet-sync', {
    method: 'POST', headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'folders', provider: 'msgraph', folder: '' }),
  }), deps);
  for (let i = 0; i < 5; i += 1) {
    const res = await ask();
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).folders, ['Jobs']);
  }
  assert.equal(tokenCalls, 1, 'five requests, one token call');
});

// ---- Sign out acts at once and can be undone (owner's rule: act, then Undo) ---

// A small in-memory database: enough of the query builder for sign out + claim.
function memoryDb(tables) {
  const from = (name) => {
    const rows = (tables[name] ||= []);
    const filters = [];
    let op = 'select';
    let patch = null;
    const match = (r) => filters.every(([k, v]) => (k === '$lt' ? true : r[k] === v));
    const run = () => {
      if (op === 'delete') { tables[name] = rows.filter((r) => !match(r)); return { data: null, error: null }; }
      if (op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
      return { data: rows.filter(match), error: null };
    };
    const b = {
      select: () => b, order: () => b, limit: () => b, is: () => b,
      eq: (k, v) => { filters.push([k, v]); return b; },
      lt: () => { filters.push(['$lt']); return b; },
      delete: () => { op = 'delete'; return b; },
      update: (p) => { op = 'update'; patch = p; return b; },
      upsert: async (row) => {
        const key = name === 'sheet_sync_links' ? ['id'] : ['user_id', 'provider'];
        const i = rows.findIndex((r) => key.every((k) => r[k] === row[k]));
        if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ ...row });
        return { error: null };
      },
      maybeSingle: async () => ({ data: run().data?.[0] || null, error: null }),
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  };
  return { from };
}

test('Sign out of Microsoft stops at once and gives an Undo that brings every workbook back', async () => {
  const { encryptToken } = await import('../supabase/functions/_shared/sheetSync/tokenCrypto.js');
  const tables = {
    sheet_sync_connections: [{ user_id: 'u-out', provider: 'msgraph', account_email: 'pm@contoso.com', scopes: 'Files.ReadWrite.All', refresh_token_enc: await encryptToken('refresh-keep', ENV.SHEET_SYNC_TOKEN_KEY) }],
    sheet_sync_links: [
      { id: 'l1', connection_user_id: 'u-out', provider: 'msgraph', status: 'active' },
      { id: 'l2', connection_user_id: 'u-out', provider: 'msgraph', status: 'active' },
      { id: 'g1', connection_user_id: 'u-out', provider: 'google', status: 'active' },
    ],
  };
  const db = memoryDb(tables);
  const createClient = () => ({
    ...db,
    rpc: async (name) => ({ data: name === 'can_use_nightly' ? true : {} }),
    auth: { getUser: async () => ({ data: { user: { id: 'u-out', email: 'pm@contoso.com', is_anonymous: false } } }) },
  });
  const deps = { env: { ...ENV, SUPABASE_ANON_KEY: 'anon' }, createClient, fetchImpl: async (u) => { throw new Error(`unexpected ${u}`); } };
  const ask = async (body) => (await handleSheetSync(new Request('https://x.supabase.co/functions/v1/sheet-sync', {
    method: 'POST', headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), deps)).json();

  const out = await ask({ action: 'disconnect', provider: 'msgraph' });
  assert.equal(out.ok, true);
  assert.match(out.undoCode, /^[A-Z0-9]{8}$/);
  assert.equal(tables.sheet_sync_connections.length, 0, 'signed out at once');
  assert.deepEqual(tables.sheet_sync_links.map((l) => l.status), ['broken', 'broken', 'active'], 'only the Microsoft workbooks stop');

  const undo = await ask({ action: 'claim', provider: 'msgraph', code: out.undoCode });
  assert.equal(undo.ok, true);
  assert.equal(undo.email, 'pm@contoso.com');
  assert.equal(tables.sheet_sync_connections.length, 1, 'the same sign-in is back');
  const { decryptToken } = await import('../supabase/functions/_shared/sheetSync/tokenCrypto.js');
  assert.equal(await decryptToken(tables.sheet_sync_connections[0].refresh_token_enc, ENV.SHEET_SYNC_TOKEN_KEY), 'refresh-keep');
  assert.deepEqual(tables.sheet_sync_links.map((l) => l.status), ['active', 'active', 'active'], 'every workbook syncs again');
  assert.equal(tables.sheet_sync_pending_connections.length, 0, 'the undo code is used up');
});

test('the panel shows Undo after Sign out, and says when another account takes over', async () => {
  const src = readFileSync(new URL('../src/components/SheetSyncButton.jsx', import.meta.url), 'utf8');
  const out = src.slice(src.indexOf('const disconnect = useCallback'), src.indexOf('// Sync now waits for its own full round'));
  assert.match(out, /announceSignOut\(provider, res/);
  const claim = src.slice(src.indexOf('const claimNow = useCallback'), src.indexOf('// A sign-in finished while this survey was closed'));
  assert.match(claim, /announceAccountSwitch\(provider, res/);
  assert.match(readFileSync(new URL('../src/mobile/nativeDeepLinks.js', import.meta.url), 'utf8'), /announceAccountSwitch\(/, 'the phone app finishes sign-in itself, so it says it too');

  const shown = [];
  globalThis.window = { dispatchEvent: (e) => { shown.push(e.detail); return true; } };
  globalThis.CustomEvent ||= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  try {
    const { announceSignOut, announceAccountSwitch } = await import('../src/services/sheetSyncNotices.js');
    const calls = [];
    const call = async (action, body) => { calls.push([action, body]); return { ok: true }; };
    let refreshed = 0;
    assert.equal(announceSignOut('msgraph', { ok: true }), null, 'no code, no Undo to offer');
    announceSignOut('msgraph', { ok: true, undoCode: 'ABCD2345' }, { call, onDone: () => { refreshed += 1; } });
    assert.equal(shown[0].message, 'Signed out of Microsoft. Live sync stopped.');
    assert.equal(shown[0].action.label, 'Undo');
    await shown[0].action.onClick();
    assert.deepEqual(calls[0], ['claim', { provider: 'msgraph', code: 'ABCD2345' }]);
    assert.equal(refreshed, 1);

    assert.equal(announceAccountSwitch('msgraph', { ok: true, email: 'pm@contoso.com' }), null, 'same account: nothing to say');
    announceAccountSwitch('msgraph', { email: 'new@contoso.com', replaced: { email: 'old@contoso.com', workbooks: 3, undoCode: 'WXYZ6789' } }, { call });
    assert.equal(shown[1].message, 'Now signed in as new@contoso.com; the 3 workbooks you linked with old@contoso.com sync with it now.');
    await shown[1].action.onClick();
    assert.deepEqual(calls[1], ['claim', { provider: 'msgraph', code: 'WXYZ6789' }]);
    announceAccountSwitch('msgraph', { email: 'new@contoso.com', replaced: { email: 'old@contoso.com', workbooks: 0 } });
    assert.equal(shown[2].message, 'Now signed in as new@contoso.com instead of old@contoso.com.');
    assert.equal(shown[2].action, undefined);
  } finally {
    delete globalThis.window;
  }
});

test('signing in with a different Microsoft account says how many workbooks move, and Undo puts the old one back', async () => {
  const { encryptToken, decryptToken } = await import('../supabase/functions/_shared/sheetSync/tokenCrypto.js');
  const tables = {
    sheet_sync_connections: [{ user_id: 'user-1', provider: 'msgraph', account_email: 'Old@Contoso.com', scopes: 'Files.ReadWrite.All', refresh_token_enc: await encryptToken('refresh-old', ENV.SHEET_SYNC_TOKEN_KEY) }],
    sheet_sync_links: [
      { id: 'l1', connection_user_id: 'user-1', provider: 'msgraph', status: 'active' },
      { id: 'l2', connection_user_id: 'user-1', provider: 'msgraph', status: 'active' },
    ],
  };
  const db = memoryDb(tables);
  const createClient = () => ({
    ...db,
    rpc: async (name) => ({ data: name === 'can_use_nightly' ? true : {} }),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'pm@contoso.com', is_anonymous: false } } }) },
  });
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/oauth2/v2.0/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'a', refresh_token: 'refresh-new', expires_in: 3600, scope: 'Files.ReadWrite.All' }) };
    if (u.includes('/me/drive')) return { ok: true, status: 200, json: async () => ({ driveType: 'business' }) };
    if (u.includes('/me?')) return { ok: true, status: 200, json: async () => ({ id: 'm2', mail: 'new@contoso.com' }) };
    throw new Error(`unexpected ${u}`);
  };
  const deps = { env: { ...ENV, SUPABASE_ANON_KEY: 'anon' }, createClient, fetchImpl };
  const to = await back(deps, `code=c1&state=${encodeURIComponent(await stateFor())}`);
  const code = to.hash.replace('#code=', '').replace('-', '');
  const ask = async (body) => (await handleSheetSync(new Request('https://x.supabase.co/functions/v1/sheet-sync', {
    method: 'POST', headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), deps)).json();

  const switched = await ask({ action: 'claim', provider: 'msgraph', code });
  assert.equal(switched.email, 'new@contoso.com');
  assert.equal(switched.replaced.email, 'Old@Contoso.com');
  assert.equal(switched.replaced.workbooks, 2);
  assert.ok(switched.replaced.undoCode);

  const undo = await ask({ action: 'claim', provider: 'msgraph', code: switched.replaced.undoCode });
  assert.equal(undo.email, 'Old@Contoso.com');
  assert.equal(await decryptToken(tables.sheet_sync_connections[0].refresh_token_enc, ENV.SHEET_SYNC_TOKEN_KEY), 'refresh-old');

  // The same account again (a fresh sign-in, case aside): nothing to warn about.
  const again = await back(deps, `code=c2&state=${encodeURIComponent(await stateFor())}`);
  tables.sheet_sync_connections[0].account_email = 'NEW@contoso.com';
  const same = await ask({ action: 'claim', provider: 'msgraph', code: again.hash.replace('#code=', '').replace('-', '') });
  assert.equal(same.ok, true);
  assert.equal(same.replaced, undefined);
});

// ---- a device clock that is hours off --------------------------------------

test('"Synced … ago" uses the server\'s clock: a phone 3 h slow or fast still reads "just now"', async () => {
  const { linkSyncedAgo, syncedAgo } = await import('../src/services/sheetSyncTime.js');
  const serverNow = Date.parse('2026-11-10T15:00:00Z');
  const link = { lastRoundAt: new Date(serverNow - 2000).toISOString(), lastRoundAgoMs: 2000 };
  for (const skew of [-3 * 3600_000, 0, 3 * 3600_000]) {
    const deviceNow = serverNow + skew;
    const got = { ...link, receivedAt: deviceNow };
    assert.equal(linkSyncedAgo(got, deviceNow), 'just now', `skew ${skew}`);
    assert.equal(linkSyncedAgo(got, deviceNow + 120_000), '2 min ago', `skew ${skew}, two minutes on`);
  }
  // Before: the device clock alone was used.
  assert.equal(syncedAgo(link.lastRoundAt, serverNow + 3 * 3600_000), '3 h ago');
  // An old server answer without the age falls back to the device clock.
  assert.equal(linkSyncedAgo({ lastRoundAt: link.lastRoundAt }, serverNow + 10_000), '12 s ago');
  assert.equal(linkSyncedAgo({}), '');
  const src = readFileSync(new URL('../supabase/functions/_shared/sheetSync/service.js', import.meta.url), 'utf8');
  assert.match(src, /lastRoundAgoMs: link\.last_round_at \?/);
});
