// Advisory origin-wide storage information. Never reserves space, vetoes Save,
// requests persistence on mount, or labels profile storage as an outside backup.
function manager(window) { try { return window?.navigator?.storage; } catch { return null; } }
function native(window) {
  try { return !!(window?.electronAPI || window?.ReactNativeWebView || window?.Capacitor?.isNativePlatform?.() || window?.location?.protocol === 'file:'); }
  catch { return true; }
}
function method(storage, name) { try { return typeof storage?.[name] === 'function' ? storage[name].bind(storage) : null; } catch { return null; } }
function bounded(operation, timeoutMs) {
  if (!operation) return Promise.resolve({ value: null, unavailable: true });
  let timer;
  return Promise.race([
    Promise.resolve().then(operation).then(value => ({ value }), () => ({ value: null, error: true })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ value: null, error: true }), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
export async function readLocalStorageStatus(window, { timeoutMs = 2500 } = {}) {
  const storage = manager(window); const isNative = native(window);
  const [estimate, persisted] = await Promise.all([
    bounded(method(storage, 'estimate'), timeoutMs),
    isNative ? Promise.resolve({ value: null }) : bounded(method(storage, 'persisted'), timeoutMs),
  ]);
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  let usage = null; let quota = null;
  try {
    if (valid(estimate.value?.usage)) usage = estimate.value.usage;
    if (valid(estimate.value?.quota) && estimate.value.quota > 0) quota = estimate.value.quota;
  } catch { /* An invalid estimate is unknown, not zero space. */ }
  let canRequest = false;
  try { canRequest = !isNative && window?.isSecureContext === true && !!method(storage, 'persist'); } catch { /* unavailable */ }
  return { native: isNative, usage, quota,
    pressure: usage !== null && quota !== null && usage / quota >= 0.9,
    persistence: isNative ? 'profile' : persisted.value === true ? 'granted' : persisted.value === false ? 'best-effort' : 'unknown',
    canRequest, unavailable: !!(estimate.error || persisted.error || estimate.unavailable || persisted.unavailable) };
}
export async function requestLocalStoragePersistence(window, { timeoutMs = 10_000 } = {}) {
  // Called only from the explicit button. Keep invocation in that user gesture.
  let operation;
  try {
    if (native(window) || window?.isSecureContext !== true) return 'unavailable';
    operation = method(manager(window), 'persist');
    if (!operation) return 'unavailable';
  } catch { return 'unavailable'; }
  let promise;
  try { promise = operation(); } catch { return 'unknown'; }
  const result = await bounded(() => promise, timeoutMs);
  return result.value === true ? 'granted' : result.value === false ? 'denied' : 'unknown';
}
