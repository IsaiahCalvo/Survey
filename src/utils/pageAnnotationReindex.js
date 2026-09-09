import { mintPastedCloneIdentity } from './pasteCloneIdentity.js';
import { EXPORT_ACK_FIELDS } from '../services/excelExportAck.js';

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

const remappedDomains = new Set(['annotationsByPage', 'surveyMarkers', 'annotations',
  'pageNames', 'pageTransformations', 'bookmarks', 'spaces', 'regionOverlayDisabled',
  'deletedPdfAnnotations']);
const pageBindingKeys = new Set(['page', 'pages', 'pageId', 'pageIds', 'pageNumber',
  'pageNumbers', 'page_number', 'targetPage', 'sourcePage', 'assignedPages',
  ...remappedDomains]);

// Extra document metadata is opaque, not a schema for arbitrary page bindings.
// Detect recognizable addresses conservatively; this is not a complete capture
// validator and cannot infer custom address encodings from their values.
function assertUnboundMetadata(value, path, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value) || value instanceof Set) {
    for (const entry of value) assertUnboundMetadata(entry, path, seen);
    return;
  }
  for (const [key, entry] of value instanceof Map ? value.entries() : Object.entries(value)) {
    if (pageBindingKeys.has(key) || /^[1-9]\d*$/.test(String(key))) {
      throw new Error(`An undeclared page binding in ${path} cannot be remapped. Your document was kept.`);
    }
    assertUnboundMetadata(entry, `${path}.${String(key)}`, seen);
  }
}

function validateNativeDeletions(entries) {
  if (!Array.isArray(entries)) throw new Error('The native deletion list is malformed. Your document was kept.');
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !Number.isSafeInteger(entry.pageNumber) || entry.pageNumber < 1
        || typeof entry.pdfAnnotationId !== 'string' || !entry.pdfAnnotationId.trim()
        || ['pageId', 'page'].some(key => key in entry && entry[key] !== entry.pageNumber)) {
      throw new Error('A native deletion identity is malformed. Your document was kept.');
    }
    const key = JSON.stringify([entry.pageNumber, entry.pdfAnnotationId]);
    if (seen.has(key)) throw new Error('A native deletion identity is ambiguous. Your document was kept.');
    seen.add(key);
  }
}

const remapPageFields = (value, mapPage, sourcePage = null) => {
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  const identity = value.pdfNativeAnnotationIdentity;
  const synthetic = String(value.pdfAnnotationId || '').trim().match(/^annot_p(\d+)_\d+$/i);
  if (synthetic) {
    const nativePage = Number(synthetic[1]) + 1;
    if ((sourcePage != null && sourcePage !== nativePage) || mapPage(nativePage) !== nativePage) {
      throw new Error('A synthetic native identity needs an exact PDF remap. Your document was kept.');
    }
  }
  if (identity != null) {
    if (identity.v !== 1 || !Number.isSafeInteger(identity.pageNumber) || identity.pageNumber < 1
        || !Number.isSafeInteger(identity.annotsIndex) || identity.annotsIndex < 0
        || !identity.fingerprint || typeof identity.fingerprint !== 'object'
        || (sourcePage != null && identity.pageNumber !== sourcePage)) {
      throw new Error('A native identity occurrence is malformed or mismatched. Your document was kept.');
    }
    next.pdfNativeAnnotationIdentity = { ...identity, pageNumber: mapPage(identity.pageNumber) };
  }
  for (const key of ['pageNumber', 'pageId', 'page']) {
    if (!(key in next)) continue;
    const page = asPage(next[key]);
    if (page == null) continue;
    next[key] = mapPage(page);
  }
  // The app's form carrier includes its page, but a surviving PDF widget keeps
  // its native fieldId when pages move. Only rewrite the exact canonical ID;
  // copied widgets need a proven native-ID map from the PDF writer, not a guess.
  const oldFormPage = asPage(value.pageNumber);
  const newFormPage = asPage(next.pageNumber);
  if (next.type === 'form-field' && next.fieldId != null
      && oldFormPage != null && newFormPage != null
      && next.id === `form-field:${oldFormPage}:${next.fieldId}`) {
    next.id = `form-field:${newFormPage}:${next.fieldId}`;
  }
  if (next.data && typeof next.data === 'object' && !Array.isArray(next.data)) {
    next.data = remapPageFields(next.data, mapPage, sourcePage);
  }
  if (next.legacyCallout && typeof next.legacyCallout === 'object') {
    next.legacyCallout = remapPageFields(next.legacyCallout, mapPage, sourcePage);
  }
  return next;
};

const remapPageKeyed = (source, mapPage, transformValue = (value) => value) => {
  const next = {};
  for (const [key, value] of Object.entries(source || {})) {
    const mapped = mapPage(asPage(key));
    if (mapped == null) continue;
    next[mapped] = transformValue(value, mapped, asPage(key));
  }
  return next;
};

const remapIdKeyed = (source, mapPage) => {
  const next = {};
  for (const [id, value] of Object.entries(source || {})) {
    const page = asPage(value?.pageNumber ?? value?.pageId ?? value?.page
      ?? value?.pdfNativeAnnotationIdentity?.pageNumber);
    if (page == null) {
      next[id] = value;
      continue;
    }
    const mapped = mapPage(page);
    if (mapped == null) continue;
    next[id] = remapPageFields(value, () => mapped, page);
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
          ...('pageNumber' in entry ? { pageNumber: mapped } : {}),
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

const remapNativeDeletions = (source, mapPage) => source.flatMap((entry) => {
  const mapped = mapPage(entry.pageNumber);
  if (mapped == null) return [];
  return [remapPageFields(entry, () => mapped, entry.pageNumber)];
});

const baseRemap = (model, mapPage) => ({
  // Keep document-level data; callers must declare any additional page-bound
  // domains before they can be remapped here. transformPageState owns model.
  ...model,
  ...(model.deletedPdfAnnotations !== undefined
    ? { deletedPdfAnnotations: remapNativeDeletions(model.deletedPdfAnnotations, mapPage) } : {}),
  annotationsByPage: remapPageKeyed(model.annotationsByPage, mapPage, (page, mapped, sourcePage) => ({
    ...(page || {}),
    objects: (Array.isArray(page?.objects) ? page.objects : [])
      .map((object) => remapPageFields(object, () => mapped, sourcePage)),
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

function copiedFormMap(copiedWidgets, sourcePage, targetPage) {
  const bySource = new Map();
  const targets = new Set();
  for (const entry of copiedWidgets || []) {
    if (entry?.sourcePage !== sourcePage || entry?.targetPage !== targetPage
        || !entry.sourceFieldId || !entry.targetFieldId || !entry.targetFieldName
        || entry.sourceFieldId === entry.targetFieldId) {
      throw new Error('The copied form identity does not match this page action. Your document was kept.');
    }
    const prior = bySource.get(entry.sourceFieldId);
    if (prior) {
      if (prior.targetFieldId === entry.targetFieldId && prior.targetFieldName === entry.targetFieldName) continue;
      throw new Error('The copied form identity is ambiguous. Your document was kept.');
    }
    if (targets.has(entry.targetFieldId)) {
      throw new Error('Two form fields share a copied identity. Your document was kept.');
    }
    targets.add(entry.targetFieldId);
    bySource.set(entry.sourceFieldId, entry);
  }
  return bySource;
}

// A page copy has never been exported or matched to an Excel row. An empty
// excelSync object is still a stored identity to the import matcher, so remove
// the whole record (including fingerprints, row position and old op receipts).
// Only traverse the annotation carriers we clone, not arbitrary business data.
function clearCopiedExcelReceipts(copy, seen = new Set()) {
  if (!copy || typeof copy !== 'object' || Array.isArray(copy) || seen.has(copy)) return copy;
  seen.add(copy);
  for (const key of EXPORT_ACK_FIELDS) delete copy[key];
  delete copy.excelRowIndex;
  clearCopiedExcelReceipts(copy.data, seen);
  clearCopiedExcelReceipts(copy.legacyCallout, seen);
  return copy;
}

function addPageClone(next, source, sourcePage, targetPage, createId, copiedWidgets) {
  const annotationIds = new Map();
  const regionIds = new Map();
  const forms = copiedFormMap(copiedWidgets, sourcePage, targetPage);

  for (const space of source.spaces || []) {
    const entry = (space?.assignedPages || []).find((candidate) => asPage(candidate?.pageId ?? candidate?.pageNumber) === sourcePage);
    for (const region of entry?.regions || []) {
      if (region?.regionId) regionIds.set(region.regionId, createId());
    }
  }

  const sourcePageData = source.annotationsByPage?.[sourcePage] || source.annotationsByPage?.[String(sourcePage)];
  if (sourcePageData) {
    const clonedPage = clone(sourcePageData);
    clonedPage.objects = (clonedPage.objects || []).map((object) => {
      const oldId = object?.data?.id || object?.data?.annoId || object?.id || object?.annotationId || null;
      const isForm = object?.data?.type === 'form-field' || object?.type === 'form-field';
      const form = isForm ? forms.get(object?.data?.fieldId ?? object?.fieldId) : null;
      if (isForm && !form) {
        throw new Error('A saved form value could not be matched to the copied PDF. Your document was kept.');
      }
      const newId = form ? `form-field:${targetPage}:${form.targetFieldId}` : createId();
      if (oldId) annotationIds.set(oldId, newId);
      let copied = mintPastedCloneIdentity(object, newId);
      copied = remapPageFields(copied, () => targetPage);
      copied = replaceRegionId(copied, regionIds);
      if (form) {
        copied.data = { ...copied.data, type: 'form-field', fieldId: form.targetFieldId,
          fieldName: form.targetFieldName, pageNumber: targetPage };
        if ('fieldId' in copied) copied.fieldId = form.targetFieldId;
        if ('fieldName' in copied) copied.fieldName = form.targetFieldName;
      }
      if (copied?.data?.legacyCallout) {
        copied.data.legacyCallout = {
          ...copied.data.legacyCallout,
          id: newId,
          annotationId: newId,
          pageNumber: targetPage,
        };
      }
      return clearCopiedExcelReceipts(copied);
    });
    next.annotationsByPage[targetPage] = clonedPage;
  }

  for (const [id, marker] of Object.entries(source.surveyMarkers || {})) {
    if (asPage(marker?.pageNumber) !== sourcePage) continue;
    const newId = annotationIds.get(id) || annotationIds.get(marker?.annotationId) || createId();
    annotationIds.set(id, newId);
    next.surveyMarkers[newId] = clearCopiedExcelReceipts(replaceRegionId({
      ...clone(marker),
      id: newId,
      annotationId: newId,
      pageNumber: targetPage,
    }, regionIds));
  }

  for (const [id, annotation] of Object.entries(source.annotations || {})) {
    if (asPage(annotation?.pageNumber ?? annotation?.pageId ?? annotation?.page) !== sourcePage) continue;
    const newId = annotationIds.get(id) || annotationIds.get(annotation?.annotationId) || createId();
    annotationIds.set(id, newId);
    next.annotations[newId] = clearCopiedExcelReceipts(replaceRegionId({
      ...clone(annotation),
      id: newId,
      annotationId: newId,
      pageNumber: targetPage,
    }, regionIds));
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
    const entry = (sourceSpace?.assignedPages || []).find((candidate) => asPage(candidate?.pageId ?? candidate?.pageNumber) === sourcePage);
    if (!entry) return space;
    const copiedEntry = clone(entry);
    copiedEntry.pageId = targetPage;
    if ('pageNumber' in copiedEntry) copiedEntry.pageNumber = targetPage;
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

export function transformPageState(model = {}, op, {
  createId = fallbackId, copiedWidgets = [],
} = {}) {
  // Remapping and later edits must never mutate the captured source, including
  // nested metadata in fields that this helper does not need to transform.
  model = clone(model);
  for (const [key, value] of Object.entries(model)) {
    if (!remappedDomains.has(key)) {
      if (pageBindingKeys.has(key)) throw new Error(`An undeclared page binding in ${key} cannot be remapped. Your document was kept.`);
      assertUnboundMetadata(value, key);
    }
  }
  if (model.deletedPdfAnnotations !== undefined) validateNativeDeletions(model.deletedPdfAnnotations);
  for (const page of Object.values(model.annotationsByPage || {})) {
    if (!page || typeof page !== 'object') continue;
    delete page.eraserMutation;
    delete page.eraserMaterializedMutationIds;
    delete page.eraserPresentationRevision;
  }
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
    // Copy can reorder /Annots and replace refs. An outer native ID mapping is
    // insufficient: a future writer proof must include the exact new occurrence.
    if (model.deletedPdfAnnotations?.some(entry => entry.pageNumber === sourcePage)) {
      throw new Error('A copied native deletion needs an exact PDF identity. Your document was kept.');
    }
    const next = baseRemap(model, (value) => (value <= afterPage ? value : value + 1));
    return addPageClone(next, model, sourcePage, targetPage, createId, copiedWidgets);
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
