// KAL-308a — unit tests for the server signing-secret client.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchOrCreateSigningSecret,
  fetchSigningSecret,
  hasServerSigningKey,
  clearSigningSecretCache,
} from '../rowIdServerSecretClient.js';
import { generateRowIdToken, classifyRowIdToken } from '../rowIdToken.js';

function makeFakeClient(responder) {
  const calls = [];
  return {
    calls,
    rpc: async (name, params) => {
      calls.push({ name, params });
      return responder(name, params, calls.length);
    },
  };
}

const okRow = (over = {}) => ({
  data: [{ key_id: 'k1', secret_b64: 'AAAAisarealbase64stringAAAA', signing_doc_id: 'sid', ...over }],
  error: null,
});

beforeEach(() => clearSigningSecretCache());

test('fetchOrCreateSigningSecret: shapes the row + sends the seed', async () => {
  const client = makeFakeClient(() => okRow());
  const r = await fetchOrCreateSigningSecret('doc1', 'uuid:file.pdf', { supabaseClient: client });
  assert.deepEqual(r, { keyId: 'k1', secret: 'AAAAisarealbase64stringAAAA', signingDocId: 'sid' });
  assert.equal(client.calls[0].name, 'kal308a_get_or_create_signing_secret');
  assert.equal(client.calls[0].params.p_document_id, 'doc1');
  assert.equal(client.calls[0].params.p_signing_id_seed, 'uuid:file.pdf');
});

test('fetchOrCreateSigningSecret: throws on RPC error (caller writes blank Row IDs)', async () => {
  const client = makeFakeClient(() => ({ data: null, error: { message: 'permission denied' } }));
  await assert.rejects(
    () => fetchOrCreateSigningSecret('doc1', 'seed', { supabaseClient: client }),
    /permission denied/,
  );
});

test('fetchOrCreateSigningSecret: requires documentId + seed', async () => {
  await assert.rejects(() => fetchOrCreateSigningSecret('', 'seed'), /documentId required/);
  await assert.rejects(() => fetchOrCreateSigningSecret('doc1', ''), /signingIdSeed required/);
});

test('fetchSigningSecret: parallel resolution fires ONE rpc (storm fix), then caches', async () => {
  let n = 0;
  const client = makeFakeClient(() => { n += 1; return okRow({ secret_b64: 'BBBBparallelsecretBBBB' }); });
  const [a, b, c] = await Promise.all([
    fetchSigningSecret('docM', { supabaseClient: client }),
    fetchSigningSecret('docM', { supabaseClient: client }),
    fetchSigningSecret('docM', { supabaseClient: client }),
  ]);
  assert.equal(n, 1, 'three parallel calls must collapse to one RPC');
  assert.deepEqual(a, { keyId: 'k1', secret: 'BBBBparallelsecretBBBB', signingDocId: 'sid' });
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  await fetchSigningSecret('docM', { supabaseClient: client }); // cached
  assert.equal(n, 1, 'a subsequent call must hit the cache');
});

test('fetchSigningSecret: no server key (empty rows) → null, not cached', async () => {
  const client = makeFakeClient(() => ({ data: [], error: null }));
  assert.equal(await fetchSigningSecret('docX', { supabaseClient: client }), null);
  await fetchSigningSecret('docX', { supabaseClient: client });
  assert.equal(client.calls.length, 2, 'null results must not be cached (a later mint can succeed)');
});

test('fetchSigningSecret: RPC error → null (key-unavailable → review), not cached', async () => {
  const client = makeFakeClient(() => ({ data: null, error: { message: 'offline' } }));
  assert.equal(await fetchSigningSecret('docX', { supabaseClient: client }), null);
});

test('hasServerSigningKey: true / false / throws on error', async () => {
  assert.equal(await hasServerSigningKey('d', { supabaseClient: makeFakeClient(() => ({ data: true, error: null })) }), true);
  assert.equal(await hasServerSigningKey('d', { supabaseClient: makeFakeClient(() => ({ data: false, error: null })) }), false);
  await assert.rejects(
    () => hasServerSigningKey('d', { supabaseClient: makeFakeClient(() => ({ data: null, error: { message: 'boom' } })) }),
    /boom/,
  );
});

test('S3 guard: a base64-STRING secret round-trips through generateRowIdToken/classifyRowIdToken', async () => {
  // Exactly the shape the server stores/returns: base64 of 32 random bytes, used
  // directly as the HMAC key string. Proves the JS HMAC keys on the base64 string.
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const secret = btoa(bin); // 44-char base64 string, same as server secret_b64

  const signingDocId = 'doc-uuid-1234:floorplan.pdf'; // the FROZEN signing id
  const token = await generateRowIdToken({
    keyId: 'k1', secret, documentId: signingDocId, scopeId: 'mod7:cat3', markerId: 'marker-abc',
  });
  const verdict = await classifyRowIdToken(token, {
    documentId: signingDocId,
    scopeId: 'mod7:cat3',
    resolveSecret: (kid) => (kid === 'k1' ? secret : null),
  });
  assert.equal(verdict.status, 'valid');
  assert.equal(verdict.markerId, 'marker-abc');
});

test('S3 guard: wrong signingDocId classifies foreign (build-note 1 — must pass frozen id)', async () => {
  const secret = btoa('0123456789abcdef0123456789abcdef'); // any base64-ish string
  const token = await generateRowIdToken({
    keyId: 'k1', secret, documentId: 'frozen:id', scopeId: 's', markerId: 'm',
  });
  const verdict = await classifyRowIdToken(token, {
    documentId: 'current:composite', // WRONG — not the frozen id
    scopeId: 's',
    resolveSecret: () => secret,
  });
  assert.equal(verdict.status, 'foreign');
});
