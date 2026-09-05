import { buildAnnotationHistoryAction } from './annotationLocalHistory.js';

const pageObjects = (page) => (Array.isArray(page?.objects) ? page.objects : []);

const pdfAnnotationKey = (pageNumber, pdfAnnotationId) => (
  `${Number(pageNumber)}:${String(pdfAnnotationId)}`
);

export function getPdfAnnotationMutationState(previousByPage, nextByPage) {
  const presentPdfAnnotationKeys = new Set();
  for (const [pageKey, page] of Object.entries(nextByPage || {})) {
    for (const annotation of pageObjects(page)) {
      if (!annotation?.pdfAnnotationId) continue;
      presentPdfAnnotationKeys.add(pdfAnnotationKey(pageKey, annotation.pdfAnnotationId));
    }
  }

  const deletedPdfAnnotations = [];
  const deletedKeys = new Set();
  for (const [pageKey, page] of Object.entries(previousByPage || {})) {
    for (const annotation of pageObjects(page)) {
      if (!annotation?.pdfAnnotationId) continue;
      const key = pdfAnnotationKey(pageKey, annotation.pdfAnnotationId);
      if (presentPdfAnnotationKeys.has(key) || deletedKeys.has(key)) continue;
      deletedKeys.add(key);
      deletedPdfAnnotations.push({
        pageNumber: Number(pageKey),
        pdfAnnotationId: String(annotation.pdfAnnotationId),
        pdfAnnotationType: annotation.pdfAnnotationType || annotation?.data?.pdfAnnotationType || null,
        ...(annotation?.pdfNativeAnnotationIdentity || annotation?.data?.pdfNativeAnnotationIdentity
          ? {
            pdfNativeAnnotationIdentity: annotation.pdfNativeAnnotationIdentity
              || annotation.data.pdfNativeAnnotationIdentity,
          }
          : {}),
      });
    }
  }

  return {
    deletedPdfAnnotations,
    presentPdfAnnotationKeys: [...presentPdfAnnotationKeys],
  };
}

const textMarkupRangeFingerprint = (annotation) => {
  if (!isTextMarkupAnnotation(annotation)) return null;
  const quads = Array.isArray(annotation.data.quads)
    ? annotation.data.quads.map((quad) => [
      quad.x1, quad.y1, quad.x2, quad.y2,
      quad.x3, quad.y3, quad.x4, quad.y4,
    ].map((value) => Number(Number(value).toFixed(4))))
    : [];
  return JSON.stringify({
    pageNumber: Number(annotation.data.pageNumber),
    markupType: String(annotation.data.markupType || annotation.exportType || '').toLowerCase(),
    textRange: annotation.data.textRange || null,
    quads,
    color: String(annotation.stroke || annotation.fill || annotation.data.color || '').toLowerCase(),
    opacity: Number(Number(annotation.opacity ?? 1).toFixed(4)),
    overlapMode: annotation.data.overlapMode === 'uniform' ? 'uniform' : 'layered',
    linkUrl: String(annotation.data.linkUrl || ''),
    linkPageNumber: Math.trunc(Number(annotation.data.linkPageNumber)) || null,
  });
};

const textMarkupRangeIdentityFingerprint = (annotation) => {
  if (!isTextMarkupAnnotation(annotation)) return null;
  const quads = Array.isArray(annotation.data.quads)
    ? annotation.data.quads.map((quad) => [
      quad.x1, quad.y1, quad.x2, quad.y2,
      quad.x3, quad.y3, quad.x4, quad.y4,
    ].map((value) => Number(Number(value).toFixed(4))))
    : [];
  return JSON.stringify({
    pageNumber: Number(annotation.data.pageNumber),
    textRange: annotation.data.textRange || null,
    textRangeModel: annotation.data.textRangeModel || null,
    quads,
  });
};

export const isExactTextMarkupDuplicate = (existing, candidate) => {
  const candidateFingerprint = textMarkupRangeFingerprint(candidate);
  return candidateFingerprint != null
    && candidateFingerprint === textMarkupRangeFingerprint(existing);
};

export const isTextMarkupAnnotation = (annotation) => (
  annotation?.data?.type === 'text-markup'
  && typeof annotation?.data?.selectionGroupId === 'string'
  && annotation.data.selectionGroupId.length > 0
);

export function preserveTextMarkupRangeResizeSiblings({
  previousPage,
  nextPage,
  activeAnnotationId,
  activeAnnotationIndex,
}) {
  const previousObjects = pageObjects(previousPage);
  const nextObjects = pageObjects(nextPage);
  if (previousObjects.length !== nextObjects.length) return nextPage;

  const requestedId = activeAnnotationId == null ? '' : String(activeAnnotationId);
  const idIndex = requestedId
    ? nextObjects.findIndex((annotation) => String(annotation?.data?.id || annotation?.id || '') === requestedId)
    : -1;
  const fallbackIndex = Number.isInteger(activeAnnotationIndex) ? activeAnnotationIndex : -1;
  const resolvedIndex = idIndex >= 0 ? idIndex : fallbackIndex;
  if (resolvedIndex < 0 || resolvedIndex >= nextObjects.length) return nextPage;

  const nextActive = nextObjects[resolvedIndex];
  if (!isTextMarkupAnnotation(nextActive)) return nextPage;

  return {
    ...nextPage,
    objects: nextObjects.map((annotation, index) => (
      index === resolvedIndex ? annotation : previousObjects[index]
    )),
  };
}

const pageAt = (annotationsByPage, pageNumber) => (
  annotationsByPage?.[pageNumber]
  || annotationsByPage?.[String(pageNumber)]
  || { objects: [] }
);

const changedPageNumbers = (previousByPage, nextByPage) => {
  const keys = new Set([
    ...Object.keys(previousByPage || {}),
    ...Object.keys(nextByPage || {}),
  ]);
  return [...keys]
    .map(Number)
    .filter(Number.isFinite)
    .filter((pageNumber) => (
      JSON.stringify(pageAt(previousByPage, pageNumber))
      !== JSON.stringify(pageAt(nextByPage, pageNumber))
    ))
    .sort((a, b) => a - b);
};

export function buildTextMarkupDocumentAction(previousByPage, nextByPage) {
  const actions = changedPageNumbers(previousByPage, nextByPage)
    .map((pageNumber) => buildAnnotationHistoryAction({
      pageNumber,
      previousPage: pageAt(previousByPage, pageNumber),
      nextPage: pageAt(nextByPage, pageNumber),
    }))
    .filter(Boolean);
  if (actions.length === 0) return null;
  return actions.length === 1 ? actions[0] : { type: 'fabric:document-batch', actions };
}

export function buildTextMarkupGroupCreateTransaction(annotationsByPage, annotations) {
  const previousByPage = annotationsByPage || {};
  const nextByPage = { ...previousByPage };
  const created = [];
  for (const annotation of annotations || []) {
    if (!isTextMarkupAnnotation(annotation)) continue;
    const pageNumber = Number(annotation.data.pageNumber);
    if (!Number.isFinite(pageNumber)) continue;
    const current = pageAt(nextByPage, pageNumber);
    const objects = pageObjects(current);
    if (objects.some((existing) => isExactTextMarkupDuplicate(existing, annotation))) continue;
    nextByPage[String(pageNumber)] = {
      ...current,
      objects: [...objects, annotation],
    };
    created.push({ pageNumber, annotation, annotationIndex: objects.length });
  }
  const action = buildTextMarkupDocumentAction(previousByPage, nextByPage);
  return action ? { action, nextByPage, created } : null;
}

export function buildTextMarkupPaintEditTransaction({
  annotationsByPage,
  annotation,
  color,
  opacity,
}) {
  if (!isTextMarkupAnnotation(annotation)) return null;
  const selectionGroupId = annotation.data.selectionGroupId;
  const normalizedOpacity = Math.max(0, Math.min(1, Number(opacity) || 0));
  const previousByPage = annotationsByPage || {};
  const nextByPage = { ...previousByPage };
  const updated = [];

  for (const [pageKey, page] of Object.entries(previousByPage)) {
    const objects = pageObjects(page);
    let changed = false;
    const nextObjects = objects.map((candidate, annotationIndex) => {
      if (!isTextMarkupAnnotation(candidate)
        || candidate.data.selectionGroupId !== selectionGroupId) return candidate;
      changed = true;
      const next = {
        ...candidate,
        fill: color,
        stroke: color,
        opacity: normalizedOpacity,
      };
      updated.push({ pageNumber: Number(pageKey), annotationIndex, annotation: next });
      return next;
    });
    if (changed) nextByPage[pageKey] = { ...page, objects: nextObjects };
  }

  const action = buildTextMarkupDocumentAction(previousByPage, nextByPage);
  return action ? {
    action,
    nextByPage,
    updated,
    selectionGroupIds: [selectionGroupId],
  } : null;
}

export function buildRequestedRedactionSnapshot(annotationsByPage, createdEntries) {
  const requestedAnnotations = new Set(
    (createdEntries || [])
      .map((entry) => entry?.annotation)
      .filter(Boolean),
  );
  const requestedIds = new Set(
    [...requestedAnnotations]
      .map((annotation) => annotation?.data?.id || annotation?.id)
      .filter(Boolean)
      .map(String),
  );

  return Object.fromEntries(Object.entries(annotationsByPage || {}).map(([pageKey, page]) => {
    const objects = pageObjects(page);
    const filtered = objects.filter((annotation) => {
      const isRedaction = isTextMarkupAnnotation(annotation)
        && String(annotation.data.markupType || '').toLowerCase() === 'redact';
      if (!isRedaction) return true;
      if (requestedAnnotations.has(annotation)) return true;
      const annotationId = annotation?.data?.id || annotation?.id;
      return annotationId != null && requestedIds.has(String(annotationId));
    });
    return [pageKey, filtered.length === objects.length ? page : { ...page, objects: filtered }];
  }));
}

const matchingRangeFingerprints = (sourceAnnotations) => new Set(
  (sourceAnnotations || [])
    .map(textMarkupRangeIdentityFingerprint)
    .filter(Boolean),
);

export function getTextMarkupRangeAnnotations(annotationsByPage, sourceAnnotations) {
  const fingerprints = matchingRangeFingerprints(sourceAnnotations);
  if (fingerprints.size === 0) return [];
  return Object.entries(annotationsByPage || {}).flatMap(([pageNumber, page]) => (
    pageObjects(page)
      .map((annotation, annotationIndex) => ({ pageNumber: Number(pageNumber), annotationIndex, annotation }))
      .filter(({ annotation }) => fingerprints.has(textMarkupRangeIdentityFingerprint(annotation)))
  ));
}

export function getTextMarkupRangeTypes(annotationsByPage, sourceAnnotations) {
  const fingerprints = matchingRangeFingerprints(sourceAnnotations);
  if (fingerprints.size === 0) return [];
  const types = new Set();
  for (const page of Object.values(annotationsByPage || {})) {
    for (const annotation of pageObjects(page)) {
      if (!fingerprints.has(textMarkupRangeIdentityFingerprint(annotation))) continue;
      const type = String(annotation.data.markupType || annotation.exportType || '').toLowerCase();
      if (type) types.add(type);
    }
  }
  const order = ['highlight', 'underline', 'squiggly', 'strikeout', 'link', 'redact'];
  return order.filter((type) => types.has(type));
}

export function resolveTextLinkEditorPrefill(selection, selectedMarkup = null) {
  const selectedLink = selection?.sourceMarks?.find(
    (mark) => mark?.data?.markupType === 'link',
  ) || (selectedMarkup?.data?.markupType === 'link' ? selectedMarkup : null);
  const mode = selectedLink?.data?.linkPageNumber ? 'page' : 'web';
  return {
    mode,
    value: mode === 'page'
      ? String(selectedLink?.data?.linkPageNumber || 1)
      : String(selectedLink?.data?.linkUrl || ''),
  };
}

export function buildTextMarkupRangeToggleOffTransaction(
  annotationsByPage,
  sourceAnnotations,
  markupType,
) {
  const previousByPage = annotationsByPage || {};
  const fingerprints = matchingRangeFingerprints(sourceAnnotations);
  if (fingerprints.size === 0) return null;
  const normalizedType = String(markupType || '').toLowerCase();
  const removedSelectionGroupIds = new Set();
  for (const page of Object.values(previousByPage)) {
    for (const annotation of pageObjects(page)) {
      if (!fingerprints.has(textMarkupRangeIdentityFingerprint(annotation))) continue;
      const type = String(annotation.data.markupType || annotation.exportType || '').toLowerCase();
      if (type === normalizedType) removedSelectionGroupIds.add(annotation.data.selectionGroupId);
    }
  }
  if (removedSelectionGroupIds.size === 0) return null;

  const nextByPage = { ...previousByPage };
  const remaining = [];
  for (const [pageKey, page] of Object.entries(previousByPage)) {
    const objects = pageObjects(page);
    const filtered = objects.filter((annotation) => (
      !isTextMarkupAnnotation(annotation)
      || !removedSelectionGroupIds.has(annotation.data.selectionGroupId)
    ));
    if (filtered.length !== objects.length) nextByPage[String(pageKey)] = { ...page, objects: filtered };
    filtered.forEach((annotation, annotationIndex) => {
      if (fingerprints.has(textMarkupRangeIdentityFingerprint(annotation))) {
        remaining.push({ pageNumber: Number(pageKey), annotationIndex, annotation });
      }
    });
  }
  const action = buildTextMarkupDocumentAction(previousByPage, nextByPage);
  return action ? {
    action,
    nextByPage,
    remaining,
    removedSelectionGroupIds: [...removedSelectionGroupIds],
    selectionGroupIds: [...removedSelectionGroupIds],
  } : null;
}

export function buildAtomicTextMarkupPageMutation({
  annotationsByPage,
  pageNumber,
  nextPage,
}) {
  const previousByPage = annotationsByPage || {};
  const previousPage = pageAt(previousByPage, pageNumber);
  const nextIds = new Set(pageObjects(nextPage).map((annotation) => annotation?.data?.id).filter(Boolean));
  const deletedGroupIds = new Set(
    pageObjects(previousPage)
      .filter(isTextMarkupAnnotation)
      .filter((annotation) => !nextIds.has(annotation.data.id))
      .map((annotation) => annotation.data.selectionGroupId),
  );
  if (deletedGroupIds.size === 0) return null;

  const nextByPage = { ...previousByPage, [String(pageNumber)]: nextPage };
  for (const key of Object.keys(previousByPage)) {
    if (Number(key) === Number(pageNumber)) continue;
    const current = pageAt(previousByPage, key);
    const objects = pageObjects(current);
    const filtered = objects.filter((annotation) => (
      !isTextMarkupAnnotation(annotation)
      || !deletedGroupIds.has(annotation.data.selectionGroupId)
    ));
    if (filtered.length !== objects.length) {
      nextByPage[String(key)] = { ...current, objects: filtered };
    }
  }
  const action = buildTextMarkupDocumentAction(previousByPage, nextByPage);
  const pdfAnnotationMutationState = getPdfAnnotationMutationState(previousByPage, nextByPage);
  return action ? {
    action,
    nextByPage,
    selectionGroupIds: [...deletedGroupIds],
    ...pdfAnnotationMutationState,
  } : null;
}

export function expandTextMarkupEraseIntent(intent, annotationsByPage) {
  if (!intent?.mutationId || !Array.isArray(intent.targets)) return intent;
  const deletedGroupIds = new Set(
    intent.targets
      .filter((target) => target?.operation === 'delete')
      .map((target) => target.before)
      .filter(isTextMarkupAnnotation)
      .map((annotation) => annotation.data.selectionGroupId),
  );
  if (deletedGroupIds.size === 0) return intent;

  const existingKeys = new Set(intent.targets.map((target) => String(target.storageKey)));
  const targets = [...intent.targets];
  for (const [pageKey, page] of Object.entries(annotationsByPage || {})) {
    pageObjects(page).forEach((annotation, index) => {
      if (
        !isTextMarkupAnnotation(annotation)
        || !deletedGroupIds.has(annotation.data.selectionGroupId)
      ) return;
      const storageKey = String(annotation.data.id || '');
      if (!storageKey || existingKeys.has(storageKey)) return;
      existingKeys.add(storageKey);
      targets.push({
        domain: 'page-object',
        kind: 'text-markup',
        operation: 'delete',
        pageNumber: Number(pageKey),
        index,
        storageKey,
        before: annotation,
      });
    });
  }
  return {
    ...intent,
    targets,
    sideEffects: (intent.sideEffects || []).filter(
      (effect) => effect?.type !== 'annotation-delete-history',
    ),
    diagnostics: {
      ...(intent.diagnostics || {}),
      textMarkupSelectionGroupIds: [...deletedGroupIds],
    },
  };
}
