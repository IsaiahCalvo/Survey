/**
 * cloudSaveBaseline.js — decides when a cloud document's marks count as saved.
 *
 * The tab's orange "unsaved" dot compares the viewer's marks with the last
 * saved copy. Cloud documents are saved by the sync engine, not by Save, so
 * once the sync light reads "Up to date" the current marks are the saved copy.
 */
import { getSyncStatusViewModel } from './syncStatusViewModel.js';

export function isCloudSaveConfirmed({ isCloudDocument, cloudSyncEnabled, status, queueSize = 0 } = {}) {
  if (!isCloudDocument || !cloudSyncEnabled || !status) return false;
  return getSyncStatusViewModel(status, queueSize).state === 'synced';
}
