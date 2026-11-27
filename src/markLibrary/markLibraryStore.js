/**
 * markLibraryStore.js — the mark library's items for the open document
 * (beta flag 'mark-library'). One store for the app: the active viewer tells
 * it who is signed in and which project the document is in (setContext); the
 * Library panel and the viewer's "Save to library" read it with
 * useMarkLibrary().
 *
 * Signed in: items live in public.mark_library_items (RLS decides who sees
 * and changes what, see the migration). Signed out (or the dev test-PDF
 * route): the personal library lives in this browser only.
 *
 * KAL-853 (database load): opening a document reads nothing. The library is
 * read only while something shows it (the Library panel, the Save to library
 * card) — those call useMarkLibrary(store, { active: true }), which retains
 * the store. There is no realtime channel: a teammate's change shows the next
 * time the panel opens (if the last read is older than REFRESH_AFTER_MS) or
 * when the tab comes back while the panel is open.
 *
 * Rules (names, tags, rows, who may change what) are markLibraryModel.js.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { supabase as defaultSupabase, isSupabaseAvailable } from '../supabaseClient.js';
import {
  canChangeLibraryItem,
  cleanLibraryName,
  cleanLibraryTags,
  libraryCopyName,
  libraryItemFromRow,
  libraryPayloadBytes,
  libraryRowFromItem,
  LIBRARY_PAYLOAD_MAX_BYTES,
  summarizeLibraryKinds,
} from './markLibraryModel.js';

const LOCAL_KEY = 'survey:mark-library.v1';
const RECENTS_KEY = 'survey:mark-library-recents.v1';
const VIEW_KEY = 'survey:mark-library-view.v1';
/** A panel that opens again within this long shows what it read last time. */
export const REFRESH_AFTER_MS = 60_000;
const SELECT_COLUMNS = 'id, library, project_id, created_by, name, tags, kinds, payload, created_at, updated_at';

const readJson = (key, fallback) => {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ }
};

const newId = () => (globalThis.crypto?.randomUUID?.()
  || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const EMPTY_ACCESS = Object.freeze({ canRead: false, canAdd: false, canManage: false, projectName: null });

/** A sentence for a failed save. */
const PAGE_ROWS = 1000;
const LIBRARY_MAX_ITEMS = 2000;

export function libraryErrorMessage(error) {
  const text = String(error?.message || error || '');
  if (/other_project/.test(text)) return 'Open a document in that project to do this.';
  if (/mark_library_full/.test(text)) return 'This library is full (2000 items). Delete some first.';
  if (/row-level security|permission|42501/i.test(text)) return 'You can\'t change this library.';
  if (/too_big|payload|1048576|check constraint/i.test(text)) return 'Those marks are too big to save (the limit is about 1 MB; large images count most).';
  if (/fetch|network|Failed to fetch/i.test(text)) return 'No connection. Try again when you are back online.';
  return 'Could not save to the library. Try again.';
}

export function createMarkLibraryStore({
  supabase = defaultSupabase,
  available = () => isSupabaseAvailable(),
  now = () => Date.now(),
  doc = typeof document !== 'undefined' ? document : null,
} = {}) {
  let state = {
    userId: null,
    projectId: null,
    personal: { status: 'idle', items: [] },
    project: { status: 'idle', items: [] },
    access: EMPTY_ACCESS,
    recents: readJson(RECENTS_KEY, {}),
    view: { library: 'personal', layout: 'large', sort: 'recent', groupByTag: false, ...readJson(VIEW_KEY, {}) },
  };
  const listeners = new Set();
  let loadToken = 0;
  // How many shown things want the library now, when it was last read (for
  // this person and project), and whether the context changed since.
  let demand = 0;
  let loadedAt = 0;
  let stale = true;
  let detachVisibility = null;

  const emit = () => { for (const fn of listeners) fn(); };
  const set = (patch) => { state = { ...state, ...patch }; emit(); };
  const online = () => Boolean(state.userId && supabase && available());

  const putItem = (item) => {
    if (!item) return;
    const key = item.library === 'project' ? 'project' : 'personal';
    const other = key === 'project' ? 'personal' : 'project';
    const without = (list) => list.filter((it) => it.id !== item.id);
    const belongs = key === 'personal' ? item.createdBy === state.userId : item.projectId === state.projectId;
    set({
      [key]: { ...state[key], items: belongs ? [item, ...without(state[key].items)] : without(state[key].items) },
      [other]: { ...state[other], items: without(state[other].items) },
    });
  };
  const dropIds = (ids) => {
    const gone = new Set(ids);
    set({
      personal: { ...state.personal, items: state.personal.items.filter((it) => !gone.has(it.id)) },
      project: { ...state.project, items: state.project.items.filter((it) => !gone.has(it.id)) },
    });
  };
  const saveLocal = () => {
    if (online()) return;
    writeJson(LOCAL_KEY, state.personal.items.map((it) => ({ ...it, library: 'personal' })));
  };

  function attachVisibility() {
    if (detachVisibility || !doc || typeof doc.addEventListener !== 'function') return;
    const onVisible = () => {
      if (doc.visibilityState === 'visible' && demand > 0 && online() && now() - loadedAt >= REFRESH_AFTER_MS) void load();
    };
    doc.addEventListener('visibilitychange', onVisible);
    detachVisibility = () => doc.removeEventListener('visibilitychange', onVisible);
  }
  function detachVisibilityListener() {
    if (detachVisibility) { detachVisibility(); detachVisibility = null; }
  }

  // The API hands back at most PAGE_ROWS rows a request (max_rows), and a
  // library holds up to 2000, so read it a page at a time.
  async function readAllRows(where) {
    const data = [];
    for (let from = 0; from < LIBRARY_MAX_ITEMS; from += PAGE_ROWS) {
      // eslint-disable-next-line no-await-in-loop
      const res = await where(supabase.from('mark_library_items').select(SELECT_COLUMNS))
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, Math.min(from + PAGE_ROWS, LIBRARY_MAX_ITEMS) - 1);
      if (res.error) return { data: null, error: res.error };
      data.push(...(res.data || []));
      if ((res.data || []).length < PAGE_ROWS) break;
    }
    return { data, error: null };
  }

  async function load() {
    const token = ++loadToken;
    stale = false;
    const { userId, projectId } = state;
    if (!online()) {
      const items = (readJson(LOCAL_KEY, []) || [])
        .map((row) => libraryItemFromRow({ ...row, project_id: null, created_by: row.createdBy ?? null, created_at: row.createdAt, updated_at: row.updatedAt }))
        .filter(Boolean)
        .map((item) => ({ ...item, library: 'personal', createdBy: userId }));
      set({ personal: { status: 'ready', items }, project: { status: 'none', items: [] }, access: EMPTY_ACCESS });
      return;
    }
    set({
      personal: { ...state.personal, status: state.personal.items.length ? 'ready' : 'loading' },
      project: projectId ? { ...state.project, status: state.project.items.length ? 'ready' : 'loading' } : { status: 'none', items: [] },
    });
    try {
      const [personalRes, accessRes] = await Promise.all([
        readAllRows((q) => q.eq('library', 'personal').eq('created_by', userId)),
        projectId ? supabase.rpc('mark_library_project_access', { p_project_id: projectId }) : Promise.resolve({ data: null }),
      ]);
      if (token !== loadToken) return;
      if (personalRes.error) throw personalRes.error;
      const access = accessRes?.data
        ? {
          canRead: Boolean(accessRes.data.can_read),
          canAdd: Boolean(accessRes.data.can_add),
          canManage: Boolean(accessRes.data.can_manage),
          projectName: accessRes.data.project_name || null,
        }
        : EMPTY_ACCESS;
      let projectItems = [];
      if (projectId && access.canRead) {
        const res = await readAllRows((q) => q.eq('library', 'project').eq('project_id', projectId));
        if (token !== loadToken) return;
        if (res.error) throw res.error;
        projectItems = (res.data || []).map(libraryItemFromRow).filter(Boolean);
      }
      set({
        access,
        personal: { status: 'ready', items: (personalRes.data || []).map(libraryItemFromRow).filter(Boolean) },
        project: projectId && access.canRead ? { status: 'ready', items: projectItems } : { status: 'none', items: [] },
      });
      loadedAt = now();
    } catch (error) {
      if (token !== loadToken) return;
      console.warn('[markLibrary] load failed', error?.message || error);
      set({
        personal: { ...state.personal, status: state.personal.items.length ? 'ready' : 'error' },
        project: projectId ? { ...state.project, status: state.project.items.length ? 'ready' : 'error' } : { status: 'none', items: [] },
      });
    }
  }

  const findItem = (id) => state.personal.items.find((it) => it.id === id)
    || state.project.items.find((it) => it.id === id) || null;

  const accessFor = () => ({ userId: state.userId, canAdd: state.access.canAdd, canManage: state.access.canManage });

  async function insertRows(rows) {
    if (!online()) {
      const now = new Date().toISOString();
      const items = rows.map((row) => libraryItemFromRow({
        ...row, id: newId(), library: 'personal', project_id: null, created_by: state.userId, created_at: now, updated_at: now,
      })).filter(Boolean);
      set({ personal: { ...state.personal, items: [...items, ...state.personal.items] } });
      saveLocal();
      return items;
    }
    const { data, error } = await supabase.from('mark_library_items').insert(rows).select(SELECT_COLUMNS);
    if (error) throw error;
    const items = (data || []).map(libraryItemFromRow).filter(Boolean);
    items.forEach(putItem);
    return items;
  }

  async function updateRow(id, patch) {
    if (!online()) {
      const now = new Date().toISOString();
      set({
        personal: {
          ...state.personal,
          items: state.personal.items.map((it) => (it.id === id ? {
            ...it,
            ...(patch.name !== undefined ? { name: cleanLibraryName(patch.name) || it.name } : {}),
            ...(patch.tags !== undefined ? { tags: cleanLibraryTags(patch.tags) } : {}),
            ...(patch.payload !== undefined ? { payload: patch.payload, kinds: summarizeLibraryKinds(patch.payload) } : {}),
            updatedAt: now,
          } : it)),
        },
      });
      saveLocal();
      return findItem(id);
    }
    const { data, error } = await supabase.from('mark_library_items').update(patch).eq('id', id).select(SELECT_COLUMNS);
    if (error) throw error;
    if (!data?.length) throw new Error('permission');
    const item = libraryItemFromRow(data[0]);
    putItem(item);
    return item;
  }

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getState() { return state; },

    /**
     * The active viewer's signed-in person and document project. Reads
     * nothing by itself (KAL-853): the library is read when something that
     * shows it retains the store.
     */
    setContext({ userId = null, projectId = null } = {}) {
      if (userId === state.userId && projectId === state.projectId) return;
      const userChanged = userId !== state.userId;
      state = {
        ...state,
        userId,
        projectId,
        ...(userChanged ? { personal: { status: 'idle', items: [] } } : {}),
        project: { status: projectId ? 'idle' : 'none', items: [] },
        access: EMPTY_ACCESS,
      };
      stale = true;
      loadedAt = 0;
      loadToken += 1; // a read for the old context lands nowhere
      emit();
      if (demand > 0) void load();
    },
    /**
     * Something that shows the library opened: read it if it was never read
     * for this context or the last read is older than REFRESH_AFTER_MS.
     * Returns the matching release().
     */
    retain() {
      demand += 1;
      attachVisibility();
      if (stale || now() - loadedAt >= REFRESH_AFTER_MS) void load();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        demand = Math.max(0, demand - 1);
        if (demand === 0) detachVisibilityListener();
      };
    },
    refresh() { return load(); },
    dispose() { detachVisibilityListener(); demand = 0; listeners.clear(); },

    canChange(item) { return canChangeLibraryItem(item, accessFor()); },
    /** Libraries this person can add to here, in menu order. */
    addableLibraries() {
      return ['personal', ...(state.projectId && state.access.canAdd ? ['project'] : [])];
    },

    setView(patch) {
      const view = { ...state.view, ...patch };
      writeJson(VIEW_KEY, view);
      set({ view });
    },
    markUsed(id) {
      const recents = { ...state.recents, [id]: Date.now() };
      // Keep the 200 most recent.
      const trimmed = Object.fromEntries(Object.entries(recents).sort((a, b) => b[1] - a[1]).slice(0, 200));
      writeJson(RECENTS_KEY, trimmed);
      set({ recents: trimmed });
    },

    /** Save new items: [{ library, name, tags, payload }]. Returns the saved items. */
    async addItems(entries) {
      const rows = (entries || []).map((entry) => libraryRowFromItem({ ...entry, projectId: entry.projectId ?? state.projectId }));
      if (rows.some((row) => libraryPayloadBytes(row.payload) > LIBRARY_PAYLOAD_MAX_BYTES)) {
        throw new Error('too_big');
      }
      // An entry that names its project (an Undo of a delete) only goes back
      // to that project, never into whichever one is open now.
      if (rows.some((row) => row.library === 'project' && row.project_id !== state.projectId)) {
        throw new Error('other_project');
      }
      if (rows.some((row) => row.library === 'project') && !(state.projectId && state.access.canAdd)) {
        throw new Error('permission');
      }
      const saved = [];
      // Fifty at a time (Drawboard's advice for bulk work, and a sane request size).
      for (let i = 0; i < rows.length; i += 50) {
        // eslint-disable-next-line no-await-in-loop
        saved.push(...await insertRows(rows.slice(i, i + 50)));
      }
      return saved;
    },
    async renameItem(id, name) {
      const clean = cleanLibraryName(name);
      if (!clean) return findItem(id);
      return updateRow(id, { name: clean });
    },
    async setTags(id, tags) { return updateRow(id, { tags: cleanLibraryTags(tags) }); },
    /** Put new marks in an item (Drawboard: place, edit, save again). */
    async replacePayload(id, payload) {
      if (libraryPayloadBytes(payload) > LIBRARY_PAYLOAD_MAX_BYTES) throw new Error('too_big');
      return updateRow(id, { payload, kinds: summarizeLibraryKinds(payload) });
    },
    async deleteItems(ids) {
      const list = [...new Set(ids || [])];
      if (list.length === 0) return [];
      if (!online()) {
        const removed = state.personal.items.filter((it) => list.includes(it.id));
        dropIds(list);
        saveLocal();
        return removed;
      }
      const removed = list.map(findItem).filter(Boolean);
      const { data, error } = await supabase.from('mark_library_items').delete().in('id', list).select('id');
      if (error) throw error;
      const gone = (data || []).map((row) => row.id);
      dropIds(gone);
      return removed.filter((it) => gone.includes(it.id));
    },
    /** Copies of `ids` in `library` (default: where each one is). */
    async duplicateItems(ids, library = null) {
      const sources = (ids || []).map(findItem).filter(Boolean);
      const names = [...state.personal.items, ...state.project.items].map((it) => it.name);
      const entries = sources.map((it) => {
        const name = (library && library !== it.library) ? it.name : libraryCopyName(it.name, names);
        names.push(name);
        return { library: library || it.library, name, tags: it.tags, payload: it.payload };
      });
      return this.addItems(entries);
    },
    /** Move items to the other library: a copy there, then the original goes. */
    async moveItems(ids, library) {
      const sources = (ids || []).map(findItem).filter((it) => it && it.library !== library);
      if (sources.length === 0) return [];
      const copies = await this.addItems(sources.map((it) => ({ library, name: it.name, tags: it.tags, payload: it.payload })));
      const deletable = sources.filter((it) => this.canChange(it)).map((it) => it.id);
      if (deletable.length) await this.deleteItems(deletable);
      return copies;
    },
  };
}

export const markLibraryStore = createMarkLibraryStore();

/**
 * The library's state. Pass { active: true } from something that shows the
 * library (it is read then, and not before); the Save to library card passes
 * its open state.
 */
export function useMarkLibrary(store = markLibraryStore, { active = false } = {}) {
  useEffect(() => (active ? store.retain() : undefined), [store, active]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
