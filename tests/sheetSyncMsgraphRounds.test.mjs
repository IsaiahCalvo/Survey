// Live sheet sync through the Microsoft adapter: the same rounds the Google
// tests play (tests/sheetSync.test.mjs), driven through providers/msgraph.js
// against the fake Microsoft (scripts/e2e-fake-msgraph.mjs), plus what only
// Excel does (typing rules, personal OneDrive).
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { runSheetRound } from '../supabase/functions/_shared/sheetSync/round.js';
import { assertProvider } from '../supabase/functions/_shared/sheetSync/providers/contract.js';
import { createMsGraphProvider, parseMsgraphFileId } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';
import { mergeMarkerWrites } from '../supabase/functions/_shared/sheetSync/service.js';
import { RECENT_WRITE_MS } from '../supabase/functions/_shared/sheetSync/engine.js';
import defaultKit from '../src/services/exportFormats/kits/defaultSurvey.js';
import { fakeMsgraphFetch, resetFakeMsgraph } from '../scripts/e2e-fake-msgraph.mjs';

const BASE = 'http://fake-ms.test/v1.0';

const template = (extraLine = false) => ({
  modules: [{ id: 'm1', name: 'Level 1', categories: [
    { id: 'doors', name: 'Doors', checklist: [
      { id: 'c1', text: 'Locked?' },
      { id: 'c2', text: 'Height', kind: 'number' },
      ...(extraLine ? [{ id: 'c3', text: 'Signed off?' }] : []),
    ] },
    { id: 'cams', name: 'Cameras', checklist: [{ id: 'k1', text: 'Online?' }] },
  ] }],
  entities: [{ id: 'e1', name: 'Installed', color: '#0a0' }, { id: 'e2', name: 'Missing', color: '#a00' }],
});

const signing = { keyId: 'k1', secret: 'c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTEyMzQ=', signingDocId: 'doc-1:sheet-sync' };

const fakeApi = async (path, body) => {
  const res = await fakeMsgraphFetch(`http://fake-ms.test/__fake${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return res.json();
};

const msProvider = () => createMsGraphProvider({ getAccessToken: async () => 'fake-ms-access-1', fetch: fakeMsgraphFetch, baseUrl: BASE });

// One linked survey: markers held in memory the way the Y.Doc holds them.
async function setup({ markers = {}, layout = buildSyncLayout({ template: template(), kit: defaultKit }) } = {}) {
  resetFakeMsgraph();
  let provider = msProvider();
  const made = await provider.createFile({ title: 'Survey A', layout });
  const itemId = parseMsgraphFileId(made.fileId).itemId;
  const ctx = {
    markers: structuredClone(markers),
    link: { file_id: made.fileId, layout, baseline: {}, state: { sheetIds: made.sheetIds }, remote_version: null, app_hash: null },
    fileId: itemId,
    get provider() { return provider; },
    set provider(p) { provider = p; },
  };
  ctx.round = async (opts = {}) => {
    let n = 0;
    const result = await runSheetRound({
      link: ctx.link,
      provider: opts.provider || provider,
      loadMarkers: async () => structuredClone(ctx.markers),
      saveMarkers: async (writes) => { Object.assign(ctx.markers, mergeMarkerWrites(ctx.markers, ctx.markers, writes)); },
      signing,
      newMarkerId: () => `new-${++n}`,
      force: opts.force,
      ...(opts.now ? { now: opts.now } : {}),
    });
    if (result.patch) Object.assign(ctx.link, result.patch);
    return result;
  };
  ctx.sheet = async (title = 'Doors - Level 1') => {
    const f = await fakeApi(`/files/${itemId}`);
    return f.sheets.find((s) => s.name === title);
  };
  ctx.edit = (edits, title = 'Doors - Level 1') => fakeApi(`/files/${itemId}/edit`, { title, edits });
  ctx.rowOf = async (markerId, title = 'Doors - Level 1') => {
    const sheet = await ctx.sheet(title);
    const nameCol = sheet.rows[0].indexOf('Item');
    return sheet.rows.findIndex((r, i) => i > 0 && r[nameCol] === ctx.markers[markerId]?.name);
  };
  ctx.col = async (header, title = 'Doors - Level 1') => (await ctx.sheet(title)).rows[0].indexOf(header);
  return ctx;
}

const door = (id, name, extra = {}) => ({
  id, name, moduleId: 'm1', categoryId: 'doors', pageNumber: 1, bounds: { x: 1, y: 1, width: 5, height: 5 },
  checklistResponses: {}, note: { text: '' }, changedBy: 'IC', changedDate: '2026-10-28T12:00:00.000Z', ...extra,
});

test('first round fills the sheet with signed rows; an idle round reads nothing', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { checklistResponses: { c1: { selection: 'Y' }, c2: { selection: '84' } }, entityName: 'Installed' }), d2: door('d2', 'D-102') } });
  const first = await ctx.round();
  assert.equal(first.status, 'synced');
  assert.equal(first.summary.appended, 2);
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows.length, 3);
  assert.match(sheet.rows[1][0], /^v1\.k1\./, 'Row ID is a signed token');
  assert.equal(sheet.rows[1][3], 'D-101');
  assert.equal(sheet.rows[1][4], 'Y');
  assert.equal(sheet.rows[1][5], 84, 'number answers go in as numbers');
  assert.equal(sheet.rows[1][6], 'Installed');
  assert.deepEqual(sheet.hidden, ['A:A'], 'Row ID column hidden');
  assert.ok(Object.keys(sheet.validations).length >= 2, 'drop-downs for answers and entity');
  // Our own writes changed the version, so one more read settles it; then idle.
  assert.equal((await ctx.round()).status, 'synced');
  assert.equal((await ctx.round()).status, 'idle');
});

test('a field tech answer reaches the sheet; a PM edit reaches the app; both land on one row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  // Field tech answers "Locked?" in the app; the PM types a note in the sheet.
  ctx.markers.d1.checklistResponses = { c1: { selection: 'N' } };
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: await ctx.col('Notes'), value: 'Hinge squeaks' }]);
  const res = await ctx.round();
  assert.equal(res.summary.conflicts, 0);
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows[r][await ctx.col('Locked?')], 'N');
  assert.equal(sheet.rows[r][await ctx.col('Notes')], 'Hinge squeaks');
  assert.equal(ctx.markers.d1.note.text, 'Hinge squeaks');
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N');
  // Later, the PM picks an entity and fixes the item name; "y" is tidied to
  // "Y". (Inside the late-save window, changing the "N" Survey just wrote
  // would be asked about instead; see sheetSyncBreak.)
  await ctx.edit([
    { row: r, col: await ctx.col('Entity'), value: 'missing' },
    { row: r, col: await ctx.col('Item'), value: 'D-101A' },
    { row: r, col: await ctx.col('Locked?'), value: 'y' },
  ]);
  await ctx.round({ force: true, now: new Date(Date.now() + RECENT_WRITE_MS + 1000) });
  assert.equal(ctx.markers.d1.entityId, 'e2');
  assert.equal(ctx.markers.d1.entityName, 'Missing');
  assert.equal(ctx.markers.d1.name, 'D-101A');
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'Y');
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'Y');
});

test('same cell changed on both sides: only that cell waits, and the choice settles it', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const r = await ctx.rowOf('d1');
  ctx.markers.d1.checklistResponses = { c1: { selection: 'Y' } };
  ctx.markers.d1.note = { text: 'app note' };
  await ctx.edit([{ row: r, col: await ctx.col('Locked?'), value: 'N' }, { row: r, col: await ctx.col('Item'), value: 'D-101 east' }]);
  const res = await ctx.round();
  assert.equal(res.summary.conflicts, 1);
  const conflict = ctx.link.state.conflicts.d1;
  assert.deepEqual(conflict.fields.map((f) => [f.header, f.app, f.sheet]), [['Locked?', 'Y', 'N']]);
  // Undisputed cells still moved both ways.
  assert.equal(ctx.markers.d1.name, 'D-101 east');
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Notes')], 'app note');
  // Nothing overwrote the disputed cell on either side.
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'Y');
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'N');
  // A later round keeps waiting, then "Use the sheet's" settles it for good.
  await ctx.round({ force: true });
  assert.ok(ctx.link.state.conflicts.d1);
  ctx.link.state = { ...ctx.link.state, choices: { d1: 'sheet' } };
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N');
  assert.equal(ctx.link.state.conflicts.d1, undefined);
  await ctx.round({ force: true });
  assert.equal(ctx.link.state.conflicts.d1, undefined, 'the conflict does not come back');
  // "Keep mine" the other way round writes the app's value into the sheet.
  ctx.markers.d1.checklistResponses = { c1: { selection: 'N/A' } };
  await ctx.edit([{ row: r, col: await ctx.col('Locked?'), value: 'Y' }]);
  await ctx.round();
  assert.ok(ctx.link.state.conflicts.d1);
  ctx.link.state = { ...ctx.link.state, choices: { d1: 'app' } };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'N/A');
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N/A');
  assert.equal(ctx.link.state.conflicts.d1, undefined);
});

test('a bad value in the sheet is reported and never written into the app', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: await ctx.col('Locked?'), value: 'Maybe' }, { row: r, col: await ctx.col('Height'), value: 'tall' }]);
  await ctx.round();
  assert.equal(ctx.markers.d1.checklistResponses.c1, undefined);
  assert.equal(ctx.link.state.problems.length, 2);
  assert.match(ctx.link.state.problems[0].message, /Maybe/);
  assert.equal((await ctx.sheet()).rows[r][await ctx.col('Locked?')], 'Maybe', 'the person fixes it, not us');
});

test('a row typed in the sheet becomes a new item; a copied row becomes a second item', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const sheet = await ctx.sheet();
  const at = sheet.rows.length;
  const col = (h) => sheet.rows[0].indexOf(h);
  await ctx.edit([
    { row: at, col: col('Item'), value: 'D-200' }, { row: at, col: col('Locked?'), value: 'Y' }, { row: at, col: col('Entity'), value: 'Installed' },
    // A copy of D-101's row, Row ID and all.
    { row: at + 1, col: 0, value: sheet.rows[1][0] }, { row: at + 1, col: col('Item'), value: 'D-101 copy' },
  ]);
  const res = await ctx.round();
  assert.equal(res.summary.created, 2);
  const created = Object.values(ctx.markers).filter((m) => m.source === 'sheet');
  assert.deepEqual(created.map((m) => m.name).sort(), ['D-101 copy', 'D-200']);
  const d200 = created.find((m) => m.name === 'D-200');
  assert.equal(d200.pageNumber, null, 'not placed on the drawing yet');
  assert.equal(d200.entityId, 'e1');
  assert.equal(d200.checklistResponses.c1.selection, 'Y');
  assert.equal(ctx.markers.d1.name, 'D-101', 'the original keeps its name');
  const after = await ctx.sheet();
  assert.match(after.rows[at][0], /^v1\./, 'the new row got its own Row ID');
  assert.notEqual(after.rows[at + 1][0], after.rows[1][0], 'the copy got a new Row ID');
  await ctx.round({ force: true });
  assert.equal(Object.keys(ctx.markers).length, 3, 'no twins on the next round');
});

test('a row deleted in the sheet never deletes the item, and can be put back', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  await fakeApi(`/files/${ctx.fileId}/delete-row`, { title: 'Doors - Level 1', row: await ctx.rowOf('d2') });
  await ctx.round();
  assert.ok(ctx.markers.d2, 'the item is still there');
  assert.ok(ctx.link.state.removedInSheet.d2);
  await ctx.round({ force: true });
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-102').length, 0, 'not re-added on its own');
  ctx.link.state = { ...ctx.link.state, choices: { d2: 'putBack' } };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-102').length, 1);
  assert.equal(ctx.link.state.removedInSheet.d2, undefined);
});

test('an item deleted in the app removes its row, unless the sheet changed that row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  const r2 = await ctx.rowOf('d2');
  await ctx.edit([{ row: r2, col: await ctx.col('Notes'), value: 'PM note' }]);
  delete ctx.markers.d1;
  delete ctx.markers.d2;
  await ctx.round();
  const rows = (await ctx.sheet()).rows;
  assert.equal(rows.filter((row) => row[3] === 'D-101').length, 0, 'untouched row removed');
  assert.equal(rows.filter((row) => row[3] === 'D-102').length, 1, 'a row the PM edited stays');
  await ctx.round({ force: true });
  assert.equal(Object.keys(ctx.markers).length, 0, 'and it does not come back as a new item');
});

test('a sort in the sheet between read and write: nothing lands on the wrong row', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101'), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  ctx.markers.d1.checklistResponses = { c1: { selection: 'Y' } };
  // A provider that lets the PM sort Z-A right after we read the sheet.
  let sorted = false;
  const p = ctx.provider;
  const sorting = { ...p, readGrid: async (id) => {
    const grid = await p.readGrid(id);
    if (!sorted) { sorted = true; await fakeApi(`/files/${ctx.fileId}/sort`, { title: 'Doors - Level 1' }); }
    return grid;
  } };
  const res = await ctx.round({ provider: sorting });
  assert.equal(res.status, 'retry');
  const res2 = await ctx.round();
  assert.equal(res2.status, 'synced');
  const sheet = await ctx.sheet();
  const lockedCol = sheet.rows[0].indexOf('Locked?');
  assert.equal(sheet.rows.find((row) => row[3] === 'D-101')[lockedCol], 'Y');
  assert.notEqual(sheet.rows.find((row) => row[3] === 'D-102')[lockedCol], 'Y');
});

test('a new checklist line and a new category after linking: the sheet grows to match', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const bigger = template(true);
  bigger.modules[0].categories.push({ id: 'racks', name: 'Racks', checklist: [{ id: 'r1', text: 'Labelled?' }] });
  ctx.link.layout = buildSyncLayout({ template: bigger, kit: defaultKit });
  ctx.markers.d1.checklistResponses = { c3: { selection: 'Y' } };
  ctx.markers.r1 = { ...door('r1', 'Rack 1'), categoryId: 'racks' };
  await ctx.round();
  const doors = await ctx.sheet();
  assert.equal(doors.rows[0].at(-1), 'Signed off?');
  assert.equal(doors.rows[1].at(-1), 'Y');
  const racks = await ctx.sheet('Racks - Level 1');
  assert.equal(racks.rows[1][3], 'Rack 1');
  // A column the PM deletes stays deleted.
  const notesCol = doors.rows[0].indexOf('Notes');
  await ctx.edit((await ctx.sheet()).rows.map((_, r) => ({ row: r, col: notesCol, value: null })));
  await ctx.round({ force: true });
  assert.equal((await ctx.sheet()).rows[0].filter((h) => h === 'Notes').length, 0);
});

test('an item moved to another category moves to that tab', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  ctx.markers.d1 = { ...ctx.markers.d1, categoryId: 'cams' };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-101').length, 0);
  assert.equal((await ctx.sheet('Cameras - Level 1')).rows.filter((row) => row[3] === 'D-101').length, 1);

  // And back again: the new tab is read before the old one this time.
  ctx.markers.d1 = { ...ctx.markers.d1, categoryId: 'doors' };
  await ctx.round();
  assert.equal((await ctx.sheet()).rows.filter((row) => row[3] === 'D-101').length, 1);
  assert.equal((await ctx.sheet('Cameras - Level 1')).rows.filter((row) => row[3] === 'D-101').length, 0);
  assert.equal(Object.keys(ctx.markers).length, 1, 'no copy made');
});

test('the Microsoft adapter meets the contract and makes the workbook the way a PM expects', async () => {
  assertProvider(msProvider());
  const ctx = await setup();
  const f = await fakeApi(`/files/${ctx.fileId}`);
  assert.deepEqual(f.sheets.map((s) => s.name), ['Doors - Level 1', 'Cameras - Level 1'], 'no stray Sheet1');
  assert.equal(f.sheets[0].frozen, 1, 'header row stays in view');
});

test('text that looks like a number, date or yes/no stays text both ways', async () => {
  const ctx = await setup({ markers: { d1: door('d1', '00123', { note: { text: 'TRUE' }, checklistResponses: { c2: { selection: '84' } } }) } });
  await ctx.round(); await ctx.round();
  const sheet = await ctx.sheet();
  const row = sheet.rows[1];
  assert.equal(row[sheet.rows[0].indexOf('Item')], '00123', 'leading zeros kept');
  assert.equal(row[sheet.rows[0].indexOf('Notes')], 'TRUE', 'not turned into a yes/no');
  assert.equal(row[sheet.rows[0].indexOf('Height')], 84, 'a number answer is a real number');
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d1.name, '00123');
  assert.equal(ctx.markers.d1.note.text, 'TRUE');
  assert.equal(ctx.link.state.problems?.length || 0, 0);
});

test('a workbook on a personal OneDrive pauses instead of half-syncing', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await fakeApi('/drive-type', { driveType: 'personal' });
  await assert.rejects(ctx.round({ provider: msProvider() }), (e) => e.status === 409 && e.code === 'personal-onedrive');
});

test('a new workbook keeps text columns as text, like Google', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  const sheet = await ctx.sheet();
  // Row ID, Changed By, Item, Locked? (a pick-one answer), Entity, Notes: text.
  // Changed Date and the Height number answer: left alone.
  assert.deepEqual([...sheet.textColumns].sort(), ['A2:A1000', 'B2:B1000', 'D2:D1000', 'E2:E1000', 'G2:G1000', 'H2:H1000']);
});

test('rounds read only the synced sheets, not a big sheet the PM added', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  await ctx.round(); await ctx.round();
  const calls = [];
  const counting = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push(`${req.method} ${new URL(req.url).pathname}`);
    return fakeMsgraphFetch(req);
  };
  // The PM adds a sheet of their own (the fake makes it like Excel would).
  const f = globalThis.__fakeMsgraph.files.get(ctx.fileId);
  f.sheets.push({ id: 'pm-notes', name: 'PM notes', position: 99, visibility: 'Visible', cells: [['Big'], ['table']], hidden: [], validations: {} });
  ctx.provider = createMsGraphProvider({ getAccessToken: async () => 'fake-ms-access-1', fetch: counting, baseUrl: BASE });
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: await ctx.col('Notes'), value: 'Read me' }]);
  const round = await ctx.round();
  assert.equal(round.summary.toApp, 1);
  const reads = calls.filter((c) => c.includes('/usedRange'));
  assert.equal(reads.length, Object.keys(ctx.link.state.sheetIds).length, 'one read per synced sheet');
  assert.ok(!reads.some((c) => c.includes('pm-notes')), 'the PM\'s own sheet is never read');
});

test('where the workbook was saved survives every round, and blank stamps are filled once', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { changedBy: '', changedDate: '' }) } });
  ctx.link.state = { ...ctx.link.state, folder: 'Jobs/2026' };
  let n = 0;
  const round = () => runSheetRound({
    link: ctx.link, provider: ctx.provider, signing, fillBy: 'IC',
    loadMarkers: async () => structuredClone(ctx.markers),
    saveMarkers: async (writes) => { Object.assign(ctx.markers, mergeMarkerWrites(ctx.markers, ctx.markers, writes)); },
    newMarkerId: () => `new-${++n}`,
  }).then((res) => { if (res.patch) Object.assign(ctx.link, res.patch); return res; });
  await round(); await round();
  assert.equal(ctx.link.state.folder, 'Jobs/2026');
  assert.equal(ctx.markers.d1.changedBy, 'IC');
  assert.match(ctx.markers.d1.changedDate, /^\d{4}-\d\d-\d\dT/);
  const sheet = await ctx.sheet();
  const r = await ctx.rowOf('d1');
  assert.equal(sheet.rows[r][sheet.rows[0].indexOf('Changed By')], 'IC', 'the sheet shows it');
});

// Real Excel, round 4: an older copy of the workbook restored from version
// history (or a column cleared by mistake) blanked every field note at once,
// and the round copied the blanks into the survey.
const fifteen = () => Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { note: { text: `field note ${i + 1}` } })]));
async function blankNotes(ctx, n) {
  const col = await ctx.col('Notes');
  const edits = [];
  for (let i = 1; i <= n; i += 1) edits.push({ row: await ctx.rowOf(`d${i}`), col, value: '' });
  await ctx.edit(edits);
}

test('many answers blanked in the sheet at once are held, not copied into the survey', async () => {
  const ctx = await setup({ markers: fifteen() });
  await ctx.round(); await ctx.round();
  await blankNotes(ctx, 12);
  const r = await ctx.round();
  assert.equal(r.summary.toApp, 0, 'nothing cleared in the survey');
  assert.equal(ctx.markers.d1.note.text, 'field note 1');
  assert.deepEqual(ctx.link.state.heldErase && { count: ctx.link.state.heldErase.count, items: ctx.link.state.heldErase.items }, { count: 12, items: 12 });
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows[await ctx.rowOf('d1')][await ctx.col('Notes')], '', 'the sheet is left as the PM left it until someone chooses');
  // Another change from the sheet still comes in while the blanks wait.
  await ctx.edit([{ row: await ctx.rowOf('d13'), col: await ctx.col('Notes'), value: 'PM typed this' }]);
  await ctx.round();
  assert.equal(ctx.markers.d13.note.text, 'PM typed this');
  assert.equal(ctx.markers.d2.note.text, 'field note 2', 'still held');
  assert.equal(ctx.link.state.heldErase.count, 12);
});

test('held blanks: "Put them back in the sheet" writes the survey\'s answers back', async () => {
  const ctx = await setup({ markers: fifteen() });
  await ctx.round(); await ctx.round();
  await blankNotes(ctx, 12);
  await ctx.round();
  ctx.link.state = { ...ctx.link.state, eraseChoice: 'app' };
  await ctx.round({ force: true });
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows[await ctx.rowOf('d5')][await ctx.col('Notes')], 'field note 5');
  assert.equal(ctx.markers.d5.note.text, 'field note 5');
  assert.equal(ctx.link.state.heldErase, undefined);
  assert.equal(ctx.link.state.eraseChoice, undefined, 'the choice is used once');
  await ctx.round();
  assert.equal((await ctx.round()).status, 'idle');
});

test('held blanks: "Clear them here too" clears them in the survey', async () => {
  const ctx = await setup({ markers: fifteen() });
  await ctx.round(); await ctx.round();
  await blankNotes(ctx, 12);
  await ctx.round();
  ctx.link.state = { ...ctx.link.state, eraseChoice: 'sheet' };
  const r = await ctx.round({ force: true });
  assert.equal(r.summary.toApp, 12);
  assert.equal(ctx.markers.d5.note.text || '', '');
  assert.equal(ctx.markers.d14.note.text, 'field note 14', 'untouched rows keep theirs');
  assert.equal(ctx.link.state.heldErase, undefined);
});

test('held blanks the PM fills in again (Undo in Excel) stop being held', async () => {
  const ctx = await setup({ markers: fifteen() });
  await ctx.round(); await ctx.round();
  await blankNotes(ctx, 12);
  await ctx.round();
  const col = await ctx.col('Notes');
  const edits = [];
  for (let i = 1; i <= 12; i += 1) edits.push({ row: await ctx.rowOf(`d${i}`), col, value: `field note ${i}` });
  await ctx.edit(edits);
  const r = await ctx.round();
  assert.equal(ctx.link.state.heldErase, undefined);
  assert.equal(r.summary.toApp, 0);
});

test('a few answers cleared in the sheet still come in as a normal PM edit', async () => {
  const ctx = await setup({ markers: fifteen() });
  await ctx.round(); await ctx.round();
  await blankNotes(ctx, 3);
  const r = await ctx.round();
  assert.equal(r.summary.toApp, 3);
  assert.equal(ctx.markers.d1.note.text || '', '');
  assert.equal(ctx.link.state.heldErase, undefined);
});

// Real Excel, round 4: the heading row deleted, or the whole tab cleared,
// left only "The Row ID column is missing", with no way back but Undo.
test('a tab that lost its heading row is left alone, listed, and picked up again after Undo', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'a' } }), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  const header = (await ctx.sheet()).rows[0];
  await fakeApi(`/files/${ctx.fileId}/delete-row`, { title: 'Doors - Level 1', row: 0 });
  const before = JSON.stringify((await ctx.sheet()).rows);
  ctx.markers.d1.note = { text: 'changed in the app meanwhile' };
  const r = await ctx.round();
  assert.equal(r.status, 'synced');
  assert.equal(ctx.link.state.brokenTabs.length, 1);
  assert.equal(JSON.stringify((await ctx.sheet()).rows), before, 'nothing written to the broken tab');
  assert.equal(ctx.markers.d1.note.text, 'changed in the app meanwhile', 'nothing lost in the app');
  // Undo in Excel: the heading row comes back; the tab syncs again.
  await fakeApi(`/files/${ctx.fileId}/insert-row`, { title: 'Doors - Level 1', row: 0, values: header });
  await ctx.round();
  assert.deepEqual(ctx.link.state.brokenTabs, []);
  const sheet = await ctx.sheet();
  assert.equal(sheet.rows[await ctx.rowOf('d1')][await ctx.col('Notes')], 'changed in the app meanwhile');
});

test('a broken tab can be made again from the survey; the old one is left as it is', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101', { note: { text: 'keep me' } }), d2: door('d2', 'D-102') } });
  await ctx.round(); await ctx.round();
  const sheet0 = await ctx.sheet();
  const edits = [];
  sheet0.rows.forEach((row, r) => row.forEach((_, c) => edits.push({ row: r, col: c, value: '' })));
  await ctx.edit(edits); // select all, Delete
  await ctx.round();
  const scopeId = ctx.link.state.brokenTabs[0];
  assert.ok(scopeId);
  // What the panel's "Make a new sheet" does (service chooseConflict putBackTab).
  const { [scopeId]: _old, ...sheetIds } = ctx.link.state.sheetIds;
  const baseline = Object.fromEntries(Object.entries(ctx.link.baseline).filter(([, b]) => b.scopeId !== scopeId));
  ctx.link.state = { ...ctx.link.state, sheetIds, brokenTabs: [] };
  ctx.link.baseline = baseline;
  await ctx.round({ force: true });
  const f = await fakeApi(`/files/${ctx.fileId}`);
  const made = f.sheets.find((s) => s.name !== 'Doors - Level 1' && s.name.startsWith('Doors'));
  assert.ok(made, `a new tab named apart from the old one (${f.sheets.map((s) => s.name).join(', ')})`);
  assert.ok(made.rows.some((row) => row.includes('D-101') && row.includes('keep me')));
  assert.ok(f.sheets.some((s) => s.name === 'Doors - Level 1'), 'the old tab is still there');
  assert.equal(Object.keys(ctx.markers).length, 2);
  await ctx.round();
  assert.deepEqual(ctx.link.state.brokenTabs, []);
});
