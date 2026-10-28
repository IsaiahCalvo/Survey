/**
 * The one place a document's new name is announced (2026-10-28).
 *
 * A document's name is held in several places at once: the open tabs (tab,
 * tooltip, overflow list, phone header, the viewer's export and print names),
 * the shell's `documents` list and each useDocuments() list (Documents tab,
 * project tree, file counts). A rename used to patch only the list it started
 * from, so an open tab kept the old name until a reload.
 *
 * Every rename goes through here and every holder subscribes and patches its
 * own copy in the same render:
 *   - a rename made on this screen: beginLocalRename() shows it at once, then
 *     confirmLocalRename() (with the row the database saved) or
 *     failLocalRename() (puts the old name back);
 *   - a rename from another screen (documentNameRealtime.js):
 *     announceRemoteDocumentName() with the row's updated_at.
 *
 * Order comes from the DATABASE's clock only (updated_at is set by a trigger),
 * never this device's: a remote rename older than the newest saved one is
 * dropped, and while a rename of ours is still saving, remote ones wait and
 * apply afterwards only if the database says they are newer. So A -> B -> C
 * typed quickly never flashes back to B when B's echo lands late.
 */

// documentId -> { name, serverAt, pending: token|null, buffered: { name, serverAt }|null }
const state = new Map();
const listeners = new Set();
// Every rename that reached subscribers, numbered, so a list read that was
// in flight can put back the renames made while it ran (namesChangedSince).
let sequence = 0;
const changedAt = new Map(); // documentId -> { name, seq }
let nextToken = 0;

function serverTime(at) {
  const parsed = typeof at === 'string' ? Date.parse(at) : (typeof at === 'number' ? at : NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function entryFor(id) {
  let entry = state.get(id);
  if (!entry) {
    entry = { name: null, serverAt: null, pending: null, buffered: null };
    state.set(id, entry);
  }
  return entry;
}

function publish(id, entry, name) {
  if (entry.name === name) return false;
  entry.name = name;
  sequence += 1;
  changedAt.set(id, { name, seq: sequence });
  for (const listener of [...listeners]) {
    try {
      listener({ id, name });
    } catch (err) {
      // One bad subscriber must never stop the others from renaming.
      console.warn('[document-name] subscriber failed:', err);
    }
  }
  return true;
}

function normalize(documentId, name) {
  const id = documentId == null ? '' : String(documentId);
  const text = typeof name === 'string' ? name.trim() : '';
  return id && text ? { id, text } : null;
}

/**
 * Show a rename made on this screen everywhere at once, before it is saved.
 * Returns a token for confirmLocalRename / failLocalRename, or null.
 */
export function beginLocalRename(documentId, name) {
  const input = normalize(documentId, name);
  if (!input) return null;
  const entry = entryFor(input.id);
  const token = ++nextToken;
  entry.pending = token;
  publish(input.id, entry, input.text);
  return token;
}

/**
 * The database saved our rename; `updatedAt` is the saved row's updated_at.
 * When it was the latest rename of ours, a remote rename that arrived while it
 * saved applies now if the database says it is newer.
 */
export function confirmLocalRename(documentId, token, updatedAt) {
  const id = documentId == null ? '' : String(documentId);
  const entry = state.get(id);
  if (!entry || token == null) return;
  const at = serverTime(updatedAt);
  if (at != null && (entry.serverAt == null || at > entry.serverAt)) entry.serverAt = at;
  if (entry.pending !== token) return;
  entry.pending = null;
  const waiting = entry.buffered;
  entry.buffered = null;
  if (waiting && (entry.serverAt == null || waiting.serverAt > entry.serverAt)) {
    entry.serverAt = waiting.serverAt;
    publish(id, entry, waiting.name);
  }
}

/**
 * Our rename was not saved: show `previousName` again (or a newer remote name
 * that arrived meanwhile). A later rename of ours keeps its own name.
 */
export function failLocalRename(documentId, token, previousName) {
  const id = documentId == null ? '' : String(documentId);
  const entry = state.get(id);
  if (!entry || entry.pending !== token) return;
  entry.pending = null;
  const waiting = entry.buffered;
  entry.buffered = null;
  if (waiting && (entry.serverAt == null || waiting.serverAt > entry.serverAt)) {
    entry.serverAt = waiting.serverAt;
    publish(id, entry, waiting.name);
    return;
  }
  const input = normalize(id, previousName);
  if (input) publish(id, entry, input.text);
}

/**
 * A rename the database made (another screen, another app). `updatedAt` is the
 * row's updated_at. Returns true when subscribers were told now.
 */
export function announceRemoteDocumentName(documentId, name, updatedAt) {
  const input = normalize(documentId, name);
  if (!input) return false;
  const at = serverTime(updatedAt);
  if (at == null) return false;
  const entry = entryFor(input.id);
  if (entry.serverAt != null && at <= entry.serverAt) return false;
  if (entry.pending != null) {
    if (!entry.buffered || at > entry.buffered.serverAt) entry.buffered = { name: input.text, serverAt: at };
    return false;
  }
  entry.serverAt = at;
  return publish(input.id, entry, input.text);
}

/** The newest name shown for a document in this session, or null. */
export function latestDocumentName(documentId) {
  return state.get(String(documentId))?.name ?? null;
}

/** A number that grows with every rename shown; pass it to namesChangedSince. */
export function documentNameSequence() {
  return sequence;
}

/** documentId -> name for every rename shown after `seq`. */
export function namesChangedSince(seq) {
  const out = new Map();
  for (const [id, change] of changedAt) {
    if (change.seq > seq) out.set(id, change.name);
  }
  return out;
}

/** Subscribe to renames: listener({ id, name }). Returns an unsubscribe function. */
export function subscribeDocumentNames(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Apply one rename to a list of rows keyed by `id`. Returns the same array
 * when nothing changed, so a React setState with it is a no-op.
 */
export function renameRows(rows, { id, name }) {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (row == null || String(row.id) !== id || row.name === name) return row;
    changed = true;
    return { ...row, name };
  });
  return changed ? next : rows;
}

/** Put back on freshly read rows the renames shown since the read began. */
export function withRenamesSince(rows, seq) {
  const renamed = namesChangedSince(seq);
  if (!renamed.size || !Array.isArray(rows)) return rows;
  let next = rows;
  for (const [id, name] of renamed) next = renameRows(next, { id, name });
  return next;
}

/** Test hook: forget every remembered name and subscriber. */
export function resetDocumentNameBusForTests() {
  state.clear();
  listeners.clear();
  changedAt.clear();
  sequence = 0;
}
