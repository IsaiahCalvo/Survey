// One column sorted by itself, apart from the rest of each row: Excel on the
// web asks "Expand your selection?" and a PM who picks "Just sort" moves every
// note onto another item's row while the Row IDs stay put (real Excel 11-14:
// all 12 notes of a 12-item tab went to the wrong items in the app). The
// engine sees a column whose changed cells hold the same values as before,
// reshuffled, and keeps each value on its own item, writing it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door } from './helpers/sheetSyncHarness.mjs';

const N = 8;
const notes = (i) => `note ${String.fromCharCode(72 - i)} ${i + 1}`; // descending letters, so a sort moves them all
const linked = async () => {
  const markers = Object.fromEntries(Array.from({ length: N }, (_, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: notes(i) } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = await ctx.sheet();
  const col = sheet.rows[0].indexOf('Notes');
  const itemCol = sheet.rows[0].indexOf('Item');
  const rowsOf = async () => (await ctx.sheet()).rows.slice(1).filter((r) => r[itemCol]);
  return { ctx, col, itemCol, rowsOf };
};
const appNotes = (ctx) => Object.fromEntries(Object.values(ctx.markers).map((m) => [m.name, m.note?.text]));
const want = Object.fromEntries(Array.from({ length: N }, (_, i) => [`D-${101 + i}`, notes(i)]));

test('a Notes column sorted by itself: every item keeps its own note and the sheet is put back', async () => {
  const { ctx, col, itemCol, rowsOf } = await linked();
  const sorted = (await rowsOf()).map((r) => r[col]).sort();
  await ctx.edit(sorted.map((value, i) => ({ row: i + 1, col, value })));
  const r = await ctx.round({ force: true });
  assert.deepEqual(appNotes(ctx), want, 'no note moved to another item in the app');
  assert.equal(r.summary.toApp, 0);
  for (const row of await rowsOf()) assert.equal(row[col], want[row[itemCol]], `${row[itemCol]} has its own note again in the sheet`);
  assert.ok((ctx.link.state.notices || []).some((n) => /"Notes" .* was sorted by itself, apart from the rest of each row/.test(n.message)), 'the panel says why');
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.toSheet + quiet.summary.toApp, 0, 'the next round is quiet');
});

test('only part of the column sorted, blanks included: those cells go back too', async () => {
  const { ctx, col, itemCol, rowsOf } = await linked();
  ctx.markers.d3.note = { text: '' };
  await ctx.round({ force: true });
  const part = (await rowsOf()).slice(0, 5).map((r) => r[col] ?? '').sort();
  await ctx.edit(part.map((value, i) => ({ row: i + 1, col, value })));
  await ctx.round({ force: true });
  assert.deepEqual(appNotes(ctx), { ...want, 'D-103': '' });
  for (const row of await rowsOf()) assert.equal(row[col] ?? '', row[itemCol] === 'D-103' ? '' : want[row[itemCol]]);
});

test('the Item column sorted by itself does not rename items', async () => {
  const { ctx, col, rowsOf } = await linked();
  const s = await ctx.sheet();
  const itemCol = s.rows[0].indexOf('Item');
  const names = (await rowsOf()).map((r) => r[itemCol]).reverse();
  await ctx.edit(names.map((value, i) => ({ row: i + 1, col: itemCol, value })));
  await ctx.round({ force: true });
  assert.deepEqual(Object.values(ctx.markers).map((m) => m.name).sort(), Object.keys(want).sort());
  assert.equal(ctx.markers.d1.name, 'D-101');
  assert.equal(ctx.markers.d1.note.text, want['D-101']);
  for (const row of await rowsOf()) assert.ok(want[row[itemCol]] === row[col], 'names back on their own rows');
});

test('a PM swapping notes between two or three items is an edit, not a sort', async () => {
  const { ctx, col } = await linked();
  const r1 = await ctx.rowOf('d1'); const r2 = await ctx.rowOf('d2'); const r3 = await ctx.rowOf('d3');
  await ctx.edit([{ row: r1, col, value: want['D-102'] }, { row: r2, col, value: want['D-103'] }, { row: r3, col, value: want['D-101'] }]);
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d1.note.text, want['D-102']);
  assert.equal(ctx.markers.d2.note.text, want['D-103']);
  assert.equal(ctx.markers.d3.note.text, want['D-101']);
});

test('many new notes typed at once are edits, not a sort', async () => {
  const { ctx, col } = await linked();
  const edits = [];
  for (let i = 0; i < N; i++) edits.push({ row: await ctx.rowOf(`d${i + 1}`), col, value: `pm ${i}` });
  await ctx.edit(edits);
  await ctx.round({ force: true });
  for (let i = 0; i < N; i++) assert.equal(ctx.markers[`d${i + 1}`].note.text, `pm ${i}`);
});

test('a whole-list sort (Row IDs move with their rows) changes nothing', async () => {
  const { ctx, rowsOf } = await linked();
  const rows = await rowsOf();
  const sorted = [...rows].reverse();
  const edits = [];
  sorted.forEach((row, i) => row.forEach((value, c) => edits.push({ row: i + 1, col: c, value })));
  await ctx.edit(edits);
  const r = await ctx.round({ force: true });
  assert.deepEqual(appNotes(ctx), want);
  assert.equal(r.summary.toApp, 0);
  assert.ok(!(ctx.link.state.notices || []).some((n) => /sorted by itself/.test(n.message)));
});

test('a tech changes one item\'s note in the same round: that item keeps the tech\'s note, the rest go back', async () => {
  const { ctx, col, itemCol, rowsOf } = await linked();
  const sorted = (await rowsOf()).map((r) => r[col]).sort();
  await ctx.edit(sorted.map((value, i) => ({ row: i + 1, col, value })));
  ctx.markers.d4.note = { text: 'tech 4' };
  await ctx.round({ force: true });
  const notesNow = appNotes(ctx);
  for (const [name, note] of Object.entries(want)) if (name !== 'D-104') assert.equal(notesNow[name], note, `${name} kept its note`);
  assert.equal(notesNow['D-104'], 'tech 4', 'the sorted value on its row is not a PM edit, so no choice');
  assert.deepEqual(ctx.link.state.conflicts || {}, {});
  for (const row of await rowsOf()) assert.equal(row[col], row[itemCol] === 'D-104' ? 'tech 4' : want[row[itemCol]]);
});
