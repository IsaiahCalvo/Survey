// scripts/e2e-fake-msgraph.mjs — a fake Microsoft (sign-in + the Graph Excel
// API) for the live sheet sync tests, so they run with no Microsoft account,
// key or network. It keeps workbooks in memory and answers only the calls
// supabase/functions/_shared/sheetSync/providers/msgraph.js and msgraphAuth.js
// make. Like real Excel, a value written without a leading apostrophe is read
// the way typing is ("12" becomes a number, "TRUE" a yes/no), so a test sees
// it if the adapter ever stops keeping text as text. Test hooks under /__fake/
// edit a workbook the way a PM typing in Excel would.
//
// Node tests call fakeMsgraphHandler(request) directly; the signed-in E2E stack
// serves it as an edge function in its own workdir only, never deployed.
// No imports, so Deno and Node both load it.

const store = globalThis.__fakeMsgraph || (globalThis.__fakeMsgraph = {
  files: new Map(), codes: new Map(), sessions: new Set(), next: 1, driveType: 'business',
});

export const FAKE_MS_EMAIL = 'pm@contoso.example';
const DRIVE = 'b!fake-drive';

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const gErr = (status, code, message) => json(status, { error: { code, message } });

export function resetFakeMsgraph() {
  store.files.clear();
  store.codes.clear();
  store.sessions.clear();
  store.driveType = 'business';
}

// What Excel stores for a value written through the API.
function typed(value) {
  if (typeof value !== 'string') return value ?? '';
  if (value.startsWith("'")) return value.slice(1);
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  return value;
}

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function parseAddress(address) {
  const rows = /^(\d+):(\d+)$/.exec(address);
  if (rows) return { r1: +rows[1] - 1, r2: +rows[2] - 1, wholeRows: true };
  const cols = /^([A-Z]+):([A-Z]+)$/.exec(address);
  if (cols) return { c1: colIndex(cols[1]), c2: colIndex(cols[2]), wholeCols: true };
  const [a, b = a] = address.split(':');
  const pa = /^([A-Z]+)(\d+)$/.exec(a);
  const pb = /^([A-Z]+)(\d+)$/.exec(b);
  if (!pa || !pb) return null;
  return { r1: +pa[2] - 1, c1: colIndex(pa[1]), r2: +pb[2] - 1, c2: colIndex(pb[1]) };
}

const touch = (f) => { f.version += 1; };
function setCell(sheet, row, col, value) {
  while (sheet.cells.length <= row) sheet.cells.push([]);
  sheet.cells[row][col] = value;
}
const cellAt = (sheet, r, c) => sheet.cells[r]?.[c] ?? '';
const newSheet = (name, position) => ({ id: `{${String(store.next++).padStart(8, '0')}-0001-0000-0000-000000000000}`, name, position, visibility: 'Visible', cells: [], hidden: [], frozen: 0, validations: {} });

function usedRange(sheet) {
  let r1 = Infinity; let c1 = Infinity; let r2 = -1; let c2 = -1;
  sheet.cells.forEach((row, r) => (row || []).forEach((v, c) => {
    if (v !== '' && v != null) { r1 = Math.min(r1, r); r2 = Math.max(r2, r); c1 = Math.min(c1, c); c2 = Math.max(c2, c); }
  }));
  if (r2 < 0) return { rowIndex: 0, columnIndex: 0, rowCount: 1, columnCount: 1, values: [['']], text: [['']], numberFormat: [['General']] };
  const box = (fn) => Array.from({ length: r2 - r1 + 1 }, (_, r) => Array.from({ length: c2 - c1 + 1 }, (_, c) => fn(r + r1, c + c1)));
  return {
    rowIndex: r1, columnIndex: c1, rowCount: r2 - r1 + 1, columnCount: c2 - c1 + 1,
    values: box((r, c) => cellAt(sheet, r, c)),
    text: box((r, c) => String(cellAt(sheet, r, c))),
    numberFormat: box(() => 'General'),
  };
}

function itemJson(id, f) {
  return {
    id, name: f.name, cTag: `"c:{${id}},${f.version}"`, eTag: `"{${id}},${f.version}"`,
    webUrl: `https://contoso.sharepoint.example/Survey/${encodeURIComponent(f.name)}`,
    parentReference: { driveId: DRIVE, driveType: store.driveType },
  };
}

function authed(req) {
  return /^Bearer fake-ms-access-\d+$/.test(req.headers.get('authorization') || '');
}

/** Request -> Response, for every fake Microsoft URL under any base path. */
export async function fakeMsgraphHandler(req) {
  const url = new URL(req.url);
  const at = url.pathname.search(/\/oauth2\/v2\.0\/|\/v1\.0\/|\/__fake(\/|$)/);
  const path = decodeURIComponent(at >= 0 ? url.pathname.slice(at) : url.pathname);
  const method = req.method;
  const isJson = (req.headers.get('content-type') || '').includes('json');
  const body = method !== 'GET' && isJson ? await req.json().catch(() => null) : null;

  // --- sign-in -------------------------------------------------------------
  if (path === '/oauth2/v2.0/authorize') {
    // The person says yes at once.
    const code = `fake-ms-code-${store.next++}`;
    store.codes.set(code, { scope: url.searchParams.get('scope') || '' });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state') || '');
    return new Response(null, { status: 302, headers: { Location: back.toString() } });
  }
  if (path === '/oauth2/v2.0/token') {
    const form = new URLSearchParams(await req.text());
    if (form.get('client_secret') !== 'e2e-fake-ms-secret') return json(401, { error: 'invalid_client' });
    let scope = form.get('scope') || '';
    if (form.get('grant_type') === 'authorization_code') {
      const grant = store.codes.get(form.get('code'));
      if (!grant) return json(400, { error: 'invalid_grant' });
      store.codes.delete(form.get('code'));
      scope = grant.scope;
    } else if (form.get('grant_type') === 'refresh_token') {
      if (!/^fake-ms-refresh-\d+$/.test(form.get('refresh_token') || '')) return json(400, { error: 'invalid_grant' });
    } else {
      return json(400, { error: 'unsupported_grant_type' });
    }
    const n = store.next++;
    // Microsoft hands back a new refresh token each time.
    return json(200, {
      access_token: `fake-ms-access-${n}`, refresh_token: `fake-ms-refresh-${n}`, expires_in: 3599,
      scope: scope.split(' ').filter((s) => s !== 'offline_access').join(' '),
    });
  }

  // --- test hooks ----------------------------------------------------------
  if (path.startsWith('/__fake')) {
    if (path === '/__fake/reset') { resetFakeMsgraph(); return json(200, { ok: true }); }
    if (path === '/__fake/files') return json(200, { files: [...store.files.keys()] });
    if (path === '/__fake/drive-type') { store.driveType = body?.driveType || 'business'; return json(200, { ok: true }); }
    const m = /^\/__fake\/files\/([^/]+)(\/edit|\/sort|\/insert-row|\/delete-row)?$/.exec(path);
    const f = m && store.files.get(m[1]);
    if (!f) return json(404, { error: 'no such file' });
    if (!m[2]) {
      return json(200, { ...f, sheets: f.sheets.map((s) => ({ ...s, rows: s.cells.map((row) => [...(row || [])].map((v) => v ?? '')) })) });
    }
    const sheet = f.sheets.find((s) => s.name === body?.title) || f.sheets[0];
    if (m[2] === '/edit') {
      for (const e of body.edits || []) setCell(sheet, e.row, e.col, e.value);
    } else if (m[2] === '/sort') {
      const [header, ...rest] = sheet.cells;
      sheet.cells = [header, ...rest.reverse()];
    } else if (m[2] === '/insert-row') {
      sheet.cells.splice(body.row, 0, body.values || []);
    } else if (m[2] === '/delete-row') {
      sheet.cells.splice(body.row, 1);
    }
    touch(f);
    return json(200, { ok: true });
  }

  // --- Graph ---------------------------------------------------------------
  if (!authed(req)) return gErr(401, 'InvalidAuthenticationToken', 'Access token is empty or invalid.');
  if (method === 'GET' && path === '/v1.0/me') {
    return json(200, { id: 'fake-ms-user', displayName: 'Pat Manager', mail: FAKE_MS_EMAIL, userPrincipalName: FAKE_MS_EMAIL });
  }
  if (method === 'GET' && path === '/v1.0/me/drive') return json(200, { id: DRIVE, driveType: store.driveType });
  const put = /^\/v1\.0\/me\/drive\/root:\/Survey\/(.+)\.xlsx:\/content$/.exec(path);
  if (method === 'PUT' && put) {
    const names = new Set([...store.files.values()].map((f) => f.name.toLowerCase()));
    let name = `${put[1]}.xlsx`;
    for (let i = 1; names.has(name.toLowerCase()); i += 1) name = `${put[1]} ${i}.xlsx`;
    const id = `FAKEITEM${store.next++}`;
    const f = { name, version: 1, sheets: [newSheet('Sheet1', 0)] };
    store.files.set(id, f);
    return json(201, itemJson(id, f));
  }

  const m = /^\/v1\.0\/drives\/([^/]+)\/items\/([^/]+)(.*)$/.exec(path);
  if (!m || m[1] !== DRIVE) return gErr(404, 'itemNotFound', 'The resource could not be found.');
  const f = store.files.get(m[2]);
  if (!f) return gErr(404, 'itemNotFound', 'The resource could not be found.');
  const rest = m[3];
  if (method === 'GET' && rest === '') return json(200, itemJson(m[2], f));
  if (store.driveType === 'personal' && rest.startsWith('/workbook')) {
    return gErr(400, 'NotSupported', 'Workbooks on OneDrive Consumer are not supported.');
  }
  if (method === 'POST' && rest === '/workbook/createSession') {
    const id = `fake-ms-session-${store.next++}`;
    store.sessions.add(id);
    return json(201, { id, persistChanges: Boolean(body?.persistChanges) });
  }
  if (method === 'POST' && rest === '/workbook/closeSession') { store.sessions.delete(req.headers.get('workbook-session-id')); return json(204); }
  if (!rest.startsWith('/workbook/')) return gErr(400, 'BadRequest', `fake msgraph: no route for ${method} ${path}`);
  if (!store.sessions.has(req.headers.get('workbook-session-id'))) return gErr(404, 'InvalidSession', 'The session has expired.');
  const wb = rest.slice('/workbook/'.length);

  if (method === 'GET' && wb === 'worksheets') {
    return json(200, { value: f.sheets.map(({ id, name, position, visibility }) => ({ id, name, position, visibility })) });
  }
  if (method === 'POST' && wb === 'worksheets/add') {
    const name = String(body?.name || `Sheet${f.sheets.length + 1}`);
    if (f.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) return gErr(400, 'ItemAlreadyExists', 'A resource with the same name or identifier already exists.');
    const sheet = newSheet(name, f.sheets.length);
    f.sheets.push(sheet);
    touch(f);
    return json(201, { id: sheet.id, name: sheet.name, position: sheet.position, visibility: sheet.visibility });
  }
  const ws = /^worksheets\/([^/(]+)(.*)$/.exec(wb);
  const sheet = ws && f.sheets.find((s) => s.id === ws[1]);
  if (!sheet) return gErr(404, 'ItemNotFound', 'The requested resource doesn\'t exist.');
  const tail = ws[2];
  if (method === 'DELETE' && tail === '') {
    f.sheets = f.sheets.filter((s) => s !== sheet);
    f.sheets.forEach((s, i) => { s.position = i; });
    touch(f);
    return json(204);
  }
  if (method === 'GET' && tail.startsWith('/usedRange')) return json(200, usedRange(sheet));
  if (method === 'POST' && tail === '/freezePanes/freezeRows') { sheet.frozen = Number(body?.count) || 0; return json(204); }
  const range = /^\/range\(address='([^']+)'\)(\/delete|\/dataValidation)?$/.exec(tail);
  const a = range && parseAddress(range[1]);
  if (!a) return gErr(400, 'BadRequest', `fake msgraph: no route for ${method} ${path}`);
  if (range[2] === '/dataValidation' && method === 'PATCH') { sheet.validations[range[1]] = body?.rule?.list?.source || ''; return json(200, {}); }
  if (range[2] === '/delete' && method === 'POST') {
    if (!a.wholeRows) return gErr(400, 'BadRequest', 'fake msgraph: only whole-row deletes');
    sheet.cells.splice(a.r1, a.r2 - a.r1 + 1);
    touch(f);
    return json(204);
  }
  if (method === 'PATCH' && a.wholeCols) {
    if (body?.columnHidden) sheet.hidden.push(range[1]);
    return json(200, {});
  }
  if (method === 'PATCH') {
    const values = body?.values || [];
    if (values.length !== a.r2 - a.r1 + 1 || values.some((line) => line.length !== a.c2 - a.c1 + 1)) {
      return gErr(400, 'InvalidArgument', 'The number of rows or columns in the input array doesn\'t match the size or dimensions of the range.');
    }
    values.forEach((line, r) => line.forEach((v, c) => setCell(sheet, a.r1 + r, a.c1 + c, typed(v))));
    touch(f);
    return json(200, {});
  }
  if (method === 'GET') {
    const box = Array.from({ length: a.r2 - a.r1 + 1 }, (_, r) => Array.from({ length: a.c2 - a.c1 + 1 }, (_, c) => cellAt(sheet, a.r1 + r, a.c1 + c)));
    return json(200, { values: box, text: box.map((l) => l.map(String)), numberFormat: box.map((l) => l.map(() => 'General')) });
  }
  return gErr(400, 'BadRequest', `fake msgraph: no route for ${method} ${path}`);
}

/** A fetch that answers from the fake, for node tests. */
export const fakeMsgraphFetch = (input, init) => fakeMsgraphHandler(input instanceof Request ? input : new Request(input, init));
