// Drag-and-drop of PDF files from the computer (owner request 2026-10-13,
// copying Drawboard): drop PDFs on the Documents list to upload them, on a
// project to add them to it, and on an open document to open them as new tabs.
//
// Pure helpers live here so they can be unit-tested without a browser; the
// React side is src/hooks/useFileDropZone.js + src/components/FileDropOverlay.jsx.
import { PHONE_LAYOUT_MAX_WIDTH } from './responsiveToolbar.js';

/**
 * True when a drag carries files from outside the page. Internal drags (page
 * thumbnails, dnd-kit rows, selected text, images inside the app) never list
 * 'Files', so they never show the upload overlay.
 */
export function isFileDrag(dataTransfer) {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (!types) return false;
  // DOMStringList (old engines) has contains(); arrays/frozen arrays have includes().
  if (typeof types.includes === 'function') return types.includes('Files');
  if (typeof types.contains === 'function') return types.contains('Files');
  return Array.from(types).includes('Files');
}

/**
 * The phone layout takes no file drops (the phone stays as it was: an iPhone
 * cannot drag files in, and the phone screens have no room for the overlay).
 * Read at event time so a desktop window narrowed to phone width agrees with
 * what is on screen.
 */
export function isPhoneLayout(win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.matchMedia !== 'function') return false;
  return win.matchMedia(`(max-width: ${PHONE_LAYOUT_MAX_WIDTH}px)`).matches;
}

/** A PDF by type, or by name when the OS gave no type (some Windows drops). */
export function isPdfFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type === 'application/pdf') return true;
  if (type && type !== 'application/octet-stream') return false;
  return /\.pdf$/i.test(String(file.name || ''));
}

/** Splits dropped files into the PDFs to upload and everything else. */
export function splitDroppedFiles(files) {
  const pdfs = [];
  const rejected = [];
  for (const file of Array.from(files || [])) {
    if (isPdfFile(file)) pdfs.push(file);
    else rejected.push(file);
  }
  return { pdfs, rejected };
}

/**
 * The one upload path checks `file.type === 'application/pdf'` and storage
 * takes its content type from the File, so a PDF that arrived without a type
 * is re-wrapped (same bytes, same name) with the right one.
 */
export function asPdfFile(file) {
  if (!file || file.type === 'application/pdf') return file;
  if (typeof File !== 'function') return file;
  return new File([file], file.name, { type: 'application/pdf', lastModified: file.lastModified });
}

/** Short, friendly words for files that are not PDFs (null when none). */
export function rejectedFilesMessage(rejected = []) {
  const count = rejected.length;
  if (!count) return null;
  if (count === 1) {
    const name = String(rejected[0]?.name || '').trim();
    return name
      ? `Only PDFs can be added. “${name}” was skipped.`
      : 'Only PDFs can be added. That file was skipped.';
  }
  return `Only PDFs can be added. ${count} files were skipped.`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Success words after PDFs were added to a project. */
export function addedToProjectMessage(count, projectName) {
  if (!count) return null;
  const what = plural(count, 'PDF', 'PDFs');
  return projectName ? `Added ${what} to ${projectName}` : `Added ${what}`;
}

/**
 * Drag depth counter. dragenter/dragleave fire for every child the pointer
 * crosses, so the overlay is on while depth > 0 (no flicker over children).
 */
export function nextDragDepth(depth, eventType) {
  const current = Number.isFinite(depth) && depth > 0 ? depth : 0;
  if (eventType === 'dragenter') return current + 1;
  if (eventType === 'dragleave') return Math.max(0, current - 1);
  if (eventType === 'drop' || eventType === 'dragend' || eventType === 'reset') return 0;
  return current;
}

/** A project id the upload path can save into (a `local-` id is not saved yet). */
export function isUploadableProjectId(projectId) {
  return typeof projectId === 'string' && projectId.length > 0 && !projectId.startsWith('local-');
}

/**
 * What a drop over the Projects tab means. `rowProjectId` is the project row
 * under the pointer (data-project-id), `openProject` the project shown on the
 * right. A row wins; otherwise the open project; otherwise nothing. A project
 * that is not saved yet (a `local-` id) cannot take files.
 */
export function resolveProjectDropTarget({ rowProjectId = null, openProject = null, projects = [] } = {}) {
  if (rowProjectId != null) {
    const project = projects.find((p) => String(p?.id) === String(rowProjectId));
    if (project && isUploadableProjectId(project.id)) {
      return { key: `project:${project.id}`, kind: 'project-row', projectId: project.id, projectName: project.name || 'Untitled project' };
    }
  }
  if (openProject && isUploadableProjectId(openProject.id)) {
    return { key: `open:${openProject.id}`, kind: 'project-open', projectId: openProject.id, projectName: openProject.name || 'Untitled project' };
  }
  return null;
}

/** The overlay's words for a drop target. */
export function dropOverlayCopy(target) {
  if (!target) {
    return { label: 'Create a project first', hint: 'Then drop PDFs on it to add them', accept: false };
  }
  switch (target.kind) {
    case 'documents':
      return { label: 'Drop PDFs to upload', hint: 'They’ll be added to Documents', accept: true };
    case 'project-row':
    case 'project-open':
      return { label: `Drop to add to ${target.projectName}`, hint: 'PDFs only', accept: true };
    case 'viewer':
      return { label: 'Drop PDFs to open', hint: 'Each one opens in a new tab', accept: true };
    default:
      return { label: 'Drop PDFs to upload', hint: '', accept: true };
  }
}

let strayGuardInstalled = false;

/**
 * A file dropped anywhere the app does not handle it must not make the
 * browser (or the Electron window) navigate away to that file. Drop zones
 * call preventDefault themselves first; this listener runs last (window,
 * bubble) and only refuses drags nobody claimed. Idempotent.
 */
export function installStrayFileDropGuard(target = typeof window !== 'undefined' ? window : null) {
  if (!target || strayGuardInstalled) return () => {};
  strayGuardInstalled = true;
  const onDragOver = (event) => {
    if (!isFileDrag(event.dataTransfer)) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = 'none'; } catch { /* read-only in some engines */ }
  };
  const onDrop = (event) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
  };
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
    strayGuardInstalled = false;
  };
}
