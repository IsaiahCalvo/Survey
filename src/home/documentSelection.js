// Desktop Documents list selection, copied from Drawboard's file list (shell
// audit 2026-10-13, scratchpad drawboardDeep/SHELL.md §2):
//   - a plain click selects that one document (and previews it);
//   - Shift-click selects the range from the last plain/Ctrl click (the
//     anchor) to the clicked row, replacing the selection;
//   - Ctrl-click (Cmd-click on a Mac) adds or removes one row.
// Pure helpers so the rules are unit-tested without a browser
// (tests/documentSelection.test.mjs).

/** Which selection rule a click asks for. */
export function selectionModeFromEvent(event) {
  if (!event) return 'single';
  if (event.shiftKey) return 'range';
  if (event.metaKey || event.ctrlKey) return 'toggle';
  return 'single';
}

/**
 * The selection after a click on `id`.
 * @param {object} input
 * @param {string[]} input.order    ids in the order the list shows them
 * @param {Set|string[]} input.selected  the current selection
 * @param {string|null} input.anchor     the row a range starts from
 * @param {string} input.id         the clicked row
 * @param {'single'|'toggle'|'range'} input.mode
 * @returns {{ selected: Set<string>, anchor: string|null }}
 */
export function nextDocumentSelection({ order = [], selected = [], anchor = null, id, mode = 'single' }) {
  const current = new Set(selected);
  if (id == null) return { selected: current, anchor };
  if (mode === 'toggle') {
    if (current.has(id)) current.delete(id);
    else current.add(id);
    return { selected: current, anchor: id };
  }
  if (mode === 'range') {
    const from = anchor == null ? -1 : order.indexOf(anchor);
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return { selected: new Set([id]), anchor: id };
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return { selected: new Set(order.slice(lo, hi + 1)), anchor };
  }
  return { selected: new Set([id]), anchor: id };
}

/** Drops ids no longer shown (archived, moved out of view, filtered away). */
export function pruneSelection(selected, visibleIds) {
  const visible = new Set(visibleIds);
  const next = new Set();
  let changed = false;
  for (const id of selected) {
    if (visible.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}

/** The header box: 'true' (all), 'mixed' (some) or 'false' (none). */
export function selectAllCheckState(selectedCount, total) {
  if (!total || !selectedCount) return 'false';
  return selectedCount >= total ? 'true' : 'mixed';
}

/**
 * The part of a file name to preselect when renaming: everything before a
 * trailing ".pdf" (any case), like Finder and Drawboard. Returns [start, end].
 */
export function renameSelectionRange(name) {
  const value = String(name || '');
  const match = /\.pdf$/i.exec(value);
  const end = match && match.index > 0 ? match.index : value.length;
  return [0, end];
}

/** Drag payload type for documents dragged inside the app (never 'Files'). */
export const DOCUMENT_DRAG_TYPE = 'application/x-survey-document-ids';

/** Reads the dragged document ids back (empty when it is not ours). */
export function readDocumentDragIds(dataTransfer) {
  if (!dataTransfer) return [];
  try {
    const raw = dataTransfer.getData(DOCUMENT_DRAG_TYPE);
    const ids = JSON.parse(raw || '[]');
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

/** True while a drag carries our documents (types are readable during dragover). */
export function isDocumentDrag(dataTransfer) {
  const types = dataTransfer?.types;
  if (!types) return false;
  if (typeof types.includes === 'function') return types.includes(DOCUMENT_DRAG_TYPE);
  if (typeof types.contains === 'function') return types.contains(DOCUMENT_DRAG_TYPE);
  return Array.from(types).includes(DOCUMENT_DRAG_TYPE);
}

/**
 * Toast words after documents were dropped on a project: "Moved 2 documents
 * to Roof Survey" (Drawboard says `Moved 2 documents into "X"`).
 */
export function movedToProjectMessage(count, projectName) {
  const n = Number(count) || 0;
  const name = String(projectName || '').trim() || 'the project';
  if (n <= 0) return null;
  return n === 1 ? `Moved 1 document to ${name}` : `Moved ${n} documents to ${name}`;
}

/** Undo toast words after documents moved to Archive. */
export function archivedMessage(count) {
  const n = Number(count) || 0;
  return n === 1 ? 'Moved to Archive' : `Moved ${n} documents to Archive`;
}
