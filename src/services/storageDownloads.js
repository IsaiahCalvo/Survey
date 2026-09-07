/** Share only pending downloads. Never retain private PDF bytes after a read:
 * later opens must still pass the server's current access checks. */
export function createStorageDownloads() {
  const pending = new Map();
  let generation = 0;
  return {
    read(actorId, path, download) {
      const key = JSON.stringify([actorId || null, path]);
      const existing = pending.get(key);
      if (existing) return existing.promise;
      const entry = { path, promise: null };
      const startedIn = generation;
      entry.promise = Promise.resolve().then(download).then((result) => {
        if (startedIn !== generation) {
          const error = new Error('The account changed while this file was downloading. Please reopen it.');
          error.name = 'AbortError';
          throw error;
        }
        return result;
      }).finally(() => {
        if (pending.get(key) === entry) pending.delete(key);
      });
      pending.set(key, entry);
      return entry.promise;
    },
    // A write or delete may race an older read. New readers must not join it.
    invalidate(path) {
      for (const [key, entry] of pending) {
        if (entry.path === path) pending.delete(key);
      }
    },
    clear() { generation++; pending.clear(); },
  };
}

const clients = new WeakMap();
export function storageDownloads(client) {
  let downloads = clients.get(client);
  if (!downloads) {
    downloads = createStorageDownloads();
    // Supabase invokes this synchronously. Never call async auth methods here.
    let actorId;
    client.auth?.onAuthStateChange?.((event, session) => {
      const nextActor = session?.user?.id ?? null;
      const initial = event === 'INITIAL_SESSION' && actorId === undefined;
      if (!initial && (event !== 'TOKEN_REFRESHED' || actorId !== nextActor)) downloads.clear();
      actorId = nextActor;
    });
    clients.set(client, downloads);
  }
  return downloads;
}
