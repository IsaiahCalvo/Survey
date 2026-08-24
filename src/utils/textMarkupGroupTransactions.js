import { buildAnnotationHistoryAction } from './annotationLocalHistory.js';

const pageObjects = (page) => (Array.isArray(page?.objects) ? page.objects : []);

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
  return action ? {
    action,
    nextByPage,
    selectionGroupIds: [...deletedGroupIds],
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
