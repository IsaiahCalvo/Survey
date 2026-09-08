import { useCallback, useEffect, useRef } from 'react';
import { deepClone } from '../utils/deepClone.js';

export function buildFormFieldObject(pageNumber, payload, existingAuthorId, userId) {
  const fieldId = payload?.fieldId;
  const rect = Array.isArray(payload?.rect) ? payload.rect : null;
  const left = rect ? Math.min(rect[0], rect[2]) : 0;
  const top = rect ? Math.min(rect[1], rect[3]) : 0;
  const width = rect ? Math.abs(rect[2] - rect[0]) : 0;
  const height = rect ? Math.abs(rect[3] - rect[1]) : 0;
  return {
    type: 'form-field',
    data: {
      id: `form-field:${pageNumber}:${fieldId}`,
      type: 'form-field',
      fieldId,
      fieldName: payload?.fieldName ?? null,
      fieldType: payload?.fieldType ?? null,
      value: payload?.value,
      pageNumber,
      rect,
    },
    pageNumber,
    left,
    top,
    width,
    height,
    meta: { authorId: existingAuthorId || userId || null },
  };
}

// documentGeneration is an optional opaque page-structure identity (for example
// the exact PDF File). Flush pending fields before replacing it. Each change,
// including A -> B -> A, retires old callbacks even within the same document.
export function usePdfjsFormFieldPersistence({ handleSaveAnnotations, userId, documentId, documentGeneration, annotationsByPageRef }) {
  const scopeRef = useRef(null);
  const scopeKey = JSON.stringify([documentId || null, userId || null]);
  if (scopeRef.current?.key !== scopeKey
    || !Object.is(scopeRef.current?.generation, documentGeneration)) {
    scopeRef.current = { key: scopeKey, generation: documentGeneration, pending: new Map(), mounted: false };
  }
  const scope = scopeRef.current;
  const isCurrent = () => scopeRef.current === scope && scope.mounted;

  const commitPdfjsFormField = useCallback((pageNumber, payload) => {
    const fieldId = payload?.fieldId;
    if (pageNumber == null || fieldId == null) return;
    const page = annotationsByPageRef.current?.[pageNumber];
    const next = page ? deepClone(page) : { objects: [] };
    if (!Array.isArray(next.objects)) next.objects = [];
    const dataId = `form-field:${pageNumber}:${fieldId}`;
    const index = next.objects.findIndex((object) => object?.data?.id === dataId);
    const existingAuthorId = index >= 0 ? next.objects[index]?.meta?.authorId : null;
    const formObject = buildFormFieldObject(pageNumber, payload, existingAuthorId, userId);
    if (index >= 0) next.objects[index] = formObject;
    else next.objects.push(formObject);
    handleSaveAnnotations(pageNumber, next, {
      source: 'form-field',
      action: 'form-field:edit',
      checkpointPolicy: 'normal',
    });
  }, [annotationsByPageRef, handleSaveAnnotations, userId]);

  const commitPendingField = useCallback((key) => {
    if (!isCurrent()) return false;
    const entry = scope.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    entry.timer = null;
    // Retain a failed commit for an explicit retry. A successful commit updates
    // the viewer's snapshot ref synchronously before the next field is merged.
    commitPdfjsFormField(entry.pageNumber, entry.payload);
    if (scope.pending.get(key) === entry) scope.pending.delete(key);
    return true;
  }, [scope, commitPdfjsFormField]);

  const queueField = useCallback((pageNumber, payload, immediate) => {
    const fieldId = payload?.fieldId;
    if (!isCurrent() || pageNumber == null || fieldId == null) return;
    const key = `${pageNumber}:${fieldId}`;
    clearTimeout(scope.pending.get(key)?.timer);
    const entry = { pageNumber, payload, timer: null };
    scope.pending.set(key, entry);
    if (immediate) commitPendingField(key);
    else entry.timer = setTimeout(() => commitPendingField(key), 400);
  }, [scope, commitPendingField]);

  const handlePdfjsFormFieldChange = useCallback((pageNumber, payload) => {
    queueField(pageNumber, payload, false);
  }, [queueField]);

  const handlePdfjsFormFieldBlur = useCallback((pageNumber, payload) => {
    if (payload?.unchanged === true) {
      // The layer proved this focus/blur did not edit the hydrated value. Do
      // not create a carrier/history entry, but preserve retry of a prior
      // failed commit that is still pending for this exact field and scope.
      if (pageNumber != null && payload.fieldId != null) {
        commitPendingField(`${pageNumber}:${payload.fieldId}`);
      }
      return;
    }
    queueField(pageNumber, payload, true);
  }, [queueField, commitPendingField]);

  const flushPendingFormFields = useCallback(() => {
    if (!isCurrent()) return 0;
    let committed = 0;
    for (const key of [...scope.pending.keys()]) {
      if (commitPendingField(key)) committed++;
    }
    return committed;
  }, [scope, commitPendingField]);

  useEffect(() => {
    scope.mounted = true;
    return () => {
      scope.mounted = false;
      scope.pending.forEach((entry) => clearTimeout(entry.timer));
      scope.pending.clear();
    };
  }, [scope]);

  return { handlePdfjsFormFieldChange, handlePdfjsFormFieldBlur, flushPendingFormFields };
}
