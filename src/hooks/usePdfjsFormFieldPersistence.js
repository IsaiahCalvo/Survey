import { useCallback, useRef, useEffect } from 'react';
import { deepClone } from '../utils/deepClone.js';

// pdf.js form-field value persistence, lifted verbatim out of PDFViewer.jsx
// (de-fragilize campaign). Form fields aren't visual annotations — each edit is
// stored as a non-visual `form-field` carrier annotation keyed by page+fieldId so
// re-edits upsert the same row. Typing debounces (400ms) into a single save; blur
// flushes immediately; pending timers are cancelled on viewer unmount.

// Pure: build the form-field carrier annotation object from a change payload.
// authorId is write-once — an existing author is preserved over the current user,
// mirroring the serializer's author-attribution invariant. rect is [x1,y1,x2,y2];
// bounds are derived with min/abs so a reversed rect still yields positive w/h.
export function buildFormFieldObject(pageNumber, payload, existingAuthorId, userId) {
  const fieldId = payload?.fieldId;
  const rect = Array.isArray(payload.rect) ? payload.rect : null;
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
      fieldName: payload.fieldName ?? null,
      fieldType: payload.fieldType ?? null,
      value: payload.value,
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
    const idx = next.objects.findIndex((o) => o?.data?.id === dataId);
    // Preserve the original author on re-edits (write-once-on-create).
    const existingAuthorId = idx >= 0 ? next.objects[idx]?.meta?.authorId : null;
    const formObj = buildFormFieldObject(pageNumber, payload, existingAuthorId, userId);
    if (idx >= 0) next.objects[idx] = formObj;
    else next.objects.push(formObj);
    handleSaveAnnotations(pageNumber, next, {
      source: 'form-field',
      action: 'form-field:edit',
      checkpointPolicy: 'normal',
    });
  }, [handleSaveAnnotations, userId, annotationsByPageRef]);

  const handlePdfjsFormFieldChange = useCallback((pageNumber, payload) => {
    const fieldId = payload?.fieldId;
    if (pageNumber == null || fieldId == null) return;
    const key = `${pageNumber}:${fieldId}`;
    const timers = formFieldSaveTimersRef.current;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    // Debounce typing so a name entered character-by-character lands as one save.
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
    if (existing) { clearTimeout(existing); timers.delete(key); }
    // Flush immediately when leaving the field so nothing is lost on a quick reload.
    commitPdfjsFormField(pageNumber, payload);
  }, [commitPdfjsFormField]);

  // Cancel any pending form-field debounce timers when the viewer itself tears
  // down (document close / unmount), so a late save never fires into a disposed
  // component. NOTE: this runs only on full unmount — page navigation does NOT
  // clear timers, because an out-of-view page's pending edit must still flush via
  // its own timer (the field's blur may not fire when its DOM node is removed).
  useEffect(() => {
    const timers = formFieldSaveTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { handlePdfjsFormFieldChange, handlePdfjsFormFieldBlur };
}
