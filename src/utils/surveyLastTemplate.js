// src/utils/surveyLastTemplate.js
//
// Owner 2026-10-07 (survey bar round): the Survey tab (desktop) and the dock's
// Survey button (phone) go straight back into the template you last used on
// THIS document; the template picker only opens the first time, or when that
// template has since been deleted. The memory is per document and lives on
// this device only (localStorage) - no database or schema change. Every
// storage call is wrapped: private mode, blocked site data or a full quota
// just means "nothing remembered", never an error.

export const SURVEY_LAST_TEMPLATE_KEY_PREFIX = 'survey:lastTemplate:';

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Which document the memory belongs to: its id (every saved document has
// one); a local file that was never saved falls back to its path, then its
// name, so it still works on the desktop's local files and the dev route.
export function surveyMemoryDocumentKey(pdfFile, pdfFilePath = null) {
  if (pdfFile?.id !== undefined && pdfFile?.id !== null && pdfFile?.id !== '') return String(pdfFile.id);
  if (typeof pdfFilePath === 'string' && pdfFilePath) return `path:${pdfFilePath}`;
  if (typeof pdfFile?.name === 'string' && pdfFile.name) return `name:${pdfFile.name}`;
  return null;
}

export function surveyLastTemplateKey(documentId) {
  if (documentId === null || documentId === undefined || documentId === '') return null;
  return `${SURVEY_LAST_TEMPLATE_KEY_PREFIX}${documentId}`;
}

export function readLastSurveyTemplateId(documentId, storage = defaultStorage()) {
  const key = surveyLastTemplateKey(documentId);
  if (!key || !storage) return null;
  try {
    const value = storage.getItem(key);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export function rememberLastSurveyTemplate(documentId, templateId, storage = defaultStorage()) {
  const key = surveyLastTemplateKey(documentId);
  if (!key || !storage || templateId === null || templateId === undefined || templateId === '') return false;
  try {
    storage.setItem(key, String(templateId));
    return true;
  } catch {
    return false;
  }
}

export function forgetLastSurveyTemplate(documentId, storage = defaultStorage()) {
  const key = surveyLastTemplateKey(documentId);
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* nothing to forget */
  }
}

// The remembered template for this document, if it still exists in
// `templates`; otherwise null (and a stale id is forgotten, so the picker
// shows and the next pick is remembered fresh).
export function resolveLastSurveyTemplate(documentId, templates, storage = defaultStorage()) {
  const id = readLastSurveyTemplateId(documentId, storage);
  if (!id) return null;
  const list = Array.isArray(templates) ? templates : [];
  const match = list.find((template) => template && String(template.id) === id);
  if (!match) {
    // An empty list is "not loaded yet", not "deleted": keep the memory.
    if (list.length > 0) forgetLastSurveyTemplate(documentId, storage);
    return null;
  }
  return match;
}
