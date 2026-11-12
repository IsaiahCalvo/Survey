// Drawboard's multi-sheet view (Nightly flag 'sheet-set-view'): a project's
// drawings as one set you can step through (bottom-bar arrows, Shift+Left /
// Right), pick from a list, or see side by side as a List or a
// Grid. Pure rules only; SheetSetBar.jsx and SheetSetView.jsx draw them.

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Grid columns: Auto (as many as there are sheets, up to 4) or any whole
// number the person types, as Drawboard's "Grid columns" box.
export const GRID_AUTO = 'auto';
export const GRID_AUTO_MAX = 4;
export const GRID_MAX_COLUMNS = 24;
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

/** A picker row: the number in bold, the name under it ({ number, name }). */
export function sheetRowParts(doc) {
  const number = sheetNumber(doc);
  const title = sheetTitle(doc);
  if (!number) return { number: title, name: '' };
  const name = title.toLowerCase().startsWith(number.toLowerCase())
    ? title.slice(number.length).replace(/^[\s\-–—:_.]+/, '')
    : title;
  return { number, name };
}

/** A saved or typed setting: 'auto', or a whole number (0 reads as 1). */
export function parseGridColumns(value) {
  if (value == null || value === '' || value === GRID_AUTO) return GRID_AUTO;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return GRID_AUTO;
  return Math.min(GRID_MAX_COLUMNS, Math.max(1, n));
}

/** Sheets per row: Auto is min(sheets, 4); a number is that many. */
export function gridColumnsFor(setting, count) {
  const parsed = parseGridColumns(setting);
  if (parsed !== GRID_AUTO) return parsed;
  return Math.max(1, Math.min(GRID_AUTO_MAX, Number(count) || 1));
}

/** The strip under a sheet in List / Grid: "M-101 - Plan - Rev C". */
export function sheetCardLabel(doc) {
  const rev = clean(doc?.sheet_revision ?? doc?.sheetRevision);
  return rev ? `${sheetLabel(doc)} - Rev ${rev}` : sheetLabel(doc);
}

/**
 * "Open all" opens the list as it stands; with two or more rows ticked it
 * reads "Open N selected" and opens only those. Order stays the list's.
 */
export function openAllChoice(files, selectedIds) {
  const rows = Array.isArray(files) ? files : [];
  const ticked = new Set([...(selectedIds || [])].map(String));
  const picked = rows.filter((f) => ticked.has(String(f.id)));
  return picked.length >= 2
    ? { files: picked, label: `Open ${picked.length} selected` }
    : { files: rows, label: 'Open all' };
}

/**
 * The set Open all chose (ids), kept while its sheets are open: the project's
 * sheets narrowed to those ids, in the project's order. With fewer than two of
 * them left, or the open sheet not among them, the whole project set stands.
 */
export function narrowSheets(sheets, ids, currentId) {
  if (!Array.isArray(ids) || !ids.length) return sheets || [];
  const keep = new Set(ids.map(String));
  const narrowed = (sheets || []).filter((s) => keep.has(String(s.id)));
  return narrowed.length > 1 && narrowed.some((s) => String(s.id) === String(currentId)) ? narrowed : (sheets || []);
}

/** Case-blind search over number and name, as the picker's search field. */
export function filterSheets(sheets, query) {
  const q = clean(query).toLowerCase();
  if (!q) return sheets || [];
  return (sheets || []).filter((s) => sheetLabel(s).toLowerCase().includes(q));
}
