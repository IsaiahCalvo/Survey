export const coercePageNumber = (value, maxPages = Number.POSITIVE_INFINITY) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) return null;
  const page = Math.trunc(numeric);
  if (page < 1) return null;
  if (Number.isFinite(maxPages) && maxPages > 0 && page > maxPages) return null;
  return page;
};

export const normalizeBookmarkPageIds = (bookmark, maxPages = Number.POSITIVE_INFINITY) => {
  if (!bookmark || typeof bookmark !== 'object') return [];
  const uniquePages = new Set();
  const addPage = (value) => {
    const page = coercePageNumber(value, maxPages);
    if (page) uniquePages.add(page);
  };
  const addPageFromIndex = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const index = Math.trunc(numeric);
    if (index >= 0) addPage(index + 1);
  };
  if (Array.isArray(bookmark.pageIds)) bookmark.pageIds.forEach(addPage);
  [
    bookmark.pageIndex, bookmark.PageIndex, bookmark.pageIdx,
    bookmark.dest?.pageIndex, bookmark.dest?.PageIndex,
    bookmark.destination?.pageIndex, bookmark.destination?.PageIndex,
  ].forEach(addPageFromIndex);
  [
    bookmark.pageId, bookmark.page, bookmark.pageNumber, bookmark.PageNumber, bookmark.targetPage,
    bookmark.dest?.page, bookmark.dest?.pageId, bookmark.dest?.pageNumber, bookmark.dest?.PageNumber,
    bookmark.destination?.page, bookmark.destination?.pageId,
    bookmark.destination?.pageNumber, bookmark.destination?.PageNumber,
  ].forEach(addPage);
  return Array.from(uniquePages);
};
