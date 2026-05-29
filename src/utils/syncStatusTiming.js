/**
 * syncStatusTiming.js — timing helper that keeps the sync indicator visible long enough to read.
 *
 * Exports MIN_SYNC_ACTIVITY_VISIBLE_MS (700ms floor) and getSyncedDelayMs(activeSince, now,
 * minVisibleMs), which returns the remaining delay before flipping the sync UI back to idle
 * so a fast sync doesn't flash. Pairs with syncStatusViewModel for the sync status chrome.
 */
export const MIN_SYNC_ACTIVITY_VISIBLE_MS = 700;

export function getSyncedDelayMs(activeSince, now = Date.now(), minVisibleMs = MIN_SYNC_ACTIVITY_VISIBLE_MS) {
  if (!Number.isFinite(activeSince)) return 0;
  const elapsed = Math.max(0, now - activeSince);
  return Math.max(0, minVisibleMs - elapsed);
}
