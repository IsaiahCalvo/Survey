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
