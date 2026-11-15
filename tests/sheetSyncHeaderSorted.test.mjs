// A sort with the heading row in it ("My data has headers" off in Excel or
// Sheets) puts the heading row among the items. Real Excel 11-15: sorted
// with the Row ID column, the items above the moved heading row stopped
// syncing both ways with no word to anyone (a tech's note never reached the
// sheet, a PM's never reached the app); sorted without it, the tab stuck on
// "has no Item column". Survey moves the heading row back on top, so the
// rows keep the PM's sort and the list syncs again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door, fakeFile } from './helpers/sheetSyncHarness.mjs';
import { findSortedHeader } from '../supabase/functions/_shared/sheetSync/engine.js';

const notes = ['pear', 'apple', 'kiwi', 'fig', 'plum', 'date', 'lime', 'banana'];
const mk = () => Object.fromEntries(notes.map((n, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: n } })]));
const TAB = 'Doors - Level 1';
const linked = async () => {
  const ctx = await setup({ markers: mk() });
  await ctx.round(); await ctx.round({ force: true });
  const tab = () => fakeFile(ctx).sheets.find((s) => s.title === TAB);
  const head = [...tab().rows[0]];
  return { ctx, tab, head, col: (name) => head.indexOf(name) };
};
// Excel's sort of rows 1..n+1 by one column, heading row included, over
// columns from..to only.
const sortWithHeading = (sheet, by, from, to, n = notes.length) => {
  const block = sheet.rows.slice(0, n + 1).map((r) => r.slice(from, to + 1));
  block.sort((a, b) => String(a[by - from]).localeCompare(String(b[by - from])));
  block.forEach((cells, r) => cells.forEach((v, i) => { sheet.rows[r][from + i] = v; }));
};
const appNotes = (ctx) => Object.fromEntries(Object.values(ctx.markers).map((m) => [m.name, m.note?.text]));
const want = Object.fromEntries(notes.map((n, i) => [`D-${101 + i}`, n]));

test('whole rows sorted with the heading row: it goes back on top, the rows keep the sort, and every item syncs again', async () => {
  const { ctx, tab, head, col } = await linked();
  sortWithHeading(tab(), col('Notes'), 0, head.length - 1);
  assert.equal(tab().rows[6][col('Item')], 'Item', 'the heading row sorted to row 7');
  // While it sat there, a tech changed an item now above it, and a PM typed
  // into another.
  ctx.markers.d2 = { ...ctx.markers.d2, note: { text: 'apple, tech' }, changedDate: '2026-11-15T19:00:00.000Z' };
  const pmRow = tab().rows.findIndex((r) => r[col('Item')] === 'D-106');
  tab().rows[pmRow][col('Notes')] = 'date, PM';
  await ctx.round({ force: true });
  const rows = tab().rows;
  assert.deepEqual(rows[0], head, 'headings back on top');
  assert.deepEqual(rows.slice(1, 9).map((r) => r[col('Item')]), ['D-102', 'D-108', 'D-106', 'D-104', 'D-103', 'D-107', 'D-101', 'D-105'], 'in the PM\'s sort order');
  assert.equal(rows.filter((r) => r[col('Item')] === 'Item').length, 1, 'no second heading row left');
  assert.equal(rows.find((r) => r[col('Item')] === 'D-102')[col('Notes')], 'apple, tech', 'the tech\'s note reached the sheet');
  assert.equal(ctx.markers.d6.note.text, 'date, PM', 'the PM\'s note reached the app');
  assert.equal(Object.keys(ctx.markers).length, notes.length, 'no item made from the heading row');
  assert.ok((ctx.link.state.notices || []).some((n) => /heading row of "Doors - Level 1" was sorted into the list \(row 7\)/.test(n.message)), 'the panel says what happened');
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.toSheet + quiet.summary.toApp + quiet.summary.created, 0, 'the next round is quiet');
});

test('the visible columns sorted with their headings, the Row ID column left out: back on top, every item keeps its values', async () => {
  const { ctx, tab, head, col } = await linked();
  sortWithHeading(tab(), col('Notes'), 1, head.length - 1);
  assert.equal(tab().rows[0][0], 'Row ID');
  await ctx.round({ force: true });
  await ctx.round({ force: true });
  const rows = tab().rows;
  assert.deepEqual(rows[0], head, 'headings back on top');
  assert.deepEqual(appNotes(ctx), want, 'no note moved to another item');
  for (const r of rows.slice(1).filter((x) => x[col('Item')])) assert.equal(r[col('Notes')], want[r[col('Item')]], `${r[col('Item')]} keeps its note in the sheet`);
  assert.equal(Object.keys(ctx.markers).length, notes.length);
  assert.equal((ctx.link.state.problems || []).filter((p) => /has no ".*" column/.test(p.message)).length, 0, 'no column reads as renamed');
});

test('a title row the PM put above the headings is left alone', async () => {
  const { ctx, tab, head } = await linked();
  tab().rows.unshift(['Doors, level 1']);
  await ctx.round({ force: true });
  assert.equal(tab().rows[0][0], 'Doors, level 1');
  assert.deepEqual(tab().rows[1], head);
  assert.equal(Object.keys(ctx.markers).length, notes.length);
  assert.equal((ctx.link.state.notices || []).filter((n) => /heading row/.test(n.message)).length, 0);
});

test('findSortedHeader: only with this tab\'s own Row IDs above the moved heading row', () => {
  const scope = { columns: [{ key: 'rowId', header: 'Row ID' }, { key: 'item', header: 'Item' }, { key: 'notes', header: 'Notes' }] };
  const own = (t) => t.startsWith('own');
  const heading = ['Row ID', 'Item', 'Notes'];
  assert.deepEqual(findSortedHeader(scope, [['own1', 'A', 'a'], heading, ['own2', 'B', 'b']], {}, own), { row: 1, c1: 0, c2: 2 });
  assert.equal(findSortedHeader(scope, [['Title'], heading, ['own2', 'B', 'b']], {}, own), null, 'a title row');
  assert.equal(findSortedHeader(scope, [heading, ['own1', 'A', 'a']], {}, own), null, 'headings on top');
  assert.equal(findSortedHeader(scope, [['x1', 'A', 'a'], heading], {}, own), null, 'not this tab\'s rows');
  assert.deepEqual(findSortedHeader(scope, [['Row ID', 'A', 'a'], ['own1', 'B', 'b'], ['own2', 'Item', 'Notes']], {}, own), { row: 2, c1: 1, c2: 2 }, 'Row ID column left out of the sort');
});

test('a heading row repeated inside the list is never made into an item', async () => {
  const { ctx, tab, head } = await linked();
  tab().rows.splice(4, 0, [...head.map((h, i) => (i === 0 ? '' : h))]);
  await ctx.round({ force: true });
  assert.equal(Object.keys(ctx.markers).length, notes.length);
});
