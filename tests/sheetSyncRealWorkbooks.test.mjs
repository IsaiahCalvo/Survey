// Live sheet sync against the messy ways PMs really handle workbooks, found
// in real Excel on the Microsoft 365 trial (2026-11-10, thread "Break Excel
// sync with real-world workbooks";
// /mnt/project-files/excel-sync/real-world-workbooks-2026-11-10.md). Each test
// is a way field notes were lost before the fix. Same rig as
// tests/sheetSyncBreak.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { runSheetRound } from '../supabase/functions/_shared/sheetSync/round.js';
import { createMsGraphProvider, parseMsgraphFileId } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';
import { mergeMarkerWrites } from '../supabase/functions/_shared/sheetSync/service.js';
import defaultKit from '../src/services/exportFormats/kits/defaultSurvey.js';
import { fakeMsgraphFetch, resetFakeMsgraph } from '../scripts/e2e-fake-msgraph.mjs';
import { setup, door, fakeFile, template, signing } from './helpers/sheetSyncHarness.mjs';

const DOORS = 'Doors - Level 1';
const tab = (ctx) => fakeFile(ctx).sheets.find((s) => s.title === DOORS);
const notes = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: `note ${i + 1}` } })]));
const deleteColumn = (ctx, col) => { for (const row of tab(ctx).rows) row.splice(col, 1); };

test('a deleted Notes column put back blank never wipes the field notes', async () => {
  const ctx = await setup({ markers: notes(8) });
  await ctx.round();
  const notesCol = await ctx.col('Notes');
  deleteColumn(ctx, notesCol);
  await ctx.round();
  assert.ok(ctx.link.state.problems.some((p) => /no "Notes" column/.test(p.message)), 'the missing column is reported');
  ctx.markers.d1.note = { text: 'changed in the app while the column was gone' };
  await ctx.round();

  // The PM types the header back on an empty column at the end.
  const header = tab(ctx).rows[0];
  header.push('Notes');
  const result = await ctx.round();

  assert.equal(result.summary.toApp, 0, 'nothing comes in from the blank column');
  assert.equal(ctx.markers.d1.note.text, 'changed in the app while the column was gone');
  for (let i = 2; i <= 8; i += 1) assert.equal(ctx.markers[`d${i}`].note.text, `note ${i}`);
  const sheet = await ctx.sheet();
  const col = sheet.rows[0].indexOf('Notes');
  assert.equal(sheet.rows[await ctx.rowOf('d2')][col], 'note 2', 'Survey fills the column back in');
  assert.equal(sheet.rows[await ctx.rowOf('d1')][col], 'changed in the app while the column was gone');

  // From then on the column syncs as usual: a PM clearing one note is a clear.
  await ctx.edit([{ row: await ctx.rowOf('d3'), col, value: '' }]);
  await ctx.round();
  assert.equal(ctx.markers.d3.note.text ?? '', '');
});

test('a header renamed and renamed back keeps PM edits made meanwhile', async () => {
  const ctx = await setup({ markers: notes(3) });
  await ctx.round();
  const col = await ctx.col('Notes');
  await ctx.edit([{ row: 0, col, value: 'Comments' }]);
  await ctx.round();
  await ctx.edit([{ row: await ctx.rowOf('d2'), col, value: 'PM wrote this under Comments' }]);
  await ctx.edit([{ row: 0, col, value: 'Notes' }]);
  await ctx.round();
  assert.equal(ctx.markers.d2.note.text, 'PM wrote this under Comments');
  assert.equal(ctx.markers.d1.note.text, 'note 1');
});

test('a Row ID typed over is matched back to its item by name, not made a second item', async () => {
  const ctx = await setup({ markers: notes(4) });
  await ctx.round();
  const r = await ctx.rowOf('d3');
  const rowIdCol = await ctx.col('Row ID');
  await ctx.edit([{ row: r, col: rowIdCol, value: 'oops' }, { row: r, col: await ctx.col('Notes'), value: 'PM note after the typo' }]);
  const result = await ctx.round();
  assert.equal(result.summary.created, 0, 'no new item');
  assert.equal(Object.values(ctx.markers).filter((m) => m.name === 'D-103').length, 1);
  assert.equal(ctx.markers.d3.note.text, 'PM note after the typo', 'the PM edit on that row comes in');
  assert.ok(ctx.link.state.problems.some((p) => /Row ID was changed/.test(p.message)), 'and the PM is told');
  const sheet = await ctx.sheet();
  assert.notEqual(sheet.rows[r][rowIdCol], 'oops', 'the Row ID is put back');
  const quiet = await ctx.round();
  assert.equal(quiet.summary.created + quiet.summary.toApp + quiet.summary.toSheet, 0, 'and the next round is quiet');
  assert.ok(!ctx.link.state.removedInSheet?.d3, 'never listed as deleted');
});

test('a row deleted in an earlier round, then a new row typed with its name: a new item, the old one untouched', async () => {
  const ctx = await setup({ markers: notes(3) });
  await ctx.round();
  tab(ctx).rows.splice(await ctx.rowOf('d3'), 1);
  await ctx.round();
  assert.ok(ctx.link.state.removedInSheet?.d3, 'listed as removed in the sheet');
  const width = tab(ctx).rows[0].length;
  const row = Array(width).fill('');
  row[await ctx.col('Item')] = 'D-103';
  tab(ctx).rows.push(row);
  await ctx.round();
  assert.equal(ctx.markers.d3.note.text, 'note 3', 'the old item keeps its note');
  assert.equal(Object.values(ctx.markers).filter((m) => m.name === 'D-103').length, 2, 'the typed row is a new item');
  assert.ok(ctx.link.state.removedInSheet?.d3, 'and the old one is still listed as removed');
});

test('two items with the same name: a broken Row ID is not guessed at', async () => {
  const ctx = await setup({ markers: { a: door('a', 'Door'), b: door('b', 'Door') } });
  await ctx.round();
  const r = await ctx.rowOf('a');
  await ctx.edit([{ row: r, col: await ctx.col('Row ID'), value: '' }, { row: r + 1, col: await ctx.col('Row ID'), value: '' }]);
  await ctx.round();
  assert.equal(Object.values(ctx.markers).filter((m) => m.name === 'Door').length, 4, 'both rows come in as new items, as before');
});

test('an Excel table Total Row is a totals line: new items go above it and nothing is reported', async () => {
  const ctx = await setup({ markers: notes(3) });
  await ctx.round();
  const width = tab(ctx).rows[0].length;
  const total = Array(width).fill('');
  total[0] = 'Total';
  total[await ctx.col('Notes')] = 3;
  tab(ctx).rows.push(total);
  ctx.markers.d9 = door('d9', 'D-109');
  await ctx.round();
  assert.ok(!ctx.link.state.problems.some((p) => /has no "Item"/.test(p.message)), JSON.stringify(ctx.link.state.problems));
  const rows = tab(ctx).rows;
  const item = rows[0].indexOf('Item');
  assert.equal(rows[rows.length - 1][0], 'Total', 'the totals line stays last');
  assert.equal(rows[rows.length - 2][item], 'D-109');
});

// --- Through the Microsoft adapter (the fake Microsoft, as real Excel answers) ---

const MS = 'http://fake-ms.test/v1.0';
const msProvider = (extra = {}) => createMsGraphProvider({ getAccessToken: async () => 'fake-ms-access-1', fetch: fakeMsgraphFetch, baseUrl: MS, ...extra });

async function msSetup(markers) {
  resetFakeMsgraph();
  const layout = buildSyncLayout({ template: template(), kit: defaultKit });
  const made = await msProvider().createFile({ title: 'Survey A', layout });
  const ctx = { markers: structuredClone(markers), link: { file_id: made.fileId, layout, baseline: {}, state: { sheetIds: made.sheetIds }, remote_version: null, app_hash: null } };
  ctx.round = async (provider = msProvider()) => {
    const result = await runSheetRound({
      link: ctx.link, provider, signing, newMarkerId: () => `new-${Math.random()}`,
      loadMarkers: async () => structuredClone(ctx.markers),
      saveMarkers: async (writes) => { Object.assign(ctx.markers, mergeMarkerWrites(ctx.markers, ctx.markers, writes)); },
    });
    if (result.patch) Object.assign(ctx.link, result.patch);
    return result;
  };
  ctx.sheet = () => globalThis.__fakeMsgraph.files.get(parseMsgraphFileId(made.fileId).itemId).sheets.find((s) => s.name === 'Doors - Level 1');
  return ctx;
}

test('a big catch-up of scattered edits stops after its time and the next round writes the rest', async () => {
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`d${i}`, door(`d${i}`, `D-${1000 + i}`)]));
  const ctx = await msSetup(many);
  await ctx.round();
  // An offline phone comes back with a note on every other item: 100 scattered cells.
  for (let i = 0; i < 200; i += 2) ctx.markers[`d${i}`].note = { text: `caught up ${i}` };
  // A clock that jumps a minute a call: writes stop after the first batch of 20.
  // Small sparse writes (one row each), or all 100 cells would go in one write.
  let t = Date.now();
  const slow = msProvider({ now: () => (t += 61_000), sparseMaxCells: 4 });
  await assert.rejects(ctx.round(slow), (e) => e.status === 503 && e.code === 'partial' && /next round/.test(e.message));
  const notes = () => { const s = ctx.sheet(); const col = s.cells[0].indexOf('Notes'); return s.cells.slice(1).filter((r) => String(r?.[col] ?? '').startsWith('caught up')).length; };
  const landed = notes();
  assert.ok(landed > 0 && landed < 100, `some landed, not all (${landed})`);
  const next = await ctx.round();
  assert.equal(next.summary.conflicts, 0, 'what landed is not a conflict');
  assert.equal(next.summary.toApp, 0, 'nothing bounces back to the app');
  assert.equal(notes(), 100, 'the rest is written');
  for (let i = 0; i < 200; i += 2) assert.equal(ctx.markers[`d${i}`].note.text, `caught up ${i}`);
});

test('scattered app edits go out in one sparse write that leaves every other cell alone', async () => {
  // A PM's formula-heavy tab makes Excel work everything out again after each
  // write (~1.3 s each, real Excel 11-12), so 20 scattered notes are one write.
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`d${i}`, door(`d${i}`, `D-${1000 + i}`)]));
  const ctx = await msSetup(many);
  await ctx.round();
  const picked = Array.from({ length: 20 }, (_, i) => 3 + i * 14);
  for (const i of picked) ctx.markers[`d${i}`].note = { text: `tech ${i}` };
  // A PM's note on an item in between lands after the round read the sheet
  // and before it writes: the write must not blank it.
  const writes = [];
  let pmTyped = false;
  const watching = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const parts = new URL(req.url).pathname.endsWith('/$batch') ? (await req.clone().json()).requests : [{ method: req.method, url: req.url }];
    const rangeWrites = parts.filter((r) => r.method === 'PATCH' && /range\(address=/.test(r.url));
    if (rangeWrites.length && !pmTyped) {
      pmTyped = true;
      const s = ctx.sheet(); const item = s.cells[0].indexOf('Item'); const col = s.cells[0].indexOf('Notes');
      s.cells.find((row) => row[item] === 'D-1010')[col] = 'pm typed meanwhile';
    }
    writes.push(...rangeWrites.map((r) => r.url));
    return fakeMsgraphFetch(req);
  };
  const r = await ctx.round(msProvider({ fetch: watching }));
  assert.equal(r.summary.toSheet, 20);
  assert.equal(writes.length, 1, writes.join(' | '));
  const s = ctx.sheet(); const item = s.cells[0].indexOf('Item'); const col = s.cells[0].indexOf('Notes');
  const noteOf = (name) => s.cells.find((row) => row[item] === name)[col];
  for (const i of picked) assert.equal(noteOf(`D-${1000 + i}`), `tech ${i}`);
  assert.equal(noteOf('D-1010'), 'pm typed meanwhile', 'a cell the write left alone keeps what the PM typed');
  assert.equal(noteOf('D-1004'), '', 'cells in between are not written');
  await ctx.round();
  assert.equal(ctx.markers.d10.note.text, 'pm typed meanwhile');
});

test('rows deleted next to each other go out in one call per run', async () => {
  const calls = [];
  const counting = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (new URL(req.url).pathname.endsWith('/$batch')) for (const r of (await req.clone().json()).requests) calls.push(r.url);
    else calls.push(new URL(req.url).pathname);
    return fakeMsgraphFetch(req);
  };
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${i}`, door(`d${i}`, `D-${100 + i}`)]));
  const ctx = await msSetup(many);
  await ctx.round();
  for (const i of [2, 3, 4, 7]) delete ctx.markers[`d${i}`];
  const r = await ctx.round(msProvider({ fetch: counting }));
  assert.equal(r.summary.deleted, 4);
  const deletes = calls.filter((c) => c.endsWith('/delete'));
  assert.equal(deletes.length, 2, deletes.join(' | '));
  const col = ctx.sheet().cells[0].indexOf('Item');
  assert.deepEqual(ctx.sheet().cells.slice(1).map((row) => row[col]).filter(Boolean), ['D-100', 'D-101', 'D-105', 'D-106', 'D-108', 'D-109']);
});

test('a stray cell far off to the right does not push new items down to its row', async () => {
  const ctx = await msSetup({ d1: door('d1', 'D-101'), d2: door('d2', 'D-102') });
  await ctx.round();
  const cells = ctx.sheet().cells;
  while (cells.length < 400) cells.push([]);
  cells[399][25] = 'PM note in Z400';
  ctx.markers.d3 = door('d3', 'D-103');
  await ctx.round();
  const col = ctx.sheet().cells[0].indexOf('Item');
  assert.equal(ctx.sheet().cells[3]?.[col], 'D-103', 'right under the list');
  assert.equal(ctx.sheet().cells[399][25], 'PM note in Z400', 'the stray cell is left as it was');
});
