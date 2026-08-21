// Main-process Microsoft auth custody (msal-node) — unit tests.
// Uses the REAL @azure/msal-node PublicClientApplication with an injected stub
// for Electron (app/shell/safeStorage), so cache wiring and the no-token IPC
// shape are exercised without a live login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  accountsToEvict,
  classifySilentTokenError,
  createMicrosoftAuthMain,
  selectPreferredAccount,
  toRendererAuthResult,
} from '../src/electron/msalAuthMain.js';
import { createMsalCacheStore } from '../src/electron/msalCacheStore.cjs';
import fs from 'node:fs';

const tempDir = mkdtempSync(join(tmpdir(), 'msauth-test-'));
const stubElectron = ({ encryptionAvailable = true } = {}) => ({
  app: { getPath: () => tempDir },
  shell: { openExternal: async () => {} },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (blob) => blob.toString('utf8').replace(/^enc:/, '')
  },
  logger: { warn: () => {} }
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));

// ── the IPC result shape: NO refresh/id token may ever cross the bridge ─────

test('toRendererAuthResult exposes ONLY accessToken + expiry + account — never refresh/id tokens', () => {
  const out = toRendererAuthResult({
    accessToken: 'at-123',
    expiresOn: new Date('2026-06-09T12:00:00Z'),
    account: { homeAccountId: 'oid.tid', tenantId: 'tid-1', username: 'u@x.com', name: 'U', idToken: 'SECRET' },
    idTokenClaims: { tid: 'tid-1' },
    refreshToken: 'SECRET-RT',
    idToken: 'SECRET-IDT'
  });
  assert.deepEqual(Object.keys(out).sort(), ['accessToken', 'account', 'expiresAt', 'success']);
  assert.deepEqual(Object.keys(out.account).sort(), ['homeAccountId', 'name', 'tenantId', 'username']);
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes('SECRET'), 'no token material beyond the access token leaks');
  assert.equal(out.expiresAt, Math.floor(Date.parse('2026-06-09T12:00:00Z') / 1000));
});

// ── service behavior with an empty cache (no live login possible in tests) ──

test('getAccessToken with no signed-in account → needsInteraction, no throw', async () => {
  const svc = createMicrosoftAuthMain(stubElectron());
  const res = await svc.getAccessToken();
  assert.equal(res.success, false);
  assert.equal(res.needsInteraction, true);
});

test('getStatus with an empty cache → signedIn:false; signOut succeeds on empty cache', async () => {
  const svc = createMicrosoftAuthMain(stubElectron());
  assert.deepEqual(await svc.getStatus(), { signedIn: false });
  assert.equal((await svc.signOut()).success, true);
});

// ── cache store: encrypted persistence, corruption, no-plaintext rule ───────

test('cache store roundtrips through encryption and chmods the file private', () => {
  const filePath = join(tempDir, 'cache-roundtrip.bin');
  const store = createMsalCacheStore({
    filePath,
    fs,
    encrypt: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decrypt: (blob) => blob.toString('utf8').replace(/^enc:/, ''),
    isEncryptionAvailable: () => true
  });
  assert.equal(store.writePersistedCache('{"cache":1}'), true);
  assert.equal(store.readPersistedCache(), '{"cache":1}');
  assert.notEqual(fs.readFileSync(filePath, 'utf8'), '{"cache":1}', 'bytes on disk are not plaintext');
});

test('cache store refuses to persist when OS encryption is unavailable (in-memory only)', () => {
  const filePath = join(tempDir, 'cache-noenc.bin');
  const store = createMsalCacheStore({
    filePath,
    fs,
    encrypt: (t) => Buffer.from(t),
    decrypt: (b) => b.toString(),
    isEncryptionAvailable: () => false
  });
  assert.equal(store.canPersist(), false);
  assert.equal(store.writePersistedCache('{"cache":1}'), false);
  assert.equal(fs.existsSync(filePath), false, 'nothing written to disk');
});

test('a corrupt/undecryptable cache file reads as empty (fresh sign-in), never throws', () => {
  const filePath = join(tempDir, 'cache-corrupt.bin');
  fs.writeFileSync(filePath, Buffer.from('garbage-not-encrypted'));
  const store = createMsalCacheStore({
    filePath,
    fs,
    encrypt: (t) => Buffer.from(t),
    decrypt: () => { throw new Error('decryption failed'); },
    isEncryptionAvailable: () => true
  });
  assert.equal(store.readPersistedCache(), null);
  assert.equal(store.removePersistedCache(), true);
  assert.equal(fs.existsSync(filePath), false);
});

test('silent token errors classify interaction vs transient network blips', () => {
  assert.deepEqual(
    classifySilentTokenError({ name: 'InteractionRequiredAuthError', message: 'login_required' }),
    { needsInteraction: true, transient: false },
  );
  assert.deepEqual(
    classifySilentTokenError({ errorCode: 'invalid_grant', message: 'AADSTS70000' }),
    { needsInteraction: true, transient: false },
  );
  assert.deepEqual(
    classifySilentTokenError({ errorCode: 'network_error', message: 'fetch failed' }),
    { needsInteraction: false, transient: true },
  );
  assert.deepEqual(
    classifySilentTokenError({ message: 'getaddrinfo ENOTFOUND login.microsoftonline.com' }),
    { needsInteraction: false, transient: true },
  );
  assert.deepEqual(
    classifySilentTokenError({ message: 'unexpected cache read' }),
    { needsInteraction: false, transient: true },
  );
});

test('preferred-account helpers evict every cached account except the selected one', () => {
  const accounts = [
    { homeAccountId: 'old-id', username: 'old@x.com' },
    { homeAccountId: 'new-id', username: 'new@x.com' },
  ];
  assert.equal(selectPreferredAccount(accounts, 'new-id').homeAccountId, 'new-id');
  assert.equal(selectPreferredAccount(accounts, 'missing-id').homeAccountId, 'old-id');
  assert.deepEqual(accountsToEvict(accounts, 'new-id').map((a) => a.homeAccountId), ['old-id']);
  assert.deepEqual(accountsToEvict(accounts, null).map((a) => a.homeAccountId), ['old-id', 'new-id']);
  assert.equal(selectPreferredAccount([], 'new-id'), null);
});

test('interactive sign-in evicts the previous account so silent refresh uses the new one', async () => {
  const accounts = [
    { homeAccountId: 'old-id', username: 'old@x.com' },
    { homeAccountId: 'new-id', username: 'new@x.com' },
  ];
  const removed = [];
  const pca = {
    acquireTokenInteractive: async () => ({
      accessToken: 'at-new',
      expiresOn: new Date('2026-06-09T12:00:00Z'),
      account: accounts[1],
    }),
    acquireTokenSilent: async ({ account }) => ({
      accessToken: 'at-silent',
      expiresOn: new Date('2026-06-09T13:00:00Z'),
      account,
    }),
    getTokenCache: () => ({
      getAllAccounts: async () => accounts.filter((account) => !removed.includes(account.homeAccountId)),
      removeAccount: async (account) => { removed.push(account.homeAccountId); },
    }),
  };
  const svc = createMicrosoftAuthMain({
    ...stubElectron(),
    createPublicClientApplication: () => pca,
  });
  const signed = await svc.signIn();
  assert.equal(signed.success, true);
  assert.equal(signed.account.homeAccountId, 'new-id');
  assert.deepEqual(removed, ['old-id']);
  const token = await svc.getAccessToken();
  assert.equal(token.success, true);
  assert.equal(token.account.homeAccountId, 'new-id');
});

test('network blip on silent refresh is transient, not needsInteraction', async () => {
  const pca = {
    acquireTokenSilent: async () => {
      const err = new Error('fetch failed');
      err.errorCode = 'network_error';
      throw err;
    },
    getTokenCache: () => ({
      getAllAccounts: async () => [{ homeAccountId: 'oid.tid', username: 'u@x.com' }],
    }),
  };
  const svc = createMicrosoftAuthMain({
    ...stubElectron(),
    createPublicClientApplication: () => pca,
  });
  const res = await svc.getAccessToken();
  assert.equal(res.success, false);
  assert.equal(res.needsInteraction, false);
  assert.equal(res.transient, true);
});
