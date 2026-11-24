// The plan a person was last seen on, kept on this device. A tier read that
// fails (offline in the field, a dropped connection) used to fall back to
// Free, so a Pro account lost its Pro tools until the next good read. Now a
// failed read keeps the plan already shown, or the last one this device saw.
// The server still checks every paid action; this only keeps the app's own
// gates steady while it can't ask.
const KEY = 'survey.lastKnownTier';

export function readLastKnownTier(userId, storage = globalThis.localStorage) {
  if (!userId) return null;
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || 'null');
    return saved && saved.userId === userId && typeof saved.tier === 'string' ? saved.tier : null;
  } catch {
    return null;
  }
}

export function writeLastKnownTier(userId, tier, storage = globalThis.localStorage) {
  if (!userId || typeof tier !== 'string') return;
  try { storage?.setItem(KEY, JSON.stringify({ userId, tier })); } catch { /* storage full or blocked */ }
}

// The tier to show when a read failed: the one on screen for this person,
// else the last one this device saw for them, else Free.
export function tierAfterFailedRead({ userId, shownTier, shownUserId }, storage) {
  if (userId && shownUserId === userId && typeof shownTier === 'string') return shownTier;
  return readLastKnownTier(userId, storage) || 'free';
}
