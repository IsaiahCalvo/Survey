/**
 * One-at-a-time idle backfill for missing document thumbnails.
 *
 * Why (owner 2026-09-23: "Why do a lot of these not have thumbnails?"): since
 * the egress cut (#801, 2026-09-07) a list row only shows a thumbnail that is
 * ALREADY cached on this device; a miss stays a placeholder until the document
 * is selected in the preview pane. Documents uploaded on another device, or
 * never previewed here, therefore never got one.
 *
 * The rows keep that rule (a row never downloads). This queue is the only
 * thing that fills gaps, and it is built to be invisible:
 *   - exactly one document at a time, with a gap between jobs;
 *   - only when the browser is idle, the list is on screen, the window is
 *     visible and the user is not mid-gesture (`isBusy`);
 *   - rows the user can see jump the queue (`prioritize`);
 *   - resumable for free: "done" is read back from the durable cache, so a
 *     reload continues where the last visit stopped and never redoes work;
 *   - bounded retries: a failing document is tried `maxAttempts` times per
 *     session, and permanent skips (too big / unreadable) are remembered by
 *     the caller's `needsThumbnail` so they are not retried every visit.
 *
 * Pure: every side effect is injected, so the Node suite drives it with fakes.
 */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function defaultWaitForIdle() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 2000 });
    } else {
      // Safari / the iOS WebView have no requestIdleCallback.
      setTimeout(resolve, 250);
    }
  });
}

export function createThumbnailBackfill({
  needsThumbnail,
  generate,
  keyOf = (doc) => doc?.id ?? null,
  waitForIdle = defaultWaitForIdle,
  isBusy = () => false,
  sleep = defaultSleep,
  gapMs = 750,
  busyRetryMs = 2000,
  maxAttempts = 2,
  onError = null,
} = {}) {
  let queue = [];
  const finished = new Set();
  const attempts = new Map();
  let running = null;
  let stopped = false;
  let active = 0;
  const stats = { generated: 0, alreadyCached: 0, failed: 0, maxConcurrent: 0, busyWaits: 0 };

  const has = (key) => queue.some((doc) => keyOf(doc) === key);

  async function runOne(doc) {
    const key = keyOf(doc);
    if (!key || finished.has(key)) return false;
    let needed = false;
    try { needed = await needsThumbnail(doc); } catch { needed = false; }
    if (!needed) {
      finished.add(key);
      stats.alreadyCached += 1;
      return false;
    }
    active += 1;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, active);
    try {
      await generate(doc, { isCancelled: () => stopped });
      finished.add(key);
      stats.generated += 1;
    } catch (error) {
      const tries = (attempts.get(key) || 0) + 1;
      attempts.set(key, tries);
      if (tries >= maxAttempts) {
        finished.add(key);
        stats.failed += 1;
      } else if (!has(key)) {
        queue.push(doc); // try again later, behind everything else
      }
      try { onError?.(error, doc); } catch { /* reporting must not stop the queue */ }
    } finally {
      active -= 1;
    }
    return true;
  }

  async function loop() {
    while (!stopped && queue.length) {
      await waitForIdle();
      if (stopped) break;
      if (isBusy()) {
        stats.busyWaits += 1;
        await sleep(busyRetryMs);
        continue;
      }
      const doc = queue.shift();
      const didWork = await runOne(doc);
      // Pace only after real work; cache checks are a local read.
      if (didWork && !stopped && queue.length) await sleep(gapMs);
    }
  }

  function kick() {
    if (stopped || running || !queue.length) return running;
    running = loop().finally(() => { running = null; if (!stopped && queue.length) kick(); });
    return running;
  }

  return {
    /** Replace the background order with the list as currently shown. */
    setDocuments(docs = []) {
      const priority = queue.filter((doc) => doc?.__thumbPriority);
      const seen = new Set(priority.map(keyOf));
      queue = priority.concat((docs || []).filter((doc) => {
        const key = keyOf(doc);
        if (!key || finished.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
      kick();
    },
    /** A row the user can see is missing its thumbnail: do it next. */
    prioritize(doc) {
      const key = keyOf(doc);
      if (!key || finished.has(key)) return;
      queue = queue.filter((entry) => keyOf(entry) !== key);
      queue.unshift({ ...doc, __thumbPriority: true });
      kick();
    },
    /** Forget that `doc` was handled so a new version is generated. */
    invalidate(doc) {
      const key = keyOf(doc);
      if (key) { finished.delete(key); attempts.delete(key); }
    },
    stop() { stopped = true; queue = []; },
    whenIdle() { return running || Promise.resolve(); },
    get pending() { return queue.length; },
    stats,
  };
}
