/**
 * Copy marks in one document, paste them in another (beta flag
 * 'paste-across-documents', Drawboard PDF Pro trial audit 2026-11-09).
 *
 * Each open tab has its own viewer, and each viewer kept its own clipboards,
 * so a Copy in one tab was gone in the next. With the flag on, the viewers
 * share one set of clipboards here. Each entry remembers the document it was
 * copied from: Survey Markers belong to their document's survey, so they
 * paste only back into it (familyClipboardForDocument drops them elsewhere).
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

export const CLIPBOARD_KEYS = Object.freeze(['annotation', 'callout', 'calloutType', 'family']);

const entries = new Map(CLIPBOARD_KEYS.map((key) => [key, { value: null, documentId: null }]));
const listeners = new Set();

export function readSharedClipboard(key) {
  return entries.get(key) || { value: null, documentId: null };
}

export function writeSharedClipboard(key, value, documentId = null) {
  const current = readSharedClipboard(key);
  if (current.value === value && current.documentId === documentId) return;
  entries.set(key, { value, documentId });
  listeners.forEach((listener) => listener());
}

export function subscribeSharedClipboard(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget everything (tests). */
export function resetSharedClipboard() {
  CLIPBOARD_KEYS.forEach((key) => entries.set(key, { value: null, documentId: null }));
  listeners.forEach((listener) => listener());
}

/**
 * The family clipboard as seen from `documentId`: from another document it
 * keeps the marks and callouts and leaves the Survey Markers behind.
 */
export function familyClipboardForDocument(entry, documentId) {
  const clipboard = entry?.value || null;
  if (!clipboard || !entry.documentId || entry.documentId === documentId) return clipboard;
  const items = (clipboard.items || []).filter((item) => item?.kind !== 'marker');
  if (items.length === 0) return null;
  return items.length === clipboard.items.length ? clipboard : { ...clipboard, items };
}

/**
 * useState for one clipboard. Shared across viewers when `shared` is true,
 * this viewer's own otherwise. The setter takes a value or an updater.
 */
export function useMarkClipboard(key, { shared = false, documentId = null } = {}) {
  const [local, setLocal] = useState(null);
  const entry = useSyncExternalStore(subscribeSharedClipboard, () => readSharedClipboard(key), () => readSharedClipboard(key));
  const sharedValue = useMemo(
    () => (key === 'family' ? familyClipboardForDocument(entry, documentId) : entry.value),
    [key, entry, documentId],
  );
  const value = shared ? sharedValue : local;
  const setValue = useCallback((next) => {
    if (!shared) {
      setLocal(next);
      return;
    }
    const current = readSharedClipboard(key);
    const resolved = typeof next === 'function' ? next(current.value) : next;
    writeSharedClipboard(key, resolved, resolved == null ? null : documentId);
  }, [shared, key, documentId]);
  return [value, setValue];
}
