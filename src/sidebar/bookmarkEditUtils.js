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
