// Google Sheets for the live sheet sync (contract.js). Only the drive.file
// scope: the app reaches files it made or the person opened with it, nothing
// else in their Drive (Google lists it as non-sensitive, so no security
// review). Sheets API v4 + Drive API v3 over fetch, no SDK, so Deno and node
// tests load it as is. Base URLs can point at a fake Google for tests.
//
// Quota (developers.google.com/workspace/sheets/api/limits): 60 reads and 60
// writes per minute per person, 300 per project. A round costs one Drive
// call when nothing changed, plus one read and at most three writes when
// something did; the runner spaces rounds out, and a 429 backs it off.
import { providerError, cellError } from './contract.js';

export const GOOGLE_SCOPES = Object.freeze(['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);

const DATE_TYPES = new Set(['DATE', 'TIME', 'DATE_TIME']);
const ROW_ID_HEADER_GREY = { red: 0.75, green: 0.75, blue: 0.75 };
// Biggest sheet a round reads (cells across the synced tabs). Past it a round
// would run out of the edge function's time and memory on every try.
export const MAX_GRID_CELLS = 250000;
const GRID_FIELDS = 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),'
  + 'data(startRow,startColumn,rowData(values(effectiveValue,formattedValue,effectiveFormat/numberFormat/type))))';
// Columns a person types words into: formatted as plain text, so Google keeps
// "00123", a 20-digit serial number or "3/4" as typed instead of turning them
// into numbers or dates (as the export's columns are).
const TEXT_KINDS = new Set(['choice', 'text', 'many']);

export const googleEndpoints = (env = {}) => ({
  auth: env.GOOGLE_OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  revoke: env.GOOGLE_OAUTH_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
  sheets: (env.GOOGLE_SHEETS_API_BASE || 'https://sheets.googleapis.com').replace(/\/$/, ''),
  drive: (env.GOOGLE_DRIVE_API_BASE || 'https://www.googleapis.com').replace(/\/$/, ''),
});

/** Google's consent page URL for a new connection. */
export function googleAuthUrl({ endpoints, clientId, redirectUri, state, loginHint }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', // a refresh token, so syncing keeps working without the person
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `${endpoints.auth}?${q}`;
}

async function tokenCall(endpoints, fetchImpl, form) {
  const res = await fetchImpl(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant: the person revoked access or the token expired.
    throw providerError(`google token: ${body?.error || res.status}`, body?.error === 'invalid_grant' ? 401 : res.status);
  }
  return body;
}

const emailFromIdToken = (idToken) => {
  try {
    const part = String(idToken || '').split('.')[1] || '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof json.email === 'string' ? json.email : null;
  } catch {
    return null;
  }
};

/** Trade the consent page's code for tokens: { refreshToken, accessToken, expiresAt, email, scope }. */
export async function exchangeGoogleCode({ endpoints, clientId, clientSecret, redirectUri, code, fetchImpl = fetch }) {
  const body = await tokenCall(endpoints, fetchImpl, {
    code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
  if (!body.refresh_token) throw providerError('google token: no refresh token', 400);
  return {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    email: emailFromIdToken(body.id_token),
    scope: String(body.scope || ''),
  };
}

/** A fresh access token from a refresh token: { accessToken, expiresAt }. */
export async function refreshGoogleToken({ endpoints, clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const body = await tokenCall(endpoints, fetchImpl, {
    refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
  });
  return { accessToken: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
}

/** Tell Google to forget a token (best effort). */
export async function revokeGoogleToken({ endpoints, token, fetchImpl = fetch }) {
  try {
    await fetchImpl(`${endpoints.revoke}?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch { /* the token is deleted on our side either way */ }
}

// A Sheets date serial (days since 1899-12-30) as YYYY-MM-DD.
const isoDay = (serial) => new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);

const cellOf = (c) => {
  if (!c || typeof c !== 'object') return null;
  const v = c.effectiveValue;
  if (v && 'errorValue' in v) return cellError(c.formattedValue || '#ERROR!');
  const type = c.effectiveFormat?.numberFormat?.type;
  if (type === 'DATE' && typeof v?.numberValue === 'number' && Number.isInteger(v.numberValue)) return isoDay(v.numberValue);
  if (type && DATE_TYPES.has(type)) return c.formattedValue ?? null;
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('numberValue' in v) return v.numberValue;
  if ('boolValue' in v) return v.boolValue;
  return null; // anything new
};

// Rows of one GridData block, placed at its start row and column.
const placeRows = (grid, into = []) => {
  const r0 = Number(grid?.startRow) || 0;
  const c0 = Number(grid?.startColumn) || 0;
  (grid?.rowData || []).forEach((r, i) => {
    const row = into[r0 + i] || (into[r0 + i] = []);
    (r?.values || []).forEach((cell, j) => { row[c0 + j] = cellOf(cell); });
  });
  return into;
};

const cellData = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  // stringValue is stored as text even when it starts with "=".
  return { userEnteredValue: { stringValue: value == null ? '' : String(value) } };
};

const headerCell = (text) => ({
  userEnteredValue: { stringValue: String(text) },
  userEnteredFormat: { textFormat: { bold: true }, backgroundColor: ROW_ID_HEADER_GREY, horizontalAlignment: 'CENTER' },
});

// Drop-down lists for entity and pick-one answer columns, like the Excel export.
function validationRequests(sheetId, scope, layout) {
  const out = [];
  scope.columns.forEach((col, i) => {
    let values = null;
    if (col.key === 'entity') values = layout.entities.map((e) => e.name);
    else if (col.key.startsWith('answer:') && (!col.item?.kind || col.item.kind === 'choice')) values = layout.answerValues;
    if (!values?.length) return;
    out.push({
      setDataValidation: {
        // No end row: the whole column, however long the survey gets.
        range: { sheetId: Number(sheetId), startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: String(v) })) },
          showCustomUi: true,
          strict: false, // a typed value is read and checked by the sync, never refused by the sheet
        },
      },
    });
  });
  return out;
}

function textFormatRequests(sheetId, scope) {
  const out = [];
  scope.columns.forEach((col, i) => {
    const text = ['rowId', 'changedBy', 'item', 'entity', 'notes'].includes(col.key)
      || (col.key.startsWith('answer:') && TEXT_KINDS.has(col.item?.kind || 'choice'));
    if (!text) return;
    out.push({
      repeatCell: {
        range: { sheetId: Number(sheetId), startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  });
  return out;
}

const hideRowIdColumn = (sheetId, scope) => {
  const i = scope.columns.findIndex((c) => c.key === 'rowId');
  return {
    updateDimensionProperties: {
      range: { sheetId: Number(sheetId), dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { hiddenByUser: true },
      fields: 'hiddenByUser',
    },
  };
};

/**
 * A provider bound to one person's Google sign-in.
 * @param {{ endpoints: object, getAccessToken: () => Promise<string>, fetchImpl?: typeof fetch }} opts
 */
export function googleSheetsProvider({ endpoints, getAccessToken, fetchImpl = fetch }) {
  const columnCounts = new Map(); // `${fileId}:${sheetId}` -> columns, from the last read

  async function call(url, { method = 'GET', body } = {}) {
    const token = await getAccessToken();
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? {} : res.json();
    const err = await res.json().catch(() => ({}));
    const reason = err?.error?.errors?.[0]?.reason || err?.error?.status || '';
    let status = res.status;
    if (status === 403 && /rate|quota/i.test(String(reason))) status = 429;
    throw providerError(`google ${method} ${new URL(url).pathname}: ${res.status} ${reason}`.trim(), status);
  }

  const sheetsUrl = (fileId, suffix = '') => `${endpoints.sheets}/v4/spreadsheets/${encodeURIComponent(fileId)}${suffix}`;
  const batchUpdate = (fileId, requests) => (requests.length
    ? call(sheetsUrl(fileId, ':batchUpdate'), { method: 'POST', body: { requests } })
    : Promise.resolve({ replies: [] }));

  // Grow a tab's columns before writing past its edge.
  const widenRequests = (fileId, cells) => {
    const need = new Map();
    for (const c of cells) need.set(String(c.sheetId), Math.max(need.get(String(c.sheetId)) || 0, c.col + 1));
    const out = [];
    for (const [sheetId, cols] of need) {
      const have = columnCounts.get(`${fileId}:${sheetId}`);
      if (have != null && cols > have) {
        out.push({ appendDimension: { sheetId: Number(sheetId), dimension: 'COLUMNS', length: cols - have } });
        columnCounts.set(`${fileId}:${sheetId}`, cols);
      }
    }
    return out;
  };

  return {
    kind: 'google',

    // Always null, so every round reads the sheet. Drive's `version` does not
    // move when someone types in a Google Sheet (seen live 2026-10-29: a cell
    // edit left it unchanged for minutes), so skipping on it hid sheet edits
    // until "Sync now". The call stays to catch a trashed or deleted sheet.
    async getVersion(fileId) {
      const meta = await call(`${endpoints.drive}/drive/v3/files/${encodeURIComponent(fileId)}?fields=trashed`);
      if (meta.trashed) throw providerError('google: the sheet is in the trash', 404);
      return null;
    },

    // `opts.sheetIds`: read only these tabs (the synced ones), so a big tab a
    // person added for their own notes costs nothing. Without it, every tab.
    async readGrid(fileId, { sheetIds = null } = {}) {
      const whole = () => call(sheetsUrl(fileId, `?includeGridData=true&fields=${encodeURIComponent(GRID_FIELDS)}`));
      const book = sheetIds?.length
        ? await call(sheetsUrl(fileId, `:getByDataFilter?fields=${encodeURIComponent(GRID_FIELDS)}`), {
          method: 'POST',
          body: { includeGridData: true, dataFilters: sheetIds.map((id) => ({ gridRange: { sheetId: Number(id) } })) },
        }).catch((err) => {
          // A synced tab someone deleted makes Google refuse the filter: read
          // every tab instead, so the round can say which one is missing.
          if (err?.status === 400) return whole();
          throw err;
        })
        : await whole();
      let cells = 0;
      const sheets = (book.sheets || []).map((s) => {
        const sheetId = String(s.properties?.sheetId ?? 0);
        const columnCount = Number(s.properties?.gridProperties?.columnCount) || 26;
        columnCounts.set(`${fileId}:${sheetId}`, columnCount);
        const rows = [];
        for (const grid of s.data || []) placeRows(grid, rows);
        for (let i = 0; i < rows.length; i += 1) {
          rows[i] = rows[i] || [];
          cells += rows[i].length;
        }
        return { sheetId, title: String(s.properties?.title || ''), columnCount, rows };
      });
      if (cells > MAX_GRID_CELLS) throw providerError(`google: sheet too big (${cells} cells)`, 413);
      return { sheets };
    },

    async readCells(fileId, cells) {
      // One range per tab column, rows 0..lowest asked, instead of one per
      // cell; read as grid data so values come back exactly as readGrid gives
      // them (dates, errors) and compare like for like.
      const groups = new Map();
      for (const c of cells) {
        const key = `${c.sheetId}:${c.col}`;
        groups.set(key, Math.max(groups.get(key) ?? 0, c.row + 1));
      }
      const keys = [...groups.keys()];
      const body = {
        includeGridData: true,
        dataFilters: keys.map((k) => {
          const [sheetId, col] = k.split(':');
          return { gridRange: { sheetId: Number(sheetId), startRowIndex: 0, endRowIndex: groups.get(k), startColumnIndex: Number(col), endColumnIndex: Number(col) + 1 } };
        }),
      };
      const res = await call(sheetsUrl(fileId, ':getByDataFilter'), { method: 'POST', body });
      const columns = new Map(); // `${sheetId}:${col}` -> rows
      for (const s of res.sheets || []) {
        for (const grid of s.data || []) {
          const key = `${s.properties?.sheetId}:${Number(grid?.startColumn) || 0}`;
          columns.set(key, placeRows({ ...grid, startColumn: 0 }, columns.get(key) || []));
        }
      }
      return cells.map((c) => columns.get(`${c.sheetId}:${c.col}`)?.[c.row]?.[0] ?? null);
    },

    async writeCells(fileId, cells) {
      await batchUpdate(fileId, [
        ...widenRequests(fileId, cells),
        ...cells.map((c) => ({
          updateCells: {
            start: { sheetId: Number(c.sheetId), rowIndex: c.row, columnIndex: c.col },
            rows: [{ values: [c.header ? headerCell(c.value) : cellData(c.value)] }],
            fields: c.header ? 'userEnteredValue,userEnteredFormat' : 'userEnteredValue',
          },
        })),
      ]);
    },

    async appendRows(fileId, appends) {
      await batchUpdate(fileId, appends.map((a) => ({
        // After the last row with data in the tab, wherever people have typed.
        appendCells: {
          sheetId: Number(a.sheetId),
          rows: a.rows.map((row) => ({ values: row.map(cellData) })),
          fields: 'userEnteredValue',
        },
      })));
    },

    async deleteRows(fileId, rows) {
      await batchUpdate(fileId, rows.map((r) => ({
        deleteDimension: { range: { sheetId: Number(r.sheetId), dimension: 'ROWS', startIndex: r.row, endIndex: r.row + 1 } },
      })));
    },

    async createFile({ title, layout }) {
      const book = await call(`${endpoints.sheets}/v4/spreadsheets`, {
        method: 'POST',
        body: {
          properties: { title: String(title || 'Survey').slice(0, 200) },
          sheets: layout.scopes.map((scope) => ({
            properties: { title: scope.title, gridProperties: { frozenRowCount: 1, columnCount: Math.max(26, scope.columns.length) } },
            data: [{ startRow: 0, startColumn: 0, rowData: [{ values: scope.columns.map((c) => headerCell(c.header)) }] }],
          })),
        },
      });
      const sheetIds = {};
      layout.scopes.forEach((scope, i) => {
        const sheetId = book.sheets?.[i]?.properties?.sheetId;
        if (sheetId != null) sheetIds[scope.scopeId] = String(sheetId);
      });
      await batchUpdate(book.spreadsheetId, layout.scopes.flatMap((scope) => (sheetIds[scope.scopeId] == null ? [] : [
        hideRowIdColumn(sheetIds[scope.scopeId], scope),
        ...textFormatRequests(sheetIds[scope.scopeId], scope),
        ...validationRequests(sheetIds[scope.scopeId], scope, layout),
      ])));
      return { fileId: String(book.spreadsheetId), url: String(book.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${book.spreadsheetId}/edit`), sheetIds };
    },

    async addTabs(fileId, scopes, layout = null) {
      const res = await batchUpdate(fileId, scopes.map((scope) => ({
        addSheet: { properties: { title: scope.title, gridProperties: { frozenRowCount: 1, columnCount: Math.max(26, scope.columns.length) } } },
      })));
      const out = {};
      scopes.forEach((scope, i) => {
        const id = res.replies?.[i]?.addSheet?.properties?.sheetId;
        if (id != null) out[scope.scopeId] = String(id);
      });
      await batchUpdate(fileId, scopes.flatMap((scope) => (out[scope.scopeId] == null ? [] : [
        { updateCells: { start: { sheetId: Number(out[scope.scopeId]), rowIndex: 0, columnIndex: 0 }, rows: [{ values: scope.columns.map((c) => headerCell(c.header)) }], fields: 'userEnteredValue,userEnteredFormat' } },
        hideRowIdColumn(out[scope.scopeId], scope),
        ...textFormatRequests(out[scope.scopeId], scope),
        ...(layout ? validationRequests(out[scope.scopeId], scope, layout) : []),
      ])));
      return out;
    },
  };
}
