const EXCEL_MAX_COLUMN_INDEX = 16_384;
const STATIC_COLUMN_COUNT = 4;
const TRAILING_COLUMN_COUNT = 2;

/** Return the A1-style letter for a one-based Excel column index. */
export function excelColumnLetter(columnIndex) {
  if (!Number.isInteger(columnIndex) || columnIndex < 1 || columnIndex > EXCEL_MAX_COLUMN_INDEX) {
    throw new RangeError(`Excel column index must be an integer from 1 to ${EXCEL_MAX_COLUMN_INDEX}`);
  }

  let remaining = columnIndex;
  let letter = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letter = String.fromCharCode(65 + digit) + letter;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letter;
}

/**
 * Describe the fixed Survey worksheet layout without filtering or reordering
 * checklist items. Callers retain the current archive and inclusion rules.
 */
export function buildSurveyWorksheetColumns(checklistItems = []) {
  if (!Array.isArray(checklistItems)) {
    throw new TypeError('checklistItems must be an array');
  }

  const totalColumnCount = STATIC_COLUMN_COUNT + checklistItems.length + TRAILING_COLUMN_COUNT;
  if (totalColumnCount > EXCEL_MAX_COLUMN_INDEX) {
    throw new RangeError(`Survey worksheet needs ${totalColumnCount} columns; Excel supports ${EXCEL_MAX_COLUMN_INDEX}`);
  }

  const headerRow = ['Row ID', 'Changed By', 'Changed Date', 'Item'];
  const columnMapping = {
    A: 'row_id',
    B: 'changed_by',
    C: 'changed_date',
    D: 'name',
  };

  checklistItems.forEach((checklistItem, index) => {
    const columnIndex = STATIC_COLUMN_COUNT + index + 1;
    headerRow.push(checklistItem?.text || '');
    columnMapping[excelColumnLetter(columnIndex)] = `checklist_${checklistItem?.id}`;
  });

  const entityColumnIndex = STATIC_COLUMN_COUNT + checklistItems.length + 1;
  const notesColumnIndex = entityColumnIndex + 1;
  const entityColumnLetter = excelColumnLetter(entityColumnIndex);
  const notesColumnLetter = excelColumnLetter(notesColumnIndex);
  headerRow.push('Entity', 'Notes');
  columnMapping[entityColumnLetter] = 'entity_name';
  columnMapping[notesColumnLetter] = 'notes';

  return {
    headerRow,
    columnMapping,
    itemColumnIndex: 4,
    itemColumnLetter: 'D',
    firstChecklistColumnIndex: checklistItems.length > 0 ? 5 : null,
    firstChecklistColumnLetter: checklistItems.length > 0 ? 'E' : null,
    lastChecklistColumnIndex: checklistItems.length > 0 ? STATIC_COLUMN_COUNT + checklistItems.length : null,
    lastChecklistColumnLetter: checklistItems.length > 0
      ? excelColumnLetter(STATIC_COLUMN_COUNT + checklistItems.length)
      : null,
    entityColumnIndex,
    entityColumnLetter,
    notesColumnIndex,
    notesColumnLetter,
    totalColumnCount,
  };
}

export const __testing = Object.freeze({ EXCEL_MAX_COLUMN_INDEX });
