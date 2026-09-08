// Only used for a fresh managed import before the loading curtain lifts.
// Saved sidebar state is authoritative, including renamed/deleted bookmarks.
export function prepareManagedLocalBookmarks(outline, createId = () => crypto.randomUUID()) {
  if (!Array.isArray(outline)) return [];
  const ids = new Map(outline.map(bookmark => [bookmark.id, createId()]));
  return outline.map(bookmark => {
    const page = bookmark.pageIds?.[0];
    const resolved = bookmark.type !== 'folder' && Number.isSafeInteger(page) && page > 0;
    return {
      ...bookmark,
      id: ids.get(bookmark.id),
      parentId: bookmark.parentId ? (ids.get(bookmark.parentId) || null) : null,
      children: [],
      ...(resolved ? {
        outlineCorrected: true,
        disableSourceNavigation: true,
        dest: { ...bookmark.dest, pageNumber: page, PageNumber: page, pageIndex: page - 1, PageIndex: page - 1 },
      } : {}),
    };
  });
}
