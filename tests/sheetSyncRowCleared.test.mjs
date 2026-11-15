// A row selected and cleared (Delete) with the hidden Row ID column left
// out: every cell blank, the name too. Before, the tech's note and answers
// were wiped in the app while the name came back. Like a deleted row, it
// now never wipes field work: the values go back and the panel says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door } from './helpers/sheetSyncHarness.mjs';

const notes = ['pear', 'apple', 'kiwi', 'fig', 'plum', 'date'];
const linked = async () => {
  const ctx = await setup({ markers: Object.fromEntries(notes.map((n, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: n }, checklistResponses: { c1: { selection: 'Y' } } })])) });
  await ctx.round(); await ctx.round({ force: true });
  const head = (await ctx.sheet()).rows[0];
  return { ctx, head };
};

test('a row with every cell cleared but its Row ID: the marker keeps its values, which go back', async () => {
  const { ctx, head } = await linked();
  await ctx.edit(head.map((_, c) => c).filter((c) => c > 0).map((col) => ({ row: 3, col, value: '' })));
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d3.name, 'D-103');
  assert.equal(ctx.markers.d3.note.text, 'kiwi', 'the note is not wiped');
  assert.equal(ctx.markers.d3.checklistResponses.c1.selection, 'Y', 'the answer is not wiped');
  const row = (await ctx.sheet()).rows[3];
  assert.equal(row[head.indexOf('Notes')], 'kiwi', 'put back in the sheet');
  assert.ok((ctx.link.state.notices || []).some((n) => /Row 4 in "Doors - Level 1" had every cell cleared/.test(n.message)));
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.toSheet + quiet.summary.toApp, 0);
});

test('clearing a note and an answer but keeping the name is still a plain edit', async () => {
  const { ctx, head } = await linked();
  await ctx.edit([{ row: 3, col: head.indexOf('Notes'), value: '' }, { row: 3, col: head.indexOf('Locked?'), value: '' }]);
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d3.note.text, '');
  assert.equal(ctx.markers.d3.checklistResponses?.c1?.selection || '', '');
});
