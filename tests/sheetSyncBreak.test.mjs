// Live sheet sync, trying to break it (2026-10-30 audit,
// /mnt/project-files/sheet-sync/audit.md). Each test is a way a PM in the
// sheet and field techs in the app lost or mixed up data before the fix, and
// checks it no longer does. Same rig as tests/sheetSync.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { MAX_CELL_CHARS, MAX_NEW_ROWS_PER_ROUND, fieldPrintsOf } from '../supabase/functions/_shared/sheetSync/engine.js';
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

test('the background sweep checks busy sheets every minute and quiet ones rarely', async () => {
  const { sweepDueAt } = await import('../supabase/functions/_shared/sheetSync/service.js');
  const now = Date.parse('2026-10-30T12:00:00Z');
  const at = (ms) => new Date(now - ms).toISOString();
  const min = 60 * 1000;
  const due = (link) => (sweepDueAt(link, now) - now) / min;
  // Changed 10 minutes ago, last round 30 s ago: due in 30 s.
  assert.equal(due({ last_change_at: at(10 * min), last_round_at: at(0.5 * min) }), 0.5);
  // Changed 3 hours ago: every 5 minutes.
  assert.equal(due({ last_change_at: at(180 * min), last_round_at: at(min) }), 4);
  // Changed 3 days ago: every 30 minutes.
  assert.equal(due({ last_change_at: at(3 * 1440 * min), last_round_at: at(min) }), 29);
  // Never changed or long quiet: every 6 hours; never synced: due now.
  assert.equal(due({ last_change_at: null, last_round_at: at(min) }), 359);
  assert.ok(due({ last_change_at: null, last_round_at: null }) < 0);
  // Excel (one cheap check): every minute for a day after a change.
  assert.equal(due({ provider: 'msgraph', last_change_at: at(180 * min), last_round_at: at(0.5 * min) }), 0.5);
  assert.equal(due({ provider: 'msgraph', last_change_at: at(3 * 1440 * min), last_round_at: at(min) }), 4);
});

// Real-Excel break test, 2026-11-09 (/mnt/project-files/excel-sync/break-test-2026-11-09.md).
test('a checkbox (TRUE / FALSE) in a pick-one column means Y / N and stays a checkbox', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { checklistResponses: { c1: { selection: 'N' } } }) } });
  await ctx.round();
  const locked = await ctx.col('Locked?');
  tab(ctx).rows[1][locked] = true; // ticked
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'Y', 'ticked means the yes answer');
  assert.equal(tab(ctx).rows[1][locked], true, 'the checkbox is not turned into "Y"');
  assert.deepEqual(ctx.link.state.problems, []);
  const quiet = await ctx.round({ force: true });
  assert.deepEqual(quiet.summary, { toSheet: 0, toApp: 0, created: 0, appended: 0, deleted: 0, conflicts: 0 }, 'a checkbox never looks changed again');
  ctx.markers.d1.checklistResponses.c1 = { selection: 'N' };
  await ctx.round();
  assert.equal(tab(ctx).rows[1][locked], false, 'the app clearing it clears the checkbox');
  ctx.markers.d1.checklistResponses.c1 = { selection: 'N/A' };
  await ctx.round();
  assert.equal(tab(ctx).rows[1][locked], 'N/A', 'an answer a checkbox cannot show is written as text');
});

test('a number typed with its own unit ("84 in") is taken; another unit is refused', async () => {
  const t = template();
  t.modules[0].categories[0].checklist[1].unit = 'in';
  const layout = buildSyncLayout({ template: t, kit: defaultKit });
  const ctx = await setup({ layout, markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round();
  const height = await ctx.col('Height');
  await ctx.edit([{ row: await ctx.rowOf('d1'), col: height, value: '84 in' }, { row: await ctx.rowOf('d2'), col: height, value: '7 ft' }]);
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c2.selection, '84');
  assert.equal(ctx.markers.d2.checklistResponses.c2?.selection ?? '', '');
  assert.ok(ctx.link.state.problems.some((p) => /"7 ft" does not fit "Height"/.test(p.message)));
});

test('a Microsoft sign-in with nothing syncing is used every two weeks so it never runs out; a dead one is forgotten', async () => {
  const { keepSignInsAlive } = await import('../supabase/functions/_shared/sheetSync/service.js');
  const { encryptToken, decryptToken } = await import('../supabase/functions/_shared/sheetSync/tokenCrypto.js');
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), MS_GRAPH_CLIENT_SECRET: 's' };
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const now = Date.parse('2026-11-09T12:00:00Z');
  const rows = [
    { user_id: 'alive', refresh_token_enc: await encryptToken('rt-alive', key) },
    { user_id: 'dead', refresh_token_enc: await encryptToken('rt-dead', key) },
  ];
  const writes = [];
  const chain = (record) => {
    const c = { filters: [], eq: (k, v) => { c.filters.push([k, v]); return c; }, lt: (k, v) => { c.lt = [k, v]; return c; }, order: () => c, limit: () => c,
      then: (ok) => ok(record(c)) };
    return c;
  };
  const service = { from: (table) => ({
    select: () => chain((c) => { assert.deepEqual(c.lt, ['updated_at', new Date(now - 14 * 86400000).toISOString()]); return { data: rows }; }),
    update: (patch) => chain((c) => { writes.push({ table, op: 'update', patch, filters: c.filters }); return {}; }),
    delete: () => chain((c) => { writes.push({ table, op: 'delete', filters: c.filters }); return {}; }),
  }) };
  const fetchImpl = async (url, init) => {
    const rt = new URLSearchParams(init.body).get('refresh_token');
    if (rt === 'rt-dead') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt-new', expires_in: 3600 }), { status: 200 });
  };
  const kept = await keepSignInsAlive({ env, service, fetchImpl }, now);
  assert.equal(kept, 1);
  const saved = writes.find((w) => w.op === 'update' && w.filters[0][1] === 'alive');
  assert.equal(saved.patch.updated_at, new Date(now).toISOString());
  assert.equal(await decryptToken(saved.patch.refresh_token_enc, key), 'rt-new');
  assert.ok(writes.some((w) => w.op === 'delete' && w.table === 'sheet_sync_connections' && w.filters[0][1] === 'dead'), 'dead sign-in forgotten');
  assert.ok(writes.some((w) => w.table === 'sheet_sync_links' && w.patch.status === 'broken'), 'its sheets say why they stopped');
});

test('a cell that will not keep what Survey writes (merged cells) never wipes the app value and stops being rewritten', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round();
  const notes = await ctx.col('Notes');
  const hiddenRow = await ctx.rowOf('d2');
  // Excel takes a write to the hidden part of a merged area and drops it.
  const real = ctx.provider;
  let dropped = 0;
  const merged = Object.assign(Object.create(null), real, {
    writeCells: async (fileId, cells) => real.writeCells(fileId, cells.filter((c) => {
      const hit = c.row === hiddenRow && c.col === notes;
      if (hit) dropped += 1;
      return !hit;
    })),
  });
  ctx.provider = merged;
  ctx.markers.d2.note = { text: 'app note for D-102' };
  await ctx.round();
  assert.equal(dropped, 1);
  const again = await ctx.round({ force: true });
  assert.equal(ctx.markers.d2.note.text, 'app note for D-102', 'the blank cell is not read as the PM clearing it');
  assert.equal(dropped, 1, 'not written again every round');
  assert.equal(again.summary.toApp, 0);
  assert.ok(ctx.link.state.problems.some((p) => /merged cells/.test(p.message)), 'the PM is told why');
  // Unmerged and typed into: it syncs again.
  ctx.provider = real;
  await ctx.edit([{ row: hiddenRow, col: notes, value: 'PM typed after unmerge' }]);
  await ctx.round();
  assert.equal(ctx.markers.d2.note.text, 'PM typed after unmerge');
  assert.deepEqual(ctx.link.state.stuck, {});
});

test('an idle Google sign-in is kept alive too, and a dead one is forgotten', async () => {
  const { keepSignInsAlive } = await import('../supabase/functions/_shared/sheetSync/service.js');
  const { encryptToken } = await import('../supabase/functions/_shared/sheetSync/tokenCrypto.js');
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), GOOGLE_SHEETS_CLIENT_ID: 'gid', GOOGLE_SHEETS_CLIENT_SECRET: 'gs', GOOGLE_OAUTH_TOKEN_URL: 'https://g.test/token' };
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const now = Date.parse('2026-11-09T12:00:00Z');
  const rows = { google: [
    { user_id: 'g-alive', refresh_token_enc: await encryptToken('g-alive', key) },
    { user_id: 'g-dead', refresh_token_enc: await encryptToken('g-dead', key) },
  ] };
  const writes = [];
  const chain = (record) => {
    const c = { filters: [], eq: (k, v) => { c.filters.push([k, v]); return c; }, lt: () => c, order: () => c, limit: () => c, then: (ok) => ok(record(c)) };
    return c;
  };
  const service = { from: (table) => ({
    select: () => chain((c) => ({ data: rows[c.filters.find(([k]) => k === 'provider')[1]] || [] })),
    update: (patch) => chain((c) => { writes.push({ table, op: 'update', patch, filters: c.filters }); return {}; }),
    delete: () => chain((c) => { writes.push({ table, op: 'delete', filters: c.filters }); return {}; }),
  }) };
  const asked = [];
  const fetchImpl = async (url, init) => {
    const rt = new URLSearchParams(init.body).get('refresh_token');
    asked.push(`${url} ${rt}`);
    if (rt === 'g-dead') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
  };
  assert.equal(await keepSignInsAlive({ env, service, fetchImpl }, now), 1);
  assert.ok(asked.every((a) => a.startsWith('https://g.test/token')), 'Google sign-ins go to Google');
  const saved = writes.find((w) => w.op === 'update' && w.filters[0][1] === 'g-alive');
  assert.equal(saved.patch.updated_at, new Date(now).toISOString());
  assert.equal(saved.patch.refresh_token_enc, undefined, 'Google keeps the same refresh token');
  assert.ok(writes.some((w) => w.op === 'delete' && w.filters[0][1] === 'g-dead' && w.filters[1][1] === 'google'));
  assert.ok(writes.some((w) => w.table === 'sheet_sync_links' && /Google sign-in/.test(w.patch.last_error || '')));
});

test('only the token endpoint ending a sign-in counts as signed out; Excel\'s own 401 does not', async () => {
  const { signInEnded } = await import('../supabase/functions/_shared/sheetSync/service.js');
  const { refreshGoogleToken, googleEndpoints } = await import('../supabase/functions/_shared/sheetSync/providers/google.js');
  const { refreshMsgraphToken } = await import('../supabase/functions/_shared/sheetSync/msgraphAuth.js');
  const deadToken = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  const g = await refreshGoogleToken({ endpoints: googleEndpoints({ GOOGLE_OAUTH_TOKEN_URL: 'https://g.test/token' }), clientId: 'a', clientSecret: 'b', refreshToken: 'x', fetchImpl: deadToken }).catch((e) => e);
  assert.equal(signInEnded(g), true, 'Google invalid_grant');
  const m = await refreshMsgraphToken({ clientId: 'a', clientSecret: 'b', tokenUrl: 'https://m.test/token' }, 'x', { fetch: deadToken }).catch((e) => e);
  assert.equal(signInEnded(m), true, 'Microsoft invalid_grant');
  // Seen in a real 40-minute Excel run: createSession refused once, fine a minute later.
  assert.equal(signInEnded(Object.assign(new Error('You do not have permissions to open this file in the browser.'), { status: 401, code: 'FileOpenUserUnauthorized' })), false);
  assert.equal(signInEnded({ status: 403 }), false);
});

test('a protected tab refuses Survey\'s write: told apart from a lost share, and nothing is lost', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  const real = ctx.provider;
  // Excel answers 403 AccessDenied to a write on a protected sheet (measured
  // 11-09); Sheets answers 403 PERMISSION_DENIED for a protected range.
  ctx.provider = Object.assign(Object.create(null), real, {
    writeCells: async () => { throw Object.assign(new Error('You cannot perform the requested operation.'), { status: 403, code: 'AccessDenied' }); },
  });
  ctx.markers.d1.note = { text: 'app note while protected' };
  const err = await ctx.round().then(() => null, (e) => e);
  assert.equal(err?.status, 403);
  assert.equal(err?.code, 'protected', 'a write refused after a good read is a protected tab');
  assert.equal(ctx.markers.d1.note.text, 'app note while protected');
  ctx.provider = real;
  await ctx.round();
  assert.equal((await ctx.sheet()).rows[await ctx.rowOf('d1')][await ctx.col('Notes')], 'app note while protected', 'it lands once unprotected');
});

test('a note longer than a cell holds is written cut to fit, keeps its full text in the app, and the next round is quiet', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: `${'x'.repeat(39999)}🚪` } }) } });
  await ctx.round();
  const cell = (await ctx.sheet()).rows[await ctx.rowOf('d1')][await ctx.col('Notes')];
  assert.equal(cell.length, MAX_CELL_CHARS, 'cut to fit an Excel cell (32,767)');
  const quiet = await ctx.round({ force: true });
  assert.deepEqual(Object.values(quiet.summary).filter(Boolean), []);
  assert.equal(ctx.markers.d1.note.text.length, 40001, 'the app keeps its full note');
});

test('a NUL in a note (pasted from a PDF) is left out of the cell, so Excel never sends back the note cut short', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'Door\u0000 A', { note: { text: 'first\u0000second' } }) } });
  await ctx.round();
  const row = (await ctx.sheet()).rows[1];
  assert.equal(row[await ctx.col('Notes')], 'firstsecond');
  assert.equal(row[await ctx.col('Item')], 'Door A');
  const quiet = await ctx.round({ force: true });
  assert.deepEqual(Object.values(quiet.summary).filter(Boolean), []);
  assert.equal(ctx.markers.d1.note.text, 'first\u0000second', 'the app keeps its text');
});

test('a PM value saved late by Excel on the web over a cell Survey just wrote is held as a conflict, not pulled in', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'Start' } }) } });
  ctx.provider = { ...ctx.provider, savesLate: true };
  const t0 = Date.parse('2026-11-10T03:00:00Z');
  await ctx.round({ now: new Date(t0) }); await ctx.round({ now: new Date(t0 + 1000), force: true });
  const notes = await ctx.col('Notes');
  const row = await ctx.rowOf('d1');
  // The PM types in Excel on the web (not saved yet); a second later the field tech changes the note.
  ctx.markers.d1.note = { text: 'App note' };
  await ctx.round({ now: new Date(t0 + 5000) });
  assert.equal((await ctx.sheet()).rows[row][notes], 'App note');
  // A minute later Excel's save lands over Survey's write.
  await ctx.edit([{ row, col: notes, value: 'PM web note' }]);
  const held = await ctx.round({ now: new Date(t0 + 65000), force: true });
  assert.equal(held.summary.conflicts, 1, 'asked, not pulled in');
  assert.equal(ctx.markers.d1.note.text, 'App note', 'the field note is kept');
  assert.equal((await ctx.sheet()).rows[row][notes], 'PM web note', 'the PM cell is left alone');
  assert.deepEqual(ctx.link.state.conflicts.d1.fields.map((f) => [f.app, f.sheet]), [['App note', 'PM web note']]);
  // Still held a round later, after the window.
  await ctx.round({ now: new Date(t0 + 700000), force: true });
  assert.ok(ctx.link.state.conflicts.d1);
  assert.equal(ctx.markers.d1.note.text, 'App note');
  // Keep mine: the field note goes back to the sheet.
  ctx.link.state.choices = { d1: 'app' };
  await ctx.round({ now: new Date(t0 + 701000), force: true });
  assert.equal((await ctx.sheet()).rows[row][notes], 'App note');
  assert.equal(ctx.link.state.conflicts.d1, undefined);
});

test('a sheet edit after the late-save window, or an Undo back to the old value, still comes in as a PM edit', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'Start' } }), d2: door('d2', 'D-102', { note: { text: 'Old' } }) } });
  ctx.provider = { ...ctx.provider, savesLate: true };
  const t0 = Date.parse('2026-11-10T03:00:00Z');
  await ctx.round({ now: new Date(t0) }); await ctx.round({ now: new Date(t0 + 1000), force: true });
  const notes = await ctx.col('Notes');
  ctx.markers.d1.note = { text: 'App note' };
  ctx.markers.d2.note = { text: 'New' };
  await ctx.round({ now: new Date(t0 + 5000) });
  // d2: the PM undoes Survey's write inside the window.
  await ctx.edit([{ row: await ctx.rowOf('d2'), col: notes, value: 'Old' }]);
  const undo = await ctx.round({ now: new Date(t0 + 65000), force: true });
  assert.equal(undo.summary.conflicts, 0, 'an Undo is not held');
  assert.equal(ctx.markers.d2.note.text, 'Old');
  // d1: the PM types after the window has passed.
  await ctx.edit([{ row: await ctx.rowOf('d1'), col: notes, value: 'PM later' }]);
  const r = await ctx.round({ now: new Date(t0 + 5000 + 310000), force: true });
  assert.equal(r.summary.conflicts, 0);
  assert.equal(ctx.markers.d1.note.text, 'PM later');
  assert.equal(ctx.markers.d2.note.text, 'Old');
});

// Real Excel on the web, 11-10: a tech's note landed, then the PM's Replace
// All ("note" to "NOTE") ran on a screen that hadn't pulled it yet and saved
// 48 s later, one save carrying eleven cells. Only the tech's cell is held.
test('a PM Replace All that saves late over a tech\'s note holds that note and takes the rest', async () => {
  const notesOf = (n) => ({ note: { text: `note ${n}` } });
  const ctx = await setup({ markers: Object.fromEntries([1, 2, 3, 4].map((n) => [`d${n}`, door(`d${n}`, `D-10${n}`, notesOf(n))])) });
  ctx.provider = { ...ctx.provider, savesLate: true };
  const t0 = Date.parse('2026-11-10T06:40:00Z');
  await ctx.round({ now: new Date(t0) }); await ctx.round({ now: new Date(t0 + 1000), force: true });
  const notes = await ctx.col('Notes');
  ctx.markers.d3.note = { text: 'tech note 3' };
  await ctx.round({ now: new Date(t0 + 6000) });
  assert.equal((await ctx.sheet()).rows[await ctx.rowOf('d3')][notes], 'tech note 3');
  // The late save: every note replaced, d3's from the stale "note 3", and the heading too.
  const edits = [{ row: 0, col: notes, value: 'NOTEs' }];
  for (const n of [1, 2, 3, 4]) edits.push({ row: await ctx.rowOf(`d${n}`), col: notes, value: `NOTE ${n}` });
  await ctx.edit(edits);
  const r = await ctx.round({ now: new Date(t0 + 54000), force: true });
  assert.equal(r.summary.conflicts, 1, 'the tech\'s note is asked about, not lost');
  assert.equal(ctx.markers.d3.note.text, 'tech note 3');
  assert.deepEqual(ctx.link.state.conflicts.d3.fields.map((f) => [f.app, f.sheet]), [['tech note 3', 'NOTE 3']]);
  for (const n of [1, 2, 4]) assert.equal(ctx.markers[`d${n}`].note.text, `NOTE ${n}`, 'the other replaced notes come in');
  const quiet = await ctx.round({ now: new Date(t0 + 60000), force: true });
  assert.equal(quiet.summary.toApp, 0, 'the renamed heading stays mapped');
});

// A PM typing a new item into the first empty row in Excel on the web while a
// field tech adds one: Survey appends the tech's row there (Graph sees it
// empty) and the PM's save lands on it later. It used to rename the tech's
// item to the PM's, with the PM's note, and the PM's item was never made.
test('a PM\'s new row saved late over the row Survey just added keeps both items', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  ctx.provider = { ...ctx.provider, savesLate: true };
  const t0 = Date.parse('2026-11-10T13:00:00Z');
  await ctx.round({ now: new Date(t0) }); await ctx.round({ now: new Date(t0 + 1000), force: true });
  ctx.markers.d2 = door('d2', 'D-102', { note: { text: 'tech note' } });
  await ctx.round({ now: new Date(t0 + 5000) });
  const row = await ctx.rowOf('d2');
  const item = await ctx.col('Item'); const notes = await ctx.col('Notes');
  await ctx.edit([{ row, col: item, value: 'D-120' }, { row, col: notes, value: 'PM typed' }]);
  const r = await ctx.round({ now: new Date(t0 + 50000), force: true });
  assert.equal(r.summary.conflicts, 0);
  assert.equal(r.summary.created, 1, 'the PM\'s row is a new item');
  assert.equal(ctx.markers.d2.name, 'D-102', 'the tech\'s item keeps its name');
  assert.equal(ctx.markers.d2.note.text, 'tech note', 'and its note');
  const pm = Object.values(ctx.markers).find((m) => m.name === 'D-120');
  assert.ok(pm, 'the PM\'s item is made');
  assert.equal(pm.note.text, 'PM typed');
  const rows = (await ctx.sheet()).rows;
  assert.deepEqual([rows[row][item], rows[row][notes]], ['D-102', 'tech note'], 'the tech\'s row is put back');
  assert.deepEqual([rows[row + 1][item], rows[row + 1][notes]], ['D-120', 'PM typed'], 'the PM\'s item goes in the row below');
  assert.ok(ctx.link.state.problems.some((p) => /typed into the row Survey had just filled/.test(p.message)), 'the panel says what happened');
  const quiet = await ctx.round({ now: new Date(t0 + 56000), force: true });
  assert.deepEqual(Object.values(quiet.summary).filter(Boolean), []);
});

// Excel can land one save cell by cell: the Item first (split off as the PM's
// item), the note a round later. That note is still held over the tech's.
test('the rest of a PM\'s late save, landing after the row was split, is still held', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  ctx.provider = { ...ctx.provider, savesLate: true };
  const t0 = Date.parse('2026-11-10T13:00:00Z');
  await ctx.round({ now: new Date(t0) }); await ctx.round({ now: new Date(t0 + 1000), force: true });
  ctx.markers.d2 = door('d2', 'D-102', { note: { text: 'tech note' } });
  await ctx.round({ now: new Date(t0 + 5000) });
  const row = await ctx.rowOf('d2');
  const item = await ctx.col('Item'); const notes = await ctx.col('Notes');
  await ctx.edit([{ row, col: item, value: 'D-120' }]);
  const r = await ctx.round({ now: new Date(t0 + 50000), force: true });
  assert.equal(r.summary.created, 1);
  await ctx.edit([{ row, col: notes, value: 'PM typed' }]);
  const later = await ctx.round({ now: new Date(t0 + 90000), force: true });
  assert.equal(later.summary.created, 0, 'no second split');
  assert.equal(ctx.markers.d2.name, 'D-102');
  assert.equal(ctx.markers.d2.note.text, 'tech note', 'the tech\'s note is not taken');
  assert.ok(ctx.link.state.conflicts?.d2, 'the late note is held');
});

test('a PM note saved late into the row Survey just added is held over a tech\'s note, and fills a blank one', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  ctx.provider = { ...ctx.provider, savesLate: true };
  const t0 = Date.parse('2026-11-10T13:00:00Z');
  await ctx.round({ now: new Date(t0) }); await ctx.round({ now: new Date(t0 + 1000), force: true });
  ctx.markers.d2 = door('d2', 'D-102', { note: { text: 'tech note' } });
  ctx.markers.d3 = door('d3', 'D-103');
  await ctx.round({ now: new Date(t0 + 5000) });
  const notes = await ctx.col('Notes');
  await ctx.edit([{ row: await ctx.rowOf('d2'), col: notes, value: 'PM typed' }, { row: await ctx.rowOf('d3'), col: notes, value: 'PM on blank' }]);
  const r = await ctx.round({ now: new Date(t0 + 50000), force: true });
  assert.equal(r.summary.conflicts, 1);
  assert.equal(ctx.markers.d2.note.text, 'tech note', 'the tech\'s note is not replaced');
  assert.deepEqual(ctx.link.state.conflicts.d2.fields.map((f) => [f.app, f.sheet]), [['tech note', 'PM typed']]);
  assert.equal(ctx.markers.d3.note.text, 'PM on blank', 'a cell the tech left blank just takes the PM\'s note');
  assert.equal(Object.keys(ctx.markers).length, 3, 'no new item without an Item');
});

test('a rename of a just-added item after that window, or on Google, is a rename', async () => {
  for (const late of [true, false]) {
    const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
    if (late) ctx.provider = { ...ctx.provider, savesLate: true };
    const t0 = Date.parse('2026-11-10T13:00:00Z');
    await ctx.round({ now: new Date(t0) }); await ctx.round({ now: new Date(t0 + 1000), force: true });
    ctx.markers.d2 = door('d2', 'D-102');
    await ctx.round({ now: new Date(t0 + 5000) });
    await ctx.edit([{ row: await ctx.rowOf('d2'), col: await ctx.col('Item'), value: 'D-102A' }]);
    const r = await ctx.round({ now: new Date(t0 + (late ? 200000 : 50000)), force: true });
    assert.equal(r.summary.created, 0, late ? 'after the window' : 'Google');
    assert.equal(ctx.markers.d2.name, 'D-102A');
    assert.equal(Object.keys(ctx.markers).length, 2);
  }
});

test('a first write over an old-format baseline is not watched, so an Undo comes straight in', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'Old' } }) } });
  ctx.provider = { ...ctx.provider, savesLate: true };
  const t0 = Date.parse('2026-11-10T03:00:00Z');
  await ctx.round({ now: new Date(t0) });
  const scope = ctx.link.layout.scopes[0];
  const { appRecordOf } = await import('../supabase/functions/_shared/sheetSync/engine.js');
  ctx.link.baseline.d1.fields = (await computeRowFingerprints(appRecordOf(ctx.markers.d1, scope))).fieldFingerprints;
  ctx.markers.d1.note = { text: 'New' };
  await ctx.round({ now: new Date(t0 + 5000) });
  assert.deepEqual(Object.keys(ctx.link.state.recentWrites).filter((k) => !k.endsWith('|+row')), [], 'an old-format "before" print could never match the sheet');
  await ctx.edit([{ row: await ctx.rowOf('d1'), col: await ctx.col('Notes'), value: 'Old' }]);
  const r = await ctx.round({ now: new Date(t0 + 65000), force: true });
  assert.equal(r.summary.conflicts, 0);
  assert.equal(ctx.markers.d1.note.text, 'Old');
});

test('a totals line typed under the items is not made an item, and new items go above it', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round();
  const item = await ctx.col('Item');
  const totalAt = tab(ctx).rows.length;
  await ctx.edit([{ row: totalAt, col: item, value: 'Grand total' }, { row: totalAt, col: await ctx.col('Notes'), value: '2 doors' }]);
  const r = await ctx.round();
  assert.equal(r.summary.created, 0);
  assert.ok(!Object.values(ctx.markers).some((m) => m.name === 'Grand total'));
  ctx.markers.d3 = door('d3', 'D-103');
  await ctx.round();
  const rows = tab(ctx).rows;
  assert.equal(rows[totalAt][item], 'D-103', 'the new item takes the totals line\'s place');
  assert.equal(rows[totalAt + 1][item], 'Grand total', 'the totals line stays last');
  const quiet = await ctx.round({ force: true });
  assert.deepEqual(Object.values(quiet.summary).filter(Boolean), []);
});

// Slow networks: a call that never answers used to hold the round (and its
// lease, and the person's panel) until the platform killed the function.
test('a Microsoft or Google call that hangs gives up and counts as busy', async () => {
  const { createMsGraphProvider } = await import('../supabase/functions/_shared/sheetSync/providers/msgraph.js');
  const { fetchWithTimeout } = await import('../supabase/functions/_shared/sheetSync/providers/contract.js');
  const hang = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const ms = createMsGraphProvider({ getAccessToken: async () => 't', fetch: hang, baseUrl: 'http://x.test/v1.0', timeoutMs: 30 });
  await assert.rejects(ms.getVersion('drives/d1/items/i1'), (err) => err.status === 504 && err.code === 'timeout');
  const g = googleSheetsProvider({ endpoints: { sheets: 'http://g.test', drive: 'http://g.test' }, getAccessToken: async () => 't', fetchImpl: hang, timeoutMs: 30 });
  await assert.rejects(g.getVersion('f1'), (err) => err.status === 504 && err.code === 'timeout');
  // A fast answer is untouched, and a real network error is not a timeout.
  const ok = await fetchWithTimeout(async () => ({ ok: true }), 'http://x.test', {}, 30);
  assert.equal(ok.ok, true);
  await assert.rejects(fetchWithTimeout(async () => { throw new TypeError('network down'); }, 'http://x.test', {}, 30), (err) => err instanceof TypeError);
});
