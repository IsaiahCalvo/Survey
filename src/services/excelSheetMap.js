// src/services/excelSheetMap.js
//
// Which survey category each sheet of an exported workbook belongs to.
//
// A sheet's name is built from "<category> - <space>", cut to Excel's 31-character
// limit, with " (2)", " (3)"… added when two names collide. Matching a sheet back to
// its category by recomputing that name breaks in three ordinary cases:
//   - the category or space is renamed in the app after the export,
//   - two categories share the same first 31 characters (the second sheet gets " (2)"),
//   - the name collides with another one and got a suffix.
// In each case the sheet matched nothing and every edit on it was skipped without a
// word. So the export also writes a small sheet → (space id, category id) list into the
// very-hidden _SurveyMetadata sheet, and the import trusts that list first. Workbooks
// exported before this list existed fall back to the name rule, unchanged.

export const SHEET_MAP_LABEL = 'sheet';
// Checklist columns: (sheet, header as exported) → checklist item id, written after
// the sheet rows. A checklist item renamed in the app after the export still finds its
// column under the old header (Excel audit W8), instead of reading as one item removed
// and an unknown new column.
export const COLUMN_MAP_LABEL = 'column';
// Rows 1-6 of _SurveyMetadata hold the template id/name, export stamp, app version and
// the workbook registration (B5/B6). The sheet list starts well clear of them.
export const SHEET_MAP_START_ROW = 10;

const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;

/** The sheet name the exporter gives a category before any " (n)" suffix. */
export const baseSheetNameFor = (categoryName, moduleName) => {
  const rawName = `${categoryName || 'Category'} - ${moduleName || 'Module'}`.trim() || 'Sheet';
  return rawName.replace(INVALID_SHEET_CHARS, '').substring(0, 31) || 'Sheet';
};

/**
 * Write the sheet list onto the _SurveyMetadata worksheet (ExcelJS).
 * @param {object} metaSheet  ExcelJS worksheet
 * @param {Array<{sheetName:string, moduleId:any, categoryId:any}>} entries
 */
export const writeSheetMap = (metaSheet, entries = []) => {
  if (!metaSheet || typeof metaSheet.getCell !== 'function') return;
  let row = SHEET_MAP_START_ROW;
  for (const entry of entries) {
    if (!entry || !entry.sheetName || entry.moduleId == null || entry.categoryId == null) continue;
    metaSheet.getCell(`A${row}`).value = SHEET_MAP_LABEL;
    metaSheet.getCell(`B${row}`).value = String(entry.sheetName);
    metaSheet.getCell(`C${row}`).value = String(entry.moduleId);
    metaSheet.getCell(`D${row}`).value = String(entry.categoryId);
    row += 1;
  }
  // Older builds stop reading the sheet list at the first other label, so these
  // rows never confuse them.
  for (const entry of entries) {
    if (!entry?.sheetName) continue;
    for (const col of entry.checklistHeaders || []) {
      if (col?.itemId == null || !String(col.header ?? '').trim()) continue;
      metaSheet.getCell(`A${row}`).value = COLUMN_MAP_LABEL;
      metaSheet.getCell(`B${row}`).value = String(entry.sheetName);
      metaSheet.getCell(`C${row}`).value = String(col.itemId);
      metaSheet.getCell(`D${row}`).value = String(col.header).trim();
      row += 1;
    }
  }
};

const cellText = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part?.text || '').join('');
    if (value.result != null) return String(value.result);
  }
  return String(value);
};

/**
 * Read the sheet list back from a loaded ExcelJS workbook. Never throws.
 * @returns {Map<string, {moduleId:string, categoryId:string}>} sheet name → ids
 */
export const readSheetMap = (workbook) => {
  const map = new Map();
  try {
    const sheet = workbook?.getWorksheet?.('_SurveyMetadata');
    if (!sheet) return map;
    // A short gap of blank rows ends the list; cap the walk so a damaged sheet can't
    // make us read forever.
    for (let row = SHEET_MAP_START_ROW; row < SHEET_MAP_START_ROW + 2000; row += 1) {
      const label = cellText(sheet.getCell(`A${row}`)?.value).trim();
      if (label !== SHEET_MAP_LABEL) break;
      const sheetName = cellText(sheet.getCell(`B${row}`)?.value);
      const moduleId = cellText(sheet.getCell(`C${row}`)?.value);
      const categoryId = cellText(sheet.getCell(`D${row}`)?.value);
      if (sheetName && moduleId && categoryId && !map.has(sheetName)) {
        map.set(sheetName, { moduleId, categoryId });
      }
    }
  } catch {
    return new Map();
  }
  return map;
};

/**
 * Find the template category a worksheet belongs to: the hidden sheet list first (by
 * id, so renames and suffixed names still match), then the old name rule.
 *
 * @param {{ sheetName:string, modules:Array, sheetMap?:Map }} args
 * @returns {{ category:object, moduleId:any, moduleName:string }|null}
 */
export const matchSheetToCategory = ({ sheetName, modules = [], sheetMap = null } = {}) => {
  const mapped = sheetMap && typeof sheetMap.get === 'function' ? sheetMap.get(sheetName) : null;
  if (mapped) {
    for (const mod of modules || []) {
      if (String(mod?.id) !== mapped.moduleId) continue;
      const cat = (mod.categories || []).find((c) => String(c?.id) === mapped.categoryId);
      if (cat) return { category: cat, moduleId: mod.id, moduleName: mod.name };
    }
    // The category is gone from the template: fall through to the name rule, which
    // also finds nothing for a deleted category — same as before.
  }
  for (const mod of modules || []) {
    for (const cat of mod?.categories || []) {
      if (baseSheetNameFor(cat?.name, mod?.name) === sheetName) {
        return { category: cat, moduleId: mod.id, moduleName: mod.name };
      }
    }
  }
  return null;
};

/**
 * Read the checklist column list back. Never throws.
 * @returns {Map<string, Map<string, string>>} sheet name → (exported header → item id)
 */
export const readColumnMap = (workbook) => {
  const map = new Map();
  try {
    const sheet = workbook?.getWorksheet?.('_SurveyMetadata');
    if (!sheet) return map;
    for (let row = SHEET_MAP_START_ROW; row < SHEET_MAP_START_ROW + 20000; row += 1) {
      const label = cellText(sheet.getCell(`A${row}`)?.value).trim();
      if (label === SHEET_MAP_LABEL) continue;
      if (label !== COLUMN_MAP_LABEL) break;
      const sheetName = cellText(sheet.getCell(`B${row}`)?.value);
      const itemId = cellText(sheet.getCell(`C${row}`)?.value);
      const header = cellText(sheet.getCell(`D${row}`)?.value).trim();
      if (!sheetName || !itemId || !header) continue;
      if (!map.has(sheetName)) map.set(sheetName, new Map());
      if (!map.get(sheetName).has(header)) map.get(sheetName).set(header, itemId);
    }
  } catch {
    return new Map();
  }
  return map;
};

/**
 * Give a column whose checklist item was renamed in the app since the export the
 * item's current name, so every reader that matches columns by header text finds it.
 * Changes the header row in place. A header that already matches an item, or whose
 * item is gone, stays as it is; so does one whose new name already has a column.
 *
 * @param {Array} headerRow  the sheet's first row, as read
 * @param {{ sheetName:string, checklistItems:Array, columnMap?:Map }} args
 * @returns {Array} the same header row
 */
export const renameMovedHeaders = (headerRow, { sheetName, checklistItems = [], columnMap = null } = {}) => {
  const exported = columnMap?.get?.(sheetName);
  if (!Array.isArray(headerRow) || !exported || exported.size === 0) return headerRow;
  const current = new Set(checklistItems.map((c) => c?.text));
  const present = new Set(headerRow.map((h) => String(h ?? '').trim()));
  headerRow.forEach((value, index) => {
    const header = String(value ?? '').trim();
    if (!header || current.has(header)) return;
    const itemId = exported.get(header);
    const item = itemId != null && checklistItems.find((c) => String(c?.id) === itemId);
    if (!item?.text || present.has(item.text)) return;
    headerRow[index] = item.text;
    present.add(item.text);
  });
  return headerRow;
};
