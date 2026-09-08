import { buildDocumentProvenance } from '../utils/documentProvenance.js';
import { computeContentSha256 } from './contentHash.js';
import { storageDownloads } from './storageDownloads.js';

const scopes = new WeakMap();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DOCUMENT_COLUMNS = 'id,user_id,project_id,name,file_path,file_size,content_sha256,page_count,name_aliases,archived,user_archived_at,created_at,updated_at';
const IDENTITY = ['id', 'user_id', 'project_id', 'name', 'file_path', 'content_sha256', 'file_size'];
const fail = (code, message) => Object.assign(new Error(message), { code });
const retired = () => fail('DOCUMENT_UPLOAD_RETIRED', 'This upload no longer belongs to the current account session.');
const conflict = message => fail('DOCUMENT_UPLOAD_CONFLICT', message);
const requireValue = (condition, message) => { if (!condition) throw fail('DOCUMENT_UPLOAD_INVALID', message); };
const uuid = value => requireValue(typeof value === 'string' && UUID.test(value), 'An exact cloud ID is required.');
const hash = value => requireValue(typeof value === 'string' && SHA256.test(value), 'A SHA-256 content hash is required.');
const plainRow = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const status = error => Number(error?.statusCode || error?.status || error?.code);
const objectExists = error => status(error) === 409 || error?.code === 'ResourceAlreadyExists';
const textArrayLiteral = values => `{${values.map(value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

// Keep an auth generation, not just an actor ID: A -> B -> A retires A's old
// work. This mirrors projectUploadCloud without changing its tested contract.
function clientScope(client) {
  let scope = scopes.get(client);
  if (scope) return scope;
  requireValue(typeof client.auth?.getSession === 'function' && typeof client.auth?.onAuthStateChange === 'function', 'An authenticated cloud client is required.');
  scope = { generation: 0, actor: undefined, token: undefined, initialSeen: false, controller: new AbortController() };
  scopes.set(client, scope);
  try {
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
    timer = setTimeout(() => abort(fail('DOCUMENT_UPLOAD_TIMEOUT', 'Cloud request timed out; its remote result is not confirmed.')), timeoutMs);
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return operation(controller.signal);
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/** Single-document transport. New uploads use a private candidate namespace.
 * Existing PDFs are read, never replaced; only an exact missing object may be
 * repaired with verified original bytes. Storage uploads have a logical deadline
 * (the installed SDK cannot abort them); rows/downloads have fetch cancellation.
 */
export async function createDocumentUploadCloud({ client, actorId, tier, isCurrent, signal,
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
    if (error || data?.session?.user?.id !== actorId || !data.session.access_token) throw retired();
    return data.session;
  };
  const session = await run((_signal, check) => readSession(check));
  assertCurrent();
  scope.actor = actorId;
  if (scope.token === undefined) scope.token = session.access_token;
  const accessToken = session.access_token;
  const proofs = new WeakMap();
  const projectId = value => { if (value !== null) uuid(value); };
  const safePath = value => {
    requireValue(typeof value === 'string' && !/[\\%?#\u0000-\u001f\u007f]/.test(value), 'Unsafe document object path.');
    const parts = value.split('/');
    requireValue(parts.length >= 2 && parts[0] === actorId && parts.every(part => part && part !== '.' && part !== '..'), 'The object path must belong to this account.');
    return value;
  };
  const candidatePath = (value, id, sha) => {
    uuid(id); hash(sha);
    requireValue(value === `${actorId}/${id}/${sha}.pdf`, 'A new PDF needs its exact account/document/hash path.');
    return value;
  };
  const owned = (row, expected = {}) => {
    requireValue(plainRow(row) && row.user_id === actorId, 'Cloud document has a different owner.');
    uuid(row.id); projectId(row.project_id); safePath(row.file_path);
    requireValue(typeof row.name === 'string' && row.name.trim(), 'Cloud document name is invalid.');
    // Legacy rows can have an unknown size. Retain null in read/archive
    // snapshots; it must not become permission to create or repair bytes.
    requireValue(row.file_size === null || (Number.isSafeInteger(row.file_size) && row.file_size >= 0), 'Cloud document size is invalid.');
    if (row.content_sha256 !== null) hash(row.content_sha256);
    for (const [key, value] of Object.entries(expected)) requireValue(row[key] === value, `Cloud document ${key} differs from the requested record.`);
    return row;
  };
  const remember = row => {
    owned(row);
    proofs.set(row, { ...row, name_aliases: Array.isArray(row.name_aliases) ? [...row.name_aliases] : row.name_aliases });
    return row;
  };
  const proofOf = row => {
    const proof = row && proofs.get(row);
    if (!proof) throw conflict('Read this document through the current upload session before changing it.');
    return proof;
  };
  const matchIdentity = (row, expected) => {
    if (!row || IDENTITY.some(key => row[key] !== expected[key])) throw conflict('The selected document changed. Read it again before retrying.');
  };
  const rowRequest = async (build, requestSignal, check) => {
    await readSession(check); check();
    const result = await build().setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(requestSignal);
    check();
    if (result.error) throw Object.assign(result.error, { status: result.status });
    return result.data;
  };
  const readDocumentNow = async (id, requestSignal, check) => {
    const row = await rowRequest(() => client.from('documents').select(DOCUMENT_COLUMNS).eq('id', id).eq('user_id', actorId).maybeSingle(), requestSignal, check);
    check();
    return row === null ? null : remember(owned(row, { id }));
  };
  const cas = (proof, payload) => {
    requireValue(typeof proof.updated_at === 'string' && proof.updated_at, 'A timestamped document read is required.');
    let query = client.from('documents').update(payload);
    for (const key of [...IDENTITY, 'updated_at', 'archived', 'user_archived_at']) {
      requireValue(proof[key] !== undefined, 'The document read has no complete update snapshot.');
      query = proof[key] === null ? query.is(key, null) : query.eq(key, proof[key]);
    }
    return query;
  };
  const download = async (path, requestSignal, check) => {
    await readSession(check); check();
    const result = await client.storage.from('documents')
      .setHeader('Authorization', `Bearer ${accessToken}`).setHeader('Cache-Control', 'no-cache')
      .download(path, { cacheNonce: globalThis.crypto.randomUUID() }, { signal: requestSignal, cache: 'no-store' });
    check();
    if (result.error) throw result.error;
    requireValue(result.data instanceof Blob && result.data.size > 0, 'Storage returned no PDF bytes.');
    return result.data;
  };
  const verifyOriginal = async (blob, sha, check, expectedSize = blob?.size) => {
    hash(sha);
    requireValue(blob instanceof Blob && blob.size > 0 && blob.size === expectedSize, 'Retained PDF bytes have the wrong size.');
    const bytes = await blob.arrayBuffer(); check();
    const actual = await computeContentSha256(bytes); check();
    requireValue(actual === sha, 'Retained PDF bytes do not match the original content hash.');
  };
  const upload = async (path, blob, check) => {
    await readSession(check); check();
    const result = await client.storage.from('documents').upload(path, blob, {
      upsert: false, contentType: 'application/pdf', cacheControl: '3600',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    check();
    if (result.error) throw result.error;
    requireValue(result.data?.path === path && result.data?.fullPath === `documents/${path}`, 'Storage did not confirm the exact uploaded PDF path.');
    storageDownloads(client).invalidate(path);
  };
  const confirmMutation = (row, proof, payload) => {
    if (!row) throw conflict('The document changed before the requested update.');
    owned(row); matchIdentity(row, proof);
    for (const [key, value] of Object.entries(payload)) {
      if (JSON.stringify(row[key]) !== JSON.stringify(value)) throw conflict('Cloud did not confirm the exact requested update.');
    }
    if (row.user_archived_at !== null) throw conflict('This document was archived by its owner.');
    return remember(row);
  };

  return {
    async readProject(id) {
      uuid(id);
      return run(async (requestSignal, check) => {
        // RLS exposes shared projects too. Only the permanent owner can skip
        // the server's editor-role check; document/storage ownership stays
        // actor-scoped regardless of who owns the containing project.
        const row = await rowRequest(() => client.from('projects').select('id,user_id,name,archived,user_archived_at').eq('id', id).maybeSingle(), requestSignal, check);
        check();
        if (row === null) return null;
        requireValue(plainRow(row) && row.id === id, 'Cloud project has a different ID.');
        uuid(row.user_id);
        if (row.user_id !== actorId) {
          const permitted = await rowRequest(() => client.rpc('user_can_access_project', { proj_id: id, required_role: 'editor' }), requestSignal, check);
          check();
          if (permitted !== true) throw conflict('The chosen shared project no longer allows file uploads.');
        }
        return { ...row, uploadWritable: true };
      });
    },
    async readDocument(id) { uuid(id); return run((requestSignal, check) => readDocumentNow(id, requestSignal, check)); },
    async findDocumentsByName(id, name) {
      projectId(id);
      requireValue(typeof name === 'string' && name.trim(), 'An exact document name is required.');
      return run(async (requestSignal, check) => {
        const rows = await rowRequest(() => {
          let query = client.from('documents').select(DOCUMENT_COLUMNS).eq('user_id', actorId)
            .eq('name', name).eq('archived', false).is('user_archived_at', null);
          query = id === null ? query.is('project_id', null) : query.eq('project_id', id);
          return query.limit(50);
        }, requestSignal, check);
        check();
        requireValue(Array.isArray(rows) && rows.length <= 50, 'Cloud did not return a bounded document list.');
        return rows.map(row => remember(owned(row, { project_id: id, name, archived: false, user_archived_at: null })));
      });
    },
    async findDocumentByHash(id, sha) {
      projectId(id); hash(sha);
      return run(async (requestSignal, check) => {
        const row = await rowRequest(() => {
          let query = client.from('documents').select(DOCUMENT_COLUMNS).eq('user_id', actorId).eq('content_sha256', sha);
          query = id === null ? query.is('project_id', null) : query.eq('project_id', id);
          return query.limit(2).maybeSingle();
        }, requestSignal, check);
        check();
        return row === null ? null : remember(owned(row, { project_id: id, content_sha256: sha }));
      });
    },
    async uploadFile(path, blob) {
      const parts = typeof path === 'string' ? path.split('/') : [];
      requireValue(parts.length === 3, 'A candidate PDF path is required.');
      const sha = parts[2].slice(0, -4);
      candidatePath(path, parts[1], sha);
      return run(async (requestSignal, check) => {
        await verifyOriginal(blob, sha, check); check();
        try { await upload(path, blob, check); } catch (error) {
          check();
          if (!objectExists(error)) throw error;
          const existing = await download(path, requestSignal, check); check();
          try { await verifyOriginal(existing, sha, check, blob.size); } catch (verifyError) {
            check(); throw conflict('The candidate path contains different bytes; nothing was overwritten.');
          }
          check(); storageDownloads(client).invalidate(path);
        }
        check(); return path;
      }, uploadTimeoutMs);
    },
    async createDocument(record) {
      owned(record); candidatePath(record.file_path, record.id, record.content_sha256);
      requireValue(Number.isSafeInteger(record.file_size) && record.file_size >= 0, 'A new PDF requires an exact file size.');
      requireValue(record.archived === false && (record.page_count === null || (Number.isSafeInteger(record.page_count) && record.page_count > 0)), 'A new unarchived PDF with a valid initial page count is required.');
      requireValue(Object.keys(record).every(key => ['id', 'user_id', 'project_id', 'name', 'file_path', 'file_size', 'content_sha256', 'page_count', 'archived', 'name_aliases'].includes(key)), 'Unexpected document upload fields.');
      const payload = { ...record, ...buildDocumentProvenance({ subscriptionTier: tier }) };
      if ('name_aliases' in record) {
        requireValue(Array.isArray(record.name_aliases) && record.name_aliases.every(name => typeof name === 'string' && name.trim()), 'Invalid PDF aliases.');
        payload.name_aliases = [...record.name_aliases];
      }
      return run(async (requestSignal, check) => {
        const row = await rowRequest(() => client.from('documents').insert(payload).select(DOCUMENT_COLUMNS).single(), requestSignal, check);
        check(); owned(row); matchIdentity(row, payload);
        requireValue(row.archived === false && row.page_count === payload.page_count, 'Cloud did not confirm the new PDF fields.');
        return remember(row);
      });
    },
    async ensureDocumentFile(row, blob) {
      const proof = proofOf(row);
      return run(async (requestSignal, check) => {
        // Read current published bytes even when their hash differs from the
        // original import. Other app flows may have changed the PDF in place.
        try { return await download(proof.file_path, requestSignal, check); } catch (error) {
          check(); if (status(error) !== 404) throw error;
        }
        await verifyOriginal(blob, proof.content_sha256, check, proof.file_size); check();
        const fresh = await readDocumentNow(proof.id, requestSignal, check); check();
        matchIdentity(fresh, proof);
        if (fresh.updated_at !== proof.updated_at || fresh.archived !== proof.archived
          || fresh.user_archived_at !== null || proof.user_archived_at !== null) throw conflict('The missing PDF no longer matches the read repair target.');
        try { await upload(proof.file_path, blob, check); } catch (error) {
          check(); if (!objectExists(error)) throw error;
        }
        check();
        // A competing repair/editor can win the create-only race. Return its
        // current published PDF, not the retained original or its old hash.
        const current = await download(proof.file_path, requestSignal, check); check();
        storageDownloads(client).invalidate(proof.file_path);
        return current;
      }, uploadTimeoutMs);
    },
    async addAlias(row, name) {
      const proof = proofOf(row);
      requireValue(typeof name === 'string' && name.trim(), 'A PDF alias is required.');
      return run(async (requestSignal, check) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const fresh = await readDocumentNow(proof.id, requestSignal, check); check();
          matchIdentity(fresh, proof);
          if (fresh.archived !== false || fresh.user_archived_at !== null) throw conflict('Read an active document before adding an alias.');
          requireValue(fresh.name_aliases === null || (Array.isArray(fresh.name_aliases) && fresh.name_aliases.every(value => typeof value === 'string')), 'Invalid existing PDF aliases.');
          const aliases = [...new Set([...(fresh.name_aliases || []), name])];
          if (fresh.name === name || (fresh.name_aliases || []).includes(name)) return fresh;
          const result = await rowRequest(() => {
            let query = cas(proofs.get(fresh), { name_aliases: aliases });
            query = fresh.name_aliases === null ? query.is('name_aliases', null) : query.eq('name_aliases', textArrayLiteral(fresh.name_aliases));
            return query.select(DOCUMENT_COLUMNS).maybeSingle();
          }, requestSignal, check);
          check();
          if (result) return confirmMutation(result, fresh, { name_aliases: aliases, archived: false });
        }
        throw conflict('The aliases kept changing; read the document before retrying.');
      });
    },
    async reviveDocument(row) {
      const proof = proofOf(row);
      if (proof.archived !== true || proof.user_archived_at !== null) throw conflict('Only an automatically archived document may be revived.');
      return run(async (requestSignal, check) => {
        const result = await rowRequest(() => cas(proof, { archived: false }).select(DOCUMENT_COLUMNS).maybeSingle(), requestSignal, check);
        check(); return confirmMutation(result, proof, { archived: false });
      });
    },
    async archiveDocument(row) {
      const proof = proofOf(row);
      if (proof.archived !== false || proof.user_archived_at !== null) throw conflict('Read the active replacement target before archiving it.');
      try {
        return await run(async (requestSignal, check) => {
          const result = await rowRequest(() => cas(proof, { archived: true }).select(DOCUMENT_COLUMNS).maybeSingle(), requestSignal, check);
          check(); return confirmMutation(result, proof, { archived: true });
        });
      } catch (error) {
        assertCurrent();
        const uncertain = error?.code === 'DOCUMENT_UPLOAD_TIMEOUT' || error instanceof TypeError
          || status(error) === 0 || status(error) >= 500 || /fetch failed|failed to fetch|network/i.test(error?.message || '');
        if (!uncertain) throw error;
        return run(async (requestSignal, check) => {
          const fresh = await readDocumentNow(proof.id, requestSignal, check); check();
          matchIdentity(fresh, proof);
          if (fresh.archived !== true || fresh.user_archived_at !== null) throw error;
          return fresh;
        });
      }
    },
  };
}
