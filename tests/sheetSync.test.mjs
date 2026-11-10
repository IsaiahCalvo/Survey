// Live sheet sync (supabase/functions/_shared/sheetSync): the merge engine and
// the round runner, driven through the real Google provider against the fake
// Google (scripts/e2e-fake-google.mjs). Each test plays one thing a field tech
// or a PM does and checks both sides end up right.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncLayout, layoutProblems } from '../supabase/functions/_shared/sheetSync/layout.js';
import { googleSheetsProvider } from '../supabase/functions/_shared/sheetSync/providers/google.js';
import { assertProvider } from '../supabase/functions/_shared/sheetSync/providers/contract.js';
import { encryptToken, decryptToken } from '../supabase/functions/_shared/sheetSync/tokenCrypto.js';
import { mergeMarkerWrites } from '../supabase/functions/_shared/sheetSync/service.js';
import { putMovedRowIdsRight, putMovedWritesRight } from '../supabase/functions/_shared/sheetSync/round.js';
import {
  defaultKit, endpoints, fakeApi, fakeGoogleFetch, template, setup, door,
} from './helpers/sheetSyncHarness.mjs';

test('layout: one tab per category, kit columns, Row ID first, blank lines get a header', () => {
  const layout = buildSyncLayout({ template: template(), kit: defaultKit });
  assert.deepEqual(layout.scopes.map((s) => s.title), ['Doors - Level 1', 'Cameras - Level 1']);
  assert.deepEqual(layout.scopes[0].columns.map((c) => c.header), ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Locked?', 'Height', 'Entity', 'Notes']);
  assert.deepEqual(layoutProblems(layout), []);
  const blank = buildSyncLayout({ template: { modules: [{ id: 'm', name: 'S', categories: [{ id: 'c', name: 'C', checklist: [{ id: 'x', text: '' }] }] }] }, kit: defaultKit });
  assert.equal(blank.scopes[0].columns[4].header, 'Check 1');
  assert.throws(() => buildSyncLayout({ template: template(), kit: { columns: [] } }));
});

test('provider meets the contract; tokens round-trip through encryption', async () => {
  assertProvider(googleSheetsProvider({ endpoints, getAccessToken: async () => 't' }));
  const sealed = await encryptToken('refresh-123', 'key-a');
  assert.match(sealed, /^v1\./);
  assert.equal(await decryptToken(sealed, 'key-a'), 'refresh-123');
  await assert.rejects(decryptToken(sealed, 'key-b'));
});

test('first round fills the sheet with signed rows; a quiet round changes nothing', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { checklistResponses: { c1: { selection: 'Y' }, c2: { selection: '84' } }, entityName: 'Installed' }), d2: door('d2', 'D-102') } });
  const first = await ctx.round();
  assert.equal(first.status, 'synced');
  assert.equal(first.summary.appended, 2);
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows.length, 3);
  assert.match(sheet.rows[1][0], /^v1\.k1\./, 'Row ID is a signed token');
  assert.equal(sheet.rows[1][3], 'D-101');
  assert.equal(sheet.rows[1][4], 'Y');
  assert.equal(sheet.rows[1][5], 84, 'number answers go in as numbers');
  assert.equal(sheet.rows[1][6], 'Installed');
  assert.deepEqual(sheet.hidden, [0], 'Row ID column hidden');
  assert.ok(sheet.validations >= 2, 'drop-downs for answers and entity');
  // Google rounds always read the sheet (Drive's version misses cell edits),
  // so a round with nothing new still reads but writes nothing either way.
  assert.equal((await ctx.round()).status, 'synced');
  const quiet = await ctx.round();
  assert.equal(quiet.status, 'synced');
  assert.deepEqual(quiet.summary, { toSheet: 0, toApp: 0, created: 0, appended: 0, deleted: 0, conflicts: 0 });
});

test('a sheet edit reaches the app even when Drive reports the same version', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  // Real Google: typing in a cell does not bump Drive's version, so Drive
  // answers the same version every time here.
  const frozenDrive = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/drive/v3/files/') && (!init || !init.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ version: '1', trashed: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return fakeGoogleFetch(input, init);
  };
  ctx.provider = googleSheetsProvider({ endpoints, getAccessToken: async () => 'fake-access-1', fetchImpl: frozenDrive });
  await ctx.round(); await ctx.round();
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: await ctx.col('Notes'), value: 'Typed in the sheet' }]);
  const round = await ctx.round();
  assert.equal(round.status, 'synced');
  assert.equal(round.summary.toApp, 1);
});

test('a field tech answer reaches the sheet; a PM edit reaches the app; both land on one row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  // Field tech answers "Locked?" in the app; the PM types a note in the sheet.
  ctx.markers.d1.checklistResponses = { c1: { selection: 'N' } };
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: await ctx.col('Notes'), value: 'Hinge squeaks' }]);
  const res = await ctx.round();
  assert.equal(res.summary.conflicts, 0);
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows[r][await ctx.col('Locked?')], 'N');
  assert.equal(sheet.rows[r][await ctx.col('Notes')], 'Hinge squeaks');
  assert.equal(ctx.markers.d1.note.text, 'Hinge squeaks');
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N');
  // The PM picks an entity and fixes the item name; "y" is tidied to "Y".
  await ctx.edit([
    { row: r, col: await ctx.col('Entity'), value: 'missing' },
    { row: r, col: await ctx.col('Item'), value: 'D-101A' },
    { row: r, col: await ctx.col('Locked?'), value: 'y' },
  ]);
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d1.entityId, 'e2');
  assert.equal(ctx.markers.d1.entityName, 'Missing');
  assert.equal(ctx.markers.d1.name, 'D-101A');
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'Y');
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'Y');
});

test('same cell changed on both sides: only that cell waits, and the choice settles it', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const r = await ctx.rowOf('d1');
  ctx.markers.d1.checklistResponses = { c1: { selection: 'Y' } };
  ctx.markers.d1.note = { text: 'app note' };
  await ctx.edit([{ row: r, col: await ctx.col('Locked?'), value: 'N' }, { row: r, col: await ctx.col('Item'), value: 'D-101 east' }]);
  const res = await ctx.round();
  assert.equal(res.summary.conflicts, 1);
  const conflict = ctx.link.state.conflicts.d1;
  assert.deepEqual(conflict.fields.map((f) => [f.header, f.app, f.sheet]), [['Locked?', 'Y', 'N']]);
  // Undisputed cells still moved both ways.
  assert.equal(ctx.markers.d1.name, 'D-101 east');
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Notes')], 'app note');
  // Nothing overwrote the disputed cell on either side.
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'Y');
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'N');
  // A later round keeps waiting, then "Use the sheet's" settles it for good.
  await ctx.round({ force: true });
  assert.ok(ctx.link.state.conflicts.d1);
  ctx.link.state = { ...ctx.link.state, choices: { d1: 'sheet' } };
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N');
  assert.equal(ctx.link.state.conflicts.d1, undefined);
  await ctx.round({ force: true });
  assert.equal(ctx.link.state.conflicts.d1, undefined, 'the conflict does not come back');
  // "Keep mine" the other way round writes the app's value into the sheet.
  ctx.markers.d1.checklistResponses = { c1: { selection: 'N/A' } };
  await ctx.edit([{ row: r, col: await ctx.col('Locked?'), value: 'Y' }]);
  await ctx.round();
  assert.ok(ctx.link.state.conflicts.d1);
  ctx.link.state = { ...ctx.link.state, choices: { d1: 'app' } };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'N/A');
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N/A');
  assert.equal(ctx.link.state.conflicts.d1, undefined);
});

test('a bad value in the sheet is reported and never written into the app', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: await ctx.col('Locked?'), value: 'Maybe' }, { row: r, col: await ctx.col('Height'), value: 'tall' }]);
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c1, undefined);
  assert.equal(ctx.link.state.problems.length, 2);
  assert.match(ctx.link.state.problems[0].message, /Maybe/);
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'Maybe', 'the person fixes it, not us');
});

test('a row typed in the sheet becomes a new item; a copied row becomes a second item', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const sheet = await ctx.sheet();
  const at = sheet.rows.length;
  const col = (h) => sheet.rows[0].indexOf(h);
  await ctx.edit([
    { row: at, col: col('Item'), value: 'D-200' }, { row: at, col: col('Locked?'), value: 'Y' }, { row: at, col: col('Entity'), value: 'Installed' },
    // A copy of D-101's row, Row ID and all.
    { row: at + 1, col: 0, value: sheet.rows[1][0] }, { row: at + 1, col: col('Item'), value: 'D-101 copy' },
  ]);
  const res = await ctx.round();
  assert.equal(res.summary.created, 2);
  const created = Object.values(ctx.markers).filter((m) => m.source === 'sheet');
  assert.deepEqual(created.map((m) => m.name).sort(), ['D-101 copy', 'D-200']);
  const d200 = created.find((m) => m.name === 'D-200');
  assert.equal(d200.pageNumber, null, 'not placed on the drawing yet');
  assert.equal(d200.entityId, 'e1');
  assert.equal(d200.checklistResponses.c1.selection, 'Y');
  assert.equal(ctx.markers.d1.name, 'D-101', 'the original keeps its name');
  const after = await ctx.sheet();
  assert.match(after.rows[at][0], /^v1\./, 'the new row got its own Row ID');
  assert.notEqual(after.rows[at + 1][0], after.rows[1][0], 'the copy got a new Row ID');
  await ctx.round({ force: true });
  assert.equal(Object.keys(ctx.markers).length, 3, 'no twins on the next round');
});

test('a row deleted in the sheet never deletes the item, and can be put back', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  await fakeApi(`/files/${ctx.fileId}/delete-row`, { title: 'Doors - Level 1', row: await ctx.rowOf('d2') });
  await ctx.round();
  assert.ok(ctx.markers.d2, 'the item is still there');
  assert.ok(ctx.link.state.removedInSheet.d2);
  await ctx.round({ force: true });
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-102').length, 0, 'not re-added on its own');
  ctx.link.state = { ...ctx.link.state, choices: { d2: 'putBack' } };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-102').length, 1);
  assert.equal(ctx.link.state.removedInSheet.d2, undefined);
});

test('an item deleted in the app removes its row, unless the sheet changed that row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  const r2 = await ctx.rowOf('d2');
  await ctx.edit([{ row: r2, col: await ctx.col('Notes'), value: 'PM note' }]);
  delete ctx.markers.d1;
  delete ctx.markers.d2;
  await ctx.round();
  const rows = (await ctx.sheet()).rows;
  assert.equal(rows.filter((row) => row[3] === 'D-101').length, 0, 'untouched row removed');
  assert.equal(rows.filter((row) => row[3] === 'D-102').length, 1, 'a row the PM edited stays');
  await ctx.round({ force: true });
  assert.equal(Object.keys(ctx.markers).length, 0, 'and it does not come back as a new item');
});

test('a sort in the sheet between read and write: nothing lands on the wrong row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  ctx.markers.d1.checklistResponses = { c1: { selection: 'Y' } };
  // A provider that lets the PM sort Z-A right after we read the sheet.
  let sorted = false;
  const p = ctx.provider;
  const sorting = { ...p, readGrid: async (id) => {
    const grid = await p.readGrid(id);
    if (!sorted) { sorted = true; await fakeApi(`/files/${ctx.fileId}/sort`, { title: 'Doors - Level 1' }); }
    return grid;
  } };
  const res = await ctx.round({ provider: sorting });
  assert.equal(res.status, 'retry');
  const res2 = await ctx.round();
  assert.equal(res2.status, 'synced');
  const sheet = await ctx.sheet();
  const lockedCol = sheet.rows[0].indexOf('Locked?');
  assert.equal(sheet.rows.find((row) => row[3] === 'D-101')[lockedCol], 'Y');
  assert.notEqual(sheet.rows.find((row) => row[3] === 'D-102')[lockedCol], 'Y');
});

test('a sort that lands after the check but before the write: values go back to their own items', async () => {
  // Real Excel soak (2026-11-10): the sort came 400 ms into the round, after
  // the Row ID check; the app's value sat on another item's row and the next
  // round took it as a PM edit on both items.
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102'), d3: door('d3', 'D-103') } });
  await ctx.round(); await ctx.round();
  ctx.markers.d1.checklistResponses = { c1: { selection: 'Y' } };
  let sorted = false;
  const p = ctx.provider;
  const sortingWrite = { ...p, writeCells: async (id, cells) => {
    if (!sorted) { sorted = true; await fakeApi(`/files/${ctx.fileId}/sort`, { title: 'Doors - Level 1' }); }
    return p.writeCells(id, cells);
  } };
  const res = await ctx.round({ provider: sortingWrite });
  assert.equal(res.status, 'retry', 'rows moved: plan again from a fresh read');
  const sheet = await ctx.sheet();
  const lockedCol = sheet.rows[0].indexOf('Locked?');
  const cell = (name) => sheet.rows.find((row) => row[3] === name)[lockedCol];
  assert.equal(cell('D-101'), 'Y', 'the value is on its own item');
  assert.ok(!cell('D-103'), 'the item it landed on first is put back');
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.toApp, 0, 'nothing comes back to the app as a PM edit');
  assert.ok(!ctx.markers.d3.checklistResponses?.c1?.selection);
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'Y');
});

test('a sort that lands while a copied row gets its own Row ID: the Row ID stays with its row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102'), d3: door('d3', 'D-103') } });
  await ctx.round(); await ctx.round();
  const sheet = await ctx.sheet();
  const at = sheet.rows.length; const item = sheet.rows[0].indexOf('Item');
  // A copy of D-101's row (Row ID and all), named "A-copy" so a Z-A sort moves it.
  await ctx.edit([{ row: at, col: 0, value: sheet.rows[1][0] }, { row: at, col: item, value: 'A-copy' }]);
  let n = 0;
  const p = ctx.provider;
  const sortingIds = { ...p, writeCells: async (id, cells) => {
    if (cells.some((c) => c.col === 0 && !c.header) && n++ === 0) await fakeApi(`/files/${ctx.fileId}/sort`, { title: 'Doors - Level 1' });
    return p.writeCells(id, cells);
  } };
  const res = await ctx.round({ provider: sortingIds });
  assert.equal(res.status, 'retry');
  await ctx.round();
  await ctx.round({ force: true });
  const after = (await ctx.sheet()).rows;
  const idOf = (name) => after.find((r) => r[item] === name)?.[0];
  const ids = after.slice(1).map((r) => r[0]);
  assert.equal(new Set(ids).size, ids.length, 'no Row ID twice');
  for (const name of ['D-101', 'D-102', 'D-103']) assert.equal(ctx.markers[`d${name.slice(-1)}`].name, name, `${name} keeps its name`);
  const copy = Object.values(ctx.markers).filter((m) => m.name === 'A-copy');
  assert.equal(copy.length, 1, 'the copy is one new item');
  assert.notEqual(idOf('A-copy'), idOf('D-101'));
  assert.equal(Object.keys(ctx.markers).length, 4);
});

// A stand-in provider over one tab, for the Row ID repair on its own.
const oneTab = (rows) => ({
  rows,
  readGrid: async () => ({ sheets: [{ sheetId: '1', title: 'T', rows: rows.map((r) => [...r]) }] }),
  writeCells: async (_id, cells) => { for (const c of cells) rows[c.row][c.col] = c.value; },
  readCells: async (_id, cells) => cells.map((c) => rows[c.row]?.[c.col] ?? ''),
});

test('value repair after a mid-write sort leaves a person\'s edit on another item alone, even the same value', async () => {
  const before = [['Row ID', 'Item', 'Done'], ['t1', 'A', ''], ['t2', 'B', ''], ['t3', 'C', '']];
  // Sorted Z-A before our "Y" for A went out, so it landed on C; meanwhile
  // a PM set B to "Y" too.
  const tab = oneTab([['Row ID', 'Item', 'Done'], ['t3', 'C', 'Y'], ['t2', 'B', 'Y'], ['t1', 'A', '']]);
  const writes = [{ sheetId: '1', title: 'T', row: 1, col: 2, value: 'Y', markerId: 'a', key: 'answer:x' }];
  const idChecks = [{ sheetId: '1', title: 'T', row: 1, col: 0, token: 't1' }];
  await putMovedWritesRight({ provider: tab, fileId: 'f', grid: { sheets: [{ sheetId: '1', rows: before }] }, writes, idChecks, landed: new Map([['1|1', 't3']]) });
  assert.deepEqual(tab.rows.slice(1).map((r) => [r[1], r[2]]), [['C', ''], ['B', 'Y'], ['A', 'Y']]);
});

test('Row ID repair finds the heading under a title row, renamed in case and moved', async () => {
  const before = [['Doors report'], ['Row ID', 'Item', 'Notes'], ['', 'A-copy', ''], ['tokA', 'D-101', '']];
  // Sorted Z-A, Item heading retyped as "item" and moved to the end, then our
  // Row ID for A-copy landed on row 3, now D-101's.
  const tab = oneTab([['Doors report'], ['Row ID', 'Notes', 'item'], ['tokNew', '', 'D-101'], ['', '', 'A-copy']]);
  const idWrites = [{ sheetId: '1', title: 'T', row: 2, col: 0, value: 'tokNew', rowIdFor: 'A-copy', itemCol: 1, headerRow: 1 }];
  await putMovedRowIdsRight({ provider: tab, fileId: 'f', grid: { sheets: [{ sheetId: '1', rows: before }] }, idWrites });
  assert.equal(tab.rows[2][0], 'tokA', 'D-101 gets its own Row ID back');
  assert.equal(tab.rows[3][0], 'tokNew', 'the new Row ID sits with A-copy');
});

test('Row ID repair: two Row IDs crossed by a sort both end on their own items', async () => {
  const before = [['Row ID', 'Item'], ['', 'A1'], ['', 'B1']];
  const tab = oneTab([['Row ID', 'Item'], ['tokA', 'B1'], ['tokB', 'A1']]);
  const idWrites = [
    { sheetId: '1', title: 'T', row: 1, col: 0, value: 'tokA', rowIdFor: 'A1', itemCol: 1, headerRow: 0 },
    { sheetId: '1', title: 'T', row: 2, col: 0, value: 'tokB', rowIdFor: 'B1', itemCol: 1, headerRow: 0 },
  ];
  await putMovedRowIdsRight({ provider: tab, fileId: 'f', grid: { sheets: [{ sheetId: '1', rows: before }] }, idWrites });
  assert.deepEqual(tab.rows.slice(1), [['tokB', 'B1'], ['tokA', 'A1']]);
});

test('a sort right before rows are deleted: no other item\'s row is deleted', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102'), d3: door('d3', 'D-103') } });
  await ctx.round(); await ctx.round();
  delete ctx.markers.d1;
  let sorted = false;
  const p = ctx.provider;
  const sortingDelete = { ...p, readCells: async (id, cells) => {
    // The last check before deleting: the PM sorts Z-A just then.
    if (!sorted && cells.length === 1 && cells[0].token) { sorted = true; await fakeApi(`/files/${ctx.fileId}/sort`, { title: 'Doors - Level 1' }); }
    return p.readCells(id, cells);
  } };
  const res = await ctx.round({ provider: sortingDelete });
  assert.equal(res.status, 'retry');
  await ctx.round();
  const rows = (await ctx.sheet()).rows;
  const names = rows.slice(1).map((r) => r[3]).filter(Boolean).sort();
  assert.deepEqual(names, ['D-102', 'D-103'], 'only the deleted item\'s row went');
});

test('a new checklist line and a new category after linking: the sheet grows to match', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const bigger = template(true);
  bigger.modules[0].categories.push({ id: 'racks', name: 'Racks', checklist: [{ id: 'r1', text: 'Labelled?' }] });
  ctx.link.layout = buildSyncLayout({ template: bigger, kit: defaultKit });
  ctx.markers.d1.checklistResponses = { c3: { selection: 'Y' } };
  ctx.markers.r1 = { ...door('r1', 'Rack 1'), categoryId: 'racks' };
  await ctx.round();
  const doors = await ctx.sheet();
  assert.equal(doors.rows[0].at(-1), 'Signed off?');
  assert.equal(doors.rows[1].at(-1), 'Y');
  const racks = await ctx.sheet('Racks - Level 1');
  assert.equal(racks.rows[1][3], 'Rack 1');
  // A column the PM deletes stays deleted.
  const f = await fakeApi(`/files/${ctx.fileId}`);
  const notesCol = doors.rows[0].indexOf('Notes');
  await ctx.edit(f.sheets.find((s) => s.title === 'Doors - Level 1').rows.map((_, r) => ({ row: r, col: notesCol, value: null })));
  await ctx.round({ force: true });
  assert.equal((await ctx.sheet()).rows[0].filter((h) => h === 'Notes').length, 0);
});

test('an item moved to another category moves to that tab', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  ctx.markers.d1 = { ...ctx.markers.d1, categoryId: 'cams' };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-101').length, 0);
  assert.equal((await ctx.sheet('Cameras - Level 1')).rows.filter((row) => row[3] === 'D-101').length, 1);

  // And back again: the new tab is read before the old one this time.
  ctx.markers.d1 = { ...ctx.markers.d1, categoryId: 'doors' };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-101').length, 1);
  assert.equal((await ctx.sheet('Cameras - Level 1')).rows.filter((row) => row[3] === 'D-101').length, 0);
  assert.equal(Object.keys(ctx.markers).length, 1, 'no copy made');
});

test('mergeMarkerWrites keeps edits made meanwhile to other fields and answers', () => {
  const before = { a: { name: 'A', checklistResponses: { x: { selection: 'Y' }, y: { selection: 'N' } }, note: { text: '' } } };
  const fresh = { a: { name: 'A', checklistResponses: { x: { selection: 'Y' }, y: { selection: 'Y' } }, note: { text: 'typed meanwhile' } } };
  const writes = { a: { name: 'A2', checklistResponses: { x: { selection: 'N/A' }, y: { selection: 'N' } }, note: { text: '' } } };
  assert.deepEqual(mergeMarkerWrites(fresh, before, writes).a, {
    name: 'A2', checklistResponses: { x: { selection: 'N/A' }, y: { selection: 'Y' } }, note: { text: 'typed meanwhile' },
  });
});
