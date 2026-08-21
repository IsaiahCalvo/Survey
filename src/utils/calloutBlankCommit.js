/**
 * calloutBlankCommit.js — rules for committing callout text and handling blanks.
 *
 * Exports normalizeCalloutText / isBlankCalloutText, shouldDeleteBlankCalloutOnCommit
 * (a brand-new callout left blank should be deleted on commit), and
 * resolveCommittedCalloutText (preserves prior text when an existing callout is
 * blanked or untouched). Used by the callout edit/commit flow.
 * Part of the separate callout pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
function normalizeCalloutText(value) {
  return typeof value === 'string' ? value : '';
}

const calloutEditDraftById = new Map();

export function setCalloutEditDraft(calloutId, text) {
  if (!calloutId) return;
  calloutEditDraftById.set(String(calloutId), normalizeCalloutText(text));
}

export function peekCalloutEditDraft(calloutId) {
  if (!calloutId) return '';
  return calloutEditDraftById.get(String(calloutId)) || '';
}

export function clearCalloutEditDraft(calloutId) {
  if (!calloutId) return;
  calloutEditDraftById.delete(String(calloutId));
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
  calloutId = null,
}) {
  const committedText = normalizeCalloutText(synthesizedText);
  const priorText = normalizeCalloutText(originalText);
  const typedText = normalizeCalloutText(editedText);
  const draftText = peekCalloutEditDraft(calloutId);
  // New-callout create: typed overlay text is source of truth.
  // fromFabricGroup can synthesize an empty textbox even after the user
  // typed — prefer editedText / live draft so chrome commit does not
  // blank-delete a just-created callout (E2E-ADV-01).
  if (isNewCallout === true) {
    if (!isBlankCalloutText(typedText)) return typedText;
    if (!isBlankCalloutText(draftText)) return draftText;
    return committedText;
  }
  if (isBlankCalloutText(committedText) && !isBlankCalloutText(priorText)) {
    return priorText;
  }
  if (editedText == null && !isBlankCalloutText(priorText)) {
    return priorText;
  }
  return committedText;
}
