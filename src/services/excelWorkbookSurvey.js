// src/services/excelWorkbookSurvey.js
//
// Which survey an exported workbook belongs to (Excel audit W9).
//
// The desktop app keeps the linked workbook on the TEMPLATE, so every survey that uses
// the same template points at the same file. Survey B's "Push to Excel" then rebuilt
// survey A's workbook with B's rows, and a pull could bring A's rows into B. The export
// now writes the survey's id into the hidden _SurveyMetadata sheet, and a pull or push
// from a different survey stops instead. Workbooks from before carry no id and work
// as they did. Only cloud surveys are stamped: their id never changes.

export const WORKBOOK_SURVEY_LABEL = 'survey_id';
// Rows 1-6 hold the template id/name, export stamp, app version and the registration;
// the sheet list starts at row 10.
const LABEL_CELL = 'A7';
const VALUE_CELL = 'B7';

/** Write the survey id onto the _SurveyMetadata worksheet (ExcelJS). */
export function writeWorkbookSurvey(metaSheet, surveyId) {
  if (!metaSheet || typeof metaSheet.getCell !== 'function' || !surveyId) return;
  metaSheet.getCell(LABEL_CELL).value = WORKBOOK_SURVEY_LABEL;
  metaSheet.getCell(VALUE_CELL).value = String(surveyId);
}

/** The survey id a loaded workbook carries, or null. Never throws. */
export function readWorkbookSurvey(workbook) {
  try {
    const sheet = workbook?.getWorksheet?.('_SurveyMetadata');
    if (!sheet) return null;
    if (String(sheet.getCell(LABEL_CELL)?.value ?? '').trim() !== WORKBOOK_SURVEY_LABEL) return null;
    const value = String(sheet.getCell(VALUE_CELL)?.value ?? '').trim();
    return value || null;
  } catch {
    return null;
  }
}

/** True when the workbook names a survey and it is not this one. */
export function belongsToAnotherSurvey(workbookSurveyId, currentSurveyId) {
  return Boolean(workbookSurveyId && currentSurveyId && String(workbookSurveyId) !== String(currentSurveyId));
}
