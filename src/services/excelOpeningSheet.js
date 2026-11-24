// ExcelJS opens a workbook on tab 0 unless told otherwise. Tab 0 of a Survey export is
// the very-hidden _SurveyMetadata sheet, so Excel opened on a sheet nobody can see and
// Numbers/Google Sheets opened on a blank grid. Point the workbook at the first sheet a
// person can see.
export function openOnFirstVisibleSheet(workbook) {
  const sheets = workbook?.worksheets || [];
  const index = sheets.findIndex((sheet) => !sheet.state || sheet.state === 'visible');
  if (index < 0) return -1;
  const current = Array.isArray(workbook.views) && workbook.views[0] ? workbook.views[0] : {};
  workbook.views = [{ x: 0, y: 0, width: 10000, height: 20000, visibility: 'visible', ...current, activeTab: index, firstSheet: index }];
  sheets.forEach((sheet, i) => {
    const view = Array.isArray(sheet.views) && sheet.views[0] ? sheet.views[0] : {};
    sheet.views = [{ ...view, tabSelected: i === index }, ...(sheet.views || []).slice(1)];
  });
  return index;
}
