import { calloutToAnnotationObject } from './calloutAnnotationBridge.js';
import { translateMovedMark } from './crossPageMove.js';

const clone = (value) => structuredClone(value);
const idOf = (mark) => String(mark?.data?.id ?? mark?.id ?? mark?.annotationId ?? '');
const regionOf = (mark) => mark?.regionId ?? mark?.data?.regionId;
const spaceOf = (mark) => mark?.spaceId ?? mark?.data?.spaceId;

/** Transfer a region assignment without deleting or replacing other page content. */
export function planSpaceRegionTransfer({ spaces, annotationsByPage = {}, surveyMarkers = {}, sourceSpaceId, sourcePageId, targetSpaceId, targetPageId, copy = false, sourceSize, targetSize, createId = () => crypto.randomUUID() }) {
  const from = spaces.find((space) => space.id === sourceSpaceId);
  const to = spaces.find((space) => space.id === targetSpaceId);
  const entry = from?.assignedPages?.find((page) => Number(page.pageId) === Number(sourcePageId));
  if (!entry || !to) throw new Error('That region or space is no longer available.');
  if (sourceSpaceId === targetSpaceId && Number(sourcePageId) === Number(targetPageId)) throw new Error('Choose a different page or space.');
  const originalIds = new Set((entry.regions || []).map((region) => region.regionId).filter(Boolean));
  const points = (entry.regions || []).flatMap((region) => region.coordinates || []);
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  let dx = 0, dy = 0;
  if (points.length && targetSize?.width > 0 && targetSize?.height > 0) {
    const left = Math.min(...xs), top = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
    if (right - left > targetSize.width || bottom - top > targetSize.height) throw new Error('This region is larger than that page. Choose a larger page.');
    dx = left < 0 ? -left : right > targetSize.width ? targetSize.width - right : 0;
    dy = top < 0 ? -top : bottom > targetSize.height ? targetSize.height - bottom : 0;
  }
  const transferRegion = (region) => ({
    ...clone(region),
    ...(region.regionId ? { regionId: copy ? createId() : region.regionId } : {}),
    pageId: Number(targetPageId),
    coordinates: (region.coordinates || []).map((value, index) => value + (index % 2 ? dy : dx)),
    ...(Array.isArray(region.sourceRegions) ? { sourceRegions: region.sourceRegions.map(transferRegion) } : {}),
  });
  const transferred = { ...clone(entry), pageId: Number(targetPageId), regions: (entry.regions || []).map(transferRegion) };
  const nextSpaces = spaces.map((space) => {
    let pages = space.assignedPages || [];
    if (!copy && space.id === sourceSpaceId) pages = pages.filter((page) => Number(page.pageId) !== Number(sourcePageId));
    if (space.id === targetSpaceId) {
      const existing = pages.find((page) => Number(page.pageId) === Number(targetPageId));
      pages = existing
        ? pages.map((page) => page === existing ? { ...page, wholePageIncluded: page.wholePageIncluded === true || transferred.wholePageIncluded === true, regions: [...(page.regions || []), ...transferred.regions] } : page)
        : [...pages, transferred];
    }
    return space.id === sourceSpaceId || space.id === targetSpaceId ? { ...space, assignedPages: pages } : space;
  });
  const belongs = (mark) => originalIds.has(regionOf(mark)) || (entry.wholePageIncluded === true && spaceOf(mark) === sourceSpaceId);
  const moveScope = (mark) => {
    const moved = { ...mark, pageNumber: Number(targetPageId), spaceId: targetSpaceId };
    if ('pageId' in moved) moved.pageId = Number(targetPageId);
    if (mark.data) moved.data = { ...mark.data, spaceId: targetSpaceId, ...('pageNumber' in mark.data ? { pageNumber: Number(targetPageId) } : {}), ...('pageId' in mark.data ? { pageId: Number(targetPageId) } : {}) };
    if (moved.data?.legacyCallout && targetSize?.width > 0 && targetSize?.height > 0) {
      const original = moved.data.legacyCallout;
      const width = sourceSize?.width || targetSize.width;
      const height = sourceSize?.height || targetSize.height;
      const point = (value) => ({ x: ((value?.x || 0) * width + dx) / targetSize.width, y: ((value?.y || 0) * height + dy) / targetSize.height });
      const callout = { ...original, pageNumber: Number(targetPageId), spaceId: targetSpaceId,
        arrowTip: point(original.arrowTip), knee: point(original.knee), textBoxPosition: point(original.textBoxPosition),
        textBoxWidth: original.textBoxWidth * width / targetSize.width,
        textBoxHeight: original.textBoxHeight * height / targetSize.height,
      };
      const projection = calloutToAnnotationObject(callout, targetSize);
      return { ...moved, ...projection, data: { ...moved.data, ...projection.data } };
    }
    return moved;
  };
  let nextPages = annotationsByPage, nextMarkers = surveyMarkers;
  const movedIds = [];
  if (!copy) {
    const sourcePage = annotationsByPage[sourcePageId] || { objects: [] };
    const moved = (sourcePage.objects || []).filter(belongs);
    movedIds.push(...moved.map(idOf).filter(Boolean));
    if (moved.length) {
      const targetPage = Number(sourcePageId) === Number(targetPageId) ? sourcePage : (annotationsByPage[targetPageId] || { objects: [] });
      const transferredMarks = moved.map((mark) => moveScope(translateMovedMark(mark, mark, dx, dy)));
      nextPages = { ...annotationsByPage,
        [sourcePageId]: { ...sourcePage, objects: sourcePage.objects.filter((mark) => !belongs(mark)) },
      };
      nextPages[targetPageId] = { ...targetPage, objects: [...(Number(sourcePageId) === Number(targetPageId) ? nextPages[sourcePageId].objects : (targetPage.objects || [])), ...transferredMarks] };
    }
    nextMarkers = { ...surveyMarkers };
    for (const [id, marker] of Object.entries(surveyMarkers)) {
      if (Number(marker.pageNumber) !== Number(sourcePageId) || !belongs(marker)) continue;
      movedIds.push(id);
      nextMarkers[id] = moveScope({ ...marker, ...(marker.bounds ? { bounds: { ...marker.bounds, x: marker.bounds.x + dx, y: marker.bounds.y + dy } } : {}) });
    }
  }
  return { spaces: nextSpaces, annotationsByPage: nextPages, surveyMarkers: nextMarkers, movedIds: [...new Set(movedIds)], changedPages: [...new Set(movedIds.length ? [Number(sourcePageId), Number(targetPageId)] : [])] };
}
