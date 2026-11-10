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
//     Every tab as plain values: string, number, boolean or null. A whole-day
//     date as "YYYY-MM-DD" from the cell's serial number (so "05/10" means the
//     same day whatever the sheet's locale); other dates and times as the text
//     the sheet shows. A cell whose formula fails (#N/A, #REF!...) as
//     { error: '#N/A' } (cellError), never as blank: blank would read as "the
//     person cleared it" and wipe the survey's value.
// - readCells(fileId, [{ sheetId, title, row, col }]) -> any[]
//     Single cells, in the order asked, in exactly readGrid's form. Just before
//     writing, the runner re-reads every Row ID it writes next to and every
//     cell it writes, so a sort or a person typing in the sheet between read
//     and write never lands a value on the wrong row or over their edit.
// - writeCells(fileId, [{ sheetId, title, row, col, value, header? }])
//     Raw values: text is never turned into a formula, number or date.
//     `header` marks a header cell (bold, like the ones createFile makes).
// - appendRows(fileId, [{ sheetId, title, rows: any[][], width }])
//     After the last used row of each tab.
// - deleteRows(fileId, [{ sheetId, title, row }])
//     The runner sends them highest row first, per tab.
// - createFile({ title, layout }) -> { fileId, url, sheetIds: { [scopeId]: sheetId } }
//     A new file with one tab per layout scope, its header row, the Row ID
//     column hidden.
// - addTabs(fileId, scopes) -> { [scopeId]: sheetId }
//     Tabs for categories added to the template after the file was made.
// - lastEditor(fileId) -> { name, email, me, at } | null   (optional)
//     Who last changed the file and when, as the last getVersion read it (no
//     call of its own). `me` is true when it was the signed-in account (the
//     linker, which is also who Survey writes as). Sheet edits are credited to
//     this person in Changed By (round.js sheetEditorLabel).
// - savesLate: true   (optional)
//     A person's typing can reach the file a minute or more after they typed
//     it (Excel on the web). The engine then holds a different value landing
//     on a cell it just wrote as a conflict (engine.js RECENT_WRITE_MS).

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

/** A cell whose formula failed, as readGrid and readCells give it. */
export const cellError = (text) => ({ error: String(text || '#ERROR!') });
export const isCellError = (value) => value != null && typeof value === 'object' && typeof value.error === 'string';

/** An Error with an HTTP-like status, for providers to throw. */
/**
 * A Microsoft or Google call that hangs (a slow or dropped connection) would
 * hold the round, its lease and the person's panel until the platform kills
 * the function. Each call gets this long; then it fails as "busy" (504,
 * code 'timeout') and the sheet waits and tries again. A write that timed out
 * may still have landed: the next round reads the sheet and settles it.
 */
export const REQUEST_TIMEOUT_MS = 45_000;

/** fetch with a time limit: a timeout becomes a 504 'timeout' error. */
export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`), { status: 504, code: 'timeout' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function providerError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}
