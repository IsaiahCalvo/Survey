import { mintPastedCloneIdentity } from './pasteCloneIdentity.js';

const clone = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const fallbackId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `page-copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

const asPage = (value) => {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
};

// An insertion slot: 0 = before page 1 (insert / paste above the first
// page), n = after page n.
const asSlot = (value) => {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 0 ? slot : null;
};

const remapPageFields = (value, mapPage) => {
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  for (const key of ['pageNumber', 'pageId', 'page']) {
    if (!(key in next)) continue;
    const page = asPage(next[key]);
    if (page == null) continue;
    next[key] = mapPage(page);
  }
  if (next.data && typeof next.data === 'object' && !Array.isArray(next.data)) {
    next.data = remapPageFields(next.data, mapPage);
  }
  if (next.legacyCallout && typeof next.legacyCallout === 'object') {
    next.legacyCallout = remapPageFields(next.legacyCallout, mapPage);
  }
  return next;
};

const remapPageKeyed = (source, mapPage, transformValue = (value) => value) => {
  const next = {};
  for (const [key, value] of Object.entries(source || {})) {
    const mapped = mapPage(asPage(key));
    if (mapped == null) continue;
    next[mapped] = transformValue(value, mapped);
  }
  return next;
};

const remapIdKeyed = (source, mapPage) => {
  const next = {};
  for (const [id, value] of Object.entries(source || {})) {
    const page = asPage(value?.pageNumber ?? value?.pageId ?? value?.page);
    if (page == null) {
      next[id] = value;
      continue;
    }
    const mapped = mapPage(page);
    if (mapped == null) continue;
    next[id] = remapPageFields(value, () => mapped);
  }
  return next;
};

const remapBookmarks = (bookmarks, mapPage, copySource = null, copyTarget = null) => (
  (Array.isArray(bookmarks) ? bookmarks : []).map((bookmark) => {
    const next = { ...bookmark };
    if (Array.isArray(bookmark?.pageIds)) {
      const pageIds = bookmark.pageIds
        .map((page) => mapPage(asPage(page)))
        .filter((page) => page != null);
      if (copySource != null && bookmark.pageIds.some((page) => asPage(page) === copySource)) {
        pageIds.push(copyTarget);
      }
      next.pageIds = [...new Set(pageIds)].sort((left, right) => left - right);
    }
    for (const key of ['pageNumber', 'pageId', 'page', 'targetPage']) {
      const page = asPage(bookmark?.[key]);
      if (page == null) continue;
      const mapped = mapPage(page);
      if (mapped == null) delete next[key];
      else next[key] = mapped;
    }
    if (Array.isArray(bookmark?.children)) {
      next.children = remapBookmarks(bookmark.children, mapPage, copySource, copyTarget);
    }
    return next;
  })
);

const addCopiedBookmarkAssociations = (nextBookmarks, sourceBookmarks, sourcePage, targetPage) => (
  (Array.isArray(nextBookmarks) ? nextBookmarks : []).map((bookmark, index) => {
    const source = sourceBookmarks?.[index];
    const next = { ...bookmark };
    if (Array.isArray(source?.pageIds) && source.pageIds.some((page) => asPage(page) === sourcePage)) {
      next.pageIds = [...new Set([...(bookmark.pageIds || []), targetPage])]
        .sort((left, right) => left - right);
    }
    if (Array.isArray(bookmark?.children)) {
      next.children = addCopiedBookmarkAssociations(
        bookmark.children,
        source?.children,
        sourcePage,
        targetPage,
      );
    }
    return next;
  })
);

const remapSpaces = (spaces, mapPage) => (
  (Array.isArray(spaces) ? spaces : []).map((space) => ({
    ...space,
    assignedPages: (Array.isArray(space?.assignedPages) ? space.assignedPages : [])
      .map((entry) => {
        const mapped = mapPage(asPage(entry?.pageId ?? entry?.pageNumber));
        if (mapped == null) return null;
        return {
          ...entry,
          pageId: mapped,
          ...(Array.isArray(entry?.regions)
            ? { regions: entry.regions.map((region) => remapPageFields(region, () => mapped)) }
            : {}),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.pageId - right.pageId),
  }))
);

const remapRegionOverlay = (source, mapPage) => {
  const entries = source instanceof Map ? source.entries() : Object.entries(source || {});
  const next = new Map();
  for (const [key, value] of entries) {
    const match = String(key).match(/^(.*)-(\d+)$/);
    if (!match) {
      next.set(key, value);
      continue;
    }
    const mapped = mapPage(asPage(match[2]));
    if (mapped != null) next.set(`${match[1]}-${mapped}`, value);
  }
  return next;
};

const baseRemap = (model, mapPage) => ({
  annotationsByPage: remapPageKeyed(model.annotationsByPage, mapPage, (page, mapped) => ({
    ...(page || {}),
    objects: (Array.isArray(page?.objects) ? page.objects : [])
      .map((object) => remapPageFields(object, () => mapped)),
  })),
  surveyMarkers: remapIdKeyed(model.surveyMarkers, mapPage),
  annotations: remapIdKeyed(model.annotations, mapPage),
  pageNames: remapPageKeyed(model.pageNames, mapPage),
  pageTransformations: remapPageKeyed(model.pageTransformations, mapPage),
  bookmarks: remapBookmarks(model.bookmarks, mapPage),
  spaces: remapSpaces(model.spaces, mapPage),
  regionOverlayDisabled: remapRegionOverlay(model.regionOverlayDisabled, mapPage),
});

const replaceRegionId = (value, regionIds) => {
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  if (next.regionId && regionIds.has(next.regionId)) next.regionId = regionIds.get(next.regionId);
  if (next.data && typeof next.data === 'object' && !Array.isArray(next.data)) {
    next.data = replaceRegionId(next.data, regionIds);
  }
  if (next.legacyCallout && typeof next.legacyCallout === 'object') {
    next.legacyCallout = replaceRegionId(next.legacyCallout, regionIds);
  }
  return next;
};

function addPageClone(next, source, sourcePage, targetPage, createId) {
  const annotationIds = new Map();
  const regionIds = new Map();

  for (const space of source.spaces || []) {
    const entry = (space?.assignedPages || []).find((candidate) => asPage(candidate?.pageId) === sourcePage);
    for (const region of entry?.regions || []) {
      if (region?.regionId) regionIds.set(region.regionId, createId());
    }
  }

  const sourcePageData = source.annotationsByPage?.[sourcePage] || source.annotationsByPage?.[String(sourcePage)];
  if (sourcePageData) {
    const clonedPage = clone(sourcePageData);
    clonedPage.objects = (clonedPage.objects || []).map((object) => {
      const oldId = object?.data?.id || object?.data?.annoId || object?.id || object?.annotationId || null;
      const newId = createId();
      if (oldId) annotationIds.set(oldId, newId);
      let copied = mintPastedCloneIdentity(object, newId);
      copied = remapPageFields(copied, () => targetPage);
      copied = replaceRegionId(copied, regionIds);
      if (copied?.data?.legacyCallout) {
        copied.data.legacyCallout = {
          ...copied.data.legacyCallout,
          id: newId,
          annotationId: newId,
          pageNumber: targetPage,
        };
      }
      return copied;
    });
    next.annotationsByPage[targetPage] = clonedPage;
  }

  for (const [id, marker] of Object.entries(source.surveyMarkers || {})) {
    if (asPage(marker?.pageNumber) !== sourcePage) continue;
    const newId = annotationIds.get(id) || annotationIds.get(marker?.annotationId) || createId();
    annotationIds.set(id, newId);
    next.surveyMarkers[newId] = replaceRegionId({
      ...clone(marker),
      id: newId,
      annotationId: newId,
      pageNumber: targetPage,
    }, regionIds);
  }

  for (const [id, annotation] of Object.entries(source.annotations || {})) {
    if (asPage(annotation?.pageNumber ?? annotation?.pageId ?? annotation?.page) !== sourcePage) continue;
    const newId = annotationIds.get(id) || annotationIds.get(annotation?.annotationId) || createId();
    annotationIds.set(id, newId);
    next.annotations[newId] = replaceRegionId({
      ...clone(annotation),
      id: newId,
      annotationId: newId,
      pageNumber: targetPage,
    }, regionIds);
  }

  if (source.pageNames?.[sourcePage] != null) next.pageNames[targetPage] = source.pageNames[sourcePage];
  if (source.pageTransformations?.[sourcePage] != null) {
    next.pageTransformations[targetPage] = clone(source.pageTransformations[sourcePage]);
  }

  next.bookmarks = addCopiedBookmarkAssociations(
    next.bookmarks,
    source.bookmarks,
    sourcePage,
    targetPage,
  );
  next.spaces = next.spaces.map((space, index) => {
    const sourceSpace = source.spaces?.[index];
    const entry = (sourceSpace?.assignedPages || []).find((candidate) => asPage(candidate?.pageId) === sourcePage);
    if (!entry) return space;
    const copiedEntry = clone(entry);
    copiedEntry.pageId = targetPage;
    copiedEntry.regions = (copiedEntry.regions || []).map((region) => ({
      ...replaceRegionId(region, regionIds),
      pageId: targetPage,
      pageNumber: targetPage,
    }));
    return {
      ...space,
      assignedPages: [...(space.assignedPages || []), copiedEntry]
        .sort((left, right) => left.pageId - right.pageId),
    };
  });

  for (const [key, value] of source.regionOverlayDisabled instanceof Map
    ? source.regionOverlayDisabled.entries()
    : Object.entries(source.regionOverlayDisabled || {})) {
    const suffix = `-${sourcePage}`;
    if (String(key).endsWith(suffix)) {
      next.regionOverlayDisabled.set(`${String(key).slice(0, -suffix.length)}-${targetPage}`, value);
    }
  }
  return next;
}

// Undo of a page delete: everything that was on page `sourcePage` of
// `source` (the state just before the delete) comes back on `targetPage` of
// `next` WITH ITS OWN IDS (unlike a copy) - its marks, Survey Markers, name,
// mirror, bookmark links, space assignment and region overlay switches.
function reinstatePageSlice(next, source, sourcePage, targetPage) {
  const toTarget = () => targetPage;
  const sourcePageData = source.annotationsByPage?.[sourcePage] || source.annotationsByPage?.[String(sourcePage)];
  if (sourcePageData) {
    const page = clone(sourcePageData);
    page.objects = (page.objects || []).map((object) => remapPageFields(object, toTarget));
    next.annotationsByPage[targetPage] = page;
  }
  for (const key of ['surveyMarkers', 'annotations']) {
    for (const [id, value] of Object.entries(source[key] || {})) {
      if (asPage(value?.pageNumber ?? value?.pageId ?? value?.page) !== sourcePage) continue;
      next[key][id] = remapPageFields(clone(value), toTarget);
    }
  }
  if (source.pageNames?.[sourcePage] != null) next.pageNames[targetPage] = source.pageNames[sourcePage];
  if (source.pageTransformations?.[sourcePage] != null) {
    next.pageTransformations[targetPage] = clone(source.pageTransformations[sourcePage]);
  }
  const relink = (nextList, sourceList) => (Array.isArray(nextList) ? nextList : []).map((bookmark, index) => {
    const before = (bookmark?.id != null
      ? (sourceList || []).find((candidate) => candidate?.id === bookmark.id)
      : sourceList?.[index]) || null;
    if (!before) return bookmark;
    const out = { ...bookmark };
    if (Array.isArray(before.pageIds) && before.pageIds.some((page) => asPage(page) === sourcePage)) {
      out.pageIds = [...new Set([...(bookmark.pageIds || []), targetPage])].sort((left, right) => left - right);
    }
    for (const field of ['pageNumber', 'pageId', 'page', 'targetPage']) {
      if (asPage(before[field]) === sourcePage && out[field] == null) out[field] = targetPage;
    }
    if (Array.isArray(bookmark?.children)) out.children = relink(bookmark.children, before.children);
    return out;
  });
  next.bookmarks = relink(next.bookmarks, source.bookmarks);
  next.spaces = next.spaces.map((space, index) => {
    const before = (space?.id != null
      ? (source.spaces || []).find((candidate) => candidate?.id === space.id)
      : source.spaces?.[index]) || null;
    const entry = (before?.assignedPages || []).find((candidate) => asPage(candidate?.pageId ?? candidate?.pageNumber) === sourcePage);
    if (!entry) return space;
    const restored = clone(entry);
    restored.pageId = targetPage;
    if (Array.isArray(restored.regions)) restored.regions = restored.regions.map((region) => remapPageFields(region, toTarget));
    return {
      ...space,
      assignedPages: [...(space.assignedPages || []), restored].sort((left, right) => left.pageId - right.pageId),
    };
  });
  for (const [key, value] of source.regionOverlayDisabled instanceof Map
    ? source.regionOverlayDisabled.entries()
    : Object.entries(source.regionOverlayDisabled || {})) {
    const suffix = `-${sourcePage}`;
    if (String(key).endsWith(suffix)) {
      next.regionOverlayDisabled.set(`${String(key).slice(0, -suffix.length)}-${targetPage}`, value);
    }
  }
  return next;
}

export function transformPageState(model = {}, op, { createId = fallbackId } = {}) {
  const type = op?.type;
  if (type === 'restore') {
    // Undo of a delete: { afterPage, from: state before the delete, fromPage }.
    const afterPage = asSlot(op.afterPage);
    const fromPage = asPage(op.fromPage);
    if (afterPage == null || fromPage == null || !op.from) throw new Error('restore requires afterPage, fromPage and the earlier state');
    const next = baseRemap(model, (value) => (value <= afterPage ? value : value + 1));
    return reinstatePageSlice(next, op.from, fromPage, afterPage + 1);
  }
  if (type === 'rotate') {
    const next = baseRemap(model, (page) => page);
    const page = asPage(op.page);
    // Undo of a turn puts the page's presentation transform back as it was
    // (the turn folded any old presentation rotation into the PDF).
    if (Object.prototype.hasOwnProperty.call(op, 'pageTransformation')) {
      if (op.pageTransformation) next.pageTransformations[page] = clone(op.pageTransformation);
      else delete next.pageTransformations[page];
      return next;
    }
    const previous = next.pageTransformations?.[page];
    if (previous) {
      const cleared = { ...previous, rotation: 0 };
      if (!cleared.mirrorH && !cleared.mirrorV) delete next.pageTransformations[page];
      else next.pageTransformations[page] = cleared;
    }
    return next;
  }

  if (type === 'delete') {
    const page = asPage(op.page);
    if (page == null) throw new Error('delete requires a positive page');
    return baseRemap(model, (value) => (value < page ? value : value === page ? null : value - 1));
  }

  if (type === 'insert') {
    const afterPage = asSlot(op.afterPage);
    if (afterPage == null) throw new Error('insert requires an afterPage of 0 or more');
    return baseRemap(model, (value) => (value <= afterPage ? value : value + 1));
  }

  if (type === 'move' || type === 'reorder') {
    const from = asPage(op.from);
    const to = asPage(op.to);
    if (from == null || to == null) throw new Error('move requires positive from/to pages');
    return baseRemap(model, (value) => {
      if (value === from) return to;
      if (from < to) return value > from && value <= to ? value - 1 : value;
      if (from > to) return value >= to && value < from ? value + 1 : value;
      return value;
    });
  }

  if (type === 'duplicate' || type === 'copy') {
    const sourcePage = asPage(op.page ?? op.source);
    const afterPage = asSlot(op.afterPage ?? op.page ?? op.target);
    if (sourcePage == null || afterPage == null) throw new Error(`${type} requires source and target pages`);
    const targetPage = afterPage + 1;
    const next = baseRemap(model, (value) => (value <= afterPage ? value : value + 1));
    return addPageClone(next, model, sourcePage, targetPage, createId);
  }

  throw new Error(`transformPageState: unknown op type ${type}`);
}

export function pageNumberAfterOperation(currentPage, operation, resultingPageCount) {
  const page = asPage(currentPage) || 1;
  const type = operation?.type;
  let next = page;
  if (type === 'delete') {
    const removed = asPage(operation.page);
    next = page < removed ? page : page === removed ? removed : page - 1;
  } else if (type === 'insert' || type === 'restore') {
    const after = asSlot(operation.afterPage);
    next = page <= after ? page : page + 1;
  } else if (type === 'duplicate' || type === 'copy') {
    const after = asSlot(operation.afterPage ?? operation.page ?? operation.target);
    next = page <= after ? page : page + 1;
  } else if (type === 'move' || type === 'reorder') {
    const from = asPage(operation.from);
    const to = asPage(operation.to);
    if (page === from) next = to;
    else if (from < to && page > from && page <= to) next = page - 1;
    else if (from > to && page >= to && page < from) next = page + 1;
  }
  const max = Math.max(1, Number(resultingPageCount) || next);
  return Math.min(Math.max(1, next), max);
}

// Compatibility for the original annotation-only helper callers/tests.
export function reindexAnnotationModel(model, op) {
  return transformPageState(model, op);
}
