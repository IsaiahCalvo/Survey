/**
 * signatureStore.js — the person's saved signatures (Nightly 'signature-tool',
 * Drawboard PDF Pro push 2026-11-12, drawboard-trial/pdf-pro/apps-side-by-side.md A8).
 *
 * Kept on this device (localStorage), newest first, at most
 * SIGNATURE_LIMIT. Each is { id, title, src (PNG data URL), width, height }
 * where width / height are the picture's CSS pixels (it lands at 0.75 pt each,
 * like any inserted picture).
 */
export const SIGNATURES_STORAGE_KEY = 'survey.signatures.v1';
export const SIGNATURE_LIMIT = 12;
const MAX_SRC_BYTES = 400 * 1024;

const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function safeStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** Only well-formed rows survive a load (a hand-edited or old store never breaks the card). */
export function cleanSignatures(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((row) => row && typeof row.id === 'string'
    && typeof row.src === 'string' && /^data:image\/png;base64,/i.test(row.src) && row.src.length <= MAX_SRC_BYTES
    && Number(row.width) > 0 && Number(row.height) > 0)
    .map((row) => ({
      id: row.id,
      title: String(row.title || 'Signature').slice(0, 60),
      src: row.src,
      width: Number(row.width),
      height: Number(row.height),
    }))
    .slice(0, SIGNATURE_LIMIT);
}

export function createSignatureStore({ storage = safeStorage(), key = SIGNATURES_STORAGE_KEY } = {}) {
  const listeners = new Set();
  let list = [];
  try { list = cleanSignatures(JSON.parse(storage?.getItem(key) || '[]')); } catch { list = []; }
  const save = () => {
    try { storage?.setItem(key, JSON.stringify(list)); } catch { /* a full store keeps the list for this visit */ }
    listeners.forEach((fn) => fn());
  };
  return {
    get: () => list,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    add({ title, src, width, height }) {
      const [row] = cleanSignatures([{ id: newId(), title, src, width, height }]);
      if (!row) return null;
      list = [row, ...list].slice(0, SIGNATURE_LIMIT);
      save();
      return row;
    },
    remove(id) {
      const next = list.filter((row) => row.id !== id);
      if (next.length === list.length) return;
      list = next;
      save();
    },
  };
}

let shared = null;
export function getSignatureStore() {
  if (!shared) shared = createSignatureStore();
  return shared;
}
