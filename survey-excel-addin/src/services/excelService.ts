/**
 * Excel Service
 * Wrapper around Office.js Excel APIs for workbook interaction
 */

import { ExcelChangeEvent, parseSheetName, columnIndexToLetter } from '../types/survey';

// Event handlers storage
type ChangeHandler = (event: ExcelChangeEvent) => void;
type SheetHandler = (sheetName: string, sheetIndex: number) => void;

let changeHandlers: ChangeHandler[] = [];
let sheetAddedHandlers: SheetHandler[] = [];
let sheetDeletedHandlers: SheetHandler[] = [];
let eventContexts: Excel.RequestContext[] = [];

/**
 * Initialize Excel API and register event handlers
 */
export async function initExcelEvents(): Promise<void> {
  await Excel.run(async (context) => {
    const workbook = context.workbook;

    // Register for worksheet change events on all sheets
    workbook.worksheets.onChanged.add(handleWorksheetChange);
    workbook.worksheets.onAdded.add(handleWorksheetAdded);
    workbook.worksheets.onDeleted.add(handleWorksheetDeleted);

    await context.sync();
    console.log('[ExcelService] Event handlers registered');
  });
}

/**
 * Handle worksheet cell changes
 */
async function handleWorksheetChange(
  eventArgs: Excel.WorksheetChangedEventArgs
): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(eventArgs.worksheetId);
    sheet.load('name,position');

    const range = sheet.getRange(eventArgs.address);
    range.load('rowIndex,columnIndex,values');

    await context.sync();

    const event: ExcelChangeEvent = {
      sheetName: sheet.name,
      sheetIndex: sheet.position,
      address: eventArgs.address,
      rowIndex: range.rowIndex,
      columnIndex: range.columnIndex,
      oldValue: undefined, // Not available in change event
      newValue: range.values[0]?.[0],
    };

    console.log('[ExcelService] Cell changed:', event);

    // Notify all handlers
    changeHandlers.forEach((handler) => handler(event));
  });
}

/**
 * Handle worksheet added
 */
async function handleWorksheetAdded(
  eventArgs: Excel.WorksheetAddedEventArgs
): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(eventArgs.worksheetId);
    sheet.load('name,position');
    await context.sync();

    console.log('[ExcelService] Worksheet added:', sheet.name);
    sheetAddedHandlers.forEach((handler) => handler(sheet.name, sheet.position));
  });
}

/**
 * Handle worksheet deleted
 */
async function handleWorksheetDeleted(
  eventArgs: Excel.WorksheetDeletedEventArgs
): Promise<void> {
  console.log('[ExcelService] Worksheet deleted:', eventArgs.worksheetId);
  // Note: We can't get the sheet name since it's deleted
  sheetDeletedHandlers.forEach((handler) => handler(eventArgs.worksheetId, -1));
}

/**
 * Register a change handler
 */
export function onCellChange(handler: ChangeHandler): () => void {
  changeHandlers.push(handler);
  return () => {
    changeHandlers = changeHandlers.filter((h) => h !== handler);
  };
}

/**
 * Register a sheet added handler
 */
export function onSheetAdded(handler: SheetHandler): () => void {
  sheetAddedHandlers.push(handler);
  return () => {
    sheetAddedHandlers = sheetAddedHandlers.filter((h) => h !== handler);
  };
}

/**
 * Register a sheet deleted handler
 */
export function onSheetDeleted(handler: SheetHandler): () => void {
  sheetDeletedHandlers.push(handler);
  return () => {
    sheetDeletedHandlers = sheetDeletedHandlers.filter((h) => h !== handler);
  };
}

/**
 * Get all worksheets
 */
export async function getWorksheets(): Promise<
  Array<{ name: string; id: string; position: number }>
> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load('items/name,items/id,items/position');
    await context.sync();

    return sheets.items.map((sheet) => ({
      name: sheet.name,
      id: sheet.id,
      position: sheet.position,
    }));
  });
}

/**
 * Get used range of a worksheet
 */
export async function getUsedRange(
  sheetName: string
): Promise<{ values: unknown[][]; address: string; rowCount: number; columnCount: number }> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const usedRange = sheet.getUsedRange();
    usedRange.load('values,address,rowCount,columnCount');
    await context.sync();

    return {
      values: usedRange.values,
      address: usedRange.address,
      rowCount: usedRange.rowCount,
      columnCount: usedRange.columnCount,
    };
  });
}

/**
 * Get a specific cell range
 */
export async function getCellRange(
  sheetName: string,
  address: string
): Promise<{ values: unknown[][]; address: string }> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    range.load('values,address');
    await context.sync();

    return {
      values: range.values,
      address: range.address,
    };
  });
}

/**
 * Update a cell range
 */
export async function updateCellRange(
  sheetName: string,
  address: string,
  values: unknown[][]
): Promise<void> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    range.values = values;
    await context.sync();
    console.log(`[ExcelService] Updated ${sheetName}!${address}`);
  });
}

/**
 * Update a single cell
 */
export async function updateCell(
  sheetName: string,
  row: number,
  col: number,
  value: unknown
): Promise<void> {
  const address = `${columnIndexToLetter(col)}${row + 1}`;
  return updateCellRange(sheetName, address, [[value]]);
}

/**
 * Insert a new row at a specific position
 */
export async function insertRow(
  sheetName: string,
  rowIndex: number,
  values?: unknown[]
): Promise<void> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);

    // Get the row to insert before
    const rowRange = sheet.getRange(`${rowIndex + 1}:${rowIndex + 1}`);
    rowRange.insert(Excel.InsertShiftDirection.down);

    if (values) {
      const newRowRange = sheet.getRange(`${rowIndex + 1}:${rowIndex + 1}`);
      const colCount = values.length;
      const dataRange = newRowRange.getResizedRange(0, colCount - 1);
      dataRange.values = [values];
    }

    await context.sync();
    console.log(`[ExcelService] Inserted row at ${rowIndex + 1} in ${sheetName}`);
  });
}

/**
 * Delete a row
 */
export async function deleteRow(sheetName: string, rowIndex: number): Promise<void> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const rowRange = sheet.getRange(`${rowIndex + 1}:${rowIndex + 1}`);
    rowRange.delete(Excel.DeleteShiftDirection.up);
    await context.sync();
    console.log(`[ExcelService] Deleted row ${rowIndex + 1} from ${sheetName}`);
  });
}

/**
 * Add a new worksheet
 */
export async function addWorksheet(name: string): Promise<string> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.add(name);
    sheet.load('id');
    await context.sync();
    console.log(`[ExcelService] Added worksheet: ${name}`);
    return sheet.id;
  });
}

/**
 * Delete a worksheet
 */
export async function deleteWorksheet(name: string): Promise<void> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(name);
    sheet.delete();
    await context.sync();
    console.log(`[ExcelService] Deleted worksheet: ${name}`);
  });
}

/**
 * Rename a worksheet
 */
export async function renameWorksheet(
  oldName: string,
  newName: string
): Promise<void> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(oldName);
    sheet.name = newName;
    await context.sync();
    console.log(`[ExcelService] Renamed worksheet: ${oldName} -> ${newName}`);
  });
}

/**
 * Get the active worksheet
 */
export async function getActiveWorksheet(): Promise<{ name: string; id: string }> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    sheet.load('name,id');
    await context.sync();
    return { name: sheet.name, id: sheet.id };
  });
}

/**
 * Get header row values (first row) of a worksheet
 */
export async function getHeaderRow(sheetName: string): Promise<string[]> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const usedRange = sheet.getUsedRange();
    usedRange.load('columnCount');
    await context.sync();

    const headerRange = sheet.getRange(`1:1`).getResizedRange(0, usedRange.columnCount - 1);
    headerRange.load('values');
    await context.sync();

    return headerRange.values[0].map((v: unknown) => String(v || ''));
  });
}

/**
 * Parse all worksheets to extract survey structure
 */
export async function parseSurveyStructure(): Promise<
  Array<{
    sheetName: string;
    moduleName: string | null;
    categoryName: string | null;
    headers: string[];
    rowCount: number;
  }>
> {
  const worksheets = await getWorksheets();
  const structure = [];

  for (const ws of worksheets) {
    const parsed = parseSheetName(ws.name);
    const headers = await getHeaderRow(ws.name);
    const usedRange = await getUsedRange(ws.name);

    structure.push({
      sheetName: ws.name,
      moduleName: parsed?.moduleName || null,
      categoryName: parsed?.categoryName || null,
      headers,
      rowCount: usedRange.rowCount,
    });
  }

  return structure;
}

/**
 * Clean up event handlers
 */
export function cleanupEventHandlers(): void {
  changeHandlers = [];
  sheetAddedHandlers = [];
  sheetDeletedHandlers = [];
  eventContexts.forEach((ctx) => {
    try {
      // Note: There's no direct way to unregister events in Office.js
      // The events will be cleaned up when the add-in closes
    } catch (e) {
      console.error('Error cleaning up event context:', e);
    }
  });
  eventContexts = [];
}
