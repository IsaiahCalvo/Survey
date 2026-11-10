// Drawboard's multi-sheet view (Nightly flag 'sheet-set-view'): a project's
// drawings as one set you can step through (bottom-bar arrows, Shift+Left /
// Right), pick from a list, or see side by side as a List or a
// Grid. Pure rules only; SheetSetBar.jsx and SheetSetView.jsx draw them.

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const GRID_COLUMNS = [4, 5, 6, 7, 8];
export const DEFAULT_GRID_COLUMNS = 4;
export const SHEET_VIEWS = ['single', 'list', 'grid'];
// Home's "Open all" asks the viewer for the List view with this event.
export const SHEET_VIEW_EVENT = 'survey:sheet-view';

const projectOf = (doc) => doc?.project_id ?? doc?.projectId ?? null;
const clean = (value) => String(value ?? '').trim();

/** "A-101.pdf" -> "A-101"; empty names read "Untitled". */
export function sheetTitle(doc) {
  const name = clean(doc?.name).replace(/\.pdf$/i, '');
  return name || 'Untitled';
}

/** The sheet number the title-block reader found, or ''. */
export function sheetNumber(doc) {
  return clean(doc?.sheet_number ?? doc?.sheetNumber);
}

/** One row of the picker: number (when known), name, revision. */
export function sheetLabel(doc) {
  const number = sheetNumber(doc);
  const title = sheetTitle(doc);
  // A title that already starts with its number is not repeated.
  if (!number || title.toLowerCase().startsWith(number.toLowerCase())) return title;
  return `${number} - ${title}`;
}

/**
 * The project's current sheets, in the project's list order: the order the
 * person arranged its Files in (`storedOrder`, ids), and for the rest by
 * sheet number where the title block gave one, then by name, numbers read as
 * numbers (A-2 before A-10). Archived files and older versions are left out.
 */
export function projectSheets(documents, projectId, storedOrder = null) {
  if (projectId == null || projectId === '') return [];
  const rows = (Array.isArray(documents) ? documents : []).filter((d) => (
    d && d.id != null
    && String(projectOf(d)) === String(projectId)
    && !d.archived
    && !d.superseded_by
  ));
  const rank = new Map((Array.isArray(storedOrder) ? storedOrder : []).map((id, i) => [String(id), i]));
  const rankOf = (d) => (rank.has(String(d.id)) ? rank.get(String(d.id)) : Number.MAX_SAFE_INTEGER);
  return rows.sort((a, b) => (
    rankOf(a) - rankOf(b)
    || COLLATOR.compare(sheetNumber(a) || sheetTitle(a), sheetNumber(b) || sheetTitle(b))
    || COLLATOR.compare(sheetTitle(a), sheetTitle(b))
    || String(a.id).localeCompare(String(b.id))
  ));
}

/** The person's own Files order for a project, from Home's saved preferences. */
export function storedProjectOrder(preferences, projectId) {
  const ids = preferences?.documentOrderByProject?.[projectId];
  return Array.isArray(ids) ? ids : null;
}

/** Where the open sheet sits: { index, count } (index -1 when not in the set). */
export function sheetPosition(sheets, currentId) {
  const index = (sheets || []).findIndex((s) => String(s.id) === String(currentId));
  return { index, count: (sheets || []).length };
}

/** The sheet one step away, or null at either end (the arrows stop there). */
export function steppedSheet(sheets, currentId, step) {
  const { index, count } = sheetPosition(sheets, currentId);
  if (index < 0 || !step) return null;
  const next = index + (step > 0 ? 1 : -1);
  return next >= 0 && next < count ? sheets[next] : null;
}

/**
 * The step a key asks for: Shift+Left / Right, as on Drawboard's web app.
 * (Drawboard's Cmd+{ / } is left out: Ctrl+[ / ] already move marks back
 * and forward in Survey.) Anything else is 0.
 */
export function sheetStepForKey(event) {
  if (!event || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return 0;
  if (event.key === 'ArrowLeft') return -1;
  if (event.key === 'ArrowRight') return 1;
  return 0;
}

export function clampGridColumns(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_GRID_COLUMNS;
  return Math.min(GRID_COLUMNS[GRID_COLUMNS.length - 1], Math.max(GRID_COLUMNS[0], n));
}

/** Case-blind search over number and name, as the picker's search field. */
export function filterSheets(sheets, query) {
  const q = clean(query).toLowerCase();
  if (!q) return sheets || [];
  return (sheets || []).filter((s) => sheetLabel(s).toLowerCase().includes(q));
}
