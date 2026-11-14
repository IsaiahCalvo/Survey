// Excel on the web refuses a PM's save ("Can't Save Your Changes") when any
// outside write lands while their typing is unsaved (real Excel, 11-13). So
// while the synced tabs keep changing under someone else's hand, a round
// that would write waits, and goes ahead once they are still or after a
// while at most (round.js SHEET_BUSY_QUIET_MS / SHEET_BUSY_MAX_MS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door } from './helpers/sheetSyncHarness.mjs';
import { SHEET_BUSY_QUIET_MS, SHEET_BUSY_MAX_MS } from '../supabase/functions/_shared/sheetSync/round.js';

const T0 = Date.parse('2026-11-13T17:00:00Z');
const at = (ms) => new Date(T0 + ms);

const linked = async ({ savesLate = true } = {}) => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'n1' } }), d2: door('d2', 'D-102', { note: { text: 'n2' } }), d3: door('d3', 'D-103', { note: { text: 'n3' } }) } });
  if (savesLate) ctx.provider = { ...ctx.provider, savesLate: true };
  await ctx.round({ now: at(0) });
  await ctx.round({ now: at(1000), force: true });
  const notes = await ctx.col('Notes');
  const row = async (id) => ctx.rowOf(id);
  const cell = async (id) => (await ctx.sheet()).rows[await row(id)][notes];
  const pmTypes = async (id, value) => ctx.edit([{ row: await row(id), col: notes, value }]);
  return { ctx, cell, pmTypes };
};

test('while a PM\'s edits keep landing, a tech\'s change waits; it goes in once the sheet is still', async () => {
  const { ctx, cell, pmTypes } = await linked();
  await pmTypes('d1', 'pm 1');
  ctx.markers.d2.note = { text: 'tech 2' };
  const first = await ctx.round({ now: at(5000), hold: true });
  assert.equal(first.status, 'held');
  assert.equal(await cell('d2'), 'n2', 'nothing written while the PM is editing');
  assert.equal(ctx.markers.d1.note.text, 'n1', 'and nothing saved: the next round plans again');

  const still = await ctx.round({ now: at(5000 + SHEET_BUSY_QUIET_MS - 5000), hold: true });
  assert.equal(still.status, 'held', 'still within the quiet time');

  const goes = await ctx.round({ now: at(5000 + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(goes.status, 'synced');
  assert.equal(await cell('d2'), 'tech 2', 'the tech\'s note is in the sheet');
  assert.equal(ctx.markers.d1.note.text, 'pm 1', 'the PM\'s note is in the app');
  assert.equal(ctx.link.state.sheetBusy, undefined, 'the wait is over');
});

test('a PM who keeps typing holds the round at most SHEET_BUSY_MAX_MS', async () => {
  const { ctx, cell, pmTypes } = await linked();
  ctx.markers.d3.note = { text: 'tech 3' };
  let t = 5000;
  let k = 0;
  await pmTypes('d1', `pm ${++k}`);
  let r = await ctx.round({ now: at(t), hold: true });
  assert.equal(r.status, 'held');
  while (t < 5000 + SHEET_BUSY_MAX_MS - 20000) {
    t += 20000;
    await pmTypes(k % 2 ? 'd2' : 'd1', `pm ${++k}`);
    r = await ctx.round({ now: at(t), hold: true });
    assert.equal(r.status, 'held', `still held at ${t / 1000} s`);
  }
  t = 5000 + SHEET_BUSY_MAX_MS + 1000;
  await pmTypes('d1', `pm ${++k}`);
  r = await ctx.round({ now: at(t), hold: true });
  assert.equal(r.status, 'synced', 'goes ahead after the most it may wait');
  assert.equal(await cell('d3'), 'tech 3');
  assert.equal(ctx.markers.d1.note.text, `pm ${k}`);
});

test('with no one editing the sheet, an app change goes in at once', async () => {
  const { ctx, cell } = await linked();
  ctx.markers.d2.note = { text: 'tech 2' };
  const r = await ctx.round({ now: at(5000), hold: true });
  assert.equal(r.status, 'synced');
  assert.equal(await cell('d2'), 'tech 2');
});

test('Google Sheets is never held, and neither is a round asked for by hand (hold off)', async () => {
  {
    const { ctx, cell, pmTypes } = await linked({ savesLate: false });
    await pmTypes('d1', 'pm 1');
    ctx.markers.d2.note = { text: 'tech 2' };
    const r = await ctx.round({ now: at(5000), hold: true });
    assert.equal(r.status, 'synced');
    assert.equal(await cell('d2'), 'tech 2');
  }
  {
    const { ctx, cell, pmTypes } = await linked();
    await pmTypes('d1', 'pm 1');
    ctx.markers.d2.note = { text: 'tech 2' };
    const r = await ctx.round({ now: at(5000) });
    assert.equal(r.status, 'synced');
    assert.equal(await cell('d2'), 'tech 2');
    assert.equal(ctx.markers.d1.note.text, 'pm 1');
  }
});

test('a held round keeps the link\'s other state as it was', async () => {
  const { ctx, pmTypes } = await linked();
  const before = structuredClone(ctx.link.state);
  const baseline = structuredClone(ctx.link.baseline);
  const version = ctx.link.remote_version;
  await pmTypes('d1', 'pm 1');
  ctx.markers.d2.note = { text: 'tech 2' };
  const r = await ctx.round({ now: at(5000), hold: true });
  assert.equal(r.status, 'held');
  const { sheetBusy, ...rest } = ctx.link.state;
  assert.deepEqual(rest, before);
  assert.ok(sheetBusy && sheetBusy.since === T0 + 5000);
  assert.deepEqual(ctx.link.baseline, baseline);
  assert.equal(ctx.link.remote_version, version);
});
