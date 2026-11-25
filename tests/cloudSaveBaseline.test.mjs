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

test('#1635 retest: marks landing while the document opens hold the unsaved dot', async () => {
  const { isCloudDocumentOpening } = await import('../src/utils/cloudSaveBaseline.js');
  assert.equal(isCloudDocumentOpening({ stage: 'hydrating' }), true);
  assert.equal(isCloudDocumentOpening({ stage: 'migrating' }), true);
  for (const stage of ['idle', 'pending', 'syncing', 'queued', 'error', 'offline-copy']) {
    assert.equal(isCloudDocumentOpening({ stage }), false, stage);
  }
  const viewer = (await import('node:fs')).readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  // Only with nothing of this device's waiting: an edit queues an upload and shows the dot.
  assert.match(viewer, /const opening = !!pdfFile\?\.id && cloudSyncEnabled && !cloudSyncQueueSize\n\s*&& isCloudDocumentOpening\(cloudSyncStatus\);\n\s*const holdDot = Boolean\(confirmTimer\) \|\| opening;/);
});
