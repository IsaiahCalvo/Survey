/**
 * sidebarPersistence.js — pure deserialize/migrate for the per-document sidebar blob.
 *
 * Extracted VERBATIM from PDFViewer's "load sidebar data from localStorage" effect
 * (the bookmark normalization + space region migration). Pure: no React state, no
 * localStorage access — the caller reads/parses the `pdfSidebar_<pdfId>` blob and
 * applies the returned values to state. Kept as a standalone, node-testable unit so
 * the bug-prone normalization logic is guarded by unit tests.
 */
import { normalizeBookmarkPageIds } from '../viewerShared.js';
import { normalizePageRegions } from './annotationVisibilityRules.js';

/**
 * Migrate a parsed sidebar blob into the shape PDFViewer applies to state.
 * @param {object} sidebarData - the JSON-parsed `pdfSidebar_<pdfId>` blob (or {}).
 * @returns {{ pageNames: object, bookmarks: Array, hasImportedPdfBookmarks: boolean,
 *             spaces: Array, pageTransformations: object }}
 */
export function migrateSidebarData(sidebarData) {
  const data = sidebarData && typeof sidebarData === 'object' ? sidebarData : {};

  const pageNames = data.pageNames || {};

  const storedBookmarksRaw = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  const bookmarks = storedBookmarksRaw.map((bookmark) => {
    const nextPageIds = normalizeBookmarkPageIds(bookmark, Number.POSITIVE_INFINITY);

    if (bookmark?.source === 'pdf' || bookmark?.isFromPDF === true) {
      return {
        ...bookmark,
        pageIds: nextPageIds,
        source: 'user',
        isFromPDF: false
      };
    }

    return {
      ...bookmark,
      pageIds: nextPageIds
    };
  });

  const hasImportedPdfBookmarks = storedBookmarksRaw.some((bookmark) => (
    bookmark?.source === 'pdf' ||
    bookmark?.isFromPDF === true ||
    (typeof bookmark?.id === 'string' && bookmark.id.startsWith('pdf:')) ||
    (typeof bookmark?.id === 'string' && bookmark.id.startsWith('pdf-outline-')) ||
    (typeof bookmark?.sourceId === 'string' && bookmark.sourceId.startsWith('pdfjs:')) ||
    Array.isArray(bookmark?.outlinePath) ||
    bookmark?.dest
  ));

  // Migrate spaces: ensure page visibility state is explicit in the region data.
  // Keep all regions as they represent multiple areas within the same logical region.
  const spaces = (data.spaces || []).map(space => ({
    ...space,
    assignedPages: (space.assignedPages || []).map(page => {
      return {
        ...page,
        regions: normalizePageRegions(page.regions || [])
      };
    })
  }));

  const pageTransformations = data.pageTransformations || {};

  return { pageNames, bookmarks, hasImportedPdfBookmarks, spaces, pageTransformations };
}
