// One live sync round for a linked spreadsheet: read the file, merge it with
// the markers (engine.js), write both sides, return what to save on the link.
// Everything outside is passed in (provider, marker store), so the edge
// function, node tests and a future scheduled job run the same code.
import { planSheetRound, appRecordOf, sameCell, SHEET_EDITOR_UNKNOWN, NOTICE_MS } from './engine.js';
import { assertProvider } from './providers/contract.js';
import { applyClashes } from './concurrent.js';

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

// Excel on the web shows a person "Can't Save Your Changes" (and makes them
// reload) when any outside write lands while their typing is not saved yet.
// Real Excel on the web, 11-13: a PM typing for 12 minutes with no writes
// was never refused; with a write every 4 s, 6 to 11 times in 6 minutes, and
// still 3 to 4 times with one every 30 s. How the writes are sent (one Graph
// session, a new one each time, or none) made no difference. Holding the
// writes while the PM's edits keep arriving cut it from about 8 to 2.
// So while the synced tabs keep changing under someone else's hand, a round
// that would write waits: nothing is written or saved, and the next round
// plans again from the sheet as it is then. It goes ahead once the tabs have
// been still for SHEET_BUSY_QUIET_MS, or after SHEET_BUSY_MAX_MS at most.
// The wait outlives the write that ends it: Excel saves typing up to a
// minute after the keys, so tabs that look still are no proof the PM has
// stopped (20-minute soak, 11-13: the writes right after a wait, with
// nothing held, met the PM's next new rows and caused the refusals left).
// Until SHEET_ACTIVE_MS after the last change seen, each write is followed
// by a fresh quiet time before the next one.
export const SHEET_BUSY_QUIET_MS = 45_000;
export const SHEET_BUSY_MAX_MS = 180_000;
export const SHEET_ACTIVE_MS = 120_000;

// Rows moved (a PM sort or row insert) between the round's check and its
// writes, so some values may sit on other items' rows. Read the written tabs
// again and, by Row ID, put each written value on its own item, and put back
// what was there before (from the round's starting read) on the item each
// misplaced value landed on (`landed`: the Row ID read back at each written
// row right after the write). Only those cells are touched, so a person's
// edit on any other item is left as it is. A few tries, in case the rows
// move again.
export async function putMovedWritesRight({ provider, fileId, grid, writes, idChecks, landed = new Map(), headers = [], tries = 3 }) {
  const byId = (rows, col) => {
    const m = new Map();
    rows.forEach((r, i) => { const t = String(r?.[col] ?? '').trim(); if (t && i > 0 && !m.has(t)) m.set(t, i); });
    return m;
  };
  const sheets = new Map();
  for (const c of idChecks) if (!sheets.has(String(c.sheetId))) sheets.set(String(c.sheetId), { col: c.col, title: c.title });
  // No tab to look at (an empty list would read every tab in the workbook).
  if (!sheets.size) return { fixed: 0 };
  for (let attempt = 0; attempt < tries; attempt++) {
    const now = await provider.readGrid(fileId, { sheetIds: [...sheets.keys()] });
    const fixes = []; const fixIds = [];
    for (const [sheetId, { col: idCol, title }] of sheets) {
      const before = grid.sheets.find((s) => sameId(s.sheetId, sheetId))?.rows || [];
      const after = now.sheets.find((s) => sameId(s.sheetId, sheetId))?.rows || [];
      // A moved or renamed column: the cells can't be matched up safely.
      const ours = writes.filter((w) => sameId(w.sheetId, sheetId) && !w.header && w.row > (w.headerRow ?? 0) && w.col !== idCol);
      // (A heading this round wrote itself, a new or renamed column, is expected.)
      const headAt = (w) => {
        const own = headers.find((h) => sameId(h.sheetId, sheetId) && h.row === (w.headerRow ?? 0) && h.col === w.col);
        return own ? own.value : before[w.headerRow ?? 0]?.[w.col];
      };
      if (ours.some((w) => !sameCell(after[w.headerRow ?? 0]?.[w.col], headAt(w)))) continue;
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

/**
 * `clashes()` (optional, read after loadMarkers): app edits made without
 * seeing a value an earlier round brought in (see concurrent.js); `pulls()`
 * (optional, read after saveMarkers): the writes to keep watching, saved on
 * the link as state.pulls.
 */
export async function runSheetRound({ link, provider, loadMarkers, saveMarkers, signing, force = false, now = new Date(), newMarkerId, fillBy = '', clashes: clashesOf = null, pulls: pullsOf = null, hold = false }) {
  assertProvider(provider);
  const layout = link.layout;
  const version = await provider.getVersion(link.file_id);
  const loaded = (await loadMarkers()) || {};
  const clashes = clashesOf?.() || {};
  const fills = fillBlankStamps(layout, loaded, fillBy, now.toISOString());
  const stamped = Object.keys(fills).length ? { ...loaded, ...fills } : loaded;
  // A blind edit Yjs dropped is put back as the app's side, and its cells
  // compare against the value from before the sheet's change.
  const { markers, baseline: roundBaseline } = applyClashes(stamped, link.baseline || {}, clashes);
  const appHash = await appHashOf(layout, markers);
  const state = { ...(link.state || {}) };
  const pendingChoices = Object.keys(state.choices || {}).length > 0;
  const newScopes = layout.scopes.filter((s) => state.sheetIds?.[s.scopeId] == null);
  // A notice past its time (engine NOTICE_MS) is only dropped by a planned
  // round, so a quiet link runs one to clear it from the panel.
  const noticeDue = (Array.isArray(state.notices) ? state.notices : []).some((n) => now.getTime() - Number(n?.t) >= NOTICE_MS);
  if (!force && !noticeDue && !Object.keys(clashes).length && !pendingChoices && !newScopes.length && version && version === link.remote_version && appHash === link.app_hash) {
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
  let grid = await provider.readGrid(link.file_id, newScopes.length ? {} : { sheetIds: Object.values(state.sheetIds || {}) });
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
  // Synced tabs the PM protected (Review > Protect Sheet) are left out of
  // the round, so the other tabs keep syncing both ways (real Excel 11-10:
  // one locked tab stopped the whole workbook). Tabs locked last round are
  // asked about first, so a still-locked tab costs no refused write.
  const sheetIdOf = (scopeId) => state.sheetIds?.[scopeId];
  let locked = [];
  if (state.lockedTabs?.length && provider.lockedTabs) {
    locked = await provider.lockedTabs(link.file_id, state.lockedTabs.map(sheetIdOf).filter((id) => id != null));
  }
  let plan;
  const makePlan = async () => {
    const planArgs = {
      layout, grid, markers, baseline: roundBaseline, state, signing, now, sheetEditor,
      lateSaves: provider.savesLate === true,
      lockedTabs: locked,
      ...(newMarkerId ? { newMarkerId } : {}),
    };
    plan = await planSheetRound(planArgs);
    // Many filled answers blanked in the sheet at once: planned again with them
    // held, so an older copy restored from version history (or a column cleared
    // by mistake) can't wipe field work before an editor has looked.
    if (plan.erasing >= BIG_ERASE && !state.eraseChoice && !state.heldErase) {
      plan = await planSheetRound({ ...planArgs, holdErase: true });
    }
  };
  await makePlan();

  // Someone editing the synced tabs (see SHEET_BUSY_QUIET_MS): wait. Their
  // edits are seen when they land (Excel saves them seconds to a minute
  // after the keys), so the tabs as read are compared round to round.
  // sheetBusy: tabs = hash as last read (null right after our own write, so
  // that write is not taken for someone's edit); at = start of the quiet
  // time; seen = last change by someone else; since = first held round.
  let busyNext = null;
  let holdTabs = null;
  if (hold && provider.savesLate === true) {
    const busy = state.sheetBusy && typeof state.sheetBusy === 'object' ? state.sheetBusy : null;
    const tabs = await sha256Hex(stableStringify(grid.sheets.map((s) => [String(s.sheetId), s.rows || []])));
    // Held rounds save nothing, so a pull repeats until a round goes ahead:
    // it only starts a wait.
    const pulled = Number(plan.summary?.toApp || 0) + Number(plan.summary?.created || 0) > 0;
    const t = now.getTime();
    // The tabs as last read with no wait under way: a change there by
    // someone else starts one even before it is a whole edit to bring in (a
    // PM's half-typed new row; real Excel 11-13: the first refusals of a
    // soak came while Survey had seen nothing yet).
    const lastTabs = typeof state.sheetTabs === 'string' ? state.sheetTabs : null;
    let next = busy;
    if (!busy) { if (pulled || (lastTabs && lastTabs !== tabs)) next = { tabs, at: t, seen: t }; }
    else if (busy.tabs == null) next = { ...busy, tabs };
    else if (busy.tabs !== tabs) next = { ...busy, tabs, at: t, seen: t };
    if (next && !(t - Number(next.seen) < SHEET_ACTIVE_MS)) next = null;
    if (next && hasWork(plan) && t - Number(next.at) < SHEET_BUSY_QUIET_MS && t - Number(next.since ?? t) < SHEET_BUSY_MAX_MS) {
      // The sheet's edits to items the app has still come in at once, so the
      // field sees the PM's changes while the app's own wait. Only updates:
      // a new row's item waits with the Row ID it gets written. Nothing else
      // is saved, so the next round reads the same cells as changed on both
      // sides to the same value, which is no clash.
      // Their fields' baseline moves on with them, so a later edit of the
      // same cell in the sheet is a plain edit, not a clash with itself.
      const early = Object.fromEntries(Object.entries(plan.markerWrites).filter(([id, m]) => m && markers[id] && plan.pullBaseline[id]));
      const ids = Object.keys(early);
      const heldState = { ...(link.state || {}), sheetBusy: { ...next, since: next.since ?? t } };
      if (!ids.length) return { status: 'held', state: heldState };
      await saveMarkers(early);
      const pulls = pullsOf?.();
      return {
        status: 'held',
        state: { ...heldState, ...(pulls && Object.keys(pulls).length ? { pulls } : {}) },
        baseline: { ...(link.baseline || {}), ...Object.fromEntries(ids.map((id) => [id, plan.pullBaseline[id]])) },
        summary: { toApp: ids.length },
      };
    }
    busyNext = next;
    holdTabs = tabs;
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
    // The Row ID at every row a value went to, read back too: it says which
    // item each value landed on, also on rows with no Row ID check (a row
    // from the sheet getting its own Row ID, or one whose Row ID was typed
    // over).
    const idColOf = new Map(plan.verify.filter((c) => 'token' in c).map((c) => [String(c.sheetId), c.col]));
    const landedCells = [...new Map(dataWrites.filter((w) => idColOf.has(String(w.sheetId)) && w.row > 0)
      .map((w) => [`${w.sheetId}|${w.row}`, { sheetId: w.sheetId, title: w.title, row: w.row, col: idColOf.get(String(w.sheetId)) }])).values()];
    const tokenBefore = (c) => String(grid.sheets.find((sh) => sameId(sh.sheetId, c.sheetId))?.rows?.[c.row]?.[c.col] ?? '').trim();
    // Rows moved: everything still to go (new rows, deletes, Row IDs) is by
    // row number, so put the values right and plan again from a fresh read.
    // A Row ID already written for an item this round doesn't save is made
    // into that item next round (engine: "recreate").
    if (filled.length || idChecks.length || landedCells.length) {
      const back = await provider.readCells(link.file_id, [...filled, ...idChecks, ...landedCells]);
      const at = filled.length + idChecks.length;
      if (offAt(back, filled.length) || landedCells.some((c, i) => String(back[at + i] ?? '').trim() !== tokenBefore(c))) {
        const landed = new Map(landedCells.map((c, i) => [`${c.sheetId}|${c.row}`, back[at + i]]));
        await putMovedWritesRight({ provider, fileId: link.file_id, grid, writes: dataWrites, idChecks: landedCells, landed, headers: headerWrites });
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
  if (hasWork(plan)) {
    await writePlan().catch(async (err) => {
      // Refused: if a synced tab is newly protected, read again (some writes
      // may have landed) and plan once more without it.
      if (Number(err?.status) !== 403 || !provider.lockedTabs) return protectedOnRefusal(err);
      const now5 = await provider.lockedTabs(link.file_id, Object.values(state.sheetIds || {})).catch(() => []);
      if (!now5.some((id) => !locked.map(String).includes(String(id)))) return protectedOnRefusal(err);
      locked = now5;
      grid = await provider.readGrid(link.file_id, { sheetIds: Object.values(state.sheetIds || {}) });
      await makePlan();
      if (hasWork(plan)) await writePlan().catch(protectedOnRefusal);
    });
  }
  if (retry) return { status: 'retry' };
  const writes = { ...fills, ...plan.markerWrites };
  // A blind edit put back above and not otherwise written: written, so the
  // survey shows what the sheet now gets.
  for (const id of Object.keys(clashes)) {
    if (!writes[id] && markers[id] !== stamped[id] && markers[id]) writes[id] = markers[id];
  }
  // Deleted in the app right after the sheet changed it: the row stays (the
  // engine keeps a changed row), and says why.
  for (const [id, c] of Object.entries(clashes)) {
    if (!c.deleted || !plan.state.tombstones?.[id]) continue;
    const p = { markerId: id, scopeId: c.scopeId, message: `"${c.name || 'An item'}" was deleted in Survey just after its row was changed in the sheet, so the row was kept. Delete the row if it should go.` };
    plan.state.problems = [p, ...(plan.state.problems || [])].slice(0, 200);
    // Once only, so it stays a while (engine NOTICE_MS) instead of one round.
    // In place of the engine's plainer note for the same kept row.
    const plainer = (n) => n.markerId === id && /was deleted in Survey, but its row was kept/.test(n.message);
    plan.state.problems = plan.state.problems.filter((n) => !plainer(n));
    plan.state.notices = [{ ...p, t: now.getTime() }, ...(plan.state.notices || []).filter((n) => n.message !== p.message && !plainer(n))].slice(0, 20);
  }
  if (Object.keys(writes).length) await saveMarkers(writes);
  const pulls = pullsOf?.();

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
        ...(pulls && Object.keys(pulls).length ? { pulls } : {}),
        // Someone still editing: our write starts a fresh quiet time.
        ...(busyNext ? { sheetBusy: hasWork(plan) ? { tabs: null, at: now.getTime(), seen: busyNext.seen } : busyNext } : {}),
        // No wait: the tabs as read, or unknown after our own write.
        ...(holdTabs && !busyNext ? { sheetTabs: hasWork(plan) ? null : holdTabs } : {}),
      },
      // The version read BEFORE the grid: if the sheet changed during the
      // round (including our own writes), the next round reads it again.
      remote_version: version,
      // (Unprotecting a tab changes the file's content tag, real Graph
      // 11-10, so a locked tab's waiting changes go in on the next round.)
      app_hash: await appHashOf(layout, after),
    },
  };
}
