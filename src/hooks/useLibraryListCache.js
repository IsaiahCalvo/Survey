import { useEffect, useLayoutEffect, useState } from 'react';
import { readLibraryListCache, writeLibraryListCache } from './libraryListCache.js';

// Opt-in device copy of a home list (libraryListCache.js). Before the first
// server read of a scope settles, the cached rows for that user+scope are
// painted and `showingCached` is true; the read then replaces them. Every
// settled list is written back so the next visit starts from it.
export function useLibraryListCache({ enabled, userId, kind, scopeKey, loadedScopeKey, rows, setRows }) {
  const [cachedScopeKey, setCachedScopeKey] = useState(null);
  useLayoutEffect(() => {
    if (!enabled || !userId) return;
    const cached = readLibraryListCache(userId, kind);
    if (cached) {
      // Keep in-memory rows only when they already belong to this scope
      // (the server settled it). `current.length` is the previous account
      // on an in-place switch — never paint or later persist those.
      setRows((current) => (loadedScopeKey === scopeKey ? current : cached));
      setCachedScopeKey(scopeKey);
    } else {
      setCachedScopeKey(null);
      if (loadedScopeKey !== scopeKey) {
        setRows((current) => (current.length ? [] : current));
      }
    }
  }, [enabled, userId, kind, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled || !userId || loadedScopeKey !== scopeKey) return;
    writeLibraryListCache(userId, kind, rows);
  }, [enabled, userId, kind, scopeKey, loadedScopeKey, rows]);
  return loadedScopeKey !== scopeKey && cachedScopeKey === scopeKey;
}

