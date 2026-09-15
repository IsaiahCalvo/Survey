import { captureCheckedPageStructure } from './checkedPageStructure.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEQ = /^(0|[1-9][0-9]{0,18})$/;
const MAX_RESPONSE_BYTES = 16 * 1024;
const safeCodes = new Set(['DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE', 'DOCUMENT_PAGE_REPLACEMENT_STALE',
  'DOCUMENT_PAGE_REPLACEMENT_EXPIRED', 'DOCUMENT_PAGE_REPLACEMENT_ADOPTION_REQUIRED']);
const fail = code => Object.assign(new Error(code === 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED'
  ? 'A prior page change must be resolved before another can start.'
  : code === 'DOCUMENT_PAGE_REPLACEMENT_ADOPTION_REQUIRED'
    ? "Review and adopt this document's entity list before replacing pages."
  : code === 'DOCUMENT_PAGE_REPLACEMENT_EXPIRED'
    ? 'The prior page change expired before it was published.'
  : code === 'DOCUMENT_PAGE_REPLACEMENT_STALE'
    ? 'The document or account changed. Your page change was kept.'
    : 'Checked page changes are not available. Your page change was kept.'), { code });
const check = (value, code = 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE') => { if (!value) throw fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value)
  && Object.keys(value).sort().join('|') === [...fields].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const seq = value => typeof value === 'string' && SEQ.test(value)
  && BigInt(value) <= 9223372036854775807n;

function captureOperation(value) {
  check(object(value));
  const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'type');
  check(typeDescriptor?.enumerable && Object.hasOwn(typeDescriptor, 'value'));
  const type = typeDescriptor.value;
  const fields = { move: ['type', 'from', 'to'], reorder: ['type', 'from', 'to'],
    insert: ['type', 'afterPage'], delete: ['type', 'page'], rotate: ['type', 'page', 'delta'],
    copy: ['type', 'source', 'afterPage'], duplicate: ['type', 'page'] }[type];
  check(fields && exact(value, fields));
  const result = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    check(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
    const entry = descriptor.value;
    if (field !== 'type') check(Number.isSafeInteger(entry)
      && (field === 'delta' ? entry % 90 === 0 : entry > 0));
    result[field] = entry;
  }
  return result;
}

function validateCapture(value, actorUserId, documentId, expectedContentModelVersion) {
  const capturedContentModelVersion = value?.contentModelVersion
    ?? value?.annotationState?.contentModelVersion ?? 1;
  check(object(value) && value.version === 1 && value.actorUserId === actorUserId
    && value.documentId === documentId && uuid(value.pdfGenerationId)
    && Number.isSafeInteger(value.coveredSeq) && value.coveredSeq >= 0
    && (value.contentModelVersion === undefined || [1, 2].includes(value.contentModelVersion))
    && (value.annotationState?.contentModelVersion === undefined
      || value.annotationState.contentModelVersion === capturedContentModelVersion)
    && capturedContentModelVersion === expectedContentModelVersion);
  return { generationId: value.pdfGenerationId, walHead: String(value.coveredSeq) };
}

function publication(value, body) {
  const v4 = value?.version === 4;
  check(body.archive_operation_ids.length === 1 || v4);
  check(exact(value, ['version', ...(v4
    ? ['content_model_version', 'aggregate_admission_version', 'offered_archive_operation_ids',
      'used_archive_operation_ids', 'legacy_sidecar_migration'] : []),
  'state', 'document_id', 'source_id', 'candidate_operation_id', 'archive_operation_ids',
  'previous_generation_id', 'generation_id', 'wal_head', 'published_at']));
  check(value.version === (v4 ? 4 : 1) && value.state === 'published' && value.document_id === body.document_id
    && value.source_id === body.source_id && value.candidate_operation_id === body.candidate_operation_id
    && JSON.stringify(value.archive_operation_ids) === JSON.stringify(body.archive_operation_ids)
    && value.previous_generation_id === body.generation_id && uuid(value.generation_id)
    && value.generation_id !== body.generation_id && value.wal_head === body.wal_head
    && typeof value.published_at === 'string' && Number.isFinite(Date.parse(value.published_at)));
  if (v4) check(value.content_model_version === 2 && value.aggregate_admission_version === 1
    && JSON.stringify(value.offered_archive_operation_ids) === JSON.stringify(body.archive_operation_ids)
    && Array.isArray(value.used_archive_operation_ids)
    && [1, 2].includes(value.used_archive_operation_ids.length)
    && JSON.stringify(value.used_archive_operation_ids)
      === JSON.stringify(body.archive_operation_ids.slice(0, value.used_archive_operation_ids.length))
    && (value.legacy_sidecar_migration === null
      || (exact(value.legacy_sidecar_migration, ['version', 'state', 'source_generation_id'])
        && value.legacy_sidecar_migration.version === 1
        && value.legacy_sidecar_migration.state === 'archived'
        && uuid(value.legacy_sidecar_migration.source_generation_id))));
  return structuredClone(value);
}

function terminal(value, body, actorUserId) {
  const v4 = value?.version === 4;
  check(body.archive_operation_ids.length === 1 || v4);
  check(exact(value, ['version', ...(v4 ? ['aggregate_admission_version',
    'offered_archive_operation_ids', 'used_archive_operation_ids'] : []),
  'state', 'actor_user_id', 'document_id', 'source_id',
    'candidate_operation_id', 'archive_operation_ids', 'expected_generation_id',
    'expected_wal_head', 'operation', 'prepared_at', 'expires_at']));
  check(value.version === (v4 ? 4 : 1) && value.state === 'expired' && value.actor_user_id === actorUserId
    && value.document_id === body.document_id && value.source_id === body.source_id
    && value.candidate_operation_id === body.candidate_operation_id
    && JSON.stringify(value.archive_operation_ids) === JSON.stringify(body.archive_operation_ids)
    && value.expected_generation_id === body.generation_id
    && value.expected_wal_head === body.wal_head
    && JSON.stringify(captureOperation(value.operation)) === JSON.stringify(body.operation)
    && typeof value.prepared_at === 'string' && Number.isFinite(Date.parse(value.prepared_at))
    && typeof value.expires_at === 'string' && Number.isFinite(Date.parse(value.expires_at)));
  if (v4) check(value.aggregate_admission_version === 1
    && JSON.stringify(value.offered_archive_operation_ids) === JSON.stringify(body.archive_operation_ids)
    && (value.used_archive_operation_ids === null
      || (Array.isArray(value.used_archive_operation_ids)
        && value.used_archive_operation_ids.length >= 1
        && value.used_archive_operation_ids.length <= body.archive_operation_ids.length
        && JSON.stringify(value.used_archive_operation_ids)
          === JSON.stringify(body.archive_operation_ids.slice(0, value.used_archive_operation_ids.length)))));
  return structuredClone(value);
}

async function responseJson(response, { signal, timeoutMs }) {
  check(response instanceof Response && response.body);
  const reader = response.body.getReader(), chunks = [];
  const deadline = Date.now() + timeoutMs;
  let size = 0, aborted = signal?.aborted === true;
  const cancel = () => {
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* closed */ }
  };
  const abort = () => { aborted = true; cancel(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const declared = response.headers.get('content-length');
    check(!aborted && (declared === null || (/^(0|[1-9][0-9]*)$/.test(declared)
      && Number(declared) <= MAX_RESPONSE_BYTES)));
    for (;;) {
      check(!aborted && Date.now() < deadline);
      const remaining = Math.max(1, deadline - Date.now());
      let timer;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(
          () => reject(fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE')), remaining,
        ); }),
      ]).finally(() => clearTimeout(timer));
      check(!aborted && Date.now() < deadline);
      if (done) break;
      check(value instanceof Uint8Array);
      size += value.byteLength; check(size <= MAX_RESPONSE_BYTES);
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    cancel();
    try { reader.releaseLock(); } catch { /* pending read */ }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE'); }
}

const expiredFailure = row => Object.assign(fail('DOCUMENT_PAGE_REPLACEMENT_EXPIRED'), {
  recovery: Object.freeze({ revision: row.revision,
    candidateOperationId: row.body.candidate_operation_id }),
});

async function readResponse(response, body, actorUserId, options) {
  const value = await responseJson(response, options);
  if (!response.ok) {
    const code = value?.error?.code;
    if (code === 'replacement_expired') {
      check(response.status === 409);
      check(exact(value, ['error', 'terminal']) && exact(value.error, ['code', 'message'])
        && typeof value.error.message === 'string');
      return { terminal: terminal(value.terminal, body, actorUserId) };
    }
    if (code === 'replacement_conflict' || code === 'replacement_unconfirmed') {
      throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
    }
    if (code === 'legacy_entity_adoption_required') {
      check(response.status === 409);
      throw fail('DOCUMENT_PAGE_REPLACEMENT_ADOPTION_REQUIRED');
    }
    throw fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE');
  }
  check(exact(value, ['replacement']));
  return { publication: publication(value.replacement, body) };
}

/** Browser caller for the private replacement Request handler. `transport` is
 * a host-owned seam; this module does not guess or mount an endpoint. The IDB
 * intent is the only source of retry IDs. It stores no PDF or annotation bytes.
 */
export function createDocumentPageReplacementClient({ store, transport, reacquire,
  getActorUserId, getAccessToken, isCurrent, responseTimeoutMs = 30_000 } = {}) {
  check(store && ['get', 'reserve', 'discardPending', 'markDispatched', 'markPublished',
    'markExpired', 'resetExpired', 'finish']
    .every(name => typeof store[name] === 'function') && typeof transport === 'function'
    && typeof reacquire === 'function' && typeof getActorUserId === 'function'
    && typeof getAccessToken === 'function' && typeof isCurrent === 'function'
    && Number.isSafeInteger(responseTimeoutMs) && responseTimeoutMs > 0
    && responseTimeoutMs <= 120_000);
  const pending = new Map();
  const current = (actorUserId, documentId) => {
    let valid = false;
    try { valid = isCurrent({ actorUserId, documentId }) === true; } catch { /* fail closed */ }
    check(valid && getActorUserId() === actorUserId, 'DOCUMENT_PAGE_REPLACEMENT_STALE');
  };
  async function run({ documentId, operation, captureAccepted, revalidateCapture,
    retireGeneration, install, persistSourceLocalState, currentGenerationId, localPageState,
    contentModelVersion = 1, resumeOnly = false, signal } = {}) {
    const actorUserId = getActorUserId();
    check(uuid(actorUserId) && uuid(documentId) && uuid(currentGenerationId)
      && [1, 2].includes(contentModelVersion)
      && typeof retireGeneration === 'function'
      && typeof install === 'function' && typeof persistSourceLocalState === 'function');
    current(actorUserId, documentId);
    let row = await store.get(actorUserId, documentId);
    current(actorUserId, documentId);
    let recoveredPrior = row !== null;
    if (row?.phase === 'expired') throw expiredFailure(row);
    if (!row) {
      if (resumeOnly) return Object.freeze({ recoveredPrior: false, noIntent: true });
      check(typeof captureAccepted === 'function' && typeof revalidateCapture === 'function');
      const capture = await captureAccepted();
      current(actorUserId, documentId);
      const frontier = validateCapture(capture, actorUserId, documentId, contentModelVersion);
      const reserved = await store.reserve(actorUserId, documentId, { operation,
        generationId: frontier.generationId, walHead: frontier.walHead, localPageState });
      row = reserved.row;
      recoveredPrior = !reserved.created;
      current(actorUserId, documentId);
      let valid = false;
      try { valid = await revalidateCapture(capture); } catch { /* fail closed */ }
      if (!valid) {
        if (reserved.created) {
          current(actorUserId, documentId);
          try { await store.discardPending(actorUserId, documentId, row.revision); }
          catch { throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED'); }
          current(actorUserId, documentId);
        }
        throw fail('DOCUMENT_PAGE_REPLACEMENT_STALE');
      }
    }
    current(actorUserId, documentId);
    if (row.phase !== 'published') {
      await persistSourceLocalState({ generationId: row.body.generation_id,
        localPageState: row.localPageState });
      current(actorUserId, documentId);
      if (row.phase === 'pending') row = await store.markDispatched(actorUserId, documentId, row.revision);
      current(actorUserId, documentId);
      if (row.phase === 'published') {
        // Another same-process caller may have settled the exact intent while
        // this caller waited for the IDB transaction.
      } else {
      const accessToken = await getAccessToken({ actorUserId, signal });
      current(actorUserId, documentId);
      check(typeof accessToken === 'string' && accessToken.length > 0 && accessToken.length <= 16384
        && !/[\s\u0000-\u001f\u007f]/.test(accessToken));
      const controller = new AbortController(), deadline = Date.now() + responseTimeoutMs;
      let late = false, timer;
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();
      const transportPromise = Promise.resolve().then(() => transport({
        body: structuredClone(row.body), accessToken, signal: controller.signal,
      }));
      // A host adapter must honor abort. If it returns a late response anyway,
      // drain no bytes and cancel that body; the dispatched intent stays saved.
      void transportPromise.then(response => {
        if (late) {
          try { void Promise.resolve(response?.body?.cancel()).catch(() => {}); }
          catch { /* no readable body */ }
        }
      }, () => {});
      let result, response, stop;
      try {
        const stopped = new Promise((_, reject) => {
          stop = () => reject(fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED'));
          if (controller.signal.aborted) { stop(); return; }
          controller.signal.addEventListener('abort', stop, { once: true });
          timer = setTimeout(() => controller.abort(), responseTimeoutMs);
        });
        response = await Promise.race([transportPromise, stopped]);
      } catch {
        late = true; controller.abort();
        clearTimeout(timer); controller.signal.removeEventListener('abort', stop);
        signal?.removeEventListener('abort', abort);
        throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
      }
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0 || controller.signal.aborted) {
          try { void Promise.resolve(response?.body?.cancel()).catch(() => {}); }
          catch { /* no readable body */ }
          throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
        }
        result = await readResponse(response, row.body, actorUserId,
          { signal: controller.signal, timeoutMs: remaining });
      } finally {
        clearTimeout(timer); controller.signal.removeEventListener('abort', stop);
        signal?.removeEventListener('abort', abort);
      }
      current(actorUserId, documentId);
      if (result.terminal) {
        row = await store.markExpired(actorUserId, documentId, row.revision, result.terminal);
        current(actorUserId, documentId);
        throw expiredFailure(row);
      }
      row = await store.markPublished(actorUserId, documentId, row.revision, result.publication);
      }
    }
    current(actorUserId, documentId);
    const opened = await reacquire({ documentId, signal });
    current(actorUserId, documentId);
    check(opened?.mode === 'checked' && opened.actorUserId === actorUserId
      && opened.documentId === documentId && opened.checkedBundle
      && uuid(opened.checkedBundle.pdfGenerationId)
      && (opened.checkedBundle.contentModelVersion ?? 1)
        === (row.publication.version === 4 ? 2 : 1)
      && opened.checkedBundle.pdfGenerationId !== row.body.generation_id,
    'DOCUMENT_PAGE_REPLACEMENT_STALE');
    if (currentGenerationId === row.body.generation_id) {
      await retireGeneration({ replacementGenerationId: opened.checkedBundle.pdfGenerationId });
      current(actorUserId, documentId);
    } else {
      check(currentGenerationId === opened.checkedBundle.pdfGenerationId,
        'DOCUMENT_PAGE_REPLACEMENT_STALE');
    }
    check(await install({ checkedBundle: opened.checkedBundle, publication: row.publication,
      localPageState: row.localPageState, operation: row.body.operation }) === true,
      'DOCUMENT_PAGE_REPLACEMENT_STALE');
    current(actorUserId, documentId);
    await store.finish(actorUserId, documentId, row.revision);
    return Object.freeze({ publication: structuredClone(row.publication), checkedBundle: opened.checkedBundle,
      recoveredPrior });
  }
  return Object.freeze({
    replace(input) {
      const actorUserId = getActorUserId(), documentId = input?.documentId;
      check(uuid(actorUserId) && uuid(documentId)
        && [1, 2].includes(input?.contentModelVersion ?? 1));
      const key = `${actorUserId}:${documentId}`;
      if (pending.has(key)) throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
      let captured;
      try { captured = { ...input, operation: captureOperation(input.operation),
        localPageState: captureCheckedPageStructure(input.localPageState) }; }
      catch { throw fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE'); }
      const task = run(captured).catch(error => { throw safeCodes.has(error?.code) ? error : fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE'); })
        .finally(() => { if (pending.get(key) === task) pending.delete(key); });
      pending.set(key, task);
      return task;
    },
    resume(input) {
      const actorUserId = getActorUserId(), documentId = input?.documentId;
      check(uuid(actorUserId) && uuid(documentId)
        && [1, 2].includes(input?.contentModelVersion ?? 1));
      const key = `${actorUserId}:${documentId}`;
      if (pending.has(key)) return pending.get(key);
      const task = run({ ...input, resumeOnly: true }).catch(error => {
        throw safeCodes.has(error?.code) ? error : fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE');
      }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
      pending.set(key, task); return task;
    },
    async resetExpired({ documentId, expectedRevision, candidateOperationId } = {}) {
      const actorUserId = getActorUserId();
      check(uuid(actorUserId) && uuid(documentId) && Number.isSafeInteger(expectedRevision)
        && expectedRevision > 0 && uuid(candidateOperationId));
      const key = `${actorUserId}:${documentId}`;
      if (pending.has(key)) throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
      current(actorUserId, documentId);
      await store.resetExpired(actorUserId, documentId, expectedRevision, candidateOperationId);
      // The exact IDB CAS is the commit point. If the caller's tab or actor
      // changes while it commits, the old row is still safely cleared; do not
      // turn that confirmed result into a false "kept" report.
      return true;
    },
  });
}
