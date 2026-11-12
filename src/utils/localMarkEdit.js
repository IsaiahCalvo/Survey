// A mark changed on this screen (the annotation store queued a local edit).
// The OneDrive save-back (hooks/useDriveSyncBack.js) pushes only after one,
// never for a remote change or an open, as Drawboard pushes only when changed.
export const LOCAL_MARK_EDIT_EVENT = 'survey:local-mark-edit';

export function announceLocalMarkEdit(documentId) {
  if (!documentId) return;
  try { globalThis.dispatchEvent?.(new CustomEvent(LOCAL_MARK_EDIT_EVENT, { detail: { documentId: String(documentId) } })); } catch { /* no DOM */ }
}
