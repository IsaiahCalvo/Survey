// Merged cells in a live Excel workbook. Excel keeps only the top-left value
// when a PM merges cells, and Graph's Excel API can't say where merged areas
// are, so the blanked cells read like the PM clearing them: the field techs'
// values were wiped in the app (real Excel 11-15, two Notes cells merged).
// The round now reads the merged areas from the file itself when filled
// cells turn blank (providers/xlsxMerges.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { runSheetRound, FILE_WAIT_MS } from '../supabase/functions/_shared/sheetSync/round.js';
import { createMsGraphProvider, parseMsgraphFileId } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';
import { mergesFromXlsx, mergeArea } from '../supabase/functions/_shared/sheetSync/providers/xlsxMerges.js';
import { mergeMarkerWrites } from '../supabase/functions/_shared/sheetSync/service.js';
import defaultKit from '../src/services/exportFormats/kits/defaultSurvey.js';
import { fakeMsgraphFetch, resetFakeMsgraph } from '../scripts/e2e-fake-msgraph.mjs';

const BASE = 'http://fake-ms.test/v1.0';
const TITLE = 'Doors - Level 1';
const template = () => ({
  modules: [{ id: 'm1', name: 'Level 1', categories: [
    { id: 'doors', name: 'Doors', checklist: [{ id: 'c1', text: 'Locked?' }] },
  ] }],
  entities: [],
});
const signing = { keyId: 'k1', secret: btoa('test-only-'.repeat(4)), signingDocId: 'doc-1:sheet-sync' };
const door = (id, name, note) => ({
  id, name, moduleId: 'm1', categoryId: 'doors', pageNumber: 1, bounds: { x: 1, y: 1, width: 5, height: 5 },
  checklistResponses: { c1: { selection: 'Y' } }, note: { text: note }, changedBy: 'IC', changedDate: '2026-10-28T12:00:00.000Z',
});
const fakeApi = async (path, body) => (await fakeMsgraphFetch(`http://fake-ms.test/__fake${path}`, body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)).json();

async function setup({ failContent = false } = {}) {
  resetFakeMsgraph();
  const calls = { content: 0 };
  const fetchImpl = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/\/content$/.test(url)) {
      calls.content += 1;
      if (failContent) return new Response('busy', { status: 503 });
    }
    return fakeMsgraphFetch(input, init);
  };
  const provider = createMsGraphProvider({ getAccessToken: async () => 'fake-ms-access-1', fetch: fetchImpl, baseUrl: BASE });
  const layout = buildSyncLayout({ template: template(), kit: defaultKit });
  const made = await provider.createFile({ title: 'Survey A', layout });
  const itemId = parseMsgraphFileId(made.fileId).itemId;
  const notes = ['check hinge', 'apple', 'co-op', 'Zed', 'ünder'];
  const ctx = {
    calls,
    markers: Object.fromEntries(notes.map((n, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-10${i + 1}`, n)])),
    link: { file_id: made.fileId, layout, baseline: {}, state: { sheetIds: made.sheetIds }, remote_version: null, app_hash: null },
  };
  ctx.round = async () => {
    let n = 0;
    const result = await runSheetRound({
      link: ctx.link, provider, signing, force: true, newMarkerId: () => `new-${++n}`,
      loadMarkers: async () => structuredClone(ctx.markers),
      saveMarkers: async (writes) => { Object.assign(ctx.markers, mergeMarkerWrites(ctx.markers, ctx.markers, writes)); },
    });
    if (result.patch) Object.assign(ctx.link, result.patch);
    return result;
  };
  ctx.sheet = async () => (await fakeApi(`/files/${itemId}`)).sheets.find((s) => s.name === TITLE);
  ctx.merge = (range, late = false) => fakeApi(`/files/${itemId}/merge`, { title: TITLE, range, late });
  ctx.save = () => fakeApi(`/files/${itemId}/save`, { title: TITLE });
  ctx.edit = (edits) => fakeApi(`/files/${itemId}/edit`, { title: TITLE, edits });
  ctx.note = (id) => ctx.markers[id].note?.text ?? '';
  ctx.problems = () => (ctx.link.state.problems || []).map((p) => p.message || p);
  await ctx.round();
  await ctx.round();
  ctx.notesCol = (await ctx.sheet()).rows[0].indexOf('Notes');
  return ctx;
}

test('two Notes cells merged in Excel: the hidden note stays in the app and the panel says to unmerge', async () => {
  const ctx = await setup();
  const col = String.fromCharCode(65 + ctx.notesCol);
  await ctx.merge(`${col}3:${col}4`); // D-102 (apple) and D-103 (co-op): Excel keeps "apple"
  assert.equal((await ctx.sheet()).rows[3][ctx.notesCol], '');

  const r = await ctx.round();
  assert.equal(r.status, 'synced');
  assert.equal(ctx.note('d3'), 'co-op', 'the merged-away note is kept in the app');
  assert.equal(ctx.note('d2'), 'apple');
  assert.ok(ctx.problems().some((m) => /D-103|Row 4/.test(m) && /merged cells/.test(m) && /Unmerge/.test(m)), ctx.problems().join('\n'));

  // Later rounds stay quiet and keep it, without reading the file again.
  const before = ctx.calls.content;
  const again = await ctx.round();
  assert.equal(again.summary?.toApp ?? 0, 0);
  assert.equal(ctx.note('d3'), 'co-op');
  assert.equal(ctx.calls.content, before);
  for (const id of ['d1', 'd4', 'd5']) assert.equal(ctx.note(id), ctx.markers[id].note.text);
});

test('the top-left cell of a merged block still syncs both ways', async () => {
  const ctx = await setup();
  const col = String.fromCharCode(65 + ctx.notesCol);
  await ctx.merge(`${col}3:${col}4`);
  await ctx.round();
  await ctx.edit([{ row: 2, col: ctx.notesCol, value: 'apple core' }]);
  await ctx.round();
  assert.equal(ctx.note('d2'), 'apple core');
  assert.equal(ctx.note('d3'), 'co-op');
});

test('a plain clear (no merge) still clears the app value, after one look at the file', async () => {
  const ctx = await setup();
  await ctx.edit([{ row: 4, col: ctx.notesCol, value: '' }]); // D-104 "Zed" cleared by the PM
  await ctx.round();
  assert.equal(ctx.note('d4'), '');
  assert.equal(ctx.calls.content, 1);
  assert.equal(ctx.note('d3'), 'co-op');
});

test('quiet rounds and plain edits never download the file', async () => {
  const ctx = await setup();
  await ctx.round();
  await ctx.edit([{ row: 1, col: ctx.notesCol, value: 'check hinge again' }]);
  await ctx.round();
  assert.equal(ctx.note('d1'), 'check hinge again');
  assert.equal(ctx.calls.content, 0);
});

test('a file that cannot be read leaves the round as it was (no crash)', async () => {
  const ctx = await setup({ failContent: true });
  await ctx.edit([{ row: 4, col: ctx.notesCol, value: '' }]);
  const r = await ctx.round();
  assert.equal(r.status, 'synced');
  assert.equal(ctx.note('d4'), '');
});

test('mergesFromXlsx: deflated parts, parts numbered apart from tab order, odd names, one-cell refs', async () => {
  // A real .xlsx as the fake builds it: two tabs, sheet parts numbered backwards.
  resetFakeMsgraph();
  const made = await fakeApi('/make-file', { name: 'T.xlsx', sheets: [{ name: 'A & B <1>', rows: [['x']] }, { name: 'Doors', rows: [['y']] }] });
  await fakeApi(`/files/${made.id}/merge`, { title: 'Doors', range: 'B2:C3' });
  await fakeApi(`/files/${made.id}/merge`, { title: 'A & B <1>', range: 'A5:A6' });
  const meta = await fakeApi(`/files/${made.id}`);
  const ids = Object.fromEntries(meta.sheets.map((s) => [s.name, s.id]));
  const res = await fakeMsgraphFetch(`http://fake-ms.test/v1.0/drives/b!fake-drive/items/${made.id}/content`, { headers: { authorization: 'Bearer fake-ms-access-1' } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const found = await mergesFromXlsx(bytes, meta.sheets.map((s) => ({ sheetId: s.id, title: s.name })),
    [{ sheetId: ids.Doors, row: 0, col: 0 }, { sheetId: ids.Doors, row: 2, col: 2 }, { sheetId: ids['A & B <1>'], row: 0, col: 0 }]);
  assert.deepEqual(found.merges[ids.Doors], [{ r0: 1, r1: 3, c0: 1, c1: 3 }]);
  assert.deepEqual(found.merges[ids['A & B <1>']], [{ r0: 4, r1: 6, c0: 0, c1: 1 }]);
  assert.deepEqual(found.filled.sort(), [`${ids.Doors}|0|0`, `${ids['A & B <1>']}|0|0`].sort());
  assert.equal(mergeArea('C4'), null);
  assert.equal(mergeArea('C4:C4'), null);
  assert.deepEqual(mergeArea('$AA$10:$AB$10'), { r0: 9, r1: 10, c0: 26, c1: 28 });
  await assert.rejects(mergesFromXlsx(new Uint8Array([1, 2, 3]), []), /not a zip/);
});

test('the saved file behind what Graph reads: the blank waits, then counts as merged once the file has it', async () => {
  const ctx = await setup();
  const col = String.fromCharCode(65 + ctx.notesCol);
  await ctx.merge(`${col}5:${col}6`, true); // D-104 Zed, D-105 ünder; the file still shows both
  const r1 = await ctx.round();
  assert.equal(r1.status, 'synced');
  assert.equal(ctx.note('d5'), 'ünder', 'nothing taken while the file is behind');
  assert.equal((await ctx.sheet()).rows[5][ctx.notesCol], '', 'nothing written into it either');
  assert.ok(ctx.link.state.fileBehind?.since > 0);
  assert.ok(!ctx.problems().some((m) => /merged/.test(m)));

  await ctx.save();
  await ctx.round();
  assert.equal(ctx.note('d5'), 'ünder');
  assert.equal(ctx.link.state.fileBehind, undefined);
  assert.ok(ctx.problems().some((m) => /Row 6/.test(m) && /merged cells/.test(m)), ctx.problems().join('\n'));
});

test('a file that stays behind past the wait: the blank is taken as it reads', async () => {
  const ctx = await setup();
  const col = String.fromCharCode(65 + ctx.notesCol);
  await ctx.merge(`${col}5:${col}6`, true);
  await ctx.round();
  assert.equal(ctx.note('d5'), 'ünder');
  ctx.link.state.fileBehind = { since: Date.now() - FILE_WAIT_MS - 1000 };
  await ctx.round();
  assert.equal(ctx.note('d5'), '');
});
