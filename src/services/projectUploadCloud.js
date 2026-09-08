import { buildDocumentProvenance } from '../utils/documentProvenance.js';
import { computeContentSha256 } from './contentHash.js';
import { storageDownloads } from './storageDownloads.js';

const scopes = new WeakMap();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PROJECT_COLUMNS = 'id,user_id,name,archived,user_archived_at';
const DOCUMENT_COLUMNS = 'id,user_id,project_id,name,file_path,file_size,content_sha256,page_count,name_aliases,archived,user_archived_at,updated_at';

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function retired() { return failure('PROJECT_UPLOAD_RETIRED', 'This upload no longer belongs to the current account session.'); }
function requireValue(condition, message) { if (!condition) throw failure('PROJECT_UPLOAD_INVALID', message); }
function uuid(value) { requireValue(typeof value === 'string' && UUID.test(value), 'An exact cloud ID is required.'); return value; }
function hash(value) { requireValue(typeof value === 'string' && SHA256.test(value), 'A SHA-256 content hash is required.'); return value; }
function plainRow(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function conflict(message) { return failure('PROJECT_UPLOAD_CONFLICT', message); }
function storageObjectExists(error) {
  return error?.status === 409 || ['409', 'ResourceAlreadyExists'].includes(String(error?.statusCode || error?.code || ''));
}
function textArrayLiteral(values) {
  return `{${values.map(value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

function clientScope(client) {
  let scope = scopes.get(client);
  if (scope) return scope;
  requireValue(typeof client.auth?.getSession === 'function' && typeof client.auth?.onAuthStateChange === 'function', 'An authenticated cloud client is required.');
  scope = { generation: 0, actor: undefined, token: undefined, initialSeen: false, controller: new AbortController() };
  scopes.set(client, scope);
  try {
    // One synchronous listener per client lifetime. Never acquire the auth
    // session lock from an auth callback; no per-file subscriptions accumulate.
    client.auth.onAuthStateChange((event, session) => {
      const actor = session?.user?.id ?? null;
      const initial = event === 'INITIAL_SESSION' && !scope.initialSeen && (scope.actor === undefined || scope.actor === actor);
      const repeated = event === 'SIGNED_IN' && actor && actor === scope.actor && session?.access_token && session.access_token === scope.token;
      if (event === 'INITIAL_SESSION') scope.initialSeen = true;
      if (!initial && !repeated && !(event === 'TOKEN_REFRESHED' && scope.actor === actor)) {
        scope.generation++;
        scope.controller.abort(retired());
        scope.controller = new AbortController();
      }
      scope.actor = actor;
      scope.token = session?.access_token;
    });
  } catch (error) { scopes.delete(client); throw error; }
  return scope;
}

function bounded(operation, signals, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const listeners = [];
    let timer;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
      callback(value);
    };
    const abort = error => { controller.abort(error); finish(reject, error); };
    for (const signal of signals.filter(Boolean)) {
      const listener = () => abort(retired());
      if (signal.aborted) { abort(retired()); break; }
      signal.addEventListener('abort', listener, { once: true }); listeners.push([signal, listener]);
    }
    if (settled) return;
    timer = setTimeout(() => abort(failure('PROJECT_UPLOAD_TIMEOUT', 'Cloud request timed out; its remote result is not confirmed.')), timeoutMs);
    // Keep observing the operation after timeout/cancellation. A late HTTP
    // rejection must not become unhandled or acknowledge an already retired job.
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return operation(controller.signal);
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/** Scoped transport for the durable project-upload engine. No cleanup, dedup,
 * unarchive, or implicit retry occurs here. Timeouts leave uncertain work for
 * the engine to reconcile with its stable IDs and exact content paths.
 *
 * Installed storage-js supports upload headers but NOT a fetch AbortSignal.
 * Its upload timeout is logical only: the remote upload can finish later.
 * Paths that contain a hash are NOT immutable in the rest of this app. This
 * adapter therefore uses actor/project/hash paths, creates only, never
 * overwrites, and verifies downloaded bytes only on an existing-object conflict
 * in that same queued project namespace. Other projects' shared paths are never
 * adopted. Row requests/downloads use fetch abort.
 * updateDocument requires the exact object from readDocument/findDocumentByHash;
 * its private snapshot binds a patch to the fields actually read by its caller.
 */
export async function createProjectUploadCloud({ client, actorId, tier, isCurrent, signal,
  requestTimeoutMs = 30_000, uploadTimeoutMs = 120_000 } = {}) {
  uuid(actorId);
  requireValue(client && typeof isCurrent === 'function', 'Cloud client and current-scope guard are required.');
  for (const timeout of [requestTimeoutMs, uploadTimeoutMs]) requireValue(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 300_000, 'Invalid cloud request timeout.');
  if (signal?.aborted || !isCurrent()) throw retired();
  const scope = clientScope(client);
  const generation = scope.generation;
  const authSignal = scope.controller.signal;
  const assertCurrent = () => {
    if (signal?.aborted || authSignal.aborted || !isCurrent() || scope.generation !== generation
      || (scope.actor !== undefined && scope.actor !== actorId)) throw retired();
  };
  const run = (operation, timeout = requestTimeoutMs) => bounded(async requestSignal => {
    const check = () => { if (requestSignal.aborted) throw requestSignal.reason; assertCurrent(); };
    check();
    const result = await operation(requestSignal, check);
    check();
    return result;
  }, [signal, authSignal], timeout);
  const readSession = async check => {
    check();
    const { data, error } = await client.auth.getSession();
    check();
    const session = data?.session;
    if (error || session?.user?.id !== actorId || !session?.access_token) throw retired();
    return session;
  };
  const session = await run((_signal, check) => readSession(check));
  assertCurrent();
  scope.actor = actorId;
  if (scope.token === undefined) scope.token = session.access_token;
  const accessToken = session.access_token;
  const readProofs = new WeakMap();
  const rowRequest = (build, validate) => run(async (requestSignal, check) => {
    await readSession(check);
    check();
    const result = await build().setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(requestSignal);
    check();
    if (result.error) throw result.error;
    return validate(result.data);
  });
  const ownedProject = (row, expectedId) => {
    requireValue(plainRow(row) && row.id === expectedId && row.user_id === actorId && typeof row.name === 'string', 'Cloud project does not match the queued owner and ID.');
    return row;
  };
  const exactPath = (value, sha, projectId) => {
    uuid(projectId);
    requireValue(typeof value === 'string' && value === `${actorId}/${projectId}/${hash(sha)}.pdf`, 'Only this account and project’s exact content-addressed PDF path is allowed.');
    return value;
  };
  const ownedDocument = (row, expected = {}) => {
    requireValue(plainRow(row) && row.user_id === actorId, 'Cloud document does not match the queued owner.');
    uuid(row.id); uuid(row.project_id); exactPath(row.file_path, row.content_sha256, row.project_id);
    requireValue(Number.isSafeInteger(row.file_size) && row.file_size >= 0, 'Cloud document size is invalid.');
    for (const [key, value] of Object.entries(expected)) requireValue(row[key] === value, `Cloud document ${key} does not match the queued record.`);
    return row;
  };
  const rememberRead = row => {
    readProofs.set(row, { ...row, name_aliases: Array.isArray(row.name_aliases) ? [...row.name_aliases] : row.name_aliases });
    return row;
  };

  return {
    async readProject(id) {
      uuid(id);
      return rowRequest(() => client.from('projects').select(PROJECT_COLUMNS).eq('id', id).eq('user_id', actorId).maybeSingle(),
        row => row === null ? null : ownedProject(row, id));
    },
    async createProject(record) {
      requireValue(plainRow(record), 'Project record is required.'); uuid(record.id);
      requireValue(record.user_id === actorId && typeof record.name === 'string' && record.name.trim(), 'Project owner and name are required.');
      requireValue(Object.keys(record).every(key => ['id', 'user_id', 'name'].includes(key)), 'Unexpected project upload fields.');
      const payload = { ...record };
      return rowRequest(() => client.from('projects').insert(payload).select(PROJECT_COLUMNS).single(), row => {
        ownedProject(row, payload.id); requireValue(row.name === payload.name, 'Cloud project name does not match the queue.'); return row;
      });
    },
    async readDocument(id) {
      uuid(id);
      return rowRequest(() => client.from('documents').select(DOCUMENT_COLUMNS).eq('id', id).eq('user_id', actorId).maybeSingle(),
        row => row === null ? null : rememberRead(ownedDocument(row, { id })));
    },
    async findDocumentByHash(projectId, sha) {
      uuid(projectId); hash(sha);
      return rowRequest(() => client.from('documents').select(DOCUMENT_COLUMNS).eq('user_id', actorId)
        .eq('project_id', projectId).eq('content_sha256', sha).limit(2).maybeSingle(),
      row => row === null ? null : rememberRead(ownedDocument(row, { project_id: projectId, content_sha256: sha })));
    },
    async uploadFile(filePath, blob) {
      const parts = typeof filePath === 'string' ? filePath.split('/') : [];
      requireValue(parts.length === 3, 'Upload path must contain the exact account, project and PDF hash.');
      const projectId = parts[1];
      const sha = parts[2].slice(0, -4);
      exactPath(filePath, sha, projectId);
      requireValue(blob instanceof Blob && blob.size > 0, 'Upload requires retained PDF bytes.');
      return run(async (requestSignal, check) => {
        const bytes = await blob.arrayBuffer(); check();
        const actualHash = await computeContentSha256(bytes); check();
        requireValue(actualHash === sha, 'Retained PDF bytes do not match the queued storage path.');
        await readSession(check); check();
        const result = await client.storage.from('documents').upload(filePath, blob, {
          upsert: false, contentType: 'application/pdf', cacheControl: '3600',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        check();
        if (result.error) {
          if (!storageObjectExists(result.error)) throw result.error;
          await readSession(check); check();
          // A separate bucket object prevents changing the shared client. The
          // supported download parameters carry a real fetch abort signal.
          const existing = await client.storage.from('documents')
            .setHeader('Authorization', `Bearer ${accessToken}`).setHeader('Cache-Control', 'no-cache')
            .download(filePath, { cacheNonce: globalThis.crypto.randomUUID() }, { signal: requestSignal, cache: 'no-store' });
          check();
          if (existing.error) throw existing.error;
          if (!(existing.data instanceof Blob) || existing.data.size !== blob.size) throw conflict('The existing PDF has different bytes; it was not overwritten.');
          const existingBytes = await existing.data.arrayBuffer(); check();
          const existingHash = await computeContentSha256(existingBytes); check();
          if (existingHash !== sha) throw conflict('The existing PDF has different bytes; it was not overwritten.');
        } else {
          requireValue(result.data?.path === filePath && result.data?.fullPath === `documents/${filePath}`, 'Storage did not confirm the exact queued PDF path.');
        }
        storageDownloads(client).invalidate(filePath);
        return filePath;
      }, uploadTimeoutMs);
    },
    async createDocument(record) {
      ownedDocument(record);
      requireValue(typeof record.name === 'string' && record.name.trim() && record.archived === false, 'A new, unarchived document name is required.');
      requireValue(record.page_count === null || (Number.isSafeInteger(record.page_count) && record.page_count > 0), 'Invalid initial PDF page count.');
      requireValue(Object.keys(record).every(key => ['id', 'user_id', 'project_id', 'name', 'file_path', 'file_size', 'content_sha256', 'page_count', 'archived', 'name_aliases'].includes(key)), 'Unexpected document upload fields.');
      const payload = { ...record, ...buildDocumentProvenance({ subscriptionTier: tier }) };
      if ('name_aliases' in record) {
        requireValue(Array.isArray(record.name_aliases) && record.name_aliases.every(name => typeof name === 'string' && name.trim()), 'Invalid PDF name aliases.');
        payload.name_aliases = [...record.name_aliases];
      }
      return rowRequest(() => client.from('documents').insert(payload).select(DOCUMENT_COLUMNS).single(),
        row => ownedDocument(row, { id: payload.id, project_id: payload.project_id, content_sha256: payload.content_sha256,
          file_path: payload.file_path, file_size: payload.file_size, name: payload.name, archived: false }));
    },
    async updateDocument(id, patch, expectedRow) {
      uuid(id);
      const proof = expectedRow && readProofs.get(expectedRow);
      if (!proof || proof.id !== id || proof.archived !== false || proof.user_archived_at !== null) throw conflict('Read the current unarchived document before updating its upload metadata.');
      requireValue(plainRow(patch) && Object.keys(patch).length > 0 && Object.keys(patch).every(key => ['page_count', 'name_aliases'].includes(key)), 'Only upload page count and aliases may be updated.');
      if ('page_count' in patch) requireValue(Number.isSafeInteger(patch.page_count) && patch.page_count > 0, 'Invalid PDF page count.');
      if ('name_aliases' in patch) requireValue(Array.isArray(patch.name_aliases) && patch.name_aliases.every(name => typeof name === 'string' && name.trim()), 'Invalid PDF name aliases.');
      const payload = { ...patch };
      if ('name_aliases' in patch) payload.name_aliases = [...patch.name_aliases];
      if ('name_aliases' in payload) requireValue(proof.name_aliases === null || (Array.isArray(proof.name_aliases) && proof.name_aliases.every(name => typeof name === 'string')), 'The read has no valid alias snapshot.');
      if ('page_count' in payload) requireValue(proof.page_count === null || (Number.isSafeInteger(proof.page_count) && proof.page_count > 0), 'The read has no valid page-count snapshot.');
      return rowRequest(() => {
        let query = client.from('documents').update(payload).eq('id', id).eq('user_id', actorId)
          .eq('project_id', proof.project_id).eq('content_sha256', proof.content_sha256)
          .eq('file_path', proof.file_path).eq('file_size', proof.file_size)
          .eq('archived', false).is('user_archived_at', null);
        if (typeof proof.updated_at === 'string' && proof.updated_at) query = query.eq('updated_at', proof.updated_at);
        // Timestamps alone are not a CAS guarantee: the exact old patched
        // fields must still match even if another writer leaves updated_at alone.
        for (const key of Object.keys(payload)) {
          query = proof[key] === null ? query.is(key, null)
            : query.eq(key, key === 'name_aliases' ? textArrayLiteral(proof[key]) : proof[key]);
        }
        return query.select(DOCUMENT_COLUMNS).maybeSingle();
      }, row => {
        if (!row) throw conflict('The document changed before its upload metadata could be saved. Read it again before retrying.');
        ownedDocument(row, { id });
        for (const key of Object.keys(payload)) requireValue(JSON.stringify(row[key]) === JSON.stringify(payload[key]), 'Cloud update did not confirm the requested upload metadata.');
        return row;
      });
    },
  };
}
