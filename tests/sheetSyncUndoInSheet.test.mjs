// Undo in the sheet over a later app change. Real Excel on the web 11-14: a
// PM typed a note, a tech then changed it in the app, and the PM's Ctrl+Z
// four minutes later put back the note from before the PM's typing, over the
// tech's, with no warning; Survey took it as a plain edit and the tech's
// note was gone on both sides. Now the sheet going back to exactly the value
// from before its own last edit, after the app changed the cell, waits as a
// choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door } from './helpers/sheetSyncHarness.mjs';
import { UNDO_WATCH_MS } from '../supabase/functions/_shared/sheetSync/engine.js';
import { SHEET_BUSY_QUIET_MS } from '../supabase/functions/_shared/sheetSync/round.js';

const T0 = Date.parse('2026-11-14T17:00:00Z');
const at = (ms) => new Date(T0 + ms);
const MIN = 60_000;

const linked = async ({ savesLate = false } = {}) => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'orig' } }), d2: door('d2', 'D-102', { note: { text: 'n2' } }) } });
  if (savesLate) ctx.provider = { ...ctx.provider, savesLate: true };
  await ctx.round({ now: at(0) });
  await ctx.round({ now: at(1000), force: true });
  const notes = await ctx.col('Notes');
  const cell = async () => (await ctx.sheet()).rows[await ctx.rowOf('d1')][notes];
  const pmTypes = async (value) => ctx.edit([{ row: await ctx.rowOf('d1'), col: notes, value }]);
  return { ctx, cell, pmTypes };
};
const typedThenTech = async (opts) => {
  const s = await linked(opts);
  await s.pmTypes('pm');
  await s.ctx.round({ now: at(10_000), force: true });
  assert.equal(s.ctx.markers.d1.note.text, 'pm');
  s.ctx.markers.d1.note = { text: 'tech' };
  await s.ctx.round({ now: at(20_000), force: true });
  assert.equal(await s.cell(), 'tech');
  return s;
};

test('the sheet undone back over a tech\'s later change waits as a choice; the tech\'s note stays', async () => {
  const { ctx, cell, pmTypes } = await typedThenTech();
  await pmTypes('orig'); // Ctrl+Z: the note from before the PM's typing
  const r = await ctx.round({ now: at(5 * MIN), force: true });
  assert.equal(ctx.markers.d1.note.text, 'tech', 'the tech\'s note is not replaced');
  assert.equal(r.summary.conflicts, 1);
  const c = ctx.link.state.conflicts.d1;
  assert.deepEqual(c.fields.map((f) => [f.key, f.app, f.sheet]), [['notes', 'tech', 'orig']]);
  assert.equal(await cell(), 'orig', 'the sheet is left as the PM has it until someone chooses');
});

test('a plain undo, with nothing changed in the app since, just comes in', async () => {
  const { ctx, pmTypes } = await linked();
  await pmTypes('pm');
  await ctx.round({ now: at(10_000), force: true });
  await pmTypes('orig');
  const r = await ctx.round({ now: at(MIN), force: true });
  assert.equal(ctx.markers.d1.note.text, 'orig');
  assert.equal(r.summary.conflicts, 0);
});

test('a new value typed over the tech\'s change is a plain edit', async () => {
  const { ctx, pmTypes } = await typedThenTech();
  await pmTypes('pm again');
  const r = await ctx.round({ now: at(5 * MIN), force: true });
  assert.equal(ctx.markers.d1.note.text, 'pm again');
  assert.equal(r.summary.conflicts, 0);
});

test('long after the PM\'s edit, going back to the old value is a plain edit', async () => {
  const { ctx, pmTypes } = await typedThenTech();
  await pmTypes('orig');
  await ctx.round({ now: at(10_000 + UNDO_WATCH_MS + MIN), force: true });
  assert.equal(ctx.markers.d1.note.text, 'orig');
});

test('Excel on the web, rounds held while the PM types: the undo still waits as a choice', async () => {
  const { ctx, cell, pmTypes } = await linked({ savesLate: true });
  await pmTypes('pm');
  const held = await ctx.round({ now: at(10_000), hold: true });
  assert.equal(held.status, 'held');
  assert.equal(ctx.markers.d1.note.text, 'pm', 'the PM\'s note came in early');
  ctx.markers.d1.note = { text: 'tech' };
  await ctx.round({ now: at(10_000 + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(await cell(), 'tech');
  await pmTypes('orig');
  await ctx.round({ now: at(6 * MIN), hold: true });
  await ctx.round({ now: at(6 * MIN + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(ctx.markers.d1.note.text, 'tech');
  assert.ok(ctx.link.state.conflicts.d1, 'a choice waits');
});
