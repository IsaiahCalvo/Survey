import test from 'node:test';
import assert from 'node:assert/strict';
import { isCloudSaveConfirmed } from '../src/utils/cloudSaveBaseline.js';

const base = { isCloudDocument: true, cloudSyncEnabled: true };

test('idle cloud sync with an empty queue confirms the save', () => {
  assert.equal(isCloudSaveConfirmed({ ...base, status: { stage: 'idle' }, queueSize: 0 }), true);
});

test('pending, syncing, queued or failed sync does not confirm', () => {
  for (const stage of ['pending', 'hydrating', 'migrating', 'syncing', 'queued', 'error']) {
    assert.equal(isCloudSaveConfirmed({ ...base, status: { stage } }), false, stage);
  }
  assert.equal(isCloudSaveConfirmed({ ...base, status: { stage: 'idle' }, queueSize: 2 }), false);
});

test('local files and accounts without cloud sync never confirm', () => {
  assert.equal(isCloudSaveConfirmed({ ...base, isCloudDocument: false, status: { stage: 'idle' } }), false);
  assert.equal(isCloudSaveConfirmed({ ...base, cloudSyncEnabled: false, status: { stage: 'idle' } }), false);
  assert.equal(isCloudSaveConfirmed({ ...base, status: null }), false);
});
