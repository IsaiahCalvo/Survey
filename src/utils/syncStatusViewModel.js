export function getSyncStatusViewModel(status, queueSize = 0, manualSyncing = false) {
  const stage = status?.stage || 'idle';

  if (manualSyncing) {
    return { state: 'syncing', label: 'Syncing now...' };
  }

  if (stage === 'error') {
    return { state: 'offline', label: 'Sync error' };
  }

  if (queueSize > 0 || stage === 'queued') {
    return {
      state: 'offline',
      label: queueSize > 0
        ? `Offline · ${queueSize} saved locally`
        : 'Saved locally',
    };
  }

  if (stage === 'pending') {
    return { state: 'syncing', label: 'Saving...' };
  }

  if (stage === 'hydrating' || stage === 'migrating' || stage === 'syncing') {
    return { state: 'syncing', label: 'Syncing...' };
  }

  return { state: 'synced', label: 'Up to date' };
}
