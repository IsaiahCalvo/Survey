// Live sheet sync: who a sheet edit is credited to. Survey writes to the sheet
// as the person who linked it, so the file's "last changed by" says the linker
// after every round that wrote. An edit from the sheet is credited to the
// person who last changed the file ("JF (sheet)"), never to whichever team
// member's device happened to run the round, and never to the linker just
// because Survey's own write shows their name (round.js sheetEditorLabel).
import test from 'node:test';
import assert from 'node:assert/strict';

import { sheetEditorLabel } from '../supabase/functions/_shared/sheetSync/round.js';
import { googleSheetsProvider } from '../supabase/functions/_shared/sheetSync/providers/google.js';
import { createMsGraphProvider, parseMsgraphFileId } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';
import { runSheetRound } from '../supabase/functions/_shared/sheetSync/round.js';
import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { mergeMarkerWrites } from '../supabase/functions/_shared/sheetSync/service.js';
import { FAKE_GOOGLE_EMAIL } from '../scripts/e2e-fake-google.mjs';
import { fakeMsgraphFetch, resetFakeMsgraph, FAKE_MS_EMAIL } from '../scripts/e2e-fake-msgraph.mjs';
import { endpoints, fakeApi, fakeGoogleFetch, setup, door, defaultKit, template, signing } from './helpers/sheetSyncHarness.mjs';

const later = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

test('label: a teammate gets their initials; unknown or Survey-made changes say Sheet', () => {
  const wrote = '2026-11-02T15:00:00.000Z';
  assert.equal(sheetEditorLabel({ name: 'Jamie Field', email: 'jamie@example.com', at: wrote }, { selfEmail: 'pm@example.com', lastWriteAt: wrote }), 'JF (sheet)');
  assert.equal(sheetEditorLabel({ name: 'Cher', email: '', at: wrote }), 'C (sheet)');
  assert.equal(sheetEditorLabel({ name: '', email: 'mary.ann.lee@x.com', at: wrote }), 'ML (sheet)', 'no name: from the email');
  assert.equal(sheetEditorLabel(null), 'Sheet');
  assert.equal(sheetEditorLabel({ name: '', email: '' }), 'Sheet');
  // The linker (Google says `me`, or the email matches): only a change well
  // after Survey's last write is theirs; nearer, it may be Survey's own write.
  const linker = { name: 'Pat Manager', email: 'PM@example.com' };
  assert.equal(sheetEditorLabel({ ...linker, at: later(wrote, 5_000) }, { selfEmail: 'pm@example.com', lastWriteAt: wrote }), 'Sheet');
  assert.equal(sheetEditorLabel({ ...linker, at: later(wrote, 120_000) }, { selfEmail: 'pm@example.com', lastWriteAt: wrote }), 'PM (sheet)');
  assert.equal(sheetEditorLabel({ name: 'Pat Manager', email: '', me: true, at: later(wrote, 120_000) }, { lastWriteAt: wrote }), 'PM (sheet)');
  assert.equal(sheetEditorLabel({ ...linker, at: later(wrote, 120_000) }, { selfEmail: 'pm@example.com', lastWriteAt: null }), 'Sheet', 'no record of our last write: cannot tell');
});

test('Google: a teammate edit in the sheet is credited to them, in the app and the sheet', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: await ctx.col('Notes'), value: 'Hinge squeaks' }]);
  const round = await ctx.round();
  assert.equal(round.summary.toApp, 1);
  assert.equal(ctx.markers.d1.note.text, 'Hinge squeaks');
  assert.equal(ctx.markers.d1.changedBy, 'JF (sheet)');
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows[r][await ctx.col('Changed By')], 'JF (sheet)', 'Changed By in the sheet says so in the same round');
  // Nothing left over: the next round moves nothing either way.
  const quiet = await ctx.round();
  assert.deepEqual(quiet.summary, { toSheet: 0, toApp: 0, created: 0, appended: 0, deleted: 0, conflicts: 0 });
  // An app edit next keeps the app's own credit rules (the round never rewrites it).
  ctx.markers.d1.checklistResponses = { c1: { selection: 'Y' } };
  await ctx.round();
  assert.equal(ctx.markers.d1.changedBy, 'JF (sheet)');
});

test('Google: a row typed into the sheet comes in credited to whoever typed it', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const sheet = await ctx.sheet();
  const at = sheet.rows.length;
  await fakeApi(`/files/${ctx.fileId}/edit`, {
    title: 'Doors - Level 1', edits: [{ row: at, col: await ctx.col('Item'), value: 'D-999' }],
    by: { displayName: 'Riley Quinn Tech', emailAddress: 'riley@example.com' },
  });
  await ctx.round();
  const added = Object.values(ctx.markers).find((m) => m.name === 'D-999');
  assert.ok(added, 'the new row came in');
  assert.equal(added.changedBy, 'RT (sheet)');
});

test('Google: Survey\'s own write is never credited to the linker; the linker typing later is', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  ctx.provider = Object.assign(googleSheetsProvider({ endpoints, getAccessToken: async () => 'fake-access-1', fetchImpl: fakeGoogleFetch }), { accountEmail: FAKE_GOOGLE_EMAIL });
  await ctx.round(); await ctx.round();
  const r = await ctx.rowOf('d1');
  const linker = { displayName: 'Pat Manager', emailAddress: FAKE_GOOGLE_EMAIL };
  // The linker types right after Survey wrote: it could be Survey's write
  // still showing, so it is "Sheet".
  await ctx.edit([{ row: r, col: await ctx.col('Notes'), value: 'First note' }], 'Doors - Level 1');
  globalThis.__fakeGoogle.files.get(ctx.fileId).modifiedBy = linker;
  await ctx.round();
  assert.equal(ctx.markers.d1.changedBy, 'Sheet');
  // Minutes later the linker types again: that one is theirs.
  await ctx.edit([{ row: r, col: await ctx.col('Notes'), value: 'Second note' }], 'Doors - Level 1');
  const f = globalThis.__fakeGoogle.files.get(ctx.fileId);
  f.modifiedBy = linker;
  f.modifiedTime = later(ctx.link.state.lastWriteAt, 5 * 60_000);
  await ctx.round();
  assert.equal(ctx.markers.d1.note.text, 'Second note');
  assert.equal(ctx.markers.d1.changedBy, 'PM (sheet)');
});

test('Excel: a teammate edit in the workbook is credited to them', async () => {
  resetFakeMsgraph();
  const BASE = 'http://fake-ms.test/v1.0';
  const provider = Object.assign(createMsGraphProvider({ getAccessToken: async () => 'fake-ms-access-1', fetch: fakeMsgraphFetch, baseUrl: BASE }), { accountEmail: FAKE_MS_EMAIL });
  const layout = buildSyncLayout({ template: template(), kit: defaultKit });
  const made = await provider.createFile({ title: 'Survey A', layout });
  const itemId = parseMsgraphFileId(made.fileId).itemId;
  const markers = { d1: door('d1', 'D-101') };
  const link = { file_id: made.fileId, layout, baseline: {}, state: { sheetIds: made.sheetIds }, remote_version: null, app_hash: null };
  const msApi = async (path, body) => (await fakeMsgraphFetch(`http://fake-ms.test/__fake${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)).json();
  const round = async () => {
    const res = await runSheetRound({
      link, provider, signing,
      loadMarkers: async () => structuredClone(markers),
      saveMarkers: async (writes) => { Object.assign(markers, mergeMarkerWrites(markers, markers, writes)); },
    });
    if (res.patch) Object.assign(link, res.patch);
    return res;
  };
  await round(); await round();
  // Survey's own writes show as the linker, close to the last write: no credit.
  const own = await round();
  assert.equal(own.status, 'idle');
  const sheet = (await msApi(`/files/${itemId}`)).sheets.find((s) => s.name === 'Doors - Level 1');
  const notes = sheet.rows[0].indexOf('Notes');
  const r = sheet.rows.findIndex((row, i) => i > 0 && row.includes('D-101'));
  await msApi(`/files/${itemId}/edit`, { title: 'Doors - Level 1', edits: [{ row: r, col: notes, value: 'Typed in Excel' }] });
  await round();
  assert.equal(markers.d1.note.text, 'Typed in Excel');
  assert.equal(markers.d1.changedBy, 'JF (sheet)');
  const after = (await msApi(`/files/${itemId}`)).sheets.find((s) => s.name === 'Doors - Level 1');
  assert.equal(after.rows[r][after.rows[0].indexOf('Changed By')], 'JF (sheet)');
});
