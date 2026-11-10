/**
 * Your own Excel layout (Nightly beta 'own-excel-layouts', plan 2026-10-27,
 * step 1): someone uploads the sheet their company already uses, says by hand
 * which of its columns Survey fills with what, and saves that as an export
 * kit on their account (public.own_export_kits). It goes through the same
 * validateExportKit as every other kit, so the export and the two-way sync
 * read it like a built-in one. Step 2 (later): AI suggests the matches.
 */
import { validateExportKit } from '../../../supabase/functions/_shared/kitShape.js';
import { registerExportKit } from './registry.js';

// What a column of their sheet can be filled with. The kit needs each once;
// what they do not match is added after their columns with the usual header.
// `detail` says in plain words what lands in the column (owner 2026-11-09:
// "people may not know what these things are or what they mean").
export const OWN_KIT_CHOICES = Object.freeze([
  Object.freeze({ field: 'name', label: 'Item name', header: 'Item', detail: 'The name on each mark, like D-1-17' }),
  Object.freeze({ field: 'entity_name', label: 'Entity', header: 'Entity', detail: 'The entity the item is set to, like Complete' }),
  Object.freeze({ field: 'checklist', label: 'Checklist answers', header: '', detail: 'One answer per column from here on, in checklist order' }),
  Object.freeze({ field: 'notes', label: 'Notes', header: 'Notes', detail: 'The notes typed on the item' }),
  Object.freeze({ field: 'changed_by', label: 'Who changed it', header: 'Changed By', detail: 'Initials of the last person to change the item' }),
  Object.freeze({ field: 'changed_date', label: 'Date changed', header: 'Changed Date', detail: 'When the item last changed' }),
]);

const squash = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Whether a column after the Checklist answers one is just the next checklist
 * line: named like a line of the template, or like the first one with
 * another number ("Definition check 2" after "Definition check 1").
 */
export function followsChecklistColumn(header, checklistHeader, lineNames = []) {
  const h = squash(header);
  if (!h) return false;
  if ((lineNames || []).some((line) => squash(line) === h)) return true;
  const stem = squash(checklistHeader).replace(/\s*\d+$/, '');
  return Boolean(stem) && stem !== squash(checklistHeader) && h !== squash(checklistHeader) && h.replace(/\s*\d+$/, '') === stem && /\d$/.test(h);
}

/** Survey's own hidden Row ID column, if their sheet already has one (an old export). */
export const isRowIdHeader = (header) => squash(header) === 'row id';

/**
 * A first guess at what each of their columns holds, from its name, so the
 * common ones are filled in already: Item / Name / Tag / Door No. -> item
 * name, Status / Entity -> entity, Notes / Remarks / Comments -> notes,
 * "... by" -> who changed it, Date / Modified -> date changed, and the first
 * column named like one of the template's checklist lines -> checklist
 * answers. Each field once; '' where there is no guess.
 */
export function guessOwnKitMatches(headers, lineNames = []) {
  const lines = new Set((lineNames || []).map(squash).filter(Boolean));
  const taken = new Set();
  const rules = [
    ['changed_by', (h) => /\b(changed|modified|updated|inspected|checked|surveyed|done) by\b|^by$/.test(h)],
    ['changed_date', (h) => /\b(date|modified|updated|changed)\b/.test(h)],
    ['entity_name', (h) => /^(entity|status|state)$/.test(h)],
    ['notes', (h) => /^(notes?|remarks?|comments?)$/.test(h)],
    ['name', (h) => /^(item|items|item name|name|tag|mark|device|item no|no|number|id)$/.test(h) || /\b(no|number|tag)$/.test(h)],
    ['checklist', (h) => lines.has(h) || /\b(check|checks|line|question|test)\s*\d+$/.test(h)],
  ];
  return (headers || []).map((header) => {
    const h = squash(header);
    if (!h || isRowIdHeader(header)) return '';
    const hit = rules.find(([field, test]) => !taken.has(field) && test(h));
    if (!hit) return '';
    taken.add(hit[0]);
    return hit[0];
  });
}
import { OWN_KIT_LIMITS, OWN_KIT_PREFIX, clean, templateOwnKitOf } from './ownKitCopy.js';

export { OWN_KIT_LIMITS, OWN_KIT_PREFIX, ownKitCopyFor, templateOwnKitOf } from './ownKitCopy.js';

/** A cell's text, whatever exceljs hands back (rich text, a formula, a date). */
function cellText(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value.richText)) return value.richText.map((r) => r.text || '').join('');
  if ('result' in value) return cellText(value.result);
  if ('text' in value) return cellText(value.text);
  return '';
}

/**
 * The column headers of a workbook's first sheet: its first row with two or
 * more names (a title line above them is skipped), else its first row with
 * any text; left to right, blanks dropped. Takes the file's bytes.
 */
export async function readSheetHeaders(bytes) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.worksheets.find((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden' && ws.actualRowCount > 0);
  if (!sheet) return [];
  let fallback = [];
  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r += 1) {
    const headers = [];
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      const text = clean(cellText(cell.value), OWN_KIT_LIMITS.header);
      if (text) headers.push(text);
    });
    if (headers.length >= 2) return headers.slice(0, OWN_KIT_LIMITS.columns);
    if (headers.length && !fallback.length) fallback = headers;
  }
  return fallback;
}

/**
 * The export kit for their sheet. `headers` are their column names in order
 * and `matches[i]` the field column i gets ('' = left out). Row ID, Changed
 * by and Changed date always come first (the sync matches rows on them; Row
 * ID is hidden), then their matched columns in their order, then whatever
 * they did not match. Throws when nothing is matched or the kit is not valid.
 */
export function buildOwnKit({ id, label, headers, matches }) {
  const used = new Map();
  (headers || []).forEach((header, i) => {
    const field = matches?.[i];
    if (field && OWN_KIT_CHOICES.some((c) => c.field === field) && !used.has(field)) used.set(field, clean(header, OWN_KIT_LIMITS.header));
  });
  if (!used.size) throw new Error('Match at least one of your columns to a Survey field.');
  const column = (field) => {
    const choice = OWN_KIT_CHOICES.find((c) => c.field === field);
    return field === 'checklist' ? { field } : { field, header: used.get(field) || choice.header };
  };
  const first = ['changed_by', 'changed_date'];
  const middle = [...used.keys()].filter((f) => !first.includes(f));
  const rest = OWN_KIT_CHOICES.map((c) => c.field).filter((f) => !first.includes(f) && !used.has(f));
  const kit = {
    id,
    kind: 'exportKit',
    version: '1.0.0',
    minEngine: 1,
    label: clean(label, OWN_KIT_LIMITS.label) || 'My layout',
    columns: [{ field: 'row_id', header: 'Row ID' }, ...first.map(column), ...middle.map(column), ...rest.map(column)],
  };
  const errors = validateExportKit(kit);
  if (errors.length) throw new Error(`That layout does not work: ${errors.join('; ')}`);
  return kit;
}

/**
 * A new kit id from its name, never one already taken. A short random tail
 * keeps two people's "Doors" apart once a template carries one to the other.
 */
export function ownKitId(label, taken = [], tail = () => Math.random().toString(36).slice(2, 7)) {
  const slug = clean(label, OWN_KIT_LIMITS.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'layout';
  const ids = new Set(taken);
  for (;;) {
    const id = `${OWN_KIT_PREFIX}${slug}-${String(tail()).toLowerCase().replace(/[^a-z0-9]/g, '') || '0'}`;
    if (!ids.has(id)) return id;
  }
}

/**
 * Registers the own layouts the given templates carry, so a teammate opening
 * a shared template exports in its layout. Returns a function that removes them.
 */
export function registerTemplateKits(templates) {
  const offs = [];
  for (const template of templates || []) {
    const kit = templateOwnKitOf(template);
    if (!kit) continue;
    try { offs.push(registerExportKit(kit)); } catch { /* checked above */ }
  }
  return () => offs.forEach((off) => off());
}

/**
 * The signed-in account's own layouts. Every kit it saves or loads is
 * registered, so the template pickers and the export see it at once.
 */
export function createOwnKitStore(client) {
  const offs = new Map();
  const table = () => client.from('own_export_kits');
  const register = (row) => {
    offs.get(row.id)?.();
    try {
      offs.set(row.id, registerExportKit({ ...row.definition, id: row.id, label: row.label, version: '1.0.0', kind: 'exportKit' }));
    } catch (err) {
      console.warn(`[exportKits] skipped own layout ${row.id}:`, err.message);
    }
  };
  return {
    async load() {
      const { data, error } = await table().select('id, label, definition').order('created_at', { ascending: true });
      if (error) {
        console.warn('[exportKits] own layouts not loaded:', error.message);
        return [];
      }
      (data || []).forEach(register);
      return data || [];
    },
    /** Saves a kit from buildOwnKit; returns its id. */
    async save(kit) {
      const { id, columns, minEngine } = kit;
      const row = { id, label: kit.label, definition: { columns, minEngine } };
      const { error } = await table().insert(row);
      if (error) throw new Error(/own_kit_limit/.test(error.message) ? `You already have ${OWN_KIT_LIMITS.perAccount} layouts.` : (error.message || 'Could not save the layout.'));
      register(row);
      return id;
    },
    /** Takes every registered own layout out of the app (sign-out). */
    unload() {
      offs.forEach((off) => off());
      offs.clear();
    },
  };
}
