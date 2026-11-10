// How long ago a live sheet last synced, in words. Kept apart from
// sheetSyncClient.js (which needs the Supabase client) so tests can load it.

/** "just now", "12 s ago", "3 min ago". */
export function syncedAgo(iso, now = Date.now()) {
  if (!iso) return '';
  return agoText(now - new Date(iso).getTime());
}

/**
 * When a link last synced, by the server's clock: its age when the answer
 * came (`lastRoundAgoMs`) plus the time since, so a device clock that is
 * hours off still reads "just now" after a round.
 */
export function linkSyncedAgo(link, now = Date.now()) {
  if (!link?.lastRoundAt) return '';
  if (typeof link.lastRoundAgoMs === 'number' && typeof link.receivedAt === 'number') {
    return agoText(link.lastRoundAgoMs + Math.max(0, now - link.receivedAt));
  }
  return syncedAgo(link.lastRoundAt, now);
}

function agoText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
