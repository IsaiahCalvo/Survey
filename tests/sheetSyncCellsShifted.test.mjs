// Cells inserted or deleted in some columns only ("Shift cells down" or "up",
// or Insert with only the visible cells of a row selected, which leaves the
// hidden Row ID column out): every value below lands on the next or previous
// item's row while the Row IDs stay (real Excel 11-14: 6 of 8 notes went to
// the wrong items and one was lost). The engine sees a column whose cells from
// some row down hold the values of the items a few rows above or below, keeps
// each value on its own item and puts the sheet back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, door } from './helpers/sheetSyncHarness.mjs';

const N = 8;
const yn = ['Y', 'N', 'Y', 'Y', 'N', 'N', 'Y', 'N'];
const want = Array.from({ length: N }, (_, i) => ({ name: `D-${101 + i}`, note: `note ${i + 1}`, locked: yn[i] }));
const linked = async () => {
  const markers = Object.fromEntries(want.map((w, i) => [`d${i + 1}`, door(`d${i + 1}`, w.name, { checklistResponses: { c1: { selection: w.locked } }, note: { text: w.note } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const head = (await ctx.sheet()).rows[0];
  const cols = { item: head.indexOf('Item'), notes: head.indexOf('Notes'), locked: head.indexOf('Locked?'), rowId: head.indexOf('Row ID') };
  const first = await ctx.rowOf('d1');
  // What the sheet holds after `by` cells are inserted (by > 0) or deleted
  // (by < 0) at list row `at` (0 = first item) in the given columns.
  const shift = async (keys, at, by, extra = []) => {
    const rows = (await ctx.sheet()).rows;
    const edits = [];
    for (const key of keys) {
      const c = cols[key];
      const vals = rows.slice(first, first + N).map((r) => r[c] ?? '');
      const moved = [...vals.slice(0, at), ...(by > 0 ? Array(by).fill('') : []), ...vals.slice(at + Math.max(0, -by))];
      while (moved.length < N + Math.max(0, by)) moved.push('');
      moved.forEach((value, i) => edits.push({ row: first + i, col: c, value }));
    }
    await ctx.edit([...edits, ...extra.map((e) => ({ ...e, row: first + e.row }))]);
  };
  return { ctx, cols, first, shift };
};
const appState = (ctx) => Object.values(ctx.markers).map((m) => ({ name: m.name, note: m.note?.text ?? '', locked: m.checklistResponses?.c1?.selection ?? '' }));
const listRows = async (ctx, cols) => (await ctx.sheet()).rows.slice(1).filter((r) => r.some((v) => v != null && v !== ''))
  .map((r) => ({ name: r[cols.item] ?? '', note: r[cols.notes] ?? '', locked: r[cols.locked] ?? '' }));
const said = (ctx) => (ctx.link.state.notices || []).some((n) => /were inserted or deleted on their own/.test(n.message));

test('Notes shifted down one cell: every item keeps its note, the sheet is put back and the pushed-off note cleared', async () => {
  const { ctx, cols, shift } = await linked();
  await shift(['notes'], 2, 1);
  const r = await ctx.round({ force: true });
  assert.deepEqual(appState(ctx), want);
  assert.equal(r.summary.toApp, 0);
  assert.ok(said(ctx), 'the panel says why');
  assert.deepEqual(await listRows(ctx, cols), want, 'sheet back as it was, no leftover row under the list');
  assert.ok(!(ctx.link.state.problems || []).some((p) => /has no "Item"/.test(p.message)));
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.toSheet + quiet.summary.toApp + quiet.summary.created, 0, 'the next round is quiet');
});

test('Notes shifted up two cells: the deleted notes come back too', async () => {
  const { ctx, cols, shift } = await linked();
  await shift(['notes'], 2, -2);
  await ctx.round({ force: true });
  assert.deepEqual(appState(ctx), want);
  assert.deepEqual(await listRows(ctx, cols), want);
});

test('three cells inserted at once (fewer than four left on the list)', async () => {
  const { ctx, cols, shift } = await linked();
  await shift(['notes'], 2, 3);
  await ctx.round({ force: true });
  assert.deepEqual(appState(ctx), want);
  assert.deepEqual(await listRows(ctx, cols), want);
});

test('a row\'s visible cells shifted down (Row ID left out): no item renamed, no twin of the last item', async () => {
  const { ctx, cols, shift } = await linked();
  await shift(['item', 'locked', 'notes'], 2, 1);
  const r = await ctx.round({ force: true });
  assert.equal(r.summary.created, 0);
  assert.deepEqual(appState(ctx), want, 'the Y / N column joined the move');
  assert.deepEqual(await listRows(ctx, cols), want);
  await ctx.round({ force: true });
  assert.equal(Object.keys(ctx.markers).length, N);
});

test('a new item the PM typed in the gap comes in as a new item under the list', async () => {
  const { ctx, cols, shift } = await linked();
  await shift(['item', 'locked', 'notes'], 2, 1, [{ row: 2, col: cols.item, value: 'NEW-1' }, { row: 2, col: cols.notes, value: 'pm new' }]);
  await ctx.round({ force: true });
  assert.deepEqual(appState(ctx).slice(0, N), want, 'no item took the new name or note');
  await ctx.round({ force: true });
  const added = appState(ctx).slice(N);
  assert.deepEqual(added, [{ name: 'NEW-1', note: 'pm new', locked: '' }]);
  assert.deepEqual(await listRows(ctx, cols), [...want, ...added]);
  assert.ok((ctx.link.state.notices || []).some((n) => /moved the new row typed in the gap under the list/.test(n.message)));
});

test('a tech changes a note in the same round: the tech\'s note stays, the rest go back, no choice', async () => {
  const { ctx, cols, shift } = await linked();
  await shift(['notes'], 2, 1);
  ctx.markers.d6.note = { text: 'tech 6' };
  await ctx.round({ force: true });
  assert.deepEqual(appState(ctx), want.map((w) => (w.name === 'D-106' ? { ...w, note: 'tech 6' } : w)));
  assert.deepEqual(ctx.link.state.conflicts || {}, {});
  assert.deepEqual(await listRows(ctx, cols), want.map((w) => (w.name === 'D-106' ? { ...w, note: 'tech 6' } : w)));
});

test('real edits are not a shift: one note moved down, and a Y / N column flipped in a run', async () => {
  const { ctx, cols, first } = await linked();
  // A PM moves note 3 to the next item and clears its own (two cells).
  await ctx.edit([{ row: first + 2, col: cols.notes, value: '' }, { row: first + 3, col: cols.notes, value: 'note 3' }]);
  // and flips Y / N on the last five items (looks like a move by one).
  const flipped = { 3: 'N', 4: 'Y', 5: 'Y', 6: 'N', 7: 'Y' };
  await ctx.edit(Object.entries(flipped).map(([i, value]) => ({ row: first + Number(i), col: cols.locked, value })));
  await ctx.round({ force: true });
  const app = appState(ctx);
  assert.equal(app[2].note, '');
  assert.equal(app[3].note, 'note 3');
  for (const [i, v] of Object.entries(flipped)) assert.equal(app[i].locked, v, `${app[i].name} took the PM's ${v}`);
  assert.ok(!said(ctx));
});

// Sideways: "Shift cells left" on a few rows' Locked? cells slides Height,
// Entity and Notes one column left, so the note lands in Entity and Notes
// reads as cleared (real Excel 11-14: 3 notes wiped in the app).
const sideways = async (by) => {
  const markers = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, {
    checklistResponses: { c1: { selection: 'Y' }, c2: { selection: 80 + i } }, note: { text: `note ${i + 1}` },
  })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = await ctx.sheet();
  const from = sheet.rows[0].indexOf('Locked?');
  const width = sheet.rows[0].length;
  const edits = [];
  for (const id of ['d2', 'd3']) {
    const r = await ctx.rowOf(id);
    const row = sheet.rows[r];
    const tail = row.slice(from);
    const moved = by > 0 ? [...tail.slice(by), ...Array(by).fill('')] : [...Array(-by).fill(''), ...tail];
    moved.forEach((value, i) => edits.push({ row: r, col: from + i, value: value ?? '' }));
  }
  await ctx.edit(edits);
  await ctx.round({ force: true });
  return { ctx, width, from };
};
const kept = (ctx) => ['d1', 'd2', 'd3', 'd4'].map((id, i) => {
  const m = ctx.markers[id];
  return [m.note.text, m.checklistResponses.c1?.selection, String(m.checklistResponses.c2?.value ?? m.checklistResponses.c2?.selection), m.entityName || ''].join('|') === `note ${i + 1}|Y|${80 + i}|`;
});

test('cells deleted sideways in two rows: every note and answer stays, the sheet is put back', async () => {
  const { ctx } = await sideways(1);
  assert.deepEqual(kept(ctx), [true, true, true, true]);
  assert.ok((ctx.link.state.notices || []).some((n) => /deleted or inserted sideways/.test(n.message)));
  const sheet = await ctx.sheet();
  const h = sheet.rows[0];
  for (const id of ['d2', 'd3']) {
    const row = sheet.rows[await ctx.rowOf(id)];
    assert.equal(row[h.indexOf('Notes')], ctx.markers[id].note.text);
    assert.equal(row[h.indexOf('Entity')] ?? '', '');
  }
});

test('cells inserted sideways: values put back and nothing left past the last column', async () => {
  const { ctx, width } = await sideways(-1);
  assert.deepEqual(kept(ctx), [true, true, true, true]);
  const sheet = await ctx.sheet();
  for (const id of ['d2', 'd3']) assert.ok(!(sheet.rows[await ctx.rowOf(id)][width] ?? ''), 'the pushed-out note is gone from the unheaded column');
});

test('a PM editing two cells of one row is not a sideways move', async () => {
  const markers = { d1: door('d1', 'D-101', { checklistResponses: { c1: { selection: 'Y' } }, note: { text: 'note 1' } }) };
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const h = (await ctx.sheet()).rows[0];
  const r = await ctx.rowOf('d1');
  await ctx.edit([{ row: r, col: h.indexOf('Locked?'), value: 'N' }, { row: r, col: h.indexOf('Notes'), value: '' }]);
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d1.checklistResponses.c1.selection, 'N');
  assert.equal(ctx.markers.d1.note.text, '');
});

// Short lists and empty cells leave each column only a little evidence
// (random accidents, 11-14). Any notes, some empty:
const custom = async (notes, heights = []) => {
  const markers = Object.fromEntries(notes.map((note, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, {
    checklistResponses: heights[i] ? { c2: { selection: heights[i] } } : {}, note: { text: note },
  })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const head = (await ctx.sheet()).rows[0];
  const cols = { notes: head.indexOf('Notes'), height: head.indexOf('Height') };
  const first = await ctx.rowOf('d1');
  const shift = async (keys, at, by) => {
    const rows = (await ctx.sheet()).rows;
    const edits = [];
    for (const key of keys) {
      const vals = rows.slice(first, first + notes.length).map((r) => r[cols[key]] ?? '');
      const moved = by > 0 ? [...vals.slice(0, at), ...Array(by).fill(''), ...vals.slice(at)] : [...vals.slice(0, at), ...vals.slice(at - by), ...Array(-by).fill('')];
      moved.forEach((value, i) => edits.push({ row: first + i, col: cols[key], value }));
    }
    await ctx.edit(edits);
    await ctx.round({ force: true });
  };
  const got = () => notes.map((_, i) => ctx.markers[`d${i + 1}`].note?.text ?? '');
  const gotHeights = () => notes.map((_, i) => String(ctx.markers[`d${i + 1}`].checklistResponses?.c2?.selection ?? ''));
  return { ctx, cols, first, shift, got, gotHeights };
};

test('notes shifted up two near the end: two moved notes and two emptied cells are enough', async () => {
  const notes = ['n0', 'n1', 'n2', 'n3', 'n4', 'pear', 'peach', 'kiwi', 'fig'];
  const { ctx, shift, got } = await custom(notes);
  await shift(['notes'], 5, -2);
  assert.deepEqual(got(), notes);
  assert.ok(said(ctx));
});

test('Height and Notes shifted down two near the end: each column alone shows too little, both together are enough', async () => {
  const notes = ['n0', 'n1', 'n2', 'n3', 'n4', 'pear', 'peach', 'kiwi'];
  const heights = [80, 81, 82, 83, 84, 85, 86, 87];
  const { ctx, cols, first, shift, got, gotHeights } = await custom(notes, heights);
  await shift(['height', 'notes'], 5, 2);
  assert.deepEqual(got(), notes);
  assert.deepEqual(gotHeights(), heights.map(String));
  const rows = (await ctx.sheet()).rows;
  for (const r of [first + 8, first + 9]) assert.ok(!(rows[r]?.[cols.notes] ?? '') && !(rows[r]?.[cols.height] ?? ''), 'pushed-off values cleared');
});

test('cells inserted where the notes were already empty: the move starts at the gap, not at the first changed cell', async () => {
  const notes = ['lime', 'lemon', '', 'grape', 'kiwi', 'fig'];
  const { ctx, shift, got } = await custom(notes);
  await shift(['notes'], 2, 2);
  assert.deepEqual(got(), notes);
  assert.ok(said(ctx));
});

test('cells inserted sideways in a row with only a note: the note pushed past the last column comes back', async () => {
  const { ctx } = await custom(['n1', 'n2', 'n3', 'n4']);
  const sheet = await ctx.sheet();
  const h = sheet.rows[0];
  const r = await ctx.rowOf('d2');
  const from = h.indexOf('Locked?');
  const tail = sheet.rows[r].slice(from, h.length);
  await ctx.edit(['', ...tail].map((value, j) => ({ row: r, col: from + j, value: value ?? '' })));
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d2.note.text, 'n2');
  const row = (await ctx.sheet()).rows[r];
  assert.equal(row[h.indexOf('Notes')], 'n2');
  assert.ok(!(row[h.length] ?? ''), 'nothing left past the last column');
});

test('cells deleted sideways in a row with only a note: the note that slid into Entity goes back to Notes', async () => {
  const { ctx } = await custom(['n1', 'n2', 'n3', 'n4']);
  const sheet = await ctx.sheet();
  const h = sheet.rows[0];
  const r = await ctx.rowOf('d2');
  const from = h.indexOf('Locked?');
  const tail = sheet.rows[r].slice(from, h.length);
  await ctx.edit([...tail.slice(1), ''].map((value, j) => ({ row: r, col: from + j, value: value ?? '' })));
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d2.note.text, 'n2');
  assert.equal(ctx.markers.d2.entityName || '', '');
  const row = (await ctx.sheet()).rows[r];
  assert.deepEqual([row[h.indexOf('Entity')] ?? '', row[h.indexOf('Notes')]], ['', 'n2']);
});

test('a PM clearing a note and typing it one column over is not taken for a sideways move unless the row shows it', async () => {
  const { ctx } = await custom(['n1', 'n2', 'n3', 'n4']);
  const h = (await ctx.sheet()).rows[0];
  const r = await ctx.rowOf('d2');
  await ctx.edit([{ row: r, col: h.indexOf('Notes'), value: '' }]);
  await ctx.round({ force: true });
  assert.equal(ctx.markers.d2.note.text, '', 'a plain clear is a clear');
});

test('notes shifted up two among empty cells: three moved cells with three different notes are enough', async () => {
  const notes = ['plum', '', 'melon', '', 'fig', '', 'grape'];
  const { ctx, shift, got } = await custom(notes);
  await shift(['notes'], 2, -2);
  assert.deepEqual(got(), notes);
  assert.ok(said(ctx));
});

test('a PM flipping three Y / N cells in a pattern that looks like a shift up: still three edits', async () => {
  const yn = ['Y', 'Y', 'N', '', 'Y', '', 'N'];
  const markers = Object.fromEntries(yn.map((v, i) => [`d${i + 1}`, door(`d${i + 1}`, `D-${101 + i}`, { checklistResponses: v ? { c1: { selection: v } } : {}, note: { text: `n${i}` } })]));
  const ctx = await setup({ markers });
  await ctx.round(); await ctx.round({ force: true });
  const c = (await ctx.sheet()).rows[0].indexOf('Locked?');
  const first = await ctx.rowOf('d1');
  await ctx.edit([{ row: first + 2, col: c, value: 'Y' }, { row: first + 4, col: c, value: 'N' }, { row: first + 6, col: c, value: '' }]);
  await ctx.round({ force: true });
  assert.deepEqual(yn.map((_, i) => ctx.markers[`d${i + 1}`].checklistResponses?.c1?.selection ?? ''), ['Y', 'Y', 'Y', '', 'N', '', '']);
  assert.ok(!said(ctx));
});

test('Remove Duplicates on the visible columns (rows taken out at two places): every marker keeps its own row', async () => {
  // Real Excel 11-15 (Data > Remove Duplicates with the hidden Row ID column
  // left out): rows went at two places, the rest moved up under other Row
  // IDs, and six markers took the next markers' names and notes in the app.
  const names = ['D-101', 'D-102', 'D-103', 'D-103', 'D-105', 'D-106', 'D-106', 'D-108', 'D-109', 'D-110'];
  const notes = ['pear', 'apple', 'kiwi', 'kiwi', 'plum', 'date', 'date', 'banana', 'lemon', 'mango'];
  const ctx = await setup({ markers: Object.fromEntries(names.map((n, i) => [`d${i + 1}`, door(`d${i + 1}`, n, { note: { text: notes[i] } })])) });
  await ctx.round(); await ctx.round({ force: true });
  const sheet = await ctx.sheet();
  const width = sheet.rows[0].length;
  const seen = new Set(); const kept = [];
  for (const row of sheet.rows.slice(1, 11)) {
    const key = JSON.stringify(row.slice(1));
    if (!seen.has(key)) { seen.add(key); kept.push(row.slice(1)); }
  }
  while (kept.length < 10) kept.push(Array(width - 1).fill(''));
  await ctx.edit(kept.flatMap((cells, r) => cells.map((value, i) => ({ row: r + 1, col: i + 1, value }))));
  await ctx.round({ force: true });
  assert.deepEqual(Object.values(ctx.markers).map((m) => `${m.name}|${m.note.text}`), names.map((n, i) => `${n}|${notes[i]}`), 'no marker renamed or emptied');
  const after = await ctx.sheet();
  const item = after.rows[0].indexOf('Item'); const note = after.rows[0].indexOf('Notes');
  assert.deepEqual(after.rows.slice(1, 11).map((r) => `${r[item]}|${r[note]}`), names.map((n, i) => `${n}|${notes[i]}`), 'each row back with its marker');
  assert.ok((ctx.link.state.notices || []).some((n) => /taken out of only some columns/.test(n.message)));
  const quiet = await ctx.round({ force: true });
  assert.equal(quiet.summary.toSheet + quiet.summary.toApp, 0);
});
