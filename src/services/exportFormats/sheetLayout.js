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
  return { headerRow, columnMapping };
}
