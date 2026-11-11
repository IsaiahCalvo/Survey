import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { publicUpdateManifest, assertFeedVersion } from '../scripts/publish-app-downloads.mjs';
import { publicIncident } from '../scripts/publish-public-status.mjs';
import { distributionStore } from '../scripts/lib/public-distribution.mjs';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml');
const bytes = Buffer.from('installer bytes');
const name = 'survey Setup 0.1.48.exe';
const hash = createHash('sha512').update(bytes).digest('base64');
const manifest = (extra = {}) => yaml.dump({ version: '0.1.48', files: [{ url: name, sha512: hash, size: bytes.length }], path: name, sha512: hash, ...extra });

test('generic feed uses versioned files and preserves their verified checksums', () => {
  const result = yaml.load(publicUpdateManifest(manifest(), '0.1.48', new Map([[name, bytes]])));
  assert.equal(result.files[0].url, `v0.1.48/${name}`);
  assert.equal(result.path, result.files[0].url);
  assert.equal(result.sha512, hash);
});

test('a missing, changed or wrong-version installer cannot become an update', () => {
  assert.throws(() => publicUpdateManifest(manifest(), '0.1.48', new Map()), /missing/);
  assert.throws(() => publicUpdateManifest(manifest(), '0.1.48', new Map([[name, Buffer.from('changed')]])), /checksum/);
  assert.throws(() => publicUpdateManifest(manifest(), '0.1.49', new Map([[name, bytes]])), /version/);
  assert.throws(() => publicUpdateManifest(manifest({ path: '../secret' }), '0.1.48', new Map([[name, bytes]])), /missing/);
});

test('public incidents contain only a fixed kind, state and dates', () => {
  const result = publicIncident({ title: 'Alert: deploy failed: secret customer name', body: 'private log', user: { email: 'private@example.test' }, html_url: 'private url', state: 'open', created_at: '2026-11-11T12:00:00Z' });
  assert.deepEqual(result, { kind: 'update', state: 'open', created_at: '2026-11-11T12:00:00Z', closed_at: null });
  assert.equal(publicIncident({ title: 'surveytool.app is down' }).kind, 'outage');
});

test('publisher allows default NSIS installer and blockmap names', async () => {
  const store = await distributionStore({ SUPABASE_SERVICE_ROLE_KEY: 'test' }, async () => new Response('{}'));
  await store.put('desktop/v0.1.48/survey Setup 0.1.48.exe', bytes);
  await store.put('desktop/v0.1.48/survey Setup 0.1.48.exe.blockmap', bytes);
});

test('publisher rejects paths outside the separate public app bucket', async () => {
  let calls = 0;
  const store = await distributionStore({ SUPABASE_SERVICE_ROLE_KEY: 'test' }, async () => { calls++; return new Response('{}'); });
  for (const path of ['documents/private.pdf', '../secret', 'desktop/v0.1.48/customer.pdf', 'android/secret.apk', 'status.json/../secret']) {
    await assert.rejects(store.put(path, bytes), /allowlist/);
  }
  assert.equal(calls, 0);
});

test('publisher never overwrites a different immutable installer', async () => {
  const store = await distributionStore({ SUPABASE_SERVICE_ROLE_KEY: 'test' }, async (_url, options) => options?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'Duplicate' }), { status: 409 })
    : new Response('other bytes'));
  await assert.rejects(store.put(`desktop/v0.1.48/${name}`, bytes), /bump the app version/);
});

test('a late release job cannot replace a newer public update feed', () => {
  assert.doesNotThrow(() => assertFeedVersion('0.1.47', '0.1.48'));
  assert.doesNotThrow(() => assertFeedVersion('0.1.48', '0.1.48'));
  assert.throws(() => assertFeedVersion('0.2.0', '0.1.48'), /newer/);
  assert.throws(() => assertFeedVersion('bad', '0.1.48'), /invalid/);
});
