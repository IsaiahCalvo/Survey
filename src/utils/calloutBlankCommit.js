/**
 * calloutBlankCommit.js — rules for committing callout text and handling blanks.
 *
 * Exports normalizeCalloutText / isBlankCalloutText, shouldDeleteBlankCalloutOnCommit
 * (a brand-new callout left blank should be deleted on commit), and
 * resolveCommittedCalloutText (preserves prior text when an existing callout is
 * blanked or untouched). Used by the callout edit/commit flow.
 * Part of the separate callout pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
export function normalizeCalloutText(value) {
  return typeof value === 'string' ? value : '';
}

export function isBlankCalloutText(value) {
  return normalizeCalloutText(value).trim().length === 0;
}

export function shouldDeleteBlankCalloutOnCommit({ isNewCallout, committedText }) {
  return isNewCallout === true && isBlankCalloutText(committedText);
}

export function resolveCommittedCalloutText({
  isNewCallout,
  editedText,
  synthesizedText,
  originalText,
}) {
  const committedText = normalizeCalloutText(synthesizedText);
  const priorText = normalizeCalloutText(originalText);
  if (isNewCallout === true) return committedText;
  if (isBlankCalloutText(committedText) && !isBlankCalloutText(priorText)) {
    return priorText;
  }
  if (editedText == null && !isBlankCalloutText(priorText)) {
    return priorText;
  }
  return committedText;
}
