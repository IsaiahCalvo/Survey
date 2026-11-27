/**
 * Shared exponential backoff helper for background pollers and auth/collab
 * retry loops (#1773, #1775). Keeps happy-path intervals unchanged while
 * throttling retries during backend outages (503/504) and preventing storms.
 */

/**
 * Compute capped exponential backoff for `consecutiveFailures` (1-indexed).
 *   1 -> baseMs
 *   2 -> baseMs * 2
 *   3 -> baseMs * 4
 *   ... capped at maxMs.
 */
export function computeBackoffDelay(consecutiveFailures, { baseMs, maxMs } = {}) {
  const failures = Math.max(0, Math.floor(Number(consecutiveFailures) || 0));
  const base = Math.max(0, Number(baseMs) || 0);
  const cap = Math.max(base, Number(maxMs) || base);
  if (failures <= 0 || base <= 0) return 0;
  const shift = Math.min(failures - 1, 20);
  return Math.min(cap, base * (2 ** shift));
}

/**
 * Stateful exponential backoff tracker for a single poller / retry loop.
 */
export function createBackoffState({ baseMs, maxMs, now = () => Date.now() }) {
  let failures = 0;
  let nextAllowedAt = 0;
  return {
    get failures() { return failures; },
    get nextAllowedAt() { return nextAllowedAt; },
    isBlocked() {
      return failures > 0 && now() < nextAllowedAt;
    },
    remainingMs() {
      if (failures <= 0) return 0;
      return Math.max(0, nextAllowedAt - now());
    },
    recordSuccess() {
      failures = 0;
      nextAllowedAt = 0;
    },
    recordFailure() {
      failures += 1;
      const delay = computeBackoffDelay(failures, { baseMs, maxMs });
      nextAllowedAt = now() + delay;
      return delay;
    },
    reset() {
      failures = 0;
      nextAllowedAt = 0;
    },
  };
}
