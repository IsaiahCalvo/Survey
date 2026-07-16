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

export function usePdfjsFormFieldPersistence({ handleSaveAnnotations, userId, annotationsByPageRef }) {
  const formFieldSaveTimersRef = useRef(new Map());

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

  const handlePdfjsFormFieldChange = useCallback((pageNumber, payload) => {
    const fieldId = payload?.fieldId;
    if (pageNumber == null || fieldId == null) return;
    const key = `${pageNumber}:${fieldId}`;
    const timers = formFieldSaveTimersRef.current;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(key);
      commitPdfjsFormField(pageNumber, payload);
    }, 400);
    timers.set(key, timer);
  }, [commitPdfjsFormField]);

  const handlePdfjsFormFieldBlur = useCallback((pageNumber, payload) => {
    const fieldId = payload?.fieldId;
    if (pageNumber == null || fieldId == null) return;
    const key = `${pageNumber}:${fieldId}`;
    const timers = formFieldSaveTimersRef.current;
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
      timers.delete(key);
    }
    commitPdfjsFormField(pageNumber, payload);
  }, [commitPdfjsFormField]);

  useEffect(() => {
    const timers = formFieldSaveTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { handlePdfjsFormFieldChange, handlePdfjsFormFieldBlur };
}
