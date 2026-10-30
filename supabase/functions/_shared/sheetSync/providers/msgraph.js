// Microsoft (OneDrive for Business, SharePoint, Teams) adapter for the sheet-sync
// engine. The server job owns the workbook and calls these; phones and the web never
// write the file themselves. Plain fetch, so it runs in the edge functions (Deno)
// and in the Node tests (with a fake fetch).
//
// Only business drives: Microsoft's Excel API refuses workbooks on personal
// (consumer) OneDrive, so a personal file throws `.code = 'personal-onedrive'`
// and the runner falls back or marks the link (see excel-sync/audit.md section 9).
//
// fileId is `drives/<driveId>/items/<itemId>` (driveIds hold `!`, so no short form).
// Rows and columns are 0-based from A1; row 0 is the header.
import { cellError } from './contract.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
// Graph closes a saving session after about 5 minutes idle; reopen a bit before.
const SESSION_TTL_MS = 4 * 60 * 1000;

export function msgraphFileId(driveId, itemId) {
  if (!driveId || !itemId) throw new Error('msgraph: drive id and item id are required');
  return `drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
}

export function parseMsgraphFileId(fileId) {
  const match = /^drives\/([^/]+)\/items\/([^/]+)$/.exec(String(fileId || ''));
  if (!match) throw Object.assign(new Error('msgraph: bad file id'), { status: 404 });
  return { driveId: decodeURIComponent(match[1]), itemId: decodeURIComponent(match[2]) };
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function cellAddress(row, col) {
  return `${columnLetter(col)}${row + 1}`;
}

/**
 * What the engine writes stays what it is. Graph writes values the way typing
 * does, so Excel would turn "=..." into a formula and "00123", "1/2" or "TRUE"
 * into a number, date or yes/no. A leading apostrophe keeps any text as text
 * (Excel hides it, as when typed); numbers and booleans go as they are.
 */
export function cellValueForWrite(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value);
  return text === '' ? '' : `'${text}`;
}

// A number format that shows a date or time (not General, 0.00, %...). Graph
// returns dates as serial numbers in `values`; the engine wants the shown text.
function isDateFormat(format) {
  if (typeof format !== 'string' || !format || format === 'General') return false;
  const bare = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare);
}

// A whole-day date (no hours or seconds in the format) as YYYY-MM-DD from its
// serial, so "05/10" reads the same day in any locale; a failed formula as
// { error } (contract.js), never as its "#N/A" text.
function plainCell(value, text, format, type) {
  if (value === '' || value === undefined) return null;
  if (type === 'Error') return cellError(typeof value === 'string' ? value : text);
  if (typeof value === 'number' && isDateFormat(format)) {
    const bare = String(format).replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
    if (!/[hs]/i.test(bare) && Number.isInteger(value) && value > 60) {
      return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
    }
    return text ?? value;
  }
  return value;
}

// Drop-downs cover this many rows, like the desktop export.
const DROP_DOWN_ROWS = 1000;

/**
 * The comma list for a column's drop-down, or null. Excel caps a typed list at 255
 * characters and splits on commas, so a longer list or a choice holding a comma
 * gets no drop-down (typing still works; the merge checks values anyway).
 */
export function dropDownChoices(column, layout) {
  const key = String(column?.key || '');
  let choices = null;
  if (key === 'entity') choices = (layout?.entities || []).map((e) => e?.name).filter(Boolean);
  else if (key.startsWith('answer:') && (!column.item?.kind || column.item.kind === 'choice')) choices = layout?.answerValues || null;
  if (!choices?.length || choices.some((c) => String(c).includes(','))) return null;
  const source = choices.map(String).join(',');
  return source.length <= 255 ? source : null;
}

function graphError(status, body, headers, where) {
  const message = body?.error?.message || `Microsoft Graph ${where} failed (${status})`;
  const error = new Error(message);
  error.status = status;
  error.code = body?.error?.code || null;
  const retryAfter = Number(headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
  return error;
}

// Session errors Graph gives when a saving session has expired or was closed.
function isSessionGone(error) {
  return (error?.status === 404 || error?.status === 400)
    && /session/i.test(`${error.code || ''} ${error.message || ''}`);
}

/** Group cells by sheet, keeping the sheet's title for the caller. */
function bySheet(cells) {
  const groups = new Map();
  for (const cell of cells || []) {
    if (!groups.has(cell.sheetId)) groups.set(cell.sheetId, []);
    groups.get(cell.sheetId).push(cell);
  }
  return groups;
}

/** Runs of cells side by side on one row, so one request writes each run. */
export function rowRuns(cells) {
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const runs = [];
  for (const cell of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.row === cell.row && last.col + last.values.length === cell.col) {
      last.values.push(cellValueForWrite(cell.value));
    } else if (last && last.row === cell.row && last.col + last.values.length - 1 === cell.col) {
      last.values[last.values.length - 1] = cellValueForWrite(cell.value); // same cell twice: last wins
    } else {
      runs.push({ row: cell.row, col: cell.col, values: [cellValueForWrite(cell.value)] });
    }
  }
  return runs;
}

/**
 * @param {object} options
 * @param {() => Promise<string>} options.getAccessToken  the linking person's Graph token
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.baseUrl]  for tests
 * @param {() => number} [options.now]
 */
export function createMsGraphProvider({ getAccessToken, fetch: fetchImpl = globalThis.fetch, baseUrl = GRAPH, now = Date.now } = {}) {
  if (typeof getAccessToken !== 'function') throw new Error('msgraph: getAccessToken is required');
  const sessions = new Map(); // fileId → { id, at }
  const checkedBusiness = new Set();

  async function call(method, path, { body, headers = {}, where = path, raw = false } = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${baseUrl}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!response.ok) throw graphError(response.status, parsed, response.headers, where);
    return parsed;
  }

  async function item(fileId) {
    return call('GET', `${fileId}?$select=id,name,cTag,eTag,webUrl,parentReference`, { where: 'item' });
  }

  async function assertBusiness(fileId) {
    if (checkedBusiness.has(fileId)) return;
    const meta = await item(fileId);
    if (meta?.parentReference?.driveType === 'personal') {
      throw Object.assign(new Error('Microsoft only allows cell edits on work or school files.'), {
        status: 409, code: 'personal-onedrive',
      });
    }
    checkedBusiness.add(fileId);
  }

  async function sessionId(fileId) {
    const open = sessions.get(fileId);
    if (open && now() - open.at < SESSION_TTL_MS) return open.id;
    await assertBusiness(fileId);
    const created = await call('POST', `${fileId}/workbook/createSession`, {
      body: { persistChanges: true }, where: 'createSession',
    });
    sessions.set(fileId, { id: created.id, at: now() });
    return created.id;
  }

  // A workbook call inside the saving session; reopens the session once if it expired.
  async function workbook(fileId, method, path, options = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const id = await sessionId(fileId);
      try {
        const result = await call(method, `${fileId}/workbook/${path}`, {
          ...options, headers: { ...(options.headers || {}), 'workbook-session-id': id },
        });
        sessions.set(fileId, { id, at: now() });
        return result;
      } catch (error) {
        if (attempt === 0 && isSessionGone(error)) { sessions.delete(fileId); continue; }
        throw error;
      }
    }
  }

  const sheetPath = (sheetId) => `worksheets/${encodeURIComponent(sheetId)}`;

  async function usedRange(fileId, sheetId, select) {
    return workbook(fileId, 'GET', `${sheetPath(sheetId)}/usedRange(valuesOnly=true)?$select=${select}`, { where: 'usedRange' });
  }

  async function writeRow(fileId, sheetId, row, col, values) {
    const address = `${cellAddress(row, col)}:${cellAddress(row, col + values.length - 1)}`;
    await workbook(fileId, 'PATCH', `${sheetPath(sheetId)}/range(address='${address}')`, {
      body: { values: [values] }, where: 'write',
    });
  }

  // One sheet per scope (layout.js shape): header row, hidden Row ID column, and a
  // drop-down on pick-one answer columns and the entity column.
  async function addSheet(fileId, scope, layout) {
    const added = await workbook(fileId, 'POST', 'worksheets/add', { body: { name: scope.title }, where: 'addSheet' });
    const columns = scope.columns || (scope.header || []).map((h) => ({ header: typeof h === 'string' ? h : h?.title ?? '' }));
    if (!columns.length) return added.id;
    // As text: a header starting with "=" must never become a live formula.
    await writeRow(fileId, added.id, 0, 0, columns.map((c) => cellValueForWrite(c.header ?? '')));
    const path = sheetPath(added.id);
    if (columns[0]?.key === 'rowId') {
      await workbook(fileId, 'PATCH', `${path}/range(address='A:A')`, { body: { columnHidden: true }, where: 'hideRowId' });
    }
    for (const [index, column] of columns.entries()) {
      const choices = dropDownChoices(column, layout);
      if (!choices) continue;
      const letter = columnLetter(index);
      // A nicety: a workbook without drop-downs still syncs.
      await workbook(fileId, 'PATCH', `${path}/range(address='${letter}2:${letter}${DROP_DOWN_ROWS}')/dataValidation`, {
        body: { rule: { list: { inCellDropDown: true, source: choices } }, errorAlert: { showAlert: false } },
        where: 'dropDown',
      }).catch(() => {});
    }
    await workbook(fileId, 'POST', `${path}/freezePanes/freezeRows`, { body: { count: 1 }, where: 'freezeHeader' }).catch(() => {});
    return added.id;
  }

  return {
    provider: 'msgraph',
    capabilities: Object.freeze({ cellWrites: true }),

    /** The content tag: changes when the cells change, not on a rename or share. */
    async getVersion(fileId) {
      const meta = await item(fileId);
      return meta?.cTag ?? null;
    },

    async readGrid(fileId) {
      const list = await workbook(fileId, 'GET', 'worksheets?$select=id,name,position,visibility', { where: 'worksheets' });
      const sheets = [];
      for (const sheet of [...(list?.value || [])].sort((a, b) => a.position - b.position)) {
        const used = await usedRange(fileId, sheet.id, 'rowIndex,columnIndex,rowCount,columnCount,values,text,numberFormat,valueTypes');
        const rows = [];
        const rowOffset = used?.rowIndex || 0;
        const colOffset = used?.columnIndex || 0;
        const values = used?.values || [];
        // An empty sheet's used range is A1 holding ''.
        const empty = values.length === 1 && values[0].length === 1 && values[0][0] === '';
        if (!empty) {
          for (let r = 0; r < rowOffset; r += 1) rows.push([]);
          values.forEach((line, r) => {
            const out = new Array(colOffset).fill(null);
            line.forEach((value, c) => out.push(plainCell(value, used.text?.[r]?.[c], used.numberFormat?.[r]?.[c], used.valueTypes?.[r]?.[c])));
            while (out.length && out[out.length - 1] === null) out.pop();
            rows.push(out);
          });
        }
        sheets.push({
          sheetId: sheet.id,
          title: sheet.name,
          rows,
          columnCount: empty ? 0 : colOffset + (used?.columnCount || 0),
          hidden: sheet.visibility !== 'Visible',
        });
      }
      return { sheets };
    },

    /** Reads just these cells (one box per sheet), e.g. to re-check Row IDs before a write. */
    async readCells(fileId, cells) {
      const out = new Map();
      for (const [sheetId, group] of bySheet(cells)) {
        const minRow = Math.min(...group.map((c) => c.row));
        const maxRow = Math.max(...group.map((c) => c.row));
        const minCol = Math.min(...group.map((c) => c.col));
        const maxCol = Math.max(...group.map((c) => c.col));
        const address = `${cellAddress(minRow, minCol)}:${cellAddress(maxRow, maxCol)}`;
        const box = await workbook(fileId, 'GET', `${sheetPath(sheetId)}/range(address='${address}')?$select=values,text,numberFormat,valueTypes`, { where: 'readCells' });
        for (const cell of group) {
          const r = cell.row - minRow;
          const c = cell.col - minCol;
          out.set(cell, plainCell(box?.values?.[r]?.[c], box?.text?.[r]?.[c], box?.numberFormat?.[r]?.[c], box?.valueTypes?.[r]?.[c]));
        }
      }
      return (cells || []).map((cell) => out.get(cell) ?? null);
    },

    async writeCells(fileId, cells) {
      for (const [sheetId, group] of bySheet(cells)) {
        for (const run of rowRuns(group)) await writeRow(fileId, sheetId, run.row, run.col, run.values);
      }
    },

    /** Adds rows under the last used row of each sheet. */
    async appendRows(fileId, batches) {
      for (const batch of batches || []) {
        if (!batch?.rows?.length) continue;
        const used = await usedRange(fileId, batch.sheetId, 'rowIndex,rowCount,values');
        const empty = !used?.values?.length || (used.values.length === 1 && used.values[0].every((v) => v === ''));
        const start = empty ? 0 : (used.rowIndex || 0) + (used.rowCount || 0);
        const width = Math.max(batch.width || 0, ...batch.rows.map((row) => row.length));
        if (!width) continue;
        const values = batch.rows.map((row) => Array.from({ length: width }, (_, c) => cellValueForWrite(row[c])));
        const address = `${cellAddress(start, 0)}:${cellAddress(start + values.length - 1, width - 1)}`;
        await workbook(fileId, 'PATCH', `${sheetPath(batch.sheetId)}/range(address='${address}')`, { body: { values }, where: 'appendRows' });
      }
    },

    /** Deletes whole rows, highest first so earlier row numbers stay right. */
    async deleteRows(fileId, rows) {
      const sorted = [...(rows || [])].sort((a, b) => b.row - a.row);
      for (const { sheetId, row } of sorted) {
        const n = row + 1;
        await workbook(fileId, 'POST', `${sheetPath(sheetId)}/range(address='${n}:${n}')/delete`, { body: { shift: 'Up' }, where: 'deleteRows' });
      }
    },

    /**
     * Makes a new workbook in the linking person's OneDrive (folder "Survey"), one
     * sheet per scope with its header row. A personal OneDrive can hold it but can't
     * be synced cell by cell, so it is refused before anything is made.
     */
    async createFile({ title, layout }) {
      const drive = await call('GET', 'me/drive?$select=id,driveType', { where: 'drive' });
      if (drive?.driveType === 'personal') {
        throw Object.assign(new Error('Microsoft only allows cell edits on work or school files.'), {
          status: 409, code: 'personal-onedrive',
        });
      }
      const safeTitle = String(title || 'Survey').replace(/[\\/:*?"<>|#%]/g, '-').slice(0, 120);
      const created = await call(
        'PUT',
        `me/drive/root:/Survey/${encodeURIComponent(safeTitle)}.xlsx:/content?@microsoft.graph.conflictBehavior=rename`,
        { body: blankWorkbookBytes(), raw: true, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, where: 'createFile' },
      );
      const fileId = msgraphFileId(created.parentReference.driveId, created.id);
      checkedBusiness.add(fileId);
      const scopes = layout?.scopes || layout?.sheets || [];
      const sheetIds = {};
      const blank = await workbook(fileId, 'GET', 'worksheets?$select=id,name', { where: 'worksheets' });
      for (const scope of scopes) sheetIds[scope.scopeId] = await addSheet(fileId, scope, layout);
      // The blank file's own first sheet goes once the real ones exist.
      const starter = blank?.value?.[0];
      if (starter && scopes.length) await workbook(fileId, 'DELETE', sheetPath(starter.id), { where: 'deleteStarter' });
      return { fileId, url: created.webUrl, sheetIds };
    },

    /** `scopes` from the layout; `layout` (optional) supplies the drop-down lists. */
    async addTabs(fileId, scopes, layout = null) {
      const sheetIds = {};
      for (const scope of scopes || []) sheetIds[scope.scopeId] = await addSheet(fileId, scope, layout);
      return sheetIds;
    },

    /** Saves and closes the session (optional; Graph also closes it when idle). */
    async close(fileId) {
      const open = sessions.get(fileId);
      if (!open) return;
      sessions.delete(fileId);
      try {
        await call('POST', `${fileId}/workbook/closeSession`, { headers: { 'workbook-session-id': open.id }, body: {}, where: 'closeSession' });
      } catch { /* already gone */ }
    },
  };
}

// --- A blank one-sheet .xlsx, built here so the edge function needs no Excel library.
// Stored (uncompressed) zip entries; Excel and Graph open it like any other file.

const BLANK_PARTS = [
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'],
];

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function blankWorkbookBytes() {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, xml] of BLANK_PARTS) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(xml);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, BLANK_PARTS.length, true);
  end.setUint16(10, BLANK_PARTS.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
