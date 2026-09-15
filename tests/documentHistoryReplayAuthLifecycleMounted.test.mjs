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

async function loadAuthContext(key) {
  const file = new URL('../src/contexts/AuthContext.jsx', import.meta.url);
  let source = await readFile(file, 'utf8');
  source = source
    .replace("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
    .replace(/import \{\n  supabase,[\s\S]*?\n\} from '\.\.\/supabaseClient';/, `const { supabase, isSupabaseAvailable, getSupabaseSession, recoverSupabaseAuthSession } = globalThis[${JSON.stringify(key)}];`)
    .replace("import { requestAccountDeletion, unlinkOAuthProvider } from '../utils/accountPlatform';", 'const requestAccountDeletion = async () => {}; const unlinkOAuthProvider = async () => {};')
    .replace("import { startDocumentHistoryReplay } from '../services/documentHistoryReplay.js';", `const { startDocumentHistoryReplay } = globalThis[${JSON.stringify(key)}];`)
    .replaceAll('import.meta.env', '({ DEV: false })');
  const output = await transformWithOxc(source, fileURLToPath(file), { lang: 'jsx' });
  const code = output.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${key}`);
}

test('history replay starts once per signed-in actor and stops on account loss or unmount', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://auth-replay.test/' });
  const saved = new Map();
  const key = `__historyReplayAuth${crypto.randomUUID().replaceAll('-', '')}`;
  const state = {
    session: { user: { id: 'actor-a', email: 'a@example.test' } },
    authListener: null,
    starts: [],
    stops: [],
  };
  const install = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  install('window', dom.window); install('document', dom.window.document);
  install('IS_REACT_ACT_ENVIRONMENT', true);
  install(key, {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: state.session }, error: null }),
        onAuthStateChange: callback => {
          state.authListener = callback;
          return { data: { subscription: { unsubscribe() { state.authListener = null; } } } };
        },
      },
      from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }),
    },
    isSupabaseAvailable: () => true,
    getSupabaseSession: async () => state.session,
    recoverSupabaseAuthSession: async () => false,
    startDocumentHistoryReplay: input => {
      state.starts.push(input);
      let stopped = false;
      return () => {
        if (!stopped) { stopped = true; state.stops.push(input.actorUserId); }
      };
    },
  });
  t.after(() => {
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const mod = await loadAuthContext(key);
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(mod.AuthProvider, null, null)); });
  await act(async () => {});
  assert.deepEqual(state.starts.map(call => call.actorUserId), ['actor-a']);
  assert.equal(state.starts[0].isCurrent(), true);
  assert.equal(Object.hasOwn(state.starts[0], 'access_token'), false);

  state.session = { user: { id: 'actor-a', email: 'a@example.test' }, access_token: 'new-token' };
  await act(async () => state.authListener('TOKEN_REFRESHED', state.session));
  assert.deepEqual(state.starts.map(call => call.actorUserId), ['actor-a']);
  assert.deepEqual(state.stops, []);

  state.session = { user: { id: 'actor-b', email: 'b@example.test' } };
  await act(async () => state.authListener('SIGNED_IN', state.session));
  assert.deepEqual(state.starts.map(call => call.actorUserId), ['actor-a', 'actor-b']);
  assert.deepEqual(state.stops, ['actor-a']);
  assert.equal(state.starts[0].isCurrent(), false);

  state.session = null;
  await act(async () => state.authListener('SIGNED_OUT', null));
  assert.deepEqual(state.stops, ['actor-a', 'actor-b']);

  state.session = { user: { id: 'actor-a', email: 'a@example.test' } };
  await act(async () => state.authListener('SIGNED_IN', state.session));
  assert.deepEqual(state.starts.map(call => call.actorUserId), ['actor-a', 'actor-b', 'actor-a']);
  await act(async () => root.unmount());
  assert.deepEqual(state.stops, ['actor-a', 'actor-b', 'actor-a']);
});
