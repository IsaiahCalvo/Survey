/**
 * presenceActivity.js — keeps "who is on this document" true while someone works.
 *
 * The presence row (document_presence.last_seen) used to be written only when
 * a document opened and on each page change. Other people's viewers mark a row
 * idle after 1 minute and drop it after 2 (presenceIdentity.js /
 * presenceRoster.js), so someone drawing on one page for a few minutes
 * vanished from everyone else's people token while still working (found in the
 * real two-account run, TEST-PLAN Part 9, 2026-10-06).
 *
 * This bumps the row again on the person's own input (pointer, key, wheel,
 * touch), at most once per PRESENCE_ACTIVITY_REFRESH_MS. Small traffic: no
 * timer and no writes while nobody touches the document; at most ~1.3 writes a
 * minute while they do. Someone only looking still goes idle, then drops, as
 * designed. Documents open in background tabs stay mounted, so the caller
 * passes isActive: input in the front tab must not keep a background
 * document's row fresh.
 */

// Under the 60 s "idle" line, so a person who keeps working stays "here".
export const PRESENCE_ACTIVITY_REFRESH_MS = 45 * 1000;

export const PRESENCE_ACTIVITY_EVENTS = Object.freeze(['pointerdown', 'keydown', 'wheel', 'touchstart']);

/**
 * @param {{ onBump: () => void, refreshMs?: number, now?: () => number, isActive?: () => boolean }} opts
 * @returns {{ noteWrite: () => void, onActivity: () => boolean }}
 *   noteWrite: a presence write just happened (resets the clock).
 *   onActivity: the person did something; bumps (and returns true) when this
 *   document is the one in front and the last write is at least refreshMs old.
 */
export function createPresenceActivityBump({ onBump, refreshMs = PRESENCE_ACTIVITY_REFRESH_MS, now = Date.now, isActive = () => true } = {}) {
  let lastWrite = -Infinity;
  return {
    noteWrite() { lastWrite = now(); },
    onActivity() {
      if (!isActive()) return false;
      const t = now();
      if (t - lastWrite < refreshMs) return false;
      lastWrite = t;
      onBump?.();
      return true;
    },
  };
}
