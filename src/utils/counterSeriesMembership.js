import { createAnnotationStorageKeyResolver } from './annotationStorageIdentity.js';

export const LEGACY_COUNTER_SERIES_KEY = '__legacy__';

export function counterSeriesKey(object) {
  return String(object?.data?.seriesId || LEGACY_COUNTER_SERIES_KEY);
}

/**
 * Stable membership/order precondition for counter series touched by an erase.
 * Display numbers are deliberately excluded because they are derived from this
 * membership plus the earliest counter's seriesStart.
 */
export function counterSeriesMembershipSnapshot(annotationsByPage, seriesKeys = null) {
  const filter = seriesKeys == null
    ? null
    : new Set([...seriesKeys].map(String));
  const groups = new Map();
  const resolveStorageKey = createAnnotationStorageKeyResolver();
  for (const [pageKey, page] of Object.entries(annotationsByPage || {})) {
    const pageNumber = Number(pageKey);
    for (const object of page?.objects || []) {
      if (object?.data?.type !== 'counter') continue;
      const seriesKey = counterSeriesKey(object);
      if (filter && !filter.has(seriesKey)) continue;
      if (!groups.has(seriesKey)) groups.set(seriesKey, []);
      groups.get(seriesKey).push({
        storageKey: String(resolveStorageKey(
          object,
          pageNumber,
          object?.data?.id ?? object?.id ?? null,
        )),
        createdAt: Number(object?.data?.createdAt) || 0,
        pageNumber,
      });
    }
  }
  return [...groups.entries()]
    .map(([seriesKey, members]) => ({
      seriesKey,
      members: members.sort((left, right) => (
        left.createdAt - right.createdAt
        || left.storageKey.localeCompare(right.storageKey)
        || left.pageNumber - right.pageNumber
      )),
    }))
    .sort((left, right) => left.seriesKey.localeCompare(right.seriesKey));
}
