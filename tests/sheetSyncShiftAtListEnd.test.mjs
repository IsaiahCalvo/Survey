// "Shift cells down" on the last item or two of a list, or anywhere in a list
// of one to three items (found in real Google Sheets 11-15, Waldo's one-row
// tab: Insert cells > Shift down on a cell). Too few list cells change for the
// shift check to see a move, so the item lost its value in the app and the
// pushed-off value sat under the list with no Row ID and no panel line. The
// value pushed off the end, alone in a row under the list, is the evidence.
// "Shift cells up" there pulls in only a blank, which reads exactly like a
// person clearing a cell or moving a value, so it stays an edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door, fakeFile } from './helpers/sheetSyncHarness.mjs';

const NOTES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'fox', 'golf', 'hotel', 'india', 'juliet'];
const linked = async (n) => {
  const markers = Object.fromEntries(Array.from({ length: n }, (_, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, {
    checklistResponses: { c1: { selection: i % 2 ? 'N' : 'Y' } }, note: { text: NOTES[i] } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = () => fakeFile(ctx).sheets.find((s) => s.title === 'Doors - Level 1');
  const head = sheet().rows[0];
  const col = (h) => head.indexOf(h);
  // Insert (by 1) or delete (by -1) one cell in a column at list row `at`.
  const shift = (header, at, by) => {
    const rows = sheet().rows; const c = col(header);
    const vals = rows.slice(1, n + 1).map((r) => r[c] ?? null);
    const moved = by > 0 ? [...vals.slice(0, at), null, ...vals.slice(at)] : [...vals.slice(0, at), ...vals.slice(at + 1), null];
    moved.forEach((v, i) => { while (rows.length <= i + 1) rows.push([]); rows[i + 1][c] = v; });
    fakeFile(ctx).version += 1;
  };
  const notes = () => Object.values(ctx.markers).map((m) => m.note?.text ?? '');
  const underList = () => sheet().rows.slice(n + 1).filter((r) => (r || []).some((v) => v != null && v !== ''));
  const said = () => (ctx.link.state.notices || []).some((x) => /were inserted or deleted on their own/.test(x.message));
  return { ctx, sheet, col, shift, notes, underList, said };
};

for (const [n, at] of [[10, 9], [10, 8], [5, 4], [3, 0], [3, 2], [2, 1], [1, 0]]) {
  test(`Notes shifted down at item ${at + 1} of ${n}: every item keeps its note and nothing is left under the list`, async () => {
    const t = await linked(n);
    t.shift('Notes', at, 1);
    const r = await t.ctx.round({ force: true });
    assert.deepEqual(t.notes(), NOTES.slice(0, n));
    assert.equal(r.summary.toApp, 0);
    assert.ok(t.said(), 'the panel says why');
    assert.deepEqual(t.underList(), [], 'the pushed-off note is cleared');
    assert.deepEqual(t.sheet().rows.slice(1, n + 1).map((row) => row[t.col('Notes')]), NOTES.slice(0, n), 'sheet put back');
    const quiet = await t.ctx.round({ force: true });
    assert.equal(quiet.summary.toSheet + quiet.summary.toApp + quiet.summary.created, 0, 'the next round is quiet');
  });
}

test('a one-item list with a Y / N cell shifted down: the answer stays', async () => {
  const t = await linked(1);
  t.shift('Locked?', 0, 1);
  await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d1.checklistResponses.c1.selection, 'Y');
  assert.deepEqual(t.underList(), []);
});

test('Notes shifted up on the last item reads as a clear and stays an edit', async () => {
  const t = await linked(10);
  t.shift('Notes', 9, -1);
  await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d10.note.text, '');
  assert.ok(!t.said());
});

test('a PM who clears the last note and types a new row under the list with that note: both are edits', async () => {
  const t = await linked(3);
  const rows = t.sheet().rows;
  rows[3][t.col('Notes')] = null;
  rows.push([]); rows[4][t.col('Item')] = 'D-200'; rows[4][t.col('Notes')] = 'charlie';
  fakeFile(t.ctx).version += 1;
  await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d3.note.text, '');
  const added = Object.values(t.ctx.markers).find((m) => m.name === 'D-200');
  assert.ok(added, 'the new row came in as an item');
  assert.equal(added.note.text, 'charlie');
  assert.ok(!t.said());
});

test('a note typed under a short list that is not the one the last item lost stays as it was', async () => {
  const t = await linked(2);
  const rows = t.sheet().rows;
  rows[2][t.col('Notes')] = null;
  rows.push([]); rows[3][t.col('Notes')] = 'something else';
  fakeFile(t.ctx).version += 1;
  await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d2.note.text, '');
  assert.ok(!t.said());
});
