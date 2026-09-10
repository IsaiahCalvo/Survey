/**
 * syncStatusViewModel.js — maps raw sync state to the {state, label} shown in the sync indicator.
 *
 * Exports getSyncStatusViewModel(status, queueSize, manualSyncing), a pure function translating
 * the sync engine's stage (idle/pending/hydrating/migrating/syncing/queued/error) plus queue depth
 * into a UI state ('syncing' | 'offline' | 'synced') and human label. Pairs with syncStatusTiming.
 */
export function getSyncStatusViewModel(status, queueSize = 0, manualSyncing = false) {
  const stage = status?.stage || 'idle';
  const pendingCount = Math.max(0, Number(queueSize) || Number(status?.queueSize) || 0);
  const errorText = String(status?.error?.message || status?.error || '').toLowerCase();

  if (status?.managedLocal) {
    if (manualSyncing) {
      return {
        state: 'syncing',
        label: 'Saving locally...',
        detail: 'Keep this document open while Survey saves to this device.',
        retryLabel: '',
      };
    }
    if (stage === 'pending' || stage === 'error') {
      return {
        state: 'offline',
        label: 'Unsaved local edits',
        detail: 'Keep this document open and use Save to keep your edits on this device.',
        retryLabel: '',
      };
    }
    return {
      state: 'synced',
      label: 'Local file',
      detail: 'Stored on this device. Use Save to keep your edits. Not uploaded or shared.',
      retryLabel: '',
    };
  }

  if (status?.errorCode === 'ANNOTATION_GENERATION_CAPACITY') {
    return {
      state: 'offline',
      label: pendingCount > 0
        ? `Backup paused · ${pendingCount} kept locally`
        : 'Cloud backup paused',
      detail: pendingCount > 0
        ? 'This document reached its cloud save limit. Pending changes remain on this device and need recovery.'
        : 'This document reached its cloud save limit. No pending local changes are queued.',
      retryLabel: 'Automatic backup is paused.',
    };
  }

  if (manualSyncing) {
    return {
      state: 'syncing',
      label: 'Syncing now...',
      detail: 'Survey is backing up your locally saved changes now.',
      retryLabel: 'Keep this document open while backup finishes.',
    };
  }

  if (stage === 'error') {
    let detail = 'Cloud backup could not finish. Your changes are safe on this device.';
    if (/timed[_ -]?out|timeout/.test(errorText)) {
      detail = 'The connection to cloud backup timed out. Your changes are safe on this device.';
    } else if (/realtime|network|offline|fetch|connection|websocket|channel/.test(errorText)) {
      detail = 'Survey cannot reach cloud backup right now. Your changes are safe on this device.';
    } else if (/permission|row.level.security|42501|access|authentication/.test(errorText)) {
      detail = 'Cloud backup rejected this account’s access. Your changes are safe on this device.';
    } else if (/quota|storage|indexeddb|database/.test(errorText)) {
      detail = 'Survey could not update its local backup queue. Keep this document open and retry.';
    }
    return {
      state: 'offline',
      label: pendingCount > 0 ? `Offline · ${pendingCount} saved locally` : 'Sync error',
      detail,
      retryLabel: 'Backup is retrying automatically.',
    };
  }

  if (pendingCount > 0 || stage === 'queued') {
    return {
      state: 'offline',
      label: pendingCount > 0
        ? `Offline · ${pendingCount} saved locally`
        : 'Saved locally',
      detail: 'Your changes are safe on this device and are waiting for cloud backup.',
      retryLabel: 'Backup is retrying automatically.',
    };
  }

  if (stage === 'pending') {
    return {
      state: 'syncing',
      label: 'Saving...',
      detail: 'Your changes are saved on this device and are waiting to be backed up.',
      retryLabel: 'Backup will retry automatically.',
    };
  }

  if (stage === 'hydrating' || stage === 'migrating' || stage === 'syncing') {
    return {
      state: 'syncing',
      label: 'Syncing...',
      detail: errorText.includes('checking whether')
        ? 'Survey is checking whether this document uses live collaboration.'
        : 'Survey is loading and backing up this document’s cloud changes.',
      retryLabel: 'Keep this document open while backup finishes.',
    };
  }

  return {
    state: 'synced',
    label: 'Up to date',
    detail: 'Everything is backed up to the cloud.',
    retryLabel: '',
  };
}

export function getCompactSyncStatusMessage(status, queueSize = 0) {
  if (status?.managedLocal) return getSyncStatusViewModel(status).detail;
  const stage = status?.stage || 'idle';
  const pendingCount = Math.max(0, Number(queueSize) || Number(status?.queueSize) || 0);
  const errorText = String(status?.error?.message || status?.error || '').toLowerCase();

  if (status?.errorCode === 'ANNOTATION_GENERATION_CAPACITY') {
    return pendingCount > 0
      ? `Cloud backup is paused; ${pendingCount} change${pendingCount === 1 ? '' : 's'} remain on this device and need recovery.`
      : 'Cloud backup is paused; this document needs recovery.';
  }

  if (stage === 'error') {
    if (/timed[_ -]?out|timeout/.test(errorText)) {
      return 'Cloud backup timed out; changes are safe and retrying.';
    }
    if (/realtime|network|offline|fetch|connection|websocket|channel/.test(errorText)) {
      return 'Cloud backup is offline; changes are safe and retrying.';
    }
    if (/permission|row.level.security|42501|access|authentication/.test(errorText)) {
      return 'Cloud backup access failed; changes are safe locally.';
    }
    if (/quota|storage|indexeddb|database/.test(errorText)) {
      return 'The backup queue needs attention; keep this document open.';
    }
    return 'Cloud backup failed; changes are safe and retrying.';
  }

  if (pendingCount > 0 || stage === 'queued') {
    const count = pendingCount > 0 ? `${pendingCount} change${pendingCount === 1 ? '' : 's'}` : 'Changes';
    return `${count} are safe locally and waiting to back up.`;
  }
  if (stage === 'pending') return 'Changes are saved locally and backing up now.';
  if (stage === 'hydrating' || stage === 'migrating' || stage === 'syncing') {
    return errorText.includes('checking whether')
      ? 'Checking this document’s cloud backup status.'
      : 'Loading and backing up this document.';
  }
  return 'Everything is backed up to the cloud.';
}
