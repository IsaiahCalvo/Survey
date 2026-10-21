// Hands a finished PDF from a free tool to the Survey app on the same site:
// the tool page stores it here, then goes to /?open=tools, and the app takes
// it out on load and opens it in a tab. The file stays in this browser.
const DB = 'survey-tools-handoff';
const STORE = 'files';
const KEY = 'latest';
// A file left behind (the app never loaded) isn't opened by surprise later.
const MAX_AGE_MS = 10 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(out?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export function putHandoff(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  return run('readwrite', (s) => s.put({ blob, name, at: Date.now() }, KEY));
}

// The waiting file as a File, or null. Taking it removes it.
export async function takeHandoff() {
  let entry;
  try {
    entry = await run('readwrite', (s) => {
      const req = s.get(KEY);
      s.delete(KEY);
      return req;
    });
  } catch {
    return null;
  }
  if (!entry?.blob || Date.now() - entry.at > MAX_AGE_MS) return null;
  return new File([entry.blob], entry.name || 'document.pdf', { type: 'application/pdf' });
}
