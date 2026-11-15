// Kal Voe suite library store (KAL-585): the person's My library and
// Company library entries, kept on the device so the library works offline.
// Every change goes into an outbox first (shown at once) and is sent one
// entry at a time when online; a change the server refuses (a member trying
// to rename a company entry) is dropped and the server's copy comes back.
// Rules: libraryModel.js. Table: library_entries.
import { useEffect, useState } from 'react';
import {
  applyLibraryOp,
  entryFromRow,
  flushLibraryOutbox,
  mergeServerEntries,
  newLibraryEntry,
  rowFromEntry,
} from './libraryModel.js';

const STORAGE_PREFIX = 'survey.suiteLibrary.';

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function isOfflineError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(error?.message || error || '');
  return /Failed to fetch|NetworkError|network|timed out|Load failed/i.test(msg);
}

/**
 * One store per signed-in person. `client` is the Supabase client; `storage`
 * defaults to localStorage (tests pass a stand-in).
 */
export function createLibraryStore({ client, userId, storage = safeStorage() }) {
  const key = `${STORAGE_PREFIX}${userId}`;
  let state = { server: [], outbox: [], entries: [], company: null, loaded: false, error: '' };
  const listeners = new Set();

  const read = () => {
    try {
      const raw = storage?.getItem(key);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === 'object') {
        state.server = Array.isArray(saved.server) ? saved.server : [];
        state.outbox = Array.isArray(saved.outbox) ? saved.outbox : [];
        state.company = saved.company || null;
      }
    } catch { /* a broken copy is ignored; the server copy comes next */ }
    state.entries = mergeServerEntries(state.server, state.outbox);
  };
  const write = () => {
    try { storage?.setItem(key, JSON.stringify({ server: state.server, outbox: state.outbox, company: state.company })); } catch { /* full or blocked */ }
  };
  const emit = () => {
    state = { ...state, entries: mergeServerEntries(state.server, state.outbox) };
    for (const fn of listeners) fn(state);
  };

  const send = async (op) => {
    let res;
    if (op.op === 'create') {
      res = await client.from('library_entries').upsert(rowFromEntry(op.entry), { onConflict: 'id', ignoreDuplicates: true });
    } else if (op.op === 'rename') {
      res = await client.from('library_entries').update({ name: op.name }).eq('id', op.id).select('id');
      if (!res.error && Array.isArray(res.data) && res.data.length === 0) throw new Error('Only an owner or admin can rename that.');
    } else if (op.op === 'remove') {
      const at = op.at || new Date().toISOString();
      res = await client.from('library_entries').update({ removed_at: at }).eq('id', op.id).select('id');
      if (!res.error && Array.isArray(res.data) && res.data.length === 0) throw new Error('Only an owner or admin can remove that.');
      if (!res.error) await client.from('library_entries').update({ removed_at: at }).eq('parent_id', op.id).is('removed_at', null);
    } else {
      return;
    }
    if (res?.error) {
      if (isOfflineError(res.error)) { const err = new Error(res.error.message); err.offline = true; throw err; }
      throw new Error(res.error.message || 'Refused');
    }
  };

  let flushing = null;
  const api = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async refresh() {
      try {
        const [{ data: company }, { data: rows, error }] = await Promise.all([
          client.rpc('get_my_organization').then((r) => r, () => ({ data: null })),
          client.from('library_entries').select('id, kind, parent_id, name, scope, owner_id, organization_id, created_at, updated_at, removed_at').limit(5000),
        ]);
        if (error) throw error;
        state.server = (rows || []).map(entryFromRow);
        state.company = company || null;
        state.loaded = true;
        state.error = '';
        write();
      } catch (err) {
        state.loaded = true;
        state.error = isOfflineError(err) ? '' : 'Could not load the library. Showing the copy on this device.';
      }
      emit();
      return api.flush();
    },

    /** Queue a change, show it at once, and try to send it. */
    queue(op) {
      state.outbox = [...state.outbox, op];
      write();
      emit();
      api.flush();
      return op;
    },

    add({ kind = 'category', name, parentId = null, scope }) {
      const entry = newLibraryEntry({ kind, name, parentId, scope, userId, company: state.company });
      api.queue({ op: 'create', entry });
      return entry;
    },
    /** Entries made elsewhere (template linking) that only need sending. */
    addMany(entries) {
      if (!entries?.length) return;
      state.outbox = [...state.outbox, ...entries.map((entry) => ({ op: 'create', entry }))];
      write();
      emit();
      api.flush();
    },
    rename(id, name) { return api.queue({ op: 'rename', id, name }); },
    remove(id) { return api.queue({ op: 'remove', id, at: new Date().toISOString() }); },

    async flush() {
      if (flushing) return flushing;
      if (!state.outbox.length) return { sent: [], refused: [] };
      flushing = (async () => {
        const result = await flushLibraryOutbox(state.outbox, send);
        // Ops queued while this ran stay behind the ones just handled.
        const handled = new Set([...result.sent, ...result.refused.map((r) => r.op)]);
        state.outbox = state.outbox.filter((op) => !handled.has(op));
        for (const op of result.sent) state.server = applyLibraryOp(state.server, op);
        if (result.refused.length) state.error = result.refused[0].error?.message || 'A library change was refused.';
        write();
        emit();
        return result;
      })();
      try { return await flushing; } finally { flushing = null; }
    },
  };

  read();
  return api;
}

const stores = new Map();
/** The shared store for this person (one per user id). */
export function libraryStoreFor(client, userId) {
  if (!client || !userId) return null;
  if (!stores.has(userId)) stores.set(userId, createLibraryStore({ client, userId }));
  return stores.get(userId);
}

/** React: the library state, refreshed once on mount and when back online. */
export function useSuiteLibrary(store) {
  const [state, setState] = useState(() => store?.getState() || null);
  useEffect(() => {
    if (!store) return undefined;
    const off = store.subscribe(setState);
    setState(store.getState());
    store.refresh();
    const online = () => store.refresh();
    globalThis.addEventListener?.('online', online);
    return () => { off(); globalThis.removeEventListener?.('online', online); };
  }, [store]);
  return state;
}
