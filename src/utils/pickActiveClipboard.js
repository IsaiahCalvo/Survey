/**
 * pickActiveClipboard — one logical clipboard for shapes + callouts.
 *
 * Copy/Cut is supposed to clear the other lane, but Paste used to prefer
 * `clipboardAnnotation` whenever it was populated. After a callout copy that
 * failed to clear (or never wrote) the shape lane, context-menu Paste cloned
 * the last rect/ellipse/pen/text instead of the callout.
 *
 * Recency wins: `lastKind` from the most recent Copy/Cut, then `copiedAt`
 * timestamps if both lanes are still populated. When both lanes exist and
 * there is no recency signal, prefer the callout — a leftover shape must
 * not beat a just-copied callout.
 *
 * @returns {'annotation' | 'callout' | null}
 */
export function pickActiveClipboard({
  clipboardAnnotation = null,
  clipboardCallout = null,
  lastKind = null,
} = {}) {
  const hasAnnotation = clipboardAnnotation != null;
  const hasCallout = clipboardCallout != null;
  if (!hasAnnotation && !hasCallout) return null;
  if (hasAnnotation && !hasCallout) return 'annotation';
  if (!hasAnnotation && hasCallout) return 'callout';
  if (lastKind === 'annotation' || lastKind === 'callout') return lastKind;

  const annotationAt = Number(clipboardAnnotation?.copiedAt);
  const calloutAt = Number(clipboardCallout?.copiedAt);
  const annotationOk = Number.isFinite(annotationAt);
  const calloutOk = Number.isFinite(calloutAt);
  if (annotationOk && calloutOk) {
    return calloutAt > annotationAt ? 'callout' : 'annotation';
  }
  if (calloutOk) return 'callout';
  if (annotationOk) return 'annotation';
  return 'callout';
}

/**
 * Live callout selection lives on `selectedCalloutIds` (the SVG path).
 * `selectedCalloutId` is the legacy PAL single-id cell and is often null
 * after a click. Keyboard Copy/Cut must read the live set or a callout
 * copy silently no-ops and Paste keeps the last shape.
 */
export function resolveSelectedCalloutId(selectedCalloutId, selectedCalloutIds) {
  if (selectedCalloutId) return selectedCalloutId;
  if (selectedCalloutIds instanceof Set && selectedCalloutIds.size > 0) {
    return Array.from(selectedCalloutIds)[selectedCalloutIds.size - 1];
  }
  if (Array.isArray(selectedCalloutIds) && selectedCalloutIds.length > 0) {
    return selectedCalloutIds[selectedCalloutIds.length - 1];
  }
  return null;
}
