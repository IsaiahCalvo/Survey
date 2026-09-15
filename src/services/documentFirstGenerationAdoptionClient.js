import { createDocumentFirstGenerationAdoptionIds, documentFirstGenerationAdoptionBody,
  validateDocumentFirstGenerationAdoptionReceipt } from './documentFirstGenerationAdoption.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuid = value => typeof value === 'string' && UUID.test(value);
const fail = (code, message = 'The document upgrade was kept for retry.') => Object.assign(
  new Error(message), { code });
const check = (value, code = 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT', message) => {
  if (!value) throw fail(code, message);
};

export function createDocumentFirstGenerationAdoptionClient({ store, transport,
  getActorUserId, getAccessToken, isCurrent, reacquire, responseTimeoutMs = 60_000 } = {}) {
  check(store && ['get', 'reserve', 'putReview', 'markConsent', 'putConfirmed',
    'putPublished', 'finish'].every(name => typeof store[name] === 'function')
    && typeof transport === 'function' && typeof getActorUserId === 'function'
    && typeof getAccessToken === 'function' && typeof isCurrent === 'function'
    && typeof reacquire === 'function' && Number.isSafeInteger(responseTimeoutMs)
    && responseTimeoutMs > 0 && responseTimeoutMs <= 120_000);
  const active = new Map();
  const current = (actorUserId, documentId) => {
    let valid = false;
    try { valid = isCurrent({ actorUserId, documentId }) === true; } catch { /* fail closed */ }
    check(valid && getActorUserId() === actorUserId,
      'DOCUMENT_FIRST_GENERATION_ADOPTION_STALE', 'The document or account changed.');
  };
  const expected = (row) => ({ actorUserId: row.actorUserId, documentId: row.documentId,
    adoptionOperationId: row.ids.adoptionOperationId, sourceId: row.ids.sourceId,
    candidateOperationId: row.ids.candidateOperationId,
    archiveOperationIds: row.ids.archiveOperationIds });
  async function send(row, body, signal) {
    current(row.actorUserId, row.documentId);
    const accessToken = await getAccessToken({ actorUserId: row.actorUserId, signal });
    current(row.actorUserId, row.documentId);
    check(typeof accessToken === 'string' && accessToken.length > 0 && accessToken.length <= 16384
      && !/[\s\u0000-\u001f\u007f]/.test(accessToken),
    'DOCUMENT_FIRST_GENERATION_ADOPTION_ACTOR_CHANGED');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, responseTimeoutMs);
    let rejectAbort;
    const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(fail('DOCUMENT_FIRST_GENERATION_ADOPTION_UNCONFIRMED'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
    try {
      const request = Promise.resolve().then(() => transport({ body, accessToken,
        signal: controller.signal }));
      const value = await Promise.race([request, aborted]);
      current(row.actorUserId, row.documentId);
      return validateDocumentFirstGenerationAdoptionReceipt(value, expected(row));
    } catch (problem) {
      if (controller.signal.aborted) throw fail('DOCUMENT_FIRST_GENERATION_ADOPTION_UNCONFIRMED');
      throw problem;
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', abort);
    }
  }
  async function status(row, signal) {
    return send(row, documentFirstGenerationAdoptionBody.status(row.ids.adoptionOperationId), signal);
  }
  async function settlePublished(row, { signal, retireGeneration, install }) {
    check(row.phase === 'published' && row.receipt?.state === 'published');
    current(row.actorUserId, row.documentId);
    check(typeof retireGeneration === 'function' && typeof install === 'function');
    await retireGeneration({ replacementGenerationId: row.receipt.generation_id });
    current(row.actorUserId, row.documentId);
    const opened = await reacquire({ documentId: row.documentId, signal });
    current(row.actorUserId, row.documentId);
    const bundle = opened?.checkedBundle;
    check(opened?.mode === 'checked' && opened.actorUserId === row.actorUserId
      && opened.documentId === row.documentId && bundle?.pdfGenerationId === row.receipt.generation_id
      && bundle.contentModelVersion === 2
      && bundle.pdf?.byte_length === row.receipt.pdf.byte_length
      && bundle.pdf?.content_sha256 === row.receipt.pdf.content_sha256
      && bundle.legacy_sidecar_migration?.version === 2
      && bundle.legacy_sidecar_migration?.state === 'archived'
      && bundle.legacy_sidecar_migration?.origin?.mode === 'legacy'
      && bundle.legacy_sidecar_migration.origin.adoption_operation_id
        === row.ids.adoptionOperationId,
    'DOCUMENT_FIRST_GENERATION_ADOPTION_STALE');
    check(await install({ opened, publication: row.receipt }) === true,
      'DOCUMENT_FIRST_GENERATION_ADOPTION_STALE');
    current(row.actorUserId, row.documentId);
    await store.finish(row.actorUserId, row.documentId, row.revision,
      row.ids.adoptionOperationId);
    return Object.freeze({ publication: row.receipt, opened });
  }
  async function reconcileAfter(row, problem, signal) {
    try {
      const found = await status(row, signal);
      if (found.state === 'missing' || found.state === 'review') throw problem;
      return found;
    } catch (statusProblem) {
      if (statusProblem === problem) throw problem;
      throw problem?.code ? problem : statusProblem;
    }
  }
  async function resumeRow(row, options) {
    const { signal } = options;
    if (row.phase === 'reserved' || row.phase === 'review') return Object.freeze({ row, needsReview: true });
    if (row.phase === 'consent') {
      let received;
      try {
        received = await send(row, documentFirstGenerationAdoptionBody.confirm(
          row.ids.adoptionOperationId, row.consentedReviewSha256), signal);
      } catch (problem) { received = await reconcileAfter(row, problem, signal); }
      if (received.state === 'published') row = await store.putPublished(row.actorUserId,
        row.documentId, row.revision, received);
      else {
        check(received.state === 'confirmed', 'DOCUMENT_FIRST_GENERATION_ADOPTION_UNCONFIRMED');
        row = await store.putConfirmed(row.actorUserId, row.documentId, row.revision, received);
      }
    }
    if (row.phase === 'confirmed') {
      let received;
      try {
        received = await send(row, documentFirstGenerationAdoptionBody.publish(
          row.ids.adoptionOperationId, row.consentedReviewSha256), signal);
      } catch (problem) { received = await reconcileAfter(row, problem, signal); }
      check(received.state === 'published', 'DOCUMENT_FIRST_GENERATION_ADOPTION_UNCONFIRMED');
      row = await store.putPublished(row.actorUserId, row.documentId, row.revision, received);
    }
    return settlePublished(row, options);
  }
  async function serialized(actorUserId, documentId, run) {
    const key = `${actorUserId}:${documentId}`;
    if (active.has(key)) return active.get(key);
    const promise = Promise.resolve().then(run).finally(() => {
      if (active.get(key) === promise) active.delete(key);
    });
    active.set(key, promise);
    return promise;
  }
  return Object.freeze({
    async review({ documentId, captureAccepted, revalidateCapture, signal } = {}) {
      const actorUserId = getActorUserId();
      check(uuid(actorUserId) && uuid(documentId) && typeof captureAccepted === 'function'
        && typeof revalidateCapture === 'function');
      return serialized(actorUserId, documentId, async () => {
        current(actorUserId, documentId);
        let row = await store.get(actorUserId, documentId);
        if (!row) row = (await store.reserve(actorUserId, documentId,
          createDocumentFirstGenerationAdoptionIds())).row;
        current(actorUserId, documentId);
        if (row.phase !== 'reserved') return Object.freeze({ row, needsReview: row.phase === 'review' });
        const capture = await captureAccepted();
        current(actorUserId, documentId);
        const received = await send(row, documentFirstGenerationAdoptionBody.preview(
          row.ids, documentId), signal);
        check(received.state === 'review');
        current(actorUserId, documentId);
        let valid = false;
        try { valid = await revalidateCapture(capture); } catch { /* fail closed */ }
        check(valid, 'DOCUMENT_FIRST_GENERATION_ADOPTION_CONFLICT',
          'The document changed. Review the upgrade again.');
        row = await store.putReview(actorUserId, documentId, row.revision, received);
        current(actorUserId, documentId);
        return Object.freeze({ row, needsReview: true });
      });
    },
    async confirm({ documentId, reviewSha256, signal, retireGeneration, install } = {}) {
      const actorUserId = getActorUserId();
      check(uuid(actorUserId) && uuid(documentId));
      return serialized(actorUserId, documentId, async () => {
        current(actorUserId, documentId);
        let row = await store.get(actorUserId, documentId);
        check(row?.phase === 'review' && row.receipt?.review_sha256 === reviewSha256,
          'DOCUMENT_FIRST_GENERATION_ADOPTION_CONFLICT', 'Review the document upgrade again.');
        row = await store.markConsent(actorUserId, documentId, row.revision, reviewSha256);
        current(actorUserId, documentId);
        return resumeRow(row, { signal, retireGeneration, install });
      });
    },
    async resume({ documentId, signal, retireGeneration, install } = {}) {
      const actorUserId = getActorUserId();
      check(uuid(actorUserId) && uuid(documentId));
      return serialized(actorUserId, documentId, async () => {
        current(actorUserId, documentId);
        let row = await store.get(actorUserId, documentId);
        if (!row) return Object.freeze({ noIntent: true });
        if (row.phase !== 'published') {
          let found;
          try { found = await status(row, signal); } catch { found = null; }
          if (found?.state === 'published') row = await store.putPublished(actorUserId,
            documentId, row.revision, found);
          else if (found?.state === 'review' && row.phase === 'reserved') {
            row = await store.putReview(actorUserId, documentId, row.revision, found);
          }
          else if (found?.state === 'confirmed' && row.phase === 'consent') {
            row = await store.putConfirmed(actorUserId, documentId, row.revision, found);
          }
        }
        return resumeRow(row, { signal, retireGeneration, install });
      });
    },
  });
}
