// "Edit template" from Survey mode: the viewer asks for the home screen's
// Templates editor with one template open. The request waits here until the
// editor mounts (the home tab may not be showing yet), and an event tells an
// already-open Templates tab or editor to act on it now.
export const TEMPLATE_EDITOR_REQUEST_EVENT = 'survey:open-template-editor';

let pending = null;

/**
 * @param {string|null} templateId the template to open
 * @param {{ create?: boolean }} [options] create: add a new empty template and open it
 */
export function requestTemplateEditor(templateId, { create = false } = {}) {
  pending = { templateId: templateId || null, create: Boolean(create) };
  try {
    globalThis.dispatchEvent?.(new CustomEvent(TEMPLATE_EDITOR_REQUEST_EVENT, { detail: pending }));
  } catch {
    // No DOM events here (tests).
  }
}

export function hasTemplateEditorRequest() {
  return pending !== null;
}

/** The waiting request, once: the editor that takes it opens that template. */
export function takeTemplateEditorRequest() {
  const request = pending;
  pending = null;
  return request;
}
