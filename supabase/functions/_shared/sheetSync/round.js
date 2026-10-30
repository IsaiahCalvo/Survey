// One live sync round for a linked spreadsheet: read the file, merge it with
// the markers (engine.js), write both sides, return what to save on the link.
// Everything outside is passed in (provider, marker store), so the edge
// function, node tests and a future scheduled job run the same code.
import { planSheetRound, appRecordOf, sameCell } from './engine.js';
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
    if (scope) rows.push([id, scope.scopeId, appRecordOf(m, scope)]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(stableStringify(rows));
}

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
export async function runSheetRound({ link, provider, loadMarkers, saveMarkers, signing, force = false, now = new Date(), newMarkerId }) {
  assertProvider(provider);
  const layout = link.layout;
  const version = await provider.getVersion(link.file_id);
  const markers = (await loadMarkers()) || {};
  const appHash = await appHashOf(layout, markers);
  const state = { ...(link.state || {}) };
  const pendingChoices = Object.keys(state.choices || {}).length > 0;
  const newScopes = layout.scopes.filter((s) => state.sheetIds?.[s.scopeId] == null);
  if (!force && !pendingChoices && !newScopes.length && version && version === link.remote_version && appHash === link.app_hash) {
    return { status: 'idle' };
  }

  // Only the synced tabs, unless one has to be added (then every title counts).
  const grid = await provider.readGrid(link.file_id, newScopes.length ? {} : { sheetIds: Object.values(state.sheetIds || {}) });
  if (newScopes.length) {
    // Categories added to the template since the file was made (or a tab put
    // back) get a tab, named apart from the tabs already there: a clash makes
    // the provider refuse the whole call, round after round.
    const used = new Set(grid.sheets.map((s) => String(s.title).toLowerCase()));
    const named = newScopes.map((scope) => {
      let title = scope.title;
      for (let n = 2; used.has(title.toLowerCase()); n += 1) title = `${scope.title.slice(0, 95)} (${n})`;
      used.add(title.toLowerCase());
      return title === scope.title ? scope : { ...scope, title };
    });
    const added = await provider.addTabs(link.file_id, named, layout);
    state.sheetIds = { ...(state.sheetIds || {}), ...added };
    for (const scope of named) {
      if (added[scope.scopeId] == null) continue;
      grid.sheets.push({ sheetId: String(added[scope.scopeId]), title: scope.title, rows: [scope.columns.map((c) => c.header)] });
    }
  }

  const plan = await planSheetRound({
    layout, grid, markers, baseline: link.baseline || {}, state, signing, now,
    ...(newMarkerId ? { newMarkerId } : {}),
  });

  if (hasWork(plan)) {
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
      if (moved) return { status: 'retry' };
    }
    const headerWrites = plan.headerAdds.map((h) => ({ sheetId: h.sheetId, title: h.title, row: h.row ?? 0, col: h.col, value: h.header, header: true }));
    if (headerWrites.length || plan.cellWrites.length) await provider.writeCells(link.file_id, [...headerWrites, ...plan.cellWrites]);
    if (plan.appends.length) await provider.appendRows(link.file_id, plan.appends);
    if (plan.deletes.length) {
      const sorted = [...plan.deletes].sort((a, b) => (sameId(a.sheetId, b.sheetId) ? b.row - a.row : String(a.sheetId).localeCompare(String(b.sheetId))));
      await provider.deleteRows(link.file_id, sorted);
    }
  }
  if (Object.keys(plan.markerWrites).length) await saveMarkers(plan.markerWrites);

  const after = { ...markers, ...plan.markerWrites };
  return {
    status: 'synced',
    summary: plan.summary,
    patch: {
      baseline: plan.baseline,
      state: plan.state,
      // The version read BEFORE the grid: if the sheet changed during the
      // round (including our own writes), the next round reads it again.
      remote_version: version,
      app_hash: await appHashOf(layout, after),
    },
  };
}
