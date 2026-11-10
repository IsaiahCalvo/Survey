// Edits the app made without seeing a value a round brought in from the
// sheet. A phone offline while the PM typed in Excel holds its change; when
// it comes back, Yjs settles the two writes to the same field by client id,
// so either the phone's older edit quietly replaces the PM's (and the next
// round pushes it over the PM's cell), or the PM's value quietly replaces the
// phone's. Values alone can't tell: by then one side equals the baseline.
//
// So each value a round writes into the survey is remembered by the Yjs item
// that holds it. On a later round, a write to the same field whose history
// does not pass through that item was made without seeing it. For those
// cells the round compares against the value from before the sheet's change
// instead of the agreed one, and the engine's usual three-way merge then
// keeps both edits (different answer lines) or asks (the same cell).
//
// Reads Yjs items directly (`_map`, `left`, `origin`, `content`) without
// importing yjs, so the edge function and node tests load the same file.
import { appRecordOf, fieldPrintsOf } from './engine.js';

// Bookkeeping every write stamps: never a clash of its own.
const STAMP_KEYS = new Set(['changedBy', 'changedDate']);
// How long a write is watched, and for how many items at most.
const WATCH_MS = 30 * 24 * 60 * 60 * 1000;
const WATCH_MAX = 1000;
// An item deleted in the app this soon after a round brought a sheet edit
// into it keeps its row: Yjs can't say whether the delete saw the edit.
const DELETE_WATCH_MS = 24 * 60 * 60 * 1000;

const covers = (item, client, clock) => item.id.client === client
  && clock >= item.id.clock && clock < item.id.clock + item.length;

// Every write to one key, newest (the value shown) first.
function writesOf(rightmost) {
  const out = [];
  for (let it = rightmost; it; it = it.left) out.push(it);
  return out;
}

function seenOf(list) {
  const seen = {};
  for (const it of list) seen[it.id.client] = Math.max(seen[it.id.client] || 0, it.id.clock + it.length);
  return seen;
}

const find = (list, client, clock) => list.find((it) => covers(it, client, clock)) || null;

// true: the item's history passes through [client, clock]; false: it does
// not; null: the chain leaves the list (cannot say).
function descends(list, item, [client, clock]) {
  for (let cur = item, guard = 0; cur && guard < 10_000; guard += 1) {
    if (covers(cur, client, clock)) return true;
    if (!cur.origin) return false;
    cur = find(list, cur.origin.client, cur.origin.clock);
  }
  return null;
}

const isYMap = (v) => !!v && typeof v === 'object' && typeof v.forEach === 'function' && typeof v.set === 'function' && v._map instanceof Map;

// A replaced write's value, read even though Yjs marked it deleted (the doc
// is loaded without garbage collection). undefined when it is gone.
function deletedValueOf(item) {
  const content = item?.content?.getContent?.() || [];
  if (!content.length) return undefined;
  const v = content[content.length - 1];
  if (!isYMap(v)) return v;
  const out = {};
  for (const [key, child] of v._map) {
    const inner = child?.content?.getContent?.() || [];
    if (!inner.length) continue;
    const value = inner[inner.length - 1];
    out[key] = isYMap(value) ? deletedValueOf(child) : value;
  }
  return out;
}

/**
 * Check one remembered write against what the key holds now.
 * @returns {null | {seen:object, clash?:{oursShown:boolean, theirs:any}}}
 *   null: the write is no longer there to check (key replaced higher up).
 */
export function checkWrite(rightmost, watch) {
  if (!rightmost || !Array.isArray(watch?.at)) return null;
  const list = writesOf(rightmost);
  const [client, clock] = watch.at;
  if (!find(list, client, clock)) return null;
  const seen = seenOf(list);
  const fresh = list.filter((it) => it.id.clock + it.length > (watch.seen?.[it.id.client] || 0));
  const blind = fresh.filter((it) => descends(list, it, watch.at) === false);
  if (!blind.length) return { seen };
  const oursShown = descends(list, list[0], watch.at) === true;
  return { seen, clash: { oursShown, theirs: oursShown ? deletedValueOf(blind[0]) : undefined } };
}

/**
 * Before a round: every remembered write checked against the survey's Y.Doc.
 * @param {object} markersMap   the doc's survey-marker Y.Map
 * @param {object} watched      link.state.pulls
 * @param {object} markers      the markers as the round reads them
 * @returns {{pulls:object, clashes:Object<string, {cells:object, scopeId:string, theirs:object|null}>}}
 *   `theirs`: the marker as the blind edit had it, when Yjs kept the round's
 *   value instead (null when the blind edit is the value shown).
 */
export function checkWatched(markersMap, watched, markers, now = Date.now()) {
  const pulls = {};
  const clashes = {};
  for (const [markerId, w] of Object.entries(watched || {})) {
    if (!w || typeof w !== 'object' || !(now - Number(w.t) < WATCH_MS)) continue;
    if (!markers[markerId]) {
      // Deleted in the app since: the sheet's edit would go with the row.
      const gone = markersMap?._map?.get(markerId);
      if (gone?.deleted && now - Number(w.t) < DELETE_WATCH_MS && w.cells && Object.keys(w.cells).length) {
        const was = deletedValueOf(gone);
        clashes[markerId] = { cells: w.cells, scopeId: w.scopeId, theirs: null, deleted: true, name: String(was?.name || '') };
      }
      continue;
    }
    const marker = markers[markerId];
    let clash = null;
    let theirs = null;
    const next = { ...w };
    if (w.root) {
      const res = checkWrite(markersMap?._map?.get(markerId), w.root);
      if (!res) { delete next.root; } else {
        next.root = { ...w.root, seen: res.seen };
        if (res.clash) {
          clash = 'all';
          if (res.clash.oursShown && res.clash.theirs && typeof res.clash.theirs === 'object') theirs = { ...res.clash.theirs };
        }
      }
    }
    const rootNow = markersMap?._map?.get(markerId);
    if (w.fields && typeof w.fields === 'object' && Array.isArray(w.rootAt) && rootNow && !covers(rootNow, w.rootAt[0], w.rootAt[1])) {
      // The whole marker was written over since (a device without
      // per-field writes): nothing says it saw the round's values, so the
      // fields it watched are compared from before. A device that did see
      // them and kept them agrees with the sheet, so nothing is asked.
      delete next.fields;
      clash = clash === 'all' ? 'all' : [...(clash || []), ...Object.keys(w.fields)];
    } else if (w.fields && typeof w.fields === 'object') {
      const fieldsMap = markersMap?.get?.(markerId);
      next.fields = {};
      for (const [field, fw] of Object.entries(w.fields)) {
        const res = isYMap(fieldsMap) ? checkWrite(fieldsMap._map.get(field), fw) : null;
        if (!res) continue;
        next.fields[field] = { ...fw, seen: res.seen };
        if (!res.clash) continue;
        if (clash !== 'all') clash = [...(clash || []), field];
        if (res.clash.oursShown && res.clash.theirs !== undefined) theirs = { ...(theirs || marker), [field]: res.clash.theirs };
      }
      if (!Object.keys(next.fields).length) delete next.fields;
    }
    if (next.root || next.fields) pulls[markerId] = next;
    if (!clash) continue;
    const cells = clash === 'all' ? w.cells : cellsOfFields(w, clash);
    if (cells && Object.keys(cells).length) clashes[markerId] = { cells, scopeId: w.scopeId, theirs };
  }
  return { pulls, clashes };
}

// The remembered cells a set of fields stands behind (kept per field).
function cellsOfFields(w, fields) {
  const out = {};
  for (const f of fields) {
    const c = w.fieldCells?.[f];
    if (!c) continue;
    for (const [k, v] of Object.entries(c)) {
      if (k === 'answers') out.answers = { ...(out.answers || {}), ...v };
      else out[k] = v;
    }
  }
  return out;
}

const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
};

// Cells (baseline fingerprints) whose value differs between two markers.
function changedCells(scope, layout, before, after) {
  const a = fieldPrintsOf(appRecordOf(before, scope, layout));
  const b = fieldPrintsOf(appRecordOf(after, scope, layout));
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === 'answers' || STAMP_KEYS.has(k)) continue;
    if (v !== b[k]) out[k] = v;
  }
  const answers = {};
  for (const [id, v] of Object.entries(a.answers || {})) if (v !== (b.answers || {})[id]) answers[id] = v;
  if (Object.keys(answers).length) out.answers = answers;
  return out;
}

/**
 * After a round wrote into the survey: what to remember about each write.
 * Fingerprints only, like the baseline: never the survey's text.
 * @param {object} doc          the Y.Doc the round just wrote into
 * @param {object} markersMap   its survey-marker Y.Map
 * @param {object} fresh        markers as they were just before the write
 * @param {object} written      markers as written
 * @param {object} layout       the link's layout
 */
export function watchWrites(doc, markersMap, fresh, written, layout, now = Date.now()) {
  const out = {};
  const scopeOf = (m) => (layout?.scopes || []).find((sc) => String(sc.moduleId ?? '') === String(m?.moduleId ?? '') && String(sc.categoryId ?? '') === String(m?.categoryId ?? ''));
  for (const [id, after] of Object.entries(written || {})) {
    const before = fresh?.[id];
    if (!before || !after || typeof after !== 'object') continue;
    const scope = scopeOf(after);
    if (!scope) continue;
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => !STAMP_KEYS.has(k) && stable(before[k]) !== stable(after[k]));
    if (!changed.length) continue;
    const cells = changedCells(scope, layout, before, after);
    if (!Object.keys(cells).length) continue;
    const entry = { t: now, scopeId: scope.scopeId, cells };
    const rootItem = markersMap?._map?.get(id);
    if (rootItem && rootItem.id.client === doc.clientID) {
      entry.root = { at: [rootItem.id.client, rootItem.id.clock], seen: seenOf(writesOf(rootItem)) };
    } else {
      const fieldsMap = markersMap?.get?.(id);
      if (!isYMap(fieldsMap) || !rootItem) continue;
      entry.rootAt = [rootItem.id.client, rootItem.id.clock];
      entry.fields = {};
      entry.fieldCells = {};
      for (const field of changed) {
        const item = fieldsMap._map.get(field);
        if (!item || item.id.client !== doc.clientID) continue;
        entry.fields[field] = { at: [item.id.client, item.id.clock], seen: seenOf(writesOf(item)) };
        const c = changedCells(scope, layout, { ...after, [field]: before[field] }, after);
        if (Object.keys(c).length) entry.fieldCells[field] = c;
      }
      if (!Object.keys(entry.fields).length) continue;
    }
    out[id] = entry;
  }
  return out;
}

const mergeCells = (a, b) => {
  const out = { ...(a || {}), ...(b || {}) };
  if (a?.answers || b?.answers) out.answers = { ...(a?.answers || {}), ...(b?.answers || {}) };
  return out;
};

const sameAt = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];

// A later round's field writes join the marker's earlier ones, so an
// offline edit to a field written two rounds ago is still caught. A newer
// whole-marker write, another scope or a marker written over in between
// starts the watch afresh.
function mergeWatch(old, add) {
  if (!old || !add.fields || !old.fields || add.root) return add;
  if (old.scopeId !== add.scopeId || !sameAt(old.rootAt, add.rootAt)) return add;
  return {
    ...old,
    ...add,
    cells: mergeCells(old.cells, add.cells),
    fields: { ...old.fields, ...add.fields },
    fieldCells: { ...(old.fieldCells || {}), ...(add.fieldCells || {}) },
  };
}

/** Old pulls plus new ones, newest kept when over the cap. */
export function keepWatched(pulls, added, now = Date.now()) {
  const all = { ...(pulls || {}) };
  for (const [id, entry] of Object.entries(added || {})) all[id] = mergeWatch(all[id], entry);
  const ids = Object.keys(all).filter((id) => now - Number(all[id]?.t) < WATCH_MS);
  ids.sort((a, b) => Number(all[b].t) - Number(all[a].t));
  return Object.fromEntries(ids.slice(0, WATCH_MAX).map((id) => [id, all[id]]));
}

/**
 * The round's view with clashes folded in: the markers (a blind edit Yjs
 * dropped put back as the app's side) and the baseline (those cells compared
 * against the value from before the sheet's change).
 */
export function applyClashes(markers, baseline, clashes) {
  const outMarkers = { ...markers };
  const outBaseline = { ...baseline };
  for (const [id, c] of Object.entries(clashes || {})) {
    const base = baseline?.[id];
    if (!base || base.scopeId !== c.scopeId || (!markers[id] && !c.deleted)) continue;
    if (c.theirs && markers[id]) outMarkers[id] = { ...markers[id], ...c.theirs, id: markers[id].id ?? id };
    const fields = { ...(base.fields || {}) };
    for (const [k, v] of Object.entries(c.cells || {})) {
      if (k === 'answers') fields.answers = { ...(fields.answers || {}), ...v };
      else fields[k] = v;
    }
    outBaseline[id] = { ...base, fields };
  }
  return { markers: outMarkers, baseline: outBaseline };
}
