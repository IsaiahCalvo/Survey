// Live sheet sync, trying to break it (2026-10-30 audit,
// /mnt/project-files/sheet-sync/audit.md). Each test is a way a PM in the
// sheet and field techs in the app lost or mixed up data before the fix, and
// checks it no longer does. Same rig as tests/sheetSync.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { MAX_NEW_ROWS_PER_ROUND, fieldPrintsOf } from '../supabase/functions/_shared/sheetSync/engine.js';
import { computeRowFingerprints } from '../supabase/functions/_shared/matcher/rowFingerprint.js';
import { mergeMarkerWrites } from '../supabase/functions/_shared/sheetSync/service.js';
import { googleSheetsProvider } from '../supabase/functions/_shared/sheetSync/providers/google.js';
import {
  defaultKit, endpoints, fakeGoogleFetch, template, setup, door, fakeFile,
} from './helpers/sheetSyncHarness.mjs';

const DOORS = 'Doors - Level 1';
const tab = (ctx, title = DOORS) => fakeFile(ctx).sheets.find((s) => s.title === title);

test('a checklist line renamed in the template keeps syncing, and its header follows', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  const t = template();
  t.modules[0].categories[0].checklist[0].text = 'Is it locked?';
  ctx.link.layout = buildSyncLayout({ template: t, kit: defaultKit });
  ctx.markers.d1.checklistResponses = { c1: { selection: 'N' } };
  await ctx.round();
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows[0].indexOf('Locked?'), -1);
  const col = sheet.rows[0].indexOf('Is it locked?');
  assert.ok(col > 0, 'header renamed in place');
  assert.equal(sheet.rows[1][col], 'N', 'the app answer still reaches the sheet');
  await ctx.edit([{ row: 1, col, value: 'N/A' }]);
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N/A', 'and the sheet answer reaches the app');
});

test('a header renamed in the sheet is reported, not silently dropped', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  await ctx.edit([{ row: 0, col: await ctx.col('Notes'), value: 'Comments' }]);
  await ctx.round();
  assert.ok(ctx.link.state.problems.some((p) => /no "Notes" column/.test(p.message)));
});

test('two lines with the same name never swap answers when a column is moved', async () => {
  const t = template();
  t.modules[0].categories[0].checklist = [{ id: 'c1', text: 'OK?' }, { id: 'c2', text: 'OK?' }, { id: 'c3', text: 'Notes' }];
  const layout = buildSyncLayout({ template: t, kit: defaultKit });
  const headers = layout.scopes[0].columns.map((c) => c.header);
  assert.equal(new Set(headers.map((h) => h.toLowerCase())).size, headers.length, 'every header differs');
  assert.ok(headers.includes('OK? (2)') && headers.includes('Notes (2)'));
});

test('a formula showing #N/A never wipes the app value, and is left in place', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'keep me' }, checklistResponses: { c1: { selection: 'Y' } } }) } });
  await ctx.round();
  const notes = await ctx.col('Notes');
  const locked = await ctx.col('Locked?');
  tab(ctx).rows[1][notes] = { error: '#N/A' };
  tab(ctx).rows[1][locked] = { error: '#REF!' };
  await ctx.round();
  assert.equal(ctx.markers.d1.note.text, 'keep me');
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'Y');
  assert.deepEqual(tab(ctx).rows[1][notes], { error: '#N/A' }, 'the PM\'s formula is not overwritten');
  assert.ok(ctx.link.state.problems.some((p) => /Notes" shows #N\/A/.test(p.message)));
  // Once the formula works again, its value comes through as a normal edit.
  tab(ctx).rows[1][notes] = 'Looked up';
  await ctx.round();
  assert.equal(ctx.markers.d1.note.text, 'Looked up');
});

test('a date typed in a non-US sheet comes in as the right day', async () => {
  const t = template();
  t.modules[0].categories[0].checklist.push({ id: 'c4', text: 'Installed on', kind: 'date' });
  const layout = buildSyncLayout({ template: t, kit: defaultKit });
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') }, layout });
  await ctx.round();
  // 5 October 2026 in an en-GB sheet shows "05/10/2026"; the serial is 46300.
  tab(ctx).rows[1][await ctx.col('Installed on')] = { date: 46300, text: '05/10/2026' };
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c4.selection, '2026-10-05');
});

test('text columns are made plain text, so typed serial numbers keep their digits', async () => {
  const ctx = await setup({ markers: {} });
  const sheet = tab(ctx);
  for (const header of ['Item', 'Notes', 'Entity', 'Locked?']) assert.ok(sheet.textColumns.includes(sheet.rows[0].indexOf(header)), header);
  assert.ok(!sheet.textColumns.includes(sheet.rows[0].indexOf('Height')), 'number lines stay numbers');
});

test('a deleted tab is listed, and putting it back rebuilds it with every row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round();
  const f = fakeFile(ctx);
  f.sheets = f.sheets.filter((s) => s.title !== DOORS);
  await ctx.round();
  assert.deepEqual(ctx.link.state.missingTabs, ['m1:doors']);
  // "Put the tab back" (service.js) forgets the tab and its rows' baselines.
  const { sheetIds, ...rest } = ctx.link.state;
  const { 'm1:doors': _gone, ...keep } = sheetIds;
  ctx.link.state = { ...rest, sheetIds: keep };
  ctx.link.baseline = {};
  await ctx.round();
  const back = tab(ctx);
  assert.ok(back, 'tab made again');
  assert.equal(back.rows.length, 3);
  assert.deepEqual(ctx.link.state.missingTabs, []);
});

test('a new tab never clashes with a tab the PM already named the same', async () => {
  const ctx = await setup({ markers: {} });
  await ctx.round();
  await ctx.edit([], 'Cameras - Level 1');
  fakeFile(ctx).sheets.push({ sheetId: 999, title: 'Windows - Level 1', rows: [['my notes']], columnCount: 26, rowCount: 10, hidden: [], validations: 0 });
  const t = template();
  t.modules[0].categories.push({ id: 'win', name: 'Windows', checklist: [] });
  ctx.link.layout = buildSyncLayout({ template: t, kit: defaultKit });
  const res = await ctx.round();
  assert.equal(res.status, 'synced');
  assert.ok(fakeFile(ctx).sheets.some((s) => s.title === 'Windows - Level 1 (2)'));
  assert.deepEqual(tab(ctx, 'Windows - Level 1').rows, [['my notes']], 'the PM\'s tab is untouched');
});

test('undoing a delete in the app after the PM changed the row brings the row back, once', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  await ctx.edit([{ row: 1, col: await ctx.col('Notes'), value: 'PM note' }]);
  const saved = ctx.markers.d1;
  delete ctx.markers.d1;
  await ctx.round();
  assert.equal(tab(ctx).rows.length, 2, 'row kept: the PM changed it');
  ctx.markers.d1 = saved; // Undo
  await ctx.round();
  ctx.markers.d1 = { ...ctx.markers.d1, name: 'D-101 renamed' };
  await ctx.round();
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows.length, 2, 'no second row');
  assert.equal(sheet.rows[1][await ctx.col('Item')], 'D-101 renamed');
  assert.equal(ctx.markers.d1.note.text, 'PM note', 'the PM\'s edit made during the delete lands');
  assert.deepEqual(ctx.link.state.removedInSheet, {});
});

test('deleting an item in the app keeps its row when the PM has data in their own column', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round();
  const extra = (await ctx.sheet()).rows[0].length;
  await ctx.edit([{ row: 0, col: extra, value: 'Cost' }, { row: 1, col: extra, value: '$450' }]);
  await ctx.round();
  delete ctx.markers.d1;
  delete ctx.markers.d2;
  await ctx.round();
  const sheet = await ctx.sheet();
  assert.deepEqual(sheet.rows.slice(1).map((r) => r[extra]), ['$450'], 'D-101 kept with the cost; D-102 removed');
});

test('a PM typing in a cell while a round runs is never overwritten', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  const notes = await ctx.col('Notes');
  ctx.markers.d1.note = { text: 'tech note' };
  const real = ctx.provider;
  let typed = false;
  const typing = {
    ...real,
    readCells: async (fileId, cells) => {
      if (!typed) { tab(ctx).rows[1][notes] = 'PM typed during the round'; typed = true; }
      return real.readCells(fileId, cells);
    },
  };
  await ctx.round({ provider: typing });
  assert.equal(tab(ctx).rows[1][notes], 'PM typed during the round');
  await ctx.round();
  assert.equal(tab(ctx).rows[1][notes], 'PM typed during the round', 'still the PM\'s text');
  assert.deepEqual(ctx.link.state.conflicts.d1.fields.map((f) => [f.app, f.sheet]), [['tech note', 'PM typed during the round']], 'both edits wait for a choice');
});

test('a copy pasted above the original row never takes over the original item', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { pageNumber: 3 }) } });
  await ctx.round();
  const sheet = tab(ctx);
  const item = sheet.rows[0].indexOf('Item');
  const copy = [...sheet.rows[1]];
  copy[item] = 'D-102';
  sheet.rows.splice(1, 0, copy);
  await ctx.round();
  assert.equal(ctx.markers.d1.name, 'D-101', 'the pinned item keeps its name');
  const created = Object.values(ctx.markers).filter((m) => m.source === 'sheet');
  assert.deepEqual(created.map((m) => m.name), ['D-102']);
});

test('moving an item to another category keeps its old row when the PM had changed it', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  await ctx.edit([{ row: 1, col: await ctx.col('Notes'), value: 'PM note' }]);
  ctx.markers.d1 = { ...ctx.markers.d1, categoryId: 'cams' };
  await ctx.round();
  assert.equal(tab(ctx).rows.length, 2, 'old row kept');
  assert.ok(ctx.link.state.problems.some((p) => /moved to another category/.test(p.message)));
  assert.equal(tab(ctx, 'Cameras - Level 1').rows.length, 2, 'and the item is on its new tab');
  await ctx.round();
  assert.equal(tab(ctx, 'Cameras - Level 1').rows.length, 2, 'once');
});

test('a sheet restored from version history never brings back items deleted in the app', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  const before = structuredClone(tab(ctx).rows);
  delete ctx.markers.d1;
  await ctx.round();
  assert.equal(tab(ctx).rows.length, 1);
  tab(ctx).rows = before; // File > Version history > Restore
  await ctx.round();
  assert.equal(Object.keys(ctx.markers).length, 0);
  assert.ok(ctx.link.state.problems.some((p) => /deleted in Survey/.test(p.message)));
});

test('a heading or totals line with no item name is not made into an item', async () => {
  const ctx = await setup({ markers: {} });
  await ctx.round();
  await ctx.edit([{ row: 1, col: await ctx.col('Notes'), value: '--- Floor 2 ---' }]);
  await ctx.round();
  assert.equal(Object.keys(ctx.markers).length, 0);
  assert.ok(ctx.link.state.problems.some((p) => /Row 2 .* has no "Item"/.test(p.message)));
});

test('a new template line never writes over a PM column that has no header', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  const width = tab(ctx).rows[0].length;
  await ctx.edit([{ row: 1, col: width, value: 'PM cost $120' }]);
  ctx.link.layout = buildSyncLayout({ template: template(true), kit: defaultKit });
  await ctx.round();
  assert.equal(tab(ctx).rows[1][width], 'PM cost $120');
  assert.equal(tab(ctx).rows[0][width + 1], 'Signed off?');
});

test('a title row typed above the header: the tab keeps syncing', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  tab(ctx).rows.unshift(['Project ABC door survey']);
  ctx.markers.d1.name = 'D-101b';
  await ctx.round();
  assert.deepEqual(ctx.link.state.problems, []);
  assert.equal(tab(ctx).rows[2][3], 'D-101b');
  assert.deepEqual(tab(ctx).rows[0], ['Project ABC door survey']);
});

test('a pasted block of thousands of rows comes in a few hundred a round, quickly', async () => {
  const ctx = await setup({ markers: {} });
  await ctx.round();
  const sheet = tab(ctx);
  for (let i = 0; i < 1000; i += 1) sheet.rows.push(['', '', '', `R-${i}`, 'Y', 12, 'Installed', 'n']);
  const first = await ctx.round();
  assert.equal(first.summary.created, MAX_NEW_ROWS_PER_ROUND);
  assert.match(ctx.link.state.problems[0].message, /700 more new rows/);
  while (Object.keys(ctx.markers).length < 1000) await ctx.round();
  // A quiet round over 1,000 rows stays well inside the edge function's CPU.
  const cpu = process.cpuUsage();
  const quiet = await ctx.round();
  const ms = (process.cpuUsage(cpu).user + process.cpuUsage(cpu).system) / 1000;
  assert.equal(quiet.summary.created, 0);
  assert.ok(ms < 1500, `quiet round took ${ms} ms of CPU`);
});

test('a row pasted from another category is reported, not silently skipped', async () => {
  const ctx = await setup({ markers: { k1: { ...door('k1', 'CAM-1'), categoryId: 'cams' } } });
  await ctx.round();
  const cam = tab(ctx, 'Cameras - Level 1').rows[1];
  tab(ctx).rows.push([...cam]);
  await ctx.round();
  assert.ok(ctx.link.state.problems.some((p) => /another category's tab/.test(p.message)));
});

test('problems are capped and short, whatever the sheet holds', async () => {
  const ctx = await setup({ markers: {} });
  await ctx.round();
  const sheet = tab(ctx);
  for (let i = 0; i < 400; i += 1) sheet.rows.push(['', '', '', '', 'x'.repeat(10000)]);
  await ctx.round();
  assert.ok(ctx.link.state.problems.length <= 200);
  assert.ok(ctx.link.state.problems.every((p) => p.message.length <= 201));
});

test('baselines saved in the old fingerprint format still merge cell by cell', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  // Rewrite the baseline the way links made before this change stored it.
  const scope = ctx.link.layout.scopes[0];
  const { appRecordOf } = await import('../supabase/functions/_shared/sheetSync/engine.js');
  ctx.link.baseline.d1.fields = (await computeRowFingerprints(appRecordOf(ctx.markers.d1, scope))).fieldFingerprints;
  assert.match(ctx.link.baseline.d1.fields.item, /^v1:/);
  ctx.markers.d1.checklistResponses = { c1: { selection: 'Y' } };
  await ctx.edit([{ row: 1, col: await ctx.col('Notes'), value: 'PM' }]);
  const res = await ctx.round();
  assert.equal(res.summary.conflicts, 0);
  assert.equal(ctx.markers.d1.note.text, 'PM');
  assert.equal(tab(ctx).rows[1][await ctx.col('Locked?')], 'Y');
  assert.match(ctx.link.baseline.d1.fields.item, /^f2:/, 'rewritten in the new format');
  assert.deepEqual(Object.keys(fieldPrintsOf({ item: 'x' })).sort(), ['answers', 'changedBy', 'changedDate', 'entity', 'item', 'notes']);
});

test('saving a round keeps a note photo or answer comment added meanwhile', () => {
  const before = { d1: { id: 'd1', note: { text: 'a' }, checklistResponses: { c1: { selection: 'Y' } } } };
  const fresh = { d1: { id: 'd1', note: { text: 'a', photos: ['p1'] }, checklistResponses: { c1: { selection: 'Y', comment: 'loose' }, c2: { selection: 'N' } } } };
  const writes = { d1: { id: 'd1', note: { text: 'from sheet' }, checklistResponses: { c1: { selection: 'N/A' } } } };
  const out = mergeMarkerWrites(fresh, before, writes).d1;
  assert.deepEqual(out.note, { text: 'from sheet', photos: ['p1'] });
  assert.deepEqual(out.checklistResponses, { c1: { selection: 'N/A', comment: 'loose' }, c2: { selection: 'N' } });
});

test('a deleted synced tab makes the filtered read fall back, not fail', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  const provider = googleSheetsProvider({ endpoints, getAccessToken: async () => 'fake-access-1', fetchImpl: fakeGoogleFetch });
  const ids = Object.values(ctx.link.state.sheetIds);
  fakeFile(ctx).sheets.shift();
  const grid = await provider.readGrid(ctx.fileId, { sheetIds: ids });
  assert.deepEqual(grid.sheets.map((s) => s.title), ['Cameras - Level 1']);
});
