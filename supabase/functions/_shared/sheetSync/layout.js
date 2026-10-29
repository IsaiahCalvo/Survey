// The sheet layout a live-synced spreadsheet uses: one tab per category of each
// space (module), the export kit's columns in its order, one column per
// checklist line. Shared by the app (which sends it) and the sheet-sync edge
// function (which checks it and syncs by it), so both read cells the same way.
//
// Column keys are rowFingerprint's field keys (item, entity, notes, changedBy,
// changedDate, answer:<checklist id>) plus 'rowId', so the merge compares a
// cell with the marker field it came from without a second mapping.
//
// Plain JS, no imports beyond _shared files, so Vite, node tests and Deno load
// the same file.
import { buildSheetLayout } from '../sheetLayout.js';
import { checklistItemKind, APP_ONLY_KINDS, validateExportKit } from '../kitShape.js';

const FIELD_TO_KEY = Object.freeze({
  row_id: 'rowId',
  changed_by: 'changedBy',
  changed_date: 'changedDate',
  name: 'item',
  entity_name: 'entity',
  notes: 'notes',
});

// Cells a person may change in the sheet. Row ID, Changed By and Changed Date
// are the app's own; a change made to them in the sheet is put back.
export const SHEET_EDITABLE_KEYS = Object.freeze(['item', 'entity', 'notes']);

const MAX_TITLE = 100; // Google's limit for a tab name
const MAX_SCOPES = 200;
const MAX_COLUMNS = 400;

export const scopeIdOf = (moduleId, categoryId) => `${String(moduleId)}:${String(categoryId)}`;

const tabTitle = (categoryName, moduleName, used) => {
  const raw = `${categoryName || 'Category'} - ${moduleName || 'Space'}`.trim() || 'Sheet';
  // Excel's banned characters too, so a sheet downloaded as .xlsx keeps its names.
  const cleaned = raw.replace(/[\\/?*[\]:]/g, '').slice(0, MAX_TITLE) || 'Sheet';
  let title = cleaned;
  for (let n = 2; used.has(title.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    title = `${cleaned.slice(0, MAX_TITLE - suffix.length)}${suffix}`;
  }
  used.add(title.toLowerCase());
  return title;
};

const checklistOf = (category) => {
  const list = Array.isArray(category?.checklist) ? category.checklist : [];
  return list
    .map((it, i) => (typeof it === 'string' ? { id: `item-${i}`, text: it } : it))
    .filter((it) => it && it.id != null);
};

/**
 * Build the layout from a template ({ modules|spaces, entities }) and an export
 * kit ({ columns }). `answerValues` are the template's pick-one answers
 * (answerSetFor in the app; Y / N / N/A by default).
 *
 * @returns {{ scopes: Array<{scopeId, moduleId, categoryId, title, columns: Array<{key, header, item?}>}>,
 *             entities: Array<{id, name, color}>, answerValues: string[] }}
 */
export function buildSyncLayout({ template, kit, answerValues = ['Y', 'N', 'N/A'] } = {}) {
  const kitErrors = validateExportKit(kit);
  if (kitErrors.length) throw new Error(`sheet layout: bad export kit (${kitErrors[0]})`);
  const modules = Array.isArray(template?.modules) ? template.modules
    : Array.isArray(template?.spaces) ? template.spaces : [];
  const used = new Set();
  const scopes = [];
  for (const module of modules) {
    for (const category of (Array.isArray(module?.categories) ? module.categories : [])) {
      if (module?.id == null || category?.id == null) continue;
      const checklist = checklistOf(category);
      const { headerRow, columnMapping } = buildSheetLayout(kit, checklist);
      const fields = Object.values(columnMapping);
      const columns = headerRow.map((header, i) => {
        const field = fields[i];
        if (field.startsWith('checklist_')) {
          const item = checklist.find((c) => `checklist_${c.id}` === field);
          // A blank line still needs a header the sheet can be read back by.
          const text = String(header ?? '').trim() || `Check ${checklist.indexOf(item) + 1}`;
          return { key: `answer:${item.id}`, header: text, item };
        }
        return { key: FIELD_TO_KEY[field], header: String(header ?? '') };
      });
      scopes.push({
        scopeId: scopeIdOf(module.id, category.id),
        moduleId: String(module.id),
        categoryId: String(category.id),
        title: tabTitle(category.name, module.name, used),
        columns,
      });
    }
  }
  const entities = (Array.isArray(template?.entities) ? template.entities : [])
    .filter((e) => e && e.id != null && e.name)
    .map((e) => ({ id: String(e.id), name: String(e.name), color: e.color ?? null }));
  return { scopes, entities, answerValues: Array.isArray(answerValues) ? answerValues.map(String) : ['Y', 'N', 'N/A'] };
}

/** Problems with a layout sent by a client; empty means it is usable. */
export function layoutProblems(layout) {
  const problems = [];
  if (!layout || typeof layout !== 'object') return ['layout must be an object'];
  if (!Array.isArray(layout.scopes) || layout.scopes.length === 0) problems.push('layout has no categories');
  else if (layout.scopes.length > MAX_SCOPES) problems.push('layout has too many categories');
  const ids = new Set();
  const titles = new Set();
  for (const scope of layout.scopes || []) {
    if (!scope || typeof scope.scopeId !== 'string' || scope.scopeId !== scopeIdOf(scope.moduleId, scope.categoryId)) {
      problems.push('a category has a bad id');
      continue;
    }
    if (ids.has(scope.scopeId)) problems.push('a category is listed twice');
    ids.add(scope.scopeId);
    const title = String(scope.title || '');
    if (!title || title.length > MAX_TITLE || titles.has(title.toLowerCase())) problems.push('a tab name is missing, too long or repeated');
    titles.add(title.toLowerCase());
    const cols = Array.isArray(scope.columns) ? scope.columns : [];
    if (!cols.length || cols.length > MAX_COLUMNS) problems.push('a category has no columns or too many');
    if (cols[0]?.key !== 'rowId') problems.push('the Row ID column must come first');
    const keys = new Set();
    for (const c of cols) {
      const ok = c && typeof c.key === 'string' && typeof c.header === 'string' && c.header.trim()
        && (Object.values(FIELD_TO_KEY).includes(c.key) || /^answer:.{1,200}$/.test(c.key));
      if (!ok) { problems.push('a column is malformed'); break; }
      if (keys.has(c.key)) { problems.push('a column is listed twice'); break; }
      keys.add(c.key);
    }
  }
  if (!Array.isArray(layout.entities)) problems.push('layout needs an entities list');
  if (!Array.isArray(layout.answerValues)) problems.push('layout needs answer values');
  return problems;
}

/** Whether a sheet edit to this column may change the marker. */
export function columnIsEditable(column) {
  if (!column) return false;
  if (column.key.startsWith('answer:')) return !APP_ONLY_KINDS.includes(checklistItemKind(column.item));
  return SHEET_EDITABLE_KEYS.includes(column.key);
}
