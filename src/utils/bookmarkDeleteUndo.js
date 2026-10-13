// KAL-461 — deleting a bookmark (or a folder, with everything in it) is
// undoable: the delete happens at once and the app's Undo toast puts every
// removed row back exactly where it was. Bookmarks are a flat array whose
// order is the list order, so a restore re-inserts each row at its old index.

/** Remove `id` and every bookmark nested under it. */
export function removeBookmarkWithDescendants(list, id) {
  const rows = Array.isArray(list) ? list : [];
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    rows.forEach((row) => {
      if (row?.parentId && ids.has(row.parentId) && !ids.has(row.id)) {
        ids.add(row.id);
        grew = true;
      }
    });
  }
  const removed = [];
  const next = [];
  rows.forEach((row, index) => {
    if (ids.has(row?.id)) removed.push({ bookmark: row, index });
    else next.push(row);
  });
  return { next: removed.length ? next : rows, removed };
}

/**
 * Put removed rows back at their old positions (ascending index, so each
 * earlier insert lands before the later ones are counted). Rows that are
 * already there again (a collaborator re-made one) are not doubled.
 */
export function restoreRemovedBookmarks(list, removed) {
  const next = Array.isArray(list) ? [...list] : [];
  const present = new Set(next.map((row) => row?.id));
  [...(removed || [])]
    .sort((a, b) => a.index - b.index)
    .forEach(({ bookmark, index }) => {
      if (!bookmark || present.has(bookmark.id)) return;
      next.splice(Math.min(Math.max(0, index), next.length), 0, bookmark);
      present.add(bookmark.id);
    });
  return next;
}

/** The toast's sentence: the name of what went, plainly. */
export function bookmarkDeleteMessage(removed) {
  const first = removed?.[0]?.bookmark;
  if (!first) return '';
  const name = typeof first.name === 'string' && first.name.trim() ? first.name.trim() : null;
  const kind = first.type === 'folder' ? 'Folder' : 'Bookmark';
  return name ? `Deleted “${name}”` : `${kind} deleted`;
}
