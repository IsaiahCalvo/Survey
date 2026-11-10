// Item tracking (Status, Assigned to, Due; flag 'marker-tracking') as live
// sheet columns: the app's values show in the sheet, a PM's edit there comes
// back to the item, and a name or status the survey does not know is refused.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncLayout, layoutProblems, trackingChoices } from '../supabase/functions/_shared/sheetSync/layout.js';
import { dropDownChoices } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';
import { mergeMarkerWrites } from '../supabase/functions/_shared/sheetSync/service.js';
import { defaultKit, template, setup, door } from './helpers/sheetSyncHarness.mjs';

const people = [
  { id: 'u-ann', name: 'Ann Lee', email: 'ann@example.com' },
  { id: 'u-bo', name: '', email: 'bo.k@example.com' },
];
const layoutWith = (opts = {}) => buildSyncLayout({ template: template(), kit: defaultKit, tracking: true, people, ...opts });
const cellOf = async (ctx, id, header) => (await ctx.sheet()).rows[await ctx.rowOf(id)][await ctx.col(header)];
const typeIn = async (ctx, id, header, value) => ctx.edit([{ row: await ctx.rowOf(id), col: await ctx.col(header), value }]);

test('tracking columns come after the kit columns only when the app turns them on', () => {
  const off = buildSyncLayout({ template: template(), kit: defaultKit });
  assert.ok(!off.scopes[0].columns.some((c) => ['status', 'assignee', 'due'].includes(c.key)));
  assert.equal(off.people, undefined);
  const on = layoutWith();
  assert.deepEqual(on.scopes[0].columns.slice(-3).map((c) => c.header), ['Status', 'Assigned to', 'Due']);
  assert.deepEqual(layoutProblems(on), []);
  assert.deepEqual(on.people.map((p) => p.id), ['u-ann', 'u-bo'], 'kept in a steady order');
  const status = on.scopes[0].columns.find((c) => c.key === 'status');
  assert.deepEqual(trackingChoices(status, on), ['Open', 'In progress', 'Done']);
  assert.equal(dropDownChoices(on.scopes[0].columns.find((c) => c.key === 'assignee'), on), 'Ann Lee,bo.k');
});

test('the app\'s status, assignee and due date show in the sheet; untouched items read Open', async () => {
  const ctx = await setup({
    layout: layoutWith(),
    markers: {
      d1: door('d1', 'D-101', { tracking: { status: 'in-progress', assigneeId: 'u-ann', due: '2026-11-20' } }),
      d2: door('d2', 'D-102'),
      d3: door('d3', 'D-103', { tracking: { status: 'done', assigneeId: 'u-gone', due: null } }),
    },
  });
  await ctx.round();
  assert.equal(await cellOf(ctx, 'd1', 'Status'), 'In progress');
  assert.equal(await cellOf(ctx, 'd1', 'Assigned to'), 'Ann Lee');
  assert.equal(await cellOf(ctx, 'd1', 'Due'), '2026-11-20');
  assert.equal(await cellOf(ctx, 'd2', 'Status'), 'Open');
  assert.equal(await cellOf(ctx, 'd2', 'Assigned to'), '');
  assert.equal(await cellOf(ctx, 'd3', 'Assigned to'), 'Former member', 'someone who left keeps a slot, as in the app');
  const quiet = await ctx.round({ force: true });
  assert.deepEqual(Object.values(quiet.summary).filter(Boolean), []);
});

test('a PM sets status, assignee (by name or email) and due date in the sheet', async () => {
  const ctx = await setup({ layout: layoutWith(), markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round();
  await typeIn(ctx, 'd1', 'Status', 'done');
  await typeIn(ctx, 'd1', 'Assigned to', 'BO.K@example.com');
  await typeIn(ctx, 'd1', 'Due', '11/25/2026');
  await ctx.round();
  const t = ctx.markers.d1.tracking;
  assert.equal(t.status, 'done');
  assert.equal(t.assigneeId, 'u-bo');
  assert.equal(t.due, '2026-11-25');
  assert.ok(t.updatedAt);
  assert.equal(await cellOf(ctx, 'd1', 'Status'), 'Done', 'tidied to the label');
  assert.equal(await cellOf(ctx, 'd1', 'Assigned to'), 'bo.k', 'shown as the app names them');
  assert.equal(ctx.markers.d2.tracking, undefined, 'other items untouched');
  // Cleared again in the sheet: the item has no tracking, as the app keeps it.
  await typeIn(ctx, 'd1', 'Status', '');
  await typeIn(ctx, 'd1', 'Assigned to', '');
  await typeIn(ctx, 'd1', 'Due', '');
  await ctx.round();
  assert.equal(ctx.markers.d1.tracking, undefined);
  assert.equal(await cellOf(ctx, 'd1', 'Status'), 'Open');
});

test('a status, person or date the survey does not know is listed, and the item keeps its value', async () => {
  const ctx = await setup({ layout: layoutWith(), markers: { d1: door('d1', 'D-101', { tracking: { status: 'in-progress', assigneeId: 'u-ann', due: '2026-11-20' } }) } });
  await ctx.round();
  await typeIn(ctx, 'd1', 'Status', 'Blocked');
  await typeIn(ctx, 'd1', 'Assigned to', 'Zed Nobody');
  await typeIn(ctx, 'd1', 'Due', 'soon');
  await ctx.round();
  assert.deepEqual({ ...ctx.markers.d1.tracking }, { status: 'in-progress', assigneeId: 'u-ann', due: '2026-11-20' });
  const text = ctx.link.state.problems.map((p) => p.message).join(' | ');
  assert.match(text, /"Blocked" is not a status/);
  assert.match(text, /"Zed Nobody" is not someone on this document/);
  assert.match(text, /"soon" is not a date/);
});

test('turning tracking on for a sheet already linked fills the new columns from the app', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { tracking: { status: 'done', assigneeId: null, due: null } }) } });
  await ctx.round();
  ctx.link.layout = layoutWith();
  await ctx.round();
  assert.equal(await cellOf(ctx, 'd1', 'Status'), 'Done');
  assert.equal(ctx.markers.d1.tracking.status, 'done');
});

test('a new row typed in the sheet with a status and assignee comes in tracked', async () => {
  const ctx = await setup({ layout: layoutWith(), markers: { d1: door('d1', 'D-101') } });
  await ctx.round();
  const sheet = await ctx.sheet();
  const at = sheet.rows.length;
  const col = (h) => sheet.rows[0].indexOf(h);
  await ctx.edit([
    { row: at, col: col('Item'), value: 'D-999' },
    { row: at, col: col('Status'), value: 'In progress' },
    { row: at, col: col('Assigned to'), value: 'Ann Lee' },
  ]);
  await ctx.round();
  const made = Object.values(ctx.markers).find((m) => m.name === 'D-999');
  assert.equal(made.tracking.status, 'in-progress');
  assert.equal(made.tracking.assigneeId, 'u-ann');
});

test('saving a round\'s status keeps an assignee picked in the app meanwhile', () => {
  const before = { d1: { id: 'd1', tracking: { status: 'open', assigneeId: null, due: null } } };
  const fresh = { d1: { id: 'd1', tracking: { status: 'open', assigneeId: 'u-ann', due: null } } };
  const writes = { d1: { id: 'd1', tracking: { status: 'done', assigneeId: null, due: null, updatedAt: 'x', updatedBy: null } } };
  const out = mergeMarkerWrites(fresh, before, writes);
  assert.equal(out.d1.tracking.status, 'done');
  assert.equal(out.d1.tracking.assigneeId, 'u-ann');
});
