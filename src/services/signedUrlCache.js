/**
 * Shared auth-scoped TTL cache and in-flight request deduplicator for Supabase
 * Storage / R2 signed URLs.
 *
 * Cuts redundant `createSignedUrl` / `createSignedUrls` calls (each of which
 * queries `storage.objects` in Postgres) when switching tabs, re-rendering
 * thumbnails/covers, or opening the same file multiple times within its TTL,
 * while strictly clearing cached URLs on sign-out, account switch, replace,
 * delete, or server refusal.
 */

const DEFAULT_MARGIN_SECONDS = 60;
const DEFAULT_MAX_ENTRIES = 2000;
const SEP = '\u0000';

const makeKey = (bucket, path) => (bucket && path ? `${bucket}${SEP}${path}` : null);

export function createSignedUrlCache({
  now = () => Date.now(),
  maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) {
  const entries = new Map(); // key -> { url, expiresAt, stamp, bucket, path }
  const inFlight = new Map(); // key -> { promise, stamp, bucket, path }
  const pathEpochs = new Map(); // key -> number
  const bucketEpochs = new Map(); // bucket -> number
  let generation = 0;

  const pathEpoch = (key) => pathEpochs.get(key) || 0;
  const bucketEpoch = (bucket) => bucketEpochs.get(bucket) || 0;

  const isStillValid = (bucket, key, gen, bEpoch, pEpoch) => (
    gen === generation && bEpoch === bucketEpoch(bucket) && pEpoch === pathEpoch(key)
  );

  const get = (bucket, path, { stamp = null } = {}) => {
    const key = makeKey(bucket, path);
    if (!key) return null;
    const hit = entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    if ((hit.stamp ?? null) !== (stamp ?? null)) return null;
    return hit.url;
  };

  const set = (bucket, path, url, {
    ttlSeconds = 3600,
    marginSeconds = DEFAULT_MARGIN_SECONDS,
    stamp = null,
  } = {}) => {
    const key = makeKey(bucket, path);
    if (!key || typeof url !== 'string' || !url) return false;
    const ttlMs = Math.max(0, (Number(ttlSeconds) - Number(marginSeconds)) * 1000);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
    entries.delete(key); // refresh insertion order for LRU pruning
    entries.set(key, {
      url,
      expiresAt: now() + ttlMs,
      stamp: stamp ?? null,
      bucket,
      path,
    });
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
    return true;
  };

  const getOrFetch = async (bucket, path, fetcher, {
    ttlSeconds = 3600,
    marginSeconds = DEFAULT_MARGIN_SECONDS,
    stamp = null,
  } = {}) => {
    const key = makeKey(bucket, path);
    if (!key || typeof fetcher !== 'function') return null;

    const cached = get(bucket, path, { stamp });
    if (cached) return cached;

    const existing = inFlight.get(key);
    if (existing && (existing.stamp ?? null) === (stamp ?? null)) {
      return existing.promise;
    }

    const gen = generation;
    const bEpoch = bucketEpoch(bucket);
    const pEpoch = pathEpoch(key);
    const record = { promise: null, stamp: stamp ?? null, bucket, path };
    record.promise = Promise.resolve()
      .then(fetcher)
      .then((url) => {
        if (typeof url === 'string' && url && isStillValid(bucket, key, gen, bEpoch, pEpoch)) {
          set(bucket, path, url, { ttlSeconds, marginSeconds, stamp });
        }
        return url;
      })
      .finally(() => {
        if (inFlight.get(key) === record) inFlight.delete(key);
      });
    inFlight.set(key, record);
    return record.promise;
  };

  /**
   * Resolve signed URLs for many paths at once: cached hits return immediately,
   * already-in-flight paths join their active request, and only the remaining
   * paths are sent to `fetchBatch(missingPaths)`.
   *
   * `fetchBatch` may return either a Map<path, url> or an array of
   * `{ path, signedUrl }` rows (the shape returned by Supabase `createSignedUrls`).
   */
  const getOrFetchBatch = async (bucket, paths, fetchBatch, {
    ttlSeconds = 3600,
    marginSeconds = DEFAULT_MARGIN_SECONDS,
  } = {}) => {
    const out = new Map();
    if (!bucket || typeof fetchBatch !== 'function') return out;

    const unique = [...new Set((paths || []).filter((p) => typeof p === 'string' && p))];
    if (unique.length === 0) return out;

    const waiting = [];
    const missing = [];
    for (const path of unique) {
      const hit = get(bucket, path);
      if (hit) {
        out.set(path, hit);
        continue;
      }
      const key = makeKey(bucket, path);
      const pending = inFlight.get(key);
      if (pending && pending.stamp === null) {
        waiting.push({ path, promise: pending.promise });
        continue;
      }
      missing.push(path);
    }

    if (missing.length > 0) {
      const gen = generation;
      const bEpoch = bucketEpoch(bucket);
      const resolvers = new Map();
      const missingEpochs = new Map();

      for (const path of missing) {
        const key = makeKey(bucket, path);
        missingEpochs.set(path, pathEpoch(key));
        let resolveUrl;
        let rejectUrl;
        const promise = new Promise((resolve, reject) => {
          resolveUrl = resolve;
          rejectUrl = reject;
        });
        // Prevent unhandled rejections if no external waiter attaches before settle.
        promise.catch(() => {});
        const record = { promise, stamp: null, bucket, path };
        inFlight.set(key, record);
        resolvers.set(path, { key, record, resolveUrl, rejectUrl });
      }

      try {
        const fetched = await fetchBatch(missing);
        const byPath = new Map();
        if (fetched instanceof Map) {
          for (const [p, url] of fetched) {
            if (typeof url === 'string' && url) byPath.set(p, url);
          }
        } else if (Array.isArray(fetched)) {
          for (const row of fetched) {
            if (row?.path && typeof row?.signedUrl === 'string' && row.signedUrl) {
              byPath.set(row.path, row.signedUrl);
            }
          }
        }
        for (const path of missing) {
          const { key, record, resolveUrl } = resolvers.get(path);
          if (inFlight.get(key) === record) inFlight.delete(key);
          const url = byPath.get(path) || null;
          if (url) {
            if (isStillValid(bucket, key, gen, bEpoch, missingEpochs.get(path))) {
              set(bucket, path, url, { ttlSeconds, marginSeconds });
            }
            out.set(path, url);
          }
          resolveUrl(url);
        }
      } catch (error) {
        for (const path of missing) {
          const { key, record, rejectUrl } = resolvers.get(path);
          if (inFlight.get(key) === record) inFlight.delete(key);
          rejectUrl(error);
        }
        throw error;
      }
    }

    if (waiting.length > 0) {
      const settled = await Promise.allSettled(waiting.map((w) => w.promise));
      for (let i = 0; i < waiting.length; i += 1) {
        const res = settled[i];
        if (res.status === 'fulfilled' && typeof res.value === 'string' && res.value) {
          out.set(waiting[i].path, res.value);
        }
      }
    }

    return out;
  };

  const invalidate = (bucket, path) => {
    const key = makeKey(bucket, path);
    if (!key) return;
    pathEpochs.set(key, pathEpoch(key) + 1);
    entries.delete(key);
    inFlight.delete(key);
  };

  const invalidateBucket = (bucket) => {
    if (!bucket) return;
    bucketEpochs.set(bucket, bucketEpoch(bucket) + 1);
    for (const [key, entry] of entries) {
      if (entry.bucket === bucket) entries.delete(key);
    }
    for (const [key, entry] of inFlight) {
      if (entry.bucket === bucket) inFlight.delete(key);
    }
  };

  const clear = () => {
    generation += 1;
    entries.clear();
    inFlight.clear();
  };

  const hasFresh = (bucket, path) => {
    const key = makeKey(bucket, path);
    if (!key) return false;
    const hit = entries.get(key);
    if (!hit) return false;
    if (hit.expiresAt <= now()) {
      entries.delete(key);
      return false;
    }
    return true;
  };

  const stats = () => ({ entries: entries.size, inFlight: inFlight.size });

  return {
    get,
    set,
    hasFresh,
    getOrFetch,
    getOrFetchBatch,
    invalidate,
    invalidateBucket,
    clear,
    stats,
  };
}

const boundClients = new WeakMap();

/**
 * Clear `cache` on sign-out or account switch. Safe to call multiple times for
 * the same (client, cache) pair. Never calls async auth methods inside the
 * synchronous Supabase callback.
 */
export function bindSignedUrlCacheToAuth(client, cache) {
  if (!client?.auth?.onAuthStateChange || !cache) return;
  let caches = boundClients.get(client);
  if (caches?.has(cache)) return;
  if (!caches) {
    caches = new WeakSet();
    boundClients.set(client, caches);
  }
  caches.add(cache);

  let actorId;
  client.auth.onAuthStateChange((event, session) => {
    const nextActor = session?.user?.id ?? null;
    const initial = event === 'INITIAL_SESSION' && actorId === undefined;
    if (event === 'SIGNED_OUT' || (!initial && (event !== 'TOKEN_REFRESHED' || actorId !== nextActor))) {
      cache.clear();
    }
    actorId = nextActor;
  });
}

let shared = null;
export function signedUrlCache() {
  if (!shared) shared = createSignedUrlCache();
  return shared;
}
