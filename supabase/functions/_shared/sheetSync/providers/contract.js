// What a spreadsheet provider gives the sheet sync runner (round.js). Google
// Sheets (google.js) and Microsoft 365 workbooks (msgraph.js) each implement
// it; the merge itself (engine.js) never talks to a provider.
//
// All methods are async. `fileId` is the provider's own id for the file.
// `sheetId` is a string (a Google tab id or a Graph worksheet id). `row` and
// `col` are 0-based grid indexes, and row 0 is the header row.
// Errors carry `.status`: 429 (slow down; the runner backs off), 401 (the
// sign-in no longer works; the link is marked broken until the owner signs in
// again), 404 (the file is gone).
//
// - getVersion(fileId) -> string | null
//     Changes whenever the file's content changes (Drive `version`, Graph cTag).
// - readGrid(fileId) -> { sheets: [{ sheetId, title, rows: any[][], columnCount? }] }
//     Every tab as plain values: string, number, boolean or null. Dates as the
//     text the sheet shows.
// - readCells(fileId, [{ sheetId, title, row, col }]) -> any[]
//     Single cells, in the order asked. The runner re-reads Row IDs with it
//     just before writing, so a sort in the sheet between read and write
//     never lands a value on the wrong row.
// - writeCells(fileId, [{ sheetId, title, row, col, value }])
//     Raw values: text is never turned into a formula, number or date.
// - appendRows(fileId, [{ sheetId, title, rows: any[][], width }])
//     After the last used row of each tab.
// - deleteRows(fileId, [{ sheetId, title, row }])
//     The runner sends them highest row first, per tab.
// - createFile({ title, layout }) -> { fileId, url, sheetIds: { [scopeId]: sheetId } }
//     A new file with one tab per layout scope, its header row, the Row ID
//     column hidden.
// - addTabs(fileId, scopes) -> { [scopeId]: sheetId }
//     Tabs for categories added to the template after the file was made.

export const PROVIDER_METHODS = Object.freeze([
  'getVersion', 'readGrid', 'readCells', 'writeCells', 'appendRows', 'deleteRows', 'createFile', 'addTabs',
]);

export const PROVIDERS = Object.freeze(['google', 'msgraph']);

/** Throws when `provider` lacks a method the runner calls. */
export function assertProvider(provider) {
  const missing = PROVIDER_METHODS.filter((m) => typeof provider?.[m] !== 'function');
  if (missing.length) throw new Error(`sheet sync provider is missing ${missing.join(', ')}`);
  return provider;
}

/** An Error with an HTTP-like status, for providers to throw. */
export function providerError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}
