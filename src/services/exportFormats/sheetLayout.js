/**
 * Turn an export kit plus a category's checklist into the sheet's header row
 * and the column mapping the Excel add-in sync reads ({ A: 'row_id', ... }).
 *
 * For the default kit this must match, cell for cell, what
 * handleExportSurveyToExcel in PDFViewer.jsx builds inline today
 * (tests/exportFormatsRegistry.test.mjs pins that).
 */
export function buildSheetLayout(kit, checklistItems = []) {
  const headerRow = [];
  const columnMapping = {};
  const push = (header, field) => {
    // Same letter scheme as the inline export (A, B, ... single letters).
    columnMapping[String.fromCharCode(65 + headerRow.length)] = field;
    headerRow.push(header);
  };
  kit.columns.forEach((col) => {
    if (col.field === 'checklist') {
      checklistItems.forEach((item) => push(item.text || '', `checklist_${item.id}`));
    } else {
      push(col.header, col.field);
    }
  });
  // 1-based column number per field, plus the checklist block, for the
  // export's styling, validation and widths.
  const colOf = {};
  Object.entries(columnMapping).forEach(([letter, field]) => {
    if (!field.startsWith('checklist_')) colOf[field] = letter.charCodeAt(0) - 64;
  });
  const checklistAt = kit.columns.findIndex((c) => c.field === 'checklist');
  const firstChecklistCol = checklistAt + 1;
  const lastChecklistCol = firstChecklistCol + checklistItems.length - 1;
  return { headerRow, columnMapping, colOf, firstChecklistCol, lastChecklistCol };
}

/** One data row in the kit's column order. `cells` holds a value per field. */
export function buildSheetRow(kit, checklistItems, cells, answers = {}) {
  const row = [];
  kit.columns.forEach((col) => {
    if (col.field === 'checklist') checklistItems.forEach((item) => row.push(answers[item.id] ?? ''));
    else row.push(cells[col.field]);
  });
  return row;
}

/**
 * Import reads system columns by their standard header text (Item, Entity,
 * Notes ...), here, in buildScopeImportPlans and in the excel-apply-changeset
 * function. A kit may rename them (Item -> Door), so map a sheet's header row
 * back to the standard names before anything reads it.
 */
export function toStandardHeaders(headerRow, kit, standardKit) {
  if (!Array.isArray(headerRow) || !kit || !standardKit || kit === standardKit) return headerRow;
  const standardOf = {};
  standardKit.columns.forEach((c) => { if (c.field !== 'checklist') standardOf[c.field] = c.header; });
  const rename = new Map();
  kit.columns.forEach((c) => {
    if (c.field !== 'checklist' && standardOf[c.field] && c.header !== standardOf[c.field]) rename.set(c.header, standardOf[c.field]);
  });
  if (!rename.size) return headerRow;
  // First unmatched occurrence only: a checklist item named Door / Gateway must
  // stay put, or import treats it as Item / Entity and drops those answers.
  const remapped = new Set();
  const out = headerRow.map((h) => {
    if (typeof h !== 'string') return h;
    const key = h.trim();
    if (!rename.has(key) || remapped.has(key)) return h;
    remapped.add(key);
    return rename.get(key);
  });
  // Keep expandos such as sheetRowNumber that the import reads off row arrays.
  return Object.assign(out, Object.fromEntries(Object.entries(headerRow).filter(([k]) => !/^\d+$/.test(k))));
}
