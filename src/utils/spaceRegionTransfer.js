import { calloutToAnnotationObject } from './calloutAnnotationBridge.js';
import { translateMovedMark } from './crossPageMove.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
    if (Array.isArray(moved.data?.quads)) {
      moved.data = { ...moved.data, quads: moved.data.quads.map((quad) => Object.fromEntries(Object.entries(quad).map(([key, value]) => [key, /^x[1-4]$/.test(key) ? value + dx : /^y[1-4]$/.test(key) ? value + dy : value]))) };
      // The geometry travels, but a source PDF's character indices cannot
      // identify words on a different page. Endpoint edits use the new quads.
      if (Number(sourcePageId) !== Number(targetPageId)) {
        delete moved.data.textRange;
        delete moved.data.textRangeModel;
      }
    }
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
  const pageChanges = [];
  for (const [spaceId, pageId] of [[sourceSpaceId, Number(sourcePageId)], [targetSpaceId, Number(targetPageId)]]) {
    const before = spaces.find((space) => space.id === spaceId)?.assignedPages?.find((page) => Number(page.pageId) === pageId) || null;
    const after = nextSpaces.find((space) => space.id === spaceId)?.assignedPages?.find((page) => Number(page.pageId) === pageId) || null;
    if (!same(before, after)) pageChanges.push({ spaceId, pageId, before: clone(before), after: clone(after) });
  }
  const findMark = (pages, id) => {
    for (const [pageNumber, page] of Object.entries(pages)) {
      const index = (page.objects || []).findIndex((mark) => idOf(mark) === id);
      if (index >= 0) return { pageNumber: Number(pageNumber), object: clone(page.objects[index]), index };
    }
    return null;
  };
  const transferState = {
    pages: pageChanges,
    annotations: movedIds.filter((id) => findMark(annotationsByPage, id)).map((id) => ({ id, before: findMark(annotationsByPage, id), after: findMark(nextPages, id) })),
    markers: movedIds.filter((id) => surveyMarkers[id]).map((id) => ({ id, before: clone(surveyMarkers[id]), after: clone(nextMarkers[id]) })),
  };
  return { transferState, spaces: nextSpaces, annotationsByPage: nextPages, surveyMarkers: nextMarkers, movedIds: [...new Set(movedIds)], changedPages: [...new Set(movedIds.length ? [Number(sourcePageId), Number(targetPageId)] : [])] };
}


const regionKey = (region) => region?.regionId ? `id:${region.regionId}` : `legacy:${JSON.stringify(region)}`;
const regionMap = (page) => new Map((page?.regions || []).map((region) => [regionKey(region), region]));

/** Reverse only this transfer's associations; newer edits stay authoritative. */
export function restoreSpaceRegionTransfer(current, transferState, { direction = 'undo' } = {}) {
  if (!transferState) return current;
  const expectedKey = direction === 'undo' ? 'after' : 'before';
  const desiredKey = direction === 'undo' ? 'before' : 'after';
  const pages = transferState.pages || [];
  const blockedRegions = new Set();
  let blockedWholePage = false;
  const changes = pages.map((change) => {
    const expected = change[expectedKey], desired = change[desiredKey];
    const liveSpace = current.spaces?.find((space) => space.id === change.spaceId);
    if (!liveSpace && expected?.wholePageIncluded === true) blockedWholePage = true;
    const live = liveSpace?.assignedPages?.find((page) => Number(page.pageId) === change.pageId) || null;
    const expectedRegions = regionMap(expected), desiredRegions = regionMap(desired), liveRegions = regionMap(live);
    const owned = [...new Set([...expectedRegions.keys(), ...desiredRegions.keys()])].filter((key) => !same(expectedRegions.get(key), desiredRegions.get(key)));
    for (const key of owned) if (!same(liveRegions.get(key), expectedRegions.get(key))) blockedRegions.add(key);
    return { ...change, expected, desired, live, expectedRegions, desiredRegions, liveRegions, owned };
  });
  const markState = (pages, id) => Object.entries(pages || {}).flatMap(([pageNumber, page]) => (page.objects || []).filter((mark) => idOf(mark) === id).map((object) => ({ pageNumber: Number(pageNumber), object })));
  const expectedMarkState = (value) => value ? { pageNumber: value.pageNumber, object: value.object } : undefined;
  // Keep a region and its marks together. If a later edit changed a moved
  // mark, skipping its relocation must also keep its region on that page.
  for (const change of transferState.annotations || []) {
    const expected = change[expectedKey], desired = change[desiredKey];
    const live = markState(current.annotationsByPage, change.id);
    if (live.length !== (expected ? 1 : 0) || !same(live[0], expectedMarkState(expected))) {
      const regionId = regionOf(expected?.object) || regionOf(desired?.object);
      if (regionId) blockedRegions.add(`id:${regionId}`);
      else blockedWholePage = true;
    }
  }
  for (const change of transferState.markers || []) {
    const expected = change[expectedKey], desired = change[desiredKey];
    if (!same(current.surveyMarkers?.[change.id], expected)) {
      const regionId = regionOf(expected) || regionOf(desired);
      if (regionId) blockedRegions.add(`id:${regionId}`);
      else blockedWholePage = true;
    }
  }
  let spaces = current.spaces || [];
  for (const change of changes) {
    if (blockedWholePage) continue;
    // A removed space is a later decision. Undo never brings its full snapshot back.
    const index = spaces.findIndex((space) => space.id === change.spaceId);
    if (index < 0) continue;
    const currentSpace = spaces[index];
    let regions = [...(change.live?.regions || [])];
    for (const key of change.owned) {
      if (blockedRegions.has(key)) continue;
      const desiredRegion = change.desiredRegions.get(key);
      regions = regions.filter((region) => regionKey(region) !== key);
      if (desiredRegion) regions.push(clone(desiredRegion));
    }
    const expectedWhole = change.expected?.wholePageIncluded === true;
    const desiredWhole = change.desired?.wholePageIncluded === true;
    let whole = change.live?.wholePageIncluded === true;
    if (whole === expectedWhole) whole = desiredWhole;
    // Keep later labels and visibility changes. A newly restored assignment
    // starts from its original metadata, without replacing an existing one.
    let nextPage = change.live ? { ...change.live, regions } : regions.length || whole ? { ...clone(change.desired), pageId: change.pageId, regions } : null;
    if (nextPage && (change.live?.wholePageIncluded !== undefined || change.desired?.wholePageIncluded !== undefined)) nextPage.wholePageIncluded = whole;
    if (nextPage && !regions.length && !whole && change.desired === null && same(change.live, change.expected)) nextPage = null;
    const assignedPages = [];
    let found = false;
    for (const page of currentSpace.assignedPages || []) {
      if (Number(page.pageId) !== change.pageId) assignedPages.push(page);
      else { found = true; if (nextPage) assignedPages.push(nextPage); }
    }
    if (!found && nextPage) assignedPages.push(nextPage);
    spaces = spaces.map((space, position) => position === index ? { ...space, assignedPages } : space);
  }
  let annotationsByPage = current.annotationsByPage || {};
  for (const change of transferState.annotations || []) {
    const expected = change[expectedKey], desired = change[desiredKey];
    if (blockedWholePage || blockedRegions.has(`id:${regionOf(expected?.object) || regionOf(desired?.object)}`)) continue;
    const entries = Object.entries(annotationsByPage).flatMap(([pageNumber, page]) => (page.objects || []).filter((mark) => idOf(mark) === change.id).map((object) => ({ pageNumber: Number(pageNumber), object })));
    if (entries.length !== (expected ? 1 : 0) || !same(entries[0], expectedMarkState(expected))) continue;
    annotationsByPage = Object.fromEntries(Object.entries(annotationsByPage).map(([pageNumber, page]) => [pageNumber, { ...page, objects: (page.objects || []).filter((mark) => idOf(mark) !== change.id) }]));
    if (desired) {
      const page = annotationsByPage[desired.pageNumber] || { objects: [] };
      const objects = [...page.objects];
      objects.splice(Math.min(desired.index ?? objects.length, objects.length), 0, clone(desired.object));
      annotationsByPage[desired.pageNumber] = { ...page, objects };
    }
  }
  const surveyMarkers = { ...(current.surveyMarkers || {}) };
  for (const change of transferState.markers || []) {
    const expected = change[expectedKey], desired = change[desiredKey];
    if (blockedWholePage || blockedRegions.has(`id:${regionOf(expected) || regionOf(desired)}`) || !same(surveyMarkers[change.id], expected)) continue;
    if (desired) surveyMarkers[change.id] = clone(desired);
    else delete surveyMarkers[change.id];
  }
  return { ...current, spaces, annotationsByPage, surveyMarkers };
}
