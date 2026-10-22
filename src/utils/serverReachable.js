// A fast "can we reach the cloud?" check before work that would otherwise sit
// in supabase-js's network retries (about 30 s per request) when offline.
// Any HTTP answer counts as reachable; only a failed or slow fetch does not.
export async function canReachServer(baseUrl, { timeoutMs = 8000, fetchImpl = globalThis.fetch, online = globalThis.navigator?.onLine } = {}) {
  if (online === false) return false;
  if (!baseUrl || typeof fetchImpl !== 'function') return true;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  try {
    await Promise.race([
      fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/auth/v1/health`, { method: 'GET', cache: 'no-store', signal: controller?.signal }),
      new Promise((_, reject) => { timer = setTimeout(() => { controller?.abort(); reject(new Error('timeout')); }, timeoutMs); }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
