/* Device files: open a PDF with no account (Nightly flag device-files,
   2026-11-10). The PDF is kept on this device, listed, renamed, read back and
   deleted; with no IndexedDB nothing is kept (the caller asks for sign-in). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDeviceFiles, isDeviceDocumentId, deviceFileRow } from '../src/services/deviceFiles.js';

const pdf = (n) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46]); return b; };

test('keep, list, read back, rename, delete', async () => {
  let changes = 0;
  const store = createDeviceFiles({ indexedDb: new IDBFactory(), onChange: () => { changes += 1; } });
  const row = await store.add({ name: 'A-101.pdf', bytes: pdf(300) });
  assert.ok(isDeviceDocumentId(row.id));
  assert.equal(row.device_file, true);
  assert.equal(row.file_path, null);
  assert.equal(row.file_size, 300);
  assert.deepEqual((await store.list()).map((r) => r.id), [row.id]);
  const kept = await store.read(row.id);
  assert.equal(kept.bytes.byteLength, 300);
  assert.equal(await store.update(row.id, { name: 'A-101 rev B.pdf' }), true);
  assert.equal((await store.list())[0].name, 'A-101 rev B.pdf');
  assert.equal(await store.remove(row.id), true);
  assert.equal(await store.read(row.id), null);
  assert.deepEqual(await store.list(), []);
  assert.ok(changes >= 3);
});

test('a cloud id is never read as a device file', async () => {
  const store = createDeviceFiles({ indexedDb: new IDBFactory() });
  assert.equal(isDeviceDocumentId('5f0c-uuid'), false);
  assert.equal(await store.read('5f0c-uuid'), null);
  assert.equal(await store.update('5f0c-uuid', { name: 'x' }), false);
});

test('newest edited first', async () => {
  let t = 1000;
  const store = createDeviceFiles({ indexedDb: new IDBFactory(), now: () => (t += 10) });
  const a = await store.add({ name: 'a.pdf', bytes: pdf(10) });
  const b = await store.add({ name: 'b.pdf', bytes: pdf(10) });
  assert.deepEqual((await store.list()).map((r) => r.name), ['b.pdf', 'a.pdf']);
  await store.touch(a.id);
  assert.deepEqual((await store.list()).map((r) => r.id), [a.id, b.id]);
});

test('no IndexedDB (private mode): nothing is kept', async () => {
  const store = createDeviceFiles({ indexedDb: null });
  assert.equal(await store.add({ name: 'a.pdf', bytes: pdf(10) }), null);
  assert.deepEqual(await store.list(), []);
});

test('row shape matches the documents table the list reads', () => {
  const row = deviceFileRow({ id: 'device-1', name: 'x.pdf', size: 5, createdAt: 0, updatedAt: 1000 });
  assert.equal(row.project_id, null);
  assert.equal(row.updated_at, new Date(1000).toISOString());
});

test('a device file reads "Only on this device" and counts as saved there', async () => {
  const { getSyncStatusViewModel } = await import('../src/utils/syncStatusViewModel.js');
  const { isCloudSaveConfirmed } = await import('../src/utils/cloudSaveBaseline.js');
  const status = { stage: 'device-only', healthy: true, error: null };
  assert.equal(getSyncStatusViewModel(status).label, 'Only on this device');
  assert.equal(isCloudSaveConfirmed({ isCloudDocument: true, cloudSyncEnabled: true, status }), true);
});
