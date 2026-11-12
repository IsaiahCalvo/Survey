/**
 * syncStatusViewModel.js — maps raw sync state to the {state, label} shown in the sync indicator.
 *
 * Exports getSyncStatusViewModel(status, queueSize, manualSyncing), a pure function translating
 * the sync engine's stage (idle/pending/hydrating/migrating/syncing/queued/error) plus queue depth
 * into a UI state ('syncing' | 'offline' | 'synced') and human label. Pairs with syncStatusTiming.
 */
const BLOCKED_DETAIL = {
  gone: 'This document was moved to Archive or deleted, or your access was removed. Your last change was not saved, and new changes can’t be.',
  locked: 'This document was locked. Your last change was not saved, and new changes can’t be until it is unlocked.',
  denied: 'You can no longer edit this document. Your last change was not saved.',
};

export function getSyncStatusViewModel(status, queueSize = 0, manualSyncing = false, { offline = browserReportsOffline() } = {}) {
  const stage = status?.stage || 'idle';
  const pendingCount = Math.max(0, Number(queueSize) || Number(status?.queueSize) || 0);
  const errorText = String(status?.error?.message || status?.error || '').toLowerCase();

  if (manualSyncing) {
    return {
      state: 'syncing',
      label: 'Syncing now...',
      detail: 'Survey is backing up your locally saved changes now.',
      retryLabel: 'Keep this document open while backup finishes.',
    };
  }

  // device-files: a PDF opened with no account lives only on this device.
  if (stage === 'device-only') {
    return {
      state: 'offline',
      label: 'Only on this device',
      detail: 'Your changes are saved on this device. Sign in and save it to your account to keep it safe and use it anywhere.',
      retryLabel: '',
    };
  }

  // The server turned an edit down and the document can't be changed any more.
  if (stage === 'blocked') {
    return {
      state: 'offline',
      label: 'Not saved',
      detail: BLOCKED_DETAIL[status?.reason] || BLOCKED_DETAIL.denied,
      retryLabel: '',
    };
  }

  // Available offline (offline-docs): opened from this device's kept copy.
  if (stage === 'offline-copy') {
    return {
      state: 'offline',
      label: 'Offline copy',
      detail: 'Opened from this device. Your changes are saved here and sync when you are back online.',
      retryLabel: 'Survey syncs as soon as the connection is back.',
    };
  }

  if (stage === 'error') {
    let detail = 'Cloud backup could not finish. Your changes are safe on this device.';
    if (/timed[_ -]?out|timeout/.test(errorText)) {
      detail = 'The connection to cloud backup timed out. Your changes are safe on this device.';
    } else if (/realtime|network|offline|fetch|connection|websocket|channel/.test(errorText)) {
      detail = 'Survey cannot reach cloud backup right now. Your changes are safe on this device.';
    } else if (/permission|row.level.security|42501|access|authentication/.test(errorText)) {
      detail = 'Cloud backup turned this change down, so it was undone.';
    } else if (/quota|storage|indexeddb|database/.test(errorText)) {
      detail = 'Survey could not update its local backup queue. Keep this document open and retry.';
    }
    if (offline) detail = 'You are offline. Your changes are safe on this device and sync when you are back online.';
    return {
      state: 'offline',
      label: pendingCount > 0 ? `Offline · ${pendingCount} saved locally` : (offline ? 'Offline' : 'Sync error'),
      detail,
      retryLabel: 'Backup is retrying automatically.',
    };
  }

  // A healthy engine with appends in flight reports 'pending' WITH a queue
  // size, so this check has to come before the queue one: it used to fall
  // into "Offline · N saved locally" and flash the red dot on every save
  // (phone walk 2026-10-28: ~2 s of "Offline" after opening a big drawing
  // while online). A failed append turns the stage to 'error' instead.
  if (stage === 'pending' && !offline) {
    return {
      state: 'syncing',
      label: 'Saving...',
      detail: 'Your changes are saved on this device and are waiting to be backed up.',
      retryLabel: 'Backup will retry automatically.',
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

  // The device lost its signal: say so at once. Before, the light stayed
  // green ("Up to date") until a save failed, about 17 s later (deep test
  // 2026-11-10). Everything made before this is in the cloud; new changes
  // wait on this device.
  if (offline) {
    return {
      state: 'offline',
      label: 'Offline',
      detail: 'You are offline. New changes are saved on this device and sync when you are back online.',
      retryLabel: 'Survey syncs as soon as the connection is back.',
    };
  }

  return {
    state: 'synced',
    label: 'Up to date',
    detail: 'Everything is backed up to the cloud.',
    retryLabel: '',
  };
}

export function getCompactSyncStatusMessage(status, queueSize = 0, { offline = browserReportsOffline() } = {}) {
  const stage = status?.stage || 'idle';
  const pendingCount = Math.max(0, Number(queueSize) || Number(status?.queueSize) || 0);
  const errorText = String(status?.error?.message || status?.error || '').toLowerCase();

  if (stage === 'device-only') return 'Only on this device: sign in and save it to your account to keep it safe.';
  if (stage === 'blocked') return BLOCKED_DETAIL[status?.reason] || BLOCKED_DETAIL.denied;
  if (stage === 'offline-copy') return 'Offline copy: changes are saved on this device and sync when you are back online.';

  if (stage === 'error') {
    if (offline) return 'You are offline; changes are safe on this device and sync when you are back.';
    if (/timed[_ -]?out|timeout/.test(errorText)) {
      return 'Cloud backup timed out; changes are safe and retrying.';
    }
    if (/realtime|network|offline|fetch|connection|websocket|channel/.test(errorText)) {
      return 'Cloud backup is offline; changes are safe and retrying.';
    }
    if (/permission|row.level.security|42501|access|authentication/.test(errorText)) {
      return 'Cloud backup turned this change down, so it was undone.';
    }
    if (/quota|storage|indexeddb|database/.test(errorText)) {
      return 'The backup queue needs attention; keep this document open.';
    }
    return 'Cloud backup failed; changes are safe and retrying.';
  }

  if (stage === 'pending' && !offline) return 'Changes are saved locally and backing up now.';
  if (pendingCount > 0 || stage === 'queued') {
    if (pendingCount === 1) return '1 change is safe locally and waiting to back up.';
    const count = pendingCount > 0 ? `${pendingCount} changes` : 'Changes';
    return `${count} are safe locally and waiting to back up.`;
  }
  if (stage === 'pending') return 'Changes are saved locally and backing up now.';
  if (stage === 'hydrating' || stage === 'migrating' || stage === 'syncing') {
    return errorText.includes('checking whether')
      ? 'Checking this document’s cloud backup status.'
      : 'Loading and backing up this document.';
  }
  if (offline) return 'You are offline; new changes are saved on this device and sync when you are back.';
  return 'Everything is backed up to the cloud.';
}

function browserReportsOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
