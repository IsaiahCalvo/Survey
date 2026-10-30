// Open speed: a cloud document's open needs two server answers before pdf.js
// can start: Storage's per-open access check (object info) and the signed URL
// it streams from. The viewer used to ask for both only once its chunk had
// downloaded, mounted and run its load effect, about 0.4 s after "Open file"
// on a fast machine, behind the viewer's own burst of requests. Now the open
// asks the moment the tab is created (AppShell.handleDocumentSelect) and the
// viewer's openDocumentStream picks up those same two answers.
//
// Nothing else changes: the same two requests, under the same session, made
// once per open. An answer is only handed over once, only to the same account
// and path, only while it is fresh (HEAD_START_MAX_AGE_MS), and only when the
// device byte cache saw no change to that path in between (its generation and
// path epoch: an upload, replace, delete or sign-out). Anything else is
// dropped and the viewer asks again exactly as before.
export const HEAD_START_MAX_AGE_MS = 15_000;

const settle = (run) => Promise.resolve()
  .then(run)
  .catch((error) => ({ data: null, error }));

export function createOpenSourceHeadStarts({ now = () => Date.now(), maxAgeMs = HEAD_START_MAX_AGE_MS } = {}) {
  const entries = new Map();
  const prune = () => {
    const t = now();
    for (const [key, entry] of entries) if (t - entry.at > maxAgeMs) entries.delete(key);
  };
  return {
    /**
     * Ask now. `stamp` names the byte cache state the answers belong to.
     * `readCached` (optional) reads this device's copy alongside: unverified
     * until the access check names its version (the viewer checks).
     */
    start(key, { fetchInfo, sign, stamp, readCached }) {
      if (!key || typeof fetchInfo !== 'function' || typeof sign !== 'function') return false;
      prune();
      const entry = { at: now(), stamp, info: settle(fetchInfo), signing: settle(sign), cached: null };
      if (typeof readCached === 'function') {
        entry.cached = Promise.resolve().then(readCached).catch(() => null);
        // An open that never comes does not keep the file's bytes in memory.
        entry.expire = setTimeout(() => { if (entries.get(key) === entry) entries.delete(key); }, maxAgeMs);
      }
      entries.set(key, entry);
      return true;
    },
    /** The answers for this open, or null to ask again. Each start is taken once. */
    take(key, stamp) {
      const entry = key ? entries.get(key) : null;
      if (!entry) return null;
      entries.delete(key);
      clearTimeout(entry.expire);
      if (now() - entry.at > maxAgeMs || entry.stamp !== stamp) return null;
      return { info: entry.info, signing: entry.signing, cached: entry.cached };
    },
    get size() { prune(); return entries.size; },
  };
}

/** The byte cache state an answer belongs to (see pdfByteCache put()). */
export function openSourceCacheStamp(cache, path) {
  if (!cache) return 'no-cache';
  return `${cache.generation ?? ''}:${cache.pathEpoch?.(path) ?? ''}`;
}

let shared = null;
export function openSourceHeadStarts() {
  if (!shared) shared = createOpenSourceHeadStarts();
  return shared;
}
