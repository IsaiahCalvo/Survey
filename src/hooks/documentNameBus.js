/**
 * The one place a document's new name is announced (2026-10-28).
 *
 * A document's name is held in several places at once: the open tabs (tab,
 * tooltip, overflow list, phone header, the viewer's export and print names),
 * the shell's `documents` list and each useDocuments() list (Documents tab,
 * project tree, file counts). A rename used to patch only the list it started
 * from, so an open tab kept the old name until a reload.
 *
 * Every rename, local or from another screen (documentNameRealtime.js), goes
 * through announceDocumentName(); every holder subscribes and patches its own
 * copy in the same render. The bus remembers the newest name per document, so
 * an older echo (A -> B -> C, with B's broadcast landing after C) never puts a
 * stale name back.
 */

// documentId -> { name, at } (at = ms of the change, from the row's updated_at)
const latest = new Map();
const listeners = new Set();

function changeTime(at) {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  const parsed = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Announce a document's name. `at` is when the change was made (ms or an ISO
 * time, usually the row's updated_at). A change older than the newest one
 * already announced for that document is dropped. Returns true when
 * subscribers were told.
 */
export function announceDocumentName(documentId, name, { at } = {}) {
  const id = documentId == null ? '' : String(documentId);
  const nextName = typeof name === 'string' ? name.trim() : '';
  if (!id || !nextName) return false;
  const when = changeTime(at);
  const known = latest.get(id);
  if (known && when < known.at) return false;
  latest.set(id, { name: nextName, at: when });
  if (known?.name === nextName) return false;
  for (const listener of [...listeners]) {
    try {
      listener({ id, name: nextName });
    } catch (err) {
      // One bad subscriber must never stop the others from renaming.
      console.warn('[document-name] subscriber failed:', err);
    }
  }
  return true;
}

/** The newest name announced for a document in this session, or null. */
export function latestDocumentName(documentId) {
  return latest.get(String(documentId))?.name ?? null;
}

/** Subscribe to renames: listener({ id, name }). Returns an unsubscribe function. */
export function subscribeDocumentNames(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Apply one rename to a list of rows keyed by `id`. Returns the same array
 * when nothing changed, so a React setState with it is a no-op.
 */
export function renameRows(rows, { id, name }) {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (row == null || String(row.id) !== id || row.name === name) return row;
    changed = true;
    return { ...row, name };
  });
  return changed ? next : rows;
}

/** Test hook: forget every remembered name and subscriber. */
export function resetDocumentNameBusForTests() {
  latest.clear();
  listeners.clear();
}
