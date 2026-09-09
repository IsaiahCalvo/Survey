import { captureCheckedPageStructure } from './checkedPageStructure.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEQ = /^(0|[1-9][0-9]{0,18})$/;
const safeCodes = new Set(['DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED',
  'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE', 'DOCUMENT_PAGE_REPLACEMENT_STALE']);
const fail = code => Object.assign(new Error(code === 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED'
  ? 'A prior page change must be resolved before another can start.'
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

function validateCapture(value, actorUserId, documentId) {
  check(object(value) && value.version === 1 && value.actorUserId === actorUserId
    && value.documentId === documentId && uuid(value.pdfGenerationId)
    && Number.isSafeInteger(value.coveredSeq) && value.coveredSeq >= 0);
  return { generationId: value.pdfGenerationId, walHead: String(value.coveredSeq) };
}

function publication(value, body) {
  check(exact(value, ['version', 'state', 'document_id', 'source_id', 'candidate_operation_id',
    'archive_operation_ids', 'previous_generation_id', 'generation_id', 'wal_head', 'published_at']));
  check(value.version === 1 && value.state === 'published' && value.document_id === body.document_id
    && value.source_id === body.source_id && value.candidate_operation_id === body.candidate_operation_id
    && JSON.stringify(value.archive_operation_ids) === JSON.stringify(body.archive_operation_ids)
    && value.previous_generation_id === body.generation_id && uuid(value.generation_id)
    && value.generation_id !== body.generation_id && value.wal_head === body.wal_head
    && typeof value.published_at === 'string' && Number.isFinite(Date.parse(value.published_at)));
  return structuredClone(value);
}

async function readResponse(response, body) {
  check(response instanceof Response);
  let value;
  try { value = await response.json(); } catch { throw fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE'); }
  if (!response.ok) {
    const code = value?.error?.code;
    if (code === 'replacement_conflict' || code === 'replacement_unconfirmed') {
      throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED');
    }
    throw fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE');
  }
  check(exact(value, ['replacement']));
  return publication(value.replacement, body);
}

/** Browser caller for the private replacement Request handler. `transport` is
 * a host-owned seam; this module does not guess or mount an endpoint. The IDB
 * intent is the only source of retry IDs. It stores no PDF or annotation bytes.
 */
export function createDocumentPageReplacementClient({ store, transport, reacquire,
  getActorUserId, getAccessToken, isCurrent } = {}) {
  check(store && ['get', 'reserve', 'discardPending', 'markDispatched', 'markPublished', 'finish']
    .every(name => typeof store[name] === 'function') && typeof transport === 'function'
    && typeof reacquire === 'function' && typeof getActorUserId === 'function'
    && typeof getAccessToken === 'function' && typeof isCurrent === 'function');
  const pending = new Map();
  const current = (actorUserId, documentId) => {
    let valid = false;
    try { valid = isCurrent({ actorUserId, documentId }) === true; } catch { /* fail closed */ }
    check(valid && getActorUserId() === actorUserId, 'DOCUMENT_PAGE_REPLACEMENT_STALE');
  };
  async function run({ documentId, operation, captureAccepted, revalidateCapture,
    retireGeneration, install, persistSourceLocalState, currentGenerationId, localPageState,
    resumeOnly = false, signal } = {}) {
    const actorUserId = getActorUserId();
    check(uuid(actorUserId) && uuid(documentId) && uuid(currentGenerationId)
      && typeof retireGeneration === 'function'
      && typeof install === 'function' && typeof persistSourceLocalState === 'function');
    current(actorUserId, documentId);
    let row = await store.get(actorUserId, documentId);
    current(actorUserId, documentId);
    let recoveredPrior = row !== null;
    if (!row) {
      if (resumeOnly) return Object.freeze({ recoveredPrior: false, noIntent: true });
      check(typeof captureAccepted === 'function' && typeof revalidateCapture === 'function');
      const capture = await captureAccepted();
      current(actorUserId, documentId);
      const frontier = validateCapture(capture, actorUserId, documentId);
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
      let response;
      try { response = await transport({ body: structuredClone(row.body), accessToken, signal }); }
      catch { throw fail('DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED'); }
      const receipt = await readResponse(response, row.body);
      current(actorUserId, documentId);
      row = await store.markPublished(actorUserId, documentId, row.revision, receipt);
      }
    }
    current(actorUserId, documentId);
    const opened = await reacquire({ documentId, signal });
    current(actorUserId, documentId);
    check(opened?.mode === 'checked' && opened.actorUserId === actorUserId
      && opened.documentId === documentId && opened.checkedBundle
      && uuid(opened.checkedBundle.pdfGenerationId)
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
      check(uuid(actorUserId) && uuid(documentId));
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
      check(uuid(actorUserId) && uuid(documentId));
      const key = `${actorUserId}:${documentId}`;
      if (pending.has(key)) return pending.get(key);
      const task = run({ ...input, resumeOnly: true }).catch(error => {
        throw safeCodes.has(error?.code) ? error : fail('DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE');
      }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
      pending.set(key, task); return task;
    },
  });
}
