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

function isCalloutLike(obj) {
  const data = obj?.data;
  if (data?.type === 'callout') return true;
  if (data?.legacyCallout && typeof data.legacyCallout === 'object') return true;
  if (data?.legacyNormalizedCoords && typeof data.legacyNormalizedCoords === 'object') return true;
  if (obj?.arrowTip && obj?.knee && (obj?.textBoxPosition || obj?.textBox || obj?.label)) return true;
  return false;
}

/** Map a 0-1 page-fraction point through a baked page rotate. */
export function rotateNormalizedPoint(pt, pageWidth, pageHeight, delta) {
  if (!pt || typeof pt !== 'object') return pt;
  const nextSize = rotateDisplayedPageSize(pageWidth, pageHeight, delta);
  const rotated = rotateDisplayedPoint(
    Number(pt.x) * pageWidth,
    Number(pt.y) * pageHeight,
    pageWidth,
    pageHeight,
    delta,
  );
  return { ...pt, x: rotated.x / nextSize.width, y: rotated.y / nextSize.height };
}

/**
 * Visual-center contract for a 0-1 callout box: remap the pixel center,
 * keep pixel width/height (same as rect), re-express as fractions of the
 * swapped page. Callout SVG stays axis-aligned (no angle field).
 */
export function rotateNormalizedBox(pos, wFrac, hFrac, pageWidth, pageHeight, delta) {
  const nextSize = rotateDisplayedPageSize(pageWidth, pageHeight, delta);
  const pw = Number(wFrac) * pageWidth;
  const ph = Number(hFrac) * pageHeight;
  const cx = Number(pos?.x ?? 0) * pageWidth + pw / 2;
  const cy = Number(pos?.y ?? 0) * pageHeight + ph / 2;
  const rotated = rotateDisplayedPoint(cx, cy, pageWidth, pageHeight, delta);
  return {
    x: (rotated.x - pw / 2) / nextSize.width,
    y: (rotated.y - ph / 2) / nextSize.height,
    width: pw / nextSize.width,
    height: ph / nextSize.height,
  };
}

function readCalloutBox(callout) {
  if (callout.textBoxPosition) {
    return {
      x: Number(callout.textBoxPosition.x ?? 0),
      y: Number(callout.textBoxPosition.y ?? 0),
      width: Number(callout.textBoxWidth ?? callout.textBox?.width ?? 0.1),
      height: Number(callout.textBoxHeight ?? callout.textBox?.height ?? 0.05),
    };
  }
  if (callout.textBox) {
    return {
      x: Number(callout.textBox.x ?? 0),
      y: Number(callout.textBox.y ?? 0),
      width: Number(callout.textBox.width ?? callout.textBoxWidth ?? 0.1),
      height: Number(callout.textBox.height ?? callout.textBoxHeight ?? 0.05),
    };
  }
  if (callout.label) {
    return {
      x: Number(callout.label.left ?? 0),
      y: Number(callout.label.top ?? 0),
      width: Number(callout.label.width ?? 0.1),
      height: Number(callout.label.height ?? 0.05),
    };
  }
  return null;
}

export function rotateCalloutFractions(callout, pageWidth, pageHeight, delta) {
  if (!callout || typeof callout !== 'object') return callout;
  const next = { ...callout };
  if (next.arrowTip) next.arrowTip = rotateNormalizedPoint(next.arrowTip, pageWidth, pageHeight, delta);
  if (next.anchor) next.anchor = rotateNormalizedPoint(next.anchor, pageWidth, pageHeight, delta);
  if (next.knee) next.knee = rotateNormalizedPoint(next.knee, pageWidth, pageHeight, delta);
  const box = readCalloutBox(next);
  if (box) {
    const rotated = rotateNormalizedBox(box, box.width, box.height, pageWidth, pageHeight, delta);
    if (next.textBoxPosition) next.textBoxPosition = { ...next.textBoxPosition, x: rotated.x, y: rotated.y };
    if (next.textBoxWidth != null) next.textBoxWidth = rotated.width;
    if (next.textBoxHeight != null) next.textBoxHeight = rotated.height;
    if (next.textBox) {
      next.textBox = { ...next.textBox, x: rotated.x, y: rotated.y, width: rotated.width, height: rotated.height };
    }
    if (next.label) {
      next.label = { ...next.label, left: rotated.x, top: rotated.y, width: rotated.width, height: rotated.height };
    }
  }
  return next;
}

function calloutPixels(callout, pageWidth, pageHeight) {
  const at = callout?.arrowTip || callout?.anchor || {};
  const kn = callout?.knee || {};
  const box = readCalloutBox(callout) || { x: 0, y: 0, width: 0.1, height: 0.05 };
  const atX = Number(at.x ?? 0) * pageWidth;
  const atY = Number(at.y ?? 0) * pageHeight;
  const knX = Number(kn.x ?? 0) * pageWidth;
  const knY = Number(kn.y ?? 0) * pageHeight;
  const tbX = box.x * pageWidth;
  const tbY = box.y * pageHeight;
  const tbW = Math.max(1, box.width * pageWidth);
  const tbH = Math.max(1, box.height * pageHeight);
  return { atX, atY, knX, knY, tbX, tbY, tbW, tbH };
}

function rebuildCalloutChildren(objects, callout, pageWidth, pageHeight) {
  const { atX, atY, knX, knY, tbX, tbY, tbW, tbH } = calloutPixels(callout, pageWidth, pageHeight);
  return (Array.isArray(objects) ? objects : []).map((child) => {
    const part = child?.data?.calloutPart;
    if (part === 'line1') return { ...child, x1: tbX + tbW / 2, y1: tbY + tbH / 2, x2: knX, y2: knY };
    if (part === 'line2') return { ...child, x1: knX, y1: knY, x2: atX, y2: atY };
    if (part === 'arrowTip') return { ...child, left: atX - 3, top: atY - 3 };
    if (part === 'textBox' || part === 'text' || child?.type === 'textbox') {
      return { ...child, left: tbX, top: tbY, width: tbW, height: tbH };
    }
    return child;
  });
}

function rotatePathCommands(commands, pageWidth, pageHeight, delta) {
  return (Array.isArray(commands) ? commands : []).map((command) => {
    if (!Array.isArray(command) || command[0] === 'Z' || command[0] === 'z') return command;
    const next = [command[0]];
    for (let i = 1; i + 1 < command.length; i += 2) {
      const rotated = rotateDisplayedPoint(command[i], command[i + 1], pageWidth, pageHeight, delta);
      next.push(rotated.x, rotated.y);
    }
    return next;
  });
}

function rotatePointList(points, pageWidth, pageHeight, delta) {
  return (Array.isArray(points) ? points : []).map((pt) => {
    if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1]))) {
      const rotated = rotateDisplayedPoint(pt[0], pt[1], pageWidth, pageHeight, delta);
      return [rotated.x, rotated.y, ...pt.slice(2)];
    }
    if (pt && typeof pt === 'object' && !Array.isArray(pt) && ('x' in pt || 'y' in pt)) {
      const rotated = rotateDisplayedPoint(pt.x, pt.y, pageWidth, pageHeight, delta);
      return { ...pt, x: rotated.x, y: rotated.y };
    }
    return pt;
  });
}

function rotateNestedPoints(value, pageWidth, pageHeight, delta) {
  if (!Array.isArray(value)) return value;
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
    && !Array.isArray(value[0])) {
    const rotated = rotateDisplayedPoint(value[0], value[1], pageWidth, pageHeight, delta);
    return [rotated.x, rotated.y, ...value.slice(2)];
  }
  return value.map((entry) => rotateNestedPoints(entry, pageWidth, pageHeight, delta));
}

function boundsFromInk(obj) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const command of obj.path || []) {
    if (!Array.isArray(command)) continue;
    for (let i = 1; i + 1 < command.length; i += 2) visit(command[i], command[i + 1]);
  }
  for (const pt of obj.paperCenterline || []) {
    if (Array.isArray(pt)) visit(Number(pt[0]), Number(pt[1]));
    else if (pt && typeof pt === 'object') visit(Number(pt.x), Number(pt.y));
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function isPageSpaceInk(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const type = String(obj.type || '').toLowerCase();
  const tool = String(obj.tool || obj.data?.tool || '').toLowerCase();
  const isInk = type === 'path' || tool === 'pen' || tool === 'highlighter' || tool === 'freedraw';
  if (!isInk) return false;
  const leftZero = obj.left == null || Number(obj.left) === 0;
  const topZero = obj.top == null || Number(obj.top) === 0;
  const offset = obj.pathOffset;
  const noOffset = !offset || (Number(offset.x || 0) === 0 && Number(offset.y || 0) === 0);
  const hasGeom = (Array.isArray(obj.path) && obj.path.length > 0)
    || (Array.isArray(obj.paperCenterline) && obj.paperCenterline.length > 0);
  return leftZero && topZero && noOffset && hasGeom;
}

/**
 * Live pen/highlighter stores path + paperCenterline in page space
 * (left=0, top=0). Remap each point through the same displayed-space
 * contract as rect; do not invent an object angle.
 */
export function rotatePageSpaceInk(obj, pageWidth, pageHeight, delta) {
  if (!obj || typeof obj !== 'object') return obj;
  if (normalizeRotationDelta(delta) === 0) return obj;
  const next = { ...obj };
  if (Array.isArray(next.path)) {
    next.path = rotatePathCommands(next.path, pageWidth, pageHeight, delta);
  }
  if (Array.isArray(next.paperCenterline)) {
    next.paperCenterline = rotatePointList(next.paperCenterline, pageWidth, pageHeight, delta);
  }
  if (Array.isArray(next.polygons)) {
    next.polygons = rotateNestedPoints(next.polygons, pageWidth, pageHeight, delta);
  }
  const bounds = boundsFromInk(next);
  if (bounds) {
    if ('width' in obj) next.width = bounds.w;
    if ('height' in obj) next.height = bounds.h;
  }
  if ('left' in obj) next.left = 0;
  if ('top' in obj) next.top = 0;
  if ('angle' in obj) next.angle = Number(obj.angle) || 0;
  return next;
}

function isCounterPin(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const kind = String(obj.data?.type || obj.data?.annotationType || obj.type || '').toLowerCase();
  return kind === 'counter';
}

function displayedCounterRadius(obj) {
  const scaleX = Math.abs(Number(obj?.scaleX ?? 1) || 1);
  const radius = Number(obj?.radius);
  if (Number.isFinite(radius) && radius > 0) return radius * scaleX;
  const width = Number(obj?.width);
  if (Number.isFinite(width) && width > 0) return (Math.abs(width) * scaleX) / 2;
  return 14 * scaleX;
}

function normalizePointerAngle(value, fallback = 225) {
  const raw = Number(value);
  const base = Number.isFinite(raw) ? raw : fallback;
  return ((base % 360) + 360) % 360;
}

/**
 * Live counter pins store left/top as the circle top-left and omit
 * width/height. Remap the displayed visual center (left+r, top+r) and
 * add delta to data.pointerAngle so the nub still aims after viewBox
 * swap. Do not invent an object angle — the bubble stays circular.
 */
export function rotatePageSpaceCounter(obj, pageWidth, pageHeight, delta) {
  if (!obj || typeof obj !== 'object') return obj;
  if (normalizeRotationDelta(delta) === 0) return obj;
  if (!isCounterPin(obj) && obj.radius == null && obj.data?.pointerAngle == null) return obj;
  const radius = displayedCounterRadius(obj);
  const left = Number(obj.left ?? obj.x) || 0;
  const top = Number(obj.top ?? obj.y) || 0;
  const rotated = rotateDisplayedPoint(left + radius, top + radius, pageWidth, pageHeight, delta);
  const nextLeft = rotated.x - radius;
  const nextTop = rotated.y - radius;
  const next = { ...obj, left: nextLeft, top: nextTop };
  if ('x' in obj) next.x = nextLeft;
  if ('y' in obj) next.y = nextTop;
  if ('angle' in obj) next.angle = Number(obj.angle) || 0;
  const data = (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data))
    ? { ...obj.data }
    : {};
  data.pointerAngle = normalizePointerAngle(
    (data.pointerAngle != null ? Number(data.pointerAngle) : 225) + Number(delta || 0),
  );
  if ('left' in data) data.left = nextLeft;
  if ('top' in data) data.top = nextTop;
  if ('x' in data) data.x = next.x ?? nextLeft;
  if ('y' in data) data.y = next.y ?? nextTop;
  next.data = data;
  return next;
}

function isSurveyMarkerBounds(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const bounds = obj.bounds;
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) return false;
  return ['x', 'y', 'left', 'top', 'width', 'height'].some((key) => (
    Number.isFinite(Number(bounds[key]))
  ));
}

function normalizeMarkerAngle(value) {
  const raw = Number(value);
  const base = Number.isFinite(raw) ? raw : 0;
  return ((base % 360) + 360) % 360;
}

/**
 * Live survey markers store geometry only in bounds {x,y,width,height,angle}.
 * Remap the displayed visual center through the same contract as rect and
 * add delta to bounds.angle. Do not invent Fabric left/top on the marker.
 */
export function rotateSurveyMarkerBounds(obj, pageWidth, pageHeight, delta) {
  if (!obj || typeof obj !== 'object') return obj;
  if (normalizeRotationDelta(delta) === 0) return obj;
  if (!isSurveyMarkerBounds(obj)) return obj;
  const bounds = obj.bounds;
  const left = Number(bounds.x ?? bounds.left) || 0;
  const top = Number(bounds.y ?? bounds.top) || 0;
  const width = Number(bounds.width) || 0;
  const height = Number(bounds.height) || 0;
  const vw = Math.abs(width) || 0;
  const vh = Math.abs(height) || 0;
  const rotated = rotateDisplayedPoint(left + vw / 2, top + vh / 2, pageWidth, pageHeight, delta);
  const nextLeft = rotated.x - vw / 2;
  const nextTop = rotated.y - vh / 2;
  const nextBounds = {
    ...bounds,
    x: nextLeft,
    y: nextTop,
    width,
    height,
    angle: normalizeMarkerAngle((Number(bounds.angle) || 0) + Number(delta || 0)),
  };
  if ('left' in bounds) nextBounds.left = nextLeft;
  if ('top' in bounds) nextBounds.top = nextTop;
  return { ...obj, bounds: nextBounds };
}

function rotateCalloutObject(obj, pageWidth, pageHeight, delta) {
  const nextSize = rotateDisplayedPageSize(pageWidth, pageHeight, delta);
  let next = { ...obj };
  if (next.data && typeof next.data === 'object' && !Array.isArray(next.data)) {
    const data = { ...next.data };
    if (data.legacyCallout && typeof data.legacyCallout === 'object') {
      data.legacyCallout = rotateCalloutFractions(data.legacyCallout, pageWidth, pageHeight, delta);
    }
    if (data.legacyNormalizedCoords && typeof data.legacyNormalizedCoords === 'object') {
      data.legacyNormalizedCoords = rotateCalloutFractions(
        data.legacyNormalizedCoords,
        pageWidth,
        pageHeight,
        delta,
      );
    }
    next.data = data;
  }
  if (next.arrowTip || next.knee || next.textBoxPosition || next.textBox || next.anchor || next.label) {
    next = { ...next, ...rotateCalloutFractions(next, pageWidth, pageHeight, delta) };
  }
  const source = next.data?.legacyCallout || next;
  if (Array.isArray(next.objects)) {
    next.objects = rebuildCalloutChildren(next.objects, source, nextSize.width, nextSize.height);
  }
  const { atX, atY, knX, knY, tbX, tbY, tbW, tbH } = calloutPixels(source, nextSize.width, nextSize.height);
  const groupLeft = Math.min(tbX, knX, atX);
  const groupTop = Math.min(tbY, knY, atY);
  const groupRight = Math.max(tbX + tbW, knX, atX);
  const groupBottom = Math.max(tbY + tbH, knY, atY);
  next.left = groupLeft;
  next.top = groupTop;
  next.width = groupRight - groupLeft;
  next.height = groupBottom - groupTop;
  if ('x' in obj) next.x = groupLeft;
  if ('y' in obj) next.y = groupTop;
  return next;
}

function rotateFabricLikeObject(obj, pageWidth, pageHeight, delta) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const turns = normalizeRotationDelta(delta);
  if (turns === 0) return obj;
  if (isCalloutLike(obj)) return rotateCalloutObject(obj, pageWidth, pageHeight, delta);
  if (isPageSpaceInk(obj)) return rotatePageSpaceInk(obj, pageWidth, pageHeight, delta);
  if (isCounterPin(obj)) return rotatePageSpaceCounter(obj, pageWidth, pageHeight, delta);
  if (isSurveyMarkerBounds(obj)) return rotateSurveyMarkerBounds(obj, pageWidth, pageHeight, delta);
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
    next.left = nextLeft;
    next.top = nextTop;
    if ('x' in obj) next.x = nextLeft;
    if ('y' in obj) next.y = nextTop;
    if ('angle' in obj || Number.isFinite(Number(obj.angle))) {
      next.angle = (Number(obj.angle) || 0) + Number(delta || 0);
    } else if (hasBox) {
      next.angle = Number(delta || 0);
    }
    if (next.data && typeof next.data === 'object' && !Array.isArray(next.data)) {
      const data = { ...next.data };
      data.left = next.left;
      data.top = next.top;
      if ('x' in data) data.x = next.x ?? next.left;
      if ('y' in data) data.y = next.y ?? next.top;
      data.angle = next.angle;
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
