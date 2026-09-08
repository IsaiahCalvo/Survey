// Recovery data, not a cache. No cloud access, eviction, or in-memory fallback.
export const PROJECT_UPLOAD_JOURNAL_DB_NAME = 'survey-project-upload-journal-v1';
const ATTEMPTS = 'attempts';
const FILES = 'files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const PHASES = ['preparing', 'ready', 'running', 'complete'];
const PROJECT_STATES = ['pending', 'unknown', 'confirmed'];
const FILE_STATES = ['pending', 'staged', 'storage-pending', 'storage-confirmed', 'document-pending', 'confirmed'];
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { name: 'ProjectUploadJournalError', code });
const check = (condition, message) => { if (!condition) throw fail('invalid-input', message); };
const id = value => check(typeof value === 'string' && UUID.test(value), 'A valid lowercase UUID is required.');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, max = 1024) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const keys = (value, allowed) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key)), 'Unsupported metadata fields.');
const errorText = value => check(value === null || (typeof value === 'string' && value.length <= 4096), 'Invalid error text.');
function path(value, actorId) {
  check(text(value, 2048) && value.startsWith(`${actorId}/`) && !/[\\%?#]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..'), 'The file path must belong to this actor.');
}
function fileInput(file) {
  keys(file, ['id', 'documentId', 'name', 'sourceName', 'size', 'type', 'lastModified']);
  id(file.id); id(file.documentId);
  check(text(file.name) && text(file.sourceName) && !/[\\/]/.test(file.name + file.sourceName), 'Valid file names are required.');
  check(integer(file.size) && file.size > 0 && integer(file.lastModified), 'Invalid file size or modification time.');
  check(file.type === 'application/pdf' || file.type === '', 'Only PDF files can be staged.');
  return { ...file, candidateDocumentId: file.documentId, state: 'pending', contentSha: null, filePath: null, pageCount: null, error: null };
}
function validate(row, actorId, attemptId) {
  try {
    check(row && row.actorId === actorId && row.id === attemptId && row.version === 1, 'Invalid attempt identity or version.');
    id(row.actorId); id(row.id); id(row.projectId);
    check(text(row.name) && integer(row.revision) && row.revision > 0, 'Invalid attempt metadata.');
    check(PHASES.includes(row.phase) && PROJECT_STATES.includes(row.projectState), 'Invalid attempt state.');
    check(typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
      && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)), 'Invalid attempt timestamps.');
    errorText(row.error);
    check(Array.isArray(row.files), 'An attempt needs a file list.');
    const ids = new Set();
    for (const file of row.files) {
      fileInput(Object.fromEntries(['id', 'documentId', 'name', 'sourceName', 'size', 'type', 'lastModified'].map(key => [key, file[key]])));
      id(file.candidateDocumentId);
      check(!ids.has(file.id), 'File IDs must be unique.'); ids.add(file.id);
      check(FILE_STATES.includes(file.state), 'Invalid file state.'); errorText(file.error);
      check(file.pageCount === null || (integer(file.pageCount) && file.pageCount > 0), 'Invalid page count.');
      if (file.state !== 'pending') {
        check(typeof file.contentSha === 'string' && HASH.test(file.contentSha), 'Invalid file hash.'); path(file.filePath, actorId);
        check(file.filePath === `${actorId}/${row.projectId}/${file.contentSha}.pdf`, 'Invalid project-scoped content-addressed file path.');
      } else check(file.contentSha === null && file.filePath === null, 'Pending files cannot claim staged bytes.');
    }
    check(new TextEncoder().encode(JSON.stringify(row)).byteLength <= MAX_METADATA_BYTES, 'Upload metadata is too large.');
  } catch (error) { throw fail('corrupt', error.message); }
  return row;
}
function notify() {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new window.Event('project-upload-journal-changed')); }
  catch { /* A UI event cannot undo a durable commit. */ }
}

export function createProjectUploadJournal({ indexedDB, dbName = PROJECT_UPLOAD_JOURNAL_DB_NAME, timeoutMs = 10_000 } = {}) {
  check(text(dbName, 1024) && integer(timeoutMs) && timeoutMs > 0, 'Invalid journal options.');
  let connection = null, opening = null, cancelOpen = null, closed = false;
  const activeTransactions = new Set();
  const active = () => { if (closed) throw fail('closed', 'The upload journal is closed.'); };
  async function database() {
    active();
    if (connection) return connection;
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request, settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer); cancelOpen = null;
        if (error) reject(error); else resolve(db);
      };
      const timer = setTimeout(() => finish(fail('timed-out', 'Opening the upload journal timed out.')), timeoutMs);
      cancelOpen = () => { try { request?.transaction?.abort(); } catch { /* already closed */ } finish(fail('closed', 'The upload journal is closed.')); };
      try {
        const factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
        if (!factory?.open) throw fail('unavailable', 'Durable upload storage is unavailable.');
        request = factory.open(dbName, 1);
      } catch (error) { finish(error); return; }
      request.onupgradeneeded = event => {
        if (settled || closed) { request.transaction.abort(); return; }
        try {
          if (event.oldVersion !== 0) throw fail('schema', 'Unsupported upload journal schema.');
          request.result.createObjectStore(ATTEMPTS, { keyPath: ['actorId', 'id'] }).createIndex('actorId', 'actorId');
          request.result.createObjectStore(FILES, { keyPath: ['actorId', 'attemptId', 'fileId'] });
        } catch (error) { request.transaction.abort(); finish(error); }
      };
      request.onblocked = () => finish(fail('blocked', 'The upload journal is blocked by another window.'));
      request.onerror = () => finish(request.error || fail('unavailable', 'The upload journal could not be opened.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); finish(fail('closed', 'The upload journal is closed.')); return; }
        try {
          const tx = db.transaction([ATTEMPTS, FILES], 'readonly');
          const metadata = tx.objectStore(ATTEMPTS), bytes = tx.objectStore(FILES);
          if (JSON.stringify(metadata.keyPath) !== JSON.stringify(['actorId', 'id'])
            || JSON.stringify(bytes.keyPath) !== JSON.stringify(['actorId', 'attemptId', 'fileId'])
            || metadata.index('actorId').keyPath !== 'actorId' || metadata.index('actorId').unique) {
            throw fail('schema', 'The upload journal schema is invalid. Its data was kept.');
          }
        } catch (error) { db.close(); finish(fail('schema', error.message)); return; }
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        finish(null, db);
      };
    }).finally(() => { opening = null; });
    return opening;
  }
  async function transact(names, mode, run) {
    const db = await database(); active();
    return new Promise((resolve, reject) => {
      let tx, result, cause, settled = false;
      try { tx = db.transaction(names, mode); } catch (error) { reject(error); return; }
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); activeTransactions.delete(abort);
        if (error) reject(error); else { if (mode === 'readwrite') notify(); resolve(result); }
      };
      const abort = error => { cause ||= error; try { tx.abort(); } catch { /* already settled */ } finish(cause); };
      activeTransactions.add(abort);
      const timer = setTimeout(() => abort(fail('timed-out', 'The upload journal operation timed out. Its pending data was kept.')), timeoutMs);
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(cause || tx.error || fail('aborted', 'The upload journal operation did not commit.'));
      tx.onerror = event => { cause ||= event.target?.error || tx.error; };
      try { run(tx, value => { result = value; }, abort); } catch (error) { abort(error); }
    });
  }
  function mutate(actorId, attemptId, names, change) {
    id(actorId); id(attemptId);
    return transact(names, 'readwrite', (tx, done, abort) => {
      const store = tx.objectStore(ATTEMPTS), request = store.get([actorId, attemptId]);
      request.onsuccess = () => {
        try {
          if (!request.result) throw fail('not-found', 'This upload attempt was not found for this actor.');
          const row = validate(request.result, actorId, attemptId);
          const next = change(row, tx);
          if (next === null) { done(true); return; }
          next.revision += 1; next.updatedAt = new Date().toISOString();
          validate(next, actorId, attemptId); store.put(next); done(next);
        } catch (error) { abort(error); }
      };
    });
  }
  const find = (row, fileId) => { const file = row.files.find(item => item.id === fileId); if (!file) throw fail('not-found', 'This upload file was not found.'); return file; };
  function remove(actorId, attemptId, requireComplete) {
    return mutate(actorId, attemptId, [ATTEMPTS, FILES], (row, tx) => {
      if (requireComplete && (row.phase !== 'complete' || row.projectState !== 'confirmed' || row.files.some(file => file.state !== 'confirmed'))) {
        throw fail('incomplete', 'The pending upload has not been confirmed. Its local data was kept.');
      }
      for (const file of row.files) tx.objectStore(FILES).delete([actorId, attemptId, file.id]);
      tx.objectStore(ATTEMPTS).delete([actorId, attemptId]);
      return null;
    });
  }
  return {
    async create(actorId, input) {
      id(actorId); keys(input, ['id', 'projectId', 'name', 'files']); id(input.id); id(input.projectId);
      check(text(input.name) && Array.isArray(input.files), 'A project name and file list are required.');
      const now = new Date().toISOString();
      const row = { actorId, id: input.id, projectId: input.projectId, name: input.name, files: input.files.map(fileInput),
        version: 1, revision: 1, createdAt: now, updatedAt: now, phase: 'preparing', projectState: 'pending', error: null };
      validate(row, actorId, input.id);
      return transact([ATTEMPTS], 'readwrite', (tx, done) => { tx.objectStore(ATTEMPTS).add(row); done(row); });
    },
    async get(actorId, attemptId) {
      id(actorId); id(attemptId);
      return transact([ATTEMPTS], 'readonly', (tx, done, abort) => {
        const request = tx.objectStore(ATTEMPTS).get([actorId, attemptId]);
        request.onsuccess = () => { try { done(request.result ? validate(request.result, actorId, attemptId) : null); } catch (error) { abort(error); } };
      });
    },
    async list(actorId) {
      id(actorId);
      return transact([ATTEMPTS], 'readonly', (tx, done, abort) => {
        const request = tx.objectStore(ATTEMPTS).index('actorId').getAll(actorId);
        request.onsuccess = () => { try { done(request.result.map(row => validate(row, actorId, row.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))); } catch (error) { abort(error); } };
      });
    },
    async stageFile(actorId, attemptId, fileId, data, blob) {
      id(actorId); id(fileId); keys(data, ['contentSha', 'filePath']);
      check(typeof data.contentSha === 'string' && HASH.test(data.contentSha), 'Staging requires a valid content hash.');
      path(data.filePath, actorId);
      check(blob instanceof Blob, 'A real Blob is required.');
      const captured = { ...data };
      return mutate(actorId, attemptId, [ATTEMPTS, FILES], (row, tx) => {
        const file = find(row, fileId);
        check(captured.filePath === `${actorId}/${row.projectId}/${captured.contentSha}.pdf`, 'Staging requires the exact project-scoped content hash path.');
        check(row.phase === 'preparing' && file.state === 'pending', 'Only pending files can be staged.');
        check(blob.size === file.size, 'The staged bytes do not match the expected size.');
        tx.objectStore(FILES).add({ actorId, attemptId, fileId, blob });
        Object.assign(file, captured, { state: 'staged', error: null });
        return row;
      });
    },
    async readFile(actorId, attemptId, fileId) {
      id(actorId); id(attemptId); id(fileId);
      return transact([ATTEMPTS, FILES], 'readonly', (tx, done, abort) => {
        const metadata = tx.objectStore(ATTEMPTS).get([actorId, attemptId]);
        metadata.onsuccess = () => {
          try {
            if (!metadata.result) { done(null); return; }
            const file = find(validate(metadata.result, actorId, attemptId), fileId);
            const request = tx.objectStore(FILES).get([actorId, attemptId, fileId]);
            request.onsuccess = () => { try {
              const blob = request.result?.blob;
              if (!blob && file.state === 'pending') { done(null); return; }
              if (!(blob instanceof Blob) || blob.size !== file.size) throw fail('corrupt', 'The staged file bytes are missing or invalid.');
              done(blob);
            } catch (error) { abort(error); } };
          } catch (error) { abort(error); }
        };
      });
    },
    async patchAttempt(actorId, attemptId, patch) {
      keys(patch, ['phase', 'projectState', 'error']); const captured = { ...patch };
      return mutate(actorId, attemptId, [ATTEMPTS], row => {
        if ('phase' in captured) {
          check(PHASES.includes(captured.phase) && PHASES.indexOf(captured.phase) >= PHASES.indexOf(row.phase), 'Invalid upload phase.');
          if (captured.phase !== 'preparing') check(row.files.every(file => file.state !== 'pending'), 'All files must be staged first.');
          if (captured.phase === 'complete') check((captured.projectState ?? row.projectState) === 'confirmed' && row.files.every(file => file.state === 'confirmed'), 'The upload is not complete.');
        }
        if ('projectState' in captured) check(PROJECT_STATES.includes(captured.projectState) && !(row.projectState === 'confirmed' && captured.projectState !== 'confirmed'), 'Invalid project state.');
        if ('error' in captured) errorText(captured.error);
        Object.assign(row, captured); return row;
      });
    },
    async patchFile(actorId, attemptId, fileId, patch) {
      id(fileId); keys(patch, ['state', 'documentId', 'filePath', 'pageCount', 'error']); const captured = { ...patch };
      return mutate(actorId, attemptId, [ATTEMPTS], row => {
        const file = find(row, fileId);
        if ('state' in captured) check(FILE_STATES.includes(captured.state) && file.state !== 'pending'
          && (FILE_STATES.indexOf(captured.state) >= FILE_STATES.indexOf(file.state)
            || (file.state !== 'confirmed' && captured.state === 'storage-pending')), 'Invalid file state transition.');
        // The engine supplies the same-project lookup proof. Bind its ID
        // before any storage write; hash paths and confirmed targets are fixed.
        const canBind = file.state !== 'pending' && file.state !== 'confirmed' && captured.state === 'storage-pending';
        if ('documentId' in captured) {
          id(captured.documentId);
          check(captured.documentId === file.documentId || canBind, 'Document identity must be bound before upload.');
        }
        if ('filePath' in captured) { path(captured.filePath, actorId); check(captured.filePath === `${actorId}/${row.projectId}/${file.contentSha}.pdf` && captured.filePath === file.filePath, 'The project-scoped content-addressed file path is immutable.'); }
        if ('pageCount' in captured) check(integer(captured.pageCount) && captured.pageCount > 0, 'Invalid page count.');
        if ('error' in captured) errorText(captured.error);
        Object.assign(file, captured); return row;
      });
    },
    finish: (actorId, attemptId) => remove(actorId, attemptId, true),
    discard: (actorId, attemptId) => remove(actorId, attemptId, false),
    close() {
      closed = true; cancelOpen?.();
      for (const abort of activeTransactions) abort(fail('closed', 'The upload journal closed before this operation committed.'));
      connection?.close(); connection = null;
    },
  };
}
let defaultJournal;
export function getProjectUploadJournal() {
  return defaultJournal ||= createProjectUploadJournal();
}
