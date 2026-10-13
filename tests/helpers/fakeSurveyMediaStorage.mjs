// A fake Supabase client for the survey-media bucket that mirrors the storage
// policies in supabase/proposed/20261001_survey_media_bucket.sql:
//   read   (list)   - the uploader, or anyone with viewer access to the document;
//   delete (remove) - the uploader, or the document's OWNER (while its row exists).
// Like the real Storage API, a delete that row-level security refuses is not an
// error: the object is just missing from the returned list. `offline` makes
// every call throw the way fetch does without a connection.
export function fakeSurveyMediaCloud({ uid, documents = {}, objects = {} } = {}) {
  const state = {
    uid,
    offline: false,
    // documentId -> { owner, members: [uid...] }
    documents: new Map(Object.entries(documents)),
    // path -> uploader uid
    objects: new Map(Object.entries(objects)),
    calls: { remove: [], list: [], rpc: [] },
  };
  const docOf = (path) => String(path).split('/')[0];
  const docRow = (path) => state.documents.get(docOf(path)) || null;
  const canRead = (path) => {
    if (state.objects.get(path) === state.uid) return true;
    const doc = docRow(path);
    return Boolean(doc && (doc.owner === state.uid || (doc.members || []).includes(state.uid)));
  };
  const canDelete = (path) => state.objects.get(path) === state.uid || docRow(path)?.owner === state.uid;
  const failIfOffline = () => {
    if (state.offline) throw new TypeError('Failed to fetch');
  };

  const bucket = {
    async remove(paths) {
      failIfOffline();
      state.calls.remove.push([...paths]);
      const data = [];
      for (const path of paths) {
        if (state.objects.has(path) && canDelete(path)) {
          state.objects.delete(path);
          data.push({ name: path });
        }
      }
      return { data, error: null };
    },
    async list(prefix, { limit = 100, offset = 0 } = {}) {
      failIfOffline();
      state.calls.list.push(prefix);
      const base = `${String(prefix).replace(/\/$/, '')}/`;
      const entries = new Map();
      for (const path of state.objects.keys()) {
        if (!path.startsWith(base) || !canRead(path)) continue;
        const rest = path.slice(base.length);
        const slash = rest.indexOf('/');
        if (slash >= 0) entries.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
        else entries.set(rest, { name: rest, id: `id-${rest}` });
      }
      return { data: [...entries.values()].slice(offset, offset + limit), error: null };
    },
  };

  const client = {
    auth: { getSession: async () => ({ data: { session: state.uid ? { user: { id: state.uid }, access_token: 'jwt' } : null } }) },
    storage: { from: () => bucket },
  };
  return { client, state };
}

/** In-memory localStorage stand-in. `broken` makes every call throw. */
export function memoryStorage({ broken = false } = {}) {
  const map = new Map();
  const guard = () => { if (broken) throw new Error('SecurityError: storage disabled'); };
  return {
    map,
    getItem: (key) => { guard(); return map.has(key) ? map.get(key) : null; },
    setItem: (key, value) => { guard(); map.set(key, String(value)); },
    removeItem: (key) => { guard(); map.delete(key); },
  };
}
