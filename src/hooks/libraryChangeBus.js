/**
 * A one-line notification that the user's document/project library changed
 * outside the hook that owns it (KAL-430).
 *
 * The Archive screen restores and permanently deletes rows, but the Documents
 * and Projects lists are held by useDocuments()/useProjects() instances mounted
 * elsewhere. Without this, a restored document would not reappear until the
 * next remount. Deliberately tiny — a set of callbacks, no state, no payload:
 * subscribers simply refetch.
 */

const listeners = new Set();

/** Subscribe to library changes. Returns an unsubscribe function. */
export function subscribeLibraryChange(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announce that documents and/or projects changed and lists should refetch. */
export function notifyLibraryChanged() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      // One bad subscriber must never stop the others from refreshing.
      console.warn('[library-change] subscriber failed:', err);
    }
  }
}

// Templates only (2026-10-07, shared templates): a template another person
// shared with you may land while the app is open; the templates lists read
// again without making the document and project lists refetch too.
const templateListeners = new Set();

/** Subscribe to template-list changes. Returns an unsubscribe function. */
export function subscribeTemplatesChange(listener) {
  if (typeof listener !== 'function') return () => {};
  templateListeners.add(listener);
  return () => templateListeners.delete(listener);
}

/** Announce that the templates lists should read again. */
export function notifyTemplatesChanged() {
  for (const listener of [...templateListeners]) {
    try {
      listener();
    } catch (err) {
      console.warn('[library-change] template subscriber failed:', err);
    }
  }
}
