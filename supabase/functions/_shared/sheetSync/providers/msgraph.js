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
import { cellError, fetchWithTimeout, REQUEST_TIMEOUT_MS } from './contract.js';
import { buildLiveWorkbook, excelSheetNames } from './liveWorkbook.js';
import { trackingChoices } from '../layout.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
// Graph closes a saving session after about 5 minutes idle; reopen a bit before.
const SESSION_TTL_MS = 4 * 60 * 1000;
// "Save in" lists up to 10 pages of 200 folders in one folder.
const FOLDER_PAGES = 10;


// "A/B" -> "A/B/" with each name URL-encoded; '' -> '' (the drive's top).
function folderPath(folder) {
  const parts = String(folder || '').split('/').filter(Boolean);
  return parts.length ? `${parts.map(encodeURIComponent).join('/')}/` : '';
}

// A folder outside the person's own OneDrive (a SharePoint or Teams library,
// reached by a pasted link or a "shortcut to My files") starts with
// "~<driveId>~<itemId>"; the rest is a path inside it, as for OneDrive.
const PLACE = /^~([A-Za-z0-9!_-]{1,200})~([A-Za-z0-9!_-]{1,200})$/;
export function placeToken(driveId, itemId) {
  return `~${driveId}~${itemId}`;
}
/** Where a folder string points: the Graph item to address, and the path under it. */
export function folderTarget(folder) {
  const parts = String(folder || '').split('/').filter(Boolean);
  const place = parts.length ? PLACE.exec(parts[0]) : null;
  if (!place) return { base: 'me/drive/root', driveId: null, sub: parts.join('/') };
  return { base: `drives/${place[1]}/items/${place[2]}`, driveId: place[1], sub: parts.slice(1).join('/') };
}
const under = (base, sub) => (sub ? `${base}:/${folderPath(sub).replace(/\/$/, '')}:` : base);

/** The "u!…" id Graph's /shares takes for a sharing link. */
export function shareIdOf(url) {
  const b64 = typeof btoa === 'function'
    ? btoa(String.fromCharCode(...new TextEncoder().encode(String(url))))
    : Buffer.from(String(url)).toString('base64');
  return `u!${b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
}

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

// Graph's $batch takes at most 20 requests.
const BATCH_SIZE = 20;
// Whole-sheet reads in one $batch: big sheets answer megabytes each.
const GRID_BATCH = 8;
// Excel saves scattered cells at about 30 a second (2,500 single-cell edits
// on a 5,000-row sheet took 83 s, real Excel 11-10), so a big offline
// catch-up could outlast the edge function and every retry would start
// over. Writes stop between batches after this long and the round ends as
// "busy"; what landed matches the app, so the next round writes only the rest.
const WRITE_BUDGET_MS = 60_000;

// Drop-downs cover this many rows, like the desktop export.
const DROP_DOWN_ROWS = 1000;
const TEXT_KINDS = new Set(['choice', 'text', 'many']);
// The same columns Google's provider formats as text (google.js textFormatRequests).
const isTextColumn = (col) => ['rowId', 'changedBy', 'item', 'entity', 'notes', 'status', 'assignee'].includes(col?.key)
  || (String(col?.key || '').startsWith('answer:') && TEXT_KINDS.has(col.item?.kind || 'choice'));

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
  else choices = trackingChoices(column, layout);
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
 * Row runs stacked into blocks: runs in the same columns on rows one under
 * another become one rectangle, so 300 notes down one column are one write
 * (Graph took ~3.5 s per 20-write batch: 300 edits ran ~1 minute).
 */
export function cellBlocks(cells) {
  const runs = rowRuns(cells).sort((a, b) => a.col - b.col || a.values.length - b.values.length || a.row - b.row);
  const blocks = [];
  for (const run of runs) {
    const last = blocks[blocks.length - 1];
    if (last && last.col === run.col && last.values[0].length === run.values.length && last.row + last.values.length === run.row) {
      last.values.push(run.values);
    } else {
      blocks.push({ row: run.row, col: run.col, values: [run.values] });
    }
  }
  return blocks;
}

/**
 * Side-by-side columns that get the same value from `valueOf` (null = none),
 * as { from, to, value } runs: one Graph call per run instead of per column.
 */
export function columnRuns(columns, valueOf) {
  const runs = [];
  (columns || []).forEach((column, index) => {
    const value = valueOf(column);
    if (value === null || value === undefined) return;
    const last = runs[runs.length - 1];
    if (last && last.to === index - 1 && last.value === value) last.to = index;
    else runs.push({ from: index, to: index, value });
  });
  return runs;
}

/**
 * @param {object} options
 * @param {() => Promise<string>} options.getAccessToken  the linking person's Graph token
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.baseUrl]  for tests
 * @param {() => number} [options.now]
 */
export function createMsGraphProvider({ getAccessToken, fetch: fetchImpl = globalThis.fetch, baseUrl = GRAPH, now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (typeof getAccessToken !== 'function') throw new Error('msgraph: getAccessToken is required');
  const sessions = new Map(); // fileId → { id, at }
  const checkedBusiness = new Set();
  const lastEditors = new Map(); // fileId -> { name, email, me, at }, from the last item read

  // `discard`: the caller needs no answer. Graph answers a range write with the
  // whole range (values, text, formulas, formats...), which for a big range is
  // tens of megabytes; on success the body is dropped unread.
  async function call(method, path, { body, headers = {}, where = path, raw = false, discard = false } = {}) {
    const token = await getAccessToken();
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    }, timeoutMs);
    if (discard && response.ok) {
      try { await response.body?.cancel?.(); } catch { /* already closed */ }
      return null;
    }
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!response.ok) throw graphError(response.status, parsed, response.headers, where);
    return parsed;
  }

  async function item(fileId) {
    const meta = await call('GET', `${fileId}?$select=id,name,cTag,eTag,webUrl,parentReference,lastModifiedBy,lastModifiedDateTime`, { where: 'item' });
    const u = meta?.lastModifiedBy?.user;
    lastEditors.set(fileId, u ? { name: u.displayName || '', email: u.email || '', me: false, at: meta.lastModifiedDateTime || null } : null);
    return meta;
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

  // Many workbook calls in Graph's $batch (20 per request, run in order), so
  // a round writing 300 rows makes 15 requests, not 300: one at a time, a
  // big round ran for minutes, near the edge function's time limit.
  // `parallel`: the ops touch different cells, so Graph may run them at once
  // (200 scattered single-cell writes: 21 s chained, 12 s parallel, measured
  // 11-09). Otherwise each waits for the one before (row deletes, in order).
  // `size`: requests per $batch (Graph takes at most 20); reads of whole
  // sheets go fewer at a time so one answer stays a few megabytes.
  // `deadline`: stop between batches once past it (see WRITE_BUDGET_MS).
  // `allow`: statuses that answer null instead of failing the batch.
  async function workbookBatch(fileId, ops, { parallel = false, size = BATCH_SIZE, deadline = null, allow = [] } = {}) {
    const bodies = [];
    for (let i = 0; i < ops.length; i += size) {
      if (deadline != null && i > 0 && now() > deadline) {
        throw Object.assign(new Error(`Saved ${i} of ${ops.length} changes to the workbook; the rest go in the next round.`), {
          status: 503, code: 'partial', retryAfterMs: 10_000,
        });
      }
      const chunk = ops.slice(i, i + size);
      for (let attempt = 0; ; attempt += 1) {
        const id = await sessionId(fileId);
        const requests = chunk.map((op, j) => ({
          id: String(j + 1),
          method: op.method,
          url: `/${fileId}/workbook/${op.path}`,
          headers: { 'Content-Type': 'application/json', 'workbook-session-id': id },
          ...(op.body !== undefined ? { body: op.body } : {}),
          ...(j && !parallel ? { dependsOn: [String(j)] } : {}),
        }));
        const res = await call('POST', '$batch', { body: { requests }, where: 'batch' });
        const answers = [...(res?.responses || [])].sort((a, b) => Number(a.id) - Number(b.id));
        // The first real failure (later ones only say "424: an earlier one failed").
        const failed = answers.find((a) => Number(a.status) >= 300 && Number(a.status) !== 424 && !allow.includes(Number(a.status)))
          || (answers.length < chunk.length ? { status: 500, body: null } : null);
        if (!failed) { sessions.set(fileId, { id, at: now() }); bodies.push(...answers.map((a) => (Number(a.status) < 300 ? a.body ?? null : null))); break; }
        const headers = { get: (k) => failed.headers?.[k] ?? failed.headers?.[String(k).toLowerCase()] ?? failed.headers?.[String(k).replace(/^\w/, (c) => c.toUpperCase())] ?? null };
        const error = graphError(Number(failed.status), failed.body, headers, 'batch');
        if (attempt === 0 && isSessionGone(error)) { sessions.delete(fileId); continue; }
        throw error;
      }
    }
    return bodies;
  }

  const sheetPath = (sheetId) => `worksheets/${encodeURIComponent(sheetId)}`;

  async function usedRange(fileId, sheetId, select) {
    return workbook(fileId, 'GET', `${sheetPath(sheetId)}/usedRange(valuesOnly=true)?$select=${select}`, { where: 'usedRange' });
  }

  // Where new rows go: under the last row holding anything in the columns
  // Survey writes (A to `width`), not under a PM's stray cell far off to the
  // right (a note typed in Z400 put new items at row 400, real Excel 11-10).
  // Graph answers 404 when those columns are empty. Only the address is
  // asked for: the old read of every value was 2 MB on a 5,000-row sheet.
  const endPath = (sheetId, width) => `${sheetPath(sheetId)}/range(address='A:${columnLetter(Math.max(0, width - 1))}')/usedRange(valuesOnly=true)?$select=rowIndex,rowCount`;
  const endRow = (used) => (used ? (used.rowIndex || 0) + (used.rowCount || 0) : 0);
  // The columns the new rows really fill (rows come padded to the sheet's width).
  const filledWidth = (rows) => Math.max(1, ...rows.map((row) => {
    let n = row.length;
    while (n > 0 && (row[n - 1] === '' || row[n - 1] == null)) n -= 1;
    return n;
  }));

  async function writeBlock(fileId, sheetId, row, col, values) {
    const address = `${cellAddress(row, col)}:${cellAddress(row + values.length - 1, col + values[0].length - 1)}`;
    await workbook(fileId, 'PATCH', `${sheetPath(sheetId)}/range(address='${address}')`, {
      body: { values }, where: 'write', discard: true,
    });
  }

  // What a tab added after linking needs once it exists: its header row, the
  // Row ID column hidden, and text columns as text. All of it goes out in one
  // parallel $batch with every other new tab's (40 tabs: 33 s one call at a
  // time, real Excel 11-10). `?$select=address` keeps Graph from answering
  // each range write with the whole range (40 KB for a 999-row column).
  // Not here, because Graph has no API for them (v1.0 and beta answer 400
  // "Resource not found for the segment", checked in a real tenant 11-09 and
  // 11-10): drop-downs (dataValidation) and the frozen header (freezePanes).
  // A new workbook gets both in its upload (liveWorkbook.js); typed values
  // are still checked by the merge.
  function sheetSetupOps(sheetId, scope) {
    const columns = scope.columns || (scope.header || []).map((h) => ({ header: typeof h === 'string' ? h : h?.title ?? '' }));
    if (!columns.length) return [];
    const path = sheetPath(sheetId);
    const range = (address) => `${path}/range(address='${address}')?$select=address`;
    // As text: a header starting with "=" must never become a live formula.
    const ops = [{ method: 'PATCH', path: range(`A1:${columnLetter(columns.length - 1)}1`), body: { values: [columns.map((c) => cellValueForWrite(c.header ?? ''))] } }];
    if (columns[0]?.key === 'rowId') {
      // One cell hides its whole column. Never address the column itself
      // ('A:A'): Graph answers with all 1,048,576 rows of it, which ran the
      // edge function out of memory on the first real workbook (Nov 3).
      ops.push({ method: 'PATCH', path: range('A1'), body: { columnHidden: true } });
    }
    // Text columns as text ("@"), the way Google's are: a PM typing 00123
    // or 1/2 in a note keeps what they typed instead of a number or a date.
    for (const run of columnRuns(columns, (column) => (isTextColumn(column) ? '@' : null))) {
      const width = run.to - run.from + 1;
      const formats = Array.from({ length: DROP_DOWN_ROWS - 1 }, () => Array(width).fill('@'));
      ops.push({ method: 'PATCH', path: range(`${columnLetter(run.from)}2:${columnLetter(run.to)}${DROP_DOWN_ROWS}`), body: { numberFormat: formats }, optional: true });
    }
    return ops;
  }

  async function listTabs(fileId) {
    const list = await workbook(fileId, 'GET', 'worksheets?$select=id,name', { where: 'worksheets' });
    return (list?.value || []).map((s) => ({ id: String(s.id), name: String(s.name) }));
  }

  return {
    provider: 'msgraph',
    capabilities: Object.freeze({ cellWrites: true }),

    /** The content tag: changes when the cells change, not on a rename or share. */
    async getVersion(fileId) {
      const meta = await item(fileId);
      return meta?.cTag ?? null;
    },

    // Excel on the web saves typed cells 4 to 90 s late (measured 11-10: 3 s to over 2 min).
    savesLate: true,

    // Who last changed the workbook, as the last getVersion saw it.
    lastEditor(fileId) {
      return lastEditors.get(fileId) || null;
    },

    // `opts.sheetIds`: read only these sheets (the synced ones), so a big
    // sheet a PM added for their own notes costs no calls. A synced sheet
    // someone deleted is simply missing, which the round reports.
    /** Every sheet in the workbook as { id, name } (no cells read). */
    tabs: listTabs,

    /** The names of every sheet in the workbook (no cells read). */
    async tabTitles(fileId) {
      return (await listTabs(fileId)).map((t) => t.name);
    },

    async readGrid(fileId, { sheetIds = null } = {}) {
      const list = await workbook(fileId, 'GET', 'worksheets?$select=id,name,position,visibility', { where: 'worksheets' });
      const only = sheetIds?.length ? new Set(sheetIds.map(String)) : null;
      const sheets = [];
      const wanted = [...(list?.value || [])].sort((a, b) => a.position - b.position)
        .filter((sheet) => !only || only.has(String(sheet.id)));
      // Every sheet's cells in a few parallel $batch calls instead of one
      // call a sheet (a quiet round on 40 tabs: 3 s one at a time, real Excel 11-10).
      const select = 'rowIndex,columnIndex,rowCount,columnCount,values,text,numberFormat,valueTypes';
      const useds = wanted.length > 1
        ? await workbookBatch(fileId, wanted.map((sheet) => ({ method: 'GET', path: `${sheetPath(sheet.id)}/usedRange(valuesOnly=true)?$select=${select}` })), { parallel: true, size: GRID_BATCH })
        : await Promise.all(wanted.map((sheet) => usedRange(fileId, sheet.id, select)));
      for (const [index, sheet] of wanted.entries()) {
        const used = useds[index];
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
      const boxes = [...bySheet(cells)].map(([sheetId, group]) => {
        const minRow = Math.min(...group.map((c) => c.row));
        const maxRow = Math.max(...group.map((c) => c.row));
        const minCol = Math.min(...group.map((c) => c.col));
        const maxCol = Math.max(...group.map((c) => c.col));
        const address = `${cellAddress(minRow, minCol)}:${cellAddress(maxRow, maxCol)}`;
        return { group, minRow, minCol, path: `${sheetPath(sheetId)}/range(address='${address}')?$select=values,text,numberFormat,valueTypes` };
      });
      // One sheet: one call. Several: one parallel $batch, not a call a sheet.
      const answers = boxes.length > 1
        ? await workbookBatch(fileId, boxes.map((b) => ({ method: 'GET', path: b.path })), { parallel: true, size: GRID_BATCH })
        : await Promise.all(boxes.map((b) => workbook(fileId, 'GET', b.path, { where: 'readCells' })));
      for (const [index, { group, minRow, minCol }] of boxes.entries()) {
        const box = answers[index];
        for (const cell of group) {
          const r = cell.row - minRow;
          const c = cell.col - minCol;
          out.set(cell, plainCell(box?.values?.[r]?.[c], box?.text?.[r]?.[c], box?.numberFormat?.[r]?.[c], box?.valueTypes?.[r]?.[c]));
        }
      }
      return (cells || []).map((cell) => out.get(cell) ?? null);
    },

    async writeCells(fileId, cells) {
      const ops = [];
      for (const [sheetId, group] of bySheet(cells)) {
        for (const block of cellBlocks(group)) {
          const address = `${cellAddress(block.row, block.col)}:${cellAddress(block.row + block.values.length - 1, block.col + block.values[0].length - 1)}`;
          // `$select`: Graph would answer each write with the whole range.
          ops.push({ sheetId, block, method: 'PATCH', path: `${sheetPath(sheetId)}/range(address='${address}')?$select=address`, body: { values: block.values } });
        }
      }
      if (ops.length <= 2) {
        for (const op of ops) await writeBlock(fileId, op.sheetId, op.block.row, op.block.col, op.block.values);
        return;
      }
      await workbookBatch(fileId, ops, { parallel: true, deadline: now() + WRITE_BUDGET_MS });
    },

    /** Adds rows under the last used row of each sheet. */
    async appendRows(fileId, batches) {
      const todo = (batches || []).filter((b) => b?.rows?.length && Math.max(b.width || 0, ...b.rows.map((row) => row.length)) > 0);
      const oneEach = new Set(todo.map((b) => String(b.sheetId))).size === todo.length;
      if (todo.length > 1 && oneEach && todo.every((b) => b.before == null)) {
        // New rows on several tabs (the first round, a tab put back): every
        // tab's end in one parallel $batch, then every tab's rows in another,
        // instead of two calls a tab one after another.
        const widthOf = (batch) => Math.max(batch.width || 0, ...batch.rows.map((row) => row.length));
        const ends = await workbookBatch(fileId, todo.map((b) => ({ method: 'GET', path: endPath(b.sheetId, filledWidth(b.rows)) })), { parallel: true, size: GRID_BATCH, allow: [404] });
        const writes = todo.map((batch, i) => {
          const start = endRow(ends[i]);
          const width = widthOf(batch);
          const values = batch.rows.map((row) => Array.from({ length: width }, (_, c) => cellValueForWrite(row[c])));
          const address = `${cellAddress(start, 0)}:${cellAddress(start + values.length - 1, width - 1)}`;
          return { method: 'PATCH', path: `${sheetPath(batch.sheetId)}/range(address='${address}')?$select=address`, body: { values } };
        });
        await workbookBatch(fileId, writes, { parallel: true, size: GRID_BATCH });
        return;
      }
      for (const batch of batches || []) {
        if (!batch?.rows?.length) continue;
        const width = Math.max(batch.width || 0, ...batch.rows.map((row) => row.length));
        if (!width) continue;
        let start;
        if (batch.before != null) {
          // Above the PM's totals line (`before`), so it stays last.
          start = batch.before;
          await workbook(fileId, 'POST', `${sheetPath(batch.sheetId)}/range(address='${start + 1}:${start + batch.rows.length}')/insert`, { body: { shift: 'Down' }, where: 'appendRows', discard: true });
        } else {
          const used = await workbook(fileId, 'GET', endPath(batch.sheetId, filledWidth(batch.rows)), { where: 'appendRows' }).catch((err) => {
            if (Number(err?.status) === 404) return null;
            throw err;
          });
          start = endRow(used);
        }
        const values = batch.rows.map((row) => Array.from({ length: width }, (_, c) => cellValueForWrite(row[c])));
        const address = `${cellAddress(start, 0)}:${cellAddress(start + values.length - 1, width - 1)}`;
        await workbook(fileId, 'PATCH', `${sheetPath(batch.sheetId)}/range(address='${address}')`, { body: { values }, where: 'appendRows', discard: true });
      }
    },

    /** Deletes whole rows, highest first so earlier row numbers stay right. */
    async deleteRows(fileId, rows) {
      // Rows next to each other on a tab go in one call ('7:9'), highest first.
      const runs = [];
      for (const [sheetId, group] of bySheet(rows)) {
        const sorted = [...new Set(group.map((r) => r.row))].sort((a, b) => b - a);
        for (const row of sorted) {
          const last = runs[runs.length - 1];
          if (last && last.sheetId === sheetId && last.from === row + 1) last.from = row;
          else runs.push({ sheetId, from: row, to: row });
        }
      }
      const ops = runs.map(({ sheetId, from, to }) => ({ method: 'POST', path: `${sheetPath(sheetId)}/range(address='${from + 1}:${to + 1}')/delete`, body: { shift: 'Up' } }));
      if (ops.length > 2) { await workbookBatch(fileId, ops, { deadline: now() + WRITE_BUDGET_MS }); return; }
      for (const op of ops) await workbook(fileId, op.method, op.path, { body: op.body, where: 'deleteRows', discard: true });
    },

    // The folders inside one folder, by name. At the top of the person's
    // OneDrive, a SharePoint/Teams folder they added as a shortcut comes back
    // in `places` with the folder string that opens it.
    async listFolders(folder = '') {
      const target = folderTarget(folder);
      const path = `${under(target.base, target.sub)}/children`;
      const folders = [];
      const places = [];
      let next = `${path}?$select=name,folder,remoteItem&$top=200`;
      for (let page = 0; next && page < FOLDER_PAGES; page += 1) {
        let res;
        try { res = await call('GET', next, { where: 'folders' }); } catch (err) {
          // A SharePoint/Teams folder renamed away, moved or deleted since it
          // was picked. (A OneDrive path that isn't there yet is fine: saving
          // makes it, as for the default "Survey" folder.)
          if (err?.status === 404 && target.driveId) return { folders: [], places: [], gone: true };
          // An account with no OneDrive of its own (a guest, or no OneDrive
          // licence: Graph answers 401 accessDenied / 403 notAllowed, or 404
          // at the top of "my drive"). It can still save in SharePoint or
          // Teams. Save in opens on the default "Survey" folder, so this is
          // checked below the top too.
          const status = Number(err?.status);
          const tokenTrouble = /token/i.test(String(err?.code || ''));
          if (!target.driveId && !tokenTrouble && ([401, 403].includes(status) || (status === 404 && !target.sub))) {
            return { folders: [], places: [], noDrive: true };
          }
          if (status === 404 && target.sub) return { folders: [], places: [] };
          throw err;
        }
        for (const it of res?.value || []) {
          if (it?.folder) folders.push(String(it.name));
          else if (it?.remoteItem?.folder && it.remoteItem.id && it.remoteItem.parentReference?.driveId) {
            places.push({ name: String(it.name), folder: placeToken(it.remoteItem.parentReference.driveId, it.remoteItem.id) });
          }
        }
        const link = res?.['@odata.nextLink'];
        next = link ? link.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0\//, '') : null;
      }
      folders.sort((a, b) => a.localeCompare(b));
      places.sort((a, b) => a.name.localeCompare(b.name));
      // A library with more folders than one look lists: say so, so the panel
      // can point to the paste-a-link box instead of a list that looks whole.
      return { folders, places, ...(next ? { more: true } : {}) };
    },

    /**
     * A SharePoint, Teams or OneDrive folder link pasted by the person, as a
     * folder string ("~drive~item") and its name. Graph's /shares opens any
     * sharing link or plain address the person can reach.
     */
    async resolveFolderLink(url) {
      let it;
      try {
        it = await call('GET', `shares/${shareIdOf(url)}/driveItem?$select=id,name,folder,file,parentReference`, { where: 'shares' });
      } catch (err) {
        if ([400, 403, 404].includes(Number(err?.status))) {
          throw Object.assign(new Error('Survey could not open that link with your Microsoft sign-in. Copy the folder\'s link from SharePoint or Teams and try again.'), { status: 400, code: 'bad_folder_link' });
        }
        throw err;
      }
      if (!it?.folder) {
        throw Object.assign(new Error('That link is to a file. Paste the link to the folder it should go in.'), { status: 400, code: 'not_a_folder' });
      }
      return { folder: placeToken(it.parentReference?.driveId, it.id), name: String(it.name || 'Folder') };
    },

    /**
     * A workbook the PM already has, from a pasted OneDrive, SharePoint or
     * Teams link: { fileId, url, title }. Survey adds its own sheets to it
     * (the round's new-tab path, named apart from the sheets already there)
     * and leaves the PM's sheets as they are. Only .xlsx opens cell by cell.
     */
    async openFile(url) {
      let it;
      try {
        it = await call('GET', `shares/${shareIdOf(url)}/driveItem?$select=id,name,file,folder,webUrl,parentReference`, { where: 'shares' });
      } catch (err) {
        if ([400, 403, 404].includes(Number(err?.status))) {
          throw Object.assign(new Error('Survey could not open that link with your Microsoft sign-in. Copy the workbook\'s link from Excel (Share > Copy link) and try again.'), { status: 400, code: 'bad_file_link' });
        }
        throw err;
      }
      if (it?.folder || !it?.file) {
        throw Object.assign(new Error('That link is to a folder. Paste the link to the workbook itself.'), { status: 400, code: 'not_a_file' });
      }
      if (!/\.xlsx$/i.test(String(it.name || ''))) {
        throw Object.assign(new Error('Survey can sync .xlsx workbooks. In Excel, save it as an Excel Workbook (.xlsx) and paste its link again.'), { status: 400, code: 'not_xlsx' });
      }
      const place = String(it.parentReference?.name || '').trim();
      return {
        fileId: msgraphFileId(it.parentReference?.driveId, it.id),
        url: it.webUrl || null,
        title: String(it.name).replace(/\.xlsx$/i, ''),
        ...(place && place !== 'root' ? { folderLabel: place } : {}),
      };
    },

    /**
     * Makes a new workbook in the linking person's OneDrive, one sheet per scope
     * with its header row. `folder`: "A/B" under the drive's top ('' = the top
     * itself); default "Survey". A personal OneDrive can hold it but can't be
     * synced cell by cell, so it is refused before anything is made.
     */
    async createFile({ title, layout, answerFills, folder = 'Survey' }) {
      const target = folderTarget(folder);
      let drive;
      try {
        drive = await call('GET', target.driveId ? `drives/${target.driveId}?$select=id,driveType` : 'me/drive?$select=id,driveType', { where: 'drive' });
      } catch (err) {
        if ([401, 403, 404].includes(Number(err?.status)) && !/token/i.test(String(err?.code || ''))) {
          throw target.driveId
            ? Object.assign(new Error('Survey could not open that folder with your Microsoft sign-in. It may have been moved or deleted, or you lost access. Pick another folder under Save in.'), { status: 409, code: 'folder_gone' })
            : Object.assign(new Error('Your Microsoft account has no OneDrive. Paste a SharePoint or Teams folder link under Save in, or use a workbook you already have.'), { status: 409, code: 'no_onedrive' });
        }
        throw err;
      }
      if (drive?.driveType === 'personal') {
        throw Object.assign(new Error('Microsoft only allows cell edits on work or school files.'), {
          status: 409, code: 'personal-onedrive',
        });
      }
      const safeTitle = String(title || 'Survey').replace(/[\\/:*?"<>|#%]/g, '-').slice(0, 120);
      // The whole workbook, formatted like the app's Export data workbook, in
      // one upload (liveWorkbook.js): no per-sheet set-up calls.
      const scopes = layout?.scopes || layout?.sheets || [];
      const built = buildLiveWorkbook({ ...(layout || {}), scopes }, { answerFills });
      let created;
      try {
        created = await call(
          'PUT',
          `${target.base}:/${folderPath(target.sub)}${encodeURIComponent(safeTitle)}.xlsx:/content?@microsoft.graph.conflictBehavior=rename`,
          { body: built.bytes, raw: true, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, where: 'createFile' },
        );
      } catch (err) {
        // A SharePoint/Teams folder picked earlier that is gone now, or that
        // this account can only view.
        if (target.driveId && [403, 404].includes(Number(err?.status))) {
          throw Object.assign(new Error(err.status === 404
            ? 'That folder was moved or deleted. Pick another folder under Save in.'
            : 'You can view that folder but not add files to it. Pick another folder under Save in.'), { status: 409, code: 'folder_gone' });
        }
        throw err;
      }
      const fileId = msgraphFileId(created.parentReference.driveId, created.id);
      checkedBusiness.add(fileId);
      const sheetIds = {};
      if (scopes.length) {
        const sheets = await workbook(fileId, 'GET', 'worksheets?$select=id,name,position', { where: 'worksheets' });
        const byPosition = [...(sheets?.value || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        scopes.forEach((scope, i) => {
          const sheet = byPosition.find((s) => s.name === built.sheetNames[i]) || byPosition[i];
          if (sheet) sheetIds[scope.scopeId] = sheet.id;
        });
      }
      // "Kal Voe Team › Jobs" for a SharePoint folder, shown as where the file lives.
      let folderLabel;
      if (target.driveId) {
        const top = await call('GET', `${target.base}?$select=name`, { where: 'folder' }).catch(() => null);
        folderLabel = [top?.name || 'SharePoint', ...target.sub.split('/').filter(Boolean)].join(' › ');
      }
      return { fileId, url: created.webUrl, sheetIds, folder: String(folder || ''), ...(folderLabel ? { folderLabel } : {}), title: String(created.name || '').replace(/\.xlsx$/i, '') || undefined };
    },

    /** `scopes` from the layout (a third `layout` argument is no longer needed). */
    // Excel refuses a sheet name over 31 characters or holding []:*?/\ (Google
    // allows 100), and a refused add failed every round after a category with
    // a long name was added to the template. Names are made Excel-safe and
    // kept clear of the sheets already there.
    async addTabs(fileId, scopes) {
      if (!scopes?.length) return {};
      const list = await workbook(fileId, 'GET', 'worksheets?$select=name', { where: 'worksheets' });
      const had = new Set((list?.value || []).map((s) => s.name));
      const names = excelSheetNames(scopes.map((s) => s.title), [...had]);
      const sheetIds = {};
      const setup = [];
      try {
        // Every tab in one $batch, each after the one before (tab order kept).
        const added = await workbookBatch(fileId, names.map((name) => ({ method: 'POST', path: 'worksheets/add', body: { name } })));
        scopes.forEach((scope, i) => {
          const id = added[i]?.id;
          if (id == null) throw Object.assign(new Error('Microsoft did not say which sheet it added.'), { status: 502 });
          sheetIds[scope.scopeId] = id;
          setup.push(...sheetSetupOps(id, scope));
        });
        await workbookBatch(fileId, setup.filter((op) => !op.optional), { parallel: true });
      } catch (err) {
        // Tabs added but not set up are taken away again: left there, they
        // hold their names and the next round adds " (2)" copies beside them.
        try {
          const now = await workbook(fileId, 'GET', 'worksheets?$select=id,name', { where: 'worksheets' });
          const ours = (now?.value || []).filter((s) => names.includes(s.name) && !had.has(s.name));
          if (ours.length) await workbookBatch(fileId, ours.map((s) => ({ method: 'DELETE', path: sheetPath(s.id) })), { parallel: true });
        } catch { /* the next round's names step around them */ }
        throw err;
      }
      // Text formats are a nicety: a refused one must not fail the tabs.
      await workbookBatch(fileId, setup.filter((op) => op.optional), { parallel: true }).catch(() => {});
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
