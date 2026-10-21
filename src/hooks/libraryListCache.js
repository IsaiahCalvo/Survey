/**
 * Device copy of the home lists (Documents, Projects, Templates, Archive) so a
 * repeat visit paints the last known list at once and refreshes from the
 * server behind it (Drawboard-style). Only row metadata is kept — never file
 * bytes: binary values and data: URLs are dropped before writing.
 *
 * Every entry is keyed by the signed-in user's id, so one account's list is
 * never read back for another. The whole cache is emptied on sign-out and
 * other accounts' entries are dropped on sign-in (bindLibraryListCacheToAuth).
 */
export const LIBRARY_LIST_CACHE_PREFIX = 'survey.libraryList.v1:';
const MAX_ENTRY_CHARS = 2_000_000;

const defaultStorage = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};

export function libraryListCacheKey(userId, kind) {
  if (!userId || !kind) return null;
  return `${LIBRARY_LIST_CACHE_PREFIX}${userId}:${kind}`;
}

function stripBytes(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value.startsWith('data:') ? undefined : value;
  if (typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return undefined;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
  if (Array.isArray(value)) return value.map(stripBytes).filter((v) => v !== undefined);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'function') continue;
    const next = stripBytes(v);
    if (next !== undefined) out[k] = next;
  }
  return out;
}

export function readLibraryListCache(userId, kind, { storage = defaultStorage() } = {}) {
  const key = libraryListCacheKey(userId, kind);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.userId !== userId || !Array.isArray(parsed.rows)) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

export function writeLibraryListCache(userId, kind, rows, { storage = defaultStorage(), now = Date.now } = {}) {
  const key = libraryListCacheKey(userId, kind);
  if (!key || !storage || !Array.isArray(rows)) return false;
  try {
    const text = JSON.stringify({ userId, savedAt: now(), rows: stripBytes(rows) });
    if (text.length > MAX_ENTRY_CHARS) {
      storage.removeItem(key);
      return false;
    }
    storage.setItem(key, text);
    return true;
  } catch {
    return false; // quota or private mode: the server read still fills the list
  }
}

/** Remove every cached list, or every list not belonging to `keepUserId`. */
export function clearLibraryListCache({ keepUserId = null, storage = defaultStorage() } = {}) {
  if (!storage) return;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(LIBRARY_LIST_CACHE_PREFIX)) keys.push(key);
    }
    const keepPrefix = keepUserId ? `${LIBRARY_LIST_CACHE_PREFIX}${keepUserId}:` : null;
    for (const key of keys) {
      if (keepPrefix && key.startsWith(keepPrefix)) continue;
      storage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}

// Is a Supabase session still stored on this device? An offline start with an
// expired access token reports INITIAL_SESSION without a session although the
// refresh token is still there (auth-js _emitInitialSession): that must not
// empty the cache — same rule as bindPdfCacheToAuth.
function storedSessionExists(storage, storageKey) {
  try {
    if (storageKey) return Boolean(storage.getItem(storageKey));
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && /^sb-.*-auth-token$/.test(key) && storage.getItem(key)) return true;
    }
  } catch { /* storage unavailable: treat as signed out */ }
  return false;
}

export function bindLibraryListCacheToAuth(client, { storage = defaultStorage() } = {}) {
  if (!client?.auth?.onAuthStateChange) return;
  client.auth.onAuthStateChange((event, session) => {
    const actor = session?.user?.id ?? null;
    if (event === 'SIGNED_OUT' || (!actor && !storedSessionExists(storage, client.auth.storageKey))) {
      clearLibraryListCache({ storage });
      return;
    }
    if (!actor) return; // session still stored (offline start): keep the cache
    clearLibraryListCache({ keepUserId: actor, storage });
  });
}
