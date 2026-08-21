# bookmarks-panel — fix log

Date: 2026-08-20
Allowlist: `src/sidebar/BookmarksPanel.jsx`, `src/sidebar/bookmarkEditUtils.js`, `src/sidebar/bookmarkReorderUtils.js`, matching tests.
Did not edit PDFViewer.jsx.

## P1-44 — New bookmarks jump to top of an already-ordered list

- Status: **closed**
- Files changed: `src/sidebar/bookmarkEditUtils.js` (`nextBookmarkOrder`), `src/sidebar/BookmarksPanel.jsx` (create / add-child / new-group / add-to-group)
- Intended behavior confirmed: new root bookmarks stamp `max(sibling.order)+1`; nested creates do the same under the parent. Missing `order` is treated as 0 so a post-import list (orders 2, 5) appends at 6, not 0.
- Break / adversarial attempts: empty list → 0; sibling with no `order` → 1; folder-local series does not steal the root max.
- Edges covered: root vs nested parentId; already-ordered imported outline.
- Test command + result: `node --test tests/bookmarkAtomicEdit.test.mjs tests/bookmarkReorderUtils.test.mjs` → pass
- Remaining risk: existing bookmarks that still lack `order` keep sorting as 0 until the next persist rewrite. Parent `onBookmarkCreate` (PDFViewer) is unchanged.

## P1-45 — Deleting a bookmark group nukes nested bookmarks with no count/undo

- Status: **closed** (confirm + count; undo not plumbed — PDFViewer is out of allowlist)
- Files changed: `src/sidebar/bookmarkEditUtils.js` (`countNestedBookmarks`, `formatBookmarkDeleteConfirm`), `src/sidebar/BookmarksPanel.jsx` (`handleDelete` used by desktop edit-mode and mobile trash)
- Intended behavior confirmed: confirm names the group and the descendant count, and says the delete cannot be undone. A leaf bookmark still gets the simple confirm.
- Break / adversarial attempts: 0 descendants; 1 nested; folder-in-folder (4 descendants including the nested folder row).
- Edges covered: flat parentId walk (does not depend on in-memory tree children).
- Test command + result: `tests/bookmarkAtomicEdit.test.mjs` → pass
- Remaining risk: still no undo / 30-day trash (that lives in PDFViewer). User must confirm.

## P1-47 — Bookmark drag-reorder is O(n²)

- Status: **closed**
- Files changed: `src/sidebar/bookmarkReorderUtils.js` (`collectBookmarkTreePersistUpdates`), `src/sidebar/BookmarksPanel.jsx` (`persistBookmarkTree`; optional `onBookmarkUpdates` batch prop)
- Intended behavior confirmed: a no-op tree emits `[]`. A single nest/move emits only the rows whose `order` or `parentId` changed, not every bookmark.
- Break / adversarial attempts: identical tree vs current bookmarks → no writes; typical nest updates fewer rows than the list length.
- Edges covered: parent change + sibling index rewrite.
- Test command + result: `tests/bookmarkReorderUtils.test.mjs` → pass
- Remaining risk: without a parent `onBookmarkUpdates` batch, each changed row still calls `onBookmarkUpdate` once. Worst-case sibling reshuffle can still be O(n) updates (was O(n) calls × O(n) maps). Optional batch prop is ready for a later PDFViewer wire-up.

## P1-48 — Rejected duplicate-name bookmark rename keeps showing unsaved name

- Status: **closed**
- Files changed: `src/sidebar/bookmarkEditUtils.js` (`prepareBookmarkNameEdit`), `src/sidebar/BookmarksPanel.jsx` (`handleRename` returns false + toast; `commitName` resets `editName`; mobile save reverts fields)
- Intended behavior confirmed: duplicate / blank name is rejected, toast shown, field reverts to the saved name. Same-type conflict only (matches existing `hasNameConflict` predicate).
- Break / adversarial attempts: `Roof` vs existing `Roof`; whitespace-only; successful rename still returns `{ name }`.
- Edges covered: desktop inline field + mobile editor.
- Test command + result: `tests/bookmarkAtomicEdit.test.mjs` → pass
- Remaining risk: folders and bookmarks are compared only against the same `type`, so a folder and bookmark can still share a name (pre-existing rule).
