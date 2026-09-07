import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageDownloads, storageDownloads } from '../src/services/storageDownloads.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('ten concurrent reads share one transfer, but a later read rechecks storage', async () => {
  const reads = createStorageDownloads();
  let calls = 0;
  const download = async () => { calls++; return new Blob(['pdf']); };
  const blobs = await Promise.all(Array.from({ length: 10 }, () => reads.read('a', 'p', download)));
  assert.equal(calls, 1);
  assert.ok(blobs.every(blob => blob === blobs[0]));
  await reads.read('a', 'p', download);
  assert.equal(calls, 2, 'settled bytes are not an authorization cache');
});

test('users, paths, and Supabase clients never share pending private reads', async () => {
  const reads = createStorageDownloads();
  let calls = 0;
  const download = async () => ++calls;
  assert.deepEqual(await Promise.all([
    reads.read('a', 'p', download), reads.read('b', 'p', download), reads.read('a', 'q', download),
  ]), [1, 2, 3]);
  assert.notEqual(storageDownloads({}), storageDownloads({}));
});

test('failed reads can retry and errors reach every waiting caller', async () => {
  const reads = createStorageDownloads();
  const error = new Error('offline');
  const results = await Promise.allSettled([
    reads.read('a', 'p', () => { throw error; }), reads.read('a', 'p', () => 'unreachable'),
  ]);
  assert.ok(results.every(result => result.reason === error));
  assert.equal(await reads.read('a', 'p', () => 'recovered'), 'recovered');
});

test('write invalidation and late old completion cannot erase a new pending read', async () => {
  const reads = createStorageDownloads();
  const old = deferred(), fresh = deferred();
  const first = reads.read('a', 'p', () => old.promise);
  reads.invalidate('p');
  const second = reads.read('a', 'p', () => fresh.promise);
  old.resolve('old');
  await first;
  assert.equal(reads.read('a', 'p', () => { throw new Error('duplicate'); }), second);
  fresh.resolve('fresh');
  assert.equal(await second, 'fresh');
});

test('auth events break pending sharing even for the same actor id', async () => {
  let callback;
  const client = { auth: { onAuthStateChange(fn) { callback = fn; } } };
  const reads = storageDownloads(client);
  assert.equal(storageDownloads(client), reads);
  const first = reads.read('a', 'p', () => 'old');
  callback('SIGNED_OUT', null);
  const second = reads.read('a', 'p', () => 'new');
  assert.notEqual(first, second);
  assert.equal(await second, 'new');
  await assert.rejects(first, { name: 'AbortError' });
});

test('initial session and same-user token refresh keep a pending transfer shared', async () => {
  let callback;
  const client = { auth: { onAuthStateChange(fn) { callback = fn; } } };
  const reads = storageDownloads(client);
  const first = reads.read('a', 'p', () => 'pdf');
  callback('INITIAL_SESSION', { user: { id: 'a' } });
  callback('TOKEN_REFRESHED', { user: { id: 'a' } });
  assert.equal(reads.read('a', 'p', () => 'duplicate'), first);
  assert.equal(await first, 'pdf');
});
