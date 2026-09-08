import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalStorageStatus, requestLocalStoragePersistence } from '../src/services/localStorageStatus.js';
const host = storage => ({ navigator: { storage }, isSecureContext: true, location: { protocol: 'https:' } });
test('status reads independent estimates without requesting permission or blocking writes', async () => {
  let requests = 0;
  const status = await readLocalStorageStatus(host({ estimate: async () => ({ usage: 95, quota: 100 }), persisted: async () => false, persist: () => { requests++; } }));
  assert.equal(requests, 0); assert.equal(status.persistence, 'best-effort'); assert.equal(status.pressure, true); assert.equal(status.canRequest, true);
});
test('missing, denied, invalid and throwing storage data stays unknown instead of zero', async () => {
  for (const storage of [null, { estimate: () => Promise.reject(new Error('blocked')) }, { estimate: async () => ({ usage: NaN, quota: -1 }) }, { get estimate() { throw new Error('denied'); } }]) {
    const result = await readLocalStorageStatus(host(storage));
    assert.equal(result.usage, null); assert.equal(result.quota, null); assert.equal(result.pressure, false); assert.equal(result.persistence, 'unknown');
  }
  const result = await readLocalStorageStatus({ get navigator() { throw new Error('restricted'); } });
  assert.equal(result.usage, null);
});
test('native profiles never request or claim browser eviction protection', async () => {
  let calls = 0;
  const win = { ...host({ estimate: async () => ({ usage: 1, quota: 4 }), persisted: () => { calls++; return true; }, persist: () => { calls++; return true; } }), electronAPI: {} };
  assert.equal((await readLocalStorageStatus(win)).persistence, 'profile');
  assert.equal(await requestLocalStoragePersistence(win), 'unavailable'); assert.equal(calls, 0);
});
test('explicit request distinguishes granted, denied and failed and binds the native receiver', async () => {
  for (const [value, expected] of [[true, 'granted'], [false, 'denied'], [undefined, 'unknown']]) {
    const storage = { persist() { assert.equal(this, storage); return Promise.resolve(value); } };
    assert.equal(await requestLocalStoragePersistence(host(storage)), expected);
  }
  assert.equal(await requestLocalStoragePersistence(host({ persist() { throw new Error('disabled'); } })), 'unknown');
  assert.equal(await requestLocalStoragePersistence({ ...host({ persist() { throw new Error('must not call'); } }), isSecureContext: false }), 'unavailable');
});
test('hanging estimates and prompts have bounded unknown results and late grants cannot mutate them', async () => {
  let finish;
  const win = host({ estimate: () => new Promise(() => {}), persisted: async () => true, persist: () => new Promise(resolve => { finish = resolve; }) });
  const status = await readLocalStorageStatus(win, { timeoutMs: 5 });
  assert.equal(status.usage, null); assert.equal(status.persistence, 'granted');
  const outcome = await requestLocalStoragePersistence(win, { timeoutMs: 5 });
  assert.equal(outcome, 'unknown'); finish(true); await Promise.resolve(); assert.equal(outcome, 'unknown');
});
