export function getAnnotationHistoryId(annotation) {
  return annotation?.data?.id
    || annotation?.data?.annoId
    || annotation?.id
    || annotation?.annotationId
    || annotation?.pdfAnnotationId
    || null;
}

export function getAnnotationHistoryAuthorId(annotation) {
  return annotation?.meta?.authorId
    || annotation?.__meta?.authorId
    || annotation?.authorId
    || annotation?.data?.authorId
    || annotation?.data?.userId
    || null;
}

function isOwnAnnotation(annotation, userId) {
  if (!userId) return true;
  const authorId = getAnnotationHistoryAuthorId(annotation);
  return !authorId || authorId === userId;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getObjects(page) {
  return Array.isArray(page?.objects) ? page.objects : [];
}

function buildIdMap(objects) {
  const map = new Map();
  objects.forEach((obj, index) => {
    const id = getAnnotationHistoryId(obj);
    if (!id) return;
    map.set(id, { obj, index });
  });
  return map;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function cloneEntries(entries) {
  return entries.map((entry) => cloneJson(entry));
}

function normalizeIdList(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  ids.forEach((id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

export function buildPreciseAnnotationHistoryAction({
  pageNumber,
  previousPage,
  nextPage,
  deletedIds = [],
  changedIds = [],
  createdIds = [],
}) {
  const previousObjects = getObjects(previousPage);
  const nextObjects = getObjects(nextPage);
  const previousById = buildIdMap(previousObjects);
  const nextById = buildIdMap(nextObjects);
  const deleteSet = normalizeIdList(deletedIds);
  const changeSet = normalizeIdList(changedIds).filter((id) => !deleteSet.includes(id));
  const createSet = normalizeIdList(createdIds).filter((id) => !deleteSet.includes(id));

  const created = createSet
    .map((id) => {
      const entry = nextById.get(id);
      return entry ? { id, after: entry.obj } : null;
    })
    .filter(Boolean);
  const deleted = deleteSet
    .map((id) => {
      const entry = previousById.get(id);
      return entry ? { id, before: entry.obj } : null;
    })
    .filter(Boolean);
  const updated = changeSet
    .map((id) => {
      const before = previousById.get(id);
      const after = nextById.get(id);
      if (!before || !after || sameJson(before.obj, after.obj)) return null;
      return { id, before: before.obj, after: after.obj };
    })
    .filter(Boolean);

  if (created.length === 0 && deleted.length === 0 && updated.length === 0) {
    return null;
  }

  if (created.length === 1 && deleted.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:create',
      pageNumber,
      annotationId: created[0].id,
      annotation: cloneJson(created[0].after),
      index: nextById.get(created[0].id)?.index ?? null,
    };
  }

  if (deleted.length === 1 && created.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:delete',
      pageNumber,
      annotationId: deleted[0].id,
      annotation: cloneJson(deleted[0].before),
      index: previousById.get(deleted[0].id)?.index ?? null,
    };
  }

  if (updated.length === 1 && created.length === 0 && deleted.length === 0) {
    return {
      type: 'fabric:update',
      pageNumber,
      annotationId: updated[0].id,
      before: cloneJson(updated[0].before),
      after: cloneJson(updated[0].after),
    };
  }

  return {
    type: 'fabric:batch',
    pageNumber,
    created: created.map((entry) => ({
      id: entry.id,
      annotation: cloneJson(entry.after),
      index: nextById.get(entry.id)?.index ?? null,
    })),
    deleted: deleted.map((entry) => ({
      id: entry.id,
      annotation: cloneJson(entry.before),
      index: previousById.get(entry.id)?.index ?? null,
    })),
    updated: updated.map((entry) => ({
      id: entry.id,
      before: cloneJson(entry.before),
      after: cloneJson(entry.after),
    })),
  };
}

export function buildAnnotationHistoryAction({ pageNumber, previousPage, nextPage }) {
  const previousObjects = getObjects(previousPage);
  const nextObjects = getObjects(nextPage);
  const previousById = buildIdMap(previousObjects);
  const nextById = buildIdMap(nextObjects);

  const created = [];
  const deleted = [];
  const updated = [];

  for (const [id, entry] of nextById.entries()) {
    const before = previousById.get(id);
    if (!before) {
      created.push({ id, after: entry.obj });
    } else if (!sameJson(before.obj, entry.obj)) {
      updated.push({ id, before: before.obj, after: entry.obj });
    }
  }

  for (const [id, entry] of previousById.entries()) {
    if (!nextById.has(id)) {
      deleted.push({ id, before: entry.obj });
    }
  }

  if (created.length === 1 && deleted.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:create',
      pageNumber,
      annotationId: created[0].id,
      annotation: cloneJson(created[0].after),
      index: nextById.get(created[0].id)?.index ?? null,
    };
  }

  if (deleted.length === 1 && created.length === 0 && updated.length === 0) {
    return {
      type: 'fabric:delete',
      pageNumber,
      annotationId: deleted[0].id,
      annotation: cloneJson(deleted[0].before),
      index: previousById.get(deleted[0].id)?.index ?? null,
    };
  }

  if (updated.length === 1 && created.length === 0 && deleted.length === 0) {
    return {
      type: 'fabric:update',
      pageNumber,
      annotationId: updated[0].id,
      before: cloneJson(updated[0].before),
      after: cloneJson(updated[0].after),
    };
  }

  const changeCount = created.length + deleted.length + updated.length;
  if (changeCount > 1) {
    return {
      type: 'fabric:batch',
      pageNumber,
      created: created.map((entry) => ({
        id: entry.id,
        annotation: cloneJson(entry.after),
        index: nextById.get(entry.id)?.index ?? null,
      })),
      deleted: deleted.map((entry) => ({
        id: entry.id,
        annotation: cloneJson(entry.before),
        index: previousById.get(entry.id)?.index ?? null,
      })),
      updated: updated.map((entry) => ({
        id: entry.id,
        before: cloneJson(entry.before),
        after: cloneJson(entry.after),
      })),
    };
  }

  return null;
}

export function invertAnnotationHistoryAction(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'fabric:create') {
    return {
      type: 'fabric:delete',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      annotation: cloneJson(action.annotation),
      index: action.index ?? null,
    };
  }
  if (action.type === 'fabric:delete') {
    return {
      type: 'fabric:create',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      annotation: cloneJson(action.annotation),
      index: action.index ?? null,
    };
  }
  if (action.type === 'fabric:update') {
    return {
      type: 'fabric:update',
      pageNumber: action.pageNumber,
      annotationId: action.annotationId,
      before: cloneJson(action.after),
      after: cloneJson(action.before),
    };
  }
  if (action.type === 'fabric:batch') {
    return {
      type: 'fabric:batch',
      pageNumber: action.pageNumber,
      created: cloneEntries(action.deleted || []).map((entry) => ({
        id: entry.id,
        annotation: entry.annotation,
        index: entry.index ?? null,
      })),
      deleted: cloneEntries(action.created || []).map((entry) => ({
        id: entry.id,
        annotation: entry.annotation,
        index: entry.index ?? null,
      })),
      updated: cloneEntries(action.updated || []).map((entry) => ({
        id: entry.id,
        before: entry.after,
        after: entry.before,
      })),
    };
  }
  return null;
}

export function filterAnnotationHistoryActionByOwner(action, userId) {
  if (!action || typeof action !== 'object' || !userId) return action || null;

  if (action.type === 'fabric:create' || action.type === 'fabric:delete') {
    return isOwnAnnotation(action.annotation, userId) ? action : null;
  }

  if (action.type === 'fabric:update') {
    return isOwnAnnotation(action.before, userId) && isOwnAnnotation(action.after, userId)
      ? action
      : null;
  }

  if (action.type === 'fabric:batch') {
    const created = (action.created || []).filter((entry) => isOwnAnnotation(entry.annotation, userId));
    const deleted = (action.deleted || []).filter((entry) => isOwnAnnotation(entry.annotation, userId));
    const updated = (action.updated || []).filter((entry) => (
      isOwnAnnotation(entry.before, userId) && isOwnAnnotation(entry.after, userId)
    ));

    if (created.length === 0 && deleted.length === 0 && updated.length === 0) return null;

    return {
      ...action,
      created: cloneEntries(created),
      deleted: cloneEntries(deleted),
      updated: cloneEntries(updated),
    };
  }

  return action;
}

export function applyAnnotationHistoryAction(annotationsByPage, action) {
  if (!action || typeof action !== 'object') return annotationsByPage || {};
  const pageKey = String(action.pageNumber);
  const current = annotationsByPage || {};
  const page = current[pageKey] || current[action.pageNumber] || { objects: [] };
  const objects = getObjects(page);
  const targetId = action.annotationId || getAnnotationHistoryId(action.annotation) || getAnnotationHistoryId(action.after);

  if (action.type !== 'fabric:batch' && !targetId) return current;

  let nextObjects = objects;
  if (action.type === 'fabric:create') {
    const exists = objects.some((obj) => getAnnotationHistoryId(obj) === targetId);
    if (exists) {
      nextObjects = objects.map((obj) => (getAnnotationHistoryId(obj) === targetId ? cloneJson(action.annotation) : obj));
    } else {
      nextObjects = [...objects];
      const index = Number.isInteger(action.index)
        ? Math.max(0, Math.min(action.index, nextObjects.length))
        : nextObjects.length;
      nextObjects.splice(index, 0, cloneJson(action.annotation));
    }
  } else if (action.type === 'fabric:delete') {
    nextObjects = objects.filter((obj) => getAnnotationHistoryId(obj) !== targetId);
  } else if (action.type === 'fabric:update') {
    nextObjects = objects.map((obj) => (getAnnotationHistoryId(obj) === targetId ? cloneJson(action.after) : obj));
  } else if (action.type === 'fabric:batch') {
    const deletedIds = new Set((action.deleted || []).map((entry) => entry.id).filter(Boolean));
    const updatedById = new Map((action.updated || []).map((entry) => [entry.id, entry.after]));
    const createdById = new Map((action.created || []).map((entry) => [entry.id, entry.annotation]));

    nextObjects = objects
      .filter((obj) => !deletedIds.has(getAnnotationHistoryId(obj)))
      .map((obj) => {
        const id = getAnnotationHistoryId(obj);
        return updatedById.has(id) ? cloneJson(updatedById.get(id)) : obj;
      });

    const existingIds = new Set(nextObjects.map(getAnnotationHistoryId).filter(Boolean));
    for (const [id, annotation] of createdById.entries()) {
      if (!id) continue;
      const entry = (action.created || []).find((candidate) => candidate.id === id) || {};
      if (existingIds.has(id)) {
        nextObjects = nextObjects.map((obj) => (
          getAnnotationHistoryId(obj) === id ? cloneJson(annotation) : obj
        ));
      } else {
        const index = Number.isInteger(entry.index)
          ? Math.max(0, Math.min(entry.index, nextObjects.length))
          : nextObjects.length;
        nextObjects = [...nextObjects];
        nextObjects.splice(index, 0, cloneJson(annotation));
        existingIds.add(id);
      }
    }
  }

  return {
    ...current,
    [pageKey]: {
      ...page,
      objects: nextObjects,
    },
  };
}
