// Live sheet sync against the messy ways PMs really handle workbooks, found
// in real Excel on the Microsoft 365 trial (2026-11-10, thread "Break Excel
// sync with real-world workbooks";
// /mnt/project-files/excel-sync/real-world-workbooks-2026-11-10.md). Each test
// is a way field notes were lost before the fix. Same rig as
// tests/sheetSyncBreak.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { setup, door, fakeFile } from './helpers/sheetSyncHarness.mjs';

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
