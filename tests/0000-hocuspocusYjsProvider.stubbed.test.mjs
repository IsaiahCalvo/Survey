/**
 * Tick-65: cover HocuspocusYjsProvider with a local stub package
 * (node_modules/@hocuspocus/provider — coverage-only, not a real dep).
 */
import { mock, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const supabaseUrl = pathToFileURL(resolve('src/supabaseClient.js')).href;
const sessionState = { mode: 'ok' };

before(() => {
  mock.module(supabaseUrl, {
    namedExports: {
      getSupabaseSession: async () => {
        if (sessionState.mode === 'throw') throw new Error('session-boom');
        if (sessionState.mode === 'null') return null;
        return { access_token: 'tok-65' };
      },
      supabase: {},
      isSupabaseAvailable: () => true,
    },
  });
});

test('createHocuspocusYjsProvider wires status/auth/token/disconnect', async () => {
  const { createHocuspocusYjsProvider } = await import('../src/lib/collab/HocuspocusYjsProvider.js');
  const { __lastProvider } = await import('@hocuspocus/provider');

  const states = [];
  const rejects = [];
  const ydoc = { __borrowed: true };

  const handle = await createHocuspocusYjsProvider({
    documentId: 'doc-65',
    ydoc,
    supabase: { auth: {} },
    url: 'wss://example.test/65',
    awareness: { __aw: true },
    onTransportState: (s) => states.push(s),
    onUpdateRejected: (r) => rejects.push(r),
  });

  const provider = __lastProvider.current;
  assert.ok(provider);
  assert.equal(provider.opts.url, 'wss://example.test/65');
  assert.equal(provider.opts.name, 'doc-65');
  assert.equal(provider.opts.document, ydoc);
  assert.equal(provider.opts.awareness.__aw, true);

  provider.opts.onStatus({ status: 'connected' });
  provider.opts.onStatus({ status: 'disconnected' });
  provider.opts.onStatus({ status: 'connecting' });
  provider.opts.onAuthenticationFailed({ reason: 'bad-jwt' });
  provider.opts.onAuthenticationFailed({});

  sessionState.mode = 'ok';
  assert.equal(await provider.opts.token(), 'tok-65');
  sessionState.mode = 'null';
  assert.equal(await provider.opts.token(), null);
  sessionState.mode = 'throw';
  assert.equal(await provider.opts.token(), null);
  sessionState.mode = 'ok';

  handle.disconnect();
  assert.equal(provider.destroyed, true);

  // destroy() throw is swallowed by disconnect()
  provider.opts.__throwOnDestroy = true;
  provider.destroyed = false;
  handle.disconnect();

  assert.ok(states.includes('online'));
  assert.ok(states.includes('offline'));
  assert.ok(rejects.includes('bad-jwt'));
  assert.ok(rejects.includes('authentication_failed'));

  // URL falls back when omitted
  await createHocuspocusYjsProvider({
    documentId: 'doc-65b',
    ydoc,
    supabase: { auth: {} },
  });
  assert.equal(__lastProvider.current.opts.url, 'wss://localhost:1234');
  assert.equal(typeof (await createHocuspocusYjsProvider({
    documentId: 'doc-65c',
    ydoc,
    supabase: { auth: {} },
  })).disconnect, 'function');
});
