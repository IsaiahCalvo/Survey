// Serialized into sw.js by the build plugin. Keep this function self-contained:
// no runtime imports, private data fetches, forced activation, or client reloads.
export function installBrowserOfflineWorker(scope, manifest) {
  const base = new URL(scope.registration.scope);
  const prefix = `survey-static-v1:${encodeURIComponent(base.href)}:`;
  const cacheName = `${prefix}${manifest.version}`;
  const completeUrl = new URL('__survey_offline_complete__', base).href;
  const assets = new Map(manifest.assets.map(asset => [new URL(asset.path, base).href, asset]));
  const indexUrl = new URL('index.html', base).href;
  const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  let repairPromise;

  async function verifyResponse(response, asset) {
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || response.status !== 200 || response.redirected || response.type === 'opaque') throw new Error(`Offline asset response rejected: ${asset.path}`);
    if ((asset.kind === 'script' && !/^(text|application)\/(javascript|ecmascript|x-javascript)$/.test(mime))
      || (asset.kind === 'html' && mime !== 'text/html')
      || (asset.kind === 'style' && mime !== 'text/css')
      || (asset.kind !== 'html' && mime === 'text/html')) throw new Error(`Offline asset MIME rejected: ${asset.path}`);
    const bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength !== asset.bytes || hex(await scope.crypto.subtle.digest('SHA-256', bytes)) !== asset.sha256) throw new Error(`Offline asset integrity rejected: ${asset.path}`);
    return response;
  }

  async function fetchVerified(url, asset, signal) {
    return verifyResponse(await scope.fetch(new Request(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal })), asset);
  }

  async function reuseSources(names) {
    const sources = [];
    for (const name of names) {
      // Never enumerate another app/account cache's entries. Scope and owner
      // must match, and unsealed staging caches cannot be reuse sources.
      if (!name.startsWith(prefix) || name === cacheName) continue;
      try {
        const cache = await scope.caches.open(name);
        const response = await cache.match(completeUrl);
        if (!response) continue;
        const record = await response.json();
        if (typeof record.version === 'string' && name === `${prefix}${record.version}`) sources.push(cache);
      } catch { /* An unreadable prior cache is not evidence; fetch instead. */ }
    }
    return sources;
  }

  async function reusableResponse(cache, url, asset) {
    try {
      const response = await cache.match(url);
      return response ? await verifyResponse(response, asset) : null;
    } catch { return null; }
  }

  async function completedCache() {
    if (!(await scope.caches.keys()).includes(cacheName)) return null;
    const cache = await scope.caches.open(cacheName);
    const response = await cache.match(completeUrl);
    if (!response) return null;
    const record = await response.json();
    if (record.version !== manifest.version) return null;
    // Do not advertise readiness if a cache was cleared or partially removed.
    for (const url of assets.keys()) if (!(await cache.match(url))) return null;
    return { cache, record };
  }

  async function populate(cache, sources, { repair = false, previousCaches = [] } = {}) {
    const pending = Array.from(assets.entries());
    let failure;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const jobs = Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (pending.length && !failure) {
          const [url, asset] = pending.shift();
          try {
            if (repair && await reusableResponse(cache, url, asset)) continue;
            let response;
            for (const source of sources) {
              response = await reusableResponse(source, url, asset);
              if (response) break;
            }
            if (controller.signal.aborted) throw new Error('Offline asset operation cancelled.');
            response ||= await fetchVerified(url, asset, controller.signal);
            if (controller.signal.aborted) throw new Error('Offline asset operation cancelled.');
            await cache.put(url, response);
          } catch (error) {
            failure = error; controller.abort();
          }
        }
      });
      // Wait for all writes to stop before deleting a failed staging cache.
      await Promise.all(jobs);
      if (failure || controller.signal.aborted) throw failure || new Error('Offline asset installation timed out.');
      await cache.put(completeUrl, new Response(JSON.stringify({ version: manifest.version, previousCaches }), { headers: { 'content-type': 'application/json' } }));
    } finally { clearTimeout(timer); }
  }

  async function install() {
    if (await completedCache()) return;
    const previousCaches = (await scope.caches.keys()).filter(name => name.startsWith(prefix) && name !== cacheName);
    // A waiting update must not evict the active bundle to make room. Bound
    // abandoned/waiting versions; activation will remove only its predecessors.
    if (previousCaches.length >= 3) throw new Error('Offline app cache version budget reached; close older app tabs and retry.');
    const cache = await scope.caches.open(cacheName);
    try { await populate(cache, await reuseSources(previousCaches), { previousCaches }); }
    catch (error) { await scope.caches.delete(cacheName); throw error; }
  }

  function repair() {
    if (!repairPromise) {
      repairPromise = (async () => {
        const cache = await scope.caches.open(cacheName);
        // Repair is NOT install rollback. Keep every verified good entry on
        // quota/network failure, and publish completeness only at the end.
        // Per-entry puts are atomic; CacheStorage has no multi-entry transaction.
        await cache.delete(completeUrl);
        const sources = await reuseSources(await scope.caches.keys());
        await populate(cache, sources, { repair: true });
      })().finally(() => { repairPromise = null; });
    }
    return repairPromise;
  }

  scope.addEventListener('install', event => event.waitUntil(install()));
  scope.addEventListener('activate', event => event.waitUntil((async () => {
    const completed = await completedCache();
    if (!completed) throw new Error('Offline bundle is incomplete.');
    // No skipWaiting/claim: normal lifecycle has retired the old controlled
    // clients. Only names seen BEFORE this installation can be removed, never
    // a newer installing/waiting bundle or another app's caches/IndexedDB.
    for (const name of completed.record.previousCaches || []) {
      if (name.startsWith(prefix) && name !== cacheName) await scope.caches.delete(name);
    }
  })()));
  scope.addEventListener('message', event => {
    if (!['SURVEY_OFFLINE_STATUS', 'SURVEY_OFFLINE_REPAIR'].includes(event.data?.type) || !event.ports?.[0]) return;
    event.waitUntil((async () => {
      try {
        if (event.data.type === 'SURVEY_OFFLINE_REPAIR') await repair();
        const completed = await completedCache();
        event.ports[0].postMessage({ type: 'SURVEY_OFFLINE_STATUS', availableOffline: !!completed, version: manifest.version, totalBytes: manifest.totalBytes });
      } catch { event.ports[0].postMessage({ type: 'SURVEY_OFFLINE_STATUS', availableOffline: false }); }
    })());
  });
  scope.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || request.headers.has('authorization') || request.headers.has('range')) return;
    const url = new URL(request.url);
    if (url.origin !== base.origin || url.search || url.hash) return;
    const navigation = request.mode === 'navigate';
    // Only the plain app home is an offline navigation. Auth/invite/reset and
    // user-bearing query routes are deliberately left to the network.
    const home = url.href === base.href || url.href === indexUrl;
    const key = navigation ? (home ? indexUrl : null) : (assets.has(url.href) ? url.href : null);
    if (!key) return;
    event.respondWith((async () => {
      const cache = await scope.caches.open(cacheName);
      const response = await cache.match(key);
      if (response) return response;
      // Only an exact manifest URL can refill a missing entry, and only after
      // verifying this build's bytes. A quota error must not prevent the online
      // caller from using the verified response or delete other good entries.
      const verified = await fetchVerified(key, assets.get(key));
      try { await cache.put(key, verified.clone()); } catch { /* Still not fully available offline. */ }
      return verified;
    })());
  });
}
