import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSyncStatusViewModel } from '../src/utils/syncStatusViewModel.js';
import { getSyncedDelayMs, MIN_SYNC_ACTIVITY_VISIBLE_MS } from '../src/utils/syncStatusTiming.js';

const hookSource = () => readFileSync(resolve('src/hooks/useAnnotationCloudSync.js'), 'utf8');
const appSource = () => readFileSync(resolve('src/App.jsx'), 'utf8');

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

test('callout debounce scheduling marks sync pending before the timer fires', () => {
  const src = hookSource();
  assert.match(
    src,
    /pendingCalloutFlushRef\.current = runCalloutPush;[\s\S]{0,140}setSyncStatus\(\{ stage: 'pending', kind: 'callout' \}\);[\s\S]{0,140}calloutTimerHandle = setTimeout/,
  );
});

test('callout push success and failure drive synced or queued status through visible status helper', () => {
  const src = hookSource();
  assert.match(src, /setSyncStatus\(\{ stage: 'syncing', kind: 'callout' \}\);/);
  assert.match(src, /setSyncStatus\(\{ stage: 'queued', error: result\.error, kind: 'callout' \}\);/);
  assert.match(src, /setSyncStatus\(\{ stage: 'synced', count: result\.data\?\.length \|\| 0, kind: 'callout' \}\);/);
});

test('manual forceFlush consumes pending fabric and callout runners before direct durable flush', () => {
  const src = hookSource();
  const forceFlushIndex = src.indexOf('const forceFlush = async () => {');
  const pendingFabricIndex = src.indexOf('const pendingFabric = pendingFabricFlushRef.current;', forceFlushIndex);
  const consumeFabricIndex = src.indexOf('await pendingFabric();', forceFlushIndex);
  const noPendingSyncedIndex = src.indexOf('const noPendingDurableWork = !consumedPendingFabric', forceFlushIndex);
  const directFabricIndex = src.indexOf('if (!noPendingDurableWork && !consumedPendingFabric && lastByPageRef.current)', forceFlushIndex);
  const consumeCalloutIndex = src.indexOf('await pendingCallout();', forceFlushIndex);
  const directCalloutIndex = src.indexOf('if (!noPendingDurableWork && !consumedPendingCallout && lastCalloutsRef.current)', forceFlushIndex);

  assert.ok(forceFlushIndex > 0, 'expected forceFlush implementation');
  assert.ok(pendingFabricIndex > forceFlushIndex, 'expected pending fabric runner lookup');
  assert.ok(consumeFabricIndex > pendingFabricIndex, 'expected pending fabric runner to be consumed');
  assert.ok(noPendingSyncedIndex > consumeFabricIndex, 'expected no-pending synced manual save fast path');
  assert.ok(directFabricIndex > consumeFabricIndex, 'expected direct fabric flush to be gated after pending runner');
  assert.ok(consumeCalloutIndex > pendingFabricIndex, 'expected pending callout runner to be consumed');
  assert.ok(directCalloutIndex > consumeCalloutIndex, 'expected direct callout flush to be gated after pending runner');
});

test('manual forceFlush does not re-upsert all annotations when already synced and no work is pending', () => {
  const src = hookSource();
  const forceFlushIndex = src.indexOf('const forceFlush = async () => {');
  const noPendingSyncedIndex = src.indexOf('const noPendingDurableWork = !consumedPendingFabric', forceFlushIndex);
  const noPendingLogIndex = src.indexOf("[CloudSync][forceFlush] no pending work; preserving synced state", forceFlushIndex);
  const directFabricIndex = src.indexOf('if (!noPendingDurableWork && !consumedPendingFabric && lastByPageRef.current)', forceFlushIndex);
  const directCalloutIndex = src.indexOf('if (!noPendingDurableWork && !consumedPendingCallout && lastCalloutsRef.current)', forceFlushIndex);
  const syncedStatusIndex = src.indexOf("setSyncStatus({ stage: 'synced', kind: 'manual-save'", forceFlushIndex);
  const staleSyncedOnlyGuardIndex = src.indexOf("&& statusAfterPending === 'synced'", noPendingSyncedIndex);

  assert.ok(noPendingSyncedIndex > forceFlushIndex, 'expected already-synced no-work guard');
  assert.ok(noPendingLogIndex > noPendingSyncedIndex, 'expected diagnostic for no-op manual save');
  assert.ok(directFabricIndex > noPendingSyncedIndex, 'expected fabric direct flush to skip no-work saves');
  assert.ok(directCalloutIndex > noPendingSyncedIndex, 'expected callout direct flush to skip no-work saves');
  assert.ok(syncedStatusIndex > directCalloutIndex, 'expected manual save to still end with synced status');
  assert.equal(staleSyncedOnlyGuardIndex, -1, 'no-op manual save must also skip full upsert from idle hydrated state');
});

test('manual forceFlush logs and settles status to synced only after successful flush', () => {
  const src = hookSource();
  const forceFlushIndex = src.indexOf('const forceFlush = async () => {');
  const startLogIndex = src.indexOf("[CloudSync][forceFlush] start", forceFlushIndex);
  const failureStatusIndex = src.indexOf("setSyncStatus({ stage: 'queued', error: err, kind: 'manual-save'", forceFlushIndex);
  const syncedLogIndex = src.indexOf("[CloudSync][forceFlush] synced", forceFlushIndex);
  const syncedStatusIndex = src.indexOf("setSyncStatus({ stage: 'synced', kind: 'manual-save'", forceFlushIndex);

  assert.ok(startLogIndex > forceFlushIndex, 'expected forceFlush start diagnostic');
  assert.ok(failureStatusIndex > forceFlushIndex, 'expected failures to leave queued status');
  assert.ok(syncedLogIndex > failureStatusIndex, 'expected synced diagnostic after failure guards');
  assert.ok(syncedStatusIndex > syncedLogIndex, 'expected synced status after successful flush log');
});

test('normal app-state Save invokes cloudSyncForceFlush', () => {
  const src = appSource();
  const saveIndex = src.indexOf("actionType: 'app-state-save'");
  const flushIndex = src.indexOf('await cloudSyncForceFlush();', saveIndex);
  const completeIndex = src.indexOf('[PDFSaveExport] action complete', saveIndex);

  assert.ok(saveIndex > 0, 'expected app-state save action');
  assert.ok(flushIndex > saveIndex, 'expected normal Save to call cloudSyncForceFlush');
  assert.ok(completeIndex > flushIndex, 'expected save completion log after force flush');
});
