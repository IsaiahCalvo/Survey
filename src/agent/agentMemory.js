// What the Survey agent learns in a project (Nightly beta, plan 2026-10-27):
// names people use for items ("D101" is D-1-01) and the wording they want in
// notes ("missing" is written "not installed"). Rows live in
// public.survey_agent_memory, shared by everyone on the project; viewers read,
// editors change (RLS). The agent reads them through get_survey_context and
// item lookups; people see and remove them under "What Survey learned".

export const MEMORY_KINDS = Object.freeze(['name', 'wording']);
export const MEMORY_LIMITS = Object.freeze({ heard: 120, means: 200, perProject: 500 });

/** The spoken form folded for matching, as the database's heard_key. */
export const memoryKey = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A store over one Supabase client. list() is cached per project and shared,
 * so the item lookups (sync) can read what the last load found.
 */
export function createAgentMemoryStore(client) {
  const cache = new Map();
  const loading = new Map();
  const listeners = new Set();
  const notify = (projectId) => listeners.forEach((fn) => { try { fn(projectId); } catch { /* listener */ } });
  const put = (projectId, rows) => { cache.set(projectId, rows); notify(projectId); return rows; };
  const table = () => client.from('survey_agent_memory');

  const store = {
    /** Rows loaded for a project, or [] before the first load. */
    cached(projectId) { return (projectId && cache.get(projectId)) || []; },
    async list(projectId, { fresh = false } = {}) {
      if (!projectId || !client?.from) return [];
      if (!fresh && cache.has(projectId)) return cache.get(projectId);
      if (!fresh && loading.has(projectId)) return loading.get(projectId);
      const run = (async () => {
        const { data, error } = await table()
          .select('id, kind, heard, means, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true });
        if (error) throw new Error(error.message || 'Could not read what Survey learned.');
        return put(projectId, data || []);
      })();
      loading.set(projectId, run);
      try { return await run; } finally { loading.delete(projectId); }
    },
    /**
     * Saves "heard means means". The same heard (folded) of the same kind is
     * replaced. Returns { row, before } where before is the replaced row.
     */
    async save(projectId, { kind, heard, means }) {
      if (!MEMORY_KINDS.includes(kind)) throw new Error('Unknown kind of memory.');
      const h = clean(heard, MEMORY_LIMITS.heard);
      const m = clean(means, MEMORY_LIMITS.means);
      if (!h || !m) throw new Error('Both what is said and what it means are needed.');
      const rows = await store.list(projectId);
      const found = rows.find((r) => r.kind === kind && memoryKey(r.heard) === memoryKey(h));
      const before = found ? { ...found } : null;
      if (before && before.heard === h && before.means === m) return { row: before, before: null, same: true };
      if (!before && rows.length >= MEMORY_LIMITS.perProject) throw new Error(`This project already has ${MEMORY_LIMITS.perProject} saved names and wordings. Remove some under What Survey learned.`);
      const query = before
        ? table().update({ heard: h, means: m }).eq('id', before.id)
        : table().insert({ project_id: projectId, kind, heard: h, means: m });
      const { data, error } = await query.select('id, kind, heard, means, created_at').single();
      if (error) throw new Error(error.message || 'Could not save that.');
      put(projectId, before ? rows.map((r) => (r.id === before.id ? data : r)) : [...rows, data]);
      return { row: data, before };
    },
    async remove(projectId, id) {
      const { error } = await table().delete().eq('id', id);
      if (error) throw new Error(error.message || 'Could not remove that.');
      put(projectId, store.cached(projectId).filter((r) => r.id !== id));
    },
    /**
     * Removes the row saved for this kind and heard, whatever its id now is
     * (undo of a save: the row may have been removed and put back since).
     */
    async removeSaved(projectId, row) {
      const key = memoryKey(row.heard);
      const found = (await store.list(projectId)).filter((r) => r.kind === row.kind && memoryKey(r.heard) === key);
      for (const r of found) await store.remove(projectId, r.id);
    },
    /** Puts back a row as it was (undo of a save or a remove). */
    async restore(projectId, row) {
      const rows = await store.list(projectId);
      const { id: _id, created_at: _c, ...fields } = row;
      const existing = rows.find((r) => r.kind === row.kind && memoryKey(r.heard) === memoryKey(row.heard));
      const query = existing
        ? table().update({ heard: fields.heard, means: fields.means }).eq('id', existing.id)
        : table().insert({ project_id: projectId, kind: fields.kind, heard: fields.heard, means: fields.means });
      const { data, error } = await query.select('id, kind, heard, means, created_at').single();
      if (error) throw new Error(error.message || 'Could not put that back.');
      put(projectId, existing ? rows.map((r) => (r.id === existing.id ? data : r)) : [...rows, data]);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return store;
}

/** The item name a learned name points to, or null. */
export function learnedNameFor(rows, heard) {
  const key = memoryKey(heard);
  if (!key) return null;
  const row = (rows || []).find((r) => r.kind === 'name' && memoryKey(r.heard) === key);
  return row ? row.means : null;
}

/** Learned rows as the model sees them: [heard, means] pairs per kind. */
export function learnedForModel(rows, max = 100) {
  const pick = (kind) => (rows || []).filter((r) => r.kind === kind).slice(-max).map((r) => [r.heard, r.means]);
  return { names: pick('name'), wording: pick('wording') };
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Note text with every whole-word "from" written as "to" (any case; a
 * capital first letter stays capital). Returns the text unchanged when
 * nothing matched.
 */
export function rewordText(text, from, to) {
  const source = String(text || '');
  const f = clean(from, MEMORY_LIMITS.heard);
  const t = clean(to, MEMORY_LIMITS.means);
  if (!source || !f || !t || f.toLowerCase() === t.toLowerCase()) return source;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(f).replace(/ /g, '\\s+')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  return source.replace(pattern, (whole, lead, word) => {
    const upper = word[0] !== word[0].toLowerCase();
    return `${lead}${upper ? t[0].toUpperCase() + t.slice(1) : t}`;
  });
}
