import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
let sequence = 0;
const row = id => ({ user_id: id, is_connected: true, account_id: `ms-${id}`, account_email: `${id}@example.test`, account_name: id,
  metadata: { access_token: `test-token-${id}`, refresh_token: `test-refresh-${id}`, expires_at: Date.now() / 1000 + 7200, tenant_id: 'test-tenant' } });

async function mount(t, { deferredReads = false, main = null, loadGraphClient = null, rows = null } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  const previous = new Map();
  const state = { user: { id: 'a' }, rows: { a: row('a'), b: row('b') }, reads: [], writes: [], intervals: new Map(), nextTimer: 0, fetch: async () => { throw new Error('Unexpected network call'); } };
  if (rows) state.rows = rows;
  const key = `__microsoftIsolation${++sequence}`;
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true, [key]: state })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  if (main) dom.window.electronAPI = main;
  state.Client = { init: ({ authProvider }) => ({ token: () => new Promise((resolve, reject) => authProvider((error, token) => error ? reject(error) : resolve(token))) }) };
  state.loadGraphClient = loadGraphClient || (async () => ({ Client: state.Client }));
  state.supabase = {
    from(table) {
      let userId;
      let operation = null;
      let payload;
      const builder = {
        select: () => builder,
        eq: (column, value) => { if (column === 'user_id') userId = value; return builder; },
        upsert: data => { operation = 'upsert'; payload = data; return builder; },
        update: data => { operation = 'update'; payload = data; return builder; },
        delete: () => { operation = 'delete'; return builder; },
        maybeSingle: () => deferredReads ? new Promise(resolve => state.reads.push({ userId, resolve })) : Promise.resolve({ data: state.rows[userId] || null }),
        then(resolve, reject) { state.writes.push({ table, userId, operation, payload }); return Promise.resolve({ error: null }).then(resolve, reject); },
      };
      return builder;
    },
  };
  const url = new URL('../src/contexts/MSGraphContext.jsx', import.meta.url);
  let source = await readFile(url, 'utf8');
  source = `const state = globalThis[${JSON.stringify(key)}];
    const fetch = (...args) => state.fetch(...args);
    const setInterval = callback => { const id = ++state.nextTimer; state.intervals.set(id, callback); return id; };
    const clearInterval = id => state.intervals.delete(id);
    ${source}`;
  source = source
    .replace("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
    .replace("import { useAuth } from './AuthContext';", 'const useAuth = () => ({ user: state.user });')
    .replace("import { supabase, isSupabaseAvailable } from '../supabaseClient';", 'const supabase = state.supabase; const isSupabaseAvailable = () => true;')
    .replaceAll("'../services/microsoftConnectionMarker'", JSON.stringify(new URL('../src/services/microsoftConnectionMarker.js', import.meta.url).href))
    .replaceAll("'../utils/microsoftOAuthRouting'", JSON.stringify(new URL('../src/utils/microsoftOAuthRouting.js', import.meta.url).href))
    .replace("await import('@microsoft/microsoft-graph-client')", 'await state.loadGraphClient()');
  const transformed = await transformWithOxc(source, fileURLToPath(url), { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${sequence}`);
  let latest;
  function Probe() { latest = mod.useMSGraph(); return null; }
  const root = createRoot(document.getElementById('root'));
  const render = async () => act(async () => root.render(React.createElement(mod.MSGraphProvider, null, React.createElement(Probe))));
  await render();
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { state, render, latest: () => latest, unmount };
}

test('sign-out clears Microsoft state and prevents old Graph clients from acquiring any token', async t => {
  const h = await mount(t);
  const oldClient = h.latest().graphClient;
  assert.equal(await oldClient.token(), 'test-token-a');
  h.state.user = null;
  await h.render();
  assert.equal(h.latest().account, null);
  assert.equal(h.latest().graphClient, null);
  assert.equal(h.latest().isAuthenticated, false);
  await assert.rejects(oldClient.token(), /No access token/);
});

test('late account-A restore cannot replace account-B connection', async t => {
  const h = await mount(t, { deferredReads: true });
  h.state.user = { id: 'b' };
  await h.render();
  await act(async () => h.state.reads.find(read => read.userId === 'b').resolve({ data: row('b') }));
  await act(async () => h.state.reads.find(read => read.userId === 'a').resolve({ data: row('a') }));
  assert.equal(h.latest().account.homeAccountId, 'ms-b');
  assert.equal(await h.latest().graphClient.token(), 'test-token-b');
  assert.equal(h.state.writes.length, 0);
});

test('device-wide Microsoft cache is not silently linked to a different Survey account', async t => {
  let acquired = 0;
  const h = await mount(t, { main: {
    microsoftSignIn() {},
    microsoftAuthStatus: async () => ({ signedIn: true, account: { homeAccountId: 'other-ms' } }),
    microsoftGetAccessToken: async () => { acquired++; return { success: true, accessToken: 'other-token', account: { homeAccountId: 'other-ms' } }; },
  } });
  assert.equal(acquired, 0);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.latest().account.homeAccountId, 'ms-a', 'existing legacy link remains scoped to this Survey user');
});

test('late explicit Microsoft sign-in after Survey account change is discarded', async t => {
  let complete;
  const h = await mount(t, { main: {
    microsoftSignIn: () => new Promise(resolve => { complete = resolve; }),
    microsoftAuthStatus: async () => ({ signedIn: false }),
  } });
  let login;
  await act(async () => { login = h.latest().login(); });
  h.state.user = { id: 'b' };
  await h.render();
  await act(async () => { complete({ success: true, accessToken: 'late-a', account: { homeAccountId: 'late-ms-a' } }); await login; });
  assert.equal(h.latest().account.homeAccountId, 'ms-b');
  assert.equal(h.state.writes.length, 0);
});

test('late refresh response cannot replace another account token or save its metadata', async t => {
  const h = await mount(t);
  let complete;
  h.state.fetch = () => new Promise(resolve => { complete = resolve; });
  let refresh;
  await act(async () => { refresh = [...h.state.intervals.values()][0](); });
  h.state.user = { id: 'b' };
  await h.render();
  await act(async () => {
    complete({ ok: true, json: async () => ({ access_token: 'late-a', refresh_token: 'late-refresh-a', expires_in: 3600 }) });
    await refresh;
  });
  assert.equal(await h.latest().graphClient.token(), 'test-token-b');
  assert.equal(h.state.writes.length, 0);
});

test('unmount invalidates a retained Graph client', async t => {
  const h = await mount(t);
  const client = h.latest().graphClient;
  await h.unmount();
  await assert.rejects(client.token(), /No access token/);
});

test('unmount also invalidates a new session created by an explicit Microsoft login', async t => {
  const h = await mount(t, { main: {
    microsoftSignIn: async () => ({ success: true, accessToken: 'explicit-token', expiresAt: Date.now() / 1000 + 3600, account: { homeAccountId: 'explicit-ms' } }),
    microsoftAuthStatus: async () => ({ signedIn: false }),
  } });
  const oldClient = h.latest().graphClient;
  await act(async () => h.latest().login());
  const client = h.latest().graphClient;
  assert.equal(await client.token(), 'explicit-token');
  await assert.rejects(oldClient.token(), /No access token/);
  await h.unmount();
  await assert.rejects(client.token(), /No access token/);
});

test('a Survey user without a link never adopts the device-wide Microsoft account', async t => {
  const h = await mount(t, { rows: {}, main: {
    microsoftSignIn() {},
    microsoftAuthStatus: async () => ({ signedIn: true, account: { homeAccountId: 'somebody-else' } }),
    microsoftGetAccessToken: async () => { throw new Error('Must not request an unrelated account token'); },
  } });
  assert.equal(h.latest().isAuthenticated, false);
  assert.equal(h.latest().account, null);
  assert.equal(h.state.writes.length, 0);
});

test('web OAuth callback is bound to the Survey user who began sign-in', async t => {
  const h = await mount(t);
  sessionStorage.setItem('ms_oauth_state', 'state');
  sessionStorage.setItem('ms_pkce_verifier', 'verifier');
  sessionStorage.setItem('ms_oauth_survey_user_id', 'different-user');
  window.history.replaceState({}, '', '?code=code&state=state');
  let fetches = 0;
  h.state.fetch = async () => { fetches++; throw new Error('must not exchange'); };
  await act(async () => h.latest().handleOAuthCallback());
  assert.equal(fetches, 0);
  assert.match(h.latest().error, /Survey account changed/);
  assert.equal(h.state.writes.length, 0);
});
