import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSyncStatusViewModel } from '../src/utils/syncStatusViewModel.js';
import { getSyncedDelayMs, MIN_SYNC_ACTIVITY_VISIBLE_MS } from '../src/utils/syncStatusTiming.js';

const appSource = () => readFileSync(resolve('src/viewerShared.js'), 'utf8')
  + '\n' + readFileSync(resolve('src/PDFViewer.jsx'), 'utf8');

test('sync status view model exposes pending debounce as visible saving state', () => {
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'pending' }, 0),
    { state: 'syncing', label: 'Saving...' },
  );
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'syncing' }, 0),
    { state: 'syncing', label: 'Syncing...' },
  );
});

test('sync status view model keeps queued and error states visible', () => {
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'queued' }, 0),
    { state: 'offline', label: 'Saved locally' },
  );
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'synced' }, 2),
    { state: 'offline', label: 'Offline · 2 saved locally' },
  );
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'error', error: new Error('boom') }, 0),
    { state: 'offline', label: 'Sync error' },
  );
});

test('fast successful sync stays visible for the minimum activity duration', () => {
  assert.equal(getSyncedDelayMs(1000, 1000), MIN_SYNC_ACTIVITY_VISIBLE_MS);
  assert.equal(getSyncedDelayMs(1000, 1300), MIN_SYNC_ACTIVITY_VISIBLE_MS - 300);
  assert.equal(getSyncedDelayMs(1000, 1900), 0);
  assert.equal(getSyncedDelayMs(null, 1000), 0);
});

// 2026-07-17: five tests pinning the retired useAnnotationCloudSync hook's
// internal status transitions and forceFlush ordering were deleted with the
// hook module (it was unmounted — pinned by
// tests/annotationInitialHydrationSource.test.mjs — so none of those
// transitions ever ran). The live status producer is useAnnotationDoc
// (stage: idle/hydrating/syncing/error + forceFlush), consumed through the
// view-model contract tested above and the Save wiring tested below.

test('normal app-state Save invokes cloudSyncForceFlush', () => {
  const src = appSource();
  const saveIndex = src.indexOf("actionType: 'app-state-save'");
  const flushIndex = src.indexOf('await cloudSyncForceFlush();', saveIndex);
  const completeIndex = src.indexOf('[PDFSaveExport] action complete', saveIndex);

  assert.ok(saveIndex > 0, 'expected app-state save action');
  assert.ok(flushIndex > saveIndex, 'expected normal Save to call cloudSyncForceFlush');
  assert.ok(completeIndex > flushIndex, 'expected save completion log after force flush');
});
