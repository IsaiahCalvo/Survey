/**
 * syncStatusViewModel.js — maps raw sync state to the {state, label} shown in the sync indicator.
 *
 * Exports getSyncStatusViewModel(status, queueSize, manualSyncing), a pure function translating
 * the sync engine's stage (idle/pending/hydrating/migrating/syncing/queued/error) plus queue depth
 * into a UI state ('syncing' | 'offline' | 'synced') and human label. Pairs with syncStatusTiming.
 */
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
