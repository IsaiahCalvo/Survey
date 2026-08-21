/**
 * P1-52: when a region disappears (local or remote), annotations stamped
 * with that regionId must not stay scoped-invisible / orphaned.
 */

export function collectLiveRegionIds(spaces) {
  const ids = new Set();
  for (const space of spaces || []) {
    for (const page of space?.assignedPages || []) {
      for (const region of page?.regions || []) {
        const id = region?.regionId ?? region?.id;
        if (id != null) ids.add(String(id));
      }
    }
  }
  return ids;
}

export function spaceHasActivatableRegions(space) {
  const pages = space?.assignedPages || [];
  if (pages.length === 0) return false;
  return pages.some((page) => Array.isArray(page?.regions) && page.regions.length > 0);
}

export function unscopeOrphanedRegionAnnotations(byPage, spaces) {
  if (!byPage || typeof byPage !== 'object') return byPage;
  if (!Array.isArray(spaces) || spaces.length === 0) return byPage;
  const live = collectLiveRegionIds(spaces);
  let changed = false;
  const next = {};
  for (const [pageKey, page] of Object.entries(byPage)) {
    const objects = Array.isArray(page?.objects) ? page.objects : [];
    let pageChanged = false;
    const mapped = objects.map((obj) => {
      const rid = obj?.regionId ?? obj?.data?.regionId;
      if (rid == null || live.has(String(rid))) return obj;
      pageChanged = true;
      changed = true;
      const copy = { ...obj, regionId: null };
      if (copy.data && typeof copy.data === 'object') {
        copy.data = { ...copy.data, regionId: null };
      }
      return copy;
    });
    next[pageKey] = pageChanged ? { ...page, objects: mapped } : page;
  }
  return changed ? next : byPage;
}
