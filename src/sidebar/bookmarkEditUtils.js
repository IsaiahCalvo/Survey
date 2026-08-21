import { hasNameConflict } from '../viewerShared.js';

export const nextBookmarkOrder = (bookmarks, parentId = null) => {
  const siblings = (bookmarks || []).filter((item) => (item?.parentId ?? null) === (parentId ?? null));
  if (siblings.length === 0) return 0;
  return siblings.reduce((max, item) => {
    const order = Number(item?.order);
    return Math.max(max, Number.isFinite(order) ? order : 0);
  }, -1) + 1;
};

export const countNestedBookmarks = (bookmarks, id) => {
  if (!id) return 0;
  const children = (bookmarks || []).filter((item) => item?.parentId === id);
  return children.reduce((total, child) => (
    total + 1 + countNestedBookmarks(bookmarks, child.id)
  ), 0);
};

export const formatBookmarkDeleteConfirm = (item, nestedCount = 0) => {
  const kind = item?.type === 'folder' ? 'group' : 'bookmark';
  const name = item?.name || 'this item';
  if (!nestedCount) return `Delete ${kind} "${name}"?`;
  const nested = nestedCount === 1 ? '1 nested bookmark' : `${nestedCount} nested bookmarks`;
  return `Delete ${kind} "${name}"? This will also permanently delete ${nested}. This cannot be undone.`;
};

export const prepareBookmarkNameEdit = ({
  bookmarks,
  bookmark,
  name,
}) => {
  const nextName = typeof name === 'string' ? name.trim() : '';
  const revertName = bookmark?.name || '';
  if (!nextName) {
    return { ok: false, error: 'Please enter a bookmark name.', revertName };
  }

  if (hasNameConflict(bookmarks, nextName, {
    predicate: (item) => item?.type === bookmark?.type,
    ignoreId: bookmark?.id,
  })) {
    return {
      ok: false,
      error: 'A bookmark with this name already exists. Please choose a different name.',
      revertName,
    };
  }

  return {
    ok: true,
    updates: { name: nextName },
  };
};

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
