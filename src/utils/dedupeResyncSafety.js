/**
 * dedupeResyncSafety.js — guards against a resync wrongly shrinking the annotation
 * set during startup or beyond what dedupe actually removed.
 *
 * Exports shouldApplyDedupeResync, which compares current vs resync counts against
 * the removedCount and startup/hydration flags and returns { apply, reason, shrink }.
 * Used to decide whether to accept a dedupe-driven resync that lowers the count.
 */
export function shouldApplyDedupeResync({
  currentCount = 0,
  resyncCount = 0,
  removedCount = 0,
  startupSyncInFlight = false,
  hydrated = false,
} = {}) {
  const current = Number.isFinite(currentCount) ? currentCount : 0;
  const next = Number.isFinite(resyncCount) ? resyncCount : 0;
  const removed = Math.max(0, Number.isFinite(removedCount) ? removedCount : 0);
  const shrink = current - next;

  if (shrink <= 0) return { apply: true, reason: 'not-a-shrink', shrink };
  if ((startupSyncInFlight || !hydrated) && shrink > 0) {
    return { apply: false, reason: 'startup-shrink', shrink };
  }
  if (shrink > removed) {
    return { apply: false, reason: 'shrink-exceeds-dedupe-removal', shrink };
  }
  return { apply: true, reason: 'expected-dedupe-shrink', shrink };
}
