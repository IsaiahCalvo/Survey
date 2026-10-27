export const AUTH_LOCK_ACQUIRE_TIMEOUT_MS = 2500;

export const createSafeNavigatorLock = (
  navigatorLockImpl,
  navigatorObject = globalThis?.navigator,
) => (name, acquireTimeout, callback) => {
  const canUseBrowserLocks = typeof navigatorObject?.locks?.request === 'function';
  if (typeof navigatorLockImpl !== 'function' || !canUseBrowserLocks) {
    return callback();
  }

  const nextTimeout = acquireTimeout > AUTH_LOCK_ACQUIRE_TIMEOUT_MS
    ? AUTH_LOCK_ACQUIRE_TIMEOUT_MS
    : acquireTimeout;
  return navigatorLockImpl(name, nextTimeout, callback);
};

// Open speed (2026-10-27): every supabase-js request reads the session under
// the auth lock first. Holding it takes ~0 ms, but each navigator.locks grant
// is its own main-thread task, handed out one at a time. During a document
// open ~30 requests queue at once while the main thread is busy, so the last
// ones waited 0.3-0.6 s for a lock nobody was using (1.3-2.9 s on a slow CPU,
// where auth-js then stole the lock from itself 5-10 times per open). Here a call that asks
// while this tab already has a request for the lock queued or held joins that
// request's turn and runs right after the calls before it, still under the
// same lock. Other tabs are excluded exactly as before, and the calls run one
// at a time, in order, as before. A call with acquireTimeout 0 means "only if
// free right now" (auth-js's refresh tick), so it never joins or leads a turn.
export const createTabBatchedLock = (lockImpl) => {
  const turns = new Map();
  // A call stuck in a turn behind one that never finishes would never reach
  // auth-js's steal-on-timeout recovery. Once the call running ahead of it has
  // run for the waiting call's timeout, it leaves the turn and asks the lock
  // itself, as it did before. The clock restarts each time a call finishes:
  // a long queue that keeps moving is not stuck, and leaving it would make
  // this tab steal the lock from itself (the running call then fails).
  const armEscape = (name, turn, item) => {
    clearTimeout(item.timer);
    if (!(item.acquireTimeout > 0)) return;
    item.timer = setTimeout(() => {
      const at = turn.queue.indexOf(item);
      if (at < 0) return;
      turn.queue.splice(at, 1);
      lockImpl(name, item.acquireTimeout, item.callback).then(item.resolve, item.reject);
    }, item.acquireTimeout);
  };
  const batchedLock = (name, acquireTimeout, callback) => {
    if (acquireTimeout === 0) return lockImpl(name, acquireTimeout, callback);
    return new Promise((resolve, reject) => {
      const open = turns.get(name);
      if (open) {
        const item = { callback, resolve, reject, acquireTimeout };
        open.queue.push(item);
        armEscape(name, open, item);
        return;
      }
      const turn = { queue: [{ callback, resolve, reject }] };
      turns.set(name, turn);
      const close = () => { if (turns.get(name) === turn) turns.delete(name); };
      Promise.resolve()
        .then(() => lockImpl(name, acquireTimeout, async () => {
          turn.granted = true;
          while (turn.queue.length) {
            const item = turn.queue.shift();
            clearTimeout(item.timer);
            for (const waiting of turn.queue) armEscape(name, turn, waiting);
            turn.running = item;
            try { item.resolve(await item.callback()); } catch (error) { item.reject(error); }
            turn.running = null;
          }
          // Closed in the same tick the queue empties: a later call starts a
          // new turn (its own grant) instead of joining a released lock.
          close();
        }))
        .catch((error) => {
          close();
          const waiting = turn.queue.splice(0);
          // Never granted: every call in the turn gets the error it would
          // have got on its own. Granted, then lost (stolen while held): the
          // call that was running gets the steal error at once, as it would
          // on its own (readStartupSession reads it as "offline"); the rest
          // ask again.
          turn.running?.reject(error);
          turn.running = null;
          for (const item of waiting) {
            clearTimeout(item.timer);
            if (turn.granted) batchedLock(name, acquireTimeout, item.callback).then(item.resolve, item.reject);
            else item.reject(error);
          }
        });
    });
  };
  return batchedLock;
};
