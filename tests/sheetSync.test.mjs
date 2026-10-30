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
