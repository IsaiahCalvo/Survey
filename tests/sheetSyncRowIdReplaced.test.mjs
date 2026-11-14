// Find and Replace in Excel and Google Sheets also changes the hidden Row ID
// column. Real Excel 11-14: Replace All on a two-letter tag changed the names
// and all 150 Row IDs, and every row became a twin item while all 150 items
// were listed as removed. A changed Row ID is now matched to the item it is
// clearly closest to, and the Row ID goes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door, signing } from './helpers/sheetSyncHarness.mjs';
import { generateRowIdToken } from '../src/services/rowIdToken.js';

const N = 8;
const linked = async (name = (i) => `MJ-${101 + i}`) => {
  const markers = Object.fromEntries(Array.from({ length: N }, (_, i) => [`d${i + 1}`, door(`d${i + 1}`, name(i), { note: { text: `note ${i + 1}` } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = await ctx.sheet();
  return { ctx, sheet, item: sheet.rows[0].indexOf('Item') };
};
// A run of capitals every Row ID of the tab holds (from the survey's own part).
const sharedRun = (tokens) => {
  const t0 = tokens[0];
  for (let i = 6; i + 2 <= t0.length; i += 1) {
    const run = t0.slice(i, i + 2);
    if (/^[A-Z]{2}$/.test(run) && tokens.every((t) => t.includes(run))) return run;
  }
  return null;
};

test('Replace All that hits every Row ID renames the items: no twins, nothing listed as removed, Row IDs put back', async () => {
  const { ctx, sheet, item } = await linked();
  const rows = sheet.rows.slice(1).filter((r) => r[item]);
  const run = sharedRun(rows.map((r) => r[0]));
  assert.ok(run, 'the tab has a run of capitals in every Row ID');
  const edits = [];
  rows.forEach((r, i) => {
    edits.push({ row: i + 1, col: 0, value: r[0].split(run).join('DR') });
    edits.push({ row: i + 1, col: item, value: `${run}-${101 + i}` });
  });
  await ctx.edit(edits);
  const res = await ctx.round({ force: true });
  assert.equal(res.summary.created, 0, 'no twin items');
  assert.equal(Object.keys(ctx.markers).length, N);
  for (let i = 0; i < N; i++) {
    assert.equal(ctx.markers[`d${i + 1}`].name, `${run}-${101 + i}`, 'renamed as the PM did');
    assert.equal(ctx.markers[`d${i + 1}`].note.text, `note ${i + 1}`, 'note kept');
  }
  assert.deepEqual(Object.keys(ctx.link.state.removedInSheet || {}), []);
  const after = await ctx.sheet();
  after.rows.slice(1).filter((r) => r[item]).forEach((r, i) => assert.equal(r[0], rows[i][0], 'Row ID put back'));
  assert.ok((ctx.link.state.notices || []).some((n) => new RegExp(`${N} hidden Row IDs .* changed \\(Find and Replace changes them too\\)`).test(n.message)));
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.created + quiet.summary.toApp + quiet.summary.toSheet, 0, 'the next round is quiet');
});

test('one Row ID with a letter changed, name changed too: still its own item', async () => {
  const { ctx, sheet, item } = await linked((i) => `D-${101 + i}`);
  const r = await ctx.rowOf('d3');
  const t = sheet.rows[r][0];
  const k = t.length - 5;
  const bent = t.slice(0, k) + (t[k] === 'A' ? 'B' : 'A') + t.slice(k + 1);
  await ctx.edit([{ row: r, col: 0, value: bent }, { row: r, col: item, value: 'Door 103' }]);
  const res = await ctx.round({ force: true });
  assert.equal(res.summary.created, 0);
  assert.equal(ctx.markers.d3.name, 'Door 103');
  assert.equal((await ctx.sheet()).rows[r][0], t);
});

test('a row carrying another survey\'s Row ID is a new item, never matched to an item of this one', async () => {
  const { ctx, sheet, item } = await linked((i) => `D-${101 + i}`);
  const notes = sheet.rows[0].indexOf('Notes');
  // D-102's row is cleared, so d2 has no row; a row from another survey goes in its place.
  const r = await ctx.rowOf('d2');
  const foreign = await generateRowIdToken({ keyId: signing.keyId, secret: signing.secret, documentId: 'another-doc:sheet-sync', scopeId: ctx.link.layout.scopes[0].scopeId, markerId: 'd2' });
  await ctx.edit([{ row: r, col: 0, value: foreign }, { row: r, col: item, value: 'X-900' }, { row: r, col: notes, value: 'elsewhere' }]);
  const res = await ctx.round({ force: true });
  assert.equal(res.summary.created, 1, 'a new item from the sheet');
  assert.equal(ctx.markers.d2.name, 'D-102', 'd2 keeps its name');
  assert.equal(ctx.markers.d2.note.text, 'note 2', 'and its note');
  assert.ok(ctx.link.state.removedInSheet?.d2, 'd2 is listed as removed from the sheet');
});
