// A row that goes back to an older copy of itself (Google's "Restore this
// version", OneDrive's "Restore", an old copy of a row pasted back; found
// testing real Google Sheets 11-15). Field techs had changed five notes in the
// app and Survey had written them; restoring the morning's version put the old
// notes back, and Survey took them as the PM's edits: all five tech notes were
// undone in the app with no word. The row's Changed By / Changed Date cells,
// which only Survey writes, went back too, so those values now wait as a
// choice and the app keeps the newer ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door, fakeFile } from './helpers/sheetSyncHarness.mjs';

const NOTES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'fox'];
const linked = async () => {
  const markers = Object.fromEntries(NOTES.map((n, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, {
    checklistResponses: { c1: { selection: 'Y' } }, note: { text: n } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = () => fakeFile(ctx).sheets.find((s) => s.title === 'Doors - Level 1');
  const col = (h) => sheet().rows[0].indexOf(h);
  const snapshot = () => structuredClone(sheet().rows);
  const restore = (rows) => { sheet().rows = structuredClone(rows); fakeFile(ctx).version += 1; };
  const tech = (id, text) => { ctx.markers[id].note = { text }; ctx.markers[id].changedBy = 'TF'; ctx.markers[id].changedDate = '2026-11-15T15:00:00.000Z'; };
  return { ctx, sheet, col, snapshot, restore, tech };
};
const notes = (ctx) => Object.values(ctx.markers).map((m) => m.note?.text ?? '');

test('an earlier version restored over field techs\' notes: the app keeps them and each waits as a choice', async () => {
  const t = await linked();
  const morning = t.snapshot();
  t.tech('d2', 'tech 2'); t.tech('d4', 'tech 4');
  await t.ctx.round({ force: true });
  assert.equal(t.sheet().rows[2][t.col('Notes')], 'tech 2', 'Survey wrote the tech notes');
  t.restore(morning);
  const r = await t.ctx.round({ force: true, now: new Date(Date.now() + 2 * 3600 * 1000) });
  assert.equal(r.summary.toApp, 0);
  assert.deepEqual(notes(t.ctx), ['alpha', 'tech 2', 'charlie', 'tech 4', 'echo', 'fox']);
  assert.deepEqual(Object.keys(t.ctx.link.state.conflicts).sort(), ['d2', 'd4']);
  assert.ok((t.ctx.link.state.notices || []).some((n) => /went back to an older copy of its row/.test(n.message)));
  const again = await t.ctx.round({ force: true });
  assert.equal(again.summary.toApp, 0, 'still held next round');
  assert.equal(Object.keys(t.ctx.link.state.conflicts).length, 2);
});

test('choosing the sheet takes the restored note; choosing the app writes the tech note back', async () => {
  const t = await linked();
  const morning = t.snapshot();
  t.tech('d2', 'tech 2'); t.tech('d4', 'tech 4');
  await t.ctx.round({ force: true });
  t.restore(morning);
  await t.ctx.round({ force: true });
  t.ctx.link.state = { ...t.ctx.link.state, choices: { d2: 'sheet', d4: 'app' } };
  await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d2.note.text, 'bravo');
  assert.equal(t.ctx.markers.d4.note.text, 'tech 4');
  assert.equal(t.sheet().rows[4][t.col('Notes')], 'tech 4');
  assert.deepEqual(t.ctx.link.state.conflicts, {});
});

test('a PM\'s plain edit (stamps untouched) still comes straight in', async () => {
  const t = await linked();
  t.tech('d2', 'tech 2');
  await t.ctx.round({ force: true });
  t.sheet().rows[2][t.col('Notes')] = 'pm 2';
  t.sheet().rows[3][t.col('Locked?')] = 'N';
  fakeFile(t.ctx).version += 1;
  const r = await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d2.note.text, 'pm 2');
  assert.equal(t.ctx.markers.d3.checklistResponses.c1.selection, 'N');
  assert.equal(r.summary.conflicts, 0);
});

test('an older copy of a row the app changed again meanwhile is a plain clash, held as before', async () => {
  const t = await linked();
  const morning = t.snapshot();
  t.tech('d2', 'tech 2');
  await t.ctx.round({ force: true });
  t.restore(morning);
  t.tech('d2', 'tech 2 again');
  await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d2.note.text, 'tech 2 again');
  assert.ok(t.ctx.link.state.conflicts.d2);
});

test('a stamp cell a PM cleared does not hold the PM\'s note edit', async () => {
  const t = await linked();
  t.sheet().rows[2][t.col('Changed By')] = null;
  t.sheet().rows[2][t.col('Notes')] = 'pm 2';
  fakeFile(t.ctx).version += 1;
  await t.ctx.round({ force: true });
  assert.equal(t.ctx.markers.d2.note.text, 'pm 2');
});
