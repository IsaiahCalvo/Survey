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

// Coalesce rapid scrolling through pages into one presence write once the
// person settles on a page (document_presence is published to Realtime with
// REPLICA IDENTITY FULL, so every redundant upsert burns WAL + Realtime decode).
export const PRESENCE_PAGE_CHANGE_DEBOUNCE_MS = 1500;

export const PRESENCE_ACTIVITY_EVENTS = Object.freeze(['pointerdown', 'keydown', 'wheel', 'touchstart']);

/**
 * True when the browser tab is not hidden (always true in non-DOM runtimes).
 */
export function isPresenceDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Skip a redundant document_presence upsert when the same document + page was
 * already written within the refresh window (for example, when the page-change
 * effect mounts immediately after the initial open presence handshake).
 */
export function shouldSkipDuplicatePresenceWrite(
  lastWrite,
  next,
  now = Date.now(),
  dedupeWindowMs = PRESENCE_ACTIVITY_REFRESH_MS,
) {
  if (!lastWrite || !next) return false;
  if (!lastWrite.documentId || lastWrite.documentId !== next.documentId) return false;
  if (lastWrite.page !== next.page) return false;
  return Number.isFinite(lastWrite.at) && (now - lastWrite.at) < dedupeWindowMs;
}

/**
 * @param {{ onBump: () => void, refreshMs?: number, now?: () => number, isActive?: () => boolean, isVisible?: () => boolean }} opts
 * @returns {{ noteWrite: (at?: number) => void, onActivity: () => boolean }}
 *   noteWrite: a presence write just happened (resets the clock).
 *   onActivity: the person did something; bumps (and returns true) when this
 *   tab is visible, this document is the one in front, and the last write is
 *   at least refreshMs old.
 */
export function createPresenceActivityBump({
  onBump,
  refreshMs = PRESENCE_ACTIVITY_REFRESH_MS,
  now = Date.now,
  isActive = () => true,
  isVisible = isPresenceDocumentVisible,
} = {}) {
  let lastWrite = -Infinity;
  return {
    noteWrite(at = now()) { lastWrite = at; },
    onActivity() {
      if (!isVisible() || !isActive()) return false;
      const t = now();
      if (t - lastWrite < refreshMs) return false;
      lastWrite = t;
      onBump?.();
      return true;
    },
  };
}
