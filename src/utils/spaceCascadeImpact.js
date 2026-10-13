// src/utils/spaceCascadeImpact.js
//
// Spaces audit chunk A (2026-10-01): removing a page from a space, or deleting
// a space, cascade-deletes the marks, callouts and Survey Markers placed IN
// that space on those pages (PDFViewer.cascadeDeleteScopedAppState). The UI
// used to do that with no confirm (page row) or a confirm that said nothing
// would be deleted (space). The confirm now states the real consequence, so
// the count it shows and the cascade must use ONE rule: both read
// resolveSpaceCascadeScope + isSpaceScopedEntry from here.

/**
 * What a space cascade covers: the space, an optional set of pages, and the
 * region ids it treats as "inside" (explicit ones, or every region drawn on
 * the covered pages of that space).
 */
export function resolveSpaceCascadeScope({ spaceId, space = null, pageIds = null, regionIds = null } = {}) {
  const pageSet = Array.isArray(pageIds) && pageIds.length > 0
    ? new Set(pageIds.map(Number).filter(Number.isFinite))
    : null;
  const hasExplicitRegionIds = Array.isArray(regionIds) && regionIds.length > 0;
  const collectedRegionIds = new Set(hasExplicitRegionIds ? regionIds.filter(Boolean) : []);
  if (!hasExplicitRegionIds) {
    (space?.assignedPages || []).forEach((page) => {
      const pageNumber = Number(page?.pageId);
      if (pageSet && !pageSet.has(pageNumber)) return;
      (page?.regions || []).forEach((region) => {
        if (region?.regionId) collectedRegionIds.add(region.regionId);
      });
    });
  }
  return { spaceId, pageSet, regionIds: collectedRegionIds, hasExplicitRegionIds };
}

/** True when the cascade for `scope` deletes this mark / callout / marker. */
export function isSpaceScopedEntry(entry, scope) {
  if (!entry || !scope) return false;
  const pageNumber = Number(entry.pageNumber ?? entry.page ?? entry.pageId);
  if (scope.pageSet && Number.isFinite(pageNumber) && !scope.pageSet.has(pageNumber)) return false;
  if (entry.regionId && scope.regionIds.has(entry.regionId)) return true;
  if (scope.hasExplicitRegionIds) return false;
  if (entry.spaceId === scope.spaceId) return true;
  if (entry.moduleId === scope.spaceId) return true;
  return false;
}

const defaultMarkId = (obj) => obj?.data?.id ?? obj?.id ?? obj?.annotationId ?? null;

/**
 * Counts what a space cascade would delete, without deleting anything.
 * `marks` = canvas marks + callouts (one per id), `surveyMarkers` = Survey
 * Markers, `areas` = drawn region areas on the covered pages.
 */
export function countSpaceCascadeImpact({
  spaceId,
  space = null,
  pageIds = null,
  annotationsByPage = {},
  callouts = [],
  surveyMarkers = {},
  getMarkId = defaultMarkId,
} = {}) {
  const scope = resolveSpaceCascadeScope({ spaceId, space, pageIds });
  const markIds = new Set();
  let anonymousMarks = 0;
  Object.entries(annotationsByPage || {}).forEach(([pageKey, pageData]) => {
    const pageNumber = Number(pageKey);
    if (scope.pageSet && !scope.pageSet.has(pageNumber)) return;
    (Array.isArray(pageData?.objects) ? pageData.objects : []).forEach((obj) => {
      if (!isSpaceScopedEntry({ ...obj, pageNumber }, scope)) return;
      const id = getMarkId(obj);
      if (id) markIds.add(String(id)); else anonymousMarks += 1;
    });
  });
  (Array.isArray(callouts) ? callouts : []).forEach((callout) => {
    if (!isSpaceScopedEntry(callout, scope)) return;
    const id = callout?.id || callout?.annotationId || null;
    if (id) markIds.add(String(id)); else anonymousMarks += 1;
  });
  let markerCount = 0;
  Object.entries(surveyMarkers || {}).forEach(([annotationId, marker]) => {
    if (markIds.has(String(annotationId))) return;
    if (isSpaceScopedEntry(marker, scope)) markerCount += 1;
  });
  let areas = 0;
  (space?.assignedPages || []).forEach((page) => {
    if (scope.pageSet && !scope.pageSet.has(Number(page?.pageId))) return;
    areas += Array.isArray(page?.regions) ? page.regions.length : 0;
  });
  const marks = markIds.size + anonymousMarks;
  return { marks, surveyMarkers: markerCount, areas, total: marks + markerCount };
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function describeLoss(impact) {
  const parts = [];
  if (impact?.marks > 0) parts.push(plural(impact.marks, 'mark'));
  if (impact?.surveyMarkers > 0) parts.push(plural(impact.surveyMarkers, 'Survey Marker'));
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0] : `${parts[0]} and ${parts[1]}`;
}

/**
 * The confirm for removing one page from a space. Returns null when nothing
 * but the page assignment goes (no marks, markers or drawn areas): that
 * removal is one Undo step and needs no question.
 */
export function buildRemovePageConfirm({ spaceName, pageId, impact }) {
  const name = spaceName || 'this space';
  const loss = describeLoss(impact);
  const areas = impact?.areas || 0;
  if (!loss && areas === 0) return null;
  const sentences = [];
  if (loss) sentences.push(`This also deletes ${loss} placed in ${name} on p.${pageId}.`);
  if (areas > 0) sentences.push(`Its ${plural(areas, 'drawn area')} ${areas === 1 ? 'goes' : 'go'} too.`);
  sentences.push('The page itself stays in the document.');
  return {
    title: `Remove p.${pageId} from ${name}?`,
    message: sentences.join(' '),
    confirmLabel: 'Remove',
    danger: true,
  };
}

/** The confirm for deleting a whole space (always asked). */
export function buildDeleteSpaceConfirm({ spaceName, pageCount = 0, impact }) {
  const name = spaceName || 'this space';
  const loss = describeLoss(impact);
  const sentences = [];
  if (loss) sentences.push(`This also deletes ${loss} placed in ${name}.`);
  else sentences.push('No marks are deleted.');
  if (pageCount > 0) {
    sentences.push(`Its ${plural(pageCount, 'page')} ${pageCount === 1 ? 'stays' : 'stay'} in the document.`);
  }
  return {
    title: `Delete ${name}?`,
    message: sentences.join(' '),
    confirmLabel: 'Delete',
    danger: true,
  };
}

/** Row meta: "3 pages · 2 areas" (areas only when some are drawn). */
export function formatSpaceCountLabel(pageCount = 0, areaCount = 0) {
  const pages = plural(pageCount, 'page');
  return areaCount > 0 ? `${pages} · ${plural(areaCount, 'area')}` : pages;
}
