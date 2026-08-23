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

export function normalizeRotationDelta(delta) {
  return (((Number(delta) || 0) % 360) + 360) % 360;
}

/** Map a displayed-space point through a baked page rotate (origin top-left). */
export function rotateDisplayedPoint(x, y, pageWidth, pageHeight, delta) {
  const turns = normalizeRotationDelta(delta);
  const px = Number(x) || 0;
  const py = Number(y) || 0;
  if (turns === 90) return { x: pageHeight - py, y: px };
  if (turns === 180) return { x: pageWidth - px, y: pageHeight - py };
  if (turns === 270) return { x: py, y: pageWidth - px };
  return { x: px, y: py };
}

export function rotateDisplayedPageSize(pageWidth, pageHeight, delta) {
  const turns = normalizeRotationDelta(delta);
  if (turns === 90 || turns === 270) return { width: pageHeight, height: pageWidth };
  return { width: pageWidth, height: pageHeight };
}

function rotateFabricLikeObject(obj, pageWidth, pageHeight, delta) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const turns = normalizeRotationDelta(delta);
  if (turns === 0) return obj;
  const next = { ...obj };
  const hasBox = ['left', 'top', 'width', 'height', 'x', 'y'].some((key) => (
    Number.isFinite(Number(obj[key]))
  ));
  if (hasBox) {
    const left = Number(obj.left ?? obj.x) || 0;
    const top = Number(obj.top ?? obj.y) || 0;
    const width = Number(obj.width) || 0;
    const height = Number(obj.height) || 0;
    const scaleX = Number(obj.scaleX ?? 1) || 1;
    const scaleY = Number(obj.scaleY ?? 1) || 1;
    const vw = Math.abs(width * scaleX) || 0;
    const vh = Math.abs(height * scaleY) || 0;
    const cx = left + vw / 2;
    const cy = top + vh / 2;
    const rotated = rotateDisplayedPoint(cx, cy, pageWidth, pageHeight, delta);
    const nextLeft = rotated.x - vw / 2;
    const nextTop = rotated.y - vh / 2;
    if ('left' in obj || Number.isFinite(Number(obj.left))) next.left = nextLeft;
    if ('top' in obj || Number.isFinite(Number(obj.top))) next.top = nextTop;
    if ('x' in obj) next.x = nextLeft;
    if ('y' in obj) next.y = nextTop;
    if ('angle' in obj || Number.isFinite(Number(obj.angle))) {
      next.angle = (Number(obj.angle) || 0) + Number(delta || 0);
    } else if (hasBox) {
      next.angle = Number(delta || 0);
    }
    if (next.data && typeof next.data === 'object' && !Array.isArray(next.data)) {
      const data = { ...next.data };
      if ('left' in data) data.left = next.left;
      if ('top' in data) data.top = next.top;
      if ('x' in data) data.x = next.x ?? next.left;
      if ('y' in data) data.y = next.y ?? next.top;
      if ('angle' in data || 'angle' in next) data.angle = next.angle;
      next.data = data;
    }
  }
  return next;
}

function rotatePageGeometry(next, page, pageWidth, pageHeight, delta) {
  if (!(pageWidth > 0) || !(pageHeight > 0) || normalizeRotationDelta(delta) === 0) return next;
  const pageData = next.annotationsByPage?.[page];
  if (pageData) {
    const rotatedSize = rotateDisplayedPageSize(pageWidth, pageHeight, delta);
    next.annotationsByPage[page] = {
      ...pageData,
      ...(pageData.width != null ? { width: rotatedSize.width } : {}),
      ...(pageData.height != null ? { height: rotatedSize.height } : {}),
      objects: (Array.isArray(pageData.objects) ? pageData.objects : [])
        .map((object) => rotateFabricLikeObject(object, pageWidth, pageHeight, delta)),
    };
  }
  for (const [id, marker] of Object.entries(next.surveyMarkers || {})) {
    if (asPage(marker?.pageNumber) !== page) continue;
    next.surveyMarkers[id] = rotateFabricLikeObject(marker, pageWidth, pageHeight, delta);
  }
  for (const [id, annotation] of Object.entries(next.annotations || {})) {
    if (asPage(annotation?.pageNumber ?? annotation?.pageId ?? annotation?.page) !== page) continue;
    next.annotations[id] = rotateFabricLikeObject(annotation, pageWidth, pageHeight, delta);
  }
  if (next.pageSizes?.[page]) {
    const rotatedSize = rotateDisplayedPageSize(pageWidth, pageHeight, delta);
    next.pageSizes = {
      ...next.pageSizes,
      [page]: { ...next.pageSizes[page], width: rotatedSize.width, height: rotatedSize.height },
    };
  }
  return next;
}

export function transformPageState(model = {}, op, { createId = fallbackId } = {}) {
  const type = op?.type;
  if (type === 'rotate') {
    const next = baseRemap(model, (page) => page);
    const page = asPage(op.page);
    const previous = next.pageTransformations?.[page];
    if (previous) {
      const cleared = { ...previous, rotation: 0 };
      if (!cleared.mirrorH && !cleared.mirrorV) delete next.pageTransformations[page];
      else next.pageTransformations[page] = cleared;
    }
    const pageWidth = Number(op.pageWidth) > 0
      ? Number(op.pageWidth)
      : Number(next.annotationsByPage?.[page]?.width);
    const pageHeight = Number(op.pageHeight) > 0
      ? Number(op.pageHeight)
      : Number(next.annotationsByPage?.[page]?.height);
    if (page != null) {
      rotatePageGeometry(next, page, pageWidth, pageHeight, Number(op.delta ?? 90));
    }
    return next;
  }

  if (type === 'delete') {
    const page = asPage(op.page);
    if (page == null) throw new Error('delete requires a positive page');
    return baseRemap(model, (value) => (value < page ? value : value === page ? null : value - 1));
  }

  if (type === 'insert') {
    const afterPage = asPage(op.afterPage);
    if (afterPage == null) throw new Error('insert requires a positive afterPage');
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
    const afterPage = asPage(op.afterPage ?? op.page ?? op.target);
    if (sourcePage == null || afterPage == null) throw new Error(`${type} requires source and target pages`);
    const targetPage = afterPage + 1;
    const next = baseRemap(model, (value) => (value <= afterPage ? value : value + 1));
    return addPageClone(next, model, sourcePage, targetPage, createId);
  }

  throw new Error(`transformPageState: unknown op type ${type}`);
}

/**
 * P1-18: remap a cut/copy clipboard page number through a mutation.
 * Deleting the clipped page clears the clipboard.
 */
export function remapClipboardPage(clipboardPage, operation) {
  const page = asPage(clipboardPage);
  if (page == null) return null;
  if (operation?.type === 'delete' && asPage(operation.page) === page) return null;
  if (operation?.type === 'rotate') return page;
  return pageNumberAfterOperation(page, operation, Number.MAX_SAFE_INTEGER);
}

export function slicePagePresentation(state) {
  if (!state) return null;
  return {
    pageNames: state.pageNames ?? {},
    pageTransformations: state.pageTransformations ?? {},
    bookmarks: state.bookmarks ?? [],
    spaces: state.spaces ?? [],
  };
}

function presentationEquals(left, right) {
  if (!left || !right) return false;
  return JSON.stringify(slicePagePresentation(left)) === JSON.stringify(slicePagePresentation(right));
}

/**
 * P1-17: graft live presentation (names / transforms / bookmarks / spaces)
 * onto an already-transformed annotation graph. Live page numbers are
 * pre-THIS-op only when React has not applied earlier queued remaps —
 * those stale snapshots must not replace the chained result.
 */
export function mergeLivePagePresentation(queuedNextState, liveState, operation, options = {}) {
  if (!queuedNextState) return queuedNextState;
  if (!liveState || !operation) return queuedNextState;
  if (presentationEquals(liveState, options.sourcePresentation)) return queuedNextState;
  if (presentationEquals(liveState, options.queueBaseline)) return queuedNextState;
  if (presentationEquals(liveState, queuedNextState)) return queuedNextState;
  const remappedLive = transformPageState({
    annotationsByPage: {},
    surveyMarkers: {},
    annotations: {},
    pageNames: liveState.pageNames ?? {},
    pageTransformations: liveState.pageTransformations ?? {},
    bookmarks: liveState.bookmarks ?? [],
    spaces: liveState.spaces ?? [],
    regionOverlayDisabled: liveState.regionOverlayDisabled ?? new Map(),
  }, operation);
  return {
    ...queuedNextState,
    pageNames: remappedLive.pageNames,
    pageTransformations: remappedLive.pageTransformations,
    bookmarks: remappedLive.bookmarks,
    spaces: remappedLive.spaces,
    regionOverlayDisabled: remappedLive.regionOverlayDisabled,
  };
}

export function pageNumberAfterOperation(currentPage, operation, resultingPageCount) {
  const page = asPage(currentPage) || 1;
  const type = operation?.type;
  let next = page;
  if (type === 'delete') {
    const removed = asPage(operation.page);
    next = page < removed ? page : page === removed ? removed : page - 1;
  } else if (type === 'insert') {
    const after = asPage(operation.afterPage);
    next = page <= after ? page : page + 1;
  } else if (type === 'duplicate' || type === 'copy') {
    const after = asPage(operation.afterPage ?? operation.page ?? operation.target);
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
