// Excel on the web refuses a PM's save ("Can't Save Your Changes") when any
// outside write lands while their typing is unsaved (real Excel, 11-13). So
// while the synced tabs keep changing under someone else's hand, a round
// that would write waits, and goes ahead once they are still or after a
// while at most (round.js SHEET_BUSY_QUIET_MS / SHEET_BUSY_MAX_MS). While
// they were editing lately (SHEET_ACTIVE_MS), each write is followed by a
// fresh quiet time: Excel saves typing late, so still tabs prove little.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door } from './helpers/sheetSyncHarness.mjs';
import { SHEET_BUSY_QUIET_MS, SHEET_BUSY_MAX_MS, SHEET_ACTIVE_MS } from '../supabase/functions/_shared/sheetSync/round.js';

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
  assert.equal(ctx.markers.d1.note.text, 'pm 1', 'the PM\'s edit still comes into the app at once');

  const still = await ctx.round({ now: at(5000 + SHEET_BUSY_QUIET_MS - 5000), hold: true });
  assert.equal(still.status, 'held', 'still within the quiet time');

  const goes = await ctx.round({ now: at(5000 + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(goes.status, 'synced');
  assert.equal(await cell('d2'), 'tech 2', 'the tech\'s note is in the sheet');
  assert.equal(ctx.markers.d1.note.text, 'pm 1', 'the PM\'s note is in the app');
  assert.equal(ctx.link.state.sheetBusy.tabs, null, 'the PM was editing lately: a fresh quiet time starts with our write');
});

test('right after a write, while the PM was editing lately, the next change waits a quiet time too; then the wait ends', async () => {
  const { ctx, cell, pmTypes } = await linked();
  await pmTypes('d1', 'pm 1');
  ctx.markers.d2.note = { text: 'tech 2' };
  assert.equal((await ctx.round({ now: at(5000), hold: true })).status, 'held');
  const wroteAt = 5000 + SHEET_BUSY_QUIET_MS + 1000;
  assert.equal((await ctx.round({ now: at(wroteAt), hold: true })).status, 'synced');

  ctx.markers.d3.note = { text: 'tech 3' };
  const soon = await ctx.round({ now: at(wroteAt + 3000), hold: true });
  assert.equal(soon.status, 'held', 'our own write is not taken for an edit, but the quiet time runs again');
  assert.equal(await cell('d3'), 'n3');
  const later = await ctx.round({ now: at(wroteAt + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(later.status, 'synced');
  assert.equal(await cell('d3'), 'tech 3');

  // No one has changed the sheet for SHEET_ACTIVE_MS: back to writing at once.
  const quietAt = 5000 + SHEET_ACTIVE_MS + 1000;
  ctx.markers.d2.note = { text: 'tech 2b' };
  const free = await ctx.round({ now: at(Math.max(quietAt, wroteAt + 2 * SHEET_BUSY_QUIET_MS + 3000)), hold: true });
  assert.equal(free.status, 'synced');
  assert.equal(await cell('d2'), 'tech 2b');
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

test('a held round keeps the link\'s other state as it was; only the pulled item\'s baseline moves on', async () => {
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
  const { d1, ...others } = ctx.link.baseline;
  const { d1: d1Before, ...othersBefore } = baseline;
  assert.deepEqual(others, othersBefore, 'the other items\' baseline is as it was');
  assert.notDeepEqual(d1, d1Before, 'the PM\'s edit is agreed on both sides now');
  assert.equal(ctx.link.remote_version, version);
});

test('the panel says the app\'s changes wait while the sheet is edited, and stops saying it once they go in', async () => {
  const { ctx, pmTypes } = await linked();
  await pmTypes('d1', 'pm 1');
  ctx.markers.d2.note = { text: 'tech 2' };
  await ctx.round({ now: at(5000), hold: true });
  assert.ok(ctx.link.state.sheetBusy.since, 'held: the link says the sheet is in use');
  await ctx.round({ now: at(5000 + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(ctx.link.state.sheetBusy.since, undefined, 'written: no longer waiting');
  const { readFileSync } = await import('node:fs');
  const service = readFileSync(new URL('../supabase/functions/_shared/sheetSync/service.js', import.meta.url), 'utf8');
  assert.match(service, /sheetInUse: Boolean\(link\.state\?\.sheetBusy\?\.since\)/);
  const panel = readFileSync(new URL('../src/components/SheetSyncButton.jsx', import.meta.url), 'utf8');
  assert.match(panel, /link\.sheetInUse && state === 'live' \? 'Waiting while the sheet is edited'/);
});

test('while held, a PM who edits the same cell again is no clash, and a PM\'s new row waits for its Row ID', async () => {
  const { ctx, cell, pmTypes } = await linked();
  await pmTypes('d1', 'pm 1');
  ctx.markers.d2.note = { text: 'tech 2' };
  assert.equal((await ctx.round({ now: at(5000), hold: true })).status, 'held');
  assert.equal(ctx.markers.d1.note.text, 'pm 1');
  await pmTypes('d1', 'pm 2');
  const r2 = await ctx.round({ now: at(10000), hold: true });
  assert.equal(r2.status, 'held');
  assert.equal(ctx.markers.d1.note.text, 'pm 2', 'the second edit comes in too');
  // A new row typed under the list: not made an item until the round writes its Row ID.
  const sheet = await ctx.sheet();
  const before = Object.keys(ctx.markers).length;
  await ctx.edit([{ row: sheet.rows.length, col: await ctx.col('Item'), value: 'D-NEW' }]);
  assert.equal((await ctx.round({ now: at(15000), hold: true })).status, 'held');
  assert.equal(Object.keys(ctx.markers).length, before, 'no item yet');
  const go = await ctx.round({ now: at(15000 + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(go.status, 'synced');
  assert.equal(Object.keys(ctx.markers).length, before + 1, 'one item for the new row');
  assert.equal(Object.values(ctx.markers).filter((m) => m.name === 'D-NEW').length, 1);
  assert.equal(await cell('d2'), 'tech 2');
  assert.equal(ctx.markers.d1.note.text, 'pm 2');
  assert.equal(await cell('d1'), 'pm 2');
  assert.deepEqual(ctx.link.state.conflicts || {}, {}, 'no clash anywhere');
});

test('a PM\'s half-typed new row (a note, no Item yet) starts the wait before there is anything to bring in', async () => {
  const { ctx, cell } = await linked();
  await ctx.round({ now: at(2000), hold: true }); // a quiet round: the tabs as they are
  const sheet = await ctx.sheet();
  await ctx.edit([{ row: sheet.rows.length, col: await ctx.col('Notes'), value: 'half typed' }]);
  ctx.markers.d2.note = { text: 'tech 2' };
  const r = await ctx.round({ now: at(5000), hold: true });
  assert.equal(r.status, 'held', 'the sheet changed under someone else\'s hand');
  assert.equal(await cell('d2'), 'n2');
  const go = await ctx.round({ now: at(5000 + SHEET_BUSY_QUIET_MS + 1000), hold: true });
  assert.equal(go.status, 'synced');
  assert.equal(await cell('d2'), 'tech 2');
});
