/**
 * usePickedSurveyMarker — the one Survey Marker picked on its own, if any.
 *
 * Owner 2026-10-22: picking a Survey Marker (Select or Pan) brings up the
 * survey bar, as picking a counter brings up the counter's bar. The page
 * layers already announce each page's pick on the window
 * (historyMarkFilter HISTORY_PAGE_SELECTION_EVENT); this listens to that, so
 * the viewer needs no new wiring into every page layer.
 *
 * Returns { pageNumber, annotationId } while exactly one marker and nothing
 * else is picked, else null.
 */
import { useEffect, useState } from 'react';
import { HISTORY_PAGE_SELECTION_EVENT } from '../utils/historyMarkFilter.js';

export function nextPickedSurveyMarker(current, detail) {
  const pageNumber = Number(detail?.pageNumber);
  if (!Number.isFinite(pageNumber)) return current;
  const items = Array.isArray(detail?.items) ? detail.items : [];
  if (items.length === 1 && items[0]?.typeKey === 'surveyMarker' && items[0]?.id) {
    const annotationId = String(items[0].id);
    if (current && current.pageNumber === pageNumber && current.annotationId === annotationId) return current;
    return { pageNumber, annotationId };
  }
  // Something else picked on another page replaces the marker pick there.
  if (items.length > 0) return null;
  return current && current.pageNumber === pageNumber ? null : current;
}

export function usePickedSurveyMarker() {
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSelection = (event) => setPicked((current) => nextPickedSurveyMarker(current, event?.detail));
    window.addEventListener(HISTORY_PAGE_SELECTION_EVENT, onSelection);
    return () => window.removeEventListener(HISTORY_PAGE_SELECTION_EVENT, onSelection);
  }, []);
  return picked;
}
