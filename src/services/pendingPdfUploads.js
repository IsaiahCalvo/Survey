// A just-uploaded document can be opened by its cloud path before its bytes
// are in Storage: the upload flow creates the row first and stores the file in
// the background. An open in that window read "object not found" and showed
// "Couldn't open this PDF" until a retry. Reads of a path this device is still
// uploading wait for that upload first (a failed upload just lets the read go
// ahead and report what Storage says).
const pending = new Map();

export function trackPdfUpload(path, promise) {
  if (!path || !promise) return promise;
  const entry = Promise.resolve(promise).then(() => {}, () => {});
  pending.set(path, entry);
  entry.then(() => { if (pending.get(path) === entry) pending.delete(path); });
  return promise;
}

export function waitForPdfUpload(path, { timeoutMs = 60_000 } = {}) {
  const entry = path ? pending.get(path) : null;
  if (!entry) return Promise.resolve();
  let timer;
  return Promise.race([entry, new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })])
    .finally(() => clearTimeout(timer));
}
