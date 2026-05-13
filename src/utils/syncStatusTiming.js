export const MIN_SYNC_ACTIVITY_VISIBLE_MS = 700;

export function getSyncedDelayMs(activeSince, now = Date.now(), minVisibleMs = MIN_SYNC_ACTIVITY_VISIBLE_MS) {
  if (!Number.isFinite(activeSince)) return 0;
  const elapsed = Math.max(0, now - activeSince);
  return Math.max(0, minVisibleMs - elapsed);
}
