// Cells merged in Google Sheets (real Google 11-15): Google keeps only the
// top-left value, so a PM who merges two Notes cells for looks blanks the
// lower note. Survey took that blank as the PM clearing the note and wiped it
// in the app. Google's grid read now says which cells sit under a merge; those
// count as unchanged from the first round, the app keeps its value and the
// panel says to unmerge them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door, fakeFile } from './helpers/sheetSyncHarness.mjs';

const NOTES = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
const linked = async () => {
  const markers = Object.fromEntries(NOTES.map((n, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: n } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = fakeFile(ctx).sheets.find((s) => s.title === 'Doors - Level 1');
  const col = sheet.rows[0].indexOf('Notes');
  // Merge list rows a..b (1-based sheet rows) of Notes, the way Google does.
  const merge = (a, b) => {
    for (let r = a + 1; r <= b; r += 1) sheet.rows[r][col] = null;
    sheet.merges = [...(sheet.merges || []), { sheetId: sheet.sheetId, startRowIndex: a, endRowIndex: b + 1, startColumnIndex: col, endColumnIndex: col + 1 }];
    fakeFile(ctx).version += 1;
  };
  return { ctx, sheet, col, merge };
};
const notes = (ctx) => Object.values(ctx.markers).map((m) => m.note?.text ?? '');

test('two Notes cells merged: the hidden note stays in the app and the panel says to unmerge', async () => {
  const { ctx, merge } = await linked();
  merge(2, 3);
  const r = await ctx.round({ force: true });
  assert.deepEqual(notes(ctx), NOTES);
  assert.equal(r.summary.toApp, 0);
  assert.ok((ctx.link.state.problems || []).some((p) => /D-103|Row 4/.test(p.message) && /merged cells/.test(p.message)), 'the panel says why');
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.toSheet + quiet.summary.toApp, 0, 'the next round is quiet');
});

test('a tech note on a merged-away cell stays in the app; unmerged and typed into, the cell syncs again', async () => {
  const { ctx, sheet, col, merge } = await linked();
  merge(1, 3);
  await ctx.round({ force: true });
  ctx.markers.d3.note = { text: 'tech says' };
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d3.note.text, 'tech says');
  assert.equal(sheet.rows[3][col] ?? null, null, 'nothing written under the merge');
  delete sheet.merges;
  sheet.rows[3][col] = 'pm typed';
  fakeFile(ctx).version += 1;
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d3.note.text, 'pm typed');
});

test('the top-left cell of a merged area still syncs like any cell', async () => {
  const { ctx, sheet, col, merge } = await linked();
  merge(2, 3);
  await ctx.round({ force: true });
  sheet.rows[2][col] = 'bravo, edited';
  fakeFile(ctx).version += 1;
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d2.note.text, 'bravo, edited');
  assert.equal(ctx.markers.d3.note.text, 'charlie');
});

test('a merged heading block above the list does not stop the sync', async () => {
  const { ctx, sheet } = await linked();
  sheet.merges = [{ sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 8, endColumnIndex: 12 }];
  fakeFile(ctx).version += 1;
  ctx.markers.d1.note = { text: 'from the app' };
  await ctx.round({ force: true });
  assert.equal(sheet.rows[1][sheet.rows[0].indexOf('Notes')], 'from the app');
});
