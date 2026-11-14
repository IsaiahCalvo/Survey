/**
 * The file a desktop document was opened from (Nightly flag
 * `local-file-link`, 2026-11-14).
 *
 * Drawboard PDF for Mac copies an opened file into its own folder, writes the
 * copy back over the original on Save, and never notices another app changing
 * the original meanwhile: its next Save silently wipes that app's work
 * (drawboard-trial/file-model/adobe-round-trip-2026-11-14.md). Survey's
 * desktop app keeps the document in the cloud and, before this, never wrote
 * back to the file at all.
 *
 * This link remembers the file's fingerprint (SHA-256) when the document
 * opens, watches the file, and:
 *   - tells the viewer when another app changes or removes it;
 *   - writes the annotated PDF back to it only while it is still the file
 *     Survey last read or wrote, so another app's change is never overwritten.
 *
 * `api` is the desktop bridge (window.electronAPI): readFile, writeFileAtomic,
 * startFileWatcher, stopFileWatcher, onFileChanged. Plain functions so the
 * rules can be tested without Electron.
 */

export const LOCAL_FILE_REOPEN_EVENT = 'survey:local-file-reopen';

const toBytes = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (data && Array.isArray(data.data)) return Uint8Array.from(data.data); // a Buffer sent as JSON
  return new Uint8Array(0);
};

export async function sha256Hex(data) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toBytes(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isMissing = (error) => /ENOENT|no such file|not found/i.test(String(error?.code || error?.message || error || ''));

/** Whether this device can link a document to its file at all. */
export function canLinkLocalFile(api, filePath) {
  return Boolean(filePath && api?.readFile && api?.writeFileAtomic && api?.startFileWatcher && api?.onFileChanged);
}

export function fileNameOf(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || 'the file';
}

/**
 * @param {object} args
 * @param {object} args.api            the desktop bridge
 * @param {string} args.filePath
 * @param {(change: {kind: 'changed', bytes: Uint8Array, sha: string} | {kind: 'gone'}) => void} [args.onOutsideChange]
 * @param {string} [args.watchId]
 */
export function createLocalFileLink({ api, filePath, onOutsideChange = () => {}, watchId = `local-file-link:${filePath}` }) {
  // The fingerprints Survey itself read or wrote. A watcher event whose bytes
  // match one of them is Survey's own write coming back, not another app.
  let knownSha = null;
  const ownWrites = new Set();
  let stopped = false;
  let removeListener = null;
  // An outside change already told to the viewer: told once until it changes again.
  let toldSha = null;

  const read = async () => {
    try {
      const bytes = toBytes(await api.readFile(filePath));
      return { state: 'present', bytes, sha: await sha256Hex(bytes) };
    } catch (error) {
      if (isMissing(error)) return { state: 'gone' };
      throw error;
    }
  };

  const onWatch = async ({ watchId: changedId, event } = {}) => {
    if (stopped || changedId !== watchId) return;
    if (event === 'unlink') {
      if (toldSha !== 'gone') { toldSha = 'gone'; onOutsideChange({ kind: 'gone' }); }
      return;
    }
    let now;
    try { now = await read(); } catch { return; }
    if (stopped) return;
    if (now.state === 'gone') {
      if (toldSha !== 'gone') { toldSha = 'gone'; onOutsideChange({ kind: 'gone' }); }
      return;
    }
    if (now.sha === knownSha || ownWrites.has(now.sha)) return;
    if (now.sha === toldSha) return;
    toldSha = now.sha;
    onOutsideChange({ kind: 'changed', bytes: now.bytes, sha: now.sha });
  };

  return {
    filePath,
    get knownSha() { return knownSha; },

    /** Reads the file once (its fingerprint now) and starts watching it. */
    async start() {
      const first = await read();
      if (first.state === 'gone') throw new Error(`${fileNameOf(filePath)} is no longer there.`);
      knownSha = first.sha;
      removeListener = api.onFileChanged(onWatch);
      await api.startFileWatcher(filePath, watchId);
      return knownSha;
    },

    /**
     * Writes `bytes` over the file if it is still the one Survey knows.
     * Returns { ok: true } or { ok: false, reason: 'changed' | 'gone' }.
     */
    async save(bytes) {
      const data = toBytes(bytes);
      const now = await read();
      if (now.state === 'gone') return { ok: false, reason: 'gone' };
      if (now.sha !== knownSha) return { ok: false, reason: 'changed' };
      const sha = await sha256Hex(data);
      ownWrites.add(sha);
      await api.writeFileAtomic(filePath, data);
      knownSha = sha;
      toldSha = null;
      return { ok: true, sha };
    },

    /** Takes the file as it is now as the one Survey knows (after the person chose to keep theirs). */
    async adoptCurrent() {
      const now = await read();
      if (now.state === 'present') { knownSha = now.sha; toldSha = null; }
      return now.state === 'present' ? now.sha : null;
    },

    async stop() {
      stopped = true;
      try { removeListener?.(); } catch { /* listener already gone */ }
      try { await api.stopFileWatcher?.(watchId); } catch { /* watcher already gone */ }
    },
  };
}
