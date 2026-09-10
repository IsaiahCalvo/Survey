import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCompactSyncStatusMessage, getSyncStatusViewModel } from '../src/utils/syncStatusViewModel.js';
import { getSyncedDelayMs, MIN_SYNC_ACTIVITY_VISIBLE_MS } from '../src/utils/syncStatusTiming.js';
import { combineCollaborationSyncStatus } from '../src/utils/collaborationSyncStatus.js';

const appSource = () => readFileSync(resolve('src/viewerShared.js'), 'utf8')
  + '\n' + readFileSync(resolve('src/PDFViewer.jsx'), 'utf8');
const providerSource = () => readFileSync(
  resolve('src/components/collab/YDocProvider.jsx'),
  'utf8',
);
const syncChipSource = () => readFileSync(
  resolve('src/components/SyncStatusChip.jsx'),
  'utf8',
);
const mobileChromeSource = () => readFileSync(
  resolve('src/mobile/MobilePdfViewerChrome.jsx'),
  'utf8',
);

test('managed local files show device-only status without claiming every edit is saved', () => {
  const status = combineCollaborationSyncStatus({
    annotationStatus: { stage: 'error', error: 'cloud unavailable' },
    transportState: 'offline',
    isSharedDocument: null,
    managedLocal: true,
    hasUnsavedChanges: false,
  });
  assert.deepEqual(getSyncStatusViewModel(status, 9), {
    state: 'synced',
    label: 'Local file',
    detail: 'Stored on this device. Use Save to keep your edits. Not uploaded or shared.',
    retryLabel: '',
  });
  assert.equal(getCompactSyncStatusMessage(status, 9),
    'Stored on this device. Use Save to keep your edits. Not uploaded or shared.');
});

test('managed local edits remain unsaved until the caller clears dirty state', () => {
  const status = combineCollaborationSyncStatus({
    managedLocal: true, hasUnsavedChanges: true, isSharedDocument: null,
  });
  assert.deepEqual(getSyncStatusViewModel(status), {
    state: 'offline',
    label: 'Unsaved local edits',
    detail: 'Keep this document open and use Save to keep your edits on this device.',
    retryLabel: '',
  });
  assert.equal(getCompactSyncStatusMessage(status),
    'Keep this document open and use Save to keep your edits on this device.');
  assert.deepEqual(getSyncStatusViewModel(status, 0, true), {
    state: 'syncing',
    label: 'Saving locally...',
    detail: 'Keep this document open while Survey saves to this device.',
    retryLabel: '',
  });
  assert.equal(getSyncStatusViewModel(status).label, 'Unsaved local edits');
});

test('sync status view model exposes pending debounce as visible saving state', () => {
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'pending' }, 0),
    {
      state: 'syncing',
      label: 'Saving...',
      detail: 'Your changes are saved on this device and are waiting to be backed up.',
      retryLabel: 'Backup will retry automatically.',
    },
  );
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'syncing' }, 0),
    {
      state: 'syncing',
      label: 'Syncing...',
      detail: 'Survey is loading and backing up this document’s cloud changes.',
      retryLabel: 'Keep this document open while backup finishes.',
    },
  );
});

test('sync status view model keeps queued and error states visible', () => {
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'queued' }, 0),
    {
      state: 'offline',
      label: 'Saved locally',
      detail: 'Your changes are safe on this device and are waiting for cloud backup.',
      retryLabel: 'Backup is retrying automatically.',
    },
  );
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'synced' }, 2),
    {
      state: 'offline',
      label: 'Offline · 2 saved locally',
      detail: 'Your changes are safe on this device and are waiting for cloud backup.',
      retryLabel: 'Backup is retrying automatically.',
    },
  );
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'error', error: new Error('boom') }, 0),
    {
      state: 'offline',
      label: 'Sync error',
      detail: 'Cloud backup could not finish. Your changes are safe on this device.',
      retryLabel: 'Backup is retrying automatically.',
    },
  );
});

test('generation capacity pauses backup without an automatic retry or false local-save claim', () => {
  const capacity = { stage: 'error', healthy: false, error: 'safe capacity message',
    errorCode: 'ANNOTATION_GENERATION_CAPACITY' };
  assert.deepEqual(getSyncStatusViewModel(capacity, 2, true), {
    state: 'offline', label: 'Backup paused · 2 kept locally',
    detail: 'This document reached its cloud save limit. Pending changes remain on this device and need recovery.',
    retryLabel: 'Automatic backup is paused.',
  });
  assert.equal(getCompactSyncStatusMessage(capacity, 2),
    'Cloud backup is paused; 2 changes remain on this device and need recovery.');
  assert.deepEqual(getSyncStatusViewModel(capacity, 0, true), {
    state: 'offline', label: 'Cloud backup paused',
    detail: 'This document reached its cloud save limit. No pending local changes are queued.',
    retryLabel: 'Automatic backup is paused.',
  });
  assert.equal(getCompactSyncStatusMessage(capacity, 0),
    'Cloud backup is paused; this document needs recovery.');
});

test('yellow and red sync states explain the cause, local backup, and retry behavior', () => {
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'pending' }, 0),
    {
      state: 'syncing',
      label: 'Saving...',
      detail: 'Your changes are saved on this device and are waiting to be backed up.',
      retryLabel: 'Backup will retry automatically.',
    },
  );
  assert.deepEqual(
    getSyncStatusViewModel({ stage: 'error', error: 'realtime timed_out' }, 2),
    {
      state: 'offline',
      label: 'Offline · 2 saved locally',
      detail: 'The connection to cloud backup timed out. Your changes are safe on this device.',
      retryLabel: 'Backup is retrying automatically.',
    },
  );
  assert.equal(
    getCompactSyncStatusMessage({ stage: 'pending' }, 0),
    'Changes are saved locally and backing up now.',
  );
  assert.equal(
    getCompactSyncStatusMessage({ stage: 'error', error: 'realtime timed_out' }, 2),
    'Cloud backup timed out; changes are safe and retrying.',
  );
});

test('desktop and mobile sync indicators keep details compact without moving adjacent tools', () => {
  const desktop = syncChipSource();
  const mobile = mobileChromeSource();
  assert.match(desktop, /aria-expanded=/);
  assert.match(desktop, /sync-status-details/);
  assert.match(desktop, /data-sync-message/);
  assert.match(desktop, /aria-label="Retry now"/);
  assert.doesNotMatch(desktop, />Retry now</);
  assert.match(mobile, /aria-expanded=/);
  assert.match(mobile, /mobile-pdf-tools__sync-details/);
  assert.match(mobile, /data-sync-message/);
  assert.match(mobile, /aria-label="Retry now"/);
  assert.doesNotMatch(mobile, />Retry now</);
  assert.match(mobile, /createPortal\([\s\S]*?document\.body/);
  assert.match(mobile, /if \(sync\.state === 'synced'\)[\s\S]*?cloudSyncOnRetry/);
  assert.match(mobile, /ref=\{syncDetailsRef\}/);
});

test('fast successful sync stays visible for the minimum activity duration', () => {
  assert.equal(getSyncedDelayMs(1000, 1000), MIN_SYNC_ACTIVITY_VISIBLE_MS);
  assert.equal(getSyncedDelayMs(1000, 1300), MIN_SYNC_ACTIVITY_VISIBLE_MS - 300);
  assert.equal(getSyncedDelayMs(1000, 1900), 0);
  assert.equal(getSyncedDelayMs(null, 1000), 0);
});

test('shared-document transport health prevents a false green annotation status', () => {
  const annotationStatus = { stage: 'idle', healthy: true, error: null };
  assert.deepEqual(
    combineCollaborationSyncStatus({
      annotationStatus,
      transportState: 'offline',
      isSharedDocument: true,
    }),
    {
      stage: 'error',
      healthy: false,
      error: 'live collaboration is offline',
    },
  );
  assert.equal(
    combineCollaborationSyncStatus({
      annotationStatus,
      transportState: 'connecting',
      isSharedDocument: true,
    }).stage,
    'hydrating',
  );
  assert.equal(
    combineCollaborationSyncStatus({
      annotationStatus,
      transportState: 'offline',
      isSharedDocument: false,
    }),
    annotationStatus,
    'a private document keeps the independent durable-save status',
  );
  assert.deepEqual(
    combineCollaborationSyncStatus({
      annotationStatus,
      transportState: 'offline',
      isSharedDocument: null,
    }),
    {
      stage: 'hydrating',
      healthy: true,
      error: 'checking whether this document uses live collaboration',
    },
    'an unresolved sharing lookup stays yellow instead of showing a false red failure',
  );
});

test('a real annotation save error is never hidden by a connecting transport', () => {
  const annotationError = {
    stage: 'error',
    healthy: false,
    error: 'save failed',
  };
  assert.equal(
    combineCollaborationSyncStatus({
      annotationStatus: annotationError,
      transportState: 'connecting',
      isSharedDocument: true,
    }),
    annotationError,
  );
});

// Shared-status refresh behavior is exercised through the real module and
// mounted provider in documentCollaborationStatus/legacyYDocProviderMounted.

test('sync failures emit privacy-safe analytics categories without raw error text', () => {
  const src = appSource();
  assert.match(src, /survey_cloud_sync_status_changed/);
  assert.match(src, /queueDepthBucket/);
  assert.match(src, /sharedState/);
  assert.doesNotMatch(src, /survey_cloud_sync_status_changed[\s\S]{0,400}errorText,/);
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
