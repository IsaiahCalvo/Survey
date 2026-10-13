/*
 * KAL-461 / KAL-464 (phone): the bottom sheet unmounts its panels when it
 * closes, so a tap outside or a swipe down in the middle of typing a new
 * bookmark (or a folder, or an edit) threw the words away. The half-typed
 * line is kept here, per document, and is back - unsaved, with the same
 * words - when the panel opens again. It is dropped once it is created,
 * saved or cancelled. Nothing is created or saved behind your back: a
 * bookmark needs its Create, an edit its Save.
 */
const mobileBookmarkDrafts = new Map();
export function readMobileBookmarkDraft(key) {
  return mobileBookmarkDrafts.get(key ?? '') || null;
}
export function writeMobileBookmarkDraft(key, draft) {
  const k = key ?? '';
  const typed = draft && (
    (draft.showCreateMenu && !draft.showMobileFolderEditor && (draft.newBookmarkName || draft.newBookmarkPages))
    || (draft.showMobileFolderEditor && draft.newFolderName)
    || draft.mobileEditingBookmarkId
  );
  if (typed) mobileBookmarkDrafts.set(k, { ...draft });
  else mobileBookmarkDrafts.delete(k);
}
