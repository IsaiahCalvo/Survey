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

// A column of a few repeated answers (Y / N): a PM who flips two Y to N and
// two N to Y in one save leaves the same values, reshuffled, but the column is
// not in order the way a sort leaves it. Those are four real edits (Excel on
// the web saves a minute of typing at once, so they arrive together).
test('a PM flipping two Y to N and two N to Y is four edits, not a sort', async () => {
  const yn = ['Y', 'N', 'Y', 'N', 'Y', 'N', 'Y', 'N'];
  const markers = Object.fromEntries(yn.map((v, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { checklistResponses: { c1: { selection: v } } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const col = (await ctx.sheet()).rows[0].indexOf('Locked?');
  const flips = { d1: 'N', d2: 'Y', d5: 'N', d6: 'Y' };
  const edits = [];
  for (const [id, value] of Object.entries(flips)) edits.push({ row: await ctx.rowOf(id), col, value });
  await ctx.edit(edits);
  await ctx.round({ force: true });
  for (const [id, value] of Object.entries(flips)) assert.equal(ctx.markers[id].checklistResponses.c1.selection, value, `${id} took the PM's ${value}`);
  assert.ok(!(ctx.link.state.notices || []).some((n) => /sorted by itself/.test(n.message)), 'no false sort line');
});

test('a Y / N column sorted by itself still goes back', async () => {
  const yn = ['Y', 'N', 'Y', 'N', 'Y', 'N', 'Y', 'N'];
  const markers = Object.fromEntries(yn.map((v, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { checklistResponses: { c1: { selection: v } } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = await ctx.sheet();
  const col = sheet.rows[0].indexOf('Locked?');
  const itemCol = sheet.rows[0].indexOf('Item');
  const rows = sheet.rows.slice(1).filter((r) => r[itemCol]);
  const sorted = rows.map((r) => r[col]).sort(); // N N N N Y Y Y Y
  await ctx.edit(sorted.map((value, i) => ({ row: i + 1, col, value })));
  await ctx.round({ force: true });
  yn.forEach((v, i) => assert.equal(ctx.markers[`d${i + 1}`].checklistResponses.c1.selection, v));
  assert.ok((ctx.link.state.notices || []).some((n) => /"Locked\?" .* was sorted by itself/.test(n.message)));
});

// Excel's sort passes over case, accents, hyphens and apostrophes; this is the
// order it left these notes in (Excel on the web, 11-14).
test('mixed notes in Excel\'s own sort order still count as sorted', async () => {
  const mix = ['Room 10', 'Zed', 'room 9', "O'Brien door", 'apple', 'OBrien hall', 'D1 check', 'D-10 check'];
  const excelOrder = ['apple', 'D1 check', 'D-10 check', "O'Brien door", 'OBrien hall', 'Room 10', 'room 9', 'Zed'];
  const markers = Object.fromEntries(mix.map((t, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: t } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const col = (await ctx.sheet()).rows[0].indexOf('Notes');
  const edits = [];
  for (let i = 0; i < mix.length; i++) edits.push({ row: await ctx.rowOf(`d${i + 1}`), col, value: excelOrder[i] });
  await ctx.edit(edits);
  await ctx.round({ force: true });
  mix.forEach((t, i) => assert.equal(ctx.markers[`d${i + 1}`].note.text, t));
});

// The visible columns sorted together, the hidden Row ID column left out (a
// PM selects Item to Notes and sorts): whole rows land on other items' Row
// IDs. One column alone is not left in order (Item, Y / N), so the rows are
// matched whole (real Excel 11-14).
test('the visible columns sorted without the Row ID column: every row goes back to its own item', async () => {
  const yn = ['Y', 'N', 'Y', 'Y', 'N', 'N', 'Y', 'N'];
  const words = ['pear', 'apple', 'kiwi', 'fig', 'plum', 'date', 'lime', 'banana'];
  const markers = Object.fromEntries(words.map((w, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { checklistResponses: { c1: { selection: yn[i] } }, note: { text: w } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const head = (await ctx.sheet()).rows[0];
  const cols = ['Item', 'Locked?', 'Notes'].map((h) => head.indexOf(h));
  const first = await ctx.rowOf('d1');
  const rows = (await ctx.sheet()).rows.slice(first, first + words.length);
  const sorted = [...rows].sort((a, b) => String(a[cols[2]]).localeCompare(String(b[cols[2]])));
  const edits = [];
  sorted.forEach((row, i) => cols.forEach((c) => edits.push({ row: first + i, col: c, value: row[c] ?? '' })));
  await ctx.edit(edits);
  const r = await ctx.round({ force: true });
  assert.equal(r.summary.toApp, 0);
  words.forEach((w, i) => {
    const m = ctx.markers[`d${i + 1}`];
    assert.deepEqual([m.name, m.checklistResponses.c1.selection, m.note.text], [`D-${101 + i}`, yn[i], w]);
  });
  assert.ok((ctx.link.state.notices || []).some((n) => /were sorted or moved without their hidden Row ID column/.test(n.message)));
  const after = (await ctx.sheet()).rows.slice(first, first + words.length);
  after.forEach((row, i) => assert.deepEqual([row[cols[0]], row[cols[2]]], [`D-${101 + i}`, words[i]]));
});

test('two rows swapped without the Row ID column, names and all: both go back', async () => {
  const yn = ['Y', 'N', 'Y', 'Y', 'N', 'N'];
  const words = ['plum', 'fig', 'grape', 'peach', 'apple', 'pear'];
  const markers = Object.fromEntries(words.map((w, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { checklistResponses: { c1: { selection: yn[i] } }, note: { text: w } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const head = (await ctx.sheet()).rows[0];
  const cols = ['Item', 'Locked?', 'Notes'].map((h) => head.indexOf(h));
  const first = await ctx.rowOf('d1');
  const rows = (await ctx.sheet()).rows.slice(first, first + words.length);
  // Sorted by Notes: only plum (D-101) and apple (D-105) trade places.
  const sorted = [...rows].sort((a, b) => String(a[cols[2]]).localeCompare(String(b[cols[2]])));
  const edits = [];
  sorted.forEach((row, i) => cols.forEach((c) => edits.push({ row: first + i, col: c, value: row[c] ?? '' })));
  await ctx.edit(edits);
  await ctx.round({ force: true });
  words.forEach((w, i) => {
    const m = ctx.markers[`d${i + 1}`];
    assert.deepEqual([m.name, m.checklistResponses.c1.selection, m.note.text], [`D-${101 + i}`, yn[i], w]);
  });
});

test('a short Notes column sorted with only three cells moving still goes back when the whole column now reads in order', async () => {
  const notes = ['plum', 'peach', '', 'tech a', 'tech b', 'banana'];
  const markers = Object.fromEntries(notes.map((n, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: n } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const col = (await ctx.sheet()).rows[0].indexOf('Notes');
  const first = await ctx.rowOf('d1');
  const sorted = ['banana', 'peach', 'plum', 'tech a', 'tech b', ''];
  await ctx.edit(sorted.map((value, i) => ({ row: first + i, col, value })));
  await ctx.round({ force: true });
  assert.deepEqual(notes.map((_, i) => ctx.markers[`d${i + 1}`].note.text), notes);
});
