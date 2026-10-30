// scripts/e2e-fake-google.mjs — a fake Google (OAuth, Sheets v4, Drive v3)
// for the live sheet sync tests, so they run with no Google account, key or
// network. It keeps spreadsheets in memory and answers only the calls
// supabase/functions/_shared/sheetSync/providers/google.js makes, the way
// Google documents them. Test hooks under /__fake/ edit a sheet the way a
// person typing in Google Sheets would.
//
// Node tests call fakeGoogleHandler(request) directly; the signed-in E2E stack
// serves it as an edge function in its own workdir only
// (scripts/e2e-local-supabase.mjs), never deployed.
// No imports, so Deno and Node both load it.

const store = globalThis.__fakeGoogle || (globalThis.__fakeGoogle = { files: new Map(), codes: new Map(), next: 1, revoked: new Set() });

export const FAKE_GOOGLE_EMAIL = 'pm@example.com';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gErr = (status, message, reason = '') => json(status, { error: { code: status, message, status: reason || 'ERROR', errors: reason ? [{ reason }] : [] } });
const b64url = (text) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function resetFakeGoogle() {
  store.files.clear();
  store.codes.clear();
  store.revoked.clear();
}

const plain = (cell) => {
  const v = cell?.userEnteredValue;
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('numberValue' in v) return v.numberValue;
  if ('boolValue' in v) return v.boolValue;
  return null;
};
// Cells tests set to { error: '#N/A' } act as a failed formula, and
// { date: serial, text } as a date the sheet shows in its own locale.
const effective = (value) => {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && value.error) return { effectiveValue: { errorValue: { type: 'N_A', message: 'x' } }, formattedValue: value.error };
  if (typeof value === 'object' && 'date' in value) {
    return { effectiveValue: { numberValue: value.date }, formattedValue: value.text, effectiveFormat: { numberFormat: { type: 'DATE' } } };
  }
  if (typeof value === 'number') return { effectiveValue: { numberValue: value }, formattedValue: String(value) };
  if (typeof value === 'boolean') return { effectiveValue: { boolValue: value }, formattedValue: value ? 'TRUE' : 'FALSE' };
  return { effectiveValue: { stringValue: String(value) }, formattedValue: String(value) };
};

function file(id) {
  const f = store.files.get(id);
  return f && !f.trashed ? f : null;
}
const sheetById = (f, sheetId) => f.sheets.find((s) => s.sheetId === Number(sheetId));
const touch = (f) => { f.version += 1; };
const setCell = (sheet, row, col, value) => {
  while (sheet.rows.length <= row) sheet.rows.push([]);
  const r = sheet.rows[row];
  while (r.length <= col) r.push(null);
  r[col] = value;
  sheet.rowCount = Math.max(sheet.rowCount, sheet.rows.length);
};
const lastDataRow = (sheet) => {
  for (let i = sheet.rows.length - 1; i >= 0; i -= 1) {
    if ((sheet.rows[i] || []).some((c) => c != null && c !== '')) return i;
  }
  return -1;
};

function authed(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return token.startsWith('fake-access-') && !store.revoked.has(token);
}

function batchUpdate(f, requests) {
  const replies = [];
  for (const req of requests || []) {
    const [kind, body] = Object.entries(req)[0] || [];
    if (kind === 'updateCells') {
      const sheet = sheetById(f, body.start.sheetId);
      if (!sheet) return { error: gErr(400, 'No grid with id') };
      for (let r = 0; r < body.rows.length; r += 1) {
        const values = body.rows[r].values || [];
        for (let c = 0; c < values.length; c += 1) {
          const col = body.start.columnIndex + c;
          if (col >= sheet.columnCount) return { error: gErr(400, `Range exceeds grid limits (column ${col})`) };
          setCell(sheet, body.start.rowIndex + r, col, plain(values[c]));
        }
      }
      replies.push({});
    } else if (kind === 'appendCells') {
      const sheet = sheetById(f, body.sheetId);
      if (!sheet) return { error: gErr(400, 'No grid with id') };
      let at = lastDataRow(sheet) + 1;
      for (const row of body.rows) {
        (row.values || []).forEach((cell, c) => setCell(sheet, at, c, plain(cell)));
        at += 1;
      }
      replies.push({});
    } else if (kind === 'deleteDimension') {
      const sheet = sheetById(f, body.range.sheetId);
      if (body.range.dimension === 'ROWS') sheet.rows.splice(body.range.startIndex, body.range.endIndex - body.range.startIndex);
      replies.push({});
    } else if (kind === 'appendDimension') {
      const sheet = sheetById(f, body.sheetId);
      if (body.dimension === 'COLUMNS') sheet.columnCount += body.length;
      replies.push({});
    } else if (kind === 'addSheet') {
      const sheetId = store.next++;
      const title = body.properties.title;
      if (f.sheets.some((s) => s.title.toLowerCase() === title.toLowerCase())) return { error: gErr(400, `A sheet with the name "${title}" already exists.`) };
      f.sheets.push({ sheetId, title, rows: [], columnCount: body.properties.gridProperties?.columnCount || 26, rowCount: 1000, hidden: [], validations: 0 });
      replies.push({ addSheet: { properties: { sheetId, title } } });
    } else if (kind === 'updateDimensionProperties') {
      const sheet = sheetById(f, body.range.sheetId);
      if (body.properties.hiddenByUser) sheet.hidden.push(body.range.startIndex);
      replies.push({});
    } else if (kind === 'setDataValidation') {
      sheetById(f, body.range.sheetId).validations += 1;
      replies.push({});
    } else if (kind === 'repeatCell') {
      const sheet = sheetById(f, body.range.sheetId);
      if (body.cell?.userEnteredFormat?.numberFormat?.type === 'TEXT') (sheet.textColumns ||= []).push(body.range.startColumnIndex);
      replies.push({});
    } else {
      return { error: gErr(400, `fake google: unsupported request ${kind}`) };
    }
  }
  touch(f);
  return { replies };
}

/** Request -> Response, for every fake Google URL under any base path. */
export async function fakeGoogleHandler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?(\/o\/oauth2|\/token|\/revoke|\/drive\/v3|\/v4\/spreadsheets|\/__fake)/, '$1');
  const body = req.method === 'POST' && (req.headers.get('content-type') || '').includes('json') ? await req.json() : null;

  // --- OAuth -------------------------------------------------------------
  if (path === '/o/oauth2/v2/auth') {
    // The person says yes at once.
    const code = `fake-code-${store.next++}`;
    store.codes.set(code, { scope: url.searchParams.get('scope') || '', email: url.searchParams.get('login_hint') || FAKE_GOOGLE_EMAIL });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state') || '');
    return new Response(null, { status: 302, headers: { Location: back.toString() } });
  }
  if (path === '/token') {
    const form = new URLSearchParams(await req.text());
    if (form.get('grant_type') === 'authorization_code') {
      const grant = store.codes.get(form.get('code'));
      if (!grant) return json(400, { error: 'invalid_grant' });
      store.codes.delete(form.get('code'));
      const n = store.next++;
      return json(200, {
        access_token: `fake-access-${n}`,
        refresh_token: `fake-refresh-${n}`,
        expires_in: 3599,
        scope: grant.scope,
        id_token: `x.${b64url(JSON.stringify({ email: grant.email }))}.x`,
      });
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (store.revoked.has(form.get('refresh_token'))) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: `fake-access-${store.next++}`, expires_in: 3599 });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }
  if (path === '/revoke') {
    store.revoked.add(url.searchParams.get('token'));
    return json(200, {});
  }

  // --- test hooks ----------------------------------------------------------
  if (path.startsWith('/__fake/')) {
    if (path === '/__fake/reset') { resetFakeGoogle(); return json(200, { ok: true }); }
    const m = /^\/__fake\/files\/([^/]+)(\/edit|\/sort|\/trash|\/insert-row|\/delete-row|\/delete-tab)?$/.exec(path);
    if (path === '/__fake/files') return json(200, { files: [...store.files.keys()] });
    const f = m && store.files.get(decodeURIComponent(m[1]));
    if (!f) return json(404, { error: 'no such file' });
    if (!m[2]) return json(200, f);
    const sheet = f.sheets.find((s) => s.title === body?.title) || f.sheets[0];
    if (m[2] === '/edit') {
      for (const e of body.edits || []) setCell(sheet, e.row, e.col, e.value);
    } else if (m[2] === '/sort') {
      // Reverse the data rows, the way a person sorting Z-A moves every row.
      const [header, ...rest] = sheet.rows;
      sheet.rows = [header, ...rest.reverse()];
    } else if (m[2] === '/insert-row') {
      sheet.rows.splice(body.row, 0, body.values || []);
    } else if (m[2] === '/delete-row') {
      sheet.rows.splice(body.row, 1);
    } else if (m[2] === '/delete-tab') {
      f.sheets = f.sheets.filter((s) => s !== sheet);
    } else if (m[2] === '/trash') {
      f.trashed = true;
    }
    touch(f);
    return json(200, { ok: true });
  }

  // --- Drive -----------------------------------------------------------------
  if (!authed(req)) return gErr(401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED');
  let m = /^\/drive\/v3\/files\/([^/?]+)$/.exec(path);
  if (m && req.method === 'GET') {
    const f = store.files.get(decodeURIComponent(m[1]));
    if (!f) return gErr(404, 'File not found', 'notFound');
    return json(200, { version: String(f.version), trashed: Boolean(f.trashed) });
  }

  // --- Sheets ----------------------------------------------------------------
  if (path === '/v4/spreadsheets' && req.method === 'POST') {
    const id = `fake-sheet-${store.next++}`;
    const f = { spreadsheetId: id, title: body.properties?.title || 'Untitled', version: 1, sheets: [] };
    for (const s of body.sheets || []) {
      const sheet = { sheetId: store.next++, title: s.properties.title, rows: [], columnCount: s.properties.gridProperties?.columnCount || 26, rowCount: 1000, hidden: [], validations: 0 };
      for (const d of s.data || []) {
        (d.rowData || []).forEach((row, r) => (row.values || []).forEach((cell, c) => setCell(sheet, (d.startRow || 0) + r, (d.startColumn || 0) + c, plain(cell))));
      }
      f.sheets.push(sheet);
    }
    store.files.set(id, f);
    return json(200, {
      spreadsheetId: id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      sheets: f.sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })),
    });
  }
  m = /^\/v4\/spreadsheets\/([^/:?]+)(:batchUpdate|:getByDataFilter|\/values:batchGetByDataFilter)?$/.exec(path);
  if (m) {
    const f = file(decodeURIComponent(m[1]));
    if (!f) return gErr(404, 'Requested entity was not found.', 'NOT_FOUND');
    if (!m[2] && req.method === 'GET') {
      return json(200, {
        sheets: f.sheets.map((s) => ({
          properties: { sheetId: s.sheetId, title: s.title, gridProperties: { rowCount: s.rowCount, columnCount: s.columnCount } },
          data: [{ rowData: s.rows.map((row) => ({ values: (row || []).map(effective) })) }],
        })),
      });
    }
    if (m[2] === ':getByDataFilter') {
      // Grid data for each gridRange, one GridData block per range, the way
      // Google answers: only the tabs a filter names.
      const bySheet = new Map();
      for (const df of body.dataFilters || []) {
        const g = df.gridRange || {};
        const sheet = sheetById(f, g.sheetId);
        if (!sheet) return gErr(400, `No grid with id: ${g.sheetId}`, 'INVALID_ARGUMENT');
        const r0 = g.startRowIndex ?? 0;
        const r1 = g.endRowIndex ?? sheet.rows.length;
        const c0 = g.startColumnIndex ?? 0;
        const c1 = g.endColumnIndex ?? Infinity;
        const rowData = [];
        for (let r = r0; r < Math.min(r1, sheet.rows.length); r += 1) {
          rowData.push({ values: (sheet.rows[r] || []).slice(c0, c1 === Infinity ? undefined : c1).map(effective) });
        }
        if (!bySheet.has(sheet.sheetId)) bySheet.set(sheet.sheetId, { sheet, data: [] });
        bySheet.get(sheet.sheetId).data.push({ startRow: r0, startColumn: c0, rowData });
      }
      return json(200, {
        sheets: [...bySheet.values()].map(({ sheet, data }) => ({
          properties: { sheetId: sheet.sheetId, title: sheet.title, gridProperties: { rowCount: sheet.rowCount, columnCount: sheet.columnCount } },
          data,
        })),
      });
    }
    if (m[2] === ':batchUpdate') {
      const out = batchUpdate(f, body.requests);
      return out.error || json(200, { spreadsheetId: f.spreadsheetId, replies: out.replies });
    }
    if (m[2] === '/values:batchGetByDataFilter') {
      return json(200, {
        valueRanges: (body.dataFilters || []).map((df) => {
          const g = df.gridRange;
          const sheet = sheetById(f, g.sheetId);
          const values = [];
          for (let r = g.startRowIndex; r < g.endRowIndex; r += 1) {
            values.push((sheet?.rows[r] || []).slice(g.startColumnIndex, g.endColumnIndex).map((v) => v ?? ''));
          }
          return { valueRange: { values }, dataFilters: [df] };
        }),
      });
    }
  }
  return gErr(404, `fake google: no route for ${req.method} ${path}`);
}

/** A fetch that answers from the fake, for node tests. */
export const fakeGoogleFetch = (input, init) => fakeGoogleHandler(input instanceof Request ? input : new Request(input, init));
