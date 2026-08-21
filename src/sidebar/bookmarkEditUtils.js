import { hasNameConflict } from '../viewerShared.js';

export const prepareAtomicBookmarkEdit = ({
  bookmarks,
  bookmark,
  name,
  page,
  numPages,
}) => {
  const nextName = typeof name === 'string' ? name.trim() : '';
  if (!nextName) {
    return { ok: false, error: 'Please enter a bookmark name.' };
  }

  const nextPage = Number.parseInt(typeof page === 'string' ? page.trim() : page, 10);
  if (!Number.isInteger(nextPage) || nextPage < 1 || (numPages && nextPage > numPages)) {
    return {
      ok: false,
      error: numPages
        ? `Please enter a page number between 1 and ${numPages}.`
        : 'Please enter a valid page number.',
    };
  }

  if (hasNameConflict(bookmarks, nextName, {
    predicate: (item) => item?.type === bookmark?.type,
    ignoreId: bookmark?.id,
  })) {
    return {
      ok: false,
      error: 'A bookmark with this name already exists. Please choose a different name.',
    };
  }

  return {
    ok: true,
    updates: {
      name: nextName,
      pageIds: [nextPage],
    },
  };
};

export const prepareBookmarkCreate = ({ bookmarks = [], name, page, numPages }) => (
  prepareAtomicBookmarkEdit({
    bookmarks,
    bookmark: { type: 'bookmark', id: '__new__' },
    name,
    page,
    numPages,
  })
);

export const deleteBookmarksById = (bookmarks, id) => {
  if (!Array.isArray(bookmarks)) return [];
  if (!id) return bookmarks;
  const drop = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of bookmarks) {
      if (drop.has(item?.id)) continue;
      if (item?.parentId && drop.has(item.parentId)) {
        drop.add(item.id);
        grew = true;
      }
    }
  }
  return bookmarks.filter((item) => !drop.has(item?.id));
};

export const countBookmarkDescendants = (bookmarks, id) => {
  if (!Array.isArray(bookmarks) || !id) return 0;
  return Math.max(0, bookmarks.length - deleteBookmarksById(bookmarks, id).length - 1);
};

export const describeBookmarkDeleteConfirm = ({ bookmarks, id } = {}) => {
  const target = (bookmarks || []).find((item) => item?.id === id);
  if (!target) return null;
  const nested = countBookmarkDescendants(bookmarks, id);
  const label = target.name || (target.type === 'folder' ? 'group' : 'bookmark');
  if (target.type === 'folder') {
    if (nested === 0) {
      return `Delete group "${label}"?`;
    }
    const unit = nested === 1 ? 'nested item' : 'nested items';
    return `Delete group "${label}" and ${nested} ${unit}?`;
  }
  return `Delete bookmark "${label}"?`;
};

export const snapshotBookmarksForHistory = (bookmarks) => (
  Array.isArray(bookmarks) ? bookmarks.map((item) => ({ ...item })) : []
);

export const historyStateHasBookmarks = (state) => (
  Boolean(state) && Object.prototype.hasOwnProperty.call(state, 'bookmarks')
);

export const applyBookmarkHistorySlice = (snapshot, bookmarks) => {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return {
    ...snapshot,
    bookmarks: snapshotBookmarksForHistory(bookmarks),
  };
};

export const planBookmarkDelete = (bookmarks, id) => {
  const previous = Array.isArray(bookmarks) ? bookmarks : [];
  if (!id) {
    return { ok: false, previous, next: previous, removed: [] };
  }
  const next = deleteBookmarksById(previous, id);
  if (next.length === previous.length) {
    return { ok: false, previous, next: previous, removed: [] };
  }
  const keep = new Set(next.map((item) => item?.id));
  return {
    ok: true,
    previous,
    next,
    removed: previous.filter((item) => !keep.has(item?.id)),
  };
};

export const isBookmarkPanelEmpty = (bookmarks) => (
  !Array.isArray(bookmarks) || bookmarks.length === 0
);
