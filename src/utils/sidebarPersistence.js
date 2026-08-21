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
    activeSpaceId: data.activeSpaceId ?? null,
  };
}

export const PAGE_NAMES_META_KEY = 'pageNames';
export const BOOKMARKS_META_KEY = 'bookmarks';

const asRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

export const mergePageNameMaps = (existing, incoming) => ({
  ...asRecord(existing),
  ...asRecord(incoming),
});

/**
 * P1-46 merge-on-write: keyed maps union (incoming wins per key). Bookmark and
 * space arrays use this writer's membership so deletes stay deleted; Y.Doc
 * meta is what shares those lists across browsers.
 */
export function mergeSidebarWrite(existingRaw, incomingRaw) {
  const existing = migrateSidebarData(existingRaw || {});
  const incoming = migrateSidebarData(incomingRaw || {});
  return {
    pageNames: mergePageNameMaps(existing.pageNames, incoming.pageNames),
    bookmarks: incoming.bookmarks,
    spaces: incoming.spaces,
    pageTransformations: mergePageNameMaps(
      existing.pageTransformations,
      incoming.pageTransformations,
    ),
    activeSpaceId: incomingRaw?.activeSpaceId ?? existing.activeSpaceId ?? null,
  };
}

export const listsShallowEqualById = (left, right) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index] || item?.id === right[index]?.id);
};

export function applyRemoteSidebarMeta(local, remote) {
  const nextNames = remote.pageNames === undefined
    ? local.pageNames
    : mergePageNameMaps(local.pageNames, remote.pageNames);
  const nextBookmarks = remote.bookmarks === undefined
    ? local.bookmarks
    : (Array.isArray(remote.bookmarks) ? remote.bookmarks : local.bookmarks);
  return {
    pageNames: nextNames,
    bookmarks: nextBookmarks,
    namesChanged: JSON.stringify(asRecord(local.pageNames)) !== JSON.stringify(asRecord(nextNames)),
    bookmarksChanged: !listsShallowEqualById(local.bookmarks, nextBookmarks)
      || JSON.stringify(local.bookmarks || []) !== JSON.stringify(nextBookmarks || []),
  };
}
