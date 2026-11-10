// One live sync round for a linked spreadsheet: read the file, merge it with
// the markers (engine.js), write both sides, return what to save on the link.
// Everything outside is passed in (provider, marker store), so the edge
// function, node tests and a future scheduled job run the same code.
import { planSheetRound, appRecordOf, sameCell, SHEET_EDITOR_UNKNOWN } from './engine.js';
import { assertProvider } from './providers/contract.js';

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A hash of everything the sheet shows about the markers, to skip idle rounds. */
export async function appHashOf(layout, markers) {
  const rows = [];
  for (const [id, m] of Object.entries(markers || {})) {
    const scope = layout.scopes.find((s) => sameId(s.moduleId, m?.moduleId) && sameId(s.categoryId, m?.categoryId));
    if (scope) rows.push([id, scope.scopeId, appRecordOf(m, scope, layout)]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(stableStringify(rows));
}

// Survey writes to the sheet as the linker, so the file's "last changed by"
// shows the linker after every round that wrote. The linker counts only for a
// change at least this long after Survey's last write; nearer than that it may
// still be Survey's own write showing (Drive and OneDrive record changes a
// little late), and the edit is credited to "Sheet".
const OWN_WRITE_SETTLE_MS = 60_000;

function initialsOf(text) {
  const words = String(text || '').split(/[\s._-]+/).filter((w) => /[a-z0-9]/i.test(w));
  if (!words.length) return '';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * Changed By for what came in from the sheet this round: the initials of the
 * person who last changed the file, like the app's own Changed By, marked
 * "(sheet)", e.g. "JD (sheet)". "Sheet" when the provider cannot say, or when
 * the last change may be Survey's own write.
 * @param {{name?:string, email?:string, me?:boolean, at?:string|null}|null} editor
 * @param {{selfEmail?:string|null, lastWriteAt?:string|null}} [opts]
 */
export function sheetEditorLabel(editor, { selfEmail = null, lastWriteAt = null } = {}) {
  if (!editor) return SHEET_EDITOR_UNKNOWN;
  const email = String(editor.email || '').trim().toLowerCase();
  const self = editor.me === true || Boolean(email && selfEmail && email === String(selfEmail).trim().toLowerCase());
  if (self) {
    const at = Date.parse(editor.at || '');
    const wrote = Date.parse(lastWriteAt || '');
    if (!Number.isFinite(at) || !Number.isFinite(wrote) || at <= wrote + OWN_WRITE_SETTLE_MS) return SHEET_EDITOR_UNKNOWN;
  }
  const who = initialsOf(editor.name) || initialsOf(email.split('@')[0]);
  return who ? `${who} (sheet)` : SHEET_EDITOR_UNKNOWN;
}

/**
 * Markers of this sheet whose Changed By or Changed Date is blank (saved
 * before the app stamped them, owner 2026-11-03: "Changed By and Changed
 * Date didn't show") get the linker's initials and today, once, the way
 * Export data fills them. Returns the markers to write.
 */
export function fillBlankStamps(layout, markers, by, at) {
  if (!by) return {};
  const scopes = layout?.scopes || [];
  const inSheet = (m) => scopes.some((sc) => String(m?.moduleId ?? '') === String(sc.moduleId ?? '') && String(m?.categoryId ?? '') === String(sc.categoryId ?? ''));
  const out = {};
  for (const [id, m] of Object.entries(markers || {})) {
    if (!m || typeof m !== 'object' || !inSheet(m)) continue;
    const needBy = !String(m.changedBy ?? '').trim();
    const needAt = !String(m.changedDate ?? '').trim();
    if (!needBy && !needAt) continue;
    out[id] = { ...m, ...(needBy ? { changedBy: by } : {}), ...(needAt ? { changedDate: at } : {}) };
  }
  return out;
}

export { initialsOf };

const hasWork = (plan) => plan.cellWrites.length || plan.appends.length || plan.deletes.length || plan.headerAdds.length;

/**
 * @param {object} args
 * @param {{file_id:string, layout:object, baseline?:object, state?:object, remote_version?:string|null, app_hash?:string|null}} args.link
 * @param {object} args.provider   see providers/contract.js
 * @param {() => Promise<object>} args.loadMarkers   live markers by id
 * @param {(writes: Object<string, object>) => Promise<void>} args.saveMarkers
 *        save new and changed markers (merging with whatever else changed)
 * @param {{keyId:string, secret:string, signingDocId:string}} args.signing
 * @param {boolean} [args.force]   run even when neither side looks changed
 * @returns {Promise<{status:'idle'|'synced'|'retry', summary?:object, patch?:object}>}
 *   `patch` is what to store on the link (baseline, state, remote_version, app_hash).
 */
const isBlankValue = (v) => v == null || (typeof v !== 'object' && String(v).trim() === '');

/** Scopes whose tab titles clash with `taken` (any case) get " (2)", " (3)"... */
export function namedApart(scopes, taken) {
  const used = new Set((taken || []).map((t) => String(t).toLowerCase()));
  return scopes.map((scope) => {
    let title = scope.title;
    for (let n = 2; used.has(title.toLowerCase()); n += 1) title = `${scope.title.slice(0, 95)} (${n})`;
    used.add(title.toLowerCase());
    return title === scope.title ? scope : { ...scope, title };
  });
}

/** Blanked answers in one round from which they are held (see planSheetRound). */
export const BIG_ERASE = 10;

// Rows moved (a PM sort or row insert) between the round's check and its
// writes, so some values may sit on other items' rows. Read the written tabs
// again and, by Row ID, put each written value on its own item, and put back
// what was there before (from the round's starting read) on the item each
// misplaced value landed on (`landed`: the Row ID read back at each written
// row right after the write). Only those cells are touched, so a person's
// edit on any other item is left as it is. A few tries, in case the rows
// move again.
export async function putMovedWritesRight({ provider, fileId, grid, writes, idChecks, landed = new Map(), tries = 3 }) {
  const byId = (rows, col) => {
    const m = new Map();
    rows.forEach((r, i) => { const t = String(r?.[col] ?? '').trim(); if (t && i > 0 && !m.has(t)) m.set(t, i); });
    return m;
  };
  const sheets = new Map();
  for (const c of idChecks) if (!sheets.has(String(c.sheetId))) sheets.set(String(c.sheetId), { col: c.col, title: c.title });
  for (let attempt = 0; attempt < tries; attempt++) {
    const now = await provider.readGrid(fileId, { sheetIds: [...sheets.keys()] });
    const fixes = []; const fixIds = [];
    for (const [sheetId, { col: idCol, title }] of sheets) {
      const before = grid.sheets.find((s) => sameId(s.sheetId, sheetId))?.rows || [];
      const after = now.sheets.find((s) => sameId(s.sheetId, sheetId))?.rows || [];
      // A moved or renamed column: the cells can't be matched up safely.
      const ours = writes.filter((w) => sameId(w.sheetId, sheetId) && !w.header && w.row > 0 && w.col !== idCol);
      if (ours.some((w) => !sameCell(after[0]?.[w.col], before[0]?.[w.col]))) continue;
      const beforeRow = byId(before, idCol); const afterRow = byId(after, idCol);
      const want = new Map();
      const tokenAt = (rows, r) => String(rows[r]?.[idCol] ?? '').trim();
      for (const w of ours) {
        const t = tokenAt(before, w.row);
        if (t) want.set(`${t}|${w.col}`, { t, col: w.col, value: w.value });
      }
      for (const w of ours) {
        const hit = String(landed.get(`${sheetId}|${w.row}`) ?? '').trim();
        if (!hit || hit === tokenAt(before, w.row) || want.has(`${hit}|${w.col}`) || !beforeRow.has(hit)) continue;
        // Our value landed on this item: put back its own, if ours is still there.
        const r = afterRow.get(hit);
        if (r != null && sameCell(after[r]?.[w.col], w.value)) want.set(`${hit}|${w.col}`, { t: hit, col: w.col, value: before[beforeRow.get(hit)]?.[w.col] ?? '' });
      }
      for (const { t, col, value } of want.values()) {
        const r = afterRow.get(t);
        if (r == null || sameCell(after[r]?.[col], value)) continue;
        fixes.push({ sheetId, title, row: r, col, value });
        fixIds.push({ sheetId, title, row: r, col: idCol, token: t });
      }
    }
    if (!fixes.length) return { fixed: 0 };
    await provider.writeCells(fileId, fixes);
    const ids = await provider.readCells(fileId, fixIds);
    if (fixIds.every((c, i) => String(ids[i] ?? '').trim() === c.token)) return { fixed: fixes.length };
  }
  return { fixed: -1 };
}

// Rows moved while this round wrote Row IDs. Each Row ID belongs on the row
// whose Item it was written for: put it there, and put back the Row ID a
// moved row had at the start of the round where one of ours landed on it.
// Columns are found again by their headings (a title row above them, or a
// column moved meanwhile, is fine). Only names that appear once are trusted;
// anything else waits for the next round's fresh read. Where two fixes meet
// on one cell, a Row ID put on its own item wins over a put-back.
const headKey = (v) => String(v ?? '').trim().toLowerCase();
export async function putMovedRowIdsRight({ provider, fileId, grid, idWrites }) {
  const sheetIds = [...new Set(idWrites.map((w) => String(w.sheetId)))];
  const now = await provider.readGrid(fileId, { sheetIds });
  const fixes = [];
  for (const sheetId of sheetIds) {
    const mine = idWrites.filter((x) => sameId(x.sheetId, sheetId) && x.itemCol >= 0);
    if (!mine.length) continue;
    const before = grid.sheets.find((s) => sameId(s.sheetId, sheetId))?.rows || [];
    const after = now.sheets.find((s) => sameId(s.sheetId, sheetId))?.rows || [];
    const headBefore = mine[0].headerRow ?? 0;
    const itemHead = headKey(before[headBefore]?.[mine[0].itemCol]);
    const idHead = headKey(before[headBefore]?.[mine[0].col]);
    if (!itemHead || !idHead) continue;
    // The heading row and columns as they are now; unsure means wait.
    const colIn = (row, want) => {
      const at = (row || []).map(headKey).flatMap((h, i) => (h === want ? [i] : []));
      return at.length === 1 ? at[0] : -1;
    };
    let headAfter = -1;
    for (let r = 0; r < Math.min(after.length, 10) && headAfter < 0; r += 1) {
      if (colIn(after[r], itemHead) >= 0 && colIn(after[r], idHead) >= 0) headAfter = r;
    }
    if (headAfter < 0) continue;
    const itemBefore = mine[0].itemCol; const idBefore = mine[0].col;
    const itemAfter = colIn(after[headAfter], itemHead); const idAfter = colIn(after[headAfter], idHead);
    const once = (rows, head, item) => {
      const seen = new Map();
      rows.forEach((r, i) => { const n = String(r?.[item] ?? '').trim(); if (i > head && n) seen.set(n, seen.has(n) ? -1 : i); });
      return seen;
    };
    const beforeAt = once(before, headBefore, itemBefore); const afterAt = once(after, headAfter, itemAfter);
    const title = mine[0].title;
    const places = new Map();
    const restores = new Map();
    for (const w of mine) {
      const token = String(w.value ?? '').trim();
      const target = afterAt.get(w.rowIdFor);
      after.forEach((r, i) => {
        if (i <= headAfter || i === target || String(r?.[idAfter] ?? '').trim() !== token) return;
        const was = beforeAt.get(String(r?.[itemAfter] ?? '').trim());
        if (was > 0) restores.set(i, { sheetId, title, row: i, col: idAfter, value: before[was]?.[idBefore] ?? '' });
      });
      if (target > 0 && String(after[target]?.[idAfter] ?? '').trim() !== token) {
        places.set(target, { sheetId, title, row: target, col: idAfter, value: w.value });
      }
    }
    for (const row of places.keys()) restores.delete(row);
    fixes.push(...restores.values(), ...places.values());
  }
  if (fixes.length) await provider.writeCells(fileId, fixes);
  return { fixed: fixes.length };
}

export async function runSheetRound({ link, provider, loadMarkers, saveMarkers, signing, force = false, now = new Date(), newMarkerId, fillBy = '' }) {
  assertProvider(provider);
  const layout = link.layout;
  const version = await provider.getVersion(link.file_id);
  const loaded = (await loadMarkers()) || {};
  const fills = fillBlankStamps(layout, loaded, fillBy, now.toISOString());
  const markers = Object.keys(fills).length ? { ...loaded, ...fills } : loaded;
  const appHash = await appHashOf(layout, markers);
  const state = { ...(link.state || {}) };
  const pendingChoices = Object.keys(state.choices || {}).length > 0;
  const newScopes = layout.scopes.filter((s) => state.sheetIds?.[s.scopeId] == null);
  if (!force && !pendingChoices && !newScopes.length && version && version === link.remote_version && appHash === link.app_hash) {
    return { status: 'idle' };
  }

  // The grid reads fine, so a write refused after it is a protected tab,
  // range or workbook (Excel: Review > Protect; Sheets: protected range), not
  // a lost share. Nothing is saved, so every change waits for the next round.
  const protectedOnRefusal = (err) => {
    if (Number(err?.status) === 403) err.code = 'protected';
    throw err;
  };
  // Only the synced tabs, unless one has to be added (then every title counts).
  const grid = await provider.readGrid(link.file_id, newScopes.length ? {} : { sheetIds: Object.values(state.sheetIds || {}) });
  if (newScopes.length) {
    // Categories added to the template since the file was made (or a tab put
    // back) get a tab, named apart from the tabs already there: a clash makes
    // the provider refuse the whole call, round after round.
    const named = namedApart(newScopes, grid.sheets.map((s) => s.title));
    const added = await provider.addTabs(link.file_id, named, layout).catch(protectedOnRefusal);
    state.sheetIds = { ...(state.sheetIds || {}), ...added };
    for (const scope of named) {
      if (added[scope.scopeId] == null) continue;
      grid.sheets.push({ sheetId: String(added[scope.scopeId]), title: scope.title, rows: [scope.columns.map((c) => c.header)] });
    }
  }

  const sheetEditor = sheetEditorLabel(provider.lastEditor?.(link.file_id) ?? null, {
    selfEmail: provider.accountEmail ?? null, lastWriteAt: state.lastWriteAt ?? null,
  });
  const planArgs = {
    layout, grid, markers, baseline: link.baseline || {}, state, signing, now, sheetEditor,
    ...(newMarkerId ? { newMarkerId } : {}),
  };
  let plan = await planSheetRound(planArgs);
  // Many filled answers blanked in the sheet at once: planned again with them
  // held, so an older copy restored from version history (or a column cleared
  // by mistake) can't wipe field work before an editor has looked.
  if (plan.erasing >= BIG_ERASE && !state.eraseChoice && !state.heldErase) {
    plan = await planSheetRound({ ...planArgs, holdErase: true });
  }

  let wroteAt = state.lastWriteAt ?? null;
  let retry = false;
  async function writePlan() {
    // A sort or row insert in the sheet since the read would move rows under
    // us, and a person typing would have their cell overwritten: check every
    // Row ID we write next to is still where it was, and every cell we write
    // still holds what the plan was made from. Anything moved: plan again.
    const checks = [...plan.verify, ...plan.deletes.map((d) => ({ ...d, col: d.rowIdCol }))];
    if (checks.length) {
      const now2 = await provider.readCells(link.file_id, checks);
      const moved = checks.some((c, i) => ('expect' in c
        ? !sameCell(now2[i], c.expect)
        : String(now2[i] ?? '').trim() !== String(c.token ?? '').trim()));
      if (moved) { retry = true; return; }
    }
    const headerWrites = plan.headerAdds.map((h) => ({ sheetId: h.sheetId, title: h.title, row: h.row ?? 0, col: h.col, value: h.header, header: true }));
    // Row IDs go out last, after the values are known to have landed: a Row
    // ID on the wrong row would hand one item's row to another.
    const idWrites = plan.cellWrites.filter((w) => 'rowIdFor' in w);
    const dataWrites = plan.cellWrites.filter((w) => !('rowIdFor' in w));
    if (headerWrites.length || dataWrites.length) await provider.writeCells(link.file_id, [...headerWrites, ...dataWrites]);
    // A write Excel accepts but does not keep (the hidden part of merged
    // cells reads blank after): remembered, or the next round reads the blank
    // as the PM clearing the cell and wipes the app's value. The Row IDs next
    // to the writes are read again in the same call: a sort that landed
    // between the check above and the write put values on other items' rows.
    const filled = dataWrites.filter((c) => c.markerId && !isBlankValue(c.value));
    // (A Row ID cell this round writes itself, a copied row getting its own,
    // isn't a moved row.)
    const ownIds = new Set(idWrites.map((w) => `${w.sheetId}|${w.row}|${w.col}`));
    const idChecks = plan.cellWrites.length ? plan.verify.filter((c) => 'token' in c && !ownIds.has(`${c.sheetId}|${c.row}|${c.col}`)) : [];
    const offAt = (vals, from = 0) => idChecks.some((c, i) => String(vals[from + i] ?? '').trim() !== String(c.token ?? '').trim());
    // Rows moved: everything still to go (new rows, deletes, Row IDs) is by
    // row number, so put the values right and plan again from a fresh read.
    // A Row ID already written for an item this round doesn't save is made
    // into that item next round (engine: "recreate").
    if (filled.length || idChecks.length) {
      const back = await provider.readCells(link.file_id, [...filled, ...idChecks]);
      if (offAt(back, filled.length)) {
        const landed = new Map(idChecks.map((c, i) => [`${c.sheetId}|${c.row}`, back[filled.length + i]]));
        await putMovedWritesRight({ provider, fileId: link.file_id, grid, writes: dataWrites, idChecks, landed });
        retry = true; return;
      }
      filled.forEach((c, i) => {
        if (isBlankValue(back[i])) plan.state.stuck = { ...(plan.state.stuck || {}), [`${c.markerId}|${c.key}`]: true };
      });
    }
    if (idWrites.length) {
      await provider.writeCells(link.file_id, idWrites);
      const now3 = await provider.readCells(link.file_id, [...idChecks, ...idWrites]);
      if (offAt(now3) || idWrites.some((w, i) => String(now3[idChecks.length + i] ?? '').trim() !== String(w.value ?? '').trim())) {
        await putMovedRowIdsRight({ provider, fileId: link.file_id, grid, idWrites });
        retry = true; return;
      }
    }
    if (plan.appends.length) await provider.appendRows(link.file_id, plan.appends);
    if (plan.deletes.length) {
      // Checked once more right before: a sort now would delete another
      // item's row.
      const dels = plan.deletes.map((d) => ({ ...d, col: d.rowIdCol }));
      const now4 = await provider.readCells(link.file_id, dels);
      if (dels.some((d, i) => String(now4[i] ?? '').trim() !== String(d.token ?? '').trim())) { retry = true; return; }
      const sorted = [...plan.deletes].sort((a, b) => (sameId(a.sheetId, b.sheetId) ? b.row - a.row : String(a.sheetId).localeCompare(String(b.sheetId))));
      await provider.deleteRows(link.file_id, sorted);
    }
    wroteAt = new Date().toISOString();
  }
  if (hasWork(plan)) await writePlan().catch(protectedOnRefusal);
  if (retry) return { status: 'retry' };
  const writes = { ...fills, ...plan.markerWrites };
  if (Object.keys(writes).length) await saveMarkers(writes);

  const after = { ...markers, ...plan.markerWrites };
  return {
    status: 'synced',
    summary: plan.summary,
    patch: {
      baseline: plan.baseline,
      // The engine rebuilds its own keys; where the file was saved (the
      // "Save in" folder) is the link's and rides along.
      state: {
        ...(typeof link.state?.folder === 'string' ? { folder: link.state.folder } : {}),
        ...(typeof link.state?.folderLabel === 'string' ? { folderLabel: link.state.folderLabel } : {}),
        ...plan.state,
        ...(wroteAt ? { lastWriteAt: wroteAt } : {}),
      },
      // The version read BEFORE the grid: if the sheet changed during the
      // round (including our own writes), the next round reads it again.
      remote_version: version,
      app_hash: await appHashOf(layout, after),
    },
  };
}
