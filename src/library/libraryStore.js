// Suite library store (KAL-585): keeps My library / Company library on this
// device and syncs it with the server one change at a time.
//
// Works offline: every add, rename and remove lands in this device's copy at
// once and joins a queue (the outbox). The queue goes to the server in order,
// one change per request, whenever there is a connection. A change the server
// refuses (not allowed) is dropped and the server's copy comes back; a change
// that fails for want of a connection waits for the next try.
//
// Entry ids are made here, so an insert that reached the server but whose
// answer was lost is harmless to send again (the server already has that id).
//
// The client and storage are passed in, so the Node tests drive this file
// with a fake server.
import {
  LIBRARY_KIND,
  LIBRARY_SCOPE,
  LIBRARY_WORDS,
  companyOf,
  linkTemplateCategories,
  manageRefusal,
  mergeServerEntries,
  nameTakenWords,
  newEntryProblem,
  newLibraryEntry,
  normalizeEntryName,
  rowFromEntry,
  sameNameEntry,
} from './libraryModel.js';

export const LIBRARY_TABLE = 'library_entries';
const STORAGE_PREFIX = 'survey.suiteLibrary.v1:';

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST204']);
const REFUSED_CODES = new Set(['42501', 'PGRST301', '23514', '23503', '22023']);

function defaultMintId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older webviews: a v4-shaped id from Math.random (never used for security).
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function safeStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** What kind of failure a Supabase error is: 'offline' | 'missing' | 'refused' | 'duplicate' | 'other'. */
export function classifyLibraryError(error) {
  if (!error) return null;
  const code = String(error.code || '');
  if (code === '23505') return 'duplicate';
  if (MISSING_TABLE_CODES.has(code)) return 'missing';
  if (REFUSED_CODES.has(code)) return 'refused';
  const message = String(error.message || error || '');
  if (!code || /fetch|network|offline|timed? ?out|Load failed/i.test(message)) return 'offline';
  return 'other';
}

export function createLibraryStore({
  client,
  userId,
  storage = safeStorage(),
  mintId = defaultMintId,
  now = () => new Date().toISOString(),
  loadCompany = null,
} = {}) {
  const key = `${STORAGE_PREFIX}${userId || 'signed-out'}`;
  const listeners = new Set();
  let flushing = null;

  const read = () => {
    try {
      const raw = storage?.getItem(key);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === 'object') {
        return {
          serverRows: Array.isArray(saved.serverRows) ? saved.serverRows : [],
          outbox: Array.isArray(saved.outbox) ? saved.outbox : [],
          company: saved.company ?? null,
        };
      }
    } catch { /* a broken copy starts empty; the server fills it again */ }
    return { serverRows: [], outbox: [], company: null };
  };

  const saved = read();
  let state = {
    serverRows: saved.serverRows,
    outbox: saved.outbox,
    company: saved.company,
    entries: mergeServerEntries(saved.serverRows, saved.outbox),
    status: 'idle', // idle | syncing | offline | not-on-server
    error: '',
  };

  const persist = () => {
    try {
      storage?.setItem(key, JSON.stringify({ serverRows: state.serverRows, outbox: state.outbox, company: state.company }));
    } catch { /* storage full or blocked: the copy in memory still works */ }
  };

  const set = (patch) => {
    state = { ...state, ...patch };
    state.entries = mergeServerEntries(state.serverRows, state.outbox);
    persist();
    for (const fn of listeners) {
      try { fn(state); } catch { /* one listener must not stop the rest */ }
    }
  };

  const who = () => ({ userId, company: state.company });

  const queue = (op) => {
    set({ outbox: [...state.outbox, op], error: '' });
    void flush();
    return op;
  };

  async function refresh() {
    if (!client || !userId) return state;
    try {
      if (typeof loadCompany === 'function') {
        const company = companyOf(await loadCompany());
        set({ company });
      }
    } catch { /* keep the company this device last knew */ }
    const { data, error } = await client.from(LIBRARY_TABLE)
      .select('id, kind, parent_id, name, scope, company_id, created_by, created_at, updated_at, removed_at')
      .order('created_at', { ascending: true });
    if (error) {
      const kind = classifyLibraryError(error);
      set({ status: kind === 'missing' ? 'not-on-server' : 'offline' });
      return state;
    }
    set({ serverRows: data || [], status: state.outbox.length ? state.status : 'idle' });
    await flush();
    return state;
  }

  async function sendOne(op) {
    if (op.op === 'add') {
      const { error } = await client.from(LIBRARY_TABLE).insert(rowFromEntry(op.entry));
      return { error, refusedQuietly: false };
    }
    const patch = op.op === 'rename'
      ? { name: normalizeEntryName(op.name) }
      : { removed_at: op.at };
    // A row the rules hide from an update comes back as no rows, not an
    // error, so ask for the row back and treat "none" as refused.
    const { data, error } = await client.from(LIBRARY_TABLE).update(patch).eq('id', op.id).select('id');
    return { error, refusedQuietly: !error && (!Array.isArray(data) || data.length === 0) };
  }

  /** Send the queue to the server, one change at a time, in order. */
  function flush() {
    if (flushing) return flushing;
    if (!client || !userId || state.outbox.length === 0) return Promise.resolve(state);
    flushing = (async () => {
      set({ status: 'syncing' });
      let refusedAny = '';
      while (state.outbox.length > 0) {
        const op = state.outbox[0];
        let result;
        try {
          result = await sendOne(op);
        } catch (err) {
          result = { error: err };
        }
        const kind = result.error ? classifyLibraryError(result.error) : (result.refusedQuietly ? 'refused' : null);
        if (kind === 'offline' || kind === 'missing') {
          set({ status: kind === 'missing' ? 'not-on-server' : 'offline' });
          return state;
        }
        // Done (or already on the server): the change becomes part of the
        // server copy; refused or broken: it is dropped.
        const nextRows = (kind === null || kind === 'duplicate') ? serverRowsWith(state.serverRows, op) : state.serverRows;
        if (kind === 'refused' || kind === 'other') {
          refusedAny = kind === 'refused'
            ? (op.op === 'add' ? LIBRARY_WORDS.refusedAdd : LIBRARY_WORDS.refusedManage)
            : String(result.error?.message || 'The library could not save that change.');
        }
        set({ serverRows: nextRows, outbox: state.outbox.slice(1) });
      }
      set({ status: 'idle', error: refusedAny });
      if (refusedAny) {
        // Bring back the server's copy of whatever was refused.
        flushing = null;
        await refresh();
      }
      return state;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  function add({ kind = LIBRARY_KIND.CATEGORY, name, parentId = null, scope = LIBRARY_SCOPE.MINE }) {
    const entry = newLibraryEntry({
      id: mintId(), kind, name, parentId, scope,
      companyId: scope === LIBRARY_SCOPE.COMPANY ? state.company?.id : null,
      userId, now: now(),
    });
    const problem = newEntryProblem(entry, { ...who(), entries: state.entries });
    if (problem) return { ok: false, reason: problem };
    queue({ op: 'add', entry });
    return { ok: true, entry };
  }

  function rename(id, name) {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return { ok: false, reason: 'That entry is gone.' };
    const refusal = manageRefusal(entry, who());
    if (refusal) return { ok: false, reason: refusal };
    const clean = normalizeEntryName(name);
    if (!clean) return { ok: false, reason: LIBRARY_WORDS.emptyName };
    if (clean === entry.name) return { ok: true, entry };
    const twin = sameNameEntry(state.entries, { ...entry, name: clean });
    if (twin) return { ok: false, reason: nameTakenWords(twin.name) };
    queue({ op: 'rename', id, name: clean, at: now() });
    return { ok: true };
  }

  function remove(id) {
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return { ok: false, reason: 'That entry is gone.' };
    const refusal = manageRefusal(entry, who());
    if (refusal) return { ok: false, reason: refusal };
    queue({ op: 'remove', id, at: now() });
    return { ok: true };
  }

  /**
   * Link my templates' categories to the library (making entries as needed)
   * and queue the new entries. Returns the templates to save.
   */
  function linkTemplates(templates) {
    const result = linkTemplateCategories(templates, {
      entries: state.entries, userId, company: state.company, mintId, now: now(),
    });
    if (result.created.length > 0) {
      set({ outbox: [...state.outbox, ...result.created.map((entry) => ({ op: 'add', entry }))] });
      void flush();
    }
    return result;
  }

  let firstRefresh = null;
  return {
    getState: () => state,
    /** The first server read (company and entries), started once. */
    ready() {
      if (!firstRefresh) firstRefresh = refresh().catch(() => state);
      return firstRefresh;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    refresh,
    flush,
    add,
    rename,
    remove,
    linkTemplates,
  };
}

/** The server copy after a change it accepted (so the list does not wait for a re-read). */
function serverRowsWith(rows, op) {
  if (op.op === 'add') {
    if (rows.some((r) => r.id === op.entry.id)) return rows;
    return [...rows, { ...rowFromEntry(op.entry), created_at: op.entry.createdAt, updated_at: op.entry.updatedAt, removed_at: null }];
  }
  return rows.map((r) => {
    if (r.id !== op.id) return r;
    if (op.op === 'rename') return { ...r, name: normalizeEntryName(op.name), updated_at: op.at };
    if (op.op === 'remove') return { ...r, removed_at: op.at };
    return r;
  });
}

// One store per signed-in person, shared by the Library tab and template saves.
const stores = new Map();
export function libraryStoreFor({ client, userId, loadCompany }) {
  if (!userId) return null;
  let store = stores.get(userId);
  if (!store) {
    store = createLibraryStore({ client, userId, loadCompany });
    stores.set(userId, store);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { void store.flush(); });
    }
  }
  return store;
}

export const __test = { serverRowsWith };
