// What the Survey agent learns in a project (Nightly beta, plan 2026-10-27):
// names people use for items ("D101" is D-1-01) and the wording they want in
// notes ("missing" is written "not installed"). Rows live in
// public.survey_agent_memory, shared by everyone on the project; viewers read,
// editors change (RLS). The agent reads them through get_survey_context and
// item lookups; people see and remove them under "What Survey learned".
// Kind 'state' (2026-11-24): what a state word means in this project
// ("done" is Commissioned here, Tested on a fire alarm job): means is an
// entity's exact name. A copy of each project's rows stays on the device,
// so the agent with no signal reads them, and a row saved with no signal
// waits there and is saved on the next load.

// 'placement' (which sheet kinds get marks) is written by the sheet-kind work.
export const MEMORY_KINDS = Object.freeze(['name', 'wording', 'state', 'placement']);
export const MEMORY_LIMITS = Object.freeze({ heard: 120, means: 200, perProject: 500 });

/** The spoken form folded for matching, as the database's heard_key. */
export const memoryKey = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

// The device's copy of a project's rows (and rows still waiting to be saved).
const localKey = (projectId) => `survey.agent.memory.v1.${projectId}`;
const readLocal = (projectId) => {
  try {
    const rows = JSON.parse(globalThis.localStorage?.getItem(localKey(projectId)) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
};
const writeLocal = (projectId, rows) => {
  try { globalThis.localStorage?.setItem(localKey(projectId), JSON.stringify(rows)); } catch { /* storage full or off */ }
};
const sameRow = (a, b) => a.kind === b.kind && memoryKey(a.heard) === memoryKey(b.heard);

/**
 * A store over one Supabase client. list() is cached per project and shared,
 * so the item lookups (sync) can read what the last load found.
 */
export function createAgentMemoryStore(client) {
  const cache = new Map();
  const loading = new Map();
  const listeners = new Set();
  const notify = (projectId) => listeners.forEach((fn) => { try { fn(projectId); } catch { /* listener */ } });
  const put = (projectId, rows) => {
    // Rows saved with no signal stay until they are saved for real.
    const waiting = readLocal(projectId).filter((r) => r.pending && !rows.some((x) => sameRow(x, r)));
    const all = [...rows.filter((r) => !waiting.some((w) => sameRow(w, r))), ...waiting];
    cache.set(projectId, all);
    writeLocal(projectId, all);
    notify(projectId);
    return all;
  };
  const table = () => client.from('survey_agent_memory');

  const store = {
    /** Rows loaded for a project (else the device's copy), or []. */
    cached(projectId) {
      if (!projectId) return [];
      if (cache.has(projectId)) return cache.get(projectId);
      const local = readLocal(projectId);
      if (local.length) cache.set(projectId, local);
      return local;
    },
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
      // Then save what was learned with no signal (each once; a failure keeps it waiting).
      run.then((rows) => {
        const waiting = rows.filter((r) => r.pending);
        if (!waiting.length) return;
        (async () => {
          for (const r of waiting) {
            try {
              await store.save(projectId, { kind: r.kind, heard: r.heard, means: r.means });
            } catch { /* still no signal: keep it */ }
          }
        })();
      }, () => {});
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
      // A row still waiting on the device is replaced, not updated.
      const rows = (await store.list(projectId)).filter((r) => !(r.pending && r.kind === kind && memoryKey(r.heard) === memoryKey(h)));
      const found = rows.find((r) => !r.pending && r.kind === kind && memoryKey(r.heard) === memoryKey(h));
      const before = found ? { ...found } : null;
      if (before && before.heard === h && before.means === m) return { row: before, before: null, same: true };
      if (!before && rows.length >= MEMORY_LIMITS.perProject) throw new Error(`This project already has ${MEMORY_LIMITS.perProject} saved names and wordings. Remove some under What Survey learned.`);
      const query = before
        ? table().update({ heard: h, means: m }).eq('id', before.id)
        : table().insert({ project_id: projectId, kind, heard: h, means: m });
      const { data, error } = await query.select('id, kind, heard, means, created_at').single();
      if (error) throw new Error(error.message || 'Could not save that.');
      writeLocal(projectId, readLocal(projectId).filter((r) => !(r.pending && sameRow(r, data))));
      put(projectId, before ? rows.map((r) => (r.id === before.id ? data : r)) : [...rows, data]);
      return { row: data, before };
    },
    /**
     * Saves on the device only, for when there is no signal: the agent reads
     * it at once, and it is saved for the project on the next load.
     */
    saveLater(projectId, { kind, heard, means }) {
      if (!projectId || !MEMORY_KINDS.includes(kind)) throw new Error('Unknown kind of memory.');
      const h = clean(heard, MEMORY_LIMITS.heard);
      const m = clean(means, MEMORY_LIMITS.means);
      if (!h || !m) throw new Error('Both what is said and what it means are needed.');
      const row = { id: `local-${Date.now()}`, kind, heard: h, means: m, pending: true, created_at: new Date().toISOString() };
      const rows = store.cached(projectId).filter((r) => !sameRow(r, row));
      writeLocal(projectId, [...readLocal(projectId).filter((r) => !sameRow(r, row)), row]);
      return { row, rows: put(projectId, [...rows.filter((r) => !r.pending), row]) };
    },
    async remove(projectId, id) {
      const local = readLocal(projectId);
      if (local.some((r) => r.id === id)) writeLocal(projectId, local.filter((r) => r.id !== id));
      const { error } = String(id).startsWith('local-') ? {} : await table().delete().eq('id', id);
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

/** The entity name a learned state word means ("done" -> Commissioned), or null. */
export function learnedStateFor(rows, heard) {
  const key = memoryKey(heard);
  if (!key) return null;
  const row = (rows || []).find((r) => r.kind === 'state' && memoryKey(r.heard) === key);
  return row ? row.means : null;
}

/** Learned rows as the model sees them: [heard, means] pairs per kind. */
export function learnedForModel(rows, max = 100) {
  const pick = (kind) => (rows || []).filter((r) => r.kind === kind).slice(-max).map((r) => [r.heard, r.means]);
  const states = pick('state');
  return { names: pick('name'), wording: pick('wording'), ...(states.length ? { states } : {}) };
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
