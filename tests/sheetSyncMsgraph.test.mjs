// The Microsoft adapter for the sheet-sync engine, against a fake Microsoft Graph
// that keeps a real grid (ranges, used range, sessions, row deletes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import {
  blankWorkbookBytes, cellValueForWrite, columnLetter, createMsGraphProvider, dropDownChoices, msgraphFileId,
  columnRuns, parseMsgraphFileId, rowRuns,
} from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';

const BASE = 'https://graph.test/v1.0';

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseAddress(address) {
  const whole = /^(\d+):(\d+)$/.exec(address);
  if (whole) return { r1: +whole[1] - 1, r2: +whole[2] - 1, wholeRows: true };
  const [a, b = a] = address.split(':');
  const pa = /^([A-Z]+)(\d+)$/.exec(a);
  const pb = /^([A-Z]+)(\d+)$/.exec(b);
  return { r1: +pa[2] - 1, c1: colIndex(pa[1]), r2: +pb[2] - 1, c2: colIndex(pb[1]) };
}

/** A tiny Graph: one business drive, workbooks of sheets of cells. */
function fakeGraph({ driveType = 'business' } = {}) {
  const state = {
    calls: [], tokens: 0, cTag: 1, sessions: new Set(), expireNext: false,
    files: new Map(),
  };
  const sheet = (name, position, cells = [], visibility = 'Visible') => ({ id: `{${name}-id}`, name, position, visibility, cells, formats: [] });
  state.addFile = (itemId, sheets) => state.files.set(itemId, { sheets, name: `${itemId}.xlsx` });
  state.sheet = sheet;

  const json = (status, body, headers = {}) => ({
    ok: status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });

  state.fetch = async (url, init) => {
    const path = decodeURIComponent(url.slice(BASE.length + 1));
    const method = init.method;
    state.calls.push(`${method} ${path}`);
    if (!/^Bearer tok-\d+$/.test(init.headers.Authorization)) return json(401, { error: { code: 'InvalidAuthenticationToken' } });

    if (method === 'GET' && path.startsWith('me/drive?')) return json(200, { id: 'b!drive', driveType });
    const put = /^me\/drive\/root:\/Survey\/(.+)\.xlsx:\/content/.exec(path);
    if (method === 'PUT' && put) {
      const book = await new ExcelJS.Workbook().xlsx.load(Buffer.from(init.body));
      const itemId = `NEW-${state.files.size + 1}`;
      // The upload carries the header row; keep it as the sheet's cells.
      state.addFile(itemId, book.worksheets.map((ws, i) => {
        const header = [];
        ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { header[col - 1] = cell.value ?? ''; });
        return sheet(ws.name, i, header.length ? [header] : []);
      }));
      state.files.get(itemId).book = book;
      // OneDrive's rename on a name clash: "Fire-Level 1 1.xlsx".
      const fileName = `${decodeURIComponent(put[1].split('/').pop()).replace(/\.xlsx$/i, '')} 1.xlsx`;
      return json(201, { id: itemId, name: fileName, webUrl: `https://x.sharepoint.com/${put[1]}`, parentReference: { driveId: 'b!drive', driveType } });
    }

    const m = /^drives\/([^/]+)\/items\/([^/?]+)(.*)$/.exec(path);
    if (!m) return json(404, { error: { code: 'itemNotFound' } });
    const file = state.files.get(m[2]);
    if (!file) return json(404, { error: { code: 'itemNotFound' } });
    const rest = m[3];
    if (method === 'GET' && rest.startsWith('?$select')) {
      return json(200, { id: m[2], name: file.name, cTag: `"c:{${m[2]}},${state.cTag}"`, parentReference: { driveId: m[1], driveType } });
    }
    if (rest === '/workbook/createSession') {
      const id = `s${state.sessions.size + 1}`;
      state.sessions.add(id);
      return json(201, { id, persistChanges: JSON.parse(init.body).persistChanges });
    }
    if (rest === '/workbook/closeSession') { state.sessions.delete(init.headers['workbook-session-id']); return json(204); }
    if (!rest.startsWith('/workbook/')) return json(404, {});
    const sid = init.headers['workbook-session-id'];
    if (state.expireNext) { state.expireNext = false; state.sessions.delete(sid); }
    if (!state.sessions.has(sid)) return json(404, { error: { code: 'InvalidSession', message: 'The session has expired.' } });
    const wb = rest.slice('/workbook/'.length);

    if (method === 'GET' && wb.startsWith('worksheets?')) {
      return json(200, { value: file.sheets.map(({ id, name, position, visibility }) => ({ id, name, position, visibility })) });
    }
    if (method === 'POST' && wb === 'worksheets/add') {
      const added = sheet(JSON.parse(init.body).name, file.sheets.length);
      file.sheets.push(added);
      return json(201, { id: added.id, name: added.name });
    }
    const ws = /^worksheets\/([^/]+)(.*)$/.exec(wb);
    const target = ws && file.sheets.find((s) => s.id === ws[1]);
    if (!target) return json(404, { error: { code: 'ItemNotFound' } });
    const tail = ws[2];
    if (method === 'DELETE' && tail === '') { file.sheets = file.sheets.filter((s) => s !== target); return json(204); }
    if (method === 'GET' && tail.startsWith('/usedRange')) {
      const rows = target.cells;
      let r1 = Infinity; let c1 = Infinity; let r2 = -1; let c2 = -1;
      rows.forEach((row, r) => (row || []).forEach((v, c) => {
        if (v !== '' && v !== undefined && v !== null) { r1 = Math.min(r1, r); r2 = Math.max(r2, r); c1 = Math.min(c1, c); c2 = Math.max(c2, c); }
      }));
      if (r2 < 0) return json(200, { rowIndex: 0, columnIndex: 0, rowCount: 1, columnCount: 1, values: [['']], text: [['']], numberFormat: [['General']] });
      const box = (fn) => Array.from({ length: r2 - r1 + 1 }, (_, r) => Array.from({ length: c2 - c1 + 1 }, (_, c) => fn(r + r1, c + c1)));
      return json(200, {
        rowIndex: r1, columnIndex: c1, rowCount: r2 - r1 + 1, columnCount: c2 - c1 + 1,
        values: box((r, c) => rows[r]?.[c] ?? ''),
        text: box((r, c) => (target.formats[r]?.[c] ? '10/29/2026' : String(rows[r]?.[c] ?? ''))),
        numberFormat: box((r, c) => target.formats[r]?.[c] || 'General'),
        valueTypes: box((r, c) => (/^#(N\/A|REF!|VALUE!|DIV\/0!)$/.test(String(rows[r]?.[c] ?? '')) ? 'Error' : 'String')),
      });
    }
    const range = /^\/range\(address='([^']+)'\)(\/delete|\/dataValidation)?/.exec(tail);
    if (method === 'POST' && tail === '/freezePanes/freezeRows') { target.frozen = JSON.parse(init.body).count; return json(200, {}); }
    if (range && method === 'PATCH' && JSON.parse(init.body).columnHidden !== undefined) {
      // Graph answers a whole-column address with all 1,048,576 rows; the
      // provider must hide through one cell instead.
      assert.ok(!/^[A-Z]+:[A-Z]+$/.test(range[1]), 'never a whole-column address');
      target.hidden = target.hidden || [];
      const col = /^([A-Z]+)/.exec(range[1])[1];
      if (JSON.parse(init.body).columnHidden) target.hidden.push(`${col}:${col}`);
      return json(200, {});
    }
    if (range && range[2] === '/dataValidation') {
      target.validation = target.validation || {};
      target.validation[range[1]] = JSON.parse(init.body).rule.list.source;
      return json(200, {});
    }
    if (range) {
      const a = parseAddress(range[1]);
      if (method === 'POST' && range[2]) {
        target.cells.splice(a.r1, a.r2 - a.r1 + 1);
        state.cTag += 1;
        return json(204);
      }
      if (method === 'PATCH') {
        const { values } = JSON.parse(init.body);
        assert.equal(values.length, a.r2 - a.r1 + 1, 'row count matches the address');
        values.forEach((line, r) => {
          assert.equal(line.length, a.c2 - a.c1 + 1, 'column count matches the address');
          line.forEach((v, c) => {
            target.cells[a.r1 + r] = target.cells[a.r1 + r] || [];
            target.cells[a.r1 + r][a.c1 + c] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
          });
        });
        state.cTag += 1;
        return json(200, {});
      }
      if (method === 'GET') {
        const box = Array.from({ length: a.r2 - a.r1 + 1 }, (_, r) => Array.from({ length: a.c2 - a.c1 + 1 }, (_, c) => target.cells[a.r1 + r]?.[a.c1 + c] ?? ''));
        return json(200, { values: box, text: box.map((l) => l.map(String)), numberFormat: box.map((l) => l.map(() => 'General')) });
      }
    }
    return json(400, { error: { code: 'unhandled', message: `${method} ${path}` } });
  };
  return state;
}

function provider(graph, extra = {}) {
  return createMsGraphProvider({ getAccessToken: async () => `tok-${++graph.tokens}`, fetch: graph.fetch, baseUrl: BASE, ...extra });
}

const FILE = msgraphFileId('b!drive', 'ITEM1');

test('file ids round-trip, columns letter past Z', () => {
  assert.equal(FILE, 'drives/b!drive/items/ITEM1');
  assert.deepEqual(parseMsgraphFileId(FILE), { driveId: 'b!drive', itemId: 'ITEM1' });
  assert.throws(() => parseMsgraphFileId('nope'), (e) => e.status === 404);
  assert.deepEqual([0, 25, 26, 51, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
});

test('text stays text: never a formula, number, date or yes/no', () => {
  assert.equal(cellValueForWrite('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(cellValueForWrite('00123'), "'00123");
  assert.equal(cellValueForWrite('1/2'), "'1/2");
  assert.equal(cellValueForWrite('TRUE'), "'TRUE");
  assert.equal(cellValueForWrite('Pass'), "'Pass");
  assert.equal(cellValueForWrite(''), '');
  assert.equal(cellValueForWrite(null), '');
  assert.equal(cellValueForWrite(3), 3);
  assert.equal(cellValueForWrite(false), false);
});

test('cells side by side on a row go out as one write', () => {
  const runs = rowRuns([
    { row: 2, col: 3, value: 'd' }, { row: 2, col: 1, value: 'b' }, { row: 2, col: 2, value: 'c' },
    { row: 5, col: 1, value: 'x' }, { row: 2, col: 3, value: 'D' },
  ]);
  assert.deepEqual(runs, [{ row: 2, col: 1, values: ["'b", "'c", "'D"] }, { row: 5, col: 1, values: ["'x"] }]);
});

test('reads every sheet in order, anchored at A1, with whole-day dates as YYYY-MM-DD', async () => {
  const graph = fakeGraph();
  const survey = graph.sheet('Fire - Level 1', 0, [['Row ID', 'Item', 'Date'], ['rid-1', 'D-1', 46324], [], ['rid-3', '=SUM', '']]);
  survey.formats[1] = [null, null, 'm/d/yyyy'];
  const offset = graph.sheet('Offset', 1, [[], ['', '', 'x']]);
  const meta = graph.sheet('_SurveyMetadata', 2, [['k', 'v']], 'VeryHidden');
  const empty = graph.sheet('Empty', 3, []);
  graph.addFile('ITEM1', [meta, offset, survey, empty].map((s, i) => Object.assign(s, { position: [2, 1, 0, 3][i] })));
  const grid = await provider(graph).readGrid(FILE);
  assert.deepEqual(grid.sheets.map((s) => s.title), ['Fire - Level 1', 'Offset', '_SurveyMetadata', 'Empty']);
  assert.deepEqual(grid.sheets[0].rows, [['Row ID', 'Item', 'Date'], ['rid-1', 'D-1', '2026-10-29'], [], ['rid-3', '=SUM']]);
  assert.equal(grid.sheets[0].columnCount, 3);
  assert.deepEqual(grid.sheets[1].rows, [[], [null, null, 'x']]);
  assert.equal(grid.sheets[2].hidden, true);
  assert.deepEqual(grid.sheets[3].rows, []);
  assert.equal(graph.sessions.size, 1, 'one saving session for the whole read');
});

test('a failed formula reads as an error, never as its "#N/A" text', async () => {
  const graph = fakeGraph();
  const s = graph.sheet('S', 0, [['Row ID', 'Notes'], ['rid-1', '#N/A']]);
  graph.addFile('ITEM1', [s]);
  const grid = await provider(graph).readGrid(FILE);
  assert.deepEqual(grid.sheets[0].rows[1], ['rid-1', { error: '#N/A' }]);
});

test('writes single cells and a formula-looking note stays text', async () => {
  const graph = fakeGraph();
  const s = graph.sheet('S', 0, [['Row ID', 'Item', 'Notes', 'Answer'], ['rid-1', 'D-1', 'old', 'Fail']]);
  graph.addFile('ITEM1', [s]);
  const p = provider(graph);
  const before = await p.getVersion(FILE);
  await p.writeCells(FILE, [
    { sheetId: s.id, title: 'S', row: 1, col: 2, value: '=not a formula' },
    { sheetId: s.id, title: 'S', row: 1, col: 3, value: 'Pass' },
  ]);
  assert.deepEqual(s.cells[1], ['rid-1', 'D-1', '=not a formula', 'Pass']);
  assert.equal(graph.calls.filter((c) => c.startsWith('PATCH')).length, 1, 'neighbouring cells in one request');
  assert.notEqual(await p.getVersion(FILE), before, 'cTag moves after a write');
  const [rid, note] = await p.readCells(FILE, [
    { sheetId: s.id, row: 1, col: 0 }, { sheetId: s.id, row: 1, col: 2 },
  ]);
  assert.deepEqual([rid, note], ['rid-1', '=not a formula']);
});

test('appends under the last used row and deletes rows highest first', async () => {
  const graph = fakeGraph();
  const s = graph.sheet('S', 0, [['Row ID', 'Item'], ['rid-1', 'A'], ['rid-2', 'B'], ['rid-3', 'C'], ['rid-4', 'D']]);
  const blank = graph.sheet('Blank', 1, []);
  graph.addFile('ITEM1', [s, blank]);
  const p = provider(graph);
  await p.appendRows(FILE, [
    { sheetId: s.id, title: 'S', rows: [['rid-5', 'E'], ['rid-6']], width: 2 },
    { sheetId: blank.id, title: 'Blank', rows: [['h1', 'h2']], width: 2 },
  ]);
  assert.deepEqual(s.cells.slice(5), [['rid-5', 'E'], ['rid-6', '']]);
  assert.deepEqual(blank.cells, [['h1', 'h2']]);
  await p.deleteRows(FILE, [{ sheetId: s.id, row: 1 }, { sheetId: s.id, row: 3 }]);
  assert.deepEqual(s.cells.map((r) => r[0]), ['Row ID', 'rid-2', 'rid-4', 'rid-5', 'rid-6']);
});

test('reopens an expired session once and carries on', async () => {
  const graph = fakeGraph();
  const s = graph.sheet('S', 0, [['a']]);
  graph.addFile('ITEM1', [s]);
  const p = provider(graph);
  await p.writeCells(FILE, [{ sheetId: s.id, row: 0, col: 0, value: 'b' }]);
  graph.expireNext = true;
  await p.writeCells(FILE, [{ sheetId: s.id, row: 0, col: 0, value: 'c' }]);
  assert.equal(s.cells[0][0], 'c');
  assert.equal(graph.calls.filter((c) => c.endsWith('createSession')).length, 2);
});

test('opens a new session after Graph\'s idle timeout instead of using a stale one', async () => {
  const graph = fakeGraph();
  const s = graph.sheet('S', 0, [['a']]);
  graph.addFile('ITEM1', [s]);
  let clock = 0;
  const p = provider(graph, { now: () => clock });
  await p.writeCells(FILE, [{ sheetId: s.id, row: 0, col: 0, value: 'b' }]);
  clock += 5 * 60 * 1000;
  await p.writeCells(FILE, [{ sheetId: s.id, row: 0, col: 0, value: 'c' }]);
  assert.equal(graph.calls.filter((c) => c.endsWith('createSession')).length, 2);
});

test('personal OneDrive is refused before any cell call', async () => {
  const graph = fakeGraph({ driveType: 'personal' });
  graph.addFile('ITEM1', [graph.sheet('S', 0, [['a']])]);
  const p = provider(graph);
  await assert.rejects(p.readGrid(FILE), (e) => e.status === 409 && e.code === 'personal-onedrive');
  await assert.rejects(p.createFile({ title: 'X', layout: { scopes: [] } }), (e) => e.code === 'personal-onedrive');
  assert.equal(graph.calls.some((c) => c.includes('createSession')), false);
});

test('Graph errors keep their status and the retry wait', async () => {
  const p = createMsGraphProvider({
    getAccessToken: async () => 'tok-1', baseUrl: BASE,
    fetch: async () => ({ ok: false, status: 429, headers: { get: (k) => (k === 'retry-after' ? '7' : null) }, text: async () => '{"error":{"code":"TooManyRequests","message":"slow down"}}' }),
  });
  await assert.rejects(p.getVersion(FILE), (e) => e.status === 429 && e.retryAfterMs === 7000 && e.message === 'slow down');
  const missing = fakeGraph();
  await assert.rejects(provider(missing).getVersion(msgraphFileId('b!drive', 'GONE')), (e) => e.status === 404);
});

test('creates a workbook in the Survey folder with one sheet per scope', async () => {
  const graph = fakeGraph();
  const p = provider(graph);
  const layout = {
    scopes: [
      { scopeId: 'm:cat1', title: 'Fire - L1', columns: [
        { key: 'rowId', header: 'Row ID' }, { key: 'item', header: 'Item' }, { key: 'entity', header: 'Entity' },
        { key: 'answer:q1', header: 'Works?' }, { key: 'answer:q2', header: 'Note', item: { kind: 'text' } },
      ] },
      { scopeId: 'm:cat2', title: 'Fire - L2', columns: [{ key: 'rowId', header: 'Row ID' }, { key: 'notes', header: 'Notes' }] },
    ],
    entities: [{ id: 'e1', name: 'Smoke detector', color: 'rgba(255, 0, 0, 0.4)' }, { id: 'e2', name: 'Pull station' }],
    answerValues: ['Pass', 'Fail', 'N/A'],
  };
  const made = await p.createFile({ title: 'Fire/Level 1', layout, answerFills: [
    { value: 'Pass', argb: 'FFCEEED0' }, { value: 'Fail', argb: 'FFF6C9CE' }, { value: 'N/A', argb: 'FFA6A6A6' },
  ] });
  assert.match(made.fileId, /^drives\/b!drive\/items\/NEW-1$/);
  assert.match(made.url, /Fire-Level%201|Fire-Level 1/);
  assert.equal(made.title, 'Fire-Level 1 1', 'the name OneDrive really gave it, shown in the panel');
  const file = graph.files.get('NEW-1');
  assert.deepEqual(file.sheets.map((s) => s.name), ['Fire - L1', 'Fire - L2']);
  assert.deepEqual(file.sheets[0].cells[0], ['Row ID', 'Item', 'Entity', 'Works?', 'Note']);
  assert.deepEqual(file.sheets[1].cells[0], ['Row ID', 'Notes']);
  assert.deepEqual(made.sheetIds, { 'm:cat1': '{Fire - L1-id}', 'm:cat2': '{Fire - L2-id}' });
  // One upload and one look-up: no per-sheet set-up calls (owner: "needs to be nearly instant").
  assert.deepEqual(graph.calls.filter((c) => !c.startsWith('POST') || !c.endsWith('createSession')).map((c) => c.split('?')[0].replace(/drives\/[^ ]+\/workbook\//, 'workbook/')),
    ['GET me/drive', 'PUT me/drive/root:/Survey/Fire-Level 1.xlsx:/content', 'GET workbook/worksheets']);
  // Formatted like the app's Export data workbook.
  const ws = file.book.worksheets[0];
  assert.equal(ws.getColumn(1).hidden, true, 'Row ID column hidden');
  assert.equal(ws.views[0].state, 'frozen');
  assert.equal(ws.views[0].ySplit, 1);
  assert.equal(ws.getCell('A1').fill.fgColor.argb, 'FFBFBFBF', 'grey header');
  assert.equal(ws.getCell('B1').border.top.style, 'thin');
  assert.equal(ws.getColumn(2).width, 24);
  assert.equal(ws.getColumn(5).width, 15);
  assert.equal(ws.getCell('C2').dataValidation.formulae[0], '"Smoke detector,Pull station"');
  assert.equal(ws.getCell('D2').dataValidation.formulae[0], '"Pass,Fail,N/A"');
  assert.equal(ws.getCell('E2').dataValidation?.type, undefined, 'a typed answer has no list');
  const rules = ws.conditionalFormattings.flatMap((cf) => cf.rules.map((r) => ({ ref: cf.ref, ...r })));
  assert.ok(rules.some((r) => r.ref === 'B2:B1000' && /COUNTIF/.test(r.formulae[0])), 'repeated item names in red');
  assert.ok(rules.some((r) => r.ref === 'A2:E1000' && /COUNTA/.test(r.formulae[0])), 'borders on rows with data');
  assert.deepEqual(rules.filter((r) => r.ref === 'D2:D1000').map((r) => r.formulae[0]), ['"Pass"', '"Fail"', '"N/A"']);
  assert.deepEqual(rules.filter((r) => r.ref === 'C2:C1000').map((r) => [r.formulae[0], r.style.fill.bgColor.argb]), [['"Smoke detector"', 'FFFF0000']], 'each entity in its colour');
  const more = await p.addTabs(made.fileId, [{ scopeId: 'm:cat3', title: 'Fire - L3', columns: [{ key: 'rowId', header: 'Row ID' }] }], layout);
  assert.deepEqual(more, { 'm:cat3': '{Fire - L3-id}' });
});

test('no drop-down when Excel could not hold the list', () => {
  const long = { answerValues: Array.from({ length: 60 }, (_, i) => `Choice ${i}`) };
  assert.equal(dropDownChoices({ key: 'answer:q' }, long), null);
  assert.equal(dropDownChoices({ key: 'answer:q' }, { answerValues: ['Yes, done', 'No'] }), null);
  assert.equal(dropDownChoices({ key: 'answer:q', item: { kind: 'choice' } }, { answerValues: ['Y', 'N'] }), 'Y,N');
  assert.equal(dropDownChoices({ key: 'notes' }, { answerValues: ['Y'] }), null);
});

test('the built-in blank workbook is a real .xlsx', async () => {
  const book = await new ExcelJS.Workbook().xlsx.load(Buffer.from(blankWorkbookBytes()));
  assert.deepEqual(book.worksheets.map((w) => w.name), ['Sheet1']);
});

test('a tab added later: range writes are never read back, and side-by-side columns share one call', async () => {
  const graph = fakeGraph();
  const realFetch = graph.fetch;
  let cancelled = 0;
  // Graph answers a range write with the whole range; reading that for a big
  // range ran the edge function out of memory (Nov 3). The answer must be dropped.
  graph.fetch = async (url, init) => {
    const res = await realFetch(url, init);
    if (init.method !== 'PATCH' || !res.ok) return res;
    return { ...res, text: async () => { throw new Error('range answer was read'); }, body: { cancel: async () => { cancelled += 1; } } };
  };
  const p = provider(graph);
  const layout = {
    scopes: [{ scopeId: 'm:a', title: 'A', columns: [
      { key: 'rowId', header: 'Row ID' }, { key: 'item', header: 'Item' }, { key: 'entity', header: 'Entity' },
      { key: 'answer:q1', header: 'Q1' }, { key: 'answer:q2', header: 'Q2' }, { key: 'answer:h', header: 'Height', item: { kind: 'number' } },
      { key: 'notes', header: 'Notes' },
    ] }],
    entities: [{ id: 'e1', name: 'Door' }],
    answerValues: ['Pass', 'Fail'],
  };
  const made = await p.createFile({ title: 'Runs', layout: { ...layout, scopes: [] } });
  await p.addTabs(made.fileId, layout.scopes, layout);
  assert.ok(cancelled > 0, 'answers dropped unread');
  const formats = graph.calls.filter((c) => c.startsWith('PATCH') && /2:[A-Z]+1000'\)$/.test(c));
  assert.equal(formats.length, 2, `two text runs (A-E, G), got ${formats.join(' | ')}`);
  const drops = graph.calls.filter((c) => c.endsWith('/dataValidation'));
  assert.equal(drops.length, 2, 'entity alone, then Q1-Q2 together');
  assert.ok(drops.some((c) => c.includes("D2:E1000")));
  assert.equal(graph.files.get('NEW-1').sheets.find((sh) => sh.name === 'A').hidden[0], 'A:A');
});

test('columnRuns groups neighbours with the same value', () => {
  const cols = ['t', 't', null, 'x', 'x', 't'].map((v) => ({ v }));
  assert.deepEqual(columnRuns(cols, (c) => c.v), [
    { from: 0, to: 1, value: 't' }, { from: 3, to: 4, value: 'x' }, { from: 5, to: 5, value: 't' },
  ]);
});
