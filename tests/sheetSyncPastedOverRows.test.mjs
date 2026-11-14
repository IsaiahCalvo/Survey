// Rows pasted over other items' rows (Row IDs and all), then undone in Excel.
// Each pasted copy used to become a new item at once, and the undo then left
// those twins in the app with no row (real Excel 11-14: 3 extra items). A
// copy still named as its item now waits for a name of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door } from './helpers/sheetSyncHarness.mjs';

const N = 6;
const linked = async () => {
  const markers = Object.fromEntries(Array.from({ length: N }, (_, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: `note ${i + 1}` } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  return ctx;
};
const pasteRows = async (ctx, from, to) => {
  const sheet = await ctx.sheet();
  const edits = [];
  from.forEach((src, k) => sheet.rows[src].forEach((value, c) => edits.push({ row: to[k], col: c, value })));
  await ctx.edit(edits);
  return sheet;
};

test('rows pasted over other items\' rows make no twin items, and an undo leaves nothing behind', async () => {
  const ctx = await linked();
  const before = await pasteRows(ctx, [1, 2], [5, 6]);
  const r = await ctx.round({ force: true });
  assert.equal(r.summary.created, 0, 'no twins made');
  assert.equal(Object.keys(ctx.markers).length, N);
  for (let i = 0; i < N; i++) assert.equal(ctx.markers[`d${i + 1}`].note.text, `note ${i + 1}`, 'no note changed');
  const copyLines = (ctx.link.state.problems || []).filter((p) => /is a copy of the "D-10[12]" row/.test(p.message));
  assert.equal(copyLines.length, 2, 'the panel says why each copy waits');

  // Undo in Excel: the rows come back as they were.
  const edits = [];
  [5, 6].forEach((row) => before.rows[row].forEach((value, c) => edits.push({ row, col: c, value })));
  await ctx.edit(edits);
  const u = await ctx.round({ force: true });
  assert.equal(u.summary.created, 0);
  assert.equal(Object.keys(ctx.markers).length, N, 'no twin items left in the app');
  assert.ok(!(ctx.link.state.problems || []).some((p) => /copy of/.test(p.message)));
  assert.deepEqual(Object.keys(ctx.link.state.removedInSheet || {}), [], 'nothing listed as removed');
});

test('a pasted copy given its own name becomes a new item', async () => {
  const ctx = await linked();
  await pasteRows(ctx, [1], [N + 1]);
  await ctx.round({ force: true });
  assert.equal(Object.keys(ctx.markers).length, N);
  const item = (await ctx.sheet()).rows[0].indexOf('Item');
  await ctx.edit([{ row: N + 1, col: item, value: 'D-200' }]);
  const r = await ctx.round({ force: true });
  assert.equal(r.summary.created, 1);
  const made = Object.values(ctx.markers).find((m) => m.name === 'D-200');
  assert.ok(made, 'the renamed copy is a new item');
  assert.equal(made.note.text, 'note 1', 'with the copied note');
  assert.equal(ctx.markers.d1.name, 'D-101', 'the original keeps its name');
  const rows = (await ctx.sheet()).rows;
  assert.notEqual(rows[N + 1][0], rows[1][0], 'the copy got its own Row ID');
});
