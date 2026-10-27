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
export const OWN_KIT_CHOICES = Object.freeze([
  Object.freeze({ field: 'name', label: 'Item name', header: 'Item' }),
  Object.freeze({ field: 'entity_name', label: 'Entity', header: 'Entity' }),
  Object.freeze({ field: 'checklist', label: 'Checklist lines', header: '' }),
  Object.freeze({ field: 'notes', label: 'Notes', header: 'Notes' }),
  Object.freeze({ field: 'changed_by', label: 'Changed by', header: 'Changed By' }),
  Object.freeze({ field: 'changed_date', label: 'Changed date', header: 'Changed Date' }),
]);
export const OWN_KIT_LIMITS = Object.freeze({ label: 60, header: 80, columns: 60, perAccount: 50 });
export const OWN_KIT_PREFIX = 'own-';

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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

/** A new kit id from its name, never one already taken. */
export function ownKitId(label, taken = []) {
  const slug = clean(label, OWN_KIT_LIMITS.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'layout';
  const base = `${OWN_KIT_PREFIX}${slug}`;
  const ids = new Set(taken);
  if (!ids.has(base)) return base;
  for (let n = 2; ; n += 1) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
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
