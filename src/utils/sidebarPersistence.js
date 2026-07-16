import { normalizeBookmarkPageIds } from './bookmarkPageIds.js';
import { normalizePageRegions } from './annotationVisibilityRules.js';

export function migrateSidebarData(sidebarData) {
  const data = sidebarData && typeof sidebarData === 'object' ? sidebarData : {};
  const storedBookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const bookmarks = storedBookmarks.map((bookmark) => {
    const pageIds = normalizeBookmarkPageIds(bookmark, Number.POSITIVE_INFINITY);
    if (bookmark?.source === 'pdf' || bookmark?.isFromPDF === true) {
      return { ...bookmark, pageIds, source: 'user', isFromPDF: false };
    }
    return { ...bookmark, pageIds };
  });
  const hasImportedPdfBookmarks = storedBookmarks.some((bookmark) => (
    bookmark?.source === 'pdf'
    || bookmark?.isFromPDF === true
    || (typeof bookmark?.id === 'string' && bookmark.id.startsWith('pdf:'))
    || (typeof bookmark?.id === 'string' && bookmark.id.startsWith('pdf-outline-'))
    || (typeof bookmark?.sourceId === 'string' && bookmark.sourceId.startsWith('pdfjs:'))
    || Array.isArray(bookmark?.outlinePath)
    || bookmark?.dest
  ));
  const spaces = (data.spaces || []).map((space) => ({
    ...space,
    assignedPages: (space.assignedPages || []).map((page) => ({
      ...page,
      regions: normalizePageRegions(page.regions || []),
    })),
  }));
  return {
    pageNames: data.pageNames || {},
    bookmarks,
    hasImportedPdfBookmarks,
    spaces,
    pageTransformations: data.pageTransformations || {},
  };
}
